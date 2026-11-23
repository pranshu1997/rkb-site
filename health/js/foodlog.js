// Food log: calories and nutrients per meal, inside the Meals flow on Today.
// Meal sheet -> "Add food" -> search (recent and often-eaten first) -> amount -> saved entry listed in that meal.
// Nutrients are stored on each entry (js/nutrition.js maths), so totals never depend on the food database version.
import { sb, upsert, patch, cachedRows, pending } from './db.js';
import { overlay } from './overlay.js';
import { localDate } from './slots.js';
import { esc, hhmm, toast, buzz } from './ui.js';
import { ICONS } from './icons.js';
import { targets, stored, loadTargets, saveTargets, suggest, complete, ACTIVITY, GOALS, KEYS, LABEL, UNIT } from './targets.js';
import { unpack, search, entryFor, totals, portion, recents, vsTarget } from './nutrition.js';
import { t as tr } from './i18n.js';

export const FOOD_SECTION = `
  <h2 class="sec-h">${tr('Nutrition')} <span data-out="nut-sub">${tr('Calories, carbs and sugar')}</span></h2>
  <section class="vlist" data-out="nutrition"></section>`;
export const FOOD_SHEET = `<dialog id="food-sheet" class="sheet" aria-label="${tr('Add food')}"></dialog>`;

const MEAL_NAME = { breakfast: tr('Breakfast'), lunch: tr('Lunch'), snack: tr('Snack'), dinner: tr('Dinner') };
const num = n => Number(n).toLocaleString();
let ctx, root, sheet, sheetT, rows = [], day, loads = 0, warned = false, saving = Promise.resolve();
const inflight = new Set();
let foods = null, foodsLoad = null; // food database, fetched on first use (the service worker keeps it for offline)
let past = null; // recents(): {recent, often}
const v = { view: 'search', meal: null, q: '', food: null, si: 0, qty: 1, editing: null };

const loadFoods = () => (foodsLoad ??= fetch(new URL('./food-db.json', import.meta.url)).then(r => r.json()).then(d => (foods = unpack(d)))
  .catch(e => { foodsLoad = null; throw e; }));

export const mealRows = meal => rows.filter(r => r.meal_type === meal);
export const mealSummary = meal => {
  const t = totals(mealRows(meal));
  return mealRows(meal).length ? tr('{kcal} kcal · {carbs} g carbs · {sugar} g sugar', { kcal: num(t.kcal), carbs: t.carbs, sugar: t.sugar }) : '';
};

// ctx: {uid, names, at() -> Date to record, by(row) -> " · by Pranshu", onChange()}
export function mountFood(el, c) {
  ctx = c;
  root = el;
  sheet = root.querySelector('#food-sheet');
  sheet.addEventListener('click', onSheetClick);
  sheet.addEventListener('input', onSheetInput);
  sheet.addEventListener('close', () => (v.food = null));
  root.querySelector('[data-out=meal-food]').addEventListener('click', e => {
    const edit = e.target.closest('[data-f-edit]')?.dataset.fEdit, del = e.target.closest('[data-f-del]')?.dataset.fDel;
    if (edit) openEdit(rows.find(r => r.id === edit));
    if (del) removeRow(rows.find(r => r.id === del));
  });
  // Lives on <body>, not in Today, because Settings opens it while the Today view is hidden.
  sheetT = document.getElementById('targets-sheet') ?? document.body.appendChild(Object.assign(document.createElement('dialog'), { id: 'targets-sheet', className: 'sheet', ariaLabel: tr('Food targets') }));
  sheetT.addEventListener('click', onTargetsClick);
  sheetT.addEventListener('input', paintSuggestions);
  root.querySelector('[data-out=nutrition]').addEventListener('click', e => e.target.closest('[data-act=targets]') && openTargets());
  addEventListener('pulse:open-targets', openTargets); // Settings row
  addEventListener('pulse:targets', render);
  loadTargets(true).then(() => loadTargets());
  render();
  return { load, openAdd, paintMeal, rows: () => rows };
}

