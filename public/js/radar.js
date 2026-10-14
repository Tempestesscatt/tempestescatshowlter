// public/js/radar.js
// MapLibre GL JS: radar (PNG), comarques (GeoJSON) i ciutats (window.CIUTATS.llista).
//
//  - Comarques: línies NEGRES al mapa clar, BLANQUES al mapa fosc.
//  - Municipis: PNG de línies a /dades/municipis_lines.png (petit)
//              + GeoJSON.gz a /dades/municipis.geojson.gz (per avisos).
//  - Ciutats: capes per trams de zoom, mida adaptada al zoom i a la població.
//  - Radar: frames des de manifest.json (a R2). Es baixen com a blobs a memòria
//    amb una cua amb prioritats (el més recent primer), i l'animació només
//    avança quan el frame ja és a memòria.

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

const DENSITY = {
  'poc':       [[3, 500000], [6, 200000], [8, 100000], [10, 50000], [12, 20000], [14, 10000]],
  'normal':    [[3, 300000], [6, 100000], [8, 30000],  [9, 15000],  [10, 8000],  [11, 4000],  [12, 2000], [13, 1000]],
  'dens':      [[3, 200000], [6, 50000],  [8, 15000],  [9, 8000],   [10, 4000],  [11, 2000],  [12, 1000], [13, 500]],
  'molt-dens': [[3, 100000], [6, 20000],  [8, 8000],   [9, 4000],   [10, 2000],  [11, 1000],  [12, 500],  [13, 0]],
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

// ---------------------------------------------------------------------------
// MUNICIPIS: PNG de línies (local) + GeoJSON.gz (local) per avisos
// ---------------------------------------------------------------------------

const MUNI_INFO_URL  = '/dades/municipis_lines.json';
const MUNI_PNG_URL   = '/dades/municipis_lines.png';
const MUNI_PNG_SRC   = 'municipis-png-src';
const MUNI_PNG_LAYER = 'municipis-png-layer';

const MUNICIPIS_GZ_URL = '/dades/municipis.geojson.gz';

let muniInfo = null;
let municipisPromise = null;

// ---------------------------------------------------------------------------
// UTILITATS: descomprimir .gz al vol
// ---------------------------------------------------------------------------

async function fetchGunzip(url) {
  const r = await fetch(url, { cache: 'no-store' });
  if (!r.ok) throw new Error('HTTP ' + r.status);

  const ds = new DecompressionStream('gzip');
  const decompressedStream = r.body.pipeThrough(ds);

  const reader = decompressedStream.getReader();
  const chunks = [];
  while (true) {
    const { done, value } = await reader.read();
    if (done) break;
    chunks.push(value);
  }

  const totalLength = chunks.reduce((acc, c) => acc + c.length, 0);
  const result = new Uint8Array(totalLength);
  let offset = 0;
  for (const chunk of chunks) {
    result.set(chunk, offset);
    offset += chunk.length;
  }

  return new TextDecoder('utf-8').decode(result);
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

// ---------------------------------------------------------------------------
// AVISOS (fills i línies per municipi)
// ---------------------------------------------------------------------------

const AVIS_SRC = 'avisos-src';
const AVIS_FILL = 'avisos-fill';
const AVIS_LINE = 'avisos-line';

const AVIS_COLOR = ['match', ['get', 'level'], 3, '#ef4444', 2, '#f97316', '#facc15'];

const CITY_TEXT_SIZE = [
  'interpolate', ['linear'], ['zoom'],
  4,  ['step', ['get', 'poblacio'], 9,  500000, 11, 2000000, 13],
  8,  ['step', ['get', 'poblacio'], 9,  8000,   10, 50000,   12, 200000,  14, 1000000, 16],
  12, ['step', ['get', 'poblacio'], 10, 1000,   11, 5000,    12, 20000,   13, 100000,  15, 500000, 18],
  16, ['step', ['get', 'poblacio'], 12, 2000,   13, 20000,   15, 100000,  18, 500000, 22],
];

// ---------------------------------------------------------------------------
// RADAR (configuració)
// ---------------------------------------------------------------------------

const RADAR_BASE_DBZ    = 'https://radar-data.tempestes.cat/dades_radar_dbz';
const RADAR_BASE_NIMBUS = 'https://radar-data.tempestes.cat/dades_radar_nimbus';

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

const BBOX = { west: -4.554099, east: 5.003083, south: 38.1, north: 45.302098 };
const COORDS = [
  [BBOX.west, BBOX.north],
  [BBOX.east, BBOX.north],
  [BBOX.east, BBOX.south],
  [BBOX.west, BBOX.south],
];

const FPS = 3;
const LOOP = true;

// Càrrega de frames
const MAX_PARALLEL = 6;        // descàrregues simultànies
const FETCH_TIMEOUT_MS = 20000;
const FETCH_RETRIES = 3;
const FIRST_FRAME_WAIT_MS = 3000;

// ---------------------------------------------------------------------------
// ESTAT
// ---------------------------------------------------------------------------

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
    applied: null,      // URL original aplicada al mapa
    wanted: null,       // URL original que volem mostrar
    applyScheduled: false,
    pendingIndex: null, // índex esperant que arribi el blob
  };
}

