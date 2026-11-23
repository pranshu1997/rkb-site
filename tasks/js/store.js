import { createClient } from 'https://cdn.jsdelivr.net/npm/@supabase/supabase-js@2/+esm';
import { SUPABASE_URL, SUPABASE_ANON_KEY } from './config.js';
import { createQueue, applyOps } from './queue.js';
import { isOpen } from './sort.js';
import { oembedUrl, topPos, openItems } from './lists.js';
import { cleanName } from './places.js';
import { S } from './strings.js';
import { toast } from './ui.js';

export const sb = createClient(SUPABASE_URL, SUPABASE_ANON_KEY, {
  auth: { persistSession: true, autoRefreshToken: true, detectSessionInUrl: false },
});
navigator.storage?.persist?.().catch(() => {});

export const isOffline = e =>
  !navigator.onLine || /failed to fetch|load failed|networkerror|network request failed|fetch failed|network timeout/i.test(e?.message ?? '');

// Offline, supabase-js waits on a token refresh that never ends, so every call has a deadline.
const deadline = (p, ms = 8000) => Promise.race([p, new Promise((_, rej) => setTimeout(() => rej(new Error('network timeout')), ms))]);
async function rows(query) {
  if (!navigator.onLine) throw new Error('Failed to fetch: offline');
  const { data, error } = await deadline(query);
  if (error) throw error;
  return data;
}
export const rpc = (fn, args) => rows(sb.rpc(fn, args));

// ── Cache: last good answer per key, served when the network is gone ──
const peek = key => { try { return JSON.parse(localStorage.getItem(`rkb:${key}`)); } catch { return null; } };
const keep = (key, v) => { try { localStorage.setItem(`rkb:${key}`, JSON.stringify(v)); } catch {} };
async function cached(key, query) {
  try {
    const data = await rows(query);
    keep(key, data);
    return data;
  } catch (e) {
    const hit = peek(key);
    if (!isOffline(e) || hit == null) throw e;
    return hit;
  }
}

// ── Write queue ──
// A pull that overlaps one of our own writes can read rows from before it landed and paint them over the
// optimistic change (a tick un-ticks, an added item vanishes). `wepoch` moves at every write start/end.
let wepoch = 0, winflight = 0;
async function runOp(op) {
  wepoch++; winflight++;
  try { await sendOp(op); } finally { wepoch++; winflight--; }
}
async function sendOp(op) {
  const q = op.kind === 'insert' ? sb.from(op.table).insert(op.row)
    : op.kind === 'patch' ? sb.from(op.table).update(op.fields).eq('id', op.id)
    : sb.rpc(op.fn, op.args);
  const { error } = await deadline(q);
  if (error) throw error;
}
export const queue = createQueue({
  store: { get: () => peek('queue') ?? [], set: v => keep('queue', v) },
  run: runOp,
  online: () => navigator.onLine,
  isOffline,
  onDrop: () => { toast(S.dropped, 'bad'); pull().catch(() => {}); },
  onChange: n => dispatchEvent(new CustomEvent('rkb:queue', { detail: n })),
});

export async function flush() {
  if (!queue.size()) return;
  if (await queue.flush()) pull().catch(() => {});
}

// ── State ──
export const state = { me: null, people: [], cats: [], tasks: [], events: {}, lists: [], items: [], places: [], listsOk: false };
const subs = new Set();
export const subscribe = f => (subs.add(f), () => subs.delete(f));
export const emit = () => subs.forEach(f => f());

export const live = () => state.tasks.filter(t => !t.deleted_at);
export const person = id => state.people.find(p => p.id === id);
export const owner = () => state.people.find(p => p.role === 'owner');
export const activePeople = () => state.people.filter(p => p.active);
export const isOwner = () => state.me?.role === 'owner';
export const category = id => state.cats.find(c => c.id === id);

function setData({ people, cats, tasks, lists = [], items = [], places = [] }) {
  const ops = queue.pending();
  state.places = applyOps(places, ops, 'places');
  state.lists = applyOps(lists, ops, 'lists');
  state.items = applyOps(items, ops, 'list_items');
  state.people = applyOps(people, ops, 'people');
  state.cats = applyOps(cats, ops, 'categories').sort((a, b) => a.sort - b.sort || a.name.localeCompare(b.name));
  state.tasks = applyOps(tasks, ops, 'tasks');
  emit();
}

