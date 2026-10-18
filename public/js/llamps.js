// Llamps en directe + històric sincronitzat amb la línia de temps del radar.
// - Es guarden amb la hora exacta a la caché del navegador (24 h).
// - setLightningTime(ms) mostra els llamps dels 5 min anteriors a aquella hora (time-lapse).
// - setLightningTime(null) = mode directe (efectes, ona i so només en directe).
import { regioCoordinates } from '../dades/escales.js';

const SRC = 'llamps-src';
const ICON = 'llamps-icon';
const IMG = 'llamp-bolt';

const HISTORY_MS = 24 * 60 * 60 * 1000;   // quant temps es guarden
const VIEW_WINDOW_MS = 5 * 60 * 1000;     // cada llamp es veu 5 min des que cau
const MAX_STRIKES = 40000;                // límit de seguretat de l'històric
const MAX_VIEW = 2000;                    // màxim de llamps dibuixats alhora
const CACHE_KEY = 'llamps.cache.v2';

const FLASH_MS = 1100;
const WAVE_MS = 1800;
const WAVE_KM = 50;
const MAX_WAVES = 15;
const FLUSH_LIVE_MS = 1000;   // en directe: màx. 1 actualització/s
const FLUSH_VIEW_MS = 150;     // en històric: resposta ràpida en moure la línia de temps
const AGE_TICK_MS = 20000;
const SAVE_MS = 15000;

const C = regioCoordinates();
const LON = C.map((p) => p[0]);
const LAT = C.map((p) => p[1]);
const BBOX = [Math.min(...LON), Math.min(...LAT), Math.max(...LON), Math.max(...LAT)];

let strikes = [];        // ordenats per hora (ascendent): {lon, lat, t}
let viewTime = null;     // null = directe; nombre = hora del radar que s'està veient
let dirty = false;
let savedDirty = false;
let flushTimer = 0;
let ageTimer = 0;
let saveTimer = 0;
let visible = true;
let mapRef = null;
let ws = null;
let retry = 0;

// ---------- Cerca binària sobre l'històric ----------
function lowerBound(t) {
  let lo = 0, hi = strikes.length;
  while (lo < hi) { const m = (lo + hi) >> 1; if (strikes[m].t < t) lo = m + 1; else hi = m; }
  return lo;
}
function upperBound(t) {
  let lo = 0, hi = strikes.length;
  while (lo < hi) { const m = (lo + hi) >> 1; if (strikes[m].t <= t) lo = m + 1; else hi = m; }
  return lo;
}

// Només es construeixen els llamps de la finestra visible (5 min fins a l'hora vista)
function buildFeatures() {
  const T = viewTime == null ? Date.now() : viewTime;
  let i0 = lowerBound(T - VIEW_WINDOW_MS);
  const i1 = upperBound(T);
  if (i1 - i0 > MAX_VIEW) i0 = i1 - MAX_VIEW;
  const out = new Array(Math.max(0, i1 - i0));
  for (let i = i0; i < i1; i++) {
    const s = strikes[i];
    out[i - i0] = {
      type: 'Feature',
      properties: { m: Math.max(0, Math.min(5, (T - s.t) / 60000)) },
      geometry: { type: 'Point', coordinates: [s.lon, s.lat] },
    };
  }
  return out;
}

// ---------- Icona (platejada) ----------
function makeBolt() {
  const s = 64;
  const c = document.createElement('canvas');
  c.width = c.height = s;
  const g = c.getContext('2d');
  g.beginPath();
  g.moveTo(38, 4); g.lineTo(14, 36); g.lineTo(28, 36);
  g.lineTo(22, 60); g.lineTo(50, 24); g.lineTo(35, 24);
  g.closePath();
  g.lineJoin = 'round';
  g.lineWidth = 5;
  g.strokeStyle = 'rgba(0,0,0,0.85)';
  g.stroke();
  const grad = g.createLinearGradient(14, 4, 50, 60);
  grad.addColorStop(0, '#ffffff');
  grad.addColorStop(0.5, '#cfd6df');
  grad.addColorStop(1, '#f4f7fa');
  g.fillStyle = grad;
  g.fill();
  return g.getImageData(0, 0, s, s);
}

