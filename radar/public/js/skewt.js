
(function () {
    'use strict';

    // ─── ESTAT ────────────────────────────────────────────────────────
    let modalCreat = false;
    let temaActual = localStorage.getItem('skewt_tema') || 'fosc';
    let unitatVent = localStorage.getItem('skewt_unitat_vent') || 'kmh';
    let origenParcelaActual = localStorage.getItem('skewt_origen_parcela') || 'manual';  
    let pressioManualActual = parseFloat(localStorage.getItem('skewt_pressio_manual')) || 850;
    let perfilActual = null;
    let indexsActual = null;
    let ventActual = null;
    let puntActual = null;
    // Alçada (m) sota el cursor quan es passa el ratolí pel Skew-T o
    // per l'hodògraf. Permet sincronitzar el marcador entre tots dos
    // gràfics (que ara viuen al mateix canvas).
    let alcadaHoverActual = null;

    const ORIGENS_PARCELA = ['sfc', 'ml', 'manual'];
    const ETIQUETES_ORIGEN = {
        'sfc': 'Superfície',
        'ml': 'Mixed-Layer',
        'manual': 'Manual'
    };

    const TEMES = {
        fosc: {
            fons: '#000000',
            fonsPanell: '#0a0a0a',
            grid: '#2a2a2a',
            gridForta: '#3a3a3a',
            isoterma: '#3a5a3a',
            isobara: '#4a4a4a',
            adiabaticaSeca: '#8a5a2a',
            adiabaticaHumida: '#2a6a5a',
            mescla: '#2a5a2a',
            temperatura: '#ff0000',
            rosada: '#20ff20',
            rosadaBlava: '#c2ff1a',
            parcela: '#ffffff',
            parcelaML: '#ffffff',
            vent: '#ffffff',
            text: '#cfe0ee',
            textDim: '#7f9bb3',
            capeArea: 'rgba(91, 247, 0, 0.15)',
            cinArea: 'rgba(50, 50, 51, 0.6)',
            hodografRing: '#3a3a3a',
            hodografRingForta: '#4d4d4d',
            hodograf0_1: '#ff3030',
            hodograf1_3: '#ffb030',
            hodograf3_6: '#30b0ff',
            hodograf6_9: '#b030ff',
           
         
            bunkersR: '#92ff03',
            bunkersL: '#6f00ff',
        },
        clar: {
            fons: '#f4f6f8',
            fonsPanell: '#ffffff',
            grid: '#d8dee5',
            gridForta: '#b8c2cc',
            isoterma: '#a8d0a8',
            isobara: '#c0c8d0',
            adiabaticaSeca: '#e0b080',
            adiabaticaHumida: '#80c0b0',
            mescla: '#a0d0a0',
            temperatura: '#d00000',
            rosada: '#008000',
            rosadaBlava: '#a08800',
            parcela: '#080808',
            parcelaML: '#000000',
            vent: '#202020',
            text: '#1a2632',
            textDim: '#5a6a7a',
            capeArea: 'rgba(255,60,60,0.12)',
            cinArea: 'rgba(60,120,255,0.15)',
            hodografRing: '#c0c8d0',
            hodografRingForta: '#a8b2bc',
            hodograf0_1: '#d00000',
            hodograf1_3: '#d08000',
            hodograf3_6: '#0060c0',
            hodograf6_9: '#8000c0',
       
            bunkersR: '#c000c0',
            bunkersL: '#00a0a0',
        }
    };

    function tema() { return TEMES[temaActual]; }

    // ─── CSS INJECTAT ────────────────────────────────────────────────────
    function injectarCSS() {
        if (document.getElementById('skewtStyles')) return;
        const css = `
        .skewt-modal-overlay {
            display: none;
            position: fixed; inset: 0; z-index: 9000;
            background: rgba(0,0,0,0.75);
            align-items: center; justify-content: center;
        }
        .skewt-modal-overlay.active { display: flex; }
        .skewt-modal {
            width: 96vw; height: 94vh;
            max-width: 1500px;
            background: var(--skewt-fons-panell, #0a0a0a);
            border: 1px solid #33475b;
            border-radius: 8px;
            display: flex; flex-direction: column;
            overflow: hidden;
            box-shadow: 0 8px 40px rgba(0,0,0,0.6);
            font-family: 'Segoe UI', Arial, sans-serif;
        }
        .skewt-modal-header {
            display: flex; align-items: center; gap: 10px;
            padding: 8px 14px;
            background: #0a101a;
            border-bottom: 1px solid #33475b;
            flex: 0 0 auto;
        }
        .skewt-modal-header h3 {
            margin: 0; font-size: 14px; color: #cfe0ee; flex: 1;
            white-space: nowrap; overflow: hidden; text-overflow: ellipsis;
        }
        .skewt-modal-header .skewt-loc {
            font-size: 11px; color: #7f9bb3; margin-right: 8px;
        }
        .skewt-btn {
            background: #141c2a; color: #cfe0ee; border: 1px solid #2a3a5a;
            border-radius: 4px; padding: 5px 10px; font-size: 11px; cursor: pointer;
            display: flex; align-items: center; gap: 5px; white-space: nowrap;
        }
        .skewt-btn:hover { background: #1c2838; }
        .skewt-btn.active { background: #2a5a8a; }
        .skewt-modal-close {
            background: transparent; border: none; color: #cfe0ee;
            font-size: 18px; cursor: pointer; padding: 2px 8px; line-height: 1;
        }
        .skewt-modal-close:hover { color: #ff6060; }
        .skewt-modal-body {
            flex: 1; display: flex; overflow: hidden; min-height: 0;
        }
        .skewt-col-main {
            flex: 1 1 auto; display: flex; overflow: hidden; min-width: 0;
        }
        .skewt-col-side {
            flex: 0 0 300px; display: flex; flex-direction: column;
            border-left: 1px solid #33475b; overflow-y: auto; min-width: 0;
        }
        .skewt-canvas-wrap {
            flex: 1 1 auto; position: relative; min-width: 0; overflow: hidden;
        }
        .skewt-canvas-wrap canvas { display: block; width: 100%; height: 100%; cursor: crosshair; }
        .skewt-table-section {
            padding: 8px 10px; border-bottom: 1px solid #222;
        }
        .skewt-table-title {
            font-size: 10px; font-weight: 700; letter-spacing: 0.5px;
            color: #7f9bb3; text-transform: uppercase; margin-bottom: 5px;
        }
        .skewt-table {
            width: 100%; border-collapse: collapse; font-size: 11px;
        }
        .skewt-table td {
            padding: 2px 4px; color: #cfe0ee; border-bottom: 1px solid rgba(255,255,255,0.04);
        }
        .skewt-table td.lbl { color: #7f9bb3; }
        .skewt-table td.val { text-align: right; font-weight: 600; font-variant-numeric: tabular-nums; }
        .skewt-loading {
            display: flex; align-items: center; justify-content: center;
            height: 100%; color: #7f9bb3; font-size: 13px; flex-direction: column; gap: 10px;
        }
        .skewt-spinner {
            width: 28px; height: 28px; border: 3px solid #2a3a5a;
            border-top-color: #FFD700; border-radius: 50%;
            animation: skewt-spin 0.8s linear infinite;
        }
        @keyframes skewt-spin { to { transform: rotate(360deg); } }
        .skewt-modal.tema-clar {
            background: #ffffff;
        }
        .skewt-modal.tema-clar .skewt-modal-header { background: #eef1f4; border-color: #d0d6dc; }
        .skewt-modal.tema-clar .skewt-modal-header h3 { color: #1a2632; }
        .skewt-modal.tema-clar .skewt-loc { color: #5a6a7a; }
        .skewt-modal.tema-clar .skewt-btn { background: #eef1f4; color: #1a2632; border-color: #c0c8d0; }
        .skewt-modal.tema-clar .skewt-btn:hover { background: #e0e6ec; }
        .skewt-modal.tema-clar .skewt-modal-close { color: #1a2632; }
        .skewt-modal.tema-clar .skewt-col-side { border-color: #d0d6dc; }
        .skewt-modal.tema-clar .skewt-table-section { border-color: #e4e8ec; }
        .skewt-modal.tema-clar .skewt-table td { color: #1a2632; border-color: #eee; }
        .skewt-modal.tema-clar .skewt-table td.lbl { color: #5a6a7a; }
        @media (max-width: 900px) {
            .skewt-modal { width: 100vw; height: 100vh; border-radius: 0; }
            .skewt-modal-body { flex-direction: column; overflow-y: auto; }
            .skewt-col-side { flex: 0 0 auto; border-left: none; border-top: 1px solid #33475b; }
        }
        `;
        const style = document.createElement('style');
        style.id = 'skewtStyles';
        style.textContent = css;
        document.head.appendChild(style);
    }

    // ─── CONSTRUCCIÓ DEL DOM DEL MODAL ─────────────────────────────────
    function crearModal() {
        if (modalCreat) return;
        injectarCSS();

        const overlay = document.createElement('div');
        overlay.id = 'skewtModalOverlay';
        overlay.className = 'skewt-modal-overlay';
        overlay.innerHTML = `
            <div class="skewt-modal" id="skewtModal">
                <div class="skewt-modal-header">
                    <h3><i class="fas fa-chart-line"></i> Skew-T / Log-P &nbsp;powered by @Tempestes.cat/Tempest.strike</h3>
                    <span class="skewt-loc" id="skewtLocLabel">—</span>
                    <button class="skewt-btn" id="skewtBtnOrigen" title="Origen de la parcel·la (SFC / Mixed-Layer / Manual)">
                        <i class="fas fa-cloud-upload-alt"></i> <span id="skewtOrigenLabel">Superfície</span>
                    </button>
                    <span id="skewtManualPressioWrap" style="display:none; margin-left:2px;">
                        <input type="number" id="skewtInputPressio" value="850" min="100" max="1050" step="5"
                            style="width:52px; height:26px; background:#141c2a; color:#cfe0ee; border:1px solid #2a3a5a;
                                   border-radius:4px; padding:2px 4px; font-size:11px; text-align:center;">
                        <span style="color:#7f9bb3; font-size:10px; margin-left:2px;">hPa</span>
                    </span>
                    <button class="skewt-btn" id="skewtBtnTema" title="Canviar tema (Fosc / Clar)">
                        <i class="fas fa-adjust"></i> <span id="skewtTemaLabel">Fosc</span>
                    </button>
                    <button class="skewt-btn" id="skewtBtnUnitat" title="Unitat de vent (km/h / kt / m/s)">
                        <i class="fas fa-wind"></i> <span id="skewtUnitatLabel">km/h</span>
                    </button>
                    <button class="skewt-modal-close" id="skewtBtnClose">✕</button>
                </div>
                <div class="skewt-modal-body" id="skewtBody">
                    <div class="skewt-loading" id="skewtLoading">
                        <div class="skewt-spinner"></div>
                        <div>Calculant sondeig...</div>
                    </div>
                </div>
            </div>
        `;
        document.body.appendChild(overlay);
        modalCreat = true;

        overlay.addEventListener('click', function (e) {
            if (e.target === overlay) tancarSkewtModal();
        });
        document.getElementById('skewtBtnClose').addEventListener('click', tancarSkewtModal);
        document.getElementById('skewtBtnTema').addEventListener('click', toggleTema);
        document.getElementById('skewtBtnUnitat').addEventListener('click', toggleUnitatVent);
        document.getElementById('skewtBtnOrigen').addEventListener('click', toggleOrigenParcela);

        // Quan l'usuari canvia la pressió manual, recalcular automàticament
        const inputPressio = document.getElementById('skewtInputPressio');
        if (inputPressio) {
            inputPressio.addEventListener('change', function () {
                if (origenParcelaActual === 'manual') {
                    pressioManualActual = parseFloat(this.value) || 850;
                    localStorage.setItem('skewt_pressio_manual', pressioManualActual);
                    recalcularAmbNouOrigen();
                }
            });
            inputPressio.addEventListener('keydown', function (e) {
                if (e.key === 'Enter' && origenParcelaActual === 'manual') {
                    pressioManualActual = parseFloat(this.value) || 850;
                    localStorage.setItem('skewt_pressio_manual', pressioManualActual);
                    recalcularAmbNouOrigen();
                }
            });
        }

        document.addEventListener('keydown', function (e) {
            if (e.key === 'Escape' && overlay.classList.contains('active')) tancarSkewtModal();
        });
    }

    // ─── TOGGLES ─────────────────────────────────────────────────────────
    function toggleTema() {
        temaActual = temaActual === 'fosc' ? 'clar' : 'fosc';
        localStorage.setItem('skewt_tema', temaActual);
        const modal = document.getElementById('skewtModal');
        if (modal) modal.classList.toggle('tema-clar', temaActual === 'clar');
        document.getElementById('skewtTemaLabel').textContent = temaActual === 'fosc' ? 'Fosc' : 'Clar';
        redibuixarTot();
    }

    function toggleUnitatVent() {
        const ordre = ['kmh', 'kt', 'ms'];
        unitatVent = ordre[(ordre.indexOf(unitatVent) + 1) % ordre.length];
        localStorage.setItem('skewt_unitat_vent', unitatVent);
        document.getElementById('skewtUnitatLabel').textContent = etiquetaUnitat(unitatVent);
        redibuixarTot();
    }

    // ── calcula (si cal) i aplica el millor nivell de partida per a
    //     l'origen "Manual", entre superfície i 500 hPa, segons el CAPE
    //     més alt que en resultaria (Most-Unstable style). Actualitza
    //     l'input de pressió i l'estat intern.
    function aplicarMillorNivellManual() {
        if (!perfilActual) return;
        const E = window.SkewtEngine;
        if (!E || !E.millorOrigenParcela) return;

        const resultat = E.millorOrigenParcela(perfilActual, { pMinim: 500 });
        if (!resultat || !esFinit(resultat.p)) return;

        pressioManualActual = Math.round(resultat.p);
        localStorage.setItem('skewt_pressio_manual', pressioManualActual);
        const input = document.getElementById('skewtInputPressio');
        if (input) input.value = pressioManualActual;
    }

    function toggleOrigenParcela() {
        const idx = ORIGENS_PARCELA.indexOf(origenParcelaActual);
        origenParcelaActual = ORIGENS_PARCELA[(idx + 1) % ORIGENS_PARCELA.length];
        localStorage.setItem('skewt_origen_parcela', origenParcelaActual);

        // Actualitzar botó
        const label = document.getElementById('skewtOrigenLabel');
        if (label) label.textContent = ETIQUETES_ORIGEN[origenParcelaActual];

        // Actualitzar estil del botó (actiu si no és SFC)
        const btn = document.getElementById('skewtBtnOrigen');
        if (btn) {
            btn.classList.toggle('active', origenParcelaActual !== 'sfc');
        }

        // Mostrar/amagar input de pressió manual
        const wrapManual = document.getElementById('skewtManualPressioWrap');
        if (wrapManual) {
            wrapManual.style.display = origenParcelaActual === 'manual' ? 'inline' : 'none';
        }

        // En entrar a mode "manual", proposar automàticament el
        // nivell (sfc..500 hPa) que produeix el CAPE més alt, en lloc de
        // mantenir sempre el valor fix anterior. Això detecta capes
        // elevades humides i inestables per sobre d'inversions de
        // superfície (Elevated CAPE).
        if (origenParcelaActual === 'manual') {
            aplicarMillorNivellManual();
        }

        // Recalcular índexs i redibuixar
        recalcularAmbNouOrigen();
    }

    function recalcularAmbNouOrigen() {
        if (!perfilActual) return;

        const E = window.SkewtEngine;
        if (!E) return;

        let pManual = null;
        if (origenParcelaActual === 'manual') {
            const input = document.getElementById('skewtInputPressio');
            pManual = input ? parseFloat(input.value) : pressioManualActual;
            if (!esFinit(pManual) || pManual < 100 || pManual > 1050) {
                pManual = 850;
                if (input) input.value = 850;
            }
            pressioManualActual = pManual;
        }

        // Recalcular índexs termodinàmics amb el nou origen
        const nousIndexs = E.calcularIndexsTermo(perfilActual, {
            origenParcela: origenParcelaActual,
            pManual: pManual,
            dpMix: 100
        });

        if (!nousIndexs) return;

        // Mantenir els índexs addicionals (K, Showalter, Totals)
        const addicionals = E.indexsAddicionals(perfilActual);
        indexsActual = Object.assign({}, nousIndexs, addicionals);

        // Redibuixar
        redibuixarTot();
    }

    function etiquetaUnitat(u) {
        if (u === 'kmh') return 'km/h';
        if (u === 'kt') return 'kt';
        return u;
    }

    function tancarSkewtModal() {
        const overlay = document.getElementById('skewtModalOverlay');
        if (overlay) overlay.classList.remove('active');
    }

    // ─── PUNT D'ENTRADA PRINCIPAL (cridat pel menú contextual del mapa) ──
    window.openSkewtModal = function () {
        crearModal();
        const overlay = document.getElementById('skewtModalOverlay');
        const modal = document.getElementById('skewtModal');
        modal.classList.toggle('tema-clar', temaActual === 'clar');
        document.getElementById('skewtTemaLabel').textContent = temaActual === 'fosc' ? 'Fosc' : 'Clar';
        document.getElementById('skewtUnitatLabel').textContent = etiquetaUnitat(unitatVent);
        document.getElementById('skewtOrigenLabel').textContent = ETIQUETES_ORIGEN[origenParcelaActual];
        const btnOrigen = document.getElementById('skewtBtnOrigen');
        if (btnOrigen) btnOrigen.classList.toggle('active', origenParcelaActual !== 'sfc');
        document.getElementById('skewtManualPressioWrap').style.display = origenParcelaActual === 'manual' ? 'inline' : 'none';
        if (origenParcelaActual === 'manual') {
            document.getElementById('skewtInputPressio').value = pressioManualActual;
        }
        overlay.classList.add('active');

        const pos = window.lastRightClickPos;
        if (!pos) {
            mostrarError('No hi ha cap punt seleccionat al mapa.');
            return;
        }

        mostrarCarregant();
        esperarDadesIObrir(pos, 0);
    };

    // ── FIX race condition ──────────────────────────────────────────────
    const SKEWT_MAX_INTENTS = 30;       // 30 x 200ms ≈ 6 segons màxim d'espera
    const SKEWT_INTERVAL_MS = 200;

    function esperarDadesIObrir(pos, intent) {
        const hourIdx = (typeof window.skewtHourIndex === 'number') ?
            window.skewtHourIndex :
            (typeof window.curIdx === 'number' ? window.curIdx : 0);

        const hores = window.totesLesHores;

        if (hores && hores[hourIdx]) {
            calcularIObrirSondeig(hores[hourIdx], pos.lat, pos.lng, hourIdx);
            return;
        }

        const overlay = document.getElementById('skewtModalOverlay');
        if (!overlay || !overlay.classList.contains('active')) return;

        if (intent >= SKEWT_MAX_INTENTS) {
            mostrarError('Encara no hi ha dades carregades per aquesta hora.\nTorna-ho a provar en uns segons.');
            return;
        }

        setTimeout(function () {
            esperarDadesIObrir(pos, intent + 1);
        }, SKEWT_INTERVAL_MS);
    }

    function mostrarCarregant() {
        const body = document.getElementById('skewtBody');
        if (!body) return;
        body.innerHTML = `
            <div class="skewt-loading">
                <div class="skewt-spinner"></div>
                <div>Calculant sondeig...</div>
            </div>
        `;
    }

    function mostrarError(msg) {
        const body = document.getElementById('skewtBody');
        if (!body) return;
        body.innerHTML = `
            <div class="skewt-loading" style="flex-direction:column; gap:12px; padding:30px;">
                <div style="font-size:40px; opacity:0.6;">!</div>
                <div style="font-size:13px; color:#cfe0ee; text-align:center; line-height:1.5; white-space:pre-line;">${msg}</div>
            </div>
        `;
    }

    function esFinit(v) { return v !== null && v !== undefined && !isNaN(v) && isFinite(v); }

    // ── Cerca del poble/vila més proper (towns_cat.js) ──────────────────
    const RADI_TERRA_KM = 6371;

    function distanciaHaversineKm(lat1, lon1, lat2, lon2) {
        const toRad = d => d * Math.PI / 180;
        const dLat = toRad(lat2 - lat1);
        const dLon = toRad(lon2 - lon1);
        const a = Math.sin(dLat / 2) ** 2 +
                  Math.cos(toRad(lat1)) * Math.cos(toRad(lat2)) * Math.sin(dLon / 2) ** 2;
        const c = 2 * Math.atan2(Math.sqrt(a), Math.sqrt(1 - a));
        return RADI_TERRA_KM * c;
    }

    function trobarPobleMesProper(lat, lon) {
        const dades = window.TOWNS_CAT;
        if (!dades || !dades.towns || !dades.towns.length) return null;

        let millor = null, millorDist = Infinity;
        for (let i = 0; i < dades.towns.length; i++) {
            const t = dades.towns[i];
            if (t.t !== 'poble' && t.t !== 'vila') continue;
            if (!esFinit(t.la) || !esFinit(t.lo)) continue;
            const d = distanciaHaversineKm(lat, lon, t.la, t.lo);
            if (d < millorDist) { millorDist = d; millor = t; }
        }
        if (!millor) return null;
        return { nom: millor.n, tipus: millor.t, altitud: millor.a, distanciaKm: millorDist };
    }

    function calcularIObrirSondeig(horaItem, lat, lon, hourIdx) {
        const E = window.SkewtEngine;
        if (!E) { mostrarError('Motor de càlcul (skewt-engine.js) no carregat.'); return; }

        const data = horaItem.data;

        const coords = data.coordenadas;
        if (!coords || !coords.lat || !coords.lon) {
            mostrarError('No hi ha dades de coordenades disponibles.');
            return;
        }

        const latMin = Math.min(coords.lat[0], coords.lat[coords.lat.length - 1]);
        const latMax = Math.max(coords.lat[0], coords.lat[coords.lat.length - 1]);
        const lonMin = Math.min(coords.lon[0], coords.lon[coords.lon.length - 1]);
        const lonMax = Math.max(coords.lon[0], coords.lon[coords.lon.length - 1]);

        if (lat < latMin || lat > latMax || lon < lonMin || lon > lonMax) {
            mostrarError(
                'Fora del domini del model.\n' +
                'Lat: ' + latMin.toFixed(1) + ' a ' + latMax.toFixed(1) + '\n' +
                'Lon: ' + lonMin.toFixed(1) + ' a ' + lonMax.toFixed(1)
            );
            return;
        }

        const perfil = E.extreurePerfil(data, lat, lon, null);
        if (!perfil) {
            mostrarError('No hi ha prou dades de sondeig en aquest punt.\nPossiblement sobre el mar o zona sense cobertura.\n\nSi el problema persisteix, comprova que el backend generi sfc_light_XX.json amb sp/st/sd/su/sv (necessari perquè el sondeig arrenqui a la pressió real de superfície).');
            return;
        }

        perfilActual = perfil;

        // Si l'origen actual és "manual", recalcular el millor nivell de
        // partida per a AQUEST nou perfil (cada punt/hora té la seva
        // pròpia estructura vertical, així que el nivell òptim pot canviar).
        if (origenParcelaActual === 'manual') {
            aplicarMillorNivellManual();
        }

        // Calcular índexs amb l'origen de parcel·la actual
        let pManual = null;
        if (origenParcelaActual === 'manual') {
            pManual = pressioManualActual;
        }

        const indexs = E.calcularIndexsTermo(perfil, {
            origenParcela: origenParcelaActual,
            pManual: pManual,
            dpMix: 100
        });
        
        const addicionals = E.indexsAddicionals(perfil);
        const nivellsVent = perfil.p.map((p, i) => ({ z: perfil.z[i], u: perfil.u[i], v: perfil.v[i] }));
        const ventComposite = E.calcularVentComposite(nivellsVent, perfil.z[0]);

        indexsActual = Object.assign({}, indexs, addicionals);
        ventActual = ventComposite;
        const pobleProper = trobarPobleMesProper(lat, lon);
        puntActual = { lat, lon, hourIdx, horaItem, pobleProper };

        // Actualitzar etiquetes del botó d'origen
        document.getElementById('skewtOrigenLabel').textContent = ETIQUETES_ORIGEN[origenParcelaActual];
        const btnOrigen = document.getElementById('skewtBtnOrigen');
        if (btnOrigen) btnOrigen.classList.toggle('active', origenParcelaActual !== 'sfc');
        document.getElementById('skewtManualPressioWrap').style.display = origenParcelaActual === 'manual' ? 'inline' : 'none';
        if (origenParcelaActual === 'manual') {
            const input = document.getElementById('skewtInputPressio');
            if (input) input.value = pressioManualActual;
        }

        muntarLayout();
        redibuixarTot();
    }

    // ─── LAYOUT ──────────────────────────────────────────────────────────
    // Un únic canvas ("skewtCanvas") que conté Skew-T + hodògraf, per tal
    // que "Copiar imatge" del navegador agafi tot en una sola peça.
    function muntarLayout() {
        const body = document.getElementById('skewtBody');
        body.innerHTML = `
            <div class="skewt-col-main">
                <div class="skewt-canvas-wrap" id="skewtCanvasWrap">
                    <canvas id="skewtCanvas"></canvas>
                </div>
            </div>
            <div class="skewt-col-side" id="skewtSideCol"></div>
        `;

        const item = puntActual.horaItem;
        const d = item.dateObj;
        const dataStr = d.toLocaleDateString('ca-ES', { weekday: 'short', day: 'numeric', month: 'short' });
        const horaStr = String(d.getHours()).padStart(2, '0') + ':00';
        const pp = puntActual.pobleProper;
        if (pp && pp.nom) {
            document.getElementById('skewtLocLabel').textContent =
                pp.nom + ' · ' + dataStr + ' ' + horaStr;
        } else {
            document.getElementById('skewtLocLabel').textContent =
                puntActual.lat.toFixed(3) + '°N, ' + puntActual.lon.toFixed(3) + '°E · ' + dataStr + ' ' + horaStr;
        }

        if (window.construirTaulaIndexsSkewt) window.construirTaulaIndexsSkewt();

        window.addEventListener('resize', onResizeSkewt);
    }

    let resizeTimeout = null;
    function onResizeSkewt() {
        clearTimeout(resizeTimeout);
        resizeTimeout = setTimeout(redibuixarTot, 120);
    }

    function redibuixarTot() {
        if (!perfilActual) return;
        if (window.dibuixarSkewtCanvas) window.dibuixarSkewtCanvas();
        if (window.construirTaulaIndexsSkewt) window.construirTaulaIndexsSkewt();
    }

    // ─── EXPORT INTERN ───────────────────────────────────────────────────
    window._skewtInternal = {
        tema, TEMES,
        get perfilActual() { return perfilActual; },
        get indexsActual() { return indexsActual; },
        get ventActual() { return ventActual; },
        get puntActual() { return puntActual; },
        get unitatVent() { return unitatVent; },
        get origenParcelaActual() { return origenParcelaActual; },
        esFinit
    };


    // ═══════════════════════════════════════════════════════════════════
    //  SECCIÓ 2 — DIBUIX DEL SKEW-T + HODÒGRAF (mateix Canvas)
    // ═══════════════════════════════════════════════════════════════════

    // Rang del diagrama Skew-T
    const P_TOP = 100;      // hPa
    const P_BOT = 1050;     // hPa
    const T_MIN = -32;      // °C
    const T_MAX = 50;       // °C
    const SKEW = 50;        // graus d'esbiaixament

    function yPerP(p, h, padTop, padBot) {
        const logTop = Math.log(P_TOP), logBot = Math.log(P_BOT);
        const frac = (logBot - Math.log(p)) / (logBot - logTop);
        return (h - padBot) - frac * (h - padTop - padBot);
    }
    function pPerY(y, h, padTop, padBot) {
        const logTop = Math.log(P_TOP), logBot = Math.log(P_BOT);
        const frac = ((h - padBot) - y) / (h - padTop - padBot);
        return Math.exp(logBot - frac * (logBot - logTop));
    }

    function xPerT(tC, p, w, h, padLeft, padRight, padTop, padBot) {
        const y = yPerP(p, h, padTop, padBot);
        const skewPerPx = Math.tan(SKEW * Math.PI / 180);
        const yBase = yPerP(P_BOT, h, padTop, padBot);
        const dxSkew = (yBase - y) * skewPerPx;
        const fracT = (tC - T_MIN) / (T_MAX - T_MIN);
        const xBase = padLeft + fracT * (w - padLeft - padRight);
        return xBase + dxSkew;
    }
    function tPerXY(x, y, w, h, padLeft, padRight, padTop, padBot) {
        const skewPerPx = Math.tan(SKEW * Math.PI / 180);
        const yBase = yPerP(P_BOT, h, padTop, padBot);
        const dxSkew = (yBase - y) * skewPerPx;
        const xBase = x - dxSkew;
        const fracT = (xBase - padLeft) / (w - padLeft - padRight);
        return T_MIN + fracT * (T_MAX - T_MIN);
    }

    function dibuixarEtiquetaPoble(ctx, padLeft, padTop, T) {
        const pp = puntActual && puntActual.pobleProper;
        if (!pp || !pp.nom) return;
        ctx.font = 'bold 11px Arial';
        ctx.textAlign = 'left';
        ctx.fillStyle = T.text;
        ctx.fillText(pp.nom, padLeft + 6, padTop + 12);
    }

    // ─── DIBUIX PRINCIPAL: calcula geometria del Skew-T (columna esquerra,
    //     més ampla) i del hodògraf (columna dreta, quadrat), tots dos dins
    //     del MATEIX canvas ───────────────────────────────────────────────
    function dibuixarSkewtCanvas() {
        const wrap = document.getElementById('skewtCanvasWrap');
        const canvas = document.getElementById('skewtCanvas');
        if (!wrap || !canvas) return;
        const dpr = window.devicePixelRatio || 1;
        const wTotal = wrap.clientWidth, hTotal = wrap.clientHeight;
        canvas.width = wTotal * dpr; canvas.height = hTotal * dpr;
        const ctx = canvas.getContext('2d');
        ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
        ctx.clearRect(0, 0, wTotal, hTotal);

        const T = tema();
        ctx.fillStyle = T.fons;
        ctx.fillRect(0, 0, wTotal, hTotal);

        // Repartiment horitzontal: hodògraf a la dreta amb amplada fixa
        const hodoAmpleIdeal = Math.min(340, Math.max(230, hTotal * 0.42));
        const hodoAmple = Math.min(hodoAmpleIdeal, wTotal * 0.42);
        const skewtAmple = wTotal - hodoAmple;

        // ── Zona Skew-T (0 .. skewtAmple) ──
        const w = skewtAmple, h = hTotal;
        const padLeft = 42, padRight = 18, padTop = 10, padBot = 26;
        const proj = {
            x: (tC, p) => xPerT(tC, p, w, h, padLeft, padRight, padTop, padBot),
            y: (p) => yPerP(p, h, padTop, padBot)
        };

        dibuixarGraella(ctx, w, h, padLeft, padRight, padTop, padBot, T, proj);
        dibuixarTerreny(ctx, T, proj, w, padRight);
        dibuixarAreesCapeCin(ctx, T, proj);
        dibuixarLiniesEstat(ctx, w, h, padLeft, padRight, padTop, padBot, T, proj);
        dibuixarNivellsClau(ctx, w, padRight, T, proj);
        dibuixarBarbesVent(ctx, w, padRight, T, proj);
        dibuixarEtiquetesEix(ctx, w, h, padLeft, padRight, padTop, padBot, T, proj);
        dibuixarEtiquetaPoble(ctx, padLeft, padTop, T);

        // Separador vertical entre Skew-T i hodògraf
        ctx.strokeStyle = T.gridForta;
        ctx.lineWidth = 1;
        ctx.beginPath();
        ctx.moveTo(skewtAmple + 0.5, 0);
        ctx.lineTo(skewtAmple + 0.5, hTotal);
        ctx.stroke();

        // ── Zona Hodògraf (skewtAmple .. wTotal) ──
        const hodoGeom = dibuixarHodografEnCanvas(ctx, T, skewtAmple, 0, hodoAmple, hTotal);

        // ─── INTERACCIÓ (tooltip Skew-T + tooltip hodògraf, un sol canvas) ─
        if (canvas._skewtMouseMove) canvas.removeEventListener('mousemove', canvas._skewtMouseMove);
        if (canvas._skewtMouseLeave) canvas.removeEventListener('mouseleave', canvas._skewtMouseLeave);
        if (canvas._skewtClick) canvas.removeEventListener('click', canvas._skewtClick);

        let tooltip = document.getElementById('skewtTooltip');
        if (!tooltip) {
            tooltip = document.createElement('div');
            tooltip.id = 'skewtTooltip';
            tooltip.style.cssText = `
                position:absolute; background:rgba(10,16,26,0.95); border:1px solid #556;
                border-radius:4px; padding:5px 8px; font-family:'Segoe UI',Arial,sans-serif;
                font-size:10px; color:#cde; pointer-events:none; z-index:1000; display:none;
                white-space:nowrap; line-height:1.5; box-shadow:0 2px 8px rgba(0,0,0,0.5);
            `;
            wrap.appendChild(tooltip);
        }

        let currentMouseY = null;
        const colorT = T.temperatura;
        const colorTd = T.rosadaBlava || '#3090ff';

        function fmtVent(mps) {
            const f = unitatVent === 'kt' ? 1.94384 : (unitatVent === 'kmh' ? 3.6 : 1);
            return (mps * f).toFixed(0) + ' ' + etiquetaUnitat(unitatVent);
        }

        function dirVent(u, v) {
            let dg = Math.atan2(-u, -v) * 180 / Math.PI;
            if (dg < 0) dg += 360;
            const sec = ['Nord', 'Nord-est', 'Est', 'Sud-est', 'Sud', 'Sud-oest', 'Oest', 'Nord-oest'];
            const index = Math.round(dg / 45) % 8;
            return sec[index] + ' ' + dg.toFixed(0) + '°';
        }

        function calcHR(tC, tdC) {
            const es = 6.112 * Math.exp((17.67 * tC) / (tC + 243.5));
            const e = 6.112 * Math.exp((17.67 * tdC) / (tdC + 243.5));
            return Math.min(100, Math.max(0, (e / es) * 100));
        }

        // ── FIX: LI calculat amb l'ORIGEN REAL de la parcel·la ──────────
        // Abans: sempre feia servir pf.t[0]/pf.td[0]/pf.p[0] (superfície),
        // encara que l'usuari tingués seleccionat "Manual" o "Mixed-Layer".
        // Ara: fa servir indexsActual.pOrigenParcela / tOrigenParcela /
        // tdOrigenParcela — el mateix punt de partida que s'ha usat per
        // calcular tParcela, CAPE, CIN, LCL, LFC, EL a skewt-engine.js.
        // Així el LI que es veu al passar el ratolí és coherent amb la
        // línia de parcel·la (groga) realment dibuixada al gràfic.
        function calcLI(pNiv, tAmb) {
            const pf = perfilActual;
            const idx = indexsActual;
            if (!pf || !idx || pNiv >= pf.p[0]) return null;
            const E = window.SkewtEngine;
            if (!E) return null;

            const pOrig = esFinit(idx.pOrigenParcela) ? idx.pOrigenParcela : pf.p[0];
            const tOrig = esFinit(idx.tOrigenParcela) ? idx.tOrigenParcela : pf.t[0];
            const tdOrig = esFinit(idx.tdOrigenParcela) ? idx.tdOrigenParcela : pf.td[0];
            if (pNiv >= pOrig) return null; // el nivell del cursor és per sota de l'origen de la parcel·la: no té sentit el LI aquí

            const tp = E.perfilParcela(tOrig, tdOrig, pOrig, [pNiv]);
            return (tp && tp.valors[0] !== null) ? tAmb - tp.valors[0] : null;
        }

        // ── NOU: lapse rate real de l'AMBIENT (sondeig, no parcel·la)
        //     entre el punt sota el cursor i 2 km / 5 km per sobre. Es
        //     retorna la diferència de temperatura (°C), és a dir quant
        //     es refreda l'aire ambient en aquest tram (valor positiu =
        //     es refreda amb l'alçada, com és habitual; valor negatiu o
        //     proper a 0 indicaria una capa isoterma o inversió just per
        //     sobre del punt inspeccionat).
        function calcPerduaAmbient(zBase, tBase, deltaZ) {
            const pf = perfilActual;
            const E = window.SkewtEngine;
            if (!pf || !E || !E.interpolarTAAlcada) return null;
            const tSup = E.interpolarTAAlcada(pf, zBase + deltaZ);
            if (tSup === null || !esFinit(tSup) || !esFinit(tBase)) return null;
            return tBase - tSup; // positiu = l'ambient es refreda pujant
        }

        // ── NOU: proxy de theta-e portada a superfície — es descendeix
        //     secament (Poisson) la T del punt sota el cursor des de la
        //     seva pressió fins a la pressió de superfície del sondeig.
        function calcTBaixadaSfc(tC, pNiv) {
            const pf = perfilActual;
            const E = window.SkewtEngine;
            if (!pf || !E || !E.descendirSecAPressio) return null;
            const pSfc = pf.p[0];
            if (!esFinit(pSfc) || !esFinit(tC) || !esFinit(pNiv)) return null;
            return E.descendirSecAPressio(tC, pNiv, pSfc);
        }

        function redrawWithLine(my) {
            ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
            ctx.clearRect(0, 0, wTotal, hTotal);
            ctx.fillStyle = T.fons; ctx.fillRect(0, 0, wTotal, hTotal);
            dibuixarGraella(ctx, w, h, padLeft, padRight, padTop, padBot, T, proj);
            dibuixarTerreny(ctx, T, proj, w, padRight);
            dibuixarAreesCapeCin(ctx, T, proj);
            dibuixarLiniesEstat(ctx, w, h, padLeft, padRight, padTop, padBot, T, proj);
            dibuixarNivellsClau(ctx, w, padRight, T, proj);
            dibuixarBarbesVent(ctx, w, padRight, T, proj);
            dibuixarEtiquetesEix(ctx, w, h, padLeft, padRight, padTop, padBot, T, proj);
            dibuixarEtiquetaPoble(ctx, padLeft, padTop, T);

            if (my !== null) {
                ctx.strokeStyle = 'rgba(255,255,255,0.65)';
                ctx.lineWidth = 0.8;
                ctx.setLineDash([3, 4]);
                ctx.beginPath(); ctx.moveTo(padLeft, my); ctx.lineTo(w - padRight, my); ctx.stroke();
                ctx.setLineDash([]);
                ctx.fillStyle = 'rgba(255,255,255,0.85)';
                ctx.beginPath(); ctx.arc(padLeft - 2, my, 2.5, 0, 2 * Math.PI); ctx.fill();
            }

            ctx.strokeStyle = T.gridForta;
            ctx.lineWidth = 1;
            ctx.beginPath();
            ctx.moveTo(skewtAmple + 0.5, 0);
            ctx.lineTo(skewtAmple + 0.5, hTotal);
            ctx.stroke();

            dibuixarHodografEnCanvas(ctx, T, skewtAmple, 0, hodoAmple, hTotal, alcadaHoverActual);
        }

        canvas._skewtMouseMove = function (e) {
            const r = canvas.getBoundingClientRect();
            const mx = e.clientX - r.left, my = e.clientY - r.top;

            // ── Sobre la zona del Skew-T ──
            if (mx >= 0 && mx <= w) {
                if (mx < padLeft - 8 || mx > w - padRight + 8 || my < padTop || my > h - padBot) {
                    tooltip.style.display = 'none';
                    if (currentMouseY !== null || alcadaHoverActual !== null) {
                        currentMouseY = null; alcadaHoverActual = null;
                        redrawWithLine(null);
                    }
                    return;
                }

                if (currentMouseY !== my) { currentMouseY = my; }

                const p = pPerY(my, h, padTop, padBot);
                const pf = perfilActual;
                if (!pf) { tooltip.style.display = 'none'; redrawWithLine(my); return; }

                let bi = 0, bd = Infinity;
                for (let i = 0; i < pf.p.length; i++) {
                    const dd = Math.abs(pf.p[i] - p);
                    if (dd < bd) { bd = dd; bi = i; }
                }
                if (bd > 25) {
                    tooltip.style.display = 'none';
                    alcadaHoverActual = null;
                    redrawWithLine(my);
                    return;
                }

                alcadaHoverActual = pf.z[bi];
                redrawWithLine(my);

                const tC = pf.t[bi], tdC = pf.td[bi], pN = pf.p[bi], zM = pf.z[bi];
                const u = pf.u[bi], v = pf.v[bi];
                const spd = Math.sqrt(u * u + v * v);
                const hr = calcHR(tC, tdC);
                const li = calcLI(pN, tC);

                let liTxt = '--', liClr = '#888';
                if (li !== null && isFinite(li)) {
                    liTxt = li.toFixed(1);
                    liClr = li < -6 ? '#f44' : li < -3 ? '#f84' : li < 0 ? '#fb4' : li < 3 ? '#8cf' : '#48f';
                }

                let hrClr = hr < 30 ? '#f84' : hr < 50 ? '#fb4' : hr < 70 ? '#8cf' : hr < 90 ? '#48f' : '#28f';

                // Pèrdua de temperatura de l'ambient 2 km i 5 km per sobre
                const perdua2km = calcPerduaAmbient(zM, tC, 2000);
                const perdua5km = calcPerduaAmbient(zM, tC, 5000);
                const p2Txt = (perdua2km !== null && esFinit(perdua2km)) ? perdua2km.toFixed(1) + '°C' : '—';
                const p5Txt = (perdua5km !== null && esFinit(perdua5km)) ? perdua5km.toFixed(1) + '°C' : '—';
                const p2Clr = (perdua2km !== null) ? (perdua2km < 4 ? '#fb4' : perdua2km > 13 ? '#f66' : '#8cf') : '#888';
                const p5Clr = (perdua5km !== null) ? (perdua5km < 10 ? '#fb4' : perdua5km > 30 ? '#f66' : '#8cf') : '#888';

                // Theta-e (aprox., adiabàtica seca) portada a superfície
                const tBaixadaSfc = calcTBaixadaSfc(tC, pN);
                const tBaixadaTxt = (tBaixadaSfc !== null && esFinit(tBaixadaSfc)) ? tBaixadaSfc.toFixed(1) + '°C' : '—';

                tooltip.innerHTML = `
                    <div style="font-weight:600;color:#fff;margin-bottom:2px;">${pN.toFixed(0)} hPa &middot; ${zM.toFixed(0)} m</div>
                    <span style="color:${colorT};">T ${tC.toFixed(1)}°C</span>
                    <span style="color:${colorTd};margin-left:10px;">Td ${tdC.toFixed(1)}°C</span>
                    <span style="color:${hrClr};margin-left:10px;">${hr.toFixed(0)}%</span><br>
                    <span style="color:#bbb;">${fmtVent(spd)} ${dirVent(u, v)}</span>
                    <span style="color:${liClr};margin-left:8px;">LI ${liTxt}</span><br>
                    <span style="color:#8fa;">T si baixés a sfc: ${tBaixadaTxt}</span><br>
                    <span style="color:${p2Clr};">Pèrdua T +2km: ${p2Txt}</span>
                    <span style="color:${p5Clr};margin-left:8px;">+5km: ${p5Txt}</span>
                `;

                const wr = wrap.getBoundingClientRect();
                let tx = e.clientX - wr.left + 14, ty = e.clientY - wr.top - 36;
                const tw = 210, th = 96;
                if (tx + tw > wTotal) tx = e.clientX - wr.left - tw - 14;
                if (tx < 4) tx = 4;
                if (ty < 2) ty = e.clientY - wr.top + 14;
                if (ty + th > hTotal) ty = hTotal - th - 4;

                tooltip.style.left = tx + 'px';
                tooltip.style.top = ty + 'px';
                tooltip.style.display = 'block';
                return;
            }

            // ── Sobre la zona del Hodògraf ──
            if (mx > w && ventActual) {
                const geom = hodoGeom;
                if (!geom) { tooltip.style.display = 'none'; return; }
                const niv = ventActual.niv;
                const factor = unitatVent === 'kt' ? 1.94384 : (unitatVent === 'kmh' ? 3.6 : 1);

                function ptLocal(u, v) {
                    return { x: geom.cx + u * factor * geom.pxPerUnit, y: geom.cy - v * factor * geom.pxPerUnit };
                }

                let millorI = -1, millorD = Infinity;
                for (let i = 0; i < niv.length; i++) {
                    const pt = ptLocal(niv[i].u, niv[i].v);
                    const dd = (pt.x - mx) ** 2 + (pt.y - my) ** 2;
                    if (dd < millorD) { millorD = dd; millorI = i; }
                }

                if (millorI === -1 || millorD > 22 * 22) {
                    tooltip.style.display = 'none';
                    if (alcadaHoverActual !== null) { alcadaHoverActual = null; redrawWithLine(null); }
                    return;
                }

                const nPunt = niv[millorI];
                if (alcadaHoverActual !== nPunt.z) {
                    alcadaHoverActual = nPunt.z;
                    redrawWithLine(null);
                }

                const spd = Math.sqrt(nPunt.u * nPunt.u + nPunt.v * nPunt.v);
                let dg = Math.atan2(-nPunt.u, -nPunt.v) * 180 / Math.PI;
                if (dg < 0) dg += 360;

                tooltip.innerHTML = `
                    <div style="font-weight:600;color:#fff;margin-bottom:2px;">${nPunt.z.toFixed(0)} m</div>
                    <span style="color:#bbb;">${fmtVent(spd)} · ${dg.toFixed(0)}°</span>
                `;

                const wr = wrap.getBoundingClientRect();
                const pMark = ptLocal(nPunt.u, nPunt.v);
                const twPx = 130, thPx = 34;
                let tx = pMark.x + 12, ty = pMark.y - thPx - 8;
                if (tx + twPx > wTotal) tx = pMark.x - twPx - 12;
                if (tx < 2) tx = 2;
                if (ty < 2) ty = pMark.y + 12;
                if (ty + thPx > hTotal) ty = hTotal - thPx - 2;

                tooltip.style.left = tx + 'px';
                tooltip.style.top = ty + 'px';
                tooltip.style.display = 'block';
                return;
            }

            tooltip.style.display = 'none';
        };

        canvas._skewtMouseLeave = function () {
            tooltip.style.display = 'none';
            if (currentMouseY !== null || alcadaHoverActual !== null) {
                currentMouseY = null; alcadaHoverActual = null;
                redrawWithLine(null);
            }
        };

        // ── clic sobre el Skew-T fixa la pressió manual ────────────────
        // Només actua si l'origen de parcel·la ja és "Manual". Agafa la
        // pressió EXACTA (interpolada) sota el cursor —no el nivell de
        // dada més proper— i l'aplica a l'input + recàlcul immediat.
        canvas._skewtClick = function (e) {
            if (origenParcelaActual !== 'manual') return;

            const r = canvas.getBoundingClientRect();
            const mx = e.clientX - r.left, my = e.clientY - r.top;

            // Només dins la zona del Skew-T (no del hodògraf) i dins
            // l'àrea útil del gràfic (marges inclosos amb el mateix
            // marge de tolerància que fa servir el tooltip de hover).
            if (mx < padLeft - 8 || mx > w - padRight + 8 || my < padTop || my > h - padBot) return;

            const pClic = pPerY(my, h, padTop, padBot);
            if (!esFinit(pClic) || pClic < 100 || pClic > 1050) return;

            const pArrodonit = Math.round(pClic);
            pressioManualActual = pArrodonit;
            localStorage.setItem('skewt_pressio_manual', pressioManualActual);
            const input = document.getElementById('skewtInputPressio');
            if (input) input.value = pArrodonit;

            recalcularAmbNouOrigen();
        };

        canvas.addEventListener('mousemove', canvas._skewtMouseMove);
        canvas.addEventListener('mouseleave', canvas._skewtMouseLeave);
        canvas.addEventListener('click', canvas._skewtClick);
    }
    window.dibuixarSkewtCanvas = dibuixarSkewtCanvas;
    window.dibuixarHodografCanvas = function () {
        if (window.dibuixarSkewtCanvas) window.dibuixarSkewtCanvas();
    };

    // ─── GRAELLA DE FONS ─────────────────────────────────────────────────
    function dibuixarGraella(ctx, w, h, padLeft, padRight, padTop, padBot, T, proj) {
        ctx.save();
        ctx.beginPath();
        ctx.rect(padLeft, padTop, w - padLeft - padRight, h - padTop - padBot);
        ctx.clip();

        const isobares = [1000, 900, 850, 800, 700, 600, 500, 400, 300, 250, 200, 150, 100];
        isobares.forEach(p => {
            const y = proj.y(p);
            ctx.strokeStyle = [1000, 850, 700, 500, 300].includes(p) ? T.gridForta : T.isobara;
            ctx.lineWidth = [1000, 850, 700, 500, 300].includes(p) ? 1 : 0.6;
            ctx.beginPath();
            ctx.moveTo(padLeft, y);
            ctx.lineTo(w - padRight, y);
            ctx.stroke();
        });

        ctx.strokeStyle = T.isoterma;
        ctx.lineWidth = 0.7;
        for (let tC = -100; tC <= 50; tC += 10) {
            ctx.beginPath();
            let started = false;
            for (let p = P_BOT; p >= P_TOP; p -= 10) {
                const x = proj.x(tC, p);
                const y = proj.y(p);
                if (x < padLeft - 60 || x > w - padRight + 60) { started = false; continue; }
                if (!started) { ctx.moveTo(x, y); started = true; } else { ctx.lineTo(x, y); }
            }
            ctx.stroke();
        }

        ctx.strokeStyle = T.hodograf3_6 || '#3090ff';
        ctx.lineWidth = 1.3;
        ctx.setLineDash([4, 3]);
        ctx.beginPath();
        let started0 = false;
        for (let p = P_BOT; p >= P_TOP; p -= 10) {
            const x = proj.x(0, p), y = proj.y(p);
            if (!started0) { ctx.moveTo(x, y); started0 = true; } else { ctx.lineTo(x, y); }
        }
        ctx.stroke();
        ctx.setLineDash([]);

        ctx.strokeStyle = T.adiabaticaSeca;
        ctx.lineWidth = 0.6;
        const RD_CP = 287.05 / 1004.6;
        for (let tPot = -30; tPot <= 200; tPot += 10) {
            ctx.beginPath();
            let started2 = false;
            for (let p = P_BOT; p >= P_TOP; p -= 15) {
                const tK = (tPot + 273.15) * Math.pow(p / 1000, RD_CP);
                const tC = tK - 273.15;
                const x = proj.x(tC, p), y = proj.y(p);
                if (x < padLeft - 100 || x > w - padRight + 100) { started2 = false; continue; }
                if (!started2) { ctx.moveTo(x, y); started2 = true; } else { ctx.lineTo(x, y); }
            }
            ctx.stroke();
        }

        ctx.strokeStyle = T.adiabaticaHumida;
        ctx.lineWidth = 0.6;
        const E = window.SkewtEngine;
        for (let tStart = -20; tStart <= 32; tStart += 4) {
            ctx.beginPath();
            let started3 = false;
            let p = 1000, t = tStart;
            for (; p >= P_TOP; p -= 15) {
                if (p < 1000) {
                    const gamma = E.gradientHumit(t, p + 7.5);
                    t = t - gamma * 15;
                }
                const x = proj.x(t, p), y = proj.y(p);
                if (x < padLeft - 100 || x > w - padRight + 100) { started3 = false; continue; }
                if (!started3) { ctx.moveTo(x, y); started3 = true; } else { ctx.lineTo(x, y); }
            }
            ctx.stroke();
        }

        ctx.strokeStyle = T.mescla;
        ctx.lineWidth = 0.5;
        ctx.setLineDash([2, 4]);
        [1, 2, 4, 6, 8, 10, 12, 16, 20, 24, 32].forEach(wg => {
            ctx.beginPath();
            let started4 = false;
            for (let p = P_BOT; p >= 400; p -= 20) {
                const wKg = wg / 1000;
                const e = (wKg * p) / (0.6219707 + wKg);
                const tC = (243.5 * Math.log(e / 6.112)) / (17.67 - Math.log(e / 6.112));
                const x = proj.x(tC, p), y = proj.y(p);
                if (x < padLeft - 40 || x > w - padRight + 40) { started4 = false; continue; }
                if (!started4) { ctx.moveTo(x, y); started4 = true; } else { ctx.lineTo(x, y); }
            }
            ctx.stroke();
        });
        ctx.setLineDash([]);

        ctx.restore();

        ctx.strokeStyle = T.gridForta;
        ctx.lineWidth = 1;
        ctx.strokeRect(padLeft, padTop, w - padLeft - padRight, h - padTop - padBot);
    }

    // ─── TERRENY ─────────────────────────────────────────────────────────
    function dibuixarTerreny(ctx, T, proj, w, padRight) {
        const perfil = perfilActual;
        if (!perfil || !perfil.p || perfil.p.length === 0) return;

        const pSurface = perfil.p[0];
        if (pSurface >= P_BOT) return;

        ctx.fillStyle = 'rgba(34, 139, 34, 0.3)';
        ctx.beginPath();

        const ySurface = proj.y(pSurface);
        const yBottom = proj.y(P_BOT);

        ctx.moveTo(42, ySurface);
        ctx.lineTo(42, yBottom);
        ctx.lineTo(w - padRight, yBottom);
        ctx.lineTo(w - padRight, ySurface);

        ctx.closePath();
        ctx.fill();

        ctx.strokeStyle = '#228B22';
        ctx.lineWidth = 2;
        ctx.setLineDash([5, 3]);
        ctx.beginPath();
        ctx.moveTo(42, ySurface);
        ctx.lineTo(w - padRight, ySurface);
        ctx.stroke();
        ctx.setLineDash([]);

        ctx.fillStyle = '#228B22';
        ctx.font = 'bold 11px Arial';
        ctx.textAlign = 'right';
        const elevation = perfil.z[0];
        ctx.fillText(`${elevation.toFixed(0)}m`, w - padRight - 10, ySurface - 5);
    }

    // ─── LÍNIES D'ESTAT ──────────────────────────────────────────────────
    function dibuixarLiniesEstat(ctx, w, h, padLeft, padRight, padTop, padBot, T, proj) {
        const perfil = perfilActual, idx = indexsActual;
        if (!perfil) return;

// ─── PARCEL·LA (línia de l'aire que puja) ─────────────────────────────
if (idx && idx.tParcela) {
    ctx.strokeStyle = T.parcela;  
    ctx.lineWidth = 1.5;
    ctx.setLineDash([2, 3]);      
    ctx.beginPath();
    let started = false;
    for (let i = 0; i < perfil.p.length; i++) {
        const tp = idx.tParcela[i];
        if (tp === null) continue;
        const x = proj.x(tp, perfil.p[i]), y = proj.y(perfil.p[i]);
        if (!started) { ctx.moveTo(x, y); started = true; } else { ctx.lineTo(x, y); }
    }
    ctx.stroke();
    ctx.setLineDash([]);         
}

        // Mixed-Layer (sempre visible com a referència, en taronja)
        const E = window.SkewtEngine;
        if (E && E.perfilMixedLayer && origenParcelaActual !== 'ml') {
            const ml = E.perfilMixedLayer(perfil, 100);
            if (ml && ml.valors) {
                ctx.strokeStyle = T.parcelaML || '#ff8c00';
                ctx.lineWidth = 1.2;
                ctx.setLineDash([6, 3]);
                ctx.beginPath();
                let startedML = false;
                for (let i = 0; i < perfil.p.length; i++) {
                    const tp = ml.valors[i];
                    if (tp === null) continue;
                    const x = proj.x(tp, perfil.p[i]), y = proj.y(perfil.p[i]);
                    if (!startedML) { ctx.moveTo(x, y); startedML = true; }
                    else { ctx.lineTo(x, y); }
                }
                ctx.stroke();
                ctx.setLineDash([]);
            }
        } else if (E && E.perfilMixedLayer && origenParcelaActual === 'ml') {
            // Si l'origen ja és ML, la línia taronja és la principal
            // (ja dibuixada com a T.parcela). No cal duplicar.
        }

        // Bulb humit
        if (E && E.perfilBulbHumit) {
            const tw = E.perfilBulbHumit(perfil);
            if (tw) {
                ctx.strokeStyle = '#40e0d0';
                ctx.lineWidth = 1.2;
                ctx.setLineDash([2, 2]);
                ctx.beginPath();
                let startedTw = false;
                for (let i = 0; i < perfil.p.length; i++) {
                    const twv = tw[i];
                    if (twv === null || !esFinit(twv)) continue;
                    const x = proj.x(twv, perfil.p[i]), y = proj.y(perfil.p[i]);
                    if (!startedTw) { ctx.moveTo(x, y); startedTw = true; }
                    else { ctx.lineTo(x, y); }
                }
                ctx.stroke();
                ctx.setLineDash([]);
            }
        }

        // Temperatura de rosada
        ctx.strokeStyle = T.rosadaBlava || '#3090ff';
        ctx.lineWidth = 2.2;
        ctx.beginPath();
        perfil.p.forEach((p, i) => {
            const x = proj.x(perfil.td[i], p), y = proj.y(p);
            if (i === 0) ctx.moveTo(x, y); else ctx.lineTo(x, y);
        });
        ctx.stroke();

        // Temperatura ambient
        ctx.strokeStyle = T.temperatura;
        ctx.lineWidth = 2.2;
        ctx.beginPath();
        perfil.p.forEach((p, i) => {
            const x = proj.x(perfil.t[i], p), y = proj.y(p);
            if (i === 0) ctx.moveTo(x, y); else ctx.lineTo(x, y);
        });
        ctx.stroke();
    }

    // ─── ÀREES CAPE / CIN ────────────────────────────────────────────────
    function dibuixarAreesCapeCin(ctx, T, proj) {
        const perfil = perfilActual, idx = indexsActual;
        if (!perfil || !idx || !idx.tParcela) return;

        function areaEntre(pIni, pFi, color) {
            const pStart = Math.min(pIni, perfil.p[0]);
            const pEnd = Math.max(pFi, 100);

            const puntsParcela = [];
            const puntsAmbient = [];
            for (let i = 0; i < perfil.p.length; i++) {
                const p = perfil.p[i];
                if (p > pStart || p < pEnd) continue;
                const tp = idx.tParcela[i];
                if (tp === null || !esFinit(tp)) continue;
                puntsParcela.push({ x: proj.x(tp, p), y: proj.y(p) });
                puntsAmbient.push({ x: proj.x(perfil.t[i], p), y: proj.y(p) });
            }
            if (puntsParcela.length < 2) return;

            ctx.fillStyle = color;
            ctx.beginPath();
            puntsParcela.forEach((pt, i) => {
                if (i === 0) ctx.moveTo(pt.x, pt.y); else ctx.lineTo(pt.x, pt.y);
            });
            for (let i = puntsAmbient.length - 1; i >= 0; i--) {
                ctx.lineTo(puntsAmbient[i].x, puntsAmbient[i].y);
            }
            ctx.closePath();
            ctx.fill();
        }

        if (idx.lfc_p && idx.el_p) {
            areaEntre(idx.lfc_p, idx.el_p, T.capeArea);
        }
        if (idx.lfc_p) {
            areaEntre(perfil.p[0], idx.lfc_p, T.cinArea);
        }
    }

    // ─── ETIQUETES DE NIVELLS CLAU ───────────────────────────────────────
    function dibuixarNivellsClau(ctx, w, padRight, T, proj) {
        const idx = indexsActual, perfil = perfilActual;
        if (!idx || !perfil) return;
        ctx.font = '10px Arial';
        ctx.textAlign = 'left';

        function marca(pHpa, text, color) {
            if (!pHpa) return;
            const y = proj.y(pHpa);
            ctx.strokeStyle = color;
            ctx.lineWidth = 1;
            ctx.setLineDash([3, 2]);
            ctx.beginPath();
            ctx.moveTo(0, y); ctx.lineTo(w, y);
            ctx.stroke();
            ctx.setLineDash([]);
            ctx.fillStyle = color;
            ctx.fillText(text, w - padRight - 74, y - 2);
        }

        marca(idx.lcl_p, 'LCL ' + idx.lcl_p.toFixed(0), '#40c0ff');
        marca(idx.lfc_p, 'LFC ' + (idx.lfc_p ? idx.lfc_p.toFixed(0) : ''), '#ff9040');
        marca(idx.el_p, 'EL ' + (idx.el_p ? idx.el_p.toFixed(0) : ''), '#c060ff');

        for (let i = 1; i < perfil.p.length; i++) {
            if ((perfil.t[i - 1] >= 0) !== (perfil.t[i] >= 0)) {
                const frac = perfil.t[i - 1] / (perfil.t[i - 1] - perfil.t[i]);
                const pCross = perfil.p[i - 1] + frac * (perfil.p[i] - perfil.p[i - 1]);
                marca(pCross, '0°C ' + pCross.toFixed(0), '#3090ff');
                break;
            }
        }
    }

    // ─── BARBES DE VENT ──────────────────────────────────────────────────
    function dibuixarBarbesVent(ctx, w, padRight, T, proj) {
        const perfil = perfilActual;
        if (!perfil) return;
        const xBarb = w - padRight - 24;

        const mostrats = [];
        let lastP = Infinity;
        perfil.p.forEach((p, i) => {
            if (lastP - p >= 45 || i === 0) {
                mostrats.push(i);
                lastP = p;
            }
        });

        mostrats.forEach(i => {
            const p = perfil.p[i];
            const y = proj.y(p);
            const uKt = perfil.u[i] * 1.94384;
            const vKt = perfil.v[i] * 1.94384;
            dibuixarBarba(ctx, xBarb, y, uKt, vKt, T.vent);
        });
    }

    function dibuixarBarba(ctx, x, y, uKt, vKt, color) {
        const spd = Math.sqrt(uKt * uKt + vKt * vKt);
        if (spd < 1) {
            ctx.strokeStyle = color;
            ctx.lineWidth = 1;
            ctx.beginPath();
            ctx.arc(x, y, 3, 0, Math.PI * 2);
            ctx.stroke();
            return;
        }
        const drawAngle = Math.atan2(-uKt, -vKt);

        ctx.save();
        ctx.translate(x, y);
        ctx.rotate(drawAngle);
        ctx.strokeStyle = color;
        ctx.lineWidth = 1.3;

        const shaftLen = 22;
        ctx.beginPath();
        ctx.moveTo(0, 0);
        ctx.lineTo(0, -shaftLen);
        ctx.stroke();

        let restant = spd;
        let pos = -shaftLen;
        const pasBarbaLlarga = 10;
        const pasBarbaCurta = 5;
        const pasTriangle = 50;

        while (restant >= pasTriangle) {
            ctx.beginPath();
            ctx.moveTo(0, pos);
            ctx.lineTo(8, pos + 4);
            ctx.lineTo(0, pos + 8);
            ctx.closePath();
            ctx.fillStyle = color;
            ctx.fill();
            pos += 8;
            restant -= pasTriangle;
        }
        while (restant >= pasBarbaLlarga) {
            ctx.beginPath();
            ctx.moveTo(0, pos);
            ctx.lineTo(9, pos - 3);
            ctx.stroke();
            pos += 4;
            restant -= pasBarbaLlarga;
        }
        if (restant >= pasBarbaCurta) {
            ctx.beginPath();
            ctx.moveTo(0, pos);
            ctx.lineTo(5, pos - 1.5);
            ctx.stroke();
        }
        ctx.restore();
    }

    // ─── ETIQUETES D'EIXOS ──────────────────────────────────────────────
    function dibuixarEtiquetesEix(ctx, w, h, padLeft, padRight, padTop, padBot, T, proj) {
        ctx.fillStyle = T.text;
        ctx.font = '10px Arial';
        ctx.textAlign = 'right';
        [1000, 900, 850, 700, 600, 500, 400, 300, 250, 200, 150, 100].forEach(p => {
            const y = proj.y(p);
            ctx.fillText(String(p), padLeft - 4, y + 3);
        });
        ctx.textAlign = 'center';
        ctx.fillStyle = T.textDim;
        ctx.font = '9px Arial';
        for (let tC = -60; tC <= 70; tC += 10) {
            const x = proj.x(tC, P_BOT);
            ctx.fillText(tC + '°', x, h - padBot + 14);
        }
    }

    function ventInterpolatAAlcada(z) {
        if (!ventActual || !ventActual.niv || ventActual.niv.length < 2) return null;
        const E = window.SkewtEngine;
        if (E && E.ventAAlcada) return E.ventAAlcada(ventActual.niv, z);
        const niv = ventActual.niv;
        for (let i = 0; i < niv.length - 1; i++) {
            const a = niv[i], b = niv[i + 1];
            if (z >= a.z && z <= b.z) {
                const f = (z - a.z) / ((b.z - a.z) || 1);
                return { u: a.u + f * (b.u - a.u), v: a.v + f * (b.v - a.v) };
            }
        }
        return null;
    }

    // ─── HODÒGRAF ────────────────────────────────────────────────────────
    function dibuixarHodografEnCanvas(ctx, T, offsetX, offsetY, ample, alt, alcadaHoverOverride) {
        if (!ventActual) return null;
        const alcadaHover = (alcadaHoverOverride !== undefined) ? alcadaHoverOverride : alcadaHoverActual;

        ctx.save();
        ctx.beginPath();
        ctx.rect(offsetX, offsetY, ample, alt);
        ctx.clip();
        ctx.translate(offsetX, offsetY);

        const w = ample, h = alt;

        const padTitol = 20, padLlegenda = 46;
        const cx = w / 2;
        const cy = padTitol + (h - padTitol - padLlegenda) / 2;
        const radiDisponible = Math.min((w - 30) / 2, (h - padTitol - padLlegenda) / 2 - 6);

        const niv = ventActual.niv;
        const factor = unitatVent === 'kt' ? 1.94384 : (unitatVent === 'kmh' ? 3.6 : 1);

        let maxSpd = 10;
        niv.forEach(n => {
            const s = Math.sqrt(n.u * n.u + n.v * n.v) * factor;
            if (s > maxSpd) maxSpd = s;
        });
        maxSpd = Math.ceil(maxSpd / 10) * 10 + 10;
        const pxPerUnit = radiDisponible / maxSpd;

        const pasAnell = maxSpd > 80 ? 20 : 10;
        for (let rv = pasAnell; rv <= maxSpd; rv += pasAnell) {
            const esForta = (rv % (pasAnell * 2) === 0);
            ctx.strokeStyle = esForta ? (T.hodografRingForta || T.gridForta) : T.hodografRing;
            ctx.lineWidth = esForta ? 1.1 : 0.6;
            ctx.beginPath();
            ctx.arc(cx, cy, rv * pxPerUnit, 0, Math.PI * 2);
            ctx.stroke();
        }

        ctx.font = '9px Arial';
        ctx.textAlign = 'left';
        for (let rv = pasAnell * 2; rv <= maxSpd; rv += pasAnell * 2) {
            const ly = cy - rv * pxPerUnit;
            const label = String(rv);
            const tw2 = ctx.measureText(label).width;
            ctx.fillStyle = T.fons;
            ctx.fillRect(cx + 2, ly - 8, tw2 + 5, 11);
            ctx.fillStyle = T.textDim;
            ctx.fillText(label, cx + 4, ly + 1);
        }

        ctx.strokeStyle = T.gridForta;
        ctx.lineWidth = 0.8;
        ctx.beginPath();
        ctx.moveTo(cx - maxSpd * pxPerUnit - 6, cy);
        ctx.lineTo(cx + maxSpd * pxPerUnit + 6, cy);
        ctx.moveTo(cx, cy - maxSpd * pxPerUnit - 6);
        ctx.lineTo(cx, cy + maxSpd * pxPerUnit + 6);
        ctx.stroke();

        ctx.fillStyle = T.textDim;
        ctx.font = 'bold 10px Arial';
        ctx.textAlign = 'center';
        ctx.fillText('N', cx, cy - maxSpd * pxPerUnit - 10);
        ctx.fillText('S', cx, cy + maxSpd * pxPerUnit + 18);
        ctx.textAlign = 'left';
        ctx.fillText('E', cx + maxSpd * pxPerUnit + 8, cy + 4);
        ctx.textAlign = 'right';
        ctx.fillText('W', cx - maxSpd * pxPerUnit - 8, cy + 4);
        ctx.textAlign = 'left';

        function pt(u, v) {
            return { x: cx + u * factor * pxPerUnit, y: cy - v * factor * pxPerUnit };
        }

        const trams = [
            { min: 0, max: 1000, color: T.hodograf0_1 },
            { min: 1000, max: 3000, color: T.hodograf1_3 },
            { min: 3000, max: 6000, color: T.hodograf3_6 },
            { min: 6000, max: 9000, color: T.hodograf6_9 },
            { min: 9000, max: 12000, color: T.hodograf9_12 },
            { min: 12000, max: 15000, color: T.hodograf12_15 }
        ];

        ctx.lineCap = 'round';
        ctx.lineJoin = 'round';

        ctx.save();
        ctx.shadowColor = 'rgba(0,0,0,0.4)';
        ctx.shadowBlur = 4;

        trams.forEach(tram => {
            const puntsTram = [];
            for (let i = 0; i < niv.length; i++) {
                if (niv[i].z >= tram.min && niv[i].z <= tram.max) {
                    if (puntsTram.length === 0 && i > 0) {
                        puntsTram.push(niv[i - 1]);
                    }
                    puntsTram.push(niv[i]);
                }
            }
            if (puntsTram.length < 2) return;

            ctx.strokeStyle = tram.color;
            ctx.lineWidth = 2.6;
            ctx.beginPath();

            const p0 = pt(puntsTram[0].u, puntsTram[0].v);
            ctx.moveTo(p0.x, p0.y);

            for (let i = 1; i < puntsTram.length; i++) {
                const n0 = puntsTram[i - 1];
                const n1 = puntsTram[i];
                const spd0 = Math.sqrt(n0.u * n0.u + n0.v * n0.v) * factor;
                const spd1 = Math.sqrt(n1.u * n1.u + n1.v * n1.v) * factor;
                const spdMitjana = (spd0 + spd1) / 2;
                const nPassos = Math.max(1, Math.floor(spdMitjana / 5));
                for (let k = 1; k <= nPassos; k++) {
                    const frac = k / nPassos;
                    const u = n0.u + (n1.u - n0.u) * frac;
                    const v = n0.v + (n1.v - n0.v) * frac;
                    const p = pt(u, v);
                    ctx.lineTo(p.x, p.y);
                }
            }
            ctx.stroke();
        });
        ctx.restore();

        niv.forEach(n => {
            const p = pt(n.u, n.v);
            ctx.beginPath();
            ctx.arc(p.x, p.y, 1.6, 0, Math.PI * 2);
            ctx.fillStyle = '#ffffff';
            ctx.globalAlpha = 0.55;
            ctx.fill();
            ctx.globalAlpha = 1;
        });

        if (ventActual.bunkers) {
            if (ventActual.bunkers.right) {
                const pr = pt(ventActual.bunkers.right.u, ventActual.bunkers.right.v);
                ctx.fillStyle = T.bunkersR;
                ctx.beginPath();
                ctx.arc(pr.x, pr.y, 4.5, 0, Math.PI * 2);
                ctx.fill();
                ctx.strokeStyle = T.fons;
                ctx.lineWidth = 1.2;
                ctx.stroke();
                ctx.fillStyle = T.text;
                ctx.font = 'bold 9px Arial';
                ctx.textAlign = 'left';
                ctx.fillText('RM', pr.x + 7, pr.y + 3);
            }
            if (ventActual.bunkers.left) {
                const pl = pt(ventActual.bunkers.left.u, ventActual.bunkers.left.v);
                ctx.fillStyle = T.bunkersL;
                ctx.beginPath();
                ctx.arc(pl.x, pl.y, 4.5, 0, Math.PI * 2);
                ctx.fill();
                ctx.strokeStyle = T.fons;
                ctx.lineWidth = 1.2;
                ctx.stroke();
                ctx.fillStyle = T.text;
                ctx.font = 'bold 9px Arial';
                ctx.textAlign = 'left';
                ctx.fillText('LM', pl.x + 7, pl.y + 3);
            }
        }

        if (alcadaHover !== null && alcadaHover !== undefined) {
            const vInterp = ventInterpolatAAlcada(alcadaHover);
            if (vInterp) {
                const pm = pt(vInterp.u, vInterp.v);
                ctx.beginPath();
                ctx.arc(pm.x, pm.y, 7, 0, Math.PI * 2);
                ctx.strokeStyle = '#ffffff';
                ctx.lineWidth = 2.2;
                ctx.stroke();
                ctx.beginPath();
                ctx.arc(pm.x, pm.y, 2.4, 0, Math.PI * 2);
                ctx.fillStyle = '#ffffff';
                ctx.fill();
            }
        }

        ctx.font = '8.5px Arial';
        const tramsLlegenda = [
            { label: '0-1 km', color: T.hodograf0_1 },
            { label: '1-3 km', color: T.hodograf1_3 },
            { label: '3-6 km', color: T.hodograf3_6 },
            { label: '6-9 km', color: T.hodograf6_9 },
            { label: '9-12 km', color: T.hodograf9_12 },
            { label: '12-15 km', color: T.hodograf12_15 }
        ];
        const colX = [10, w / 2 + 4];
        const filaAlt = 13;
        const llegendaYBase = h - padLlegenda + 12;
        tramsLlegenda.forEach((tram, i) => {
            const col = i % 2, fila = Math.floor(i / 2);
            const x = colX[col];
            const y = llegendaYBase + fila * filaAlt;
            ctx.fillStyle = tram.color;
            ctx.fillRect(x, y - 5, 12, 5);
            ctx.fillStyle = T.textDim;
            ctx.textAlign = 'left';
            ctx.fillText(tram.label, x + 16, y);
        });

        ctx.fillStyle = T.textDim;
        ctx.font = 'bold 10px Arial';
        ctx.textAlign = 'left';
        ctx.fillText('Hodògraf  en valors de  (' + etiquetaUnitat(unitatVent) + ')', 10, 15);

        ctx.restore();

        return { cx: cx + offsetX, cy: cy + offsetY, pxPerUnit };
    }

    // ─── TAULA D'ÍNDEXS ──────────────────────────────────────────────────

    function fmt(v, dec, unitat) {
        if (v === null || v === undefined || isNaN(v)) return '—';
        return v.toFixed(dec !== undefined ? dec : 0) + (unitat || '');
    }

    function colorPerCape(cape) {
        if (cape === null || cape === undefined) return null;
        if (cape < 300) return '#7f9bb3';
        if (cape < 1000) return '#e0d040';
        if (cape < 2500) return '#e08030';
        return '#e03030';
    }

    function convertirVent(mps) {
        const factor = unitatVent === 'kt' ? 1.94384 : (unitatVent === 'kmh' ? 3.6 : 1);
        return mps * factor;
    }

    function convertirVentAKt(mps) { return mps * 1.94384; }

    function construirTaulaIndexsSkewt() {
        const side = document.getElementById('skewtSideCol');
        if (!side || !indexsActual) return;
        const idx = indexsActual;
        const vent = ventActual;
        const uv = etiquetaUnitat(unitatVent);

        function fila(label, valor, color) {
            return `<tr><td class="lbl">${label}</td><td class="val"${color ? ' style="color:' + color + '"' : ''}>${valor}</td></tr>`;
        }

        let html = '';

        // Origen de la parcel·la
        html += `<div class="skewt-table-section"><div class="skewt-table-title">Origen de la parcel·la</div><table class="skewt-table">`;
        const infoOrigen = idx.origenParcelaInfo || {};
        html += fila('Tipus', ETIQUETES_ORIGEN[idx.origenParcela || 'sfc'] || '—');
        html += fila('Pressió', fmt(infoOrigen.p, 0, ' hPa'));
        html += fila('T inicial', fmt(infoOrigen.t, 1, '°C'));
        html += fila('Td inicial', fmt(infoOrigen.td, 1, '°C'));
        html += `</table></div>`;

        html += `<div class="skewt-table-section"><div class="skewt-table-title">Termodinàmica</div><table class="skewt-table">`;
        html += fila('CAPE', fmt(idx.cape, 0, ' J/kg'), colorPerCape(idx.cape));
        html += fila('CIN', fmt(idx.cin, 0, ' J/kg'), idx.cin === 0 ? '#7f9bb3' : (idx.cin < -100 ? '#4090ff' : null));
        html += fila('LI', fmt(idx.li, 1), idx.li !== null && idx.li < -4 ? '#e03030' : null);
        html += fila('Showalter', fmt(idx.showalter, 1));
        html += fila('K-Index', fmt(idx.kIndex, 0));
        html += fila('Totals Totals', fmt(idx.totalsTotals, 0));
        html += fila('PWAT', fmt(idx.pwat, 1, ' mm'));
        html += `</table></div>`;

        html += `<div class="skewt-table-section"><div class="skewt-table-title">Nivells</div><table class="skewt-table">`;
        html += fila('LCL', fmt(idx.lcl_p, 0, ' hPa') + ' · ' + fmt(idx.lcl_z, 0, ' m'));
        html += fila('LFC', idx.lfc_p ? fmt(idx.lfc_p, 0, ' hPa') + ' · ' + fmt(idx.lfc_z, 0, ' m') : '—');
        html += fila('EL', idx.el_p ? fmt(idx.el_p, 0, ' hPa') + ' · ' + fmt(idx.el_z, 0, ' m') : '—');
        html += `</table></div>`;

        if (vent) {
            html += `<div class="skewt-table-section"><div class="skewt-table-title">Cisallament (Bulk Shear)</div><table class="skewt-table">`;
            html += fila('0–1 km', fmt(convertirVent(vent.shear01), 0, ' ' + uv));
            html += fila('0–3 km', fmt(convertirVent(vent.shear03), 0, ' ' + uv));
            html += fila('0–6 km', fmt(convertirVent(vent.shear06), 0, ' ' + uv), vent.shear06 > 20 ? '#e08030' : null);
            html += fila('0–8 km', fmt(convertirVent(vent.shear08), 0, ' ' + uv));
            html += `</table></div>`;

            html += `<div class="skewt-table-section"><div class="skewt-table-title">Helicitat (SRH)</div><table class="skewt-table">`;
            html += fila('0–1 km', fmt(vent.srh01, 0, ' m²/s²'), Math.abs(vent.srh01) > 150 ? '#e03030' : null);
            html += fila('0–3 km', fmt(vent.srh03, 0, ' m²/s²'), Math.abs(vent.srh03) > 250 ? '#e03030' : null);
            html += `</table></div>`;

            html += `<div class="skewt-table-section"><div class="skewt-table-title">Moviment de la tempesta</div><table class="skewt-table">`;
            const rmSpd = Math.sqrt(vent.bunkers.right.u ** 2 + vent.bunkers.right.v ** 2);
            const lmSpd = Math.sqrt(vent.bunkers.left.u ** 2 + vent.bunkers.left.v ** 2);
            html += fila('Right-mover (RM)', fmt(convertirVent(rmSpd), 0, ' ' + uv));
            html += fila('Left-mover (LM)', fmt(convertirVent(lmSpd), 0, ' ' + uv));
            html += `</table></div>`;

            const cape = idx.cape || 0;
            const srh01 = vent.srh01 || 0;
            const shear06Kt = convertirVentAKt(vent.shear06);
            const shearTerm = Math.max(0, Math.min(shear06Kt / 20, 1.5));
            const lclTerm = idx.lcl_z !== null ? Math.max(0, Math.min((2000 - idx.lcl_z) / 1000, 1)) : 0;
            const cinTerm = idx.cin !== null ? Math.max(0, Math.min((idx.cin + 200) / 150, 1)) : 1;
            const stpAprox = (cape / 1500) * (srh01 / 150) * shearTerm * lclTerm * cinTerm;
            const ehi01 = (cape * srh01) / 160000;

            html += `<div class="skewt-table-section"><div class="skewt-table-title">Índexs compostos (aprox.)</div><table class="skewt-table">`;
            html += fila('STP (aprox.)', fmt(Math.max(0, stpAprox), 2));
            html += fila('EHI 0–1km', fmt(ehi01, 2));
            html += `</table></div>`;
        }

        const dataAvui = new Date().toLocaleDateString('ca-ES', {
            day: 'numeric',
            month: 'long',
            year: 'numeric'
        });

        html += `<div class="skewt-table-section" style="opacity:0.5;">
            <div class="skewt-table-title">Avís legal</div>
            <div style="font-size:9px; color:${tema().textDim}; line-height:1.4;">
                Dades amb finalitat informativa. No ens fem responsables 
                de l'ús que es faci d'aquesta informació.
                <br><br>
                Avís declarat el ${dataAvui}.
            </div>
        </div>`;

        side.innerHTML = html;
    }
    window.construirTaulaIndexsSkewt = construirTaulaIndexsSkewt;

    

})();