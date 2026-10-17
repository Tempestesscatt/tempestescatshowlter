// public/dades/autoreload.js
// -----------------------------------------------------------------------------
// Actualització en directe SENSE recarregar la pàgina.
//
// Com funciona:
//   1) Llegeix els manifests de R2 cada N segons (sempre sense caché).
//   2) Compara la signatura (nº frames + updated + últim timestamp + últim hash).
//   3) Si ha canviat, demana a radar.js que rellegeixi els manifests i baixi els
//      frames nous, i COMPROVA que l'últim frame del radar coincideix amb el del
//      manifest. Si encara no hi és, ho reintenta unes quantes vegades.
//   4) Avisa la resta de la pàgina amb l'esdeveniment 'radar:data-updated'
//      (acumulacions, avisos...) i mostra un avís discret.
//
// L'usuari conserva la hora, la pausa/animació i el producte: res no es recarrega.
//
// Ús:
//   import { initAutoReload } from './dades/autoreload.js';
//   initAutoReload();                         // 30 s, sense recarregar
//   initAutoReload({ reload: true });         // (opcional) recàrrega de pàgina com abans
// -----------------------------------------------------------------------------

import * as radar from '../js/radar.js';

const DEFAULT_INTERVAL_MS = 30000;
const VERIFY_TRIES = 8;
const VERIFY_EVERY_MS = 4000;
const DEFAULT_COUNTDOWN_S = 10;

const MANIFESTS = {
  dbz:    'https://radar-data.tempestes.cat/dades_radar_dbz/manifest.json',
  lluvia: 'https://radar-data.tempestes.cat/dades_radar_nimbus/manifest.json',
};

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

// ---------------------------------------------------------------------------
// AVÍS DISCRET (toast)
// ---------------------------------------------------------------------------

function injectStyles() {
  if (document.getElementById('autoreload-styles')) return;
  const css = document.createElement('style');
  css.id = 'autoreload-styles';
  css.textContent = `
    #autoreloadBanner {
      position: fixed; top: max(12px, env(safe-area-inset-top)); left: 50%;
      transform: translateX(-50%) translateY(-140%); z-index: 9999;
      display: flex; align-items: center; gap: 10px; padding: 9px 16px 9px 12px;
      background: rgba(10, 12, 20, 0.92);
      backdrop-filter: blur(14px); -webkit-backdrop-filter: blur(14px);
      border: 1px solid rgba(120, 140, 180, 0.28); border-radius: 999px;
      box-shadow: 0 10px 40px rgba(0, 0, 0, 0.55);
      color: #cfe0ff; font: 500 13px/1 system-ui, -apple-system, "Segoe UI", Roboto, sans-serif;
      pointer-events: none; opacity: 0; max-width: calc(100vw - 24px);
      transition: transform .35s cubic-bezier(.4, 0, .2, 1), opacity .35s ease;
    }
    #autoreloadBanner.show { transform: translateX(-50%) translateY(0); opacity: 1; }
    #autoreloadBanner .ar-dot { width: 10px; height: 10px; border-radius: 50%; background: #5a9dff; flex-shrink: 0; }
    #autoreloadBanner.ok .ar-dot { background: #4ade80; }
    #autoreloadBanner.warn .ar-dot { background: #facc15; }
    #autoreloadBanner .ar-text { white-space: nowrap; overflow: hidden; text-overflow: ellipsis; }
    #autoreloadBanner .ar-text b { color: #fff; font-weight: 700; }
  `;
  document.head.appendChild(css);
}

let toastTimer = 0;
function toast(html, kind, ms = 3500) {
  injectStyles();
  let el = document.getElementById('autoreloadBanner');
  if (!el) {
    el = document.createElement('div');
    el.id = 'autoreloadBanner';
    el.setAttribute('role', 'status');
    el.setAttribute('aria-live', 'polite');
    el.innerHTML = '<span class="ar-dot"></span><span class="ar-text"></span>';
    document.body.appendChild(el);
  }
  el.className = kind || '';
  el.querySelector('.ar-text').innerHTML = html;
  void el.offsetWidth;
  el.classList.add('show');
  clearTimeout(toastTimer);
  toastTimer = setTimeout(() => el.classList.remove('show'), ms);
}

// ---------------------------------------------------------------------------
// MANIFEST
// ---------------------------------------------------------------------------

async function fetchInfo(url) {
  try {
    const r = await fetch(`${url}?t=${Date.now()}`, { cache: 'no-store' });
    if (!r.ok) return null;
    const j = await r.json();
    if (!j || !Array.isArray(j.frames) || j.frames.length === 0) return null;
    const last = j.frames[j.frames.length - 1];
    return {
      sig: `${j.frames.length}|${j.updated || ''}|${last.t || ''}|${last.f || ''}`,
      lastF: last.f || '',
      lastT: last.t || '',
    };
  } catch (e) {
    return null;
  }
}

// "2026-04-20T185500Z" -> ms
function parseT(t) {
  const m = /^(\d{4})-(\d{2})-(\d{2})T(\d{2})(\d{2})(\d{2})Z$/.exec(t || '');
  return m ? Date.UTC(+m[1], +m[2] - 1, +m[3], +m[4], +m[5], +m[6]) : NaN;
}

