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

    const ESTACIONES_URL = 'https://radar-data.tempestes.cat/radar/estaciones_meta.js';
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
                display:flex; flex-direction:column; align-items:center;
                font-family:sans-serif; pointer-events:auto; cursor:pointer;
            }
            .estacio-marker .eb-caixa {
                background:rgba(13,17,23,0.92); border:1px solid rgba(255,255,255,0.18);
                border-radius:8px; padding:3px 7px; text-align:center;
                box-shadow:0 1px 4px rgba(0,0,0,0.4); white-space:nowrap;
            }
            .estacio-marker .eb-temp {
                font-size:13px; font-weight:700; color:#ffffff; line-height:1.15;
            }
            .estacio-marker .eb-rosada {
                font-size:10px; font-weight:500; color:#7fd4ff; line-height:1.15;
            }
            .estacio-marker .eb-punta {
                width:0; height:0; margin:0 auto;
                border-left:5px solid transparent; border-right:5px solid transparent;
                border-top:6px solid rgba(13,17,23,0.92);
            }
            .popup-estacio {
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

    // Color de temperatura: fred blau -> calid vermell, simple i llegible
    function colorTemp(t) {
        if (t === null || t === undefined || isNaN(t)) return '#8b949e';
        if (t <= 0)  return '#4aa3ff';
        if (t <= 10) return '#7fd4ff';
        if (t <= 18) return '#8fe08f';
        if (t <= 25) return '#ffd35c';
        if (t <= 32) return '#ff9a3c';
        return '#ff4d4d';
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

    function crearIconaEstacio(estacio) {
        const ta = estacio.ta;
        const tpr = estacio.tpr;
        const c = colorTemp(ta);

        const taTxt = (ta !== null && ta !== undefined) ? Math.round(ta) : '—';
        const tprTxt = (tpr !== null && tpr !== undefined) ? Math.round(tpr) : '—';

        // Punt exacte sobre la coordenada + etiqueta "temp/rosada" al costat
        const html =
            '<div class="estacio-marker">' +
                '<div class="eb-punt" style="background:' + c + ';"></div>' +
                '<div class="eb-etiqueta" style="color:' + c + ';">' + taTxt + '/' + tprTxt + '</div>' +
            '</div>';

        return L.divIcon({
            className: '',
            html: html,
            iconSize: [46, 20],
            iconAnchor: [4, 10] // el punt queda exactament sobre lat/lon
        });
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
            renderitzarEstacions(payload.estaciones || []);
            console.log('[Estacions] Carregades', (payload.estaciones || []).length, '· actualitzat', payload.updated);
        } catch(e) {
            console.log('[Estacions] Error carregant:', e.message);
        }
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
        btn.textContent = '🌡️ Estacions';
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
            carregarEstacions();
            setInterval(carregarEstacions, REFRESH_MS);
        } else {
            setTimeout(esperarMapaIIniciar, 300);
        }
    }

    document.addEventListener('auth:autoritzat', esperarMapaIIniciar);

})();