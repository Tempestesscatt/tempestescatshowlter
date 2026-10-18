// public/js/radar.js
// MapLibre GL JS: radar (PNG), comarques, municipis (GeoJSON.gz) i ciutats.
//
// Política de caché:
//  - Dades VIVES (manifests i frames del radar): sempre es validen amb el servidor.
//      · manifest: cache 'no-store' + ?t=<bloc de 10 s> (així un CDN pot compartir-lo entre usuaris)
//      · frames:   cache 'no-cache' (revalida; si no ha canviat, el servidor respon 304)
//      · els blobs només viuen a memòria durant la sessió.
//      · els últims frames es tornen a baixar cada cop que el manifest canvia,
//        per si s'han regenerat amb el mateix nom.
//  - Dades ESTÀTIQUES (comarques, relleu, municipis, ciutats): caché normal del navegador.
//
// Lleuger:
//  - Només es precarreguen les últimes PRELOAD_FRAMES (3 h) de la capa visible i els
//    últims 2 frames de l'altra. Els frames antics es baixen quan l'usuari hi arriba.
//  - Hi ha un límit de blobs a memòria per capa (KEEP_*): els més antics s'alliberen.
//  - Mòbils amb poca memòria o "estalvi de dades": precàrrega i descàrregues reduïdes.
//  - Els municipis (només visibles a zoom >= 8) es carreguen amb una mica de retard.
//  - orderLayers no serialitza tot l'estil (getLayersOrder).
//
// Llamps: la línia de temps del radar governa els llamps (setLightningTime):
//  frame més recent = directe; frame antic = llamps dels 5 min anteriors a aquella hora.

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

// NOTA: tots els nuclis d'Overture tenen població 0, així que l'últim nivell de
// cada densitat baixa a 0 perquè es vegin. Si notes que el mapa va lent a zoom
// alt, puja aquests 0 a un valor més gran (però llavors no veuràs cap poble).
const DENSITY = {
  'poc':       [[3, 500000], [6, 200000], [8, 100000], [10, 50000], [12, 20000], [14, 0]],
  'normal':    [[3, 300000], [6, 100000], [8, 30000],  [9, 15000],  [10, 8000],  [11, 4000],  [12, 2000], [13, 0]],
  'dens':      [[3, 200000], [6, 50000],  [8, 15000],  [9, 8000],   [10, 4000],  [11, 2000],  [12, 0]],
  'molt-dens': [[3, 100000], [6, 20000],  [8, 8000],   [9, 4000],   [10, 2000],  [11, 0]],
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
const MUNI_DELAY_MS = 2000;   // les línies de municipis no es veuen fins a zoom 8

const AVIS_SRC = 'avisos-src';
const AVIS_FILL = 'avisos-fill';
const AVIS_LINE = 'avisos-line';
const AVIS_COLOR = ['match', ['get', 'level'], 3, '#ef4444', 2, '#f97316', '#facc15'];

const ACUM_LAYER_ID = 'acum-layer';

// Com que tots els nuclis tenen població 0, no podem fer servir 'step' sobre
// població per mida. Fem servir un interpolate per zoom amb mides fixes.
const CITY_TEXT_SIZE = [
  'interpolate', ['linear'], ['zoom'],
  4,  9,
  8,  10,
  11, 11,
  13, 12,
  16, 14,
];

// ===========================================================================
// URLs DE R2
// ===========================================================================
// Totes les dades de radar, acumulacions i alertes vénen de R2.
// Les dades d'AEMET (estacions, alertes CAP) viuen a estacions.js i alertes.js.

const R2_BASE = 'https://radar-data.tempestes.cat';

const RADAR_BASE_DBZ    = `${R2_BASE}/dades_radar_dbz`;
const RADAR_BASE_NIMBUS = `${R2_BASE}/dades_radar_nimbus`;

const RADAR = {
  dbz: {
    label: 'Reflectivitat (dBZ)',
    basePath: RADAR_BASE_DBZ,
    sourceId: 'radar-src-dbz',
    layerId: 'radar-layer-dbz',
    opacity: 0.85,
    visible: true,
  },
  lluvia: {
    label: 'Intensitat de pluja (mm/h)',
    basePath: RADAR_BASE_NIMBUS,
    sourceId: 'radar-src-lluvia',
    layerId: 'radar-layer-lluvia',
    opacity: 0.9,
    visible: false,
  },
};

const COORDS = regioCoordinates();

// Dispositiu fluix o connexió limitada: es carrega menys
const LOW_END = (() => {
  try {
    const c = navigator.connection;
    if (c && (c.saveData || /(^|-)2g$/.test(c.effectiveType || ''))) return true;
    if (navigator.deviceMemory && navigator.deviceMemory <= 2) return true;
  } catch (e) { /* ignore */ }
  return false;
})();

const FPS = 3;
const LOOP = true;

const MAX_PARALLEL = LOW_END ? 3 : 6;        // descàrregues simultànies
const FETCH_TIMEOUT_MS = 12000;
const FETCH_RETRIES = 3;
const FIRST_FRAME_WAIT_MS = 1500;
const SWITCH_WAIT_MS = 1500;                 // espera màxima en canviar de producte / hora
const BOOT_FRAMES = LOW_END ? 3 : 6;         // frames que es baixen a l'arrencada (capa visible)
const REFRESH_MS = 30000;                    // cada quant es torna a llegir el manifest
const TAIL_REVALIDATE = 2;                   // últims frames que es tornen a baixar quan el manifest canvia

const PRELOAD_FRAMES = LOW_END ? 12 : 36;    // capa visible: últimes 3 h (a 5 min/frame)
const PRELOAD_HIDDEN = 2;                    // capa amagada: només els últims frames
const KEEP_VISIBLE = LOW_END ? 24 : 90;      // màxim de blobs a memòria (capa visible)
const KEEP_HIDDEN = 12;                      // màxim de blobs a memòria (capa amagada)

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
  } catch (e) { /* ignore */ }
  return DEFAULT_DENSITY;
}