// ── Load (phone copy first, then the network) ────────────────────────────
export async function load(forDay, first = false) {
  day = forDay;
  const mine = ++loads; // reloads can finish out of order; only the newest paints
  try {
    const [got, queued] = await Promise.all([
      cachedRows(`food:day:${day}`, sb.from('food_log').select('*').eq('slot_date', day).is('deleted_at', null), first)
        .catch(e => { if (e.message === 'nocache') return []; throw e; }),
      pending(),
    ]);
    if (mine !== loads) return;
    rows = overlay(got, [...queued, ...inflight], 'food_log').filter(r => !r.deleted_at && r.slot_date === day)
      .sort((a, b) => a.eaten_at.localeCompare(b.eaten_at));
    changed();
  } catch (e) {
    console.error(e);
    if (!warned) (warned = true, toast(tr('Food log: {error}', { error: e.message }), 'bad')); // once, not on every 15 s poll
  }
}

function changed() {
  render();
  ctx.onChange();
}

// ── Today: totals against targets ────────────────────────────────────────
function render() {
  const t = totals(rows);
  const T = targets();
  const row = (icon, tint, name, value, unit, target, unitNote) => {
    const vs = vsTarget(value, target, unitNote, tr);
    return `<div class="vrow done prog${vs.over ? ' lvl-high' : ''}" style="--progress:${Math.min(100, (value / target) * 100)}%">
      <span class="vic ${tint}" aria-hidden="true">${icon}</span>
      <span class="vtx"><span class="vname">${name}</span><span class="vnote">${vs.text} · ${tr('target {n} {unit}', { n: num(target), unit: unitNote })}</span></span>
      <span class="vval"><b class="num">${num(value)}</b><small>${unitNote}</small></span></div>`;
  };
  root.querySelector('[data-out=nutrition]').innerHTML =
    row(ICONS.kcal, 'vic-kcal', tr('Calories'), t.kcal, 'kcal', T.kcal, 'kcal') +
    row(ICONS.carbs, 'vic-carbs', tr('Carbs'), t.carbs, 'g', T.carbs, 'g') +
    row(ICONS.sugar, 'vic-sugar', tr('Sugar'), t.sugar, 'g', T.sugar, 'g') +
    `<div class="vrow done"><span class="vic vic-diet" aria-hidden="true">${ICONS.food}</span>
      <span class="vtx"><span class="vname">${tr('Protein, fat, fibre')}</span>
      <span class="vnote">${tr('{protein} g protein · {fat} g fat · {fibre} g fibre', t)}</span></span></div>
    <button type="button" class="vrow done" data-act="targets"><span class="vic vic-diet" aria-hidden="true">${ICONS.food}</span>
      <span class="vtx"><span class="vname">${tr('Food targets')}</span><span class="vnote">${tr(stored().kcal ? 'Set for Papa' : 'Using standard numbers')}</span></span><span class="chev" aria-hidden="true">›</span></button>`;
  root.querySelector('[data-out=nutrition]').classList.toggle('empty', !rows.length); // nothing logged: only the Food targets row shows
  root.querySelector('[data-out=nut-sub]').textContent = rows.length ? tr(rows.length === 1 ? '{n} item logged' : '{n} items logged', { n: rows.length }) : tr('Nothing logged');
  if (sheet.open && v.view === 'search') paintResults();
}