const QS = () => ({
  people: sb.from('people').select('*').order('created_at'),
  cats: sb.from('categories').select('*').is('archived_at', null).order('sort').order('name'),
  tasks: sb.from('tasks').select('*').is('deleted_at', null).order('created_at', { ascending: false }).limit(3000),
});
// Lists (same project, same queue). RLS shows them to Papa and Pranshu only; employees get empty answers.
const LQ = () => ({
  lists: sb.from('lists').select('*').order('last_used_at', { ascending: false }),
  items: sb.from('list_items').select('*').order('position').limit(5000),
  places: sb.from('places').select('*').order('name'),
});

// Paint from the phone's copy first (no network), then pull.
export function paintCached() {
  const [people, cats, tasks] = ['people', 'cats', 'tasks'].map(peek);
  if (!people || !cats || !tasks) return false;
  state.listsOk = !!peek('listsOk');
  setData({ people, cats, tasks, lists: peek('lists') ?? [], items: peek('items') ?? [], places: peek('places') ?? [] });
  return true;
}
async function pullOnce() {
  const q = QS();
  const [people, cats, tasks] = await Promise.all(Object.entries(q).map(([k, v]) => cached(k, v)));
  // A Lists failure must never hide the tasks: keep what the phone has.
  const lq = LQ();
  const [lists, items] = await Promise.all([cached('lists', lq.lists), cached('items', lq.items)]).catch(() => [peek('lists') ?? [], peek('items') ?? []]);
  const places = await cached('places', lq.places).catch(() => peek('places') ?? []); // places must never hide lists (table missing = empty)
  return { people, cats, tasks, lists, items, places };
}
export async function pull() {
  let d;
  for (let i = 0; i < 4; i++) { // ponytail: after 4 overlaps with writes, paint anyway; the 20 s poll corrects it
    const e = wepoch;
    d = await pullOnce();
    if (e === wepoch && !winflight) break;
    await new Promise(r => setTimeout(r, 150));
  }
  setData(d);
}

export async function boot(uid) {
  await pull();
  state.me = state.people.find(p => p.user_id === uid) ?? null;
  await checkLists();
  return state.me;
}

export function clearLocal() {
  try { Object.keys(localStorage).filter(k => k.startsWith('rkb:')).forEach(k => localStorage.removeItem(k)); } catch {}
  queue.clear();
  Object.assign(state, { me: null, people: [], cats: [], tasks: [], events: {}, lists: [], items: [], places: [], listsOk: false });
}

// The cache and the write queue belong to one login. If a different user (or nobody we know) is
// signing in on this phone, drop both before anything is painted or replayed under the new session.
export function bindUser(uid) {
  let owner = null;
  try { owner = localStorage.getItem('rkb:uid'); } catch {}
  if (owner !== uid) clearLocal();
  try { localStorage.setItem('rkb:uid', uid); } catch {}
}
sb.auth.onAuthStateChange(ev => { if (ev === 'SIGNED_OUT') clearLocal(); });

// ── Optimistic writes ──
const stampDone = (t, f) => {
  if (f.status) {
    if (f.status !== 'waiting') f.waiting_on = null;
    f.done_at = f.status === 'done' ? t.done_at ?? new Date().toISOString() : null;
  }
  return f;
};
// Paint the change now, save behind; revert and say so if the server refuses it.
export async function mutate(id, fields) {
  const t = state.tasks.find(x => x.id === id);
  if (!t) return;
  const before = { ...t };
  const local = stampDone(t, { ...fields });
  Object.assign(t, local, { updated_at: new Date().toISOString() });
  emit();
  try {
    const r = await queue.send({ kind: 'patch', table: 'tasks', id, fields });
    if (!!t.pending !== (r === 'queued')) { t.pending = r === 'queued'; emit(); }
    // Finishing a repeating task makes the next one in the database: fetch it.
    if (r === 'sent' && fields.status === 'done' && t.repeat_rule) pull().catch(() => {});
  } catch (e) {
    Object.assign(t, before);
    emit();
    toast(S.changeFailed, 'bad');
    throw e;
  }
}