function loadDensity() {
  try {
    const k = localStorage.getItem(DENSITY_KEY);
    if (k && DENSITY[k]) return k;
  } catch (e) { /* ignore */ }
  return DEFAULT_DENSITY;
}

const vis = (v) => (v ? 'visible' : 'none');

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
    paint: {
      'line-color': t.color,
      'line-opacity': t.opacity,
      'line-width': LINE_WIDTH,
    },
  });
}

// ---------------------------------------------------------------------------
// MUNICIPIS (PNG de línies)
// ---------------------------------------------------------------------------

async function addMunicipis(map) {
  if (!muniInfo) {
    try {
      const r = await fetch(MUNI_INFO_URL, { cache: 'no-store' });
      if (!r.ok) throw new Error('HTTP ' + r.status);
      muniInfo = await r.json();
    } catch (e) {
      console.warn('[municipis-png]', e.message);
      return;
    }
  }

  if (map.getLayer(MUNI_PNG_LAYER)) map.removeLayer(MUNI_PNG_LAYER);
  if (map.getSource(MUNI_PNG_SRC)) map.removeSource(MUNI_PNG_SRC);

  map.addSource(MUNI_PNG_SRC, {
    type: 'image',
    url: MUNI_PNG_URL,
    coordinates: muniInfo.coordinates,
  });

  map.addLayer({
    id: MUNI_PNG_LAYER,
    type: 'raster',
    source: MUNI_PNG_SRC,
    minzoom: 8,
    layout: { visibility: vis(state.municipisVisible) },
    paint: {
      'raster-opacity': ['interpolate', ['linear'], ['zoom'], 8, 0, 9.5, 1],
      'raster-fade-duration': 0,
      'raster-resampling': 'linear',
    },
  });
}

export function setMunicipisVisibility(visible) {
  state.municipisVisible = visible;
  const map = state.map;
  if (map && map.getLayer(MUNI_PNG_LAYER)) {
    map.setLayoutProperty(MUNI_PNG_LAYER, 'visibility', vis(visible));
  }
}

function restyleMunicipis() {
  // El PNG ja ve pintat amb color fix; no cal restyling per tema.
}

// ---------------------------------------------------------------------------
// AVISOS DE PLUJA (fills i línies)
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
// CIUTATS (una capa per tram de zoom)
// ---------------------------------------------------------------------------

let citiesCache = null;

function buildCitiesGeoJSON() {
  const list = window.CIUTATS && Array.isArray(window.CIUTATS.llista) ? window.CIUTATS.llista : [];
  return {
    type: 'FeatureCollection',
    features: list
      .filter((c) => Number.isFinite(c.lon) && Number.isFinite(c.lat))
      .map((c) => ({
        type: 'Feature',
        properties: { nom: c.nom, poblacio: c.poblacio || 0 },
        geometry: { type: 'Point', coordinates: [c.lon, c.lat] },
      })),
  };
}

