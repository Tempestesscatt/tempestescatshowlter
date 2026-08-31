// ═══════════════════════════════════════════════════════════════════════
//  radar.js — VISOR RADAR METEOROLÒGIC (NE ESPANYA)
//  CIRRUS (dBZ) / NIMBUS (mm) · Hora Madrid · Escala americana · Multi-paleta
//  + Ubicació en viu (seguiment) + Alerta de dBZ fort a prop
// ═══════════════════════════════════════════════════════════════════════

(function() {
    'use strict';

    // Dades servides des del bucket R2 (Cloudflare), no des del mateix
    // origen que la web. Actualitzat pel workflow de GitHub Actions
    // cada 10 min sense necessitat de re-deploy de la web.
    const BASE_PATH = 'https://radar-data.tempestes.cat/radar';
    const REFRESH_MS = 5 * 60 * 1000; // 5 min

    // ═══ PRODUCTES DISPONIBLES ═══
    // Cada producte te el seu propi fitxer de metadata (generat pel
    // script de Python amb el "filename_prefix" corresponent) i la
    // seva propia clau de valor dins de cada punt.
    const PRODUCTS = {
        cirrus: {
            label: 'CIRRUS (dBZ)',
            metadataFile: 'radar_metadata.js',
            valorKey: 'dbz',
            unitat: 'dBZ',
            nomCamp: 'Reflectivitat'
        },
        nimbus: {
            label: 'NIMBUS (mm)',
            metadataFile: 'radar_metadata_nimbus.js',
            valorKey: 'rain_mm',
            unitat: 'mm',
            nomCamp: 'Precipitació acumulada'
        }
    };
    const PRODUCT_STORAGE_KEY = 'radar_producte_seleccionat';
    let producteActual = 'cirrus';
    let VALOR_KEY = PRODUCTS[producteActual].valorKey;

    // ═══ CONFIG ALERTA DE PROXIMITAT ═══
    // Nomes te sentit amb Cirrus (dBZ). Amb Nimbus es desactiva.
    const ALERT_DBZ_THRESHOLD = 50;   // dBZ a partir del qual avisem
    const ALERT_RADIUS_KM = 5;        // radi de vigilància al voltant de l'usuari
    const ALERT_RECHECK_MS = 15000;   // cada quant es reavalua l'alerta
    const ALERT_COOLDOWN_MS = 60000;  // temps mínim entre avisos sonors repetits

    // Resolucio de rejilla per defecte (metres), nomes com a fallback
    // si algun frame no porta "resolution_m" (p.ex. dades antigues
    // generades abans d'aquest fix).
    const FALLBACK_RESOLUTION_M = 2000;

    console.log('[Radar] Iniciant...');

    // ═══ HORA MADRID ═══
    function horaMadrid(ts) {
        const any_ = ts.slice(0,4);
        const mes = ts.slice(5,7);
        const dia = ts.slice(8,10);
        const hh = ts.slice(11,13);
        const mm = ts.slice(13,15);
        const d = new Date(Date.UTC(any_, mes-1, dia, hh, mm, 0));
        const madrid = new Date(d.toLocaleString('en-US', {timeZone: 'Europe/Madrid'}));
        const h = String(madrid.getHours()).padStart(2,'0');
        const m = String(madrid.getMinutes()).padStart(2,'0');
        return h + ':' + m;
    }

    function dataMadrid(ts) {
        const any_ = ts.slice(0,4);
        const mes = ts.slice(5,7);
        const dia = ts.slice(8,10);
        const hh = ts.slice(11,13);
        const mm = ts.slice(13,15);
        const d = new Date(Date.UTC(any_, mes-1, dia, hh, mm, 0));
        const madrid = new Date(d.toLocaleString('en-US', {timeZone: 'Europe/Madrid'}));
        const dies = ['dg.','dl.','dt.','dc.','dj.','dv.','ds.'];
        return dies[madrid.getDay()] + ' ' +
               String(madrid.getDate()).padStart(2,'0') + '/' +
               String(madrid.getMonth()+1).padStart(2,'0') + '/' +
               madrid.getFullYear();
    }

    // ═══════════════════════════════════════════════════════════════════
    //  PALETES DE COLORS
    // ═══════════════════════════════════════════════════════════════════
    const PALETTES = {
        classica: {
            label: 'Clàssica dBZ',
            stops: [
                {v:-30, r:0,   g:0,   b:0,   a:0},
                {v:-25, r:80,  g:80,  b:80,  a:30},
                {v:-20, r:120, g:120, b:120, a:50},
                {v:-15, r:150, g:150, b:150, a:65},
                {v:-10, r:180, g:180, b:180, a:80},
                {v:-5,  r:200, g:200, b:200, a:100},
                {v:0,   r:0,   g:236, b:236, a:150},
                {v:5,   r:1,   g:160, b:246, a:200},
                {v:10,  r:0,   g:0,   b:246, a:210},
                {v:15,  r:0,   g:236, b:0,   a:220},
                {v:20,  r:0,   g:180, b:0,   a:220},
                {v:25,  r:0,   g:100, b:0,   a:220},
                {v:30,  r:255, g:200, b:0,   a:230},
                {v:35,  r:255, g:144, b:0,   a:230},
                {v:40,  r:255, g:0,   b:0,   a:240},
                {v:45,  r:192, g:0,   b:0,   a:240},
                {v:50,  r:120, g:0,   b:0,   a:240},
                {v:55,  r:255, g:0,   b:255, a:250},
                {v:60,  r:160, g:32,  b:240, a:250},
                {v:65,  r:80,  g:0,   b:130, a:255},
                {v:70,  r:200, g:200, b:200, a:255},
                {v:75,  r:255, g:255, b:255, a:255}
            ]
        },
        windy: {
            label: 'Estil nexard',
            stops: [
                {v:-30, r:0,   g:0,   b:0,   a:0},
                {v:-10, r:100, g:100, b:100, a:40},
                {v:0,   r:98,  g:222, b:255, a:120},
                {v:8,   r:65,  g:182, b:255, a:170},
                {v:16,  r:60,  g:130, b:250, a:200},
                {v:22,  r:60,  g:200, b:120, a:215},
                {v:28,  r:120, g:220, b:70,  a:220},
                {v:34,  r:230, g:220, b:60,  a:225},
                {v:40,  r:250, g:170, b:40,  a:235},
                {v:46,  r:245, g:100, b:40,  a:240},
                {v:52,  r:230, g:50,  b:40,  a:245},
                {v:58,  r:180, g:30,  b:90,  a:250},
                {v:64,  r:150, g:30,  b:170, a:255},
                {v:70,  r:230, g:200, b:250, a:255},
                {v:75,  r:255, g:255, b:255, a:255}
            ]
        },
        pastel: {
            label: 'Pastel suau',
            stops: [
                {v:-30, r:0,   g:0,   b:0,   a:0},
                {v:-10, r:150, g:150, b:150, a:35},
                {v:0,   r:174, g:222, b:230, a:110},
                {v:10,  r:141, g:197, b:224, a:160},
                {v:18,  r:150, g:214, b:170, a:190},
                {v:26,  r:200, g:224, b:140, a:205},
                {v:34,  r:245, g:210, b:120, a:220},
                {v:42,  r:240, g:150, b:110, a:230},
                {v:50,  r:225, g:110, b:120, a:240},
                {v:58,  r:200, g:120, b:190, a:245},
                {v:66,  r:170, g:130, b:220, a:250},
                {v:75,  r:235, g:225, b:245, a:255}
            ]
        },
        altcontrast: {
            label: 'Alt contrast',
            stops: [
                {v:-30, r:0,   g:0,   b:0,   a:0},
                {v:-5,  r:130, g:130, b:130, a:60},
                {v:0,   r:20,  g:200, b:235, a:190},
                {v:12,  r:10,  g:60,  b:230, a:220},
                {v:20,  r:15,  g:190, b:15,  a:230},
                {v:30,  r:255, g:225, b:0,   a:235},
                {v:38,  r:255, g:120, b:0,   a:240},
                {v:45,  r:230, g:0,   b:0,   a:245},
                {v:52,  r:130, g:0,   b:0,   a:248},
                {v:58,  r:255, g:0,   b:255, a:252},
                {v:65,  r:110, g:0,   b:180, a:255},
                {v:75,  r:255, g:255, b:255, a:255}
            ]
        },
        // Paleta oficial per Nimbus (mm acumulats), fixada pel client.
        // Es l'UNICA opcio disponible quan el producte actiu es Nimbus.
        pluja: {
            label: 'Pluja (mm)',
            stops: [
                {v:0,   r:0,   g:0,   b:0,   a:0},
                {v:0.1, r:200, g:230, b:255, a:120},
                {v:0.5, r:100, g:200, b:255, a:160},
                {v:1,   r:0,   g:150, b:255, a:190},
                {v:2,   r:0,   g:100, b:200, a:210},
                {v:5,   r:0,   g:200, b:0,   a:220},
                {v:10,  r:100, g:255, b:0,   a:225},
                {v:20,  r:255, g:255, b:0,   a:230},
                {v:30,  r:255, g:200, b:0,   a:235},
                {v:50,  r:255, g:100, b:0,   a:240},
                {v:75,  r:255, g:0,   b:0,   a:245},
                {v:100, r:200, g:0,   b:200, a:255}
            ]
        }
    };

    const PALETTE_STORAGE_KEY = 'radar_palette_seleccionada'; // clau antiga (migracio)
    function paletteStorageKeyPer(producte) {
        return 'radar_palette_seleccionada_' + producte;
    }
    let paletaActual = 'classica';

    // Quines paletes es poden triar per cada producte. Cirrus te
    // diverses opcions d'estil; Nimbus nomes te la paleta oficial de
    // pluja fixada pel client (una sola opcio, no editable).
    const PALETTES_PER_PRODUCTE = {
        cirrus: ['classica', 'windy', 'pastel', 'altcontrast'],
        nimbus: ['pluja'],
    };

    // Selecciona automaticament una paleta coherent amb el producte
    // actiu (a menys que l'usuari ja n'hagi triat una manualment per
    // aquest producte concret).
    function paletaPerDefecte(producte) {
        return producte === 'nimbus' ? 'pluja' : 'classica';
    }

    function getStops() {
        return (PALETTES[paletaActual] || PALETTES.classica).stops;
    }

    function getColor(v) {
        const STOPS = getStops();
        if (v === null || v === undefined || isNaN(v)) return STOPS[0];
        if (v <= STOPS[0].v) return STOPS[0];
        if (v >= STOPS[STOPS.length-1].v) return STOPS[STOPS.length-1];
        for (let i=0; i<STOPS.length-1; i++) {
            if (v>=STOPS[i].v && v<=STOPS[i+1].v) {
                const t = (v-STOPS[i].v)/(STOPS[i+1].v-STOPS[i].v);
                return {
                    r: Math.round(STOPS[i].r + (STOPS[i+1].r-STOPS[i].r)*t),
                    g: Math.round(STOPS[i].g + (STOPS[i+1].g-STOPS[i].g)*t),
                    b: Math.round(STOPS[i].b + (STOPS[i+1].b-STOPS[i].b)*t),
                    a: Math.round((STOPS[i].a||0) + ((STOPS[i+1].a||0)-(STOPS[i].a||0))*t)
                };
            }
        }
        return STOPS[0];
    }

    // ═══ MAPA ═══
const map = L.map('map', {
    preferCanvas: true,
    minZoom: 6,
    maxZoom: 14
}).setView([41.0, 1.5], 8);
window.map = map;

    L.tileLayer('https://server.arcgisonline.com/ArcGIS/rest/services/World_Street_Map/MapServer/tile/{z}/{y}/{x}', {
        attribution: 'Esri, OpenStreetMap',
        maxZoom: 19
    }).addTo(map);

    map.createPane('paneRadar');
    map.getPane('paneRadar').style.zIndex = 400;
    map.getPane('paneRadar').style.pointerEvents = 'none';

    map.createPane('paneGeojson');
    map.getPane('paneGeojson').style.zIndex = 500;
    map.getPane('paneGeojson').style.pointerEvents = 'none';

    map.createPane('paneUser');
    map.getPane('paneUser').style.zIndex = 650;

    // ═══════════════════════════════════════════════════════════════════
    //  CAPA CANVAS
    // ═══════════════════════════════════════════════════════════════════
    const RadarLayer = L.Layer.extend({
        initialize: function() {
            this._canvas = null;
            this._frame = null;
            this._offscreen = null;
            this._dirty = true;
            this._opacity = 0.85;
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
        setFrame: function(frame) {
            this._frame = frame;
            this._dirty = true;
            this._render();
        },
        repaint: function() {
            this._dirty = true;
            this._render();
        },
        getFrame: function() {
            return this._frame;
        },
        _drawOffscreen: function() {
            if (!this._frame || !this._frame.points || !this._frame.points.length) return;
            const pts = this._frame.points;
            const b = this._frame.bounds;
            const W = 1024;
            const lonR = b.east - b.west || 1;
            const latR = b.north - b.south || 1;
            const H = Math.round(W * latR / lonR);
            if (!this._offscreen || this._offscreen.width !== W || this._offscreen.height !== H) {
                this._offscreen = document.createElement('canvas');
                this._offscreen.width = W;
                this._offscreen.height = H;
            }
            const ctx = this._offscreen.getContext('2d');
            ctx.clearRect(0, 0, W, H);

            // ═══ MIDA DE PUNT BASADA EN LA RESOLUCIO REAL DE DADES ═══
            const resolutionM = this._frame.resolution_m || FALLBACK_RESOLUTION_M;
            const centerLatRad = ((b.north + b.south) / 2) * Math.PI / 180;
            const metersPerDegLon = 111320 * Math.cos(centerLatRad);
            const metersPerDegLat = 111320;
            const pxPerDegLon = W / lonR;
            const pxPerDegLat = H / latR;
            const pxSizeX = (resolutionM / metersPerDegLon) * pxPerDegLon;
            const pxSizeY = (resolutionM / metersPerDegLat) * pxPerDegLat;
            const pSize = Math.max(1, Math.ceil(Math.max(pxSizeX, pxSizeY)) + 1);

            for (let i=0; i<pts.length; i++) {
                const p = pts[i];
                const x = (p.lon - b.west) / lonR * W;
                const y = (b.north - p.lat) / latR * H;
                if (x<0 || x>=W || y<0 || y>=H) continue;
                const c = getColor(p[VALOR_KEY]);
                if (!c.a) continue;
                ctx.fillStyle = 'rgba('+c.r+','+c.g+','+c.b+','+(c.a/255)+')';
                ctx.fillRect(Math.floor(x), Math.floor(y), pSize, pSize);
            }
            this._dirty = false;
        },
        _render: function() {
            if (!this._frame || !this._map) return;
            if (this._dirty) this._drawOffscreen();
            if (!this._offscreen) return;
            const size = this._map.getSize();
            const c = this._canvas;
            c.width = size.x;
            c.height = size.y;
            const ctx = c.getContext('2d');
            ctx.clearRect(0, 0, size.x, size.y);
            ctx.imageSmoothingEnabled = true;
            L.DomUtil.setPosition(c, this._map.containerPointToLayerPoint([0,0]));
            const b = this._frame.bounds;
            const tl = this._map.latLngToContainerPoint([b.north, b.west]);
            const br = this._map.latLngToContainerPoint([b.south, b.east]);
            const w = br.x - tl.x;
            const h = br.y - tl.y;
            if (w>0 && h>0) {
                ctx.globalAlpha = this._opacity;
                ctx.drawImage(this._offscreen, tl.x, tl.y, w, h);
                ctx.globalAlpha = 1.0;
            }
        }
    });

    const radarLayer = new RadarLayer();
    radarLayer.addTo(map);

    // ═══ GEOJSON DE COMARQUES ═══
    let capaComarques = null;

    async function carregarComarques() {
        const rutes = [
            'comarques.geojson',
            'geo/comarques.geojson',
            'radar/comarques.geojson',
            'girona_comarques.geojson',
            'dades/girona_comarques.geojson',
            'radar/girona_comarques.geojson'
        ];

        for (const ruta of rutes) {
            try {
                const resp = await fetch(ruta);
                if (resp.ok) {
                    const contentType = resp.headers.get('content-type');
                    if (contentType && contentType.includes('text/html')) continue;
                    const text = await resp.text();
                    if (text.startsWith('<!DOCTYPE') || text.startsWith('<html')) continue;
                    try {
                        const geojson = JSON.parse(text);
                        processarGeoJSON(geojson);
                        console.log('[GeoJSON] Carregat:', ruta);
                        return;
                    } catch(e) {}
                }
            } catch(e) {}
        }
        console.log('[GeoJSON] Sense comarques');
    }

    function processarGeoJSON(geojson) {
        if (capaComarques) map.removeLayer(capaComarques);
        capaComarques = L.geoJSON(geojson, {
            pane: 'paneGeojson',
            style: function() {
                return { color: '#000000', weight: 1, opacity: 0.7, fill: false, interactive: false };
            },
            onEachFeature: function(feature, layer) {
                if (feature.properties && feature.properties.nom) {
                    layer.bindTooltip(feature.properties.nom, { permanent: false, direction: 'center', opacity: 0.9 });
                }
            }
        });
        capaComarques.addTo(map);
    }

    // ═══ CARREGA DE DADES ═══
    let radarFrames = [];
    let currentFrame = 0;
    let animTimer = null;
    let animPlaying = false;

    function updateUI() {
        const fi = document.getElementById('frameIndicator');
        if (fi) fi.textContent = (currentFrame+1)+' / '+radarFrames.length;

        const td = document.getElementById('timeDisplay');
        const dd = document.getElementById('dateDisplay');
        if (td && radarFrames[currentFrame]) {
            const ts = radarFrames[currentFrame].timestamp;
            td.textContent = horaMadrid(ts);
            if (dd) dd.textContent = dataMadrid(ts);
        }
    }

    function setStatus(text, offline) {
        const st = document.getElementById('statusText');
        const dot = document.getElementById('statusDot');
        if (st) st.textContent = text;
        if (dot) dot.classList.toggle('offline', !!offline);
    }

// ═══ CARREGA DE DADES (ÚLTIMS 5 FRAMES) ═══
async function carregarDades(silencios) {
    const ld = document.getElementById('loading');
    if (ld && !silencios) ld.classList.remove('hidden');

    const producteDeLaPeticio = producteActual;
    const metadataFile = PRODUCTS[producteDeLaPeticio].metadataFile;

    try {
        // 1. Carregar metadata
        const mr = await fetch(BASE_PATH+'/'+metadataFile+'?t='+Date.now(), {cache:'no-store'});
        if (!mr.ok) {
            if (ld) ld.classList.add('hidden');
            setStatus('Error carregant dades', true);
            return;
        }
        const metaText = await mr.text();
        const metaMatch = metaText.match(/window\.radarMetadata\s*=\s*(\{[\s\S]*\});?\s*$/);
        if (!metaMatch) return;
        const metadata = JSON.parse(metaMatch[1]);

        if (!metadata || !metadata.frames || !metadata.frames.length) {
            if (ld) ld.classList.add('hidden');
            return;
        }

        // 2. Carregar només els últims 5 frames
        const framesACarregar = metadata.frames.slice(-50);
        const framesNous = [];

        for (let i = 0; i < framesACarregar.length; i++) {
            const url = BASE_PATH + '/' + framesACarregar[i].file + '?t=' + Date.now();
            try {
                const r = await fetch(url, {cache:'no-store'});
                if (!r.ok) continue;
                const txt = await r.text();
                const frameMatch = txt.match(/window\.radarFrame\s*=\s*(\{[\s\S]*\});?\s*$/);
                if (!frameMatch) continue;
                const frame = JSON.parse(frameMatch[1]);
                if (frame && frame.points) {
                    framesNous.push({
                        timestamp: frame.timestamp,
                        bounds: frame.bounds,
                        points: frame.points,
                        resolution_m: frame.resolution_m || FALLBACK_RESOLUTION_M
                    });
                }
            } catch(e) {}
        }

        if (producteDeLaPeticio !== producteActual) {
            if (ld) ld.classList.add('hidden');
            return;
        }

        if (ld) ld.classList.add('hidden');
        if (!framesNous.length) {
            setStatus('Sense dades noves', true);
            return;
        }

        radarFrames = framesNous;
        currentFrame = radarFrames.length - 1;
        
        console.log('[Radar]', producteActual, 'frames:', radarFrames.length, '(últims 50)');
        
        radarLayer.setFrame(radarFrames[currentFrame]);
        updateUI();
        setStatus('En directe', false);
        avaluarAlertaProximitat();
        
    } catch(e) {
        if (ld) ld.classList.add('hidden');
        setStatus('Error carregant dades', true);
    }
}

    // ═══ NAVEGACIÓ ═══
    function framePrev() {
        if (!radarFrames.length) return;
        currentFrame = currentFrame>0 ? currentFrame-1 : radarFrames.length-1;
        radarLayer.setFrame(radarFrames[currentFrame]);
        updateUI();
    }
    function frameNext() {
        if (!radarFrames.length) return;
        currentFrame = currentFrame<radarFrames.length-1 ? currentFrame+1 : 0;
        radarLayer.setFrame(radarFrames[currentFrame]);
        updateUI();
    }
    function frameLatest() {
        if (!radarFrames.length) return;
        currentFrame = radarFrames.length-1;
        radarLayer.setFrame(radarFrames[currentFrame]);
        updateUI();
    }

    function startAnim() {
        if (animPlaying || radarFrames.length<2) return;
        animPlaying = true;
        const btn = document.getElementById('btnPlay');
        if (btn) { btn.textContent = 'Pausa'; btn.classList.add('active'); }
        animTimer = setInterval(() => {
            currentFrame = currentFrame<radarFrames.length-1 ? currentFrame+1 : 0;
            radarLayer.setFrame(radarFrames[currentFrame]);
            updateUI();
        }, 800);
    }
    function stopAnim() {
        animPlaying = false;
        const btn = document.getElementById('btnPlay');
        if (btn) { btn.textContent = 'Reproduir'; btn.classList.remove('active'); }
        if (animTimer) { clearInterval(animTimer); animTimer = null; }
    }
    function toggleAnim() { animPlaying ? stopAnim() : startAnim(); }

    // ═══ SELECTOR DE PALETA ═══
    function aplicarPaleta(clau) {
        if (!PALETTES[clau]) return;
        paletaActual = clau;
        try { localStorage.setItem(paletteStorageKeyPer(producteActual), clau); } catch(e) {}
        radarLayer.repaint();
        const sel = document.getElementById('paletteSelect');
        if (sel && sel.value !== clau) sel.value = clau;
    }

    function refrescarOpcionsPaleta() {
        const sel = document.getElementById('paletteSelect');
        if (!sel) return;
        const claus = PALETTES_PER_PRODUCTE[producteActual] || Object.keys(PALETTES);

        sel.innerHTML = '';
        claus.forEach(function(clau) {
            const opt = document.createElement('option');
            opt.value = clau;
            opt.textContent = PALETTES[clau].label;
            sel.appendChild(opt);
        });

        // Amb una unica opcio (cas de Nimbus) no te sentit un selector
        // interactiu: es deshabilita perque quedi clar que es fixa.
        sel.disabled = (claus.length <= 1);
        sel.title = sel.disabled
            ? 'Paleta fixa per aquest producte'
            : 'Estil de colors del radar';
    }

    function initPaletteSelector() {
        const bb = document.getElementById('bottombar');
        if (!bb || document.getElementById('paletteSelect')) return;

        const wrap = document.createElement('select');
        wrap.id = 'paletteSelect';
        wrap.style.cssText = 'margin-left:8px;padding:6px 10px;border-radius:8px;'+
            'background:rgba(13,17,23,0.9);color:#c9d1d9;border:1px solid rgba(255,255,255,0.15);'+
            'font-family:sans-serif;font-size:13px;cursor:pointer;';

        wrap.addEventListener('change', function() {
            aplicarPaleta(wrap.value);
        });

        bb.appendChild(wrap);
        refrescarOpcionsPaleta();

        let inicial = paletaPerDefecte(producteActual);
        try {
            const guardat = localStorage.getItem(paletteStorageKeyPer(producteActual));
            if (guardat && PALETTES[guardat] && (PALETTES_PER_PRODUCTE[producteActual] || []).includes(guardat)) {
                inicial = guardat;
            }
        } catch(e) {}
        wrap.value = inicial;
        paletaActual = inicial;
    }

    // ═══ SELECTOR DE PRODUCTE (CIRRUS / NIMBUS) ═══
    function canviarProducte(clau) {
        if (!PRODUCTS[clau] || clau === producteActual) return;

        producteActual = clau;
        VALOR_KEY = PRODUCTS[clau].valorKey;
        try { localStorage.setItem(PRODUCT_STORAGE_KEY, clau); } catch(e) {}

        // Neteja l'estat de l'animacio i dels frames de l'anterior
        // producte: no te sentit animar barrejant dBZ amb mm.
        stopAnim();
        radarFrames = [];
        currentFrame = 0;
        vistaAcumulada = false;
        radarLayer.setFrame(null);
        updateUI();
        actualitzarBotoAcumulat();

        // Cada producte recorda la seva propia paleta preferida (clau
        // per producte). Si l'usuari mai ha triat una per aquest
        // producte concret, s'aplica la paleta per defecte.
        refrescarOpcionsPaleta();
        let paletaGuardada = null;
        try { paletaGuardada = localStorage.getItem(paletteStorageKeyPer(clau)); } catch(e) {}
        const opcionsValides = PALETTES_PER_PRODUCTE[clau] || [];
        aplicarPaleta((paletaGuardada && opcionsValides.includes(paletaGuardada)) ? paletaGuardada : paletaPerDefecte(clau));

        const sel = document.getElementById('productSelect');
        if (sel && sel.value !== clau) sel.value = clau;

        // L'alerta de proximitat nomes te sentit amb dBZ (Cirrus).
        if (clau !== 'cirrus') amagarBannerAlerta();

        carregarDades(false);
    }

    function initProductSelector() {
        const bb = document.getElementById('bottombar');
        if (!bb || document.getElementById('productSelect')) return;

        const wrap = document.createElement('select');
        wrap.id = 'productSelect';
        wrap.title = 'Producte de radar (Cirrus reflectivitat / Nimbus pluja acumulada)';
        wrap.style.cssText = 'margin-left:8px;padding:6px 10px;border-radius:8px;'+
            'background:rgba(13,17,23,0.9);color:#c9d1d9;border:1px solid rgba(255,255,255,0.15);'+
            'font-family:sans-serif;font-size:13px;cursor:pointer;';

        Object.keys(PRODUCTS).forEach(function(clau) {
            const opt = document.createElement('option');
            opt.value = clau;
            opt.textContent = PRODUCTS[clau].label;
            wrap.appendChild(opt);
        });

        let inicial = 'cirrus';
        try {
            const guardat = localStorage.getItem(PRODUCT_STORAGE_KEY);
            if (guardat && PRODUCTS[guardat]) inicial = guardat;
        } catch(e) {}
        wrap.value = inicial;
        producteActual = inicial;
        VALOR_KEY = PRODUCTS[inicial].valorKey;

        wrap.addEventListener('change', function() {
            canviarProducte(wrap.value);
        });

        // El posem com a primer control de la barra, abans de la resta.
        bb.insertBefore(wrap, bb.firstChild);
    }

    // ═══════════════════════════════════════════════════════════════════
    //  UBICACIÓ EN VIU + SEGUIMENT + ALERTA DE PROXIMITAT
    // ═══════════════════════════════════════════════════════════════════
    let watchId = null;
    let seguimentActiu = false;   // si el mapa s'ha de recentrar sol quan et mous
    let userMarker = null;
    let userAccuracyCircle = null;
    let alertRadiusCircle = null;
    let posicioActual = null;     // {lat, lon}
    let ultimAvisTs = 0;
    let alertaActiva = false;

    function distanciaKm(lat1, lon1, lat2, lon2) {
        const R = 6371;
        const dLat = (lat2-lat1) * Math.PI/180;
        const dLon = (lon2-lon1) * Math.PI/180;
        const a = Math.sin(dLat/2)**2 +
                  Math.cos(lat1*Math.PI/180)*Math.cos(lat2*Math.PI/180)*Math.sin(dLon/2)**2;
        return R * 2 * Math.atan2(Math.sqrt(a), Math.sqrt(1-a));
    }

    function crearIconaUsuari() {
        return L.divIcon({
            className: 'user-location-icon',
            html: '<div class="ul-pulse"></div><div class="ul-dot"></div>',
            iconSize: [22,22],
            iconAnchor: [11,11]
        });
    }

    function injectarEstilsUsuari() {
        if (document.getElementById('user-location-styles')) return;
        const style = document.createElement('style');
        style.id = 'user-location-styles';
        style.textContent = `
            .user-location-icon { position: relative; }
            .ul-dot {
                position:absolute; left:50%; top:50%; width:14px; height:14px;
                margin:-7px 0 0 -7px; background:#1a73e8; border:2px solid #fff;
                border-radius:50%; box-shadow:0 0 4px rgba(0,0,0,0.5); z-index:2;
            }
            .ul-pulse {
                position:absolute; left:50%; top:50%; width:22px; height:22px;
                margin:-11px 0 0 -11px; background:rgba(26,115,232,0.35);
                border-radius:50%; animation: ul-pulse-anim 1.8s ease-out infinite;
            }
            @keyframes ul-pulse-anim {
                0% { transform: scale(0.4); opacity: 1; }
                100% { transform: scale(2.2); opacity: 0; }
            }
            #alertaProximitat {
                position:absolute; top:14px; left:50%; transform:translateX(-50%);
                z-index:1000; background:rgba(200,0,0,0.95); color:#fff;
                padding:10px 18px; border-radius:10px; font-family:sans-serif;
                font-size:14px; font-weight:600; box-shadow:0 2px 10px rgba(0,0,0,0.4);
                display:none; align-items:center; gap:8px; animation: ul-blink 1s infinite;
            }
            @keyframes ul-blink {
                0%,100% { box-shadow:0 2px 10px rgba(0,0,0,0.4); }
                50% { box-shadow:0 2px 22px rgba(255,0,0,0.9); }
            }
        `;
        document.head.appendChild(style);
    }

    function crearBannerAlerta() {
        if (document.getElementById('alertaProximitat')) return;
        const el = document.createElement('div');
        el.id = 'alertaProximitat';
        el.innerHTML = '⚠️ <span id="alertaProximitatText">Zona forta a prop</span>';
        const mapEl = document.getElementById('map');
        (mapEl ? mapEl.parentElement : document.body).style.position = 'relative';
        (mapEl || document.body).appendChild(el);
    }

    function mostrarBannerAlerta(dbzMax, distKm) {
        const el = document.getElementById('alertaProximitat');
        const txt = document.getElementById('alertaProximitatText');
        if (!el || !txt) return;
        txt.textContent = 'Zona forta a ' + distKm.toFixed(1) + ' km · ' + dbzMax.toFixed(0) + ' dBZ (llindar ' + ALERT_DBZ_THRESHOLD + ')';
        el.style.display = 'flex';
    }
    function amagarBannerAlerta() {
        const el = document.getElementById('alertaProximitat');
        if (el) el.style.display = 'none';
    }

    function reproduirSoAlerta() {
        try {
            const ACtx = window.AudioContext || window.webkitAudioContext;
            if (!ACtx) return;
            const ctx = new ACtx();
            [0, 0.25].forEach(function(delay) {
                const osc = ctx.createOscillator();
                const gain = ctx.createGain();
                osc.type = 'square';
                osc.frequency.value = 880;
                gain.gain.setValueAtTime(0.0001, ctx.currentTime + delay);
                gain.gain.exponentialRampToValueAtTime(0.25, ctx.currentTime + delay + 0.02);
                gain.gain.exponentialRampToValueAtTime(0.0001, ctx.currentTime + delay + 0.18);
                osc.connect(gain).connect(ctx.destination);
                osc.start(ctx.currentTime + delay);
                osc.stop(ctx.currentTime + delay + 0.2);
            });
        } catch(e) {}
    }

    // Comprova el frame de radar actual i busca el punt de dBZ més alt
    // dins del radi definit al voltant de la posició de l'usuari.
    // Nomes te sentit amb el producte Cirrus (dBZ).
    function avaluarAlertaProximitat() {
        if (producteActual !== 'cirrus') return;
        if (!posicioActual || !radarFrames.length || !radarFrames[currentFrame]) return;
        const frame = radarFrames[currentFrame];
        let dbzMax = -Infinity;
        let distDelMax = null;

        for (let i=0; i<frame.points.length; i++) {
            const p = frame.points[i];
            const v = p[VALOR_KEY];
            if (v === undefined || v === null || isNaN(v)) continue;
            const dLatDeg = Math.abs(p.lat - posicioActual.lat);
            if (dLatDeg > (ALERT_RADIUS_KM/111) * 1.5) continue;
            const d = distanciaKm(posicioActual.lat, posicioActual.lon, p.lat, p.lon);
            if (d <= ALERT_RADIUS_KM && v > dbzMax) {
                dbzMax = v;
                distDelMax = d;
            }
        }

        if (dbzMax >= ALERT_DBZ_THRESHOLD) {
            alertaActiva = true;
            mostrarBannerAlerta(dbzMax, distDelMax);
            const ara = Date.now();
            if (ara - ultimAvisTs > ALERT_COOLDOWN_MS) {
                reproduirSoAlerta();
                ultimAvisTs = ara;
            }
        } else {
            alertaActiva = false;
            amagarBannerAlerta();
        }
    }

    function actualitzarMarcadorUsuari(lat, lon, accuracy) {
        posicioActual = { lat: lat, lon: lon };
        const ll = [lat, lon];

        if (!userMarker) {
            injectarEstilsUsuari();
            userMarker = L.marker(ll, { icon: crearIconaUsuari(), pane: 'paneUser', zIndexOffset: 1000 }).addTo(map);
        } else {
            userMarker.setLatLng(ll);
        }

        if (accuracy) {
            if (!userAccuracyCircle) {
                userAccuracyCircle = L.circle(ll, {
                    radius: accuracy, pane: 'paneUser',
                    color: '#1a73e8', weight: 1, fillColor: '#1a73e8', fillOpacity: 0.08, interactive: false
                }).addTo(map);
            } else {
                userAccuracyCircle.setLatLng(ll);
                userAccuracyCircle.setRadius(accuracy);
            }
        }

        if (!alertRadiusCircle) {
            alertRadiusCircle = L.circle(ll, {
                radius: ALERT_RADIUS_KM * 1000, pane: 'paneUser',
                color: '#ff3b30', weight: 1, dashArray: '4,6',
                fillColor: '#ff3b30', fillOpacity: 0.03, interactive: false
            }).addTo(map);
        } else {
            alertRadiusCircle.setLatLng(ll);
        }

        if (seguimentActiu) {
            map.panTo(ll, { animate: true });
        }

        avaluarAlertaProximitat();
    }

    function onPosicioError(err) {
        console.log('[Ubicació] Error:', err.message);
        setStatus('Sense accés a la ubicació', true);
        const btn = document.getElementById('btnSeguirme');
        if (btn) { btn.classList.remove('active'); btn.textContent = 'Seguir-me'; }
        seguimentActiu = false;
    }

    function iniciarSeguimentUbicacio() {
        if (!('geolocation' in navigator)) {
            console.log('[Ubicació] Geolocalització no disponible en aquest navegador');
            return;
        }
        if (watchId !== null) return; // ja en marxa
        watchId = navigator.geolocation.watchPosition(
            function(pos) {
                actualitzarMarcadorUsuari(pos.coords.latitude, pos.coords.longitude, pos.coords.accuracy);
            },
            onPosicioError,
            { enableHighAccuracy: true, maximumAge: 5000, timeout: 20000 }
        );
    }

    function aturarSeguimentUbicacio() {
        if (watchId !== null) {
            navigator.geolocation.clearWatch(watchId);
            watchId = null;
        }
    }

    function toggleSeguiment() {
        const btn = document.getElementById('btnSeguirme');
        if (!seguimentActiu) {
            seguimentActiu = true;
            if (btn) { btn.classList.add('active'); btn.textContent = 'Seguint-te…'; }
            iniciarSeguimentUbicacio();
            if (posicioActual) {
                map.setView([posicioActual.lat, posicioActual.lon], Math.max(map.getZoom(), 10), { animate: true });
            }
        } else {
            seguimentActiu = false;
            if (btn) { btn.classList.remove('active'); btn.textContent = 'Seguir-me'; }
        }
    }

    function initSeguimentUI() {
        const bb = document.getElementById('bottombar');
        if (!bb || document.getElementById('btnSeguirme')) return;
        crearBannerAlerta();

        const btn = document.createElement('button');
        btn.id = 'btnSeguirme';
        btn.textContent = 'Seguir-me';
        btn.title = 'Mostra la teva ubicació en viu i centra el mapa mentre et mous';
        btn.className = 'primary';
        btn.addEventListener('click', toggleSeguiment);
        bb.appendChild(btn);

        iniciarSeguimentUbicacio();
    }

    // ═══ VISTA: EN DIRECTE vs ACUMULAT ÚLTIMA HORA (nomes Nimbus) ═══
    // L'acumulat d'ultima hora es un fitxer apart generat pel backend
    // (radar_hourly_nimbus.js), NO forma part de la llista de frames
    // navegables: es un unic "mapa" que sempre mostra el total dels
    // ultims 60 minuts fins al moment.
    let vistaAcumulada = false;
    let frameAcumulatHora = null; // { bounds, points, resolution_m, ... }

    async function carregarAcumulatHora() {
        if (producteActual !== 'nimbus') return;
        try {
            const url = BASE_PATH + '/radar_hourly_nimbus.js?t=' + Date.now();
            const r = await fetch(url, {cache:'no-store'});
            if (!r.ok) { frameAcumulatHora = null; return; }
            const txt = await r.text();
            const m = txt.match(/window\.radarHourly\s*=\s*(\{[\s\S]*\});?\s*$/);
            if (!m) { frameAcumulatHora = null; return; }
            const obj = JSON.parse(m[1]);
            frameAcumulatHora = {
                timestamp: obj.updated,
                bounds: obj.bounds,
                points: obj.points,
                resolution_m: obj.resolution_m || FALLBACK_RESOLUTION_M,
                minuts_comptats: obj.minuts_comptats || 0
            };
        } catch(e) {
            frameAcumulatHora = null;
        }
    }

    function actualitzarBotoAcumulat() {
        const btn = document.getElementById('btnAcumulatHora');
        if (!btn) return;
        // Nomes te sentit amb Nimbus: s'amaga per Cirrus.
        btn.style.display = (producteActual === 'nimbus') ? '' : 'none';
        btn.textContent = vistaAcumulada ? 'En directe' : 'Acumulat última hora';
        btn.classList.toggle('active', vistaAcumulada);
    }

    async function toggleVistaAcumulada() {
        if (producteActual !== 'nimbus') return;
        vistaAcumulada = !vistaAcumulada;
        actualitzarBotoAcumulat();

        if (vistaAcumulada) {
            stopAnim();
            await carregarAcumulatHora();
            if (frameAcumulatHora) {
                radarLayer.setFrame(frameAcumulatHora);
                setStatus('Acumulat última hora · '+(frameAcumulatHora.minuts_comptats)+'min comptats', false);
                const td = document.getElementById('timeDisplay');
                const dd = document.getElementById('dateDisplay');
                if (td) td.textContent = 'Última hora';
                if (dd) dd.textContent = dataMadrid(frameAcumulatHora.timestamp);
            } else {
                setStatus('Encara no hi ha acumulat de l\'última hora', true);
            }
        } else {
            if (radarFrames[currentFrame]) {
                radarLayer.setFrame(radarFrames[currentFrame]);
                updateUI();
                setStatus('En directe', false);
            }
        }
    }

    function initBotoAcumulatHora() {
        const bb = document.getElementById('bottombar');
        if (!bb || document.getElementById('btnAcumulatHora')) return;
        const btn = document.createElement('button');
        btn.id = 'btnAcumulatHora';
        btn.className = 'primary';
        btn.title = 'Mostra la pluja total acumulada durant l\'última hora (nomes Nimbus)';
        btn.addEventListener('click', toggleVistaAcumulada);
        bb.appendChild(btn);
        actualitzarBotoAcumulat();
    }

    // ═══════════════════════════════════════════════════════════════════
    //  PANELL D'INFORMACIÓ (què és Cirrus/Nimbus i les seves escales)
    // ═══════════════════════════════════════════════════════════════════
    function llegendaHtmlDbz() {
        const punts = [-10, 0, 15, 30, 40, 50, 60, 70];
        let html = '<div style="display:flex;flex-wrap:wrap;gap:6px;margin-top:8px;">';
        punts.forEach(function(v) {
            const c = (function() {
                const stopsAntics = paletaActual;
                paletaActual = 'classica';
                const col = getColor(v);
                paletaActual = stopsAntics;
                return col;
            })();
            html += '<div style="display:flex;align-items:center;gap:4px;font-size:11px;color:#c9d1d9;">' +
                '<span style="display:inline-block;width:14px;height:14px;border-radius:3px;background:rgba('+c.r+','+c.g+','+c.b+','+(c.a/255)+');border:1px solid rgba(255,255,255,0.15);"></span>' +
                v + '</div>';
        });
        html += '</div>';
        return html;
    }

    function llegendaHtmlPluja() {
        const punts = [0.1, 1, 5, 10, 20, 50, 100];
        let html = '<div style="display:flex;flex-wrap:wrap;gap:6px;margin-top:8px;">';
        punts.forEach(function(v) {
            const stopsAntics = paletaActual;
            paletaActual = 'pluja';
            const c = getColor(v);
            paletaActual = stopsAntics;
            html += '<div style="display:flex;align-items:center;gap:4px;font-size:11px;color:#c9d1d9;">' +
                '<span style="display:inline-block;width:14px;height:14px;border-radius:3px;background:rgba('+c.r+','+c.g+','+c.b+','+(c.a/255)+');border:1px solid rgba(255,255,255,0.15);"></span>' +
                v + 'mm</div>';
        });
        html += '</div>';
        return html;
    }

    function contingutInfo() {
        return '' +
        '<div style="margin-bottom:18px;">' +
            '<div style="font-size:15px;font-weight:700;color:#fff;margin-bottom:4px;">CIRRUS · Reflectivitat (dBZ)</div>' +
            '<p style="font-size:13px;color:#c9d1d9;line-height:1.5;margin:0;">' +
                'Mostra la intensitat de l\'eco de radar en <b>decibels (dBZ)</b>: com mes forta es la senyal ' +
                'que torna al radar, mes gran o densa es la precipitacio (o pedra) en aquell punt. ' +
                'Valors baixos (blau/verd) indiquen pluja feble; valors alts (vermell/magenta/lila) indiquen ' +
                'pluja molt intensa, possible calamarsa o tempesta severa.' +
            '</p>' +
            llegendaHtmlDbz() +
        '</div>' +
        '<div>' +
            '<div style="font-size:15px;font-weight:700;color:#fff;margin-bottom:4px;">NIMBUS · Precipitació (mm)</div>' +
            '<p style="font-size:13px;color:#c9d1d9;line-height:1.5;margin:0;">' +
                'Mostra la quantitat de pluja <b>acumulada en mil·limetres (mm)</b> en aquell punt: quants litres ' +
                'per metre quadrat han caigut. Colors clars (blau) son quantitats petites; colors calids ' +
                '(groc, taronja, vermell, magenta) indiquen acumulats molt elevats. La vista "Acumulat última hora" ' +
                'suma tota la pluja caiguda durant els ultims 60 minuts.' +
            '</p>' +
            llegendaHtmlPluja() +
        '</div>';
    }

    function injectarEstilsInfo() {
        if (document.getElementById('info-panel-styles')) return;
        const style = document.createElement('style');
        style.id = 'info-panel-styles';
        style.textContent = `
            #infoOverlay {
                position:absolute; inset:0; z-index:1200;
                background:rgba(0,0,0,0.55);
                display:none; align-items:center; justify-content:center;
            }
            #infoPanel {
                background:rgba(13,17,23,0.98); color:#c9d1d9;
                border:1px solid rgba(255,255,255,0.12);
                border-radius:14px; padding:22px 24px;
                max-width:420px; width:90%; max-height:80vh; overflow-y:auto;
                font-family:sans-serif; box-shadow:0 8px 30px rgba(0,0,0,0.5);
            }
            #infoPanel .info-close {
                float:right; background:none; border:none; color:#8b949e;
                font-size:20px; cursor:pointer; line-height:1; padding:0 4px;
            }
            #infoPanel .info-close:hover { color:#fff; }
        `;
        document.head.appendChild(style);
    }

    function crearPanellInfo() {
        if (document.getElementById('infoOverlay')) return;
        injectarEstilsInfo();
        const overlay = document.createElement('div');
        overlay.id = 'infoOverlay';
        overlay.innerHTML =
            '<div id="infoPanel">' +
                '<button class="info-close" id="btnTancarInfo" aria-label="Tancar">✕</button>' +
                '<div style="clear:both;"></div>' +
                contingutInfo() +
            '</div>';
        const mapEl = document.getElementById('map');
        (mapEl ? mapEl.parentElement : document.body).style.position = 'relative';
        (mapEl || document.body).appendChild(overlay);

        overlay.addEventListener('click', function(e) {
            if (e.target === overlay) amagarPanellInfo();
        });
        document.getElementById('btnTancarInfo').addEventListener('click', amagarPanellInfo);
    }

    function mostrarPanellInfo() {
        crearPanellInfo();
        const overlay = document.getElementById('infoOverlay');
        if (overlay) overlay.style.display = 'flex';
    }

    function amagarPanellInfo() {
        const overlay = document.getElementById('infoOverlay');
        if (overlay) overlay.style.display = 'none';
    }

    function initBotoInfo() {
        const bb = document.getElementById('bottombar');
        if (!bb || document.getElementById('btnInfo')) return;
        const btn = document.createElement('button');
        btn.id = 'btnInfo';
        btn.className = 'primary';
        btn.title = 'Que significa cada radar i la seva escala de colors';
        btn.textContent = 'ℹ️ Info';
        btn.addEventListener('click', mostrarPanellInfo);
        bb.appendChild(btn);
    }

    function initButtons() {
        document.getElementById('btnPrev')?.addEventListener('click', () => { stopAnim(); framePrev(); });
        document.getElementById('btnNext')?.addEventListener('click', () => { stopAnim(); frameNext(); });
        document.getElementById('btnLatest')?.addEventListener('click', () => { stopAnim(); frameLatest(); });
        document.getElementById('btnRefresh')?.addEventListener('click', () => carregarDades(false));

        const bb = document.getElementById('bottombar');
        if (bb && !document.getElementById('btnPlay')) {
            const playBtn = document.createElement('button');
            playBtn.id = 'btnPlay';
            playBtn.textContent = 'Reproduir';
            playBtn.className = 'primary';
            playBtn.title = 'Reproduir/Pausar (espai)';
            playBtn.addEventListener('click', toggleAnim);
            bb.insertBefore(playBtn, document.getElementById('btnLatest'));
        }

        initProductSelector();
        initPaletteSelector();
        initBotoAcumulatHora();
        initSeguimentUI();
        initBotoInfo();
    }

    document.addEventListener('keydown', function(e) {
        if (!radarFrames.length) return;
        if (e.key==='ArrowLeft') { e.preventDefault(); stopAnim(); framePrev(); }
        if (e.key==='ArrowRight') { e.preventDefault(); stopAnim(); frameNext(); }
        if (e.key===' ') { e.preventDefault(); toggleAnim(); }
        if (e.key==='Escape') { amagarPanellInfo(); }
    });

    setInterval(avaluarAlertaProximitat, ALERT_RECHECK_MS);

    // ═══ POPUP ═══
    let popupActual = null;
    map.on('click', function(e) {
        if (!radarFrames.length || !radarFrames[currentFrame]) return;
        const frame = radarFrames[currentFrame];
        let mp = null, md = Infinity;
        for (let i=0; i<frame.points.length; i++) {
            const p = frame.points[i];
            const d = (p.lat-e.latlng.lat)**2 + (p.lon-e.latlng.lng)**2;
            if (d<md) { md=d; mp=p; }
        }
        if (popupActual) { map.removeLayer(popupActual); popupActual=null; }
        if (mp && Math.sqrt(md)<0.05) {
            const v = mp[VALOR_KEY];
            if (v===undefined) return;
            const c = getColor(v);
            const info = PRODUCTS[producteActual];
            popupActual = L.popup({closeButton:true,className:'popup-clic',offset:[0,-8]})
                .setLatLng(e.latlng)
                .setContent(
                    '<div style="background:rgba(13,17,23,0.95);color:#c9d1d9;padding:12px 16px;border-radius:10px;font-family:sans-serif;min-width:110px;border:1px solid rgba(255,255,255,0.08);">'+
                    '<div style="font-size:10px;color:#8b949e;text-transform:uppercase;letter-spacing:1.2px;margin-bottom:4px;">'+info.nomCamp+' · '+horaMadrid(frame.timestamp)+'</div>'+
                    '<div style="font-size:26px;font-weight:700;color:rgb('+c.r+','+c.g+','+c.b+');">'+v.toFixed(1)+' <span style="font-size:13px;font-weight:500;color:#8b949e;">'+info.unitat+'</span></div>'+
                    '<div style="font-size:10px;color:#484f58;margin-top:8px;">'+e.latlng.lat.toFixed(4)+'°N · '+e.latlng.lng.toFixed(4)+'°E</div>'+
                    '</div>'
                ).openOn(map);
        }
    });

    // ═══ INICI ═══
    let jaIniciat = false;

    function iniciar() {
        if (jaIniciat) return;
        jaIniciat = true;
        initButtons();
        carregarComarques().then(() => carregarDades(false)).catch(() => carregarDades(false));
        setInterval(() => carregarDades(true), REFRESH_MS);
    }

    document.addEventListener('auth:autoritzat', iniciar);

    window.addEventListener('beforeunload', function() {
        aturarSeguimentUbicacio();
    });

})();
