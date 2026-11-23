// Pure list logic (no DOM, no network): node-tested in tests/lists.test.mjs.

// http(s) only. Returns the cleaned URL or null. A bare "example.com" is not a link.
export function safeUrl(s) {
  const t = String(s ?? '').trim();
  if (!t || /\s/.test(t) || t.length > 2000) return null;
  try {
    const u = new URL(t);
    return (u.protocol === 'http:' || u.protocol === 'https:') && u.hostname ? u.href : null;
  } catch { return null; }
}

// A box holding only a link becomes an item whose text is that link (a title replaces it when fetched).
export function parseInput(s) {
  const t = String(s ?? '').trim();
  const url = safeUrl(t);
  return url ? { text: t, url } : { text: t, url: null };
}

// oEmbed needs no API key for these hosts. Returns the lookup URL or null.
export function oembedUrl(url) {
  const u = safeUrl(url);
  if (!u) return null;
  const h = new URL(u).hostname.replace(/^(www|m)\./, '');
  if (h === 'youtube.com' || h === 'youtu.be' || h === 'music.youtube.com') return `https://www.youtube.com/oembed?format=json&url=${encodeURIComponent(u)}`;
  if (h === 'vimeo.com') return `https://vimeo.com/api/oembed.json?url=${encodeURIComponent(u)}`;
  return null;
}

export const hostOf = url => { try { return new URL(url).hostname.replace(/^www\./, ''); } catch { return ''; } };

const byPos = (a, b) => a.position - b.position || a.created_at.localeCompare(b.created_at);
export const isLive = x => !x.archived_at;
export const openItems = (items, listId) => items.filter(i => i.list_id === listId && isLive(i) && !i.done_at).sort(byPos);
export const doneItems = (items, listId) => items.filter(i => i.list_id === listId && isLive(i) && i.done_at).sort((a, b) => b.done_at.localeCompare(a.done_at));
// "N items" counts what is still to do.
export const countOf = (items, listId) => openItems(items, listId).length;

// Lists screen order: most recently used first; title breaks ties.
export const sortLists = lists => lists.filter(isLive).sort((a, b) => b.last_used_at.localeCompare(a.last_used_at) || a.title.localeCompare(b.title));
export const archivedLists = lists => lists.filter(l => l.archived_at).sort((a, b) => b.archived_at.localeCompare(a.archived_at));

// New items go on top, under the add box.
export const topPos = open => (open.length ? open[0].position - 1 : 0);

// Desktop column sort (view only, never written back): text A-Z, or a date column; dir 1 = ascending, -1 = descending. Blank dates sort last; ties keep list order.
// Dates compare as instants: PostgREST trims fractional zeros, so same-second ISO strings do not sort as text.
export const sortItems = (items, key, dir) => [...items].sort((a, b) => (key === 'text' ? dir * a.text.localeCompare(b.text)
  : !a[key] - !b[key] || dir * (Date.parse(a[key]) - Date.parse(b[key]))) || a.position - b.position);

// One-row reorder: returns the new position for item `id` moved up (-1) or down (+1), or null at the edge.
export function movePos(open, id, dir) {
  const i = open.findIndex(x => x.id === id);
  const j = i + dir;
  if (i < 0 || j < 0 || j >= open.length) return null;
  if (dir < 0) return j === 0 ? open[0].position - 1 : (open[j - 1].position + open[j].position) / 2;
  return j === open.length - 1 ? open[j].position + 1 : (open[j].position + open[j + 1].position) / 2;
}

// Search across every live list. Case-insensitive; every word must appear somewhere in the item.
export function search(lists, items, q) {
  const words = String(q ?? '').toLowerCase().split(/\s+/).filter(Boolean);
  if (!words.length) return { lists: [], items: [] };
  const live = new Map(lists.filter(isLive).map(l => [l.id, l]));
  const has = (s, w) => (s ?? '').toLowerCase().includes(w);
  return {
    lists: [...live.values()].filter(l => words.every(w => has(l.title, w))),
    items: items
      .filter(i => isLive(i) && live.has(i.list_id) && words.every(w => [i.text, i.note, i.url, i.link_title, live.get(i.list_id).title].some(f => has(f, w))))
      .sort((a, b) => Number(!!a.done_at) - Number(!!b.done_at) || live.get(b.list_id).last_used_at.localeCompare(live.get(a.list_id).last_used_at) || byPos(a, b)),
  };
}

export const cleanTitle = s => String(s ?? '').trim().replace(/\s+/g, ' ').slice(0, 80);
