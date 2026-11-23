import { TABS, textOf, visible, groupByDay, sections, sectionLabel, parseWatch, pruneDismissed, ago, isStale, shareText, fmtDate, emptyKind } from './logic.js';

export const APP_VERSION = 'rkb-v15'; // bump with CACHE in sw.js; tests/logic.test.mjs checks they match

// ── Phone storage (no login, no server: each phone keeps its own) ──
const KEY = { news: 'rkb.news', lang: 'rkb.lang', dismissed: 'rkb.dismissed', saved: 'rkb.saved', watch: 'rkb.watch', size: 'rkb.size', theme: 'rkb.theme', tab: 'rkb.tab' };
const load = (k, d) => { try { return JSON.parse(localStorage.getItem(k)) ?? d; } catch { return d; } };
const keep = (k, v) => { try { localStorage.setItem(k, JSON.stringify(v)); } catch { /* storage full: next tap still works in memory */ } };

let speaking = null; // id of the story being read aloud
const S = {
  news: load(KEY.news, { updated: null, items: [] }),
  lang: load(KEY.lang, 'en'),
  dismissed: pruneDismissed(load(KEY.dismissed, {})),
  saved: load(KEY.saved, {}),   // id -> full item, so saved stories outlive the 7-day cleanup
  watch: load(KEY.watch, []),
  tab: load(KEY.tab, 'politics'),
};
keep(KEY.dismissed, S.dismissed);
document.documentElement.dataset.size = load(KEY.size, 'normal');

const L = {
  en: { updated: 'Updated', never: 'Not updated yet', saved: 'Saved', settings: 'Settings',
    listen: 'Listen', stop: 'Stop', share: 'Share on WhatsApp', shareShort: 'Share', save: 'Save', unsave: 'Remove from saved', dismiss: 'Remove',
    removed: 'Removed', clear: 'Clear', clearDay: 'Clear this day', removedN: n => `Removed ${n} stories`, undo: 'Undo', also: 'Also in', watch: 'Watchlist', pay: 'Subscribers only', reserve: 'Reserve',
    auction: 'Auction', empty: 'All read: new news comes at 6 am and 6 pm.', noSaved: 'Nothing saved yet: tap Save on a story to keep it.',
    loading: 'Getting the news…', none: 'No news yet: it comes at 6 am and 6 pm.', noNet: 'Could not get the news, check the internet.', retry: 'Try again', refresh: 'Refresh',
    stale: h => `News last came ${h} hours ago.`, offline: 'Offline, showing the last news.', failed: 'Could not refresh, showing the last news.', close: 'Close', size: 'Text size', sizes: ['Normal', 'Large', 'Larger'],
    theme: 'Appearance', themes: ['Auto', 'Light', 'Dark'], watchHelp: 'One name per line: clients, companies, people. Stories that name them come first.',
    watchSaved: 'Watchlist saved', restore: n => `Show ${n} removed stories again`, restored: 'Removed stories are back', stories: n => `${n} stories` },
  hi: { updated: 'अपडेट', never: 'अभी अपडेट नहीं हुआ', saved: 'सहेजी गई', settings: 'सेटिंग',
    listen: 'सुनें', stop: 'रोकें', share: 'WhatsApp पर भेजें', shareShort: 'भेजें', save: 'सहेजें', unsave: 'सहेजी से हटाएँ', dismiss: 'हटाएँ',
    removed: 'हटा दी', clear: 'सब हटाएँ', clearDay: 'इस दिन की खबरें हटाएँ', removedN: n => `${n} खबरें हटा दीं`, undo: 'वापस लाएँ', also: 'यह भी', watch: 'वॉचलिस्ट', pay: 'सिर्फ़ सदस्य', reserve: 'आरक्षित मूल्य',
    auction: 'नीलामी', empty: 'सब पढ़ लिया, नई खबरें सुबह 6 और शाम 6 बजे आती हैं।', noSaved: 'अभी कुछ नहीं सहेजा, खबर पर सहेजें दबाएँ।',
    loading: 'खबरें आ रही हैं…', none: 'अभी कोई खबर नहीं, खबरें सुबह 6 और शाम 6 बजे आती हैं।', noNet: 'खबरें नहीं आ सकीं, इंटरनेट देखें।', retry: 'फिर कोशिश करें', refresh: 'ताज़ा करें',
    stale: h => `खबरें ${h} घंटे पहले आई थीं।`, offline: 'इंटरनेट नहीं है, पिछली खबरें दिख रही हैं।',
    failed: 'ताज़ा नहीं हो सका, पिछली खबरें दिख रही हैं।', close: 'बंद करें', size: 'अक्षर का आकार', sizes: ['सामान्य', 'बड़ा', 'और बड़ा'],
    theme: 'रंग', themes: ['ऑटो', 'हल्का', 'गहरा'], watchHelp: 'हर लाइन में एक नाम: क्लाइंट, कंपनी, व्यक्ति। इनकी खबरें सबसे ऊपर आएँगी।',
    watchSaved: 'वॉचलिस्ट सहेजी गई', restore: n => `हटाई गई ${n} खबरें फिर दिखाएँ`, restored: 'हटाई गई खबरें वापस आ गईं', stories: n => `${n} खबरें` },
};
const t = () => L[S.lang];

