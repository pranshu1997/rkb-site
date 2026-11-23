// RKB window: one top bar (Health | Tasks | News + gear), one frame per section, one service worker.
// Switching sections shows another frame: nothing reloads, each section keeps its place. Sections load the first time they are opened.
// Food (Pulse feat/food) is a Health tab, so it needs no entry here.
(() => {
  // One origin: the old GitHub Pages address hands over to rkb.pranshu.app, where Inbox can be framed (same-site cookie) and the login lives.
  if (location.hostname === 'pranshu1997.github.io') { location.replace('https://rkb.pranshu.app/' + location.pathname.replace(/^\/rkb-app\/?/, '') + location.search + location.hash); return; }
  const BASE = new URL('./', document.currentScript.src).pathname; // "/rkb/"
  // Inbox (triage.pranshu.app) allows framing only from rkb.pranshu.app (same-site, so its Lax cookie is sent). There it is a section.
  // Everywhere else (GitHub Pages, local) it stays a link that opens a new tab.
  const INBOX = 'https://triage.pranshu.app/';
  const INBOX_SECTION = location.hostname === 'rkb.pranshu.app';
  const APPS = ['health', 'tasks', 'news', ...(INBOX_SECTION ? ['inbox'] : [])];
  // Lists lives inside Tasks (hash #lists, #l/<uuid>): the old #lists entry opens Tasks there.
  let NAV; // set below, once localStorage helpers exist: sections this account cannot use are left out
  const de = document.documentElement;
  // Only this site may frame RKB (GitHub Pages cannot send frame-ancestors, and a meta tag is ignored).
  try { if (top !== self) void parent.document; } catch { de.hidden = true; return; }
  const ls = {
    get: k => { try { return localStorage.getItem(k); } catch { return null; } },
    set: (k, v) => { try { localStorage.setItem(k, v); } catch {} },
  };
  const json = (k, d) => { try { return JSON.parse(ls.get(k)) ?? d; } catch { return d; } };
  // Sections this account cannot use (a Tasks-only staff account has no Health; Inbox opens for Papa's id only). Written by the RKB sign-in below.
  const can = a => !(json('rkb.noaccess', []).includes(a));
  NAV = APPS.filter(can);
  const lang = () => (json('rkb.lang', null) ?? ls.get('lang')) === 'hi' ? 'hi' : 'en';
  const T = {
    en: { health: 'Health', tasks: 'Tasks', news: 'News', inbox: 'Inbox', settings: 'Settings', lists: 'Lists', places: 'Places', whatsapp: 'WhatsApp', sms: 'Messages', calls: 'Calls', mail: 'Mail', calendar: 'Calendar', home: 'Home', morning: 'Good morning', afternoon: 'Good afternoon', evening: 'Good evening', g_touch: 'Stay in touch', g_day: 'My day', g_read: 'Read',
      signin: 'Log in', signinSub: 'Log in once to open all your apps', email: 'Email', password: 'Password', show: 'Show', hide: 'Hide', wait: 'Please wait\u2026', close: 'Close',
      need: 'Type your email and password.', wrong: 'The email or password is not right. Check it and try again.', offline: 'Cannot reach the server. Check the internet and try again.', otherLang: '\u0939\u093f\u0928\u094d\u0926\u0940',
      noteNet: a => `${a} could not log in. Open ${a} to try again.`, noteBad: a => `${a} has a different password. Open ${a} to log in there.` },
    hi: { health: 'स्वास्थ्य', tasks: 'काम', news: 'खबरें', inbox: 'इनबॉक्स', settings: 'सेटिंग', lists: 'सूचियाँ', places: 'जगहें', whatsapp: 'व्हाट्सऐप', sms: 'संदेश', calls: 'कॉल', mail: 'मेल', calendar: 'कैलेंडर', home: 'होम', morning: 'सुप्रभात', afternoon: 'नमस्कार', evening: 'शुभ संध्या', g_touch: 'संपर्क में रहें', g_day: 'मेरा दिन', g_read: 'पढ़ें',
      signin: 'लॉग इन', signinSub: 'एक बार लॉग इन करें, सारे ऐप खुल जाएँगे', email: 'ईमेल', password: 'पासवर्ड', show: 'दिखाएँ', hide: 'छिपाएँ', wait: 'कृपया रुकें…', close: 'बंद करें',
      need: 'ईमेल और पासवर्ड लिखें।', wrong: 'ईमेल या पासवर्ड सही नहीं है। जाँचकर फिर कोशिश करें।', offline: 'सर्वर से जुड़ नहीं पा रहे। इंटरनेट जाँचें और फिर कोशिश करें।', otherLang: 'English',
      noteNet: a => `${a} में लॉग इन नहीं हो पाया। फिर कोशिश करने के लिए ${a} खोलें।`, noteBad: a => `${a} का पासवर्ड अलग है। वहाँ लॉग इन करने के लिए ${a} खोलें।` },
  };
  const L = () => T[lang()];
  const inboxLink = () => INBOX_SECTION ? '' : `<a href="${INBOX}" target="_blank" rel="noopener">${ICON.inbox}<span>${L().inbox}</span></a>`;
  const frames = {};
  // Desktop layout (contract: ~/.claude/handoffs/ui-overhaul-20261116/rkb6-desktop-contract.md): window >= 1024px shows a left sidebar.
  const mq = matchMedia('(min-width: 1024px)');
  const layout = () => (mq.matches ? 'desktop' : 'phone');
  const setLayout = f => { try { const d = f.contentDocument.documentElement; d.dataset.layout = layout(); d.style.setProperty('--rkb-content-max', '1040px'); } catch {} };
  // Variant B, "icon home" (phones only): RKB opens on a screen of big app icons instead of the top section bar.
  // Phones open it by default; ?home=tabs (remembered in rkb.home, also Settings > Home screen) restores the top bar. Desktop keeps the sidebar whatever is chosen.
  const qh = new URLSearchParams(location.search).get('home');
  if (qh) ls.set('rkb.home', qh === 'icons' ? 'icons' : 'tabs');
  const homeOn = () => !mq.matches && ls.get('rkb.home') !== 'tabs';
  const syncHome = () => { if (homeOn()) de.dataset.home = 'icons'; else { delete de.dataset.home; if (cur === 'home') show(ls.get('rkbshell.last')); } };
  const syncLayout = () => { de.dataset.layout = layout(); syncHome(); for (const k in frames) setLayout(frames[k]); };
  mq.addEventListener('change', syncLayout);
  de.dataset.layout = layout();
  const applyTheme = () => {
    de.dataset.theme = json('rkb.theme', null) ?? ls.get('theme') ?? 'system';
    de.dataset.size = json('rkb.size', 'normal'); // the bar, sidebar and viewer bar grow with text size too
    const dark = de.dataset.theme === 'dark' || (de.dataset.theme === 'system' && matchMedia('(prefers-color-scheme: dark)').matches);
    document.querySelector('meta[name=theme-color]')?.setAttribute('content', dark ? '#000000' : '#f2f2f7');
  };
  applyTheme();
  // A change made in one section reaches every loaded section now, not at their next load.
  // Inbox is cross-origin, so it gets the same choices as a message (contract I3); it may never answer, and nothing waits for it.
  const INBOX_ORIGIN = new URL(INBOX).origin;
  // Inbox may not listen yet when its frame loads, so any message it sends also gets the prefs, until it answers inbox-prefs-ok.
  let prefsOk = false;
  const sendPrefs = () => { try { frames.inbox?.contentWindow?.postMessage({ type: 'rkb-prefs', size: json('rkb.size', 'normal'), theme: de.dataset.theme, lang: lang() }, INBOX_ORIGIN); } catch {} };
  const applyAll = () => {
    applyTheme(); sendPrefs();
    for (const k in frames) try { const d = frames[k].contentDocument.documentElement; d.dataset.theme = de.dataset.theme; d.dataset.size = json('rkb.size', 'normal'); } catch {}
    for (const k in frames) setLayout(frames[k]);
  };
  matchMedia('(prefers-color-scheme: dark)').addEventListener('change', applyTheme);
  const GEAR = '<svg viewBox="0 0 24 24" width="26" height="26" aria-hidden="true" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round"><circle cx="12" cy="12" r="3"/><path d="M19.4 15a1.7 1.7 0 0 0 .3 1.8l.1.1a2 2 0 1 1-2.8 2.8l-.1-.1a1.7 1.7 0 0 0-1.8-.3 1.7 1.7 0 0 0-1 1.5V21a2 2 0 1 1-4 0v-.1a1.7 1.7 0 0 0-1.1-1.5 1.7 1.7 0 0 0-1.8.3l-.1.1a2 2 0 1 1-2.8-2.8l.1-.1a1.7 1.7 0 0 0 .3-1.8 1.7 1.7 0 0 0-1.5-1H3a2 2 0 1 1 0-4h.1a1.7 1.7 0 0 0 1.5-1.1 1.7 1.7 0 0 0-.3-1.8l-.1-.1a2 2 0 1 1 2.8-2.8l.1.1a1.7 1.7 0 0 0 1.8.3H9a1.7 1.7 0 0 0 1-1.5V3a2 2 0 1 1 4 0v.1a1.7 1.7 0 0 0 1 1.5 1.7 1.7 0 0 0 1.8-.3l.1-.1a2 2 0 1 1 2.8 2.8l-.1.1a1.7 1.7 0 0 0-.3 1.8V9a1.7 1.7 0 0 0 1.5 1H21a2 2 0 1 1 0 4h-.1a1.7 1.7 0 0 0-1.5 1z"/></svg>';

  // Section icons (SF-Symbols style, 1.8 stroke): the bar shows icon over label, like the iOS tab bar.
  const ICON = {
    health: '<svg viewBox="0 0 24 24" width="24" height="24" aria-hidden="true" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round"><path d="M12 20.5s-7.5-4.6-7.5-10.2A4.3 4.3 0 0 1 12 7.6a4.3 4.3 0 0 1 7.5 2.7c0 5.6-7.5 10.2-7.5 10.2z"/></svg>',
    tasks: '<svg viewBox="0 0 24 24" width="24" height="24" aria-hidden="true" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round"><circle cx="12" cy="12" r="9"/><path d="m8 12.4 2.8 2.8L16.2 9.6"/></svg>',
    news: '<svg viewBox="0 0 24 24" width="24" height="24" aria-hidden="true" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round"><rect x="4" y="4" width="16" height="16" rx="3"/><path d="M8 9h8M8 12.5h8M8 16h5"/></svg>',
    inbox: '<svg viewBox="0 0 24 24" width="24" height="24" aria-hidden="true" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round"><path d="M3.5 13.5 6 5.5h12l2.5 8v5a1.5 1.5 0 0 1-1.5 1.5H5a1.5 1.5 0 0 1-1.5-1.5z"/><path d="M3.5 13.5H9a3 3 0 0 0 6 0h5.5"/></svg>',
  };

  const svg = (d, w = 24) => `<svg viewBox="0 0 24 24" width="${w}" height="${w}" aria-hidden="true" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round">${d}</svg>`;
  Object.assign(ICON, {
    whatsapp: svg('<path d="M4 20l1.3-4.2A8 8 0 1 1 8.3 18.8z"/><path d="M9.2 8.6c.3 2.6 2.4 4.9 5.3 5.7l1.2-1.3-2-1-.8.8c-.9-.4-1.7-1.2-2.1-2.1l.8-.8-1-2z"/>'),
    sms: svg('<path d="M4 5.5h16a1.5 1.5 0 0 1 1.5 1.5v8.5A1.5 1.5 0 0 1 20 17h-8l-4.5 3.5V17H4a1.5 1.5 0 0 1-1.5-1.5V7A1.5 1.5 0 0 1 4 5.5z"/><path d="M8 11.2h.01M12 11.2h.01M16 11.2h.01"/>'),
    calls: svg('<path d="M6.6 3.5h3l1.4 4-2 1.3a11 11 0 0 0 5.6 5.6l1.3-2 4 1.4v3a2 2 0 0 1-2.2 2A16.5 16.5 0 0 1 4.6 5.7a2 2 0 0 1 2-2.2z"/>'),
    mail: svg('<rect x="3" y="5.5" width="18" height="13" rx="2.5"/><path d="m4 7.5 8 6 8-6"/>'),
    calendar: svg('<rect x="3.5" y="5" width="17" height="15.5" rx="3"/><path d="M3.5 10h17M8 3v4M16 3v4"/>'),
    settings: GEAR,
  });
  // Sections get the bottom safe-area from here: some phones report 0 inside a frame.
  const sab = getComputedStyle(document.getElementById('rkb-probe')).paddingBottom || '0px';
  const bar = document.getElementById('rkb-bar'), box = document.getElementById('rkb-frames');
  const RKB = (window.RKB = { host: true, base: BASE, sab, applyTheme: applyAll });

  
  bar.innerHTML = `<button type="button" class="rkb-homebtn" aria-label="${L().home}">${svg('<path d="m14.5 5-7 7 7 7"/>')}<span>${L().home}</span></button><span class="rkb-title"></span>
    <nav aria-label="RKB">${NAV.map(a => `<a href="#${a}" data-rkb-app="${a}">${ICON[a] ?? ''}<span>${L()[a]}</span></a>`).join('')}${inboxLink()}</nav>
    <button type="button" class="rkb-gear" aria-label="${L().settings}">${GEAR}</button>`;
  // Desktop sidebar: same sections as the top bar, Lists and Places under Tasks. CSS shows it only at >= 1024px.
  const side = document.getElementById('rkb-side');
  // Same groups as the icon home. Desktop reaches WhatsApp, Mail and the rest inside Inbox, so Inbox is that group's one entry.
  const SGROUPS = [['g_touch', [['inbox']]], ['g_day', [['health'], ['tasks'], ['lists', 'tasks', '#lists'], ['places', 'tasks', '#places']]], ['g_read', [['news']]]];
  const sideLink = ([k, , h]) => `<a href="#${k}" data-rkb-app="${k}"${h ? ' class="sub"' : ''}>${h ? '' : ICON[k] ?? ''}<span>${L()[k]}</span></a>`;
  side.innerHTML = `<div class="rkb-brand">RKB</div><nav aria-label="RKB">${SGROUPS.map(([g, items]) => {
    const vis = items.filter(([k, a]) => APPS.includes(a ?? k) && can(a ?? k));
    return vis.length ? `<h2 class="rkb-gh">${L()[g]}</h2>${vis.map(sideLink).join('')}` : g === 'g_touch' ? `<h2 class="rkb-gh">${L()[g]}</h2>${inboxLink()}` : '';
  }).join('')}</nav>
    <button type="button" class="rkb-gear rkb-side-set" aria-label="${L().settings}">${GEAR}<span>${L().settings}</span></button>`;
  let cur;

  function frameFor(a, hidden, hash = '') {
    if (frames[a]) return frames[a];
    const f = frames[a] = Object.assign(document.createElement('iframe'), { className: 'rkb-frame', title: L()[a], src: a === 'inbox' ? INBOX + hash : `${BASE}${a}/${hash}`, hidden });
    if (a === 'inbox') f.setAttribute('allow', 'clipboard-write'); // Copy code: Chromium blocks the clipboard in a cross-origin frame without it
    f.addEventListener('load', () => (a === 'inbox' ? (prefsOk = false, sendPrefs()) : setLayout(f)));
    box.append(f);
    if (a !== 'inbox') navigator.serviceWorker?.ready.then(r => r.active?.postMessage({ app: a }));
    return f;
  }
  function show(a, hash = '') {
    let sub = null;
    if (a === 'lists' || a === 'places') { sub = a; a = 'tasks'; hash = hash || '#' + sub; }
    if (!APPS.includes(a) || !can(a)) a = NAV[0] ?? 'tasks';
    if (cur && cur !== a) try { frames[cur].contentWindow.RKB?.closeSettings?.(); } catch {}
    const had = !!frames[a];
    frameFor(a, false, hash);
    // replace, not a new frame entry (a frame entry newer than ours makes Back's history.go step over the wrong one). The URL is
    // absolute: a relative one would resolve against this window.
    if (had && hash && a === 'inbox') try { frames.inbox.contentWindow.location.replace(INBOX + hash); } catch {} // cross-origin: replace is allowed, and fires hashchange inside Inbox
    else if (had && hash) try { const l = frames[a].contentWindow.location; l.replace(l.pathname + l.search + hash); } catch {}
    for (const k in frames) frames[k].hidden = k !== a;
    for (const l of document.querySelectorAll('[data-rkb-app]')) (l.dataset.rkbApp === (sub || a)) ? l.setAttribute('aria-current', 'page') : l.removeAttribute('aria-current');
    ls.set('rkbshell.last', a); titleEl.textContent = L()[sub || a];
    de.dataset.app = a; cur = a;
    showViewer();
  }
  RKB.show = show;

  // ---- Variant B: icon home (phones). Opening a tile = show() + one rkbBack item, so Android Back returns to Home; the Home
  // button pops everything opened since Home. Inbox tiles deep-link by hash into the cross-origin Inbox frame (see show()).
  const homeEl = Object.assign(document.createElement('main'), { id: 'rkb-home' }), titleEl = bar.querySelector('.rkb-title');
  document.body.append(homeEl);
  const IB = '#/inbox/l/all/';
  const TILES = [
    ...(INBOX_SECTION ? [['whatsapp', 'inbox', IB + 'whatsapp'], ['sms', 'inbox', IB + 'sms'], ['calls', 'inbox', IB + 'calls'], ['mail', 'inbox', '#/inbox/mail'], ['calendar', 'inbox', '#/calendar']] : []),
    ['health'], ['tasks'], ['news'], ...(INBOX_SECTION ? [] : [['inbox']]), ['settings'],
  ];
  // Real brand marks (Simple Icons, CC0; handset = Material "call"), 24x24. White on a solid brand tile (>= 3:1); Messages is a circle mark, so it is the tile.
  const BRAND = {
    whatsapp: 'M17.472 14.382c-.297-.149-1.758-.867-2.03-.967-.273-.099-.471-.148-.67.15-.197.297-.767.966-.94 1.164-.173.199-.347.223-.644.075-.297-.15-1.255-.463-2.39-1.475-.883-.788-1.48-1.761-1.653-2.059-.173-.297-.018-.458.13-.606.134-.133.298-.347.446-.52.149-.174.198-.298.298-.497.099-.198.05-.371-.025-.52-.075-.149-.669-1.612-.916-2.207-.242-.579-.487-.5-.669-.51-.173-.008-.371-.01-.57-.01-.198 0-.52.074-.792.372-.272.297-1.04 1.016-1.04 2.479 0 1.462 1.065 2.875 1.213 3.074.149.198 2.096 3.2 5.077 4.487.709.306 1.262.489 1.694.625.712.227 1.36.195 1.871.118.571-.085 1.758-.719 2.006-1.413.248-.694.248-1.289.173-1.413-.074-.124-.272-.198-.57-.347m-5.421 7.403h-.004a9.87 9.87 0 01-5.031-1.378l-.361-.214-3.741.982.998-3.648-.235-.374a9.86 9.86 0 01-1.51-5.26c.001-5.45 4.436-9.884 9.888-9.884 2.64 0 5.122 1.03 6.988 2.898a9.825 9.825 0 012.893 6.994c-.003 5.45-4.437 9.884-9.885 9.884m8.413-18.297A11.815 11.815 0 0012.05 0C5.495 0 .16 5.335.157 11.892c0 2.096.547 4.142 1.588 5.945L.057 24l6.305-1.654a11.882 11.882 0 005.683 1.448h.005c6.554 0 11.89-5.335 11.893-11.893a11.821 11.821 0 00-3.48-8.413Z',
    mail: 'M24 5.457v13.909c0 .904-.732 1.636-1.636 1.636h-3.819V11.73L12 16.64l-6.545-4.91v9.273H1.636A1.636 1.636 0 0 1 0 19.366V5.457c0-2.023 2.309-3.178 3.927-1.964L5.455 4.64 12 9.548l6.545-4.91 1.528-1.145C21.69 2.28 24 3.434 24 5.457z',
    sms: 'M12 0A12 12 0 0 0 0 12a12 12 0 0 0 12 12 12 12 0 0 0 12-12A12 12 0 0 0 12 0zM4.911 7.089h11.456a2.197 2.197 0 0 1 2.165 2.19v5.863a2.213 2.213 0 0 1-2.177 2.178H8.04c-1.174 0-2.04-.99-2.04-2.178v-4.639L4.503 7.905c-.31-.42-.05-.816.408-.816zm3.415 2.19c-.347 0-.68.21-.68.544 0 .334.333.544.68.544h7.905c.346 0 .68-.21.68-.544 0-.334-.334-.545-.68-.545zm0 2.177c-.347 0-.68.21-.68.544 0 .334.333.544.68.544h7.905c.346 0 .68-.21.68-.544 0-.334-.334-.544-.68-.544zm-.013 2.19c-.346 0-.68.21-.68.544 0 .334.334.544.68.544h5.728c.347 0 .68-.21.68-.544 0-.334-.333-.545-.68-.545z',
    calls: 'M6.62 10.79c1.44 2.83 3.76 5.14 6.59 6.59l2.2-2.2c.27-.27.67-.36 1.02-.24 1.12.37 2.33.57 3.57.57.55 0 1 .45 1 1V20c0 .55-.45 1-1 1-9.39 0-17-7.61-17-17 0-.55.45-1 1-1h3.5c.55 0 1 .45 1 1 0 1.25.2 2.45.57 3.57.11.35.03.74-.25 1.02l-2.2 2.2z',
  };
  const tileIcon = k => BRAND[k] ? `<i class="rkb-ico" data-brand="${k}"><svg viewBox="0 0 24 24" aria-hidden="true"><path d="${BRAND[k]}"/></svg></i>` : `<i class="rkb-ico">${ICON[k]}</i>`;
  const TONE = { whatsapp: 'ok', sms: 'blue', calls: 'ok', mail: 'blue', calendar: 'bad', health: 'bad', tasks: 'blue', news: 'blue', inbox: 'blue', settings: 'muted' };
  // Three groups by what the tile is for, then Settings as a small row. A tile this account cannot use is left out; an empty group disappears.
  const GROUPS = [['g_touch', ['whatsapp', 'sms', 'calls', 'mail', 'inbox']], ['g_day', ['health', 'tasks', 'calendar']], ['g_read', ['news']]];
  const tileOk = k => { const t = TILES.find(x => x[0] === k); return t && can(t[1] ?? k); };
  const tileHtml = k => (k === 'inbox' && !INBOX_SECTION
    ? `<a class="rkb-tile" href="${INBOX}" target="_blank" rel="noopener"`
    : `<button type="button" class="rkb-tile" data-tile="${k}"`) + ` style="--tone: var(--${TONE[k]})">${tileIcon(k)}<span>${L()[k]}</span></${k === 'inbox' && !INBOX_SECTION ? 'a' : 'button'}>`;
  homeEl.innerHTML = `<h1 class="rkb-hello"></h1>${GROUPS.map(([g, ks]) => ks.filter(tileOk).length
    ? `<section class="rkb-group" aria-labelledby="rkb-${g}"><h2 id="rkb-${g}">${L()[g]}</h2><div class="rkb-tiles">${ks.filter(tileOk).map(tileHtml).join('')}</div></section>` : '').join('')}
    <button type="button" class="rkb-setrow" data-tile="settings">${ICON.settings}<span>${L().settings}</span></button>`;
  function showHome() {
    if (cur && cur !== 'home') try { frames[cur].contentWindow.RKB?.closeSettings?.(); } catch {}
    for (const k in frames) frames[k].hidden = true;
    const h = new Date().getHours();
    homeEl.querySelector('.rkb-hello').textContent = L()[h < 12 ? 'morning' : h < 17 ? 'afternoon' : 'evening'];
    homeEl.scrollTop = 0; de.dataset.app = cur = 'home'; showViewer();
  }
  RKB.showHome = showHome;
  function openTile(k) {
    const t = TILES.find(x => x[0] === k), app = t[1] ?? (k === 'settings' ? NAV[0] : k);
    show(app, t[2] ?? ''); titleEl.textContent = L()[k]; // Inbox tiles show their own name: Inbox itself has no title for "WhatsApp"
    rkbBack.push('home', showHome);
    if (k === 'settings') (async () => { for (let i = 0; i < 100; i++) { try { frames[app].contentWindow.RKB.openSettings(); return; } catch {} await new Promise(r => setTimeout(r, 150)); } })();
  }
  function goHome() {
    const i = stack.findLastIndex(x => x.app === 'home');
    for (const it of stack.slice(i + 1)) { if (stack.includes(it)) try { it.close(); } catch {} } // sheets opened since Home close themselves
    if (i >= 0) stack.length = i; // then the Home entry and anything above go; sync() steps history back over them
    clearTimeout(timer); timer = setTimeout(sync);
    showHome();
  }
  homeEl.addEventListener('click', e => { const t = e.target.closest('[data-tile]'); if (t) openTile(t.dataset.tile); });

  // One back stack for every section (contract I5). A same-origin section opens a sheet with rkbBack.push(app, close) and,
  // when its own button closes it, calls rkbBack.done(id). Only this window touches history: entry n ({rkbBack: n}) stands
  // for stack[n - 1], so Back closes exactly the top item, wherever it lives. Back is state-based; while our own
  // history.go() is in flight nothing pushes or pops, and its landing re-syncs.
  const stack = [];
  let seq = 0, going = false, timer = 0, settled = null;
  const depth = () => history.state?.rkbBack ?? 0;
  if (depth()) history.replaceState(null, ''); // reload: nothing is open, so the entry may not claim an item
  const sync = () => {
    timer = 0;
    if (going) return;
    const d = depth();
    if (d > stack.length) return (going = true), history.go(stack.length - d);
    for (let n = d + 1; n <= stack.length; n++) history.pushState({ rkbBack: n }, '');
    const f = settled; settled = null; f?.();
  };
  window.rkbBack = {
    push(app, close) { const id = ++seq, doc = watchDoc(app); stack.push({ id, app, close, doc }); sync(); return id; },
    // Deferred, so a close handler that opens the next sheet reuses this entry. Unknown ids (already closed by Back) are ignored.
    done(id) { const i = stack.findIndex(x => x.id === id); if (i < 0) return; stack.splice(i, 1); timer ||= setTimeout(sync); },
  };
  // A section document that goes away (reload, language change, update) takes its items with it: drop them without calling
  // their close fns (their page is gone) and step history back over their entries. Deferred like done(), so if the whole
  // window is leaving nothing runs. A persisted pagehide (back-forward cache) is not a going-away.
  const watched = new WeakSet();
  function watchDoc(app) {
    let doc = null;
    try { doc = frames[app]?.contentDocument ?? null; } catch {}
    if (doc && !watched.has(doc)) {
      watched.add(doc);
      doc.defaultView.addEventListener('pagehide', e => {
        if (e.persisted) return;
        for (let i = stack.length; i--;) if (stack[i].doc === doc) stack.splice(i, 1);
        timer ||= setTimeout(sync);
      });
    }
    return doc;
  }
  addEventListener('popstate', () => {
    if (going) return (going = false), sync();
    while (stack.length > depth()) {
      const it = stack.pop();
      if (it.app !== cur && APPS.includes(it.app)) show(it.app); // a sheet left open in a hidden section: show it, then close it
      try { it.close(); } catch {}
    }
    if (depth() > stack.length) sync(); // forward onto an entry no item owns: step back off it
  });
  // Reload (language change) only once every entry is popped, so back finds no stale step. Open sheets go with the reload.
  RKB.reload = () => { stack.length = 0; settled = () => location.reload(); clearTimeout(timer); sync(); };
  const onNav = e => {
    const l = e.target.closest('a[data-rkb-app]');
    if (l) {
      e.preventDefault();
      if (l.classList.contains('sub')) show(l.dataset.rkbApp);
      else if (l.dataset.rkbApp === cur) frames[cur]?.contentWindow.dispatchEvent(new Event('rkb:tab')); // same entry again: that section goes home
      else show(l.dataset.rkbApp);
    } else if (e.target.closest('.rkb-homebtn')) goHome();
    else if (e.target.closest('.rkb-gear')) {
      try { frames[cur].contentWindow.RKB.openSettings(); } catch {}
    }
  };
  bar.addEventListener('click', onNav); side.addEventListener('click', onNav);
  // Keyboard: Alt+1 Health, Alt+2 Tasks, Alt+3 News (Alt+Option on Mac gives symbols, so match the physical key).
  addEventListener('keydown', e => {
    const a = e.altKey && !e.ctrlKey && !e.metaKey && NAV[+e.code.replace('Digit', '') - 1];
    if (a && /^Digit[1-3]$/.test(e.code)) { e.preventDefault(); show(a); }
  });

  // Log out of every section: each signs out inside its own frame, so its own cleanup (cache, queue, push) runs.
  RKB.logOutAll = async () => {
    // The section on screen signs out last: it re-renders to its login form, and requests still in flight must not refill its cache first.
    for (const a of ['health', 'tasks'].filter(can).sort((x, y) => (x === cur) - (y === cur))) {
      const f = frameFor(a, a !== cur), t0 = Date.now();
      let r; while (!(r = f.contentWindow?.RKB)?.signOut) { if (Date.now() - t0 > 15000) return false; await new Promise(x => setTimeout(x, 150)); }
      if (!(await r.signOut().catch(() => false))) return false;
    }
    ls.set('rkb.noaccess', '[]');
    return true;
  };

  // Who is signed in? Health's profiles table says: role 'entry' is Papa, anyone else is a viewer (Pranshu, member).
  // Viewer bar only on Health. Papa's account starts on Large text (only while no size was ever chosen).
  const viewerEl = document.getElementById('rkb-viewer');
  let who = null;
  const showViewer = () => {
    const on = who?.viewer && cur === 'health';
    viewerEl.hidden = !on; de.classList.toggle('rkb-viewing', !!on);
    if (on) viewerEl.textContent = lang() === 'hi' ? `आप ${who.name} का दिन देख रहे हैं` : `You are viewing ${who.name}\u2019s day`;
  };
  async function whoAmI() {
    try {
      const P = await fetch(`${BASE}projects.json`).then(r => r.json()), h = P.health;
      const tok = JSON.parse(ls.get(`sb-${new URL(h.url).hostname.split('.')[0]}-auth-token`) || 'null');
      if (!tok?.access_token) return;
      const rows = await fetch(`${h.url}/rest/v1/profiles?select=id,role,display_name`, { headers: { apikey: h.key, authorization: `Bearer ${tok.access_token}` } }).then(r => r.json());
      const me = rows.find(p => p.id === tok.user?.id), owner = rows.find(p => p.role === 'entry');
      if (!me || !owner) return;
      who = { viewer: me.role !== 'entry', name: owner.display_name || 'Papa' };
      if (!who.viewer && ls.get('rkb.size') === null && !mq.matches) { ls.set('rkb.size', JSON.stringify('large')); applyAll(); }
      showViewer();
    } catch {}
  }
  whoAmI();
  addEventListener('storage', e => e.key?.endsWith('-auth-token') && whoAmI()); // signing in/out inside a frame
  RKB.whoAmI = whoAmI;

  // Inbox single sign-on: a signed-out Inbox frame asks for the RKB Tasks login; only triage.pranshu.app gets the answer,
  // and its server accepts only Papa's id (employees sign in to Tasks too, but cannot open Inbox).
  const tasksToken = async () => {
    const key = `sb-${new URL((await fetch(`${BASE}projects.json`).then(r => r.json())).tasks.url).hostname.split('.')[0]}-auth-token`;
    const read = () => { const t = json(key, null); return t?.access_token && t.expires_at * 1000 > Date.now() + 30000 ? t.access_token : null; };
    if (read() || !json(key, null)) return read();
    frameFor('tasks', true); // an old token: the Tasks frame refreshes it; wait for that
    return new Promise(res => {
      const done = () => { removeEventListener('storage', on); clearTimeout(t); res(read()); };
      const on = e => e.key === key && read() && done(), t = setTimeout(done, 8000);
      addEventListener('storage', on);
    });
  };
  addEventListener('message', async e => {
    if (e.origin !== new URL(INBOX).origin || e.source !== frames.inbox?.contentWindow) return;
    if (e.data?.type === 'inbox-prefs-ok') prefsOk = true; else if (!prefsOk) sendPrefs();
    if (e.data?.type !== 'inbox-need-rkb-token') return;
    let token = null;
    try { token = await tasksToken(); } catch {}
    e.source.postMessage({ type: 'rkb-token', token }, new URL(INBOX).origin);
  });

  // ---- One sign-in for RKB. Health and Tasks are two Supabase projects; the window signs the same email + password into both, once,
  // and stores each session where that section's supabase-js looks for it (the same key and shape the sections' own login writes).
  // Nothing loads before that: no frame is made, so Papa never meets a section's own login first. The password lives in memory for the calls only.
  const tokenKey = url => `sb-${new URL(url).hostname.split('.')[0]}-auth-token`;
  const hasSession = () => { try { return Object.keys(localStorage).some(k => /^sb-[\w-]+-auth-token$/.test(k) && json(k, null)?.access_token); } catch { return true; } };
  // 'ok' | 'bad' (project refused: wrong password, or no account there) | 'net' (could not reach it, or it is busy)
  async function signInBoth(email, password) {
    const P = await fetch(`${BASE}projects.json`).then(r => r.json());
    const apps = ['health', 'tasks'].filter(a => P[a]), uniq = apps.filter((a, i) => apps.findIndex(b => tokenKey(P[b].url) === tokenKey(P[a].url)) === i), res = {};
    await Promise.all(uniq.map(async a => {
      try {
        const r = await fetch(`${P[a].url}/auth/v1/token?grant_type=password`, { method: 'POST', headers: { apikey: P[a].key, 'content-type': 'application/json' }, body: JSON.stringify({ email, password }) });
        const t = r.ok && await r.json();
        if (t?.access_token && t.refresh_token) { ls.set(tokenKey(P[a].url), JSON.stringify(t)); res[a] = 'ok'; } else res[a] = r.status >= 500 || r.status === 429 ? 'net' : 'bad';
      } catch { res[a] = 'net'; }
    }));
    for (const a of apps) res[a] ??= res[uniq.find(b => tokenKey(P[b].url) === tokenKey(P[a].url))];
    return res;
  }
  function gate() {
    de.dataset.gate = ''; de.lang = lang();
    const l = L(), el = Object.assign(document.createElement('main'), { id: 'rkb-login' });
    el.innerHTML = `<form class="rkb-lcard" novalidate><h1>RKB</h1><p class="rkb-lsub">${l.signinSub}</p>
      <label for="rkb-em">${l.email}</label><input id="rkb-em" name="email" type="email" autocomplete="username" inputmode="email" autocapitalize="none" autocorrect="off" spellcheck="false" value="${(ls.get('rkb.email') ?? '').replace(/[^\w.@+-]/g, '')}">
      <label for="rkb-pw">${l.password}</label><div class="rkb-pw"><input id="rkb-pw" name="password" type="password" autocomplete="current-password"><button type="button" class="rkb-show" aria-controls="rkb-pw">${l.show}</button></div>
      <p class="rkb-lerr" role="alert"></p><button type="submit" class="rkb-lgo">${l.signin}</button><button type="button" class="rkb-llang">${l.otherLang}</button></form>`;
    document.body.append(el);
    const f = el.querySelector('form'), em = f.email, pw = f.password, err = el.querySelector('.rkb-lerr'), go = el.querySelector('.rkb-lgo');
    if (!matchMedia('(pointer: coarse)').matches) (em.value ? pw : em).focus();
    el.querySelector('.rkb-show').addEventListener('click', e => { const on = pw.type === 'password'; pw.type = on ? 'text' : 'password'; e.currentTarget.textContent = on ? l.hide : l.show; });
    el.querySelector('.rkb-llang').addEventListener('click', () => { const v = lang() === 'hi' ? 'en' : 'hi'; ls.set('lang', v); ls.set('rkb.lang', JSON.stringify(v)); location.reload(); });
    f.addEventListener('submit', async e => {
      e.preventDefault();
      const email = em.value.trim().toLowerCase(), password = pw.value;
      if (!email || !password) { err.textContent = l.need; return; }
      go.disabled = true; go.textContent = l.wait; err.textContent = '';
      let res = null;
      try { res = await signInBoth(email, password); } catch {}
      const apps = Object.keys(res ?? {}), ok = apps.filter(a => res[a] === 'ok'), bad = apps.filter(a => res[a] !== 'ok');
      if (!ok.length) { err.textContent = !res || bad.some(a => res[a] === 'net') ? l.offline : l.wrong; go.disabled = false; go.textContent = l.signin; pw.focus(); return; }
      // One project refused. Health refusing = a Tasks-only account (staff): Health and Inbox are not theirs, so they are left out.
      // Anything else (Tasks refusing, or a project that could not be reached) keeps the section; it shows its own login, and a note says why.
      let none = [], note = null;
      for (const a of bad) if (a === 'health' && res[a] === 'bad') none = ['health', 'inbox']; else note = { app: a, kind: res[a] };
      ls.set('rkb.noaccess', JSON.stringify(none)); ls.set('rkb.email', email);
      if (note) ls.set('rkb.note', JSON.stringify(note)); else localStorage.removeItem('rkb.note');
      pw.value = ''; location.reload(); // the window starts again with a session: icon home on phones, the last section on desktop
    });
  }
  // A section that could not sign in says so once, on the first screen after the sign-in, until it is closed.
  const note = json('rkb.note', null);
  if (note) {
    try { localStorage.removeItem('rkb.note'); } catch {}
    const n = Object.assign(document.createElement('div'), { id: 'rkb-note', role: 'status' });
    n.innerHTML = `<p>${L()[note.kind === 'bad' ? 'noteBad' : 'noteNet'](L()[note.app])}</p><button type="button">${L().close}</button>`;
    n.querySelector('button').addEventListener('click', () => n.remove());
    document.body.append(n);
  }
  const gated = !hasSession();
  if (gated) gate();

  const first = location.hash.slice(1).split('/')[0];
  if (gated) { /* the sign-in screen is up; it reloads the window once a session exists */ }
  else if (first === 'lists' || first === 'l') show('tasks', '#' + location.hash.slice(1)); // old Lists links land in Tasks > Lists
  else if (homeOn() && !APPS.includes(first)) showHome();
  else show(APPS.includes(first) ? first : ls.get('rkbshell.last'));
  if (!gated) syncHome();
  if ('serviceWorker' in navigator) {
    navigator.serviceWorker.register(`${BASE}sw.js`, { scope: BASE, updateViaCache: 'none' }).catch(() => {});
    // Health and Tasks (small) are fetched into the cache 1.5 s after load (files only, nothing is run), so the first switch is instant. News (1.9 MB feed) stays lazy. Safari has no requestIdleCallback.
    addEventListener('load', () => setTimeout(() => navigator.serviceWorker.ready.then(r => ['health', 'tasks'].filter(a => a !== cur).forEach(a => r.active?.postMessage({ app: a }))), 1500));
  }
})();
