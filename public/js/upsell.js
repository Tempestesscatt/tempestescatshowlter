/* =========================================================
   upsell.js — Tempestes.cat
   ========================================================= */

const $ = (id) => document.getElementById(id);
const PREUS_URL = 'https://tempestes.cat/privacitat/preus';

export const TIERS = ['anon', 'free', 'entusiasta', 'professional'];
export const ACCESS = {
  anon: { minutes: 25, name: 'Sense sessió', window: '25 minuts' },
  free: { minutes: 60, name: 'Compte gratuït', window: '1 hora' },
  entusiasta: { minutes: 180, name: 'Entusiasta', window: '3 hores' },
  professional: { minutes: Infinity, name: 'Professional', window: '24 hores' },
};

export function initUpsell({ state }) {
  const upsell = $('upsell');
  const upsellTitle = $('upsellTitle');
  const upsellText = $('upsellText');
  const upsellTiers = $('upsellTiers');
  const upsellPrimary = $('upsellPrimary');
  const upsellSecondary = $('upsellSecondary');
  const upsellX = $('upsellX');

  if (!upsell) return null;

  async function loginGoogle() {
    try {
      if (state.auth?.loginGoogle) await state.auth.loginGoogle();
      close();
    } catch (e) { console.error('[upsell] loginGoogle', e); }
  }

  const TEXTS = {
    anon: { title: 'Inicia sessió per veure més', text: "Sense compte pots veure els últims 25 minuts. Amb un compte gratuït desbloqueges l'hora sencera.", cta: 'Iniciar sessió amb Google', action: loginGoogle },
    free: { title: 'Inicia sessió per veure 1 hora', text: "Sense compte pots veure els últims 25 minuts. Amb un compte gratuït desbloqueges l'hora sencera.", cta: 'Iniciar sessió amb Google', action: loginGoogle },
    entusiasta: { title: 'Amplia fins a 3 hores', text: 'Aquest tram del radar és del pla Entusiasta.', cta: 'Veure el pla Entusiasta', action: () => { location.href = PREUS_URL + '?pla=entusiasta'; } },
    professional: { title: '24 hores i arxiu', text: "Aquest tram del radar i l'arxiu històric són del pla Professional.", cta: 'Veure el pla Professional', action: () => { location.href = PREUS_URL + '?pla=professional'; } },
  };

  function open(need, custom) {
    if (!upsell) return;
    const here = TIERS.indexOf(state.tier || 'anon');
    const needIdx = TIERS.indexOf(need);
    const t = TEXTS[need] || TEXTS.free;
    if (upsellTitle) upsellTitle.textContent = custom?.title || t.title;
    if (upsellText) upsellText.textContent = custom?.text || t.text;
    if (upsellTiers) {
      upsellTiers.innerHTML = TIERS.map((k, i) => {
        const cls = ['tier-row', i <= here ? 'ok' : '', i === needIdx ? 'need' : '', i === here ? 'here' : ''].filter(Boolean).join(' ');
        return `<div class="${cls}"><b>${ACCESS[k].name}</b><span>${ACCESS[k].window}</span></div>`;
      }).join('');
    }
    if (upsellPrimary) {
      upsellPrimary.textContent = t.cta;
      upsellPrimary.onclick = t.action;
    }
    upsell.classList.add('open');
    upsell.setAttribute('aria-hidden', 'false');
  }

  function close() {
    if (!upsell) return;
    upsell.classList.remove('open');
    upsell.setAttribute('aria-hidden', 'true');
  }

  upsellX?.addEventListener('click', close);
  upsellSecondary?.addEventListener('click', close);
  upsell.addEventListener('click', (e) => { if (e.target === upsell) close(); });
  document.addEventListener('keydown', (e) => { if (e.key === 'Escape' && upsell.classList.contains('open')) close(); });

  state.upsell = { open, close, TIERS, ACCESS, loginGoogle };
  return state.upsell;
}