// ── Meal sheet: this meal's food entries ────────────────────────────────
export function paintMeal(meal) {
  const list = mealRows(meal);
  const t = totals(list);
  root.querySelector('[data-out=meal-food]').innerHTML = !list.length ? '' : `<div class="vlist food-items">${list.map(r => `
    <div class="vrow done frow${r.pending ? ' pending' : ''}">
      <button type="button" class="fmain" data-f-edit="${esc(r.id)}" aria-label="${esc(tr('Change {name}', { name: r.name }))}">
        <span class="vtx"><span class="vname">${esc(r.name)}</span>
        <span class="vnote">${esc(portion(r))} · ${tr('{carbs} g carbs · {sugar} g sugar', { carbs: Number(r.carbs), sugar: Number(r.sugar) })} · ${hhmm(r.eaten_at)}${r.pending ? ` · ${tr('saving…')}` : ''}${esc(ctx.by(r))}</span></span>
        <span class="vval"><b class="num">${Math.round(r.kcal)}</b><small>kcal</small></span></button>
      <button type="button" class="link bad" data-f-del="${esc(r.id)}" aria-label="${esc(tr('Delete {name}', { name: r.name }))}">${tr('Delete')}</button></div>`).join('')}
    <div class="vrow done frow ftotal"><span class="vtx"><span class="vname">${tr('{meal} total', { meal: MEAL_NAME[meal] })}</span>
      <span class="vnote">${tr('{carbs} g carbs · {sugar} g sugar · {protein} g protein', t)}</span></span>
      <span class="vval"><b class="num">${num(t.kcal)}</b><small>kcal</small></span></div></div>`;
}

// ── Add / change sheet ─────────────────────────────────────────────────
export async function openAdd(meal) {
  Object.assign(v, { view: 'search', meal, q: '', editing: null, food: null });
  renderSheet();
  if (!sheet.open) sheet.showModal();
  loadPast();
  try { await loadFoods(); } catch { toast(tr('Food list not available'), 'bad'); }
  if (sheet.open && v.view === 'search') paintResults();
}

async function openEdit(r) {
  if (!r) return;
  try { await loadFoods(); } catch { return toast(tr('Food list not available'), 'bad'); }
  const f = foods.find(x => x.id === r.food_id);
  if (!f) return toast(tr('This food is no longer in the list. Delete it and add it again.'), 'bad');
  const si = Math.max(0, f.sv.findIndex(s => s[0] === r.unit));
  Object.assign(v, { view: 'pick', meal: r.meal_type, food: f, si, qty: Number(r.qty), editing: r });
  renderSheet();
  sheet.showModal();
}

async function loadPast() {
  try {
    const got = await cachedRows('food:recent', sb.from('food_log').select('food_id,name,unit,qty,created_at').is('deleted_at', null)
      .order('created_at', { ascending: false }).limit(300));
    past = recents(got);
  } catch { past ??= { recent: [], often: [] }; }
  if (sheet.open && v.view === 'search') paintResults();
}

function renderSheet() {
  const name = MEAL_NAME[v.meal];
  if (v.view === 'search') {
    sheet.innerHTML = `<div class="sheet-head"><span></span><h2>${tr('Add to {meal}', { meal: name })}</h2><button type="button" class="link" data-f="close">${tr('Close')}</button></div>
      <input type="search" name="q" value="${esc(v.q)}" placeholder="${tr('Search food: roti, dal, chai')}" autocomplete="off" autocapitalize="off" spellcheck="false" enterkeyhint="search" aria-label="${tr('Search food')}">
      <div data-out="results"></div>`;
    paintResults();
    return;
  }
  const f = v.food;
  sheet.innerHTML = `<div class="sheet-head">${v.editing ? '<span></span>' : `<button type="button" class="link" data-f="back">${tr('Back')}</button>`}<h2>${name}</h2><button type="button" class="link" data-f="close">${tr('Close')}</button></div>
    <h3 class="pick-name">${esc(f.name)}</h3>
    <label class="when"><span>${tr('Serving')}</span><select name="serving" aria-label="${tr('Serving')}">${f.sv.map((s, i) =>
      `<option value="${i}"${i === v.si ? ' selected' : ''}>${esc(s[0])} (${s[1]} g)</option>`).join('')}</select></label>
    <div class="vlist"><div class="vrow done counter"><span class="vtx"><span class="vname">${tr('How many')}</span><span class="vnote" data-out="amount"></span></span>
      <span class="stepper"><button type="button" data-f="less" aria-label="${tr('Less')}">−</button><b class="num" data-out="qty"></b><button type="button" data-f="more" aria-label="${tr('More')}">+</button></span></div></div>
    <div class="vlist" data-out="preview"></div>
    <button type="button" class="save" data-f="add">${v.editing ? tr('Save changes') : tr('Add to {meal}', { meal: name })}</button>`;
  paintPick();
}

