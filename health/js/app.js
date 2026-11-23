import './back.js'; // Android back closes sheets; first, so every showModal() goes through it
import { sb, cachedRows, peek, clearCache, clearQueue, pending, flush, isOffline, deadline } from './db.js';
import { mountToday } from './today.js';
import { mountSettings, applyTheme } from './settings.js';
import { esc, toast, buzz } from './ui.js';
import { t, HI } from './i18n.js';

const root = document.getElementById('app');
applyTheme();
if (HI) document.documentElement.lang = 'hi', document.title = t(document.title); // 'Pulse', or 'RKB Health' from the RKB build
const LOADING = () => `<p class="center muted">${t('Loading…')}</p>`;
if (root.querySelector('p')) root.innerHTML = LOADING(); // index.html says it in English before the script runs

// One app for both phones: every screen, every edit. The only difference between the two accounts is whose
// phone it is; all health data belongs to Papa (the `entry` profile), whoever types it.
let ensureSummary = () => {};
async function boot() {
  // Both profiles, kept on the phone: the app opens at once, and the copy refreshes behind.
  // With no stored copy and no network this must not hang on "Loading…": one deadline for the whole wait (C4).
  const query = sb.from('profiles').select('id,role,display_name');
  const { session, people } = await deadline((async () => {
    const { data: { session } } = await sb.auth.getSession(); // reads the stored session; offline it can wait on a token refresh
    return { session, people: session && (peek('people') ?? await cachedRows('people', query)) };
  })());
  if (!session) return login();
  if (peek('people')) cachedRows('people', query).catch(() => {});
  const me = people.find(p => p.id === session.user.id);
  if (!me) return noRole(session.user.email);
  const owner = people.find(p => p.role === 'entry') ?? me;
  const names = Object.fromEntries(people.map(p => [p.id, p.display_name || (p.role === 'entry' ? 'Papa' : 'Pranshu')]));
  const profile = { ...me, owner: owner.id, ownerName: owner.display_name || 'Pulse', names };
  // All views stay mounted and only toggle `hidden`, so realtime keeps each one current.
  // The nav comes first in the DOM: on desktop it is the strip above the views, so Tab reaches it first (phones pin it to the bottom).
  root.innerHTML = `<nav class="tabs">
      <button data-tab="main">${ICON.today}<span>${t('Today')}</span></button>
      <button data-tab="summary">${ICON.summary}<span>${t('History')}</span></button>
      <button data-tab="meds">${ICON.meds}<span>${t('Medicines')}</span></button>
      <button data-tab="tasks">${ICON.tasks}<span>${t('Tests')}</span></button>
      ${window.RKB ? '' : `<button data-tab="settings">${ICON.settings}<span>${t('Settings')}</span></button>`}</nav>
    <div data-view="main"></div><div data-view="summary" hidden></div><div data-view="meds" hidden></div><div data-view="tasks" hidden></div><div data-view="settings" hidden></div>`;
  const view = name => root.querySelector(`[data-view=${name}]`);
  await mountToday(view('main'), profile); // paints from the phone's copy; the network answer follows
  showTab(location.hash.slice(1) || 'main');
  // History (Chart.js and 90 days of rows) loads in the background, so opening it later is instant.
  let summary;
  ensureSummary = () => (summary ??= import('./dashboard.js').then(m => m.mountDashboard(view('summary'), profile)));
  const idle = window.requestIdleCallback ?? (f => setTimeout(f, 300));
  idle(ensureSummary, { timeout: 1500 });
  // The other screens load after Today has painted: less to download and run before first content.
  const [{ mountMeds }, { mountTasks }] = await Promise.all([import('./meds.js'), import('./tasks.js')]);
  await Promise.all([
    mountMeds(view('meds'), profile),
    mountTasks(view('tasks'), profile),
    mountSettings(view('settings'), profile, session.user.email),
  ]);
  // Inside RKB the shell's gear opens Settings; this view (reminders, updates) moves into its panel.
  if (window.RKB) { const sv = view('settings'); window.RKB.mountSettings = slot => { sv.hidden = false; slot.append(sv); }; }
}

