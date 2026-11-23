import { state, subscribe, isOwner, addPlace, patchPlace } from './store.js';
import { sortPlaces, mapsUrl, cleanName, searchUrl, parseHits, validPoint } from './places.js';
import { S } from './strings.js';
import { esc, toast, buzz, sheet, inlineConfirm, goHash, nav } from './ui.js';

// Places: Papa saves a named spot, taps a name to open it in Google Maps. Hash "#places" (shown under the Lists tab).
// Map = Leaflet 1.9.4 + OpenStreetMap tiles, loaded only when the Add screen opens. Search = Nominatim, one request per tap.
const LEAFLET = 'https://cdn.jsdelivr.net/npm/leaflet@1.9.4/dist/leaflet';
let root, unsub = null, paint = () => {};
const $ = (el, sel) => el.querySelector(sel);

export function mountPlaces(el) {
  root = el;
  return function show() {
    unsub?.();
    root.innerHTML = `<div class="large-title"><button class="back" data-back>‹ ${nav.placesFrom === 'today' ? S.tabToday : S.tabLists}</button></div><h1>${S.placesTitle}</h1>
      <div class="psplit"><div class="plist">${isOwner() ? `<button class="newtask" data-add>+ ${S.addPlace}</button>` : ''}<div id="rows"></div></div><div class="pmapbig" data-all hidden></div></div>`;
    const rows = $(root, '#rows');
    paint = () => {
      const ps = sortPlaces([...state.places]);
      rows.innerHTML = ps.length ? `<div class="group">${ps.map(p => `<div class="row prow"><a class="t" href="${esc(mapsUrl(p))}" target="_blank" rel="noopener noreferrer">${esc(p.name)}</a>${isOwner() ? `<button class="ghost" data-edit="${p.id}" aria-label="${esc(S.placeOptions)}">⋯</button>` : ''}</div>`).join('')}</div><p class="foot muted">${esc(S.savedPlaces(ps.length))}</p>` : `<p class="empty">${S.noPlaces}</p>`;
    };
    // Desktop: one big map of every saved place beside the list. Phone never loads it.
    let allMap, layer;
    const paintMap = () => {
      if (!layer) return;
      layer.clearLayers();
      const ps = sortPlaces([...state.places]);
      ps.forEach(p => window.L.marker([p.lat, p.lng], { title: p.name }).bindPopup(`<a href="${esc(mapsUrl(p))}" target="_blank" rel="noopener noreferrer">${esc(p.name)}</a>`).addTo(layer));
      if (ps.length) allMap.fitBounds(ps.map(p => [p.lat, p.lng]), { maxZoom: 15, padding: [32, 32] });
    };
    const mapBox = $(root, '[data-all]');
    if (document.documentElement.dataset.layout === 'desktop') {
      mapBox.hidden = false;
      loadLeaflet().then(L => {
        allMap = L.map(mapBox).setView([START.lat, START.lng], START.z);
        L.tileLayer('https://tile.openstreetmap.org/{z}/{x}/{y}.png', { maxZoom: 19, attribution: '© OpenStreetMap' }).addTo(allMap);
        layer = L.layerGroup().addTo(allMap);
        paintMap();
        setTimeout(() => allMap.invalidateSize(), 50);
      }).catch(() => (mapBox.hidden = true));
    }
    unsub = subscribe(() => !root.hidden && (paint(), paintMap()));
    $(root, '[data-back]').onclick = () => goHash(nav.placesFrom);
    $(root, '[data-add]')?.addEventListener('click', addSheet);
    rows.onclick = e => { const b = e.target.closest('[data-edit]'); if (b) editSheet(b.dataset.edit); };
    paint();
  };
}

let leafletReady;
function loadLeaflet() {
  leafletReady ??= new Promise((ok, no) => {
    if (window.L) return ok(window.L);
    document.head.append(Object.assign(document.createElement('link'), { rel: 'stylesheet', href: `${LEAFLET}.css` }));
    const s = Object.assign(document.createElement('script'), { src: `${LEAFLET}.js`, onload: () => ok(window.L), onerror: () => { leafletReady = null; no(new Error('map')); } });
    document.head.append(s);
  });
  return leafletReady;
}

// India as the first view; moves to the pin's place as soon as search or location answers.
const START = { lat: 28.45, lng: 77.03, z: 12 };