function removeCityLayers(map) {
  const style = map.getStyle();
  if (!style) return;
  for (const l of style.layers) {
    if (l.id.startsWith(CITIES_PREFIX)) map.removeLayer(l.id);
  }
}

function addCities(map) {
  if (!citiesCache) {
    citiesCache = buildCitiesGeoJSON();
    if (citiesCache.features.length === 0) {
      console.warn('[ciutats] window.CIUTATS.llista buida o inexistent');
    }
  }

  removeCityLayers(map);
  if (map.getSource(CITIES_SRC)) map.removeSource(CITIES_SRC);
  map.addSource(CITIES_SRC, { type: 'geojson', data: citiesCache });

  const tiers = DENSITY[state.density];
  const t = CITY_THEME[state.theme];

  tiers.forEach(([zoom, minPop], i) => {
    const next = tiers[i + 1];
    map.addLayer({
      id: CITIES_PREFIX + i,
      type: 'symbol',
      source: CITIES_SRC,
      minzoom: zoom,
      maxzoom: next ? next[0] : 24,
      filter: ['>=', ['get', 'poblacio'], minPop],
      layout: {
        visibility: vis(state.citiesVisible),
        'text-field': ['get', 'nom'],
        'text-font': FONT,
        'text-size': CITY_TEXT_SIZE,
        'text-padding': 3,
        'text-max-width': 8,
        'symbol-sort-key': ['-', 0, ['get', 'poblacio']],
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

function restyleComarques() {
  const map = state.map;
  if (!map || !map.getLayer(COMARQUES_LINE)) return;
  map.setPaintProperty(COMARQUES_LINE, 'line-color', LINE_THEME[state.theme].color);
}

// ---------------------------------------------------------------------------
// CÀRREGA DE FRAMES: cua amb prioritats + cache de blobs
// ---------------------------------------------------------------------------
//
// prio 0 = urgent (l'usuari el vol veure ara)
// prio 1 = capa visible
// prio 2 = capa amagada

const blobCache = new Map();   // url original -> blob URL
const frameMeta = new Map();   // url original -> { key, index }
const queued = new Map();      // url original -> entry (a la cua)
const inflight = new Map();    // url original -> promise (descarregant)
const failed = new Set();      // url original -> fallit definitivament
let queue = [];                // entries en ordre d'inserció
let activeDownloads = 0;

if (typeof window !== 'undefined') window.__radar = { state, blobCache, failed };

const noop = () => {};

function sleep(ms) { return new Promise((r) => setTimeout(r, ms)); }

async function downloadBlob(url) {
  let lastErr = null;
  for (let attempt = 0; attempt < FETCH_RETRIES; attempt++) {
    const ctrl = new AbortController();
    const timer = setTimeout(() => ctrl.abort(), FETCH_TIMEOUT_MS);
    try {
      const r = await fetch(url, { mode: 'cors', signal: ctrl.signal });
      if (!r.ok) throw new Error('HTTP ' + r.status);
      const blob = await r.blob();
      if (!blob.size) throw new Error('buit');
      return URL.createObjectURL(blob);
    } catch (e) {
      lastErr = e;
      await sleep(400 * (attempt + 1));
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

function layerPrio(key) {
  return state.layers[key] && state.layers[key].visible ? 1 : 2;
}

function pickNext() {
  let bestI = -1;
  let bestPrio = 99;
  for (let i = 0; i < queue.length; i++) {
    const e = queue[i];
    if (e.prio < bestPrio) { bestPrio = e.prio; bestI = i; if (bestPrio === 0) break; }
  }
  if (bestI < 0) return null;
  return queue.splice(bestI, 1)[0];
}

function pump() {
  while (activeDownloads < MAX_PARALLEL) {
    const entry = pickNext();
    if (!entry) return;
    queued.delete(entry.url);

    // No reintentem frames que ja han fallat definitivament
    if (failed.has(entry.url) && entry.prio > 0) { entry.reject(new Error('fallit')); continue; }

    // Frames bloquejats pel pla: no els baixem (si després es desbloquegen, es tornen a encuar)
    if (entry.prio > 0 && isLocked(entry.url)) {
      entry.reject(new Error('bloquejat'));
      continue;
    }
    if (blobCache.has(entry.url)) { entry.resolve(blobCache.get(entry.url)); continue; }

    activeDownloads++;
    const p = downloadBlob(entry.url)
      .then((objUrl) => {
        blobCache.set(entry.url, objUrl);
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

/** Demana un frame. Retorna una promesa amb el blob URL. */
function requestFrame(url, prio) {
  if (blobCache.has(url)) return Promise.resolve(blobCache.get(url));

  const existing = queued.get(url);
  if (existing) {
    if (prio < existing.prio) existing.prio = prio;
    return existing.promise;
  }

  if (inflight.has(url)) {
    // Ja s'està baixant: esperem que acabi
    return inflight.get(url).then(() => blobCache.get(url));
  }

  const entry = { url, prio };
  entry.promise = new Promise((resolve, reject) => { entry.resolve = resolve; entry.reject = reject; });
  entry.promise.catch(noop); // evita "unhandled rejection"
  queued.set(url, entry);
  queue.push(entry);
  pump();
  return entry.promise;
}

/** Encua tots els frames desbloquejats d'una capa, del més recent al més antic. */
function enqueueLayer(key) {
  const st = state.layers[key];
  if (!st) return;
  const prio = layerPrio(key);
  for (let i = st.frames.length - 1; i >= st.minIndex; i--) {
    const url = st.frames[i];
    if (blobCache.has(url) || queued.has(url) || inflight.has(url)) continue;
    requestFrame(url, prio);
  }
}

function reprioritize() {
  for (const e of queue) {
    if (e.prio === 0) continue;
    const m = frameMeta.get(e.url);
    if (m) e.prio = layerPrio(m.key);
  }
}

function releaseUnused(key, newFrames) {
  const keep = new Set(newFrames);
  for (const [url, meta] of frameMeta) {
    if (meta.key !== key || keep.has(url)) continue;
    const objUrl = blobCache.get(url);
    if (objUrl) { URL.revokeObjectURL(objUrl); blobCache.delete(url); }
    frameMeta.delete(url);
  }
}

// ---------------------------------------------------------------------------
// RADAR (càrrega)
// ---------------------------------------------------------------------------

async function fetchManifest(cfg) {
  try {
    const r = await fetch(`${cfg.basePath}/manifest.json?t=${Date.now()}`, { cache: 'no-store' });
    if (!r.ok) return null;
    const j = await r.json();
    return j && Array.isArray(j.frames) ? j : null;
  } catch (e) {
    return null;
  }
}

function parseTs(ts) {
  const m = /(\d{4})-(\d{2})-(\d{2})T(\d{2}):?(\d{2})/.exec(ts || '');
  return m ? new Date(Date.UTC(+m[1], +m[2] - 1, +m[3], +m[4], +m[5])) : null;
}

function addRadarLayer(map, key) {
  const cfg = RADAR[key];
  const st = state.layers[key];
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

async function initLayer(map, key) {
  const cfg = RADAR[key];
  const st = state.layers[key];

  const manifest = await fetchManifest(cfg);
  if (!manifest || manifest.frames.length === 0) return false;

  const v = encodeURIComponent(manifest.updated || Date.now());
  const ext = manifest.ext || '.png';
  const frames = [];
  const timestamps = [];
  for (const item of manifest.frames) {
    if (!item || !item.f) continue;
    frames.push(`${cfg.basePath}/${item.f}${ext}?v=${v}`);
    timestamps.push(parseTs(item.t));
  }
  if (frames.length === 0) return false;

  releaseUnused(key, frames);

  st.frames = frames;
  st.timestamps = timestamps;
  st.applied = null;
  st.wanted = null;
  st.pendingIndex = null;
  frames.forEach((u, i) => frameMeta.set(u, { key, index: i }));

  st.currentIndex = frames.length - 1; // comença al frame més recent

  // El frame més recent primer: l'esperem (com a màxim uns segons) perquè es vegi de seguida.
  try {
    await Promise.race([
      requestFrame(frames[st.currentIndex], 0),
      sleep(FIRST_FRAME_WAIT_MS),
    ]);
  } catch (e) { /* no passa res: addRadarLayer farà servir la URL directa */ }

  addRadarLayer(map, key);
  st.initialized = true;

  // La resta, en segon pla, del més recent al més antic
  console.log(`[radar:${key}] Carregant ${frames.length} frames en segon pla...`);
  enqueueLayer(key);

  return true;
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
      const r = await fetch(RELIEF_INFO_URL, { cache: 'no-store' });
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
  if (map && map.getLayer(RELIEF_LAYER)) {
    map.setLayoutProperty(RELIEF_LAYER, 'visibility', vis(visible));
  }
}

// ---------------------------------------------------------------------------
// ORDRE DE CAPES
// ---------------------------------------------------------------------------

function orderLayers(map) {
  if (map.getLayer(RELIEF_LAYER)) map.moveLayer(RELIEF_LAYER);
  for (const key of Object.keys(RADAR)) {
    if (map.getLayer(RADAR[key].layerId)) map.moveLayer(RADAR[key].layerId);
  }
  if (map.getLayer(MUNI_PNG_LAYER)) map.moveLayer(MUNI_PNG_LAYER);
  if (map.getLayer(AVIS_FILL)) map.moveLayer(AVIS_FILL);
  if (map.getLayer(AVIS_LINE)) map.moveLayer(AVIS_LINE);
  if (map.getLayer(COMARQUES_LINE)) map.moveLayer(COMARQUES_LINE);
  const style = map.getStyle();
  for (const l of style.layers) {
    if (l.id.startsWith(CITIES_PREFIX)) map.moveLayer(l.id);
  }
}

// ---------------------------------------------------------------------------
// MOSTRAR FRAMES
// ---------------------------------------------------------------------------

/** Aplica al mapa el frame "wanted" (com a molt un cop per frame de pantalla). */
function scheduleApply(key) {
  const st = state.layers[key];
  if (st.applyScheduled) return;
  st.applyScheduled = true;
  const run = () => {
    st.applyScheduled = false;
    applyWanted(key);
  };
  if (typeof requestAnimationFrame === 'function' && !document.hidden) requestAnimationFrame(run);
  else setTimeout(run, 0);
}

function applyWanted(key) {
  const cfg = RADAR[key];
  const st = state.layers[key];
  const map = state.map;
  if (!map || !st.initialized || !st.wanted) return;
  if (st.applied === st.wanted) return;

  const blobUrl = blobCache.get(st.wanted);
  if (!blobUrl) return; // encara no ha arribat; s'aplicarà quan arribi

  const source = map.getSource(cfg.sourceId);
  if (!source) return;
  try {
    source.updateImage({ url: blobUrl, coordinates: COORDS });
    st.applied = st.wanted;
  } catch (e) {
    console.warn('[radar] updateImage:', e.message);
  }
}

/**
 * Mostra el frame `index`.
 *  - fromTick = true: només avança si el frame ja és a memòria (si no, l'espera).
 *  - fromTick = false (usuari): mou l'índex a l'instant i la imatge s'aplica quan arribi.
 */
function showFrame(key, index, fromTick) {
  const st = state.layers[key];
  const map = state.map;
  if (!map || !st.initialized || index < 0 || index >= st.frames.length) return;
  if (index < st.minIndex) index = st.minIndex;

  const url = st.frames[index];
  const ready = blobCache.has(url);

  if (fromTick) {
    if (!ready) {
      requestFrame(url, 0); // el pugem de prioritat i esperem al següent tick
      return;
    }
    st.currentIndex = index;
    st.wanted = url;
    scheduleApply(key);
    return;
  }

  // Acció de l'usuari
  st.currentIndex = index;
  st.wanted = url;
  if (ready) {
    scheduleApply(key);
  } else {
    st.pendingIndex = index;
    requestFrame(url, 0).then(() => {
      // Només l'apliquem si l'usuari encara el vol veure
      if (st.wanted === url) scheduleApply(key);
    }).catch(noop);
  }
}

// ---------------------------------------------------------------------------
// ANIMACIÓ (setInterval)
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
  for (const key of Object.keys(state.layers)) {
    const st = state.layers[key];
    if (!st.initialized || st.frames.length === 0 || !st.visible) continue;
    const idx = nextReadyIndex(st);
    if (idx >= 0 && idx !== st.currentIndex) showFrame(key, idx, true);
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
    // Les cancel·lacions d'imatges en canviar ràpid de frame són normals
    if ((err && err.name === 'AbortError') || /abort/i.test(msg)) return;
    console.warn('[map]', msg || e);
  });
}

export async function initRadar(map) {
  state.map = map;
  attachErrorHandler(map);
  getMunicipis();
  await addRelief(map);
  await addComarques(map);
  await addMunicipis(map);
  addAvisos(map);
  addCities(map);

  const results = await Promise.all(Object.keys(RADAR).map((k) => initLayer(map, k)));

  orderLayers(map);
  return results.some(Boolean);
}

export async function reapplyLayers() {
  const map = state.map;
  if (!map) return;
  await addRelief(map);
  await addComarques(map);
  await addMunicipis(map);
  addAvisos(map);
  addCities(map);
  for (const key of Object.keys(RADAR)) {
    if (state.layers[key].frames.length) addRadarLayer(map, key);
  }
  orderLayers(map);
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
  if (map && map.getLayer(COMARQUES_LINE)) {
    map.setLayoutProperty(COMARQUES_LINE, 'visibility', vis(visible));
  }
}

export function setMinIndex(key, idx) {
  const st = state.layers[key];
  if (!st) return;
  const prev = st.minIndex;
  st.minIndex = Math.max(0, Math.min(idx, Math.max(0, st.frames.length - 1)));
  if (st.initialized && st.currentIndex < st.minIndex) showFrame(key, st.minIndex, false);
  // Si s'han desbloquejat frames (login / canvi de pla), els encuem
  if (st.initialized && st.minIndex < prev) enqueueLayer(key);
}

export function goToFrameLayer(key, index) {
  if (state.layers[key]) showFrame(key, index, false);
}

export function setLayerVisibility(key, visible) {
  const cfg = RADAR[key];
  if (!cfg) return;
  state.layers[key].visible = visible;
  const map = state.map;
  if (map && map.getLayer(cfg.layerId)) {
    map.setLayoutProperty(cfg.layerId, 'visibility', vis(visible));
  }
  reprioritize();
  if (visible) {
    // La capa que es veu ha de tenir els frames al davant de la cua
    enqueueLayer(key);
    scheduleApply(key);
  }
}

export function setLayerOpacity(key, opacity) {
  const cfg = RADAR[key];
  if (!cfg) return;
  state.layers[key].opacity = opacity;
  const map = state.map;
  if (map && map.getLayer(cfg.layerId)) {
    map.setPaintProperty(cfg.layerId, 'raster-opacity', opacity);
  }
}

export function getLayerState(key) {
  const st = state.layers[key];
  if (!st) return null;
  let loaded = 0;
  for (const u of st.frames) if (blobCache.has(u)) loaded++;
  return {
    id: key,
    label: RADAR[key].label,
    totalFrames: st.frames.length,
    loadedFrames: loaded,
    timestamps: st.timestamps,
    currentIndex: st.currentIndex,
    minIndex: st.minIndex,
    currentUrl: st.frames[st.currentIndex],
    frames: st.frames,
    visible: st.visible,
    opacity: st.opacity,
    initialized: st.initialized,
  };
}

export const pauseRadarAnimation = stopAllAnimations;
export const resumeRadarAnimation = startAllAnimations;

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
  getMunicipis,
  startAllAnimations,
  stopAllAnimations,
  pauseRadarAnimation,
  resumeRadarAnimation,
  goToFrameLayer,
  setLayerVisibility,
  setLayerOpacity,
  setMinIndex,
  getLayerState,
};