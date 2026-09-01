// ─────────────────────────────────────────────────────────────
// mapasatelit.js - VERSIÓN BETA LIMPIA
// Tempestes.cat - Meteosat MTG
// ─────────────────────────────────────────────────────────────

const R2_BASE = 'https://radar-data.tempestes.cat/dades_sat/';

const CONFIG = {
  dataUrl: R2_BASE + 'meteosat_ne_spain.msgpack.gz',
  irDataUrl: R2_BASE + 'meteosat_ne_spain_temp.msgpack.gz',
  ctthAltiDataUrl: R2_BASE + 'meteosat_ne_spain_ctth_alti.msgpack.gz',
  precipDataUrl: R2_BASE + 'meteosat_ne_spain_precip.msgpack.gz',
  geojsonUrl: 'geo/spain.geojson',

bbox: {
    lon_min: -4.554099,
    lat_min: 35.901552,
    lon_max: 5.003083,
    lat_max: 45.302098,
},

  initialCenter: [40.5, 0.0],
  initialZoom: 7,
  defaultOpacity: 0.75,
};

const AUTO_REFRESH_MS = 5 * 60 * 1000; // 5 minuts

// ─── PALETAS DE COLORES ───

function lerpColor(c1, c2, f) {
  return [
    Math.round(c1[0] + (c2[0] - c1[0]) * f),
    Math.round(c1[1] + (c2[1] - c1[1]) * f),
    Math.round(c1[2] + (c2[2] - c1[2]) * f),
  ];
}

const IR_COLOR_STOPS = [
  { temp: 50, color: [10, 10, 10] },
  { temp: 40, color: [30, 30, 30] },
  { temp: 30, color: [55, 55, 55] },
  { temp: 20, color: [80, 80, 80] },
  { temp: 10, color: [105, 105, 105] },
  { temp: 0, color: [135, 135, 135] },
  { temp: -10, color: [165, 165, 165] },
  { temp: -20, color: [195, 195, 195] },
  { temp: -30, color: [225, 225, 225] },
  { temp: -40, color: [245, 245, 245] },
  { temp: -41, color: [255, 255, 0] },
  { temp: -45, color: [255, 200, 0] },
  { temp: -50, color: [255, 140, 0] },
  { temp: -53, color: [255, 60, 0] },
  { temp: -56, color: [220, 0, 0] },
  { temp: -59, color: [150, 0, 0] },
  { temp: -62, color: [80, 0, 40] },
  { temp: -65, color: [140, 0, 140] },
  { temp: -68, color: [190, 30, 190] },
  { temp: -71, color: [230, 90, 230] },
  { temp: -74, color: [120, 190, 255] },
  { temp: -77, color: [40, 120, 230] },
  { temp: -80, color: [255, 255, 255] },
];

function irToColor(tempC) {
  if (tempC === null || tempC === undefined || Number.isNaN(tempC) || tempC <= -999) {
    return [0, 0, 0, 0];
  }
  const clamped = Math.max(-80, Math.min(50, tempC));
  for (let i = 0; i < IR_COLOR_STOPS.length - 1; i++) {
    const a = IR_COLOR_STOPS[i];
    const b = IR_COLOR_STOPS[i + 1];
    if (clamped >= b.temp && clamped <= a.temp) {
      const f = (clamped - b.temp) / (a.temp - b.temp);
      const [r, g, bl] = lerpColor(b.color, a.color, f);
      return [r, g, bl, 255];
    }
  }
  if (clamped > 50) return [20, 20, 20, 255];
  if (clamped < -80) return [255, 30, 10, 255];
  return [20, 20, 20, 255];
}

const ALTI_STOPS = [
  { t: 0.000, color: [0, 30, 80] },
  { t: 0.065, color: [0, 90, 160] },
  { t: 0.130, color: [0, 150, 190] },
  { t: 0.190, color: [0, 180, 140] },
  { t: 0.250, color: [60, 200, 80] },
  { t: 0.310, color: [160, 215, 40] },
  { t: 0.375, color: [230, 220, 30] },
  { t: 0.440, color: [255, 190, 20] },
  { t: 0.500, color: [255, 150, 15] },
  { t: 0.560, color: [255, 110, 15] },
  { t: 0.625, color: [255, 60, 20] },
  { t: 0.690, color: [225, 20, 20] },
  { t: 0.750, color: [180, 10, 40] },
  { t: 0.810, color: [150, 10, 90] },
  { t: 0.875, color: [160, 20, 160] },
  { t: 0.940, color: [200, 80, 220] },
  { t: 1.000, color: [235, 200, 250] },
];

function altiToColor(altiM) {
  if (altiM === null || altiM === undefined || Number.isNaN(altiM) || altiM <= -999) {
    return [0, 0, 0, 0];
  }
  const clamped = Math.max(0, Math.min(16000, altiM));
  const t = clamped / 16000;
  for (let i = 0; i < ALTI_STOPS.length - 1; i++) {
    const a = ALTI_STOPS[i];
    const b = ALTI_STOPS[i + 1];
    if (t >= a.t && t <= b.t) {
      const f = (t - a.t) / (b.t - a.t);
      const [r, g, bl] = lerpColor(a.color, b.color, f);
      return [r, g, bl, 255];
    }
  }
  return [...ALTI_STOPS[ALTI_STOPS.length - 1].color, 255];
}

const PRECIP_STOPS = [
  { t: 0.00, color: [120, 190, 235] },
  { t: 0.06, color: [40, 130, 220] },
  { t: 0.12, color: [0, 90, 200] },
  { t: 0.20, color: [0, 160, 90] },
  { t: 0.30, color: [60, 190, 40] },
  { t: 0.40, color: [150, 210, 20] },
  { t: 0.50, color: [230, 220, 20] },
  { t: 0.62, color: [255, 175, 15] },
  { t: 0.74, color: [255, 110, 15] },
  { t: 0.85, color: [230, 40, 30] },
  { t: 0.93, color: [190, 15, 60] },
  { t: 1.00, color: [220, 60, 220] },
];

function precipToColor(precipMmh) {
  if (precipMmh === null || precipMmh === undefined || Number.isNaN(precipMmh) || precipMmh < 0) {
    return [0, 0, 0, 0];
  }
  const clamped = Math.max(0, Math.min(50, precipMmh));
  const t = clamped / 50;
  for (let i = 0; i < PRECIP_STOPS.length - 1; i++) {
    const a = PRECIP_STOPS[i];
    const b = PRECIP_STOPS[i + 1];
    if (t >= a.t && t <= b.t) {
      const f = (t - a.t) / (b.t - a.t);
      const [r, g, bl] = lerpColor(a.color, b.color, f);
      return [r, g, bl, 255];
    }
  }
  return [...PRECIP_STOPS[PRECIP_STOPS.length - 1].color, 255];
}

