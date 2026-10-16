// public/js/estacions.js
// -----------------------------------------------------------------------------
// Estacions meteorològiques d'AEMET sobre el mapa.
//
// Cada estació es mostra com una etiqueta amb "T/Td" (ex: 18/10).
// Color de fons segons la temperatura.
// Papallugues: LCL baix, spread saturat, o convergència.
//
// Simple i net.
// -----------------------------------------------------------------------------

const DATA_URL = '/dades/aemet/estaciones_meta.js';

const SRC = 'estacions-src';
const LAYER_PULSE = 'estacions-pulse';
const LAYER_LABEL = 'estacions-label';

const ZOOM_TIERS = [
  { z: 0,  score: 4.5 },
  { z: 6,  score: 4.0 },
  { z: 7,  score: 3.5 },
  { z: 8,  score: 3.0 },
  { z: 9,  score: 2.0 },
  { z: 10, score: 1.0 },
  { z: 11, score: 0.1 },
];

// Colors per temperatura (fons de l'etiqueta)
const TEMP_COLORS = [
  [-15, '#6366f1'],
  [-10, '#60a5fa'],
  [ -5, '#7dd3fc'],
  [  0, '#a5f3fc'],
  [  5, '#a7f3d0'],
  [ 10, '#bbf7d0'],
  [ 15, '#fef08a'],
  [ 20, '#fde047'],
  [ 25, '#fcd34d'],
  [ 30, '#fb923c'],
  [ 35, '#f87171'],
  [ 40, '#ef4444'],
  [ 45, '#b91c1c'],
];

const PAP_LCL_MAX_M = 1000;
const PAP_SPREAD_MAX_C = 3;
const PAP_CONVERGENCIA_MIN = 0.5;

// ---------------------------------------------------------------------------
// UTILITATS
// ---------------------------------------------------------------------------

function tempColor(ta) {
  if (ta == null) return '#94a3b8';
  let c = TEMP_COLORS[0][1];
  for (const [v, col] of TEMP_COLORS) {
    if (ta >= v) c = col;
  }
  return c;
}

/** Color del text (fosc o clar) segons la lluminositat del fons. */
function textColorFor(hex) {
  const r = parseInt(hex.slice(1, 3), 16);
  const g = parseInt(hex.slice(3, 5), 16);
  const b = parseInt(hex.slice(5, 7), 16);
  const lum = 0.299 * r + 0.587 * g + 0.114 * b;
  return lum > 150 ? '#0a0c14' : '#ffffff';
}

function computeScore(e) {
  let s = 0;
  if (e.ta != null) s += 1.5;
  if (e.vv != null) s += 1.5;
  if (e.prec != null) s += 1.0;
  if (e.hr != null) s += 0.5;
  return Math.round(s * 2) / 2;
}

function calcLCL(ta, tpr) {
  if (ta == null || tpr == null) return null;
  const diff = ta - tpr;
  if (diff < 0) return null;
  return Math.round(125 * diff);
}

function calcUV(vv, dv) {
  if (vv == null || dv == null) return { u: null, v: null };
  const rad = (dv * Math.PI) / 180;
  return { u: -vv * Math.sin(rad), v: -vv * Math.cos(rad) };
}

function calcConvergencia(features, maxDistKm = 35) {
  const toRad = Math.PI / 180;
  for (const f of features) f.properties.conv = 0;

  for (let i = 0; i < features.length; i++) {
    const fi = features[i];
    const pi = fi.properties;
    if (pi.u == null || pi.v == null) continue;

    const lonI = fi.geometry.coordinates[0];
    const latI = fi.geometry.coordinates[1];

    let sum = 0, n = 0;
    for (let j = 0; j < features.length; j++) {
      if (i === j) continue;
      const fj = features[j];
      const pj = fj.properties;
      if (pj.u == null || pj.v == null) continue;

      const lonJ = fj.geometry.coordinates[0];
      const latJ = fj.geometry.coordinates[1];

      const dx = (lonJ - lonI) * Math.cos(((latI + latJ) / 2) * toRad) * 111.32;
      const dy = (latJ - latI) * 110.57;
      const dist = Math.sqrt(dx * dx + dy * dy);
      if (dist > maxDistKm || dist < 0.5) continue;

      sum += (pi.u * dx + pi.v * dy) / dist;
      n++;
    }

    if (n > 0) pi.conv = Math.round(-sum / n * 100) / 100;
  }
}

