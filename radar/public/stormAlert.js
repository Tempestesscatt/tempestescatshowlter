// ═══════════════════════════════════════════════════════════════════════
//  stormAlert.js — ZONES DE PERILL PER dBZ + DIRECCIO DE MOVIMENT
//  Amarillo 40-50 dBZ · Rojo 50-65 dBZ · Lila 65-80 dBZ
//  Contorns reals (marching squares) + fletxa de direccio de la tempesta
//
//  Requereix que ja existeixi window.map (Leaflet) i que aquest script
//  es carregui DESPRES de radar.js, ja que llegeix `radarFrames` i
//  `currentFrame` a traves dels hooks exposats per radar.js.
// ═══════════════════════════════════════════════════════════════════════

(function () {
    'use strict';

    // ═══ CONFIG ═══
    const BANDS = [
        { min: 40, max: 50, color: '#08fd1cd0', label: '40–50 dBZ' }, // amarillo
        { min: 50, max: 65, color: '#ff0008', label: '50–65 dBZ' }, // rojo
        { min: 65, max: 80, color: '#01ffddc4', label: '65–80 dBZ' }  // lila
    ];
    const GRID_N = 160;                 // resolucio de la rejilla d'interpolacio (cel·les per costat)
    const N_FRAMES_DIRECCIO = 5;        // quants frames recents fem servir per estimar direccio
    const ARROW_LENGTH_KM = 12;         // longitud de la fletxa de direccio
    const VALOR_KEY_DEFAULT = 'dbz';    // aquest modul nomes te sentit amb Cirrus (dBZ)

    console.log('[StormAlert] Iniciant...');

    if (!window.map) {
        console.warn('[StormAlert] window.map no existeix encara, avortant.');
        return;
    }
    const map = window.map;

    // ═══ PANE PROPI (per sobre del radar, per sota dels popups) ═══
    if (!map.getPane('paneStormAlert')) {
        map.createPane('paneStormAlert');
        map.getPane('paneStormAlert').style.zIndex = 450;
        map.getPane('paneStormAlert').style.pointerEvents = 'none';
    }

    let capaBandes = L.layerGroup([], { pane: 'paneStormAlert' }).addTo(map);
    let capaFletxa = L.layerGroup([], { pane: 'paneStormAlert' }).addTo(map);

    // ═══════════════════════════════════════════════════════════════════
    //  1. INTERPOLACIO A REJILLA REGULAR
    // ═══════════════════════════════════════════════════════════════════
    // Els punts del frame venen en lat/lon amb una resolucio coneguda
    // (resolution_m) pero no formen necessariament un array 2D net a
    // les nostres mans: els reconstruim en una rejilla GRID_N x GRID_N
    // sobre el bounding box del frame, agafant el valor del punt mes
    // proper (nearest) — suficient per generar contorns nets.
    function construirRejilla(frame, valorKey) {
        const pts = frame.points;
        const b = frame.bounds;
        if (!pts || !pts.length || !b) return null;

        const lonR = (b.east - b.west) || 1;
        const latR = (b.north - b.south) || 1;
        const nx = GRID_N;
        const ny = Math.max(1, Math.round(GRID_N * latR / lonR));

        // Index espacial simple (bucket grid) per accelerar el nearest-neighbour
        const bucketCols = Math.min(400, Math.max(20, Math.round(lonR / ((frame.resolution_m || 2000) / 111320))));
        const bucketRows = Math.min(400, Math.max(20, Math.round(latR / ((frame.resolution_m || 2000) / 111320))));
        const buckets = new Array(bucketCols * bucketRows);
        function bucketIdx(lon, lat) {
            let cx = Math.floor((lon - b.west) / lonR * bucketCols);
            let cy = Math.floor((b.north - lat) / latR * bucketRows);
            cx = Math.min(bucketCols - 1, Math.max(0, cx));
            cy = Math.min(bucketRows - 1, Math.max(0, cy));
            return cy * bucketCols + cx;
        }
        for (let i = 0; i < pts.length; i++) {
            const idx = bucketIdx(pts[i].lon, pts[i].lat);
            if (!buckets[idx]) buckets[idx] = [];
            buckets[idx].push(pts[i]);
        }

        function nearest(lon, lat) {
            let cx = Math.floor((lon - b.west) / lonR * bucketCols);
            let cy = Math.floor((b.north - lat) / latR * bucketRows);
            cx = Math.min(bucketCols - 1, Math.max(0, cx));
            cy = Math.min(bucketRows - 1, Math.max(0, cy));
            let best = null, bestD = Infinity;
            for (let dy = -1; dy <= 1; dy++) {
                for (let dx = -1; dx <= 1; dx++) {
                    const ncx = cx + dx, ncy = cy + dy;
                    if (ncx < 0 || ncy < 0 || ncx >= bucketCols || ncy >= bucketRows) continue;
                    const arr = buckets[ncy * bucketCols + ncx];
                    if (!arr) continue;
                    for (let k = 0; k < arr.length; k++) {
                        const p = arr[k];
                        const d = (p.lon - lon) * (p.lon - lon) + (p.lat - lat) * (p.lat - lat);
                        if (d < bestD) { bestD = d; best = p; }
                    }
                }
            }
            return best;
        }

        const grid = new Float32Array(nx * ny);
        for (let j = 0; j < ny; j++) {
            const lat = b.north - (j / (ny - 1 || 1)) * latR;
            for (let i = 0; i < nx; i++) {
                const lon = b.west + (i / (nx - 1 || 1)) * lonR;
                const p = nearest(lon, lat);
                const v = p ? p[valorKey] : undefined;
                grid[j * nx + i] = (v === undefined || v === null || isNaN(v)) ? -999 : v;
            }
        }

        return { grid, nx, ny, bounds: b };
    }

    // ═══════════════════════════════════════════════════════════════════
    //  2. MARCHING SQUARES — genera contorns (llista de polígons) per
    //     un llindar donat sobre la rejilla
    // ═══════════════════════════════════════════════════════════════════
    // Implementacio simple basada en "isobands": per cada llindar,
    // generem el conjunt de segments frontera i els encadenem en anells.
    function marchingSquaresContours(rejilla, threshold) {
        const { grid, nx, ny, bounds } = rejilla;
        const b = bounds;
        const lonR = b.east - b.west;
        const latR = b.north - b.south;

        function val(i, j) {
            const v = grid[j * nx + i];
            return v;
        }
        function toLatLon(i, j) {
            const lon = b.west + (i / (nx - 1 || 1)) * lonR;
            const lat = b.north - (j / (ny - 1 || 1)) * latR;
            return [lat, lon];
        }
        function interp(i1, j1, i2, j2, v1, v2) {
            const t = v1 === v2 ? 0.5 : (threshold - v1) / (v2 - v1);
            const tt = Math.max(0, Math.min(1, t));
            const p1 = toLatLon(i1, j1);
            const p2 = toLatLon(i2, j2);
            return [p1[0] + (p2[0] - p1[0]) * tt, p1[1] + (p2[1] - p1[1]) * tt];
        }

        // Recollim segments (parells de punts) de cada cel·la creuada pel llindar
        const segments = [];
        for (let j = 0; j < ny - 1; j++) {
            for (let i = 0; i < nx - 1; i++) {
                const v00 = val(i, j), v10 = val(i + 1, j), v11 = val(i + 1, j + 1), v01 = val(i, j + 1);
                // Tractem -999 (sense dada) com a molt per sota del llindar
                const c00 = v00 >= threshold ? 1 : 0;
                const c10 = v10 >= threshold ? 1 : 0;
                const c11 = v11 >= threshold ? 1 : 0;
                const c01 = v01 >= threshold ? 1 : 0;
                const caseIdx = c00 | (c10 << 1) | (c11 << 2) | (c01 << 3);
                if (caseIdx === 0 || caseIdx === 15) continue;

                const eTop = () => interp(i, j, i + 1, j, v00, v10);
                const eRight = () => interp(i + 1, j, i + 1, j + 1, v10, v11);
                const eBottom = () => interp(i, j + 1, i + 1, j + 1, v01, v11);
                const eLeft = () => interp(i, j, i, j + 1, v00, v01);

                const pairs = {
                    1: [[eLeft(), eTop()]],
                    2: [[eTop(), eRight()]],
                    3: [[eLeft(), eRight()]],
                    4: [[eRight(), eBottom()]],
                    5: [[eLeft(), eTop()], [eRight(), eBottom()]],
                    6: [[eTop(), eBottom()]],
                    7: [[eLeft(), eBottom()]],
                    8: [[eBottom(), eLeft()]],
                    9: [[eTop(), eBottom()]],
                    10: [[eTop(), eLeft()], [eBottom(), eRight()]],
                    11: [[eBottom(), eRight()]],
                    12: [[eRight(), eLeft()]],
                    13: [[eRight(), eTop()]],
                    14: [[eTop(), eLeft()]]
                };
                const segs = pairs[caseIdx];
                if (segs) segments.push(...segs);
            }
        }

        return encadenarSegments(segments);
    }

    // Encadena segments [ [lat,lon], [lat,lon] ] en anells tancats
    // (o polilínies obertes si toquen la vora del mapa).
    function encadenarSegments(segments) {
        const EPS = 1e-7;
        const key = (p) => p[0].toFixed(6) + ',' + p[1].toFixed(6);
        const used = new Array(segments.length).fill(false);
        const index = new Map(); // key -> [ {segIdx, endIdx} ]

        segments.forEach((s, idx) => {
            [0, 1].forEach((end) => {
                const k = key(s[end]);
                if (!index.has(k)) index.set(k, []);
                index.get(k).push({ segIdx: idx, end });
            });
        });

        const rings = [];
        for (let startIdx = 0; startIdx < segments.length; startIdx++) {
            if (used[startIdx]) continue;
            used[startIdx] = true;
            let ring = [segments[startIdx][0], segments[startIdx][1]];
            let guard = 0;
            while (guard++ < segments.length + 5) {
                const last = ring[ring.length - 1];
                const k = key(last);
                const candidates = index.get(k) || [];
                let extended = false;
                for (const cand of candidates) {
                    if (used[cand.segIdx]) continue;
                    const seg = segments[cand.segIdx];
                    const otherEnd = seg[cand.end === 0 ? 1 : 0];
                    used[cand.segIdx] = true;
                    ring.push(otherEnd);
                    extended = true;
                    break;
                }
                if (!extended) break;
            }
            if (ring.length >= 3) rings.push(ring);
        }
        return rings;
    }

    // ═══════════════════════════════════════════════════════════════════
    //  3. CENTROIDE PONDERAT PER dBZ (per estimar direccio)
    // ═══════════════════════════════════════════════════════════════════
    function centroidePonderat(frame, minDbz, valorKey) {
        const pts = frame.points;
        let sumLat = 0, sumLon = 0, sumW = 0;
        for (let i = 0; i < pts.length; i++) {
            const v = pts[i][valorKey];
            if (v === undefined || v === null || isNaN(v) || v < minDbz) continue;
            const w = v; // pes = intensitat
            sumLat += pts[i].lat * w;
            sumLon += pts[i].lon * w;
            sumW += w;
        }
        if (sumW <= 0) return null;
        return { lat: sumLat / sumW, lon: sumLon / sumW };
    }

    function bearing(lat1, lon1, lat2, lon2) {
        const phi1 = lat1 * Math.PI / 180, phi2 = lat2 * Math.PI / 180;
        const dLon = (lon2 - lon1) * Math.PI / 180;
        const y = Math.sin(dLon) * Math.cos(phi2);
        const x = Math.cos(phi1) * Math.sin(phi2) - Math.sin(phi1) * Math.cos(phi2) * Math.cos(dLon);
        let brng = Math.atan2(y, x) * 180 / Math.PI;
        return (brng + 360) % 360;
    }

    function angDiff(a, b) {
        let d = Math.abs(a - b) % 360;
        return d > 180 ? 360 - d : d;
    }

    // Estima la direccio de moviment mes estable comparant dues series
    // de centroides (>40dBZ i >50dBZ) al llarg dels ultims N frames.
    // Retorna { bearingDeg, speedKmPerFrame, font } o null si no hi ha
    // prou dades per decidir.
    function estimarDireccio(frames, valorKey) {
        if (!frames || frames.length < 2) return null;
        const recents = frames.slice(-N_FRAMES_DIRECCIO);

        function seriePerLlindar(minDbz) {
            return recents.map(f => centroidePonderat(f, minDbz, valorKey)).filter(Boolean);
        }

        function analitzarSerie(serie) {
            if (serie.length < 2) return null;
            const bearings = [];
            const dists = [];
            for (let i = 1; i < serie.length; i++) {
                const a = serie[i - 1], b = serie[i];
                const dLatKm = (b.lat - a.lat) * 111.32;
                const dLonKm = (b.lon - a.lon) * 111.32 * Math.cos(a.lat * Math.PI / 180);
                const dist = Math.sqrt(dLatKm * dLatKm + dLonKm * dLonKm);
                if (dist < 0.3) continue; // moviment massa petit, soroll
                bearings.push(bearing(a.lat, a.lon, b.lat, b.lon));
                dists.push(dist);
            }
            if (!bearings.length) return null;

            // Mitjana circular
            let sx = 0, sy = 0;
            bearings.forEach(deg => {
                const r = deg * Math.PI / 180;
                sx += Math.cos(r); sy += Math.sin(r);
            });
            const meanBearing = (Math.atan2(sy / bearings.length, sx / bearings.length) * 180 / Math.PI + 360) % 360;

            // Variancia angular (0 = perfectament consistent)
            let varSum = 0;
            bearings.forEach(deg => { varSum += angDiff(deg, meanBearing) ** 2; });
            const variancia = varSum / bearings.length;

            const speed = dists.reduce((a, c) => a + c, 0) / dists.length;
            return { bearingDeg: meanBearing, speedKmPerFrame: speed, variancia, nMostres: bearings.length };
        }

        const serie40 = analitzarSerie(seriePerLlindar(40));
        const serie50 = analitzarSerie(seriePerLlindar(50));

        // Triem la serie mes estable (menor variancia angular). Si nomes
        // una es valida, fem servir aquesta. Preferim series amb mes
        // mostres en cas d'empat proxim.
        let elegida = null, font = null;
        if (serie40 && serie50) {
            if (serie50.variancia <= serie40.variancia) { elegida = serie50; font = 'nucli >50dBZ'; }
            else { elegida = serie40; font = 'zona >40dBZ'; }
        } else if (serie50) { elegida = serie50; font = 'nucli >50dBZ'; }
        else if (serie40) { elegida = serie40; font = 'zona >40dBZ'; }

        if (!elegida) return null;
        return { bearingDeg: elegida.bearingDeg, speedKmPerFrame: elegida.speedKmPerFrame, font, variancia: elegida.variancia };
    }

    // ═══════════════════════════════════════════════════════════════════
    //  4. DIBUIX
    // ═══════════════════════════════════════════════════════════════════
    function dibuixarBandes(frame, valorKey) {
        capaBandes.clearLayers();
        const rejilla = construirRejilla(frame, valorKey);
        if (!rejilla) return;

        // Dibuixem de la banda mes ampla (menor dBZ) a la mes estreta,
        // perque les bandes superiors quedin per sobre visualment.
        BANDS.forEach(band => {
            const rings = marchingSquaresContours(rejilla, band.min);
            rings.forEach(ring => {
                L.polygon(ring, {
                    pane: 'paneStormAlert',
                    color: band.color,
                    weight: 2,
                    opacity: 0.9,
                    fillColor: band.color,
                    fillOpacity: 0.35,
                    interactive: false
                }).addTo(capaBandes);
            });
        });
    }

    function destiKmDes(lat, lon, bearingDeg, distKm) {
        const R = 6371;
        const brng = bearingDeg * Math.PI / 180;
        const lat1 = lat * Math.PI / 180, lon1 = lon * Math.PI / 180;
        const lat2 = Math.asin(Math.sin(lat1) * Math.cos(distKm / R) + Math.cos(lat1) * Math.sin(distKm / R) * Math.cos(brng));
        const lon2 = lon1 + Math.atan2(
            Math.sin(brng) * Math.sin(distKm / R) * Math.cos(lat1),
            Math.cos(distKm / R) - Math.sin(lat1) * Math.sin(lat2)
        );
        return [lat2 * 180 / Math.PI, lon2 * 180 / Math.PI];
    }



    // ═══════════════════════════════════════════════════════════════════
    //  5. ENGANXAR AMB radar.js
    // ═══════════════════════════════════════════════════════════════════
    // radar.js no exposa hooks explicits, aixi que vigilem el frame
    // actiu de radarLayer via un interval lleuger + comprovem canvis de
    // producte a traves del selector (nomes te sentit amb Cirrus/dBZ).
    let ultimTimestampProcessat = null;

    function frameKeyKey(frame) {
        return frame ? frame.timestamp : null;
    }

    function actualitzar() {
        const productSel = document.getElementById('productSelect');
        const producteActual = productSel ? productSel.value : 'cirrus';
        if (producteActual !== 'cirrus') {
            capaBandes.clearLayers();
            capaFletxa.clearLayers();
            ultimTimestampProcessat = null;
            return;
        }

        // Accedim a l'estat intern de radar.js a traves de la capa
        // afegida al mapa (unica RadarLayer present amb getFrame()).
        let radarLayerRef = null;
        map.eachLayer(l => { if (l.getFrame) radarLayerRef = l; });
        if (!radarLayerRef) return;
        const frame = radarLayerRef.getFrame();
        if (!frame) return;

        if (frameKeyKey(frame) === ultimTimestampProcessat) return; // sense canvis
        ultimTimestampProcessat = frameKeyKey(frame);

        dibuixarBandes(frame, VALOR_KEY_DEFAULT);

        // Per la direccio necessitem l'historial de frames, que no es
        // public a radar.js. El reconstruim demanant-li a l'usuari... no
        // podem. Per tant exposem un petit "recull" propi: cada cop que
        // detectem un frame nou el guardem en un buffer local ordenat.
        bufferFrames.push(frame);
        if (bufferFrames.length > N_FRAMES_DIRECCIO + 2) bufferFrames.shift();

        const direccio = estimarDireccio(bufferFrames, VALOR_KEY_DEFAULT);
        const centreActual = centroidePonderat(frame, 50, VALOR_KEY_DEFAULT) || centroidePonderat(frame, 40, VALOR_KEY_DEFAULT);
        dibuixarFletxa(centreActual, direccio);
    }

    const bufferFrames = [];

    // Estils del tooltip de direccio
    (function injectarEstils() {
        if (document.getElementById('storm-alert-styles')) return;
        const style = document.createElement('style');
        style.id = 'storm-alert-styles';
        style.textContent = `
            .storm-direction-tooltip {
                background: rgba(13,17,23,0.9) !important;
                color: #fff !important;
                border: 1px solid rgba(255,255,255,0.2) !important;
                font-family: sans-serif;
                font-size: 12px;
                font-weight: 600;
                padding: 3px 8px !important;
            }
            .storm-direction-tooltip::before { display:none; }
        `;
        document.head.appendChild(style);
    })();

    // Comprovem periodicament (els frames es carreguen de forma
    // asincrona dins radar.js i no hi ha event emes cap enfora).
    setInterval(actualitzar, 2000);
    setTimeout(actualitzar, 1500);

    console.log('[StormAlert] Actiu — vigilant frames Cirrus per generar bandes i direccio.');

})();