function paintResults() {
  const box = sheet.querySelector('[data-out=results]');
  if (!box) return;
  const item = (f, hint) => {
    const e = entryFor(f, f.sv[0], 1);
    return `<button type="button" class="vrow frow" data-pick="${esc(f.id)}"${hint ? ` data-unit="${esc(hint.unit)}" data-qty="${hint.qty}"` : ''}>
      <span class="vtx"><span class="vname">${esc(f.name)}</span>
      <span class="vnote">${esc(e.unit)} (${e.grams} g): ${e.kcal} kcal · ${tr('{carbs} g carbs · {sugar} g sugar', e)}</span></span><span class="chev" aria-hidden="true">›</span></button>`;
  };
  const group = (title, list) => (list.length ? `<h3 class="f-h">${title}</h3><div class="vlist food-list">${list.join('')}</div>` : '');
  if (!foods) return void (box.innerHTML = `<p class="muted center">${tr('Loading foods…')}</p>`);
  if (v.q.trim()) {
    const hits = search(foods, v.q);
    box.innerHTML = hits.length ? `<div class="vlist food-list">${hits.map(f => item(f)).join('')}</div>`
      : `<p class="muted center">${tr('No food found for “{q}”. Try another spelling or a shorter word.', { q: esc(v.q.trim()) })}</p>`;
    return;
  }
  const byId = new Map(foods.map(f => [f.id, f]));
  const known = g => g.map(p => ({ p, f: byId.get(p.food_id) })).filter(x => x.f).map(x => item(x.f, x.p));
  box.innerHTML = group(tr('Recent'), known(past?.recent ?? [])) + group(tr('Often eaten'), known(past?.often ?? []))
    || `<p class="muted center">${tr('Type a food name above. Foods you add are shown here next time.')}</p>`;
}

function paintPick() {
  const f = v.food, s = f.sv[v.si], e = entryFor(f, s, v.qty);
  sheet.querySelector('[data-out=qty]').textContent = v.qty;
  sheet.querySelector('[data-out=amount]').textContent = `${esc(portion({ unit: s[0], qty: v.qty }))} = ${e.grams} g`;
  const line = (name, val, unit, tint) => `<div class="vrow done frow"><span class="vtx"><span class="vname">${name}</span></span><span class="vval"><b class="num ${tint}">${num(val)}</b><small>${unit}</small></span></div>`;
  sheet.querySelector('[data-out=preview]').innerHTML = line(tr('Calories'), e.kcal, 'kcal') + line(tr('Carbs'), e.carbs, 'g') + line(tr('Sugar'), e.sugar, 'g') +
    `<div class="vrow done frow"><span class="vtx"><span class="vname">${tr('Protein · fat · fibre')}</span><span class="vnote">${e.protein} g · ${e.fat} g · ${e.fibre} g</span></span></div>`;
}

function onSheetInput(e) {
  if (e.target.name === 'q') (v.q = e.target.value, paintResults());
  if (e.target.name === 'serving') (v.si = Number(e.target.value), paintPick());
}

function onSheetClick(e) {
  const act = e.target.closest('[data-f]')?.dataset.f, pick = e.target.closest('[data-pick]');
  if (act === 'close') sheet.close();
  if (act === 'back') (v.view = 'search', renderSheet(), sheet.querySelector('[name=q]').focus());
  if (act === 'less') (v.qty = Math.max(0.5, v.qty - 0.5), paintPick());
  if (act === 'more') (v.qty = Math.min(20, v.qty + 0.5), paintPick());
  if (act === 'add') save();
  if (pick) {
    const f = foods.find(x => x.id === pick.dataset.pick);
    const si = f.sv.findIndex(s => s[0] === pick.dataset.unit);
    Object.assign(v, { view: 'pick', food: f, si: Math.max(0, si), qty: Number(pick.dataset.qty) || 1 });
    renderSheet();
  }
}

