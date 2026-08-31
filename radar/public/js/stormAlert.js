// ─────────────────────────────────────────────────────────────
// stormalert.js - Eines de dibuix d'alertes a l'estil NOAA/NWS
// Tempestes.cat
//
// v3 (setembre 2026): sistema d'edicio interactiva. Quan
// l'administrador clica al mapa, la forma es col·loca en mode
// EDICIO: apareixen anses per moure el centre, rotar, escalar i
// arrastrar cada vertex individualment. La forma nomes es guarda
// a Firebase quan es prem "Confirmar". Mentre hi ha una forma en
// edicio, no es pot iniciar-ne una altra (cal Confirmar o
// Cancel·lar primer). Tambe inclou una eina de "forma lliure":
// vas clicant punts consecutius per dibuixar un poligon fet a mida
// i el tanques amb el boto de tancar traç.
// ─────────────────────────────────────────────────────────────

(function (global) {

  // ─── Constants geometriques ───
  const KM_PER_DEG_LAT = 111.32;

  function toRad(deg) { return deg * Math.PI / 180; }
  function toDeg(rad) { return rad * 180 / Math.PI; }
  function kmPerDegLon(lat) { return KM_PER_DEG_LAT * Math.cos(toRad(lat)); }

  function offsetToLatLon(originLat, originLon, xKm, yKm) {
    return [
      originLat + yKm / KM_PER_DEG_LAT,
      originLon + xKm / kmPerDegLon(originLat),
    ];
  }

  function latLonToOffset(originLat, originLon, lat, lon) {
    return [
      (lon - originLon) * kmPerDegLon(originLat),
      (lat - originLat) * KM_PER_DEG_LAT,
    ];
  }

  function rotatePoint(x, y, rad) {
    return [
      x * Math.cos(rad) - y * Math.sin(rad),
      x * Math.sin(rad) + y * Math.cos(rad),
    ];
  }

  // ─── Plantilles de formes: vertexs base (en km, centrats a 0,0,
  // orientats "amunt") per a mida=1. Es multipliquen per la mida
  // real i es giren segons la rotacio abans de projectar-los. ───
  function shapeTemplate(shape, sizeKm, aspect) {
    const s = sizeKm;
    switch (shape) {
      case 'triangle':
        return [[0, -s / 2], [s * 0.433, s * 0.25], [-s * 0.433, s * 0.25]];
      case 'diamond':
        return [[0, -s / 2], [s * 0.35, 0], [0, s / 2], [-s * 0.35, 0]];
      case 'pentagon':
        return regularPolygon(5, s / 2, -90);
      case 'hexagon':
        return regularPolygon(6, s / 2, -30);
      case 'octagon':
        return regularPolygon(8, s / 2, -90 - 22.5);
      case 'star':
        return starPolygon(5, s / 2, s * 0.22, -90);
      case 'arrow':
        return arrowTemplate(s, aspect || 0.45);
      case 'rectangle': {
        const w = s / 2;
        const h = (aspect || 0.7) * s / 2;
        return [[-w, -h], [w, -h], [w, h], [-w, h]];
      }
      case 'storm':
        return stormTemplate(s, aspect || 0.55);
      case 'circle':
      default:
        return null; // el cercle es tracta a part (radi, no poligon)
    }
  }

  function regularPolygon(sides, radius, startDeg) {
    const pts = [];
    for (let i = 0; i < sides; i++) {
      const angle = toRad(startDeg + (i * 360 / sides));
      pts.push([radius * Math.cos(angle), radius * Math.sin(angle)]);
    }
    return pts;
  }

  function starPolygon(spikes, outerR, innerR, startDeg) {
    const pts = [];
    for (let i = 0; i < spikes * 2; i++) {
      const r = i % 2 === 0 ? outerR : innerR;
      const angle = toRad(startDeg + (i * 360 / (spikes * 2)));
      pts.push([r * Math.cos(angle), r * Math.sin(angle)]);
    }
    return pts;
  }

  function arrowTemplate(s, widthRatio) {
    const len = s;
    const halfW = s * widthRatio * 0.4;
    const headW = halfW * 2.1;
    const headLen = len * 0.38;
    const shaftLen = len - headLen;
    return [
      [-halfW, len / 2],
      [halfW, len / 2],
      [halfW, len / 2 - shaftLen],
      [headW, len / 2 - shaftLen],
      [0, -len / 2],
      [-headW, len / 2 - shaftLen],
      [-halfW, len / 2 - shaftLen],
    ];
  }

  function stormTemplate(lengthKm, widthRatio) {
    const widthKm = lengthKm * widthRatio;
    const bodyLen = lengthKm * 0.6;
    const tipLen = lengthKm * 0.4;
    const halfW = widthKm / 2;
    return [
      [-halfW, bodyLen], [halfW, bodyLen], [halfW, 0],
      [0, -tipLen], [-halfW, 0],
    ];
  }

  function projectTemplate(template, centerLat, centerLon, rotationDeg) {
    const rot = toRad(rotationDeg || 0);
    return template.map(([x, y]) => {
      const [rx, ry] = rotatePoint(x, y, rot);
      return offsetToLatLon(centerLat, centerLon, rx, ry);
    });
  }

  function buildShapeLatLngs(alert) {
    if (alert.customPoints && alert.customPoints.length >= 3) {
      return alert.customPoints.map(p => [p.lat, p.lon]);
    }
    const template = shapeTemplate(alert.shape, alert.sizeKm || 15, alert.aspect);
    if (!template) return null; // circle
    return projectTemplate(template, alert.lat, alert.lon, alert.rotation || 0);
  }

  // ─── Definicio de formes disponibles a la paleta ───
  const SHAPE_DEFS = [
    { id: 'circle', label: 'Cercle' },
    { id: 'rectangle', label: 'Rectangle' },
    { id: 'triangle', label: 'Triangle' },
    { id: 'diamond', label: 'Rombe' },
    { id: 'pentagon', label: 'Pentagon' },
    { id: 'hexagon', label: 'Hexagon' },
    { id: 'octagon', label: 'Octagon' },
    { id: 'star', label: 'Estrella' },
    { id: 'arrow', label: 'Fletxa' },
    { id: 'storm', label: 'Tempesta' },
    { id: 'freeform', label: 'Forma lliure' },
  ];

  const COLOR_DEFS = [
    '#ff3b30', '#ff9500', '#ffcc00', '#34c759',
    '#30b0c7', '#0a84ff', '#af52de', '#ffffff',
  ];

  // ─── Mòdul principal ───
  const StormAlert = {
    _map: null,
    _layers: [],
    _manualAlerts: [],
    _isAdmin: false,
    _currentShape: 'circle',
    _currentColor: '#ff3b30',
    _currentMessage: 'ALERTA',
    _alertsRef: null,
    _paletteCreated: false,
    _mapClickHandler: null,

    _editing: null,

    setAdminMode(enabled) {
      this._isAdmin = enabled;
      if (enabled) {
        this._createPalette();
      } else {
        this._cancelEditing();
        this._removePalette();
      }
      this._renderAll();
    },

    // ════════════════════════════════════════════════════════
    //  PALETA
    // ════════════════════════════════════════════════════════

    _createPalette() {
      if (this._paletteCreated) return;
      if (document.getElementById('drawPalette')) return;
      this._paletteCreated = true;

      const shapeButtons = SHAPE_DEFS.map(s =>
        `<button type="button" class="sa-shape-btn${s.id === this._currentShape ? ' active' : ''}" data-shape="${s.id}">${s.label}</button>`
      ).join('');

      const colorButtons = COLOR_DEFS.map(c =>
        `<button type="button" class="sa-color-btn${c === this._currentColor ? ' active' : ''}" data-color="${c}" style="background:${c};"></button>`
      ).join('');

      const palette = document.createElement('div');
      palette.id = 'drawPalette';
      palette.innerHTML = `
        <div id="paletteHeader" class="sa-header">
          <span>EINES DE DIBUIX</span>
          <button type="button" id="closePaletteBtn" class="sa-icon-btn" title="Tancar">&times;</button>
        </div>
        <div class="sa-body">

          <div class="sa-section-label">Forma</div>
          <div class="sa-shape-grid">${shapeButtons}</div>

          <div class="sa-section-label">Color</div>
          <div class="sa-color-row">${colorButtons}</div>

          <div class="sa-section-label">Missatge</div>
          <input type="text" id="msgInputPalette" class="sa-text-input" placeholder="TEXT ALERTA" value="${this._currentMessage}" maxlength="40" />

          <div class="sa-hint" id="drawStatusPalette">Selecciona una forma i clica al mapa per col·locar-la.</div>

          <div class="sa-divider"></div>

          <div class="sa-section-label">Alertes actives</div>
          <div id="alertListPalette" class="sa-alert-list"><div class="sa-empty">Cap alerta</div></div>

          <button type="button" id="clearAlertsPalette" class="sa-btn sa-btn-danger sa-btn-block">Eliminar totes les alertes</button>
        </div>

        <div id="editToolbar" class="sa-edit-toolbar" style="display:none;">
          <div class="sa-edit-title">EDITANT FORMA</div>
          <div class="sa-edit-hint">Arrossega el centre per moure-la, l'ansa lateral per rotar, l'ansa d'escala per canviar la mida, o cada vertex individualment.</div>
          <div class="sa-edit-row">
            <button type="button" id="confirmEditBtn" class="sa-btn sa-btn-primary">Confirmar</button>
            <button type="button" id="cancelEditBtn" class="sa-btn sa-btn-secondary">Cancel·lar</button>
          </div>
          <div class="sa-edit-row" id="freeformRow" style="display:none;">
            <button type="button" id="closeFreeformBtn" class="sa-btn sa-btn-secondary sa-btn-block">Tancar traçat</button>
          </div>
        </div>
      `;

      document.body.appendChild(palette);
      this._injectStyles();

      let isDragging = false, dx = 0, dy = 0;
      const header = document.getElementById('paletteHeader');
      header.addEventListener('mousedown', (e) => {
        if (e.target.id === 'closePaletteBtn') return;
        isDragging = true;
        const rect = palette.getBoundingClientRect();
        dx = e.clientX - rect.left;
        dy = e.clientY - rect.top;
        e.preventDefault();
      });
      document.addEventListener('mousemove', (e) => {
        if (!isDragging) return;
        let x = e.clientX - dx;
        let y = e.clientY - dy;
        const rect = palette.getBoundingClientRect();
        x = Math.max(0, Math.min(window.innerWidth - rect.width, x));
        y = Math.max(0, Math.min(window.innerHeight - rect.height, y));
        palette.style.left = x + 'px';
        palette.style.top = y + 'px';
        palette.style.bottom = 'auto';
        palette.style.right = 'auto';
      });
      document.addEventListener('mouseup', () => { isDragging = false; });

      document.getElementById('closePaletteBtn').addEventListener('click', () => {
        this._cancelEditing();
        palette.style.display = 'none';
        this._paletteCreated = false;
      });

      palette.querySelectorAll('.sa-shape-btn').forEach(btn => {
        btn.addEventListener('click', () => {
          if (this._editing) return;
          palette.querySelectorAll('.sa-shape-btn').forEach(b => b.classList.remove('active'));
          btn.classList.add('active');
          this._currentShape = btn.dataset.shape;
        });
      });

      palette.querySelectorAll('.sa-color-btn').forEach(btn => {
        btn.addEventListener('click', () => {
          palette.querySelectorAll('.sa-color-btn').forEach(b => b.classList.remove('active'));
          btn.classList.add('active');
          this._currentColor = btn.dataset.color;
          if (this._editing) {
            this._editing.color = this._currentColor;
            this._redrawEditingShape();
          }
        });
      });

      document.getElementById('msgInputPalette').addEventListener('input', (e) => {
        this._currentMessage = e.target.value.toUpperCase() || 'ALERTA';
        if (this._editing) this._editing.message = this._currentMessage;
      });

      document.getElementById('clearAlertsPalette').addEventListener('click', async () => {
        if (!confirm('Eliminar totes les alertes manuals?')) return;
        const ok = await this.clearAllManualAlerts();
        this._setStatus(ok ? 'Totes les alertes eliminades.' : 'Error en eliminar (revisa consola).');
      });

      document.getElementById('confirmEditBtn').addEventListener('click', () => this._confirmEditing());
      document.getElementById('cancelEditBtn').addEventListener('click', () => this._cancelEditing());
      document.getElementById('closeFreeformBtn').addEventListener('click', () => this._closeFreeformPath());

      this._updateAlertListUI();
    },

    _removePalette() {
      const palette = document.getElementById('drawPalette');
      if (palette) palette.remove();
      this._paletteCreated = false;
    },

    _setStatus(text) {
      const el = document.getElementById('drawStatusPalette');
      if (el) el.textContent = text;
    },

    _injectStyles() {
      if (document.getElementById('sa-styles')) return;
      const style = document.createElement('style');
      style.id = 'sa-styles';
      style.textContent = `
        #drawPalette {
          position: fixed;
          bottom: 100px;
          right: 20px;
          z-index: 10000;
          width: 270px;
          background: #10141d;
          border: 1px solid #2a3140;
          border-radius: 6px;
          box-shadow: 0 12px 34px rgba(0,0,0,0.55);
          font-family: 'Segoe UI', Tahoma, Geneva, Verdana, sans-serif;
          color: #d7dbe3;
        }
        .sa-header {
          padding: 7px 10px;
          background: #1a2030;
          border-bottom: 1px solid #2a3140;
          border-radius: 6px 6px 0 0;
          cursor: move;
          font-size: 11px;
          font-weight: 600;
          letter-spacing: 0.04em;
          color: #b9c0cc;
          display: flex;
          justify-content: space-between;
          align-items: center;
          user-select: none;
        }
        .sa-icon-btn {
          background: none;
          border: none;
          color: #7a8296;
          cursor: pointer;
          font-size: 15px;
          line-height: 1;
          padding: 0 3px;
        }
        .sa-icon-btn:hover { color: #d7dbe3; }
        .sa-body { padding: 10px; }
        .sa-section-label {
          font-size: 9.5px;
          font-weight: 600;
          letter-spacing: 0.05em;
          color: #7a8296;
          margin: 8px 0 4px 0;
          text-transform: uppercase;
        }
        .sa-section-label:first-child { margin-top: 0; }
        .sa-shape-grid {
          display: grid;
          grid-template-columns: repeat(3, 1fr);
          gap: 3px;
        }
        .sa-shape-btn {
          background: #1a2030;
          border: 1px solid #2a3140;
          color: #b9c0cc;
          padding: 5px 4px;
          border-radius: 3px;
          font-size: 10px;
          font-weight: 500;
          cursor: pointer;
          font-family: inherit;
        }
        .sa-shape-btn:hover { background: #232a3d; }
        .sa-shape-btn.active {
          background: #3d5afe;
          border-color: #3d5afe;
          color: #ffffff;
        }
        .sa-color-row {
          display: flex;
          gap: 5px;
          flex-wrap: wrap;
        }
        .sa-color-btn {
          width: 20px;
          height: 20px;
          border-radius: 3px;
          border: 2px solid #2a3140;
          cursor: pointer;
          padding: 0;
        }
        .sa-color-btn.active { border-color: #ffffff; }
        .sa-text-input {
          width: 100%;
          background: #1a2030;
          border: 1px solid #2a3140;
          border-radius: 3px;
          color: #eef1f6;
          padding: 6px 8px;
          font-size: 11px;
          font-family: inherit;
          text-transform: uppercase;
          font-weight: 600;
        }
        .sa-text-input:focus { outline: none; border-color: #3d5afe; }
        .sa-hint {
          font-size: 10px;
          color: #7a8296;
          margin-top: 8px;
          line-height: 1.5;
        }
        .sa-divider {
          height: 1px;
          background: #2a3140;
          margin: 10px 0;
        }
        .sa-alert-list {
          max-height: 110px;
          overflow-y: auto;
          margin-bottom: 8px;
        }
        .sa-empty {
          color: #55596a;
          font-size: 10px;
          text-align: center;
          padding: 8px 0;
        }
        .sa-alert-row {
          display: flex;
          align-items: center;
          gap: 6px;
          padding: 4px 0;
          border-bottom: 1px solid #1e2430;
          font-size: 10.5px;
        }
        .sa-alert-swatch {
          width: 8px;
          height: 8px;
          border-radius: 2px;
          flex-shrink: 0;
        }
        .sa-alert-name {
          flex: 1;
          color: #d7dbe3;
          overflow: hidden;
          text-overflow: ellipsis;
          white-space: nowrap;
        }
        .sa-alert-del {
          background: none;
          border: none;
          color: #6b7284;
          cursor: pointer;
          font-size: 13px;
          padding: 0 3px;
        }
        .sa-alert-del:hover { color: #ff5f5f; }
        .sa-btn {
          border: none;
          border-radius: 3px;
          font-size: 11px;
          font-weight: 600;
          padding: 7px 10px;
          cursor: pointer;
          font-family: inherit;
        }
        .sa-btn-block { width: 100%; }
        .sa-btn-danger { background: #3a1f22; color: #ff8080; }
        .sa-btn-danger:hover { background: #4a262a; }
        .sa-btn-primary { background: #3d5afe; color: #ffffff; flex: 1; }
        .sa-btn-primary:hover { background: #5069ff; }
        .sa-btn-secondary { background: #1a2030; color: #b9c0cc; border: 1px solid #2a3140; flex: 1; }
        .sa-btn-secondary:hover { background: #232a3d; }
        .sa-edit-toolbar {
          border-top: 1px solid #2a3140;
          padding: 10px;
          background: #151a26;
          border-radius: 0 0 6px 6px;
        }
        .sa-edit-title {
          font-size: 10px;
          font-weight: 700;
          letter-spacing: 0.06em;
          color: #3d5afe;
          margin-bottom: 4px;
        }
        .sa-edit-hint {
          font-size: 9.5px;
          color: #7a8296;
          line-height: 1.5;
          margin-bottom: 8px;
        }
        .sa-edit-row {
          display: flex;
          gap: 6px;
          margin-top: 6px;
        }
        .sa-edit-row:first-of-type { margin-top: 0; }
        .noaa-tooltip {
          background: #10141d;
          border: 1px solid #2a3140;
          color: #eef1f6;
          font-family: 'Segoe UI', Tahoma, sans-serif;
          font-size: 11px;
          font-weight: 600;
          padding: 3px 7px;
          border-radius: 3px;
          box-shadow: 0 4px 12px rgba(0,0,0,0.4);
        }
        .noaa-tooltip::before { display: none; }
      `;
      document.head.appendChild(style);
    },

    // ════════════════════════════════════════════════════════
    //  FIREBASE
    // ════════════════════════════════════════════════════════

    setAlertsRef(ref) {
      this._alertsRef = ref;
      this._listenForAlerts();
    },

    _listenForAlerts() {
      if (!this._alertsRef) return;
      this._alertsRef.off();
      this._alertsRef.on('value', (snapshot) => {
        const data = snapshot.val();
        this._manualAlerts = data
          ? Object.entries(data).map(([key, alert]) => ({ id: key, ...alert }))
          : [];
        this._renderAll();
        this._updateAlertListUI();
      });
    },

    _updateAlertListUI() {
      const list = document.getElementById('alertListPalette');
      if (!list) return;
      if (this._manualAlerts.length === 0) {
        list.innerHTML = '<div class="sa-empty">Cap alerta</div>';
        return;
      }
      list.innerHTML = this._manualAlerts.map(a => `
        <div class="sa-alert-row">
          <span class="sa-alert-swatch" style="background:${a.color || '#ff3b30'};"></span>
          <span class="sa-alert-name">${(a.message || 'ALERTA')}</span>
          <button type="button" class="sa-alert-del" data-id="${a.id}">&times;</button>
        </div>
      `).join('');
      list.querySelectorAll('.sa-alert-del').forEach(btn => {
        btn.addEventListener('click', () => {
          if (confirm('Eliminar aquesta alerta?')) this.removeManualAlert(btn.dataset.id);
        });
      });
    },

    async addManualAlert(alertData) {
      if (!this._isAdmin) { console.warn('[StormAlert] no ets admin'); return false; }
      if (!this._alertsRef) { console.error('[StormAlert] _alertsRef no assignat.'); return false; }
      try {
        const newAlert = {
          lat: alertData.lat,
          lon: alertData.lon,
          shape: alertData.shape || 'circle',
          color: alertData.color || '#ff3b30',
          fillOpacity: alertData.fillOpacity ?? 0.18,
          message: alertData.message || 'ALERTA',
          timestamp: Date.now(),
          createdBy: alertData.createdBy || 'admin',
          lineWidth: alertData.lineWidth || 2.5,
          rotation: alertData.rotation || 0,
          sizeKm: alertData.sizeKm || 15,
          radiusKm: alertData.radiusKm || alertData.sizeKm || 15,
          aspect: alertData.aspect || null,
          customPoints: alertData.customPoints || null,
        };
        const ref = await this._alertsRef.push(newAlert);
        return ref.key;
      } catch (err) {
        console.error('[StormAlert] Error afegint alerta:', err);
        return false;
      }
    },

    async removeManualAlert(alertId) {
      if (!this._isAdmin || !this._alertsRef) return false;
      try {
        await this._alertsRef.child(alertId).remove();
        return true;
      } catch (err) {
        console.error('[StormAlert] Error eliminant alerta:', err);
        return false;
      }
    },

    async clearAllManualAlerts() {
      if (!this._isAdmin || !this._alertsRef) return false;
      try {
        await this._alertsRef.set(null);
        return true;
      } catch (err) {
        console.error('[StormAlert] Error eliminant totes les alertes:', err);
        return false;
      }
    },

    async refresh() {
      if (this._alertsRef) this._listenForAlerts();
      this._renderAll();
      return true;
    },

    // ════════════════════════════════════════════════════════
    //  RENDER D'ALERTES CONFIRMADES
    // ════════════════════════════════════════════════════════

    render() { this._renderManualAlerts(); },

    _renderManualAlerts() {
      this._clearLayers();
      if (!this._map || this._manualAlerts.length === 0) return;

      this._manualAlerts.forEach((alert) => {
        const color = alert.color || '#ff3b30';
        const fillOpacity = alert.fillOpacity ?? 0.18;
        const lineWidth = alert.lineWidth || 2.5;
        let layer;

        try {
          if (alert.shape === 'circle' && !alert.customPoints) {
            layer = L.circle([alert.lat, alert.lon], {
              radius: (alert.radiusKm || alert.sizeKm || 15) * 1000,
              color, weight: lineWidth, opacity: 0.95, fillColor: color, fillOpacity, interactive: true,
            }).addTo(this._map);
          } else {
            const latlngs = buildShapeLatLngs(alert);
            if (!latlngs) return;
            layer = L.polygon(latlngs, {
              color, weight: lineWidth, opacity: 0.95, fillColor: color, fillOpacity, interactive: true,
            }).addTo(this._map);
          }
        } catch (err) {
          console.error('[StormAlert] Error renderitzant alerta:', err);
          return;
        }

        layer.bindTooltip(alert.message || 'ALERTA', {
          direction: 'top', offset: [0, -6], className: 'noaa-tooltip', permanent: false,
        });

        if (this._isAdmin) {
          layer.on('click', (e) => {
            L.DomEvent.stopPropagation(e);
            if (this._editing) return;
            if (confirm('Eliminar aquesta alerta?\n"' + alert.message + '"')) {
              this.removeManualAlert(alert.id);
            }
          });
        }

        this._layers.push(layer);
      });
    },

    _renderAll() {
      this._clearLayers();
      if (!this._map) return;
      this._renderManualAlerts();
    },

    _clearLayers() {
      this._layers.forEach((l) => { if (this._map && this._map.hasLayer(l)) this._map.removeLayer(l); });
      this._layers = [];
    },

    // ════════════════════════════════════════════════════════
    //  EDICIO INTERACTIVA
    // ════════════════════════════════════════════════════════

    _startEditing(lat, lon) {
      if (this._editing) return;

      if (this._currentShape === 'freeform') {
        this._startFreeform(lat, lon);
        return;
      }

      const sizeKm = 16;
      this._editing = {
        shape: this._currentShape,
        color: this._currentColor,
        message: this._currentMessage,
        lat, lon,
        sizeKm,
        rotation: 0,
        aspect: this._currentShape === 'rectangle' ? 0.7 : (this._currentShape === 'arrow' ? 0.45 : (this._currentShape === 'storm' ? 0.55 : null)),
        customVertices: null,
        editLayer: null,
        vertexHandles: [],
        centerHandle: null,
        rotateHandle: null,
        scaleHandle: null,
        freeformPoints: null,
        freeformMarkers: [],
        freeformLine: null,
      };

      this._map.getContainer().style.cursor = '';
      this._showEditToolbar(false);
      this._redrawEditingShape();
      this._setStatus('Editant forma. Confirma per desar-la.');
    },

    _redrawEditingShape() {
      const ed = this._editing;
      if (!ed || !this._map) return;

      this._clearEditLayers();

      const color = ed.color;

      if (ed.shape === 'circle') {
        ed.editLayer = L.circle([ed.lat, ed.lon], {
          radius: (ed.sizeKm / 2) * 1000,
          color, weight: 2.5, opacity: 0.95, fillColor: color, fillOpacity: 0.18,
          interactive: false, dashArray: '4 3',
        }).addTo(this._map);
        this._addCenterHandle();
        this._addScaleHandle(ed.sizeKm / 2);
        return;
      }

      let localVerts;
      if (ed.customVertices) {
        localVerts = ed.customVertices;
      } else {
        localVerts = shapeTemplate(ed.shape, ed.sizeKm, ed.aspect);
        const rot = toRad(ed.rotation || 0);
        localVerts = localVerts.map(([x, y]) => rotatePoint(x, y, rot));
      }

      const latlngs = localVerts.map(([x, y]) => offsetToLatLon(ed.lat, ed.lon, x, y));
      ed.editLayer = L.polygon(latlngs, {
        color, weight: 2.5, opacity: 0.95, fillColor: color, fillOpacity: 0.18,
        interactive: false, dashArray: '4 3',
      }).addTo(this._map);

      this._addCenterHandle();
      this._addRotateHandle(localVerts);
      localVerts.forEach((v, i) => this._addVertexHandle(v, i));
    },

    _clearEditLayers() {
      const ed = this._editing;
      if (!ed || !this._map) return;
      if (ed.editLayer && this._map.hasLayer(ed.editLayer)) this._map.removeLayer(ed.editLayer);
      ed.vertexHandles.forEach(h => { if (this._map.hasLayer(h)) this._map.removeLayer(h); });
      ed.vertexHandles = [];
      if (ed.centerHandle && this._map.hasLayer(ed.centerHandle)) this._map.removeLayer(ed.centerHandle);
      if (ed.rotateHandle && this._map.hasLayer(ed.rotateHandle)) this._map.removeLayer(ed.rotateHandle);
      if (ed.scaleHandle && this._map.hasLayer(ed.scaleHandle)) this._map.removeLayer(ed.scaleHandle);
      ed.centerHandle = null;
      ed.rotateHandle = null;
      ed.scaleHandle = null;
    },

    _handleIcon(kind) {
      const styles = {
        center: 'width:14px;height:14px;border-radius:50%;background:#3d5afe;border:2px solid #ffffff;box-shadow:0 0 0 1px #1a2030;cursor:move;',
        vertex: 'width:10px;height:10px;border-radius:2px;background:#ffffff;border:2px solid #3d5afe;cursor:pointer;',
        rotate: 'width:12px;height:12px;border-radius:50%;background:#ffcc00;border:2px solid #10141d;cursor:alias;',
        scale: 'width:12px;height:12px;border-radius:2px;background:#34c759;border:2px solid #10141d;cursor:nwse-resize;',
      };
      return L.divIcon({ className: '', html: `<div style="${styles[kind]}"></div>`, iconSize: [14, 14], iconAnchor: [7, 7] });
    },

    _addCenterHandle() {
      const ed = this._editing;
      const marker = L.marker([ed.lat, ed.lon], { icon: this._handleIcon('center'), draggable: true, zIndexOffset: 1000 }).addTo(this._map);
      marker.on('drag', (e) => {
        const newPos = e.target.getLatLng();
        ed.lat = newPos.lat;
        ed.lon = newPos.lng;
        this._redrawEditingShape();
      });
      ed.centerHandle = marker;
    },

    _addRotateHandle(localVerts) {
      const ed = this._editing;
      const topY = Math.min(...localVerts.map(v => v[1])) - ed.sizeKm * 0.28;
      const pos = offsetToLatLon(ed.lat, ed.lon, 0, topY);
      const marker = L.marker(pos, { icon: this._handleIcon('rotate'), draggable: true, zIndexOffset: 1001 }).addTo(this._map);
      marker.on('drag', (e) => {
        const p = e.target.getLatLng();
        const [dx, dy] = latLonToOffset(ed.lat, ed.lon, p.lat, p.lng);
        const angle = toDeg(Math.atan2(dx, dy));
        ed.rotation = angle + 180;
        if (ed.customVertices) {
          ed.customVertices = null;
        }
        this._redrawEditingShape();
      });
      ed.rotateHandle = marker;
    },

    _addScaleHandle(radiusKm) {
      const ed = this._editing;
      const pos = offsetToLatLon(ed.lat, ed.lon, radiusKm * 0.707, radiusKm * 0.707);
      const marker = L.marker(pos, { icon: this._handleIcon('scale'), draggable: true, zIndexOffset: 1001 }).addTo(this._map);
      marker.on('drag', (e) => {
        const p = e.target.getLatLng();
        const [dx, dy] = latLonToOffset(ed.lat, ed.lon, p.lat, p.lng);
        const dist = Math.sqrt(dx * dx + dy * dy);
        ed.sizeKm = Math.max(2, dist * 2 / 1.414);
        this._redrawEditingShape();
      });
      ed.scaleHandle = marker;
    },

    _addVertexHandle(localPoint, index) {
      const ed = this._editing;
      const pos = offsetToLatLon(ed.lat, ed.lon, localPoint[0], localPoint[1]);
      const marker = L.marker(pos, { icon: this._handleIcon('vertex'), draggable: true, zIndexOffset: 1000 }).addTo(this._map);
      marker.on('drag', (e) => {
        const p = e.target.getLatLng();
        const [dx, dy] = latLonToOffset(ed.lat, ed.lon, p.lat, p.lng);
        if (!ed.customVertices) {
          const template = shapeTemplate(ed.shape, ed.sizeKm, ed.aspect);
          const rot = toRad(ed.rotation || 0);
          ed.customVertices = template.map(([x, y]) => rotatePoint(x, y, rot));
        }
        ed.customVertices[index] = [dx, dy];
        this._redrawEditingShape();
      });
      ed.vertexHandles.push(marker);
    },

    // ── Forma lliure: clic a clic ──
    _startFreeform(lat, lon) {
      this._editing = {
        shape: 'freeform',
        color: this._currentColor,
        message: this._currentMessage,
        lat, lon,
        freeformPoints: [[lat, lon]],
        freeformMarkers: [],
        freeformLine: null,
        editLayer: null,
        vertexHandles: [],
        centerHandle: null,
        rotateHandle: null,
        scaleHandle: null,
      };
      this._showEditToolbar(true);
      this._redrawFreeform();
      this._setStatus('Clica per afegir punts. Tanca el traçat quan acabis.');
    },

    _addFreeformPoint(lat, lon) {
      const ed = this._editing;
      if (!ed || ed.shape !== 'freeform') return;
      ed.freeformPoints.push([lat, lon]);
      this._redrawFreeform();
    },

    _redrawFreeform() {
      const ed = this._editing;
      if (!ed || !this._map) return;

      if (ed.freeformLine && this._map.hasLayer(ed.freeformLine)) this._map.removeLayer(ed.freeformLine);
      ed.freeformMarkers.forEach(m => { if (this._map.hasLayer(m)) this._map.removeLayer(m); });
      ed.freeformMarkers = [];

      if (ed.freeformPoints.length >= 2) {
        ed.freeformLine = L.polyline(ed.freeformPoints, {
          color: ed.color, weight: 2.5, opacity: 0.95, dashArray: '4 3', interactive: false,
        }).addTo(this._map);
      }

      ed.freeformPoints.forEach(([lat, lon], i) => {
        const marker = L.marker([lat, lon], { icon: this._handleIcon('vertex'), draggable: true, zIndexOffset: 1000 }).addTo(this._map);
        marker.on('drag', (e) => {
          const p = e.target.getLatLng();
          ed.freeformPoints[i] = [p.lat, p.lng];
          this._redrawFreeformLineOnly();
        });
        ed.freeformMarkers.push(marker);
      });
    },

    _redrawFreeformLineOnly() {
      const ed = this._editing;
      if (!ed || !this._map) return;
      if (ed.freeformLine && this._map.hasLayer(ed.freeformLine)) this._map.removeLayer(ed.freeformLine);
      if (ed.freeformPoints.length >= 2) {
        ed.freeformLine = L.polyline(ed.freeformPoints, {
          color: ed.color, weight: 2.5, opacity: 0.95, dashArray: '4 3', interactive: false,
        }).addTo(this._map);
      }
    },

    _closeFreeformPath() {
      const ed = this._editing;
      if (!ed || ed.shape !== 'freeform') return;
      if (ed.freeformPoints.length < 3) {
        this._setStatus('Cal almenys 3 punts per tancar una forma lliure.');
        return;
      }
      if (ed.freeformLine && this._map.hasLayer(ed.freeformLine)) this._map.removeLayer(ed.freeformLine);
      ed.freeformLine = L.polygon(ed.freeformPoints, {
        color: ed.color, weight: 2.5, opacity: 0.95, fillColor: ed.color, fillOpacity: 0.18,
        dashArray: '4 3', interactive: false,
      }).addTo(this._map);
      ed.closed = true;
      this._showEditToolbar(false, true);
      this._setStatus('Ajusta els vertexs si cal i confirma per desar-la.');
    },

    _showEditToolbar(isFreeform, freeformClosed) {
      const toolbar = document.getElementById('editToolbar');
      const freeformRow = document.getElementById('freeformRow');
      const confirmBtn = document.getElementById('confirmEditBtn');
      if (!toolbar) return;
      toolbar.style.display = 'block';
      if (freeformRow) freeformRow.style.display = (isFreeform && !freeformClosed) ? 'flex' : 'none';
      if (confirmBtn) confirmBtn.style.display = (isFreeform && !freeformClosed) ? 'none' : 'block';
      this._setPaletteInteractionLocked(true);
    },

    _hideEditToolbar() {
      const toolbar = document.getElementById('editToolbar');
      if (toolbar) toolbar.style.display = 'none';
      this._setPaletteInteractionLocked(false);
    },

    _setPaletteInteractionLocked(locked) {
      document.querySelectorAll('.sa-shape-btn').forEach(b => {
        b.style.opacity = locked ? '0.4' : '1';
        b.style.pointerEvents = locked ? 'none' : 'auto';
      });
    },

    async _confirmEditing() {
      const ed = this._editing;
      if (!ed) return;

      let payload;
      if (ed.shape === 'freeform') {
        if (!ed.closed || ed.freeformPoints.length < 3) {
          this._setStatus('Tanca el traçat abans de confirmar.');
          return;
        }
        const pts = ed.freeformPoints.map(([lat, lon]) => ({ lat, lon }));
        const centroid = pts.reduce((acc, p) => [acc[0] + p.lat / pts.length, acc[1] + p.lon / pts.length], [0, 0]);
        payload = {
          lat: centroid[0], lon: centroid[1],
          shape: 'freeform',
          color: ed.color,
          message: ed.message,
          customPoints: pts,
        };
      } else if (ed.shape === 'circle') {
        payload = {
          lat: ed.lat, lon: ed.lon,
          shape: 'circle',
          color: ed.color,
          message: ed.message,
          radiusKm: ed.sizeKm / 2,
          sizeKm: ed.sizeKm,
        };
      } else {
        let customPoints = null;
        if (ed.customVertices) {
          customPoints = ed.customVertices.map(([x, y]) => {
            const [lat, lon] = offsetToLatLon(ed.lat, ed.lon, x, y);
            return { lat, lon };
          });
        }
        payload = {
          lat: ed.lat, lon: ed.lon,
          shape: ed.shape,
          color: ed.color,
          message: ed.message,
          sizeKm: ed.sizeKm,
          rotation: ed.rotation,
          aspect: ed.aspect,
          customPoints,
        };
      }

      const result = await this.addManualAlert(payload);
      this._setStatus(result ? 'Alerta desada.' : 'Error en desar (revisa consola).');
      this._teardownEditing();
    },

    _cancelEditing() {
      if (!this._editing) return;
      this._teardownEditing();
      this._setStatus('Edicio cancel·lada.');
    },

    _teardownEditing() {
      const ed = this._editing;
      if (!ed || !this._map) { this._editing = null; return; }

      this._clearEditLayers();
      if (ed.freeformLine && this._map.hasLayer(ed.freeformLine)) this._map.removeLayer(ed.freeformLine);
      if (ed.freeformMarkers) ed.freeformMarkers.forEach(m => { if (this._map.hasLayer(m)) this._map.removeLayer(m); });

      this._editing = null;
      this._hideEditToolbar();
    },

    // ════════════════════════════════════════════════════════
    //  ATTACH / DETACH
    // ════════════════════════════════════════════════════════

    attach(map) {
      this._map = map;

      if (this._mapClickHandler) this._map.off('click', this._mapClickHandler);

      this._mapClickHandler = (e) => {
        if (!this._isAdmin) return;

        if (this._editing && this._editing.shape === 'freeform' && !this._editing.closed) {
          this._addFreeformPoint(e.latlng.lat, e.latlng.lng);
          return;
        }

        if (this._editing) return;

        this._startEditing(e.latlng.lat, e.latlng.lng);
      };

      this._map.on('click', this._mapClickHandler);

      if (this._manualAlerts.length > 0) this.render();
    },

    detach() {
      this._teardownEditing();
      this._clearLayers();
      if (this._map && this._mapClickHandler) {
        this._map.off('click', this._mapClickHandler);
        this._mapClickHandler = null;
      }
      if (this._alertsRef) this._alertsRef.off();
      this._removePalette();
    },

    getManualAlerts() { return this._manualAlerts; },
  };

  global.StormAlert = StormAlert;

})(window);