const COLS = ['id', 'title', 'notes', 'client', 'category_id', 'priority', 'due_date', 'repeat_rule', 'assignee_id'];
export async function addTask(input) {
  const row = { id: crypto.randomUUID(), notes: null, client: null, category_id: null, priority: 2, due_date: null, repeat_rule: null, assignee_id: owner()?.id, ...input };
  const now = new Date().toISOString();
  const t = { ...row, status: 'todo', waiting_on: null, seen_at: null, done_at: null, deleted_at: null, created_by: state.me?.id, created_at: now, updated_at: now, pending: true };
  state.tasks.unshift(t);
  emit();
  try {
    const r = await queue.send({ kind: 'insert', table: 'tasks', row: Object.fromEntries(COLS.map(c => [c, row[c]])) });
    if (r !== 'queued') { t.pending = false; emit(); }
  } catch (e) {
    state.tasks = state.tasks.filter(x => x.id !== row.id);
    emit();
    toast(S.addFailed, 'bad');
    throw e;
  }
  return t;
}

// ── History ──
export async function loadEvents(taskId) {
  const ops = queue.pending();
  let evs = state.events[taskId] ?? peek(`ev:${taskId}`) ?? [];
  try { evs = await cached(`ev:${taskId}`, sb.from('task_events').select('*').eq('task_id', taskId).order('created_at')); } catch {}
  evs = applyOps(evs, ops.filter(o => o.row?.task_id === taskId), 'task_events');
  state.events[taskId] = evs;
  return evs;
}
export async function addComment(taskId, body) {
  const row = { id: crypto.randomUUID(), task_id: taskId, kind: 'comment', body };
  state.events[taskId] = [...(state.events[taskId] ?? []), { ...row, author_id: state.me?.id, created_at: new Date().toISOString(), pending: true }];
  try {
    await queue.send({ kind: 'insert', table: 'task_events', row });
  } catch (e) {
    state.events[taskId] = state.events[taskId].filter(x => x.id !== row.id);
    toast(S.commentFailed, 'bad');
    throw e;
  }
}

// ── Categories (queued like tasks) ──
export async function addCategory(name) {
  const row = { id: crypto.randomUUID(), name: name.trim(), sort: state.cats.length };
  state.cats = [...state.cats, { ...row, archived_at: null }];
  emit();
  try { await queue.send({ kind: 'insert', table: 'categories', row }); } catch (e) { state.cats = state.cats.filter(c => c.id !== row.id); emit(); throw e; }
}
export async function patchCategory(id, fields) {
  const c = category(id);
  const before = { ...c };
  Object.assign(c, fields);
  if (fields.archived_at) state.cats = state.cats.filter(x => x.id !== id);
  emit();
  try { await queue.send({ kind: 'patch', table: 'categories', id, fields }); } catch (e) { state.cats.push(before); emit(); throw e; }
}

// ── People: online only (a refused change must show at once, not on a later replay) ──
async function direct(q) {
  if (!navigator.onLine) { toast(S.needNet, 'bad'); throw new Error('offline'); }
  const { error } = await deadline(q);
  if (error) throw error;
  await pull();
}
export const addPerson = f => direct(sb.from('people').insert(f));
export const patchPerson = (id, f) => direct(sb.from('people').update(f).eq('id', id));
export const reassignOpen = async (from, to) => { const n = await rpc('reassign_open', { from_person: from, to_person: to }); await pull(); return n; };

// ── Lists: does this login see them? The server decides (can_see_lists); the UI only mirrors it. ──
export async function checkLists() {
  try { state.listsOk = !!(await rpc('can_see_lists')); keep('listsOk', state.listsOk); } catch (e) { if (!isOffline(e)) state.listsOk = false; }
  // Papa's first run: two starter lists, made once by the server (it refuses if any list ever existed).
  if (state.listsOk && isOwner() && !state.lists.length && navigator.onLine) { await rpc('ensure_starter_lists').catch(() => {}); await pull(); }
}
export const list = id => state.lists.find(l => l.id === id);

// ── Writes: paint first, save behind, revert if the server refuses ──
const nowIso = () => new Date().toISOString();
const bump = id => { const l = list(id); if (l) l.last_used_at = nowIso(); };

async function patchRow(table, rowsArr, id, fields, after) {
  const r = rowsArr.find(x => x.id === id);
  if (!r) return;
  const before = { ...r };
  Object.assign(r, fields, { updated_at: nowIso() });
  after?.(r, before);
  emit();
  try { await queue.send({ kind: 'patch', table, id, fields }); } catch (e) {
    Object.assign(r, before);
    emit();
    toast(S.changeFailed, 'bad');
    throw e;
  }
}
export const patchItem = (id, fields) => patchRow('list_items', state.items, id, fields, r => { bump(r.list_id); if (fields.list_id) bump(fields.list_id); });
export const patchList = (id, fields) => patchRow('lists', state.lists, id, fields);
export const patchPlace = (id, fields) => patchRow('places', state.places, id, fields);

