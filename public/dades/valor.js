// Generat automaticament per valor.py. No editar a ma.
const PALETES = {"DBZH":{"unitat":"dBZ","inici":-4.0,"pas":2.0,"colors":["#f6f6f6","#e8e8e8","#dadada","#cccccc","#bebebe","#b0b0b0","#05e6e7","#03c5ed","#01a3f3","#0274f4","#024bf4","#0220f4","#029f5b","#01fd01","#01e101","#01c801","#01a201","#018801","#006b00","#7fbc01","#fdf802","#f1da02","#e5bc02","#f2a801","#ff9400","#fe4a00","#fd0000","#e90000","#d40000","#c80000","#bc0000","#da007f","#f800fd","#c82ae2","#9854c6","#ccaae3","#eeeeee"],"tipus":"indexada"},"VRADH":{"unitat":"km/h","factor":3.6,"inici":-46.25,"pas":1.0,"colors":["#ed0086","#db0189","#c8018b","#b6028e","#a9028f","#970392","#840494","#780496","#5d0599","#450499","#2c0399","#1c0299","#1717a0","#1a37aa","#1c4cb1","#1f6cbc","#228cc7","#25acd1","#27c2d8","#34e0e3","#47e2e5","#54e3e6","#68e5e8","#7be7ea","#8feaed","#9cebee","#afedf0","#9af2c8","#7ff5a3","#57f86c","#2efc34","#03f503","#03ea03","#03db03","#03cb03","#03c003","#03b103","#02a102","#029102","#028702","#027702","#026702","#4e794c","#5a7d58","#668164","#728570","#757575","#8a7281","#885f6c","#864c56","#853f48","#730000","#840001","#8f0001","#a00002","#b00003","#c10004","#cc0005","#dd0006","#ee0007","#fa3751","#fa4769","#fb5782","#fc689b","#fd73ab","#fe83c4","#ff95d0","#ffa8c6","#ffc5b7","#ffe1a8","#ffe09b","#ffd793","#ffca86","#ffbd79","#ffb471","#ffa764","#ff9a57","#fc874e","#f5814a","#ea7845","#e06f3f","#d8683c","#ce5f36","#c35631","#b94d2c","#b14628","#a73d23","#9c341d","#952e1a","#8a2414","#801b0f","#751209","#6e0c06","#6e0c06"],"tipus":"indexada"},"RATE":{"unitat":"mm/h","nivells":[0.0,0.1,0.5,1.0,2.0,5.0,10.0,20.0,30.0,50.0,80.0,120.0,200.0,300.0,500.0,700.0,1000.0],"colors":["#00000000","#00ffffff","#00c8ffff","#0078ffff","#0000ffff","#00c800ff","#00ff00ff","#64ff00ff","#ffff00ff","#ffc800ff","#ff9600ff","#ff6400ff","#ff0000ff","#c80000ff","#ff0096ff","#c800c8ff","#ffffffff"],"tipus":"nivells","coords":[[-3.0,44.5],[4.5,44.5],[4.5,39.5],[-3.0,39.5]]},"ACRR":{"unitat":"mm","nivells":[0.0,0.2,1.0,2.0,5.0,10.0,20.0,50.0,100.0,200.0,300.0,500.0,750.0,1000.0,1500.0,2000.0,3000.0],"colors":["#00000000","#aad7ffff","#8cc3ffff","#64aaffff","#3278f0ff","#14a0dcff","#14c8c8ff","#1ec85aff","#5ad728ff","#96e128ff","#fdeb02ff","#fda000ff","#fd3c00ff","#c80014ff","#c800a0ff","#8c3cdcff","#ffffffff"],"tipus":"nivells","coords":[[-3.0,44.5],[4.5,44.5],[4.5,39.5],[-3.0,39.5]]}};
window.VALOR_PALETES = PALETES;

const LITRES_BASE = 'https://radar-data.tempestes.cat/dades_litres';
const PRODUCTE_A_PALETA = { dbz: 'DBZH', vel: 'VRADH' };
const TOLERANCIA2 = 40 * 40;      // paletes indexades: distància de color màxima (al quadrat)
const TOLERANCIA_CONT2 = 36 * 36; // litres: residu màxim (al quadrat) sobre el segment