const LIGHTNING_STOPS = [
  { t: 0.00, color: [255, 255, 120] },
  { t: 0.15, color: [255, 220, 40] },
  { t: 0.30, color: [255, 175, 15] },
  { t: 0.45, color: [255, 120, 10] },
  { t: 0.60, color: [235, 60, 15] },
  { t: 0.75, color: [200, 20, 30] },
  { t: 0.88, color: [170, 10, 90] },
  { t: 1.00, color: [255, 255, 255] },
];

function lightningAccToColor(val) {
  if (val === null || val === undefined || Number.isNaN(val) || val <= 0) {
    return [0, 0, 0, 0];
  }
  const norm = Math.min(1, val / 10);
  const t = Math.sqrt(norm);
  for (let i = 0; i < LIGHTNING_STOPS.length - 1; i++) {
    const a = LIGHTNING_STOPS[i];
    const b = LIGHTNING_STOPS[i + 1];
    if (t >= a.t && t <= b.t) {
      const f = (t - a.t) / (b.t - a.t);
      const [r, g, bl] = lerpColor(a.color, b.color, f);
      return [r, g, bl, 255];
    }
  }
  return [...LIGHTNING_STOPS[LIGHTNING_STOPS.length - 1].color, 255];
}

// ─── DOM ───
const dom = {
  statusDot: null,
  statusText: null,
  hudTime: null,
  layerButtons: null,
  legendIr: null,
  legendAlti: null,
  legendPrecip: null,
  legendLightning: null,
  legendRadar: null,
  preloader: null,
  preloaderFill: null,
  preloaderSubtitle: null,
  preloaderSteps: null,
  refreshBtn: null,
  refreshRing: null,
  refreshCountdown: null,
  radarToggle: null,
  radarTime: null,
  radarControls: null,
  radarPrevBtn: null,
  radarNextBtn: null,
  radarPlayBtn: null,
  radarOnlyBtn: null,
};

let map = null;
let activeLayer = 'image';
let overlays = {};
let currentPayloads = {};
let borderLayer = null;
let labelLayer = null;
let todosLosTowns = [];
let radioActual = 0;
let popupMarker = null;
let showLabels = true;

let refreshTimer = null;
let countdownTimer = null;
let nextRefreshAt = 0;
let isRefreshing = false;

let layerLoaded = {
  image: false,
  ir: false,
  ctth_alti: false,
  precip: false,
  lightning_acc: false
};

// L'overlay de radar és independent de la capa de fons activa: es
// pot mostrar/amagar per sobre de qualsevol capa (satèl·lit, IR,
// altura, precipitació, llamps) amb un toggle, no és una capa mes
// de la llista exclusiva.
let radarOverlayEnabled = false;

// Quan "Nomes radar" es activat, posa a 0 l'opacitat de la capa de
// fons activa (satelit/IR/altura/precip/llamps) perque nomes es
// vegi el radar per sobre del mapa base (hillshade + fronteres).
// Es manté sincronitzat si l'usuari canvia de capa o refresca
// mentre l'opcio esta activa.
let onlyRadarEnabled = false;

function applyOnlyRadarOpacity() {
  if (!overlays[activeLayer]) return;
  overlays[activeLayer].setOpacity(onlyRadarEnabled ? 0 : CONFIG.defaultOpacity);
}

function toggleOnlyRadar(enabled) {
  onlyRadarEnabled = enabled;
  if (dom.radarOnlyBtn) dom.radarOnlyBtn.classList.toggle('is-active', enabled);
  applyOnlyRadarOpacity();
}

// ─── Cargar towns ───
function cargarTowns() {
  return new Promise((resolve, reject) => {
    if (typeof TOWNS_CAT !== 'undefined' && TOWNS_CAT.towns) {
      todosLosTowns = TOWNS_CAT.towns;
      console.log('towns_NE.js cargado: ' + todosLosTowns.length + ' elementos');
      resolve(todosLosTowns);
      return;
    }
    const script = document.createElement('script');
    script.src = 'dades/towns_NE.js';
    script.onload = function() {
      if (typeof TOWNS_CAT !== 'undefined' && TOWNS_CAT.towns) {
        todosLosTowns = TOWNS_CAT.towns;
        console.log('towns_NE.js cargado: ' + todosLosTowns.length + ' elementos');
        resolve(todosLosTowns);
      } else {
        reject(new Error('No se pudo cargar towns_NE.js'));
      }
    };
    script.onerror = function() { reject(new Error('Error cargando towns_NE.js')); };
    document.head.appendChild(script);
  });
}

// ─── GeoJSON ───
async function cargarGeoJSON() {
  try {
    console.log('Cargando GeoJSON...');
    const response = await fetch(CONFIG.geojsonUrl);
    if (!response.ok) return null;
    return await response.json();
  } catch (error) {
    console.log('Sin GeoJSON');
    return null;
  }
}

function dibujarFronteras(geojsonData) {
  if (borderLayer) { map.removeLayer(borderLayer); borderLayer = null; }
  if (!geojsonData) return;
  borderLayer = L.geoJSON(geojsonData, {
    style: { color: '#2b2a2a', weight: 1.2, opacity: 0.5, fill: false },
    interactive: false,
    zIndex: 3,
  }).addTo(map);
}

// ─── Distancia y filtrado de towns ───
function distanciaKm(lat1, lon1, lat2, lon2) {
  const R = 6371;
  const dLat = (lat2 - lat1) * Math.PI / 180;
  const dLon = (lon2 - lon1) * Math.PI / 180;
  const a = Math.sin(dLat/2) * Math.sin(dLat/2) +
            Math.cos(lat1 * Math.PI / 180) * Math.cos(lat2 * Math.PI / 180) *
            Math.sin(dLon/2) * Math.sin(dLon/2);
  const c = 2 * Math.atan2(Math.sqrt(a), Math.sqrt(1-a));
  return R * c;
}

