/* =========================================================
   acum.js — Tempestes.cat
   ========================================================= */

const $ = (id) => document.getElementById(id);

const ACUM_BASE = 'https://radar-data.tempestes.cat/dades_radar_acumulacions';
const ACUM_LAYER_ID = 'acum-layer';
const ACUM_SOURCE_ID = 'acum-src';
const ACUM_STEP_MS = 1200;
const DEFAULT_ACUM_STEPS = [30, 60, 180, 360, 720, 1440];

const hourFmt = new Intl.DateTimeFormat('ca-ES', { timeZone: 'Europe/Madrid', hour: '2-digit', minute: '2-digit' });
const dayFmt = new Intl.DateTimeFormat('ca-ES', { timeZone: 'Europe/Madrid', day: '2-digit', month: 'short', year: 'numeric' });

function formatPeriodLabel(mins) { if (mins < 60) return `${Math.round(mins)} min`; const h = mins / 60; if (Number.isInteger(h)) return h === 1 ? '1 hora' : `${h} hores`; return `${h.toFixed(1)} hores`; }
function shortPeriod(m) { return m < 60 ? `${m} min` : `${Math.round((m / 60) * 10) / 10} h`; }

async function loadManifest(base) {
  const url = `${base}/manifest.json`;
  const r = await fetch(url, { cache: 'no-cache' });
  if (!r.ok) throw new Error(`Manifest no disponible (${r.status})`);
  return r.json();
}

function periodsFromManifest(manifest, base) {
  if (!manifest || !Array.isArray(manifest.frames)) return [];
  return manifest.frames.map((f) => {
    const min = Number(f.min ?? f.minutes ?? f.period ?? 0);
    const file = f.file || f.url || f.path;
    if (!min || !file) return null;
    return { min, url: `${base}/${file}`, ts: f.timestamp ? new Date(f.timestamp) : null };
  }).filter(Boolean).sort((a, b) => a.min - b.min);
}

