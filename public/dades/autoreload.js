// public/dades/autoreload.js
// -----------------------------------------------------------------------------
// Recarrega la pàgina quan detecta que el radar ha publicat frames nous a R2.
//
// Com funciona:
//   1) Llegeix els manifests de R2 cada N segons.
//   2) Compara la signatura (nº frames + últim timestamp + últim hash).
//   3) Si ha canviat, mostra un bàner discret a dalt amb compte enrere i
//      recarrega la pàgina.
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
// ESTILS DEL BÀNER
// ---------------------------------------------------------------------------

function injectStyles() {
  if (document.getElementById('autoreload-styles')) return;
  const css = document.createElement('style');
  css.id = 'autoreload-styles';
  css.textContent = `
    #autoreloadBanner {
      position: fixed;
      top: max(12px, env(safe-area-inset-top));
      left: 50%;
      transform: translateX(-50%) translateY(-120%);
      z-index: 9999;
      display: flex; align-items: center; gap: 12px;
      padding: 10px 16px 10px 12px;
      background: rgba(10, 12, 20, 0.92);
      backdrop-filter: blur(14px); -webkit-backdrop-filter: blur(14px);
      border: 1px solid rgba(120, 140, 180, 0.28);
      border-radius: 999px;
      box-shadow: 0 10px 40px rgba(0, 0, 0, 0.55);
      color: #eef;
      font-family: system-ui, -apple-system, "Segoe UI", Roboto, sans-serif;
      font-size: 13px;
      line-height: 1;
      pointer-events: none;
      opacity: 0;
      transition: transform .35s cubic-bezier(.4, 0, .2, 1), opacity .35s ease;
      max-width: calc(100vw - 24px);
    }
    #autoreloadBanner.show {
      transform: translateX(-50%) translateY(0);
      opacity: 1;
    }

    #autoreloadBanner .ar-dot {
      position: relative;
      width: 10px; height: 10px; border-radius: 50%;
      background: #5a9dff;
      flex-shrink: 0;
      box-shadow: 0 0 0 0 rgba(90, 157, 255, 0.6);
      animation: autoreloadPulse 1.6s ease-out infinite;
    }
    @keyframes autoreloadPulse {
      0%   { box-shadow: 0 0 0 0 rgba(90, 157, 255, 0.6); }
      70%  { box-shadow: 0 0 0 10px rgba(90, 157, 255, 0); }
      100% { box-shadow: 0 0 0 0 rgba(90, 157, 255, 0); }
    }

    #autoreloadBanner .ar-text {
      font-weight: 500;
      color: #cfe0ff;
      white-space: nowrap;
      overflow: hidden;
      text-overflow: ellipsis;
    }
    #autoreloadBanner .ar-text b {
      color: #fff;
      font-weight: 700;
    }

    #autoreloadBanner .ar-count {
      display: inline-flex; align-items: center; justify-content: center;
      min-width: 26px; height: 26px; padding: 0 6px;
      border-radius: 999px;
      background: rgba(90, 157, 255, 0.18);
      border: 1px solid rgba(90, 157, 255, 0.45);
      color: #5a9dff;
      font-weight: 700;
      font-variant-numeric: tabular-nums;
      font-size: 13px;
      flex-shrink: 0;
    }

    #autoreloadBanner .ar-bar {
      position: absolute;
      left: 12px; right: 12px; bottom: 4px;
      height: 2px; border-radius: 999px;
      background: rgba(120, 140, 180, 0.18);
      overflow: hidden;
    }
    #autoreloadBanner .ar-bar-fill {
      height: 100%; width: 100%;
      background: linear-gradient(90deg, #3a6ac0, #5a9dff);
      border-radius: 999px;
      transform-origin: left center;
    }

    @media (prefers-reduced-motion: reduce) {
      #autoreloadBanner .ar-dot { animation: none; }
    }
  `;
  document.head.appendChild(css);
}

function buildBanner() {
  let el = document.getElementById('autoreloadBanner');
  if (el) return el;

  el = document.createElement('div');
  el.id = 'autoreloadBanner';
  el.setAttribute('role', 'status');
  el.setAttribute('aria-live', 'polite');
  el.innerHTML = `
    <span class="ar-dot"></span>
    <span class="ar-text">Dades noves · actualitzant en <b id="autoreloadCount">10</b> s</span>
    <span class="ar-count" id="autoreloadCountBadge">10</span>
    <span class="ar-bar"><span class="ar-bar-fill" id="autoreloadBar"></span></span>
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
  const banner = buildBanner();
  const countEl = document.getElementById('autoreloadCount');
  const badgeEl = document.getElementById('autoreloadCountBadge');
  const barEl = document.getElementById('autoreloadBar');

  banner.classList.add('show');

  let remaining = seconds;
  countEl.textContent = String(remaining);
  badgeEl.textContent = String(remaining);

  // Transició de la barra
  barEl.style.transition = 'none';
  barEl.style.transform = 'scaleX(1)';
  void barEl.offsetWidth;
  barEl.style.transition = `transform ${seconds}s linear`;
  barEl.style.transform = 'scaleX(0)';

  const timer = setInterval(() => {
    remaining -= 1;
    const v = Math.max(0, remaining);
    countEl.textContent = String(v);
    badgeEl.textContent = String(v);
    if (remaining <= 0) {
      clearInterval(timer);
      onDone();
    }
  }, 1000);

  return () => {
    clearInterval(timer);
    banner.classList.remove('show');
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

  let signatures = null;
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
      const url = new URL(location.href);
      url.searchParams.set('_r', Date.now().toString());
      location.replace(url.toString());
    });
  }

  check();
  timer = setInterval(check, intervalMs);

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