function getTownsByProximity(zoom, bbox, center) {
  if (!todosLosTowns || todosLosTowns.length === 0 || !showLabels) return [];

  var dentroBbox = todosLosTowns.filter(function(t) {
    return t.la >= bbox.lat_min && t.la <= bbox.lat_max &&
           t.lo >= bbox.lon_min && t.lo <= bbox.lon_max;
  });
  if (dentroBbox.length === 0) return [];

  var conDistancia = dentroBbox.map(function(t) {
    var dist = distanciaKm(center.lat, center.lng, t.la, t.lo);
    return { ...t, dist: dist };
  });
  conDistancia.sort(function(a, b) { return a.dist - b.dist; });

  var radioKm = 0, maxElementos = 0, mostrarCimas = false, soloVilas = false, mostrarPueblos = false, maxCimas = 0, alturaMinima = 0;

  if (zoom <= 11) {
    radioKm = 0; maxElementos = 0;
  }
  else if (zoom === 12) {
    radioKm = 60; maxElementos = 25; soloVilas = true;
  }
  else if (zoom === 13) {
    radioKm = 40; maxElementos = 50; soloVilas = false; mostrarPueblos = true;
  }
  else if (zoom === 14) {
    radioKm = 25; maxElementos = 100; soloVilas = false; mostrarPueblos = true;
  }
  else {
    radioKm = 15; maxElementos = 180; soloVilas = false; mostrarPueblos = true; mostrarCimas = true; maxCimas = 3;
  }

  radioActual = radioKm;

  var vilas = conDistancia.filter(function(t) { return t.t === 'vila' && t.dist <= radioKm; });
  var pueblos = conDistancia.filter(function(t) { return t.t === 'poble' && t.dist <= radioKm; });
  var cimas = conDistancia.filter(function(t) { return t.t === 'cim' && t.dist <= radioKm; });

  if (!mostrarPueblos) pueblos = [];
  if (mostrarCimas && alturaMinima >= 0) cimas = cimas.filter(function(t) { return t.a && t.a >= alturaMinima; });
  else cimas = [];
  if (soloVilas) { pueblos = []; cimas = []; }

  cimas.sort(function(a, b) { return (b.a || 0) - (a.a || 0); });
  if (maxCimas > 0 && cimas.length > maxCimas) cimas = cimas.slice(0, maxCimas);

  pueblos.sort(function(a, b) { return a.dist - b.dist; });
  vilas.sort(function(a, b) { return a.dist - b.dist; });

  var resultado = vilas.concat(cimas);
  var pueblosRestantes = maxElementos - resultado.length;
  if (pueblosRestantes > 0 && pueblos.length > 0) resultado = resultado.concat(pueblos.slice(0, pueblosRestantes));
  if (resultado.length > maxElementos) resultado = resultado.slice(0, maxElementos);

  return resultado;
}

function detectarColisiones(etiquetas) {
  if (etiquetas.length === 0) return [];
  var resultado = [];
  var margin = 18;
  for (var i = 0; i < etiquetas.length; i++) {
    var actual = etiquetas[i];
    var punto = map.latLngToContainerPoint([actual.la, actual.lo]);
    var colisiona = false;
    for (var j = 0; j < resultado.length; j++) {
      var existente = resultado[j];
      var puntoExistente = map.latLngToContainerPoint([existente.la, existente.lo]);
      var dx = punto.x - puntoExistente.x;
      var dy = punto.y - puntoExistente.y;
      var distancia = Math.sqrt(dx*dx + dy*dy);
      if (distancia < margin) { colisiona = true; break; }
    }
    if (!colisiona) resultado.push(actual);
  }
  return resultado;
}

function createLabelsFromTowns() {
  if (labelLayer) { map.removeLayer(labelLayer); labelLayer = null; }
  if (!showLabels) return;

  labelLayer = L.layerGroup().addTo(map);
  var zoom = Math.round(map.getZoom());
  var center = map.getCenter();
  var bbox = CONFIG.bbox;

  if (!todosLosTowns || todosLosTowns.length === 0) { mostrarCapitalesPrincipales(); return; }
  var towns = getTownsByProximity(zoom, bbox, center);
  if (towns.length === 0) { mostrarCapitalesPrincipales(); return; }

  var vilas = towns.filter(function(t) { return t.t === 'vila'; });
  var cims = towns.filter(function(t) { return t.t === 'cim'; });
  var pueblos = towns.filter(function(t) { return t.t === 'poble'; });
  var ordenados = vilas.concat(cims).concat(pueblos);
  var sinColisiones = detectarColisiones(ordenados);

  sinColisiones.forEach(function(t) {
    var size = 8, color = '#f0f0f0', fontWeight = 'normal';
    if (t.t === 'cim') {
      var factor = Math.max(0.4, 1 - (t.dist / 150));
      if (t.a && t.a > 2500) { size = Math.round(10 * factor); color = '#ff6b6b'; fontWeight = 'bold'; }
      else if (t.a && t.a > 1500) { size = Math.round(9 * factor); color = '#ffa94d'; }
      else if (t.a && t.a > 800) { size = Math.round(8 * factor); color = '#ffd93d'; }
      else { size = Math.round(7 * factor); color = '#ffed4a'; }
      size = Math.max(5, size);
    } else if (t.t === 'vila') {
      size = Math.round(12 + (zoom - 10) * 0.5);
      color = '#FFFFFF'; fontWeight = 'bold';
    } else if (t.t === 'poble') {
      var factor2 = Math.max(0.4, 1 - (t.dist / 80));
      size = Math.max(6, Math.round(8 * factor2));
      color = '#dddddd';
    }

    var displayName = t.n;
    if (t.a && t.t === 'cim' && t.a > 500) displayName = t.n + ' (' + t.a + 'm)';
    var opacidad = Math.min(1, Math.max(0.4, 1 - (t.dist / (radioActual || 150)) * 0.6));

    var shadowHtml = '<div style="color:' + color + ';font-size:' + size + 'px;font-weight:' + fontWeight + ';font-family:\'Segoe UI\',Arial,sans-serif;text-shadow:-1px -1px 0 rgba(0,0,0,0.95),1px -1px 0 rgba(0,0,0,0.95),-1px 1px 0 rgba(0,0,0,0.95),1px 1px 0 rgba(0,0,0,0.95),0px 0px 8px rgba(0,0,0,0.8);pointer-events:none;user-select:none;text-align:center;line-height:1.1;white-space:nowrap;opacity:' + opacidad.toFixed(2) + ';">' + displayName + '</div>';
    var icon = L.divIcon({ className: '', html: shadowHtml, iconSize: [180, 22], iconAnchor: [90, 11] });
    labelLayer.addLayer(L.marker([t.la, t.lo], { icon: icon, interactive: false, zIndexOffset: 1000 }));
  });
}

function mostrarCapitalesPrincipales() {
  if (!showLabels) return;
  var capitals = [
    { name: 'BARCELONA', lat: 41.3874, lon: 2.1686 },
    { name: 'MADRID', lat: 40.4168, lon: -3.7038 },
    { name: 'VALENCIA', lat: 39.4699, lon: -0.3763 },
    { name: 'ZARAGOZA', lat: 41.6488, lon: -0.8891 },
  ];
  capitals.forEach(function(l) {
    var html = '<div style="color:#FFD700;font-size:16px;font-weight:bold;font-family:\'Segoe UI\',Arial,sans-serif;text-shadow:-2px -2px 0 rgba(0,0,0,0.95),2px -2px 0 rgba(0,0,0,0.95),-2px 2px 0 rgba(0,0,0,0.95),2px 2px 0 rgba(0,0,0,0.95);pointer-events:none;user-select:none;text-align:center;">' + l.name + '</div>';
    var icon = L.divIcon({ className: '', html: html, iconSize: [120, 24], iconAnchor: [60, 12] });
    labelLayer.addLayer(L.marker([l.lat, l.lon], { icon: icon, interactive: false, zIndexOffset: 1000 }));
  });
}

// ─── Utilitats ───
function setStatus(state, message) {
  if (!dom.statusDot) return;
  dom.statusDot.className = 'dot' + (state ? ' ' + state : '');
  dom.statusText.textContent = message;
}

