// public/js/stickers.js
// Radares individuals (un PNG per radar). Llegeix els manifests globals
// generats per radar-real.py v5:
//   /dades_radar_dbz/manifest.json          (DBZH)
//   /dades_radar_velocitat/manifest.json    (VRADH)
//
// API pública (la que fa servir index.html):
//   initStickers({ map, base, getBefore, afterLayers, onUpdate }) -> stk
//   isSticker(key) -> bool
//   STICKER_KEYS -> ['sdbz', 'svel']
//
// Mètodes de l'objecte retornat:
//   load(key)            -> Promise<bool>   Carrega el manifest + frames
//   setActive(key|null)                     Activa/desactiva un producte sticker
//   getLayerState(key)   -> { timestamps, frames, currentIndex, minIndex, ... }
//   goToFrame(key, i)                       Canvia de frame (respecta minIndex)
//   setMinIndex(key, i)                     Bloqueja frames antics (premium)
//   setVisibility(key, v)                   Mostra/amaga les capes del producte
//   syncToTime(key, ms)  -> Promise<int>    Salta al frame més proper a ms
//   getScale(key)        -> { title, unit, min, max, stops, ticks, log } | null
//   valueAt(lngLat)      -> Promise<{ text, sub, radar } | null>
//   pause() / resume()                      Atura/reprèn l'animació
//   refresh(key)         -> Promise<void>   Revalida el manifest i recarrega
//   reapply()                               Torna a afegir les capes (canvi de tema)

// ---------------------------------------------------------------------------
// CONFIGURACIÓ
// ---------------------------------------------------------------------------

const PRODUCTS = {
  sdbz: {
    label: 'Reflectivitat per radar (dBZ)',
    manifestUrl: '/dades_radar_dbz/manifest.json',
    basePath: '/dades_radar_dbz',
    unit: 'dBZ',
    defaultOpacity: 0.85,
  },
  svel: {
    label: 'Velocitat Doppler (km/h)',
    manifestUrl: '/dades_radar_velocitat/manifest.json',
    basePath: '/dades_radar_velocitat',
    unit: 'km/h',
    defaultOpacity: 0.85,
  },
};

export const STICKER_KEYS = Object.keys(PRODUCTS);

export function isSticker(key) {
  return !!PRODUCTS[key];
}

// ---------------------------------------------------------------------------
// CONSTANTS
// ---------------------------------------------------------------------------

const FPS = 3;
const LOOP = true;

const LOW_END = (() => {
  try {
    const c = navigator.connection;
    if (c && (c.saveData || /(^|-)2g$/.test(c.effectiveType || ''))) return true;
    if (navigator.deviceMemory && navigator.deviceMemory <= 2) return true;
  } catch (e) { /* ignore */ }
  return false;
})();

const MAX_PARALLEL = LOW_END ? 3 : 6;
const FETCH_TIMEOUT_MS = 12000;
const FETCH_RETRIES = 3;
const FIRST_FRAME_WAIT_MS = 1500;
const BOOT_FRAMES = LOW_END ? 2 : 4;
const PRELOAD_FRAMES = LOW_END ? 8 : 24;
const KEEP_BLOBS = LOW_END ? 32 : 120;
const REFRESH_MS = 30000;

const noop = () => {};
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

// ---------------------------------------------------------------------------
// ESTAT
// ---------------------------------------------------------------------------

const vis = (v) => (v ? 'visible' : 'none');

const state = {
  map: null,
  base: '',
  getBefore: () => null,
  afterLayers: () => {},
  onUpdate: () => {},
  activeKey: null,
  // { sdbz: { radars: [...], escala: {...}, updated: str }, svel: {...} }
  manifests: {},
  // { sdbz: { radars: [ { id, nom, coords, frames: [url], timestamps: [Date],
  //                     currentIndex, minIndex, layers: { sourceId, layerId } } ],
  //            visible, opacity, active, applied: Map<radarId, url>, wanted: Map<radarId, url> } }
  layers: {},
};

