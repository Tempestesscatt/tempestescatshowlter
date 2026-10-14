// public/dades/cobertura.js
// -----------------------------------------------------------------------------
// Capa de COBERTURA del radar: pinta una malla grisa semitransparent on el
// radar NO té dades (fora de l'abast dels radars).
//
// Ús des del radar.html:
//   <script src="/dades/cobertura.js"></script>
//   ...
//   const cobertura = window.COBERTURA.init({ map, visible: true });
//   cobertura.setVisible(false);
// -----------------------------------------------------------------------------

(function () {
  'use strict';

  // ---------------------------------------------------------------------------
  // CONFIGURACIÓ
  // ---------------------------------------------------------------------------

  const INFO_URL = '/dades/cobertura_radar.json';
  const PNG_URL  = '/dades/cobertura_radar.png';

  const SRC_ID   = 'cobertura-src';
  const LAYER_ID = 'cobertura-layer';

  // Caché del JSON (una sola càrrega per pàgina)
  let infoPromise = null;

  function loadInfo() {
    if (!infoPromise) {
      infoPromise = fetch(INFO_URL, { cache: 'no-store' })
        .then(function (r) {
          if (!r.ok) throw new Error('HTTP ' + r.status);
          return r.json();
        })
        .catch(function (e) {
          console.warn('[cobertura] no s\'ha pogut carregar', e.message);
          return null;
        });
    }
    return infoPromise;
  }

  // ---------------------------------------------------------------------------
  // API
  // ---------------------------------------------------------------------------

  /**
   * Afegeix (o actualitza) la capa de cobertura al mapa.
   *
   * @param {Object}  opts
   * @param {Object}  opts.map        instància de maplibregl.Map
   * @param {boolean} [opts.visible]  si la capa ha de sortir visible (true per defecte)
   * @param {string}  [opts.beforeId] id de la capa davant de la qual inserir-la
   * @returns {Promise<{setVisible:Function, isVisible:Function, refresh:Function, remove:Function}>}
   */
  async function init(opts) {
    opts = opts || {};
    const map = opts.map;
    if (!map) throw new Error('[cobertura] cal passar { map }');

    const beforeId = opts.beforeId || null;
    let _visible = opts.visible !== false;

    const info = await loadInfo();
    if (!info) {
      return {
        setVisible: function () {},
        isVisible: function () { return false; },
        refresh: function () { return Promise.resolve(); },
        remove: function () {},
      };
    }

    function removeLayer() {
      if (map.getLayer(LAYER_ID)) {
        try { map.removeLayer(LAYER_ID); } catch (e) {}
      }
      if (map.getSource(SRC_ID)) {
        try { map.removeSource(SRC_ID); } catch (e) {}
      }
    }

    function addLayer() {
      if (map.getLayer(LAYER_ID)) return;

      map.addSource(SRC_ID, {
        type: 'image',
        url: PNG_URL,
        coordinates: info.coordinates,
      });

      map.addLayer({
        id: LAYER_ID,
        type: 'raster',
        source: SRC_ID,
        layout: { visibility: _visible ? 'visible' : 'none' },
        paint: {
          'raster-opacity': 1,
          'raster-fade-duration': 0,
          'raster-resampling': 'nearest',
        },
      }, beforeId || undefined);
    }

    function setVisible(on) {
      _visible = !!on;
      if (map.getLayer(LAYER_ID)) {
        map.setLayoutProperty(LAYER_ID, 'visibility', _visible ? 'visible' : 'none');
      } else if (_visible) {
        addLayer();
      }
    }

    // Afegim la capa al mapa
    addLayer();

    return {
      setVisible: setVisible,
      isVisible: function () { return _visible; },
      refresh: async function () { removeLayer(); addLayer(); },
      remove: removeLayer,
    };
  }

  // ---------------------------------------------------------------------------
  // EXPOSICIÓ GLOBAL
  // ---------------------------------------------------------------------------

  window.COBERTURA = {
    init: init,
    LAYER_ID: LAYER_ID,
    SRC_ID: SRC_ID,
  };
})();