// ─── PANTALLA DE CÀRREGA (preloader) ───
const PRELOADER_STEP_LABELS = {
  image: 'imatge natural color',
  ir: 'temperatura infraroja',
  ctth_alti: 'altura dels núvols',
  precip: 'precipitació',
  lightning_acc: 'activitat elèctrica',
};

function preloaderSetProgress(fraction) {
  if (!dom.preloaderFill) return;
  var pct = Math.max(0, Math.min(100, Math.round(fraction * 100)));
  dom.preloaderFill.style.width = pct + '%';
}

function preloaderSetSubtitle(text) {
  if (!dom.preloaderSubtitle) return;
  dom.preloaderSubtitle.textContent = text;
}

function preloaderMarkStep(layerKey, state) {
  if (!dom.preloaderSteps) return;
  var el = dom.preloaderSteps.querySelector('[data-step="' + layerKey + '"]');
  if (!el) return;
  el.classList.remove('done', 'failed');
  if (state === 'done') el.classList.add('done');
  if (state === 'failed') el.classList.add('failed');
}

function preloaderHide() {
  if (!dom.preloader) return;
  preloaderSetProgress(1);
  setTimeout(function() {
    dom.preloader.classList.add('hidden');
  }, 250);
}

// ─── Hora Madrid ───
function formatHoraMadrid(timestamp) {
  if (!timestamp) return '--:--:--';
  try {
    var raw = String(timestamp);
    var tieneZona = /Z$|[+-]\d{2}:?\d{2}$/.test(raw.trim());
    var isoParaParsear = tieneZona ? raw : (raw.replace(' ', 'T') + 'Z');

    var dt = new Date(isoParaParsear);
    if (Number.isNaN(dt.getTime())) {
      dt = new Date(raw);
    }
    if (Number.isNaN(dt.getTime())) return raw;

    var formatted = new Intl.DateTimeFormat('ca-ES', {
      timeZone: 'Europe/Madrid',
      day: '2-digit',
      month: '2-digit',
      hour: '2-digit',
      minute: '2-digit',
      second: '2-digit',
    }).format(dt);

    return formatted + ' (Hora Madrid)';
  } catch (err) {
    return timestamp || '--:--:--';
  }
}

// ─── POPUP: Obtener información del píxel ───
function getPixelValue(lat, lng, layerKey) {
  var payload = currentPayloads[layerKey];
  if (!payload) return null;

  var width = payload.width, height = payload.height, values = payload.values, bbox = payload.bbox;
  if (!width || !height || !values) return null;

  var lon_min = bbox.lon_min, lat_min = bbox.lat_min, lon_max = bbox.lon_max, lat_max = bbox.lat_max;

  var col = Math.round(((lng - lon_min) / (lon_max - lon_min)) * (width - 1));
  var row = Math.round(((lat_max - lat) / (lat_max - lat_min)) * (height - 1));

  col = Math.max(0, Math.min(width - 1, col));
  row = Math.max(0, Math.min(height - 1, row));

  var val = values[row]?.[col];
  if (val === undefined || val === null || Number.isNaN(val)) return null;
  return val;
}

function formatPixelLine(layerKey, val) {
  switch (layerKey) {
    case 'ir':
      if (val === null || val <= -999) return null;
      return 'Temperatura IR: ' + val.toFixed(1) + '°C';
    case 'ctth_alti':
      if (val === null || val <= -999) return null;
      return 'Altura núvol: ' + Math.round(val) + ' m';
    case 'precip':
      if (val === null || val < 0) return null;
      return 'Precipitació: ' + val.toFixed(1) + ' mm/h';
    case 'lightning_acc':
      if (val === null || val <= 0) return null;
      return 'Llamps acumulats: ' + Math.round(val);
    default:
      return null;
  }
}

function getPixelInfoLines(lat, lng, layerKey) {
  var lines = [];

  if (layerKey === 'image') {
    lines.push('Imatge natural color');
    var altiVal = getPixelValue(lat, lng, 'ctth_alti');
    var altiLine = formatPixelLine('ctth_alti', altiVal);
    if (altiLine) lines.push(altiLine);
    else lines.push('Altura núvol: sense dades');
  } else {
    var val = getPixelValue(lat, lng, layerKey);
    var line = formatPixelLine(layerKey, val);
    lines.push(line || 'Sense dades');
  }

  return lines;
}

// ─── setOverlay ───
function setOverlay(key, dataUrl, bbox, opacity) {
  var lon_min = CONFIG.bbox.lon_min, lat_min = CONFIG.bbox.lat_min, 
      lon_max = CONFIG.bbox.lon_max, lat_max = CONFIG.bbox.lat_max;
  var bounds = [[lat_min, lon_min], [lat_max, lon_max]];
  
  if (overlays[key]) {
    overlays[key].setUrl(dataUrl);
    overlays[key].setBounds(bounds);
    overlays[key].setOpacity(opacity);
    return overlays[key];
  }
  
  overlays[key] = L.imageOverlay(dataUrl, bounds, {
    opacity: opacity,
    interactive: false,
    zIndex: 2,
  });
  return overlays[key];
}

// ─── updateHudTime ───
function updateHudTime(timestamp) {
  if (!dom.hudTime) return;
  dom.hudTime.textContent = formatHoraMadrid(timestamp);
}

// ─── fetchAndDecode ───
async function fetchAndDecode(url) {
  setStatus('loading', 'Descarregant...');
  var bustedUrl = url + (url.indexOf('?') === -1 ? '?' : '&') + 't=' + Date.now();
  var response = await fetch(bustedUrl, { cache: 'no-store' });
  if (!response.ok) throw new Error('HTTP ' + response.status);
  var compressed = new Uint8Array(await response.arrayBuffer());
  var decompressed;
  try { decompressed = pako.inflate(compressed); }
  catch (err) { throw new Error('Error descomprimint'); }
  var payload;
  try { payload = msgpack.decode(decompressed); }
  catch (err) { throw new Error('Error decodificant'); }
  return payload;
}

