// public/js/alertes.js
// -----------------------------------------------------------------------------
// Alertes meteorològiques d'AEMET sobre el mapa.
//
// Carrega:
//   - /dades/alertes/manifest.json   → info del PNG únic
//   - /dades/alertes/avisos.json     → detall de cada zona
//
// Un sol PNG amb totes les zones pintades amb el color de la seva
// severitat MÀXIMA (de tots els dies).
//
// En passar el ratolí: tooltip amb el nom de la zona i la severitat.
// En fer clic: popup amb tots els detalls (dies, events, headlines).
// -----------------------------------------------------------------------------

// ---------------------------------------------------------------------------
// CONFIGURACIÓ
// ---------------------------------------------------------------------------

const MANIFEST_URL = '/dades/alertes/manifest.json';
const AVISOS_URL = '/dades/alertes/avisos.json';
const LAYER_ID = 'alertes-layer';
const SOURCE_ID = 'alertes-src';

const SEVERITY_LABELS = {
  'Minor':    { name: 'Avís groc',    color: '#ffeb00' },
  'Moderate': { name: 'Avís taronja', color: '#ffa53c' },
  'Severe':   { name: 'Avís vermell', color: '#dc1414' },
  'Extreme':  { name: 'Avís extrem',  color: '#8c005a' },
};

const SEVERITY_PRIORITY = ['Extreme', 'Severe', 'Moderate', 'Minor'];

// ---------------------------------------------------------------------------
// UTILITATS DE PÍXEL
// ---------------------------------------------------------------------------

const probe = document.createElement('canvas');
probe.width = probe.height = 1;
const pctx = probe.getContext('2d', { willReadFrequently: true });
pctx.imageSmoothingEnabled = false;

let alertesImg = null;   // HTMLImageElement del PNG

function loadImage(url) {
  return new Promise((resolve, reject) => {
    const img = new Image();
    img.crossOrigin = 'anonymous';
    img.onload = () => resolve(img);
    img.onerror = () => reject(new Error('No s\'ha pogut carregar ' + url));
    img.src = url;
  });
}

function lngLatToUV(lng, lat, region) {
  const mercY = (latDeg) => Math.asinh(Math.tan(latDeg * Math.PI / 180));
  const n = mercY(region.lat_max);
  const s = mercY(region.lat_min);
  const u = (lng - region.lon_min) / (region.lon_max - region.lon_min);
  const v = (n - mercY(lat)) / (n - s);
  return { u, v };
}

function readPixel(img, u, v) {
  if (u < 0 || u > 1 || v < 0 || v > 1) return null;
  const sx = Math.min(img.naturalWidth - 1, Math.max(0, Math.floor(u * img.naturalWidth)));
  const sy = Math.min(img.naturalHeight - 1, Math.max(0, Math.floor(v * img.naturalHeight)));
  pctx.clearRect(0, 0, 1, 1);
  pctx.drawImage(img, sx, sy, 1, 1, 0, 0, 1, 1);
  const d = pctx.getImageData(0, 0, 1, 1).data;
  return { r: d[0], g: d[1], b: d[2], a: d[3] };
}

/** Retorna la severitat que correspon a un color, o null. */
function severitatDelColor(px) {
  for (const sev of SEVERITY_PRIORITY) {
    const expected = SEVERITY_LABELS[sev]?.color;
    if (!expected) continue;
    const r = parseInt(expected.slice(1, 3), 16);
    const g = parseInt(expected.slice(3, 5), 16);
    const b = parseInt(expected.slice(5, 7), 16);
    const dr = px.r - r, dg = px.g - g, db = px.b - b;
    const dist = Math.sqrt(dr * dr + dg * dg + db * db);
    if (dist < 80) return sev;
  }
  // Si el píxel és blanc (ratlla), no podem saber la severitat pel color
  return null;
}

function puntDinsBbox(lng, lat, bbox) {
  if (!bbox || bbox.length !== 4) return false;
  const [w, s, e, n] = bbox;
  return lng >= w && lng <= e && lat >= s && lat <= n;
}

// ---------------------------------------------------------------------------
// DADES
// ---------------------------------------------------------------------------

let cachedManifest = null;
let cachedAvisos = null;