// Cola de descàrrega (compartida entre tots els radars)
const blobCache = new Map();      // url -> blob URL
const failed = new Set();         // url
const frameMeta = new Map();      // url -> { key, radarId, index }
const queued = new Map();         // url -> entry
const inflight = new Map();       // url -> Promise
const queue = [];
let activeDownloads = 0;

if (typeof window !== 'undefined') {
  window.__stickers = { state, blobCache, failed };
}

// ---------------------------------------------------------------------------
// DESCÀRREGA
// ---------------------------------------------------------------------------

async function downloadBlob(url) {
  let lastErr = null;
  for (let attempt = 0; attempt < FETCH_RETRIES; attempt++) {
    const ctrl = new AbortController();
    const timer = setTimeout(() => ctrl.abort(), FETCH_TIMEOUT_MS);
    try {
      const r = await fetch(url, { mode: 'cors', signal: ctrl.signal, cache: 'no-cache' });
      if (!r.ok) throw new Error('HTTP ' + r.status);
      const blob = await r.blob();
      if (!blob.size) throw new Error('buit');
      return URL.createObjectURL(blob);
    } catch (e) {
      lastErr = e;
      if (attempt < FETCH_RETRIES - 1) await sleep(300 * (attempt + 1));
    } finally {
      clearTimeout(timer);
    }
  }
  throw lastErr || new Error('error desconegut');
}

const layerPrio = (key) => (state.layers[key] && state.layers[key].visible ? 1 : 2);

function pickNext() {
  let bestI = -1, bestPrio = 99;
  for (let i = 0; i < queue.length; i++) {
    if (queue[i].prio < bestPrio) {
      bestPrio = queue[i].prio; bestI = i;
      if (bestPrio === 0) break;
    }
  }
  return bestI < 0 ? null : queue.splice(bestI, 1)[0];
}

function pump() {
  while (activeDownloads < MAX_PARALLEL) {
    const entry = pickNext();
    if (!entry) return;
    queued.delete(entry.url);
    if (blobCache.has(entry.url)) { entry.resolve(blobCache.get(entry.url)); continue; }
    if (entry.prio > 0 && failed.has(entry.url)) { entry.reject(new Error('fallit')); continue; }
    if (entry.prio > 0 && !frameMeta.has(entry.url)) { entry.reject(new Error('retirat')); continue; }

    activeDownloads++;
    const p = downloadBlob(entry.url)
      .then((objUrl) => {
        blobCache.set(entry.url, objUrl);
        failed.delete(entry.url);
        entry.resolve(objUrl);
      })
      .catch((e) => {
        failed.add(entry.url);
        console.warn('[stickers] no s\'ha pogut baixar', entry.url, e.message);
        entry.reject(e);
      })
      .finally(() => {
        activeDownloads--;
        inflight.delete(entry.url);
        pump();
      });
    inflight.set(entry.url, p);
  }
}

function requestFrame(url, prio) {
  if (blobCache.has(url)) return Promise.resolve(blobCache.get(url));
  const existing = queued.get(url);
  if (existing) { if (prio < existing.prio) existing.prio = prio; return existing.promise; }
  if (inflight.has(url)) return inflight.get(url).then(() => blobCache.get(url));

  const entry = { url, prio };
  entry.promise = new Promise((resolve, reject) => { entry.resolve = resolve; entry.reject = reject; });
  entry.promise.catch(noop);
  queued.set(url, entry);
  queue.push(entry);
  pump();
  return entry.promise;
}

function trimBlobs() {
  if (blobCache.size <= KEEP_BLOBS) return;
  // Esborra els blobs més antics que no estiguin en ús
  const inUse = new Set();
  for (const key of Object.keys(state.layers)) {
    const st = state.layers[key];
    for (const radar of st.radars) {
      const cur = radar.frames[radar.currentIndex];
      if (cur) inUse.add(cur);
      for (const u of radar.wanted?.values?.() || []) inUse.add(u);
      for (const u of radar.applied?.values?.() || []) inUse.add(u);
    }
  }
  for (const [url, blob] of blobCache) {
    if (blobCache.size <= KEEP_BLOBS) break;
    if (inUse.has(url)) continue;
    URL.revokeObjectURL(blob);
    blobCache.delete(url);
  }
}