// ─── buildImageDataUrl ───
const UPSCALE_FACTOR = 4;
function buildImageDataUrl(payload) {
  var width = payload.width, height = payload.height, pixels = payload.pixels;
  if (!width || !height || !pixels) throw new Error('Payload invàlid');
  var rgbBytes = new Uint8Array(pixels);
  var expectedLength = width * height * 3;
  if (rgbBytes.length !== expectedLength) throw new Error('Mida incorrecta');
 
  var source = document.createElement('canvas');
  source.width = width;
  source.height = height;
  var sourceCtx = source.getContext('2d');
  var imageData = sourceCtx.createImageData(width, height);
  for (var i = 0, j = 0; i < rgbBytes.length; i += 3, j += 4) {
    imageData.data[j] = rgbBytes[i];
    imageData.data[j + 1] = rgbBytes[i + 1];
    imageData.data[j + 2] = rgbBytes[i + 2];
    imageData.data[j + 3] = 255;
  }
  sourceCtx.putImageData(imageData, 0, 0);
 
  // ── NOU: usa HDEnhance si està disponible, sinó cau al mètode antic ──
  var upscaled;
  if (window.HDEnhance) {
    upscaled = window.HDEnhance.upscaleWithSharpen(source, UPSCALE_FACTOR, {
      amount: 0.9,
      threshold: 2,
      cssFilter: 'contrast(1.04) saturate(1.06)', // una mica més suau que abans
                                                    // perquè el sharpen ja aporta contrast
    });
  } else {
    // fallback: comportament original sense hd.js
    var midFactor = Math.max(1, Math.round(UPSCALE_FACTOR / 2));
    var mid = document.createElement('canvas');
    mid.width = width * midFactor;
    mid.height = height * midFactor;
    var midCtx = mid.getContext('2d');
    midCtx.imageSmoothingEnabled = true;
    midCtx.imageSmoothingQuality = 'high';
    midCtx.drawImage(source, 0, 0, mid.width, mid.height);
 
    upscaled = document.createElement('canvas');
    upscaled.width = width * UPSCALE_FACTOR;
    upscaled.height = height * UPSCALE_FACTOR;
    var upscaledCtx = upscaled.getContext('2d');
    upscaledCtx.imageSmoothingEnabled = true;
    upscaledCtx.imageSmoothingQuality = 'high';
    upscaledCtx.filter = 'contrast(1.06) saturate(1.08)';
    upscaledCtx.drawImage(mid, 0, 0, upscaled.width, upscaled.height);
    upscaledCtx.filter = 'none';
    mid.width = 0; mid.height = 0;
  }
 
  var result = upscaled.toDataURL('image/png', 1.0);
 
  source.width = 0; source.height = 0;
  upscaled.width = 0; upscaled.height = 0;
 
  return result;
}



// ─── Funciones build para cada capa ───
function buildIrDataUrl(p) { return buildValueGridDataUrl(p, irToColor); }
function buildCtthAltiDataUrl(p) { return buildValueGridDataUrl(p, altiToColor); }
function buildPrecipDataUrl(p) { return buildValueGridDataUrl(p, precipToColor); }
function buildLightningAccDataUrl(p) { return buildValueGridDataUrl(p, lightningAccToColor); }

async function loadLayer(key, url, buildFn) {
  if (layerLoaded[key]) {
    console.log('Capa ' + key + ' ja carregada, utilitzant cache');
    return true;
  }
  
  var friendlyNames = {
    'image': 'imatge',
    'ir': 'infraroig',
    'ctth_alti': 'altura dels núvols',
    'precip': 'precipitació',
    'lightning_acc': 'llamps'
  };
  var displayName = friendlyNames[key] || key;
  
  try {
    setStatus('loading', 'Carregant ' + displayName + '...');
    var payload = await fetchAndDecode(url);
    var dataUrl = buildFn(payload);
    currentPayloads[key] = payload;
    setOverlay(key, dataUrl, payload.bbox, CONFIG.defaultOpacity);
    updateHudTime(payload.timestamp);
    layerLoaded[key] = true;
    console.log('Capa ' + key + ' carregada correctament');
    return true;
  } catch (err) {
    console.warn('Error carregant ' + key + ':', err.message);
    return false;
  }
}

// ─── showActiveLayer ───
function showActiveLayer() {
  for (var key in overlays) {
    if (overlays[key] && map.hasLayer(overlays[key])) map.removeLayer(overlays[key]);
  }
  if (overlays[activeLayer]) overlays[activeLayer].addTo(map);
  if (borderLayer && !map.hasLayer(borderLayer)) {
    borderLayer.addTo(map);
    borderLayer.setZIndex(3);
  }
  applyOnlyRadarOpacity();
}

// ─── loadAllLayers ───
async function loadAllLayers(isFirstLoad) {
  if (isFirstLoad === undefined) isFirstLoad = false;
  if (isRefreshing) return;
  isRefreshing = true;
  setRefreshBtnState('loading');

  var initialLayer = { key: 'image', url: CONFIG.dataUrl, build: buildImageDataUrl };
  var statuses = {};
  var errors = [];

  try {
    setStatus('loading', 'Carregant imatge...');
    if (isFirstLoad) preloaderSetSubtitle('Carregant imatge natural color...');
    await loadLayer(initialLayer.key, initialLayer.url, initialLayer.build);
    statuses[initialLayer.key] = true;
    if (isFirstLoad) preloaderMarkStep(initialLayer.key, 'done');
  } catch (err) {
    console.warn('Error carregant imatge:', err.message);
    errors.push(initialLayer.key);
    statuses[initialLayer.key] = false;
    if (isFirstLoad) preloaderMarkStep(initialLayer.key, 'failed');
  }

  if (isFirstLoad) preloaderSetProgress(1);

  if (!statuses['image']) {
    setStatus('error', 'Error: no s\'ha pogut carregar la imatge');
    if (isFirstLoad) preloaderSetSubtitle('No s\'ha pogut carregar la imatge del satèl·lit');
    isRefreshing = false;
    setRefreshBtnState('error');
    scheduleNextAutoRefresh();
    return;
  }

  var otherLayers = ['ir', 'ctth_alti', 'precip', 'lightning_acc'];
  otherLayers.forEach(function(key) {
    statuses[key] = false;
    layerLoaded[key] = false;
    if (isFirstLoad) {
      preloaderMarkStep(key, 'pending');
    }
  });

  updateLayerButtonsAvailability(statuses);

  if (isFirstLoad) {
    activeLayer = 'image';
  }

  showActiveLayer();
  setStatus('', 'Imatge carregada. Clica altres capes per carregar-les.');

  if (isFirstLoad) {
    preloaderSetSubtitle('Mapa llest! Clica les altres capes per carregar-les.');
    preloaderHide();
  }

  isRefreshing = false;
  setRefreshBtnState('idle');
  scheduleNextAutoRefresh();
}

// ─── Controls UI ───
function updateLayerButtonsAvailability(statuses) {
  if (!dom.layerButtons) return;
  dom.layerButtons.forEach(function(btn) {
    var layer = btn.dataset.layer;
    var available = statuses[layer] || false;
    var isActive = layer === activeLayer && available;
    
    btn.disabled = false;
    btn.classList.toggle('unavailable', !available && layer !== 'image');
    btn.classList.toggle('active', isActive);
    btn.classList.toggle('loading-layer', false);
    
    if (!available && layer !== 'image') {
      btn.textContent = btn.textContent.replace(' Cargar', '') + ' Cargar';
    }
  });
}

