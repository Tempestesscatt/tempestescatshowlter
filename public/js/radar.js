// public/js/radar.js
// MapLibre GL JS: radar (PNG locals), comarques, municipis (GeoJSON.gz), ciutats,
// relleu i províncies. Compatible amb el Python radar-real.py v5 (DBZH + VRADH).

import { regioCoordinates } from '../dades/escales.js';
import {
  initLightning, reapplyLightning, setLightningVisibility, setLightningTime,
  setLightningSound, getLightningSound, LIGHTNING_LAYER_IDS,
} from './llamps.js';

// ---------------------------------------------------------------------------
// CONFIGURACIÓ
// ---------------------------------------------------------------------------
const COMARQUES_URL = '/dades/comarques.geojson';
const COMARQUES_SRC = 'comarques-src';
const COMARQUES_LINE = 'comarques-line';

const CITIES_SRC = 'ciutats-src';
const CITIES_PREFIX = 'ciutats-tier-';
const FONT = ['Noto Sans Regular'];

const DENSITY_KEY = 'radar.density';
const DEFAULT_DENSITY = 'normal';

const CIUTATS_Z4 = new Set(['Barcelona', 'Tarragona', 'Lleida', 'Girona', 'Reus']);
const CIUTATS_Z6 = new Set([
  ...CIUTATS_Z4,
  'Tortosa', 'Manresa', 'Terrassa', 'Sabadell', 'Mataró',
  'Vic', 'Figueres', 'Vilafranca del Penedès', 'Vilanova i la Geltrú',
  'Igualada', 'Blanes', 'Lloret de Mar', 'Olot', 'Salt',
  'Granollers', 'Sant Cugat del Vallès', 'Mollet del Vallès',
  'Rubí', 'Badalona', 'Santa Coloma de Gramenet',
  'L\'Hospitalet de Llobregat', 'Cornellà de Llobregat',
  'Sant Boi de Llobregat', 'El Prat de Llobregat',
  'Castelldefels', 'Viladecans', 'Sant Adrià de Besòs',
  'Cerdanyola del Vallès', 'Palafrugell', 'Sant Feliu de Guíxols',
  'Palamós', 'Roses', 'Valls', 'Cambrils', 'Salou',
  'El Vendrell', 'Amposta', 'Balaguer', 'Tàrrega', 'Mollerussa',
  'La Seu d\'Urgell', 'Puigcerdà', 'Berga', 'Solsona',
]);
const CIUTATS_Z8 = new Set([
  ...CIUTATS_Z6,
  'Sant Carles de la Ràpita', 'Tremp', 'Cervera', 'Guissona',
  'Artesa de Segre', 'Falset', 'Gandesa', 'Sort', 'Vielha',
]);

const DENSITY = {
  'poc':       [[4, 'z4'], [6, 'z6'], [8, 'z8'], [10, 'tots']],
  'normal':    [[4, 'z4'], [6, 'z6'], [8, 'z8'], [10, 'tots']],
  'dens':      [[4, 'z4'], [6, 'z6'], [7, 'z8'], [9, 'tots']],
  'molt-dens': [[4, 'z4'], [5, 'z6'], [7, 'z8'], [8, 'tots']],
};

const CITY_THEME = {
  clar: { text: '#14171c', halo: 'rgba(255,255,255,0.92)', haloWidth: 1.6 },
  fosc: { text: '#ffffff', halo: 'rgba(0,0,0,0.85)',       haloWidth: 1.6 },
};
const LINE_THEME = {
  clar: { color: 'rgba(0,0,0,0.70)',       opacity: 1 },
  fosc: { color: 'rgba(255,255,255,0.65)', opacity: 1 },
};
const LINE_WIDTH = ['interpolate', ['linear'], ['zoom'], 5, 0.5, 8, 0.9, 11, 1.3, 14, 1.8];

const MUNICIPIS_GZ_URL = '/dades/municipis.geojson.gz';
const MUNI_SRC = 'municipis-src';
const MUNI_LINE = 'municipis-line';
const MUNI_THEME = {
  clar: { color: 'rgba(0,0,0,0.38)',       opacity: 1 },
  fosc: { color: 'rgba(255,255,255,0.32)', opacity: 1 },
};
const MUNI_WIDTH = ['interpolate', ['linear'], ['zoom'], 8, 0.4, 11, 0.7, 14, 1.2];
const MUNI_DELAY_MS = 2000;

const AVIS_SRC = 'avisos-src';
const AVIS_FILL = 'avisos-fill';
const AVIS_LINE = 'avisos-line';
const AVIS_COLOR = ['match', ['get', 'level'], 3, '#ef4444', 2, '#f97316', '#facc15'];

const ACUM_LAYER_ID = 'acum-layer';

const CITY_TEXT_SIZE = [
  'interpolate', ['linear'], ['zoom'],
  4,  10, 6,  11, 8,  11, 11, 12, 13, 13, 16, 15,
];

// ===========================================================================
// RUTES LOCALS
// ===========================================================================
const LOCAL_BASE = '';
const RADAR_BASE_DBZ = `${LOCAL_BASE}/dades_radar_dbz`;
const RADAR_BASE_VEL = `${LOCAL_BASE}/dades_radar_velocitat`;

const RADAR = {
  dbz: {
    label: 'Reflectivitat (dBZ)',
    basePath: RADAR_BASE_DBZ,
    sourceId: 'radar-src-dbz',
    layerId: 'radar-layer-dbz',
    opacity: 0.85,
    visible: true,
  },
  vel: {
    label: 'Velocitat radial (km/h)',
    basePath: RADAR_BASE_VEL,
    sourceId: 'radar-src-vel',
    layerId: 'radar-layer-vel',
    opacity: 0.85,
    visible: false,
  },
};

const DEFAULT_COORDS = regioCoordinates();

const LOW_END = (() => {
  try {
    const c = navigator.connection;
    if (c && (c.saveData || /(^|-)2g$/.test(c.effectiveType || ''))) return true;
    if (navigator.deviceMemory && navigator.deviceMemory <= 2) return true;
  } catch (e) {}
  return false;
})();

