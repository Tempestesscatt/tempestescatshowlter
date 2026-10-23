// public/dades/valor.js
// Creu al lloc del cursor/dit amb el valor del radar (dBZ o VRADH).
//
// Llegeix el píxel del PNG del frame visible i el converteix en valor buscant
// el color més proper a l'escala (dades/escales.js).
// Reutilitza el blob que radar.js ja té a memòria (cap descàrrega extra).

import { SCALES, colorToValue, lngLatToUV, MIN_ALPHA } from './escales.js';

// ---------------------------------------------------------------------------
// CACHE D'IMATGES
// ---------------------------------------------------------------------------
const imgCache = new Map();
const MAX_CACHE = 8;

function getImage(url, onLoad) {
  const hit = imgCache.get(url);
  if (hit) {
    imgCache.delete(url);
    imgCache.set(url, hit);
    return hit.complete && hit.naturalWidth ? hit : null;
  }
  const img = new Image();
  img.crossOrigin = 'anonymous';
  img.onload = onLoad || null;
  img.onerror = () => imgCache.delete(url);
  img.src = url;
  imgCache.set(url, img);
  while (imgCache.size > MAX_CACHE) imgCache.delete(imgCache.keys().next().value);
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

export function initValor({
  map,
  getLayerState,
  getKey,
  isRadarVisible = () => true,
}) {
  injectStyles();

  const mapEl = map.getContainer();
  const canvasContainer = map.getCanvasContainer();
  const root = buildCross(mapEl);
  const label = root.querySelector('#valorLabel');
  const sw = label.querySelector('.sw');
  const tx = label.querySelector('.tx');

  let enabled = true;
  let point = null;
  let isTouch = false;
  let hideTimer = 0;
  let lastKey = null;
  let lastUrl = null;

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
    tx.textContent = text;
    if (unit) {
      const un = document.createElement('span');
      un.className = 'un';
      un.textContent = ' ' + unit;
      tx.appendChild(un);
    }
  }

  function urlActual(key) {
    const st = getLayerState(key);
    if (!st) return null;
    return st.currentBlob || st.currentUrl || null;
  }

  function update() {
    if (!enabled || !point) { hide(); return; }
    if (!isRadarVisible()) { hide(); return; }

    root.style.transform = `translate(${point.x}px, ${point.y}px)`;
    root.classList.add('show');
    if (!isTouch) mapEl.classList.add('valor-on');

    const key = getKey();
    const scale = SCALES[key];
    if (!scale) { console.warn('[valor] SCALES[' + key + '] no existeix'); hide(); return; }

    const url = urlActual(key);
    if (!url) { console.warn('[valor] urlActual(' + key + ') = null'); hide(); return; }

    const ll = map.unproject([point.x, point.y]);
    const { u, v } = lngLatToUV(ll.lng, ll.lat);

    if (u < 0 || u > 1 || v < 0 || v > 1) {
      render('Fora de cobertura', '', null, true);
      placeLabel();
      return;
    }

    const img = getImage(url, () => update());
    if (!img) { render('…', '', null, true); placeLabel(); return; }

    const px = readPixel(img, u, v);
    if (px.a < MIN_ALPHA) { render('Sense eco', '', null, true); placeLabel(); return; }

    const val = colorToValue(px.r, px.g, px.b, scale);
    if (val === null) {
      render('Sense eco', '', null, true);
    } else {
      render(scale.format(val), scale.unit, `rgb(${px.r},${px.g},${px.b})`, false);
    }
    placeLabel();
  }

  const pointFromEvent = (cx, cy) => {
    const r = mapEl.getBoundingClientRect();
    return { x: cx - r.left, y: cy - r.top };
  };

  canvasContainer.addEventListener('mousemove', (e) => {
    clearTimeout(hideTimer);
    isTouch = false;
    point = pointFromEvent(e.clientX, e.clientY);
    update();
  });
  canvasContainer.addEventListener('mouseleave', hide);

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

  map.on('move', () => { if (point) update(); });

  (function watch() {
    if (point) {
      const key = getKey();
      const url = urlActual(key);
      if (key !== lastKey || url !== lastUrl) {
        lastKey = key;
        lastUrl = url;
        update();
      }
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