// ---------------------------------------------------------------------------
// MANIFEST
// ---------------------------------------------------------------------------

async function fetchManifest(producte) {
  const cfg = PRODUCTS[producte];
  for (let i = 0; i < 3; i++) {
    try {
      const bucket = Math.floor(Date.now() / 10000);
      const r = await fetch(`${cfg.manifestUrl}?t=${bucket}`, { cache: 'no-store' });
      if (r.ok) {
        const j = await r.json();
        if (j && Array.isArray(j.radars)) return j;
      }
    } catch (e) { /* reintenta */ }
    await sleep(400 * (i + 1));
  }
  return null;
}

function parseTs(ts) {
  // "20261020T0954"
  let m = /^(\d{4})(\d{2})(\d{2})T(\d{2})(\d{2})$/.exec(ts || '');
  if (m) return new Date(Date.UTC(+m[1], +m[2] - 1, +m[3], +m[4], +m[5]));
  // "2026-10-20T09:54"
  m = /(\d{4})-(\d{2})-(\d{2})T(\d{2}):?(\d{2})/.exec(ts || '');
  return m ? new Date(Date.UTC(+m[1], +m[2] - 1, +m[3], +m[4], +m[5])) : null;
}

function hexToRgb(h) {
  h = h.replace('#', '');
  return [parseInt(h.slice(0, 2), 16), parseInt(h.slice(2, 4), 16), parseInt(h.slice(4, 6), 16)];
}

/**
 * Converteix l'escala del manifest (Python) al format de paintLegend():
 *   { min, max, stops: [[v, [r,g,b]], ...], ticks: [...], log: false, title, unit }
 */
function buildScale(manifest, key) {
  const esc = manifest && manifest.escala;
  if (!esc || !Array.isArray(esc.colors) || esc.colors.length === 0) return null;
  const unit = esc.unitat || PRODUCTS[key].unit;
  const min = Number(esc.inici);
  const step = Number(esc.pas);
  const stops = [];
  for (let i = 0; i < esc.colors.length; i++) {
    stops.push([min + i * step, hexToRgb(esc.colors[i])]);
  }
  const max = min + (esc.colors.length - 1) * step;
  // Ticks "bonics": 5 valors repartits, arrodonits
  const ticks = [];
  const nTicks = 5;
  for (let i = 0; i < nTicks; i++) {
    const v = min + (max - min) * (i / (nTicks - 1));
    ticks.push(Math.round(v * 10) / 10);
  }
  return {
    title: PRODUCTS[key].label,
    unit,
    min,
    max,
    stops,
    ticks,
    log: false,
  };
}

// ---------------------------------------------------------------------------
// CAPES
// ---------------------------------------------------------------------------

function sourceId(key, radarId) { return `stk-src-${key}-${radarId}`; }
function layerId(key, radarId) { return `stk-layer-${key}-${radarId}`; }

function addRadarSticker(map, key, radar) {
  const st = state.layers[key];
  if (!st || !radar.frames.length) return;

  const sid = sourceId(key, radar.id);
  const lid = layerId(key, radar.id);
  if (map.getLayer(lid)) map.removeLayer(lid);
  if (map.getSource(sid)) map.removeSource(sid);

  const url = radar.frames[radar.currentIndex] || radar.frames[0];
  const src = blobCache.get(url) || url;
  const coords = radar.coords;
  if (!coords || coords.length !== 4) return;

  map.addSource(sid, { type: 'image', url: src, coordinates: coords });
  map.addLayer({
    id: lid,
    type: 'raster',
    source: sid,
    layout: { visibility: vis(st.visible) },
    paint: {
      'raster-opacity': st.opacity,
      'raster-fade-duration': 0,
      'raster-resampling': 'linear',
    },
  });
  radar.applied = radar.applied || new Map();
  radar.wanted = radar.wanted || new Map();
  radar.applied.set(radar.id, url);
  radar.wanted.set(radar.id, url);
}