// ---------------------------------------------------------------------------
// DADES
// ---------------------------------------------------------------------------

let cachedData = null;

async function loadData() {
  if (cachedData) return cachedData;
  if (window.estacionesData && Array.isArray(window.estacionesData.estaciones)) {
    cachedData = window.estacionesData;
    return cachedData;
  }
  await new Promise((resolve, reject) => {
    const s = document.createElement('script');
    s.src = `${DATA_URL}?t=${Date.now()}`;
    s.onload = resolve;
    s.onerror = () => reject(new Error('No s\'ha pogut carregar ' + DATA_URL));
    document.head.appendChild(s);
  });
  if (!window.estacionesData || !Array.isArray(window.estacionesData.estaciones)) {
    throw new Error('window.estacionesData no vàlid');
  }
  cachedData = window.estacionesData;
  return cachedData;
}

function toGeoJSON(data) {
  const features = [];
  for (const e of data.estaciones) {
    if (!Number.isFinite(e.lat) || !Number.isFinite(e.lon)) continue;
    const score = computeScore(e);
    if (score === 0) continue;

    const lcl = calcLCL(e.ta, e.tpr);
    const spread = (e.ta != null && e.tpr != null) ? Math.round((e.ta - e.tpr) * 10) / 10 : null;
    const uv = calcUV(e.vv, e.dv);

    const papLcl = (lcl != null && lcl <= PAP_LCL_MAX_M) ? 1 : 0;
    const papSpread = (spread != null && spread <= PAP_SPREAD_MAX_C) ? 1 : 0;

    // Text de l'etiqueta: "18/10"
    const labelText = (e.ta != null || e.tpr != null)
      ? `${e.ta != null ? Math.round(e.ta) : '?'}/${e.tpr != null ? Math.round(e.tpr) : '?'}`
      : '?';

    // Colors
    const bg = tempColor(e.ta);
    const fg = textColorFor(bg);

    features.push({
      type: 'Feature',
      properties: {
        idema: e.idema, nombre: e.nombre, alt: e.alt,
        ta: e.ta, hr: e.hr, tpr: e.tpr, tpr_calc: e.tpr_calc ? 1 : 0,
        vv: e.vv, dv: e.dv, vmax: e.vmax,
        prec: e.prec, fint: e.fint,
        score,
        lcl, spread,
        u: uv.u, v: uv.v,
        conv: 0,
        papLcl, papSpread, papConv: 0, papallona: 0,
        labelText, bg, fg,
      },
      geometry: { type: 'Point', coordinates: [e.lon, e.lat] },
    });
  }

  calcConvergencia(features, 35);

  for (const f of features) {
    const p = f.properties;
    p.papConv = (p.conv > PAP_CONVERGENCIA_MIN) ? 1 : 0;
    p.papallona = (p.papLcl || p.papSpread || p.papConv) ? 1 : 0;
  }

  return { type: 'FeatureCollection', features };
}

// ---------------------------------------------------------------------------
// POPUP
// ---------------------------------------------------------------------------

const escapeHtml = (s) => String(s == null ? '' : s).replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));

function fmt(val, unit, decimals = 1) {
  if (val == null) return '<span class="na">—</span>';
  const n = Number(val);
  if (!Number.isFinite(n)) return '<span class="na">—</span>';
  return `${n.toFixed(decimals)}${unit ? '<small>' + unit + '</small>' : ''}`;
}

function windDir(deg) {
  if (deg == null) return '';
  const dirs = ['N', 'NNE', 'NE', 'ENE', 'E', 'ESE', 'SE', 'SSE',
                'S', 'SSO', 'SO', 'OSO', 'O', 'ONO', 'NO', 'NNO'];
  return dirs[Math.round(((deg % 360) / 22.5)) % 16];
}

function lclInfo(m) {
  if (m == null) return { txt: '', color: '#7f8a9c' };
  if (m <= 300)  return { txt: 'molt baix', color: '#ef4444' };
  if (m <= 600)  return { txt: 'baix',      color: '#f97316' };
  if (m <= 1000) return { txt: 'moderadament baix', color: '#eab308' };
  if (m <= 1800) return { txt: 'moderat',   color: '#84cc16' };
  return { txt: 'alt', color: '#3b82f6' };
}