// ─── switchLayer amb càrrega sota demanda ───
async function switchLayer(layerName) {
  // Si la capa ja està carregada, simplement canviem
  if (layerLoaded[layerName]) {
    activeLayer = layerName;
    showActiveLayer();
    updateLayerButtonsUI();
    updateLegendVisibility(layerName);
    return;
  }

  console.log('🔄 Carregant capa sota demanda: ' + layerName);
  
  dom.layerButtons.forEach(function(btn) {
    if (btn.dataset.layer === layerName) {
      btn.classList.add('loading-layer');
      btn.textContent = '⏳ Carregant...';
    }
  });

  var layerConfigs = {
    'ir': { url: CONFIG.irDataUrl, build: buildIrDataUrl },
    'ctth_alti': { url: CONFIG.ctthAltiDataUrl, build: buildCtthAltiDataUrl },
    'precip': { url: CONFIG.precipDataUrl, build: buildPrecipDataUrl },
    'lightning_acc': { url: CONFIG.lightningAccDataUrl, build: buildLightningAccDataUrl }
  };

  var config = layerConfigs[layerName];
  if (!config) return;

  try {
    var success = await loadLayer(layerName, config.url, config.build);
    
    if (success) {
      activeLayer = layerName;
      showActiveLayer();
      updateLayerButtonsUI();
      updateLegendVisibility(layerName);
      setStatus('', 'Capa ' + layerName + ' carregada');
    } else {
      setStatus('error', 'Error carregant ' + layerName);
    }
  } catch (err) {
    console.error('Error carregant capa:', err);
    setStatus('error', 'Error carregant ' + layerName);
  }

  dom.layerButtons.forEach(function(btn) {
    if (btn.dataset.layer === layerName) {
      btn.classList.remove('loading-layer');
      var label = {
        'ir': 'IR Temperatura',
        'ctth_alti': 'Altura núvols',
        'precip': 'Precipitació',
        'lightning_acc': 'Llamps'
      }[layerName] || layerName;
      btn.textContent = label;
    }
  });
}

function updateLayerButtonsUI() {
  if (!dom.layerButtons) return;
  dom.layerButtons.forEach(function(btn) {
    var layer = btn.dataset.layer;
    var isActive = layer === activeLayer && layerLoaded[layer];
    btn.classList.toggle('active', isActive);
    if (layerLoaded[layer]) {
      btn.classList.remove('unavailable');
    }
  });
}

function updateLegendVisibility(layerName) {
  var legendMap = {
    'ir': 'legendIr',
    'ctth_alti': 'legendAlti',
    'precip': 'legendPrecip',
    'lightning_acc': 'legendLightning',
  };

  var allLegends = ['legendIr', 'legendAlti', 'legendPrecip', 'legendLightning'];
  allLegends.forEach(function(key) { if (dom[key]) dom[key].style.display = 'none'; });

  var legendKey = legendMap[layerName];
  if (legendKey && dom[legendKey]) dom[legendKey].style.display = 'block';

  // La llegenda de radar és independent: es mostra sempre que
  // l'overlay estigui actiu, sigui quina sigui la capa de fons.
  if (dom.legendRadar) dom.legendRadar.style.display = radarOverlayEnabled ? 'block' : 'none';
}

async function toggleRadarOverlay(enabled) {
  radarOverlayEnabled = enabled;

  if (!enabled) {
    if (window.RadarLayer) window.RadarLayer.detach();
    if (dom.legendRadar) dom.legendRadar.style.display = 'none';
    if (dom.radarControls) dom.radarControls.style.display = 'none';
    if (onlyRadarEnabled) toggleOnlyRadar(false);
    return;
  }

  if (window.RadarLayer.isLoaded()) {
    window.RadarLayer.attach(map);
    if (dom.legendRadar) dom.legendRadar.style.display = 'block';
    if (dom.radarControls) dom.radarControls.style.display = 'flex';

    // ← AQUÍ (rama: radar ya estaba cargado)
    window.StormAlert.attach(map);
    await window.StormAlert.refresh();

    return;
  }

  if (dom.radarToggle) dom.radarToggle.disabled = true;
  setStatus('loading', 'Carregant radar...');

  var ok = await window.RadarLayer.load();

  if (dom.radarToggle) dom.radarToggle.disabled = false;

  if (!ok) {
    setStatus('error', 'Error carregant radar');
    radarOverlayEnabled = false;
    if (dom.radarToggle) dom.radarToggle.checked = false;
    return;
  }

  window.RadarLayer.attach(map);
  if (dom.legendRadar) dom.legendRadar.style.display = 'block';
  if (dom.radarControls) dom.radarControls.style.display = 'flex';
  setStatus('', 'Radar actiu');

  // ← Y AQUÍ (rama: radar se acaba de cargar por primera vez)
  window.StormAlert.attach(map);
  await window.StormAlert.refresh();
}

function bindLayerToggle() {
  if (!dom.layerButtons) return;
  dom.layerButtons.forEach(function(btn) {
    btn.addEventListener('click', function() {
      if (btn.disabled) return;
      var layer = btn.dataset.layer;
      
      if (layer === activeLayer && layerLoaded[layer]) return;
      
      dom.layerButtons.forEach(function(b) { b.classList.remove('active'); });
      btn.classList.add('active');
      
      switchLayer(layer);
    });
  });
}

// ═════════════════════════════════════════════════════════════
// BOTÓ DE REFRESC + COMPTADOR ENRERE (5 min)
// ═════════════════════════════════════════════════════════════

function injectRefreshButtonStyles() {
  if (document.getElementById('refresh-btn-styles')) return;
  var style = document.createElement('style');
  style.id = 'refresh-btn-styles';
  style.textContent = `
    .refresh-btn {
      position: relative;
      width: 30px;
      height: 30px;
      flex-shrink: 0;
      border: none;
      background: transparent;
      cursor: pointer;
      display: flex;
      align-items: center;
      justify-content: center;
      -webkit-tap-highlight-color: transparent;
    }
    .refresh-btn svg { position: absolute; inset: 0; transform: rotate(-90deg); }
    .refresh-btn .refresh-ring-bg {
      fill: none;
      stroke: rgba(255,255,255,0.08);
      stroke-width: 2.5;
    }
    .refresh-btn .refresh-ring-fg {
      fill: none;
      stroke: #4fc3f7;
      stroke-width: 2.5;
      stroke-linecap: round;
      transition: stroke-dashoffset 1s linear, stroke 0.3s ease;
    }
    .refresh-btn .refresh-icon {
      position: relative;
      width: 13px;
      height: 13px;
      color: #4fc3f7;
      transition: transform 0.5s ease, color 0.3s ease;
      display: flex;
      align-items: center;
      justify-content: center;
    }
    .refresh-btn .refresh-icon svg.icon-refresh {
      width: 100%;
      height: 100%;
      transform: none;
    }
    .refresh-btn.is-loading .refresh-icon {
      animation: refresh-spin 0.9s linear infinite;
    }
    .refresh-btn.is-error .refresh-ring-fg { stroke: #ef5350; }
    .refresh-btn.is-error .refresh-icon { color: #ef5350; }
    .refresh-btn:hover .refresh-icon { color: #81d4fa; }
    .refresh-btn:active .refresh-icon { transform: scale(0.85); }
    @keyframes refresh-spin { to { transform: rotate(360deg); } }

    .refresh-countdown {
      font-size: 8px;
      font-weight: 500;
      font-variant-numeric: tabular-nums;
      color: #7a8ba8;
      letter-spacing: 0.02em;
      white-space: nowrap;
      margin-top: 1px;
    }
    .hud-refresh-wrap {
      display: flex;
      flex-direction: column;
      align-items: center;
      gap: 0;
    }

    .layer-btn.loading-layer {
      opacity: 0.7;
      cursor: wait;
    }
    .layer-btn.loading-layer::after {
      content: '';
      display: inline-block;
      width: 10px;
      height: 10px;
      margin-left: 6px;
      border: 2px solid #4fc3f7;
      border-top-color: transparent;
      border-radius: 50%;
      animation: layer-spin 0.8s linear infinite;
      vertical-align: middle;
    }
    @keyframes layer-spin {
      to { transform: rotate(360deg); }
    }
    .layer-btn.unavailable {
      opacity: 0.5;
    }
  `;
  document.head.appendChild(style);
}

