// ═══════════════════════════════════════════════════════════════════════
//  skewt-engine.js — Motor termodinàmic i de vent per al Skew-T
//  Sense dependències, JS pur. No toca el DOM.
//  Llegeix el format de dades produït per t_final_png_paletes.py / mapaarome.js
//  Inclou: SARS (Sounding Analog Retrieval System)
//
//  ── NOVETAT D'AQUESTA VERSIÓ ──────────────────────────────────────────
//  AUTÒNOM: carrega la pressió superficial REAL des de 
//  gfs_pressio_superficial_ne.json (GFS) o del fitxer que se li passi.
//  El sondeig arrenca a la pressió REAL de cada punt (no a 1000 hPa fix).
// ═══════════════════════════════════════════════════════════════════════

(function (global) {
    'use strict';

    // ─── CONSTANTS FÍSIQUES ─────────────────────────────────────────────
    const RD = 287.05;
    const CP = 1004.6;
    const RD_CP = RD / CP;
    const G0 = 9.80665;
    const EPS = 0.6219707;
    const L = 2.501e6;

    const NIVELLS_PRESSIO = [1000, 950, 925, 900, 875, 850, 800, 750, 700, 650,
                              600, 550, 500, 450, 400, 350, 300, 250, 200, 150, 100];

    // ─── PRESSIÓ SUPERFICIAL GLOBAL (carregada automàticament) ──────────
    let pressioSuperficialGlobal = null;
    let pressioSuperficialCoords = null;
    let pressioSuperficialDades = null;

    // ─── UTILITATS BÀSIQUES ─────────────────────────────────────────────

    function esFinit(v) {
        return v !== null && v !== undefined && !isNaN(v) && isFinite(v);
    }

    function pressioAAlcada(pHpa) {
        const T0 = 288.15, p0 = 1013.25, lapse = 0.0065;
        return (T0 / lapse) * (1.0 - Math.pow(pHpa / p0, RD * lapse / G0));
    }

    function alcadaAPressio(zM) {
        const T0 = 288.15, p0 = 1013.25, lapse = 0.0065;
        return p0 * Math.pow(1.0 - (lapse * zM) / T0, G0 / (RD * lapse));
    }

    // Bolton (1980), eq. 10 — e_sat en hPa, T en °C.
    function esatBolton(tC) { return 6.112 * Math.exp((17.67 * tC) / (tC + 243.5)); }
    function wsat(tC, pHpa) { const es = esatBolton(tC); return EPS * es / Math.max(pHpa - es, 0.1); }
    function tdFromRH(tC, rhPct) { const es = esatBolton(tC); const e = es * Math.max(0.01, Math.min(100, rhPct)) / 100; return (243.5 * Math.log(e / 6.112)) / (17.67 - Math.log(e / 6.112)); }

    // Bolton (1980), eq. 22 — temperatura del LCL.
    function lclBolton(tC, tdC, pHpa) {
        const tK = tC + 273.15, tdK = tdC + 273.15;
        const tLclK = 1.0 / (1.0 / (tdK - 56.0) + Math.log(tK / tdK) / 800.0) + 56.0;
        const pLcl = pHpa * Math.pow(tLclK / tK, 1.0 / RD_CP);
        return { p: pLcl, t: tLclK - 273.15 };
    }

    // Gradient pseudoadiabàtic saturat
    function gradientHumit(tC, pHpa) {
        const tK = tC + 273.15, es = esatBolton(tC);
        const ws = EPS * es / Math.max(pHpa - es, 0.1);
        const num = 1.0 + (L * ws) / (RD * tK);
        const den = 1.0 + (0.622 * L * L * ws) / (CP * RD * tK * tK);
        return (RD * tK) / (CP * pHpa) * (num / den);
    }

    function perfilMixedLayer(perfil, dpMix) {
        if (!perfil || perfil.p.length < 2) return null;
        const pSfc = perfil.p[0], pTopMix = pSfc - (dpMix || 100);
        let sumT = 0, sumTd = 0, count = 0;
        for (let i = 0; i < perfil.p.length; i++) {
            if (perfil.p[i] >= pTopMix) { sumT += perfil.t[i]; sumTd += perfil.td[i]; count++; }
            else break;
        }
        if (count === 0) return null;
        return perfilParcela(sumT / count, sumTd / count, pSfc, perfil.p);
    }

    function mitjanaMixedLayer(perfil, dpMix) {
        if (!perfil || perfil.p.length < 2) return null;
        const pSfc = perfil.p[0], pTopMix = pSfc - (dpMix || 100);
        let sumT = 0, sumTd = 0, count = 0;
        for (let i = 0; i < perfil.p.length; i++) {
            if (perfil.p[i] >= pTopMix) { sumT += perfil.t[i]; sumTd += perfil.td[i]; count++; }
            else break;
        }
        if (count === 0) return null;
        return { p: pSfc, t: sumT / count, td: sumTd / count };
    }

    function interpolarNivell(perfil, pTarget) {
        if (!perfil || !perfil.p || perfil.p.length < 2) return null;
        const p = perfil.p, t = perfil.t, td = perfil.td;
        if (pTarget > p[0] || pTarget < p[p.length - 1]) return null;
        for (let i = 0; i < p.length - 1; i++) {
            if (p[i] >= pTarget && p[i + 1] <= pTarget) {
                const denom = (p[i] - p[i + 1]) || 1;
                const f = (p[i] - pTarget) / denom;
                return { p: pTarget, t: t[i] + f * (t[i + 1] - t[i]), td: td[i] + f * (td[i + 1] - td[i]) };
            }
            if (p[i] === pTarget) return { p: pTarget, t: t[i], td: td[i] };
        }
        return null;
    }

    function interpolarTAAlcada(perfil, zTarget) {
        if (!perfil || !perfil.z || perfil.z.length < 2) return null;
        const z = perfil.z, t = perfil.t;
        const zMin = z[0], zMax = z[z.length - 1];
        if (zTarget < zMin || zTarget > zMax) return null;
        for (let i = 0; i < z.length - 1; i++) {
            if (z[i] <= zTarget && z[i + 1] >= zTarget) {
                const denom = (z[i + 1] - z[i]) || 1;
                const f = (zTarget - z[i]) / denom;
                return t[i] + f * (t[i + 1] - t[i]);
            }
            if (z[i] === zTarget) return t[i];
        }
        return null;
    }

    function descendirSecAPressio(tC, pOrigen, pDesti) {
        if (!esFinit(tC) || !esFinit(pOrigen) || !esFinit(pDesti) || pOrigen <= 0) return null;
        const tK = tC + 273.15;
        const tDestiK = tK * Math.pow(pDesti / pOrigen, RD_CP);
        return tDestiK - 273.15;
    }

    function perfilParcela(tSfc, tdSfc, pSfc, pLevels) {
        const lcl = lclBolton(tSfc, tdSfc, pSfc);
        const out = new Array(pLevels.length);
        for (let i = 0; i < pLevels.length; i++) {
            const pDest = pLevels[i];
            if (pDest >= pSfc) { out[i] = null; continue; }
            if (pDest >= lcl.p) {
                out[i] = (tSfc + 273.15) * Math.pow(pDest / pSfc, RD_CP) - 273.15;
            } else {
                let p = lcl.p, t = lcl.t;
                const nPassos = Math.max(1, Math.ceil((lcl.p - pDest) / 5));
                const dp = (lcl.p - pDest) / nPassos;
                for (let k = 0; k < nPassos; k++) {
                    const g1 = gradientHumit(t, p);
                    const tMig = t - g1 * (dp / 2);
                    const g2 = gradientHumit(tMig, p - dp / 2);
                    t = t - g2 * dp; p -= dp;
                }
                out[i] = t;
            }
        }
        return { valors: out, lcl };
    }

    function temperaturaBulbHumit(tC, tdC, pHpa) {
        if (!esFinit(tC) || !esFinit(tdC) || !esFinit(pHpa)) return null;
        if (tdC >= tC) return tC;

        const wObjectiu = wsat(tdC, pHpa);
        const RD_CP_LOCAL = RD_CP;
        const tK = tC + 273.15;

        function tDryAdiabat(p1) {
            return tK * Math.pow(p1 / pHpa, RD_CP_LOCAL) - 273.15;
        }

        let pLo = 50, pHi = pHpa;
        const fHi = wsat(tDryAdiabat(pHi), pHi) - wObjectiu;
        const fLo = wsat(tDryAdiabat(pLo), pLo) - wObjectiu;
        if (fHi < 0) {
            return tC;
        }
        let pLcl = pHpa;
        if (fLo > 0) {
            pLcl = lclBolton(tC, tdC, pHpa).p;
        } else {
            for (let iter = 0; iter < 40; iter++) {
                const pMig = (pLo + pHi) / 2;
                const fMig = wsat(tDryAdiabat(pMig), pMig) - wObjectiu;
                if (fMig > 0) pHi = pMig; else pLo = pMig;
            }
            pLcl = (pLo + pHi) / 2;
        }
        const tLcl = tDryAdiabat(pLcl);

        let p = pLcl, t = tLcl;
        const nPassos = Math.max(1, Math.ceil((pHpa - pLcl) / 5));
        const dp = (pHpa - pLcl) / nPassos;
        for (let k = 0; k < nPassos; k++) {
            const g1 = gradientHumit(t, p);
            const tMig = t + g1 * (dp / 2);
            const g2 = gradientHumit(tMig, p + dp / 2);
            t = t + g2 * dp; p += dp;
        }
        return t;
    }

    function perfilBulbHumit(perfil) {
        if (!perfil || !perfil.p) return null;
        const out = new Array(perfil.p.length);
        for (let i = 0; i < perfil.p.length; i++) {
            out[i] = temperaturaBulbHumit(perfil.t[i], perfil.td[i], perfil.p[i]);
        }
        return out;
    }

    function calcularAiguaPrecipitable(perfil) {
        if (!perfil || !perfil.p || perfil.p.length < 2) return null;
        const p = perfil.p, td = perfil.td;
        let integral = 0;
        for (let i = 0; i < p.length - 1; i++) {
            if (!esFinit(td[i]) || !esFinit(td[i + 1])) continue;
            const w0 = wsat(td[i], p[i]);
            const w1 = wsat(td[i + 1], p[i + 1]);
            const dp = p[i] - p[i + 1];
            if (dp <= 0) continue;
            integral += 0.5 * (w0 + w1) * dp;
        }
        const pwatMm = (integral * 100) / G0;
        return esFinit(pwatMm) ? pwatMm : null;
    }

    function calcularIndexsTermo(perfil, opcions) {
        const opt = opcions || {};
        const origen = opt.origenParcela || 'sfc';
        const { p, t, td } = perfil;
        const n = p.length;
        if (n < 3) return null;

        let pSfc = p[0], tSfc = t[0], tdSfc = td[0];
        let origenReal = 'sfc';
        let origenInfo = { p: p[0], t: t[0], td: td[0] };

        if (origen === 'ml') {
            const ml = mitjanaMixedLayer(perfil, esFinit(opt.dpMix) ? opt.dpMix : 100);
            if (ml) { pSfc = ml.p; tSfc = ml.t; tdSfc = ml.td; origenReal = 'ml'; origenInfo = ml; }
        } else if (origen === 'manual' && esFinit(opt.pManual)) {
            const niv = interpolarNivell(perfil, opt.pManual);
            if (niv) { pSfc = niv.p; tSfc = niv.t; tdSfc = niv.td; origenReal = 'manual'; origenInfo = niv; }
        }

        const { valors: tParcela, lcl } = perfilParcela(tSfc, tdSfc, pSfc, p);
        const z = p.map(pressioAAlcada);
        const buoy = new Array(n);
        for (let i = 0; i < n; i++) {
            if (tParcela[i] === null || !esFinit(t[i]) || p[i] >= pSfc) { buoy[i] = null; continue; }
            buoy[i] = tParcela[i] - t[i];
        }
        let cape = 0, cin = 0, lfcZ = null, elZ = null, candidatLFC = null, flotabilitatContinua = 0;
        const MIN_FLOTABILITAT_M = 2000;
        for (let i = 1; i < n; i++) {
            if (buoy[i] === null || buoy[i - 1] === null) continue;
            const dz = z[i] - z[i - 1]; if (dz <= 0) continue;
            const b0 = buoy[i - 1], b1 = buoy[i];
            const tk0 = t[i - 1] + 273.15, tk1 = t[i] + 273.15;
            const e0 = G0 * (b0 / tk0), e1 = G0 * (b1 / tk1);
            if (b0 >= 0 && b1 >= 0) {
                if (candidatLFC === null) { candidatLFC = z[i - 1]; flotabilitatContinua = 0; }
                flotabilitatContinua += dz; cape += 0.5 * (e0 + e1) * dz; elZ = z[i];
            } else if (b0 < 0 && b1 >= 0) {
                const frac = b0 / (b0 - b1), zCross = z[i - 1] + frac * dz;
                if (candidatLFC === null) { candidatLFC = zCross; flotabilitatContinua = 0; }
                if (lfcZ === null) cin += 0.5 * e0 * (zCross - z[i - 1]);
                flotabilitatContinua += (z[i] - zCross); cape += 0.5 * e1 * (z[i] - zCross); elZ = z[i];
            } else if (b0 >= 0 && b1 < 0) {
                const frac = b0 / (b0 - b1), zCross = z[i - 1] + frac * dz;
                flotabilitatContinua += (zCross - z[i - 1]); cape += 0.5 * e0 * (zCross - z[i - 1]);
                if (candidatLFC !== null && flotabilitatContinua >= MIN_FLOTABILITAT_M) {
                    if (lfcZ === null) lfcZ = candidatLFC;
                    elZ = zCross;
                }
                candidatLFC = null; flotabilitatContinua = 0;
            } else {
                if (lfcZ === null) cin += 0.5 * (e0 + e1) * dz;
                candidatLFC = null; flotabilitatContinua = 0;
            }
        }
        if (candidatLFC !== null && flotabilitatContinua >= MIN_FLOTABILITAT_M && lfcZ === null) lfcZ = candidatLFC;
        const lfc = lfcZ !== null ? alcadaAPressio(lfcZ) : null;
        const el = elZ !== null ? alcadaAPressio(elZ) : null;
        let li = null;
        const idx500 = p.reduce((best, pv, i) => (Math.abs(pv - 500) < Math.abs(p[best] - 500)) ? i : best, 0);
        if (Math.abs(p[idx500] - 500) < 40 && esFinit(t[idx500]) && p[idx500] < pSfc) {
            const tp500 = perfilParcela(tSfc, tdSfc, pSfc, [500]).valors[0];
            if (tp500 !== null) li = t[idx500] - tp500;
        }
        const cinFinal = (lfcZ !== null) ? Math.min(0, -Math.abs(cin)) : 0;
        const pwat = calcularAiguaPrecipitable(perfil);

        return {
            cape: Math.max(0, cape), cin: cinFinal,
            tSfc: t[0],
            lcl_p: lcl.p, lcl_t: lcl.t, lcl_z: pressioAAlcada(lcl.p),
            lfc_p: lfc, lfc_z: lfcZ, el_p: el, el_z: elZ, li: li,
            tParcela: tParcela, z: z,
            pwat: pwat,
            origenParcela: origenReal, origenParcelaInfo: origenInfo,
            pOrigenParcela: pSfc, tOrigenParcela: tSfc, tdOrigenParcela: tdSfc
        };
    }

    function millorOrigenParcela(perfil, opcions) {
        if (!perfil || !perfil.p || perfil.p.length < 3) return null;
        const opt = opcions || {};
        const pLimit = esFinit(opt.pMinim) ? opt.pMinim : 500;
        const capeEpsilon = esFinit(opt.capeEpsilon) ? opt.capeEpsilon : 25;

        let millorP = perfil.p[0];
        let millorCape = -Infinity;
        let millorDiffTd = Infinity;

        for (let i = 0; i < perfil.p.length; i++) {
            const pNiv = perfil.p[i];
            if (pNiv > perfil.p[0] || pNiv < pLimit) continue;
            const t = perfil.t[i], td = perfil.td[i];
            if (!esFinit(t) || !esFinit(td)) continue;

            const idx = calcularIndexsTermo(perfil, { origenParcela: 'manual', pManual: pNiv });
            if (!idx) continue;
            const cape = idx.cape || 0;
            const diffTd = t - td;

            if (cape > millorCape + capeEpsilon) {
                millorCape = cape; millorP = pNiv; millorDiffTd = diffTd;
            } else if (Math.abs(cape - millorCape) <= capeEpsilon) {
                if (diffTd < millorDiffTd) {
                    millorCape = Math.max(millorCape, cape); millorP = pNiv; millorDiffTd = diffTd;
                }
            }
        }

        return esFinit(millorP) ? { p: millorP, cape: millorCape } : null;
    }

    function indexsAddicionals(perfil) {
        const { p, t, td } = perfil;
        function tAt(pTarget) { for (let i = 0; i < p.length - 1; i++) { if (p[i] >= pTarget && p[i + 1] <= pTarget) { const f = (p[i] - pTarget) / (p[i] - p[i + 1]); return t[i] + f * (t[i + 1] - t[i]); } } return null; }
        function tdAt(pTarget) { for (let i = 0; i < p.length - 1; i++) { if (p[i] >= pTarget && p[i + 1] <= pTarget) { const f = (p[i] - pTarget) / (p[i] - p[i + 1]); return td[i] + f * (td[i + 1] - td[i]); } } return null; }
        const t850 = tAt(850), td850 = tdAt(850), t700 = tAt(700), td700 = tdAt(700), t500 = tAt(500);
        let kIndex = null, totalsTotals = null, showalter = null;
        if (esFinit(t850) && esFinit(td850) && esFinit(t700) && esFinit(td700) && esFinit(t500)) { kIndex = (t850 - t500) + td850 - (t700 - td700); totalsTotals = (t850 + td850) - 2 * t500; }
        if (esFinit(t850) && esFinit(td850) && esFinit(t500)) { const tp500 = perfilParcela(t850, td850, 850, [500]).valors[0]; if (tp500 !== null) showalter = t500 - tp500; }
        return { kIndex, totalsTotals, showalter };
    }

    function bulkShear(uBase, vBase, uTop, vTop) { const du = uTop - uBase, dv = vTop - vBase; return Math.sqrt(du * du + dv * dv); }

    function stormMotionBunkers(uMean06, vMean06, uShear06, vShear06) {
        const shearMag = Math.sqrt(uShear06 * uShear06 + vShear06 * vShear06);
        if (shearMag < 0.1) return { right: { u: uMean06, v: vMean06 }, left: { u: uMean06, v: vMean06 } };
        const D = 7.5, uPerpR = D * (vShear06 / shearMag), vPerpR = D * (-uShear06 / shearMag);
        return { right: { u: uMean06 + uPerpR, v: vMean06 + vPerpR }, left: { u: uMean06 - uPerpR, v: vMean06 - vPerpR } };
    }

    function calcularSRH(nivells, stormU, stormV, zBase, zTop) {
        let srh = 0;
        for (let i = 0; i < nivells.length - 1; i++) {
            const a = nivells[i], b = nivells[i + 1];
            if (a.z > zTop || b.z < zBase) continue;
            let z0 = Math.max(a.z, zBase), z1 = Math.min(b.z, zTop); if (z1 <= z0) continue;
            const frac0 = (z0 - a.z) / (b.z - a.z || 1), frac1 = (z1 - a.z) / (b.z - a.z || 1);
            const u0 = a.u + frac0 * (b.u - a.u), v0 = a.v + frac0 * (b.v - a.v);
            const u1 = a.u + frac1 * (b.u - a.u), v1 = a.v + frac1 * (b.v - a.v);
            srh += (u0 - stormU) * (v1 - stormV) - (u1 - stormU) * (v0 - stormV);
        }
        return srh;
    }

    function ventMitja(nivells, zBase, zTop) {
        let sumU = 0, sumV = 0, sumW = 0;
        for (let i = 0; i < nivells.length - 1; i++) {
            const a = nivells[i], b = nivells[i + 1];
            if (a.z > zTop || b.z < zBase) continue;
            let z0 = Math.max(a.z, zBase), z1 = Math.min(b.z, zTop); if (z1 <= z0) continue;
            const frac0 = (z0 - a.z) / (b.z - a.z || 1), frac1 = (z1 - a.z) / (b.z - a.z || 1);
            const u0 = a.u + frac0 * (b.u - a.u), v0 = a.v + frac0 * (b.v - a.v);
            const u1 = a.u + frac1 * (b.u - a.u), v1 = a.v + frac1 * (b.v - a.v);
            const w = z1 - z0;
            sumU += 0.5 * (u0 + u1) * w; sumV += 0.5 * (v0 + v1) * w; sumW += w;
        }
        if (sumW === 0) return null;
        return { u: sumU / sumW, v: sumV / sumW };
    }

    function ventAAlcada(nivells, zTarget) {
        for (let i = 0; i < nivells.length - 1; i++) {
            const a = nivells[i], b = nivells[i + 1];
            if (zTarget >= a.z && zTarget <= b.z) { const f = (zTarget - a.z) / (b.z - a.z || 1); return { u: a.u + f * (b.u - a.u), v: a.v + f * (b.v - a.v) }; }
        }
        if (zTarget <= nivells[0].z) return { u: nivells[0].u, v: nivells[0].v };
        return { u: nivells[nivells.length - 1].u, v: nivells[nivells.length - 1].v };
    }

    function calcularVentComposite(nivellsVent, zSfc) {
        if (!nivellsVent || nivellsVent.length < 3) return null;
        const niv = nivellsVent.map(n => ({ z: n.z - zSfc, u: n.u, v: n.v })).filter(n => n.z >= -10).sort((a, b) => a.z - b.z);
        if (niv.length < 3) return null;
        const sfc = ventAAlcada(niv, 0), v1km = ventAAlcada(niv, 1000), v3km = ventAAlcada(niv, 3000), v6km = ventAAlcada(niv, 6000), v8km = ventAAlcada(niv, 8000);
        const shear01 = bulkShear(sfc.u, sfc.v, v1km.u, v1km.v), shear03 = bulkShear(sfc.u, sfc.v, v3km.u, v3km.v);
        const shear06 = bulkShear(sfc.u, sfc.v, v6km.u, v6km.v), shear08 = bulkShear(sfc.u, sfc.v, v8km.u, v8km.v);
        const mean06 = ventMitja(niv, 0, 6000) || v6km;
        const uShear06 = v6km.u - sfc.u, vShear06 = v6km.v - sfc.v;
        const bunkers = stormMotionBunkers(mean06.u, mean06.v, uShear06, vShear06);
        const srh01 = calcularSRH(niv, bunkers.right.u, bunkers.right.v, 0, 1000);
        const srh03 = calcularSRH(niv, bunkers.right.u, bunkers.right.v, 0, 3000);
        return { niv, sfc, v1km, v3km, v6km, v8km, shear01, shear03, shear06, shear08, mean06, bunkers, srh01, srh03 };
    }

    function indexGraellaMesProper(lats, lons, lat, lon) {
        let iBest = 0, bestDLat = Infinity; for (let i = 0; i < lats.length; i++) { const d = Math.abs(lats[i] - lat); if (d < bestDLat) { bestDLat = d; iBest = i; } }
        let jBest = 0, bestDLon = Infinity; for (let j = 0; j < lons.length; j++) { const d = Math.abs(lons[j] - lon); if (d < bestDLon) { bestDLon = d; jBest = j; } }
        return { i: iBest, j: jBest };
    }

    function filaRealPerIndex(lats, i) { const latNord = lats[0] > lats[lats.length - 1]; return latNord ? (lats.length - 1 - i) : i; }

    // ══════════════════════════════════════════════════════════════════
    //  CARREGAR PRESSIÓ SUPERFICIAL (AUTÒNOM)
    // ══════════════════════════════════════════════════════════════════

    /**
     * Carrega la pressió superficial des de gfs_pressio_superficial_ne.json
     * o des de la URL que es passi.
     */
    async function carregarPressioSuperficial(url) {
        const urlFinal = url || 'dades/gfs_pressio_superficial_ne.json';
        try {
            const resp = await fetch(urlFinal + '?_=' + Date.now());
            if (!resp.ok) {
                console.warn('[SkewtEngine] ⚠️ No s\'ha trobat pressió superficial a:', urlFinal);
                return false;
            }
            const json = await resp.json();
            pressioSuperficialGlobal = json;
            pressioSuperficialCoords = json.coordenadas;
            pressioSuperficialDades = json.variables.surface_pressure.datos;
            console.log('[SkewtEngine] ✅ Pressió superficial carregada:', 
                pressioSuperficialCoords.lat.length, 'lat ×', 
                pressioSuperficialCoords.lon.length, 'lon =',
                pressioSuperficialDades.length, 'punts');
            return true;
        } catch (e) {
            console.warn('[SkewtEngine] ⚠️ Error carregant pressió superficial:', e.message);
            return false;
        }
    }

    /**
     * Obté la pressió superficial per a un punt (lat, lon) interpolant
     * de la graella carregada. Retorna hPa o null.
     */
    function obtenirPressioSuperficial(lat, lon) {
        if (!pressioSuperficialDades || !pressioSuperficialCoords) return null;
        const lats = pressioSuperficialCoords.lat;
        const lons = pressioSuperficialCoords.lon;
        const Nlat = lats.length;
        const Nlon = lons.length;

        let iLat = 0, iLon = 0;
        let minDistLat = Infinity, minDistLon = Infinity;

        for (let i = 0; i < Nlat; i++) {
            const d = Math.abs(lats[i] - lat);
            if (d < minDistLat) { minDistLat = d; iLat = i; }
        }
        for (let j = 0; j < Nlon; j++) {
            const d = Math.abs(lons[j] - lon);
            if (d < minDistLon) { minDistLon = d; iLon = j; }
        }

        if (minDistLat > 0.5 || minDistLon > 0.5) return null;
        const idx = iLat * Nlon + iLon;
        const sp = pressioSuperficialDades[idx];
        return esFinit(sp) ? sp : null;
    }

    // ══════════════════════════════════════════════════════════════════
    //  EXTRACCIÓ DEL PERFIL VERTICAL (AUTÒNOMA)
    // ══════════════════════════════════════════════════════════════════

    /**
     * Extreu el perfil vertical en un punt (lat, lon).
     * 
     * Si el paràmetre `opcions` conté `usarPressioReal: true` (per defecte),
     * intenta obtenir la pressió superficial REAL de la graella GFS.
     * Si no la troba, cau a la graella 3D (sense forçar 1000 hPa).
     * 
     * També accepta `spOverride` per forçar manualment una pressió.
     */
    function extreurePerfil(data, lat, lon, opcions) {
        const opt = opcions || {};
        const usarPressioReal = opt.usarPressioReal !== false; // per defecte true
        const spOverride = opt.spOverride || null;

        const vars = data.variables || {};
        let coordSfc = data.coordenadas_sfc || data.coordenadas;
        const coord3d = data.coordenadas_3d || data.coordenadas;

        const out = { p: [], t: [], td: [], u: [], v: [] };
        let pSfc = null, tSfc = null, tdSfc = null, uSfc = null, vSfc = null;

        // ── 1. Intentar obtenir pSfc REAL de la graella de pressió ──
        if (usarPressioReal && pressioSuperficialDades) {
            const sp = obtenirPressioSuperficial(lat, lon);
            if (esFinit(sp)) {
                pSfc = sp;
                console.log('[SkewtEngine] ✅ Pressió real a', lat.toFixed(3), lon.toFixed(3), '=', pSfc.toFixed(1), 'hPa');
            }
        }

        // ── 2. Override extern (per a proves) ──
        if (esFinit(spOverride)) pSfc = spOverride;

        // ── 3. Llegir T/Td de superfície (st/sd) si existeixen ──
        if (coordSfc && vars.st && vars.st.datos) {
            const idx = indexGraellaMesProper(coordSfc.lat, coordSfc.lon, lat, lon);
            const Nlon = coordSfc.lon.length;
            const filaReal = filaRealPerIndex(coordSfc.lat, idx.i);
            const flatIdx = filaReal * Nlon + idx.j;

            const rawSt = vars.st.datos[flatIdx];
            tSfc = esFinit(rawSt) ? (rawSt > 100 ? rawSt - 273.15 : rawSt) : null;

            if (vars.sd && vars.sd.datos) {
                const rawSd = vars.sd.datos[flatIdx];
                tdSfc = esFinit(rawSd) ? (rawSd > 100 ? rawSd - 273.15 : rawSd) : null;
            }

            if (vars.su && vars.su.datos) uSfc = vars.su.datos[flatIdx];
            if (vars.sv && vars.sv.datos) vSfc = vars.sv.datos[flatIdx];
        }

        // ── 4. Si tenim pSfc real i T/Td, afegir punt de superfície ──
        if (esFinit(pSfc) && esFinit(tSfc) && esFinit(tdSfc)) {
            out.p.push(pSfc);
            out.t.push(tSfc);
            out.td.push(tdSfc);
            out.u.push(esFinit(uSfc) ? uSfc : 0);
            out.v.push(esFinit(vSfc) ? vSfc : 0);
        }

        // ── 5. Nivells 3D (descartant els que estiguin per sota de pSfc) ──
        if (coord3d) {
            const idx3d = indexGraellaMesProper(coord3d.lat, coord3d.lon, lat, lon);
            const Nlon3 = coord3d.lon.length;
            const filaReal3 = filaRealPerIndex(coord3d.lat, idx3d.i);
            const flatIdx3 = filaReal3 * Nlon3 + idx3d.j;

            NIVELLS_PRESSIO.forEach(niv => {
                if (esFinit(pSfc) && niv >= pSfc) return;

                const kt = 't_' + niv, kd = 'dpt_' + niv, ku = 'u_' + niv, kv = 'v_' + niv;
                if (!vars[kt] || !vars[kt].datos) return;

                let tv = vars[kt].datos[flatIdx3];
                if (!esFinit(tv)) return;
                if (tv > 100) tv -= 273.15;

                let tdv = null;
                if (vars[kd] && vars[kd].datos) {
                    tdv = vars[kd].datos[flatIdx3];
                    if (esFinit(tdv) && tdv > 100) tdv -= 273.15;
                }
                if (!esFinit(tdv)) return;

                let uv = 0, vv = 0;
                if (vars[ku] && vars[ku].datos) uv = vars[ku].datos[flatIdx3];
                if (vars[kv] && vars[kv].datos) vv = vars[kv].datos[flatIdx3];
                if (!esFinit(uv)) uv = 0;
                if (!esFinit(vv)) vv = 0;

                out.p.push(niv);
                out.t.push(tv);
                out.td.push(tdv);
                out.u.push(uv);
                out.v.push(vv);
            });
        }

        // ── 6. Ordenar per pressió decreixent ──
        const idxOrdre = out.p.map((_, i) => i).sort((a, b) => out.p[b] - out.p[a]);
        const net = { p: [], t: [], td: [], u: [], v: [] };
        let lastP = Infinity;
        idxOrdre.forEach(i => {
            if (out.p[i] >= lastP) return;
            net.p.push(out.p[i]);
            net.t.push(out.t[i]);
            net.td.push(out.td[i]);
            net.u.push(out.u[i]);
            net.v.push(out.v[i]);
            lastP = out.p[i];
        });

        if (net.p.length < 3) return null;
        net.z = net.p.map(pressioAAlcada);
        return net;
    }

    // ═══════════════════════════════════════════════════════════════════════
    //  SARS
    // ═══════════════════════════════════════════════════════════════════════

    const PERFILS_REFERENCIA = [
        { nom: 'Tempesta ordinària (pols)', icon: '', tSfc: { min: 18, max: 34 }, cape: { min: 100, max: 800 }, cin: { min: -300, max: 0 }, li: { min: -2, max: 2 }, lcl: { min: 800, max: 2000 }, lfc: { min: 1000, max: 3500 }, el: { min: 5000, max: 9000 }, shear06: { min: 5, max: 15 }, srh01: { min: 0, max: 80 }, srh03: { min: 0, max: 150 }, desc: 'Tempestes disperses de curta durada. Calamarsa petita, vents moderats. Baix potencial sever.', nivellRisc: 1 },
        { nom: 'Tempesta ordinària (organitzada)', icon: '', tSfc: { min: 16, max: 32 }, cape: { min: 500, max: 1500 }, cin: { min: -200, max: -10 }, li: { min: -4, max: -1 }, lcl: { min: 600, max: 1800 }, lfc: { min: 800, max: 3000 }, el: { min: 6000, max: 11000 }, shear06: { min: 10, max: 20 }, srh01: { min: 20, max: 120 }, srh03: { min: 50, max: 200 }, desc: 'Tempestes que poden organitzar-se. Calamarsa moderada, vents forts. Risc moderat.', nivellRisc: 2 },
        { nom: 'Multicèl·lula', icon: '', tSfc: { min: 15, max: 32 }, cape: { min: 1000, max: 2500 }, cin: { min: -150, max: -10 }, li: { min: -6, max: -2 }, lcl: { min: 500, max: 1500 }, lfc: { min: 600, max: 2500 }, el: { min: 8000, max: 13000 }, shear06: { min: 15, max: 28 }, srh01: { min: 50, max: 180 }, srh03: { min: 100, max: 300 }, desc: 'Tempestes organitzades en grup. Calamarsa mitjana-gran, vents molt forts, possible inundació.', nivellRisc: 3 },
        { nom: 'Supercèl·lula clàssica', icon: '', tSfc: { min: 16, max: 34 }, cape: { min: 1500, max: 4000 }, cin: { min: -120, max: -10 }, li: { min: -10, max: -4 }, lcl: { min: 500, max: 1500 }, lfc: { min: 500, max: 2000 }, el: { min: 9000, max: 14000 }, shear06: { min: 20, max: 40 }, srh01: { min: 100, max: 400 }, srh03: { min: 150, max: 600 }, desc: 'Tempesta rotatòria amb mesocicló. Calamarsa gran, vents destructors, tornado possible.', nivellRisc: 4 },
        { nom: 'Supercèl·lula HP', icon: '', tSfc: { min: 18, max: 34 }, cape: { min: 2000, max: 5000 }, cin: { min: -100, max: -5 }, li: { min: -12, max: -5 }, lcl: { min: 400, max: 1000 }, lfc: { min: 400, max: 1500 }, el: { min: 10000, max: 15000 }, shear06: { min: 15, max: 30 }, srh01: { min: 100, max: 350 }, srh03: { min: 150, max: 500 }, desc: 'Precipitació extrema, calamarsa gran, inundacions sobtades. Tornado possible.', nivellRisc: 4 },
        { nom: 'Supercèl·lula LP', icon: '', tSfc: { min: 16, max: 34 }, cape: { min: 1000, max: 3000 }, cin: { min: -150, max: -20 }, li: { min: -8, max: -3 }, lcl: { min: 1000, max: 2500 }, lfc: { min: 800, max: 2500 }, el: { min: 8000, max: 13000 }, shear06: { min: 25, max: 50 }, srh01: { min: 150, max: 500 }, srh03: { min: 250, max: 800 }, desc: 'Poca pluja però calamarsa gegant. Tornado violent possible.', nivellRisc: 5 },
        { nom: 'Tempesta tropical / huracà', icon: '', tSfc: { min: 22, max: 34 }, cape: { min: 500, max: 2500 }, cin: { min: -50, max: 0 }, li: { min: -3, max: 2 }, lcl: { min: 300, max: 800 }, lfc: { min: 400, max: 1200 }, el: { min: 10000, max: 16000 }, shear06: { min: 3, max: 15 }, srh01: { min: 200, max: 800 }, srh03: { min: 300, max: 1000 }, desc: 'Pluges torrencials, vents huracanats. Baixa activitat elèctrica.', nivellRisc: 5 },
        { nom: 'Tempesta seca', icon: '', tSfc: { min: 22, max: 40 }, cape: { min: 1000, max: 3500 }, cin: { min: -200, max: -30 }, li: { min: -7, max: -2 }, lcl: { min: 2000, max: 4000 }, lfc: { min: 2000, max: 4000 }, el: { min: 7000, max: 12000 }, shear06: { min: 10, max: 25 }, srh01: { min: 30, max: 200 }, srh03: { min: 80, max: 350 }, desc: 'Llamps sense pluja. Risc extrem d\'incendis.', nivellRisc: 3 },
        { nom: 'Tempesta hivernal', icon: '', tSfc: { min: -15, max: 2 }, cape: { min: 0, max: 300 }, cin: { min: -500, max: -100 }, li: { min: 0, max: 5 }, lcl: { min: 200, max: 800 }, lfc: { min: 3000, max: 6000 }, el: { min: 4000, max: 8000 }, shear06: { min: 10, max: 30 }, srh01: { min: 50, max: 300 }, srh03: { min: 100, max: 500 }, desc: 'Neu intensa, vents forts.', nivellRisc: 2 },
        { nom: 'Dret / bow echo', icon: '', tSfc: { min: 18, max: 36 }, cape: { min: 1500, max: 4000 }, cin: { min: -80, max: -5 }, li: { min: -10, max: -4 }, lcl: { min: 600, max: 1500 }, lfc: { min: 600, max: 2000 }, el: { min: 8000, max: 14000 }, shear06: { min: 25, max: 55 }, srh01: { min: -250, max: 250 }, srh03: { min: -300, max: 300 }, desc: 'Vents destructors en línia recta (>120 km/h), impulsats per un cold pool fort i shear predominantment lineal (no requereix rotació mesociclònica).', nivellRisc: 5 },
        { nom: 'Multicèl·lula d\'alt CAPE (sense rotació)', icon: '', tSfc: { min: 18, max: 38 }, cape: { min: 2500, max: 6000 }, cin: { min: -450, max: -20 }, li: { min: -14, max: -5 }, lcl: { min: 600, max: 2200 }, lfc: { min: 1500, max: 4500 }, el: { min: 9000, max: 14000 }, shear06: { min: 15, max: 42 }, srh01: { min: -300, max: 60 }, srh03: { min: -400, max: 100 }, desc: 'Inestabilitat extrema amb shear moderat però sense rotació organitzada coherent (SRH baix o negatiu). Calamarsa molt gran per pur creixement vertical de l\'updraft i ratxes fortes per corrents descendents (downbursts), sense mesocicló. Tornado improbable.', nivellRisc: 4 }
    ];

    function similitudRang(valor, rang) {
        if (valor >= rang.min && valor <= rang.max) return 1.0;
        const amplitud = Math.max(rang.max - rang.min, 1);
        const diff = valor < rang.min ? (rang.min - valor) : (valor - rang.max);
        const x = Math.min(1, diff / amplitud);
        let s = Math.max(0, 1 - x * x);
        if (rang.min > 0 && valor < 0) s *= 0.15;
        else if (rang.max < 0 && valor > 0) s *= 0.15;
        return s;
    }

    function factorGate(similitudVariable) {
        if (similitudVariable >= 0.35) return 1.0;
        const t = similitudVariable / 0.35;
        return Math.max(0, t * t * t);
    }

    function calcularSimilitudSARS(indexsActual, ventActual, perfilRef) {
        const tSfc = esFinit(indexsActual.tSfc) ? indexsActual.tSfc : null;
        const cape = indexsActual.cape || 0, cin = indexsActual.cin || 0, li = indexsActual.li || 0;
        const lcl = indexsActual.lcl_z || 1500, lfc = indexsActual.lfc_z || 2000, el = indexsActual.el_z || 10000;
        const shear06 = ventActual ? ventActual.shear06 : 0;
        const srh01 = ventActual ? ventActual.srh01 : 0;
        const srh03 = ventActual ? ventActual.srh03 : 0;

        const sCape = similitudRang(cape, perfilRef.cape), sCin = similitudRang(cin, perfilRef.cin), sLi = similitudRang(li, perfilRef.li);
        const sLcl = similitudRang(lcl, perfilRef.lcl), sLfc = similitudRang(lfc, perfilRef.lfc), sEl = similitudRang(el, perfilRef.el);
        const sShear06 = similitudRang(shear06, perfilRef.shear06), sSrh01 = similitudRang(srh01, perfilRef.srh01), sSrh03 = similitudRang(srh03, perfilRef.srh03);
        const sTsfc = (tSfc !== null && perfilRef.tSfc) ? similitudRang(tSfc, perfilRef.tSfc) : 1.0;

        const pes = { tSfc: 0.10, cape: 0.18, cin: 0.09, li: 0.09, lcl: 0.09, lfc: 0.09, el: 0.05, shear06: 0.13, srh01: 0.09, srh03: 0.09 };
        const scoreBase = pes.tSfc * sTsfc + pes.cape * sCape + pes.cin * sCin + pes.li * sLi +
                           pes.lcl * sLcl + pes.lfc * sLfc + pes.el * sEl +
                           pes.shear06 * sShear06 + pes.srh01 * sSrh01 + pes.srh03 * sSrh03;

        const gate = factorGate(sTsfc) * factorGate(sCape) * factorGate(sSrh01);
        return Math.round(scoreBase * gate * 100);
    }

    function trobarAnàlegsSARS(indexsActual, ventActual) {
        return PERFILS_REFERENCIA.map(ref => ({ ...ref, similitud: calcularSimilitudSARS(indexsActual, ventActual, ref) })).sort((a, b) => b.similitud - a.similitud);
    }

    // ─── EXPORT FINAL ──────────────────────────────────────────────────────
    global.SkewtEngine = {
        // Constants
        NIVELLS_PRESSIO,

        // Utilitats
        esFinit, pressioAAlcada, alcadaAPressio, esatBolton, wsat, tdFromRH,
        lclBolton, gradientHumit, perfilParcela,
        interpolarTAAlcada, descendirSecAPressio,
        temperaturaBulbHumit, perfilBulbHumit,
        calcularAiguaPrecipitable,

        // Índexs termodinàmics
        calcularIndexsTermo, indexsAddicionals,
        perfilMixedLayer, mitjanaMixedLayer, interpolarNivell,
        millorOrigenParcela,

        // Vent
        bulkShear, stormMotionBunkers, calcularSRH, ventMitja, ventAAlcada,
        calcularVentComposite,

        // Extracció de perfil (AUTÒNOMA amb pressió real)
        extreurePerfil,

        // Pressió superficial (AUTÒNOMA)
        carregarPressioSuperficial,
        obtenirPressioSuperficial,

        // SARS
        PERFILS_REFERENCIA, calcularSimilitudSARS, trobarAnàlegsSARS
    };

    // ─── INICIALITZACIÓ AUTOMÀTICA ──────────────────────────────────────
    // Carrega la pressió superficial automàticament en carregar el script.
    // Si falla, el Skew-T funcionarà igual però arrencarà a 1000 hPa.
    carregarPressioSuperficial();

})(window);