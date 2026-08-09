// ═══════════════════════════════════════════════════════════════════════
//  lightning.js — LLAMPS EN DIRECTE (Blitzortung, via backend propi)
//  Ja NO es connecta per WebSocket des del navegador. En comptes d'aixo,
//  llegeix periòdicament radar/rayos_metadata.js, generat pel daemon
//  Python (generar_rayos.py) que escolta Blitzortung de forma contínua
//  al servidor. Així els llamps es veuen sempre actualitzats encara que
//  ningú tingui la pestanya oberta.
//
//  Cada llamp dura 5 min a pantalla i es va esvaint fins desapareixer.
//  Pensat per conviure amb radar.js: mateix estil de panes, bottombar, etc.
// ═══════════════════════════════════════════════════════════════════════

(function() {
    'use strict';

    // ═══ CONFIG ═══
    const RAYOS_URL = 'radar/rayos_metadata.js';
    const FETCH_INTERVAL_MS = 15 * 1000;         // el backend escriu cada 15s
    const STRIKE_LIFESPAN_MS = 5 * 60 * 1000;    // cada llamp dura 5 min a pantalla
    const RING_MAX_RADIUS_M = 50000;             // ona expansiva fins a 50km
    const RING_DURATION_MS = 1400;

    let actiu = false;
    let map = null;
    let fetchTimer = null;

    // Llamps a pantalla: Map de clau_unica -> { marker, ring, lat, lon, ts, fadeInterval }
    let strikes = new Map();

    let soundOn = true;
    let audioCtx = null;
    const VOLUM_TRO = 0.12;             // volum base (abans 0.22, massa fort)
    const MAX_SONS_PER_CICLE = 3;       // no sonen mes de N llamps de cop
    const ESPAI_ENTRE_SONS_MS = 260;    // separacio minima entre truenos en cua
    let sonsEnAquestCicle = 0;
    let ultimSoTs = 0;

    console.log('[Llamps] Modul carregat (mode fetch)');

    // ═══════════════════════════════════════════════════════════════════
    //  SO DE TRO — dues fases: crack + rumble
    // ═══════════════════════════════════════════════════════════════════
    function getAudioCtx() {
        if (!audioCtx) {
            const ACtx = window.AudioContext || window.webkitAudioContext;
            audioCtx = new ACtx();
        }
        return audioCtx;
    }

    function playThunder(volume) {
        if (!soundOn) return;
        try {
            const ctx = getAudioCtx();
            if (ctx.state === 'suspended') ctx.resume();
            const now = ctx.currentTime;

            const bufSize1 = ctx.sampleRate * 0.3;
            const buf1 = ctx.createBuffer(1, bufSize1, ctx.sampleRate);
            const d1 = buf1.getChannelData(0);
            for (let i = 0; i < bufSize1; i++) d1[i] = Math.random() * 2 - 1;
            const noise1 = ctx.createBufferSource();
            noise1.buffer = buf1;
            const bandpass = ctx.createBiquadFilter();
            bandpass.type = 'bandpass';
            bandpass.frequency.setValueAtTime(2500, now);
            bandpass.Q.value = 0.7;
            const gain1 = ctx.createGain();
            gain1.gain.setValueAtTime(0.0001, now);
            gain1.gain.exponentialRampToValueAtTime(volume * 0.9, now + 0.005);
            gain1.gain.exponentialRampToValueAtTime(0.0001, now + 0.2);
            noise1.connect(bandpass); bandpass.connect(gain1); gain1.connect(ctx.destination);
            noise1.start(now); noise1.stop(now + 0.2);

            const bufSize2 = ctx.sampleRate * 1.8;
            const buf2 = ctx.createBuffer(1, bufSize2, ctx.sampleRate);
            const d2 = buf2.getChannelData(0);
            for (let j = 0; j < bufSize2; j++) d2[j] = Math.random() * 2 - 1;
            const noise2 = ctx.createBufferSource();
            noise2.buffer = buf2;
            const lowpass = ctx.createBiquadFilter();
            lowpass.type = 'lowpass';
            lowpass.frequency.setValueAtTime(400, now + 0.1);
            lowpass.frequency.exponentialRampToValueAtTime(50, now + 1.8);
            const gain2 = ctx.createGain();
            gain2.gain.setValueAtTime(0.0001, now + 0.1);
            gain2.gain.exponentialRampToValueAtTime(volume * 0.5, now + 0.25);
            gain2.gain.exponentialRampToValueAtTime(0.0001, now + 1.8);
            noise2.connect(lowpass); lowpass.connect(gain2); gain2.connect(ctx.destination);
            noise2.start(now + 0.1); noise2.stop(now + 1.8);
        } catch (e) {}
    }

    function desbloquejarAudio() {
        try { getAudioCtx(); } catch(e) {}
    }

    // Evita que arribar 10-15 llamps de cop (un sol cicle de fetch amb
    // tempesta activa) soni com un mur de truenos simultanis, que
    // espanta molt. Nomes sonen els primers N del cicle, espaiats.
    function programarSo() {
        if (sonsEnAquestCicle >= MAX_SONS_PER_CICLE) return;
        sonsEnAquestCicle++;

        const ara = Date.now();
        const espera = Math.max(0, ultimSoTs + ESPAI_ENTRE_SONS_MS - ara);
        ultimSoTs = ara + espera;

        setTimeout(function() {
            playThunder(VOLUM_TRO);
        }, espera);
    }

    // ═══════════════════════════════════════════════════════════════════
    //  AFEGIR LLAMP — icona + ona expansiva + fade de 5 min + so
    //  ts_restant_ms: quant li queda de vida (si venia ja "vell" del
    //  backend, comença directament amb menys temps de fade).
    // ═══════════════════════════════════════════════════════════════════
    function afegirLlamp(clau, lat, lon, ts, ambSo) {
        if (ambSo) programarSo();

        const html =
            '<div class="lg-strike-wrap">' +
              '<svg class="lg-strike-svg" width="26" height="26" viewBox="0 0 24 24">' +
                '<path d="M13 2 L4 14 L11 14 L10 22 L20 9 L13 9 Z" fill="#fdfdfd" stroke="#070707" stroke-width="0.6"/>' +
              '</svg>' +
            '</div>';

        const icon = L.divIcon({
            className: 'lg-strike-icon',
            html: html,
            iconSize: [26, 26],
            iconAnchor: [13, 13]
        });

        const marker = L.marker([lat, lon], {
            icon: icon, interactive: false, opacity: 1, pane: 'paneLlamps'
        }).addTo(map);

        const ring = L.circle([lat, lon], {
            radius: 1000, color: '#020202', weight: 2,
            fillColor: '#69fc07', fillOpacity: 0.12, opacity: 0.7,
            interactive: false, pane: 'paneLlamps'
        }).addTo(map);

        // L'ona expansiva només te sentit si el llamp és fresc (< uns
        // segons), no la mostrem si ja arriba amb minuts de vida.
        const edatMs = Date.now() - ts;
        if (edatMs < 20000) {
            const ringStart = Date.now();
            const ringInterval = setInterval(function() {
                const t = (Date.now() - ringStart) / RING_DURATION_MS;
                if (t >= 1) {
                    clearInterval(ringInterval);
                    map.removeLayer(ring);
                    return;
                }
                ring.setRadius(1000 + t * (RING_MAX_RADIUS_M - 1000));
                ring.setStyle({ opacity: 0.7 * (1 - t), fillOpacity: 0.12 * (1 - t) });
            }, 40);
        } else {
            map.removeLayer(ring);
        }

        const el = marker.getElement();
        const svgEl = el ? el.querySelector('.lg-strike-svg') : null;

        // El fade sempre dura STRIKE_LIFESPAN_MS complets DES DEL MOMENT
        // QUE ES PINTA, no des del ts real del llamp (que pot arribar amb
        // fins a 10 min d'antiguitat des del backend). Aixi cap llamp
        // "neix mort" i sempre es veu el cicle sencer de 5 min.
        const visualStart = Date.now();
        const entry = { marker: marker, lat: lat, lon: lon, ts: ts, fadeInterval: null };

        entry.fadeInterval = setInterval(function() {
            const elapsed = Date.now() - visualStart;
            const remaining = 1 - (elapsed / STRIKE_LIFESPAN_MS);
            if (remaining <= 0) {
                clearInterval(entry.fadeInterval);
                map.removeLayer(marker);
                strikes.delete(clau);
                return;
            }
            if (svgEl) svgEl.style.opacity = Math.max(remaining * 0.75, 0.12);
        }, 1000);

        strikes.set(clau, entry);
    }

    function netejarTot() {
        strikes.forEach(function(s) {
            if (s.fadeInterval) clearInterval(s.fadeInterval);
            map.removeLayer(s.marker);
        });
        strikes.clear();
    }

    // ═══════════════════════════════════════════════════════════════════
    //  FETCH PERIÒDIC — llegeix radar/rayos_metadata.js
    // ═══════════════════════════════════════════════════════════════════
    function setStatusLlamps(text) {
        const el = document.getElementById('lgStatusText');
        if (el) el.textContent = text;
    }

    function claUnica(r) {
        return r.lat + '_' + r.lon + '_' + r.ts;
    }

    async function carregarRayos(primeraCarrega) {
        if (!actiu) return;
        try {
            const r = await fetch(RAYOS_URL + '?t=' + Date.now(), {
                cache: 'no-store',
                headers: { 'Cache-Control': 'no-cache, no-store', 'Pragma': 'no-cache' }
            });
            if (!r.ok) {
                console.log('[Llamps] Error HTTP', r.status, RAYOS_URL);
                setStatusLlamps('Error de connexio');
                return;
            }
            const txt = await r.text();
            const m = txt.match(/window\.rayosData\s*=\s*(\{[\s\S]*\});?\s*$/);
            if (!m) {
                console.log('[Llamps] Format inesperat de resposta. Primers 200 car.:', txt.slice(0, 200));
                return;
            }
            const payload = JSON.parse(m[1]);
            const rayos = payload.rayos || [];
            console.log('[Llamps] Fetch OK ·', rayos.length, 'rayos · updated:', payload.updated, '· ara:', new Date().toISOString());

            sonsEnAquestCicle = 0; // nou cicle, tornem a permetre fins a MAX_SONS_PER_CICLE

            rayos.forEach(function(r) {
                const clau = claUnica(r);
                if (!strikes.has(clau)) {
                    // So només per llamps que apareixen DESPRES de la
                    // primera carrega (si no, sonaria tot de cop en obrir).
                    afegirLlamp(clau, r.lat, r.lon, r.ts, !primeraCarrega);
                }
            });

            // NOTA: NO esborrem aqui els llamps que ja no surten al
            // fetch actual. El backend pot re-generar el 'ts' amb
            // lleugeres variacions entre escriptures i la clau deixaria
            // de coincidir, fent que un llamp real "morís" als pocs
            // segons en comptes dels 5 min complets. Cada llamp es neteja
            // nomes pel seu propi fadeInterval (veure afegirLlamp).

            setStatusLlamps('Llamps en directe · ' + rayos.length + ' actius');
        } catch (e) {
            console.log('[Llamps] Error carregant:', e.message);
            setStatusLlamps('Error de connexio');
        }
    }

    function iniciarFetchPeriodic() {
        carregarRayos(true); // primera carrega: sense so
        if (fetchTimer) clearInterval(fetchTimer);
        fetchTimer = setInterval(function() { carregarRayos(false); }, FETCH_INTERVAL_MS);
    }

    function aturarFetchPeriodic() {
        if (fetchTimer) { clearInterval(fetchTimer); fetchTimer = null; }
    }

    // ═══════════════════════════════════════════════════════════════════
    //  ON / OFF
    // ═══════════════════════════════════════════════════════════════════
    function activar() {
        actiu = true;
        setStatusLlamps('Connectant...');
        iniciarFetchPeriodic();
        actualitzarBotons();
        // ═══ MOSTRAR ATRIBUCIÓ CC BY-SA 4.0 ═══
        const attr = document.getElementById('lightningAttr');
        if (attr) attr.classList.add('visible');
    }

    function desactivar() {
        actiu = false;
        aturarFetchPeriodic();
        netejarTot();
        setStatusLlamps('Llamps desactivats');
        actualitzarBotons();
        // ═══ AMAGAR ATRIBUCIÓ ═══
        const attr = document.getElementById('lightningAttr');
        if (attr) attr.classList.remove('visible');
    }

    function toggleActiu() {
        desbloquejarAudio();
        if (actiu) {
            desactivar();
        } else {
            activar();
        }
    }

    function toggleSo() {
        soundOn = !soundOn;
        const btn = document.getElementById('btnLlampsSo');
        if (btn) btn.textContent = soundOn ? '🔊' : '🔇';
    }

    function actualitzarBotons() {
        const btnMode = document.getElementById('btnLlamps');
        const btnSo = document.getElementById('btnLlampsSo');
        if (btnMode) {
            btnMode.textContent = actiu ? 'Llamps: ON' : 'Llamps: OFF';
            btnMode.classList.toggle('active', actiu);
        }
        if (btnSo) {
            btnSo.style.display = actiu ? '' : 'none';
        }
    }

    // ═══════════════════════════════════════════════════════════════════
    //  ESTILS + PANE + UI
    // ═══════════════════════════════════════════════════════════════════
    function injectarEstils() {
        if (document.getElementById('lightning-styles')) return;
        const style = document.createElement('style');
        style.id = 'lightning-styles';
        style.textContent = `
            .lg-strike-icon { pointer-events: none; }
            .lg-strike-wrap { width: 26px; height: 26px; }
            .lg-strike-svg {
                opacity: 0.8;
                filter: drop-shadow(0 0 4px rgba(201,184,255,0.55)) drop-shadow(0 0 1px rgba(255,255,255,0.4));
                transition: opacity 4s linear;
            }
            #lgStatus {
                position: absolute; top: 14px; right: 14px; z-index: 900;
                background: rgba(13,17,23,0.85); color: #c9d1d9;
                padding: 5px 12px; border-radius: 8px;
                font-family: sans-serif; font-size: 12px;
                border: 1px solid rgba(255,255,255,0.1);
                display: none;
            }
        `;
        document.head.appendChild(style);
    }

    function crearIndicadorEstat() {
        if (document.getElementById('lgStatus')) return;
        const el = document.createElement('div');
        el.id = 'lgStatus';
        el.innerHTML = '<span id="lgStatusText">Llamps desactivats</span>';

        // ═══ ATRIBUCIÓ OBLIGATÒRIA CC BY-SA 4.0 ═══
        const attr = document.createElement('div');
        attr.id = 'lgAttribution';
        attr.style.cssText = 'margin-top:6px;font-size:9px;color:#8b949e;line-height:1.3;';
        attr.innerHTML = 'Dades: <a href="https://www.blitzortung.org" target="_blank" style="color:#8b949e;">Blitzortung.org</a> i col·laboradors · <a href="https://creativecommons.org/licenses/by-sa/4.0/" target="_blank" style="color:#8b949e;">CC BY-SA 4.0</a>';
        el.appendChild(attr);

        const mapEl = document.getElementById('map');
        (mapEl ? mapEl.parentElement : document.body).style.position = 'relative';
        (mapEl || document.body).appendChild(el);
    }

    function initUI() {
        const bb = document.getElementById('bottombar');
        if (!bb || document.getElementById('btnLlamps')) return;

        const btnMode = document.createElement('button');
        btnMode.id = 'btnLlamps';
        btnMode.className = 'primary';
        btnMode.title = 'Activa/desactiva els llamps (cada un dura 5 min a pantalla)';
        btnMode.textContent = 'Llamps: OFF';
        btnMode.addEventListener('click', toggleActiu);
        bb.appendChild(btnMode);

        const btnSo = document.createElement('button');
        btnSo.id = 'btnLlampsSo';
        btnSo.title = 'So de tro';
        btnSo.textContent = '🔊';
        btnSo.style.display = 'none';
        btnSo.addEventListener('click', function(e) {
            e.stopPropagation();
            toggleSo();
        });
        bb.appendChild(btnSo);
    }

    function iniciar() {
        map = window.map; // el mapa Leaflet ja creat per radar.js
        if (!map) {
            console.log('[Llamps] No trobo window.map, esperant...');
            setTimeout(iniciar, 500);
            return;
        }
        map.createPane('paneLlamps');
        map.getPane('paneLlamps').style.zIndex = 620;
        map.getPane('paneLlamps').style.pointerEvents = 'auto';

        injectarEstils();
        crearIndicadorEstat();
        initUI();

        console.log('[Llamps] Inicialitzat (mode fetch)');
    }

    // S'inicia quan l'app ja esta autoritzada (mateix event que radar.js)
    document.addEventListener('auth:autoritzat', iniciar);

    window.addEventListener('beforeunload', function() {
        aturarFetchPeriodic();
    });

})();   