// public/dades/autoreload.js
// -----------------------------------------------------------------------------
// Recarrega la pàgina quan detecta que el radar ha publicat frames nous a R2.
//
// Com funciona:
//   1) Llegeix els manifests de R2 cada N segons.
//   2) Compara la signatura (nº frames + últim timestamp + últim hash).
//   3) Si ha canviat, mostra un comptador de 10 s i recarrega la pàgina.
//
// Pensat per a pantalles de radar "en directe" (kiosk, monitor, TV).
//
// Ús:
//   import { initAutoReload } from './dades/autoreload.js';
//   initAutoReload();                          // per defecte: 60 s, 10 s de compte enrere
//   initAutoReload({ intervalMs: 30000 });     // comprova cada 30 s
// -----------------------------------------------------------------------------

const DEFAULT_INTERVAL_MS = 60000;   // 1 minut
const DEFAULT_COUNTDOWN_S = 10;      // segons abans de recarregar

const MANIFESTS = {
  dbz:    'https://radar-data.tempestes.cat/dades_radar_dbz/manifest.json',
  lluvia: 'https://radar-data.tempestes.cat/dades_radar_nimbus/manifest.json',
};

// ---------------------------------------------------------------------------
// ESTILS DEL COMPTADOR
// ---------------------------------------------------------------------------

function injectStyles() {
  if (document.getElementById('autoreload-styles')) return;
  const css = document.createElement('style');
  css.id = 'autoreload-styles';
  css.textContent = `
    #autoreloadOverlay {
      position: fixed; inset: 0; z-index: 9999;
      display: none; align-items: center; justify-content: center;
      background: rgba(6, 8, 13, 0.78);
      backdrop-filter: blur(6px); -webkit-backdrop-filter: blur(6px);
      font-family: system-ui, -apple-system, "Segoe UI", Roboto, sans-serif;
      color: #eef;
    }
    #autoreloadOverlay.show { display: flex; }
    #autoreloadCard {
      display: flex; flex-direction: column; align-items: center; gap: 18px;
      padding: 32px 44px;
      background: rgba(10, 12, 20, 0.92);
      border: 1px solid rgba(120, 140, 180, 0.28);
      border-radius: 18px;
      box-shadow: 0 20px 60px rgba(0, 0, 0, 0.6);
      text-align: center;
      animation: autoreloadPulse 2s ease-in-out infinite;
    }
    @keyframes autoreloadPulse {
      0%, 100% { transform: scale(1); }
      50%      { transform: scale(1.02); }
    }
    #autoreloadCard .ar-icon {
      width: 54px; height: 54px; border-radius: 50%;
      display: flex; align-items: center; justify-content: center;
      background: rgba(90, 157, 255, 0.18);
      border: 1px solid rgba(90, 157, 255, 0.5);
    }
    #autoreloadCard .ar-icon svg {
      width: 28px; height: 28px;
      stroke: #5a9dff; fill: none; stroke-width: 2;
      stroke-linecap: round; stroke-linejoin: round;
      animation: autoreloadSpin 2.4s linear infinite;
    }
    @keyframes autoreloadSpin {
      from { transform: rotate(0deg); }
      to   { transform: rotate(360deg); }
    }
    #autoreloadCard .ar-title {
      font-size: 20px; font-weight: 700; letter-spacing: .3px;
    }
    #autoreloadCard .ar-sub {
      font-size: 13px; color: #8fa5cb; max-width: 300px; line-height: 1.5;
    }
    #autoreloadCard .ar-count {
      font-size: 56px; font-weight: 800; line-height: 1;
      color: #5a9dff; font-variant-numeric: tabular-nums;
      text-shadow: 0 0 24px rgba(90, 157, 255, 0.5);
    }
    #autoreloadCard .ar-bar {
      width: 220px; height: 5px; border-radius: 999px;
      background: rgba(120, 140, 180, 0.2);
      overflow: hidden;
    }
    #autoreloadCard .ar-bar-fill {
      height: 100%; width: 100%;
      background: linear-gradient(90deg, #3a6ac0, #5a9dff);
      border-radius: 999px;
      transform-origin: left center;
    }
    @media (prefers-reduced-motion: reduce) {
      #autoreloadCard { animation: none; }
      #autoreloadCard .ar-icon svg { animation: none; }
    }
  `;
  document.head.appendChild(css);
}

function buildOverlay() {
  let el = document.getElementById('autoreloadOverlay');
  if (el) return el;

  el = document.createElement('div');
  el.id = 'autoreloadOverlay';
  el.innerHTML = `
    <div id="autoreloadCard">
      <div class="ar-icon">
        <svg viewBox="0 0 24 24">
          <path d="M21 12a9 9 0 1 1-3-6.7"/>
          <polyline points="21 3 21 9 15 9"/>
        </svg>
      </div>
      <div class="ar-title">Actualitzant el radar</div>
      <div class="ar-sub">Hi ha dades noves. La pàgina es recarregarà automàticament.</div>
      <div class="ar-count" id="autoreloadCount">10</div>
      <div class="ar-bar"><div class="ar-bar-fill" id="autoreloadBar"></div></div>
    </div>
  `;
  document.body.appendChild(el);
  return el;
}