// ── Writes: the entry shows at once as "saving…"; the next load confirms it, or removes it if refused ──
function save() {
  const f = v.food, e = entryFor(f, f.sv[v.si], v.qty), old = v.editing;
  const at = old ? new Date(old.eaten_at) : ctx.at();
  const row = { id: old?.id ?? crypto.randomUUID(), user_id: ctx.uid, slot_date: old?.slot_date ?? localDate(at), meal_type: v.meal,
    eaten_at: at.toISOString(), food_id: f.id, name: f.name, ...e, deleted_at: null };
  buzz();
  sheet.close();
  write(row);
}

function removeRow(r) {
  if (!r || !confirm(tr('Delete {name}?', { name: r.name }))) return;
  buzz();
  rows = rows.filter(x => x.id !== r.id);
  loads++;
  changed();
  const p = saving.catch(() => {}).then(() => patch('food_log', r.id, { deleted_at: new Date().toISOString() }));
  saving = p;
  p.catch(err => toast(tr('Not saved: {error}', { error: err.message }), 'bad')).finally(() => (past = null, load(day)));
}

function write(row) {
  const op = { kind: 'upsert', table: 'food_log', row };
  inflight.add(op);
  rows = overlay(rows, [op], 'food_log').filter(r => !r.deleted_at && r.slot_date === day).sort((a, b) => a.eaten_at.localeCompare(b.eaten_at));
  loads++; // a load already in flight read the old state
  changed();
  const p = saving.catch(() => {}).then(() => upsert('food_log', row));
  saving = p;
  p.catch(e => toast(tr('Not saved: {error}', { error: e.message }), 'bad')).finally(() => (inflight.delete(op), (past = null), load(day)));
}

// ── Food targets screen: body profile, suggestions with reasons, editable numbers ──
const field = (name, label, attrs = '') => `<label class="trow"><span>${label}</span><input name="${name}" type="number" inputmode="decimal" autocomplete="off" placeholder="–" ${attrs}></label>`;
const pickRow = (name, label, opts) => `<label class="trow"><span>${label}</span><select name="${name}"><option value="">${tr('Choose')}</option>${opts.map(([k, t]) => `<option value="${k}">${esc(t)}</option>`).join('')}</select></label>`;

function openTargets() {
  const t = stored(), T = targets();
  sheetT.innerHTML = `<div class="sheet-head"><span></span><h2>${tr('Food targets')}</h2><button type="button" class="link" data-t="close">${tr('Close')}</button></div>
    <p class="t-warn"><b>${tr('Suggestion only.')}</b> ${tr('Confirm with Papa’s doctor before relying on these numbers.')}</p>
    <h3 class="f-h">${tr('About Papa')}</h3>
    <div class="vlist tlist">
      ${field('height_cm', tr('Height (cm)'), 'min="80" max="250"')}${field('weight_kg', tr('Weight (kg)'), 'min="20" max="300"')}${field('age', tr('Age'), 'min="1" max="120"')}
      ${pickRow('sex', tr('Sex'), [['male', tr('Male')], ['female', tr('Female')]])}
      ${pickRow('activity', tr('Activity'), Object.entries(ACTIVITY).map(([k, a]) => [k, tr(a[0])]))}
      ${pickRow('goal', tr('Goal'), Object.entries(GOALS).map(([k, g]) => [k, tr(g[3])]))}
      ${pickRow('diabetes', tr('Diabetes'), [['yes', tr('Yes')], ['no', tr('No')]])}
    </div>
    <h3 class="f-h">${tr('Targets for each day')}</h3>
    <button type="button" class="ghost" data-t="all" disabled>${tr('Use all suggestions')}</button>
    <div class="vlist tlist">${KEYS.map(k => `<div class="trow-wrap" data-k="${k}">${field(k, `${tr(LABEL[k])} (${UNIT[k]})`, 'min="0"')}
      <p class="t-why" data-out="why-${k}"></p></div>`).join('')}</div>
    <p class="muted t-foot">${tr('A number you type is kept. Suggestions never change it by themselves.')}</p>
    <button type="button" class="save" data-t="save">${tr('Save targets')}</button>`;
  for (const k of ['height_cm', 'weight_kg', 'age', 'sex', 'activity', 'goal']) (sheetT.querySelector(`[name=${k}]`).value = t[k] ?? '');
  sheetT.querySelector('[name=diabetes]').value = t.diabetes == null ? '' : t.diabetes ? 'yes' : 'no';
  for (const k of KEYS) sheetT.querySelector(`[name=${k}]`).value = T[k];
  paintSuggestions();
  sheetT.showModal();
}

