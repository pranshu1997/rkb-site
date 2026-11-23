import { RULES, nextDue } from './recur.js';
import { S } from './strings.js';
import { ymd, addDays } from './sort.js';
import { fmtDay } from './ui.js';

const LABEL = { weekly: S.repWeekly, monthly: S.repMonthly, quarterly: S.repQuarterly, yearly: S.repYearly };
export const repeatLabel = r => LABEL[r];

// "Repeats" picker. It needs a due date: the next copy is counted from it.
export const repeatField = t => `<label>${S.repeats}<select name="repeat_rule"${t?.due_date ? '' : ' disabled'}>
  <option value="">${S.repNone}</option>${RULES.map(r => `<option value="${r}"${t?.repeat_rule === r ? ' selected' : ''}>${LABEL[r]}</option>`).join('')}</select>
  <small class="rephint muted">${t?.due_date ? '' : S.repNeedsDue}</small></label>`;

// Keep the picker in step with the due date, and show when the next one will be due.
export function bindRepeat(root, anchor) {
  const sel = root.querySelector('[name=repeat_rule]'), due = root.querySelector('[name=due_date]'), hint = root.querySelector('.rephint');
  const paint = () => {
    sel.disabled = !due.value;
    if (!due.value) sel.value = '';
    hint.textContent = !due.value ? S.repNeedsDue : sel.value ? S.repNext(fmtDay(nextDue(sel.value, due.value, anchor?.()))) : '';
  };
  due.addEventListener('input', paint); sel.addEventListener('input', paint);
  paint();
}

// One-tap due dates above the date field: Today, Tomorrow, Next week. They fill the field and fire the same events a typed date does.
export const dueChips = () => `<div class="qdue" data-duechips role="group">${[['qToday', 0], ['qTomorrow', 1], ['qWeek', 7]].map(([k, n]) => `<button type="button" class="chip" data-in="${n}">${S[k]}</button>`).join('')}</div>`;
export function bindDueChips(root) {
  const due = root.querySelector('[name=due_date]');
  root.querySelector('[data-duechips]').onclick = e => {
    const b = e.target.closest('[data-in]'); if (!b) return;
    due.value = addDays(ymd(), +b.dataset.in);
    due.dispatchEvent(new Event('input', { bubbles: true })); due.dispatchEvent(new Event('change', { bubbles: true }));
  };
}
