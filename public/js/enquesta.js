/* =====================================================================
   enquesta.js · Enquesta "typeform-style" per a TEMPESTES.CAT
   ---------------------------------------------------------------------
   · Una pregunta per pantalla amb animació de slide
   · Barra de progrés
   · No demana login si ja estàs autenticat (mostra qui respon)
   · Si NO estàs loguejat, mostra un botó per fer-ho
   · Desa a Firebase RTDB: /enquesta/respostes/{uid}
   · Només una resposta per usuari
   · Salt intel·ligent segons el pla/cicle clicat a preus.html
   · Preguntes extra per al pla Equips (necessitats + motiu)
   · Panell d'admin: NOMÉS visible per a tempestescat@gmail.com
   · Exportació CSV
   · Icones SVG pròpies (hereten el color del tema)
   ===================================================================== */

const DB_URL = 'https://tempestescat-default-rtdb.europe-west1.firebasedatabase.app';
const RUTA_RESPOSTES = DB_URL + '/enquesta/respostes';
const RUTA_ADMIN = DB_URL + '/admin';

/* 👇 NOMÉS aquest correu veu el panell d'administrador.
   Els altres admins (a /admin) segueixen tenint pla premium,
   però NO veuen les respostes de l'enquesta. */
const ADMIN_PANELL = 'tempestescat@gmail.com';

/* ───────────────────────────────────────────────────────────────────
   ICONES SVG
   ─────────────────────────────────────────────────────────────────── */
const ICONES = {
  fletxaDreta: `<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M5 12h14M13 5l7 7-7 7"/></svg>`,
  fletxaEsq: `<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M19 12H5M11 5l-7 7 7 7"/></svg>`,
  check: `<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.4" stroke-linecap="round" stroke-linejoin="round"><path d="M20 6L9 17l-5-5"/></svg>`,
  enviar: `<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round"><path d="M22 2L11 13M22 2l-7 20-4-9-9-4 20-7z"/></svg>`,
  tanca: `<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M18 6L6 18M6 6l12 12"/></svg>`,

  nuvol: `<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.7" stroke-linecap="round" stroke-linejoin="round"><path d="M17.5 19H9a7 7 0 1 1 6.71-9h1.79a4.5 4.5 0 1 1 0 9z"/></svg>`,
  llamp: `<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.7" stroke-linecap="round" stroke-linejoin="round"><path d="M13 2L3 14h9l-1 8 10-12h-9l1-8z"/></svg>`,
  edifici: `<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.7" stroke-linecap="round" stroke-linejoin="round"><path d="M3 21h18M5 21V7l7-4 7 4v14M9 21v-4h6v4M9 9h.01M15 9h.01M9 13h.01M15 13h.01"/></svg>`,
  gratis: `<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.7" stroke-linecap="round" stroke-linejoin="round"><circle cx="12" cy="12" r="9"/><path d="M9 9.5c0-1.1.9-2 2-2h2a2 2 0 0 1 0 4h-2a2 2 0 0 0 0 4h2c1.1 0 2-.9 2-2M12 6v2M12 16v2"/></svg>`,
  cor: `<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.7" stroke-linecap="round" stroke-linejoin="round"><path d="M20.84 4.61a5.5 5.5 0 0 0-7.78 0L12 5.67l-1.06-1.06a5.5 5.5 0 0 0-7.78 7.78l1.06 1.06L12 21.23l7.78-7.78 1.06-1.06a5.5 5.5 0 0 0 0-7.78z"/></svg>`,
  polze: `<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.7" stroke-linecap="round" stroke-linejoin="round"><path d="M7 10v12M15 5.88L14 10h5.83a2 2 0 0 1 1.92 2.56l-2.33 8A2 2 0 0 1 17.5 22H4a2 2 0 0 1-2-2v-8a2 2 0 0 1 2-2h2.76a2 2 0 0 0 1.79-1.11L12 2a3.13 3.13 0 0 1 3 3.88z"/></svg>`,
  pensatiu: `<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.7" stroke-linecap="round" stroke-linejoin="round"><circle cx="12" cy="12" r="9"/><path d="M9.09 9a3 3 0 0 1 5.83 1c0 2-3 3-3 3M12 17h.01"/></svg>`,
  trist: `<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.7" stroke-linecap="round" stroke-linejoin="round"><circle cx="12" cy="12" r="9"/><path d="M16 16s-1.5-2-4-2-4 2-4 2M9 9h.01M15 9h.01"/></svg>`,
  calendari: `<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.7" stroke-linecap="round" stroke-linejoin="round"><rect x="3" y="4" width="18" height="18" rx="2"/><path d="M16 2v4M8 2v4M3 10h18"/></svg>`,
  moneda: `<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.7" stroke-linecap="round" stroke-linejoin="round"><circle cx="12" cy="12" r="9"/><path d="M12 6v12M15 9.5a2.5 2.5 0 0 0-2.5-2.5h-1a2 2 0 0 0 0 4h1a2 2 0 0 1 0 4h-1A2.5 2.5 0 0 1 9 12.5"/></svg>`,
  dubte: `<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.7" stroke-linecap="round" stroke-linejoin="round"><circle cx="12" cy="12" r="9"/><path d="M9.09 9a3 3 0 0 1 5.83 1c0 2-3 3-3 3M12 17h.01"/></svg>`,
  grafic: `<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.7" stroke-linecap="round" stroke-linejoin="round"><path d="M3 3v18h18M7 15l4-4 4 4 5-6"/></svg>`,
  tempesta: `<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.7" stroke-linecap="round" stroke-linejoin="round"><path d="M17.5 16H9a7 7 0 1 1 6.71-9h1.79a4.5 4.5 0 1 1 0 9zM13 12l-2 4h3l-2 4"/></svg>`,
  capes: `<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.7" stroke-linecap="round" stroke-linejoin="round"><path d="M12 2L2 7l10 5 10-5-10-5zM2 17l10 5 10-5M2 12l10 5 10-5"/></svg>`,
  calculadora: `<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.7" stroke-linecap="round" stroke-linejoin="round"><rect x="4" y="2" width="16" height="20" rx="2"/><path d="M8 6h8M8 10h.01M12 10h.01M16 10h.01M8 14h.01M12 14h.01M16 14h.01M8 18h.01M12 18h.01M16 18h.01"/></svg>`,
  radar: `<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.7" stroke-linecap="round" stroke-linejoin="round"><path d="M12 12l7-7"/><circle cx="12" cy="12" r="2"/><path d="M4.93 19.07A10 10 0 1 1 19.07 4.93M7.76 16.24a6 6 0 1 1 8.48-8.48"/></svg>`,
  api: `<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.7" stroke-linecap="round" stroke-linejoin="round"><rect x="2" y="6" width="20" height="12" rx="2"/><path d="M6 10h.01M10 10h.01M14 10h.01M18 10h.01M6 14h8"/></svg>`,
  campana: `<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.7" stroke-linecap="round" stroke-linejoin="round"><path d="M18 8A6 6 0 0 0 6 8c0 7-3 9-3 9h18s-3-2-3-9M13.73 21a2 2 0 0 1-3.46 0"/></svg>`,
  campanaOff: `<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.7" stroke-linecap="round" stroke-linejoin="round"><path d="M13.73 21a2 2 0 0 1-3.46 0M18.63 13A17.89 17.89 0 0 1 18 8M6.26 6.26A5.86 5.86 0 0 0 6 8c0 7-3 9-3 9h14M18 8a6 6 0 0 0-9.33-5M2 2l20 20"/></svg>`,
  descarregar: `<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.7" stroke-linecap="round" stroke-linejoin="round"><path d="M21 15v4a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2v-4M7 10l5 5 5-5M12 15V3"/></svg>`,
  refrescar: `<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.7" stroke-linecap="round" stroke-linejoin="round"><path d="M23 4v6h-6M1 20v-6h6"/><path d="M3.51 9a9 9 0 0 1 14.85-3.36L23 10M1 14l4.64 4.36A9 9 0 0 0 20.49 15"/></svg>`,
  tauler: `<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.7" stroke-linecap="round" stroke-linejoin="round"><rect x="3" y="3" width="18" height="18" rx="2"/><path d="M3 9h18M9 21V9"/></svg>`
};

