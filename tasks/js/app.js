import { sb, state, isOwner, paintCached, boot, bindUser, pull, flush, watch, queue, clearLocal, isOffline, checkLists } from './store.js';
import { mountLists } from './listsview.js';
import { mountPlaces } from './placesview.js';
import { mountList, clearKeep } from './tasks.js';
import { mountSettings } from './settings.js';
import { mountTeam } from './team.js';
import { S, LANG } from './strings.js';
import { esc, buzz, unwind, afterBack, rkb, wide, goHash, nav } from './ui.js';

// Inside RKB the shell sets data-layout on every frame; standalone, set it from the window width (same 1024 px breakpoint).
document.querySelector('#app > .skel')?.setAttribute('aria-label', S.loading); // index.html cannot know the language
if (!window.RKB) { const mq = matchMedia('(min-width: 1024px)'), set = () => (document.documentElement.dataset.layout = mq.matches ? 'desktop' : 'phone'); set(); mq.addEventListener('change', set); }
const root = document.getElementById('app');
const net = document.getElementById('net');

function banner() {
  const n = queue.size();
  const off = !navigator.onLine;
  net.hidden = !off && !n;
  net.textContent = off ? S.offline + (n ? ` ${n} waiting.` : '') : S.waiting(n);
}
addEventListener('online', banner); addEventListener('offline', banner); addEventListener('rkb:queue', banner);

// Tabs live in one bar under the RKB top bar. "To do" (not "Today") so it never clashes with Health's Today.
const tabOf = h => (h.startsWith('l/') ? 'lists' : h || 'today');
const barOf = n => (n === 'places' ? nav.placesFrom : n); // Places keeps lit the tab that opened it
let renders = {}, pendingTab = null;
function showTab(name) {
  if (window.RKB && name === 'settings') name = 'today'; // RKB's gear opens Settings
  if (!root.querySelector(`[data-view=${name}]`)) name = 'today';
  // An open sheet or Team person page closes first; the URL below is set only after its history entry is gone.
  // Taps made while that is in flight only change which tab shows, so the last tap wins.
  if (pendingTab) return void (pendingTab = name);
  pendingTab = name;
  unwind();
  afterBack(() => { const n = pendingTab; pendingTab = null; paintTab(n); });
}
function paintTab(name) {
  clearKeep();
  root.querySelector('.pane-empty')?.toggleAttribute('hidden', !['today', 'all', 'done'].includes(name));
  root.querySelectorAll('[data-view]').forEach(v => (v.hidden = v.dataset.view !== name));
  root.querySelectorAll('[data-tab]').forEach(b => b.setAttribute('aria-pressed', b.dataset.tab === barOf(name)));
  if (name === 'lists') { if (!location.hash.startsWith('#l/')) history.replaceState(history.state, '', '#lists'); }
  else history.replaceState(history.state, '', name === 'today' ? location.pathname : `#${name}`);
  document.getElementById('fab')?.toggleAttribute('hidden', name !== 'lists');
  renders[name]?.();
  if (!queue.size()) pull().catch(() => {}); // fresh data on every tab change (there is no Refresh button)
  scrollTo(0, 0);
  syncSub();
}
// Inside RKB a Lists or Places sub-page is one shell back item (contract I5): Back returns to all lists; leaving it any other way
// (own Back, a tab, the sidebar) calls done. Desktop opens a list beside the index, which is no sub-page.
let subId = null;
function syncSub() {
  const r = rkb(); if (!r) return;
  const on = location.hash === '#places' || (!wide() && location.hash.startsWith('#l/'));
  if (on && subId === null) subId = r.push('tasks', () => { subId = null; goHash(nav.placesFrom); });
  else if (!on && subId !== null) { r.done(subId); subId = null; }
}
addEventListener('rkb:tab', e => (window.RKB && e.detail === 'settings' ? window.RKB.openSettings() : showTab(e.detail)));
addEventListener('hashchange', () => root.querySelector('[data-tab]') && showTab(tabOf(location.hash.slice(1))));

function shell(email) {
  // Standalone only (the RKB shell owns text size): Papa's phone starts on Large until he picks a size.
  try { if (!window.RKB && isOwner() && !localStorage.getItem('rkb.size')) document.documentElement.dataset.size = 'large'; } catch {}
  const own = isOwner(), lists = state.listsOk;
  const tab = (n, label) => `<button data-tab="${n}" aria-pressed="false">${label}</button>`;
  root.innerHTML = `<nav class="seg" aria-label="${S.appName}">${tab('today', S.tabToday)}${tab('all', S.tabAll)}${lists ? tab('lists', S.tabLists) : ''}${tab('done', S.tabDone)}${own ? tab('team', S.tabTeam) : ''}${window.RKB ? '' : tab('settings', S.tabSettings)}</nav>
    <div data-view="today"></div><div data-view="all" hidden></div>${lists ? '<div data-view="lists" hidden></div><div data-view="places" hidden></div>' : ''}<div data-view="done" hidden></div>${own ? '<div data-view="team" hidden></div>' : ''}<div data-view="settings" hidden></div><aside class="pane-empty" hidden>${S.paneEmpty}</aside>`;
  const v = n => root.querySelector(`[data-view=${n}]`);
  renders = {
    ...(own ? { team: mountTeam(v('team')) } : {}),
    ...(lists ? { lists: mountLists(v('lists')), places: mountPlaces(v('places')) } : {}),
    today: mountList(v('today'), 'today'), all: mountList(v('all'), 'all'), done: mountList(v('done'), 'done'),
    settings: mountSettings(v('settings'), { email, signOut }),
  };
  // Inside RKB the shell's gear opens Settings; this view (categories, team, reminders) moves into its panel.
  if (window.RKB) {
    const sv = v('settings');
    window.RKB.mountSettings = slot => { sv.hidden = false; slot.append(sv); renders.settings(); };
  }
  root.querySelector('nav').onclick = e => { const b = e.target.closest('[data-tab]'); if (!b) return;
    if (b.dataset.tab === 'lists' && location.hash.startsWith('#l/')) goHash('lists'); // tapping Lists inside a list goes back to all lists
    else showTab(b.dataset.tab);
  };
  showTab(tabOf(location.hash.slice(1)));
}

