// ═══════════════════════════════════════════════════════════════════════
//  radar.js — VISOR RADAR METEOROLÒGIC (NE ESPANYA)
//  CIRRUS (dBZ) · Hora Madrid · Escala americana · Multi-paleta
// ═══════════════════════════════════════════════════════════════════════

(function() {
    'use strict';

    // Dades servides des del bucket R2 (Cloudflare), no des del mateix
    // origen que la web. Actualitzat pel workflow de GitHub Actions
    // cada 5 min sense necessitat de re-deploy de la web.
    const BASE_PATH = 'https://radar-data.tempestes.cat/radar';
    const VALOR_KEY = 'dbz';
    const REFRESH_MS = 5 * 60 * 1000; // 5 min, ajusta si canvies l'interval real

    console.log('[Radar] Iniciant...');

    // ═══ HORA MADRID ═══
    function horaMadrid(ts) {
        const año = ts.slice(0,4);
        const mes = ts.slice(5,7);
        const dia = ts.slice(8,10);
        const hh = ts.slice(11,13);
        const mm = ts.slice(13,15);
        const d = new Date(Date.UTC(año, mes-1, dia, hh, mm, 0));
        const madrid = new Date(d.toLocaleString('en-US', {timeZone: 'Europe/Madrid'}));
        const h = String(madrid.getHours()).padStart(2,'0');
        const m = String(madrid.getMinutes()).padStart(2,'0');
        return h + ':' + m;
    }

    function dataMadrid(ts) {
        const año = ts.slice(0,4);
        const mes = ts.slice(5,7);
        const dia = ts.slice(8,10);
        const hh = ts.slice(11,13);
        const mm = ts.slice(13,15);
        const d = new Date(Date.UTC(año, mes-1, dia, hh, mm, 0));
        const madrid = new Date(d.toLocaleString('en-US', {timeZone: 'Europe/Madrid'}));
        const dies = ['dg.','dl.','dt.','dc.','dj.','dv.','ds.'];
        return dies[madrid.getDay()] + ' ' +
               String(madrid.getDate()).padStart(2,'0') + '/' +
               String(madrid.getMonth()+1).padStart(2,'0') + '/' +
               madrid.getFullYear();
    }

    // ═══════════════════════════════════════════════════════════════════
    //  PALETES DE COLORS (múltiples estils seleccionables)
    // ═══════════════════════════════════════════════════════════════════
    //
    //  Cada paleta és un array de "stops" { v, r, g, b, a }.
    //  getColor() interpola linealment RGBA entre stops consecutius,
    //  així que els degradats surten suaus dins de cada banda i el
    //  "look" de cada paleta ve determinat per quins colors/talls poses.
    //
    const PALETTES = {

        // ── 1) CLÀSSICA (la que ja tenies — PRINCIPAL / per defecte) ──
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

        // ── 2) TIPUS "WINDY" (blaus-verds-grocs-vermells més saturats i suaus) ──
        windy: {
            label: 'Estil Windy',
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

        // ── 3) PASTEL / SUAU (baixa saturació, bo per fons clars de mapa) ──
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

        // ── 4) ALT CONTRAST (bandes marcades, bo per llegir valors extrems ràpid) ──
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
        }
    };

    const PALETTE_STORAGE_KEY = 'radar_palette_seleccionada';
    let paletaActual = 'classica'; // per defecte: la principal

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

    // ═══════════════════════════════════════════════════════════════════
    //  CAPA CANVAS — interpolació robusta (sense talls / "trossos romputs")
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
            // Repinta amb la mateixa frame (per canvi de paleta, sense recarregar dades)
            this._dirty = true;
            this._render();
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
            const zoom = this._map ? this._map.getZoom() : 8;
            const pSize = zoom <= 7 ? 6 : zoom <= 9 ? 5 : zoom <= 11 ? 4 : 3;
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
    // Nota: aquests fitxers (comarques.geojson, etc.) es continuen
    // servint des del mateix origen que la web (Cloudflare Pages),
    // ja que no canvien cada 5 min com les dades del radar.
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
                        console.log('[GeoJSON] ✅ Carregat:', ruta);
                        return;
                    } catch(e) {}
                }
            } catch(e) {}
        }
        console.log('[GeoJSON] ℹ️  Sense comarques');
    }

    function processarGeoJSON(geojson) {
        if (capaComarques) map.removeLayer(capaComarques);
        capaComarques = L.geoJSON(geojson, {
            pane: 'paneGeojson',
            style: function() {
                return {
                    color: '#ffffff',
                    weight: 1,
                    opacity: 0.7,
                    fill: false,
                    interactive: false
                };
            },
            onEachFeature: function(feature, layer) {
                if (feature.properties && feature.properties.nom) {
                    layer.bindTooltip(feature.properties.nom, {
                        permanent: false,
                        direction: 'center',
                        opacity: 0.9
                    });
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

    async function carregarDades(silenciós) {
        const ld = document.getElementById('loading');
        // En els refrescos automàtics (silenciós=true) no tapem el mapa
        // amb l'overlay de càrrega, només la primera vegada.
        if (ld && !silenciós) ld.classList.remove('hidden');

        try {
            // Cache-busting: sense això el navegador (o la CDN davant
            // del bucket R2) pot servir una còpia en caché de fa uns
            // minuts, en comptes de les dades acabades de pujar.
            const mr = await fetch(BASE_PATH+'/radar_metadata.js?t='+Date.now(), {cache:'no-store'});
            if (!mr.ok) { if (ld) ld.classList.add('hidden'); return; }
            const metaText = await mr.text();
            eval(metaText);

            if (!window.radarMetadata || !window.radarMetadata.frames) {
                if (ld) ld.classList.add('hidden');
                return;
            }

            const framesInfo = window.radarMetadata.frames;
            const framesNous = [];

            for (let i=0; i<framesInfo.length; i++) {
                const url = BASE_PATH+'/'+framesInfo[i].file;
                try {
                    const r = await fetch(url+'?t='+Date.now(), {cache:'no-store'});
                    if (!r.ok) continue;
                    const txt = await r.text();
                    window.radarFrame = null;
                    eval(txt);
                    if (window.radarFrame && window.radarFrame.points && window.radarFrame.points.length) {
                        framesNous.push({
                            timestamp: window.radarFrame.timestamp,
                            bounds: window.radarFrame.bounds,
                            points: window.radarFrame.points
                        });
                    }
                } catch(e) {}
            }

            if (ld) ld.classList.add('hidden');
            if (!framesNous.length) return;

            // Si l'usuari estava mirant el frame "actual" (l'últim),
            // el mantenim actualitzat a l'últim nou en refrescar.
            const estavaAlDarrer = (currentFrame === radarFrames.length - 1) || radarFrames.length === 0;

            radarFrames = framesNous;
            console.log('[Radar] ✅ Frames:', radarFrames.length, silenciós ? '(auto-refresc)' : '(càrrega inicial)');

            if (estavaAlDarrer) {
                currentFrame = radarFrames.length - 1;
            } else if (currentFrame >= radarFrames.length) {
                currentFrame = radarFrames.length - 1;
            }

            radarLayer.setFrame(radarFrames[currentFrame]);
            updateUI();
        } catch(e) {
            if (ld) ld.classList.add('hidden');
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
        if (btn) { btn.textContent = '⏸ Pausa'; btn.classList.add('active'); }
        animTimer = setInterval(() => {
            currentFrame = currentFrame<radarFrames.length-1 ? currentFrame+1 : 0;
            radarLayer.setFrame(radarFrames[currentFrame]);
            updateUI();
        }, 800);
    }
    function stopAnim() {
        animPlaying = false;
        const btn = document.getElementById('btnPlay');
        if (btn) { btn.textContent = '▶ Reproduir'; btn.classList.remove('active'); }
        if (animTimer) { clearInterval(animTimer); animTimer = null; }
    }
    function toggleAnim() { animPlaying ? stopAnim() : startAnim(); }

    // ═══════════════════════════════════════════════════════════════════
    //  SELECTOR DE PALETA (UI)
    // ═══════════════════════════════════════════════════════════════════
    function aplicarPaleta(clau) {
        if (!PALETTES[clau]) return;
        paletaActual = clau;
        try { localStorage.setItem(PALETTE_STORAGE_KEY, clau); } catch(e) {}
        radarLayer.repaint();
        // Actualitza estat visual dels botons/select si existeixen
        const sel = document.getElementById('paletteSelect');
        if (sel && sel.value !== clau) sel.value = clau;
    }

    function initPaletteSelector() {
        const bb = document.getElementById('bottombar');
        if (!bb || document.getElementById('paletteSelect')) return;

        const wrap = document.createElement('select');
        wrap.id = 'paletteSelect';
        wrap.title = 'Estil de colors del radar';
        wrap.style.cssText = 'margin-left:8px;padding:6px 10px;border-radius:8px;'+
            'background:rgba(13,17,23,0.9);color:#c9d1d9;border:1px solid rgba(255,255,255,0.15);'+
            'font-family:sans-serif;font-size:13px;cursor:pointer;';

        Object.keys(PALETTES).forEach(function(clau) {
            const opt = document.createElement('option');
            opt.value = clau;
            opt.textContent = PALETTES[clau].label;
            wrap.appendChild(opt);
        });

        // Restaura preferència guardada si existeix
        let inicial = 'classica';
        try {
            const guardat = localStorage.getItem(PALETTE_STORAGE_KEY);
            if (guardat && PALETTES[guardat]) inicial = guardat;
        } catch(e) {}
        wrap.value = inicial;
        paletaActual = inicial;

        wrap.addEventListener('change', function() {
            aplicarPaleta(wrap.value);
        });

        bb.appendChild(wrap);
    }

    function initButtons() {
        document.getElementById('btnPrev')?.addEventListener('click', () => { stopAnim(); framePrev(); });
        document.getElementById('btnNext')?.addEventListener('click', () => { stopAnim(); frameNext(); });
        document.getElementById('btnLatest')?.addEventListener('click', () => { stopAnim(); frameLatest(); });
        document.getElementById('btnRefresh')?.addEventListener('click', () => location.reload());

        const bb = document.getElementById('bottombar');
        if (bb && !document.getElementById('btnPlay')) {
            const playBtn = document.createElement('button');
            playBtn.id = 'btnPlay';
            playBtn.textContent = '▶ Reproduir';
            playBtn.className = 'primary';
            playBtn.title = 'Reproduir/Pausar (espai)';
            playBtn.addEventListener('click', toggleAnim);
            bb.insertBefore(playBtn, document.getElementById('btnLatest'));
        }

        initPaletteSelector();
    }

    document.addEventListener('keydown', function(e) {
        if (!radarFrames.length) return;
        if (e.key==='ArrowLeft') { e.preventDefault(); stopAnim(); framePrev(); }
        if (e.key==='ArrowRight') { e.preventDefault(); stopAnim(); frameNext(); }
        if (e.key===' ') { e.preventDefault(); toggleAnim(); }
    });

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
            popupActual = L.popup({closeButton:true,className:'popup-clic',offset:[0,-8]})
                .setLatLng(e.latlng)
                .setContent(
                    '<div style="background:rgba(13,17,23,0.95);color:#c9d1d9;padding:12px 16px;border-radius:10px;font-family:sans-serif;min-width:110px;border:1px solid rgba(255,255,255,0.08);">'+
                    '<div style="font-size:10px;color:#8b949e;text-transform:uppercase;letter-spacing:1.2px;margin-bottom:4px;">Reflectivitat · '+horaMadrid(frame.timestamp)+'</div>'+
                    '<div style="font-size:26px;font-weight:700;color:rgb('+c.r+','+c.g+','+c.b+');">'+v.toFixed(1)+' <span style="font-size:13px;font-weight:500;color:#8b949e;">dBZ</span></div>'+
                    '<div style="font-size:10px;color:#484f58;margin-top:8px;">'+e.latlng.lat.toFixed(4)+'°N · '+e.latlng.lng.toFixed(4)+'°E</div>'+
                    '</div>'
                ).openOn(map);
        }
    });

    // ═══ INICI ═══
    console.log('[Radar] 🚀 Iniciant');

    function iniciar() {
        initButtons();
        carregarComarques().then(() => carregarDades(false)).catch(() => carregarDades(false));

        // Auto-refresc: torna a demanar les dades cada REFRESH_MS sense
        // recarregar la pàgina ni mostrar l'overlay de càrrega.
        setInterval(() => carregarDades(true), REFRESH_MS);
    }

    if (document.readyState==='loading') {
        document.addEventListener('DOMContentLoaded', iniciar);
    } else {
        iniciar();
    }

})();