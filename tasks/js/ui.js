import { S, LANG } from './strings.js';
export const esc = s => String(s ?? '').replace(/[&<>"']/g, c => `&#${c.charCodeAt(0)};`);

let timer;
// action = { label, fn }: a text button inside the toast (used for Undo).
// Toasts stay 6 s; 'bad' toasts stay until Close or the next toast replaces them.
export function toast(msg, kind = 'ok', action) {
  if (kind === 'bad' && !action) action = { label: S.close, fn: () => {} };
  const el = document.getElementById('toast');
  el.replaceChildren(msg);
  if (action) {
    const b = Object.assign(document.createElement('button'), { className: 'toast-act', textContent: action.label });
    b.onclick = () => { el.className = ''; action.fn(); };
    el.append(b);
  }
  el.className = `show ${kind}`;
  clearTimeout(timer);
  if (kind !== 'bad') timer = setTimeout(() => (el.className = ''), 6000);
}

// iOS Safari has no navigator.vibrate; clicking a hidden switch input (iOS 18+) plays the system tap haptic.
export function buzz(ms = 10) {
  try {
    if (navigator.vibrate) return navigator.vibrate(ms);
    let w = document.getElementById('hapt');
    if (!w) {
      w = Object.assign(document.createElement('label'), { id: 'hapt', innerHTML: '<input type="checkbox" switch>' });
      w.style.display = 'none';
      document.body.append(w);
    }
    w.click();
  } catch {}
}

export const wide = () => document.documentElement.dataset.layout === 'desktop';

// Android back: every open sheet or sub-page owns one history entry (root tabs own none, so back at a root leaves the app).
// Back pops the newest and calls its close function; closing from code (Close, Save, a tab switch) goes back over its own entry.
// history.go is async but pushState is not: a push made before the popstate of a go lands would be popped by it,
// so pushes (and afterBack work) wait in `after` until every go in flight has landed.
const backs = [], held = new Set(), after = [];
let going = 0, goTimer;
if (history.state?.rkbBack) history.replaceState(null, ''); // reloaded with a sheet open: nothing is open now, so this entry owns nothing
const settle = () => { if (going && !--going) { clearTimeout(goTimer); after.splice(0).forEach(f => f()); } };
function goBack(n) {
  going++;
  history.go(-n);
  clearTimeout(goTimer);
  goTimer = setTimeout(() => { going = 1; settle(); }, 1000); // ponytail: popstate that never comes; 1 s is far past any real one
}
// Run fn now, or once the history moves in flight have landed (URL changes must not land on an entry that is going away).
export const afterBack = fn => (going ? after.push(fn) : fn());
const hold = fn => { held.add(fn); after.push(() => held.delete(fn) && pushBack(fn)); };

// Inside RKB (contract I5) the shell owns the one back stack and its history; this frame never pushes or goes.
// Open: id = rkbBack.push('tasks', closeFn). Closed by our own Close/Save/Escape: rkbBack.done(id).
// The shell's closeFn drops the id before closing, so the close that follows does not call done a second time.
export const rkb = () => { try { return window.parent !== window && window.parent.rkbBack; } catch { return null; } };
// Lists and Places sub-pages: standalone each one is a history entry. Inside RKB the frame adds none (a frame entry newer than a
// shell entry makes the shell's history.go step over the wrong one); app.js registers the sub-page with rkbBack instead.
// The URL is absolute: a relative one resolves against the calling window, and the shell's Back calls closeFn from its own window.
// Places opens from the Lists tab or from the To do row; Back returns to whichever opened it.
export const nav = { placesFrom: 'lists' };
export const goHash = h => (rkb() ? location.replace(location.pathname + location.search + '#' + h) : (location.hash = h));
const ids = new Map(); // shell id -> close fn; a replaced sheet takes over its id
const idOf = fn => [...ids].find(([, f]) => f === fn)?.[0];

export function pushBack(fn) {
  const r = rkb();
  if (r) { const id = r.push('tasks', () => { const f = ids.get(id); ids.delete(id); f?.(); }); return void ids.set(id, fn); }
  if (going) return hold(fn);
  backs.push(fn);
  history.pushState({ rkbBack: backs.length }, '');
}
export function popBack(fn) {
  const r = rkb();
  if (r) { const id = idOf(fn); if (id === undefined) return false; ids.delete(id); r.done(id); return true; }
  if (held.delete(fn)) return false; // closed before its entry was pushed: nothing to go back over
  const i = backs.indexOf(fn);
  if (i < 0) return false;
  const n = backs.length - i;
  backs.length = i; // truncate first, so the popstate that follows finds nothing to close
  goBack(n);
  return true;
}
// A replaced sheet hands its entry (pushed or still held) to the new one. False when old owns none.
function replaceBack(old, fn) {
  if (rkb()) { const id = idOf(old); return id !== undefined && (ids.set(id, fn), true); }
  const i = backs.indexOf(old);
  if (i >= 0) return (backs[i] = fn), true;
  return held.delete(old) && (hold(fn), true);
}
// Close every sheet and sub-page; true when history moves (run URL changes in afterBack).
export function unwind() {
  const r = rkb();
  if (r) { const all = [...ids].reverse(); ids.clear(); all.forEach(([id, f]) => { r.done(id); f(); }); return false; }
  const n = backs.length, fns = [...backs.splice(0), ...held];
  held.clear();
  fns.reverse().forEach(f => f());
  if (n) goBack(n);
  return n > 0;
}
addEventListener('popstate', e => { const depth = e.state?.rkbBack ?? 0; while (backs.length > depth) backs.pop()(); settle(); });

// One bottom sheet at a time. `html` fills it; returns the dialog. Closing removes it.
export function sheet(title, html, { onClose, full, closeLabel, pane } = {}) {
  const old = [...document.querySelectorAll('dialog.sheet')];
  old.forEach(o => { o.replaced = true; o.remove(); }); // some engines fire close on removal: a replaced sheet must not pop the entry it hands over
  const d = document.createElement('dialog');
  d.className = full ? 'sheet full' : pane ? 'sheet pane' : 'sheet';
  d.innerHTML = `<div class="sheet-head"><h2>${esc(title)}</h2><button type="button" class="link" data-close>${closeLabel ?? S.close}</button></div>${html}`;
  d.back = () => d.open && d.close();
  d.addEventListener('click', e => e.target.closest('[data-close]') && d.close());
  d.addEventListener('close', () => { if (!d.replaced) popBack(d.back); d.remove(); onClose?.(); });
  document.body.append(d);
  if (pane) d.show(); else d.showModal(); // pane = desktop side panel: the list beside it stays usable
  if (!old.some(o => replaceBack(o.back, d.back))) pushBack(d.back); // a replaced sheet hands over its history entry
  return d;
}

const dateFmt = new Intl.DateTimeFormat(LANG === 'hi' ? 'hi-IN' : 'en-IN', { day: 'numeric', month: 'short' });
export const fmtDay = day => dateFmt.format(new Date(`${day}T00:00:00`));
export const fmtWhen = iso => {
  const d = new Date(iso);
  return `${dateFmt.format(d)}, ${d.toLocaleTimeString(LANG === 'hi' ? 'hi-IN' : 'en-IN', { hour: 'numeric', minute: '2-digit' })}`;
};

// Two-step confirm in place of window.confirm: the button becomes "Question? Cancel / Yes".
export function inlineConfirm(btn, question, yes, fn) {
  const box = document.createElement('div');
  box.className = 'confirm';
  box.innerHTML = `<p>${esc(question)}</p><div class="btns"><button type="button" class="ghost" data-no>${S.cancel}</button><button type="button" class="bad" data-yes>${esc(yes)}</button></div>`;
  btn.hidden = true;
  btn.after(box);
  box.querySelector('[data-no]').onclick = () => { box.remove(); btn.hidden = false; };
  box.querySelector('[data-yes]').onclick = () => fn();
}

// Phone photos are 3-10 MB; resize to a JPEG (longest side 1280) before upload.
export async function shrink(file, max = 1280) {
  const img = await createImageBitmap(file, { imageOrientation: 'from-image' });
  const k = Math.min(1, max / Math.max(img.width, img.height));
  const c = Object.assign(document.createElement('canvas'), { width: Math.round(img.width * k), height: Math.round(img.height * k) });
  c.getContext('2d').drawImage(img, 0, 0, c.width, c.height);
  return new Promise(r => c.toBlob(r, 'image/jpeg', 0.8));
}

// The tick button for a task or list item: an empty circle when open, a filled circle plus the word Done when done: shape and word, never colour alone.
export const tickBtn = (done, attr = 'data-tick') => `<button class="tick" ${attr} aria-label="${done ? S.tickUndo : S.tickDone}"><span class="circ"></span><span class="tw">${done ? S.stateDone : ''}</span></button>`;