function popupHtml(p) {
  const fint = p.fint ? new Date(p.fint) : null;
  const hora = fint && !isNaN(fint) ? new Intl.DateTimeFormat('ca-ES', {
    timeZone: 'Europe/Madrid', hour: '2-digit', minute: '2-digit'
  }).format(fint) : '';

  const vvKmh = p.vv != null ? p.vv * 3.6 : null;
  const vmaxKmh = p.vmax != null ? p.vmax * 3.6 : null;
  const li = lclInfo(p.lcl);

  const badges = [];
  if (p.papLcl)    badges.push('<span class="b b-lcl">LCL</span>');
  if (p.papSpread) badges.push('<span class="b b-spread">saturat</span>');
  if (p.papConv)   badges.push('<span class="b b-conv">convergència</span>');

  return `
    <div class="ep">
      <div class="ep-head">
        <div class="ep-name">${escapeHtml(p.nombre)}</div>
        <div class="ep-meta">${escapeHtml(p.idema)}${p.alt != null ? ' · ' + Math.round(p.alt) + ' m' : ''}${hora ? ' · ' + hora : ''}</div>
        ${badges.length ? '<div class="ep-badges">' + badges.join('') + '</div>' : ''}
      </div>

      <div class="ep-row">
        <div class="ep-c">
          <span class="ep-l">Temperatura</span>
          <span class="ep-v">${fmt(p.ta, '°C')}</span>
        </div>
        <div class="ep-c">
          <span class="ep-l">Rosada</span>
          <span class="ep-v">${fmt(p.tpr, '°C')}${p.tpr_calc ? '<em>*</em>' : ''}</span>
        </div>
        <div class="ep-c">
          <span class="ep-l">Humitat</span>
          <span class="ep-v">${fmt(p.hr, '%', 0)}</span>
        </div>
      </div>

      <div class="ep-row">
        <div class="ep-c">
          <span class="ep-l">LCL</span>
          <span class="ep-v" style="color:${li.color}">${p.lcl != null ? p.lcl.toLocaleString('ca-ES') : '—'}<small>m</small></span>
          <span class="ep-s">${li.txt}</span>
        </div>
        <div class="ep-c">
          <span class="ep-l">Spread</span>
          <span class="ep-v">${fmt(p.spread, '°C')}</span>
        </div>
        <div class="ep-c">
          <span class="ep-l">Pluja 1h</span>
          <span class="ep-v ${p.prec > 0 ? 'rain' : ''}">${fmt(p.prec, 'mm')}</span>
        </div>
      </div>

      <div class="ep-row">
        <div class="ep-c">
          <span class="ep-l">Vent</span>
          <span class="ep-v">${fmt(vvKmh, 'km/h', 1)}</span>
          <span class="ep-s">${windDir(p.dv)} ${p.dv != null ? Math.round(p.dv) + '°' : ''}</span>
        </div>
        <div class="ep-c">
          <span class="ep-l">Ratxa</span>
          <span class="ep-v">${fmt(vmaxKmh, 'km/h', 0)}</span>
        </div>
        <div class="ep-c">
          <span class="ep-l">Convergència</span>
          <span class="ep-v">${fmt(p.conv, 'm/s', 2)}</span>
        </div>
      </div>
    </div>`;
}

// ---------------------------------------------------------------------------
// ESTILS POPUP + ETIQUETES
// ---------------------------------------------------------------------------

