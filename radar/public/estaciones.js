// ═══════════════════════════════════════════════════════════════════════
//  estaciones.js — CAPA D'ESTACIONS METEOROLÒGIQUES (Temp + Punt de rosada)
//  Es carrega des del mateix bucket R2 que el radar, generat per
//  generar_estaciones.py via GitHub Actions. No fa peticions a AEMET
//  directament des del navegador (sense api_key per usuari).
//
//  Requereix que window.map ja existeixi (creat a radar.js) i que
//  aquest fitxer es carregui DESPRÉS de radar.js.
// ═══════════════════════════════════════════════════════════════════════

(function() {
    'use strict';

    const ESTACIONES_URL = 'radar/estaciones_meta.js';
    const REFRESH_MS = 5 * 60 * 1000; // 5 min, igual que el radar

    let capaEstacions = null;
    let marcadorsPerIdema = {};
    let estacionsVisible = true;

    // ═══ ESTILS DEL MARCADOR ═══
    function injectarEstilsEstacions() {
        if (document.getElementById('estacions-styles')) return;
        const style = document.createElement('style');
        style.id = 'estacions-styles';
        style.textContent = `
            .estacio-marker {
                display:flex; align-items:center; gap:4px;
                font-family:sans-serif; pointer-events:auto; cursor:pointer;
            }
            .estacio-marker .eb-punt {
                width:8px; height:8px; border-radius:50%; flex:0 0 auto;
                border:1.5px solid rgba(13,17,23,0.9);
                box-shadow:0 0 3px rgba(0,0,0,0.6);
            }
            .estacio-marker .eb-etiqueta {
                font-size:12px; font-weight:700; white-space:nowrap; line-height:1;
                text-shadow:
                    -1px -1px 0 rgba(13,17,23,0.9), 1px -1px 0 rgba(13,17,23,0.9),
                    -1px  1px 0 rgba(13,17,23,0.9), 1px  1px 0 rgba(13,17,23,0.9),
                    0 0 4px rgba(13,17,23,0.9);
            }
            .estacio-marker .eb-vent {
                display:flex; align-items:center; justify-content:center;
                width:22px; height:22px; margin-left:2px; cursor:pointer;
                filter: drop-shadow(0 0 2px rgba(13,17,23,0.9));
            }
                background:rgba(13,17,23,0.97); color:#c9d1d9; padding:12px 16px;
                border-radius:10px; font-family:sans-serif; min-width:150px;
                border:1px solid rgba(255,255,255,0.1);
            }
            .popup-estacio .pe-nom {
                font-size:12px; font-weight:700; color:#fff; margin-bottom:6px;
                text-transform:uppercase; letter-spacing:0.5px;
            }
            .popup-estacio .pe-fila {
                display:flex; justify-content:space-between; gap:14px;
                font-size:13px; padding:2px 0;
            }
            .popup-estacio .pe-fila span:first-child { color:#8b949e; }
            .popup-estacio .pe-fila span:last-child { font-weight:600; color:#fff; }
            .popup-estacio .pe-hora {
                font-size:10px; color:#484f58; margin-top:8px;
            }
        `;
        document.head.appendChild(style);
    }

    // Paleta de temperatura amb interpolació de color entre stops,
    // igual d'estil que les paletes del radar (radar.js).
    const TEMP_STOPS = [
        {v:-24, r:45,  g:0,   b:75},  {v:-20, r:130, g:0,   b:160},
        {v:-15, r:65,  g:0,   b:115}, {v:-10, r:0,   g:0,   b:255},
        {v:-5,  r:0,   g:135, b:255}, {v:0,   r:0,   g:235, b:255},
        {v:2,   r:0,   g:255, b:150}, {v:5,   r:0,   g:200, b:0},
        {v:8,   r:120, g:255, b:0},   {v:11,  r:255, g:255, b:0},
        {v:14,  r:255, g:255, b:170}, {v:17,  r:255, g:235, b:100},
        {v:20,  r:255, g:200, b:0},   {v:23,  r:255, g:140, b:0},
        {v:26,  r:255, g:70,  b:0},   {v:29,  r:255, g:0,   b:0},
        {v:32,  r:180, g:0,   b:0},   {v:35,  r:90,  g:0,   b:0},
        {v:38,  r:150, g:0,   b:150}, {v:42,  r:255, g:0,   b:255},
        {v:46,  r:255, g:185, b:255}
    ];

    function colorTemp(t) {
        if (t === null || t === undefined || isNaN(t)) return '#8b949e';
        const S = TEMP_STOPS;
        if (t <= S[0].v) return rgbHex(S[0]);
        if (t >= S[S.length-1].v) return rgbHex(S[S.length-1]);
        for (let i=0; i<S.length-1; i++) {
            if (t >= S[i].v && t <= S[i+1].v) {
                const rang = S[i+1].v - S[i].v || 1;
                const p = (t - S[i].v) / rang;
                return rgbHex({
                    r: Math.round(S[i].r + (S[i+1].r - S[i].r) * p),
                    g: Math.round(S[i].g + (S[i+1].g - S[i].g) * p),
                    b: Math.round(S[i].b + (S[i+1].b - S[i].b) * p)
                });
            }
        }
        return rgbHex(S[S.length-1]);
    }

    function rgbHex(c) {
        const h = (n) => n.toString(16).padStart(2, '0');
        return '#' + h(c.r) + h(c.g) + h(c.b);
    }

    function horaMadridDesdeFint(fint) {
        // fint ve com "AAAA-MM-DDTHH:MM:SS" en UTC
        if (!fint) return '--:--';
        try {
            const d = new Date(fint + 'Z');
            const madrid = new Date(d.toLocaleString('en-US', {timeZone: 'Europe/Madrid'}));
            const h = String(madrid.getHours()).padStart(2,'0');
            const m = String(madrid.getMinutes()).padStart(2,'0');
            return h + ':' + m;
        } catch(e) {
            return '--:--';
        }
    }

    // ═══ BARBA DE VENT (wind barb meteorologic) ═══
    // Astil + calcs/triangles segons la velocitat en km/h:
    //   triangle (banderola) = 50 km/h, ratlla llarga = 10 km/h,
    //   ratlla curta = 5 km/h. S'arrodoneix als 5 km/h mes propers.
    function svgBarbaVent(kmh) {
        const astilLlarg = 20;
        let restant = Math.round(kmh / 5) * 5; // arrodonim a multiples de 5
        const stroke = '#000000b6';
        const strokeVora = '#46464694';
        let parts = '<line x1="2" y1="22" x2="2" y2="' + (22 - astilLlarg) + '" stroke="' + strokeVora + '" stroke-width="2.4"/>' +
                     '<line x1="2" y1="22" x2="2" y2="' + (22 - astilLlarg) + '" stroke="' + stroke + '" stroke-width="1.2"/>';

        let posY = 22 - astilLlarg; // comencem a dalt de l'astil, baixant
        const pasBanderola = 4.5;
        const pasRatlla = 3;

        while (restant >= 50) {
            // Banderola (triangle ple) = 50 km/h
            parts += '<polygon points="2,' + posY + ' 2,' + (posY + pasBanderola) + ' 11,' + (posY + pasBanderola/2) + '" fill="' + stroke + '" stroke="' + strokeVora + '" stroke-width="0.8"/>';
            posY += pasBanderola;
            restant -= 50;
        }
        while (restant >= 10) {
            // Ratlla llarga = 10 km/h
            parts += '<line x1="2" y1="' + posY + '" x2="11" y2="' + (posY - 3) + '" stroke="' + strokeVora + '" stroke-width="2.4"/>' +
                     '<line x1="2" y1="' + posY + '" x2="11" y2="' + (posY - 3) + '" stroke="' + stroke + '" stroke-width="1.2"/>';
            posY += pasRatlla;
            restant -= 10;
        }
        if (restant >= 5) {
            // Ratlla curta = 5 km/h
            parts += '<line x1="2" y1="' + posY + '" x2="7" y2="' + (posY - 2) + '" stroke="' + strokeVora + '" stroke-width="2.4"/>' +
                     '<line x1="2" y1="' + posY + '" x2="7" y2="' + (posY - 2) + '" stroke="' + stroke + '" stroke-width="1.2"/>';
        }
        return parts;
    }

function iconaBarbaVent(dv, vv) {
    if (dv === null || dv === undefined || isNaN(dv)) return '';
    const kmh = (vv !== null && vv !== undefined) ? vv * 3.6 : 0;
    const kmhTxt = kmh.toFixed(0);
    // dv és "d'on ve el vent" (meteorologic). La barba (l'astil) ha
    // d'apuntar cap ON VE el vent — així ho fan els mapes sinòptics
    // estàndard. Per tant NO sumem 180.
    const rot = dv % 360;
    return '' +
        '<div class="eb-vent" title="Vent ' + kmhTxt + ' km/h" data-kmh="' + kmhTxt + '" data-dv="' + Math.round(dv) + '">' +
            '<svg viewBox="0 0 24 24" style="transform:rotate(' + rot + 'deg);" width="20" height="20">' +
                svgBarbaVent(kmh) +
            '</svg>' +
        '</div>';
}

    function crearIconaEstacio(estacio) {
        const ta = estacio.ta;
        const tpr = estacio.tpr;
        const cTa = colorTemp(ta);
        const cTpr = colorTemp(tpr);

        const taTxt = (ta !== null && ta !== undefined) ? Math.round(ta) : '—';
        const tprTxt = (tpr !== null && tpr !== undefined) ? Math.round(tpr) : '—';

        // Punt exacte sobre la coordenada + etiqueta "temp/rosada" al costat,
        // cada valor pintat amb el seu propi color segons la paleta de temp,
        // i la fletxa de vent apilada a la dreta (si hi ha dada).
        const html =
            '<div class="estacio-marker">' +
                '<div class="eb-punt" style="background:' + cTa + ';"></div>' +
                '<div class="eb-etiqueta">' +
                    '<span style="color:' + cTa + ';">' + taTxt + '</span>' +
                    '<span style="color:#8b949e;">/</span>' +
                    '<span style="color:' + cTpr + ';">' + tprTxt + '</span>' +
                '</div>' +
                iconaBarbaVent(estacio.dv, estacio.vv) +
            '</div>';

        return L.divIcon({
            className: '',
            html: html,
            iconSize: [70, 24],
            iconAnchor: [4, 10] // el punt queda exactament sobre lat/lon
        });
    }

    function direccioCardinal(graus) {
        const dirs = ['N','NNE','NE','ENE','E','ESE','SE','SSE','S','SSO','SO','OSO','O','ONO','NO','NNO'];
        const idx = Math.round(graus / 22.5) % 16;
        return dirs[idx];
    }

    function contingutPopup(estacio) {
        const files = [];
        if (estacio.ta !== null && estacio.ta !== undefined) {
            files.push('<div class="pe-fila"><span>Temperatura</span><span>' + estacio.ta.toFixed(1) + ' °C</span></div>');
        }
        if (estacio.tpr !== null && estacio.tpr !== undefined) {
            files.push('<div class="pe-fila"><span>Punt de rosada</span><span>' + estacio.tpr.toFixed(1) + ' °C</span></div>');
        }
        if (estacio.hr !== null && estacio.hr !== undefined) {
            files.push('<div class="pe-fila"><span>Humitat relativa</span><span>' + estacio.hr.toFixed(0) + ' %</span></div>');
        }
        if (estacio.alt !== null && estacio.alt !== undefined) {
            files.push('<div class="pe-fila"><span>Altitud</span><span>' + estacio.alt.toFixed(0) + ' m</span></div>');
        }
        if (estacio.vv !== null && estacio.vv !== undefined) {
            const kmh = (estacio.vv * 3.6).toFixed(0);
            const cardinal = (estacio.dv !== null && estacio.dv !== undefined) ? ' ' + direccioCardinal(estacio.dv) : '';
            files.push('<div class="pe-fila"><span>Vent</span><span>' + kmh + ' km/h' + cardinal + '</span></div>');
        }
        if (estacio.prec !== null && estacio.prec !== undefined) {
            files.push('<div class="pe-fila"><span>Precipitació (1h)</span><span>' + estacio.prec.toFixed(1) + ' mm</span></div>');
        }

        return '' +
            '<div class="popup-estacio">' +
                '<div class="pe-nom">' + (estacio.nombre || estacio.idema) + '</div>' +
                files.join('') +
                '<div class="pe-hora">Actualitzat ' + horaMadridDesdeFint(estacio.fint) + ' · ' + estacio.idema + '</div>' +
            '</div>';
    }

    // ═══ CÀRREGA DE DADES ═══
    async function carregarEstacions() {
        try {
            const r = await fetch(ESTACIONES_URL + '?t=' + Date.now(), { cache: 'no-store' });
            if (!r.ok) {
                console.log('[Estacions] Error HTTP', r.status);
                return;
            }
            const txt = await r.text();
            const m = txt.match(/window\.estacionesData\s*=\s*(\{[\s\S]*\});?\s*$/);
            if (!m) {
                console.log('[Estacions] Format inesperat de resposta');
                return;
            }
            const payload = JSON.parse(m[1]);
            window.__estacionsUltimaLlista = payload.estaciones || [];
            renderitzarEstacions(payload.estaciones || []);
            actualitzarCapaPluja();
            console.log('[Estacions] Carregades', (payload.estaciones || []).length, '· actualitzat', payload.updated);
        } catch(e) {
            console.log('[Estacions] Error carregant:', e.message);
        }
    }

    // ═══ FILTRAT PER ZOOM (declutter) ═══
    // A zoom baix (mapa allunyat) no te sentit mostrar les ~800
    // etiquetes de cop, es solaparien totes. Dividim el mapa en una
    // graella i nomes ens quedem amb UNA estacio per cel·la (la que
    // tingui dades mes completes). Com mes zoom, mes petita la
    // cel·la -> apareixen mes estacions gradualment.
    function midaCellaGraus(zoom) {
        // Ajustat empiricament: zoom 6 (tot Espanya) ~1.4°, zoom 11
        // (comarca) ~0.05° (practicament totes visibles).
        const taula = {
            6: 1.4, 7: 0.9, 8: 0.55, 9: 0.3, 10: 0.12, 11: 0.05
        };
        if (zoom <= 6) return taula[6];
        if (zoom >= 11) return 0;
        return taula[zoom] !== undefined ? taula[zoom] : 0.05;
    }

    function filtrarPerDensitat(estacions, zoom) {
        const cella = midaCellaGraus(zoom);
        if (cella <= 0) return estacions; // zoom prou alt: mostrem totes

        const millorPerCella = new Map();
        estacions.forEach(function(e) {
            const key = Math.round(e.lat / cella) + '_' + Math.round(e.lon / cella);
            const actual = millorPerCella.get(key);
            if (!actual || completesa(e) > completesa(actual)) {
                millorPerCella.set(key, e);
            }
        });
        return Array.from(millorPerCella.values());
    }

    // Preferim mostrar, quan cal triar, l'estacio amb mes camps
    // omplerts (mes util a l'usuari que una amb quasi tot buit).
    function completesa(e) {
        let n = 0;
        if (e.ta !== null && e.ta !== undefined) n++;
        if (e.tpr !== null && e.tpr !== undefined) n++;
        if (e.vv !== null && e.vv !== undefined) n++;
        if (e.prec !== null && e.prec !== undefined) n++;
        return n;
    }

    function renderitzarEstacions(estacions) {
        if (!window.map) {
            console.log('[Estacions] window.map encara no existeix, s\'esperarà');
            return;
        }

        if (!capaEstacions) {
            capaEstacions = L.layerGroup();
            if (estacionsVisible) capaEstacions.addTo(window.map);
        }

        const idemasNous = new Set();

        estacions.forEach(function(estacio) {
            idemasNous.add(estacio.idema);
            const ll = [estacio.lat, estacio.lon];
            const icona = crearIconaEstacio(estacio);

            let marcador = marcadorsPerIdema[estacio.idema];
            if (!marcador) {
                marcador = L.marker(ll, { icon: icona, pane: 'paneGeojson' });
                marcador.bindPopup(contingutPopup(estacio), { className: '', closeButton: true });
                marcador.addTo(capaEstacions);
                marcadorsPerIdema[estacio.idema] = marcador;
            } else {
                marcador.setLatLng(ll);
                marcador.setIcon(icona);
                // Si el popup esta obert, actualitzem el seu contingut tambe
                marcador.setPopupContent(contingutPopup(estacio));
            }
            marcador._estacioData = estacio;
        });

        // Neteja marcadors d'estacions que ja no venen a la resposta
        // (per exemple, si una estacio deixa d'emetre dades)
        Object.keys(marcadorsPerIdema).forEach(function(idema) {
            if (!idemasNous.has(idema)) {
                capaEstacions.removeLayer(marcadorsPerIdema[idema]);
                delete marcadorsPerIdema[idema];
            }
        });
    }

    // ═══════════════════════════════════════════════════════════════════
    //  CAPA DE PRECIPITACIÓ INTERPOLADA (IDW) — "massa viscosa"
    //  Genera una malla contínua a partir dels punts 'prec' de les
    //  estacions, renderitzada amb canvas igual que el RadarLayer.
    // ═══════════════════════════════════════════════════════════════════
    const PLUJA_GRID_COLS = 140;       // resolució horitzontal de la malla
    const IDW_POWER = 2.2;             // "duresa" de la interpolació
    const IDW_RADI_CERCA_KM = 90;      // no interpolem amb estacions massa lluny
    const PLUJA_MIN_VISIBLE = 0.1;     // per sota d'aixo, es tracta com transparent

    const PLUJA_STOPS = [
        {v:0,   r:0,   g:0,   b:0,   a:0},
        {v:0.1, r:200, g:230, b:255, a:90},
        {v:0.5, r:100, g:200, b:255, a:150},
        {v:1,   r:0,   g:150, b:255, a:190},
        {v:2,   r:0,   g:100, b:200, a:210},
        {v:5,   r:0,   g:200, b:0,   a:220},
        {v:10,  r:100, g:255, b:0,   a:225},
        {v:20,  r:255, g:255, b:0,   a:230},
        {v:30,  r:255, g:200, b:0,   a:235},
        {v:50,  r:255, g:100, b:0,   a:240},
        {v:75,  r:255, g:0,   b:0,   a:245},
        {v:100, r:200, g:0,   b:200, a:255}
    ];

    function colorPluja(v) {
        const S = PLUJA_STOPS;
        if (v === null || v === undefined || isNaN(v) || v < PLUJA_MIN_VISIBLE) return S[0];
        if (v <= S[0].v) return S[0];
        if (v >= S[S.length-1].v) return S[S.length-1];
        for (let i=0; i<S.length-1; i++) {
            if (v >= S[i].v && v <= S[i+1].v) {
                const rang = S[i+1].v - S[i].v || 1;
                const p = (v - S[i].v) / rang;
                return {
                    r: Math.round(S[i].r + (S[i+1].r - S[i].r) * p),
                    g: Math.round(S[i].g + (S[i+1].g - S[i].g) * p),
                    b: Math.round(S[i].b + (S[i+1].b - S[i].b) * p),
                    a: Math.round(S[i].a + (S[i+1].a - S[i].a) * p)
                };
            }
        }
        return S[S.length-1];
    }

    function distanciaKmSimple(lat1, lon1, lat2, lon2) {
        const R = 6371;
        const dLat = (lat2-lat1) * Math.PI/180;
        const dLon = (lon2-lon1) * Math.PI/180;
        const a = Math.sin(dLat/2)**2 +
                  Math.cos(lat1*Math.PI/180)*Math.cos(lat2*Math.PI/180)*Math.sin(dLon/2)**2;
        return R * 2 * Math.atan2(Math.sqrt(a), Math.sqrt(1-a));
    }

    // Interpolació IDW (Inverse Distance Weighting): cada estació "vota"
    // el seu valor de pluja, amb pes inversament proporcional a la
    // distancia^IDW_POWER. Aixo dona una superficie contínua i suau
    // en comptes de punts aillats.
    function valorIDW(lat, lon, punts) {
        let sumaPesos = 0, sumaValors = 0, dinsRadi = 0;
        for (let i=0; i<punts.length; i++) {
            const p = punts[i];
            const d = distanciaKmSimple(lat, lon, p.lat, p.lon);
            if (d > IDW_RADI_CERCA_KM) continue;
            dinsRadi++;
            if (d < 0.1) return p.prec; // pràcticament sobre l'estació
            const pes = 1 / Math.pow(d, IDW_POWER);
            sumaPesos += pes;
            sumaValors += pes * p.prec;
        }
        if (dinsRadi === 0 || sumaPesos === 0) return null; // sense dades a prop -> transparent
        return sumaValors / sumaPesos;
    }

    const PlujaLayer = L.Layer.extend({
        initialize: function() {
            this._canvas = null;
            this._offscreen = null;
            this._bounds = null;
            this._dirty = true;
        },
        onAdd: function(map) {
            this._map = map;
            const c = document.createElement('canvas');
            c.style.cssText = 'position:absolute;top:0;left:0;pointer-events:none;';
            map.getPane('paneRadar').appendChild(c);
            this._canvas = c;
            map.on('moveend zoomend', this._render, this);
            this._render();
        },
        onRemove: function(map) {
            map.getPane('paneRadar').removeChild(this._canvas);
            map.off('moveend zoomend', this._render, this);
        },
        setPunts: function(punts) {
            this._punts = punts;
            this._dirty = true;
            this._render();
        },
        _calcularBounds: function() {
            if (!this._punts || !this._punts.length) return null;
            let latMin=90, latMax=-90, lonMin=180, lonMax=-180;
            this._punts.forEach(function(p) {
                if (p.lat<latMin) latMin=p.lat;
                if (p.lat>latMax) latMax=p.lat;
                if (p.lon<lonMin) lonMin=p.lon;
                if (p.lon>lonMax) lonMax=p.lon;
            });
            // Marge perque la malla no talli just a la darrera estacio
            const margeLat = (latMax-latMin) * 0.15 + 0.3;
            const margeLon = (lonMax-lonMin) * 0.15 + 0.3;
            return {
                north: latMax + margeLat, south: latMin - margeLat,
                east: lonMax + margeLon, west: lonMin - margeLon
            };
        },
        _drawOffscreen: function() {
            if (!this._punts || !this._punts.length) return;
            const b = this._calcularBounds();
            this._bounds = b;
            const lonR = b.east - b.west || 1;
            const latR = b.north - b.south || 1;
            const W = PLUJA_GRID_COLS;
            const H = Math.round(W * latR / lonR);

            if (!this._offscreen || this._offscreen.width !== W || this._offscreen.height !== H) {
                this._offscreen = document.createElement('canvas');
                this._offscreen.width = W;
                this._offscreen.height = H;
            }
            const ctx = this._offscreen.getContext('2d');
            ctx.clearRect(0, 0, W, H);
            const imgData = ctx.createImageData(W, H);

            for (let y=0; y<H; y++) {
                const lat = b.north - (y / H) * latR;
                for (let x=0; x<W; x++) {
                    const lon = b.west + (x / W) * lonR;
                    const v = valorIDW(lat, lon, this._punts);
                    const c = colorPluja(v);
                    const idx = (y * W + x) * 4;
                    imgData.data[idx]   = c.r;
                    imgData.data[idx+1] = c.g;
                    imgData.data[idx+2] = c.b;
                    imgData.data[idx+3] = c.a;
                }
            }
            ctx.putImageData(imgData, 0, 0);
            this._dirty = false;
        },
        _render: function() {
            if (!this._punts || !this._map) return;
            if (this._dirty) this._drawOffscreen();
            if (!this._offscreen || !this._bounds) return;
            const size = this._map.getSize();
            const c = this._canvas;
            c.width = size.x;
            c.height = size.y;
            const ctx = c.getContext('2d');
            ctx.clearRect(0, 0, size.x, size.y);
            // Suavitzat perque la rejilla baixa resolucio es vegi com
            // una massa continua, no com quadrats (aixo dona l'aspecte
            // "viscos" que es vol).
            ctx.imageSmoothingEnabled = true;
            ctx.imageSmoothingQuality = 'high';
            L.DomUtil.setPosition(c, this._map.containerPointToLayerPoint([0,0]));
            const b = this._bounds;
            const tl = this._map.latLngToContainerPoint([b.north, b.west]);
            const br = this._map.latLngToContainerPoint([b.south, b.east]);
            const w = br.x - tl.x;
            const h = br.y - tl.y;
            if (w>0 && h>0) {
                ctx.globalAlpha = 0.8;
                ctx.drawImage(this._offscreen, tl.x, tl.y, w, h);
                ctx.globalAlpha = 1.0;
            }
        }
    });

    let capaPluja = null;
    let vistaPlujaActiva = false;

    function toggleVistaPluja() {
        if (!window.map) return;
        vistaPlujaActiva = !vistaPlujaActiva;

        const btn = document.getElementById('btnPrecipitacio');
        if (btn) btn.classList.toggle('active', vistaPlujaActiva);

        if (vistaPlujaActiva) {
            if (!capaPluja) capaPluja = new PlujaLayer();
            capaPluja.addTo(window.map);
            actualitzarCapaPluja();
            // Amaguem la capa d'estacions mentre es veu la massa de
            // pluja, perque no es solapin visualment els dos modes.
            if (capaEstacions && window.map.hasLayer(capaEstacions)) {
                window.map.removeLayer(capaEstacions);
            }
        } else {
            if (capaPluja) window.map.removeLayer(capaPluja);
            if (capaEstacions && estacionsVisible) {
                capaEstacions.addTo(window.map);
            }
        }
    }

    function actualitzarCapaPluja() {
        if (!vistaPlujaActiva || !capaPluja) return;
        const ultimesDades = window.__estacionsUltimaLlista || [];
        const punts = ultimesDades
            .filter(function(e) { return e.prec !== null && e.prec !== undefined; })
            .map(function(e) { return { lat: e.lat, lon: e.lon, prec: e.prec }; });
        capaPluja.setPunts(punts);
    }

    function initBotoPrecipitacio() {
        const bb = document.getElementById('bottombar');
        if (!bb || document.getElementById('btnPrecipitacio')) return;
        const btn = document.createElement('button');
        btn.id = 'btnPrecipitacio';
        btn.className = 'primary';
        btn.title = 'Mostra el mapa de precipitació acumulada (interpolat de les estacions)';
        btn.textContent = 'Precipitació';
        btn.addEventListener('click', toggleVistaPluja);
        bb.appendChild(btn);
    }

    // ═══ TOGGLE VISIBILITAT (botó a la barra inferior) ═══
    function toggleEstacions() {
        if (!capaEstacions || !window.map) return;
        estacionsVisible = !estacionsVisible;
        if (estacionsVisible) {
            capaEstacions.addTo(window.map);
        } else {
            window.map.removeLayer(capaEstacions);
        }
        const btn = document.getElementById('btnEstacions');
        if (btn) btn.classList.toggle('active', estacionsVisible);
    }

    function initBotoEstacions() {
        const bb = document.getElementById('bottombar');
        if (!bb || document.getElementById('btnEstacions')) return;
        const btn = document.createElement('button');
        btn.id = 'btnEstacions';
        btn.className = 'primary active';
        btn.title = 'Mostra/amaga les estacions meteorològiques (temp. i punt de rosada)';
        btn.textContent = 'Estacions';
        btn.addEventListener('click', toggleEstacions);
        bb.appendChild(btn);
    }

    // ═══ INICI ═══
    // S'espera que window.map ja existeixi (creat des de radar.js).
    // Si aquest script es carrega abans per algun motiu, reintenta.
    function esperarMapaIIniciar() {
        if (window.map) {
            injectarEstilsEstacions();
            initBotoEstacions();
            initBotoPrecipitacio();
            carregarEstacions();
            setInterval(carregarEstacions, REFRESH_MS);
        } else {
            setTimeout(esperarMapaIIniciar, 300);
        }
    }

    document.addEventListener('auth:autoritzat', esperarMapaIIniciar);

})();