// ---------------------------------------------------------------------------
// SIGNATURA DEL MANIFEST
// ---------------------------------------------------------------------------

async function fetchSignature(url) {
  try {
    const r = await fetch(`${url}?t=${Date.now()}`, { cache: 'no-store' });
    if (!r.ok) return null;
    const j = await r.json();
    if (!j || !Array.isArray(j.frames) || j.frames.length === 0) return null;
    const last = j.frames[j.frames.length - 1];
    return `${j.frames.length}|${j.updated || ''}|${last.t || ''}|${last.f || ''}`;
  } catch (e) {
    return null;
  }
}

// ---------------------------------------------------------------------------
// COMPTADOR I RECÀRREGA
// ---------------------------------------------------------------------------

function showCountdown(seconds, onDone) {
  injectStyles();
  const overlay = buildOverlay();
  const countEl = document.getElementById('autoreloadCount');
  const barEl = document.getElementById('autoreloadBar');

  overlay.classList.add('show');

  let remaining = seconds;
  countEl.textContent = String(remaining);
  barEl.style.transform = 'scaleX(1)';

  // Transició suau de la barra
  barEl.style.transition = `transform ${seconds}s linear`;
  // Forcem un reflow perquè la transició s'apliqui
  void barEl.offsetWidth;
  barEl.style.transform = 'scaleX(0)';

  const timer = setInterval(() => {
    remaining -= 1;
    countEl.textContent = String(Math.max(0, remaining));
    if (remaining <= 0) {
      clearInterval(timer);
      onDone();
    }
  }, 1000);

  return () => {
    clearInterval(timer);
    overlay.classList.remove('show');
  };
}

// ---------------------------------------------------------------------------
// API
// ---------------------------------------------------------------------------

/**
 * @param {object}   [opts]
 * @param {number}   [opts.intervalMs=60000]     Cada quant es comprova (ms).
 * @param {number}   [opts.countdownS=10]        Segons del comptador abans de recarregar.
 * @param {string[]} [opts.watch=['dbz','lluvia']]  Quins manifests vigilar.
 * @param {Function} [opts.onChange]             Callback en detectar canvi.
 * @param {boolean}  [opts.reload=true]          Si false, només crida onChange.
 * @returns {Function}  Funció per aturar el watcher.
 */
export function initAutoReload({
  intervalMs = DEFAULT_INTERVAL_MS,
  countdownS = DEFAULT_COUNTDOWN_S,
  watch = ['dbz', 'lluvia'],
  onChange = null,
  reload = true,
} = {}) {
  const urls = watch.filter((k) => MANIFESTS[k]).map((k) => ({ key: k, url: MANIFESTS[k] }));
  if (urls.length === 0) {
    console.warn('[autoreload] cap manifest a vigilar');
    return () => {};
  }

  let signatures = null;   // primera lectura
  let stopped = false;
  let timer = 0;
  let counting = false;
  let cancelCountdown = null;

  async function check() {
    if (stopped || counting) return;
    if (document.hidden) return;

    const current = {};
    for (const { key, url } of urls) {
      current[key] = await fetchSignature(url);
    }

    if (signatures === null) {
      signatures = current;
      return;
    }

    let changedKey = null;
    for (const { key } of urls) {
      if (current[key] && current[key] !== signatures[key]) {
        changedKey = key;
        break;
      }
    }

    if (!changedKey) {
      signatures = current;
      return;
    }

    // Hi ha canvi: parem el watcher i mostrem el comptador
    stopped = true;
    if (timer) clearInterval(timer);
    counting = true;

    console.log(`[autoreload] manifest canviat (${changedKey}): recarregant en ${countdownS} s`);

    if (typeof onChange === 'function') {
      try { onChange(changedKey); } catch (e) { console.warn('[autoreload] onChange:', e); }
    }

    if (!reload) {
      counting = false;
      return;
    }

    cancelCountdown = showCountdown(countdownS, () => {
      counting = false;
      // Recàrrega forçada (ignora caché)
      const url = new URL(location.href);
      url.searchParams.set('_r', Date.now().toString());
      location.replace(url.toString());
    });
  }

  // Primera lectura immediata per inicialitzar signatures
  check();

  timer = setInterval(check, intervalMs);

  // Quan la pestanya torna a ser visible, comprova de seguida
  const onVisible = () => { if (!document.hidden) check(); };
  document.addEventListener('visibilitychange', onVisible);

  return function stop() {
    stopped = true;
    if (timer) clearInterval(timer);
    if (cancelCountdown) cancelCountdown();
    document.removeEventListener('visibilitychange', onVisible);
  };
}

export default { initAutoReload };