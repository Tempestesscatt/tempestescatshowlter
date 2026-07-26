// ═══════════════════════════════════════════════════════════════════════
//  lightning.js — CAPA DE LLAMPS EN TEMPS REAL (Blitzortung.org)
//  100% client-side: cada navegador obre el seu propi websocket,
//  no passa per cap backend ni R2 ni el teu servidor. Cost: zero.
//
//  AVIS: el protocol de Blitzortung NO es una API oficial documentada,
//  es un protocol descobert per la comunitat que el seu propi mapa web
//  utilitza. Pot canviar sense avis. Aquest modul esta dissenyat per
//  fallar en silenci (sense trencar el radar) si aixo passa.
// ═══════════════════════════════════════════════════════════════════════

(function() {
    'use strict';

    // ═══ CONFIG ═══
    // Servidors coneguts del clúster de Blitzortung (rotem si un falla).
    const SERVERS = [
        'wss://ws1.blitzortung.org:3000',
        'wss://ws5.blitzortung.org:3000',
        'wss://ws6.blitzortung.org:3000',
        'wss://ws7.blitzortung.org:3000'
    ];

    // Mateixa regio que fas servir per retallar el radar (REGIO al
    // script Python). Ajusta si cal.
    const REGIO = { lat_min: 38.5, lat_max: 45.0, lon_min: -2.0, lon_max: 5.0 };

    const VIDA_MAX_MS = 20 * 60 * 1000;      // quant temps es queda un llamp al mapa
    const RECONNECT_DELAY_MS = 5000;          // espera abans de reintentar servidor
    const MAX_RECONNECT_DELAY_MS = 60000;     // topall de backoff exponencial

    console.log('[Lightning] Iniciant...');

    // ═══════════════════════════════════════════════════════════════════
    //  DECODIFICACIO DEL PROTOCOL (LZW-like propi de Blitzortung)
    // ═══════════════════════════════════════════════════════════════════
    function decodeBlitzortung(str) {
        const d = Array.from(str);
        if (!d.length) return '';
        let dict = {};
        let c = d[0];
        let f = c;
        let out = [c];
        let dictSize = 256;
        for (let i = 1; i < d.length; i++) {
            const code = d[i].charCodeAt(0);
            let entry;
            if (dictSize > code) {
                entry = d[i];
            } else if (dict[code]) {
                entry = dict[code];
            } else {
                entry = f + c;
            }
            out.push(entry);
            c = entry[0];
            dict[dictSize] = f + c;
            dictSize += 1;
            f = entry;
        }
        return out.join('');
    }

    function parseStrike(rawMsg) {
        let json;
        try {
            const decoded = decodeBlitzortung(rawMsg);
            json = JSON.parse(decoded);
        } catch (e) {
            return null;
        }
        if (json == null || typeof json.lat !== 'number' || typeof json.lon !== 'number') {
            return null;
        }
        return {
            lat: json.lat,
            lon: json.lon,
            // 'time' ve en nanosegons des d'epoch al protocol de Blitzortung
            ts: json.time ? Math.floor(json.time / 1e6) : Date.now(),
            // 'mds' inclou dades de les estacions que l'han detectat;
            // fem servir la seva longitud com a proxy grosser de "força"
            estacions: Array.isArray(json.sig) ? json.sig.length : 0
        };
    }

    function dinsRegio(lat, lon) {
        return lat >= REGIO.lat_min && lat <= REGIO.lat_max &&
               lon >= REGIO.lon_min && lon <= REGIO.lon_max;
    }

    // ═══════════════════════════════════════════════════════════════════
    //  CAPA LEAFLET DE LLAMPS
    // ═══════════════════════════════════════════════════════════════════
    const LightningLayer = L.Layer.extend({
        initialize: function() {
            this._canvas = null;
            this._strikes = []; // { lat, lon, ts, estacions }
        },
        onAdd: function(map) {
            this._map = map;
            const c = document.createElement('canvas');
            c.style.cssText = 'position:absolute;top:0;left:0;pointer-events:none;';
            map.getPane('paneLightning').appendChild(c);
            this._canvas = c;
            map.on('moveend zoomend', this._render, this);
            this._render();
        },
        onRemove: function(map) {
            map.getPane('paneLightning').removeChild(this._canvas);
            map.off('moveend zoomend', this._render, this);
        },
        addStrike: function(strike) {
            this._strikes.push(strike);
            this._render();
        },
        purgarAntics: function() {
            const ara = Date.now();
            const abans = this._strikes.length;
            this._strikes = this._strikes.filter(s => (ara - s.ts) < VIDA_MAX_MS);
            if (this._strikes.length !== abans) this._render();
        },
        comptador: function() {
            return this._strikes.length;
        },
        _colorPerEdat: function(edatMs) {
            // Groc/blanc = molt recent -> taronja -> vermell fosc = vell
            const t = Math.min(edatMs / VIDA_MAX_MS, 1);
            if (t < 0.15) return { r: 255, g: 255, b: 220 };
            if (t < 0.4)  return { r: 255, g: 210, b: 60  };
            if (t < 0.7)  return { r: 255, g: 130, b: 30  };
            return { r: 200, g: 40, b: 30 };
        },
        _render: function() {
            if (!this._map) return;
            const size = this._map.getSize();
            const c = this._canvas;
            c.width = size.x;
            c.height = size.y;
            const ctx = c.getContext('2d');
            ctx.clearRect(0, 0, size.x, size.y);
            L.DomUtil.setPosition(c, this._map.containerPointToLayerPoint([0, 0]));

            const ara = Date.now();
            for (let i = 0; i < this._strikes.length; i++) {
                const s = this._strikes[i];
                const edatMs = ara - s.ts;
                if (edatMs > VIDA_MAX_MS) continue;
                const p = this._map.latLngToContainerPoint([s.lat, s.lon]);
                if (p.x < -20 || p.x > size.x + 20 || p.y < -20 || p.y > size.y + 20) continue;

                const col = this._colorPerEdat(edatMs);
                const t = edatMs / VIDA_MAX_MS;
                const alpha = Math.max(0.15, 1 - t);
                const radi = edatMs < 3000 ? 9 : 4; // "destell" gran nomes al principi

                ctx.beginPath();
                ctx.arc(p.x, p.y, radi, 0, Math.PI * 2);
                ctx.fillStyle = 'rgba(' + col.r + ',' + col.g + ',' + col.b + ',' + alpha + ')';
                ctx.fill();

                if (edatMs < 3000) {
                    ctx.beginPath();
                    ctx.arc(p.x, p.y, radi + 6, 0, Math.PI * 2);
                    ctx.strokeStyle = 'rgba(' + col.r + ',' + col.g + ',' + col.b + ',' + (alpha * 0.5) + ')';
                    ctx.lineWidth = 2;
                    ctx.stroke();
                }
            }
        }
    });

    // ═══════════════════════════════════════════════════════════════════
    //  CONNEXIO WEBSOCKET AMB RECONNEXIO AUTOMATICA
    // ═══════════════════════════════════════════════════════════════════
    let ws = null;
    let serverIdx = 0;
    let reconnectDelay = RECONNECT_DELAY_MS;
    let lightningLayer = null;
    let purgaTimer = null;
    let connectat = false;

    function setStatusLlamps(text, actiu) {
        const el = document.getElementById('lightningStatus');
        if (el) {
            el.textContent = text;
            el.classList.toggle('offline', !actiu);
        }
    }

    function connectar() {
        const url = SERVERS[serverIdx % SERVERS.length];
        console.log('[Lightning] Connectant a', url);

        try {
            ws = new WebSocket(url);
        } catch (e) {
            console.warn('[Lightning] No es pot obrir websocket:', e);
            programarReconnexio();
            return;
        }

        ws.onopen = function() {
            console.log('[Lightning] Connectat');
            connectat = true;
            reconnectDelay = RECONNECT_DELAY_MS; // reset del backoff
            setStatusLlamps('Llamps en directe', true);
            // Missatge de subscripcio que espera el servidor de Blitzortung
            ws.send(JSON.stringify({ a: 111 }));
        };

        ws.onmessage = function(ev) {
            const strike = parseStrike(ev.data);
            if (!strike) return;
            if (!dinsRegio(strike.lat, strike.lon)) return;
            if (lightningLayer) lightningLayer.addStrike(strike);
        };

        ws.onerror = function(e) {
            console.warn('[Lightning] Error de websocket:', e);
        };

        ws.onclose = function() {
            connectat = false;
            setStatusLlamps('Reconnectant...', false);
            serverIdx += 1; // prova el seguent servidor del clúster
            programarReconnexio();
        };
    }

    function programarReconnexio() {
        setTimeout(connectar, reconnectDelay);
        reconnectDelay = Math.min(reconnectDelay * 1.5, MAX_RECONNECT_DELAY_MS);
    }

    // ═══════════════════════════════════════════════════════════════════
    //  INICI — s'enganxa al mateix esdeveniment d'autoritzacio que radar.js
    // ═══════════════════════════════════════════════════════════════════
    let jaIniciat = false;

    function iniciar() {
        if (jaIniciat) return;
        jaIniciat = true;

        if (typeof L === 'undefined' || typeof map === 'undefined') {
            console.warn('[Lightning] Mapa Leaflet no trobat, s\'omet la capa de llamps');
            return;
        }
        if (typeof WebSocket === 'undefined') {
            console.warn('[Lightning] WebSocket no suportat en aquest navegador');
            return;
        }

        map.createPane('paneLightning');
        map.getPane('paneLightning').style.zIndex = 450; // per sobre del radar
        map.getPane('paneLightning').style.pointerEvents = 'none';

        lightningLayer = new LightningLayer();
        lightningLayer.addTo(map);

        purgaTimer = setInterval(function() {
            if (lightningLayer) lightningLayer.purgarAntics();
        }, 10000);

        connectar();
    }

    document.addEventListener('auth:autoritzat', iniciar);

    // Exposem un objecte minim per si vols consultar l'estat des de la consola
    window.LightningDebug = {
        comptador: function() { return lightningLayer ? lightningLayer.comptador() : 0; },
        connectat: function() { return connectat; }
    };

})();