/* ---------- Paletes preparades ---------- */
function parseHex(h) {
  h = h.replace('#', '');
  return [
    parseInt(h.slice(0, 2), 16), parseInt(h.slice(2, 4), 16), parseInt(h.slice(4, 6), 16),
    h.length >= 8 ? parseInt(h.slice(6, 8), 16) : 255,
  ];
}
const preparades = {};
function preparar(nom) {
  if (preparades[nom]) return preparades[nom];
  const p = PALETES[nom];
  if (!p) return null;
  const rgb = p.colors.map(parseHex);
  const exacte = new Map();
  rgb.forEach((c, i) => {
    if (c[3] === 0) return;
    const k = (c[0] << 16) | (c[1] << 8) | c[2];
    if (!exacte.has(k)) exacte.set(k, i);
  });
  return (preparades[nom] = { p, rgb, exacte });
}

/* ---------- Paletes indexades (dBZ, velocitat) ---------- */
// Al PNG, l'índex de paleta k+1 té el color colors[k] i el valor inici + k*pas.
function indexDeColor(prep, r, g, b) {
  const k = (r << 16) | (g << 8) | b;
  if (prep.exacte.has(k)) return prep.exacte.get(k);
  let best = -1, bestD = Infinity;
  prep.rgb.forEach((c, i) => {
    if (c[3] === 0) return;
    const d = (c[0] - r) ** 2 + (c[1] - g) ** 2 + (c[2] - b) ** 2;
    if (d < bestD) { bestD = d; best = i; }
  });
  return bestD <= TOLERANCIA2 ? best : -1;
}
function textIndexada(prep, d) {
  const i = indexDeColor(prep, d[0], d[1], d[2]);
  if (i < 0) return null;
  const p = prep.p;
  const v = (p.inici + i * p.pas) * (p.factor || 1);
  const txt = p.factor ? Math.round(v) : Number(v.toFixed(2));
  return `${txt} ${p.unitat}`;
}

/* ---------- Paletes contínues (litres: RATE, ACRR) ---------- */
// El PNG s'ha pintat interpolant colors entre nivells consecutius. Per invertir-ho,
// busquem el segment [nivell i, nivell i+1] més proper al color i interpolem el valor.
function textContinua(prep, d) {
  const { p, rgb } = prep;
  const px = [d[0], d[1], d[2], d[3]];
  let best = null, bestRes = Infinity;
  for (let i = 0; i < rgb.length - 1; i++) {
    const c0 = rgb[i], c1 = rgb[i + 1];
    let dd = 0, dp = 0;
    for (let k = 0; k < 4; k++) {
      const dk = c1[k] - c0[k];
      dd += dk * dk;
      dp += (px[k] - c0[k]) * dk;
    }
    const t = dd > 0 ? Math.max(0, Math.min(1, dp / dd)) : 0;
    let res = 0;
    for (let k = 0; k < 4; k++) {
      const e = px[k] - (c0[k] + t * (c1[k] - c0[k]));
      res += e * e;
    }
    if (res < bestRes) {
      bestRes = res;
      best = p.nivells[i] + t * (p.nivells[i + 1] - p.nivells[i]);
    }
  }
  if (best === null || bestRes > TOLERANCIA_CONT2) return null;
  const dec = best < 1 ? 2 : best < 10 ? 1 : 0;
  return `${best.toFixed(dec)} ${p.unitat}`;
}

function textDePixel(nom, d) {
  const prep = preparar(nom);
  if (!prep) return null;
  return prep.p.tipus === 'indexada' ? textIndexada(prep, d) : textContinua(prep, d);
}

/* ---------- Càrrega de píxels (amb memòria cau) ---------- */
const cache = new Map();
function carregar(url) {
  if (cache.has(url)) return cache.get(url);
  const prom = (async () => {
    const r = await fetch(url, { mode: 'cors' });
    if (!r.ok) throw new Error('HTTP ' + r.status);
    const bmp = await createImageBitmap(await r.blob());
    const c = document.createElement('canvas');
    c.width = bmp.width; c.height = bmp.height;
    const ctx = c.getContext('2d', { willReadFrequently: true });
    ctx.drawImage(bmp, 0, 0);
    return { ctx, w: c.width, h: c.height };
  })();
  cache.set(url, prom);
  prom.catch(() => cache.delete(url));
  if (cache.size > 8) cache.delete(cache.keys().next().value);
  return prom;
}