const state = {
  map: null,
  theme: 'fosc',
  density: loadDensity(),
  citiesVisible: true,
  comarquesVisible: true,
  reliefVisible: true,
  municipisVisible: true,
  avisosData: { type: 'FeatureCollection', features: [] },
  layers: {},
};

for (const key of Object.keys(RADAR)) {
  state.layers[key] = {
    frames: [],
    timestamps: [],
    currentIndex: 0,
    minIndex: 0,
    initialized: false,
    visible: RADAR[key].visible,
    opacity: RADAR[key].opacity,
    applied: null,
    wanted: null,
    applyScheduled: false,
    loaded: 0,
    manifestSig: null,
    minTime: null,
    orphans: [],
    syncing: false,
  };
}

// ---------------------------------------------------------------------------
// LLAMPS: la línia de temps del radar governa quins llamps es veuen
// ---------------------------------------------------------------------------

function syncLightning(key, index) {
  const st = state.layers[key];
  if (!st || !st.visible) return;
  const d = st.timestamps[index];
  const last = index >= st.frames.length - 1;
  setLightningTime(last || !d ? null : d.getTime());
}

// ---------------------------------------------------------------------------
// CÀRREGA DE FRAMES: cua amb prioritats + cache de blobs (només memòria)
// prio 0 = urgent, 1 = capa visible, 2 = capa amagada
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
      // 'no-cache': el navegador sempre pregunta al servidor si el fitxer ha canviat.
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
  let bestI = -1;
  let bestPrio = 99;
  for (let i = 0; i < queue.length; i++) {
    if (queue[i].prio < bestPrio) {
      bestPrio = queue[i].prio;
      bestI = i;
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
      .catch((e) => {
        failed.add(entry.url);
        console.warn('[radar] no s\'ha pogut baixar', entry.url, e.message);
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
  if (existing) {
    if (prio < existing.prio) existing.prio = prio;
    return existing.promise;
  }
  if (inflight.has(url)) return inflight.get(url).then(() => blobCache.get(url));

  const entry = { url, prio };
  entry.promise = new Promise((resolve, reject) => { entry.resolve = resolve; entry.reject = reject; });
  entry.promise.catch(noop);
  queued.set(url, entry);
  queue.push(entry);
  pump();
  return entry.promise;
}

// Primer índex que es precarrega: capa visible = últimes 3 h; amagada = últims frames
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
    requestFrame(url, prio);
  }
}

// Si un frame havia fallat (xarxa, 404 transitori), es torna a provar.
function retryMissing(key) {
  const st = state.layers[key];
  if (!st || !st.initialized) return;
  for (let i = preloadFrom(st); i < st.frames.length; i++) failed.delete(st.frames[i]);
  enqueueLayer(key);
}

// Allibera els blobs més antics si se supera el límit de memòria de la capa
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
    URL.revokeObjectURL(blob);
    blobCache.delete(url);
    st.loaded = Math.max(0, st.loaded - 1);
  }
}

