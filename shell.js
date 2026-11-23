// RKB shell, section side. Every section (Health, Tasks, News) runs inside the one RKB window (host.js) as a frame.
// This file gives each section: preferences, theme, last tab, the Settings panel, one sign-in. The bar, the service worker and
// log out of all sections belong to host.js. Loaded as a plain script in <head> of every section page, so window.RKB exists
// before the section's module runs.
(() => {
  const BASE = new URL('./', document.currentScript.src).pathname; // "/rkb/" (or the same under a test server)
  const APPS = ['health', 'tasks', 'news'];
  const app = APPS.find(a => location.pathname.startsWith(`${BASE}${a}/`));
  const ls = {
    get: k => { try { return localStorage.getItem(k); } catch { return null; } },
    set: (k, v) => { try { localStorage.setItem(k, v); } catch {} },
  };
  const json = (k, d) => { try { return JSON.parse(ls.get(k)) ?? d; } catch { return d; } };
  const RKB = (window.RKB = { app, base: BASE });
  const tabKey = a => `rkbshell.tab.${a}`;
  if (!app) return;
  // Only the RKB window (same origin, host.js) may show a section. Opened alone, a section sends you to RKB;
  // framed by any other site it stays invisible (no clickjacking: the page cannot be seen or clicked).
  let host = null;
  try { host = parent !== self && parent.RKB?.host ? parent.RKB : null; } catch {}
  if (!host) {
    if (top === self) {
      if (location.hash) ls.set(tabKey(app), location.hash.slice(1));
      ls.set('rkbshell.last', app);
      location.replace(BASE);
    } else document.documentElement.hidden = true;
    return;
  }
  document.documentElement.style.setProperty('--rkb-sab', host.sab);
  // An app that sizes its text in rem opts in with <meta name="rkb-rem">; the others keep the old CSS-zoom fallback until they adopt it. News is already rem.
  if (app === 'news' || document.querySelector('meta[name=rkb-rem]')) document.documentElement.dataset.rem = '';

  // ── Preferences: the apps' existing keys, written together so each app reads its own on load ──
  const pref = {
    lang: () => (json('rkb.lang', null) ?? ls.get('lang')) === 'hi' ? 'hi' : 'en',
    size: () => json('rkb.size', 'normal'),
    theme: () => json('rkb.theme', null) ?? ls.get('theme') ?? 'system',
  };
  const de = document.documentElement;
  const applyTheme = () => {
    de.dataset.theme = pref.theme();
    const dark = de.dataset.theme === 'dark' || (de.dataset.theme === 'system' && matchMedia('(prefers-color-scheme: dark)').matches);
    document.querySelector('meta[name=theme-color]')?.setAttribute('content', dark ? '#000000' : '#f2f2f7');
  };
  de.dataset.rkb = ''; de.dataset.app = app; de.dataset.size = pref.size();
  applyTheme();

  // Reopen the tab this app was on (Health and Tasks keep the tab in the URL hash; News remembers its own).
  if (!location.hash && ls.get(tabKey(app))) history.replaceState(null, '', `#${ls.get(tabKey(app))}`);

  const T = {
    en: { health: 'Health', tasks: 'Tasks', news: 'News', settings: 'Settings', done: 'Done', lang: 'Language', size: 'Text size', theme: 'Appearance', home: 'Home screen', homes: ['Icons', 'Tabs'],
      sizes: ['Normal', 'Large', 'Larger'], themes: ['Auto', 'Light', 'Dark'], account: 'Account', out: 'Log out', sure: 'Tap again to log out of Health and Tasks',
      kept: 'Log out cancelled', gone: 'Logged out' },
    hi: { health: 'स्वास्थ्य', tasks: 'काम', news: 'खबरें', settings: 'सेटिंग', done: 'हो गया', lang: 'भाषा', size: 'अक्षर का आकार', theme: 'रंग', home: 'होम स्क्रीन', homes: ['आइकन', 'टैब'],
      sizes: ['सामान्य', 'बड़ा', 'और बड़ा'], themes: ['ऑटो', 'हल्का', 'गहरा'], account: 'खाता', out: 'लॉग आउट', sure: 'हेल्थ और टास्क से लॉग आउट करने के लिए फिर दबाएँ',
      kept: 'लॉग आउट रद्द', gone: 'लॉग आउट हो गया' },
  };
  const L = () => T[pref.lang()];

  // Keep the remembered tab current. The apps switch tabs with replaceState, so watch the tab bar itself.
  const saveTab = () => {
    const t = document.querySelector('.tabs button.on')?.dataset.tab;
    if (t && app !== 'news') ls.set(tabKey(app), t);
  };
  new MutationObserver(saveTab).observe(document, { subtree: true, attributes: true, attributeFilter: ['class'] });

  // ── Settings panel ──
  let panel;
  const seg = (name, items, cur) => `<div class="rkb-seg" role="group" data-pick="${name}">${items.map(([v, label]) =>
    `<button type="button" data-v="${v}" aria-pressed="${v === cur}">${label}</button>`).join('')}</div>`;
  // Android back / browser back closes the panel: it is one item on the RKB window's back stack (host.js rkbBack).
  let panelId = 0;
  function openPanel() {
    if (!panel) panelId = parent.rkbBack.push(app, () => closePanel(true));
    panel?.remove();
    const l = L();
    panel = document.createElement('div');
    panel.className = 'rkb-chrome'; panel.id = 'rkb-panel'; panel.setAttribute('role', 'dialog'); panel.setAttribute('aria-modal', 'true'); panel.setAttribute('aria-label', l.settings);
    panel.innerHTML = `<div class="rkb-panel-in"><header><h1>${l.settings}</h1><button type="button" class="rkb-close">${l.done}</button></header>
      <section><h2>${l.lang}</h2>${seg('lang', [['en', 'English'], ['hi', 'हिन्दी']], pref.lang())}</section>
      <section><h2>${l.size}</h2>${seg('size', ['normal', 'large', 'larger'].map((v, i) => [v, l.sizes[i]]), pref.size())}</section>
      <section><h2>${l.theme}</h2>${seg('theme', ['system', 'light', 'dark'].map((v, i) => [v, l.themes[i]]), pref.theme())}</section>
      ${matchMedia('(min-width: 1024px)').matches ? '' : `<section><h2>${l.home}</h2>${seg('home', ['icons', 'tabs'].map((v, i) => [v, l.homes[i]]), ls.get('rkb.home') === 'tabs' ? 'tabs' : 'icons')}</section>`}
      <div class="rkb-slot"></div>
      <section><h2>${l.account}</h2><button type="button" class="rkb-out">${l.out}</button><p class="rkb-msg" role="status"></p></section></div>`;
    document.body.append(panel);
    de.classList.add('rkb-panel-open');
    RKB.mountSettings?.(panel.querySelector('.rkb-slot'));
    panel.tabIndex = -1; panel.focus({ preventScroll: true }); // focus goes into the dialog (screen readers, Tab reaches Done next) without a ring on Done after a tap
  }
  const closePanel = (popped = false) => {
    if (!panel) return;
    panel.remove(); panel = null; de.classList.remove('rkb-panel-open');
    if (!popped) parent.rkbBack.done(panelId);
  };
  // The window reloads only after every back entry is popped (host.js), so no stale entry is left for back to land on. Once only.
  let reloading = false;
  const reloadHost = () => { if (!reloading) { reloading = true; host.reload(); } };
  RKB.openSettings = openPanel;
  RKB.closeSettings = () => closePanel();
  addEventListener('keydown', e => e.key === 'Escape' && closePanel());
  document.addEventListener('click', async e => {
    if (!panel || !panel.contains(e.target)) return;
    if (e.target.closest('.rkb-close')) return closePanel();
    const b = e.target.closest('[data-pick] button');
    if (b) {
      const kind = b.parentElement.dataset.pick;
      if (kind === 'lang' && b.dataset.v === pref.lang()) return; // already the language: no reload
      b.parentElement.querySelectorAll('button').forEach(x => x.setAttribute('aria-pressed', x === b));
      const v = b.dataset.v;
      if (kind === 'lang') { ls.set('lang', v); ls.set('rkb.lang', JSON.stringify(v)); reloadHost(); }
      if (kind === 'home') { ls.set('rkb.home', b.dataset.v); reloadHost(); }
      if (kind === 'size') { ls.set('rkb.size', JSON.stringify(v)); de.dataset.size = v; host.applyTheme?.(); }
      if (kind === 'theme') { ls.set('theme', v); ls.set('rkb.theme', JSON.stringify(v)); applyTheme(); host.applyTheme?.(); }
    }
    const out = e.target.closest('.rkb-out');
    if (out) {
      if (!out.dataset.armed) { out.dataset.armed = '1'; out.textContent = L().sure; return; }
      out.disabled = true;
      const msg = panel.querySelector('.rkb-msg');
      const ok = await logOut();
      out.disabled = false; delete out.dataset.armed; out.textContent = L().out;
      msg.textContent = ok ? L().gone : L().kept;
      if (ok) setTimeout(reloadHost, 600);
    }
  });
  matchMedia('(prefers-color-scheme: dark)').addEventListener('change', applyTheme);

  const logOut = () => host.logOutAll();

  // ── One sign-in ──
  // Health and Tasks are two Supabase projects. When one app's login form is submitted, the same email + password
  // is also signed in to the other project, and its session is stored where that app's supabase-js looks for it.
  // The password lives in memory until that call ends. If the other project refuses (different password, no account),
  // nothing is stored and that app shows its own login form as before.
  const tokenKey = url => `sb-${new URL(url).hostname.split('.')[0]}-auth-token`;
  document.addEventListener('submit', e => {
    const f = e.target.closest?.('form.login');
    if (!f || app === 'news') return;
    let email = f.email?.value.trim().toLowerCase(), password = f.password?.value;
    (async () => {
      const P = await fetch(`${BASE}projects.json`).then(r => r.json()).catch(() => null);
      if (!P?.[app] || !email || !password) return;
      for (let i = 0; i < 80 && !ls.get(tokenKey(P[app].url)); i++) await new Promise(r => setTimeout(r, 250)); // own sign-in done?
      if (!ls.get(tokenKey(P[app].url))) return;
      const todo = Object.keys(P).filter(a => a !== app && !ls.get(tokenKey(P[a].url)));
      await Promise.all(todo.filter((a, i) => todo.findIndex(b => tokenKey(P[b].url) === tokenKey(P[a].url)) === i).map(async a => {
        try {
          const r = await fetch(`${P[a].url}/auth/v1/token?grant_type=password`, {
            method: 'POST', headers: { apikey: P[a].key, 'content-type': 'application/json' }, body: JSON.stringify({ email, password }),
          });
          const s = r.ok && await r.json();
          if (s?.access_token && s.refresh_token) ls.set(tokenKey(P[a].url), JSON.stringify(s));
        } catch {}
      }));
      email = password = null;
    })();
  }, true);
  // The login screen belongs to RKB, not to one app.
  new MutationObserver(() => { const h = document.querySelector('form.login h1'); if (h && h.textContent !== 'RKB') h.textContent = 'RKB'; })
    .observe(document, { childList: true, subtree: true });
})();
