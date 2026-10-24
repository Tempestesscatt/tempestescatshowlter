// public/dades/valor.js
// Creu "+" sota el cursor amb el valor numèric (dBZ, m/s, mm/h, mm).
//
// El valor es llegeix del PNG original del frame (no del canvas WebGL del mapa),
// així no depèn de preserveDrawingBuffer, del devicePixelRatio, de l'opacitat
// de la capa ni del mapa base que hi ha a sota.

import { PALETES } from './paletes.js';

const LITRES_R2_BASE = 'https://radar-data.tempestes.cat/dades_litres';
const LITRES_MANIFEST_URL = `${LITRES_R2_BASE}/manifest.json`;
const CACHE_MAX = 4;          // imatges descodificades en memòria
const REFRESH_MS = 300;       // refresca el número mentre el frame canvia
const TOL2 = 24 * 24 * 3;     // distància² màxima de color acceptada

export function initValor({
  map,
  getLayerState,
  getKey,
  isRadarVisible,
  getLitresProduct,
  getLitresFrames,
  getLitresFrameIndex,
}) {
  injectStyles();

  const tooltip = document.createElement('div');
  tooltip.className = 'valor-tooltip';
  tooltip.style.display = 'none';
  document.body.appendChild(tooltip);

  const crosshair = document.createElement('div');
  crosshair.className = 'valor-crosshair';
  crosshair.style.display = 'none';
  crosshair.innerHTML = `
    <svg width="20" height="20" viewBox="0 0 20 20" aria-hidden="true">
      <line x1="10" y1="0" x2="10" y2="20" stroke="currentColor" stroke-width="1.6"/>
      <line x1="0" y1="10" x2="20" y2="10" stroke="currentColor" stroke-width="1.6"/>
    </svg>`;
  document.body.appendChild(crosshair);

  let enabled = true;
  let lastPos = null;
  let seq = 0;
  let manifestCache = null;
  let manifestTs = 0;
  let refreshTimer = 0;
  let lastWhy = '';
  // Diagnòstic: escriu a la consola el motiu de "sense dada" (només quan canvia)
  function why(msg) {
    if (msg !== lastWhy) { lastWhy = msg; console.info('[valor]', msg); }
    return null;
  }

  const container = map.getCanvasContainer();

  // ---------------------------------------------------------------- manifest litres
  async function loadLitresManifest() {
    const now = Date.now();
    if (manifestCache && now - manifestTs < 60_000) return manifestCache;
    try {
      const r = await fetch(`${LITRES_MANIFEST_URL}?t=${now}`, { cache: 'no-store' });
      if (!r.ok) return manifestCache;
      manifestCache = await r.json();
      manifestTs = now;
    } catch (e) { /* ens quedem amb la còpia anterior */ }
    return manifestCache;
  }

  // ---------------------------------------------------------------- imatges
  const imgCache = new Map(); // clau -> Promise<{ctx,w,h}|null>

  function getImageEntry(key, src) {
    let p = imgCache.get(key);
    if (p) { imgCache.delete(key); imgCache.set(key, p); return p; }
    p = new Promise((resolve) => {
      const img = new Image();
      img.crossOrigin = 'anonymous';
      img.onload = () => {
        try {
          const c = document.createElement('canvas');
          c.width = img.naturalWidth;
          c.height = img.naturalHeight;
          const cx = c.getContext('2d', { willReadFrequently: true });
          cx.imageSmoothingEnabled = false;
          cx.drawImage(img, 0, 0);
          resolve({ ctx: cx, w: c.width, h: c.height });
        } catch (e) { resolve(null); }
      };
      img.onerror = () => resolve(null);
      img.src = src;
    });
    imgCache.set(key, p);
    while (imgCache.size > CACHE_MAX) imgCache.delete(imgCache.keys().next().value);
    p.then((r) => { if (!r) imgCache.delete(key); });
    return p;
  }

  const mercY = (lat) => Math.log(Math.tan(Math.PI / 4 + (lat * Math.PI) / 360));

  // coords = [[lonW,latN],[lonE,latN],[lonE,latS],[lonW,latS]] (com MapLibre)
  async function samplePixel(key, src, coords, ll) {
    if (!coords || coords.length < 4) return why('coords invàlides');
    const lonW = coords[0][0], latN = coords[0][1];
    const lonE = coords[2][0], latS = coords[2][1];
    const u = (ll.lng - lonW) / (lonE - lonW);
    const v = (mercY(latN) - mercY(ll.lat)) / (mercY(latN) - mercY(latS));
    if (!(u >= 0 && u < 1 && v >= 0 && v < 1)) return why(`fora de la imatge (u=${u.toFixed(3)}, v=${v.toFixed(3)})`);

    const entry = await getImageEntry(key, src);
    if (!entry) return why("no s'ha pogut carregar/descodificar la imatge (CORS o blob?)");
    const px = Math.floor(u * entry.w);
    const py = Math.floor(v * entry.h);
    try {
      const d = entry.ctx.getImageData(px, py, 1, 1).data;
      if (d[3] < 8) return why('píxel transparent (no hi ha eco aquí)');
      return { r: d[0], g: d[1], b: d[2] };
    } catch (e) {
      return why('canvas tainted: ' + (e && e.message));
    }
  }

  // ---------------------------------------------------------------- color -> valor
  const palCache = new Map();
  function hexToRgb(h) {
    const s = h.replace('#', '');
    return [parseInt(s.slice(0, 2), 16), parseInt(s.slice(2, 4), 16), parseInt(s.slice(4, 6), 16)];
  }
  function getPal(name, levels, colors) {
    const k = `${name}|${levels.length}|${colors.length}`;
    let p = palCache.get(k);
    if (!p) { p = { levels, rgb: colors.map(hexToRgb) }; palCache.set(k, p); }
    return p;
  }

  // Paleta discreta (radar): el píxel és exactament un color de la paleta.
  function decodeDiscrete(r, g, b, pal) {
    let best = Infinity, bi = -1;
    for (let i = 0; i < pal.rgb.length; i++) {
      const c = pal.rgb[i];
      const d = (r - c[0]) ** 2 + (g - c[1]) ** 2 + (b - c[2]) ** 2;
      if (d < best) { best = d; bi = i; }
    }
    return bi >= 0 && best <= TOL2 ? pal.levels[bi] : null;
  }

  // Litres: litres.py pinta amb una LUT de 1024 entrades repartides LINEALMENT
  // entre levels[0] i levels[última] (aplicar_escala). Reconstruïm la mateixa
  // LUT aquí i busquem l'entrada més propera al color del píxel.
  // Nota: la resolució és d'(max-min)/1023 (≈1 mm/h a RATE, ≈3 mm a ACRR) i els
  // valors per sota d'aquest pas són transparents: és el que genera el Python.
  const LUT_SIZE = 1024;
  const LUT_TOL2 = 16 * 16 * 3;
  const lutCache = new Map();

  function getLut(name, levels, colors) {
    const k = `${name}|${levels.length}|${levels[0]}|${levels[levels.length - 1]}`;
    let lut = lutCache.get(k);
    if (lut) return lut;
    const vmin = levels[0], vmax = levels[levels.length - 1];
    const pos = levels.map((v) => (v - vmin) / (vmax - vmin));
    const rgb = colors.map(hexToRgb);
    lut = new Float32Array(LUT_SIZE * 3);
    let s = 0;
    for (let i = 0; i < LUT_SIZE; i++) {
      const p = i / (LUT_SIZE - 1);
      while (s < pos.length - 2 && p > pos[s + 1]) s++;
      const span = pos[s + 1] - pos[s];
      const t = span > 0 ? Math.max(0, Math.min(1, (p - pos[s]) / span)) : 0;
      for (let c = 0; c < 3; c++) lut[i * 3 + c] = rgb[s][c] + t * (rgb[s + 1][c] - rgb[s][c]);
    }
    lutCache.set(k, lut);
    return lut;
  }

  function decodeLut(r, g, b, name, levels, colors) {
    const lut = getLut(name, levels, colors);
    let best = Infinity, bi = -1;
    for (let i = 1; i < LUT_SIZE; i++) { // l'entrada 0 és transparent
      const d = (r - lut[i * 3]) ** 2 + (g - lut[i * 3 + 1]) ** 2 + (b - lut[i * 3 + 2]) ** 2;
      if (d < best) { best = d; bi = i; }
    }
    if (bi < 0 || best > LUT_TOL2) return null;
    const vmin = levels[0], vmax = levels[levels.length - 1];
    return vmin + ((bi + 0.5) / (LUT_SIZE - 1)) * (vmax - vmin);
  }

  // ---------------------------------------------------------------- cerca
  async function lookupLitres(ll) {
    const product = typeof getLitresProduct === 'function' ? getLitresProduct() : null;
    if (!product) return undefined; // litres no actiu
    const frames = getLitresFrames ? getLitresFrames() : [];
    const idx = getLitresFrameIndex ? getLitresFrameIndex() : -1;
    const fr = frames[idx];
    if (!fr) return null;

    const m = await loadLitresManifest();
    const prod = m && m.products && m.products[product];
    if (!prod || !m.coords) return null;
    const levels = prod.levels || (PALETES[product] && PALETES[product].levels);
    const colors = prod.colors || (PALETES[product] && PALETES[product].colors);
    const unit = prod.unit || (PALETES[product] && PALETES[product].unit) || '';
    if (!levels || !colors) return null;

    const src = `${LITRES_R2_BASE}/${fr.f}.png`;
    const px = await samplePixel(src, src, m.coords, ll);
    if (!px) return null;
    const v = decodeLut(px.r, px.g, px.b, product, levels, colors);
    return v === null ? null : { text: `≈ ${formatValue(v, unit)}`, source: 'litres' };
  }

  async function lookupRadar(ll) {
    if (typeof getLayerState !== 'function' || typeof getKey !== 'function') return null;
    if (typeof isRadarVisible === 'function' && !isRadarVisible()) return null;
    const key = getKey(); // 'dbz' | 'vel'
    const name = key === 'dbz' ? 'DBZH' : key === 'vel' ? 'VRADH' : null;
    const palDef = name && PALETES[name];
    if (!palDef) return null;

    const st = getLayerState(key);
    if (!st || !st.initialized || !st.coords || !st.currentBlob) {
      return why(`estat radar: init=${!!(st && st.initialized)} coords=${!!(st && st.coords)} blob=${!!(st && st.currentBlob)}`);
    }

    const px = await samplePixel(st.currentUrl, st.currentBlob, st.coords, ll);
    if (!px) return null;
    let v = decodeDiscrete(px.r, px.g, px.b, getPal(name, palDef.levels, palDef.colors));
    if (v === null) return why(`color sense coincidència amb la paleta: rgb(${px.r},${px.g},${px.b})`);
    // Velocitat: el nivell és el límit inferior d'un bin d'1 m/s desplaçat 0.25;
    // mostrem el valor enter més proper al centre del bin.
    if (name === 'VRADH') v = Math.round(v + 0.5);
    return { text: formatValue(v, palDef.unit), source: 'radar' };
  }

  async function lookup(clientX, clientY) {
    const rect = container.getBoundingClientRect();
    const x = clientX - rect.left, y = clientY - rect.top;
    if (x < 0 || y < 0 || x > rect.width || y > rect.height) return null;
    const ll = map.unproject([x, y]);

    const lit = await lookupLitres(ll);
    if (lit !== undefined) return lit; // litres actiu: el radar està amagat
    return lookupRadar(ll);
  }

  // ---------------------------------------------------------------- format
  function formatValue(v, unit) {
    if (unit === 'dBZ') return `${Math.round(v)} dBZ`;
    if (unit === 'm/s') return `${Math.round(v)} m/s`;
    if (unit === 'mm/h' || unit === 'mm') {
      const dec = v < 1 ? 2 : v < 10 ? 1 : 0;
      return `${v.toFixed(dec)} ${unit}`;
    }
    return `${v.toFixed(1)} ${unit || ''}`.trim();
  }

  // ---------------------------------------------------------------- UI
  function showCrosshair(x, y) {
    crosshair.style.display = 'block';
    crosshair.style.transform = `translate(${x - 10}px, ${y - 10}px)`;
  }
  function hideCrosshair() { crosshair.style.display = 'none'; }

  function showTooltip(x, y, text, source) {
    tooltip.textContent = text;
    tooltip.dataset.source = source;
    tooltip.style.display = 'block';
    const w = tooltip.offsetWidth, h = tooltip.offsetHeight;
    let left = x + 16, top = y - 8;
    if (left + w > window.innerWidth - 8) left = x - w - 16;
    if (top + h > window.innerHeight - 8) top = y - h + 8;
    tooltip.style.transform = `translate(${left}px, ${Math.max(4, top)}px)`;
  }
  function hideTooltip() { tooltip.style.display = 'none'; }
  function hideAll() { hideTooltip(); hideCrosshair(); }

  async function update() {
    if (!enabled || !lastPos) return;
    const my = ++seq;
    let res = null;
    try { res = await lookup(lastPos.x, lastPos.y); } catch (e) { console.warn('[valor] error', e); }
    if (my !== seq || !enabled || !lastPos) return;
    if (res) {
      const tag = 'ok ' + res.text;
      if (lastWhy !== tag) { lastWhy = tag; console.info('[valor] valor trobat:', res.text); }
      showTooltip(lastPos.x, lastPos.y, res.text, res.source);
    }
    else hideTooltip();
  }

  function onMouseMove(e) {
    if (!enabled) { hideAll(); return; }
    lastPos = { x: e.clientX, y: e.clientY };
    showCrosshair(lastPos.x, lastPos.y);
    update();
  }
  function onMouseLeave() {
    lastPos = null;
    seq++;
    hideAll();
  }

  // ---------------------------------------------------------------- setup
  container.addEventListener('mousemove', onMouseMove);
  container.addEventListener('mouseleave', onMouseLeave);
  container.style.cursor = 'none';
  refreshTimer = setInterval(() => { if (lastPos && enabled) update(); }, REFRESH_MS);
  loadLitresManifest();

  return {
    setEnabled(on) {
      enabled = !!on;
      container.style.cursor = enabled ? 'none' : '';
      if (!enabled) { lastPos = null; seq++; hideAll(); }
    },
    isEnabled: () => enabled,
    refresh: () => { manifestCache = null; manifestTs = 0; imgCache.clear(); loadLitresManifest(); },
    destroy() {
      clearInterval(refreshTimer);
      container.removeEventListener('mousemove', onMouseMove);
      container.removeEventListener('mouseleave', onMouseLeave);
      container.style.cursor = '';
      tooltip.remove();
      crosshair.remove();
    },
  };
}

// ---------------------------------------------------------------- estils
function injectStyles() {
  if (document.getElementById('valor-styles')) return;
  const s = document.createElement('style');
  s.id = 'valor-styles';
  s.textContent = `
    .valor-crosshair {
      position: fixed; left: 0; top: 0; width: 20px; height: 20px;
      pointer-events: none; z-index: 9999; color: #fff;
      filter: drop-shadow(0 0 1.5px rgba(0,0,0,.95)) drop-shadow(0 0 1px rgba(0,0,0,.95));
    }
    .valor-tooltip {
      position: fixed !important; left: 0 !important; top: 0 !important;
      opacity: 1 !important; visibility: visible !important;
      pointer-events: none; z-index: 99999;
      padding: 3px 8px; white-space: nowrap;
      font: 600 13px/1.3 system-ui, -apple-system, 'Segoe UI', sans-serif;
      color: #fff; background: rgba(10,12,20,.88);
      border: 1px solid rgba(255,255,255,.25); border-radius: 6px;
      box-shadow: 0 2px 8px rgba(0,0,0,.45);
    }
  `;
  document.head.appendChild(s);
}