function reprioritize() {
  for (const e of queue) {
    if (e.prio === 0) continue;
    const m = frameMeta.get(e.url);
    if (m) e.prio = layerPrio(m.key);
  }
}

// Torna a baixar (revalidant) un frame que ja era a memòria i el substitueix.
async function refreshFrame(key, url) {
  try {
    const fresh = await downloadBlob(url);
    if (!frameMeta.has(url)) { URL.revokeObjectURL(fresh); return; }
    const old = blobCache.get(url);
    blobCache.set(url, fresh);
    if (old) setTimeout(() => URL.revokeObjectURL(old), 10000);
    const st = state.layers[key];
    if (st && st.wanted === url) { st.applied = null; scheduleApply(key); }
  } catch (e) { /* es queda amb el blob anterior */ }
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
// RADAR: manifest + preparació
// ---------------------------------------------------------------------------

async function fetchManifest(cfg) {
  for (let i = 0; i < 3; i++) {
    try {
      // El paràmetre canvia cada 10 s: sempre és fresc, però un CDN el pot compartir entre usuaris
      const bucket = Math.floor(Date.now() / 10000);
      const r = await fetch(`${cfg.basePath}/manifest.json?t=${bucket}`, { cache: 'no-store' });
      if (r.ok) {
        const j = await r.json();
        if (j && Array.isArray(j.frames)) return j;
      }
    } catch (e) { /* reintenta */ }
    await sleep(400 * (i + 1));
  }
  return null;
}

function parseTs(ts) {
  const m = /(\d{4})-(\d{2})-(\d{2})T(\d{2}):?(\d{2})/.exec(ts || '');
  return m ? new Date(Date.UTC(+m[1], +m[2] - 1, +m[3], +m[4], +m[5])) : null;
}

const listeners = new Set();
let bootDone = false;

export function onLayerUpdate(cb) {
  listeners.add(cb);
  return () => listeners.delete(cb);
}

function notify(key) {
  for (const cb of listeners) {
    try { cb(key); } catch (e) { console.warn('[radar] listener:', e && e.message); }
  }
}

function releaseFrame(url, st) {
  failed.delete(url);
  if (blobCache.has(url)) st.orphans.push(url);
}

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

  const manifest = await fetchManifest(cfg);
  if (!manifest || manifest.frames.length === 0) return false;

  const firstItem = manifest.frames[0] || {};
  const lastItem = manifest.frames[manifest.frames.length - 1] || {};
  const sig = `${manifest.updated || ''}|${manifest.frames.length}|${firstItem.f || ''}|${lastItem.f || ''}`;
  if (!initial && sig === st.manifestSig) return false;

  const ext = manifest.ext || '.png';
  const frames = [];
  const timestamps = [];
  for (const item of manifest.frames) {
    if (!item || !item.f) continue;
    frames.push(`${cfg.basePath}/${item.f}${ext}`);
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
  } else {
    st.minIndex = 0;
  }
  st.minIndex = Math.min(st.minIndex, frames.length - 1);
  if (st.currentIndex < st.minIndex) st.currentIndex = st.minIndex;

  st.initialized = true;
  st.loaded = frames.reduce((n, u) => n + (blobCache.has(u) ? 1 : 0), 0);

  if (first) {
    requestFrame(frames[st.currentIndex], 0);
    // Capa visible: uns quants frames d'arrencada. Capa amagada: només l'actual.
    const prio = layerPrio(key);
    const n = st.visible ? BOOT_FRAMES : 1;
    for (let i = frames.length - 2; i >= Math.max(0, frames.length - n); i--) {
      requestFrame(frames[i], prio);
    }
    if (late) {
      await Promise.race([requestFrame(frames[st.currentIndex], 0).catch(noop), sleep(FIRST_FRAME_WAIT_MS)]);
      addRadarLayer(state.map, key);
      orderLayers(state.map);
      notify(key);
    }
    return true;
  }

  const url = frames[st.currentIndex];
  st.wanted = url;
  requestFrame(url, 0).then(() => { if (st.wanted === url) scheduleApply(key); }).catch(noop);
  enqueueLayer(key);
  revalidateTail(key);
  flushOrphans(st);
  syncLightning(key, st.currentIndex);
  notify(key);
  return true;
}

