/* =========================================================
   player.js — Tempestes.cat
   ========================================================= */

const $ = (id) => document.getElementById(id);

export const TIERS = ['anon', 'free', 'entusiasta', 'professional'];
export const ACCESS = {
  anon: { minutes: 25, name: 'Sense sessió', window: '25 minuts' },
  free: { minutes: 60, name: 'Compte gratuït', window: '1 hora' },
  entusiasta: { minutes: 180, name: 'Entusiasta', window: '3 hores' },
  professional: { minutes: Infinity, name: 'Professional', window: '24 hores' },
};
const PRODUCTS = ['dbz', 'vel'];

const hourFmt = new Intl.DateTimeFormat('ca-ES', { timeZone: 'Europe/Madrid', hour: '2-digit', minute: '2-digit' });
const dayFmt = new Intl.DateTimeFormat('ca-ES', { timeZone: 'Europe/Madrid', day: '2-digit', month: 'short', year: 'numeric' });
const hourOnlyFmt = new Intl.DateTimeFormat('en-GB', { timeZone: 'Europe/Madrid', hour: '2-digit', hour12: false });
const minuteOnlyFmt = new Intl.DateTimeFormat('en-GB', { timeZone: 'Europe/Madrid', minute: '2-digit' });

export function initPlayer({ map, state, radar, saved }) {
  const playPauseBtn = $('playPauseBtn');
  const prevBtn = $('prevBtn');
  const nextBtn = $('nextBtn');
  const timelineEl = $('timeline');
  const timelineProg = $('timelineProgress');
  const timelineThumb = $('timelineThumb');
  const timelineLabels = $('timelineLabels');
  const timelineLocked = $('timelineLocked');
  const timelineLock = $('timelineLock');
  const timeCurrent = $('timeCurrent');
  const timeDate = $('timeDate');
  const prodDbzBtn = $('prodDbz');
  const prodVelBtn = $('prodVel');
  const playerRadar = $('playerRadar');
  const playerAcum = $('playerAcum');

  let totalFrames = 0;
  let timestamps = [];
  let intervalMin = 5;
  let lastRendered = -1;
  let dragging = false;
  let minIndex = 0;
  let lockPct = 0;
  let lockPrompted = false;
  let activeKey = state.activeKey || 'dbz';

  function rebuildTimelineLabels() {
    if (!timelineLabels) return;
    timelineLabels.innerHTML = '';
    if (totalFrames === 0 || timestamps.length === 0) return;
    const totalH = (totalFrames * intervalMin) / 60;
    const stepH = totalH <= 4 ? 1 : totalH <= 12 ? 2 : totalH <= 24 ? 3 : 6;
    for (let i = 0; i < totalFrames; i++) {
      const d = timestamps[i];
      if (!d) continue;
      const h = Number(hourOnlyFmt.format(d)) % 24;
      const m = Number(minuteOnlyFmt.format(d));
      if (m === 0 && h % stepH === 0) {
        const el = document.createElement('div');
        el.className = 'timeline-label';
        el.style.left = (totalFrames > 1 ? (i / (totalFrames - 1)) * 100 : 0) + '%';
        el.textContent = String(h).padStart(2, '0') + 'h';
        timelineLabels.appendChild(el);
      }
    }
    if (timelineLabels.children.length < 2 && totalFrames > 1) {
      const idxs = totalFrames <= 3 ? [0, totalFrames - 1] : [0, Math.round((totalFrames - 1) / 2), totalFrames - 1];
      idxs.forEach((i, k) => {
        const d = timestamps[i];
        if (!d) return;
        const el = document.createElement('div');
        el.className = 'timeline-label' + (k === 0 ? ' edge-l' : '') + (k === idxs.length - 1 ? ' edge-r' : '');
        el.style.left = (i / (totalFrames - 1)) * 100 + '%';
        el.textContent = hourFmt.format(d);
        timelineLabels.appendChild(el);
      });
    }
  }

  function updateUI(index) {
    if (index === lastRendered) return;
    lastRendered = index;
    const d = timestamps[index];
    if (timeCurrent) timeCurrent.textContent = d ? hourFmt.format(d) : '—';
    if (timeDate) timeDate.textContent = d ? dayFmt.format(d) : '—';
    const pct = totalFrames > 1 ? (index / (totalFrames - 1)) * 100 : 0;
    if (timelineProg) {
      timelineProg.style.left = lockPct + '%';
      timelineProg.style.width = Math.max(0, pct - lockPct) + '%';
    }
    if (timelineThumb) timelineThumb.style.left = pct + '%';
    const labels = timelineLabels?.querySelectorAll('.timeline-label') || [];
    let closest = null, best = Infinity;
    labels.forEach((el) => {
      const delta = Math.abs(parseFloat(el.style.left) - pct);
      if (delta < best) { best = delta; closest = el; }
    });
    labels.forEach((el) => el.classList.toggle('active', el === closest));
  }

  function indexFromEvent(e) {
    if (!timelineEl) return 0;
    const rect = timelineEl.getBoundingClientRect();
    const x = (e.touches ? e.touches[0].clientX : e.clientX) - rect.left;
    return Math.round(Math.max(0, Math.min(1, x / rect.width)) * (totalFrames - 1));
  }

  function seek(idx) {
    idx = Math.max(0, Math.min(totalFrames - 1, idx));
    if (idx < minIndex) { promptLocked(idx); idx = minIndex; }
    if (idx === lastRendered) return;
    radar.goToFrameLayer(activeKey, idx);
    updateUI(idx);
  }

  function setPausedUI(paused) {
    state.uiPaused = paused;
    if (playPauseBtn) playPauseBtn.textContent = paused ? 'Reprèn' : 'Pausa';
  }
  function pauseUI() { radar.pauseRadarAnimation(); setPausedUI(true); }
  function resumeUI() { radar.resumeRadarAnimation(); setPausedUI(false); }

  playPauseBtn?.addEventListener('click', () => { if (state.uiPaused) resumeUI(); else pauseUI(); });

  function step(delta) {
    pauseUI();
    const s = radar.getLayerState(activeKey);
    if (!s || totalFrames === 0) return;
    const span = Math.max(1, totalFrames - minIndex);
    const idx = minIndex + (((s.currentIndex - minIndex + delta) % span) + span) % span;
    radar.goToFrameLayer(activeKey, idx);
    updateUI(idx);
  }
  prevBtn?.addEventListener('click', () => step(-1));
  nextBtn?.addEventListener('click', () => step(1));

  timelineEl?.addEventListener('mousedown', (e) => { if (!totalFrames) return; dragging = true; pauseUI(); seek(indexFromEvent(e)); });
  timelineEl?.addEventListener('touchstart', (e) => { if (!totalFrames) return; dragging = true; pauseUI(); seek(indexFromEvent(e)); }, { passive: true });
  window.addEventListener('mousemove', (e) => { if (dragging) seek(indexFromEvent(e)); });
  window.addEventListener('touchmove', (e) => { if (dragging) seek(indexFromEvent(e)); }, { passive: true });
  window.addEventListener('mouseup', () => { dragging = false; lockPrompted = false; });
  window.addEventListener('touchend', () => { dragging = false; lockPrompted = false; });

  function syncTimeline(key) {
    const st = radar.getLayerState(key);
    if (!st || !st.initialized) return false;
    totalFrames = st.totalFrames;
    timestamps = st.timestamps || [];
    intervalMin = timestamps.length >= 2 && timestamps[0] && timestamps[1] ? Math.max(1, Math.round((timestamps[1] - timestamps[0]) / 60000)) : 5;
    rebuildTimelineLabels();
    computeAccess();
    return true;
  }

  async function selectProduct(key, opts) {
    state.acum?.hideOnMap?.();
    $('prodAcum')?.classList.remove('active');
    if (playerRadar) playerRadar.style.display = '';
    if (playerAcum) playerAcum.style.display = 'none';

    const st = radar.getLayerState(key);
    if (!st || !st.initialized) return;

    let ms = state.lastRadarMs;
    if (opts && 'ms' in opts) ms = opts.ms;
    else {
      const prev = radar.getLayerState(activeKey);
      if (prev && prev.initialized && prev.currentTime) ms = prev.currentTime;
    }

    await radar.syncToTime(key, ms);
    activeKey = key;
    state.activeKey = key;

    for (const k of PRODUCTS) {
      const s = radar.getLayerState(k);
      if (s && s.initialized) radar.setLayerVisibility(k, k === key && state.radarOn);
    }
    prodDbzBtn?.classList.toggle('active', key === 'dbz');
    prodVelBtn?.classList.toggle('active', key === 'vel');
    state.legend?.render?.(key);
    syncTimeline(key);
    state.r3d?.setKey?.(key);
  }

  prodDbzBtn?.addEventListener('click', () => { selectProduct('dbz'); if (state.isMobile()) state.ui?.closePanel?.(); });
  prodVelBtn?.addEventListener('click', () => { selectProduct('vel'); if (state.isMobile()) state.ui?.closePanel?.(); });

  function minIndexFor(key) {
    const st = radar.getLayerState(key);
    if (!st || !st.initialized) return 0;
    const mins = ACCESS[state.tier].minutes;
    if (!isFinite(mins)) return 0;
    const ts = st.timestamps;
    let latest = null;
    for (let i = ts.length - 1; i >= 0; i--) { if (ts[i]) { latest = ts[i].getTime(); break; } }
    if (latest === null) return 0;
    const limit = latest - mins * 60000 - 1000;
    for (let i = 0; i < ts.length; i++) { if (ts[i] && ts[i].getTime() >= limit) return i; }
    return 0;
  }

  function computeAccess() {
    for (const k of PRODUCTS) radar.setMinIndex(k, minIndexFor(k));
    const st = radar.getLayerState(activeKey);
    minIndex = st ? st.minIndex : 0;
    lockPct = totalFrames > 1 ? (minIndex / (totalFrames - 1)) * 100 : 0;
    state.minIndex = minIndex;
    if (timelineLocked) timelineLocked.style.width = lockPct + '%';
    if (timelineLock) {
      timelineLock.style.display = lockPct > 0 ? 'block' : 'none';
      timelineLock.style.left = lockPct / 2 + '%';
    }
    timelineLabels?.querySelectorAll('.timeline-label').forEach((el) => {
      el.classList.toggle('locked', parseFloat(el.style.left) < lockPct - 0.01);
    });
    lastRendered = -1;
    if (st && st.initialized) updateUI(Math.max(st.currentIndex, minIndex));
  }

  function requiredTierFor(idx) {
    let latest = null;
    for (let i = timestamps.length - 1; i >= 0; i--) { if (timestamps[i]) { latest = timestamps[i].getTime(); break; } }
    const d = timestamps[idx];
    if (latest === null || !d) return 'free';
    const age = (latest - d.getTime()) / 60000;
    if (age <= ACCESS.anon.minutes) return 'anon';
    if (age <= ACCESS.free.minutes) return 'free';
    if (age <= ACCESS.entusiasta.minutes) return 'entusiasta';
    return 'professional';
  }

  function promptLocked(idx) {
    if (lockPrompted) return;
    lockPrompted = true;
    state.upsell?.open?.(requiredTierFor(idx));
  }

  state.player = {
    selectProduct, syncTimeline, computeAccess, pauseUI, resumeUI, setPausedUI, updateUI, seek, step,
    getActiveKey: () => activeKey,
    getTotalFrames: () => totalFrames,
    getTimestamps: () => timestamps,
    getMinIndex: () => minIndex,
    updateAccess: () => { computeAccess(); syncTimeline(activeKey); },
  };

  state.player.setPausedUI(state.uiPaused);
  return state.player;
}
