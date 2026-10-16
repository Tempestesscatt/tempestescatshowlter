// public/dades/valor.js
// Creu al lloc del cursor/dit amb el valor del radar (dBZ, mm/h o mm).
//
// Com funciona ("a la força"): llegeix el pixel del PNG del frame que
// es veu en aquell moment i el torna a convertir en valor buscant el color
// més proper a l'escala de colors (la mateixa que fa servir l'script de Python).
// No necessita cap dada extra del servidor.

// ---------------------------------------------------------------------------
// CONFIGURACIÓ (ha de coincidir amb l'script de Python i radar.js)
// ---------------------------------------------------------------------------

// Cobertura del PNG (REGIO del Python). La imatge és Mercator.
const BOUNDS = { west: -10.0, east: 30.0, south: 35.0, north: 71.0 };

// Per sota d'aquesta opacitat considerem que "no hi ha eco"
const MIN_ALPHA = 30;

// Distància màxima de color (RGB) per acceptar una lectura.
// Amb escales fines (molts stops), cal apujar-ho una mica.
const MAX_COLOR_DIST = 90;

// ---------------------------------------------------------------------------
// ESCALES (han de coincidir EXACTAMENT amb el Python i radar.html)
// ---------------------------------------------------------------------------

export const SCALES = {
  // --- dBZ: de -4 a 68 ---
  dbz: {
    unit: 'dBZ',
    log: false,
    stops: [
      [ -4, [240, 240, 240]], [ -2, [225, 225, 225]], [  0, [205, 205, 205]],
      [  2, [185, 185, 185]], [  4, [160, 160, 160]], [  6, [220, 220, 220]],
      [  8, [255, 255, 255]], [ 10, [  0, 235, 235]], [ 12, [  0, 210, 235]],
      [ 14, [  0, 180, 235]], [ 16, [  0, 140, 235]], [ 18, [  0, 100, 235]],
      [ 20, [  0,  60, 235]], [ 22, [  0, 130, 130]], [ 24, [  0, 180, 100]],
      [ 26, [  0, 210,  50]], [ 28, [ 40, 220,  20]], [ 30, [  0, 200,   0]],
      [ 32, [  0, 170,   0]], [ 34, [  0, 140,   0]], [ 36, [ 80, 210,   0]],
      [ 38, [140, 230,   0]], [ 40, [200, 240,   0]], [ 42, [235, 250,   0]],
      [ 44, [255, 250,   0]], [ 46, [255, 235,   0]], [ 48, [255, 210,   0]],
      [ 50, [255, 180,   0]], [ 52, [255, 150,   0]], [ 54, [255, 110,   0]],
      [ 56, [255,  70,   0]], [ 58, [255,  30,   0]], [ 60, [255,   0,   0]],
      [ 62, [200,   0,   0]], [ 64, [160,   0,   0]], [ 66, [230,   0, 200]],
      [ 68, [200,   0, 230]],
    ],
    format: (v) => {
      if (v >= 68) return '68+';
      if (v <= -4) return '< -4';
      return v.toFixed(0);
    },
  },

  // --- Pluja: de 0.1 a 650 mm/h ---
  lluvia: {
    unit: 'mm/h',
    log: true,
    stops: [
      [   0.1, [  0, 230, 230]], [  0.15, [  0, 200, 240]], [   0.2, [  0, 170, 250]],
      [   0.3, [  0, 120, 250]], [   0.4, [  0,  80, 250]], [   0.5, [  0,  40, 250]],
      [   0.6, [  0,   0, 250]], [   0.9, [  0, 160, 120]], [   1.2, [  0, 220,  40]],
      [   1.5, [ 60, 230,   0]], [     2, [  0, 200,   0]], [   2.7, [  0, 150,   0]],
      [   3.7, [  0, 110,   0]], [   4.8, [  0,  80,   0]], [     6, [160, 220,   0]],
      [     9, [230, 240,   0]], [    12, [250, 250,   0]], [    15, [250, 220,   0]],
      [    21, [250, 180,   0]], [    27, [250, 140,   0]], [    37, [250, 100,   0]],
      [    49, [250,  60,   0]], [    65, [250,   0,   0]], [    86, [220,   0,   0]],
      [   120, [190,   0,   0]], [   153, [210,   0,  80]], [   210, [240,   0, 180]],
      [   273, [220,   0, 230]], [   370, [180,  40, 220]], [   486, [160,  90, 200]],
      [   650, [240, 230, 255]],
    ],
    format: (v) => {
      if (v >= 650) return '650+';
      if (v >= 100) return v.toFixed(0);
      if (v < 1) return v.toFixed(2);
      if (v < 10) return v.toFixed(1);
      return v.toFixed(0);
    },
  },

  // --- 🆕 Acumulació: de 0.2 a 1000 mm ---
  acum: {
    unit: 'mm',
    log: true,
    stops: [
      [   0.2, [170, 215, 255]],
      [   0.5, [140, 195, 255]],
      [     1, [100, 170, 255]],
      [     2, [ 50, 120, 240]],
      [     3, [ 20, 160, 220]],
      [     5, [ 20, 200, 200]],
      [    10, [ 30, 200,  90]],
      [    15, [ 90, 215,  40]],
      [    20, [150, 225,  40]],
      [    30, [253, 235,   2]],
      [    50, [253, 160,   0]],
      [    75, [253,  60,   0]],
      [   100, [200,   0,  20]],
      [   150, [200,   0, 160]],
      [   200, [140,  60, 220]],
      [   300, [180, 130, 240]],
      [   400, [210, 180, 250]],
      [   500, [220, 200, 255]],
      [   700, [200, 160, 255]],
      [  1000, [255, 255, 255]],
    ],
    format: (v) => {
      if (v >= 1000) return '1000+';
      if (v >= 100)  return v.toFixed(0);
      if (v >= 10)   return v.toFixed(1);
      if (v >= 1)    return v.toFixed(1);
      return v.toFixed(2);
    },
  },
};

