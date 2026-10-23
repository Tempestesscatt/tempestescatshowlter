/* =========================================================
   avisos-ui.js — Tempestes.cat
   ========================================================= */

const $ = (id) => document.getElementById(id);
const hourFmt = new Intl.DateTimeFormat('ca-ES', { timeZone: 'Europe/Madrid', hour: '2-digit', minute: '2-digit' });
const escapeHtml = (s) => String(s).replace(/[&<>"']/g, (c) => ({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]));

export function initAvisos({ map, state, radar, alertes }) {
  const avisBtn = $('avisBtn');
  const avisBadge = $('avisBadge');
  const avisPanel = $('avisPanel');
  const avisList = $('avisList');
  const avisMsg = $('avisMsg');
  const avisMeta = $('avisMeta');
  const avisTitle = $('avisTitle');
  const avisX = $('avisX');
  const avisLegend = $('avisLegend');
  const chkAvisos = $('chkAvisos');
  const avisBadgeTier = $('avisBadgeTier');

  let layerOn = true, key = '', busy = false, items = [], latest = null, alertesCatalunya = null;
  const LEVELS = state.avisosLevels || [
    { id: 'feble', name: 'Feble', min: 2, color: '#5a9dff' },
    { id: 'moderat', name: 'Moderat', min: 8, color: '#39e69b' },
    { id: 'fort', name: 'Fort', min: 20, color: '#facc15' },
    { id: 'molt-fort', name: 'Molt fort', min: 40, color: '#f97316' },
    { id: 'extrem', name: 'Extrem', min: 60, color: '#ef4444' },
  ];
  const levelInfo = (id) => LEVELS.find((l) => l.id === id) || LEVELS[0];

  function accessLevel() {
    const tier = state.tier || 'anon';
    const i = ['anon', 'free', 'entusiasta', 'professional'].indexOf(tier);
    if (i >= 3) return 'full';
    if (i >= 1) return 'basic';
    return 'none';
  }
  const hasAvisos = () => accessLevel() !== 'none';

  function paintTierBadge() {
    if (!avisBadgeTier) return;
    const lvl = accessLevel();
    if (lvl === 'full') { avisBadgeTier.className = 'pro'; avisBadgeTier.textContent = 'Pro'; }
    else if (lvl === 'basic') { avisBadgeTier.className = 'free'; avisBadgeTier.textContent = 'Free'; }
    else { avisBadgeTier.className = 'free'; avisBadgeTier.textContent = 'Login'; }
  }

  function paintBadge() {
    const lvl = accessLevel();
    avisBtn?.classList.toggle('locked', lvl === 'none');
    const teAlertes = alertesCatalunya && alertesCatalunya.total > 0;
    const teAvisos = items.length > 0;
    if (teAlertes || (lvl !== 'none' && teAvisos)) {
      const num = (teAlertes ? alertesCatalunya.total : 0) + (teAvisos ? items.length : 0);
      if (avisBadge) {
        avisBadge.textContent = num > 99 ? '99+' : num;
        avisBadge.classList.add('on');
      }
    } else {
      avisBadge?.classList.remove('on');
    }
  }

  function applyVisibility() {
    const show = layerOn && hasAvisos();
    const fc = show ? state.avisosToFeatureCollection?.(items) || null : null;
    radar.setAvisosData(fc);
  }

  function render(message) {
    paintBadge();
    const lvl = accessLevel();
    if (avisMsg) {
      avisMsg.style.display = message ? 'block' : 'none';
      avisMsg.textContent = message || '';
    }
    if (avisList) avisList.innerHTML = '';
    if (avisMeta && latest) {
      const edat = Math.round((Date.now() - latest.getTime()) / 60000);
      avisMeta.textContent = `Radar de les ${hourFmt.format(latest)}${edat > 20 ? ` (fa ${edat} min)` : ''}`;
    }
    if (message) return;
    if (!avisList) return;

    if (lvl === 'basic') {
      const byComarca = new Map();
      for (const it of items) {
        const k = it.comarca || '—';
        const prev = byComarca.get(k);
        if (!prev) byComarca.set(k, { comarca: k, max: it.max, level: it.level, count: 1 });
        else { prev.count += 1; if (it.max > prev.max) { prev.max = it.max; prev.level = it.level; } }
      }
      const top = [...byComarca.values()].sort((a, b) => b.max - a.max).slice(0, 3);
      if (top.length === 0) {
        avisList.innerHTML = `<div class="avis-msg visible">Cap comarca amb pluja intensa.</div>`;
        return;
      }
      avisList.innerHTML = top.map((it) => {
        const l = levelInfo(it.level);
        return `<button class="avis-item" disabled>
          <span class="avis-dot" style="background:${l.color}"></span>
          <span class="avis-name">${escapeHtml(it.comarca)}</span>
          <span class="avis-val">${Math.round(it.max)}<small>mm/h</small></span>
        </button>`;
      }).join('');
      return;
    }

    avisList.innerHTML = items.map((it, i) => {
      const l = levelInfo(it.level);
      const sub = [it.comarca, l.name, it.when ? hourFmt.format(it.when) : ''].filter(Boolean).join(' · ');
      return `<button class="avis-item" data-i="${i}">
        <span class="avis-dot" style="background:${l.color}"></span>
        <span class="avis-name">${escapeHtml(it.nom)}<span class="avis-sub">${escapeHtml(sub)}</span></span>
        <span class="avis-val">${Math.round(it.max)}<small>mm/h</small></span>
      </button>`;
    }).join('');
  }

  avisList?.addEventListener('click', (e) => {
    const b = e.target.closest('.avis-item');
    if (!b || b.disabled) return;
    const it = items[Number(b.dataset.i)];
    if (!it || !it.feature) return;
    const bounds = state.avisosBoundsOf?.(it.feature);
    if (bounds) map.fitBounds(bounds, { padding: 90, maxZoom: 11, duration: 1000 });
    if (state.isMobile()) close();
  });

  function open() {
    const lvl = accessLevel();
    if (avisTitle) avisTitle.textContent = lvl === 'basic' ? 'Top 3 comarques · ara mateix' : 'Avisos · ara mateix';
    avisPanel?.classList.add('open');
  }
  function close() { avisPanel?.classList.remove('open'); }
  avisX?.addEventListener('click', close);

  avisBtn?.addEventListener('click', () => {
    if (accessLevel() === 'none') {
      state.upsell?.open?.('free', { title: 'Avisos', text: 'Inicia sessió gratis per veure alertes i avisos.' });
      return;
    }
    if (avisPanel?.classList.contains('open')) close();
    else { open(); refresh().catch(() => {}); }
  });

  chkAvisos?.addEventListener('change', async (e) => {
    const on = e.target.checked;
    if (!on) { layerOn = false; applyVisibility(); return; }
    if (accessLevel() === 'none') {
      chkAvisos.checked = false;
      state.upsell?.open?.('free', { title: 'Avisos de pluja', text: 'Inicia sessió gratis per veure els avisos.' });
      return;
    }
    layerOn = true;
    if (!items.length) await refresh().catch(() => {});
    applyVisibility();
  });

  function clear() {
    key = ''; items = []; latest = null;
    radar.setAvisosData(null);
    close();
    paintBadge();
  }

  async function refresh() {
    try {
      if (state.getResumAlertesCatalunya) alertesCatalunya = await state.getResumAlertesCatalunya();
      else if (alertes?.getResum) alertesCatalunya = await alertes.getResum();
    } catch (e) { console.warn('[avisos] alertes', e); }
    paintBadge();

    if (!hasAvisos()) { clear(); return; }
    if (busy) return;

    const st = radar.getLayerState('dbz');
    if (!st || !st.initialized || !st.frames.length) { render('No hi ha dades de pluja disponibles.'); return; }

    let latestTs = null;
    for (let i = st.timestamps.length - 1; i >= 0; i--) { if (st.timestamps[i]) { latestTs = st.timestamps[i]; break; } }
    if (!latestTs) { render('No hi ha dades de pluja disponibles.'); return; }

    const k = String(latestTs.getTime());
    if (k === key) { render(items.length ? '' : 'Cap municipi amb pluja intensa.'); if (layerOn) applyVisibility(); return; }

    const WINDOW_MIN = state.avisosWindowMin || 30;
    const limit = latestTs.getTime() - WINDOW_MIN * 60000 - 1000;
    const frames = [];
    st.timestamps.forEach((d, i) => { if (d && d.getTime() >= limit) frames.push({ url: st.frames[i], t: d }); });

    busy = true;
    latest = latestTs;
    render('Calculant els avisos…');

    try {
      const municipis = await radar.getMunicipis();
      if (!municipis) { render("No s'han pogut carregar els municipis."); return; }
      if (!state.computeAvisos) { render('Mòdul de càlcul no disponible.'); return; }
      const res = await state.computeAvisos({ frames, municipis });
      items = res.items;
      latest = res.latest || latestTs;
      key = k;
      if (layerOn) applyVisibility();
      render(items.length ? '' : 'Cap municipi amb pluja intensa.');
    } catch (e) {
      console.error('[avisos]', e);
      render("No s'han pogut calcular els avisos.");
    } finally {
      busy = false;
      if (!hasAvisos()) clear();
    }
  }

  if (avisLegend) {
    avisLegend.innerHTML = LEVELS.map((l) => `<span><i style="background:${l.color}"></i>${l.name} ≥ ${l.min} mm/h</span>`).join('');
  }

  state.avisos = { refresh, render, open, close, clear, applyVisibility, paintBadge, paintTierBadge, getItems: () => items, getLatest: () => latest, getAlertes: () => alertesCatalunya };
  paintTierBadge();
  paintBadge();
  return state.avisos;
}