/** Comprova que l'últim frame que té el radar és el que diu el manifest. */
function radarHasLatest(key, info) {
  try {
    const st = radar.getLayerState(key);
    if (!st || !st.initialized || !st.frames.length) return false;
    const lastUrl = st.frames[st.frames.length - 1] || '';
    if (info.lastF && lastUrl.includes(info.lastF)) return true;
    const want = parseT(info.lastT);
    const ts = st.timestamps[st.timestamps.length - 1];
    return Number.isFinite(want) && ts && ts.getTime() === want;
  } catch (e) {
    return false;
  }
}

const hourFmt = new Intl.DateTimeFormat('ca-ES', { timeZone: 'Europe/Madrid', hour: '2-digit', minute: '2-digit' });

/** Força la lectura i reintenta fins que el radar mostra l'últim frame publicat. */
async function applyUpdate(key, info) {
  let ok = false;
  for (let i = 0; i < VERIFY_TRIES; i++) {
    try {
      if (typeof radar.refreshNow === 'function') await radar.refreshNow();
    } catch (e) { /* es reintenta */ }
    if (radarHasLatest(key, info)) { ok = true; break; }
    await sleep(VERIFY_EVERY_MS);
  }
  return ok;
}

// ---------------------------------------------------------------------------
// API
// ---------------------------------------------------------------------------

/**
 * @param {object}   [opts]
 * @param {number}   [opts.intervalMs=30000]    Cada quant es comprova (ms).
 * @param {string[]} [opts.watch=['dbz','lluvia']]
 * @param {Function} [opts.onChange]            Callback (key, {ok, lastT}) després d'aplicar.
 * @param {boolean}  [opts.reload=false]        true = recarrega la pàgina (comportament antic).
 * @param {number}   [opts.countdownS=10]       Només amb reload:true.
 * @param {boolean}  [opts.notify=true]         Mostra l'avís discret.
 * @returns {Function} Funció per aturar el watcher.
 */
export function initAutoReload({
  intervalMs = DEFAULT_INTERVAL_MS,
  watch = ['dbz', 'lluvia'],
  onChange = null,
  reload = false,
  countdownS = DEFAULT_COUNTDOWN_S,
  notify = true,
} = {}) {
  const urls = watch.filter((k) => MANIFESTS[k]).map((k) => ({ key: k, url: MANIFESTS[k] }));
  if (urls.length === 0) {
    console.warn('[autoreload] cap manifest a vigilar');
    return () => {};
  }

  let signatures = null;
  let stopped = false;
  let busy = false;
  let timer = 0;

  async function check() {
    if (stopped || busy || document.hidden) return;
    busy = true;
    try {
      const current = {};
      await Promise.all(urls.map(async ({ key, url }) => { current[key] = await fetchInfo(url); }));

      if (signatures === null) {
        signatures = {};
        for (const { key } of urls) signatures[key] = current[key] ? current[key].sig : null;
        // Primera lectura: assegura que el radar ja mostra el que hi ha publicat
        for (const { key } of urls) {
          if (current[key] && !radarHasLatest(key, current[key]) && typeof radar.refreshNow === 'function') {
            radar.refreshNow();
            break;
          }
        }
        return;
      }

      for (const { key } of urls) {
        const cur = current[key];
        if (!cur || cur.sig === signatures[key]) continue;

        signatures[key] = cur.sig;
        console.log(`[autoreload] dades noves (${key}) ${cur.lastT}`);

        if (reload) {
          stopped = true;
          if (timer) clearInterval(timer);
          if (typeof onChange === 'function') { try { onChange(key, { ok: false, lastT: cur.lastT }); } catch (e) {} }
          if (notify) toast(`Dades noves · actualitzant en <b>${countdownS}</b> s`, '', countdownS * 1000 + 500);
          setTimeout(() => {
            const u = new URL(location.href);
            u.searchParams.set('_r', Date.now().toString());
            location.replace(u.toString());
          }, countdownS * 1000);
          return;
        }

        const ok = await applyUpdate(key, cur);
        const when = parseT(cur.lastT);
        const hh = Number.isFinite(when) ? hourFmt.format(new Date(when)) : '';

        if (ok) {
          console.log(`[autoreload] ${key} actualitzat (${cur.lastT})`);
          if (notify) toast(`Radar actualitzat${hh ? ` · <b>${hh}</b>` : ''}`, 'ok');
        } else {
          console.warn(`[autoreload] ${key}: el manifest ja és nou però el frame encara no arriba`);
          // Perquè es torni a intentar al proper cicle
          signatures[key] = null;
          if (notify) toast('Dades noves detectades · carregant…', 'warn');
        }

        try { window.dispatchEvent(new CustomEvent('radar:data-updated', { detail: { key, ok, lastT: cur.lastT } })); } catch (e) {}
        if (typeof onChange === 'function') {
          try { onChange(key, { ok, lastT: cur.lastT }); } catch (e) { console.warn('[autoreload] onChange:', e); }
        }
      }
    } finally {
      busy = false;
    }
  }

  check();
  timer = setInterval(check, intervalMs);

  const onVisible = () => { if (!document.hidden) check(); };
  document.addEventListener('visibilitychange', onVisible);
  window.addEventListener('online', onVisible);

  return function stop() {
    stopped = true;
    if (timer) clearInterval(timer);
    document.removeEventListener('visibilitychange', onVisible);
    window.removeEventListener('online', onVisible);
  };
}

export default { initAutoReload };