async function syncLayer(key, initial = false) {
  const st = state.layers[key];
  if (st.syncing) return false;
  st.syncing = true;
  try {
    return await doSync(key, initial);
  } finally {
    st.syncing = false;
  }
}

let refreshTimer = 0;

function refreshAll() {
  return Promise.all(Object.keys(RADAR).map((key) =>
    syncLayer(key)
      .then(() => { retryMissing(key); trimBlobs(key); })
      .catch((e) => console.warn(`[radar:${key}] refresc`, e && e.message))
  ));
}

function startRefresh() {
  if (refreshTimer) return;
  refreshTimer = setInterval(() => { if (!document.hidden) refreshAll(); }, REFRESH_MS);
  document.addEventListener('visibilitychange', () => { if (!document.hidden) refreshAll(); });
  window.addEventListener('online', refreshAll);
}

/** Força una lectura immediata dels manifests (p. ex. en obrir un panell). */
export function refreshNow() { return refreshAll(); }

// Arrenca en importar el mòdul
const prepared = {};
for (const key of Object.keys(RADAR)) {
  prepared[key] = syncLayer(key, true).catch((e) => {
    console.warn(`[radar:${key}]`, e && e.message);
    return false;
  });
}

function addRadarLayer(map, key) {
  const cfg = RADAR[key];
  const st = state.layers[key];
  if (!st.frames.length) return;
  if (map.getLayer(cfg.layerId)) map.removeLayer(cfg.layerId);
  if (map.getSource(cfg.sourceId)) map.removeSource(cfg.sourceId);

  const url = st.frames[st.currentIndex] || st.frames[0];
  const src = blobCache.get(url) || url;
  map.addSource(cfg.sourceId, { type: 'image', url: src, coordinates: COORDS });
  map.addLayer({
    id: cfg.layerId,
    type: 'raster',
    source: cfg.sourceId,
    layout: { visibility: vis(st.visible) },
    paint: {
      'raster-opacity': st.opacity,
      'raster-fade-duration': 0,
      'raster-resampling': 'linear',
    },
  });
  st.applied = url;
  st.wanted = url;
}

// ---------------------------------------------------------------------------
// MUNICIPIS (GeoJSON.gz) — dada estàtica, caché normal
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
      .catch((e) => {
        console.warn('[municipis]', e.message);
        municipisPromise = null;
        return null;
      });
  }
  return municipisPromise;
}