// ---------------------------------------------------------------------------
// COLOR -> VALOR
// ---------------------------------------------------------------------------

export function colorToValue(r, g, b, scale) {
  const { stops, log } = scale;
  let best = null;

  for (let i = 0; i < stops.length - 1; i++) {
    const A = stops[i][1];
    const B = stops[i + 1][1];
    const abx = B[0] - A[0], aby = B[1] - A[1], abz = B[2] - A[2];
    const len2 = abx * abx + aby * aby + abz * abz || 1;

    let t = ((r - A[0]) * abx + (g - A[1]) * aby + (b - A[2]) * abz) / len2;
    t = Math.max(0, Math.min(1, t));

    const px = A[0] + t * abx - r;
    const py = A[1] + t * aby - g;
    const pz = A[2] + t * abz - b;
    const d2 = px * px + py * py + pz * pz;

    if (!best || d2 < best.d2) best = { d2, i, t };
  }

  if (!best || Math.sqrt(best.d2) > MAX_COLOR_DIST) return null;

  const v0 = stops[best.i][0];
  const v1 = stops[best.i + 1][0];
  if (log) {
    const l0 = Math.log10(v0), l1 = Math.log10(v1);
    return Math.pow(10, l0 + (l1 - l0) * best.t);
  }
  return v0 + (v1 - v0) * best.t;
}

// ---------------------------------------------------------------------------
// POSICIÓ -> PIXEL DEL PNG (imatge en Mercator)
// ---------------------------------------------------------------------------

const mercY = (latDeg) => Math.asinh(Math.tan((latDeg * Math.PI) / 180));
const MERC_N = mercY(BOUNDS.north);
const MERC_S = mercY(BOUNDS.south);

export function lngLatToUV(lng, lat) {
  const u = (lng - BOUNDS.west) / (BOUNDS.east - BOUNDS.west);
  const v = (MERC_N - mercY(lat)) / (MERC_N - MERC_S);
  return { u, v };
}

// ---------------------------------------------------------------------------
// LECTURA DEL PIXEL (només 1 pixel per consulta)
// ---------------------------------------------------------------------------

const imgCache = new Map();   // url -> HTMLImageElement
const MAX_CACHE = 80;

function getImage(url, onLoad) {
  let entry = imgCache.get(url);
  if (entry) return entry.complete && entry.naturalWidth ? entry : null;

  entry = new Image();
  entry.crossOrigin = 'anonymous';
  entry.onload = onLoad;
  entry.src = url;
  imgCache.set(url, entry);
  if (imgCache.size > MAX_CACHE) imgCache.delete(imgCache.keys().next().value);
  return null;
}

const probe = document.createElement('canvas');
probe.width = probe.height = 1;
const pctx = probe.getContext('2d', { willReadFrequently: true });
pctx.imageSmoothingEnabled = false;

