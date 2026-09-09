(function (global) {

  // Dades servides des de R2 (mateix bucket/domini que fa servir
  // mapasatelit.js per al satelit, pero amb prefix dades_rad/ en
  // lloc de dades_sat/).
  const RADAR_BASE = 'https://radar-data.tempestes.cat/dades_rad/';

  const RADAR_CONFIG = {
    framePattern: RADAR_BASE + 'meteorad_ne_spain_dbz_frame_{n}.msgpack.gz',
    totalFrames: 5,
    // Temps base entre frames REALS (ms) a velocitat 1x. Es multiplica
    // per la fraccio de pas d'interpolacio (vegeu INTERP_STEPS) i es
    // divideix per l'speedMultiplier seleccionat per l'usuari.
    animIntervalMs: 700,
    // Nombre de fotogrames intermedis generats ENTRE cada parell de
    // frames reals consecutius (interpolacio temporal, com lerpGrids
    // de radar-style.js). 0 = sense interpolar (salt brusc, com
    // abans). Amb INTERP_STEPS=4 es generen 4 passos intermedis, es
    // a dir t=0.2,0.4,0.6,0.8 entre cada parell de frames reals, a
    // mes dels propis frames reals (t=0 i t=1).
    interpSteps: 4,
    // Resolucio de sortida del canvas rasteritzat (px).
    outW: 700,
    outH: 700,
    // Radi (en cel·les de la reixa nativa) del blur gaussia aplicat
    // abans de rasteritzar.
    smoothRadiusCells: 1,
    // Resolucio aproximada (metres) de cada cel·la de la reixa nativa.
    defaultResolutionM: 2000,
  };

  // Multiplicadors de velocitat disponibles per l'usuari. 1 = velocitat
  // normal (animIntervalMs entre frames reals). 0.5 = doble de lenta.
  // 4 = quatre vegades mes rapida.
  const SPEED_OPTIONS = [0.5, 1, 2, 4];
  const SPEED_STORAGE_KEY = 'radar_speed_multiplier';

  function loadSpeed() {
    try {
      var saved = parseFloat(localStorage.getItem(SPEED_STORAGE_KEY));
      return SPEED_OPTIONS.indexOf(saved) !== -1 ? saved : 1;
    } catch (e) {
      return 1;
    }
  }
  function saveSpeed(val) {
    try { localStorage.setItem(SPEED_STORAGE_KEY, String(val)); } catch (e) {}
  }

  // ─── Offset de correccio (lon/lat) ───
  const LON_OFFSET_STORAGE_KEY = 'radar_lon_offset';
  const LAT_OFFSET_STORAGE_KEY = 'radar_lat_offset';
  const OFFSET_STEP = 0.01;
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

  // ─── Parseig robust de timestamps de radar ───
  // Els frames envien timestamps en format compacte tipus
  // "2026-09-09T215000Z" (sense ":" a la part de l'hora), que NO es
  // un ISO 8601 valid i que `new Date(...)` rebutja silenciosament
  // (retorna Invalid Date). Aquesta funcio normalitza aquest format
  // (amb o sense guions/separadors) abans de crear el Date, i cau
  // a altres formats ISO/"YYYY-MM-DD HH:MM:SS" si cal.
  function parsejarTimestampRadar(timestamp) {
    if (!timestamp) return null;
    const raw = String(timestamp).trim();

    // Format compacte: 2026-09-09T215000Z o 20260909T215000Z
    const compacte = raw.match(/^(\d{4})-?(\d{2})-?(\d{2})T(\d{2})(\d{2})(\d{2})Z?$/);
    if (compacte) {
      const iso = compacte[1] + '-' + compacte[2] + '-' + compacte[3] + 'T' +
                  compacte[4] + ':' + compacte[5] + ':' + compacte[6] + 'Z';
      const dt = new Date(iso);
      if (!Number.isNaN(dt.getTime())) return dt;
    }

    // Format ISO normal (amb ":"), amb o sense zona horaria explicita
    const tieneZona = /Z$|[+-]\d{2}:?\d{2}$/.test(raw);
    const isoNormal = tieneZona ? raw : (raw.replace(' ', 'T') + 'Z');
    const dt2 = new Date(isoNormal);
    if (!Number.isNaN(dt2.getTime())) return dt2;

    // Ultim recurs
    const dt3 = new Date(raw);
    if (!Number.isNaN(dt3.getTime())) return dt3;

    return null;
  }

  // Format curt "HH:MM" en hora local de Madrid, per la caixa del
  // panell de radar (al costat del toggle). Sempre retorna una hora
  // llegible en 24h; mai el text cru del timestamp.
  function formatarHoraLocalMadrid(timestamp) {
    const dt = parsejarTimestampRadar(timestamp);
    if (!dt) return '--:--';
    try {
      return new Intl.DateTimeFormat('ca-ES', {
        timeZone: 'Europe/Madrid',
        hour: '2-digit',
        minute: '2-digit',
      }).format(dt);
    } catch (err) {
      return '--:--';
    }
  }

  // =====================================================================
  // RENDERITZAT VISUAL (estil radar-style.js v2, amb interpolacio
  // temporal afegida)
  // =====================================================================

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
      const row = Math.round((maxLat - p.lat) / dLat);
      const col = Math.round((p.lon - minLon) / dLon);
      if (row >= 0 && row < nRows && col >= 0 && col < nCols) {
        const idx = row * nCols + col;
        if (isNaN(grid[idx]) || p.dbz > grid[idx]) grid[idx] = p.dbz;
      }
    }

    return { grid, nRows, nCols, north: maxLat, west: minLon, dLat, dLon };
  }

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
   * Interpolacio temporal entre dues reixes (t=0 -> gA, t=1 -> gB).
   * Si les reixes no coincideixen geometricament, es remalla gB sobre
   * les coordenades de gA amb mostreig bilineal. Igual que lerpGrids
   * de radar-style.js.
   */
  function lerpGrids(gA, gB, t) {
    if (t <= 0) return gA;
    if (t >= 1) return gB;

    const { nRows, nCols } = gA;
    const out = new Float32Array(nRows * nCols);

    const sameShape = gB.nRows === gA.nRows && gB.nCols === gA.nCols &&
      gB.north === gA.north && gB.west === gA.west;

    for (let r = 0; r < nRows; r++) {
      for (let c = 0; c < nCols; c++) {
        const a = gA.grid[r * nCols + c];

        let b;
        if (sameShape) {
          b = gB.grid[r * nCols + c];
        } else {
          const lat = gA.north - r * gA.dLat;
          const lon = gA.west + c * gA.dLon;
          const rB = (gB.north - lat) / gB.dLat;
          const cB = (lon - gB.west) / gB.dLon;
          b = bilinearSample(gB.grid, gB.nRows, gB.nCols, rB, cB);
        }

        const aNan = isNaN(a), bNan = isNaN(b);
        if (aNan && bNan) out[r * nCols + c] = NaN;
        else if (aNan) out[r * nCols + c] = b * t;
        else if (bNan) out[r * nCols + c] = a * (1 - t);
        else out[r * nCols + c] = a + (b - a) * t;
      }
    }

    return { grid: out, nRows, nCols, north: gA.north, west: gA.west, dLat: gA.dLat, dLon: gA.dLon };
  }

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
        const fadeIn = Math.min(1, (dbz - THRESHOLD_DBZ) / 3);
        data[idx + 3] = Math.round(baseAlpha * fadeIn);
      }
    }

    ctx.putImageData(imgData, 0, 0);
    return canvas;
  }

  /**
   * Genera el dataURL PNG a partir d'una reixa ja suavitzada
   * (rawGrid -> smoothGrid ja aplicat prèviament).
   */
  function gridToDataUrl(smoothedGrid) {
    const canvas = rasterizeGridToCanvas(smoothedGrid, RADAR_CONFIG.outW, RADAR_CONFIG.outH, 210);
    const result = canvas.toDataURL('image/png', 1.0);
    canvas.width = 0; canvas.height = 0;
    return result;
  }

  /**
   * Processa el payload cru d'un frame (punts) fins a la reixa
   * suavitzada, LLESTA per interpolar amb lerpGrids o rasteritzar
   * directament amb gridToDataUrl.
   */
  function buildSmoothedGrid(frameData) {
    const rawGrid = buildGrid(frameData);
    return smoothGrid(rawGrid, RADAR_CONFIG.smoothRadiusCells);
  }

  // ─── Gestor de capa de radar ───
  const RadarLayer = {
    _frames: [],           // [{timestamp, bounds, grid, dataUrl}, ...] ordenats antic->nou
    _loaded: false,
    _loading: false,
    _animTimer: null,
    // _animIndex ara es un index FRACCIONARI (pot ser 2.4, per
    // exemple) que representa "entre el frame 2 i el 3, a un 40%".
    // L'index de frame REAL mostrat a la UI (comptador, hora) es
    // Math.round(_animIndex).
    _animIndex: 0,
    _overlay: null,
    _map: null,
    _onFrameChange: null,
    _timeEl: null,
    _isPlaying: false,
    _onPlayStateChange: null,
    _lonOffset: loadOffset(LON_OFFSET_STORAGE_KEY, DEFAULT_LON_OFFSET),
    _latOffset: loadOffset(LAT_OFFSET_STORAGE_KEY, DEFAULT_LAT_OFFSET),
    _onOffsetChange: null,
    _speedMultiplier: loadSpeed(),
    _onSpeedChange: null,

    isLoaded() {
      return this._loaded;
    },

    isLoading() {
      return this._loading;
    },

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
          const smoothed = buildSmoothedGrid(payload);
          results.push({
            timestamp: payload.timestamp,
            bounds: payload.bounds,
            grid: smoothed,               // reixa crua suavitzada, per interpolar
            dataUrl: gridToDataUrl(smoothed), // PNG del frame real (sense interpolar), cache
          });
        } catch (err) {
          console.warn('Radar frame_' + n + ' no disponible:', err.message);
        }
      }

      if (results.length === 0) {
        this._loading = false;
        return false;
      }

      this._frames = results.reverse();
      this._loaded = true;
      this._loading = false;
      return true;
    },

    attach(map, onFrameChange) {
      this._map = map;
      this._onFrameChange = onFrameChange || null;
      if (!this._loaded || this._frames.length === 0) return;

      this._animIndex = this._frames.length - 1;
      this._showFrame(this._animIndex);
    },

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
    // Ara es mouen d'un FRAME REAL a un altre (saltant qualsevol
    // interpolacio intermitja en curs), arrodonint primer l'index
    // fraccionari actual.
    stepForward() {
      if (!this._loaded || this._frames.length === 0) return;
      const cur = Math.round(this._animIndex);
      this._animIndex = (cur + 1) % this._frames.length;
      this._showFrame(this._animIndex);
    },

    stepBackward() {
      if (!this._loaded || this._frames.length === 0) return;
      const cur = Math.round(this._animIndex);
      this._animIndex = (cur - 1 + this._frames.length) % this._frames.length;
      this._showFrame(this._animIndex);
    },

    isPlaying() {
      return this._isPlaying;
    },

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

    // ─── Velocitat d'animacio (0.5x, 1x, 2x, 4x) ───
    getSpeedOptions() {
      return SPEED_OPTIONS.slice();
    },

    getSpeed() {
      return this._speedMultiplier;
    },

    setSpeedCallback(cb) {
      this._onSpeedChange = cb || null;
    },

    setSpeed(multiplier) {
      if (SPEED_OPTIONS.indexOf(multiplier) === -1) return;
      this._speedMultiplier = multiplier;
      saveSpeed(multiplier);
      if (this._onSpeedChange) this._onSpeedChange(multiplier);
      // Si esta animant, reinicia el timer perque el nou interval
      // s'apliqui immediatament en lloc d'esperar al proxim tick.
      if (this._isPlaying) {
        this._startAnimation();
      }
    },

    // ─── Ajust d'offset de correccio (lon/lat) ───
    getLonOffset() {
      return this._lonOffset;
    },

    getLatOffset() {
      return this._latOffset;
    },

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

    nudgeEast() { this.setLonOffset(this._lonOffset + OFFSET_STEP); },
    nudgeWest() { this.setLonOffset(this._lonOffset - OFFSET_STEP); },
    nudgeNorth() { this.setLatOffset(this._latOffset + OFFSET_STEP); },
    nudgeSouth() { this.setLatOffset(this._latOffset - OFFSET_STEP); },
    resetOffsets() { this.setLonOffset(0); this.setLatOffset(0); },

    /**
     * Mostra el frame a un index FRACCIONARI (p.ex. 2.4 = 40% entre
     * el frame real 2 i el 3). Si index cau exactament sobre un
     * enter, s'usa directament el dataUrl ja cachejat del frame
     * real (mes rapid, sense recalcular). Si no, s'interpola entre
     * els dos frames reals adjacents amb lerpGrids + rasteritzat al
     * vol.
     */
    _showFrame(index) {
      if (!this._map || this._frames.length === 0) return;

      const n = this._frames.length;
      // Normalitza dins [0, n) fent wrap, mantenint la part fraccionaria.
      let idx = index % n;
      if (idx < 0) idx += n;

      const i0 = Math.floor(idx);
      const frac = idx - i0;
      const frameA = this._frames[i0];

      let dataUrl, bounds, tsForLabel;

      if (frac < 0.001) {
        // Exactament sobre un frame real: usar el PNG ja cachejat.
        dataUrl = frameA.dataUrl;
        bounds = frameA.bounds;
        tsForLabel = frameA.timestamp;
      } else {
        // Fotograma intermedi: interpolar entre frameA i el seguent
        // (amb wrap circular, com stepForward/animacio).
        const i1 = (i0 + 1) % n;
        const frameB = this._frames[i1];
        const interpGrid = lerpGrids(frameA.grid, frameB.grid, frac);
        dataUrl = gridToDataUrl(interpGrid);
        // bounds/timestamp: interpolem visualment la posicio pero
        // etiquetem amb el frame real mes proper per no confondre
        // l'hora mostrada (arrodonim a A o B segons quin es mes a prop).
        bounds = frac < 0.5 ? frameA.bounds : frameB.bounds;
        tsForLabel = frac < 0.5 ? frameA.timestamp : frameB.timestamp;
      }

      const b = bounds;
      const boundsLeaflet = [
        [b.south + this._latOffset, b.west + this._lonOffset],
        [b.north + this._latOffset, b.east + this._lonOffset]
      ];

      if (this._overlay) {
        this._overlay.setUrl(dataUrl);
        this._overlay.setBounds(boundsLeaflet);
      } else {
        this._overlay = L.imageOverlay(dataUrl, boundsLeaflet, {
          opacity: 1,
          interactive: false,
          zIndex: 10,
        });
      }
      if (!this._map.hasLayer(this._overlay)) {
        this._overlay.addTo(this._map);
      }

      if (this._onFrameChange) this._onFrameChange(tsForLabel, Math.round(idx) % n, n);
      this._updateTimeLabel(tsForLabel);
    },

    // Actualitza la caixa d'hora curta del panell de radar (al
    // costat del toggle). Sempre en format "HH:MM", hora local de
    // Madrid — mai el timestamp cru (p.ex. mai "2026-09-09T215000Z").
    _updateTimeLabel(timestamp) {
      if (!this._timeEl) return;
      this._timeEl.textContent = formatarHoraLocalMadrid(timestamp);
    },

    setTimeElement(el) {
      this._timeEl = el || null;
    },

    _startAnimation() {
      this._stopAnimation();
      const n = this._frames.length;
      if (n === 0) return;

      // Pas d'interpolacio: quants "trossos" fraccionaris hi ha
      // entre cada parell de frames reals. interpSteps=4 -> 5 passos
      // (0, 0.2, 0.4, 0.6, 0.8) abans d'arribar al seguent frame real.
      const stepsPerFrame = Math.max(1, RADAR_CONFIG.interpSteps + 1);
      const stepFraction = 1 / stepsPerFrame;

      // Interval entre CADA fotograma (real o intermedi), ajustat
      // per la velocitat seleccionada: mes speedMultiplier = mes
      // rapid = interval mes curt. Es divideix tambe per stepsPerFrame
      // perque el temps TOTAL per avançar d'un frame real al seguent
      // segueixi sent proporcional a animIntervalMs, encara que ara
      // hi hagi passos intermedis pel mig.
      const totalMsPerRealFrame = RADAR_CONFIG.animIntervalMs / this._speedMultiplier;
      const tickMs = Math.max(30, totalMsPerRealFrame * stepFraction);

      this._animTimer = setInterval(() => {
        this._animIndex = (this._animIndex + stepFraction) % n;
        this._showFrame(this._animIndex);
      }, tickMs);
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