const FPS = 3;
const LOOP = true;
const MAX_PARALLEL = LOW_END ? 3 : 6;
const FETCH_TIMEOUT_MS = 12000;
const FETCH_RETRIES = 3;
const FIRST_FRAME_WAIT_MS = 1500;
const SWITCH_WAIT_MS = 1500;
const BOOT_FRAMES = LOW_END ? 3 : 6;
const REFRESH_MS = 30000;
const TAIL_REVALIDATE = 2;
const PRELOAD_FRAMES = LOW_END ? 12 : 36;
const PRELOAD_HIDDEN = 2;
const KEEP_VISIBLE = LOW_END ? 24 : 90;
const KEEP_HIDDEN = 12;

// ---------------------------------------------------------------------------
// ESTAT
// ---------------------------------------------------------------------------
const vis = (v) => (v ? 'visible' : 'none');
const noop = () => {};
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

function loadDensity() {
  try {
    const k = localStorage.getItem(DENSITY_KEY);
    if (k && DENSITY[k]) return k;
  } catch (e) {}
  return DEFAULT_DENSITY;
}

const state = {
  map: null,
  theme: 'fosc',
  density: loadDensity(),
  citiesVisible: true,
  comarquesVisible: true,
  reliefVisible: true,
  provinciesVisible: true,
  municipisVisible: true,
  avisosData: { type: 'FeatureCollection', features: [] },
  radars: [],
  activeRadarId: null,
  manifests: { dbz: null, vel: null },
  layers: {},
  markers: new Map(),
};

for (const key of Object.keys(RADAR)) {
  state.layers[key] = {
    frames: [], timestamps: [], currentIndex: 0, minIndex: 0,
    initialized: false, visible: RADAR[key].visible, opacity: RADAR[key].opacity,
    applied: null, wanted: null, applyScheduled: false, loaded: 0,
    manifestSig: null, minTime: null, orphans: [], syncing: false,
    coords: null, radarId: null,
  };
}

// ---------------------------------------------------------------------------
// LLAMPS
// ---------------------------------------------------------------------------
function syncLightning(key, index) {
  const st = state.layers[key];
  if (!st || !st.visible) return;
  const d = st.timestamps[index];
  const last = index >= st.frames.length - 1;
  try { setLightningTime(last || !d ? null : d.getTime()); } catch (e) {}
}

// ---------------------------------------------------------------------------
// CÀRREGA DE FRAMES
// ---------------------------------------------------------------------------
const blobCache = new Map();
const failed = new Set();
const frameMeta = new Map();
const queued = new Map();
const inflight = new Map();
const queue = [];
let activeDownloads = 0;

if (typeof window !== 'undefined') window.__radar = { state, blobCache, failed };

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

function isLocked(url) {
  const m = frameMeta.get(url);
  if (!m) return false;
  const st = state.layers[m.key];
  return !!st && m.index < st.minIndex;
}

const layerPrio = (key) => (state.layers[key] && state.layers[key].visible ? 1 : 2);

