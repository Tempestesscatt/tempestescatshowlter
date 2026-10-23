/* =========================================================
   main.js — Tempestes.cat
   ========================================================= */

import radarDefault, * as radarNs from './radar.js';
const radarApi = { ...radarDefault, ...radarNs };

import { initUI } from './ui.js';
import { initAuth } from './auth.js';
import { initControls } from './controls.js';
import { initSearch } from './search.js';
import { initLegend } from './legend.js';
import { initPlayer } from './player.js';
import { initAcum } from './acum.js';
import { initAvisos } from './avisos-ui.js';
import { initUpsell } from './upsell.js';
import { initEstacions } from './estacions.js';
import { initAlertes } from './alertes.js';

const MAP_CENTER = [1.5, 41.7];
const MAP_ZOOM = 6.4;
const BASEMAPS = {
  clar: 'https://tiles.openfreemap.org/styles/positron',
  fosc: 'https://tiles.openfreemap.org/styles/dark',
};
const VIEW_KEY = 'radar.view.v2';

const $ = (id) => document.getElementById(id);
const isMobile = () => window.matchMedia('(max-width: 760px)').matches;

const loader = $('loader');
const loaderFill = $('loaderFill');
const loaderText = $('loaderText');

export function setLoad(pct, text) {
  if (!loaderFill) return;
  loaderFill.style.width = Math.max(0, Math.min(100, pct)) + '%';
  if (text && loaderText) loaderText.textContent = text;
}

export function hideLoader() {
  if (!loader) return;
  loader.classList.add('hide');
  setTimeout(() => loader.remove(), 400);
}

export const state = {
  map: null,
  radar: radarApi,
  activeKey: 'dbz',
  radarOn: true,
  uiPaused: false,
  currentTheme: 'fosc',
  appReady: false,
  lastRadarMs: null,
  timestamps: [],
  totalFrames: 0,
  intervalMin: 5,
  minIndex: 0,
  tier: 'anon',
  currentUser: null,
  planLabel: '',
  isMobile,
};

function loadView() {
  try {
    const j = JSON.parse(sessionStorage.getItem(VIEW_KEY) || 'null');
    return j && typeof j === 'object' ? j : null;
  } catch { return null; }
}
function readTheme() {
  try { return localStorage.getItem('radar.theme') === 'clar' ? 'clar' : 'fosc'; }
  catch { return 'fosc'; }
}