function addLayers(map) {
  if (map.getLayer(ICON)) map.removeLayer(ICON);
  if (map.getSource(SRC)) map.removeSource(SRC);
  if (!map.hasImage(IMG)) map.addImage(IMG, makeBolt(), { pixelRatio: 3 });
  map.addSource(SRC, { type: 'geojson', data: { type: 'FeatureCollection', features: buildFeatures() } });
  map.addLayer({
    id: ICON, type: 'symbol', source: SRC,
    layout: {
      visibility: visible ? 'visible' : 'none',
      'icon-image': IMG,
      'icon-size': 1,
      'icon-allow-overlap': true,
      'icon-ignore-placement': true,
    },
    paint: {
      'icon-opacity': ['interpolate', ['linear'], ['get', 'm'], 0, 1, 1, 0.8, 3, 0.5, 5, 0.12],
    },
  });
}

function flush() {
  flushTimer = 0;
  if (!dirty) return;
  if (document.hidden) return;   // es refarà en tornar a la pestanya
  dirty = false;
  const src = mapRef && mapRef.getSource(SRC);
  if (src) src.setData({ type: 'FeatureCollection', features: buildFeatures() });
}

function scheduleFlush(delay = FLUSH_LIVE_MS) {
  dirty = true;
  if (flushTimer) return;
  flushTimer = setTimeout(flush, delay);
}

// ---------- Caché al navegador (hora de caiguda inclosa) ----------
function pack(list) {
  return JSON.stringify(list.map((s) => [Math.round(s.lon * 1e4), Math.round(s.lat * 1e4), Math.round(s.t / 1000)]));
}

function saveCache() {
  if (!savedDirty) return;
  try {
    const cutoff = Date.now() - HISTORY_MS;
    let list = strikes.filter((s) => s.t >= cutoff);
    try {
      localStorage.setItem(CACHE_KEY, pack(list));
    } catch (e) {
      // Sense espai: es queda amb la meitat més recent
      list = list.slice(Math.floor(list.length / 2));
      localStorage.setItem(CACHE_KEY, pack(list));
    }
    savedDirty = false;
  } catch (e) { /* localStorage bloquejat */ }
}

function loadCache() {
  try {
    localStorage.removeItem('llamps.cache.v1');
    const raw = localStorage.getItem(CACHE_KEY);
    if (!raw) return;
    const list = JSON.parse(raw);
    if (!Array.isArray(list)) return;
    const now = Date.now();
    const cutoff = now - HISTORY_MS;
    strikes = list
      .filter((a) => Array.isArray(a) && a.length === 3)
      .map((a) => ({ lon: a[0] / 1e4, lat: a[1] / 1e4, t: a[2] * 1000 }))
      .filter((s) => s.t >= cutoff && s.t <= now + 60000)
      .sort((a, b) => a.t - b.t)
      .slice(-MAX_STRIKES);
  } catch (e) { /* caché corrupta: s'ignora */ }
}

window.addEventListener('pagehide', saveCache);
document.addEventListener('visibilitychange', () => {
  if (document.hidden) saveCache();
  else scheduleFlush(FLUSH_VIEW_MS);
});

function ageTick() {
  if (document.hidden) return;
  const cutoff = Date.now() - HISTORY_MS;
  let i = 0;
  while (i < strikes.length && strikes[i].t < cutoff) i++;
  if (i) { strikes.splice(0, i); savedDirty = true; }
  if (viewTime == null) scheduleFlush();   // en directe, actualitza l'apagat
}

// ---------- Canvas: brillantor platejada + ona suau (només en directe) ----------
let cv = null;
let ctx = null;
let dpr = 1;
let waves = [];
let raf = 0;

function setupCanvas(map) {
  if (cv) return;
  cv = document.createElement('canvas');
  cv.style.cssText = 'position:absolute;inset:0;width:100%;height:100%;pointer-events:none;z-index:2;';
  map.getContainer().appendChild(cv);
  ctx = cv.getContext('2d');
  resizeCanvas();
  map.on('resize', resizeCanvas);
}

function resizeCanvas() {
  if (!cv || !mapRef) return;
  const el = mapRef.getContainer();
  dpr = Math.min(window.devicePixelRatio || 1, 2);
  cv.width = Math.max(1, Math.round(el.clientWidth * dpr));
  cv.height = Math.max(1, Math.round(el.clientHeight * dpr));
}

