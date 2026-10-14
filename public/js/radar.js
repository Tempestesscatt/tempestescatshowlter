// public/js/radar.js
// MapLibre GL JS: radar (PNG), comarques (GeoJSON) i ciutats (window.CIUTATS.llista).
//
//  - Comarques: línies NEGRES al mapa clar, BLANQUES al mapa fosc.
//  - Municipis: PNG de línies a /dades/municipis_lines.png (petit)
//              + GeoJSON.gz a /dades/municipis.geojson.gz (per avisos).
//  - Ciutats: capes per trams de zoom (sempre funciona), mida adaptada
//    al zoom i a la població, densitat ajustable.
//  - Radar: carrega els frames des de manifest.json (a R2) i els pre-carrega
//    TOTS alhora perquè l'animació vagi fluida.

// ---------------------------------------------------------------------------
// CONFIGURACIÓ
// ---------------------------------------------------------------------------

const COMARQUES_URL = '/dades/comarques.geojson';
const COMARQUES_SRC = 'comarques-src';
const COMARQUES_LINE = 'comarques-line';

const CITIES_SRC = 'ciutats-src';
const CITIES_PREFIX = 'ciutats-tier-';

const FONT = ['Noto Sans Regular']; // disponible als glyphs d'OpenFreeMap

const DENSITY_KEY = 'radar.density';
const DEFAULT_DENSITY = 'normal';

// [zoom mínim, població mínima] per a cada tram
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

// GeoJSON.gz amb els municipis
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

// Mida del text segons zoom i població
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
    applied: null,
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
      'raster-opacity': [
        'interpolate', ['linear'], ['zoom'],
        8, 0,
        9.5, 1,
      ],
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
  map.addSource(cfg.sourceId, { type: 'image', url, coordinates: COORDS });
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
}

async function initLayer(map, key) {
  const cfg = RADAR[key];
  const st = state.layers[key];
  st.frames = [];
  st.timestamps = [];
  st.applied = null;

  const manifest = await fetchManifest(cfg);
  if (!manifest || manifest.frames.length === 0) return false;

  const v = encodeURIComponent(manifest.updated || Date.now());
  const ext = manifest.ext || '.png';
  for (const item of manifest.frames) {
    if (!item || !item.f) continue;
    st.frames.push(`${cfg.basePath}/${item.f}${ext}?v=${v}`);
    st.timestamps.push(parseTs(item.t));
  }
  if (st.frames.length === 0) return false;

  st.currentIndex = st.frames.length - 1; // comença al frame més recent
  addRadarLayer(map, key);
  st.initialized = true;

  // 👇 PRE-CÀRREGA COMPLETA: baixem tots els frames de cop
  console.log(`[radar:${key}] Pre-carregant ${st.frames.length} PNGs...`);
  preload(st.frames, (pct) => {
    // Opcional: pots actualitzar una barra de progrés aquí
    // console.log(`[radar:${key}] ${Math.round(pct * 100)}%`);
  });

  return true;
}

// ---------------------------------------------------------------------------
// PRE-CÀRREGA (baixa TOTS els PNGs de cop)
// ---------------------------------------------------------------------------

const preloaded = new Set();

/**
 * Pre-carrega tots els PNGs d'un array d'URLs.
 * - Descarrega 8 en paral·lel (per no saturar la xarxa).
 * - Marca cada URL com a `preloaded` per no tornar-la a baixar.
 * - Es pot cridar diverses vegades: només baixa les que falten.
 * - Retorna una Promise que es resol quan totes han acabat (o fallat).
 */
function preload(all, onProgress) {
  const urls = all.filter((u) => !preloaded.has(u));
  if (urls.length === 0) {
    if (onProgress) onProgress(1);
    return Promise.resolve();
  }

  urls.forEach((u) => preloaded.add(u));
  const total = urls.length;
  let done = 0;
  let ok = 0;
  let ko = 0;
  let idx = 0;

  const MAX_PARALLEL = 8;

  return new Promise((resolve) => {
    function worker() {
      if (idx >= total) {
        if (ok + ko === total) {
          console.log(`[radar] Pre-càrrega feta: ${ok} OK, ${ko} errors (${total} en total)`);
          resolve();
        }
        return;
      }
      const i = idx++;
      const url = urls[i];
      const img = new Image();
      img.onload = () => {
        ok++;
        done++;
        if (onProgress) onProgress(done / total);
        worker();
      };
      img.onerror = () => {
        ko++;
        done++;
        if (onProgress) onProgress(done / total);
        worker();
      };
      img.src = url;
    }

    for (let n = 0; n < MAX_PARALLEL; n++) worker();
  });
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
// API PÚBLICA
// ---------------------------------------------------------------------------

export async function initRadar(map) {
  state.map = map;
  getMunicipis(); // comença a baixar el .geojson.gz (per als avisos)
  await addRelief(map);
  await addComarques(map);
  await addMunicipis(map);
  addAvisos(map);
  addCities(map);

  // Ara no esperem que acabin les pre-càrregues: initLayer les llança
  // en segon pla i retorna de seguida.
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

// ---------------------------------------------------------------------------
// ANIMACIÓ
// ---------------------------------------------------------------------------

function showFrame(key, index) {
  const cfg = RADAR[key];
  const st = state.layers[key];
  const map = state.map;
  if (!map || !st.initialized || index < 0 || index >= st.frames.length) return;
  if (index < st.minIndex) index = st.minIndex;

  const url = st.frames[index];
  st.currentIndex = index;
  if (st.applied === url) return;

  const source = map.getSource(cfg.sourceId);
  if (!source) return;
  try {
    source.updateImage({ url, coordinates: COORDS });
    st.applied = url;
  } catch (e) {
    console.warn('[radar] updateImage:', e.message);
  }
}

let intervalId = 0;

function tick() {
  for (const key of Object.keys(state.layers)) {
    const st = state.layers[key];
    if (!st.initialized || st.frames.length === 0) continue;
    let next = st.currentIndex + 1;
    if (next >= st.frames.length) {
      if (!LOOP) continue;
      next = st.minIndex;
    }
    showFrame(key, next);
  }
}

export function startAllAnimations() {
  stopAllAnimations();
  intervalId = setInterval(tick, 1000 / FPS);
}

export function stopAllAnimations() {
  if (intervalId) clearInterval(intervalId);
  intervalId = 0;
}

// Primer frame permès (els anteriors queden bloquejats)
export function setMinIndex(key, idx) {
  const st = state.layers[key];
  if (!st) return;
  st.minIndex = Math.max(0, Math.min(idx, Math.max(0, st.frames.length - 1)));
  if (st.initialized && st.currentIndex < st.minIndex) showFrame(key, st.minIndex);
  // Ja no cal cridar preload aquí perquè ho hem fet a initLayer
}

export function startAllAnimations() {
  if (rafId) cancelAnimationFrame(rafId);
  lastTick = 0;
  rafId = requestAnimationFrame(loop);
}

export function stopAllAnimations() {
  if (rafId) cancelAnimationFrame(rafId);
  rafId = 0;
}

export function goToFrameLayer(key, index) {
  if (state.layers[key]) showFrame(key, index);
}

export function setLayerVisibility(key, visible) {
  const cfg = RADAR[key];
  if (!cfg) return;
  state.layers[key].visible = visible;
  const map = state.map;
  if (map && map.getLayer(cfg.layerId)) {
    map.setLayoutProperty(cfg.layerId, 'visibility', vis(visible));
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
  return {
    id: key,
    label: RADAR[key].label,
    totalFrames: st.frames.length,
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