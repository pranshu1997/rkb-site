// Food targets: the stored profile + targets (one food_target row). Suggestion maths is in targetcalc.js.
// Stored values win over suggestions; a missing value falls back to FOOD_TARGET in config.js.
import { sb, upsert, cachedRows } from './db.js';
import { FOOD_TARGET } from './config.js';
import { KEYS } from './targetcalc.js';
export * from './targetcalc.js';

// ── Stored row ──────────────────────────────────────────────────────────────
let current = null; // the food_target row, or {} when none saved yet
export const stored = () => current ?? {};
// Effective target: the saved number, else the built-in default.
export const target = k => (Number(current?.[k]) > 0 ? Number(current[k]) : FOOD_TARGET[k]);
export const targets = () => Object.fromEntries(KEYS.map(k => [k, target(k)]));

export async function loadTargets(first = false) {
  try {
    const got = await cachedRows('food:target', sb.from('food_target').select('*').is('deleted_at', null).limit(1), first);
    current = got[0] ?? {};
  } catch (e) {
    if (e.message !== 'nocache') console.error(e);
    current ??= {}; // table missing (migration not applied yet) or no copy yet: defaults
  }
  dispatchEvent(new Event('pulse:targets'));
  return current;
}

export async function saveTargets(uid, fields) {
  const row = { user_id: uid, ...Object.fromEntries(Object.entries(fields).map(([k, v]) => [k, v === '' || v == null || Number.isNaN(v) ? null : v])), deleted_at: null };
  await upsert('food_target', row, 'user_id');
  current = { ...current, ...row };
  try { localStorage.setItem('pulse:food:target', JSON.stringify([current])); } catch {}
  dispatchEvent(new Event('pulse:targets'));
}
