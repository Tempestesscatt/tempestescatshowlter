// ─────────────────────────────────────────────────────────────
// radar_dbz.js - Capa de radar Cirrus (dBZ) sobre el mapa satelit
// Tempestes.cat
//
// S'enganxa a mapasatelit.js com una capa mes: 'radar_dbz'.
// A diferencia de les altres capes (image/ir/ctth_alti/precip),
// les dades del radar no venen com a graella width x height, sino
// com una llista de punts dispersos {lat, lon, dbz}. Aquest modul
// els interpola a una graella pròpia abans de pintar-los, perque
// es vegi com un radar real (taques suaus, no punts aillats).
//
// Frames: frame_1 (mes recent) ... frame_5 (mes antic). S'animen
// en bucle mentre la capa estigui activa.
// ─────────────────────────────────────────────────────────────

(function (global) {

  // Dades servides des de R2 (mateix bucket/domini que fa servir
  // mapasatelit.js per al satelit, pero amb prefix dades_rad/ en
  // lloc de dades_sat/).
  const RADAR_BASE = 'https://radar-data.tempestes.cat/dades_rad/';

  const RADAR_CONFIG = {
    framePattern: RADAR_BASE + 'meteorad_ne_spain_dbz_frame_{n}.msgpack.gz',
    totalFrames: 5,
    // Temps entre frames de l'animacio (ms). Prou lent per veure
    // be cada instant pero prou agil per transmetre moviment.
    animIntervalMs: 700,
    // Resolucio de la graella d'interpolacio (px). Mes alt = mes
    // detall pero mes cost de calcul; 400x400 va sobrat per la
    // regio NE Espanya i es suavitza igualment amb l'upscale del
    // canvas (igual que fan les altres capes).
    gridWidth: 380,
    gridHeight: 380,
    // Radi d'influencia de cada punt de radar sobre la graella,
    // en "cel·les" de graella. Mes gran = taques mes suaus i
    // contínues (estil radar real); mes petit = mes fidel al punt
    // pero amb mes forats.
    interpolationRadiusCells: 1,
  };

  // ─── Paleta dBZ estil NWS/radar americà ───
  // Verd (precip feble) -> groc -> taronja -> vermell -> magenta/blanc
  // (nucli de tempesta severa), igual que els radars operatius de la
  // NOAA (NEXRAD reflectivity, escala "NWS Reflectivity").
  const DBZ_STOPS = [
    { dbz: 5, color: [4, 233, 231] },     // cian - precip molt feble
    { dbz: 10, color: [1, 159, 244] },    // blau clar
    { dbz: 15, color: [3, 0, 244] },      // blau
    { dbz: 20, color: [2, 253, 2] },      // verd
    { dbz: 25, color: [1, 197, 1] },      // verd mitja
    { dbz: 30, color: [0, 142, 0] },      // verd fosc
    { dbz: 35, color: [253, 248, 2] },    // groc
    { dbz: 40, color: [229, 188, 0] },    // groc-taronja
    { dbz: 45, color: [253, 149, 0] },    // taronja
    { dbz: 50, color: [253, 0, 0] },      // vermell
    { dbz: 55, color: [212, 0, 0] },      // vermell fosc
    { dbz: 60, color: [188, 0, 0] },      // granate
    { dbz: 65, color: [248, 0, 253] },    // magenta - severa
    { dbz: 70, color: [152, 84, 198] },   // violeta - extrema
    { dbz: 75, color: [253, 253, 253] },  // blanc - nucli extrem
  ];

  function lerpColor(c1, c2, f) {
    return [
      Math.round(c1[0] + (c2[0] - c1[0]) * f),
      Math.round(c1[1] + (c2[1] - c1[1]) * f),
      Math.round(c1[2] + (c2[2] - c1[2]) * f),
    ];
  }

  function dbzToColor(dbz) {
    if (dbz === null || dbz === undefined || Number.isNaN(dbz) || dbz < DBZ_STOPS[0].dbz) {
      return [0, 0, 0, 0]; // transparent per sota del llindar minim
    }
    const clamped = Math.min(DBZ_STOPS[DBZ_STOPS.length - 1].dbz, dbz);
    for (let i = 0; i < DBZ_STOPS.length - 1; i++) {
      const a = DBZ_STOPS[i];
      const b = DBZ_STOPS[i + 1];
      if (clamped >= a.dbz && clamped <= b.dbz) {
        const f = (clamped - a.dbz) / (b.dbz - a.dbz);
        const [r, g, bl] = lerpColor(a.color, b.color, f);
        // Opacitat progressiva: precip feble mes transparent, nuclis
        // forts gairebe opacs, com fan els radars reals.
        const alpha = Math.round(140 + (clamped / DBZ_STOPS[DBZ_STOPS.length - 1].dbz) * 115);
        return [r, g, bl, Math.min(255, alpha)];
      }
    }
    return [...DBZ_STOPS[DBZ_STOPS.length - 1].color, 255];
  }

  // ─── Interpolacio de punts dispersos a graella ───
  // Per cada frame es reben punts {lat, lon, dbz} irregulars. Es
  // projecten sobre una graella regular (gridWidth x gridHeight) dins
  // el bbox del frame, acumulant-los amb un kernel gaussia simple
  // (pes segons distancia) perque el resultat siguin taques suaus i
  // continues en lloc de pixels aillats.
  function interpolateToGrid(points, bounds, gridW, gridH, radiusCells) {
    const grid = new Float32Array(gridW * gridH).fill(NaN);
    const weightSum = new Float32Array(gridW * gridH);
    const valueSum = new Float32Array(gridW * gridH);

    const lonRange = bounds.east - bounds.west;
    const latRange = bounds.north - bounds.south;
    if (lonRange <= 0 || latRange <= 0 || points.length === 0) {
      return { grid, gridW, gridH };
    }

    const radiusPx = Math.max(1, radiusCells);
    const radiusPx2 = radiusPx * radiusPx;

    for (let p = 0; p < points.length; p++) {
      const pt = points[p];
      const gx = ((pt.lon - bounds.west) / lonRange) * (gridW - 1);
      const gy = ((bounds.north - pt.lat) / latRange) * (gridH - 1);

      const x0 = Math.max(0, Math.floor(gx - radiusPx));
      const x1 = Math.min(gridW - 1, Math.ceil(gx + radiusPx));
      const y0 = Math.max(0, Math.floor(gy - radiusPx));
      const y1 = Math.min(gridH - 1, Math.ceil(gy + radiusPx));

      for (let y = y0; y <= y1; y++) {
        for (let x = x0; x <= x1; x++) {
          const dx = x - gx;
          const dy = y - gy;
          const d2 = dx * dx + dy * dy;
          if (d2 > radiusPx2) continue;
          // Kernel gaussia normalitzat pel radi (suavitzat estandard)
          const w = Math.exp(-d2 / (2 * (radiusPx / 2) * (radiusPx / 2)));
          const idx = y * gridW + x;
          weightSum[idx] += w;
          valueSum[idx] += w * pt.dbz;
        }
      }
    }

    for (let i = 0; i < grid.length; i++) {
      grid[i] = weightSum[i] > 0 ? valueSum[i] / weightSum[i] : NaN;
    }

    return { grid, gridW, gridH };
  }

  function buildRadarDataUrl(frameData) {
    const { gridWidth, gridHeight, interpolationRadiusCells } = RADAR_CONFIG;
    const { grid, gridW, gridH } = interpolateToGrid(
      frameData.points, frameData.bounds, gridWidth, gridHeight, interpolationRadiusCells
    );

    const canvas = document.createElement('canvas');
    canvas.width = gridW;
    canvas.height = gridH;
    const ctx = canvas.getContext('2d');
    const imageData = ctx.createImageData(gridW, gridH);

    for (let i = 0; i < grid.length; i++) {
      const color = dbzToColor(grid[i]);
      const idx = i * 4;
      imageData.data[idx] = color[0];
      imageData.data[idx + 1] = color[1];
      imageData.data[idx + 2] = color[2];
      imageData.data[idx + 3] = color[3];
    }
    ctx.putImageData(imageData, 0, 0);

    // Suavitzat final amb un lleuger blur via upscale (igual patro
    // que la resta de capes de mapasatelit.js), perque quedi "maco"
    // i sense pixelat en fer zoom.
    const upFactor = 3;
    const upCanvas = document.createElement('canvas');
    upCanvas.width = gridW * upFactor;
    upCanvas.height = gridH * upFactor;
    const upCtx = upCanvas.getContext('2d');
    upCtx.imageSmoothingEnabled = true;
    upCtx.imageSmoothingQuality = 'high';
    upCtx.filter = 'blur(1.2px) saturate(1.1)';
    upCtx.drawImage(canvas, 0, 0, upCanvas.width, upCanvas.height);
    upCtx.filter = 'none';

    const result = upCanvas.toDataURL('image/png', 1.0);

    canvas.width = 0; canvas.height = 0;
    upCanvas.width = 0; upCanvas.height = 0;

    return result;
  }

  // ─── Gestor de capa de radar ───
  // Exposa una API senzilla que mapasatelit.js pot cridar. Manté
  // l'estat propi (frames carregats, animacio en marxa) aillat
  // d'aquest modul.
  const RadarLayer = {
    _frames: [],           // [{timestamp, dataUrl, bounds}, ...] ordenats 1..5
    _loaded: false,
    _loading: false,
    _animTimer: null,
    _animIndex: 0,
    _overlay: null,
    _map: null,
    _onFrameChange: null,  // callback opcional (per actualitzar HUD hora)
    _timeEl: null,         // element HTML on es mostra l'hora del frame actual

    isLoaded() {
      return this._loaded;
    },

    isLoading() {
      return this._loading;
    },

    // Descarrega i processa els 5 frames. Nomes es fa la primera
    // vegada que s'activa la capa (com IR/precip a mapasatelit.js).
    // Passar force=true ignora el cache intern i torna a descarregar
    // els 5 frames encara que ja estiguessin carregats (anticache
    // massiu: cada refresc obté dades noves de R2, mai les antigues).
    async load(force) {
      if (this._loading) return this._loaded;
      if (this._loaded && !force) return true;
      this._loading = true;
      if (force) {
        this._loaded = false;
        this._frames = [];
      }

      const results = [];
      for (let n = 1; n <= RADAR_CONFIG.totalFrames; n++) {
        const url = RADAR_CONFIG.framePattern.replace('{n}', n);
        try {
          const bustedUrl = url + (url.indexOf('?') === -1 ? '?' : '&') + 't=' + Date.now();
          const response = await fetch(bustedUrl, { cache: 'no-store' });
          if (!response.ok) throw new Error('HTTP ' + response.status);
          const compressed = new Uint8Array(await response.arrayBuffer());
          const decompressed = pako.inflate(compressed);
          const payload = msgpack.decode(decompressed);
          const dataUrl = buildRadarDataUrl(payload);
          results.push({
            timestamp: payload.timestamp,
            bounds: payload.bounds,
            dataUrl: dataUrl,
          });
        } catch (err) {
          console.warn('Radar frame_' + n + ' no disponible:', err.message);
        }
      }

      if (results.length === 0) {
        this._loading = false;
        return false;
      }

      // results ve ordenat frame_1 (mes nou) ... frame_5 (mes antic).
      // Es capgira perque l'animacio flueixi cronologicament: index 0
      // = mes antic, ultim index = mes nou. Aixi l'animacio avança
      // "cap endavant en el temps" i acaba sempre a l'instant mes
      // recent abans de tornar a començar pel mes antic.
      this._frames = results.reverse();
      this._loaded = true;
      this._loading = false;
      return true;
    },

    // Crea/actualitza l'overlay a Leaflet i comença l'animacio.
    // onFrameChange es opcional (per exemple, per mostrar l'hora del
    // frame de radar en algun HUD secundari); no toca l'hora
    // principal, que sempre reflecteix la capa de fons.
    attach(map, onFrameChange) {
      this._map = map;
      this._onFrameChange = onFrameChange || null;
      if (!this._loaded || this._frames.length === 0) return;

      // Comença sempre mostrant l'instant mes recent (ultim del
      // array, ja que _frames va d'antic a nou) i engega l'animacio
      // tot seguit en automatic, sense esperar cap clic ni fletxa.
      this._animIndex = this._frames.length - 1;
      this._showFrame(this._animIndex);
      this._startAnimation();
    },

    // Treu l'overlay del mapa i atura l'animacio (pero manté les
    // dades en cache per si es torna a activar la capa).
    detach() {
      this._stopAnimation();
      if (this._overlay && this._map && this._map.hasLayer(this._overlay)) {
        this._map.removeLayer(this._overlay);
      }
      if (this._timeEl) this._timeEl.textContent = '';
    },

    _showFrame(index) {
      const frame = this._frames[index];
      if (!frame || !this._map) return;

      const b = frame.bounds;
      const bounds = [[b.south, b.west], [b.north, b.east]];

      if (this._overlay) {
        this._overlay.setUrl(frame.dataUrl);
        this._overlay.setBounds(bounds);
      } else {
        // zIndex 4: per sobre de qualsevol capa de fons (satelit,
        // ir, alcada, precip, llamps fan servir zIndex 2) i de les
        // fronteres (zIndex 3), ja que ara es un overlay independent
        // que es pot combinar amb qualsevol capa de fons.
        this._overlay = L.imageOverlay(frame.dataUrl, bounds, {
          opacity: 0.65,
          interactive: false,
          zIndex: 4,
        });
      }
      if (!this._map.hasLayer(this._overlay)) {
        this._overlay.addTo(this._map);
      }

      if (this._onFrameChange) this._onFrameChange(frame.timestamp, index, this._frames.length);
      this._updateTimeLabel(frame.timestamp);
    },

    // Escriu l'hora del frame actual a l'element HTML del costat del
    // toggle (si existeix). Format Europe/Madrid, igual que la resta
    // de l'app (formatHoraMadrid a mapasatelit.js).
    _updateTimeLabel(timestamp) {
      if (!this._timeEl || !timestamp) return;
      try {
        var raw = String(timestamp);
        var tieneZona = /Z$|[+-]\d{2}:?\d{2}$/.test(raw.trim());
        var iso = tieneZona ? raw : (raw.replace(' ', 'T') + 'Z');
        var dt = new Date(iso);
        if (Number.isNaN(dt.getTime())) dt = new Date(raw);
        if (Number.isNaN(dt.getTime())) { this._timeEl.textContent = raw; return; }
        var formatted = new Intl.DateTimeFormat('ca-ES', {
          timeZone: 'Europe/Madrid',
          hour: '2-digit',
          minute: '2-digit',
        }).format(dt);
        this._timeEl.textContent = formatted;
      } catch (err) {
        this._timeEl.textContent = timestamp;
      }
    },

    // Vincula l'element HTML on es mostrarà l'hora de cada frame
    // (cridat una vegada des de mapasatelit.js, al costat del toggle).
    setTimeElement(el) {
      this._timeEl = el || null;
    },

    _startAnimation() {
      this._stopAnimation();
      this._animTimer = setInterval(() => {
        // Animacio cap endavant en el temps: com _frames va d'antic
        // (index 0) a nou (ultim index), sumar 1 avança cronologi-
        // cament. Quan arriba al mes nou, fa wrap al mes antic i
        // torna a començar: antic->...->nou->antic->...
        this._animIndex = (this._animIndex + 1) % this._frames.length;
        this._showFrame(this._animIndex);
      }, RADAR_CONFIG.animIntervalMs);
    },

    _stopAnimation() {
      if (this._animTimer) {
        clearInterval(this._animTimer);
        this._animTimer = null;
      }
    },

    setOpacity(op) {
      if (this._overlay) this._overlay.setOpacity(op);
    },
  };

  global.RadarLayer = RadarLayer;

})(window);