function draw() {
  raf = 0;
  if (!ctx || !mapRef) return;
  const now = Date.now();
  waves = waves.filter((w) => now - w.t < Math.max(WAVE_MS, FLASH_MS));

  ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
  ctx.clearRect(0, 0, cv.width / dpr, cv.height / dpr);
  if (!waves.length) return;

  const W = cv.width / dpr;
  const H = cv.height / dpr;
  const zoom = mapRef.getZoom();

  for (const w of waves) {
    const age = now - w.t;
    const p = mapRef.project([w.lon, w.lat]);
    const mpp = 40075016.686 / (512 * Math.pow(2, zoom)) * Math.cos(w.lat * Math.PI / 180);

    if (age < FLASH_MS) {
      const f = age / FLASH_MS;
      const fade = Math.pow(1 - f, 1.5);
      const fr = 16 + 26 * Math.sqrt(f);
      if (p.x > -fr && p.x < W + fr && p.y > -fr && p.y < H + fr) {
        const g = ctx.createRadialGradient(p.x, p.y, 0, p.x, p.y, fr);
        g.addColorStop(0, `rgba(255,255,255,${0.95 * fade})`);
        g.addColorStop(0.3, `rgba(225,232,242,${0.6 * fade})`);
        g.addColorStop(0.7, `rgba(176,188,204,${0.2 * fade})`);
        g.addColorStop(1, 'rgba(160,172,190,0)');
        ctx.fillStyle = g;
        ctx.beginPath();
        ctx.arc(p.x, p.y, fr, 0, Math.PI * 2);
        ctx.fill();

        const L = fr * 1.1;
        ctx.lineWidth = 1;
        ctx.strokeStyle = `rgba(245,248,252,${0.7 * fade})`;
        ctx.beginPath();
        ctx.moveTo(p.x - L, p.y); ctx.lineTo(p.x + L, p.y);
        ctx.moveTo(p.x, p.y - L); ctx.lineTo(p.x, p.y + L);
        ctx.stroke();
      }
    }

    if (age < WAVE_MS) {
      const k = age / WAVE_MS;
      const ease = 1 - Math.pow(1 - k, 3);
      const r = (ease * WAVE_KM * 1000) / mpp;
      if (p.x + r < 0 || p.x - r > W || p.y + r < 0 || p.y - r > H) continue;
      const a = Math.pow(1 - k, 2);
      ctx.beginPath();
      ctx.arc(p.x, p.y, Math.max(r, 0.5), 0, Math.PI * 2);
      ctx.lineWidth = 0.6 + 1.2 * (1 - k);
      ctx.strokeStyle = `rgba(215,224,236,${0.22 * a})`;
      ctx.stroke();
    }
  }
  raf = requestAnimationFrame(draw);
}

function spawnWave(lon, lat) {
  if (document.hidden || !mapRef) return;
  const b = mapRef.getBounds();
  const m = 0.6;
  if (lon < b.getWest() - m || lon > b.getEast() + m || lat < b.getSouth() - m || lat > b.getNorth() + m) return;
  waves.push({ lon, lat, t: Date.now() });
  if (waves.length > MAX_WAVES) waves.shift();
  if (!raf) raf = requestAnimationFrame(draw);
}

// ---------- So: un simple tick ----------
let audioCtx = null;
let soundOn = true;
let lastSounds = [];

function unlockAudio() {
  if (!audioCtx) {
    const AC = window.AudioContext || window.webkitAudioContext;
    if (!AC) return;
    audioCtx = new AC();
  }
  if (audioCtx.state === 'suspended') audioCtx.resume();
}
['pointerdown', 'keydown', 'touchstart'].forEach((ev) =>
  window.addEventListener(ev, unlockAudio, { passive: true }));

function playTick(vol = 1) {
  if (!soundOn || !audioCtx || audioCtx.state !== 'running') return;
  const c = audioCtx;
  const t0 = c.currentTime;
  const osc = c.createOscillator();
  const g = c.createGain();
  osc.type = 'triangle';
  const f = 1500 + Math.random() * 500;
  osc.frequency.setValueAtTime(f, t0);
  osc.frequency.exponentialRampToValueAtTime(f * 0.45, t0 + 0.03);
  g.gain.setValueAtTime(0, t0);
  g.gain.linearRampToValueAtTime(0.1 * vol, t0 + 0.002);
  g.gain.exponentialRampToValueAtTime(0.0001, t0 + 0.045);
  osc.connect(g).connect(c.destination);
  osc.start(t0);
  osc.stop(t0 + 0.06);
}