function removeAllStickerLayers(map, key) {
  const st = state.layers[key];
  if (!st) return;
  for (const radar of st.radars) {
    const lid = layerId(key, radar.id);
    const sid = sourceId(key, radar.id);
    if (map.getLayer(lid)) map.removeLayer(lid);
    if (map.getSource(sid)) map.removeSource(sid);
  }
}

function applyWanted(key, radar) {
  const map = state.map;
  const st = state.layers[key];
  if (!map || !st) return;
  const wanted = radar.wanted.get(radar.id);
  if (!wanted) return;
  if (radar.applied.get(radar.id) === wanted) return;
  const blobUrl = blobCache.get(wanted);
  if (!blobUrl) return;
  const source = map.getSource(sourceId(key, radar.id));
  if (!source) return;
  try {
    source.updateImage({ url: blobUrl, coordinates: radar.coords });
    radar.applied.set(radar.id, wanted);
    trimBlobs();
  } catch (e) {
    console.warn('[stickers] updateImage:', e.message);
  }
}

function scheduleApply(key, radar) {
  const st = state.layers[key];
  if (!st) return;
  st.applyScheduled = st.applyScheduled || new Set();
  if (st.applyScheduled.has(radar.id)) return;
  st.applyScheduled.add(radar.id);
  const run = () => {
    st.applyScheduled.delete(radar.id);
    applyWanted(key, radar);
  };
  if (!document.hidden && typeof requestAnimationFrame === 'function') requestAnimationFrame(run);
  else setTimeout(run, 0);
}

function showRadarFrame(key, radar, index) {
  if (!radar.frames.length) return;
  if (index < radar.minIndex) index = radar.minIndex;
  if (index < 0 || index >= radar.frames.length) return;
  radar.currentIndex = index;
  const url = radar.frames[index];
  radar.wanted.set(radar.id, url);
  if (blobCache.has(url)) {
    scheduleApply(key, radar);
  } else {
    requestFrame(url, 0).then(() => {
      if (radar.wanted.get(radar.id) === url) scheduleApply(key, radar);
    }).catch(noop);
  }
}

function nearestIndex(radar, ms) {
  let best = -1;
  let bestD = Infinity;
  for (let i = radar.minIndex; i < radar.timestamps.length; i++) {
    const d = radar.timestamps[i];
    if (!d) continue;
    const dd = Math.abs(d.getTime() - ms);
    if (dd < bestD) { bestD = dd; best = i; }
  }
  return best;
}

// ---------------------------------------------------------------------------
// CARREGAR UN PRODUCTE (manifest + radars + frames)
// ---------------------------------------------------------------------------

async function loadProduct(key) {
  if (!PRODUCTS[key]) return false;
  const st = state.layers[key] = state.layers[key] || {
    radars: [],
    visible: false,
    opacity: PRODUCTS[key].defaultOpacity,
    active: false,
    initialized: false,
    applyScheduled: new Set(),
  };

  const manifest = await fetchManifest(key);
  if (!manifest) return false;
  state.manifests[key] = manifest;

  // (Re)construeix la llista de radars
  const oldById = new Map(st.radars.map((r) => [r.id, r]));
  const radars = [];
  const ext = manifest.ext || '.png';

  for (const r of manifest.radars) {
    if (!r || !r.id || !Array.isArray(r.frames) || r.frames.length === 0) continue;
    const coords = Array.isArray(r.coords) && r.coords.length === 4 ? r.coords : null;
    if (!coords) continue;

    const frames = [];
    const timestamps = [];
    for (const item of r.frames) {
      if (!item || !item.f) continue;
      frames.push(`${PRODUCTS[key].basePath}/${r.id}/${item.f}${ext}`);
      timestamps.push(parseTs(item.t));
    }
    if (frames.length === 0) continue;

    const prev = oldById.get(r.id);
    const curIdx = prev && prev.timestamps.length
      ? (prev.currentIndex >= prev.timestamps.length - 1
          ? frames.length - 1
          : Math.min(prev.currentIndex, frames.length - 1))
      : frames.length - 1;
    const minIdx = prev ? Math.min(prev.minIndex, frames.length - 1) : 0;

    // Neteja frameMeta antic
    if (prev) for (const u of prev.frames) frameMeta.delete(u);
    frames.forEach((u, i) => { frameMeta.set(u, { key, radarId: r.id, index: i }); failed.delete(u); });

    radars.push({
      id: r.id,
      nom: r.nom || r.id,
      coords,
      frames,
      timestamps,
      currentIndex: Math.max(minIdx, curIdx),
      minIndex: minIdx,
      applied: prev ? prev.applied : new Map(),
      wanted: prev ? prev.wanted : new Map(),
    });
  }

  st.radars = radars;
  st.initialized = radars.length > 0;
  st.scale = buildScale(manifest, key);

  // Precarrega el frame actual + els propers de cada radar
  for (const radar of radars) {
    const cur = radar.frames[radar.currentIndex];
    if (cur) requestFrame(cur, 0);
    const from = Math.max(radar.minIndex, radar.frames.length - PRELOAD_FRAMES);
    for (let i = radar.frames.length - 2; i >= from; i--) {
      requestFrame(radar.frames[i], layerPrio(key));
    }
  }

  return radars.length > 0;
}