/* ───────────────────────────────────────────────────────────────────
   PREGUNTES (amb condicions de visibilitat)
   ─────────────────────────────────────────────────────────────────── */
const PREGUNTES = [
  {
    id: 'pla',
    tipus: 'single',
    titol: 'Quin pla t\'interessaria més?',
    hint: 'Tria el que més s\'acosti al que necessites.',
    condicio: () => !ESTAT.preseleccionat,
    opcions: [
      { valor: 'entusiasta',   ico: 'nuvol',    text: 'Entusiasta',  sub: '4,99 €/mes' },
      { valor: 'professional', ico: 'llamp',    text: 'Professional', sub: '9,99 €/mes' },
      { valor: 'equips',       ico: 'edifici',  text: 'Equips', sub: 'per a mitjans, agències, universitats…' },
      { valor: 'cap',          ico: 'gratis',   text: 'De moment cap', sub: 'em quedo amb el Gratuït' }
    ]
  },
  {
    id: 'preu',
    tipus: 'single',
    titol: 'Què et semblen els preus?',
    hint: 'Siguis sincer, no et compromet a res.',
    condicio: () => ESTAT.respostes.pla !== 'cap',
    opcions: [
      { valor: 'barat',     ico: 'cor',       text: 'Barats' },
      { valor: 'just',      ico: 'polze',     text: 'Justos' },
      { valor: 'car',       ico: 'pensatiu',  text: 'Una mica cars' },
      { valor: 'massa_car', ico: 'trist',     text: 'Massa cars, no pagaria' }
    ]
  },
  {
    id: 'cicle',
    tipus: 'single',
    titol: 'Com preferiries pagar?',
    hint: 'El pagament anual té un descompte de fins al 17%.',
    condicio: () => ESTAT.respostes.pla !== 'cap',
    opcions: [
      { valor: 'mensual', ico: 'calendari', text: 'Mensual' },
      { valor: 'anual',   ico: 'moneda',    text: 'Anual', sub: 'estalvi fins al 17%' },
      { valor: 'nols',    ico: 'dubte',     text: 'No ho sé' }
    ]
  },
  {
    id: 'equips_necessitats',
    tipus: 'text',
    titol: 'Què necessitaries exactament?',
    hint: 'Explica\'ns què necessita el teu equip, mitjà o institució.',
    placeholder: 'Ex: 5 comptes d\'usuari, accés a l\'API per integrar-ho al nostre web, facturació a nom d\'empresa…',
    maxlength: 500,
    condicio: () => ESTAT.respostes.pla === 'equips'
  },
  {
    id: 'equips_motiu',
    tipus: 'text',
    titol: 'I per a què ho faríeu servir?',
    hint: 'Ens ajuda a entendre el teu cas d\'ús.',
    placeholder: 'Ex: som un mitjà local i volem fer seguiment d\'episodis severs…',
    maxlength: 500,
    condicio: () => ESTAT.respostes.pla === 'equips'
  },
  {
    id: 'funcions',
    tipus: 'multi',
    titol: 'Quines funcions et fan més falta?',
    hint: 'Pots triar-ne diverses.',
    opcions: [
      { valor: 'skewt',    ico: 'grafic',      text: 'Skew-T complet' },
      { valor: 'convecio', ico: 'tempesta',    text: 'Variables avançades de convecció' },
      { valor: 'pressio',  ico: 'capes',       text: 'Nivells de pressió' },
      { valor: 'indexs',   ico: 'calculadora', text: 'Índexs compostos (EHI, SCP, STP)' },
      { valor: 'radar',    ico: 'radar',       text: 'Radar ampliat / 24 h' },
      { valor: 'api',      ico: 'api',         text: 'API de dades' }
    ]
  },
  {
    id: 'comentari',
    tipus: 'text',
    titol: 'Algun comentari o suggeriment?',
    hint: 'Opcional. Què hi afegiries, treuries o canviaries?',
    placeholder: 'Escriu el que vulguis…',
    maxlength: 500
  },
  {
    id: 'avisar',
    tipus: 'single',
    titol: 'Vols que t\'avisem quan surtin?',
    hint: 'T\'enviarem un correu quan els plans premium estiguin disponibles.',
    opcions: [
      { valor: '1', ico: 'campana',    text: 'Sí, avisa\'m per correu' },
      { valor: '0', ico: 'campanaOff', text: 'No, gràcies' }
    ]
  }
];

