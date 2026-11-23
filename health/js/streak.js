// Streak: consecutive days on which all four checklist readings (BP, sugar, steps, weight) were entered. Pure rules + the loader is in today.js (db.js needs the browser).
// A missed day only restarts the count quietly; nothing is owed or shown as a failure. Read-only: no stored data is changed.
import { METRIC_ALSO } from './config.js';
import { localDate } from './slots.js';

export const STREAK_FROM = '2026-10-01';
export const STREAK_ITEMS = ['bp', 'sugar', 'steps', 'weight']; // the "N of 4 left" checklist; minutes walked count as steps
export const METRICS = [...STREAK_ITEMS, 'walk_min'];

const ms = ymd => { const [y, m, d] = ymd.split('-').map(Number); return Date.UTC(y, m - 1, d); };
const addDays = (ymd, n) => new Date(ms(ymd) + n * 86_400_000).toISOString().slice(0, 10);

// day -> Set of metrics entered that day. Deleted rows are ignored.
export function indexReadings(rows) {
  const idx = new Map();
  for (const r of rows) if (!r.deleted_at && METRICS.includes(r.metric)) (idx.get(r.slot_date) ?? idx.set(r.slot_date, new Set()).get(r.slot_date)).add(r.metric);
  return idx;
}

export const dayComplete = (idx, ymd) => { const h = idx.get(ymd); return !!h && STREAK_ITEMS.every(m => h.has(m) || h.has(METRIC_ALSO[m])); };

// current = run of complete days ending today (or yesterday while today is still open). best = longest run ever.
export function streakSummary(rows, now = new Date()) {
  const idx = indexReadings(rows), today = localDate(now), first = [...idx.keys()].sort()[0];
  let run = 0, best = 0;
  if (first) for (let d = first; d <= today; d = addDays(d, 1)) {
    if (dayComplete(idx, d)) best = Math.max(best, ++run);
    else if (d !== today) run = 0; // today still open: it never breaks the run
  }
  return { current: run, best, todayDone: dayComplete(idx, today) };
}
