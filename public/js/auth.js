/* =========================================================
   auth.js — Tempestes.cat
   ========================================================= */

const $ = (id) => document.getElementById(id);

const DB_URL = 'https://tempestescat-default-rtdb.europe-west1.firebasedatabase.app';
const FIREBASE_CONFIG = {
  apiKey: 'AIzaSyBGcGUk2gsoDaHkg9Yv-nqMJ5_x-QPTMS8',
  authDomain: 'tempestescat.firebaseapp.com',
  projectId: 'tempestescat',
  storageBucket: 'tempestescat.firebasestorage.app',
  messagingSenderId: '683240351775',
  appId: '1:683240351775:web:bc65d73249537b9cc28d2a',
};

const userName = (u) => (u.displayName || '').trim() || (u.email ? u.email.split('@')[0] : 'Usuari');
const escapeHtml = (s) => String(s).replace(/[&<>"']/g, (c) => ({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]));

export function initAuth({ state }) {
  const userBtn = $('userBtn');
  const accountBox = $('accountBox');

  let auth = null, fb = null;
  let resolveReady;
  let readyPromise = new Promise((res) => { resolveReady = res; });
  let settled = false;

  async function fetchPlan(u) {
    try {
      const token = await u.getIdToken();
      const r = await fetch(`${DB_URL}/users/${encodeURIComponent(u.uid)}/pla.json?auth=${token}`, { cache: 'no-store' });
      if (!r.ok) return 'gratuït';
      const k = String((await r.json()) || '').trim().toLowerCase().replace('gratuit', 'gratuït');
      return ['gratuït', 'entusiasta', 'professional', 'equips'].includes(k) ? k : 'gratuït';
    } catch { return 'gratuït'; }
  }

  async function fetchIsAdmin(u) {
    if (!u || !u.email) return false;
    try {
      const token = await u.getIdToken();
      const k = u.email.toLowerCase().replace(/\./g, ',');
      const r = await fetch(`${DB_URL}/admin/${encodeURIComponent(k)}.json?auth=${token}`, { cache: 'no-store' });
      return r.ok && (await r.json()) === true;
    } catch { return false; }
  }

  function updateAccountUI() {
    const u = state.currentUser;
    const tier = state.tier;
    const planLabel = state.planLabel;

    if (!u) {
      if (userBtn) userBtn.innerHTML = '<svg viewBox="0 0 24 24"><circle cx="12" cy="8" r="4"/><path d="M4 21c0-4 3.6-7 8-7s8 3 8 7"/></svg>';
      if (accountBox) {
        accountBox.innerHTML = `
          <div class="acc-line"><span>Historial visible</span><span class="acc-badge">25 minuts</span></div>
          <div class="info-text">Inicia sessió gratis per veure l'hora sencera.</div>
          <div class="acc-actions"><button class="primary" id="accLogin">Iniciar sessió amb Google</button></div>`;
        $('accLogin')?.addEventListener('click', loginGoogle);
      }
      return;
    }

    const nom = userName(u);
    const ini = escapeHtml(nom[0].toUpperCase());
    const avatar = u.photoURL ? `<img src="${escapeHtml(u.photoURL)}" alt="" referrerpolicy="no-referrer">` : ini;

    if (userBtn) userBtn.innerHTML = u.photoURL ? `<img src="${escapeHtml(u.photoURL)}" alt="" referrerpolicy="no-referrer">` : `<span class="ini">${ini}</span>`;

    if (accountBox) {
      const windowLabel = state.access?.[tier]?.window || (tier === 'professional' ? '24 hores' : tier === 'entusiasta' ? '3 hores' : tier === 'free' ? '1 hora' : '25 minuts');
      accountBox.innerHTML = `
        <div class="acc-who">
          <div class="acc-av">${avatar}</div>
          <div style="min-width:0">
            <div class="acc-name">${escapeHtml(nom)}</div>
            <div class="acc-mail">${escapeHtml(u.email || '')}</div>
          </div>
        </div>
        <div class="acc-line"><span>Pla</span><span class="acc-badge">${escapeHtml(planLabel || 'Gratuït')}</span></div>
        <div class="acc-line"><span>Historial visible</span><span>${windowLabel}</span></div>
        <div class="acc-actions">
          ${tier !== 'professional' ? '<a class="primary" href="https://tempestes.cat/privacitat/preus">Veure plans</a>' : ''}
          <button id="accLogout">Tancar sessió</button>
        </div>`;
      $('accLogout')?.addEventListener('click', logout);
    }
  }

  function accessChanged() {
    state.player?.updateAccess?.();
    updateAccountUI();
    state.avisos?.paintTierBadge?.();
    state.avisos?.paintBadge?.();
    if (state.acum && state.acumPeriod && !state.acum.allowed?.(state.acumPeriod)) {
      state.acumPeriod = 30;
      state.acum.stopPlay?.();
      if (state.activeKey === 'acum') { state.acum.showOnMap?.(30); state.legend?.renderAcum?.(30); }
    }
    state.acum?.refresh?.().catch(() => {});
    if (state.appReady) state.avisos?.refresh?.().catch(() => {});
  }

  async function loginGoogle() {
    try {
      await readyPromise;
      if (!auth || !fb) return;
      await fb.signInWithPopup(auth, new fb.GoogleAuthProvider());
      state.upsell?.close?.();
    } catch (e) { console.error('[auth] loginGoogle', e); }
  }

  async function logout() {
    try {
      await readyPromise;
      if (auth && fb) await fb.signOut(auth);
    } catch (e) { console.error('[auth] logout', e); }
  }

  (async () => {
    try {
      const [appMod, authMod] = await Promise.all([
        import('https://www.gstatic.com/firebasejs/10.12.2/firebase-app.js'),
        import('https://www.gstatic.com/firebasejs/10.12.2/firebase-auth.js'),
      ]);
      fb = authMod;
      auth = authMod.getAuth(appMod.initializeApp(FIREBASE_CONFIG));
      authMod.onAuthStateChanged(auth, async (u) => {
        state.currentUser = u;
        if (!u) {
          state.tier = 'anon'; state.planLabel = '';
          accessChanged(); settled = true; resolveReady();
          return;
        }
        state.tier = 'free'; state.planLabel = 'Gratuït';
        accessChanged();
        const [plan, admin] = await Promise.all([fetchPlan(u), fetchIsAdmin(u)]);
        if (state.currentUser !== u) return;
        if (admin) { state.tier = 'professional'; state.planLabel = 'Admin'; }
        else if (plan === 'entusiasta') { state.tier = 'entusiasta'; state.planLabel = 'Entusiasta'; }
        else if (plan === 'professional' || plan === 'equips') { state.tier = 'professional'; state.planLabel = plan === 'equips' ? 'Equips' : 'Professional'; }
        else { state.tier = 'free'; state.planLabel = 'Gratuït'; }
        accessChanged(); settled = true; resolveReady();
      });
    } catch (e) {
      console.warn('[auth] Firebase no disponible', e);
      state.tier = 'anon'; state.planLabel = '';
      settled = true; resolveReady();
    }
  })();

  userBtn?.addEventListener('click', () => {
    if (state.currentUser) state.ui?.openPanel?.();
    else loginGoogle();
  });

  state.auth = { loginGoogle, logout, fetchPlan, fetchIsAdmin, ready: () => readyPromise, updateAccountUI, isSettled: () => settled };
  updateAccountUI();
  return state.auth;
}
