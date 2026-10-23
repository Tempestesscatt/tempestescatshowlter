/* =========================================================
   ui.js — Tempestes.cat
   ========================================================= */

const $ = (id) => document.getElementById(id);

let sidePanel, sideBackdrop, legendEl, legendToggle, themeClarBtn, themeFoscBtn, menuBtn, panelCloseBtn;

export function openPanel() {
  if (!sidePanel) return;
  sidePanel.classList.add('open');
  sideBackdrop?.classList.add('visible');
}
export function closePanel() {
  if (!sidePanel) return;
  sidePanel.classList.remove('open');
  sideBackdrop?.classList.remove('visible');
}
export function togglePanel() {
  if (!sidePanel) return;
  if (sidePanel.classList.contains('open')) closePanel();
  else openPanel();
}

function paintThemeUI(theme) {
  if (themeClarBtn) themeClarBtn.classList.toggle('active', theme === 'clar');
  if (themeFoscBtn) themeFoscBtn.classList.toggle('active', theme === 'fosc');
  document.body.classList.toggle('theme-clar', theme === 'clar');
  document.body.classList.toggle('theme-fosc', theme === 'fosc');
}

function applyTheme(theme, { map, radar, state, onReload }) {
  if (theme === state.currentTheme) return;
  state.currentTheme = theme;
  try { localStorage.setItem('radar.theme', theme); } catch {}

  paintThemeUI(theme);
  radar.setBaseTheme(theme);

  const BASEMAPS = {
    clar: 'https://tiles.openfreemap.org/styles/positron',
    fosc: 'https://tiles.openfreemap.org/styles/dark',
  };

  map.setStyle(BASEMAPS[theme], { diff: false });
  map.once('style.load', async () => {
    const style = map.getStyle();
    if (style) {
      for (const l of style.layers) {
        if (l.type === 'symbol') {
          try { map.setLayoutProperty(l.id, 'visibility', 'none'); } catch {}
        }
      }
    }
    try { await radar.reapplyLayers(); } catch (e) { console.warn('[ui] reapplyLayers', e); }
    if (typeof onReload === 'function') {
      try { await onReload(); } catch (e) { console.warn('[ui] onReload', e); }
    }
  });
}

function setupPlayerResize() {
  const bottomBar = $('bottomBar');
  if (!bottomBar) return;
  if ('ResizeObserver' in window) {
    const ro = new ResizeObserver((entries) => {
      const h = Math.ceil(entries[0].target.getBoundingClientRect().height);
      if (h > 0) document.documentElement.style.setProperty('--player-h', h + 'px');
    });
    ro.observe(bottomBar);
  }
}

function setupTopBarButtons() {
  menuBtn = $('menuBtn');
  panelCloseBtn = $('panelCloseBtn');
  sidePanel = $('sidePanel');
  sideBackdrop = $('sideBackdrop');
  legendEl = $('legend');
  legendToggle = $('legendToggle');
  themeClarBtn = $('themeClar');
  themeFoscBtn = $('themeFosc');

  menuBtn?.addEventListener('click', openPanel);
  panelCloseBtn?.addEventListener('click', closePanel);
  sideBackdrop?.addEventListener('click', closePanel);

  legendToggle?.addEventListener('click', () => {
    if (!legendEl) return;
    const hidden = legendEl.classList.toggle('hidden');
    legendToggle.classList.toggle('on', !hidden);
  });
}

export function initUI({ map, state, setLoad }) {
  setupTopBarButtons();
  setupPlayerResize();
  paintThemeUI(state.currentTheme);

  themeClarBtn?.addEventListener('click', () => {
    applyTheme('clar', { map, radar: state.radar, state, onReload: state.onThemeReload });
  });
  themeFoscBtn?.addEventListener('click', () => {
    applyTheme('fosc', { map, radar: state.radar, state, onReload: state.onThemeReload });
  });

  document.addEventListener('keydown', (e) => {
    if (e.key === 'Escape' && sidePanel?.classList.contains('open')) closePanel();
  });

  state.ui = {
    openPanel, closePanel, togglePanel, paintThemeUI,
    applyTheme: (theme) => applyTheme(theme, { map, radar: state.radar, state, onReload: state.onThemeReload }),
  };

  if (typeof setLoad === 'function') setLoad(25, 'Interfície llesta');
}