export async function addPlace({ name, lat, lng }) {
  const row = { id: crypto.randomUUID(), name: cleanName(name), lat, lng };
  const t = nowIso();
  state.places.push({ ...row, archived_at: null, created_at: t, updated_at: t, pending: true });
  emit();
  try { await queue.send({ kind: 'insert', table: 'places', row }); } catch (e) {
    state.places = state.places.filter(p => p.id !== row.id);
    emit();
    toast(S.placeFailed, 'bad');
    throw e;
  }
  return row.id;
}

export async function addList(title) {
  const row = { id: crypto.randomUUID(), title };
  const t = nowIso();
  state.lists.unshift({ ...row, archived_at: null, last_used_at: t, created_at: t, updated_at: t, pending: true });
  emit();
  try { await queue.send({ kind: 'insert', table: 'lists', row }); } catch (e) {
    state.lists = state.lists.filter(l => l.id !== row.id);
    emit();
    toast(S.listFailed, 'bad');
    throw e;
  }
  return row.id;
}

// A bare YouTube/Vimeo link is shown by its title when oEmbed answers in time; any failure leaves the URL.
export async function videoTitle(url, ms = 3000) {
  const api = oembedUrl(url);
  if (!api || !navigator.onLine) return null;
  const ctl = new AbortController();
  const timer = setTimeout(() => ctl.abort(), ms);
  try {
    const r = await fetch(api, { signal: ctl.signal });
    const t = r.ok ? (await r.json()).title : null;
    return typeof t === 'string' && t.trim() ? t.trim().slice(0, 200) : null;
  } catch { return null; } finally { clearTimeout(timer); }
}

const ITEM_COLS = ['id', 'list_id', 'text', 'note', 'url', 'link_title', 'position'];
export async function addItem(listId, { text, note = null, url = null, link_title = null }) {
  const row = { id: crypto.randomUUID(), list_id: listId, text: text.slice(0, 500), note: note || null, url, link_title, position: topPos(openItems(state.items, listId)) };
  const t = nowIso();
  state.items.push({ ...row, done_at: null, archived_at: null, created_by: state.me?.id, created_at: t, updated_at: t, pending: true });
  bump(listId);
  emit();
  try { await queue.send({ kind: 'insert', table: 'list_items', row: Object.fromEntries(ITEM_COLS.map(c => [c, row[c]])) }); } catch (e) {
    state.items = state.items.filter(x => x.id !== row.id);
    emit();
    toast(S.itemFailed, 'bad');
    throw e;
  }
  return row.id;
}

// ── Live updates: realtime is best effort, so also poll while visible ──
let channel;
export function watch() {
  channel?.unsubscribe();
  let t;
  const later = () => { clearTimeout(t); t = setTimeout(() => queue.size() || pull().catch(() => {}), 400); };
  channel = sb.channel('rkb')
    .on('postgres_changes', { event: '*', schema: 'public', table: 'tasks' }, later)
    .on('postgres_changes', { event: '*', schema: 'public', table: 'lists' }, later)
    .on('postgres_changes', { event: '*', schema: 'public', table: 'list_items' }, later)
    .on('postgres_changes', { event: '*', schema: 'public', table: 'places' }, later)
    .on('postgres_changes', { event: 'INSERT', schema: 'public', table: 'task_events' }, () => dispatchEvent(new CustomEvent('rkb:events')))
    .subscribe();
  addEventListener('online', () => flush());
  setInterval(() => document.visibilityState === 'visible' && (queue.size() ? flush() : pull().catch(() => {})), 20000);
}

export const openCount = () => live().filter(isOpen).length;

// ── Reminder settings (one row, online) ──
export const getSettings = () => cached('settings', sb.from('app_settings').select('*').limit(1)).then(r => r[0]);
export async function setReminderTime(t) {
  if (!navigator.onLine) { toast(S.needNet, 'bad'); throw new Error('offline'); }
  const { error } = await deadline(sb.from('app_settings').update({ reminder_time: t }).eq('id', 1));
  if (error) throw error;
  keep('settings', [{ id: 1, reminder_time: t }]);
}
export const registerPush = f => rpc('register_push', f);
export const dropPush = endpoint => rpc('drop_push', { p_endpoint: endpoint });