// ---------------------------------------------------------------------------
// ANIMACIÓ
// ---------------------------------------------------------------------------

let intervalId = 0;

function nextReadyIndex(radar) {
  const n = radar.frames.length;
  const span = n - radar.minIndex;
  if (span <= 0) return -1;
  const cur = Math.max(radar.currentIndex, radar.minIndex);
  for (let step = 1; step <= span; step++) {
    if (!LOOP && cur + step >= n) return -1;
    const i = radar.minIndex + ((cur - radar.minIndex + step) % span);
    if (blobCache.has(radar.frames[i])) return i;
  }
  return -1;
}

function tick() {
  if (document.hidden) return;
  for (const key of Object.keys(state.layers)) {
    const st = state.layers[key];
    if (!st || !st.visible || !st.initialized) continue;
    for (const radar of st.radars) {
      const idx = nextReadyIndex(radar);
      if (idx >= 0 && idx !== radar.currentIndex) showRadarFrame(key, radar, idx);
    }
  }
}

function startAnimation() {
  stopAnimation();
  intervalId = setInterval(tick, 1000 / FPS);
}

function stopAnimation() {
  if (intervalId) clearInterval(intervalId);
  intervalId = 0;
}

// ---------------------------------------------------------------------------
// VALUE AT (llegir el píxel del PNG sota el cursor)
// ---------------------------------------------------------------------------

const imageCache = new Map();   // blobUrl -> { img: HTMLImageElement, canvas, data: ImageData }
const MAX_IMAGE_CACHE = 8;

function loadImageData(blobUrl) {
  const cached = imageCache.get(blobUrl);
  if (cached) return Promise.resolve(cached);

  return new Promise((resolve, reject) => {
    const img = new Image();
    img.crossOrigin = 'anonymous';
    img.onload = () => {
      const canvas = document.createElement('canvas');
      canvas.width = img.naturalWidth;
      canvas.height = img.naturalHeight;
      const ctx = canvas.getContext('2d', { willReadFrequently: true });
      ctx.drawImage(img, 0, 0);
      let data = null;
      try { data = ctx.getImageData(0, 0, canvas.width, canvas.height); } catch (e) { /* CORS */ }
      const entry = { img, canvas, data };
      imageCache.set(blobUrl, entry);
      while (imageCache.size > MAX_IMAGE_CACHE) {
        const firstKey = imageCache.keys().next().value;
        imageCache.delete(firstKey);
      }
      resolve(entry);
    };
    img.onerror = () => reject(new Error('no s\'ha pogut carregar la imatge'));
    img.src = blobUrl;
  });
}

/** Converteix [r,g,b] en valor físic segons l'escala del manifest. */
function rgbToValue(rgb, scale) {
  if (!scale) return null;
  const [r, g, b] = rgb;
  // Cerca lineal entre els stops
  let bestV = null, bestD = Infinity;
  for (const [v, c] of scale.stops) {
    const d = (c[0] - r) ** 2 + (c[1] - g) ** 2 + (c[2] - b) ** 2;
    if (d < bestD) { bestD = d; bestV = v; }
  }
  return bestV;
}