const svg = d => `<svg viewBox="0 0 24 24" width="26" height="26" aria-hidden="true"><path d="${d}" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round"/></svg>`;
const ICON = {
  today: svg('M12 20s-7-4.4-7-10a4 4 0 0 1 7-2.6A4 4 0 0 1 19 10c0 5.6-7 10-7 10z'),
  summary: svg('M4 19V5M4 19h16M8 15l3-4 3 2 4-6'),
  meds: svg('M10.5 3.5a5 5 0 0 1 7 7l-7 7a5 5 0 0 1-7-7zM7 7l7 7'),
  tasks: svg('M9 6h11M9 12h11M9 18h11M4 6l1 1 2-2M4 12l1 1 2-2M4 18l1 1 2-2'),
  settings: svg('M12 15a3 3 0 1 0 0-6 3 3 0 0 0 0 6zM19.4 15a1.7 1.7 0 0 0 .3 1.8l.1.1a2 2 0 1 1-2.8 2.8l-.1-.1a1.7 1.7 0 0 0-1.8-.3 1.7 1.7 0 0 0-1 1.5V21a2 2 0 1 1-4 0v-.1a1.7 1.7 0 0 0-1.1-1.5 1.7 1.7 0 0 0-1.8.3l-.1.1a2 2 0 1 1-2.8-2.8l.1-.1a1.7 1.7 0 0 0 .3-1.8 1.7 1.7 0 0 0-1.5-1H3a2 2 0 1 1 0-4h.1a1.7 1.7 0 0 0 1.5-1.1 1.7 1.7 0 0 0-.3-1.8l-.1-.1a2 2 0 1 1 2.8-2.8l.1.1a1.7 1.7 0 0 0 1.8.3H9a1.7 1.7 0 0 0 1-1.5V3a2 2 0 1 1 4 0v.1a1.7 1.7 0 0 0 1 1.5 1.7 1.7 0 0 0 1.8-.3l.1-.1a2 2 0 1 1 2.8 2.8l-.1.1a1.7 1.7 0 0 0-.3 1.8V9a1.7 1.7 0 0 0 1.5 1H21a2 2 0 1 1 0 4h-.1a1.7 1.7 0 0 0-1.5 1z'),
};

function showTab(name) {
  if (window.RKB && name === 'settings') name = 'main'; // RKB's gear opens Settings
  if (!root.querySelector(`[data-view=${name}]`)) name = 'main';
  if (name === 'summary') ensureSummary();
  root.querySelectorAll('[data-view]').forEach(v => (v.hidden = v.dataset.view !== name));
  root.querySelectorAll('[data-tab]').forEach(b => b.classList.toggle('on', b.dataset.tab === name));
  history.replaceState(null, '', name === 'main' ? location.pathname : `#${name}`);
  scrollTo(0, name === 'summary' && summaryY != null ? summaryY : 0);
  if (name === 'summary') summaryY = null;
}

// A calendar day on History opens on Today; the History tab then comes back where it was.
let summaryY = null;
addEventListener('pulse:open-day', () => { summaryY = scrollY; showTab('main'); });

// Email + password, once per phone. Accounts are made by the admin; public sign-up is off.
// (Email links open Safari on iOS, not the home-screen app, and hosted email templates need SMTP.)
function login() {
  let remembered = '';
  try { remembered = localStorage.getItem('login-email') ?? ''; } catch {} // not 'pulse:' prefixed: sign-out keeps it
  root.innerHTML = `
    <form class="login">
      <img src="icons/icon-192.png" alt="" width="72" height="72">
      <h1>${t('RKB Health')}</h1>
      <p class="muted">${t('Sign in once on this device. It stays signed in.')}</p>
      <label>${t('Email')}<input name="email" type="email" inputmode="email" autocomplete="username" autocapitalize="none"
        autocorrect="off" spellcheck="false" required value="${esc(remembered)}"></label>
      <label>${t('Password')}<span class="pw"><input name="password" type="password" autocomplete="current-password" required>
        <button type="button" class="link" data-act="show">${t('Show')}</button></span></label>
      <button class="save">${t('Sign in')}</button>
      <p class="login-error" role="alert"></p>
    </form>`;
  const form = root.querySelector('form');
  const error = form.querySelector('.login-error');
  (remembered ? form.password : form.email).focus();
  form.querySelector('[data-act=show]').onclick = e => {
    const shown = form.password.type === 'text';
    form.password.type = shown ? 'password' : 'text';
    e.target.textContent = t(shown ? 'Show' : 'Hide');
  };
  form.onsubmit = async e => {
    e.preventDefault();
    const email = form.email.value.trim().toLowerCase();
    const button = form.querySelector('.save');
    button.disabled = true;
    button.textContent = t('Signing in…');
    error.textContent = '';
    const { error: err } = await sb.auth.signInWithPassword({ email, password: form.password.value });
    button.disabled = false;
    button.textContent = t('Sign in');
    if (err) {
      error.textContent = err.message === 'Invalid login credentials' ? t('Email or password is wrong. Check both and try again.')
        : isOffline(err) ? t('No internet. Connect and try again.') : err.message;
      return;
    }
    try { localStorage.setItem('login-email', email); } catch {}
    start();
  };
}

function noRole(email) {
  root.innerHTML = `<div class="card narrow"><p>${t('{email} is signed in but has no access yet.', { email: esc(email) })}</p>
    <p class="muted">${t('Ask Pranshu to add you.')}</p></div>${signOutButton()}`;
}

const signOutButton = () => `<p class="center"><button class="link" data-act="signout">${t('Sign out')}</button></p>`;

root.addEventListener('click', async e => {
  const tab = e.target.closest('[data-tab]');
  if (tab) showTab(tab.dataset.tab);
  const signout = e.target.closest('[data-act=signout]');
  if (signout) {
    signout.disabled = true; // answers the tap while the sign-out finishes
    if (!(await signOut())) signout.disabled = false;
  }
});

