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
    // Resolucio de sortida del canvas rasteritzat (px). Es el que
    // abans es deia gridWidth/gridHeight; ara es nomes la mida del
    // canvas final (la reixa de dades interna es construeix a la
    // resolucio nativa dels punts i despres es mostreja bilinealment
    // cap aquesta mida de sortida, igual que fa radar-style.js).
    outW: 700,
    outH: 700,
    // Radi (en cel·les de la reixa nativa) del blur gaussia aplicat
    // abans de rasteritzar. Mes gran = taques mes suaus i continues
    // (estil radar real); mes petit = mes fidel al punt pero amb
    // mes soroll/textura.
    smoothRadiusCells: 1,
    // Resolucio aproximada (metres) de cada cel·la de la reixa nativa
    // construida a partir dels punts dispersos del frame. Nomes
    // s'utilitza si el payload del frame no porta el seu propi
    // resolution_m.
    defaultResolutionM: 2000,
  };

  // ─── Offset de correccio (lon/lat) ───
  const LON_OFFSET_STORAGE_KEY = 'radar_lon_offset';
  const LAT_OFFSET_STORAGE_KEY = 'radar_lat_offset';
  // Graus per click de nudge (~1km aprox a aquesta latitud).
  const OFFSET_STEP = 0.01;
  // Valors inicials per defecte si no hi ha res desat a localStorage
  // (0.1 en longitud es el valor que s'havia trobat que apropava
  // be el radar cap a l'est; ajustable des de la UI o consola).
  const DEFAULT_LON_OFFSET = 0.05;
  const DEFAULT_LAT_OFFSET = -0.049;

  function loadOffset(key, defaultVal) {
    try {
      const saved = localStorage.getItem(key);
      const val = saved !== null ? parseFloat(saved) : defaultVal;
      return Number.isFinite(val) ? val : defaultVal;
    } catch (err) {
      return defaultVal;
    }
  }

  function saveOffset(key, val) {
    try {
      localStorage.setItem(key, String(val));
    } catch (err) {
      console.warn('No s\'ha pogut desar offset de radar:', err);
    }
  }

  // =====================================================================
  // RENDERITZAT VISUAL (estil radar-style.js v2)
  //
  // En comptes de "pintar" cada punt dispers directament sobre un canvas
  // amb un kernel gaussia per punt (com abans), aqui es segueix el
  // mateix enfocament que radar-style.js:
  //   1) els punts {lat,lon,dbz} es converteixen a una REIXA REGULAR
  //      (buildGrid), agafant el maxim de dBZ per cel·la.
  //   2) es suavitza la reixa sencera amb un blur gaussia separable
  //      que ignora les cel·les sense dada (smoothGrid), evitant que
  //      les zones sense pluja es "tenyeixin".
  //   3) es rasteritza la reixa suavitzada a la mida final del canvas
  //      fent servir interpolacio BILINEAL entre cel·les
  //      (rasterizeGridToCanvas), amb un lleuger fade a la vora del
  //      llindar minim per evitar una vora dura.
  // Aixo dona vores suaus i contínues, com el radar de TV/NEXRAD real,
  // en lloc de l'aspecte "taques" del kernel per punt.
  // =====================================================================

  // ─── Paleta dBZ estil NWS/radar americà (colors "clàssics") ───
  const NWS_STEPS = [
    { min: -Infinity, max: 5,  c: null },
    { min: 5,   max: 10,  c: [4, 233, 231] },
    { min: 10,  max: 15,  c: [1, 159, 244] },
    { min: 15,  max: 20,  c: [3, 0, 244] },
    { min: 20,  max: 25,  c: [2, 253, 2] },
    { min: 25,  max: 30,  c: [1, 197, 1] },
    { min: 30,  max: 35,  c: [0, 142, 0] },
    { min: 35,  max: 40,  c: [253, 248, 2] },
    { min: 40,  max: 45,  c: [229, 188, 0] },
    { min: 45,  max: 50,  c: [253, 149, 0] },
    { min: 50,  max: 55,  c: [253, 0, 0] },
    { min: 55,  max: 60,  c: [212, 0, 0] },
    { min: 60,  max: 65,  c: [188, 0, 0] },
    { min: 65,  max: 70,  c: [248, 0, 253] },
    { min: 70,  max: 75,  c: [152, 84, 198] },
    { min: 75,  max: Infinity, c: [253, 253, 253] },
  ];

  const THRESHOLD_DBZ = 5;

  /**
   * Color continu (no per graons) per a un valor de dBZ, interpolant
   * linealment entre els colors base de cada tram. Dona transicions
   * netes sense bandes brusques.
   */
  function dbzToColorSmooth(dbz) {
    const steps = NWS_STEPS.filter((s) => s.c);
    if (dbz < THRESHOLD_DBZ) return steps[0].c;
    if (dbz >= steps[steps.length - 1].min) return steps[steps.length - 1].c;
    for (let i = 0; i < steps.length - 1; i++) {
      const a = steps[i], b = steps[i + 1];
      if (dbz >= a.min && dbz < b.min) {
        const t = (dbz - a.min) / (b.min - a.min);
        return [
          a.c[0] + t * (b.c[0] - a.c[0]),
          a.c[1] + t * (b.c[1] - a.c[1]),
          a.c[2] + t * (b.c[2] - a.c[2]),
        ];
      }
    }
    return steps[0].c;
  }

  /**
   * Construeix una reixa regular a partir dels punts d'un frame.
   * frame ha de tenir { points: [{lat,lon,dbz}, ...], resolution_m?,
   * bounds?: {north,south,east,west} }.
   * Retorna { grid: Float32Array(nRows*nCols) amb NaN=sense dada,
   *           nRows, nCols, north, west, dLat, dLon }.
   */
  function buildGrid(frame) {
    const pts = frame.points;
    const resolutionM = frame.resolution_m || RADAR_CONFIG.defaultResolutionM;

    let minLat = Infinity, maxLat = -Infinity, minLon = Infinity, maxLon = -Infinity;

    if (frame.bounds) {
      minLat = frame.bounds.south;
      maxLat = frame.bounds.north;
      minLon = frame.bounds.west;
      maxLon = frame.bounds.east;
    } else {
      for (const p of pts) {
        if (p.lat < minLat) minLat = p.lat;
        if (p.lat > maxLat) maxLat = p.lat;
        if (p.lon < minLon) minLon = p.lon;
        if (p.lon > maxLon) maxLon = p.lon;
      }
    }

    if (!isFinite(minLat) || !pts || pts.length === 0) {
      return { grid: new Float32Array(1).fill(NaN), nRows: 1, nCols: 1, north: 0, west: 0, dLat: 0.01, dLon: 0.01 };
    }

    const midLat = (minLat + maxLat) / 2;
    const metersPerDegLat = 111320;
    const metersPerDegLon = 111320 * Math.cos((midLat * Math.PI) / 180);
    const dLat = resolutionM / metersPerDegLat;
    const dLon = resolutionM / Math.max(metersPerDegLon, 1);

    const nRows = Math.max(1, Math.round((maxLat - minLat) / dLat) + 1);
    const nCols = Math.max(1, Math.round((maxLon - minLon) / dLon) + 1);

    const grid = new Float32Array(nRows * nCols).fill(NaN);

    for (const p of pts) {
      const row = Math.round((maxLat - p.lat) / dLat); // fila 0 = nord
      const col = Math.round((p.lon - minLon) / dLon);
      if (row >= 0 && row < nRows && col >= 0 && col < nCols) {
        const idx = row * nCols + col;
        if (isNaN(grid[idx]) || p.dbz > grid[idx]) grid[idx] = p.dbz;
      }
    }

    return { grid, nRows, nCols, north: maxLat, west: minLon, dLat, dLon };
  }

  /**
   * Aplica un suavitzat gaussia (blur) sobre la reixa de dBZ, tractant
   * les cel·les sense dada (NaN) amb pes zero perque no "tenyeixin"
   * les zones sense pluja del voltant.
   */
  function smoothGrid(gridObj, radius) {
    radius = radius || 1;
    const { grid, nRows, nCols } = gridObj;

    const sigma = radius * 0.6;
    const kernelSize = radius * 2 + 1;
    const kernel = new Float32Array(kernelSize);
    let kSum = 0;
    for (let i = 0; i < kernelSize; i++) {
      const x = i - radius;
      const v = Math.exp(-(x * x) / (2 * sigma * sigma));
      kernel[i] = v;
      kSum += v;
    }
    for (let i = 0; i < kernelSize; i++) kernel[i] /= kSum;

    const tmp = new Float32Array(nRows * nCols).fill(NaN);
    const out = new Float32Array(nRows * nCols).fill(NaN);

    // passada horitzontal
    for (let r = 0; r < nRows; r++) {
      for (let c = 0; c < nCols; c++) {
        let sumW = 0, sumV = 0, any = false;
        for (let k = -radius; k <= radius; k++) {
          const cc = c + k;
          if (cc < 0 || cc >= nCols) continue;
          const v = grid[r * nCols + cc];
          if (isNaN(v)) continue;
          const w = kernel[k + radius];
          sumV += v * w;
          sumW += w;
          any = true;
        }
        tmp[r * nCols + c] = any ? sumV / sumW : NaN;
      }
    }

    // passada vertical
    for (let c = 0; c < nCols; c++) {
      for (let r = 0; r < nRows; r++) {
        let sumW = 0, sumV = 0, any = false;
        for (let k = -radius; k <= radius; k++) {
          const rr = r + k;
          if (rr < 0 || rr >= nRows) continue;
          const v = tmp[rr * nCols + c];
          if (isNaN(v)) continue;
          const w = kernel[k + radius];
          sumV += v * w;
          sumW += w;
          any = true;
        }
        out[r * nCols + c] = any ? sumV / sumW : NaN;
      }
    }

    return { grid: out, nRows, nCols, north: gridObj.north, west: gridObj.west, dLat: gridObj.dLat, dLon: gridObj.dLon };
  }

  /**
   * Interpolacio bilineal d'un valor de la reixa a coordenades de
   * fila/columna fraccionaries.
   */
  function bilinearSample(grid, nRows, nCols, r, c) {
    if (r < 0 || r > nRows - 1 || c < 0 || c > nCols - 1) return NaN;
    const r0 = Math.floor(r), c0 = Math.floor(c);
    const r1 = Math.min(r0 + 1, nRows - 1), c1 = Math.min(c0 + 1, nCols - 1);
    const fr = r - r0, fc = c - c0;

    const v00 = grid[r0 * nCols + c0];
    const v01 = grid[r0 * nCols + c1];
    const v10 = grid[r1 * nCols + c0];
    const v11 = grid[r1 * nCols + c1];

    const vals = [
      { v: v00, w: (1 - fr) * (1 - fc) },
      { v: v01, w: (1 - fr) * fc },
      { v: v10, w: fr * (1 - fc) },
      { v: v11, w: fr * fc },
    ].filter((x) => !isNaN(x.v));

    if (vals.length === 0) return NaN;
    let sumW = 0, sumV = 0;
    for (const x of vals) { sumW += x.w; sumV += x.v * x.w; }
    return sumW > 0 ? sumV / sumW : NaN;
  }

  /**
   * Rasteritza una reixa de dBZ a un <canvas> amb interpolacio
   * bilineal (suau, sense vores dentades) i colors NWS continus.
   */
  function rasterizeGridToCanvas(gridObj, outW, outH, opacity255) {
    const { grid, nRows, nCols } = gridObj;
    const canvas = document.createElement('canvas');
    canvas.width = outW;
    canvas.height = outH;
    const ctx = canvas.getContext('2d');
    const imgData = ctx.createImageData(outW, outH);
    const data = imgData.data;
    const baseAlpha = opacity255 !== undefined ? opacity255 : 210;

    const rowScale = (nRows - 1) / Math.max(outH - 1, 1);
    const colScale = (nCols - 1) / Math.max(outW - 1, 1);

    for (let y = 0; y < outH; y++) {
      const r = y * rowScale;
      for (let x = 0; x < outW; x++) {
        const c = x * colScale;
        const dbz = bilinearSample(grid, nRows, nCols, r, c);
        const idx = (y * outW + x) * 4;
        if (isNaN(dbz) || dbz < THRESHOLD_DBZ) {
          data[idx + 3] = 0;
          continue;
        }
        const col = dbzToColorSmooth(dbz);
        data[idx] = col[0];
        data[idx + 1] = col[1];
        data[idx + 2] = col[2];
        // fade suau just per sobre del llindar, per evitar vora dura
        const fadeIn = Math.min(1, (dbz - THRESHOLD_DBZ) / 3);
        data[idx + 3] = Math.round(baseAlpha * fadeIn);
      }
    }

    ctx.putImageData(imgData, 0, 0);
    return canvas;
  }

  /**
   * Substitueix l'antiga interpolateToGrid + dbzToColor per punt.
   * Rep el payload del frame (amb .points, .bounds opcional,
   * .resolution_m opcional) i retorna un dataURL PNG ja suavitzat i
   * rasteritzat amb bilineal, igual que radar-style.js.
   */
  function buildRadarDataUrl(frameData) {
    const rawGrid = buildGrid(frameData);
    const smoothed = smoothGrid(rawGrid, RADAR_CONFIG.smoothRadiusCells);
    const canvas = rasterizeGridToCanvas(smoothed, RADAR_CONFIG.outW, RADAR_CONFIG.outH, 210);
    const result = canvas.toDataURL('image/png', 1.0);
    canvas.width = 0; canvas.height = 0;
    return result;
  }

  // ─── Gestor de capa de radar ───
  // Exposa una API senzilla que mapasatelit.js pot cridar. Manté
  // l'estat propi (frames carregats, animacio en marxa) aillat
  // d'aquest modul. (Sense canvis respecte a la versio anterior:
  // nomes es substitueix com es genera frame.dataUrl.)
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
    _isPlaying: false,     // si l'animacio automatica esta en marxa
    _onPlayStateChange: null, // callback opcional (per actualitzar boto play/pause)
    _lonOffset: loadOffset(LON_OFFSET_STORAGE_KEY, DEFAULT_LON_OFFSET),
    _latOffset: loadOffset(LAT_OFFSET_STORAGE_KEY, DEFAULT_LAT_OFFSET),
    _onOffsetChange: null, // callback opcional (per actualitzar UI d'offset)

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

      // Comença mostrant l'instant mes recent (ultim del array, ja
      // que _frames va d'antic a nou), en ESTATIC. No s'anima fins
      // que l'usuari premi play o una fletxa manualment.
      this._animIndex = this._frames.length - 1;
      this._showFrame(this._animIndex);
    },

    // Treu l'overlay del mapa i atura l'animacio (pero manté les
    // dades en cache per si es torna a activar la capa).
    detach() {
      this._stopAnimation();
      this._isPlaying = false;
      if (this._onPlayStateChange) this._onPlayStateChange(false);
      if (this._overlay && this._map && this._map.hasLayer(this._overlay)) {
        this._map.removeLayer(this._overlay);
      }
      if (this._timeEl) this._timeEl.textContent = '';
    },

    // ─── Controls manuals (fletxes + play/pause) ───

    // Avança un frame cap al mes nou (cronologicament endavant).
    // Fa wrap: des del mes nou torna al mes antic.
    stepForward() {
      if (!this._loaded || this._frames.length === 0) return;
      this._animIndex = (this._animIndex + 1) % this._frames.length;
      this._showFrame(this._animIndex);
    },

    // Retrocedeix un frame cap al mes antic (cronologicament enrere).
    // Fa wrap: des del mes antic salta al mes nou.
    stepBackward() {
      if (!this._loaded || this._frames.length === 0) return;
      this._animIndex = (this._animIndex - 1 + this._frames.length) % this._frames.length;
      this._showFrame(this._animIndex);
    },

    isPlaying() {
      return this._isPlaying;
    },

    // Vincula un callback opcional que s'avisa quan l'estat play/
    // pause canvia (per exemple, per commutar la icona del boto).
    setPlayStateCallback(cb) {
      this._onPlayStateChange = cb || null;
    },

    play() {
      if (!this._loaded || this._frames.length === 0) return;
      this._isPlaying = true;
      if (this._onPlayStateChange) this._onPlayStateChange(true);
      this._startAnimation();
    },

    pause() {
      this._isPlaying = false;
      if (this._onPlayStateChange) this._onPlayStateChange(false);
      this._stopAnimation();
    },

    togglePlay() {
      if (this._isPlaying) this.pause();
      else this.play();
    },

    // ─── Ajust d'offset de correccio (lon/lat) ───
    // Temporal, mentre no es diagnostica/corregeix l'origen exacte
    // del desplaçament a rad.py. Persisteix a localStorage.

    getLonOffset() {
      return this._lonOffset;
    },

    getLatOffset() {
      return this._latOffset;
    },

    // Vincula un callback opcional que s'avisa quan l'offset canvia
    // (per exemple, per actualitzar una etiqueta a la UI amb els
    // valors actuals de lon/lat offset).
    setOffsetChangeCallback(cb) {
      this._onOffsetChange = cb || null;
    },

    setLonOffset(val) {
      this._lonOffset = val;
      saveOffset(LON_OFFSET_STORAGE_KEY, val);
      if (this._loaded && this._frames.length > 0) this._showFrame(this._animIndex);
      if (this._onOffsetChange) this._onOffsetChange(this._lonOffset, this._latOffset);
    },

    setLatOffset(val) {
      this._latOffset = val;
      saveOffset(LAT_OFFSET_STORAGE_KEY, val);
      if (this._loaded && this._frames.length > 0) this._showFrame(this._animIndex);
      if (this._onOffsetChange) this._onOffsetChange(this._lonOffset, this._latOffset);
    },

    // Desplaça el radar cap a l'est (augmenta la longitud).
    nudgeEast() {
      this.setLonOffset(this._lonOffset + OFFSET_STEP);
    },

    // Desplaça el radar cap a l'oest (disminueix la longitud).
    nudgeWest() {
      this.setLonOffset(this._lonOffset - OFFSET_STEP);
    },

    // Desplaça el radar cap amunt / nord (augmenta la latitud).
    nudgeNorth() {
      this.setLatOffset(this._latOffset + OFFSET_STEP);
    },

    // Desplaça el radar cap avall / sud (disminueix la latitud).
    nudgeSouth() {
      this.setLatOffset(this._latOffset - OFFSET_STEP);
    },

    // Reinicia ambdos offsets a 0 (posicio "crua", sense correccio).
    resetOffsets() {
      this.setLonOffset(0);
      this.setLatOffset(0);
    },

    _showFrame(index) {
      const frame = this._frames[index];
      if (!frame || !this._map) return;

      const b = frame.bounds;
      // Correccio temporal: les dades del radar apareixen desplaçades
      // de manera consistent (pendent de diagnosticar l'origen exacte
      // a rad.py: projeccio/datum). S'apliquen offsets ajustables amb
      // nudgeEast()/nudgeWest()/nudgeNorth()/nudgeSouth(), persistits
      // a localStorage.
      const bounds = [
        [b.south + this._latOffset, b.west + this._lonOffset],
        [b.north + this._latOffset, b.east + this._lonOffset]
      ];

      if (this._overlay) {
        this._overlay.setUrl(frame.dataUrl);
        this._overlay.setBounds(bounds);
      } else {
        // zIndex 4: per sobre de qualsevol capa de fons (satelit,
        // ir, alcada, precip, llamps fan servir zIndex 2) i de les
        // fronteres (zIndex 3), ja que ara es un overlay independent
        // que es pot combinar amb qualsevol capa de fons.
        this._overlay = L.imageOverlay(frame.dataUrl, bounds, {
          opacity: 1,
          interactive: false,
          zIndex: 10,
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