function createRefreshButton() {
  injectRefreshButtonStyles();

  var hudRow = document.querySelector('.hud .hud-row');
  if (!hudRow) return;

  var wrap = document.createElement('div');
  wrap.className = 'hud-refresh-wrap';

  var btn = document.createElement('button');
  btn.className = 'refresh-btn';
  btn.type = 'button';
  btn.title = 'Actualitzar ara';
  btn.innerHTML =
    '<svg viewBox="0 0 32 32">' +
      '<circle class="refresh-ring-bg" cx="16" cy="16" r="13"></circle>' +
      '<circle class="refresh-ring-fg" cx="16" cy="16" r="13" ' +
        'stroke-dasharray="81.68" stroke-dashoffset="0"></circle>' +
    '</svg>' +
    '<span class="refresh-icon">' +
      '<svg class="icon-refresh" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.4" stroke-linecap="round" stroke-linejoin="round">' +
        '<path d="M21 12a9 9 0 1 1-2.64-6.36"></path>' +
        '<polyline points="21 3 21 9 15 9"></polyline>' +
      '</svg>' +
    '</span>';

  var countdown = document.createElement('span');
  countdown.className = 'refresh-countdown';
  countdown.id = 'refresh-countdown';
  countdown.textContent = '5:00';

  wrap.appendChild(btn);
  wrap.appendChild(countdown);
  hudRow.appendChild(wrap);

  dom.refreshBtn = btn;
  dom.refreshRing = btn.querySelector('.refresh-ring-fg');
  dom.refreshCountdown = countdown;

  btn.addEventListener('click', function() {
    if (isRefreshing) return;
    console.log('Actualització manual del satèl·lit...');
    refreshCurrentLayer();
  });
}

// Funció per refrescar només la capa activa
async function refreshCurrentLayer() {
  if (isRefreshing) return;

  // Si l'overlay de radar està actiu, es refresca en paral·lel amb
  // la capa de fons (són independents ara). Es passa force=true a
  // load() perque cada refresc (manual o automatic) torni a
  // descarregar els 5 frames des de R2 sense fer servir cap dada
  // en cache (anticache massiu: mai es reutilitzen frames vells).
  // Es respecta si l'usuari tenia l'animacio en marxa o en pausa:
  // nomes es torna a engegar l'animacio si ja estava reproduint-se.
  if (radarOverlayEnabled && window.RadarLayer) {
    var radarWasPlaying = window.RadarLayer.isPlaying();
    window.RadarLayer.detach();
    window.RadarLayer.load(true).then(function(ok) {
      if (ok) {
        window.RadarLayer.attach(map);
        if (dom.radarControls) dom.radarControls.style.display = 'flex';
        if (radarWasPlaying) window.RadarLayer.play();
      }
    });
  }

    if (radarOverlayEnabled && window.StormAlert) {
    window.StormAlert.refresh();
  }

  isRefreshing = true;
  setRefreshBtnState('loading');

  var layerConfigs = {
    'image': { url: CONFIG.dataUrl, build: buildImageDataUrl },
    'ir': { url: CONFIG.irDataUrl, build: buildIrDataUrl },
    'ctth_alti': { url: CONFIG.ctthAltiDataUrl, build: buildCtthAltiDataUrl },
    'precip': { url: CONFIG.precipDataUrl, build: buildPrecipDataUrl },
    'lightning_acc': { url: CONFIG.lightningAccDataUrl, build: buildLightningAccDataUrl }
  };

  var config = layerConfigs[activeLayer];
  if (!config) {
    isRefreshing = false;
    setRefreshBtnState('idle');
    return;
  }

  try {
    layerLoaded[activeLayer] = false;
    await loadLayer(activeLayer, config.url, config.build);
    showActiveLayer();
    setStatus('', 'Capa ' + activeLayer + ' actualitzada');
  } catch (err) {
    console.error('Error refrescant capa:', err);
    setStatus('error', 'Error actualitzant');
  }

  isRefreshing = false;
  setRefreshBtnState('idle');
  scheduleNextAutoRefresh();
}

function setRefreshBtnState(state) {
  if (!dom.refreshBtn) return;
  dom.refreshBtn.classList.remove('is-loading', 'is-error');
  if (state === 'loading') dom.refreshBtn.classList.add('is-loading');
  if (state === 'error') dom.refreshBtn.classList.add('is-error');
}

function updateCountdownDisplay() {
  if (!dom.refreshCountdown) return;
  var remainingMs = Math.max(0, nextRefreshAt - Date.now());
  var totalSeconds = Math.ceil(remainingMs / 1000);
  var mm = Math.floor(totalSeconds / 60);
  var ss = totalSeconds % 60;
  dom.refreshCountdown.textContent = mm + ':' + (ss < 10 ? '0' : '') + ss;

  if (dom.refreshRing) {
    var circumference = 81.68;
    var fraction = 1 - Math.min(1, Math.max(0, remainingMs / AUTO_REFRESH_MS));
    dom.refreshRing.setAttribute('stroke-dashoffset', String(circumference * fraction));
  }
}

function scheduleNextAutoRefresh() {
  if (refreshTimer) clearTimeout(refreshTimer);
  if (countdownTimer) clearInterval(countdownTimer);

  nextRefreshAt = Date.now() + AUTO_REFRESH_MS;
  updateCountdownDisplay();

  countdownTimer = setInterval(updateCountdownDisplay, 1000);

  refreshTimer = setTimeout(function() {
    console.log('Actualitzant dades del satèl·lit (auto)...');
    refreshCurrentLayer();
  }, AUTO_REFRESH_MS);
}

