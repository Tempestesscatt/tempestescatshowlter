/* =========================================================
   search.js — Tempestes.cat
   ========================================================= */

const $ = (id) => document.getElementById(id);
const norm = (s) => (s || '').toString().toLowerCase().normalize('NFD').replace(/[\u0300-\u036f]/g, '');
const escapeHtml = (s) => String(s).replace(/[&<>"']/g, (c) => ({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]));
const fmtPop = (n) => { if (!n) return ''; if (n >= 1e6) return (n/1e6).toFixed(1)+'M'; if (n >= 1e3) return Math.round(n/1e3)+'k'; return String(n); };

export function initSearch({ map, state, isMobile }) {
  const searchInput = $('searchInput');
  const searchClear = $('searchClear');
  const searchResults = $('searchResults');
  if (!searchInput || !searchResults) return null;

  const raw = (window.CIUTATS && Array.isArray(window.CIUTATS.llista)) ? window.CIUTATS.llista : [];
  const cities = raw.map((c) => Array.isArray(c) ? { nom: c[0], lon: c[1], lat: c[2], poblacio: 0 } : c);

  let matches = [], selIndex = -1;
  let markerEl = null, markerTimer = 0, markerMoveHandler = null;

  function searchCities(query) {
    const q = norm(query).trim();
    if (q.length < 2) return [];
    const out = [];
    for (const c of cities) {
      if (!c.nom) continue;
      const n = norm(c.nom);
      if (n.startsWith(q)) out.push({ ...c, score: 2 });
      else if (n.includes(q)) out.push({ ...c, score: 1 });
    }
    out.sort((a, b) => b.score - a.score || (b.poblacio || 0) - (a.poblacio || 0));
    return out.slice(0, 12);
  }

  function renderResults() {
    searchResults.innerHTML = '';
    selIndex = -1;
    if (matches.length === 0) {
      searchResults.innerHTML = '<div class="search-empty">Cap resultat</div>';
    } else {
      matches.forEach((c, i) => {
        const div = document.createElement('div');
        div.className = 'search-result';
        div.dataset.i = i;
        div.innerHTML = `<span class="search-result-name">${escapeHtml(c.nom)}</span><span class="search-result-meta">${escapeHtml(c.pais||'')} ${c.poblacio ? '· ' + fmtPop(c.poblacio) : ''}</span>`;
        div.addEventListener('click', () => pickCity(c));
        searchResults.appendChild(div);
      });
    }
    searchResults.classList.add('visible');
  }

  function showSearchMarker(lon, lat) {
    const mapEl = $('map');
    if (!mapEl) return;
    hideSearchMarker();
    markerEl = document.createElement('div');
    markerEl.className = 'search-marker';
    markerEl.innerHTML = '<div class="search-marker-pulse"></div><div class="search-marker-dot"></div>';
    mapEl.appendChild(markerEl);

    const positionMarker = () => {
      if (!markerEl) return;
      const p = map.project([lon, lat]);
      markerEl.style.transform = `translate(${p.x}px, ${p.y}px)`;
    };
    positionMarker();
    markerMoveHandler = positionMarker;
    map.on('move', markerMoveHandler);
    map.on('zoom', markerMoveHandler);

    markerTimer = setTimeout(() => {
      if (markerEl) {
        markerEl.style.transition = 'opacity 400ms ease';
        markerEl.style.opacity = '0';
        setTimeout(hideSearchMarker, 400);
      }
    }, 4600);
  }

  function hideSearchMarker() {
    if (markerTimer) { clearTimeout(markerTimer); markerTimer = 0; }
    if (markerMoveHandler) {
      try { map.off('move', markerMoveHandler); map.off('zoom', markerMoveHandler); } catch {}
      markerMoveHandler = null;
    }
    if (markerEl) { markerEl.remove(); markerEl = null; }
  }

  function pickCity(c) {
    if (!c || !Number.isFinite(c.lon) || !Number.isFinite(c.lat)) return;
    map.flyTo({ center: [c.lon, c.lat], zoom: 11, duration: 1200, essential: true });
    searchInput.value = c.nom;
    searchResults.classList.remove('visible');
    searchClear.classList.add('visible');
    searchInput.blur();
    showSearchMarker(c.lon, c.lat);
    if (isMobile && isMobile()) state.ui?.closePanel?.();
  }

  function clearSearch() {
    searchInput.value = '';
    searchResults.classList.remove('visible');
    searchResults.innerHTML = '';
    searchClear.classList.remove('visible');
    matches = []; selIndex = -1;
  }

  searchInput.addEventListener('input', (e) => {
    const v = e.target.value;
    searchClear.classList.toggle('visible', v.length > 0);
    if (v.trim().length < 2) { searchResults.classList.remove('visible'); matches = []; return; }
    matches = searchCities(v);
    renderResults();
  });

  searchInput.addEventListener('keydown', (e) => {
    if (!searchResults.classList.contains('visible')) return;
    const items = searchResults.querySelectorAll('.search-result');
    if (e.key === 'ArrowDown') { e.preventDefault(); selIndex = Math.min(selIndex + 1, items.length - 1); }
    else if (e.key === 'ArrowUp') { e.preventDefault(); selIndex = Math.max(selIndex - 1, 0); }
    else if (e.key === 'Enter') { e.preventDefault(); pickCity(matches[selIndex >= 0 ? selIndex : 0]); return; }
    else if (e.key === 'Escape') { clearSearch(); return; }
    else return;
    items.forEach((it, i) => it.classList.toggle('selected', i === selIndex));
    items[selIndex]?.scrollIntoView({ block: 'nearest' });
  });

  searchClear.addEventListener('click', clearSearch);
  document.addEventListener('click', (e) => {
    if (!e.target.closest('.search-wrap')) searchResults.classList.remove('visible');
  });

  state.search = { pickCity, clearSearch, showSearchMarker, hideSearchMarker };
  return state.search;
}
