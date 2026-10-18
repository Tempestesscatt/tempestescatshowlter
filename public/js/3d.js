// llamps.js
// Mòdul experimental per dibuixar llamps en directe de Blitzortung sobre MapLibre.
// Basat en enginyeria inversa de la comunitat; pot deixar de funcionar.

const LLAMPS_SRC = 'llamps-src';
const LLAMPS_LAYER = 'llamps-layer';
const MAX_LLAMPS = 800;       // màxim de llamps a la memòria
const MINUTS_VISIBLES = 30;   // quants minuts enrere mostrar

let ws = null;
let llampsData = []; // array de { lon, lat, time }

function initLlampLayer(map) {
  if (!map) return;

  // Font GeoJSON per als llamps
  if (!map.getSource(LLAMPS_SRC)) {
    map.addSource(LLAMPS_SRC, {
      type: 'geojson',
      data: { type: 'FeatureCollection', features: [] },
    });
  }

  // Capa de punts (cercles) per als llamps
  if (!map.getLayer(LLAMPS_LAYER)) {
    map.addLayer({
      id: LLAMPS_LAYER,
      type: 'circle',
      source: LLAMPS_SRC,
      paint: {
        'circle-radius': [
          'interpolate', ['linear'], ['zoom'],
          3, 2,
          6, 3,
          10, 5,
          14, 8,
        ],
        'circle-color': '#ffdd00',
        'circle-opacity': 0.9,
        'circle-stroke-width': 1,
        'circle-stroke-color': '#ff8800',
        'circle-stroke-opacity': 0.7,
      },
    });
  }

  // Iniciar la connexió WebSocket
  connectBlitzortung(map);
}

function connectBlitzortung(map) {
  if (ws && ws.readyState === WebSocket.OPEN) return;

  // Servidor alternatiu (prova ws1, ws2, etc.)
  const server = 'wss://ws1.blitzortung.org/';
  console.log('[llamps] connectant a', server);

  try {
    ws = new WebSocket(server);
  } catch (e) {
    console.warn('[llamps] error creant WebSocket:', e);
    return;
  }

  ws.onopen = () => {
    console.log('[llamps] connectat');
    // Payload de subscripció bàsic (enginyeria inversa)
    // Alguns exemples fan servir un objecte amb west/east/north/south/time
    const payload = {
      west: -10,
      east: 10,
      north: 50,
      south: 35,
      time: Date.now() * 1000000 - 60000000000, // ~60s enrere en nanosegons?
    };
    // Alternativa: alguns clients envien {a: 111} o similar
    // ws.send(JSON.stringify({ a: 111 }));
    ws.send(JSON.stringify(payload));
  };

  ws.onmessage = (ev) => {
    let msg;
    try {
      // El protocol pot estar comprimit o ofuscat; aquí assumim JSON net
      // Si falla, mira la llibreria de descodificació de la comunitat
      msg = JSON.parse(ev.data);
    } catch (e) {
      // Si el missatge no és JSON, ignora'l (pot estar comprimit)
      return;
    }

    // El format pot variar: pot ser un objecte únic o un array
    const items = Array.isArray(msg) ? msg : (msg.d || [msg]);
    for (const it of items) {
      if (typeof it.lat === 'number' && typeof it.lon === 'number') {
        afegirLlamp(it.lon, it.lat, it.time || Date.now());
      }
    }
  };

  ws.onerror = (e) => {
    console.warn('[llamps] error WebSocket:', e);
  };

  ws.onclose = () => {
    console.log('[llamps] desconnectat, reintentant en 10s...');
    ws = null;
    setTimeout(() => connectBlitzortung(map), 10000);
  };
}

function afegirLlamp(lon, lat, time) {
  // Evitar duplicats propers en el temps i l'espai (simple)
  const ara = Date.now();
  const ts = typeof time === 'number'
    ? (time > 1e15 ? time / 1e6 : time) // si ve en nanosegons
    : ara;

  // Comprovar si ja tenim un llamp molt a prop fa poc
  for (let i = llampsData.length - 1; i >= 0; i--) {
    const l = llampsData[i];
    if (Math.abs(l.lat - lat) < 0.001 && Math.abs(l.lon - lon) < 0.001 &&
        Math.abs(l.time - ts) < 2000) {
      return; // duplicat
    }
  }

  llampsData.push({ lon, lat, time: ts });

  // Poda: treure els més antics i limitar la mida
  const limit = ara - MINUTS_VISIBLES * 60000;
  llampsData = llampsData.filter((l) => l.time >= limit);
  if (llampsData.length > MAX_LLAMPS) {
    llampsData = llampsData.slice(-MAX_LLAMPS);
  }

  actualitzarCapa();
}

function actualitzarCapa() {
  const map = window.__radarMap; // necessitem una referència al mapa
  if (!map) return;
  const src = map.getSource(LLAMPS_SRC);
  if (!src) return;

  const features = llampsData.map((l) => ({
    type: 'Feature',
    geometry: { type: 'Point', coordinates: [l.lon, l.lat] },
    properties: { time: l.time },
  }));

  src.setData({ type: 'FeatureCollection', features });
}

// Exportar la funció d'inicialització
export function initLlams(map) {
  // Guardar referència al mapa per a actualitzacions
  window.__radarMap = map;
  initLlampLayer(map);

  // Actualitzar la capa cada 5 segons per netejar llamps antics
  setInterval(actualitzarCapa, 5000);
}