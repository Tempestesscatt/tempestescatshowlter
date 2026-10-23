// public/dades/escales.js
// Font única de veritat al front-end per a:
//   - la regió coberta pels PNG (Mercator),
//   - les escales de color (dBZ, VRADH, mm/h, mm acumulats),
//   - la conversió color -> valor i posició -> píxel.

export const REGIO = {
  lat_min: 38.100000,
  lat_max: 45.302098,
  lon_min: -4.554099,
  lon_max: 5.003083,
};

export const BOUNDS = {
  west: REGIO.lon_min,
  east: REGIO.lon_max,
  south: REGIO.lat_min,
  north: REGIO.lat_max,
};

export function regioCoordinates() {
  const { lon_min, lon_max, lat_min, lat_max } = REGIO;
  return [
    [lon_min, lat_max],
    [lon_max, lat_max],
    [lon_max, lat_min],
    [lon_min, lat_min],
  ];
}

export const STD_PERIODS = [30, 60, 180, 360, 720, 1440];

export const MIN_ALPHA = 30;
export const MAX_COLOR_DIST = 90;

// ---------------------------------------------------------------------------
// ESCALES
// ---------------------------------------------------------------------------

export const SCALES = {
  dbz: {
    label: 'Reflectivitat (dBZ)',
    title: 'dBZ',
    unit: 'dBZ',
    log: false,
    min: -4,
    max: 68,
    stops: [
      [ -4, [240, 240, 240]], [ -2, [225, 225, 225]], [  0, [205, 205, 205]],
      [  2, [185, 185, 185]], [  4, [160, 160, 160]], [  6, [220, 220, 220]],
      [  8, [255, 255, 255]], [ 10, [  0, 235, 235]], [ 12, [  0, 210, 235]],
      [ 14, [  0, 180, 235]], [ 16, [  0, 140, 235]], [ 18, [  0, 100, 235]],
      [ 20, [  0,  60, 235]], [ 22, [  0, 130, 130]], [ 24, [  0, 180, 100]],
      [ 26, [  0, 210,  50]], [ 28, [ 40, 220,  20]], [ 30, [  0, 200,   0]],
      [ 32, [  0, 170,   0]], [ 34, [  0, 140,   0]], [ 36, [ 80, 210,   0]],
      [ 38, [140, 230,   0]], [ 40, [200, 240,   0]], [ 42, [235, 250,   0]],
      [ 44, [255, 250,   0]], [ 46, [255, 235,   0]], [ 48, [255, 210,   0]],
      [ 50, [255, 180,   0]], [ 52, [255, 150,   0]], [ 54, [255, 110,   0]],
      [ 56, [255,  70,   0]], [ 58, [255,  30,   0]], [ 60, [255,   0,   0]],
      [ 62, [200,   0,   0]], [ 64, [160,   0,   0]], [ 66, [230,   0, 200]],
      [ 68, [200,   0, 230]],
    ],
    ticks: [-4, 0, 4, 8, 12, 16, 20, 24, 28, 32, 36, 40, 44, 48, 52, 56, 60, 64, 68],
    format: (v) => {
      if (v >= 68) return '68+';
      if (v <= -4) return '< -4';
      return v.toFixed(0);
    },
  },

  // VRADH — Velocitat radial (Doppler)
  // Verd   = cap al radar (negatiu)
  // Vermell = allunyant-se (positiu)
  // Blanc  = ~0 m/s (zona estàtica)
  vel: {
    label: 'Velocitat radial (VRADH)',
    title: 'VRADH',
    unit: 'm/s',
    log: false,
    min: -50,
    max: 50,
    stops: [
      [-50, [128,   0,   0]],
      [-40, [160,   0,   0]],
      [-30, [208,   0,   0]],
      [-25, [255,   0,   0]],
      [-20, [255,  64,  64]],
      [-15, [255, 128, 128]],
      [-10, [255, 176, 176]],
      [ -5, [255, 224, 224]],
      [ -3, [255, 255, 255]],
      [  3, [255, 255, 255]],
      [  5, [224, 255, 224]],
      [ 10, [176, 255, 176]],
      [ 15, [128, 255, 128]],
      [ 20, [ 64, 255,  64]],
      [ 25, [  0, 255,   0]],
      [ 30, [  0, 208,   0]],
      [ 40, [  0, 160,   0]],
      [ 50, [  0, 128,   0]],
    ],
    ticks: [-50, -40, -30, -20, -10, -3, 3, 10, 20, 30, 40, 50],
    format: (v) => {
      if (v >= 50) return '50+';
      if (v <= -50) return '< -50';
      return v.toFixed(0);
    },
  },

  lluvia: {
    label: 'Pluja (mm/h)',
    title: 'mm/h',
    unit: 'mm/h',
    log: true,
    min: 0.1,
    max: 650,
    stops: [
      [   0.1, [  0, 230, 230]], [  0.15, [  0, 200, 240]], [   0.2, [  0, 170, 250]],
      [   0.3, [  0, 120, 250]], [   0.4, [  0,  80, 250]], [   0.5, [  0,  40, 250]],
      [   0.6, [  0,   0, 250]], [   0.9, [  0, 160, 120]], [   1.2, [  0, 220,  40]],
      [   1.5, [ 60, 230,   0]], [     2, [  0, 200,   0]], [   2.7, [  0, 150,   0]],
      [   3.7, [  0, 110,   0]], [   4.8, [  0,  80,   0]], [     6, [160, 220,   0]],
      [     9, [230, 240,   0]], [    12, [250, 250,   0]], [    15, [250, 220,   0]],
      [    21, [250, 180,   0]], [    27, [250, 140,   0]], [    37, [250, 100,   0]],
      [    49, [250,  60,   0]], [    65, [250,   0,   0]], [    86, [220,   0,   0]],
      [   120, [190,   0,   0]], [   153, [210,   0,  80]], [   210, [240,   0, 180]],
      [   273, [220,   0, 230]], [   370, [180,  40, 220]], [   486, [160,  90, 200]],
      [   650, [240, 230, 255]],
    ],
    ticks: [0.1, 0.2, 0.4, 0.6, 1.2, 2, 3.7, 6, 12, 21, 37, 65, 120, 210, 370, 650],
    format: (v) => {
      if (v >= 650) return '650+';
      if (v >= 100) return v.toFixed(0);
      if (v < 1) return v.toFixed(2);
      if (v < 10) return v.toFixed(1);
      return v.toFixed(0);
    },
  },

  acum: {
    label: 'Acumulació (mm)',
    title: 'mm',
    unit: 'mm',
    log: true,
    min: 0.2,
    max: 1000,
    stops: [
      [   0.2, [170, 215, 255]], [   0.5, [140, 195, 255]], [     1, [100, 170, 255]],
      [     2, [ 50, 120, 240]], [     3, [ 20, 160, 220]], [     5, [ 20, 200, 200]],
      [    10, [ 30, 200,  90]], [    15, [ 90, 215,  40]], [    20, [150, 225,  40]],
      [    30, [253, 235,   2]], [    50, [253, 160,   0]], [    75, [253,  60,   0]],
      [   100, [200,   0,  20]], [   150, [200,   0, 160]], [   200, [140,  60, 220]],
      [   300, [180, 130, 240]], [   400, [210, 180, 250]], [   500, [220, 200, 255]],
      [   700, [200, 160, 255]], [  1000, [255, 255, 255]],
    ],
    ticks: [0.2, 1, 5, 10, 30, 50, 100, 200, 500, 1000],
    format: (v) => {
      if (v >= 1000) return '1000+';
      if (v >= 100) return v.toFixed(0);
      if (v >= 1) return v.toFixed(1);
      return v.toFixed(2);
    },
  },
};

// ---------------------------------------------------------------------------
// COLOR -> VALOR
// ---------------------------------------------------------------------------

export function colorToValue(r, g, b, scale) {
  if (!scale || !Array.isArray(scale.stops) || scale.stops.length < 2) return null;
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
// POSICIÓ -> PÍXEL DEL PNG (Mercator)
// ---------------------------------------------------------------------------

const mercY = (latDeg) => Math.asinh(Math.tan((latDeg * Math.PI) / 180));
const MERC_N = mercY(REGIO.lat_max);
const MERC_S = mercY(REGIO.lat_min);

export function lngLatToUV(lng, lat) {
  const u = (lng - REGIO.lon_min) / (REGIO.lon_max - REGIO.lon_min);
  const v = (MERC_N - mercY(lat)) / (MERC_N - MERC_S);
  return { u, v };
}

export default { REGIO, BOUNDS, SCALES, STD_PERIODS, regioCoordinates, colorToValue, lngLatToUV };