/** Projecta lngLat al píxel del PNG d'un radar (bbox NW/NE/SE/SW). */
function lngLatToPixel(radar, lng, lat, imgW, imgH) {
  const c = radar.coords;
  const west = c[0][0], north = c[0][1];
  const east = c[2][0], south = c[2][1];
  if (lng < west || lng > east || lat < south || lat > north) return null;
  const x = ((lng - west) / (east - west)) * imgW;
  const y = ((north - lat) / (north - south)) * imgH;
  return [Math.round(x), Math.round(y)];
}

async function valueAt(lngLat) {
  const key = state.activeKey;
  if (!key || !state.layers[key] || !state.layers[key].visible) return null;
  const st = state.layers[key];
  const scale = st.scale;
  if (!scale) return null;

  const { lng, lat } = lngLat;
  let best = null;

  for (const radar of st.radars) {
    const url = radar.applied.get(radar.id);
    if (!url) continue;
    let entry;
    try { entry = await loadImageData(url); } catch (e) { continue; }
    if (!entry.data) continue;
    const imgW = entry.canvas.width, imgH = entry.canvas.height;
    const px = lngLatToPixel(radar, lng, lat, imgW, imgH);
    if (!px) continue;
    const [x, y] = px;
    if (x < 0 || y < 0 || x >= imgW || y >= imgH) continue;
    const i = (y * imgW + x) * 4;
    const a = entry.data.data[i + 3];
    if (a < 10) continue;   // transparent
    const rgb = [entry.data.data[i], entry.data.data[i + 1], entry.data.data[i + 2]];
    const v = rgbToValue(rgb, scale);
    if (v == null) continue;
    // Prioritza el radar amb valor més alt (o el primer)
    if (!best || Math.abs(v) > Math.abs(best.value)) {
      best = { value: v, radar: radar.nom || radar.id };
    }
  }

  if (!best) return null;

  const unit = scale.unit || '';
  const text = `${best.value.toFixed(1)} ${unit}`;
  return {
    text,
    sub: scale.title,
    radar: best.radar,
  };
}

// ---------------------------------------------------------------------------
// API PÚBLICA
// ---------------------------------------------------------------------------