function injectPopupStyles() {
  if (document.getElementById('estacions-styles')) return;
  const css = document.createElement('style');
  css.id = 'estacions-styles';
  css.textContent = `
    .maplibregl-popup.est-popup-wrap .maplibregl-popup-content {
      background: rgba(18, 20, 26, 0.98);
      backdrop-filter: blur(20px); -webkit-backdrop-filter: blur(20px);
      border: 1px solid rgba(255, 255, 255, 0.10);
      border-radius: 12px;
      box-shadow: 0 20px 60px rgba(0, 0, 0, 0.7);
      padding: 0;
      color: #eef2f8;
      font-family: system-ui, -apple-system, "Segoe UI", Roboto, sans-serif;
      overflow: hidden;
      min-width: 300px;
    }
    .maplibregl-popup.est-popup-wrap .maplibregl-popup-tip {
      border-top-color: rgba(18, 20, 26, 0.98);
      border-bottom-color: rgba(18, 20, 26, 0.98);
    }
    .maplibregl-popup.est-popup-wrap .maplibregl-popup-close-button {
      color: #8b95a8; font-size: 18px; padding: 2px 8px;
      width: auto; height: auto; border-radius: 0 12px 0 8px;
    }
    .maplibregl-popup.est-popup-wrap .maplibregl-popup-close-button:hover {
      background: rgba(255,255,255,.08); color: #fff;
    }

    .ep { font-size: 13px; }
    .ep-head {
      padding: 12px 14px 10px;
      border-bottom: 1px solid rgba(255, 255, 255, 0.08);
    }
    .ep-name {
      font-size: 14px; font-weight: 600; line-height: 1.3;
      padding-right: 22px; letter-spacing: -0.01em;
    }
    .ep-meta {
      font-size: 11px; color: #8b95a8; margin-top: 3px;
      font-variant-numeric: tabular-nums;
    }
    .ep-badges { display: flex; gap: 5px; margin-top: 7px; flex-wrap: wrap; }
    .ep-badges .b {
      font-size: 9.5px; font-weight: 700; letter-spacing: .3px;
      padding: 2px 8px; border-radius: 4px; text-transform: uppercase;
    }
    .b-lcl    { background: rgba(249, 115, 22, 0.15); color: #fb923c; }
    .b-spread { background: rgba(6, 182, 212, 0.15);  color: #22d3ee; }
    .b-conv   { background: rgba(239, 68, 68, 0.15);  color: #f87171; }

    .ep-row {
      display: grid; grid-template-columns: 1fr 1fr 1fr; gap: 1px;
      background: rgba(255, 255, 255, 0.06);
      border-top: 1px solid rgba(255, 255, 255, 0.06);
    }
    .ep-row:first-of-type { border-top: none; }
    .ep-c {
      background: rgba(18, 20, 26, 0.98);
      padding: 10px 12px;
      display: flex; flex-direction: column; gap: 2px;
      min-width: 0;
    }
    .ep-l {
      font-size: 9.5px; font-weight: 600; color: #8b95a8;
      text-transform: uppercase; letter-spacing: .5px;
      white-space: nowrap; overflow: hidden; text-overflow: ellipsis;
    }
    .ep-v {
      font-size: 15px; font-weight: 600; color: #f5f7fa;
      font-variant-numeric: tabular-nums; letter-spacing: -0.02em;
      white-space: nowrap;
    }
    .ep-v small { font-size: 10px; font-weight: 500; color: #8b95a8; margin-left: 2px; }
    .ep-v em { color: #eab308; font-style: normal; font-weight: 700; margin-left: 1px; }
    .ep-v.rain { color: #5ac8ff; }
    .ep-v .na { color: #4a5364; }
    .ep-s {
      font-size: 10px; color: #8b95a8; font-variant-numeric: tabular-nums;
      white-space: nowrap; overflow: hidden; text-overflow: ellipsis;
      min-height: 12px;
    }
  `;
  document.head.appendChild(css);
}

// ---------------------------------------------------------------------------
// API
// ---------------------------------------------------------------------------