async function signOut(force) {
  const n = queue.size();
  if (n && !force && !document.querySelector('#signout-ask')) {
    const b = root.querySelector('[data-signout]');
    b.insertAdjacentHTML('afterend', `<div id="signout-ask" class="static"><p>${S.signOutWaiting(n)}</p></div>`);
    b.textContent = S.signOutAnyway;
    return;
  }
  buzz();
  document.getElementById('fab')?.remove();
  // Stop this phone's pushes for this login first (best effort; never blocks sign-out).
  await Promise.race([import('./push.js').then(m => m.disablePush()).catch(() => {}), new Promise(r => setTimeout(r, 1500))]);
  await sb.auth.signOut();
  clearLocal();
  start();
}

async function start() {
  const { data: { session } } = await sb.auth.getSession();
  if (!session) return login();
  const uid = session.user.id, email = session.user.email;
  bindUser(uid);
  if (paintCached() && (state.me = state.people.find(p => p.user_id === uid) ?? null)) {
    shell(email);
    checkLists().then(() => !!state.listsOk !== !!root.querySelector('[data-view=lists]') && shell(email)).catch(() => {});
    pull().then(() => { state.me = state.people.find(p => p.user_id === uid) ?? state.me; renders[tabOf(location.hash.slice(1))]?.(); }).catch(() => {});
  } else {
    root.innerHTML = SKELETON;
    try { await boot(uid); } catch (e) { return fail(e); }
    if (!state.me) return noAccess(email);
    shell(email);
  }
  banner(); flush(); watch();
}

if (window.RKB) window.RKB.signOut = async () => {
  const n = queue.size();
  if (n && !confirm(S.signOutWaiting(n))) return false;
  await signOut(true);
  return true;
};

// Grey placeholder rows while the first load runs (same markup as index.html, so nothing jumps).
const SKELETON = `<div class="skel" aria-busy="true" aria-label="${S.loading}"><div class="large-title"><i></i></div><div class="group">${'<div class="static"><i></i><i></i></div>'.repeat(4)}</div></div>`;
const fail = e => {
  console.error(e);
  root.innerHTML = `<div class="group state" role="alert"><div class="static"><p>${isOffline(e) ? S.noNet : S.loadFailed}</p><button class="save" data-retry>${S.retry}</button></div></div>`;
  root.querySelector('[data-retry]').onclick = start;
};
const noAccess = email => {
  root.innerHTML = `<div class="large-title"><h1>${S.noAccess}</h1></div><div class="group"><div class="static"><p>${esc(S.noAccessBody(email))}</p><p class="muted">${S.noAccessHint}</p></div>
    <button class="row action" data-signout>${S.signOut}</button></div>`;
  root.querySelector('[data-signout]').onclick = () => signOut();
};

function login() {
  let remembered = '';
  try { remembered = localStorage.getItem('login-email') ?? ''; } catch {}
  root.innerHTML = `<form class="login"><img src="icons/icon-192.png" alt="" width="72" height="72"><h1>${S.appName}</h1><p class="muted">${S.signInHint}</p>
    <label>${S.email}<input name="email" type="email" inputmode="email" autocomplete="username" autocapitalize="none" autocorrect="off" spellcheck="false" required value="${esc(remembered)}"></label>
    <label>${S.password}<span class="pw"><input name="password" type="password" autocomplete="current-password" required><button type="button" class="link" data-show>${S.show}</button></span></label>
    <button class="save">${S.signIn}</button><p class="login-error" role="alert"></p></form>`;
  const form = root.querySelector('form'), err = form.querySelector('.login-error');
  (remembered ? form.password : form.email).focus();
  form.querySelector('[data-show]').onclick = e => {
    const shown = form.password.type === 'text';
    form.password.type = shown ? 'password' : 'text';
    e.target.textContent = shown ? S.show : S.hide;
  };
  form.onsubmit = async e => {
    e.preventDefault();
    const email = form.email.value.trim().toLowerCase(), btn = form.querySelector('.save');
    btn.disabled = true; btn.textContent = S.signingIn; err.textContent = '';
    const { error } = await sb.auth.signInWithPassword({ email, password: form.password.value });
    btn.disabled = false; btn.textContent = S.signIn;
    if (error) { err.textContent = error.message === 'Invalid login credentials' ? S.badLogin : isOffline(error) ? S.noNet : error.message; return; }
    try { localStorage.setItem('login-email', email); } catch {}
    start();
  };
}

document.title = S.appName;
document.documentElement.lang = LANG;
if ('serviceWorker' in navigator) {
  // A new deploy's worker takes over in the background; reload once so the open page runs it too.
  const hadController = !!navigator.serviceWorker.controller;
  let reloaded = false;
  navigator.serviceWorker.addEventListener('controllerchange', () => {
    if (hadController && !reloaded) { reloaded = true; location.reload(); }
  });
  if (!window.RKB) navigator.serviceWorker.register('sw.js', { updateViaCache: 'none' }).then(r => r.update()).catch(() => {}); // inside RKB the shell's worker serves every app
}
start();
