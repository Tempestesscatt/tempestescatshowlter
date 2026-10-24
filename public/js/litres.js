// public/js/litres.js

const R2_BASE = 'https://radar-data.tempestes.cat/dades_litres';
const MANIFEST_URL = `${R2_BASE}/manifest.json`;
const SRC_ID = 'litres-src';
const LAYER_ID = 'litres-layer';

const POLL_INTERVAL_MS = 60_000;

export function initLitres({ map, onActivate, onDeactivate }) {
  let currentProduct = null;
  let manifest = null;
  let manifestUpdated = null;
  let frames = [];
  let frameIndex = -1;
  let activeFrameUrl = null;
  let flyoutEl = null;
  let sliderEl = null;
  let preloadTimer = null;
  let pollTimer = null;
  let followLatest = true;

  // ------------------------------------------------------------------ botó
  const rail = document.querySelector('.side-rail.left');
  if (rail) {
    const btn = document.createElement('button');
    btn.className = 'rail-btn';
    btn.id = 'litresBtn';
    btn.title = 'Litres (OPERA)';
    btn.innerHTML = `
      <svg viewBox="0 0 24 24"><path d="M12 2C8 7 6 11 6 14a6 6 0 0 0 12 0c0-3-2-7-6-12z"/></svg>
      <span class="label">Litres</span>
    `;
    const sep = rail.querySelector('.rail-sep');
    if (sep) rail.insertBefore(btn, sep);
    else rail.appendChild(btn);

    btn.addEventListener('click', (e) => {
      e.stopPropagation();
      toggleFlyout(btn);
    });
  }

  // ---------------------------------------------------------------- flyout
  flyoutEl = document.createElement('div');
  flyoutEl.className = 'flyout flyout-litres';
  flyoutEl.id = 'flyout-litresSelect';
  flyoutEl.innerHTML = `
    <div class="flyout-title litres-head">
      <span>Litres (OPERA)</span>
      <span class="litres-badge" id="litresBadge" hidden></span>
    </div>

    <div class="litres-body">
      <div class="litres-left">
        <div class="litres-options">
          <button class="opt" data-litres="RATE">
            <div class="opt-main">
              <span class="opt-name">Intensitat de la precipitació</span>
              <span class="opt-sub">mm/h · OPERA RATE</span>
            </div>
            <svg class="check" viewBox="0 0 24 24"><polyline points="20 6 9 17 4 12"/></svg>
          </button>
          <button class="opt" data-litres="ACRR">
            <div class="opt-main">
              <span class="opt-name">Acumulat 1h</span>
              <span class="opt-sub">mm · OPERA ACRR</span>
            </div>
            <svg class="check" viewBox="0 0 24 24"><polyline points="20 6 9 17 4 12"/></svg>
          </button>
        </div>

        <div class="litres-panel" id="litresPanel" hidden>
          <div class="litres-meta">
            <span class="litres-time" id="litresTime">—</span>
            <span class="litres-count" id="litresCount"></span>
          </div>

          <div class="litres-slider-row">
            <button class="litres-nav" id="litresPrev" type="button" aria-label="Anterior">
              <svg viewBox="0 0 24 24"><polyline points="15 18 9 12 15 6"/></svg>
            </button>
            <div class="litres-track">
              <div class="litres-progress" id="litresProgress"></div>
              <input type="range" id="litresSlider" min="0" max="0" value="0" step="1" />
            </div>
            <button class="litres-nav" id="litresNext" type="button" aria-label="Següent">
              <svg viewBox="0 0 24 24"><polyline points="9 18 15 12 9 6"/></svg>
            </button>
          </div>

          <div class="litres-axis" id="litresAxis"></div>
        </div>
      </div>

      <!-- NOU: Llegenda vertical a la dreta -->
      <div class="litres-right" id="litresRight" hidden>
        <div class="litres-legend-v" id="litresLegendV">
          <div class="litres-legend-v-labels" id="litresLegendVLabels"></div>
          <div class="litres-legend-v-bar" id="litresLegendVBar"></div>
        </div>
      </div>
    </div>

    <div class="litres-loading" id="litresLoading" hidden>
      <span class="litres-spin"></span> Carregant…
    </div>

    <div class="litres-status" id="litresStatus" hidden></div>
  `;
  document.body.appendChild(flyoutEl);

  const $ = (id) => flyoutEl.querySelector(`#${id}`);
  sliderEl = $('litresSlider');
  const timeEl = $('litresTime');
  const countEl = $('litresCount');
  const progEl = $('litresProgress');
  const axisEl = $('litresAxis');
  const panelEl = $('litresPanel');
  const badgeEl = $('litresBadge');
  const loadingEl = $('litresLoading');
  const statusEl = $('litresStatus');
  const rightEl = $('litresRight');
  const legendVBarEl = $('litresLegendVBar');
  const legendVLabelsEl = $('litresLegendVLabels');

  // ---------------------------------------------------------------- events
  flyoutEl.querySelectorAll('.opt[data-litres]').forEach((opt) => {
    opt.addEventListener('click', async () => {
      if (opt.classList.contains('loading')) return;
      opt.classList.add('loading');
      const ok = await loadProduct(opt.dataset.litres);
      opt.classList.remove('loading');
      if (ok) updateUI(opt.dataset.litres);
    });
  });

  sliderEl.addEventListener('input', () => {
    followLatest = false;
    const i = parseInt(sliderEl.value, 10) || 0;
    paintPosition(i);
    debouncedGo(i);
  });
  sliderEl.addEventListener('change', () => goToFrame(parseInt(sliderEl.value, 10) || 0));

  $('litresPrev').addEventListener('click', () => {
    followLatest = false;
    goToFrame(Math.max(0, frameIndex - 1));
  });
  $('litresNext').addEventListener('click', () => {
    goToFrame(Math.min(frames.length - 1, frameIndex + 1));
    if (frameIndex === frames.length - 1) followLatest = true;
  });

  flyoutEl.addEventListener('keydown', (e) => {
    if (!flyoutEl.classList.contains('open') || !frames.length) return;
    if (e.key === 'ArrowLeft')  { e.preventDefault(); followLatest = false; goToFrame(Math.max(0, frameIndex - 1)); }
    if (e.key === 'ArrowRight') { e.preventDefault(); goToFrame(Math.min(frames.length - 1, frameIndex + 1)); }
  });

  function debounce(fn, ms) {
    let t;
    return (...a) => { clearTimeout(t); t = setTimeout(() => fn(...a), ms); };
  }
  const debouncedGo = debounce((i) => goToFrame(i), 120);

  // ---------------------------------------------------------------- flyout UI
  function toggleFlyout(btn) {
    if (flyoutEl.classList.contains('open')) { closeFlyout(); return; }
    closeAllOtherFlyouts();
    flyoutEl.classList.add('open');
    positionFlyout(btn);
    btn.classList.add('active');
    flyoutEl.tabIndex = -1;
    flyoutEl.focus({ preventScroll: true });
    if (currentProduct) startPolling();
  }

  function closeFlyout() {
    flyoutEl.classList.remove('open');
    const btn = document.getElementById('litresBtn');
    if (btn) btn.classList.remove('active');
    stopPolling();
  }

  function closeAllOtherFlyouts() {
    document.querySelectorAll('.flyout.open').forEach(f => { if (f !== flyoutEl) f.classList.remove('open'); });
    document.querySelectorAll('.rail-btn.active').forEach(b => { if (b.id !== 'litresBtn') b.classList.remove('active'); });
  }

  function positionFlyout(anchorBtn) {
    const rect = anchorBtn.getBoundingClientRect();
    flyoutEl.style.top = Math.max(12, rect.top) + 'px';
    flyoutEl.style.left = (rect.right + 8) + 'px';
    flyoutEl.style.right = '';
    requestAnimationFrame(() => {
      const fh = flyoutEl.offsetHeight;
      if (rect.top + fh > window.innerHeight - 12) {
        flyoutEl.style.top = Math.max(12, window.innerHeight - fh - 12) + 'px';
      }
    });
  }

  document.addEventListener('click', (e) => {
    if (!e.target.closest('#flyout-litresSelect') && !e.target.closest('#litresBtn')) closeFlyout();
  });

  // ---------------------------------------------------------------- manifest
  async function fetchManifest() {
    try {
      const r = await fetch(`${MANIFEST_URL}?t=${Date.now()}`, { cache: 'no-store' });
      return r.ok ? await r.json() : null;
    } catch (e) {
      console.warn('[litres] manifest', e);
      return null;
    }
  }

  function setLoading(on) {
    loadingEl.hidden = !on;
    panelEl.classList.toggle('is-loading', on);
  }

  function setStatus(msg, isError = false) {
    if (!msg) {
      statusEl.hidden = true;
      statusEl.textContent = '';
      return;
    }
    statusEl.hidden = false;
    statusEl.textContent = msg;
    statusEl.style.color = isError ? '#ff6b6b' : '';
  }

  async function loadProduct(productKey) {
    if (!map) return false;
    const key = String(productKey || '').toUpperCase();
    if (key !== 'RATE' && key !== 'ACRR') return false;

    setLoading(true);
    setStatus('');
    manifest = await fetchManifest();
    if (!manifest || !manifest.products || !manifest.products[key]) {
      setLoading(false);
      setStatus(`Sense dades per a ${key}`, true);
      return false;
    }
    const prod = manifest.products[key];
    if (!prod.frames || !prod.frames.length) {
      setLoading(false);
      setStatus(`0 frames per a ${key}`, true);
      return false;
    }

    currentProduct = key;
    manifestUpdated = manifest.updated || null;
    frames = prod.frames.slice();

    sliderEl.min = 0;
    sliderEl.max = Math.max(0, frames.length - 1);
    sliderEl.value = frames.length - 1;

    panelEl.hidden = false;
    badgeEl.hidden = false;
    badgeEl.textContent = key;
    rightEl.hidden = false; // Mostrem la llegenda vertical
    buildAxis();
    buildLegendV(prod.levels, prod.colors, key);

    followLatest = true;
    const ok = await goToFrame(frames.length - 1, true);
    setLoading(false);
    if (ok && onActivate) onActivate();
    if (ok) startPolling();
    return ok;
  }

  function buildAxis() {
    axisEl.innerHTML = '';
    const n = frames.length;
    if (!n) return;
    if (n === 1) {
      axisEl.innerHTML = `<span class="litres-tick" style="left:0">${shortTime(frames[0].t)}</span>`;
      return;
    }
    const idxs = new Set([0, n - 1]);
    if (n >= 4) {
      idxs.add(Math.floor((n - 1) / 2));
      idxs.add(Math.floor((n - 1) / 4));
      idxs.add(Math.floor(((n - 1) * 3) / 4));
    }
    [...idxs].sort((a, b) => a - b).forEach((i) => {
      const el = document.createElement('span');
      el.className = 'litres-tick';
      el.style.left = (i / (n - 1)) * 100 + '%';
      el.dataset.i = i;
      el.textContent = shortTime(frames[i].t);
      axisEl.appendChild(el);
    });
  }

function buildLegendV(levels, colors, productKey) {
  if (!levels || !colors || !levels.length || !colors.length) return;

  // Límit per a la llegenda: 500 mm (ACRR) o 1000 mm/h (RATE)
  const LIMIT_MAX = productKey === 'ACRR' ? 500 : 1000;

  // Filtrem els nivells fins al límit
  const filtered = [];
  for (let i = 0; i < levels.length; i++) {
    if (levels[i] <= LIMIT_MAX) {
      filtered.push({ val: levels[i], color: colors[i] });
    } else {
      if (filtered.length > 0) {
        const prev = filtered[filtered.length - 1];
        if (prev.val < LIMIT_MAX) {
          filtered.push({ val: LIMIT_MAX, color: colors[i] });
        }
      }
      break;
    }
  }

  if (filtered.length < 2) return;

  const min = filtered[0].val;
  const max = filtered[filtered.length - 1].val;
  const range = max - min || 1;

  // Gradient vertical
  const stops = filtered.map(({ val, color }) => {
    const pct = ((val - min) / range) * 100;
    return `${color} ${pct}%`;
  });
  legendVBarEl.style.background = `linear-gradient(to top, ${stops.join(', ')})`;

  // Generem exactament 6 etiquetes (0, i 5 més fins al màxim)
  legendVLabelsEl.innerHTML = '';
  const numLabels = 6;
  
  for (let k = 0; k < numLabels; k++) {
    // Calculem la posició en % (0% a baix, 100% a dalt)
    const pct = (k / (numLabels - 1)) * 100;
    // Calculem el valor corresponent
    const val = min + (range * pct / 100);
    
    const span = document.createElement('span');
    span.className = 'litres-legend-v-label';
    span.style.bottom = `${pct}%`;
    // Mostrem enters si és gran, decimals si és petit
    span.textContent = val >= 100 ? Math.round(val) : (val >= 10 ? Math.round(val) : val.toFixed(1));
    legendVLabelsEl.appendChild(span);
  }
}

  function paintPosition(i) {
    if (!frames.length) return;
    const pct = (i / Math.max(1, frames.length - 1)) * 100;
    progEl.style.width = pct + '%';
    timeEl.textContent = formatTime(frames[i].t);
    countEl.textContent = `${i + 1} / ${frames.length}`;
    axisEl.querySelectorAll('.litres-tick').forEach(el => {
      el.classList.toggle('active', parseInt(el.dataset.i, 10) === i);
    });
  }

  async function goToFrame(idx, force = false) {
    if (!frames.length) return false;
    idx = Math.max(0, Math.min(frames.length - 1, idx));
    if (!force && idx === frameIndex) return true;

    frameIndex = idx;
    sliderEl.value = idx;
    paintPosition(idx);

    const fr = frames[idx];
    const url = `${R2_BASE}/${fr.f}.png`;

    if (url === activeFrameUrl && map.getLayer(LAYER_ID)) {
      map.setLayoutProperty(LAYER_ID, 'visibility', 'visible');
      schedulePreload(idx);
      return true;
    }

    try {
      const head = await fetch(url, { method: 'HEAD', cache: 'no-store' });
      if (!head.ok) { console.warn(`[litres] ${url} (${head.status})`); return false; }
    } catch (e) { console.warn('[litres] HEAD', e); return false; }

    activeFrameUrl = url;

    if (map.getSource(SRC_ID)) {
      map.getSource(SRC_ID).updateImage({ url, coordinates: manifest.coords });
    } else {
      map.addSource(SRC_ID, { type: 'image', url, coordinates: manifest.coords });
      map.addLayer({
        id: LAYER_ID,
        type: 'raster',
        source: SRC_ID,
        paint: { 'raster-opacity': 0.9, 'raster-fade-duration': 0, 'raster-resampling': 'linear' },
      });
    }
    map.setLayoutProperty(LAYER_ID, 'visibility', 'visible');
    try { map.moveLayer(LAYER_ID); } catch (e) {}

    schedulePreload(idx);
    return true;
  }

  function schedulePreload(idx) {
    clearTimeout(preloadTimer);
    preloadTimer = setTimeout(() => {
      const a = frames[idx - 1]; const b = frames[idx + 1];
      if (a) new Image().src = `${R2_BASE}/${a.f}.png`;
      if (b) new Image().src = `${R2_BASE}/${b.f}.png`;
    }, 200);
  }

  // ---------------------------------------------------------------- polling
  function startPolling() {
    stopPolling();
    pollTimer = setInterval(checkForUpdates, POLL_INTERVAL_MS);
    checkForUpdates();
  }

  function stopPolling() {
    if (pollTimer) {
      clearInterval(pollTimer);
      pollTimer = null;
    }
  }

  async function checkForUpdates() {
    if (!currentProduct) return;
    try {
      const m = await fetchManifest();
      if (!m || !m.products || !m.products[currentProduct]) return;

      const newUpdated = m.updated || null;
      const newFrames = m.products[currentProduct].frames || [];
      if (!newFrames.length) return;

      if (newUpdated === manifestUpdated && newFrames.length === frames.length) return;

      const prevFrameTs = frames[frameIndex]?.t || null;

      manifest = m;
      manifestUpdated = newUpdated;
      frames = newFrames.slice();

      sliderEl.max = Math.max(0, frames.length - 1);
      buildAxis();
      buildLegendV(
        m.products[currentProduct].levels,
        m.products[currentProduct].colors,
        currentProduct
      );

      if (followLatest) {
        await goToFrame(frames.length - 1, true);
      } else {
        const newIdx = prevFrameTs ? frames.findIndex(f => f.t === prevFrameTs) : -1;
        if (newIdx >= 0) {
          paintPosition(newIdx);
          const fr = frames[newIdx];
          activeFrameUrl = `${R2_BASE}/${fr.f}.png`;
        } else {
          await goToFrame(frames.length - 1, true);
          followLatest = true;
        }
      }

      setStatus('Actualitzat', false);
      setTimeout(() => setStatus(''), 2000);
    } catch (e) {
      console.warn('[litres] checkForUpdates', e);
    }
  }

  // ---------------------------------------------------------------- utils
  function parseT(t) {
    if (!t || t.length < 13) return null;
    const d = new Date(`${t.slice(0,4)}-${t.slice(4,6)}-${t.slice(6,8)}T${t.slice(9,11)}:${t.slice(11,13)}:00Z`);
    return isNaN(d) ? null : d;
  }
  function formatTime(t) {
    const d = parseT(t);
    if (!d) return '—';
    try {
      return new Intl.DateTimeFormat('ca-ES', {
        timeZone: 'Europe/Madrid',
        day: '2-digit', month: '2-digit',
        hour: '2-digit', minute: '2-digit',
      }).format(d);
    } catch (_) { return d.toISOString().slice(0, 16).replace('T', ' '); }
  }
  function shortTime(t) {
    const d = parseT(t);
    if (!d) return '';
    try {
      return new Intl.DateTimeFormat('en-GB', {
        timeZone: 'Europe/Madrid', hour: '2-digit', minute: '2-digit', hour12: false,
      }).format(d);
    } catch (_) { return ''; }
  }

  function updateUI(productKey) {
    flyoutEl.querySelectorAll('.opt[data-litres]').forEach((o) => {
      o.classList.toggle('selected', o.dataset.litres === productKey);
    });
    const chip = document.getElementById('chipProduct');
    if (chip) chip.textContent = productKey === 'RATE' ? 'mm/h' : 'mm';
    const bar = document.getElementById('bottomBar');
    if (bar) bar.style.display = 'none';
    const legend = document.getElementById('legend');
    if (legend) legend.classList.add('hidden');
  }

  function hide() {
    stopPolling();
    if (map && map.getLayer(LAYER_ID)) map.setLayoutProperty(LAYER_ID, 'visibility', 'none');
    currentProduct = null;
    manifest = null;
    manifestUpdated = null;
    frames = [];
    frameIndex = -1;
    activeFrameUrl = null;
    clearTimeout(preloadTimer);

    panelEl.hidden = true;
    badgeEl.hidden = true;
    badgeEl.textContent = '';
    rightEl.hidden = true; // Amaguem la llegenda vertical
    setStatus('');

    const bar = document.getElementById('bottomBar');
    if (bar) bar.style.display = '';
    const legend = document.getElementById('legend');
    if (legend) legend.classList.remove('hidden');

    flyoutEl.querySelectorAll('.opt[data-litres]').forEach((o) => o.classList.remove('selected'));
    if (onDeactivate) onDeactivate();
  }

  return {
    loadProduct,
    hide,
    getCurrentProduct: () => currentProduct,
    getFrameIndex: () => frameIndex,
    getFrames: () => frames.slice(),
    checkForUpdates,
  };
}