// Returns false when the user keeps the unsent entries.
async function signOut() {
  // Cached rows and queued entries (with photos) must not stay on a phone someone else may use.
  const waiting = (await pending()).length;
  if (waiting && !confirm(t('{n} entries are not sent yet. Sign out and delete them?', { n: waiting }))) return false;
  buzz();
  await sb.auth.signOut();
  clearCache();
  await clearQueue();
  start();
  return true;
}
if (window.RKB) window.RKB.signOut = signOut;

// ── Offline: install the shell, show the queue, sync when the network returns ──
// ── Updates: a new version applies by itself the next time the app is opened or comes back ──
// Only when no panel is open, so a half-typed reading is never lost.
let hadController = !!navigator.serviceWorker?.controller;
let updateReady = false;
const applyUpdate = () => updateReady && !document.querySelector('dialog[open]') && location.reload();
if ('serviceWorker' in navigator) {
  const keepLibs = () => navigator.serviceWorker.controller?.postMessage({
    cache: performance.getEntriesByType('resource').map(r => r.name).filter(u => /cdn\.jsdelivr\.net/.test(u)),
  });
  if (!window.RKB) navigator.serviceWorker.register('sw.js'); // inside RKB the shell's worker serves every app
  navigator.serviceWorker.addEventListener('controllerchange', () => {
    keepLibs();
    if (hadController) (updateReady = true), applyUpdate(); // first install is not an update
    hadController = true;
  });
  keepLibs();
  addEventListener('pulse:sheets-closed', applyUpdate); // back.js: the last sheet closed and its entry is popped, so the reload cannot race it
}
export async function checkForUpdate() {
  const reg = await navigator.serviceWorker?.getRegistration();
  await reg?.update().catch(() => {});
}

// ── Pull down to refresh (home-screen apps have no browser refresh) ──
const ptr = Object.assign(document.createElement('div'), { id: 'ptr', innerHTML:
  '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.2" stroke-linecap="round"><path d="M20 12a8 8 0 1 1-2.3-5.7M20 4v5h-5"/></svg>' });
document.body.append(ptr);
let pullStart = null;
addEventListener('touchstart', e => {
  pullStart = scrollY <= 0 && !document.querySelector('dialog[open]') ? e.touches[0].clientY : null;
}, { passive: true });
addEventListener('touchmove', e => {
  if (pullStart == null) return;
  const d = Math.max(0, Math.min(120, e.touches[0].clientY - pullStart));
  ptr.style.opacity = Math.min(1, d / 50);
  ptr.style.transform = `translateY(${d - 70}px) rotate(${d * 3}deg)`;
}, { passive: true });
addEventListener('touchend', async e => {
  if (pullStart == null) return;
  const pulled = e.changedTouches[0].clientY - pullStart > 80;
  pullStart = null;
  if (!pulled) return (ptr.style.transform = '', ptr.style.opacity = '');
  ptr.style.transform = 'translateY(0)';
  ptr.classList.add('spin');
  await refresh();
  ptr.classList.remove('spin');
  ptr.style.transform = '';
  ptr.style.opacity = '';
});
// Refresh = send waiting entries, fetch the newest data, and pick up a new version if there is one.
export async function refresh() {
  await Promise.all([flush(), checkForUpdate()]);
  dispatchEvent(new Event('pulse:refresh'));
  await new Promise(r => setTimeout(r, 400));
  if (updateReady) applyUpdate();
  return updateReady;
}
addEventListener('pulse:check-update', async () => toast(t((await refresh()) ? 'Updating…' : 'You have the newest version')));

const net = document.getElementById('net');
let waiting = 0;
const paintNet = () => {
  const off = !navigator.onLine;
  net.hidden = !waiting && !off;
  net.textContent = off ? t('No internet. Changes are sent later.') + (waiting ? ` ${t('{n} waiting.', { n: waiting })}` : '') : t('{n} waiting to send', { n: waiting });
};
addEventListener('pulse:queue', e => ((waiting = e.detail), paintNet()));
addEventListener('pulse:synced', () => toast(t('All entries sent')));
addEventListener('pulse:dropped', e => toast(t('One entry was rejected: {error}', { error: e.detail }), 'bad'));
addEventListener('online', () => (paintNet(), flush()));
addEventListener('offline', paintNet);
document.addEventListener('visibilitychange', () => document.visibilityState === 'visible' && flush());
setInterval(flush, 30_000);

// Nothing painted yet: a calm card with Try again (same words as Today's first-load failure); later errors toast.
const start = () => boot().then(flush).catch(err => {
  if (root.querySelector('[data-view]')) return toast(t('Could not load: {error}', { error: err.message }), 'bad');
  root.innerHTML = `<div class="card narrow"><p class="load-fail" role="alert">${t(navigator.onLine ? 'Could not load.' : 'No internet.')}
    <button type="button" class="ghost" data-act="reboot">${t('Try again')}</button></p></div>`;
  root.querySelector('[data-act=reboot]').onclick = () => ((root.innerHTML = LOADING()), start());
});
start();
