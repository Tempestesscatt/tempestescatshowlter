(function() {
    'use strict';

    const BANDS = [
        { min: 40, max: 50, color: '#FFD700', label: '40–50 dBZ' },
        { min: 50, max: 65, color: '#FF4500', label: '50–65 dBZ' },
        { min: 65, max: 80, color: '#9B30FF', label: '65–80 dBZ' }
    ];
    const GRID_N = 100;
    const VALOR_KEY = 'dbz';

    if (!window.map) return;
    const map = window.map;

    if (!map.getPane('paneAlertas')) {
        map.createPane('paneAlertas');
        map.getPane('paneAlertas').style.zIndex = 450;
        map.getPane('paneAlertas').style.pointerEvents = 'none';
    }

    let capaAlertas = L.layerGroup([], { pane: 'paneAlertas' }).addTo(map);

    function construirRejilla(frame) {
        const pts = frame.points;
        const b = frame.bounds;
        if (!pts || !pts.length || !b) return null;

        const lonR = b.east - b.west || 1;
        const latR = b.north - b.south || 1;
        const nx = GRID_N;
        const ny = Math.max(1, Math.round(GRID_N * latR / lonR));
        const grid = new Float32Array(nx * ny);

        for (let j = 0; j < ny; j++) {
            const lat = b.north - (j / (ny - 1 || 1)) * latR;
            for (let i = 0; i < nx; i++) {
                const lon = b.west + (i / (nx - 1 || 1)) * lonR;
                let best = null, bestD = Infinity;
                for (let k = 0; k < pts.length; k++) {
                    const p = pts[k];
                    const d = (p.lon - lon) ** 2 + (p.lat - lat) ** 2;
                    if (d < bestD) { bestD = d; best = p; }
                }
                const v = best ? best[VALOR_KEY] : undefined;
                grid[j * nx + i] = (v === undefined || isNaN(v)) ? -999 : v;
            }
        }
        return { grid, nx, ny, bounds: b };
    }

    function marchingSquares(rejilla, threshold) {
        const { grid, nx, ny, bounds } = rejilla;
        const b = bounds;
        const lonR = b.east - b.west;
        const latR = b.north - b.south;
        const segments = [];

        function toLon(i) { return b.west + (i / (nx - 1 || 1)) * lonR; }
        function toLat(j) { return b.north - (j / (ny - 1 || 1)) * latR; }

        for (let j = 0; j < ny - 1; j++) {
            for (let i = 0; i < nx - 1; i++) {
                const v00 = grid[j * nx + i];
                const v10 = grid[j * nx + i + 1];
                const v11 = grid[(j + 1) * nx + i + 1];
                const v01 = grid[(j + 1) * nx + i];
                
                const c00 = v00 >= threshold ? 1 : 0;
                const c10 = v10 >= threshold ? 1 : 0;
                const c11 = v11 >= threshold ? 1 : 0;
                const c01 = v01 >= threshold ? 1 : 0;
                const idx = c00 | (c10 << 1) | (c11 << 2) | (c01 << 3);
                if (idx === 0 || idx === 15) continue;

                const pts = [
                    [toLat(j), toLon(i)],     // 0: top-left
                    [toLat(j), toLon(i+1)],   // 1: top-right
                    [toLat(j+1), toLon(i+1)], // 2: bottom-right
                    [toLat(j+1), toLon(i)]    // 3: bottom-left
                ];
                const vals = [v00, v10, v11, v01];

                function interp(e1, e2) {
                    const t = (threshold - vals[e1]) / (vals[e2] - vals[e1] || 1e-10);
                    const tt = Math.max(0, Math.min(1, t));
                    return [
                        pts[e1][0] + (pts[e2][0] - pts[e1][0]) * tt,
                        pts[e1][1] + (pts[e2][1] - pts[e1][1]) * tt
                    ];
                }

                const edges = {
                    1: [[3,0]], 2: [[0,1]], 3: [[3,1]],
                    4: [[1,2]], 5: [[3,0], [1,2]], 6: [[0,2]],
                    7: [[3,2]], 8: [[2,3]], 9: [[0,2]],
                    10: [[0,1], [2,3]], 11: [[1,3]], 12: [[1,3]],
                    13: [[0,3]], 14: [[0,1]]
                };

                const segs = edges[idx];
                if (segs) {
                    segs.forEach(s => {
                        const p1 = interp(s[0], s[1]);
                        const p2 = interp(s[1], s[0]);
                        segments.push([p1, p2]);
                    });
                }
            }
        }
        return segments;
    }

    function encadenarSegmentos(segments) {
        if (!segments.length) return [];
        const used = new Array(segments.length).fill(false);
        const rings = [];

        for (let i = 0; i < segments.length; i++) {
            if (used[i]) continue;
            used[i] = true;
            const ring = [segments[i][0], segments[i][1]];
            let changed = true;
            while (changed) {
                changed = false;
                const last = ring[ring.length - 1];
                for (let j = 0; j < segments.length; j++) {
                    if (used[j]) continue;
                    const d1 = (segments[j][0][0] - last[0]) ** 2 + (segments[j][0][1] - last[1]) ** 2;
                    const d2 = (segments[j][1][0] - last[0]) ** 2 + (segments[j][1][1] - last[1]) ** 2;
                    if (d1 < 1e-10 || d2 < 1e-10) {
                        used[j] = true;
                        ring.push(d1 < d2 ? segments[j][1] : segments[j][0]);
                        changed = true;
                        break;
                    }
                }
            }
            if (ring.length >= 3) rings.push(ring);
        }
        return rings;
    }

    function dibujarAlertas(frame) {
        capaAlertas.clearLayers();
        const rejilla = construirRejilla(frame);
        if (!rejilla) return;

        BANDS.forEach(band => {
            const segments = marchingSquares(rejilla, band.min);
            const rings = encadenarSegmentos(segments);
            rings.forEach(ring => {
                L.polyline(ring, {
                    pane: 'paneAlertas',
                    color: band.color,
                    weight: 2.5,
                    opacity: 0.85,
                    interactive: false,
                    smoothFactor: 1
                }).addTo(capaAlertas);
            });
        });
    }

    let ultimoFrame = null;

    function actualizar() {
        const sel = document.getElementById('productSelect');
        if (sel && sel.value !== 'cirrus') {
            capaAlertas.clearLayers();
            ultimoFrame = null;
            return;
        }

        let radarLayer = null;
        map.eachLayer(l => { if (l.getFrame) radarLayer = l; });
        if (!radarLayer) return;

        const frame = radarLayer.getFrame();
        if (!frame) return;
        if (frame === ultimoFrame) return;
        ultimoFrame = frame;

        dibujarAlertas(frame);
    }

    setInterval(actualizar, 2000);
    setTimeout(actualizar, 1500);

    console.log('[Alertas] Activo - mostrando solo líneas de contorno');
})();