// public/js/estacions.js
// Estacions AEMET amb focus exclusiu: triar-ne una -> flyTo + amagar la resta.
// API: initEstacions({ map, visible }) -> { start, setVisible, getSelected, select, clearSelection, destroy }
// No requereix tocar el HTML: s'enganxa sol al botó [title="Estacions"] de la banda dreta.

const AEMET_URL = '/dades/aemet/estacions.geojson'; // ajusta si tens un altre path
const SRC_ID = 'estacions-src';
const LAYER_HALO = 'estacions-halo';
const LAYER_DOT  = 'estacions-dot';
const LAYER_LABEL = 'estacions-label';

const COLOR = {
  normal: '#5a9dff',
  selected: '#22c55e',
  halo: 'rgba(90,157,255,0.35)',
  haloSelected: 'rgba(34,197,94,0.45)',
  label: '#ffffff',
  labelHalo: 'rgba(0,0,0,0.85)',
};

export function initEstacions({ map, visible = false } = {}) {
  if (!map) {
    console.warn('[estacions] initEstacions: falta map');
    return {
      start: async () => {},
      setVisible: () => {},
      getSelected: () => null,
      select: () => {},
      clearSelection: () => {},
      destroy: () => {},
    };
  }

  // ---------------------------------------------------------------- estat
  let data = null;              // FeatureCollection
  let started = false;          // start() ja ha carregat el geojson
  let starting = null;          // promesa en curs
  let visibleState = !!visible; // volums visibles o no
  let selectedId = null;        // id de l'estació enfocada
  let flyoutEl = null;
  let boundBtn = null;

  const allFeatures = () => (data && Array.isArray(data.features)) ? data.features : [];
  const byId = new Map(); // id -> feature
  const featureId = (f) => (f && f.properties && (f.properties.id || f.properties.codi || f.properties.indicatiu || f.properties.nom)) || null;

  // ---------------------------------------------------------------- utils
  const norm = (s) => (s || '').toString().toLowerCase().normalize('NFD').replace(/[\u0300-\u036f]/g, '');

  function ensureStyleLayers() {
    if (map.getLayer(LAYER_HALO)) map.removeLayer(LAYER_HALO);
    if (map.getLayer(LAYER_DOT))  map.removeLayer(LAYER_DOT);
    if (map.getLayer(LAYER_LABEL)) map.removeLayer(LAYER_LABEL);
    if (map.getSource(SRC_ID)) map.removeSource(SRC_ID);

    map.addSource(SRC_ID, {
      type: 'geojson',
      data: data || { type: 'FeatureCollection', features: [] },
    });

    // Halo (cercle gran translúcid)
    map.addLayer({
      id: LAYER_HALO, type: 'circle', source: SRC_ID, minzoom: 4,
      paint: {
        'circle-radius': ['interpolate', ['linear'], ['zoom'], 4, 4, 10, 14, 14, 22],
        'circle-color': [
          'case',
          ['==', ['get', 'id'], selectedId || '__none__'],
          COLOR.haloSelected,
          COLOR.halo,
        ],
        'circle-opacity': 0.55,
        'circle-stroke-width': 0,
      },
    });

    // Punt
    map.addLayer({
      id: LAYER_DOT, type: 'circle', source: SRC_ID, minzoom: 4,
      paint: {
        'circle-radius': ['interpolate', ['linear'], ['zoom'], 4, 2.5, 10, 5, 14, 8],
        'circle-color': [
          'case',
          ['==', ['get', 'id'], selectedId || '__none__'],
          COLOR.selected,
          COLOR.normal,
        ],
        'circle-stroke-color': '#ffffff',
        'circle-stroke-width': 1.4,
        'circle-opacity': 1,
      },
    });

    // Etiqueta (nom) només quan ja hi ha prou zoom o està seleccionada
    map.addLayer({
      id: LAYER_LABEL, type: 'symbol', source: SRC_ID, minzoom: 6,
      filter: ['==', ['get', 'id'], selectedId || '__none__'],
      layout: {
        'text-field': ['get', 'nom'],
        'text-font': ['Noto Sans Regular'],
        'text-size': ['interpolate', ['linear'], ['zoom'], 6, 11, 12, 13],
        'text-offset': [0, 1.2],
        'text-anchor': 'top',
        'text-allow-overlap': true,
      },
      paint: {
        'text-color': COLOR.label,
        'text-halo-color': COLOR.labelHalo,
        'text-halo-width': 1.6,
      },
    });

    applyVisibility();
  }

  function applyVisibility() {
    const v = visibleState ? 'visible' : 'none';
    for (const id of [LAYER_HALO, LAYER_DOT, LAYER_LABEL]) {
      if (map.getLayer(id)) {
        try { map.setLayoutProperty(id, 'visibility', v); } catch (e) {}
      }
    }
  }

  function refreshSelectionPaint() {
    if (!map.getLayer(LAYER_HALO) || !map.getLayer(LAYER_DOT)) return;
    try {
      map.setPaintProperty(LAYER_HALO, 'circle-color', [
        'case',
        ['==', ['get', 'id'], selectedId || '__none__'],
        COLOR.haloSelected,
        COLOR.halo,
      ]);
      map.setPaintProperty(LAYER_DOT, 'circle-color', [
        'case',
        ['==', ['get', 'id'], selectedId || '__none__'],
        COLOR.selected,
        COLOR.normal,
      ]);
      map.setFilter(LAYER_LABEL, ['==', ['get', 'id'], selectedId || '__none__']);
    } catch (e) {}
  }

  // Aplica un filtre que amaga TOTES les estacions excepte la seleccionada
  // (només s'aplica quan hi ha selectedId; si no, filtre buit = totes visibles).
  function applyFocusFilter() {
    const f = selectedId
      ? ['==', ['get', 'id'], selectedId]
      : null;
    for (const id of [LAYER_HALO, LAYER_DOT]) {
      if (!map.getLayer(id)) continue;
      try { map.setFilter(id, f); } catch (e) {}
    }
    // L'etiqueta ja té el seu propi filtre (només la seleccionada)
    if (map.getLayer(LAYER_LABEL)) {
      try { map.setFilter(LAYER_LABEL, ['==', ['get', 'id'], selectedId || '__none__']); } catch (e) {}
    }
  }

  // ---------------------------------------------------------------- càrrega
  async function load() {
    if (data) return data;
    try {
      const r = await fetch(AEMET_URL, { cache: 'no-store' });
      if (!r.ok) throw new Error('HTTP ' + r.status);
      const j = await r.json();
      if (!j || j.type !== 'FeatureCollection' || !Array.isArray(j.features)) {
        throw new Error('format geojson inesperat');
      }
      // Normalitzem: assegurem que cada feature té un `id` a properties
      j.features.forEach((f) => {
        if (!f.properties) f.properties = {};
        if (!f.properties.id) {
          f.properties.id = f.properties.codi
            || f.properties.indicatiu
            || f.properties.nom
            || (f.geometry && f.geometry.coordinates
                ? `${f.geometry.coordinates[0]},${f.geometry.coordinates[1]}`
                : Math.random().toString(36).slice(2));
        }
        if (!f.properties.nom) f.properties.nom = f.properties.name || f.properties.id;
      });
      data = j;
      byId.clear();
      j.features.forEach((f) => byId.set(f.properties.id, f));
      return data;
    } catch (e) {
      console.warn('[estacions] no s\'ha pogut carregar', e.message);
      data = { type: 'FeatureCollection', features: [] };
      return data;
    }
  }

  async function start() {
    if (started) return true;
    if (starting) return starting;
    starting = (async () => {
      await load();
      if (!map.getStyle || !map.getStyle()) {
        // Si el mapa encara no té estil carregat, esperem
        await new Promise((res) => map.once('style.load', res));
      }
      ensureStyleLayers();
      refreshSelectionPaint();
      applyFocusFilter();
      started = true;
      return true;
    })();
    return starting;
  }

  // ---------------------------------------------------------------- focus
  function flyToStation(feature) {
    const [lon, lat] = feature.geometry.coordinates;
    map.flyTo({
      center: [lon, lat],
      zoom: 10,
      duration: 1400,
      essential: true,
      curve: 1.4,
    });
  }

  function select(id) {
    if (!id) return;
    const f = byId.get(id);
    if (!f) { console.warn('[estacions] select: id desconegut', id); return; }
    selectedId = id;
    visibleState = true;
    applyVisibility();
    refreshSelectionPaint();
    applyFocusFilter();
    flyToStation(f);
    updateFlyoutSelection();
  }

  function clearSelection() {
    if (!selectedId) return;
    selectedId = null;
    refreshSelectionPaint();
    applyFocusFilter();
    updateFlyoutSelection();
  }

  function getSelected() { return selectedId; }

  function setVisible(v) {
    visibleState = !!v;
    if (!visibleState) {
      // En amagar-les, també traiem el focus perquè no quedi res estrany
      selectedId = null;
      refreshSelectionPaint();
      applyFocusFilter();
      closeFlyout();
    }
    if (map.getLayer(LAYER_DOT)) applyVisibility();
  }

  // ---------------------------------------------------------------- flyout
  function buildFlyout() {
    const el = document.createElement('div');
    el.className = 'flyout';
    el.id = 'flyout-estacions';
    el.innerHTML = `
      <div class="flyout-title">Estacions AEMET</div>
      <div class="estacions-search" style="padding:4px 6px 8px">
        <input type="text" placeholder="Cerca estació…" autocomplete="off"
          style="width:100%;padding:7px 9px;background:rgba(24,34,46,.9);
                 color:#e8f0f8;border:1px solid rgba(80,120,160,.25);
                 border-radius:8px;font:inherit;font-size:12px;outline:none" />
      </div>
      <div class="estacions-list" style="max-height:340px;overflow:auto;padding:2px 4px 4px"></div>
      <div class="estacions-actions" style="display:flex;gap:6px;padding:6px 6px 4px;border-top:1px solid rgba(80,120,160,.2)">
        <button class="opt" data-act="clear" style="justify-content:center;background:rgba(24,34,46,.9);border:1px solid rgba(80,120,160,.25)">
          <span style="font-weight:600">Mostrar totes</span>
        </button>
      </div>
    `;
    document.body.appendChild(el);

    el.addEventListener('click', (e) => {
      e.stopPropagation();
      const btn = e.target.closest('[data-station-id]');
      if (btn) {
        const id = btn.dataset.stationId;
        if (id === selectedId) clearSelection();
        else select(id);
        return;
      }
      const act = e.target.closest('[data-act]');
      if (act && act.dataset.act === 'clear') { clearSelection(); return; }
    });

    const input = el.querySelector('input[type="text"]');
    input.addEventListener('input', () => renderList(input.value));
    input.addEventListener('keydown', (e) => {
      if (e.key === 'Escape') closeFlyout();
    });

    return el;
  }

  function renderList(filter = '') {
    const list = flyoutEl.querySelector('.estacions-list');
    if (!list) return;
    const q = norm(filter).trim();
    const items = allFeatures()
      .filter((f) => !q || norm(f.properties.nom).includes(q))
      .sort((a, b) => (a.properties.nom || '').localeCompare(b.properties.nom || ''));

    list.innerHTML = '';
    if (items.length === 0) {
      list.innerHTML = '<div style="padding:12px;text-align:center;font-size:12px;color:#8aa0b8">Cap resultat</div>';
      return;
    }
    for (const f of items) {
      const id = f.properties.id;
      const btn = document.createElement('button');
      btn.className = 'opt' + (id === selectedId ? ' selected' : '');
      btn.dataset.stationId = id;
      btn.style.justifyContent = 'flex-start';
      btn.innerHTML = `
        <span class="opt-main">
          <span class="opt-name"></span>
          <span class="opt-sub"></span>
        </span>
      `;
      btn.querySelector('.opt-name').textContent = f.properties.nom || id;
      btn.querySelector('.opt-sub').textContent =
        (f.properties.comarca || f.properties.provincia || f.properties.regio || 'AEMET');
      list.appendChild(btn);
    }
  }

  function updateFlyoutSelection() {
    if (!flyoutEl) return;
    flyoutEl.querySelectorAll('[data-station-id]').forEach((b) => {
      b.classList.toggle('selected', b.dataset.stationId === selectedId);
    });
  }

  function positionFlyout(anchorBtn) {
    if (!flyoutEl) return;
    const rect = anchorBtn.getBoundingClientRect();
    const isRight = anchorBtn.closest('.side-rail.right');
    flyoutEl.classList.add('open');
    flyoutEl.style.top = Math.max(12, rect.top) + 'px';
    if (isRight) {
      flyoutEl.style.right = (window.innerWidth - rect.left + 8) + 'px';
      flyoutEl.style.left = '';
    } else {
      flyoutEl.style.left = (rect.right + 8) + 'px';
      flyoutEl.style.right = '';
    }
    requestAnimationFrame(() => {
      const fh = flyoutEl.offsetHeight;
      if (rect.top + fh > window.innerHeight - 12) {
        flyoutEl.style.top = Math.max(12, window.innerHeight - fh - 12) + 'px';
      }
    });
  }

  function openFlyout(anchorBtn) {
    if (!flyoutEl) flyoutEl = buildFlyout();
    positionFlyout(anchorBtn);
    renderList();
    anchorBtn.classList.add('active');
  }

  function closeFlyout() {
    if (flyoutEl) flyoutEl.classList.remove('open');
    if (boundBtn) boundBtn.classList.remove('active');
  }

  function toggleFlyout(anchorBtn) {
    if (flyoutEl && flyoutEl.classList.contains('open')) closeFlyout();
    else openFlyout(anchorBtn);
  }

  // ---------------------------------------------------------------- bind
  function findRailButton() {
    // Botó de la banda dreta amb title="Estacions" o aria-label que ho contingui
    const btns = Array.from(document.querySelectorAll('.side-rail.right .rail-btn'));
    return btns.find((b) =>
      /estacion/i.test(b.getAttribute('title') || '') ||
      /estacion/i.test(b.getAttribute('aria-label') || '') ||
      /estacion/i.test(b.textContent || '')
    ) || null;
  }

  function bindRailButton() {
    boundBtn = findRailButton();
    if (!boundBtn) {
      console.warn('[estacions] no s\'ha trobat el botó "Estacions" a la banda dreta');
      return;
    }
    boundBtn.addEventListener('click', (e) => {
      e.stopPropagation();
      toggleFlyout(boundBtn);
    });
    // Tanquem en clicar fora
    document.addEventListener('click', (e) => {
      if (!flyoutEl) return;
      if (e.target.closest('#flyout-estacions')) return;
      if (e.target.closest('.side-rail.right .rail-btn')) return;
      closeFlyout();
    });
    document.addEventListener('keydown', (e) => {
      if (e.key === 'Escape') closeFlyout();
    });
    window.addEventListener('resize', () => {
      if (flyoutEl && flyoutEl.classList.contains('open')) positionFlyout(boundBtn);
    });
  }

  // ---------------------------------------------------------------- init
  async function boot() {
    bindRailButton();
    if (visible) {
      await start();
    }
  }
  boot();

  // ---------------------------------------------------------------- API
  function destroy() {
    for (const id of [LAYER_LABEL, LAYER_DOT, LAYER_HALO]) {
      if (map.getLayer(id)) { try { map.removeLayer(id); } catch (e) {} }
    }
    if (map.getSource(SRC_ID)) { try { map.removeSource(SRC_ID); } catch (e) {} }
    if (flyoutEl) { flyoutEl.remove(); flyoutEl = null; }
    if (boundBtn) boundBtn.classList.remove('active');
    boundBtn = null;
    started = false;
    starting = null;
  }

  return {
    start,
    setVisible,
    getSelected,
    select,
    clearSelection,
    destroy,
  };
}

export default { initEstacions };