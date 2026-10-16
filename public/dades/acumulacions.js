// public/dades/acumulacions.js
// -----------------------------------------------------------------------------
// Acumulacions de pluja (mm) generades pel Python (cumul.py).
//
// El Python ja ha fet tota la feina:
//   - ha integrat els mm/h del Nimbus en el temps,
//   - ha pintat un PNG per a cada període (30 min, 1h, 3h, 6h, 12h, 24h)
//     amb una escala de colors pròpia (ACUM_STOPS),
//   - ha escrit un manifest.json amb la llista de períodes.
//
// Aquest mòdul:
//   1) llegeix el manifest,
//   2) dona la URL del PNG que toca,
//   3) dona les coordenades per a l'image source de MapLibre,
//   4) permet consultar el valor (mm) en un punt concret,
//   5) pinta una creu tipus "+" amb l'etiqueta del valor al ratolí/dit.
// -----------------------------------------------------------------------------

// ---------------------------------------------------------------------------
// CONFIGURACIÓ
// ---------------------------------------------------------------------------

export const REGIO = {
  lat_min: 35.5,
  lat_max: 44.0,
  lon_min: -10.0,
  lon_max: 5.0,
};

export const W = 2000;
export const H = 2000;

// Períodes per defecte que genera el Python
export const STD_PERIODS = [30, 60, 180, 360, 720, 1440];

// Escala de colors de l'acumulació (la mateixa que pinta el Python).
// La usem per a la llegenda i per al valor sota el cursor.
export const ACUM_SCALE = {
  unit: 'mm',
  min: 0.2,
  max: 1000,
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
  ticks: [0.2, 1, 5, 10, 30, 50, 100, 200, 500, 1000],
};

// Llindars per llegir el color del PNG (han de coincidir amb el Python)
const MIN_ALPHA = 30;
const MAX_COLOR_DIST = 90;

// ---------------------------------------------------------------------------
// MANIFEST
// ---------------------------------------------------------------------------

export async function loadManifest(baseUrl) {
  try {
    const url = `${baseUrl.replace(/\/$/, '')}/manifest.json?t=${Date.now()}`;
    const r = await fetch(url, { cache: 'no-store' });
    if (!r.ok) return null;
    return await r.json();
  } catch (e) {
    console.warn('[acumulacions] manifest no disponible', e);
    return null;
  }
}

/**
 * Retorna la llista de períodes disponibles amb la seva URL de PNG.
 * @returns {Array<{min:number, url:string, max_mm:number, t:string}>}
 */
export function periodsFromManifest(manifest, baseUrl) {
  if (!manifest || !Array.isArray(manifest.frames)) return [];
  const dir = baseUrl.replace(/\/$/, '');
  const ext = manifest.ext || '.png';
  const prefix = manifest.prefix || '';
  return manifest.frames
    .map((fr) => {
      if (!fr || !fr.f || fr.min == null) return null;
      return {
        min: Number(fr.min),
        url: `${dir}/${prefix}${fr.f}${ext}`,
        max_mm: Number(fr.max_mm || 0),
        t: fr.t || manifest.last_timestamp || null,
      };
    })
    .filter(Boolean)
    .sort((a, b) => a.min - b.min);
}

// ---------------------------------------------------------------------------
// POSICIÓ -> PÍXEL DEL PNG (Mercator, igual que el Python i valor.js)
// ---------------------------------------------------------------------------

const _mercY = (latDeg) => Math.asinh(Math.tan(latDeg * Math.PI / 180));
const _MERC_N = _mercY(REGIO.lat_max);
const _MERC_S = _mercY(REGIO.lat_min);

export function lngLatToUV(lng, lat) {
  const u = (lng - REGIO.lon_min) / (REGIO.lon_max - REGIO.lon_min);
  const v = (_MERC_N - _mercY(lat)) / (_MERC_N - _MERC_S);
  return { u, v };
}

export function regioCoordinates() {
  const { lon_min, lon_max, lat_min, lat_max } = REGIO;
  return [
    [lon_min, lat_max], // TL
    [lon_max, lat_max], // TR
    [lon_max, lat_min], // BR
    [lon_min, lat_min], // BL
  ];
}

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
// CACHÉ D'IMATGES I LECTURA DE PÍXEL
// ---------------------------------------------------------------------------

const imgCache = new Map();
const MAX_CACHE = 32;