function readPixel(img, u, v) {
  const sx = Math.min(img.naturalWidth - 1, Math.max(0, Math.floor(u * img.naturalWidth)));
  const sy = Math.min(img.naturalHeight - 1, Math.max(0, Math.floor(v * img.naturalHeight)));
  pctx.clearRect(0, 0, 1, 1);
  pctx.drawImage(img, sx, sy, 1, 1, 0, 0, 1, 1);
  const d = pctx.getImageData(0, 0, 1, 1).data;
  return { r: d[0], g: d[1], b: d[2], a: d[3] };
}

// ---------------------------------------------------------------------------
// INTERFÍCIE: creu + etiqueta
// ---------------------------------------------------------------------------

function injectStyles() {
  if (document.getElementById('valor-styles')) return;
  const css = document.createElement('style');
  css.id = 'valor-styles';
  css.textContent = `
    .valor-on, .valor-on * { cursor: none !important; }
    #valorCross {
      position: absolute; left: 0; top: 0; z-index: 12; pointer-events: none;
      width: 0; height: 0; display: none;
    }
    #valorCross.show { display: block; }
    #valorCross svg {
      position: absolute; left: -16px; top: -16px; width: 32px; height: 32px;
      overflow: visible; filter: drop-shadow(0 0 2px rgba(0,0,0,.6));
    }
    #valorLabel {
      position: absolute; white-space: nowrap; display: flex; align-items: center; gap: 7px;
      padding: 5px 10px 5px 7px; border-radius: 9px;
      background: rgba(10, 12, 20, .9); color: #fff;
      border: 1px solid rgba(120, 140, 180, .35);
      box-shadow: 0 6px 20px rgba(0, 0, 0, .5);
      font: 600 13px/1 system-ui, -apple-system, "Segoe UI", Roboto, sans-serif;
      font-variant-numeric: tabular-nums;
    }
    #valorLabel .sw { width: 12px; height: 12px; border-radius: 3px; border: 1px solid rgba(255,255,255,.25); }
    #valorLabel .un { font-weight: 500; color: #9fb4d6; font-size: 11px; }
    #valorLabel.none { color: #9fb4d6; font-weight: 500; }
  `;
  document.head.appendChild(css);
}

function buildCross(container) {
  const wrap = document.createElement('div');
  wrap.id = 'valorCross';
  wrap.innerHTML = `
    <svg viewBox="0 0 32 32" aria-hidden="true">
      <g stroke="#000" stroke-opacity=".85" stroke-width="4" stroke-linecap="round">
        <line x1="16" y1="1" x2="16" y2="11"/><line x1="16" y1="21" x2="16" y2="31"/>
        <line x1="1" y1="16" x2="11" y2="16"/><line x1="21" y1="16" x2="31" y2="16"/>
      </g>
      <g stroke="#fff" stroke-width="2" stroke-linecap="round">
        <line x1="16" y1="1" x2="16" y2="11"/><line x1="16" y1="21" x2="16" y2="31"/>
        <line x1="1" y1="16" x2="11" y2="16"/><line x1="21" y1="16" x2="31" y2="16"/>
      </g>
    </svg>
    <div id="valorLabel"><span class="sw"></span><span class="tx"></span></div>
  `;
  container.appendChild(wrap);
  return wrap;
}

// ---------------------------------------------------------------------------
// API
// ---------------------------------------------------------------------------

/**
 * @param {object}   opts
 * @param {object}   opts.map             instància de maplibregl.Map
 * @param {Function} opts.getLayerState   radar.getLayerState (ha de retornar currentUrl)
 * @param {Function} opts.getKey          () => 'dbz' | 'lluvia' | 'acum'
 * @param {Function} [opts.isRadarVisible] () => boolean
 * @param {Function} [opts.getAcumUrl]    () => string|null   (URL del PNG d'acumulació actiu)
 */