const svg = d => `<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true">${d}</svg>`;
const ICON = {
  refresh: svg('<path d="M20 12a8 8 0 1 1-2.3-5.7M20 4v5h-5"/>'),
  saved: svg('<path d="M6 3h12v18l-6-4-6 4z"/>'),
  savedOn: '<svg viewBox="0 0 24 24" fill="currentColor" aria-hidden="true"><path d="M6 3h12v18l-6-4-6 4z"/></svg>',
  settings: svg('<circle cx="12" cy="12" r="3"/><path d="M19.4 15a1.7 1.7 0 0 0 .3 1.8l.1.1a2 2 0 1 1-2.8 2.8l-.1-.1a1.7 1.7 0 0 0-1.8-.3 1.7 1.7 0 0 0-1 1.5V21a2 2 0 1 1-4 0v-.1a1.7 1.7 0 0 0-1.1-1.5 1.7 1.7 0 0 0-1.8.3l-.1.1a2 2 0 1 1-2.8-2.8l.1-.1a1.7 1.7 0 0 0 .3-1.8 1.7 1.7 0 0 0-1.5-1H3a2 2 0 1 1 0-4h.1a1.7 1.7 0 0 0 1.5-1.1 1.7 1.7 0 0 0-.3-1.8l-.1-.1a2 2 0 1 1 2.8-2.8l.1.1a1.7 1.7 0 0 0 1.8.3H9a1.7 1.7 0 0 0 1-1.5V3a2 2 0 1 1 4 0v.1a1.7 1.7 0 0 0 1 1.5 1.7 1.7 0 0 0 1.8-.3l.1-.1a2 2 0 1 1 2.8 2.8l-.1.1a1.7 1.7 0 0 0-.3 1.8V9a1.7 1.7 0 0 0 1.5 1H21a2 2 0 1 1 0 4h-.1a1.7 1.7 0 0 0-1.5 1z"/>'),
  listen: svg('<path d="M11 5L6 9H2v6h4l5 4zM15.5 8.5a5 5 0 0 1 0 7M19 5a10 10 0 0 1 0 14"/>'),
  stop: '<svg viewBox="0 0 24 24" fill="currentColor" aria-hidden="true"><rect x="6" y="6" width="12" height="12" rx="2"/></svg>',
  out: svg('<path d="M14 4h6v6M20 4l-9 9M18 14v5a1 1 0 0 1-1 1H5a1 1 0 0 1-1-1V7a1 1 0 0 1 1-1h5"/>'),
  share: svg('<path d="M12 15V3M8 7l4-4 4 4M5 12v7a2 2 0 0 0 2 2h10a2 2 0 0 0 2-2v-7"/>'),
};
const safeUrl = u => (/^https?:\/\//i.test(u ?? '') ? u : '#'); // feed text decides the link; never a javascript: URL
const esc = s => String(s ?? '').replace(/[&<>"']/g, c => `&#${c.charCodeAt(0)};`);
const $ = s => document.querySelector(s);

// ── Rendering ─────────────────────────────────────────────────────
const root = $('#app');
root.innerHTML = `
  ${window.RKB ? '' : `<header class="top"><div class="acts">
      <div class="seg" role="group" aria-label="Language"><button data-lang="en">EN</button><button data-lang="hi" lang="hi">हि</button></div>
      <button class="icon" data-act="settings">${ICON.settings}</button>
    </div></header>`}
  <div class="large-title"><h1 data-title></h1><p class="sub"><span data-count></span><span data-stamp></span></p></div>
  <nav class="chips" aria-label="Sections">${TABS.map(x => `<button data-tab="${x.id}"></button>`).join('')}<button data-act="saved" class="saved">${ICON.saved}<span data-saved-label></span></button></nav>
  <div class="banner" data-stale role="status" hidden><p></p><button class="link" data-act="fetch"></button></div>
  <section data-list></section>`;

// The arrow sticks to the last word so it never wraps onto a line of its own.
const titleWithArrow = ti => { const i = ti.lastIndexOf(' '); return `${esc(ti.slice(0, i + 1))}<span class="nw">${esc(ti.slice(i + 1))}${ICON.out}</span>`; };
function storyHTML(it, { inSaved = false } = {}) {
  const x = textOf(it, S.lang);
  const facts = it.tab === 'results' ? esc(it.key_numbers ?? '')
    : it.tab === 'auctions' ? [it.city, it.reserve && `${t().reserve} ${it.reserve}`, it.auction_date && `${t().auction} ${fmtDate(it.auction_date, S.lang)}`].filter(Boolean).map(f => `<span>${esc(f)}</span>`).join(' · ')
    : '';
  const saved = it.id in S.saved;
  return `<article class="story" data-id="${esc(it.id)}" lang="${x.lang}">
    <div class="meta"><span>${esc(it.source)} · ${esc(ago(it.time, S.lang))}</span>
      ${inSaved ? '' : `<button class="link dismiss" data-act="dismiss">${t().dismiss}</button>`}</div>
    ${it.watch || it.paywall ? `<div class="tags">${it.watch ? `<span class="tag watch">${t().watch}: ${esc(it.watch)}</span>` : ''}${it.paywall ? `<span class="tag pay">${t().pay}</span>` : ''}</div>` : ''}
    <h2><a href="${esc(safeUrl(it.url))}" target="_blank" rel="noopener">${titleWithArrow(x.title)}</a></h2>
    ${facts ? `<p class="facts">${facts}</p>` : ''}
    ${x.summary ? `<p class="sum">${esc(x.summary)}</p>` : ''}
    ${it.also?.length ? `<p class="also">${t().also} ${esc(it.also.join(', '))}</p>` : ''}
    <div class="row">
      <div class="acts">
        <button class="ghost" data-act="listen">${speaking === it.id ? ICON.stop + `<span>${t().stop}</span>` : ICON.listen + `<span>${t().listen}</span>`}</button>
        <button class="ghost" data-act="save" aria-pressed="${saved}">${saved ? ICON.savedOn : ICON.saved}<span>${saved ? t().saved : t().save}</span></button>
        <button class="ghost" data-act="share" aria-label="${t().share}">${ICON.share}<span>${t().shareShort}</span></button>
      </div>
    </div>
  </article>`;
}

// Empty / loading / error: one calm sentence and one action, in a centred card.
const stateCard = (msg, act) => `<div class="empty"><p>${msg}</p>${act ? `<button class="ghost" data-act="fetch">${act}</button>` : ''}</div>`;
const hasCopy = () => !!(S.news.items.length || S.news.updated);
function emptyState() {
  const kind = emptyKind(hasCopy(), !!refreshing, S.failed);
  if (kind === 'failed') return stateCard(t().noNet, t().retry);
  if (kind === 'empty') return stateCard(t().empty, t().refresh);
  if (kind === 'loading') return stateCard(t().loading);
  return stateCard(t().none, t().refresh);
}

// Over the list: a failed refresh (offline has its own top banner), else old news. One sentence + one action.
// Also run on its own by refresh(), so a background refresh never rewrites the list.
function banner() {
  const u = S.news.updated, stale = $('[data-stale]'), failed = S.failed && navigator.onLine && hasCopy();
  stale.hidden = !(failed || (shown.length && isStale(u)));
  if (!stale.hidden) {
    stale.firstChild.textContent = failed ? t().failed : t().stale(Math.round((Date.now() - Date.parse(u)) / 36e5));
    stale.lastChild.textContent = failed ? t().retry : t().refresh;
  }
  document.querySelectorAll('[data-act=fetch]').forEach(b => { b.disabled = !!refreshing; });
}

let shown = [], dayGroups = [];
function render() {
  const tab = TABS.find(x => x.id === S.tab) ?? TABS[0];
  document.documentElement.lang = S.lang;
  $('[data-title]').textContent = tab[S.lang];
  const groups = dayGroups = sections(groupByDay(visible(S.news.items, tab.id, S.dismissed, S.watch)));
  shown = groups.flatMap(g => g.items);
  $('[data-count]').textContent = shown.length ? t().stories(shown.length) : '';
  $('[data-list]').innerHTML = shown.length
    ? groups.map(g => `<section class="day" data-day="${g.key}"><header class="day-head"><h3>${sectionLabel(g, S.lang)}</h3><button class="link" data-act="clear-day" aria-label="${t().clearDay}">${t().clear}</button></header><div class="list">${g.items.map(i => storyHTML(i)).join('')}</div></section>`).join('')
    : emptyState();
  const u = S.news.updated;
  $('[data-stamp]').textContent = u ? `${t().updated} ${new Date(u).toLocaleString(S.lang === 'hi' ? 'hi-IN' : 'en-IN', { day: 'numeric', month: 'short', hour: 'numeric', minute: '2-digit' })}` : t().never;
  banner();
  document.querySelectorAll('[data-lang]').forEach(b => b.setAttribute('aria-pressed', b.dataset.lang === S.lang));
  document.querySelectorAll('.chips [data-tab]').forEach(b => {
    const x = TABS.find(y => y.id === b.dataset.tab);
    b.setAttribute('aria-pressed', x.id === tab.id);
    b.textContent = x[S.lang];
  });
  for (const [act, key] of [['saved', 'saved'], ['settings', 'settings']]) {
    const b = root.querySelector(`[data-act=${act}]`);
    if (!b) continue; // no Settings button inside RKB
    b.setAttribute('aria-label', t()[key]);
    b.title = t()[key];
    const ns = Object.keys(S.saved).length;
    b.querySelector('[data-saved-label]')?.replaceChildren(t()[key], ...(ns ? [Object.assign(document.createElement('span'), { className: 'n', textContent: ns })] : []));
  }
}

// ── Toast with Undo ──────────────────────────────────────────────
let toastTimer;
function toast(msg, undo) {
  const el = $('#toast');
  el.innerHTML = `<span>${esc(msg)}</span>${undo ? `<button>${t().undo}</button>` : ''}`;
  if (undo) el.querySelector('button').onclick = () => { hideToast(); undo(); };
  el.className = 'show';
  clearTimeout(toastTimer);
  toastTimer = setTimeout(hideToast, 6000); // toasts stay >= 6 s (contract 7b)
}
function hideToast() { clearTimeout(toastTimer); $('#toast').className = ''; }

// ── Actions ──────────────────────────────────────────────────────
const byId = id => shown.find(i => i.id === id) ?? S.news.items.find(i => i.id === id) ?? S.saved[id];

function dismiss(id, el) {
  S.dismissed[id] = Date.now();
  keep(KEY.dismissed, S.dismissed);
  const done = () => render();
  if (el && !matchMedia('(prefers-reduced-motion: reduce)').matches) {
    el.classList.add('gone');
    setTimeout(done, 200);
  } else done();
  toast(t().removed, () => { delete S.dismissed[id]; keep(KEY.dismissed, S.dismissed); render(); });
}

function clearDay(day) {
  const ids = dayGroups.find(g => g.key === day).items.map(i => i.id);
  const now = Date.now();
  ids.forEach(id => { S.dismissed[id] = now; });
  keep(KEY.dismissed, S.dismissed);
  render();
  toast(t().removedN(ids.length), () => { ids.forEach(id => delete S.dismissed[id]); keep(KEY.dismissed, S.dismissed); render(); });
}

function toggleSave(id) {
  if (id in S.saved) delete S.saved[id];
  else { const { watch, ...it } = byId(id); S.saved[id] = it; }
  keep(KEY.saved, S.saved);
}

// By query, not by a kept button: a render can replace the story while it is read aloud.
const resetListen = () => document.querySelectorAll('[data-act=listen]').forEach(b => { b.innerHTML = `${ICON.listen}<span>${t().listen}</span>`; });
function listen(id, btn) {
  speechSynthesis.cancel();
  resetListen();
  if (speaking === id) return (speaking = null);
  const x = textOf(byId(id), S.lang);
  const u = new SpeechSynthesisUtterance(`${x.title}. ${x.summary ?? ''}`);
  u.lang = x.lang === 'hi' ? 'hi-IN' : 'en-IN';
  u.rate = 0.9;
  u.onend = u.onerror = () => { if (speaking === id) { speaking = null; resetListen(); } };
  speaking = id;
  btn.innerHTML = `${ICON.stop}<span>${t().stop}</span>`;
  speechSynthesis.speak(u);
}

function share(id) {
  // wa.me opens the WhatsApp app on both phones; one tap to the contact list.
  open(`https://wa.me/?text=${encodeURIComponent(shareText(byId(id), S.lang))}`, '_blank', 'noopener');
}

document.addEventListener('click', e => {
  const b = e.target.closest('button');
  if (!b) return;
  const story = b.closest('.story');
  const id = story?.dataset.id;
  if (b.dataset.tab) {
    S.tab = b.dataset.tab; keep(KEY.tab, S.tab); speechSynthesis.cancel(); speaking = null; render(); scrollTo(0, 0);
  } else if (b.dataset.lang) {
    S.lang = b.dataset.lang; keep(KEY.lang, S.lang); speechSynthesis.cancel(); speaking = null; render();
  } else if (b.dataset.act === 'clear-day') clearDay(b.closest('.day').dataset.day);
  else if (b.dataset.act === 'dismiss') dismiss(id, story);
  else if (b.dataset.act === 'save') {
    toggleSave(id);
    const on = id in S.saved;
    b.innerHTML = `${on ? ICON.savedOn : ICON.saved}<span>${on ? t().saved : t().save}</span>`;
    b.setAttribute('aria-pressed', on);
    if (b.closest('dialog')) openSaved();
  } else if (b.dataset.act === 'listen') listen(id, b);
  else if (b.dataset.act === 'share') share(id);
  else if (b.dataset.act === 'saved') openSaved();
  else if (b.dataset.act === 'fetch') refresh();
  else if (b.dataset.act === 'settings') openSettings();
});

// Swipe left to dismiss. touch-action: pan-y keeps vertical scrolling native.
let drag = null;
document.addEventListener('pointerdown', e => {
  const s = e.target.closest('[data-list] .story');
  if (!s || e.target.closest('button') || e.pointerType === 'mouse') return;
  drag = { s, x: e.clientX, y: e.clientY, dx: 0 };
});
document.addEventListener('pointermove', e => {
  if (!drag) return;
  drag.dx = Math.min(0, e.clientX - drag.x);
  if (Math.abs(e.clientY - drag.y) > 24 && Math.abs(drag.dx) < 24) return (drag.s.style.transform = '', drag = null);
  drag.s.classList.add('dragging');
  drag.s.style.transform = `translateX(${drag.dx}px)`;
});
const endDrag = () => {
  if (!drag) return;
  const { s, dx } = drag;
  drag = null;
  s.classList.remove('dragging');
  s.style.transform = '';
  if (dx < -Math.min(140, s.offsetWidth * 0.35)) dismiss(s.dataset.id, s);
};
document.addEventListener('pointerup', endDrag);
document.addEventListener('pointercancel', endDrag);

// ── Sheets ───────────────────────────────────────────────────────
// Each open sheet owns one history entry, so Android back closes the sheet instead of leaving RKB.
// Close / Escape / backdrop pop that entry; a back gesture (popstate) closes the sheet. Tabs push nothing.
// Inside RKB (contract I5) the shell owns the one back stack: the sheet is rkbBack.push('news', closeFn), its own close calls
// done(id), and this frame never touches history (a frame entry newer than a shell entry makes Back step over the wrong one).
const popSheet = () => { const d = document.querySelector('dialog.sheet'); if (d) { d.popped = true; d.close(); } };
addEventListener('popstate', popSheet);
const rkbBack = () => { try { return window.parent !== window && window.parent.rkbBack; } catch { return null; } };
function sheet(title, body) {
  const old = document.querySelector('dialog.sheet'), r = rkbBack();
  let backId;
  if (old) { backId = old.backId; old.remove(); } // the new sheet reuses its history entry (or shell item)
  else if (r) backId = r.push('news', popSheet);
  else history.pushState({ sheet: 1 }, '');
  const d = document.createElement('dialog');
  d.className = 'sheet';
  d.innerHTML = `<div class="grab"></div><header><h2>${esc(title)}</h2><button class="link" data-close>${t().close}</button></header><div class="body">${body}</div>`;
  d.addEventListener('click', e => { if (e.target === d || e.target.closest('[data-close]')) d.close(); });
  d.backId = backId;
  d.addEventListener('close', () => { d.remove(); render(); if (d.popped) return; if (r) r.done(d.backId); else if (history.state?.sheet) history.back(); });
  document.body.append(d);
  d.showModal();
  return d;
}

function openSaved() {
  const items = Object.values(S.saved).sort((a, b) => (a.time < b.time ? 1 : -1));
  const body = items.length ? `<div class="list">${items.map(i => storyHTML(i, { inSaved: true })).join('')}</div>` : `<p class="empty">${t().noSaved}</p>`;
  const open = document.querySelector('dialog.sheet[data-kind=saved]');
  if (open) return (open.querySelector('.body').innerHTML = body);
  sheet(t().saved, body).dataset.kind = 'saved';
}

// Inside RKB the shell owns language, text size and appearance; the gear's panel gets the rest.
if (window.RKB) window.RKB.mountSettings = slot => {
  const n = Object.keys(S.dismissed).filter(id => S.news.items.some(i => i.id === id)).length;
  slot.innerHTML = `<section><h2 id="rkb-watch-h">${t().watch}</h2><label class="field"><textarea data-watch aria-labelledby="rkb-watch-h" rows="5" placeholder="Tata Steel&#10;Jaiprakash Associates">${esc(S.watch.join('\n'))}</textarea><small>${t().watchHelp}</small></label></section>
    ${n ? `<button class="link" data-restore>${t().restore(n)}</button>` : ''}<p class="version">RKB News ${APP_VERSION}</p>`;
  slot.querySelector('[data-watch]').addEventListener('change', e => { S.watch = parseWatch(e.target.value); keep(KEY.watch, S.watch); toast(t().watchSaved); });
  slot.querySelector('[data-restore]')?.addEventListener('click', e => { S.dismissed = {}; keep(KEY.dismissed, S.dismissed); e.target.remove(); toast(t().restored); render(); });
};

function openSettings() {
  const size = document.documentElement.dataset.size, theme = load(KEY.theme, 'system');
  const n = Object.keys(S.dismissed).filter(id => S.news.items.some(i => i.id === id)).length;
  const d = sheet(t().settings, `
    <div class="field"><span>${t().size}</span><div class="seg" data-pick="size">${['normal', 'large', 'larger'].map((v, i) => `<button data-v="${v}" aria-pressed="${v === size}">${t().sizes[i]}</button>`).join('')}</div></div>
    <div class="field"><span>${t().theme}</span><div class="seg" data-pick="theme">${['system', 'light', 'dark'].map((v, i) => `<button data-v="${v}" aria-pressed="${v === theme}">${t().themes[i]}</button>`).join('')}</div></div>
    <label class="field"><span>${t().watch}</span><textarea data-watch rows="5" placeholder="Tata Steel&#10;Jaiprakash Associates">${esc(S.watch.join('\n'))}</textarea><small>${t().watchHelp}</small></label>
    ${n ? `<button class="link" data-restore>${t().restore(n)}</button>` : ''}
    <p class="version">RKB News ${APP_VERSION}</p>`);
  d.addEventListener('click', e => {
    const b = e.target.closest('[data-pick] button');
    if (b) {
      const kind = b.parentElement.dataset.pick;
      b.parentElement.querySelectorAll('button').forEach(x => x.setAttribute('aria-pressed', x === b));
      if (kind === 'size') { document.documentElement.dataset.size = b.dataset.v; keep(KEY.size, b.dataset.v); }
      else { document.documentElement.dataset.theme = b.dataset.v; keep(KEY.theme, b.dataset.v); }
    }
    if (e.target.closest('[data-restore]')) {
      S.dismissed = {}; keep(KEY.dismissed, S.dismissed); e.target.closest('[data-restore]').remove(); toast(t().restored);
    }
  });
  d.querySelector('[data-watch]').addEventListener('change', e => {
    S.watch = parseWatch(e.target.value); keep(KEY.watch, S.watch); toast(t().watchSaved);
  });
}

// ── Data: paint the phone's copy first, then ask the network ─────
async function fetchNews() {
  const r = await fetch(`data/news.json?t=${Date.now()}`, { cache: 'no-store' });
  if (!r.ok) throw new Error(r.status);
  const doc = await r.json();
  if (!Array.isArray(doc?.items)) throw new Error('bad news.json');
  S.news = { updated: doc.updated, items: doc.items };
  keep(KEY.news, S.news);
}

let refreshing = null;
async function refresh() {
  if (refreshing) return refreshing;
  const had = hasCopy(), was = JSON.stringify(S.news);
  refreshing = (async () => {
    try {
      navigator.serviceWorker?.getRegistration().then(r => r?.update()).catch(() => {});
      await fetchNews();
      S.failed = false;
    } catch {
      S.failed = true; // stays on screen (banner or card) until a refresh works; errors never auto-dismiss
    } finally {
      refreshing = null;
      // Re-render only on new news: a full render drops a story mid-swipe. With a phone copy the list and its
      // empty card do not depend on failed/refreshing (emptyKind), so the banner carries that state.
      // Compare the items, not `updated`: a run that fetches nothing keeps the old time but still prunes/translates.
      if (!had || JSON.stringify(S.news) !== was) render(); else banner();
    }
  })();
  if (had) banner(); else render(); // no copy yet: the card shows "Getting the news…"
  return refreshing;
}

// Pull down to refresh (Pulse js/app.js): home-screen apps have no browser refresh.
const ptr = Object.assign(document.createElement('div'), { id: 'ptr', innerHTML: ICON.refresh });
document.body.append(ptr);
let pullStart = null;
addEventListener('touchstart', e => { pullStart = scrollY <= 0 && !document.querySelector('dialog[open]') ? e.touches[0].clientY : null; }, { passive: true });
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
  ptr.style.opacity = 1;
  ptr.classList.add('spin');
  await refresh();
  ptr.classList.remove('spin');
  ptr.style.transform = '';
  ptr.style.opacity = '';
});

const net = $('#net');
const showNet = () => { net.hidden = navigator.onLine; net.textContent = t().offline; };
addEventListener('online', () => { showNet(); refresh(); });
addEventListener('offline', showNet);
// Coming back to the app after hours: fetch the new batch without a pull.
document.addEventListener('visibilitychange', () => { if (!document.hidden && isStale(S.news.updated, Date.now() + 3 * 36e5)) refresh(); });

if ('serviceWorker' in navigator) {
  // A new version takes over at once (sw.js skipWaiting); reload so the page runs it. Not on the first visit.
  const hadController = !!navigator.serviceWorker.controller;
  let reloaded = false;
  navigator.serviceWorker.addEventListener('controllerchange', () => { if (hadController && !reloaded) { reloaded = true; location.reload(); } });
  if (!window.RKB) navigator.serviceWorker.register('sw.js'); // inside RKB the shell's worker serves every app
}

render();
showNet();
refresh();
window.__ready = true;
if (window.RKB) window.RKB.signOut = async () => true; // News has no login
