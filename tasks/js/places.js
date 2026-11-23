// Pure place logic (no DOM, no network): node-tested in tests/places.test.mjs.

export const MAPS = 'https://www.google.com/maps/search/?api=1&query=';
// Coordinates go in the URL as plain numbers, never as text the user typed.
export const mapsUrl = p => `${MAPS}${Number(p.lat).toFixed(6)},${Number(p.lng).toFixed(6)}`;
export const validPoint = (lat, lng) => Number.isFinite(lat) && Number.isFinite(lng) && Math.abs(lat) <= 90 && Math.abs(lng) <= 180;
export const cleanName = s => String(s ?? '').trim().replace(/\s+/g, ' ').slice(0, 80);
// Names A-Z so Papa finds one by letter; archived places are hidden.
export const sortPlaces = ps => ps.filter(p => !p.archived_at).sort((a, b) => a.name.localeCompare(b.name));
export const archivedPlaces = ps => ps.filter(p => p.archived_at).sort((a, b) => b.archived_at.localeCompare(a.archived_at));

// Nominatim usage policy: one request per search tap, no autocomplete, max 5 results, identified by the browser's Referer.
export const searchUrl = q => `https://nominatim.openstreetmap.org/search?format=jsonv2&limit=5&q=${encodeURIComponent(String(q).trim())}`;
export const parseHits = json => (Array.isArray(json) ? json : [])
  .map(h => ({ name: String(h.display_name ?? '').slice(0, 120), lat: Number(h.lat), lng: Number(h.lon) }))
  .filter(h => h.name && validPoint(h.lat, h.lng));
