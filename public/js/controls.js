/* =========================================================
   controls.js — Tempestes.cat
   ========================================================= */

const $ = (id) => document.getElementById(id);

function startClock() {
  const clock = $('tcClock');
  if (!clock) return;
  const tick = () => {
    const d = new Date();
    clock.textContent = `${String(d.getUTCHours()).padStart(2, '0')}:${String(d.getUTCMinutes()).padStart(2, '0')}:${String(d.getUTCSeconds()).padStart(2, '0')} UTC`;
  };
  tick();
  setInterval(tick, 1000);
}

function toggleCheck(id) {
  const el = $(id);
  if (el) {
    el.checked = !el.checked;
    el.dispatchEvent(new Event('change', { bubbles: true }));
  }
}

function markActive(btn, isToggle = false) {
  document.querySelectorAll('.tc-tool[data-action]').forEach((b) => {
    if (b.dataset.action === 'lightning') {
      b.classList.toggle('is-active', $('chkLlamps')?.checked);
    } else if (b.dataset.action === 'terrain') {
      b.classList.toggle('is-active', $('chkRelleu')?.checked);
    } else if (!isToggle && b === btn) {
      b.classList.add('is-active');
    } else if (!isToggle && b !== btn) {
      b.classList.remove('is-active');
    }
  });
}

function handleAction(action, btn, state) {
  switch (action) {
    case 'radar': $('prodDbz')?.click(); break;
    case 'lightning': toggleCheck('chkLlamps'); markActive(btn, true); break;
    case 'terrain': toggleCheck('chkRelleu'); markActive(btn, true); break;
    case 'alerts': $('avisBtn')?.click(); break;
    case 'layers':
    case 'models':
      state.ui?.openPanel?.();
      break;
    case 'frames':
      $('bottomBar')?.scrollIntoView({ behavior: 'smooth', block: 'nearest' });
      break;
    case 'legend': $('legendToggle')?.click(); break;
  }

  if (!['lightning', 'terrain', 'layers', 'models', 'alerts', 'frames', 'legend'].includes(action)) {
    markActive(btn, false);
  }
}

export function initControls({ state }) {
  $('sidePanel')?.classList.remove('open');
  $('sideBackdrop')?.classList.remove('visible');

  document.querySelectorAll('.tc-tool[data-action]').forEach((btn) => {
    btn.addEventListener('click', (e) => {
      e.preventDefault();
      e.stopPropagation();
      handleAction(btn.dataset.action, btn, state);
    });
  });

  if ($('chkLlamps')?.checked) document.querySelector('.tc-tool[data-action="lightning"]')?.classList.add('is-active');
  if ($('chkRelleu')?.checked) document.querySelector('.tc-tool[data-action="terrain"]')?.classList.add('is-active');

  const menu = $('tcOpenMenu');
  if (menu) menu.addEventListener('click', () => $('menuBtn')?.click());

  startClock();

  state.controls = { toggleCheck, markActive };
}
