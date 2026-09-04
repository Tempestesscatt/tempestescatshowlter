// sfc-particles.js - Partícules de vent animades (direcció real, U/V) sobre el mapa Leaflet
// Depèn de sfc.js: reutilitza window.SFC per obtenir/cachejar els payloads (su, sv).
// Capa Leaflet real (es mou i fa zoom amb el mapa), canvas sincronitzat cada frame de pan/zoom.

(function() {
  'use strict';

  // ─── CONFIGURACIÓ ───────────────────────────────────────────
  const PART_CONFIG = {
    baseUrl: 'dades_sfc/',
    numParticles: 30000,      // SEMPRE 30000 partícules
    fadeAlpha: 0.92,          // Esteles més curtes per millor rendiment
    speedFactor: 0.56,        // factor d'escala px/frame per m/s de vent
    lineWidth: 1.2,
    maxAge: 60,               // frames abans de regenerar una partícula
    defaultColor: '#000000',
    refreshInterval: 5 * 60 * 1000,
  };

  // ─── ESTAT ──────────────────────────────────────────────────
  let particlesEnabled = false;
  let particleColor = PART_CONFIG.defaultColor;
  let windPayloadCache = {};
  let activeWindHour = null;
  let uField = null, vField = null, gridLats = null, gridLons = null;
  let particles = [];
  let animFrameId = null;
  let particlesLoading = false;
  let refreshTimer = null;

  // ─── CAPA LEAFLET CUSTOM ────────────────────────────────────

  const ParticleLayer = L.Layer.extend({
    onAdd: function(map) {
      this._map = map;
      this._canvas = L.DomUtil.create('canvas', 'sfc-particle-canvas');
      this._canvas.style.position = 'absolute';
      this._canvas.style.pointerEvents = 'none';
      this._canvas.style.zIndex = 450;

      const pane = map.getPane('overlayPane');
      pane.appendChild(this._canvas);

      map.on('move zoom resize viewreset', this._reset, this);
      this._reset();
      return this;
    },
    onRemove: function(map) {
      L.DomUtil.remove(this._canvas);
      map.off('move zoom resize viewreset', this._reset, this);
    },
    _reset: function() {
      const map = this._map;
      const size = map.getSize();
      const topLeft = map.containerPointToLayerPoint([0, 0]);
      L.DomUtil.setPosition(this._canvas, topLeft);
      this._canvas.width = size.x;
      this._canvas.height = size.y;
      
      // SEMPRE mantenir 30000 partícules
      // Si no hi ha partícules, crear-les totes
      if (particles.length === 0) {
        seedParticles();
      }
      // Si n'hi ha menys de 30000, afegir les que falten
      else if (particles.length < PART_CONFIG.numParticles) {
        const needed = PART_CONFIG.numParticles - particles.length;
        for (let i = 0; i < needed; i++) {
          const p = randomLatLngInBounds();
          if (p) {
            particles.push({
              lat: p.lat,
              lon: p.lon,
              age: Math.random() * PART_CONFIG.maxAge
            });
          }
        }
      }
      // Si n'hi ha més de 30000, eliminar les sobrants
      else if (particles.length > PART_CONFIG.numParticles) {
        particles.length = PART_CONFIG.numParticles;
      }
    },
    getCanvas: function() {
      return this._canvas;
    }
  });

  let particleLayer = null;

  // ─── UTILITATS DE DADES ─────────────────────────────────────

  async function fetchWindPayload(hour) {
    if (window.SFC && window.SFC._getRawPayload) {
      const cached = window.SFC._getRawPayload(hour);
      if (cached) return cached;
    }
    if (windPayloadCache[hour]) return windPayloadCache[hour];

    const url = PART_CONFIG.baseUrl + 'sfc_' + String(hour).padStart(2, '0') + '.msgpack.gz';
    try {
      const response = await fetch(url, { cache: 'no-store' });
      if (!response.ok) return null;
      const compressed = new Uint8Array(await response.arrayBuffer());
      if (typeof pako === 'undefined' || typeof msgpack === 'undefined') {
        throw new Error('pako/msgpack no carregats');
      }
      const decompressed = pako.inflate(compressed);
      const data = msgpack.decode(decompressed);
      windPayloadCache[hour] = data;
      return data;
    } catch (err) {
      console.warn('PART: Error carregant vent hora ' + hour + ':', err.message);
      return null;
    }
  }

  function getCurrentUtcHour() {
    return new Date().getUTCHours();
  }

  function buildWindField(payload) {
    const coords = payload.coordenadas;
    const vars = payload.variables;
    if (!coords || !vars || !vars.su || !vars.sv) {
      console.warn('PART: Payload sense su/sv');
      return false;
    }
    gridLats = coords.lat;
    gridLons = coords.lon;
    uField = vars.su.datos;
    vField = vars.sv.datos;
    
    // DEBUG: Mostrar rang de valors del vent
    const uMin = Math.min(...uField.filter(v => v !== null && v !== undefined));
    const uMax = Math.max(...uField.filter(v => v !== null && v !== undefined));
    const vMin = Math.min(...vField.filter(v => v !== null && v !== undefined));
    const vMax = Math.max(...vField.filter(v => v !== null && v !== undefined));
    console.log(`PART: Vent U: ${uMin.toFixed(2)} a ${uMax.toFixed(2)} m/s`);
    console.log(`PART: Vent V: ${vMin.toFixed(2)} a ${vMax.toFixed(2)} m/s`);
    
    return true;
  }

  function sampleWind(lat, lon) {
    if (!uField || !vField || !gridLats || !gridLons) return null;
    const nLat = gridLats.length;
    const nLon = gridLons.length;
    if (lat < gridLats[0] || lat > gridLats[nLat - 1] || lon < gridLons[0] || lon > gridLons[nLon - 1]) {
      return null;
    }
    
    let iLat = Math.floor((lat - gridLats[0]) / (gridLats[nLat - 1] - gridLats[0]) * (nLat - 1));
    let iLon = Math.floor((lon - gridLons[0]) / (gridLons[nLon - 1] - gridLons[0]) * (nLon - 1));
    iLat = Math.max(0, Math.min(nLat - 2, iLat));
    iLon = Math.max(0, Math.min(nLon - 2, iLon));

    const idx00 = iLat * nLon + iLon;
    const idx10 = iLat * nLon + (iLon + 1);
    const idx01 = (iLat + 1) * nLon + iLon;
    const idx11 = (iLat + 1) * nLon + (iLon + 1);

    const u00 = uField[idx00], u10 = uField[idx10], u01 = uField[idx01], u11 = uField[idx11];
    const v00 = vField[idx00], v10 = vField[idx10], v01 = vField[idx01], v11 = vField[idx11];
    if ([u00, u10, u01, u11, v00, v10, v01, v11].some(v => v === null || v === undefined)) {
      return null;
    }

    const tLat = (lat - gridLats[iLat]) / (gridLats[iLat + 1] - gridLats[iLat]);
    const tLon = (lon - gridLons[iLon]) / (gridLons[iLon + 1] - gridLons[iLon]);

    const u0 = u00 + (u10 - u00) * tLon;
    const u1 = u01 + (u11 - u01) * tLon;
    const u = u0 + (u1 - u0) * tLat;

    const v0 = v00 + (v10 - v00) * tLon;
    const v1 = v01 + (v11 - v01) * tLon;
    const v = v0 + (v1 - v0) * tLat;

    return { u, v };
  }

  // ─── PARTÍCULES ─────────────────────────────────────────────

  function randomLatLngInBounds() {
    if (!gridLats || !gridLons) return null;
    const lat = gridLats[0] + Math.random() * (gridLats[gridLats.length - 1] - gridLats[0]);
    const lon = gridLons[0] + Math.random() * (gridLons[gridLons.length - 1] - gridLons[0]);
    return { lat, lon };
  }

  function seedParticles() {
    if (!particleLayer || !gridLats || !gridLons) return;
    particles = [];
    for (let i = 0; i < PART_CONFIG.numParticles; i++) {
      const p = randomLatLngInBounds();
      if (!p) continue;
      particles.push({
        lat: p.lat,
        lon: p.lon,
        age: Math.random() * PART_CONFIG.maxAge
      });
    }
    console.log(`PART: ${particles.length} partícules inicialitzades (sempre 30000)`);
  }

  function stepParticle(p) {
    const wind = sampleWind(p.lat, p.lon);
    p.age++;
    if (!wind || p.age > PART_CONFIG.maxAge) {
      const np = randomLatLngInBounds();
      if (np) {
        p.lat = np.lat;
        p.lon = np.lon;
      }
      p.age = 0;
      p.hasPrev = false;
      return;
    }
    
    const metersPerDegLat = 111320;
    const metersPerDegLon = 111320 * Math.cos(p.lat * Math.PI / 180);
    const dtSeconds = 60 * PART_CONFIG.speedFactor;
    
    p.prevLat = p.lat;
    p.prevLon = p.lon;
    p.lat += (wind.v * dtSeconds) / metersPerDegLat;
    p.lon += (wind.u * dtSeconds) / metersPerDegLon;
    p.hasPrev = true;
    
    // Si surt fora dels límits de la graella, regenerar
    if (p.lat < gridLats[0] || p.lat > gridLats[gridLats.length - 1] ||
        p.lon < gridLons[0] || p.lon > gridLons[gridLons.length - 1]) {
      const np = randomLatLngInBounds();
      if (np) {
        p.lat = np.lat;
        p.lon = np.lon;
      }
      p.age = 0;
      p.hasPrev = false;
    }
  }

  function animate() {
    if (!particlesEnabled || !particleLayer || !window.map) {
      animFrameId = null;
      return;
    }
    
    const canvas = particleLayer.getCanvas();
    const ctx = canvas.getContext('2d');
    const map = window.map;
    
    // Esvaïm el frame anterior
    ctx.globalCompositeOperation = 'destination-in';
    ctx.fillStyle = 'rgba(0,0,0,' + PART_CONFIG.fadeAlpha + ')';
    ctx.fillRect(0, 0, canvas.width, canvas.height);
    ctx.globalCompositeOperation = 'source-over';
    
    ctx.strokeStyle = particleColor;
    ctx.lineWidth = PART_CONFIG.lineWidth;
    ctx.beginPath();
    
    for (let i = 0; i < particles.length; i++) {
      const p = particles[i];
      stepParticle(p);
      
      if (!p.hasPrev) continue;
      
      const startPt = map.latLngToContainerPoint([p.prevLat, p.prevLon]);
      const endPt = map.latLngToContainerPoint([p.lat, p.lon]);
      
      // Saltar línies massa llargues (canvis de viewport)
      const dx = endPt.x - startPt.x;
      const dy = endPt.y - startPt.y;
      const dist = Math.sqrt(dx*dx + dy*dy);
      if (dist > 200) continue;
      
      // Dibuixar només si està dins o prop del canvas
      if (startPt.x < -50 || startPt.x > canvas.width + 50 ||
          startPt.y < -50 || startPt.y > canvas.height + 50) continue;
      
      ctx.moveTo(startPt.x, startPt.y);
      ctx.lineTo(endPt.x, endPt.y);
    }
    ctx.stroke();
    
    animFrameId = requestAnimationFrame(animate);
  }

  // ─── CARREGA / ACTIVACIÓ ────────────────────────────────────

  async function loadWindField(hour) {
    if (particlesLoading) return false;
    particlesLoading = true;
    try {
      const payload = await fetchWindPayload(hour);
      if (!payload) {
        particlesLoading = false;
        return false;
      }
      const ok = buildWindField(payload);
      if (ok) {
        activeWindHour = hour;
        seedParticles();
      }
      particlesLoading = false;
      return ok;
    } catch (err) {
      console.error('PART: Error carregant camp de vent:', err);
      particlesLoading = false;
      return false;
    }
  }

  async function toggleParticles(enable) {
    particlesEnabled = enable;
    const btn = document.getElementById('particles-toggle-btn');
    
    if (!enable) {
      if (animFrameId) {
        cancelAnimationFrame(animFrameId);
        animFrameId = null;
      }
      if (particleLayer && window.map && window.map.hasLayer(particleLayer)) {
        window.map.removeLayer(particleLayer);
      }
      if (btn) {
        btn.textContent = 'VENT';
        btn.style.borderColor = 'rgba(79,195,247,0.3)';
        btn.style.background = 'rgba(79,195,247,0.1)';
        btn.classList.remove('active');
      }
      console.log('PART: Desactivat');
      return;
    }
    
    if (!window.map) {
      console.warn('PART: window.map no disponible');
      particlesEnabled = false;
      return;
    }
    
    if (btn) {
      btn.textContent = 'VENT...';
    }
    
    const hour = getCurrentUtcHour();
    const ok = await loadWindField(hour);
    if (!ok) {
      console.warn('PART: No s\'ha pogut carregar el camp de vent');
      particlesEnabled = false;
      if (btn) {
        btn.textContent = 'VENT';
      }
      return;
    }
    
    if (!particleLayer) {
      particleLayer = new ParticleLayer();
    }
    if (!window.map.hasLayer(particleLayer)) {
      particleLayer.addTo(window.map);
    }
    
    if (btn) {
      btn.textContent = 'VENT ON';
      btn.style.borderColor = '#4fc3f7';
      btn.style.background = 'rgba(79,195,247,0.2)';
      btn.classList.add('active');
    }
    
    if (!animFrameId) {
      animFrameId = requestAnimationFrame(animate);
    }
    console.log('PART: Activat (hora ' + hour + ') amb 30000 partícules fixes');
  }

  function setParticleColor(color) {
    particleColor = color;
  }

  async function refreshParticles() {
    if (!particlesEnabled) return;
    const hour = getCurrentUtcHour();
    if (hour !== activeWindHour) {
      await loadWindField(hour);
    }
  }

  function startAutoRefresh() {
    if (refreshTimer) clearInterval(refreshTimer);
    refreshTimer = setInterval(refreshParticles, PART_CONFIG.refreshInterval);
  }

  // ─── API PÚBLICA ────────────────────────────────────────────

  window.SFCParticles = {
    toggle: toggleParticles,
    setColor: setParticleColor,
    refresh: refreshParticles,
    getStatus: function() {
      return {
        enabled: particlesEnabled,
        hour: activeWindHour,
        color: particleColor,
        numParticles: particles.length,
        targetParticles: PART_CONFIG.numParticles
      };
    },
    setNumParticles: function(n) {
      PART_CONFIG.numParticles = Math.max(1000, Math.min(50000, n));
      if (particlesEnabled) seedParticles();
    }
  };

  // ─── UI: BOTÓ + SELECTOR DE COLOR AL .layer-dock ──────────

  function addParticlesButton() {
    const dock = document.querySelector('.layer-dock');
    if (!dock) {
      setTimeout(addParticlesButton, 500);
      return;
    }
    if (document.getElementById('particles-toggle-btn')) return;
    
    const btn = document.createElement('button');
    btn.id = 'particles-toggle-btn';
    btn.className = 'layer-btn';
    btn.textContent = 'VENT';
    btn.title = 'Activar/desactivar partícules de vent animades (30000 partícules)';
    btn.style.cssText = 'background: rgba(79,195,247,0.08); font-size: 11px; padding: 8px 12px;';
    
    const colorSelect = document.createElement('select');
    colorSelect.id = 'particles-color-select';
    colorSelect.title = 'Color de les partícules';
    colorSelect.style.cssText =
      'background: rgba(255,255,255,0.06); ' +
      'border: 1px solid rgba(255,255,255,0.1); ' +
      'border-radius: 999px; ' +
      'padding: 4px 8px; ' +
      'color: #e8edf5; ' +
      'font-size: 10px; ' +
      'cursor: pointer; ' +
      'font-family: inherit; ' +
      'margin-left: 2px; ' +
      'height: 26px;';
    
    const optNegre = document.createElement('option');
    optNegre.value = '#000000';
    optNegre.textContent = 'Negre';
    optNegre.selected = true;
    const optBlanc = document.createElement('option');
    optBlanc.value = '#ffffff';
    optBlanc.textContent = 'Blanc';
    colorSelect.appendChild(optNegre);
    colorSelect.appendChild(optBlanc);
    
    const container = document.createElement('span');
    container.style.cssText = 'display: flex; align-items: center; gap: 2px; flex-shrink: 0;';
    container.appendChild(btn);
    container.appendChild(colorSelect);
    
    const sfcBtn = document.getElementById('sfc-toggle-btn');
    if (sfcBtn && sfcBtn.parentElement) {
      sfcBtn.parentElement.insertAdjacentElement('afterend', container);
    } else {
      dock.insertBefore(container, dock.firstChild);
    }
    
    btn.addEventListener('click', function() {
      toggleParticles(!particlesEnabled);
    });
    
    colorSelect.addEventListener('change', function(e) {
      setParticleColor(e.target.value);
    });
    
    console.log('PART: Boto de partícules inserit al dock');
  }

  function init() {
    if (window.map) {
      addParticlesButton();
      startAutoRefresh();
    } else {
      setTimeout(init, 500);
    }
  }

  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', init);
  } else {
    init();
  }

  console.log('SFC-Particles.js carregat. Utilitza SFCParticles.toggle() per activar.');

})();