export function initValor({
  map,
  getLayerState,
  getKey,
  isRadarVisible = () => true,
  getAcumUrl = null,
}) {
  injectStyles();

  const mapEl = map.getContainer();
  const canvasContainer = map.getCanvasContainer();
  const root = buildCross(mapEl);
  const label = root.querySelector('#valorLabel');
  const sw = label.querySelector('.sw');
  const tx = label.querySelector('.tx');

  let enabled = true;
  let point = null;        // {x, y} en píxels dins del mapa
  let isTouch = false;
  let hideTimer = 0;

  function hide() {
    root.classList.remove('show');
    mapEl.classList.remove('valor-on');
    point = null;
  }

  function placeLabel() {
    const w = label.offsetWidth;
    const h = label.offsetHeight;
    const W = mapEl.clientWidth;
    let lx, ly;

    if (isTouch) {            // al mòbil: a sobre del dit
      lx = -w / 2;
      ly = -(h + 54);
      if (point.y + ly < 8) ly = 38;
    } else {                  // a l'ordinador: a la dreta i amunt
      lx = 20;
      ly = -(h + 14);
      if (point.x + lx + w > W - 8) lx = -(w + 20);
      if (point.y + ly < 8) ly = 18;
    }
    if (point.x + lx < 8) lx = 8 - point.x;
    if (point.x + lx + w > W - 8) lx = W - 8 - w - point.x;

    label.style.left = lx + 'px';
    label.style.top = ly + 'px';
  }

  function render(text, unit, color, none) {
    label.classList.toggle('none', !!none);
    sw.style.display = color ? 'block' : 'none';
    if (color) sw.style.background = color;
    tx.innerHTML = unit ? `${text} <span class="un">${unit}</span>` : text;
  }

  /**
   * Retorna la URL del PNG a llegir segons el mode actual:
   *   - 'acum' → getAcumUrl()
   *   - 'dbz' / 'lluvia' → radar.getLayerState(key).currentUrl
   */
  function urlActual(key) {
    if (key === 'acum') {
      return getAcumUrl ? getAcumUrl() : null;
    }
    const st = getLayerState(key);
    return st ? st.currentUrl : null;
  }

  function update() {
    if (!enabled || !point || !isRadarVisible()) { hide(); return; }

    root.style.transform = `translate(${point.x}px, ${point.y}px)`;
    root.classList.add('show');
    if (!isTouch) mapEl.classList.add('valor-on');

    const key = getKey();
    const scale = SCALES[key];
    const url = urlActual(key);

    if (!scale || !url) { hide(); return; }

    const ll = map.unproject([point.x, point.y]);
    const { u, v } = lngLatToUV(ll.lng, ll.lat);

    if (u < 0 || u > 1 || v < 0 || v > 1) {
      render('Fora de cobertura', '', null, true);
      placeLabel();
      return;
    }

    const img = getImage(url, update);
    if (!img) { render('…', '', null, true); placeLabel(); return; }

    const px = readPixel(img, u, v);
    if (px.a < MIN_ALPHA) {
      // Per a l'acumulació diem "Sense pluja", per a la resta "Sense eco"
      render(key === 'acum' ? 'Sense pluja' : 'Sense eco', '', null, true);
      placeLabel();
      return;
    }

    const val = colorToValue(px.r, px.g, px.b, scale);
    if (val === null) {
      render(key === 'acum' ? 'Sense pluja' : 'Sense eco', '', null, true);
    } else {
      render(scale.format(val), scale.unit, `rgb(${px.r},${px.g},${px.b})`, false);
    }
    placeLabel();
  }

  // ----- ratolí -----
  function pointFromEvent(clientX, clientY) {
    const r = mapEl.getBoundingClientRect();
    return { x: clientX - r.left, y: clientY - r.top };
  }

  canvasContainer.addEventListener('mousemove', (e) => {
    clearTimeout(hideTimer);
    isTouch = false;
    point = pointFromEvent(e.clientX, e.clientY);
    update();
  });
  canvasContainer.addEventListener('mouseleave', hide);

  // ----- dit -----
  function onTouch(e) {
    if (e.touches.length !== 1) { hide(); return; }
    clearTimeout(hideTimer);
    isTouch = true;
    const t = e.touches[0];
    point = pointFromEvent(t.clientX, t.clientY);
    update();
  }
  canvasContainer.addEventListener('touchstart', onTouch, { passive: true });
  canvasContainer.addEventListener('touchmove', onTouch, { passive: true });
  const onTouchEnd = () => { hideTimer = setTimeout(hide, 1500); };
  canvasContainer.addEventListener('touchend', onTouchEnd, { passive: true });
  canvasContainer.addEventListener('touchcancel', onTouchEnd, { passive: true });

  // El mapa es mou sota el dit/ratolí: tornem a llegir
  map.on('move', () => { if (point) update(); });

  // Canvi de frame de l'animació (o de període d'acumulació): actualitzem el valor
  let lastUrl = null;
  (function watch() {
    if (point) {
      const url = urlActual(getKey());
      if (url && url !== lastUrl) { lastUrl = url; update(); }
    }
    requestAnimationFrame(watch);
  })();

  return {
    setEnabled(on) {
      enabled = !!on;
      if (!enabled) hide();
    },
    isEnabled: () => enabled,
  };
}

export default { initValor };