function pickNext() {
  let bestI = -1, bestPrio = 99;
  for (let i = 0; i < queue.length; i++) {
    if (queue[i].prio < bestPrio) { bestPrio = queue[i].prio; bestI = i; if (bestPrio === 0) break; }
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
    if (entry.prio > 0 && isLocked(entry.url)) { entry.reject(new Error('bloquejat')); continue; }
    if (entry.prio > 0 && !frameMeta.has(entry.url)) { entry.reject(new Error('retirat')); continue; }
    activeDownloads++;
    const p = downloadBlob(entry.url)
      .then((objUrl) => {
        blobCache.set(entry.url, objUrl);
        failed.delete(entry.url);
        const m = frameMeta.get(entry.url);
        if (m) state.layers[m.key].loaded++;
        entry.resolve(objUrl);
      })
      .catch((e) => { failed.add(entry.url); console.warn('[radar] no s\'ha pogut baixar', entry.url, e.message); entry.reject(e); })
      .finally(() => { activeDownloads--; inflight.delete(entry.url); pump(); });
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
  queued.set(url, entry); queue.push(entry); pump();
  return entry.promise;
}

function preloadFrom(st) {
  const keepLast = st.visible ? PRELOAD_FRAMES : PRELOAD_HIDDEN;
  return Math.max(st.minIndex, st.frames.length - keepLast);
}

function enqueueLayer(key) {
  const st = state.layers[key];
  if (!st) return;
  const prio = layerPrio(key);
  const from = preloadFrom(st);
  for (let i = st.frames.length - 1; i >= from; i--) {
    const url = st.frames[i];
    if (blobCache.has(url) || queued.has(url) || inflight.has(url)) continue;
    requestFrame(url, prio).catch(noop);
  }
}

function retryMissing(key) {
  const st = state.layers[key];
  if (!st || !st.initialized) return;
  for (let i = preloadFrom(st); i < st.frames.length; i++) failed.delete(st.frames[i]);
  enqueueLayer(key);
}

function trimBlobs(key) {
  const st = state.layers[key];
  if (!st || !st.initialized) return;
  const limit = st.visible ? KEEP_VISIBLE : KEEP_HIDDEN;
  let kept = 0;
  for (let i = st.frames.length - 1; i >= 0; i--) {
    const url = st.frames[i];
    const blob = blobCache.get(url);
    if (!blob) continue;
    if (kept < limit) { kept++; continue; }
    if (i === st.currentIndex || url === st.applied || url === st.wanted) continue;
    URL.revokeObjectURL(blob); blobCache.delete(url);
    st.loaded = Math.max(0, st.loaded - 1);
  }
}

function reprioritize() {
  for (const e of queue) { if (e.prio === 0) continue; const m = frameMeta.get(e.url); if (m) e.prio = layerPrio(m.key); }
}

async function refreshFrame(key, url) {
  try {
    const fresh = await downloadBlob(url);
    if (!frameMeta.has(url)) { URL.revokeObjectURL(fresh); return; }
    const old = blobCache.get(url);
    blobCache.set(url, fresh);
    if (old) setTimeout(() => URL.revokeObjectURL(old), 10000);
    const st = state.layers[key];
    if (st && st.wanted === url) { st.applied = null; scheduleApply(key); }
  } catch (e) {}
}

function revalidateTail(key) {
  const st = state.layers[key];
  if (!st) return;
  const from = Math.max(st.minIndex, st.frames.length - TAIL_REVALIDATE);
  for (let i = st.frames.length - 1; i >= from; i--) {
    const url = st.frames[i];
    if (blobCache.has(url)) refreshFrame(key, url);
  }
}

// ---------------------------------------------------------------------------
// MANIFEST
// ---------------------------------------------------------------------------
async function fetchManifest(producte) {
  const base = RADAR[producte].basePath;
  for (let i = 0; i < 3; i++) {
    try {
      const bucket = Math.floor(Date.now() / 10000);
      const r = await fetch(`${base}/manifest.json?t=${bucket}`, { cache: 'no-store' });
      if (r.status === 404) { console.info(`[radar:${producte}] manifest no trobat`); return null; }
      if (r.ok) { const j = await r.json(); if (j && Array.isArray(j.radars)) return j; }
    } catch (e) {}
    await sleep(400 * (i + 1));
  }
  return null;
}

function parseTs(ts) {
  let m = /^(\d{4})(\d{2})(\d{2})T(\d{2})(\d{2})$/.exec(ts || '');
  if (m) return new Date(Date.UTC(+m[1], +m[2] - 1, +m[3], +m[4], +m[5]));
  m = /(\d{4})-(\d{2})-(\d{2})T(\d{2}):?(\d{2})/.exec(ts || '');
  return m ? new Date(Date.UTC(+m[1], +m[2] - 1, +m[3], +m[4], +m[5])) : null;
}

const listeners = new Set();
let bootDone = false;

export function onLayerUpdate(cb) {
  if (typeof cb !== 'function') return () => {};
  listeners.add(cb);
  return () => listeners.delete(cb);
}

function notify(key) {
  for (const cb of listeners) { try { cb(key); } catch (e) { console.warn('[radar] listener:', e && e.message); } }
}

function releaseFrame(url, st) { failed.delete(url); if (blobCache.has(url)) st.orphans.push(url); }

function flushOrphans(st) {
  if (!st.orphans.length) return;
  const keep = [];
  for (const url of st.orphans) {
    if (url === st.applied || url === st.wanted) { keep.push(url); continue; }
    const blob = blobCache.get(url);
    if (blob) URL.revokeObjectURL(blob);
    blobCache.delete(url);
  }
  st.orphans = keep;
}

async function doSync(key, initial) {
  const cfg = RADAR[key];
  const st = state.layers[key];
  const manifest = await fetchManifest(key);
  if (!manifest || !Array.isArray(manifest.radars) || manifest.radars.length === 0) return false;
  state.manifests[key] = manifest;

  if (!state.activeRadarId) {
    const esgld = manifest.radars.find((r) => r.id && r.id.endsWith('-esgld'));
    state.activeRadarId = esgld ? esgld.id : (manifest.radars[0] && manifest.radars[0].id) || null;
  }

  const known = new Set(state.radars.map((r) => r.id));
  for (const r of manifest.radars) {
    if (r && r.id && !known.has(r.id)) {
      state.radars.push({
        id: r.id, nom: r.nom || r.id, regio: r.regio || '',
        lat: Number.isFinite(r.lat) ? r.lat : null,
        lon: Number.isFinite(r.lon) ? r.lon : null,
        coords: Array.isArray(r.coords) ? r.coords : null,
      });
    }
  }

  if (state.map && state.radars.length > 0) addRadarMarkers(state.map);

  const radar = manifest.radars.find((r) => r.id === state.activeRadarId);
  if (!radar || !Array.isArray(radar.frames) || radar.frames.length === 0) return false;

  const firstItem = radar.frames[0] || {};
  const lastItem = radar.frames[radar.frames.length - 1] || {};
  const sig = `${manifest.updated || ''}|${radar.id}|${radar.frames.length}|${firstItem.f || ''}|${lastItem.f || ''}`;
  if (!initial && sig === st.manifestSig) return false;

  st.coords = Array.isArray(radar.coords) ? radar.coords : DEFAULT_COORDS;
  st.radarId = radar.id;

  const ext = manifest.ext || '.png';
  const frames = [];
  const timestamps = [];
  for (const item of radar.frames) {
    if (!item || !item.f) continue;
    frames.push(`${cfg.basePath}/${radar.id}/${item.f}${ext}`);
    timestamps.push(parseTs(item.t));
  }
  if (frames.length === 0) return false;

  const first = !st.initialized;
  const late = first && bootDone && !!state.map;
  const oldFrames = st.frames;
  const prevUrl = oldFrames[st.currentIndex];
  const wasLive = first || st.currentIndex >= oldFrames.length - 1;

  for (const u of oldFrames) frameMeta.delete(u);
  frames.forEach((u, i) => { frameMeta.set(u, { key, index: i }); failed.delete(u); });
  const keep = new Set(frames);
  for (const u of oldFrames) if (!keep.has(u)) releaseFrame(u, st);

  st.manifestSig = sig;
  st.frames = frames;
  st.timestamps = timestamps;

  let idx = wasLive ? frames.length - 1 : frames.indexOf(prevUrl);
  if (idx < 0) idx = frames.length - 1;
  st.currentIndex = idx;

  if (st.minTime != null) {
    const k = timestamps.findIndex((d) => d && d.getTime() >= st.minTime);
    st.minIndex = k < 0 ? 0 : k;
  } else st.minIndex = 0;
  st.minIndex = Math.min(st.minIndex, frames.length - 1);
  if (st.currentIndex < st.minIndex) st.currentIndex = st.minIndex;

  st.initialized = true;
  st.loaded = frames.reduce((n, u) => n + (blobCache.has(u) ? 1 : 0), 0);

  if (first) {
    requestFrame(frames[st.currentIndex], 0).catch(noop);
    const prio = layerPrio(key);
    const n = st.visible ? BOOT_FRAMES : 1;
    for (let i = frames.length - 2; i >= Math.max(0, frames.length - n); i--) requestFrame(frames[i], prio).catch(noop);
    if (late) {
      await Promise.race([requestFrame(frames[st.currentIndex], 0).catch(noop), sleep(FIRST_FRAME_WAIT_MS)]);
      try { addRadarLayer(state.map, key); orderLayers(state.map); } catch (e) {}
      notify(key);
    }
    return true;
  }

  const url = frames[st.currentIndex];
  st.wanted = url;
  requestFrame(url, 0).then(() => { if (st.wanted === url) scheduleApply(key); }).catch(noop);
  enqueueLayer(key); revalidateTail(key); flushOrphans(st);
  syncLightning(key, st.currentIndex);
  notify(key);
  return true;
}

async function syncLayer(key, initial = false) {
  const st = state.layers[key];
  if (!st || st.syncing) return false;
  st.syncing = true;
  try { return await doSync(key, initial); }
  catch (e) { console.warn(`[radar:${key}] sync`, e && e.message); return false; }
  finally { st.syncing = false; }
}

let refreshTimer = 0;
function refreshAll() {
  return Promise.all(Object.keys(RADAR).map((key) =>
    syncLayer(key).then(() => { retryMissing(key); trimBlobs(key); })
      .catch((e) => console.warn(`[radar:${key}]`, e && e.message))
  ));
}
function startRefresh() {
  if (refreshTimer) return;
  refreshTimer = setInterval(() => { if (!document.hidden) refreshAll(); }, REFRESH_MS);
  document.addEventListener('visibilitychange', () => { if (!document.hidden) refreshAll(); });
  window.addEventListener('online', refreshAll);
}
export function refreshNow() { return refreshAll(); }

const prepared = {};
for (const key of Object.keys(RADAR)) {
  prepared[key] = syncLayer(key, true).catch((e) => {
    console.warn(`[radar:${key}] init`, e && e.message);
    return false;
  });
}

function addRadarLayer(map, key) {
  const cfg = RADAR[key];
  const st = state.layers[key];
  if (!map || !st.frames.length) return;
  if (map.getLayer(cfg.layerId)) map.removeLayer(cfg.layerId);
  if (map.getSource(cfg.sourceId)) map.removeSource(cfg.sourceId);
  const url = st.frames[st.currentIndex] || st.frames[0];
  const src = blobCache.get(url) || url;
  const coords = st.coords || DEFAULT_COORDS;
  map.addSource(cfg.sourceId, { type: 'image', url: src, coordinates: coords });
  map.addLayer({
    id: cfg.layerId, type: 'raster', source: cfg.sourceId,
    layout: { visibility: vis(st.visible) },
    paint: { 'raster-opacity': st.opacity, 'raster-fade-duration': 0, 'raster-resampling': 'linear' },
  });
  st.applied = url;
  st.wanted = url;
}

// ---------------------------------------------------------------------------
// MARCADORS DE RADARS
// ---------------------------------------------------------------------------
function ensureMarkerStyles() {
  if (document.getElementById('radar-marker-styles')) return;
  const s = document.createElement('style');
  s.id = 'radar-marker-styles';
  s.textContent = `
    .radar-marker {
      display: flex; align-items: center; justify-content: center;
      width: 26px; height: 26px; padding: 0;
      background: rgba(90, 157, 255, 0.9);
      border: 2px solid #fff;
      border-radius: 50%;
      box-shadow: 0 0 12px rgba(90, 157, 255, 0.85), 0 2px 6px rgba(0,0,0,.6);
      cursor: pointer; transition: transform .15s, background .15s;
      position: relative;
    }
    .radar-marker:hover { transform: scale(1.15); background: rgba(90, 157, 255, 1); }
    .radar-marker svg { width: 14px; height: 14px; stroke: #fff; fill: none; stroke-width: 2.2; stroke-linecap: round; stroke-linejoin: round; }
    .radar-marker.active { background: #fff; box-shadow: 0 0 20px rgba(90, 157, 255, 1), 0 2px 8px rgba(0,0,0,.8); }
    .radar-marker.active svg { stroke: #3559a0; }
    .radar-marker-label {
      position: absolute; left: 50%; top: 100%; transform: translateX(-50%);
      margin-top: 4px; padding: 2px 7px;
      background: rgba(10, 12, 20, 0.88);
      color: #eef; font-size: 11px; font-weight: 600; white-space: nowrap;
      border-radius: 6px; border: 1px solid rgba(120, 140, 180, 0.3);
      pointer-events: none; opacity: 0; transition: opacity .15s;
    }
    .radar-marker:hover .radar-marker-label,
    .radar-marker.active .radar-marker-label { opacity: 1; }
    .radar-marker-pulse {
      position: absolute; inset: -6px; border-radius: 50%;
      background: rgba(90, 157, 255, 0.35);
      animation: radar-marker-pulse 1.8s ease-out infinite;
      pointer-events: none;
    }
    .radar-marker.active .radar-marker-pulse { display: none; }
    @keyframes radar-marker-pulse {
      0% { transform: scale(0.6); opacity: 1; }
      100% { transform: scale(1.8); opacity: 0; }
    }
  `;
  document.head.appendChild(s);
}

function makeMarkerEl(radar, onClick) {
  const el = document.createElement('div');
  el.className = 'radar-marker';
  el.title = radar.nom;
  el.innerHTML = `
    <div class="radar-marker-pulse"></div>
    <svg viewBox="0 0 24 24" aria-hidden="true">
      <path d="M12 2v4"/><path d="M12 18v4"/><path d="M2 12h4"/><path d="M18 12h4"/>
      <circle cx="12" cy="12" r="3"/>
    </svg>
  `;
  const label = document.createElement('span');
  label.className = 'radar-marker-label';
  label.textContent = radar.nom || radar.id || 'Radar';
  el.appendChild(label);
  el.addEventListener('click', (ev) => { ev.stopPropagation(); onClick(); });
  return el;
}

function addRadarMarkers(map) {
  if (!map || typeof maplibregl === 'undefined') return;
  ensureMarkerStyles();
  for (const radar of state.radars) {
    if (state.markers.has(radar.id)) continue;
    if (!Number.isFinite(radar.lat) || !Number.isFinite(radar.lon)) {
      if (radar.coords && radar.coords.length === 4) {
        const west = radar.coords[0][0], north = radar.coords[0][1];
        const east = radar.coords[2][0], south = radar.coords[2][1];
        radar.lon = (west + east) / 2;
        radar.lat = (north + south) / 2;
      } else continue;
    }
    const el = makeMarkerEl(radar, () => {
      setActiveRadar(radar.id);
      try { map.flyTo({ center: [radar.lon, radar.lat], zoom: 8, duration: 1000, essential: true }); } catch (e) {}
    });
    const marker = new maplibregl.Marker({ element: el, anchor: 'center' })
      .setLngLat([radar.lon, radar.lat])
      .addTo(map);
    state.markers.set(radar.id, marker);
  }
  updateActiveMarker();
}

function updateActiveMarker() {
  for (const [id, marker] of state.markers) {
    const el = marker.getElement();
    if (el) el.classList.toggle('active', id === state.activeRadarId);
  }
}

function removeRadarMarkers() {
  for (const m of state.markers.values()) m.remove();
  state.markers.clear();
}

// ---------------------------------------------------------------------------
// MUNICIPIS
// ---------------------------------------------------------------------------
let municipisPromise = null;
async function fetchGunzip(url) {
  const r = await fetch(url);
  if (!r.ok) throw new Error('HTTP ' + r.status);
  const buf = new Uint8Array(await r.arrayBuffer());
  const isGzip = buf.length > 2 && buf[0] === 0x1f && buf[1] === 0x8b;
  if (!isGzip) return new TextDecoder('utf-8').decode(buf);
  const stream = new Blob([buf]).stream().pipeThrough(new DecompressionStream('gzip'));
  return new Response(stream).text();
}
export function getMunicipis() {
  if (!municipisPromise) {
    municipisPromise = fetchGunzip(MUNICIPIS_GZ_URL)
      .then((text) => JSON.parse(text))
      .catch((e) => { console.warn('[municipis]', e.message); municipisPromise = null; return null; });
  }
  return municipisPromise;
}
async function addMunicipis(map) {
  const data = await getMunicipis();
  if (!data || !map) return;
  if (map.getLayer(MUNI_LINE)) map.removeLayer(MUNI_LINE);
  if (map.getSource(MUNI_SRC)) map.removeSource(MUNI_SRC);
  map.addSource(MUNI_SRC, { type: 'geojson', data, tolerance: 0.6 });
  const t = MUNI_THEME[state.theme];
  map.addLayer({
    id: MUNI_LINE, type: 'line', source: MUNI_SRC, minzoom: 8,
    layout: { 'line-join': 'round', visibility: vis(state.municipisVisible) },
    paint: {
      'line-color': t.color,
      'line-opacity': ['interpolate', ['linear'], ['zoom'], 8, 0, 9.5, t.opacity],
      'line-width': MUNI_WIDTH,
    },
  });
}
export function setMunicipisVisibility(visible) {
  state.municipisVisible = visible;
  const map = state.map;
  if (map && map.getLayer(MUNI_LINE)) map.setLayoutProperty(MUNI_LINE, 'visibility', vis(visible));
}
function restyleMunicipis() {
  const map = state.map;
  if (!map || !map.getLayer(MUNI_LINE)) return;
  map.setPaintProperty(MUNI_LINE, 'line-color', MUNI_THEME[state.theme].color);
}

// ---------------------------------------------------------------------------
// COMARQUES
// ---------------------------------------------------------------------------
let comarquesCache = null;
async function addComarques(map) {
  if (!map) return;
  if (!comarquesCache) {
    try { const r = await fetch(COMARQUES_URL); if (!r.ok) throw new Error('HTTP ' + r.status); comarquesCache = await r.json(); }
    catch (e) { console.warn('[comarques]', e.message); return; }
  }
  if (map.getLayer(COMARQUES_LINE)) map.removeLayer(COMARQUES_LINE);
  if (map.getSource(COMARQUES_SRC)) map.removeSource(COMARQUES_SRC);
  map.addSource(COMARQUES_SRC, { type: 'geojson', data: comarquesCache });
  const t = LINE_THEME[state.theme];
  map.addLayer({
    id: COMARQUES_LINE, type: 'line', source: COMARQUES_SRC,
    layout: { 'line-join': 'round', visibility: vis(state.comarquesVisible) },
    paint: { 'line-color': t.color, 'line-opacity': t.opacity, 'line-width': LINE_WIDTH },
  });
}
function restyleComarques() {
  const map = state.map;
  if (!map || !map.getLayer(COMARQUES_LINE)) return;
  map.setPaintProperty(COMARQUES_LINE, 'line-color', LINE_THEME[state.theme].color);
}

// ---------------------------------------------------------------------------
// AVISOS
// ---------------------------------------------------------------------------
function addAvisos(map) {
  if (!map) return;
  if (map.getLayer(AVIS_LINE)) map.removeLayer(AVIS_LINE);
  if (map.getLayer(AVIS_FILL)) map.removeLayer(AVIS_FILL);
  if (map.getSource(AVIS_SRC)) map.removeSource(AVIS_SRC);
  map.addSource(AVIS_SRC, { type: 'geojson', data: state.avisosData });
  map.addLayer({ id: AVIS_FILL, type: 'fill', source: AVIS_SRC, paint: { 'fill-color': AVIS_COLOR, 'fill-opacity': 0.28 } });
  map.addLayer({
    id: AVIS_LINE, type: 'line', source: AVIS_SRC,
    layout: { 'line-join': 'round' },
    paint: { 'line-color': AVIS_COLOR, 'line-width': ['interpolate', ['linear'], ['zoom'], 6, 1.2, 12, 2.6] },
  });
}
export function setAvisosData(fc) {
  state.avisosData = fc || { type: 'FeatureCollection', features: [] };
  const src = state.map && state.map.getSource(AVIS_SRC);
  if (src) src.setData(state.avisosData);
}

// ---------------------------------------------------------------------------
// CIUTATS
// ---------------------------------------------------------------------------
let citiesCache = null;
function nivellCiutat(nom) {
  if (CIUTATS_Z4.has(nom)) return 'z4';
  if (CIUTATS_Z6.has(nom)) return 'z6';
  if (CIUTATS_Z8.has(nom)) return 'z8';
  return 'tots';
}
function buildCitiesGeoJSON() {
  const list = window.CIUTATS && Array.isArray(window.CIUTATS.llista) ? window.CIUTATS.llista : [];
  const features = [];
  for (const c of list) {
    let nom, lon, lat;
    if (Array.isArray(c)) [nom, lon, lat] = c;
    else if (c && typeof c === 'object') { nom = c.nom; lon = c.lon; lat = c.lat; }
    else continue;
    if (!nom || !Number.isFinite(lon) || !Number.isFinite(lat)) continue;
    features.push({ type: 'Feature', properties: { nom, nivell: nivellCiutat(nom) }, geometry: { type: 'Point', coordinates: [lon, lat] } });
  }
  return { type: 'FeatureCollection', features };
}
function layerIds(map) {
  try { if (typeof map.getLayersOrder === 'function') return map.getLayersOrder(); } catch (e) {}
  const style = map.getStyle(); return style ? style.layers.map((l) => l.id) : [];
}
function removeCityLayers(map) {
  let ids; try { ids = layerIds(map); } catch (e) { return; }
  for (const id of ids) if (id.startsWith(CITIES_PREFIX)) map.removeLayer(id);
}
function addCities(map) {
  if (!map) return;
  if (!citiesCache) { citiesCache = buildCitiesGeoJSON(); console.log(`[ciutats] ${citiesCache.features.length} nuclis`); }
  removeCityLayers(map);
  if (map.getSource(CITIES_SRC)) map.removeSource(CITIES_SRC);
  map.addSource(CITIES_SRC, { type: 'geojson', data: citiesCache });
  const t = CITY_THEME[state.theme];
  const tiers = DENSITY[state.density];
  tiers.forEach(([zoomMin, nivell], i) => {
    const next = tiers[i + 1];
    map.addLayer({
      id: CITIES_PREFIX + i, type: 'symbol', source: CITIES_SRC,
      minzoom: zoomMin, maxzoom: next ? next[0] : 24,
      filter: ['==', ['get', 'nivell'], nivell],
      layout: {
        visibility: vis(state.citiesVisible),
        'text-field': ['get', 'nom'],
        'text-font': FONT,
        'text-size': CITY_TEXT_SIZE,
        'text-padding': 6,
        'text-max-width': 8,
        'symbol-sort-key': ['get', 'nom'],
      },
      paint: {
        'text-color': t.text,
        'text-halo-color': t.halo,
        'text-halo-width': t.haloWidth,
        'text-halo-blur': 0.4,
      },
    });
  });
}
function restyleCities() {
  const map = state.map;
  if (!map) return;
  const t = CITY_THEME[state.theme];
  for (let i = 0; i < DENSITY[state.density].length; i++) {
    const id = CITIES_PREFIX + i;
    if (!map.getLayer(id)) continue;
    map.setPaintProperty(id, 'text-color', t.text);
    map.setPaintProperty(id, 'text-halo-color', t.halo);
    map.setPaintProperty(id, 'text-halo-width', t.haloWidth);
  }
}

// ---------------------------------------------------------------------------
// RELLEU / PROVÍNCIES
// ---------------------------------------------------------------------------
const RELIEF_URL = '/relleu/relleu_catalunya.png';
const RELIEF_SRC = 'relief-src';
const RELIEF_LAYER = 'relief-layer';
const RELIEF_THEME = { clar: { opacity: 1 }, fosc: { opacity: 1 } };
const RELIEF_COORDS = [[-4.554099, 45.302098], [5.003083, 45.302098], [5.003083, 38.100000], [-4.554099, 38.100000]];

function addRelief(map) {
  if (!map) return;
  if (map.getLayer(RELIEF_LAYER)) map.removeLayer(RELIEF_LAYER);
  if (map.getSource(RELIEF_SRC)) map.removeSource(RELIEF_SRC);
  map.addSource(RELIEF_SRC, { type: 'image', url: RELIEF_URL, coordinates: RELIEF_COORDS });
  map.addLayer({
    id: RELIEF_LAYER, type: 'raster', source: RELIEF_SRC,
    layout: { visibility: vis(state.reliefVisible) },
    paint: { 'raster-opacity': RELIEF_THEME[state.theme].opacity, 'raster-fade-duration': 0, 'raster-resampling': 'linear' },
  });
}
function restyleRelief() {
  const map = state.map;
  if (!map || !map.getLayer(RELIEF_LAYER)) return;
  map.setPaintProperty(RELIEF_LAYER, 'raster-opacity', RELIEF_THEME[state.theme].opacity);
}
export function setReliefVisibility(visible) {
  state.reliefVisible = visible;
  const map = state.map;
  if (map && map.getLayer(RELIEF_LAYER)) map.setLayoutProperty(RELIEF_LAYER, 'visibility', vis(visible));
}

const PROV_URL = '/relleu/provincies.png';
const PROV_SRC = 'provincies-src';
const PROV_LAYER = 'provincies-layer';
const PROV_COORDS = [[-4.604099, 45.352098], [5.053083, 45.352098], [5.053083, 38.050000], [-4.604099, 38.050000]];

function addProvincies(map) {
  if (!map) return;
  if (map.getLayer(PROV_LAYER)) map.removeLayer(PROV_LAYER);
  if (map.getSource(PROV_SRC)) map.removeSource(PROV_SRC);
  map.addSource(PROV_SRC, { type: 'image', url: PROV_URL, coordinates: PROV_COORDS });
  map.addLayer({
    id: PROV_LAYER, type: 'raster', source: PROV_SRC,
    layout: { visibility: vis(state.provinciesVisible) },
    paint: { 'raster-opacity': 0.9, 'raster-fade-duration': 0, 'raster-resampling': 'linear' },
  });
}
export function setProvinciesVisibility(visible) {
  state.provinciesVisible = visible;
  const map = state.map;
  if (map && map.getLayer(PROV_LAYER)) map.setLayoutProperty(PROV_LAYER, 'visibility', vis(visible));
}

// ---------------------------------------------------------------------------
// ORDRE DE CAPES
// ---------------------------------------------------------------------------
function orderLayers(map) {
  if (!map) return;
  let ids; try { ids = layerIds(map); } catch (e) { return; }
  if (!ids.length) return;
  const mv = (id) => { if (map.getLayer(id)) map.moveLayer(id); };
  mv(RELIEF_LAYER); mv(PROV_LAYER);
  for (const id of ids) if (id.startsWith('alertes-')) mv(id);
  mv(AVIS_FILL); mv(AVIS_LINE); mv(ACUM_LAYER_ID);
  for (const key of Object.keys(RADAR)) mv(RADAR[key].layerId);
  for (const id of LIGHTNING_LAYER_IDS) mv(id);
  mv(MUNI_LINE); mv(COMARQUES_LINE);
  for (const id of ids) if (id.startsWith(CITIES_PREFIX)) mv(id);
}

// ---------------------------------------------------------------------------
// MOSTRAR FRAMES
// ---------------------------------------------------------------------------
function scheduleApply(key) {
  const st = state.layers[key];
  if (!st || st.applyScheduled) return;
  st.applyScheduled = true;
  const run = () => { st.applyScheduled = false; applyWanted(key); };
  if (!document.hidden && typeof requestAnimationFrame === 'function') requestAnimationFrame(run);
  else setTimeout(run, 0);
}

function applyWanted(key) {
  const cfg = RADAR[key];
  const st = state.layers[key];
  const map = state.map;
  if (!map || !st.wanted || st.applied === st.wanted) return;
  const blobUrl = blobCache.get(st.wanted);
  if (!blobUrl) return;
  const source = map.getSource(cfg.sourceId);
  if (!source || typeof source.updateImage !== 'function') return;
  try {
    source.updateImage({ url: blobUrl, coordinates: st.coords || DEFAULT_COORDS });
    st.applied = st.wanted;
    flushOrphans(st);
  } catch (e) { console.warn('[radar] updateImage:', e.message); }
}

function showFrame(key, index) {
  const st = state.layers[key];
  if (!st || !st.initialized || index < 0 || index >= st.frames.length) return;
  if (index < st.minIndex) index = st.minIndex;
  const url = st.frames[index];
  st.currentIndex = index;
  st.wanted = url;
  syncLightning(key, index);
  if (blobCache.has(url)) scheduleApply(key);
  else requestFrame(url, 0).then(() => { if (st.wanted === url) scheduleApply(key); }).catch(noop);
}

function nearestIndex(st, ms) {
  let best = -1, bestD = Infinity;
  for (let i = st.minIndex; i < st.timestamps.length; i++) {
    const d = st.timestamps[i];
    if (!d) continue;
    const dd = Math.abs(d.getTime() - ms);
    if (dd < bestD) { bestD = dd; best = i; }
  }
  return best;
}

// ---------------------------------------------------------------------------
// ANIMACIÓ
// ---------------------------------------------------------------------------
let intervalId = 0;
function nextReadyIndex(st) {
  const n = st.frames.length;
  const span = n - st.minIndex;
  if (span <= 0) return -1;
  const cur = Math.max(st.currentIndex, st.minIndex);
  for (let step = 1; step <= span; step++) {
    if (!LOOP && cur + step >= n) return -1;
    const i = st.minIndex + ((cur - st.minIndex + step) % span);
    if (blobCache.has(st.frames[i])) return i;
  }
  return -1;
}
function tick() {
  if (document.hidden) return;
  for (const key of Object.keys(state.layers)) {
    const st = state.layers[key];
    if (!st.initialized || !st.visible || st.frames.length === 0) continue;
    const idx = nextReadyIndex(st);
    if (idx >= 0 && idx !== st.currentIndex) showFrame(key, idx);
  }
}
export function startAllAnimations() { stopAllAnimations(); intervalId = setInterval(tick, 1000 / FPS); }
export function stopAllAnimations() { if (intervalId) clearInterval(intervalId); intervalId = 0; }

// ---------------------------------------------------------------------------
// API PÚBLICA
// ---------------------------------------------------------------------------
let errorHandlerAttached = false;
function attachErrorHandler(map) {
  if (errorHandlerAttached || !map) return;
  errorHandlerAttached = true;
  map.on('error', (e) => {
    const err = e && e.error;
    const msg = (err && err.message) || '';
    if ((err && err.name === 'AbortError') || /abort/i.test(msg)) return;
    console.warn('[map]', msg || e);
  });
}

function loadExtras(map) {
  if (!map) return;
  const run = async () => {
    try {
      addCities(map); orderLayers(map);
      await Promise.all([addRelief(map), addProvincies(map), addComarques(map)]);
      orderLayers(map);
      setTimeout(() => { addMunicipis(map).then(() => orderLayers(map)).catch(noop); }, MUNI_DELAY_MS);
    } catch (e) { console.warn('[extras]', e && e.message); }
  };
  if (typeof requestIdleCallback === 'function') requestIdleCallback(run, { timeout: 800 });
  else setTimeout(run, 50);
}

export async function initRadar(map) {
  if (!map) return false;
  state.map = map;
  attachErrorHandler(map);
  addAvisos(map);

  const results = await Promise.all(Object.keys(RADAR).map((k) => prepared[k]));

  await Promise.all(Object.keys(RADAR).map(async (key) => {
    const st = state.layers[key];
    if (!st.initialized) return;
    await Promise.race([requestFrame(st.frames[st.currentIndex], 0).catch(noop), sleep(FIRST_FRAME_WAIT_MS)]);
    try { addRadarLayer(map, key); } catch (e) { console.warn('[radar] addLayer', key, e && e.message); }
  }));

  orderLayers(map);
  try { initLightning(map); } catch (e) { console.warn('[llamps]', e && e.message); }
  orderLayers(map);
  loadExtras(map);
  bootDone = true;
  startRefresh();
  return results.some(Boolean);
}

export async function reapplyLayers() {
  const map = state.map;
  if (!map) return;
  addAvisos(map);
  try { reapplyLightning(map); } catch (e) {}
  addCities(map);
  for (const key of Object.keys(RADAR)) addRadarLayer(map, key);
  orderLayers(map);
  await Promise.all([addRelief(map), addProvincies(map), addComarques(map)]);
  orderLayers(map);
  addMunicipis(map).then(() => orderLayers(map)).catch(noop);
  removeRadarMarkers();
  addRadarMarkers(map);
}

export function setBaseTheme(theme) {
  state.theme = theme === 'clar' ? 'clar' : 'fosc';
  restyleComarques(); restyleCities(); restyleRelief(); restyleMunicipis();
}

export function setDensity(key) {
  if (!DENSITY[key]) return false;
  state.density = key;
  try { localStorage.setItem(DENSITY_KEY, key); } catch (e) {}
  if (state.map) { addCities(state.map); orderLayers(state.map); }
  return true;
}
export function getDensity() { return state.density; }

export function setCiutatsVisibility(visible) {
  state.citiesVisible = visible;
  const map = state.map;
  if (!map) return;
  for (let i = 0; i < DENSITY[state.density].length; i++) {
    const id = CITIES_PREFIX + i;
    if (map.getLayer(id)) map.setLayoutProperty(id, 'visibility', vis(visible));
  }
}

export function setComarquesVisibility(visible) {
  state.comarquesVisible = visible;
  const map = state.map;
  if (map && map.getLayer(COMARQUES_LINE)) map.setLayoutProperty(COMARQUES_LINE, 'visibility', vis(visible));
}

export function setMinIndex(key, idx) {
  const st = state.layers[key];
  if (!st) return;
  st.minIndex = Math.max(0, Math.min(idx, Math.max(0, st.frames.length - 1)));
  const d = st.timestamps[st.minIndex];
  st.minTime = d ? d.getTime() : null;
  if (!st.initialized) return;
  if (st.currentIndex < st.minIndex) showFrame(key, st.minIndex);
  enqueueLayer(key);
}

export function goToFrameLayer(key, index) { if (state.layers[key]) showFrame(key, index); }

export async function syncToTime(key, ms) {
  const st = state.layers[key];
  if (!st || !st.initialized || !st.frames.length) return -1;
  let idx = Number.isFinite(ms) ? nearestIndex(st, ms) : -1;
  if (idx < 0) idx = st.frames.length - 1;
  const url = st.frames[idx];
  showFrame(key, idx);
  if (st.applied !== url) {
    await Promise.race([requestFrame(url, 0).catch(noop), sleep(SWITCH_WAIT_MS)]);
    if (st.wanted === url) applyWanted(key);
  }
  return idx;
}

export function setLayerVisibility(key, visible) {
  const cfg = RADAR[key];
  if (!cfg) return;
  const st = state.layers[key];
  if (!st) return;
  st.visible = visible;
  const map = state.map;
  if (map && map.getLayer(cfg.layerId)) map.setLayoutProperty(cfg.layerId, 'visibility', vis(visible));
  reprioritize();
  if (visible) {
    if (st.initialized) { enqueueLayer(key); scheduleApply(key); syncLightning(key, st.currentIndex); }
  } else if (!Object.values(state.layers).some((l) => l.visible)) {
    try { setLightningTime(null); } catch (e) {}
  }
  for (const k of Object.keys(state.layers)) trimBlobs(k);
}

export function setLayerOpacity(key, opacity) {
  const cfg = RADAR[key];
  if (!cfg) return;
  const st = state.layers[key];
  if (!st) return;
  st.opacity = opacity;
  const map = state.map;
  if (map && map.getLayer(cfg.layerId)) map.setPaintProperty(cfg.layerId, 'raster-opacity', opacity);
}

export function getLayerState(key) {
  const st = state.layers[key];
  if (!st) return null;
  const cur = st.timestamps[st.currentIndex];
  return {
    id: key,
    label: RADAR[key].label,
    totalFrames: st.frames.length,
    loadedFrames: st.loaded,
    timestamps: st.timestamps,
    currentIndex: st.currentIndex,
    currentTime: cur ? cur.getTime() : null,
    minIndex: st.minIndex,
    currentUrl: st.frames[st.currentIndex],
    currentBlob: blobCache.get(st.frames[st.currentIndex]) || null,
    frames: st.frames,
    visible: st.visible,
    opacity: st.opacity,
    initialized: st.initialized,
    radarId: st.radarId,
    coords: st.coords,
  };
}

// ---------------------------------------------------------------------------
// API MULTI-RADAR
// ---------------------------------------------------------------------------
export function getRadars() {
  if (!Array.isArray(state.radars)) return [];
  return state.radars.map((r) => ({
    id: r.id, nom: r.nom, regio: r.regio,
    lat: r.lat, lon: r.lon, coords: r.coords,
  }));
}

export function getActiveRadarId() { return state.activeRadarId || null; }

export async function setActiveRadar(id) {
  if (!id || id === state.activeRadarId) return false;
  const exists = state.radars.some((r) => r.id === id);
  if (!exists) { console.warn('[radar] setActiveRadar: id desconegut', id); return false; }
  state.activeRadarId = id;
  for (const key of Object.keys(state.layers)) {
    const st = state.layers[key];
    st.manifestSig = null;
    for (const u of st.frames) releaseFrame(u, st);
    st.frames = []; st.timestamps = []; st.initialized = false;
    st.currentIndex = 0; st.minIndex = 0; st.applied = null; st.wanted = null;
  }
  await refreshAll();
  if (state.map) {
    for (const key of Object.keys(RADAR)) {
      if (state.layers[key].initialized) addRadarLayer(state.map, key);
    }
    orderLayers(state.map);
    for (const key of Object.keys(RADAR)) notify(key);
  }
  updateActiveMarker();
  return true;
}

export const pauseRadarAnimation = stopAllAnimations;
export const resumeRadarAnimation = startAllAnimations;

export { setLightningVisibility, setLightningSound, getLightningSound };

export default {
  initRadar, reapplyLayers, setBaseTheme, setDensity, getDensity,
  setCiutatsVisibility, setComarquesVisibility, setReliefVisibility, setProvinciesVisibility, setMunicipisVisibility,
  setAvisosData, setLightningVisibility, setLightningSound, getLightningSound, getMunicipis,
  startAllAnimations, stopAllAnimations, pauseRadarAnimation, resumeRadarAnimation,
  goToFrameLayer, syncToTime, refreshNow, setLayerVisibility, setLayerOpacity, setMinIndex,
  getLayerState, onLayerUpdate, getRadars, getActiveRadarId, setActiveRadar,
};