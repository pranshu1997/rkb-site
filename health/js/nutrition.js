// Food search and nutrient maths. Pure functions, so tests run in node.
// A food is {id, name, al (extra search words), kcal, p, c, f, fi, s (all per 100 g), sv: [[label, grams], ...]}.

export const unpack = db => db.f.map(([id, name, al, kcal, p, c, f, fi, s, sv]) =>
  ({ id, name, al, kcal, p, c, f, fi, s, sv, hay: `${name} ${al}`.toLowerCase() }));

// Every typed word must start a word in the name or the aliases (or sit inside one, ranked lower).
// Starts-with-the-whole-query first, then word starts, then substrings; shorter names before longer.
export function search(foods, q, limit = 30) {
  const words = q.toLowerCase().split(/[^a-z0-9]+/).filter(Boolean);
  if (!words.length) return [];
  const scored = [];
  for (const f of foods) {
    const al = f.al.toLowerCase().split(' '); // a curated alias that equals the typed word is the best hit
    let score = f.hay.startsWith(words.join(' ')) || words.every(w => al.includes(w)) ? 0 : 1;
    let ok = true;
    for (const w of words) {
      if (f.hay.includes(` ${w}`) || f.hay.startsWith(w) || f.hay.includes(`(${w}`)) continue;
      if (f.hay.includes(w)) score = Math.max(score, 2);
      else { ok = false; break; }
    }
    if (ok) scored.push([score, f.name.length, f]);
  }
  return scored.sort((a, b) => a[0] - b[0] || a[1] - b[1]).slice(0, limit).map(x => x[2]);
}

const r1 = x => Math.round(x * 10) / 10;
// Nutrients for `qty` servings of `serving` ([label, grams]); the entry stores them, so a later database change never rewrites history.
export function entryFor(food, serving, qty) {
  const grams = serving[1] * qty, k = grams / 100;
  return { unit: serving[0], qty, grams: r1(grams), kcal: Math.round(food.kcal * k), protein: r1(food.p * k), carbs: r1(food.c * k),
    fat: r1(food.f * k), fibre: r1(food.fi * k), sugar: r1(food.s * k) };
}

export const ZERO = { kcal: 0, protein: 0, carbs: 0, fat: 0, fibre: 0, sugar: 0 };
export function totals(rows) {
  const t = { ...ZERO };
  for (const r of rows) for (const k in t) t[k] += Number(r[k] ?? 0);
  for (const k in t) t[k] = k === 'kcal' ? Math.round(t[k]) : r1(t[k]);
  return t;
}

// "2 × roti", "1.5 × katori"; a 100 g serving reads as grams.
export const portion = r => (r.unit === '100 g' ? `${Math.round(r.qty * 100)} g` : `${Number(r.qty)} × ${r.unit}`);

// Past entries (newest first) -> foods to offer first: the 5 latest, then the 5 most often eaten. Each keeps its last unit + qty.
export function recents(rows, n = 5) {
  const by = new Map();
  for (const r of rows) {
    const g = by.get(r.food_id);
    if (g) g.count++;
    else by.set(r.food_id, { food_id: r.food_id, name: r.name, unit: r.unit, qty: Number(r.qty), count: 1 });
  }
  const all = [...by.values()];
  const recent = all.slice(0, n);
  const often = all.filter(g => !recent.includes(g) && g.count > 1).sort((a, b) => b.count - a.count).slice(0, n);
  return { recent, often };
}

// One total per day that has entries: [{slot_date, value}], oldest first, for the Summary bars.
export function dailySums(rows, key) {
  const by = new Map();
  for (const r of rows) by.set(r.slot_date, (by.get(r.slot_date) ?? 0) + Number(r[key] ?? 0));
  return [...by].sort((a, b) => a[0].localeCompare(b[0])).map(([slot_date, v]) => ({ slot_date, value: r1(v) }));
}

// "Over by 120 kcal" / "560 kcal left"; over = true past the target. `tr` translates (i18n t); the default only fills {n} {unit}.
const fill = (s, v) => s.replace(/\{(\w+)\}/g, (m, k) => v[k]);
export const vsTarget = (value, target, unit, tr = fill) =>
  value > target ? { over: true, text: tr('Over by {n} {unit}', { n: Math.round(value - target), unit }) } : { over: false, text: tr('{n} {unit} left', { n: Math.round(target - value), unit }) };