// ─── Inici ───
function initApp() {
  dom.statusDot = document.getElementById('status-dot');
  dom.statusText = document.getElementById('status-text');
  dom.hudTime = document.getElementById('hud-time');
  dom.layerButtons = document.querySelectorAll('.layer-btn');
  dom.legendIr = document.getElementById('legend-ir');
  dom.legendAlti = document.getElementById('legend-alti');
  dom.legendPrecip = document.getElementById('legend-precip');
  dom.legendLightning = document.getElementById('legend-lightning');
  dom.legendRadar = document.getElementById('legend-radar');
  dom.preloader = document.getElementById('preloader');
  dom.preloaderFill = document.getElementById('preloader-fill');
  dom.preloaderSubtitle = document.getElementById('preloader-subtitle');
  dom.preloaderSteps = document.getElementById('preloader-steps');
  dom.radarToggle = document.getElementById('radar-toggle');
  dom.radarTime = document.getElementById('radar-time');
  dom.radarControls = document.getElementById('radar-controls');
  dom.radarPrevBtn = document.getElementById('radar-prev-btn');
  dom.radarNextBtn = document.getElementById('radar-next-btn');
  dom.radarPlayBtn = document.getElementById('radar-play-btn');
  dom.radarOnlyBtn = document.getElementById('radar-only-btn');

  // Vincula l'element on RadarLayer escriura l'hora de cada frame
  // mentre s'anima (al costat del toggle "Radar de pluja").
  if (window.RadarLayer && dom.radarTime) {
    window.RadarLayer.setTimeElement(dom.radarTime);
  }

  // Commuta la icona play/pause quan l'estat d'animacio canvia,
  // tant si el canvi ve del boto com d'una fletxa manual.
  if (window.RadarLayer && dom.radarPlayBtn) {
    window.RadarLayer.setPlayStateCallback(function(isPlaying) {
      dom.radarPlayBtn.classList.toggle('is-playing', isPlaying);
    });
  }

  if (dom.radarPrevBtn) {
    dom.radarPrevBtn.addEventListener('click', function() {
      if (window.RadarLayer) {
        window.RadarLayer.pause();
        window.RadarLayer.stepBackward();
      }
    });
  }
  if (dom.radarNextBtn) {
    dom.radarNextBtn.addEventListener('click', function() {
      if (window.RadarLayer) {
        window.RadarLayer.pause();
        window.RadarLayer.stepForward();
      }
    });
  }
  if (dom.radarPlayBtn) {
    dom.radarPlayBtn.addEventListener('click', function() {
      if (window.RadarLayer) window.RadarLayer.togglePlay();
    });
  }
  if (dom.radarOnlyBtn) {
    dom.radarOnlyBtn.addEventListener('click', function() {
      toggleOnlyRadar(!onlyRadarEnabled);
    });
  }

  createRefreshButton();

  initMapFirstLoad();
  bindLayerToggle();

  if (dom.radarToggle) {
    dom.radarToggle.addEventListener('change', function() {
      toggleRadarOverlay(dom.radarToggle.checked);
    });
  }

  console.log('Tempestes.cat - Meteosat MTG');
  console.log('Prem "L" per mostrar/ocultar etiquetes');
  console.log('📡 Càrrega sota demanda: només es carrega la capa que es veu');
}

function initMapFirstLoad() {
  map = L.map('map', {
    center: CONFIG.initialCenter,
    zoom: CONFIG.initialZoom,
    zoomControl: true,
    fadeAnimation: true,
    attributionControl: true,
    zoomSnap: 0.5,
  });

  var lon_min = CONFIG.bbox.lon_min, lat_min = CONFIG.bbox.lat_min, lon_max = CONFIG.bbox.lon_max, lat_max = CONFIG.bbox.lat_max;
  var bounds = [[lat_min, lon_min], [lat_max, lon_max]];

  L.tileLayer(
    'https://server.arcgisonline.com/ArcGIS/rest/services/Elevation/World_Hillshade_Dark/MapServer/tile/{z}/{y}/{x}.png',
    { maxZoom: 13, minZoom: 1, attribution: 'Tiles © Esri', opacity: 0.9 }
  ).addTo(map);

  map.fitBounds(bounds, { padding: [10, 10] });

  cargarGeoJSON().then(dibujarFronteras);
  cargarTowns().then(function() { setTimeout(createLabelsFromTowns, 100); }).catch(function() { mostrarCapitalesPrincipales(); });

  var timeoutLabels = null;
  map.on('zoomend', function() {
    clearTimeout(timeoutLabels);
    timeoutLabels = setTimeout(function() {
      if (todosLosTowns && todosLosTowns.length > 0 && showLabels) createLabelsFromTowns();
    }, 200);
  });
  map.on('moveend', function() {
    clearTimeout(timeoutLabels);
    timeoutLabels = setTimeout(function() {
      if (todosLosTowns && todosLosTowns.length > 0 && showLabels) createLabelsFromTowns();
    }, 200);
  });

  map.on('click', function(e) {
    var lat = e.latlng.lat;
    var lng = e.latlng.lng;
    var lines = getPixelInfoLines(lat, lng, activeLayer);

    if (popupMarker) { map.removeLayer(popupMarker); popupMarker = null; }
    if (window.popupTimeout) { clearTimeout(window.popupTimeout); window.popupTimeout = null; }

    var popupId = 'pixel-popup-' + Date.now();
    var linesHtml = lines.map(function(l) {
      return '<div>' + l + '</div>';
    }).join('');

    var html =
      '<div style="position:relative;background:rgba(10,14,26,0.92);backdrop-filter:blur(12px);' +
      'border:1px solid rgba(79,195,247,0.25);border-radius:10px;padding:8px 26px 8px 14px;' +
      'color:#e8edf5;font-size:12px;font-family:\'Segoe UI\',Arial,sans-serif;max-width:260px;' +
      'text-align:center;box-shadow:0 4px 24px rgba(0,0,0,0.6);">' +
        '<span id="' + popupId + '" style="position:absolute;top:2px;right:6px;cursor:pointer;' +
        'color:#9fb3c8;font-weight:bold;font-size:14px;line-height:1;padding:2px 4px;">×</span>' +
        linesHtml +
      '</div>';

    popupMarker = L.marker([lat, lng], {
      icon: L.divIcon({
        className: 'info-marker',
        html: html,
        iconSize: [260, 20 + lines.length * 16],
        iconAnchor: [130, 10 + lines.length * 8],
      }),
      interactive: true,
    }).addTo(map);

    var markerEl = popupMarker.getElement();
    var closeBtn = markerEl ? markerEl.querySelector('#' + popupId) : null;
    if (closeBtn) {
      closeBtn.addEventListener('click', function(evt) {
        evt.stopPropagation();
        if (popupMarker) { map.removeLayer(popupMarker); popupMarker = null; }
        if (window.popupTimeout) { clearTimeout(window.popupTimeout); window.popupTimeout = null; }
      }, { once: true });
    }

    window.popupTimeout = setTimeout(function() {
      if (popupMarker) { map.removeLayer(popupMarker); popupMarker = null; }
    }, 12000);
  });

  document.addEventListener('keydown', function(e) {
    if (e.key === 'l' || e.key === 'L') {
      e.preventDefault();
      showLabels = !showLabels;
      if (showLabels) {
        createLabelsFromTowns();
        console.log('Etiquetas activadas');
      } else {
        if (labelLayer) { map.removeLayer(labelLayer); labelLayer = null; }
        console.log('Etiquetas desactivadas');
      }
    }
  });

  loadAllLayers(true);
  return map;
}

document.addEventListener('DOMContentLoaded', initApp);