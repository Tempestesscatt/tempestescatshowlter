// sfc.js - Integra dades AROME SFC + Geopotencial 500hPa + Vent 500hPa
// Amb isolínies NEGRES amb ETIQUETES i BARBES DE VENT
// Optimitzat per a dispositius mòbils

(function() {
  'use strict';

  // ─── CONFIGURACIÓ ───────────────────────────────────────────
  const SFC_CONFIG = {
    baseUrl: 'https://radar-data.tempestes.cat/dades_sfc/',
    variables: ['wind_speed_10m', 'srh', 'sd', 'cape', 'z500'],
    variableLabels: {
      'wind_speed_10m': 'Vent 10m',
      'srh': 'Humitat 2m',
      'sd': 'Punt rosada',
      'cape': 'CAPE',
      'z500': 'Geo 500hPa'
    },
    variableUnits: {
      'wind_speed_10m': 'km/h',
      'srh': '%',
      'sd': '°C',
      'cape': 'J/kg',
      'z500': 'm'
    },
    defaultOpacity: 0.35,
    refreshInterval: 5 * 60 * 1000,
  };

  // ─── ESTAT ──────────────────────────────────────────────────
  let sfcLayer = null;
  let sfcDataCache = {};
  let activeSfcHour = null;
  let sfcEnabled = false;
  let sfcCurrentVar = 'wind_speed_10m';
  let sfcRefreshTimer = null;
  let sfcLoading = false;
  let contourLayer = null;
  let barbLayer = null;
  let currentPayload = null;
  let zoomHandler = null;

  // ─── DETECCIÓ DE DISPOSITIU MÒBIL ──────────────────────────
  const isMobile = /Android|webOS|iPhone|iPad|iPod|BlackBerry|IEMobile|Opera Mini/i.test(navigator.userAgent) || 
                   window.innerWidth <= 768;

  // ─── PALETES DE COLOR ──────────────────────────────────────
  const STOPS_RATXA_LOCAL = [
    {v:0,r:200,g:200,b:255},{v:5,r:150,g:200,b:255},{v:10,r:100,g:180,b:255},
    {v:15,r:0,g:150,b:255},{v:20,r:0,g:200,b:220},{v:25,r:0,g:220,b:180},
    {v:30,r:0,g:255,b:100},{v:35,r:50,g:255,b:0},{v:40,r:150,g:255,b:0},
    {v:45,r:220,g:255,b:0},{v:50,r:255,g:255,b:0},{v:55,r:255,g:230,b:0},
    {v:60,r:255,g:200,b:0},{v:65,r:255,g:170,b:0},{v:70,r:255,g:140,b:0},
    {v:75,r:255,g:110,b:0},{v:80,r:255,g:80,b:0},{v:85,r:255,g:50,b:0},
    {v:90,r:255,g:20,b:0},{v:95,r:255,g:0,b:0},{v:100,r:230,g:0,b:0},
    {v:110,r:210,g:0,b:0},{v:120,r:190,g:0,b:30},{v:130,r:170,g:0,b:60},
    {v:140,r:150,g:0,b:100},{v:150,r:130,g:0,b:140},{v:160,r:180,g:0,b:180},
    {v:170,r:200,g:0,b:200},{v:180,r:220,g:20,b:220},{v:190,r:240,g:50,b:240},
    {v:200,r:250,g:100,b:250},{v:220,r:255,g:150,b:255},{v:240,r:255,g:200,b:255},
    {v:260,r:255,g:220,b:255},{v:280,r:255,g:240,b:255},{v:300,r:255,g:255,b:255}
  ];

  const STOPS_HUMITAT_LOCAL = [
    {v:0,r:200,g:190,b:150,a:255},{v:3,r:195,g:190,b:145,a:255},
    {v:5,r:190,g:190,b:140,a:255},{v:8,r:185,g:192,b:135,a:255},
    {v:10,r:180,g:195,b:130,a:255},{v:12,r:175,g:198,b:128,a:255},
    {v:15,r:170,g:200,b:125,a:255},{v:18,r:165,g:203,b:122,a:255},
    {v:20,r:158,g:208,b:118,a:255},{v:23,r:150,g:212,b:115,a:255},
    {v:25,r:142,g:216,b:112,a:255},{v:28,r:134,g:220,b:110,a:255},
    {v:30,r:126,g:224,b:108,a:255},{v:33,r:118,g:228,b:110,a:255},
    {v:35,r:110,g:230,b:115,a:255},{v:38,r:102,g:232,b:122,a:255},
    {v:40,r:94,g:234,b:130,a:255},{v:42,r:86,g:234,b:140,a:255},
    {v:45,r:78,g:234,b:150,a:255},{v:48,r:70,g:234,b:162,a:255},
    {v:50,r:64,g:232,b:174,a:255},{v:52,r:58,g:230,b:186,a:255},
    {v:55,r:52,g:226,b:196,a:255},{v:57,r:48,g:220,b:206,a:255},
    {v:60,r:44,g:214,b:216,a:255},{v:62,r:42,g:206,b:224,a:255},
    {v:65,r:40,g:196,b:230,a:255},{v:68,r:38,g:184,b:236,a:255},
    {v:70,r:36,g:172,b:240,a:255},{v:72,r:36,g:158,b:244,a:255},
    {v:75,r:38,g:144,b:248,a:255},{v:78,r:40,g:130,b:248,a:255},
    {v:80,r:44,g:116,b:248,a:255},{v:83,r:50,g:102,b:248,a:255},
    {v:85,r:58,g:88,b:246,a:255},{v:88,r:66,g:74,b:244,a:255},
    {v:90,r:76,g:62,b:240,a:255},{v:92,r:88,g:52,b:236,a:255},
    {v:94,r:100,g:44,b:230,a:255},{v:95,r:112,g:38,b:224,a:255},
    {v:96,r:124,g:34,b:218,a:255},{v:97,r:136,g:30,b:210,a:255},
    {v:98,r:148,g:28,b:200,a:255},{v:99,r:158,g:28,b:190,a:255},
    {v:100,r:168,g:30,b:178,a:255}
  ];

  const STOPS_TEMP_LOCAL = [
    {v:-24,r:45,g:0,b:75},{v:-20,r:130,g:0,b:160},{v:-15,r:65,g:0,b:115},
    {v:-10,r:0,g:0,b:255},{v:-5,r:0,g:135,b:255},{v:0,r:0,g:235,b:255},
    {v:2,r:0,g:255,b:150},{v:5,r:0,g:200,b:0},{v:8,r:120,g:255,b:0},
    {v:11,r:255,g:255,b:0},{v:14,r:255,g:255,b:170},{v:17,r:255,g:235,b:100},
    {v:20,r:255,g:200,b:0},{v:23,r:255,g:140,b:0},{v:26,r:255,g:70,b:0},
    {v:29,r:255,g:0,b:0},{v:32,r:180,g:0,b:0},{v:35,r:90,g:0,b:0},
    {v:38,r:150,g:0,b:150},{v:42,r:255,g:0,b:255},{v:46,r:255,g:185,b:255}
  ];

  const STOPS_CAPE_LOCAL = [
    {v:0,r:79,g:195,b:247,a:255},{v:100,r:50,g:170,b:240,a:255},
    {v:300,r:0,g:140,b:255,a:255},{v:500,r:0,g:200,b:255,a:255},
    {v:700,r:0,g:255,b:200,a:255},{v:900,r:120,g:255,b:80,a:255},
    {v:1100,r:220,g:255,b:0,a:255},{v:1300,r:255,g:255,b:0,a:255},
    {v:1500,r:255,g:200,b:0,a:255},{v:1800,r:255,g:140,b:0,a:255},
    {v:2100,r:255,g:60,b:0,a:255},{v:2400,r:255,g:0,b:0,a:255},
    {v:2800,r:255,g:0,b:140,a:255},{v:3200,r:255,g:0,b:220,a:255},
    {v:3800,r:200,g:0,b:255,a:255}
  ];

  function obtenirStops(variable) {
    switch(variable) {
      case 'wind_speed_10m': return STOPS_RATXA_LOCAL;
      case 'srh': return STOPS_HUMITAT_LOCAL;
      case 'sd': return STOPS_TEMP_LOCAL;
      case 'cape': return STOPS_CAPE_LOCAL;
      default: return STOPS_RATXA_LOCAL;
    }
  }

  function getColor(stops, val) {
    if (val === null || val === undefined || Number.isNaN(val)) {
      return [0, 0, 0, 0];
    }
    if (val <= stops[0].v) {
      return [stops[0].r || 0, stops[0].g || 0, stops[0].b || 0, stops[0].a || 200];
    }
    if (val >= stops[stops.length - 1].v) {
      const last = stops[stops.length - 1];
      return [last.r || 0, last.g || 0, last.b || 0, last.a || 200];
    }
    for (let i = 0; i < stops.length - 1; i++) {
      if (val >= stops[i].v && val <= stops[i + 1].v) {
        const t = (val - stops[i].v) / (stops[i + 1].v - stops[i].v);
        const r = Math.round((stops[i].r || 0) + ((stops[i + 1].r || 0) - (stops[i].r || 0)) * t);
        const g = Math.round((stops[i].g || 0) + ((stops[i + 1].g || 0) - (stops[i].g || 0)) * t);
        const b = Math.round((stops[i].b || 0) + ((stops[i + 1].b || 0) - (stops[i].b || 0)) * t);
        const a = Math.round((stops[i].a || 200) + ((stops[i + 1].a || 200) - (stops[i].a || 200)) * t);
        return [r, g, b, a];
      }
    }
    return [0, 0, 0, 0];
  }

  // ─── GENERAR BARBES DE VENT ──────────────────

  function getBarbSpacing(zoom) {
    // Espaiat entre barbes segons zoom (adaptat per mòbil)
    if (isMobile) {
      if (zoom >= 12) return 15;
      if (zoom >= 11) return 20;
      if (zoom >= 10) return 30;
      if (zoom >= 9) return 40;
      if (zoom >= 8) return 50;
      return 60;
    } else {
      if (zoom >= 12) return 10;
      if (zoom >= 11) return 15;
      if (zoom >= 10) return 20;
      if (zoom >= 9) return 30;
      if (zoom >= 8) return 40;
      return 50;
    }
  }

  function createWindBarbs(payload) {
    // Eliminar la capa anterior
    if (barbLayer) {
      window.map.removeLayer(barbLayer);
      barbLayer = null;
    }

    const coords = payload.coordenadas;
    const vars = payload.variables;

    if (!coords || !vars || !vars.u500 || !vars.v500) {
      console.warn('No hi ha dades de vent 500hPa');
      return;
    }

    const latList = coords.lat;
    const lonList = coords.lon;

    const u500 = vars.u500.datos;
    const v500 = vars.v500.datos;

    const nLat = latList.length;
    const nLon = lonList.length;

    const currentZoom = window.map ? window.map.getZoom() : 8;
    const spacing = getBarbSpacing(currentZoom);

    // Crear nova capa
    barbLayer = L.layerGroup().addTo(window.map);

    // Recórrer la graella
    for (let i = 0; i < nLat; i += spacing) {
      for (let j = 0; j < nLon; j += spacing) {
        const idx = i * nLon + j;

        const u = u500[idx];
        const v = v500[idx];

        // Dades no vàlides
        if (
          u === null ||
          v === null ||
          u === undefined ||
          v === undefined ||
          !Number.isFinite(u) ||
          !Number.isFinite(v)
        ) {
          continue;
        }

        // Velocitat en m/s
        const speed = Math.sqrt(u * u + v * v);

        // No representar vents pràcticament en calma
        if (speed < 1) {
          continue;
        }

        const lat = latList[i];
        const lon = lonList[j];

        // Crear la barba meteorològica
        const barbHtml = createWindBarbSVG(u, v, speed);

        const marker = L.marker([lat, lon], {
          icon: L.divIcon({
            className: 'wind-barb-marker',
            html: barbHtml,
            iconSize: [40, 40], // Mida reduïda per mòbil
            iconAnchor: [20, 20]
          }),
          interactive: false
        });

        barbLayer.addLayer(marker);
      }
    }

    console.log('Barbes de vent creades');
  }

  function createWindBarbSVG(u, v, speed) {
    const angle = Math.atan2(-u, -v) * 180 / Math.PI;

    // Velocitat en nusos
    const speedKnots = speed * 1.94384;
    const roundedKnots = Math.round(speedKnots / 5) * 5;

    // Vent en calma
    if (roundedKnots < 5) {
      return `
        <svg width="40" height="40" viewBox="-20 -20 40 40" xmlns="http://www.w3.org/2000/svg">
          <circle cx="0" cy="0" r="7" fill="none" stroke="black" stroke-width="2"/>
        </svg>
      `;
    }

    // Descomposar la velocitat
    let remaining = roundedKnots;
    const flags = Math.floor(remaining / 50);
    remaining = remaining % 50;
    const fullBarbs = Math.floor(remaining / 10);
    remaining = remaining % 10;
    const halfBarb = remaining >= 5;

    // Geometria
    const shaftStart = 5;
    const shaftEnd = -17;
    let elements = '';

    // Pal principal
    elements += `
      <line x1="0" y1="${shaftStart}" x2="0" y2="${shaftEnd}" 
            stroke="black" stroke-width="2" stroke-linecap="round"/>
    `;

    // Banderes de 50 kt
    let barbPosition = shaftEnd;
    for (let i = 0; i < flags; i++) {
      const y = barbPosition;
      elements += `
        <polygon points="0,${y} 0,${y + 7} 12,${y + 7}" 
                 fill="black" stroke="black" stroke-width="0.8"/>
      `;
      barbPosition += 8;
    }

    // Barbes completes de 10 kt
    for (let i = 0; i < fullBarbs; i++) {
      const y = barbPosition;
      elements += `
        <line x1="0" y1="${y}" x2="10" y2="${y + 5}" 
              stroke="black" stroke-width="2" stroke-linecap="round"/>
      `;
      barbPosition += 5;
    }

    // Mitja barba de 5 kt
    if (halfBarb) {
      const y = barbPosition;
      elements += `
        <line x1="0" y1="${y}" x2="6" y2="${y + 3}" 
              stroke="black" stroke-width="2" stroke-linecap="round"/>
      `;
    }

    // SVG final
    const svg = `
      <svg width="40" height="40" viewBox="-20 -20 40 40" 
           xmlns="http://www.w3.org/2000/svg"
           style="overflow: visible; transform: rotate(${angle}deg); transform-origin: center center;">
        ${elements}
      </svg>
    `;

    return svg;
  }

  // ─── GENERAR ISOLÍNIES NEGRES AMB ETIQUETES ──────────────────

  function getContourInterval(zoom) {
    // Intervals adaptats per mòbil
    if (isMobile) {
      if (zoom >= 12) return 3;
      if (zoom >= 11) return 4;
      if (zoom >= 10) return 6;
      if (zoom >= 9) return 10;
      if (zoom >= 8) return 15;
      return 20;
    } else {
      if (zoom >= 12) return 2;
      if (zoom >= 11) return 3;
      if (zoom >= 10) return 5;
      if (zoom >= 9) return 8;
      if (zoom >= 8) return 10;
      return 15;
    }
  }

  function generateContours(payload) {
    const coords = payload.coordenadas;
    const vars = payload.variables;
    if (!coords || !vars || !vars.z500) {
      console.warn('No hi ha dades de geopotencial 500hPa');
      return null;
    }
    
    const latList = coords.lat;
    const lonList = coords.lon;
    const values = vars.z500.datos;
    
    const nLat = latList.length;
    const nLon = lonList.length;
    
    const validValues = values.filter(v => v !== null && v !== undefined);
    if (validValues.length === 0) {
      console.warn('No hi ha valors vàlids de geopotencial');
      return null;
    }
    
    const minVal = Math.min(...validValues);
    const maxVal = Math.max(...validValues);
    
    const currentZoom = window.map ? window.map.getZoom() : 8;
    const interval = getContourInterval(currentZoom);
    
    console.log('Z500: Min =', minVal.toFixed(1), 'Max =', maxVal.toFixed(1), 
                'Zoom =', currentZoom, 'Interval =', interval + 'm');
    
    if (maxVal - minVal < interval * 0.5) {
      console.warn('Z500: Rang massa petit');
      return [];
    }
    
    const levels = [];
    for (let v = Math.ceil(minVal / interval) * interval; v <= maxVal; v += interval) {
      levels.push(v);
    }
    
    // Reduir el nombre de nivells per mòbil
    const maxLevels = isMobile ? 8 : 15;
    if (levels.length > maxLevels) {
      const step = Math.ceil(levels.length / maxLevels);
      const filteredLevels = [];
      for (let i = 0; i < levels.length; i += step) {
        filteredLevels.push(levels[i]);
      }
      levels.length = 0;
      levels.push(...filteredLevels);
    }
    
    const lines = [];
    
    for (let i = 0; i < nLat - 1; i++) {
      for (let j = 0; j < nLon - 1; j++) {
        const idx00 = i * nLon + j;
        const idx10 = i * nLon + (j + 1);
        const idx01 = (i + 1) * nLon + j;
        const idx11 = (i + 1) * nLon + (j + 1);
        
        const v00 = values[idx00], v10 = values[idx10];
        const v01 = values[idx01], v11 = values[idx11];
        
        if ([v00, v10, v01, v11].some(v => v === null || v === undefined)) continue;
        
        for (const level of levels) {
          const segments = marchingSquare(v00, v10, v11, v01, level, 
                                        latList[i], lonList[j], 
                                        latList[i+1], lonList[j+1]);
          if (segments && segments.length > 0) {
            // Afegir el nivell a cada segment
            for (const segment of segments) {
              lines.push({
                segment: segment,
                level: level
              });
            }
          }
        }
      }
    }
    
    console.log('Z500: Segments =', lines.length);
    return lines;
  }

  function marchingSquare(v00, v10, v11, v01, level, lat0, lon0, lat1, lon1) {
    const inside = (v) => v >= level;
    const b00 = inside(v00) ? 1 : 0;
    const b10 = inside(v10) ? 1 : 0;
    const b11 = inside(v11) ? 1 : 0;
    const b01 = inside(v01) ? 1 : 0;
    
    const caseIndex = b00 * 8 + b10 * 4 + b11 * 2 + b01;
    
    if (caseIndex === 0 || caseIndex === 15) return [];
    
    const interpolate = (v1, v2, p1, p2) => {
      if (v2 === v1) return p1;
      const t = (level - v1) / (v2 - v1);
      return p1 + t * (p2 - p1);
    };
    
    const segments = [];
    
    const topLat = interpolate(v00, v10, lat0, lat0);
    const topLon = interpolate(v00, v10, lon0, lon1);
    const rightLat = interpolate(v10, v11, lat0, lat1);
    const rightLon = interpolate(v10, v11, lon1, lon1);
    const bottomLat = interpolate(v01, v11, lat1, lat1);
    const bottomLon = interpolate(v01, v11, lon0, lon1);
    const leftLat = interpolate(v00, v01, lat0, lat1);
    const leftLon = interpolate(v00, v01, lon0, lon0);
    
    if (caseIndex === 1 || caseIndex === 14) {
      segments.push([[leftLat, leftLon], [bottomLat, bottomLon]]);
    } else if (caseIndex === 2 || caseIndex === 13) {
      segments.push([[bottomLat, bottomLon], [rightLat, rightLon]]);
    } else if (caseIndex === 3 || caseIndex === 12) {
      segments.push([[leftLat, leftLon], [rightLat, rightLon]]);
    } else if (caseIndex === 4 || caseIndex === 11) {
      segments.push([[topLat, topLon], [rightLat, rightLon]]);
    } else if (caseIndex === 6 || caseIndex === 9) {
      segments.push([[topLat, topLon], [bottomLat, bottomLon]]);
    } else if (caseIndex === 7 || caseIndex === 8) {
      segments.push([[topLat, topLon], [leftLat, leftLon]]);
    } else if (caseIndex === 5) {
      segments.push([[topLat, topLon], [leftLat, leftLon]]);
      segments.push([[bottomLat, bottomLon], [rightLat, rightLon]]);
    } else if (caseIndex === 10) {
      segments.push([[topLat, topLon], [rightLat, rightLon]]);
      segments.push([[bottomLat, bottomLon], [leftLat, leftLon]]);
    }
    
    return segments;
  }

  function createContourLayer(lines) {
    if (contourLayer) {
      window.map.removeLayer(contourLayer);
    }
    
    if (!lines || lines.length === 0) {
      console.warn('No hi ha isolínies per dibuixar');
      return;
    }
    
    contourLayer = L.layerGroup().addTo(window.map);
    
    // Agrupar segments per nivell
    const segmentsByLevel = {};
    
    lines.forEach((segmentData) => {
      const segment = segmentData.segment;
      const level = segmentData.level;
      
      if (!segmentsByLevel[level]) {
        segmentsByLevel[level] = [];
      }
      segmentsByLevel[level].push(segment);
    });
    
    // Dibuixar cada nivell amb la seva etiqueta
    for (const level in segmentsByLevel) {
      const segments = segmentsByLevel[level];
      
      // Dibuixar segments
      segments.forEach((segment) => {
        const polyline = L.polyline(segment, {
          color: '#000000',
          weight: isMobile ? 1.5 : 2,
          opacity: 0.85,
          interactive: false,
          smoothFactor: 1,
        });
        contourLayer.addLayer(polyline);
      });
      
      // Afegir etiqueta al punt mitjà de la isolínia
      if (segments.length > 0) {
        // Trobar el segment més llarg per posar-hi l'etiqueta
        let longestSegment = segments[0];
        let maxLength = 0;
        
        segments.forEach((segment) => {
          if (segment && segment.length >= 2) {
            const length = Math.sqrt(
              Math.pow(segment[1][0] - segment[0][0], 2) + 
              Math.pow(segment[1][1] - segment[0][1], 2)
            );
            if (length > maxLength) {
              maxLength = length;
              longestSegment = segment;
            }
          }
        });
        
        if (longestSegment && longestSegment.length >= 2) {
          const midLat = (longestSegment[0][0] + longestSegment[1][0]) / 2;
          const midLon = (longestSegment[0][1] + longestSegment[1][1]) / 2;
          
          const fontSize = isMobile ? '8px' : '9px';
          
          const label = L.marker([midLat, midLon], {
            icon: L.divIcon({
              className: 'contour-label',
              html: `<div style="
                font-size: ${fontSize};
                font-weight: 600;
                color: #000000;
                text-shadow: 1px 1px 2px rgba(255,255,255,0.9), 
                            -1px -1px 2px rgba(255,255,255,0.9),
                            1px -1px 2px rgba(255,255,255,0.9),
                            -1px 1px 2px rgba(255,255,255,0.9);
                background: transparent;
                padding: 1px 2px;
                border-radius: 2px;
                white-space: nowrap;
                pointer-events: none;
                font-family: 'Segoe UI', system-ui, sans-serif;
                letter-spacing: -0.2px;
              ">${Math.round(level)}</div>`,
              iconSize: [25, 10],
              iconAnchor: [12, 5]
            }),
            interactive: false,
            keyboard: false
          });
          
          contourLayer.addLayer(label);
        }
      }
    }
    
    return contourLayer;
  }

  // ─── REGENERAR AL CANVIAR ZOOM ──────────────────

  function setupZoomHandler() {
    if (zoomHandler) {
      window.map.off('zoomend', zoomHandler);
    }
    
    zoomHandler = function() {
      if (sfcEnabled && sfcCurrentVar === 'z500' && currentPayload) {
        const lines = generateContours(currentPayload);
        if (lines && lines.length > 0) {
          createContourLayer(lines);
        }
        createWindBarbs(currentPayload);
      }
    };
    
    window.map.on('zoomend', zoomHandler);
  }

  // ─── UTILITATS ──────────────────────────────────────────────

  async function fetchSfcFile(hour) {
    const url = SFC_CONFIG.baseUrl + 'sfc_' + String(hour).padStart(2, '0') + '.msgpack.gz';
    try {
      const response = await fetch(url, { cache: 'no-store' });
      if (!response.ok) {
        if (response.status === 404) {
          console.log('SFC: Fitxer per hora ' + hour + ' no disponible (404)');
          return null;
        }
        throw new Error('HTTP ' + response.status);
      }
      const compressed = new Uint8Array(await response.arrayBuffer());
      if (typeof pako === 'undefined') {
        throw new Error('pako no carregat');
      }
      const decompressed = pako.inflate(compressed);
      if (typeof msgpack === 'undefined') {
        throw new Error('msgpack no carregat');
      }
      const data = msgpack.decode(decompressed);
      return data;
    } catch (err) {
      console.warn('SFC: Error carregant hora ' + hour + ':', err.message);
      return null;
    }
  }

  function getCurrentUtcHour() {
    const now = new Date();
    return now.getUTCHours();
  }

  function buildSfcImageDataUrl(payload, variable) {
    const coords = payload.coordenadas;
    const vars = payload.variables;
    if (!coords || !vars) {
      throw new Error('Payload SFC invalit');
    }
    const latList = coords.lat;
    const lonList = coords.lon;
    if (!latList || !lonList || latList.length === 0 || lonList.length === 0) {
      throw new Error('Coordenades buides');
    }

    const varData = vars[variable];
    if (!varData || !varData.datos) {
      throw new Error('Variable ' + variable + ' no trobada');
    }

    const width = lonList.length;
    const height = latList.length;
    const values = varData.datos;
    const stops = obtenirStops(variable);

    const canvas = document.createElement('canvas');
    canvas.width = width;
    canvas.height = height;
    const ctx = canvas.getContext('2d');
    const imageData = ctx.createImageData(width, height);

    const esTemperatura = (variable === 'sd');

    for (let row = 0; row < height; row++) {
      const srcRow = height - 1 - row;
      for (let col = 0; col < width; col++) {
        const idx = srcRow * width + col;
        let val = values[idx];
        
        if (esTemperatura && val !== null && !Number.isNaN(val) && val > 100) {
          val = val - 273.15;
        }

        const color = getColor(stops, val);
        const pixelIdx = (row * width + col) * 4;
        imageData.data[pixelIdx] = color[0];
        imageData.data[pixelIdx + 1] = color[1];
        imageData.data[pixelIdx + 2] = color[2];
        imageData.data[pixelIdx + 3] = color[3];
      }
    }

    ctx.putImageData(imageData, 0, 0);
    return canvas.toDataURL('image/png');
  }

  async function loadSfcLayer(hour, variable) {
    if (sfcLoading) return;
    sfcLoading = true;

    try {
      let payload = sfcDataCache[hour];
      if (!payload) {
        payload = await fetchSfcFile(hour);
        if (payload) {
          sfcDataCache[hour] = payload;
        } else {
          console.warn('SFC: No s\'han pogut carregar dades per hora ' + hour);
          sfcLoading = false;
          return false;
        }
      }

      if (!payload.variables || !payload.variables[variable]) {
        console.warn('SFC: Variable ' + variable + ' no disponible per hora ' + hour);
        sfcLoading = false;
        return false;
      }

      currentPayload = payload;

      // Si és geopotencial, mostrar isolínies + barbes
      if (variable === 'z500') {
        if (sfcLayer && window.map && window.map.hasLayer(sfcLayer)) {
          window.map.removeLayer(sfcLayer);
          sfcLayer = null;
        }
        
        const lines = generateContours(payload);
        if (lines && lines.length > 0) {
          createContourLayer(lines);
        }
        
        createWindBarbs(payload);
        
        setupZoomHandler();
        
        activeSfcHour = hour;
        sfcCurrentVar = variable;
        updateSfcInfo(payload, variable);
        sfcLoading = false;
        return true;
      }

      // Per altres variables, eliminar isolínies i barbes
      if (contourLayer && window.map && window.map.hasLayer(contourLayer)) {
        window.map.removeLayer(contourLayer);
        contourLayer = null;
      }
      if (barbLayer && window.map && window.map.hasLayer(barbLayer)) {
        window.map.removeLayer(barbLayer);
        barbLayer = null;
      }
      if (zoomHandler && window.map) {
        window.map.off('zoomend', zoomHandler);
        zoomHandler = null;
      }

      const dataUrl = buildSfcImageDataUrl(payload, variable);
      const coords = payload.coordenadas;
      const latMin = coords.lat[0];
      const latMax = coords.lat[coords.lat.length - 1];
      const lonMin = coords.lon[0];
      const lonMax = coords.lon[coords.lon.length - 1];
      const bounds = [[latMin, lonMin], [latMax, lonMax]];

      if (sfcLayer && window.map && window.map.hasLayer(sfcLayer)) {
        window.map.removeLayer(sfcLayer);
      }

      sfcLayer = L.imageOverlay(dataUrl, bounds, {
        opacity: SFC_CONFIG.defaultOpacity,
        interactive: false,
        zIndex: 4,
        pane: 'overlayPane',
      });

      if (window.map) {
        sfcLayer.addTo(window.map);
        activeSfcHour = hour;
        sfcCurrentVar = variable;
        console.log('SFC: Capa carregada (hora ' + hour + ', var ' + variable + ')');
        updateSfcInfo(payload, variable);
        
        sfcLoading = false;
        return true;
      } else {
        console.warn('SFC: window.map no disponible');
        sfcLoading = false;
        return false;
      }
    } catch (err) {
      console.error('SFC: Error carregant capa:', err);
      sfcLoading = false;
      return false;
    }
  }

  function updateSfcInfo(payload, variable) {
    var label = SFC_CONFIG.variableLabels[variable] || variable;
    var hora = payload.hora_madrid || payload.hora_utc || '';
    var msg = 'SFC: ' + label + ' | ' + hora;
    var infoEl = document.getElementById('sfc-status');
    if (!infoEl) {
      infoEl = document.createElement('div');
      infoEl.id = 'sfc-status';
      infoEl.style.cssText = 
        'position: absolute; ' +
        'bottom: ' + (isMobile ? '120px' : '100px') + '; ' +
        'left: 50%; ' +
        'transform: translateX(-50%); ' +
        'background: rgba(10,14,26,0.75); ' +
        'backdrop-filter: blur(8px); ' +
        'border-radius: 20px; ' +
        'padding: ' + (isMobile ? '3px 10px' : '4px 14px') + '; ' +
        'color: #b0c4de; ' +
        'font-size: ' + (isMobile ? '10px' : '11px') + '; ' +
        'z-index: 1000; ' +
        'pointer-events: none; ' +
        'border: 1px solid rgba(79,195,247,0.12); ' +
        'font-family: "Segoe UI", system-ui, sans-serif; ' +
        'white-space: nowrap;';
      document.body.appendChild(infoEl);
    }
    infoEl.textContent = msg;
  }

  function toggleSfc(enable) {
    sfcEnabled = enable;
    if (!enable) {
      if (sfcLayer && window.map) {
        window.map.removeLayer(sfcLayer);
        sfcLayer = null;
      }
      if (contourLayer && window.map) {
        window.map.removeLayer(contourLayer);
        contourLayer = null;
      }
      if (barbLayer && window.map) {
        window.map.removeLayer(barbLayer);
        barbLayer = null;
      }
      if (zoomHandler && window.map) {
        window.map.off('zoomend', zoomHandler);
        zoomHandler = null;
      }
      currentPayload = null;
      var infoEl = document.getElementById('sfc-status');
      if (infoEl) infoEl.remove();
      var btn = document.getElementById('sfc-toggle-btn');
      if (btn) {
        btn.textContent = 'SFC';
        btn.style.borderColor = 'rgba(79,195,247,0.3)';
        btn.style.background = 'rgba(79,195,247,0.1)';
        btn.classList.remove('active');
      }
      console.log('SFC: Desactivat');
      return;
    }

    var hour = getCurrentUtcHour();
    var varToLoad = sfcCurrentVar || 'wind_speed_10m';
    loadSfcLayer(hour, varToLoad);
    var btn = document.getElementById('sfc-toggle-btn');
    if (btn) {
      btn.textContent = 'SFC ON';
      btn.style.borderColor = '#4fc3f7';
      btn.style.background = 'rgba(79,195,247,0.2)';
      btn.classList.add('active');
    }
    console.log('SFC: Activat');
  }

  async function refreshSfc() {
    if (!sfcEnabled) return;
    var hour = getCurrentUtcHour();
    if (hour !== activeSfcHour || !sfcLayer && !contourLayer || 
        (sfcLayer && !window.map.hasLayer(sfcLayer)) || 
        (contourLayer && !window.map.hasLayer(contourLayer))) {
      await loadSfcLayer(hour, sfcCurrentVar);
    } else {
      console.log('SFC: L\'hora no ha canviat, no cal refrescar');
    }
  }

  function setSfcVariable(variable) {
    if (!sfcEnabled) {
      sfcCurrentVar = variable;
      return;
    }
    var hour = getCurrentUtcHour();
    sfcCurrentVar = variable;
    loadSfcLayer(hour, variable);
  }

  function startSfcAutoRefresh() {
    if (sfcRefreshTimer) clearInterval(sfcRefreshTimer);
    sfcRefreshTimer = setInterval(function() {
      refreshSfc();
    }, SFC_CONFIG.refreshInterval);
    console.log('SFC: Refresc automatic cada ' + (SFC_CONFIG.refreshInterval/60000) + ' min');
  }

  // ─── EXPOSAR FUNCIONS GLOBALS ─────────────────────────────

  window.SFC = {
    toggle: toggleSfc,
    refresh: refreshSfc,
    setVariable: setSfcVariable,
    getStatus: function() {
      return {
        enabled: sfcEnabled,
        hour: activeSfcHour,
        variable: sfcCurrentVar,
        layerExists: !!sfcLayer,
        contourExists: !!contourLayer,
        barbExists: !!barbLayer
      };
    },
    setOpacity: function(opacity) {
      if (sfcLayer) {
        sfcLayer.setOpacity(Math.min(1, Math.max(0, opacity)));
      }
    },
    loadHour: function(hour, variable) {
      var varToUse = variable || sfcCurrentVar || 'wind_speed_10m';
      return loadSfcLayer(hour, varToUse);
    },
    getVariables: function() {
      return Object.keys(SFC_CONFIG.variableLabels);
    },
    _getRawPayload: function(hour) {
      return sfcDataCache[hour] || null;
    }
  };

  // ─── INICIALITZACIÓ ────────────────────────────────────────

  function initSfc() {
    if (window.map) {
      console.log('SFC: Inicialitzant integracio amb el mapa satel·lit');
      console.log('SFC: Mode ' + (isMobile ? 'mòbil' : 'escriptori'));
      startSfcAutoRefresh();
      addSfcButton();
    } else {
      setTimeout(initSfc, 500);
    }
  }

  // ─── AFEGIR BOTO SFC ─────────────

  function addSfcButton() {
    var dock = document.querySelector('.layer-dock');
    if (!dock) {
      createSfcPanel();
      return;
    }

    if (document.getElementById('sfc-toggle-btn')) return;

    var btn = document.createElement('button');
    btn.id = 'sfc-toggle-btn';
    btn.className = 'layer-btn';
    btn.textContent = 'SFC';
    btn.title = 'Activar/desactivar capa SFC';
    btn.style.cssText = 'background: rgba(79,195,247,0.08); font-size: ' + 
                        (isMobile ? '10px' : '11px') + '; padding: ' + 
                        (isMobile ? '6px 10px' : '8px 12px') + ';';

    var select = document.createElement('select');
    select.id = 'sfc-var-select';
    select.style.cssText = 
      'background: rgba(255,255,255,0.06); ' +
      'border: 1px solid rgba(255,255,255,0.1); ' +
      'border-radius: 999px; ' +
      'padding: ' + (isMobile ? '3px 6px' : '4px 8px') + '; ' +
      'color: #e8edf5; ' +
      'font-size: ' + (isMobile ? '9px' : '10px') + '; ' +
      'cursor: pointer; ' +
      'font-family: inherit; ' +
      'margin-left: 2px; ' +
      'height: ' + (isMobile ? '24px' : '26px') + '; ' +
      'max-width: ' + (isMobile ? '100px' : '120px') + ';';
    
    var vars = SFC_CONFIG.variables;
    for (var i = 0; i < vars.length; i++) {
      var v = vars[i];
      var opt = document.createElement('option');
      opt.value = v;
      opt.textContent = SFC_CONFIG.variableLabels[v] || v;
      if (v === sfcCurrentVar) opt.selected = true;
      select.appendChild(opt);
    }

    var container = document.createElement('span');
    container.style.cssText = 'display: flex; align-items: center; gap: 2px; flex-shrink: 0;';
    container.appendChild(btn);
    container.appendChild(select);

    dock.insertBefore(container, dock.firstChild);

    btn.addEventListener('click', function() {
      toggleSfc(!sfcEnabled);
    });

    select.addEventListener('change', function(e) {
      setSfcVariable(e.target.value);
      if (sfcEnabled) {
        var btn2 = document.getElementById('sfc-toggle-btn');
        if (btn2) {
          btn2.textContent = 'SFC ON';
          btn2.style.borderColor = '#4fc3f7';
          btn2.style.background = 'rgba(79,195,247,0.2)';
          btn2.classList.add('active');
        }
      }
    });
  }

  function createSfcPanel() {
    var panel = document.createElement('div');
    panel.className = 'sfc-panel';
    panel.style.cssText = 
      'position: absolute; bottom: ' + (isMobile ? '100px' : '80px') + '; ' +
      'left: 50%; transform: translateX(-50%); ' +
      'background: rgba(10,14,26,0.85); backdrop-filter: blur(12px); ' +
      'border: 1px solid rgba(79,195,247,0.2); border-radius: 30px; ' +
      'padding: ' + (isMobile ? '5px 10px' : '6px 14px') + '; ' +
      'color: #e8edf5; font-size: ' + (isMobile ? '11px' : '12px') + '; ' +
      'z-index: 1000; ' +
      'display: flex; gap: ' + (isMobile ? '4px' : '6px') + '; ' +
      'align-items: center; ' +
      'box-shadow: 0 8px 32px rgba(0,0,0,0.5); pointer-events: auto;';
    
    var vars = SFC_CONFIG.variables;
    var optionsHtml = '';
    for (var i = 0; i < vars.length; i++) {
      var v = vars[i];
      var selected = (v === sfcCurrentVar) ? ' selected' : '';
      optionsHtml += '<option value="' + v + '"' + selected + '>' + (SFC_CONFIG.variableLabels[v] || v) + '</option>';
    }
    
    panel.innerHTML = 
      '<button id="sfc-toggle-btn" style="background:rgba(79,195,247,0.12);border:1px solid rgba(79,195,247,0.25);border-radius:20px;padding:' + 
      (isMobile ? '3px 10px' : '4px 12px') + ';color:#e8edf5;font-size:' + 
      (isMobile ? '10px' : '11px') + ';cursor:pointer;font-family:inherit;">SFC</button>' +
      '<select id="sfc-var-select" style="background:rgba(255,255,255,0.06);border:1px solid rgba(255,255,255,0.1);border-radius:20px;padding:' + 
      (isMobile ? '3px 6px' : '4px 8px') + ';color:#e8edf5;font-size:' + 
      (isMobile ? '9px' : '10px') + ';cursor:pointer;font-family:inherit;">' + 
      optionsHtml + 
      '</select>';
    document.body.appendChild(panel);

    document.getElementById('sfc-toggle-btn').addEventListener('click', function() {
      toggleSfc(!sfcEnabled);
      this.textContent = sfcEnabled ? 'SFC ON' : 'SFC';
    });
    document.getElementById('sfc-var-select').addEventListener('change', function() {
      setSfcVariable(this.value);
    });
  }

  // ─── INICIAR ────────────────────────────────────────────────

  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', initSfc);
  } else {
    initSfc();
  }

  console.log('SFC.js carregat.');
  console.log('   Geo 500hPa: isolínies NEGRES amb etiquetes + barbes de vent');
  console.log('   Optimitzat per a dispositius mòbils');

})();