export function initAcum({ map, state, radar }) {
  const playerRadar = $('playerRadar');
  const playerAcum = $('playerAcum');
  const prodAcumBtn = $('prodAcum');
  const acumTime = $('acumTime');
  const acumDate = $('acumDate');
  const acumPlayBtn = $('acumPlayBtn');
  const acumSliderEl = $('acumSlider');
  const acumProgress = $('acumProgress');
  const acumThumb = $('acumThumb');
  const acumLabels = $('acumLabels');
  const acumTicks = $('acumTicks');
  const acumLockedEl = $('acumLocked');
  const acumLockIcon = $('acumLock');

  let manifest = null;
  let periods = [];
  let period = state.acumPeriod || 60;
  let promise = null;
  let key = '';
  let timer = 0;
  let sliderSig = '';
  let dragging = false;
  let lockPrompted = false;
  let blobs = new Map();

  function allowed(min) {
    const tier = state.tier || 'anon';
    const max = state.access?.[tier]?.minutes ?? 25;
    return min <= Math.max(30, max);
  }
  function needed(min) {
    if (min <= 30) return 'anon';
    if (min <= 60) return 'free';
    if (min <= 180) return 'entusiasta';
    return 'professional';
  }
  function steps() { return periods.length ? periods.map((p) => p.min) : DEFAULT_ACUM_STEPS; }
  function maxIdx() { let m = 0; steps().forEach((v, i) => { if (allowed(v)) m = i; }); return m; }
  function acumUrl(p) { return `${p.url}?v=${encodeURIComponent(key)}`; }

  function dropBlobs() { for (const b of blobs.values()) URL.revokeObjectURL(b); blobs.clear(); }

  async function preload() {
    const live = new Set(periods.map((p) => p.url));
    for (const [u, b] of blobs) { if (!live.has(u)) { URL.revokeObjectURL(b); blobs.delete(u); } }
    const pending = periods.filter((p) => allowed(p.min) && !blobs.has(p.url));
    await Promise.all(pending.map(async (p) => {
      try {
        const r = await fetch(p.url, { mode: 'cors', cache: 'no-cache' });
        if (!r.ok) return;
        const blob = await r.blob();
        if (blob.size) blobs.set(p.url, URL.createObjectURL(blob));
      } catch {}
    }));
  }

  function showOnMap(minutes) {
    const p = periods.find((x) => x.min === minutes);
    if (!p) return;
    const src = blobs.get(p.url) || acumUrl(p);
    const coords = state.regioCoordinates?.() || state.coords;
    if (!coords) return;
    const source = map.getSource(ACUM_SOURCE_ID);
    if (source && map.getLayer(ACUM_LAYER_ID)) {
      try { source.updateImage({ url: src, coordinates: coords }); return; } catch { hideOnMap(); }
    }
    map.addSource(ACUM_SOURCE_ID, { type: 'image', url: src, coordinates: coords });
    let before;
    for (const id of ['radar-layer-dbz', 'radar-layer-vel', 'radar-layer-lluvia', 'radar-layer']) {
      if (map.getLayer(id)) { before = id; break; }
    }
    map.addLayer({
      id: ACUM_LAYER_ID, type: 'raster', source: ACUM_SOURCE_ID,
      paint: { 'raster-opacity': 0.9, 'raster-fade-duration': 0, 'raster-resampling': 'linear' },
    }, before);
  }

  function hideOnMap() {
    if (map.getLayer(ACUM_LAYER_ID)) map.removeLayer(ACUM_LAYER_ID);
    if (map.getSource(ACUM_SOURCE_ID)) map.removeSource(ACUM_SOURCE_ID);
  }

  function paintSlider() {
    const st = steps();
    const n = st.length;
    const pctOf = (i) => (n > 1 ? (i / (n - 1)) * 100 : 0);
    const mx = maxIdx();
    const cur = Math.max(0, st.indexOf(period));
    const sig = `${st.join(',')}|${mx}`;

    if (sig !== sliderSig) {
      sliderSig = sig;
      if (acumTicks) acumTicks.innerHTML = st.map((v, i) => `<i class="acum-tick" style="left:${pctOf(i)}%"></i>`).join('');
      if (acumLabels) acumLabels.innerHTML = st.map((v, i) =>
        `<div class="timeline-label${i === 0 ? ' edge-l' : ''}${i === n - 1 ? ' edge-r' : ''}${i > mx ? ' locked' : ''}" data-i="${i}" style="left:${pctOf(i)}%">${shortPeriod(v)}</div>`
      ).join('');
      if (acumLockedEl) {
        const hasLock = mx < n - 1;
        const lockStart = hasLock ? ((mx + 0.5) / (n - 1)) * 100 : 100;
        acumLockedEl.style.width = 100 - lockStart + '%';
      }
      if (acumLockIcon) {
        const hasLock = mx < n - 1;
        const lockStart = hasLock ? ((mx + 0.5) / (n - 1)) * 100 : 100;
        acumLockIcon.style.display = hasLock ? 'block' : 'none';
        acumLockIcon.style.left = (lockStart + 100) / 2 + '%';
      }
    }

    if (acumThumb) acumThumb.style.left = pctOf(cur) + '%';
    if (acumProgress) acumProgress.style.width = pctOf(cur) + '%';
    acumLabels?.querySelectorAll('.timeline-label').forEach((el) => {
      el.classList.toggle('active', Number(el.dataset.i) === cur);
    });
  }

  function updateChips() {
    document.querySelectorAll('.acum-chip').forEach((b) => {
      const min = Number(b.dataset.min);
      const p = periods.find((x) => x.min === min);
      const ok = allowed(min);
      b.classList.toggle('active', min === period);
      b.classList.toggle('locked', !ok);
      b.disabled = periods.length > 0 && !p;
    });
    if (acumTime) acumTime.textContent = `Acumulació ${formatPeriodLabel(period)}`;
    if (acumDate) {
      if (manifest && manifest.last_timestamp) {
        const d = new Date(manifest.last_timestamp);
        acumDate.textContent = `fins ${hourFmt.format(d)} · ${dayFmt.format(d)}`;
      } else {
        acumDate.textContent = '';
      }
    }
    paintSlider();
  }

  function setPeriod(mins) {
    if (!Number.isFinite(mins)) return;
    if (!allowed(mins)) { state.upsell?.open?.(needed(mins)); return; }
    period = mins;
    state.acumPeriod = mins;
    updateChips();
    if (state.activeKey !== 'acum') return;
    showOnMap(period);
    state.legend?.renderAcum?.(period);
  }

  function advance() {
    const st = steps();
    const mx = maxIdx();
    const cur = Math.max(0, st.indexOf(period));
    setPeriod(st[(cur + 1) % (mx + 1)]);
  }

  function startPlay() {
    if (timer) return;
    if (maxIdx() < 1) { state.upsell?.open?.(needed(steps()[1] || 60)); return; }
    timer = setInterval(advance, ACUM_STEP_MS);
    if (acumPlayBtn) acumPlayBtn.textContent = 'Pausa';
  }
  function stopPlay() {
    if (timer) clearInterval(timer);
    timer = 0;
    if (acumPlayBtn) acumPlayBtn.textContent = 'Reprodueix';
  }

  acumPlayBtn?.addEventListener('click', () => { if (timer) stopPlay(); else startPlay(); });

  function idxFromEvent(e) {
    if (!acumSliderEl) return 0;
    const rect = acumSliderEl.getBoundingClientRect();
    const x = (e.touches ? e.touches[0].clientX : e.clientX) - rect.left;
    return Math.round(Math.max(0, Math.min(1, x / rect.width)) * (steps().length - 1));
  }
  function seek(idx) {
    const st = steps();
    idx = Math.max(0, Math.min(st.length - 1, idx));
    const mx = maxIdx();
    if (idx > mx) { if (!lockPrompted) { lockPrompted = true; state.upsell?.open?.(needed(st[idx])); } idx = mx; }
    if (st[idx] !== period) setPeriod(st[idx]);
  }

  acumSliderEl?.addEventListener('mousedown', (e) => { dragging = true; stopPlay(); seek(idxFromEvent(e)); });
  acumSliderEl?.addEventListener('touchstart', (e) => { dragging = true; stopPlay(); seek(idxFromEvent(e)); }, { passive: true });
  window.addEventListener('mousemove', (e) => { if (dragging) seek(idxFromEvent(e)); });
  window.addEventListener('touchmove', (e) => { if (dragging) seek(idxFromEvent(e)); }, { passive: true });
  window.addEventListener('mouseup', () => { dragging = false; lockPrompted = false; });
  window.addEventListener('touchend', () => { dragging = false; lockPrompted = false; });

  document.querySelectorAll('.acum-chip').forEach((btn) => {
    btn.addEventListener('click', async () => {
      const mins = Number(btn.dataset.min);
      if (!Number.isFinite(mins)) return;
      stopPlay();
      if (!allowed(mins)) { state.upsell?.open?.(needed(mins)); return; }
      if (state.activeKey === 'acum' && !periods.length) await refresh();
      setPeriod(mins);
    });
  });

  prodAcumBtn?.addEventListener('click', async () => {
    state.player?.off3D?.();
    $('prodDbz')?.classList.remove('active');
    $('prodVel')?.classList.remove('active');
    prodAcumBtn.classList.add('active');

    if (playerRadar) playerRadar.style.display = 'none';
    if (playerAcum) playerAcum.style.display = '';

    for (const k of ['dbz', 'vel']) radar.setLayerVisibility(k, false);

    hideOnMap();
    state.activeKey = 'acum';

    if (!allowed(period)) period = 30;
    state.legend?.renderAcum?.(period);
    updateChips();

    if (periods.length) showOnMap(period);
    await refresh();
    if (state.activeKey !== 'acum') return;
    showOnMap(period);
    state.legend?.renderAcum?.(period);
    updateChips();
    preload().catch(() => {});

    if (state.isMobile()) state.ui?.closePanel?.();
  });

  function refresh() {
    if (promise) return promise;
    promise = (async () => {
      try {
        const m = await loadManifest(ACUM_BASE);
        if (!m || !Array.isArray(m.frames) || m.frames.length === 0) {
          if (!periods.length && acumDate) acumDate.textContent = "Sense dades d'acumulació";
          return;
        }
        const k = `${m.updated || ''}|${m.last_timestamp || ''}`;
        const changed = k !== key || !periods.length;
        manifest = m;
        if (changed) {
          periods = periodsFromManifest(m, ACUM_BASE);
          key = k;
          dropBlobs();
        }
        updateChips();
        if (changed && state.activeKey === 'acum') {
          showOnMap(period);
          state.legend?.renderAcum?.(period);
          preload().catch(() => {});
        }
      } catch (e) {
        console.error('[acum]', e);
        if (!periods.length && acumDate) acumDate.textContent = "No s'han pogut carregar";
      } finally {
        promise = null;
      }
    })();
    return promise;
  }

  state.acum = {
    refresh, setPeriod, showOnMap, hideOnMap, startPlay, stopPlay,
    getPeriods: () => periods, getPeriod: () => period, allowed, needed,
  };

  updateChips();
  refresh().catch(() => {});
  return state.acum;
}