async function addMunicipis(map) {
  const data = await getMunicipis();
  if (!data) return;
  if (map.getLayer(MUNI_LINE)) map.removeLayer(MUNI_LINE);
  if (map.getSource(MUNI_SRC)) map.removeSource(MUNI_SRC);

  map.addSource(MUNI_SRC, { type: 'geojson', data, tolerance: 0.6 });
  const t = MUNI_THEME[state.theme];
  map.addLayer({
    id: MUNI_LINE,
    type: 'line',
    source: MUNI_SRC,
    minzoom: 8,
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
  if (!comarquesCache) {
    try {
      const r = await fetch(COMARQUES_URL);
      if (!r.ok) throw new Error('HTTP ' + r.status);
      comarquesCache = await r.json();
    } catch (e) {
      console.warn('[comarques]', e.message);
      return;
    }
  }
  if (map.getLayer(COMARQUES_LINE)) map.removeLayer(COMARQUES_LINE);
  if (map.getSource(COMARQUES_SRC)) map.removeSource(COMARQUES_SRC);

  map.addSource(COMARQUES_SRC, { type: 'geojson', data: comarquesCache });
  const t = LINE_THEME[state.theme];
  map.addLayer({
    id: COMARQUES_LINE,
    type: 'line',
    source: COMARQUES_SRC,
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
// AVISOS (fills i línies)
// ---------------------------------------------------------------------------

function addAvisos(map) {
  if (map.getLayer(AVIS_LINE)) map.removeLayer(AVIS_LINE);
  if (map.getLayer(AVIS_FILL)) map.removeLayer(AVIS_FILL);
  if (map.getSource(AVIS_SRC)) map.removeSource(AVIS_SRC);
  map.addSource(AVIS_SRC, { type: 'geojson', data: state.avisosData });
  map.addLayer({
    id: AVIS_FILL, type: 'fill', source: AVIS_SRC,
    paint: { 'fill-color': AVIS_COLOR, 'fill-opacity': 0.28 },
  });
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
// Suporta dos formats:
//   - Array compacte: [nom, lon, lat]                (generat des d'Overture)
//   - Objecte:        {nom, lon, lat, poblacio, ...} (format antic)
// ---------------------------------------------------------------------------

let citiesCache = null;

function buildCitiesGeoJSON() {
  const list = window.CIUTATS && Array.isArray(window.CIUTATS.llista) ? window.CIUTATS.llista : [];
  return {
    type: 'FeatureCollection',
    features: list
      .map((c) => {
        let nom, lon, lat, poblacio;
        if (Array.isArray(c)) {
          [nom, lon, lat] = c;
          poblacio = 0;
        } else if (c && typeof c === 'object') {
          nom = c.nom;
          lon = c.lon;
          lat = c.lat;
          poblacio = c.poblacio || 0;
        } else {
          return null;
        }
        if (!nom || !Number.isFinite(lon) || !Number.isFinite(lat)) return null;
        return {
          type: 'Feature',
          properties: { nom, poblacio },
          geometry: { type: 'Point', coordinates: [lon, lat] },
        };
      })
      .filter(Boolean),
  };
}

// Ids de les capes del mapa en ordre, sense serialitzar tot l'estil (molt més lleuger)
function layerIds(map) {
  try {
    if (typeof map.getLayersOrder === 'function') return map.getLayersOrder();
  } catch (e) { /* cau al mètode antic */ }
  const style = map.getStyle();
  return style ? style.layers.map((l) => l.id) : [];
}

function removeCityLayers(map) {
  let ids;
  try { ids = layerIds(map); } catch (e) { return; }
  for (const id of ids) {
    if (id.startsWith(CITIES_PREFIX)) map.removeLayer(id);
  }
}

function addCities(map) {
  if (!citiesCache) {
    citiesCache = buildCitiesGeoJSON();
    if (citiesCache.features.length === 0) console.warn('[ciutats] window.CIUTATS.llista buida o inexistent');
  }

  removeCityLayers(map);
  if (map.getSource(CITIES_SRC)) map.removeSource(CITIES_SRC);
  map.addSource(CITIES_SRC, { type: 'geojson', data: citiesCache });

  const tiers = DENSITY[state.density];
  const t = CITY_THEME[state.theme];

  tiers.forEach(([zoom, minPop], i) => {
    const next = tiers[i + 1];
    // Com que població = 0 per a tots els nuclis d'Overture, el filtre per
    // població no té sentit. Només mostrem els que tenen població 0 (tots)
    // a partir del zoom indicat. El filtre '>=' amb 0 sempre passa.
    map.addLayer({
      id: CITIES_PREFIX + i,
      type: 'symbol',
      source: CITIES_SRC,
      minzoom: zoom,
      maxzoom: next ? next[0] : 24,
      filter: minPop > 0
        ? ['any', ['>=', ['get', 'poblacio'], minPop], ['==', ['get', 'poblacio'], 0]]
        : ['>=', ['get', 'poblacio'], 0],
      layout: {
        visibility: vis(state.citiesVisible),
        'text-field': ['get', 'nom'],
        'text-font': FONT,
        'text-size': CITY_TEXT_SIZE,
        'text-padding': 3,
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
// RELLEU
// ---------------------------------------------------------------------------

const RELIEF_INFO_URL = '/dades/relleu_catalunya.json';
const RELIEF_SRC = 'relief-src';
const RELIEF_LAYER = 'relief-layer';
const RELIEF_THEME = { clar: { opacity: 1 }, fosc: { opacity: 1 } };

let reliefInfo = null;

async function addRelief(map) {
  if (!reliefInfo) {
    try {
      const r = await fetch(RELIEF_INFO_URL);
      if (!r.ok) throw new Error('HTTP ' + r.status);
      reliefInfo = await r.json();
    } catch (e) {
      console.warn('[relleu]', e.message);
      return;
    }
  }
  if (map.getLayer(RELIEF_LAYER)) map.removeLayer(RELIEF_LAYER);
  if (map.getSource(RELIEF_SRC)) map.removeSource(RELIEF_SRC);

  map.addSource(RELIEF_SRC, {
    type: 'image',
    url: '/dades/' + reliefInfo.file,
    coordinates: reliefInfo.coordinates,
  });
  map.addLayer({
    id: RELIEF_LAYER,
    type: 'raster',
    source: RELIEF_SRC,
    layout: { visibility: vis(state.reliefVisible) },
    paint: {
      'raster-opacity': RELIEF_THEME[state.theme].opacity,
      'raster-fade-duration': 0,
      'raster-resampling': 'linear',
    },
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

// ---------------------------------------------------------------------------
// ORDRE DE CAPES
// ---------------------------------------------------------------------------

function orderLayers(map) {
  let ids;
  try { ids = layerIds(map); } catch (e) { return; }
  if (!ids.length) return;

  const mv = (id) => { if (map.getLayer(id)) map.moveLayer(id); };

  mv(RELIEF_LAYER);
  // Alertes AEMET: per sota del radar
  for (const id of ids) if (id.startsWith('alertes-')) mv(id);
  // Avisos de pluja: per sota del radar (el radar sempre queda pintat a sobre)
  mv(AVIS_FILL);
  mv(AVIS_LINE);
  mv(ACUM_LAYER_ID);
  for (const key of Object.keys(RADAR)) mv(RADAR[key].layerId);
  // Llamps: per sobre del radar (han de ser ben visibles)
  for (const id of LIGHTNING_LAYER_IDS) mv(id);
  mv(MUNI_LINE);
  mv(COMARQUES_LINE);
  for (const id of ids) if (id.startsWith(CITIES_PREFIX)) mv(id);
}

// ---------------------------------------------------------------------------
// MOSTRAR FRAMES
// ---------------------------------------------------------------------------

function scheduleApply(key) {
  const st = state.layers[key];
  if (st.applyScheduled) return;
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
  if (!source) return;
  try {
    source.updateImage({ url: blobUrl, coordinates: COORDS });
    st.applied = st.wanted;
    flushOrphans(st);
  } catch (e) {
    console.warn('[radar] updateImage:', e.message);
  }
}

function showFrame(key, index) {
  const st = state.layers[key];
  if (!st.initialized || index < 0 || index >= st.frames.length) return;
  if (index < st.minIndex) index = st.minIndex;

  const url = st.frames[index];
  st.currentIndex = index;
  st.wanted = url;
  syncLightning(key, index);

  if (blobCache.has(url)) {
    scheduleApply(key);
  } else {
    requestFrame(url, 0).then(() => {
      if (st.wanted === url) scheduleApply(key);
    }).catch(noop);
  }
}

// Índex del frame més proper en el temps (respectant el límit del pla)
function nearestIndex(st, ms) {
  let best = -1;
  let bestD = Infinity;
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

function startAllAnimations() {
  stopAllAnimations();
  intervalId = setInterval(tick, 1000 / FPS);
}

function stopAllAnimations() {
  if (intervalId) clearInterval(intervalId);
  intervalId = 0;
}

// ---------------------------------------------------------------------------
// API PÚBLICA
// ---------------------------------------------------------------------------

let errorHandlerAttached = false;

function attachErrorHandler(map) {
  if (errorHandlerAttached) return;
  errorHandlerAttached = true;
  map.on('error', (e) => {
    const err = e && e.error;
    const msg = (err && err.message) || '';
    if ((err && err.name === 'AbortError') || /abort/i.test(msg)) return;
    console.warn('[map]', msg || e);
  });
}

function loadExtras(map) {
  const run = async () => {
    try {
      addCities(map);
      orderLayers(map);
      await Promise.all([addRelief(map), addComarques(map)]);
      orderLayers(map);
      // Municipis: pesats i només visibles a zoom >= 8, es carreguen una mica després
      setTimeout(() => {
        addMunicipis(map).then(() => orderLayers(map)).catch(noop);
      }, MUNI_DELAY_MS);
    } catch (e) {
      console.warn('[extras]', e && e.message);
    }
  };
  if (typeof requestIdleCallback === 'function') requestIdleCallback(run, { timeout: 800 });
  else setTimeout(run, 50);
}

export async function initRadar(map) {
  state.map = map;
  attachErrorHandler(map);
  addAvisos(map);

  const results = await Promise.all(Object.keys(RADAR).map((k) => prepared[k]));

  await Promise.all(Object.keys(RADAR).map(async (key) => {
    const st = state.layers[key];
    if (!st.initialized) return;
    await Promise.race([
      requestFrame(st.frames[st.currentIndex], 0).catch(noop),
      sleep(FIRST_FRAME_WAIT_MS),
    ]);
    addRadarLayer(map, key);
  }));

  orderLayers(map);
  initLightning(map);
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
  reapplyLightning(map);
  addCities(map);
  for (const key of Object.keys(RADAR)) addRadarLayer(map, key);
  orderLayers(map);

  await Promise.all([addRelief(map), addComarques(map)]);
  orderLayers(map);

  addMunicipis(map).then(() => orderLayers(map)).catch(noop);
}

export function setBaseTheme(theme) {
  state.theme = theme === 'clar' ? 'clar' : 'fosc';
  restyleComarques();
  restyleCities();
  restyleRelief();
  restyleMunicipis();
}

export function setDensity(key) {
  if (!DENSITY[key]) return false;
  state.density = key;
  try { localStorage.setItem(DENSITY_KEY, key); } catch (e) { /* ignore */ }
  if (state.map) {
    addCities(state.map);
    orderLayers(state.map);
  }
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

export function goToFrameLayer(key, index) {
  if (state.layers[key]) showFrame(key, index);
}

/**
 * Posa la capa `key` a l'hora `ms` (o al frame més proper) i espera que el frame
 * estigui realment pintat. Serveix per canviar de producte mantenint la mateixa hora.
 * Si `ms` no és vàlid, es queda al frame més recent. Retorna l'índex resultant.
 */
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
  st.visible = visible;
  const map = state.map;
  if (map && map.getLayer(cfg.layerId)) map.setLayoutProperty(cfg.layerId, 'visibility', vis(visible));
  reprioritize();
  if (visible) {
    enqueueLayer(key);
    scheduleApply(key);
    syncLightning(key, st.currentIndex);
  } else if (!Object.values(state.layers).some((l) => l.visible)) {
    setLightningTime(null);   // sense radar visible (p. ex. acumulació): llamps en directe
  }
  for (const k of Object.keys(state.layers)) trimBlobs(k);
}

export function setLayerOpacity(key, opacity) {
  const cfg = RADAR[key];
  if (!cfg) return;
  state.layers[key].opacity = opacity;
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
  };
}

export const pauseRadarAnimation = stopAllAnimations;
export const resumeRadarAnimation = startAllAnimations;

export { setLightningVisibility, setLightningSound, getLightningSound };

export default {
  initRadar,
  reapplyLayers,
  setBaseTheme,
  setDensity,
  getDensity,
  setCiutatsVisibility,
  setComarquesVisibility,
  setReliefVisibility,
  setMunicipisVisibility,
  setAvisosData,
  setLightningVisibility,
  setLightningSound,
  getLightningSound,
  getMunicipis,
  startAllAnimations,
  stopAllAnimations,
  pauseRadarAnimation,
  resumeRadarAnimation,
  goToFrameLayer,
  syncToTime,
  refreshNow,
  setLayerVisibility,
  setLayerOpacity,
  setMinIndex,
  getLayerState,
  onLayerUpdate,
};