async function boot() {
  setLoad(5, 'Preparant el mapa…');
  const saved = loadView();
  const theme = readTheme();
  state.currentTheme = theme;

  const map = new maplibregl.Map({
    container: 'map',
    style: BASEMAPS[theme],
    center: saved && Array.isArray(saved.c) && saved.c.length === 2 ? saved.c : MAP_CENTER,
    zoom: saved && Number.isFinite(saved.z) ? saved.z : MAP_ZOOM,
    pitch: saved && Number.isFinite(saved.p) ? Math.min(60, saved.p) : 0,
    bearing: saved && Number.isFinite(saved.b) ? saved.b : 0,
    attributionControl: false,
  });

  map.addControl(new maplibregl.NavigationControl({ visualizePitch: false }), 'top-right');
  map.addControl(new maplibregl.AttributionControl({ compact: true }), 'bottom-right');
  state.map = map;

  const hideBaseLabels = () => {
    const style = map.getStyle();
    if (!style) return;
    for (const l of style.layers) {
      if (l.type === 'symbol') {
        try { map.setLayoutProperty(l.id, 'visibility', 'none'); } catch {}
      }
    }
  };

  await new Promise((resolve) => {
    map.once('style.load', () => { hideBaseLabels(); resolve(); });
  });

  setLoad(20, 'Inicialitzant la interfície…');

  initUI({ map, state, setLoad });
  initControls({ state });

  const auth = initAuth({ state });
  await auth.ready();

  const estacions = initEstacions({ map, visible: false });
  const alertes = initAlertes({ map, visible: true });
  state.estacions = estacions;
  state.alertes = alertes;
  alertes.start().catch(() => {});

  setLoad(40, 'Carregant el radar…');

  try { await radarApi.initRadar(map); }
  catch (e) {
    console.error('[radar]', e);
    setLoad(100, 'Error carregant el radar');
    setTimeout(hideLoader, 1500);
    return;
  }

  const products = ['dbz', 'vel'];
  const available = products.filter((k) => {
    const s = radarApi.getLayerState(k);
    return s && s.initialized && s.totalFrames > 0;
  });

  if (available.length === 0) {
    setLoad(100, 'Sense dades disponibles');
    setTimeout(hideLoader, 1000);
    return;
  }

  setLoad(60, 'Preparant el reproductor…');

  const player = initPlayer({ map, state, radar: radarApi, saved });
  const legend = initLegend({ state, radar: radarApi });
  const acum = initAcum({ map, state, radar: radarApi });
  const avisos = initAvisos({ map, state, radar: radarApi, alertes });
  const upsell = initUpsell({ state });
  const search = initSearch({ map, state, isMobile });

  Object.assign(state, { player, legend, acum, avisos, upsell, search });

  setLoad(80, 'Carregant dades…');

  const initialKey = saved && available.includes(saved.product) ? saved.product : available[0];
  await player.selectProduct(initialKey, {
    ms: saved && !saved.atLatest && Number.isFinite(saved.ms) ? saved.ms : undefined,
  });

  radarApi.startAllAnimations();
  if (saved && saved.paused) player.pauseUI();

  if (saved?.chk) {
    for (const [id, val] of Object.entries(saved.chk)) {
      const el = $(id);
      if (!el || el.checked === !!val) continue;
      if (id === 'chkAvisos' && val) continue;
      el.checked = !!val;
      el.dispatchEvent(new Event('change'));
    }
  }
  if (saved?.density) {
    const sel = $('densitySelect');
    if (sel?.querySelector(`option[value="${saved.density}"]`)) {
      sel.value = saved.density;
      radarApi.setDensity(saved.density);
    }
  }

  if (saved?.product === 'acum') {
    if (Number.isFinite(saved.acumPeriod)) state.acumPeriod = saved.acumPeriod;
    $('prodAcum')?.click();
  }

  setLoad(100, 'A punt!');
  hideLoader();
  state.appReady = true;

  setTimeout(() => { acum.refresh().catch(() => {}); avisos.refresh().catch(() => {}); }, 1200);

  setInterval(() => { if (!document.hidden) acum.refresh().catch(() => {}); }, 30000);
  setInterval(() => { if (!document.hidden && state.appReady) avisos.refresh().catch(() => {}); }, 60000);

  document.addEventListener('visibilitychange', () => {
    if (document.hidden) radarApi.pauseRadarAnimation();
    else {
      if (!state.uiPaused && state.activeKey !== 'acum') radarApi.resumeRadarAnimation();
      if (state.appReady) { acum.refresh().catch(() => {}); avisos.refresh().catch(() => {}); }
    }
  });

  const saveView = () => {
    if (!state.appReady) return;
    try {
      const c = map.getCenter();
      const chk = {};
      document.querySelectorAll('#sidePanel input[type=checkbox]').forEach((el) => {
        if (el.id && el.id !== 'chkAutoReload') chk[el.id] = el.checked;
      });
      sessionStorage.setItem(VIEW_KEY, JSON.stringify({
        product: state.activeKey, ms: state.lastRadarMs, atLatest: state.lastAtLatest,
        paused: state.uiPaused, acumPeriod: state.acumPeriod,
        c: [c.lng, c.lat], z: map.getZoom(), p: map.getPitch(), b: map.getBearing(),
        chk, density: $('densitySelect')?.value,
      }));
    } catch {}
  };
  setInterval(saveView, 1000);
  map.on('moveend', saveView);
  window.addEventListener('pagehide', saveView);
}

if (!window.maplibregl) {
  console.error('[main] MapLibre GL no s\'ha carregat.');
} else {
  boot().catch((e) => {
    console.error('[main] Error inicial:', e);
    setLoad(100, 'Error: ' + (e?.message || e));
    setTimeout(hideLoader, 2000);
  });
}
