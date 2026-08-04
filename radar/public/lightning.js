// ═══════════════════════════════════════════════════════════════════════
//  lightning.js — LLAMPS EN DIRECTE (Blitzortung)
//  Cada llamp dura 5 min a pantalla i es va esvaint fins desapareixer.
//  Pensat per conviure amb radar.js: mateix estil de panes, bottombar, etc.
// ═══════════════════════════════════════════════════════════════════════

(function() {
    'use strict';

    // ═══ CONFIG ═══
    const WS_URL = 'wss://ws1.blitzortung.org/';
    const STRIKE_LIFESPAN_MS = 5 * 60 * 1000;    // cada llamp dura 5 min
    const RING_MAX_RADIUS_M = 50000;             // ona expansiva fins a 50km
    const RING_DURATION_MS = 1400;
    const RECONNECT_BASE_MS = 2000;
    const RECONNECT_MAX_MS = 20000;

    // Zona de cobertura: Europa central (ampliada des del NE d'Espanya)
    const BOUNDS = { latMin: 38.5, latMax: 45.0, lonMin: -2.0, lonMax: 5.0 };

    let actiu = false;
    let map = null;
    let ws = null;
    let reconnectDelay = RECONNECT_BASE_MS;
    let reconnectTimer = null;

    // Llamps a pantalla: array de { marker, ring, lat, lon, ts, fadeInterval }
    let strikes = [];

    let soundOn = true;
    let audioCtx = null;

    console.log('[Llamps] Modul carregat');

    // ═══════════════════════════════════════════════════════════════════
    //  DECODIFICACIO LZW (format Blitzortung)
    // ═══════════════════════════════════════════════════════════════════
    function decode(raw) {
        const dict = {};
        const data = raw.split('');
        let currChar = data[0];
        let oldPhrase = currChar;
        const out = [currChar];
        let code = 256;
        let phrase;
        for (let i = 1; i < data.length; i++) {
            const currCode = data[i].charCodeAt(0);
            if (currCode < 256) {
                phrase = data[i];
            } else {
                phrase = dict[currCode] ? dict[currCode] : (oldPhrase + currChar);
            }
            out.push(phrase);
            currChar = phrase.charAt(0);
            dict[code] = oldPhrase + currChar;
            code++;
            oldPhrase = phrase;
        }
        return out.join('');
    }

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
            gain1.gain.exponentialRampToValueAtTime(volume * 1.3, now + 0.005);
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
            gain2.gain.exponentialRampToValueAtTime(volume * 0.8, now + 0.25);
            gain2.gain.exponentialRampToValueAtTime(0.0001, now + 1.8);
            noise2.connect(lowpass); lowpass.connect(gain2); gain2.connect(ctx.destination);
            noise2.start(now + 0.1); noise2.stop(now + 1.8);
        } catch (e) {}
    }

    function desbloquejarAudio() {
        try { getAudioCtx(); } catch(e) {}
    }

    // ═══════════════════════════════════════════════════════════════════
    //  AFEGIR LLAMP — icona + ona expansiva + fade de 5 min + so
    // ═══════════════════════════════════════════════════════════════════
    function afegirLlamp(lat, lon, ts) {
        playThunder(0.22);

        const html =
            '<div class="lg-strike-wrap">' +
              '<svg class="lg-strike-svg" width="26" height="26" viewBox="0 0 24 24">' +
                '<path d="M13 2 L4 14 L11 14 L10 22 L20 9 L13 9 Z" fill="#f3ecff" stroke="#c9b8ff" stroke-width="0.6"/>' +
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
            radius: 1000, color: '#c9b8ff', weight: 2,
            fillColor: '#c9b8ff', fillOpacity: 0.12, opacity: 0.7,
            interactive: false, pane: 'paneLlamps'
        }).addTo(map);

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

        const startTime = Date.now();
        const el = marker.getElement();
        const svgEl = el ? el.querySelector('.lg-strike-svg') : null;

        const entry = { marker: marker, ring: ring, lat: lat, lon: lon, ts: ts, fadeInterval: null };

        entry.fadeInterval = setInterval(function() {
            const elapsed = Date.now() - startTime;
            const remaining = 1 - (elapsed / STRIKE_LIFESPAN_MS);
            if (remaining <= 0) {
                clearInterval(entry.fadeInterval);
                map.removeLayer(marker);
                strikes = strikes.filter(function(s) { return s !== entry; });
                return;
            }
            if (svgEl) svgEl.style.opacity = Math.max(remaining * 0.75, 0.12);
        }, 1000);

        strikes.push(entry);
    }

    function netejarTot() {
        strikes.forEach(function(s) {
            if (s.fadeInterval) clearInterval(s.fadeInterval);
            map.removeLayer(s.marker);
            if (s.ring) map.removeLayer(s.ring);
        });
        strikes = [];
    }

    // ═══════════════════════════════════════════════════════════════════
    //  WEBSOCKET
    // ═══════════════════════════════════════════════════════════════════
    function dinsBounds(lat, lon) {
        return lat >= BOUNDS.latMin && lat <= BOUNDS.latMax &&
               lon >= BOUNDS.lonMin && lon <= BOUNDS.lonMax;
    }

    function setStatusLlamps(text) {
        const el = document.getElementById('lgStatusText');
        if (el) el.textContent = text;
    }

    function connectWs() {
        if (!actiu) return;
        setStatusLlamps('Connectant...');
        try {
            ws = new WebSocket(WS_URL);
        } catch (e) {
            scheduleReconnect();
            return;
        }

        ws.onopen = function() {
            setStatusLlamps('Llamps en directe');
            reconnectDelay = RECONNECT_BASE_MS;
            ws.send(JSON.stringify({ a: 111 }));
        };

        ws.onmessage = function(evt) {
            if (!actiu) return;
            try {
                const decoded = decode(evt.data);
                const obj = JSON.parse(decoded);
                if (typeof obj.lat !== 'number' || typeof obj.lon !== 'number') return;
                if (!dinsBounds(obj.lat, obj.lon)) return;
                afegirLlamp(obj.lat, obj.lon, obj.time);
            } catch (err) {}
        };

        ws.onclose = function() {
            if (!actiu) return;
            setStatusLlamps('Reconnectant...');
            scheduleReconnect();
        };

        ws.onerror = function() {
            setStatusLlamps('Error de connexio');
        };
    }

    function scheduleReconnect() {
        if (reconnectTimer) clearTimeout(reconnectTimer);
        reconnectTimer = setTimeout(function() {
            if (actiu) connectWs();
        }, reconnectDelay);
        reconnectDelay = Math.min(reconnectDelay * 1.5, RECONNECT_MAX_MS);
    }

    function disconnectWs() {
        if (reconnectTimer) { clearTimeout(reconnectTimer); reconnectTimer = null; }
        if (ws) {
            ws.onclose = null;
            ws.close();
            ws = null;
        }
    }

    // ═══════════════════════════════════════════════════════════════════
    //  ON / OFF
    // ═══════════════════════════════════════════════════════════════════
function activar() {
    actiu = true;
    reconnectDelay = RECONNECT_BASE_MS;
    connectWs();
    actualitzarBotons();
    // ═══ MOSTRAR ATRIBUCIÓ CC BY-SA 4.0 ═══
    const attr = document.getElementById('lightningAttr');
    if (attr) attr.classList.add('visible');
}

function desactivar() {
    actiu = false;
    disconnectWs();
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
        btnMode.title = 'Activa/desactiva els llamps en directe (cada un dura 5 min)';
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

        console.log('[Llamps] Inicialitzat');
    }

    // S'inicia quan l'app ja esta autoritzada (mateix event que radar.js)
    document.addEventListener('auth:autoritzat', iniciar);

    window.addEventListener('beforeunload', function() {
        disconnectWs();
    });

})();
