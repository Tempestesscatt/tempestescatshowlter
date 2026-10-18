// Llamps — DESACTIVAT
// Aquest mòdul NO fa cap petició de xarxa, ni WebSocket, ni fetch.
// Manté les mateixes exportacions que la versió activa perquè radar.js
// no peti i el mapa carregui sense errors.
//
// Per reactivar-ho quan tinguis una font legal (Meteocat, Xweather, etc.):
//   1. Canvia ENABLED a true.
//   2. Implementa la càrrega a `pollFeed()` (o torna a posar la versió completa).
//   3. Verifica que la font permet ús comercial al teu lloc web.

const ENABLED = false;   // <-- canvia a true quan tinguis font legal

const SRC = 'llamps-src';
const ICON = 'llamps-icon';
const IMG = 'llamp-bolt';

let visible = true;
let mapRef = null;
let viewTime = null;

// ---------- Crides segures (no fan res si està desactivat) ----------
export function initLightning(map) {
  if (!ENABLED) return;      // desactivat: no fa res
  mapRef = map;
  // Aquí aniria la càrrega real quan es reactivi
}

export function reapplyLightning(map) {
  if (!ENABLED) return;
  mapRef = map;
  // Aquí aniria la re-creació de la capa quan es reactivi
}

export function setLightningTime(ms) {
  if (!ENABLED) return;
  viewTime = Number.isFinite(ms) ? ms : null;
}

export function setLightningVisibility(v) {
  if (!ENABLED) return;
  visible = v;
}

export function setLightningSound(on) {
  if (!ENABLED) return;
}

export function getLightningSound() {
  return false;
}

export const LIGHTNING_LAYER_IDS = [];