async function loadManifest() {
  if (cachedManifest) return cachedManifest;
  const r = await fetch(`${MANIFEST_URL}?t=${Date.now()}`, { cache: 'no-store' });
  if (!r.ok) throw new Error('HTTP ' + r.status);
  const j = await r.json();
  if (!j || !j.png) throw new Error('manifest no vàlid');
  cachedManifest = j;
  return j;
}

async function loadAvisos() {
  if (cachedAvisos) return cachedAvisos;
  try {
    const r = await fetch(`${AVISOS_URL}?t=${Date.now()}`, { cache: 'no-store' });
    if (!r.ok) throw new Error('HTTP ' + r.status);
    const j = await r.json();
    if (!j || !Array.isArray(j.avisos)) throw new Error('avisos.json no vàlid');
    cachedAvisos = j;
    return j;
  } catch (e) {
    console.warn('[alertes] no s\'ha pogut carregar avisos.json:', e.message);
    cachedAvisos = { avisos: [] };
    return cachedAvisos;
  }
}

// ---------------------------------------------------------------------------
// API
// ---------------------------------------------------------------------------

export function initAlertes({ map, visible = true, onClick = null } = {}) {
  if (!map) throw new Error('initAlertes: cal un map');

  let isVisible = visible;
  let manifest = null;
  let avisosDetall = null;

  const popup = new maplibregl.Popup({
    className: 'alerta-popup-wrap',
    closeButton: true,
    closeOnClick: true,
    offset: 12,
    maxWidth: '340px',
  });

  // Tooltip
  let tooltipEl = null;
  function ensureTooltip() {
    if (tooltipEl) return tooltipEl;
    tooltipEl = document.createElement('div');
    tooltipEl.id = 'alertaTooltip';
    tooltipEl.style.display = 'none';
    document.body.appendChild(tooltipEl);
    return tooltipEl;
  }
  function showTooltip(html, x, y) {
    const el = ensureTooltip();
    el.innerHTML = html;
    el.style.display = 'block';
    const rect = el.getBoundingClientRect();
    const W = window.innerWidth;
    const H = window.innerHeight;
    let px = x + 14;
    let py = y + 14;
    if (px + rect.width > W - 8) px = x - rect.width - 14;
    if (py + rect.height > H - 8) py = y - rect.height - 14;
    el.style.left = px + 'px';
    el.style.top = py + 'px';
  }
  function hideTooltip() {
    if (tooltipEl) tooltipEl.style.display = 'none';
  }

  injectStyles();

  // ---------------------------------------------------------------------------
  // CAPA AL MAPA
  // ---------------------------------------------------------------------------
  function addLayer() {
    if (map.getSource(SOURCE_ID)) {
      map.getSource(SOURCE_ID).updateImage({
        url: `/dades/alertes/${manifest.png}?t=${Date.now()}`,
        coordinates: manifest.coords,
      });
      // Assegurem que quedi a sota
      ensureBelowRadar();
      return;
    }

    map.addSource(SOURCE_ID, {
      type: 'image',
      url: `/dades/alertes/${manifest.png}`,
      coordinates: manifest.coords,
    });

    map.addLayer({
      id: LAYER_ID,
      type: 'raster',
      source: SOURCE_ID,
      layout: { visibility: isVisible ? 'visible' : 'none' },
      paint: {
        'raster-opacity': 0.9,
        'raster-fade-duration': 0,
        'raster-resampling': 'linear',
      },
    });

    // Movem la capa perquè quedi per sota del radar
    ensureBelowRadar();
  }

  /** Mou la capa d'alertes perquè quedi just per sota de les capes del radar. */
  function ensureBelowRadar() {
    if (!map.getLayer(LAYER_ID)) return;

    // Busquem la primera capa del radar (relleu, radar, acumulacions, etc.)
    const capesSobre = [
      'relief-layer',        // relleu
      'acum-layer',          // acumulacions
      'radar-layer-dbz',     // radar dBZ
      'radar-layer-lluvia',  // radar NIMBUS
      'avisos-fill',         // avisos de pluja
      'avisos-line',
      'municipis-line',
      'comarques-line',
    ];

    // Busquem la primera capa que existeixi i moguem les alertes a sota seu
    for (const id of capesSobre) {
      if (map.getLayer(id)) {
        try {
          map.moveLayer(LAYER_ID, id);
        } catch (e) {
          console.warn('[alertes] no s\'ha pogut moure la capa:', e.message);
        }
        return;
      }
    }

    // Si no hi ha cap capa del radar encara, la deixem al fons
    // (quan el radar es carregui, quedarà per sobre automàticament)
  }
  // ---------------------------------------------------------------------------
  // DETECCIÓ D'AVÍS SOTA EL CURSOR
  // ---------------------------------------------------------------------------
  function avisSotaPunt(lngLat) {
    if (!manifest) return null;
    if (!alertesImg) return null;

    const { u, v } = lngLatToUV(lngLat.lng, lngLat.lat, manifest.region);
    if (u < 0 || u > 1 || v < 0 || v > 1) return null;

    const px = readPixel(alertesImg, u, v);
    if (!px) return null;
    if (px.a < 20) return null;

    // Severitat detectada pel color
    let sev = severitatDelColor(px);

    // Si és blanc (ratlla) o no detectem color, mirem els avisos per bbox
    if (!sev) {
      const isWhite = px.r > 230 && px.g > 230 && px.b > 230;
      if (isWhite) {
        const zona = zonaPerBbox(lngLat);
        if (zona) sev = zona.severity;
      }
    }

    // Busquem la zona que cobreix aquest punt
    const zona = zonaPerBbox(lngLat, sev);
    if (!zona) return { severity: sev || 'Minor', zona: null };

    return {
      severity: zona.severity,
      zona,
    };
  }

  /** Retorna la zona (de avisos.json) que cobreix aquest punt, opcionalment filtrant per severitat. */
  function zonaPerBbox(lngLat, severityFilter = null) {
    if (!avisosDetall || !avisosDetall.avisos) return null;

    let candidats = avisosDetall.avisos;
    if (severityFilter) {
      candidats = candidats.filter((a) => a.severity === severityFilter);
      if (candidats.length === 0) candidats = avisosDetall.avisos;
    }

    const dins = candidats.filter((a) => puntDinsBbox(lngLat.lng, lngLat.lat, a.bbox));
    if (dins.length === 0) return null;

    // Si n'hi ha més d'un, prioritzem el de més rank
    dins.sort((a, b) => (b.rank || 0) - (a.rank || 0));
    return dins[0];
  }

  // ---------------------------------------------------------------------------
  // HTML DEL POPUP
  // ---------------------------------------------------------------------------
  function popupHtml(zona) {
    if (!zona) {
      return `<div class="al-popup"><div class="al-zone">Cap informació disponible</div></div>`;
    }

    const sevClass = `al-sev-${zona.severity.toLowerCase()}`;
    const info = SEVERITY_LABELS[zona.severity] || { name: zona.severity };

    let diesHtml = '';
    if (zona.dies && zona.dies.length > 0) {
      diesHtml = `<div class="al-dies"><span class="al-dies-lbl">Dies:</span> ${zona.dies.map((d) => `<span class="al-dia">${escapeHtml(d)}</span>`).join('')}</div>`;
    }

    // Detalls per dia
    let detallsHtml = '';
    if (zona.detalls && zona.detalls.length > 0) {
      detallsHtml = zona.detalls.slice(0, 5).map((d) => {
        const sevClassD = `al-sev-${(d.severity || 'minor').toLowerCase()}`;
        return `
          <div class="al-detall">
            <div class="al-detall-head">
              <span class="al-sev-mini ${sevClassD}">${escapeHtml(d.severity || '')}</span>
              <span class="al-detall-dia">${escapeHtml(d.dia || '')}</span>
            </div>
            ${d.headline ? `<div class="al-detall-hl">${escapeHtml(d.headline)}</div>` : ''}
            ${d.event && d.event !== d.headline ? `<div class="al-detall-ev">${escapeHtml(d.event)}</div>` : ''}
          </div>`;
      }).join('');
    }

    return `
      <div class="al-popup">
        <div class="al-head">
          <span class="al-sev ${sevClass}">${escapeHtml(zona.severity)}</span>
          <span class="al-event">${escapeHtml(info.name)}</span>
        </div>
        <div class="al-zona">${escapeHtml(zona.zona || '')}</div>
        ${diesHtml}
        ${detallsHtml ? `<div class="al-detalls">${detallsHtml}</div>` : ''}
      </div>`;
  }

  // ---------------------------------------------------------------------------
  // ESDEVENIMENTS AL MAPA
  // ---------------------------------------------------------------------------
  let lastMove = 0;

  function attachEvents() {
    map.on('click', (e) => {
      const trobat = avisSotaPunt(e.lngLat);
      if (!trobat || !trobat.zona) return;

      if (typeof onClick === 'function') {
        onClick(trobat.zona, e);
        return;
      }

      popup.setLngLat(e.lngLat).setHTML(popupHtml(trobat.zona)).addTo(map);
    });

    map.on('mousemove', (e) => {
      const now = performance.now();
      if (now - lastMove < 60) return;
      lastMove = now;

      const trobat = avisSotaPunt(e.lngLat);
      if (trobat && trobat.zona) {
        map.getCanvas().style.cursor = 'pointer';
        const info = SEVERITY_LABELS[trobat.severity] || { name: trobat.severity };
        const html = `
          <div class="al-tip">
            <span class="al-tip-dot al-sev-${trobat.severity.toLowerCase()}"></span>
            <span class="al-tip-name">${escapeHtml(info.name)}</span>
            <span class="al-tip-zona">${escapeHtml(trobat.zona.zona || '')}</span>
          </div>`;
        showTooltip(html, e.originalEvent.clientX, e.originalEvent.clientY);
      } else {
        map.getCanvas().style.cursor = '';
        hideTooltip();
      }
    });

    map.on('mouseout', () => {
      map.getCanvas().style.cursor = '';
      hideTooltip();
    });
  }

  // ---------------------------------------------------------------------------
  // ESTILS
  // ---------------------------------------------------------------------------
  function injectStyles() {
    if (document.getElementById('alertes-styles')) return;
    const css = document.createElement('style');
    css.id = 'alertes-styles';
    css.textContent = `
      .maplibregl-popup.alerta-popup-wrap .maplibregl-popup-content {
        background: rgba(15, 17, 22, 0.97);
        backdrop-filter: blur(18px); -webkit-backdrop-filter: blur(18px);
        border: 1px solid rgba(255, 255, 255, 0.10);
        border-radius: 10px;
        box-shadow: 0 16px 48px rgba(0, 0, 0, 0.65);
        padding: 0; color: #e8ecf3;
        font-family: system-ui, -apple-system, "Segoe UI", Roboto, sans-serif;
        overflow: hidden;
      }
      .maplibregl-popup.alerta-popup-wrap .maplibregl-popup-tip {
        border-top-color: rgba(15, 17, 22, 0.97);
      }
      .maplibregl-popup.alerta-popup-wrap .maplibregl-popup-close-button {
        color: #7f8a9c; font-size: 16px; padding: 4px 8px;
        border-radius: 0 10px 0 6px;
      }
      .maplibregl-popup.alerta-popup-wrap .maplibregl-popup-close-button:hover {
        background: rgba(255,255,255,.06); color: #fff;
      }
      .al-popup { min-width: 260px; max-width: 340px; padding: 12px 14px; }
      .al-head { display: flex; align-items: center; gap: 8px; margin-bottom: 6px; flex-wrap: wrap; }
      .al-sev {
        font-size: 9px; font-weight: 700; letter-spacing: .4px;
        padding: 3px 8px; border-radius: 4px; text-transform: uppercase;
      }
      .al-sev-mini {
        font-size: 8px; font-weight: 700; letter-spacing: .3px;
        padding: 2px 6px; border-radius: 3px; text-transform: uppercase;
      }
      .al-sev-minor    { background: rgba(255, 235, 0, .18);  color: #fde047; }
      .al-sev-moderate { background: rgba(255, 165, 60, .18); color: #fbbf24; }
      .al-sev-severe   { background: rgba(220, 20, 20, .22);  color: #f87171; }
      .al-sev-extreme  { background: rgba(140, 0, 90, .25);   color: #f9a8d4; }
      .al-event { font-size: 13px; font-weight: 600; color: #f5f7fa; }
      .al-zona { font-size: 12px; color: #cbd5e1; margin-bottom: 8px; line-height: 1.4; }
      .al-dies { font-size: 11px; color: #94a3b8; margin-bottom: 8px; }
      .al-dies-lbl { color: #7f8a9c; }
      .al-dia {
        display: inline-block; padding: 2px 6px; margin: 0 4px 4px 0;
        background: rgba(255,255,255,.06); border-radius: 4px;
        font-variant-numeric: tabular-nums;
      }
      .al-detalls {
        max-height: 220px; overflow-y: auto;
        border-top: 1px solid rgba(255,255,255,0.08);
        padding-top: 8px; margin-top: 4px;
      }
      .al-detall {
        padding: 6px 0;
        border-bottom: 1px solid rgba(255,255,255,0.05);
      }
      .al-detall:last-child { border-bottom: none; }
      .al-detall-head {
        display: flex; align-items: center; gap: 6px; margin-bottom: 3px;
      }
      .al-detall-dia {
        font-size: 10px; color: #7f8a9c;
        font-variant-numeric: tabular-nums;
      }
      .al-detall-hl {
        font-size: 11.5px; color: #e8ecf3; line-height: 1.35;
      }
      .al-detall-ev {
        font-size: 10.5px; color: #94a3b8; margin-top: 2px;
      }

      #alertaTooltip {
        position: fixed; z-index: 9999; pointer-events: none;
        background: rgba(15, 17, 22, 0.97);
        backdrop-filter: blur(14px); -webkit-backdrop-filter: blur(14px);
        border: 1px solid rgba(255, 255, 255, 0.10);
        border-radius: 8px; padding: 7px 11px;
        box-shadow: 0 8px 24px rgba(0, 0, 0, 0.5);
        font-family: system-ui, -apple-system, "Segoe UI", Roboto, sans-serif;
        font-size: 12px; color: #e8ecf3;
        white-space: nowrap; max-width: 320px;
      }
      #alertaTooltip .al-tip { display: flex; align-items: center; gap: 8px; }
      #alertaTooltip .al-tip-dot {
        width: 10px; height: 10px; border-radius: 50%;
        display: inline-block;
        border: 1px solid rgba(255,255,255,0.2);
        flex-shrink: 0;
      }
      #alertaTooltip .al-tip-dot.al-sev-minor    { background: #ffeb00; }
      #alertaTooltip .al-tip-dot.al-sev-moderate { background: #ffa53c; }
      #alertaTooltip .al-tip-dot.al-sev-severe   { background: #dc1414; }
      #alertaTooltip .al-tip-dot.al-sev-extreme  { background: #8c005a; }
      #alertaTooltip .al-tip-name { font-weight: 600; color: #f5f7fa; }
      #alertaTooltip .al-tip-zona {
        color: #94a3b8; font-weight: 400;
        overflow: hidden; text-overflow: ellipsis;
      }
    `;
    document.head.appendChild(css);
  }

  // ---------------------------------------------------------------------------
  // API
  // ---------------------------------------------------------------------------
  const api = {
    async start() {
      try {
        manifest = await loadManifest();
        avisosDetall = await loadAvisos();

        // Carreguem el PNG per lectura de píxels
        try {
          alertesImg = await loadImage(`/dades/alertes/${manifest.png}?t=${Date.now()}`);
        } catch (e) {
          console.warn('[alertes] no s\'ha pogut carregar el PNG:', e.message);
        }

        console.log(`[alertes] ${avisosDetall.avisos.length} zones carregades`);

        addLayer();
        attachEvents();

      } catch (e) {
        console.warn('[alertes]', e.message);
      }
    },

    async refresh() {
      cachedManifest = null;
      cachedAvisos = null;
      alertesImg = null;
      await api.start();
    },

    setVisible(on) {
      isVisible = !!on;
      if (map.getLayer(LAYER_ID)) {
        map.setLayoutProperty(LAYER_ID, 'visibility', isVisible ? 'visible' : 'none');
      }
      if (!isVisible) {
        popup.remove();
        hideTooltip();
      }
    },

    isVisible: () => isVisible,
    getManifest: () => manifest,
    getAvisos: () => avisosDetall,

    destroy() {
      popup.remove();
      if (map.getLayer(LAYER_ID)) {
        try { map.removeLayer(LAYER_ID); } catch (e) {}
      }
      if (map.getSource(SOURCE_ID)) {
        try { map.removeSource(SOURCE_ID); } catch (e) {}
      }
      if (tooltipEl && tooltipEl.parentNode) {
        tooltipEl.parentNode.removeChild(tooltipEl);
      }
    },
  };

  return api;
}

// ---------------------------------------------------------------------------
// UTILITATS
// ---------------------------------------------------------------------------

function escapeHtml(s) {
  return String(s == null ? '' : s).replace(/[&<>"']/g, (c) => ({
    '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;'
  }[c]));
}

export default { initAlertes };