export function initStickers(opts = {}) {
  state.map = opts.map || null;
  state.base = opts.base || '';
  state.getBefore = opts.getBefore || (() => null);
  state.afterLayers = opts.afterLayers || (() => {});
  state.onUpdate = opts.onUpdate || (() => {});

  if (state.map) {
    // Reordena les capes si el tema canvia
    state.map.on('style.load', () => {
      for (const key of Object.keys(state.layers)) {
        const st = state.layers[key];
        if (st && st.initialized) reapply();
      }
    });
  }

  return {
    load: async (key) => {
      const ok = await loadProduct(key);
      if (ok && state.map) {
        const st = state.layers[key];
        for (const radar of st.radars) {
          const url = radar.frames[radar.currentIndex];
          await Promise.race([requestFrame(url, 0).catch(noop), sleep(FIRST_FRAME_WAIT_MS)]);
          addRadarSticker(state.map, key, radar);
        }
        state.afterLayers();
      }
      return ok;
    },

    setActive: (key) => {
      state.activeKey = key;
      for (const k of Object.keys(state.layers)) {
        const st = state.layers[k];
        if (!st) continue;
        st.active = (k === key);
        // Visibilitat: només el producte actiu (i si està actiu)
        const show = st.active && st.visible !== false && (state.activeKey === k);
        for (const radar of st.radars) {
          if (state.map && state.map.getLayer(layerId(k, radar.id))) {
            state.map.setLayoutProperty(layerId(k, radar.id), 'visibility', vis(show));
          }
        }
      }
      if (key) startAnimation();
      else stopAnimation();
    },

    getLayerState: (key) => {
      const st = state.layers[key];
      if (!st || !st.initialized || st.radars.length === 0) return null;
      // Agafa el radar amb més frames (per la timeline global)
      let ref = st.radars[0];
      for (const r of st.radars) if (r.frames.length > ref.frames.length) ref = r;
      const cur = ref.timestamps[ref.currentIndex];
      return {
        id: key,
        label: PRODUCTS[key].label,
        totalFrames: ref.frames.length,
        loadedFrames: ref.frames.length,
        timestamps: ref.timestamps,
        currentIndex: ref.currentIndex,
        currentTime: cur ? cur.getTime() : null,
        minIndex: ref.minIndex,
        currentUrl: ref.frames[ref.currentIndex],
        frames: ref.frames,
        visible: st.visible,
        opacity: st.opacity,
        initialized: st.initialized,
        radars: st.radars.length,
      };
    },

    goToFrame: (key, index) => {
      const st = state.layers[key];
      if (!st) return;
      for (const radar of st.radars) showRadarFrame(key, radar, index);
    },

    setMinIndex: (key, idx) => {
      const st = state.layers[key];
      if (!st) return;
      for (const radar of st.radars) {
        radar.minIndex = Math.max(0, Math.min(idx, Math.max(0, radar.frames.length - 1)));
        if (radar.currentIndex < radar.minIndex) showRadarFrame(key, radar, radar.minIndex);
      }
    },

    setVisibility: (key, visible) => {
      const st = state.layers[key];
      if (!st) return;
      st.visible = visible;
      if (state.map) {
        for (const radar of st.radars) {
          const lid = layerId(key, radar.id);
          if (state.map.getLayer(lid)) state.map.setLayoutProperty(lid, 'visibility', vis(visible));
        }
      }
      if (visible) startAnimation();
      else if (!Object.values(state.layers).some((l) => l && l.visible)) stopAnimation();
    },

    syncToTime: async (key, ms) => {
      const st = state.layers[key];
      if (!st) return -1;
      let bestIdx = -1;
      for (const radar of st.radars) {
        const idx = Number.isFinite(ms) ? nearestIndex(radar, ms) : radar.frames.length - 1;
        if (idx < 0) continue;
        const url = radar.frames[idx];
        showRadarFrame(key, radar, idx);
        if (radar.applied.get(radar.id) !== url) {
          await Promise.race([requestFrame(url, 0).catch(noop), sleep(1500)]);
          if (radar.wanted.get(radar.id) === url) applyWanted(key, radar);
        }
        if (idx > bestIdx) bestIdx = idx;
      }
      return bestIdx;
    },

    getScale: (key) => {
      const st = state.layers[key];
      return st && st.scale ? st.scale : null;
    },

    valueAt: (lngLat) => valueAt(lngLat),

    pause: () => stopAnimation(),
    resume: () => startAnimation(),

    refresh: async (key) => {
      const st = state.layers[key];
      if (!st) return;
      await loadProduct(key);
      if (state.map) {
        for (const radar of st.radars) addRadarSticker(state.map, key, radar);
        state.afterLayers();
      }
    },

    reapply: () => {
      if (!state.map) return;
      for (const key of Object.keys(state.layers)) {
        const st = state.layers[key];
        if (!st || !st.initialized) continue;
        removeAllStickerLayers(state.map, key);
        for (const radar of st.radars) addRadarSticker(state.map, key, radar);
      }
      state.afterLayers();
    },
  };
}

// ---------------------------------------------------------------------------
// REFRESC PERIÒDIC (per si el radar publica frames nous)
// ---------------------------------------------------------------------------

setInterval(() => {
  if (document.hidden) return;
  if (!state.activeKey) return;
  // Revalida el manifest del producte actiu
  loadProduct(state.activeKey).then((ok) => {
    if (!ok || !state.map) return;
    const st = state.layers[state.activeKey];
    for (const radar of st.radars) {
      if (!state.map.getLayer(layerId(state.activeKey, radar.id))) {
        addRadarSticker(state.map, state.activeKey, radar);
      }
    }
    state.afterLayers();
    state.onUpdate(state.activeKey);
  }).catch(() => {});
}, REFRESH_MS);