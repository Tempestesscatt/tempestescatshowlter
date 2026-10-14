// public/js/avisos.js
// Avisos de pluja intensa per municipi.
//
// Agafa els frames de pluja (mm/h) de l'última finestra, llegeix els colors
// del PNG en uns punts de mostra dins de cada municipi i els converteix a
// mm/h (mateixa escala que valor.js). Retorna els municipis que passen els
// llindars.

import { colorToValue, lngLatToUV, SCALES } from '../dades/valor.js';

// ---------------------------------------------------------------------------
// CONFIGURACIÓ
// ---------------------------------------------------------------------------

// Finestra d'anàlisi (minuts) respecte al frame més recent.
// El Nimbus surt cada 15 min, així que amb 20 min agafem 2 frames (el més
// nou i el previ). Amb 5 min només n'agafaríem 1 i perdíem context.
export const WINDOW_MIN = 20;

// Llindars d'intensitat instantània (mm/h) per al Nimbus.
// Aquests valors són els "instantani" del radar, no acumulats.
export const LEVELS = [
  { id: 1, min: 5,  name: 'Pluja moderada',   color: '#facc15' },
  { id: 2, min: 15, name: 'Pluja forta',      color: '#f97316' },
  { id: 3, min: 30, name: 'Pluja torrencial', color: '#ef4444' },
];

const MIN_ALPHA = 30;     // per sota, considerem que no hi ha eco
const STEP_DEG = 0.012;   // separació dels punts de mostra (~1,3 km)
const MAX_POINTS = 90;    // màxim de punts per municipi

const tick = () => new Promise((r) => setTimeout(r, 0));

// ---------------------------------------------------------------------------
// GEOMETRIA
// ---------------------------------------------------------------------------

function polysOf(f) {
  const g = f && f.geometry;
  if (!g) return [];
  return g.type === 'Polygon'      ? [g.coordinates]
       : g.type === 'MultiPolygon' ? g.coordinates
       : [];
}

function inRings(x, y, rings) {
  let inside = false;
  for (const ring of rings) {
    for (let i = 0, j = ring.length - 1; i < ring.length; j = i++) {
      const xi = ring[i][0], yi = ring[i][1], xj = ring[j][0], yj = ring[j][1];
      if ((yi > y) !== (yj > y) && x < ((xj - xi) * (y - yi)) / (yj - yi) + xi) inside = !inside;
    }
  }
  return inside;
}

export function boundsOf(f) {
  let w = 180, s = 90, e = -180, n = -90;
  for (const poly of polysOf(f)) {
    for (const [x, y] of poly[0]) {
      if (x < w) w = x; if (x > e) e = x;
      if (y < s) s = y; if (y > n) n = y;
    }
  }
  return [[w, s], [e, n]];
}

function samplePoints(f) {
  const polys = polysOf(f);
  if (!polys.length) return [];
  const [[w, s], [e, n]] = boundsOf(f);
  let nx = Math.max(1, Math.ceil((e - w) / STEP_DEG));
  let ny = Math.max(1, Math.ceil((n - s) / STEP_DEG));
  while (nx * ny > MAX_POINTS) { nx = Math.ceil(nx * 0.85); ny = Math.ceil(ny * 0.85); }

  const pts = [];
  for (let i = 0; i < nx; i++) {
    const x = w + ((i + 0.5) * (e - w)) / nx;
    for (let j = 0; j < ny; j++) {
      const y = s + ((j + 0.5) * (n - s)) / ny;
      if (polys.some((p) => inRings(x, y, p))) pts.push([x, y]);
    }
  }
  if (pts.length === 0 && polys[0] && polys[0][0] && polys[0][0][0]) {
    pts.push([polys[0][0][0][0], polys[0][0][0][1]]);
  }
  return pts;
}

const sampleCache = new WeakMap();