function getImage(url, onLoad) {
  let entry = imgCache.get(url);
  if (entry) return entry.complete && entry.naturalWidth ? entry : null;
  entry = new Image();
  entry.crossOrigin = 'anonymous';
  if (onLoad) entry.onload = onLoad;
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

/**
 * Valor d'acumulació (mm) en un punt (lng, lat) per a un període concret.
 */
export function valorEnUrl(url, lng, lat) {
  const { u, v } = lngLatToUV(lng, lat);
  if (u < 0 || u > 1 || v < 0 || v > 1) return 0;

  const img = getImage(url);
  if (!img) return null;

  const px = readPixel(img, u, v);
  if (px.a < MIN_ALPHA) return 0;

  const val = colorToValue(px.r, px.g, px.b, ACUM_SCALE);
  return val === null ? 0 : val;
}

// ---------------------------------------------------------------------------
// HELPERS
// ---------------------------------------------------------------------------

export function colorAt(mm) {
  const p = ACUM_SCALE;
  if (mm <= p.min) {
    const c = p.stops[0][1];
    return `rgb(${c[0]},${c[1]},${c[2]})`;
  }
  if (mm >= p.max) {
    const c = p.stops[p.stops.length - 1][1];
    return `rgb(${c[0]},${c[1]},${c[2]})`;
  }
  const lx = Math.log10(mm);
  for (let i = 0; i < p.stops.length - 1; i++) {
    const [v0, c0] = p.stops[i];
    const [v1, c1] = p.stops[i + 1];
    const l0 = Math.log10(v0), l1 = Math.log10(v1);
    if (lx >= l0 && lx <= l1) {
      const t = (lx - l0) / (l1 - l0);
      const r = Math.round(c0[0] + (c1[0] - c0[0]) * t);
      const g = Math.round(c0[1] + (c1[1] - c0[1]) * t);
      const b = Math.round(c0[2] + (c1[2] - c0[2]) * t);
      return `rgb(${r},${g},${b})`;
    }
  }
  return 'rgb(255,255,255)';
}

export function formatMm(v) {
  if (v == null) return '—';
  if (v >= 1000) return '1000+';
  if (v >= 100) return v.toFixed(0);
  if (v >= 10) return v.toFixed(1);
  if (v >= 1) return v.toFixed(1);
  return v.toFixed(2);
}

// ---------------------------------------------------------------------------
// INTERFÍCIE: creu tipus "+" amb l'etiqueta del valor
// ---------------------------------------------------------------------------

function injectStylesAcum() {
  if (document.getElementById('acum-valor-styles')) return;
  const css = document.createElement('style');
  css.id = 'acum-valor-styles';
  css.textContent = `
    .acum-valor-on, .acum-valor-on * { cursor: none !important; }
    #acumValorCross {
      position: absolute; left: 0; top: 0; z-index: 12; pointer-events: none;
      width: 0; height: 0; display: none;
    }
    #acumValorCross.show { display: block; }
    #acumValorCross svg {
      position: absolute; left: -16px; top: -16px; width: 32px; height: 32px;
      overflow: visible; filter: drop-shadow(0 0 2px rgba(0,0,0,.6));
    }
    #acumValorLabel {
      position: absolute; white-space: nowrap; display: flex; align-items: center; gap: 7px;
      padding: 5px 10px 5px 7px; border-radius: 9px;
      background: rgba(10, 12, 20, .9); color: #fff;
      border: 1px solid rgba(120, 140, 180, .35);
      box-shadow: 0 6px 20px rgba(0, 0, 0, .5);
      font: 600 13px/1 system-ui, -apple-system, "Segoe UI", Roboto, sans-serif;
      font-variant-numeric: tabular-nums;
    }
    #acumValorLabel .sw { width: 12px; height: 12px; border-radius: 3px; border: 1px solid rgba(255,255,255,.25); }
    #acumValorLabel .un { font-weight: 500; color: #9fb4d6; font-size: 11px; }
    #acumValorLabel.none { color: #9fb4d6; font-weight: 500; }
  `;
  document.head.appendChild(css);
}

function buildAcumCross(container) {
  const wrap = document.createElement('div');
  wrap.id = 'acumValorCross';
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
    <div id="acumValorLabel"><span class="sw"></span><span class="tx"></span></div>
  `;
  container.appendChild(wrap);
  return wrap;
}

/**
 * Activa la creu "+" amb el valor de l'acumulació sota el ratolí/dit.
 *
 * @param {object}   opts
 * @param {object}   opts.map             maplibregl.Map
 * @param {Function} opts.getPeriodUrl    () => string|null   URL del PNG del període actiu
 * @param {Function} opts.isEnabled       () => boolean       (si la capa d'acumulació està activa)
 * @returns {{ setEnabled(on:boolean):void, isEnabled():boolean }}
 */
export function initAcumValor({ map, getPeriodUrl, isEnabled = () => true }) {
  injectStylesAcum();

  const mapEl = map.getContainer();
  const canvasContainer = map.getCanvasContainer();
  const root = buildAcumCross(mapEl);
  const label = root.querySelector('#acumValorLabel');
  const sw = label.querySelector('.sw');
  const tx = label.querySelector('.tx');

  let enabled = true;
  let point = null;       // {x, y} píxels dins del mapa
  let isTouch = false;
  let hideTimer = 0;

  function hide() {
    root.classList.remove('show');
    mapEl.classList.remove('acum-valor-on');
    point = null;
  }

  function placeLabel() {
    const w = label.offsetWidth;
    const h = label.offsetHeight;
    const W = mapEl.clientWidth;
    let lx, ly;

    if (isTouch) {
      lx = -w / 2;
      ly = -(h + 54);
      if (point.y + ly < 8) ly = 38;
    } else {
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

  function update() {
    if (!enabled || !point || !isEnabled()) { hide(); return; }

    const url = getPeriodUrl();
    if (!url) { hide(); return; }

    root.style.transform = `translate(${point.x}px, ${point.y}px)`;
    root.classList.add('show');
    if (!isTouch) mapEl.classList.add('acum-valor-on');

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
      render('Sense pluja', '', null, true);
      placeLabel();
      return;
    }

    const val = colorToValue(px.r, px.g, px.b, ACUM_SCALE);
    if (val === null) {
      render('Sense pluja', '', null, true);
    } else {
      render(formatMm(val), ACUM_SCALE.unit, `rgb(${px.r},${px.g},${px.b})`, false);
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

  // Canvi de període: si està actiu, refresquem
  let lastUrl = null;
  (function watch() {
    if (point && enabled && isEnabled()) {
      const url = getPeriodUrl();
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

export default {
  REGIO, W, H, STD_PERIODS, ACUM_SCALE,
  loadManifest, periodsFromManifest,
  lngLatToUV, regioCoordinates,
  valorEnUrl, colorAt, formatMm,
  initAcumValor,
};