/* ---------- Geometria (igual que MapLibre: lineal en Mercator entre cantonades) ---------- */
const mercY = (lat) => Math.log(Math.tan(Math.PI / 4 + (lat * Math.PI) / 360));
function lngLatAPixel(coords, lng, lat, w, h) {
  const lonW = coords[0][0], latN = coords[0][1];
  const lonE = coords[2][0], latS = coords[2][1];
  const fx = (lng - lonW) / (lonE - lonW);
  const fy = (mercY(latN) - mercY(lat)) / (mercY(latN) - mercY(latS));
  if (fx < 0 || fx >= 1 || fy < 0 || fy >= 1) return null;
  return [Math.floor(fx * w), Math.floor(fy * h)];
}

/* ---------- Litres ---------- */
function nomPaletaLitres(prod) {
  if (!prod) return null;
  const s = String(typeof prod === 'object' ? (prod.id || prod.key || prod.name || '') : prod).toUpperCase();
  if (PALETES[s] && PALETES[s].tipus === 'nivells') return s;
  if (s.includes('ACRR') || s.includes('ACUM')) return 'ACRR';
  if (s.includes('RATE') || s.includes('INTENS')) return 'RATE';
  return null;
}
function urlDeFrame(f) {
  if (!f) return null;
  if (typeof f === 'string') {
    return /^(https?:|blob:|data:|\/)/.test(f) ? f : `${LITRES_BASE}/${f.replace(/\.png$/, '')}.png`;
  }
  if (f.blob || f.url || f.src) return f.blob || f.url || f.src;
  if (f.f) return `${LITRES_BASE}/${f.f}.png`;
  return null;
}

/* ---------- initValor ---------- */
export function initValor(opts) {
  const { map, getLayerState, getKey, isRadarVisible } = opts;
  const getLitresProduct = opts.getLitresProduct || (() => null);
  const getLitresFrames = opts.getLitresFrames || (() => []);
  const getLitresFrameIndex = opts.getLitresFrameIndex || (() => -1);

  let enabled = true;
  let last = null;
  let raf = 0;
  let seq = 0;

  const tip = document.createElement('div');
  tip.style.cssText =
    'position:absolute;z-index:5;pointer-events:none;display:none;' +
    'padding:3px 8px;border-radius:6px;font:600 12px/1.3 system-ui,sans-serif;' +
    'background:rgba(10,12,20,.9);color:#fff;border:1px solid rgba(255,255,255,.25);' +
    'white-space:nowrap;transform:translate(14px,14px)';
  map.getContainer().appendChild(tip);

  const amaga = () => { tip.style.display = 'none'; };

  function fontActual() {
    const prodL = getLitresProduct();
    if (prodL) {
      const nom = nomPaletaLitres(prodL);
      if (!nom) return null;
      const frames = getLitresFrames() || [];
      const frame = frames[getLitresFrameIndex()];
      const url = urlDeFrame(frame);
      const coords = (frame && typeof frame === 'object' && frame.coords) || PALETES[nom].coords;
      return url && coords ? { nom, url, coords } : null;
    }
    if (!isRadarVisible()) return null;
    const key = getKey();
    const nom = PRODUCTE_A_PALETA[key];
    const st = getLayerState(key);
    if (!nom || !st || !st.initialized || !st.coords) return null;
    const url = st.currentBlob || st.currentUrl;
    return url ? { nom, url, coords: st.coords } : null;
  }

  async function actualitza() {
    if (!enabled || !last) return amaga();
    const f = fontActual();
    if (!f) return amaga();
    const mi = ++seq;
    const { lngLat, point } = last;
    let img;
    try { img = await carregar(f.url); } catch (e) { return amaga(); }
    if (mi !== seq) return;
    const px = lngLatAPixel(f.coords, lngLat.lng, lngLat.lat, img.w, img.h);
    if (!px) return amaga();
    const d = img.ctx.getImageData(px[0], px[1], 1, 1).data;
    if (d[3] < 10) return amaga();
    const text = textDePixel(f.nom, d);
    if (!text) return amaga();
    tip.textContent = text;
    tip.style.left = point.x + 'px';
    tip.style.top = point.y + 'px';
    tip.style.display = 'block';
  }

  map.on('mousemove', (e) => {
    last = e;
    if (!raf) raf = requestAnimationFrame(() => { raf = 0; actualitza(); });
  });
  map.on('mouseout', () => { last = null; amaga(); });
  // Refresca mentre l'animació canvia de frame amb el ratolí quiet
  setInterval(() => { if (enabled && last) actualitza(); }, 350);

  return {
    setEnabled(v) { enabled = !!v; if (!enabled) amaga(); },
    destroy() { tip.remove(); },
  };
}