function addSheet() {
  const d = sheet(S.addPlace, `<form class="stack" data-f>
    <div class="add-row" style="margin-top:0"><input name="q" type="search" enterkeyhint="search" placeholder="${esc(S.searchPlace)}" aria-label="${esc(S.searchPlace)}" autocomplete="off"><button type="button" data-go>${S.searchGo}</button></div>
    <div data-hits></div>
    <button type="button" class="ghost" data-loc>◎ ${S.useMyLocation}</button>
    <div class="pmap" data-map></div><p class="hint" data-hint>${S.dragPin}</p>
    <label>${S.placeName}<input name="n" maxlength="80" placeholder="${esc(S.placeNameHint)}" autocomplete="off" required></label>
    <button class="save">${S.savePlace}</button></form>`, { full: true });
  const f = $(d, '[data-f]'), hits = $(d, '[data-hits]'), hint = $(d, '[data-hint]');
  let pt = { lat: START.lat, lng: START.lng }, marker, map;
  const put = (lat, lng, zoom) => { pt = { lat, lng }; marker?.setLatLng([lat, lng]); if (zoom) map?.setView([lat, lng], zoom); else map?.panTo([lat, lng]); };
  loadLeaflet().then(L => {
    map = L.map($(d, '[data-map]')).setView([pt.lat, pt.lng], START.z);
    L.tileLayer('https://tile.openstreetmap.org/{z}/{x}/{y}.png', { maxZoom: 19, attribution: '© OpenStreetMap' }).addTo(map);
    const icon = L.divIcon({ className: 'pinicon', html: '<i></i>', iconSize: [48, 48], iconAnchor: [24, 46] });
    marker = L.marker([pt.lat, pt.lng], { draggable: true, icon }).addTo(map);
    marker.on('dragend', () => { const c = marker.getLatLng(); pt = { lat: c.lat, lng: c.lng }; });
    map.on('click', e => put(e.latlng.lat, e.latlng.lng));
    setTimeout(() => map.invalidateSize(), 50);
  }).catch(() => (hint.textContent = S.mapNeedsNet));

  let busy = false, lastQ = '';
  const search = async () => {
    const q = f.q.value.trim();
    if (q.length < 3 || !navigator.onLine || busy || q === lastQ) return; // Nominatim policy: one request per tap, never a repeat of the same text
    busy = true; lastQ = q;
    hits.innerHTML = `<p class="hint">${S.searching}</p>`;
    try {
      const r = await fetch(searchUrl(q), { headers: { Accept: 'application/json' } });
      const list = parseHits(await r.json());
      hits.innerHTML = list.length ? `<div class="group">${list.map((h, i) => `<button type="button" class="row" data-hit="${i}" style="text-align:left">${esc(h.name)}</button>`).join('')}</div>` : `<p class="hint">${S.noHits}</p>`;
      hits.onclick = e => { const b = e.target.closest('[data-hit]'); if (!b) return; const h = list[b.dataset.hit]; put(h.lat, h.lng, 17); hits.innerHTML = ''; if (!f.n.value) f.n.value = cleanName(h.name.split(',')[0]); };
    } catch { hits.innerHTML = `<p class="hint">${S.noNet}</p>`; lastQ = ''; }
    finally { busy = false; }
  };
  $(d, '[data-go]').onclick = search;
  f.q.onkeydown = e => { if (e.key === 'Enter') { e.preventDefault(); search(); } };
  $(d, '[data-loc]').onclick = () => {
    hint.textContent = S.locating;
    navigator.geolocation?.getCurrentPosition(
      p => { hint.textContent = S.dragPin; put(p.coords.latitude, p.coords.longitude, 17); },
      () => { hint.textContent = S.locDenied; }, { enableHighAccuracy: true, timeout: 15000 });
    if (!navigator.geolocation) hint.textContent = S.locDenied;
  };
  f.onsubmit = async e => {
    e.preventDefault();
    const name = cleanName(f.n.value);
    if (!name || !validPoint(pt.lat, pt.lng)) return;
    d.close();
    buzz();
    try { await addPlace({ name, ...pt }); toast(S.placeSaved(name)); } catch {}
  };
}

function editSheet(id) {
  const p = state.places.find(x => x.id === id);
  if (!p) return;
  const d = sheet(S.placeOptions, `<form class="stack" data-f><label>${S.renamePlace}<input name="n" maxlength="80" value="${esc(p.name)}" required></label>
    <a class="ghost lnk2" href="${esc(mapsUrl(p))}" target="_blank" rel="noopener noreferrer">${S.openInMaps}</a>
    <button class="save">${S.save}</button><button type="button" class="link danger" data-arch>${S.archivePlace}</button></form>`);
  const f = $(d, '[data-f]');
  f.onsubmit = e => { e.preventDefault(); if ($(d, '.confirm')) return; const n = cleanName(f.n.value); if (!n) return; d.close(); patchPlace(id, { name: n }).catch(() => {}); };
  $(d, '[data-arch]').onclick = e => inlineConfirm(e.currentTarget, S.removePlaceQ, S.archivePlace, () => {
    d.close();
    patchPlace(id, { archived_at: new Date().toISOString() }).catch(() => {}); // paint first; offline it waits in the queue, so Undo must not wait for it
    toast(S.placeArchived, 'ok', { label: S.undo, fn: () => patchPlace(id, { archived_at: null }).catch(() => {}) });
  });
}