function maybePlay(lon, lat) {
  if (!soundOn || !mapRef || !audioCtx || document.hidden) return;
  const b = mapRef.getBounds();
  if (!b.contains([lon, lat])) return;
  const now = Date.now();
  lastSounds = lastSounds.filter((t) => now - t < 1000);
  if (lastSounds.length >= 5) return;
  lastSounds.push(now);
  const cn = mapRef.getCenter();
  const dist = Math.hypot(lon - cn.lng, lat - cn.lat);
  const span = Math.hypot(b.getEast() - b.getWest(), b.getNorth() - b.getSouth()) / 2 || 1;
  playTick(Math.max(0.3, 1 - dist / span));
}

// ---------- Entrada de llamps ----------
export function addStrike(lon, lat, t = Date.now()) {
  if (lon < BBOX[0] || lon > BBOX[2] || lat < BBOX[1] || lat > BBOX[3]) return;
  const s = { lon, lat, t };
  const n = strikes.length;
  if (!n || strikes[n - 1].t <= t) strikes.push(s);
  else strikes.splice(lowerBound(t), 0, s);
  if (strikes.length > MAX_STRIKES + 500) strikes.splice(0, strikes.length - MAX_STRIKES);
  savedDirty = true;

  const live = viewTime == null;
  const inWindow = live || (t <= viewTime && t >= viewTime - VIEW_WINDOW_MS);
  if (inWindow) scheduleFlush(live ? FLUSH_LIVE_MS : FLUSH_VIEW_MS);

  // Efectes (brillantor, ona i so) només en directe
  if (live && visible && Date.now() - t < 5000) {
    spawnWave(lon, lat);
    maybePlay(lon, lat);
  }
}

// Descodificador de Blitzortung
function decode(b) {
  const e = {}, d = b.split('');
  let c = d[0], f = c, h = 256, o = h;
  const g = [c];
  for (let i = 1; i < d.length; i++) {
    const code = d[i].charCodeAt(0);
    const a = h > code ? d[i] : (e[code] ? e[code] : f + c);
    g.push(a);
    c = a.charAt(0);
    e[o++] = f + c;
    f = a;
  }
  return g.join('');
}

// ATENCIÓ: feed no oficial. Pot canviar o caure en qualsevol moment.
const WS_HOSTS = ['ws1', 'ws7', 'ws8'].map((h) => `wss://${h}.blitzortung.org/`);

function connect() {
  const url = WS_HOSTS[retry % WS_HOSTS.length];
  try { ws = new WebSocket(url); } catch (e) { return scheduleReconnect(); }
  ws.onopen = () => { retry = 0; ws.send(JSON.stringify({ a: 111 })); };
  ws.onmessage = (ev) => {
    try {
      const m = JSON.parse(decode(ev.data));
      if (Number.isFinite(m.lat) && Number.isFinite(m.lon)) addStrike(m.lon, m.lat);
    } catch (e) { /* missatge no vàlid */ }
  };
  ws.onclose = scheduleReconnect;
  ws.onerror = () => ws && ws.close();
}

function scheduleReconnect() {
  retry++;
  setTimeout(connect, Math.min(30000, 1000 * retry));
}

// ---------- API pública ----------
export function initLightning(map) {
  mapRef = map;
  loadCache();
  addLayers(map);
  setupCanvas(map);
  if (!ageTimer) ageTimer = setInterval(ageTick, AGE_TICK_MS);
  if (!saveTimer) saveTimer = setInterval(saveCache, SAVE_MS);
  if (!ws) connect();
}

export function reapplyLightning(map) {
  mapRef = map;
  addLayers(map);
}

/**
 * Sincronitza els llamps amb la línia de temps del radar.
 *   ms = hora del frame que es veu -> llamps dels 5 min anteriors a aquella hora
 *   ms = null                      -> mode directe
 */
export function setLightningTime(ms) {
  const t = Number.isFinite(ms) ? ms : null;
  if (t === viewTime) return;
  viewTime = t;
  if (t !== null) waves = [];
  if (flushTimer) { clearTimeout(flushTimer); flushTimer = 0; }
  scheduleFlush(FLUSH_VIEW_MS);
}

export function setLightningVisibility(v) {
  visible = v;
  if (cv) cv.style.display = v ? '' : 'none';
  if (!v) waves = [];
  if (!mapRef) return;
  if (mapRef.getLayer(ICON)) mapRef.setLayoutProperty(ICON, 'visibility', v ? 'visible' : 'none');
  if (v) scheduleFlush(FLUSH_VIEW_MS);
}

export function setLightningSound(on) {
  soundOn = !!on;
  if (on) unlockAudio();
}
export function getLightningSound() { return soundOn; }

export const LIGHTNING_LAYER_IDS = [ICON];