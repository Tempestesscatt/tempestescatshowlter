/* =========================================================
   legend.js — Tempestes.cat
   ========================================================= */

const $ = (id) => document.getElementById(id);

const DEFAULT_SCALES = {
  dbz: { title: 'dBZ', min: -20, max: 80, log: false, stops: [[-20,[100,100,100]],[0,[50,50,150]],[20,[50,150,50]],[40,[200,200,50]],[60,[200,50,50]],[80,[150,0,0]]], ticks: [-20,0,20,40,60,80] },
  vel: { title: 'km/h', min: -100, max: 100, log: false, stops: [[-100,[0,50,200]],[-50,[0,150,255]],[0,[200,200,200]],[50,[255,150,0]],[100,[200,0,0]]], ticks: [-100,-50,0,50,100] },
  acum: { title: 'mm', min: 0, max: 100, log: true, stops: [[0,[255,255,255]],[1,[150,200,255]],[5,[50,120,255]],[10,[50,200,50]],[25,[255,200,0]],[50,[255,100,0]],[100,[200,0,0]]], ticks: [0,1,5,10,25,50,100] },
};

function legendPct(p, v) {
  if (p.log) {
    const min = Math.log10(Math.max(1e-6, p.min));
    const max = Math.log10(Math.max(1e-5, p.max));
    const val = Math.log10(Math.max(1e-6, v));
    return ((val - min) / (max - min)) * 100;
  }
  return ((v - p.min) / (p.max - p.min)) * 100;
}

function paintLegend(p, title) {
  const legendTitle = $('legendTitle');
  const legendBar = $('legendBar');
  const legendTicks = $('legendTicks');
  if (!legendTitle || !legendBar || !legendTicks) return;
  legendTitle.textContent = title || p.title || '';
  const stops = p.stops.map(([v, c]) => `rgb(${c[0]},${c[1]},${c[2]}) ${legendPct(p, v).toFixed(1)}%`).join(', ');
  legendBar.style.background = `linear-gradient(to top, ${stops})`;
  legendTicks.innerHTML = p.ticks.map((v) => `<span class="legend-tick" style="bottom:${legendPct(p, v).toFixed(1)}%">${v}</span>`).join('');
}

function formatPeriodLabel(mins) {
  if (mins < 60) return `${Math.round(mins)} min`;
  const h = mins / 60;
  if (Number.isInteger(h)) return h === 1 ? '1 hora' : `${h} hores`;
  return `${h.toFixed(1)} hores`;
}

export function initLegend({ state, scales }) {
  const SCALES = scales || state?.scales || DEFAULT_SCALES;

  function render(key) { const p = SCALES[key] || SCALES.dbz; paintLegend(p, p.title); }
  function renderAcum(minutes) { const p = SCALES.acum; paintLegend(p, `${formatPeriodLabel(minutes)} · mm`); }
  function toggle() {
    const legend = $('legend'), btn = $('legendToggle');
    if (!legend) return;
    const hidden = legend.classList.toggle('hidden');
    btn?.classList.toggle('on', !hidden);
  }
  function show() { $('legend')?.classList.remove('hidden'); $('legendToggle')?.classList.add('on'); }
  function hide() { $('legend')?.classList.add('hidden'); $('legendToggle')?.classList.remove('on'); }

  state.legend = { render, renderAcum, toggle, show, hide, scales: SCALES, paint: paintLegend, pct: legendPct };
  render(state?.activeKey || 'dbz');
  return state.legend;
}