export function initEstacions({ map, visible = true } = {}) {
  if (!map) throw new Error('initEstacions: cal un map');

  injectPopupStyles();

  let isVisible = visible;
  let data = null;
  let geojson = null;
  let lastFilterKey = '';
  let pulsePhase = 0;
  let pulseTimer = 0;

  const popup = new maplibregl.Popup({
    className: 'est-popup-wrap',
    closeButton: true,
    closeOnClick: true,
    offset: 16,
    maxWidth: '340px',
  });

  function filterForZoom(z) {
    let score = ZOOM_TIERS[0].score;
    for (const t of ZOOM_TIERS) {
      if (z >= t.z) score = t.score;
    }
    return score;
  }

  function applyZoomFilters() {
    if (!map.getLayer(LAYER_LABEL)) return;
    const z = map.getZoom();
    const minScore = filterForZoom(z);

    const key = `s=${minScore}`;
    if (key === lastFilterKey) return;
    lastFilterKey = key;

    const scoreFilter = ['>=', ['get', 'score'], minScore];

    try {
      map.setFilter(LAYER_LABEL, scoreFilter);
      map.setFilter(LAYER_PULSE, ['all', ['==', ['get', 'papallona'], 1], scoreFilter]);
    } catch (e) { /* no-op */ }
  }

  function startPulse() {
    if (pulseTimer) return;
    const tick = () => {
      if (!map.getLayer(LAYER_PULSE)) return;
      pulsePhase = (pulsePhase + 1) % 90;
      const t = pulsePhase / 90;
      const wave = 0.5 + 0.5 * Math.sin(t * Math.PI * 2);
      const radiusMul = 1 + 0.6 * wave;
      const opacity = 0.15 + 0.25 * wave;
      try {
        map.setPaintProperty(LAYER_PULSE, 'circle-radius', [
          'interpolate', ['linear'], ['zoom'],
          5, 10 * radiusMul, 10, 16 * radiusMul, 14, 24 * radiusMul,
        ]);
        map.setPaintProperty(LAYER_PULSE, 'circle-opacity', opacity);
      } catch (e) { /* no-op */ }
    };
    pulseTimer = setInterval(tick, 50);
  }

  function stopPulse() {
    if (pulseTimer) clearInterval(pulseTimer);
    pulseTimer = 0;
  }

  function addSourcesAndLayers() {
    if (map.getSource(SRC)) return;

    const z0 = map.getZoom();
    const scoreFilter0 = ['>=', ['get', 'score'], filterForZoom(z0)];

    map.addSource(SRC, { type: 'geojson', data: geojson, generateId: false });

    // Halo pulsant per a les papallones
    map.addLayer({
      id: LAYER_PULSE,
      type: 'circle',
      source: SRC,
      filter: ['all', ['==', ['get', 'papallona'], 1], scoreFilter0],
      layout: { visibility: isVisible ? 'visible' : 'none' },
      paint: {
        'circle-radius': ['interpolate', ['linear'], ['zoom'], 5, 10, 10, 16, 14, 24],
        'circle-color': '#fb923c',
        'circle-opacity': 0.25,
        'circle-blur': 0.85,
      },
    });

    // Etiqueta "T/Td" amb fons de color
    map.addLayer({
      id: LAYER_LABEL,
      type: 'symbol',
      source: SRC,
      filter: scoreFilter0,
      layout: {
        visibility: isVisible ? 'visible' : 'none',
        'text-field': ['get', 'labelText'],
        'text-font': ['Noto Sans Regular'],
        'text-size': ['interpolate', ['linear'], ['zoom'],
          5, 9,
          8, 11,
          11, 13,
          14, 15,
        ],
        'text-padding': 2,
        'text-allow-overlap': true,
        'text-ignore-placement': true,
        'symbol-sort-key': ['-', 0, ['get', 'score']],
      },
      paint: {
        'text-color': ['get', 'fg'],
        'text-halo-color': ['get', 'bg'],
        'text-halo-width': 2.2,
        'text-halo-blur': 0.3,
      },
    });

    applyZoomFilters();
    map.on('moveend', applyZoomFilters);
    map.on('zoomend', applyZoomFilters);

    map.on('click', LAYER_LABEL, (e) => {
      const f = e.features && e.features[0];
      if (!f) return;
      popup.setLngLat(f.geometry.coordinates).setHTML(popupHtml(f.properties)).addTo(map);
    });
    map.on('mouseenter', LAYER_LABEL, () => { map.getCanvas().style.cursor = 'pointer'; });
    map.on('mouseleave', LAYER_LABEL, () => { map.getCanvas().style.cursor = ''; });

    startPulse();
  }

  function removeLayers() {
    stopPulse();
    for (const id of [LAYER_LABEL, LAYER_PULSE]) {
      if (map.getLayer(id)) {
        try { map.removeLayer(id); } catch (e) {}
      }
    }
    if (map.getSource(SRC)) {
      try { map.removeSource(SRC); } catch (e) {}
    }
    map.off('moveend', applyZoomFilters);
    map.off('zoomend', applyZoomFilters);
    lastFilterKey = '';
  }

  async function load() {
    const d = await loadData();
    data = d;
    geojson = toGeoJSON(d);
    return geojson;
  }

  const api = {
    async start() {
      removeLayers();
      try {
        await load();
        addSourcesAndLayers();
      } catch (e) {
        console.warn('[estacions]', e.message);
      }
    },

    setVisible(on) {
      isVisible = !!on;
      for (const id of [LAYER_PULSE, LAYER_LABEL]) {
        if (map.getLayer(id)) {
          map.setLayoutProperty(id, 'visibility', isVisible ? 'visible' : 'none');
        }
      }
      if (!isVisible) { popup.remove(); stopPulse(); } else { startPulse(); }
    },

    isVisible: () => isVisible,

    async refresh() {
      cachedData = null;
      const d = await load();
      const src = map.getSource(SRC);
      if (src) src.setData(geojson);
      return d;
    },

    getData: () => data,

    destroy() {
      popup.remove();
      removeLayers();
    },
  };

  return api;
}

export default { initEstacions };