const val = n => sheetT.querySelector(`[name=${n}]`).value;
function profile() {
  return { height_cm: val('height_cm') === '' ? null : Number(val('height_cm')), weight_kg: val('weight_kg') === '' ? null : Number(val('weight_kg')),
    age: val('age') === '' ? null : Number(val('age')), sex: val('sex') || null, activity: val('activity') || null, goal: val('goal') || null,
    diabetes: val('diabetes') === '' ? null : val('diabetes') === 'yes' };
}
function paintSuggestions() {
  const p = profile(), s = suggest({ ...p, diabetes: p.diabetes ?? false }, tr);
  const note = p.diabetes == null && s ? ` ${tr('Diabetes not chosen: treated as no.')}` : '';
  for (const k of KEYS) {
    sheetT.querySelector(`[data-out=why-${k}]`).innerHTML = s
      ? `${tr('Suggested {value}.', { value: `<b>${s[k][0].toLocaleString()} ${UNIT[k]}</b>` })} ${esc(s[k][1])}${k === 'kcal' ? esc(note) : ''}${Number(val(k)) === s[k][0] ? '' : ` <button type="button" class="link" data-t="use" data-k="${k}">${tr('Use {n}', { n: s[k][0].toLocaleString() })}</button>`}`
      : tr('Fill in the profile above to see a suggestion.');
  }
  sheetT.querySelector('[data-t=all]').disabled = !s;
}

async function onTargetsClick(e) {
  const b = e.target.closest('[data-t]');
  if (!b) return;
  const act = b.dataset.t;
  if (act === 'close') sheetT.close();
  if (act === 'use' || act === 'all') {
    const p = profile(), s = suggest({ ...p, diabetes: p.diabetes ?? false }, tr);
    for (const k of act === 'all' ? KEYS : [b.dataset.k]) sheetT.querySelector(`[name=${k}]`).value = s[k][0];
    paintSuggestions();
  }
  if (act === 'save') {
    const fields = { ...profile(), ...Object.fromEntries(KEYS.map(k => [k, val(k) === '' ? null : Number(val(k))])) };
    const bad = [['height_cm', 80, 250, 'Height'], ['weight_kg', 20, 300, 'Weight'], ['age', 1, 120, 'Age'], ['kcal', 500, 6000, 'Calories'], ['carbs', 0, 800, 'Carbs'],
      ['sugar', 0, 400, 'Sugar'], ['protein', 0, 400, 'Protein'], ['fat', 0, 400, 'Fat'], ['fibre', 0, 200, 'Fibre']]
      .find(([k, lo, hi]) => fields[k] != null && !(fields[k] >= lo && fields[k] <= hi));
    if (bad) return toast(tr('{what} must be between {min} and {max}', { what: tr(bad[3]), min: bad[1], max: bad[2] }), 'bad');
    b.disabled = true;
    try {
      await saveTargets(ctx.uid, fields);
      buzz();
      sheetT.close();
    } catch (err) {
      toast(tr('Not saved: {error}', { error: err.message }), 'bad');
    } finally {
      b.disabled = false;
    }
  }
}
