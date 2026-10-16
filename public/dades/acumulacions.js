// public/dades/acumulacions.js
// -----------------------------------------------------------------------------
// Acumulacions de pluja (mm) generades pel Python (cumul.py).
//
// El Python integra els mm/h del NIMBUS, pinta un PNG per període (30 min, 1 h,
// 3 h, 6 h, 12 h, 24 h) i escriu un manifest.json. Aquest mòdul:
//   1) llegeix el manifest,
//   2) en retorna els períodes amb la URL del PNG i si són parcials.
//
// El valor sota el cursor el resol dades/valor.js (mode 'acum'); les escales,
// la regió i les coordenades són a dades/escales.js.
// -----------------------------------------------------------------------------

export async function loadManifest(baseUrl) {
  try {
    const url = `${baseUrl.replace(/\/$/, '')}/manifest.json?t=${Date.now()}`;
    const r = await fetch(url, { cache: 'no-store' });
    if (!r.ok) return null;
    return await r.json();
  } catch (e) {
    console.warn('[acumulacions] manifest no disponible', e);
    return null;
  }
}

/**
 * Períodes disponibles amb la URL del seu PNG.
 * `parcial` = l'historial no cobreix el període sencer; `cobertura_min` = minuts reals.
 * @returns {Array<{min:number, url:string, max_mm:number, t:string|null, parcial:boolean, cobertura_min:number}>}
 */
export function periodsFromManifest(manifest, baseUrl) {
  if (!manifest || !Array.isArray(manifest.frames)) return [];
  const dir = baseUrl.replace(/\/$/, '');
  const ext = manifest.ext || '.png';
  const prefix = manifest.prefix || '';
  return manifest.frames
    .map((fr) => {
      if (!fr || !fr.f || fr.min == null) return null;
      const min = Number(fr.min);
      return {
        min,
        url: `${dir}/${prefix}${fr.f}${ext}`,
        max_mm: Number(fr.max_mm || 0),
        t: fr.t || manifest.last_timestamp || null,
        parcial: fr.parcial === true,
        cobertura_min: Number(fr.cobertura_min != null ? fr.cobertura_min : min),
      };
    })
    .filter(Boolean)
    .sort((a, b) => a.min - b.min);
}

export default { loadManifest, periodsFromManifest };