const ETIQ = {
  pla: { entusiasta: 'Entusiasta', professional: 'Professional', equips: 'Equips', cap: 'Cap (Gratuït)' },
  preu: { barat: 'Barats', just: 'Justos', car: 'Una mica cars', massa_car: 'Massa cars' },
  cicle: { mensual: 'Mensual', anual: 'Anual', nols: 'No ho sap' },
  funcions: { skewt: 'Skew-T', convecio: 'Convecció avançada', pressio: 'Nivells de pressió', indexs: 'Índexs compostos', radar: 'Radar ampliat', api: 'API de dades' }
};

/* ───────────────────────────────────────────────────────────────────
   ESTAT
   ─────────────────────────────────────────────────────────────────── */
const ESTAT = {
  preguntaActual: 0,
  respostes: {},
  animant: false,
  jaRespost: false,
  preseleccionat: false
};

let respostesAdmin = [];
let esAdmin = false;        // admin general (a /admin de Firebase) → pla Professional
let esAdminPanell = false;  // NOMÉS pot veure el panell → ADMIN_PANELL

const $ = (s, ctx = document) => ctx.querySelector(s);
const $$ = (s, ctx = document) => Array.from(ctx.querySelectorAll(s));
const esc = s => String(s == null ? '' : s)
  .replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;')
  .replace(/"/g, '&quot;').replace(/'/g, '&#39;');
const cont = () => document.getElementById('enq');
const contAdmin = () => document.getElementById('enqAdmin');

function preguntesVisibles() {
  return PREGUNTES.filter(p => !p.condicio || p.condicio());
}

/* ───────────────────────────────────────────────────────────────────
   API
   ─────────────────────────────────────────────────────────────────── */
async function api(metode, url, cos) {
  const user = window._fbUser;
  if (!user) throw new Error('No autenticat');
  const token = await user.getIdToken();
  const sep = url.includes('?') ? '&' : '?';
  const opts = { method: metode, cache: 'no-store' };
  if (cos) {
    opts.body = JSON.stringify(cos);
    opts.headers = { 'Content-Type': 'application/json' };
  }
  return fetch(url + sep + 'auth=' + token, opts);
}

/* Comprova si l'usuari és admin a /admin de Firebase (permís general) */
async function comprovarAdmin() {
  const user = window._fbUser;
  if (!user || !user.email) return false;
  try {
    const r = await fetch(RUTA_ADMIN + '.json', { cache: 'no-store' });
    if (!r.ok) return false;
    const admins = await r.json() || {};
    const clau = user.email.toLowerCase().replace(/\./g, ',');
    return admins[clau] === true;
  } catch (e) { return false; }
}

/* Comprova si l'usuari pot VEURE EL PANELL (només ADMIN_PANELL) */
function potVeurePanell() {
  const user = window._fbUser;
  if (!user || !user.email) return false;
  return user.email.toLowerCase() === ADMIN_PANELL.toLowerCase();
}

/* ───────────────────────────────────────────────────────────────────
   RENDER SHELL
   ─────────────────────────────────────────────────────────────────── */
function renderShell() {
  const el = cont();
  if (!el) return;
  el.innerHTML = `
    <button type="button" class="enq-tanca" id="enqTanca" aria-label="Tanca">${ICONES.tanca}</button>

    <div class="enq-shell" id="enqPantallaLogin" hidden>
      <div class="enq-pantalla">
        <div class="icona"><i class="fa-solid fa-clipboard-list"></i></div>
        <h3>Ajuda'ns a decidir els plans</h3>
        <p>Són unes preguntes i tardes menys d'un minut. Per respondre necessitem que iniciïs sessió (així evitem respostes duplicades).</p>
        <button type="button" class="enq-btn-pill" id="enqBtnLogin">
          <i class="fa-brands fa-google"></i> Inicia sessió amb Google
        </button>
      </div>
    </div>

    <div class="enq-shell" id="enqPantallaPregunta" hidden>
      <div class="enq-progress"><div class="bar" id="enqBar"></div></div>
      <div class="enq-head">
        <span class="step" id="enqStep"></span>
        <span class="qui" id="enqQui"></span>
      </div>
      <div class="enq-body" id="enqBody"></div>
      <div class="enq-foot">
        <button type="button" class="enrere" id="enqEnrere">
          ${ICONES.fletxaEsq} Enrere
        </button>
        <div class="enq-espai"></div>
        <button type="button" class="seguent" id="enqSeguent">
          Següent ${ICONES.fletxaDreta}
        </button>
      </div>
    </div>

    <div class="enq-shell" id="enqPantallaFet" hidden>
      <div class="enq-pantalla">
        <div class="enq-ok-icon">${ICONES.check}</div>
        <h3>Gràcies per la teva resposta!</h3>
        <p>Ens ajudarà molt a decidir com seran els plans premium de TEMPESTES.CAT.</p>
        <button type="button" class="enq-btn-pill" id="enqBtnTancarFet">
          Tanca
        </button>
      </div>
    </div>
  `;
}

function mostrarPantalla(nom) {
  $('#enqPantallaLogin').hidden    = nom !== 'login';
  $('#enqPantallaPregunta').hidden = nom !== 'pregunta';
  $('#enqPantallaFet').hidden      = nom !== 'fet';
}

function pintarUsuariCapcalera() {
  const el = $('#enqQui');
  if (!el) return;
  const u = window._fbUser;
  if (!u) { el.innerHTML = ''; return; }
  const nom = u.displayName || (u.email ? u.email.split('@')[0] : 'Usuari');
  const inicial = nom[0].toUpperCase();
  const avatar = u.photoURL
    ? `<img src="${esc(u.photoURL)}" alt="" referrerpolicy="no-referrer">`
    : `<span>${esc(inicial)}</span>`;
  el.innerHTML = `
    <span class="qui-avatar">${avatar}</span>
    <span class="qui-nom">${esc(nom)}</span>
  `;
}

/* ───────────────────────────────────────────────────────────────────
   RENDER PREGUNTA
   ─────────────────────────────────────────────────────────────────── */
function renderPregunta(index) {
  const visibles = preguntesVisibles();
  const p = visibles[index];
  if (!p) { enviarEnquesta(); return; }

  const body = $('#enqBody');
  if (!body) return;

  const val = ESTAT.respostes[p.id];

  let htmlOpts = '';
  if (p.tipus === 'single') {
    htmlOpts = `<div class="enq-opcions">${p.opcions.map(o => `
      <label class="enq-op" data-tipus="single">
        <input type="radio" name="${p.id}" value="${esc(o.valor)}" ${val === o.valor ? 'checked' : ''}>
        <span class="marca"></span>
        <span class="ico">${ICONES[o.ico] || ''}</span>
        <span class="text">
          <span class="titol">${esc(o.text)}</span>
          ${o.sub ? `<span class="sub">${esc(o.sub)}</span>` : ''}
        </span>
      </label>`).join('')}</div>`;
  } else if (p.tipus === 'multi') {
    const arr = Array.isArray(val) ? val : [];
    htmlOpts = `<div class="enq-opcions">${p.opcions.map(o => `
      <label class="enq-op" data-tipus="multi">
        <input type="checkbox" name="${p.id}" value="${esc(o.valor)}" ${arr.includes(o.valor) ? 'checked' : ''}>
        <span class="marca"></span>
        <span class="ico">${ICONES[o.ico] || ''}</span>
        <span class="text">
          <span class="titol">${esc(o.text)}</span>
          ${o.sub ? `<span class="sub">${esc(o.sub)}</span>` : ''}
        </span>
      </label>`).join('')}</div>`;
  } else if (p.tipus === 'text') {
    htmlOpts = `<textarea class="enq-textarea" id="enqText" maxlength="${p.maxlength || 500}"
      placeholder="${esc(p.placeholder || '')}">${esc(val || '')}</textarea>`;
  }

  body.innerHTML = `
    <div class="enq-slide" id="enqSlide">
      <h3>${esc(p.titol)}</h3>
      ${p.hint ? `<p class="hint">${esc(p.hint)}</p>` : ''}
      ${htmlOpts}
    </div>
  `;

  const totalVisibles = visibles.length;
  const pct = (index / totalVisibles) * 100;
  $('#enqBar').style.width = pct + '%';
  $('#enqStep').textContent = `Pregunta ${index + 1} de ${totalVisibles}`;
  $('#enqEnrere').disabled = index === 0;

  actualitzarBotoSeguent();
  pintarUsuariCapcalera();

  if (p.tipus === 'single') {
    $$('input[name="' + p.id + '"]', body).forEach(inp => {
      inp.addEventListener('change', () => {
        ESTAT.respostes[p.id] = inp.value;
        actualitzarBotoSeguent();
        setTimeout(() => { if (!ESTAT.animant) seguent(); }, 280);
      });
    });
  } else if (p.tipus === 'multi') {
    $$('input[name="' + p.id + '"]', body).forEach(inp => {
      inp.addEventListener('change', () => {
        ESTAT.respostes[p.id] = $$('input[name="' + p.id + '"]:checked', body).map(x => x.value);
        actualitzarBotoSeguent();
      });
    });
  } else if (p.tipus === 'text') {
    const ta = $('#enqText', body);
    if (ta) {
      ta.addEventListener('input', () => {
        ESTAT.respostes[p.id] = ta.value;
        actualitzarBotoSeguent();
      });
      ta.addEventListener('keydown', e => {
        if (e.key === 'Enter' && !e.shiftKey) {
          e.preventDefault();
          if (!ESTAT.animant) seguent();
        }
      });
      setTimeout(() => ta.focus(), 100);
    }
  }

  requestAnimationFrame(() => {
    const slide = $('#enqSlide', body);
    if (slide) slide.classList.add('actiu');
  });
}

function actualitzarBotoSeguent() {
  const visibles = preguntesVisibles();
  const p = visibles[ESTAT.preguntaActual];
  if (!p) return;
  const btn = $('#enqSeguent');
  if (!btn) return;

  let ok = false;
  const val = ESTAT.respostes[p.id];
  if (p.tipus === 'single') ok = !!val;
  else if (p.tipus === 'multi') ok = Array.isArray(val) && val.length > 0;
  else if (p.tipus === 'text') {
    if (p.id.startsWith('equips_')) ok = typeof val === 'string' && val.trim().length >= 3;
    else ok = true;
  }

  const esUltima = ESTAT.preguntaActual === visibles.length - 1;
  btn.innerHTML = esUltima
    ? `Envia l'enquesta ${ICONES.enviar}`
    : `Següent ${ICONES.fletxaDreta}`;
  btn.disabled = !ok;
}

/* ───────────────────────────────────────────────────────────────────
   NAVEGACIÓ
   ─────────────────────────────────────────────────────────────────── */
function seguent() {
  if (ESTAT.animant) return;
  const visibles = preguntesVisibles();
  const p = visibles[ESTAT.preguntaActual];
  if (!p) return;

  const val = ESTAT.respostes[p.id];
  let ok = false;
  if (p.tipus === 'single') ok = !!val;
  else if (p.tipus === 'multi') ok = Array.isArray(val) && val.length > 0;
  else if (p.tipus === 'text') {
    if (p.id.startsWith('equips_')) ok = typeof val === 'string' && val.trim().length >= 3;
    else ok = true;
  }
  if (!ok) {
    window.mostrarToast && window.mostrarToast('Completa aquesta pregunta', 'error');
    return;
  }

  if (ESTAT.preguntaActual >= visibles.length - 1) {
    enviarEnquesta();
    return;
  }

  ESTAT.animant = true;
  const slide = $('#enqSlide');
  if (slide) slide.classList.add('sortint');
  setTimeout(() => {
    ESTAT.preguntaActual++;
    renderPregunta(ESTAT.preguntaActual);
    ESTAT.animant = false;
  }, 240);
}

function enrere() {
  if (ESTAT.animant || ESTAT.preguntaActual === 0) return;
  ESTAT.animant = true;
  const slide = $('#enqSlide');
  if (slide) slide.classList.add('sortint');
  setTimeout(() => {
    ESTAT.preguntaActual--;
    renderPregunta(ESTAT.preguntaActual);
    ESTAT.animant = false;
  }, 240);
}

/* ───────────────────────────────────────────────────────────────────
   ENVIAR
   ─────────────────────────────────────────────────────────────────── */
async function enviarEnquesta() {
  const user = window._fbUser;
  if (!user) { window.mostrarToast && window.mostrarToast('Cal iniciar sessió', 'error'); return; }

  const btn = $('#enqSeguent');
  if (btn) { btn.disabled = true; btn.innerHTML = '<span class="spinner"></span> Enviant…'; }

  const r = ESTAT.respostes;
  const cos = {
    pla: r.pla || '',
    preu: r.preu || '',
    cicle: r.cicle || '',
    funcions: Array.isArray(r.funcions) ? r.funcions : [],
    comentari: (r.comentari || '').toString().trim().slice(0, 500),
    equips_necessitats: (r.equips_necessitats || '').toString().trim().slice(0, 500),
    equips_motiu: (r.equips_motiu || '').toString().trim().slice(0, 500),
    avisar: r.avisar === '1',
    nom: user.displayName || '',
    email: user.email || '',
    data: Date.now()
  };

  try {
    const resp = await api('PUT', RUTA_RESPOSTES + '/' + encodeURIComponent(user.uid) + '.json', cos);
    if (resp.ok) {
      window.mostrarToast && window.mostrarToast('Gràcies per respondre!', 'ok');
      ESTAT.jaRespost = true;
      mostrarPantalla('fet');
      if (esAdminPanell) carregarAdmin();
    } else if (resp.status === 401 || resp.status === 403) {
      window.mostrarToast && window.mostrarToast('Firebase ha denegat el desat. Revisa les regles.', 'error');
      if (btn) { btn.disabled = false; actualitzarBotoSeguent(); }
    } else {
      window.mostrarToast && window.mostrarToast('No s\'ha pogut desar. Torna-ho a provar.', 'error');
      if (btn) { btn.disabled = false; actualitzarBotoSeguent(); }
    }
  } catch (e) {
    window.mostrarToast && window.mostrarToast('Error de connexió', 'error');
    if (btn) { btn.disabled = false; actualitzarBotoSeguent(); }
  }
}

/* ───────────────────────────────────────────────────────────────────
   OBERTURA / TANCAMENT
   ─────────────────────────────────────────────────────────────────── */
async function obrirEnquesta(opcions) {
  const el = cont();
  if (!el) return;

  let pla = null, cicle = null;
  if (typeof opcions === 'string') {
    pla = opcions;
  } else if (opcions && typeof opcions === 'object') {
    pla = opcions.pla;
    cicle = opcions.cicle;
  }

  if (pla && ['entusiasta','professional','equips'].includes(pla)) {
    ESTAT.respostes.pla = pla;
    ESTAT.preseleccionat = true;
  } else {
    ESTAT.preseleccionat = false;
  }

  if (cicle && ['mensual','anual'].includes(cicle)) {
    ESTAT.respostes.cicle = cicle;
  }

  el.classList.add('modal');
  el.scrollTop = 0;
  document.body.style.overflow = 'hidden';

  if (!window._fbUser) {
    mostrarPantalla('login');
    return;
  }

  ESTAT.jaRespost = await comprovarJaRespost(window._fbUser);
  if (ESTAT.jaRespost) {
    mostrarPantalla('fet');
  } else {
    ESTAT.preguntaActual = 0;
    renderPregunta(0);
    mostrarPantalla('pregunta');
  }
}

function tancarEnquesta() {
  const el = cont();
  if (!el) return;
  el.classList.remove('modal');
  document.body.style.overflow = '';
}

async function comprovarJaRespost(user) {
  try {
    const r = await api('GET', RUTA_RESPOSTES + '/' + encodeURIComponent(user.uid) + '.json');
    if (!r.ok) return false;
    const v = await r.json();
    return !!v;
  } catch (e) { return false; }
}

/* ───────────────────────────────────────────────────────────────────
   PANELL ADMIN · visual
   ─────────────────────────────────────────────────────────────────── */
async function carregarAdmin() {
  if (!esAdminPanell) return;
  const user = window._fbUser;
  if (!user) return;
  try {
    const r = await api('GET', RUTA_RESPOSTES + '.json');
    if (!r.ok) return;
    const dades = await r.json();
    respostesAdmin = Object.entries(dades || {}).map(([uid, v]) => ({ uid, ...v }))
      .sort((a, b) => (b.data || 0) - (a.data || 0));
    pintarAdmin();
  } catch (e) {}
}

/* Compta quantes vegades surt cada valor d'un camp */
function comptar(camp, multi) {
  const c = {};
  respostesAdmin.forEach(r => {
    const vals = multi ? (r[camp] || []) : [r[camp]];
    vals.forEach(v => { if (v) c[v] = (c[v] || 0) + 1; });
  });
  return c;
}

/* Ordena un objecte de comptes de més a menys */
function ordenarDesc(obj) {
  return Object.entries(obj).sort((a, b) => b[1] - a[1]);
}

/* ─── Targeta KPI ─── */
function kpiCard(ico, valor, etiqueta, accent) {
  return `
    <div class="adm-kpi ${accent ? 'accent-' + accent : ''}">
      <div class="adm-kpi-ico">${ico}</div>
      <div class="adm-kpi-val">${valor}</div>
      <div class="adm-kpi-lbl">${esc(etiqueta)}</div>
    </div>`;
}

/* ─── Donut chart SVG ─── */
function donutChart(comptes, etiquetes) {
  const total = Object.values(comptes).reduce((s, n) => s + n, 0) || 1;
  const paleta = ['#58a6ff', '#3fb950', '#d29922', '#f85149', '#a371f7', '#ff7b72', '#79c0ff', '#56d364'];
  const claus = Object.keys(etiquetes).filter(k => comptes[k] > 0);
  if (!claus.length) return '<p class="adm-empty">Encara no hi ha dades.</p>';

  const r = 60, c = 2 * Math.PI * r;
  let offset = 0;
  let paths = '';
  claus.forEach((k, i) => {
    const n = comptes[k] || 0;
    const pct = n / total;
    const dash = pct * c;
    const color = paleta[i % paleta.length];
    paths += `<circle cx="80" cy="80" r="${r}"
      fill="none" stroke="${color}" stroke-width="22"
      stroke-dasharray="${dash} ${c - dash}"
      stroke-dashoffset="${-offset}"
      transform="rotate(-90 80 80)"
      style="transition:stroke-dasharray .6s ease" />`;
    offset += dash;
  });

  const llegenda = claus.map((k, i) => {
    const n = comptes[k] || 0;
    const pct = Math.round((n / total) * 100);
    const color = paleta[i % paleta.length];
    return `
      <div class="adm-lg-item">
        <span class="adm-lg-dot" style="background:${color}"></span>
        <span class="adm-lg-lbl">${esc(etiquetes[k])}</span>
        <span class="adm-lg-num">${n}</span>
        <span class="adm-lg-pct">${pct}%</span>
      </div>`;
  }).join('');

  return `
    <div class="adm-donut-wrap">
      <svg viewBox="0 0 160 160" class="adm-donut">
        <circle cx="80" cy="80" r="${r}" fill="none" stroke="var(--bg-2)" stroke-width="22"/>
        ${paths}
        <text x="80" y="76" text-anchor="middle" font-size="22" font-weight="700" fill="var(--text)" font-family="Space Grotesk, Inter">${total}</text>
        <text x="80" y="94" text-anchor="middle" font-size="10" fill="var(--muted)" font-family="Inter" letter-spacing="1">TOTAL</text>
      </svg>
      <div class="adm-lg">${llegenda}</div>
    </div>`;
}

/* ─── Barres horitzontals ─── */
function barresH(comptes, etiquetes) {
  const total = respostesAdmin.length || 1;
  const claus = Object.keys(etiquetes);
  if (!Object.values(comptes).some(n => n > 0)) return '<p class="adm-empty">Encara no hi ha dades.</p>';

  return `<div class="adm-bars">${
    claus.map(k => {
      const n = comptes[k] || 0;
      const pct = Math.round((n / total) * 100);
      return `
        <div class="adm-bar">
          <div class="adm-bar-top">
            <span class="adm-bar-lbl">${esc(etiquetes[k])}</span>
            <span class="adm-bar-num">${n} <small>(${pct}%)</small></span>
          </div>
          <div class="adm-bar-track">
            <div class="adm-bar-fill" style="width:${pct}%"></div>
          </div>
        </div>`;
    }).join('')
  }</div>`;
}

/* ─── Chips (per a funcions multi) ─── */
function chips(comptes, etiquetes) {
  const total = respostesAdmin.length || 1;
  const files = ordenarDesc(comptes);
  if (!files.length) return '<p class="adm-empty">Encara no hi ha dades.</p>';

  return `<div class="adm-chips">${
    files.map(([k, n]) => {
      const pct = Math.round((n / total) * 100);
      const nom = etiquetes[k] || k;
      return `
        <div class="adm-chip">
          <span class="adm-chip-lbl">${esc(nom)}</span>
          <span class="adm-chip-num">${n}</span>
          <span class="adm-chip-pct">${pct}%</span>
        </div>`;
    }).join('')
  }</div>`;
}

/* ─── Bloc sencer ─── */
function bloc(titol, subtitol, contingut) {
  return `
    <div class="adm-bloc">
      <div class="adm-bloc-head">
        <h4>${esc(titol)}</h4>
        ${subtitol ? `<span class="adm-bloc-sub">${esc(subtitol)}</span>` : ''}
      </div>
      ${contingut}
    </div>`;
}

/* ─── Targeta d'una resposta ─── */
function respostaCard(r) {
  const data = r.data ? new Date(r.data).toLocaleString('ca-ES', {
    day: '2-digit', month: 'short', hour: '2-digit', minute: '2-digit'
  }) : '';
  const nom = r.nom || 'Sense nom';
  const inicial = nom[0].toUpperCase();
  const avatar = r.email
    ? `<span class="adm-resp-av">${esc(inicial)}</span>`
    : `<span class="adm-resp-av">?</span>`;

  const plaBadge = r.pla
    ? `<span class="adm-resp-pla pla-${esc(r.pla)}">${esc(ETIQ.pla[r.pla] || r.pla)}</span>`
    : '';

  const funcs = (r.funcions || []).map(f => ETIQ.funcions[f] || f);
  const funcsChips = funcs.length
    ? `<div class="adm-resp-funcs">${funcs.map(f => `<span class="adm-resp-func">${esc(f)}</span>`).join('')}</div>`
    : '';

  const meta = [
    ETIQ.preu[r.preu] && `<span> ${esc(ETIQ.preu[r.preu])}</span>`,
    ETIQ.cicle[r.cicle] && `<span> ${esc(ETIQ.cicle[r.cicle])}</span>`,
    r.avisar && `<span class="adm-resp-avis"> Vol avís</span>`
  ].filter(Boolean).join(' · ');

  const extraEquips = (r.pla === 'equips' && (r.equips_necessitats || r.equips_motiu))
    ? `<div class="adm-resp-equips">
        ${r.equips_necessitats ? `<div><b>Necessitats:</b> ${esc(r.equips_necessitats)}</div>` : ''}
        ${r.equips_motiu ? `<div><b>Motiu:</b> ${esc(r.equips_motiu)}</div>` : ''}
       </div>`
    : '';

  return `
    <article class="adm-resp">
      <header class="adm-resp-head">
        ${avatar}
        <div class="adm-resp-info">
          <div class="adm-resp-nom">${esc(nom)}</div>
          <div class="adm-resp-email">${esc(r.email || '')}</div>
        </div>
        ${plaBadge}
      </header>
      <div class="adm-resp-meta">
        <span class="adm-resp-data">${esc(data)}</span>
        ${meta ? '· ' + meta : ''}
      </div>
      ${funcsChips}
      ${extraEquips}
      ${r.comentari ? `<div class="adm-resp-com">"${esc(r.comentari)}"</div>` : ''}
    </article>`;
}

/* ─── PINTAR EL PANELL ─── */
function pintarAdmin() {
  const wrap = contAdmin();
  if (!wrap) return;
  wrap.dataset.obert = '1';

  const total = respostesAdmin.length;
  const avisar = respostesAdmin.filter(r => r.avisar).length;
  const ambEquips = respostesAdmin.filter(r => r.pla === 'equips').length;
  const ambProfessional = respostesAdmin.filter(r => r.pla === 'professional').length;

  wrap.innerHTML = `
    <div class="adm-inner">
      <header class="adm-header">
        <div>
          <h3>${ICONES.tauler} Panell d'administrador</h3>
          <p class="adm-sub">Respostes rebudes de l'enquesta de plans · TEMPESTES.CAT</p>
        </div>
        <button type="button" class="adm-close" id="enqBtnTancaAdmin" aria-label="Tanca">
          ${ICONES.tanca}
        </button>
      </header>

      <section class="adm-kpis">
        ${kpiCard('', total, 'Respostes totals', 'blue')}
        ${kpiCard('', avisar, 'Volen avís per correu', 'gold')}
        ${kpiCard('', ambEquips, 'Interessats en Equips', 'purple')}
        ${kpiCard('', ambProfessional, 'Interessats en Professional', 'green')}
      </section>

      <div class="adm-grid">
        ${bloc('Pla preferit', 'Distribució de respostes', donutChart(comptar('pla'), ETIQ.pla))}
        ${bloc('Què et semblen els preus?', 'Opinió general', barresH(comptar('preu'), ETIQ.preu))}
      </div>

      <div class="adm-grid">
        ${bloc('Cicle de pagament', 'Mensual vs Anual', donutChart(comptar('cicle'), ETIQ.cicle))}
        ${bloc('Funcions més demanades', 'Poden triar-ne diverses', chips(comptar('funcions', true), ETIQ.funcions))}
      </div>

      <section class="adm-respostes">
        <div class="adm-bloc-head">
          <h4>Totes les respostes</h4>
          <span class="adm-bloc-sub">${total} ${total === 1 ? 'resposta' : 'respostes'}</span>
        </div>
        <div class="adm-resp-llista">
          ${total ? respostesAdmin.map(respostaCard).join('') : '<p class="adm-empty">Encara no hi ha respostes.</p>'}
        </div>
      </section>

      <footer class="adm-foot">
        <button type="button" class="enq-btn-pill" id="enqBtnCsv">${ICONES.descarregar} Descarrega CSV</button>
        <button type="button" class="enq-btn-pill" id="enqBtnRefresca">${ICONES.refrescar} Actualitza</button>
      </footer>
    </div>
  `;

  $('#enqBtnCsv')?.addEventListener('click', descarregarCsv);
  $('#enqBtnRefresca')?.addEventListener('click', carregarAdmin);
  $('#enqBtnTancaAdmin')?.addEventListener('click', () => { wrap.dataset.obert = '0'; });
}

function descarregarCsv() {
  const cap = ['data','nom','email','pla','preu','cicle','funcions','equips_necessitats','equips_motiu','avisar','comentari'];
  const cel = v => {
    let s = String(v == null ? '' : v).replace(/"/g, '""');
    if (/^[=+\-@]/.test(s)) s = "'" + s;
    return '"' + s + '"';
  };
  const files = respostesAdmin.map(r => [
    r.data ? new Date(r.data).toISOString() : '', r.nom, r.email, r.pla, r.preu, r.cicle,
    (r.funcions || []).join('|'), r.equips_necessitats || '', r.equips_motiu || '',
    r.avisar ? 'si' : 'no', r.comentari
  ].map(cel).join(','));
  const csv = '\ufeff' + [cap.join(',')].concat(files).join('\n');
  const a = document.createElement('a');
  a.href = URL.createObjectURL(new Blob([csv], { type: 'text/csv;charset=utf-8' }));
  a.download = 'enquesta-plans.csv';
  document.body.appendChild(a); a.click(); a.remove();
}

/* ───────────────────────────────────────────────────────────────────
   BOTÓ FLOTANT ADMIN (només ADMIN_PANELL)
   ─────────────────────────────────────────────────────────────────── */
function mostrarBotoAdmin(mostrar) {
  let btn = document.getElementById('enqAdminToggle');
  if (!mostrar) {
    if (btn) btn.remove();
    return;
  }
  if (btn) return;

  btn = document.createElement('button');
  btn.id = 'enqAdminToggle';
  btn.className = 'enq-admin-toggle';
  btn.type = 'button';
  btn.innerHTML = 'Panell admin';
  btn.addEventListener('click', () => carregarAdmin());
  document.body.appendChild(btn);
}

/* ───────────────────────────────────────────────────────────────────
   LISTENERS
   ─────────────────────────────────────────────────────────────────── */
function inicialitzarListeners() {
  document.addEventListener('click', e => {
    if (e.target.closest('#enqBtnLogin')) {
      e.preventDefault();
      window._login().catch(err => {
        if (err && err.code !== 'auth/popup-closed-by-user') {
          window.mostrarToast && window.mostrarToast('No s\'ha pogut iniciar sessió', 'error');
        }
      });
    }
    if (e.target.closest('#enqTanca') || e.target.closest('#enqBtnTancarFet')) {
      tancarEnquesta();
    }
    if (e.target.closest('#enqSeguent')) { e.preventDefault(); seguent(); }
    if (e.target.closest('#enqEnrere'))  { e.preventDefault(); enrere(); }
  });

  document.addEventListener('click', e => {
    const el = cont();
    if (el && el.classList.contains('modal') && e.target === el) tancarEnquesta();
  });

  document.addEventListener('keydown', e => {
    const el = cont();
    if (e.key === 'Escape' && el && el.classList.contains('modal')) tancarEnquesta();
  });

  /* Canvi d'usuari (login/logout) */
  window.addEventListener('preus:user', async e => {
    const user = e.detail;
    pintarUsuariCapcalera();

    if (!user) {
      ESTAT.jaRespost = false;
      esAdmin = false;
      esAdminPanell = false;
      mostrarBotoAdmin(false);
      const wrapAdmin = contAdmin();
      if (wrapAdmin) wrapAdmin.dataset.obert = '0';
      const el = cont();
      if (el && el.classList.contains('modal')) mostrarPantalla('login');
      return;
    }

    esAdmin = await comprovarAdmin();
    esAdminPanell = potVeurePanell();

    if (esAdminPanell) {
      carregarAdmin();
      mostrarBotoAdmin(true);
    } else {
      mostrarBotoAdmin(false);
      const wrapAdmin = contAdmin();
      if (wrapAdmin) wrapAdmin.dataset.obert = '0';
    }

    const el = cont();
    if (el && el.classList.contains('modal')) {
      const loginVisible = !$('#enqPantallaLogin')?.hidden;
      if (loginVisible) {
        ESTAT.jaRespost = await comprovarJaRespost(user);
        if (ESTAT.jaRespost) mostrarPantalla('fet');
        else { ESTAT.preguntaActual = 0; renderPregunta(0); mostrarPantalla('pregunta'); }
      } else {
        pintarUsuariCapcalera();
      }
    }
  });
}

/* ───────────────────────────────────────────────────────────────────
   INIT
   ─────────────────────────────────────────────────────────────────── */
function init() {
  renderShell();
  inicialitzarListeners();
  window.obrirEnquesta = obrirEnquesta;
  window.tancarEnquesta = tancarEnquesta;
  pintarUsuariCapcalera();

  // Si ja hi havia usuari carregat abans de l'init (per exemple, ja loguejat)
  if (window._fbUser) {
    esAdminPanell = potVeurePanell();
    if (esAdminPanell) {
      comprovarAdmin().then(a => { esAdmin = a; });
      carregarAdmin();
      mostrarBotoAdmin(true);
    }
  }
}

if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', init);
else init();