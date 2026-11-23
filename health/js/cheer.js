// Encouragement: a friendly line after every entry, a bigger one when all four readings are in, a calm streak pill.
// EN and HI through the shared strings table (i18n.js).
import { toast, buzz } from './ui.js';
import { t } from './i18n.js';

const SAVED = ['Saved. Well done.', 'Saved. Good job.', 'Saved. Keep it up.', 'Saved. That helps.'];

// Android: vibrate pattern. iOS has no vibrate(): buzz() plays the system tap three times (iOS 18+ only).
const celebrate = () => navigator.vibrate ? navigator.vibrate([15, 80, 15, 80, 30]) : [0, 130, 260].forEach(t => setTimeout(buzz, t));

let n = 0;
export function cheer(all = false) {
  toast(t(all ? 'All 4 done. Wonderful.' : SAVED[n++ % SAVED.length]));
  if (all) {
    celebrate();
    for (const el of document.querySelectorAll('.left-bar, .streak')) { el.classList.remove('pop'); void el.offsetWidth; el.classList.add('pop'); }
  }
}

export function streakHtml({ current, best, todayDone }) {
  const bestHtml = `<span class="best">${t('Best {n}', { n: best })}</span>`;
  if (!current) return `<span class="note">${t(best ? 'Welcome back. Today is a fresh start.' : 'Enter all 4 today to start a streak.')}</span>${best ? bestHtml : ''}`;
  return `<span class="pill${todayDone ? ' on' : ''}">${t(current === 1 ? '{n} day in a row' : '{n} days in a row', { n: current })}</span>${bestHtml}`;
}