async function getSamples(geojson) {
  if (sampleCache.has(geojson)) return sampleCache.get(geojson);
  const out = [];
  const feats = geojson.features;
  for (let i = 0; i < feats.length; i++) {
    const pts = samplePoints(feats[i]);
    const u = new Float32Array(pts.length), v = new Float32Array(pts.length);
    pts.forEach(([x, y], k) => { const p = lngLatToUV(x, y); u[k] = p.u; v[k] = p.v; });
    out.push({ u, v });
    if (i % 40 === 39) await tick();
  }
  sampleCache.set(geojson, out);
  return out;
}

// ---------------------------------------------------------------------------
// LECTURA DELS FRAMES
// ---------------------------------------------------------------------------

function loadImage(url) {
  return new Promise((res, rej) => {
    const img = new Image();
    img.crossOrigin = 'anonymous';
    img.onload = () => res(img);
    img.onerror = () => rej(new Error("No s'ha pogut carregar " + url));
    img.src = url;
  });
}

const levelOf = (v) => {
  let id = 0;
  for (const l of LEVELS) if (v >= l.min) id = l.id;
  return id;
};

export async function computeAvisos({ frames, municipis, onProgress }) {
  if (!frames.length || !municipis || !Array.isArray(municipis.features)) {
    return { items: [], latest: null };
  }

  const scale = SCALES.lluvia;
  const feats = municipis.features;
  const samples = await getSamples(municipis);
  const n = feats.length;

  const maxV = new Float32Array(n);
  const maxT = new Array(n).fill(null);
  const nowV = new Float32Array(n);

  const canvas = document.createElement('canvas');
  const ctx = canvas.getContext('2d', { willReadFrequently: true });

  for (let fi = 0; fi < frames.length; fi++) {
    const img = await loadImage(frames[fi].url);
    canvas.width = img.naturalWidth;
    canvas.height = img.naturalHeight;
    ctx.clearRect(0, 0, canvas.width, canvas.height);
    ctx.drawImage(img, 0, 0);
    const W = canvas.width, H = canvas.height;
    const data = ctx.getImageData(0, 0, W, H).data;
    const last = fi === frames.length - 1;

    for (let i = 0; i < n; i++) {
      const { u, v } = samples[i];
      let best = 0;
      for (let k = 0; k < u.length; k++) {
        const uk = u[k], vk = v[k];
        if (uk < 0 || uk > 1 || vk < 0 || vk > 1) continue;
        const x = Math.min(W - 1, Math.floor(uk * W));
        const y = Math.min(H - 1, Math.floor(vk * H));
        const p = (y * W + x) * 4;
        if (data[p + 3] < MIN_ALPHA) continue;
        const val = colorToValue(data[p], data[p + 1], data[p + 2], scale);
        if (val !== null && val > best) best = val;
      }
      if (best > maxV[i]) { maxV[i] = best; maxT[i] = frames[fi].t; }
      if (last) nowV[i] = best;
      if (i % 300 === 299) await tick();
    }
    if (onProgress) onProgress((fi + 1) / frames.length);
  }

  const items = [];
  for (let i = 0; i < n; i++) {
    const level = levelOf(maxV[i]);
    if (!level) continue;
    const p = feats[i].properties || {};
    items.push({
      codi: p.codi_municipi_6 || p.codi_municipi_5 || String(i),
      nom: p.nom_municipi || p.name || p.nom || 'Municipi',
      comarca: p.nom_comarca || p.comarca || '',
      max: maxV[i],
      level,
      when: maxT[i],
      now: nowV[i],
      feature: feats[i],
    });
  }
  items.sort((a, b) => b.max - a.max);
  return { items, latest: frames[frames.length - 1].t };
}

export function toFeatureCollection(items) {
  return {
    type: 'FeatureCollection',
    features: items.map((it) => ({
      type: 'Feature',
      properties: {
        codi: it.codi,
        nom: it.nom,
        level: it.level,
        max: Math.round(it.max),
      },
      geometry: it.feature.geometry,
    })),
  };
}