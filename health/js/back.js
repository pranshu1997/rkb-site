// Android back closes the open sheet instead of leaving the app. Every sheet, keypad and photo viewer is a
// <dialog> opened with showModal(), so this one hook covers all of them. Each open sheet owns one history
// entry (history.state.sheet = how many sheets are open there): back closes the top sheet; a sheet closed by
// its own button, Escape or Save pops its entry. Tabs use replaceState (app.js) and add no entries.
// Inside RKB (contract I5) the shell owns the one back stack: a sheet registers with parent.rkbBack instead
// of touching history, and the shell's Back calls its closeFn. Standalone keeps the state-based code below.
if (history.state?.sheet) history.replaceState(null, ''); // reload: no sheet is open, so the entry may not claim one
const open = []; // open sheets, oldest first
let pendingGo = false; // our history.go() is in flight: history.state is stale until its popstate lands
const depth = () => history.state?.sheet ?? 0;

const shellBack = () => { try { return window.parent !== window && window.parent.rkbBack; } catch { return null; } }; // cross-origin parent: standalone
const shellIds = new Map(); // RKB: open sheet -> its rkbBack id
const shellClosed = () => shellIds.size || setTimeout(() => dispatchEvent(new Event('pulse:sheets-closed')));

const showModal = HTMLDialogElement.prototype.showModal;
HTMLDialogElement.prototype.showModal = function () {
  showModal.call(this);
  if (open.includes(this) || shellIds.has(this)) return;
  const shell = shellBack();
  // Closed by the shell's Back: forget the id first, so the close event below does not call done() again.
  if (shell) return void shellIds.set(this, shell.push('health', () => (shellIds.delete(this), this.close(), shellClosed())));
  open.push(this);
  if (pendingGo) return; // history.state is stale until our pop lands; the landing pushes this sheet's entry
  // A sheet that opens as another closes (pick a test -> its form) reuses the entry not yet popped.
  history[depth() >= open.length ? 'replaceState' : 'pushState']({ sheet: open.length }, '');
};

// Own close: drop the sheet, then pop the entries no open sheet owns (after the close handlers, which may open the next sheet).
// While our history.go() is in flight nothing pushes or pops; its popstate runs sync() again on landing.
let syncing = 0;
const sync = () => {
  syncing = 0;
  if (pendingGo) return;
  if (depth() > open.length) return (pendingGo = true), history.go(open.length - depth());
  for (let n = depth() + 1; n <= open.length; n++) history.pushState({ sheet: n }, ''); // sheets opened during the pop
  if (!open.length) dispatchEvent(new Event('pulse:sheets-closed'));
};
document.addEventListener('close', e => {
  if (shellIds.has(e.target)) {
    if (e.target.open) return; // reopened before this event: it keeps its id
    window.parent.rkbBack.done(shellIds.get(e.target));
    shellIds.delete(e.target);
    return void shellClosed();
  }
  const i = open.indexOf(e.target);
  if (i < 0) return; // closed by back (already dropped) or not a sheet
  open.splice(i, 1);
  syncing ||= setTimeout(sync);
}, true);

// Back: close sheets until each open one has its entry again. Our own history.go() landing only re-syncs.
addEventListener('popstate', () => {
  if (pendingGo) return (pendingGo = false), sync();
  while (open.length > depth()) open.pop().close();
  if (!open.length) dispatchEvent(new Event('pulse:sheets-closed'));
});
