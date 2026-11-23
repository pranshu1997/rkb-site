// RKB service worker: one worker for /rkb/. {"health": {"v": "b6b844ae54", "files": ["index.html", "css/app.css", "icons/apple-touch-icon.png", "icons/icon-192.png", "icons/icon-512.png", "icons/maskable-512.png", "js/app.js", "js/back.js", "js/cheer.js", "js/config.js", "js/dashboard.js", "js/db.js", "js/food-db.json", "js/foodlog.js", "js/i18n.js", "js/icons.js", "js/keypad.js", "js/meds.js", "js/nutrition.js", "js/overlay.js", "js/push.js", "js/ranges.js", "js/settings.js", "js/slots.js", "js/stats.js", "js/streak.js", "js/targetcalc.js", "js/targets.js", "js/tasks.js", "js/today.js", "js/ui.js", "js/voice.js"]}, "tasks": {"v": "9221a5ab5b", "files": ["index.html", "css/app.css", "icons/apple-touch-icon.png", "icons/icon-192.png", "icons/icon-512.png", "icons/maskable-512.png", "js/app.js", "js/config.js", "js/detail.js", "js/lists.js", "js/listsview.js", "js/photos.js", "js/places.js", "js/placesview.js", "js/push.js", "js/queue.js", "js/recur.js", "js/repeat.js", "js/settings.js", "js/sort.js", "js/store.js", "js/strings.js", "js/tasks.js", "js/team.js", "js/ui.js", "js/voice.js"]}, "news": {"v": "a7e529d8d2", "files": ["index.html", "css/app.css", "data/news.json", "icons/apple-touch-icon.png", "icons/icon-192.png", "icons/icon-512.png", "icons/maskable-512.png", "js/app.js", "js/logic.js"]}, "shell": {"v": "c42e68411e", "files": ["host.css", "host.js", "icons/apple-touch-icon.png", "icons/icon-192.png", "icons/icon-512.png", "icons/maskable-512.png", "index.html", "manifest.webmanifest", "projects.json", "rkb-tokens.css", "shell.css", "shell.js"]}} is filled in by scripts/build.sh:
// { shell|health|tasks|news: { v: content hash, files: [paths under that folder] } }.
// Only the shell is precached. An app's files are cached the first time it is opened, in a cache named after
// that app's hash, so a new Health version never makes anyone re-download Tasks or News.
const BUILD = {"health": {"v": "b6b844ae54", "files": ["index.html", "css/app.css", "icons/apple-touch-icon.png", "icons/icon-192.png", "icons/icon-512.png", "icons/maskable-512.png", "js/app.js", "js/back.js", "js/cheer.js", "js/config.js", "js/dashboard.js", "js/db.js", "js/food-db.json", "js/foodlog.js", "js/i18n.js", "js/icons.js", "js/keypad.js", "js/meds.js", "js/nutrition.js", "js/overlay.js", "js/push.js", "js/ranges.js", "js/settings.js", "js/slots.js", "js/stats.js", "js/streak.js", "js/targetcalc.js", "js/targets.js", "js/tasks.js", "js/today.js", "js/ui.js", "js/voice.js"]}, "tasks": {"v": "9221a5ab5b", "files": ["index.html", "css/app.css", "icons/apple-touch-icon.png", "icons/icon-192.png", "icons/icon-512.png", "icons/maskable-512.png", "js/app.js", "js/config.js", "js/detail.js", "js/lists.js", "js/listsview.js", "js/photos.js", "js/places.js", "js/placesview.js", "js/push.js", "js/queue.js", "js/recur.js", "js/repeat.js", "js/settings.js", "js/sort.js", "js/store.js", "js/strings.js", "js/tasks.js", "js/team.js", "js/ui.js", "js/voice.js"]}, "news": {"v": "a7e529d8d2", "files": ["index.html", "css/app.css", "data/news.json", "icons/apple-touch-icon.png", "icons/icon-192.png", "icons/icon-512.png", "icons/maskable-512.png", "js/app.js", "js/logic.js"]}, "shell": {"v": "c42e68411e", "files": ["host.css", "host.js", "icons/apple-touch-icon.png", "icons/icon-192.png", "icons/icon-512.png", "icons/maskable-512.png", "index.html", "manifest.webmanifest", "projects.json", "rkb-tokens.css", "shell.css", "shell.js"]}};
const BASE = new URL('./', self.registration.scope).pathname;
const APPS = ['health', 'tasks', 'news'];
const FEED = "https://pranshu1997.github.io/rkb-news/data/news.json"; // News feed host (cross-origin, CORS-open); '' = the bundled copy only
const CDN = 'rkb-cdn'; // supabase-js and chart.js: kept across app updates
const name = k => `rkb-${k}-${BUILD[k].v}`;
const dir = k => (k === 'shell' ? BASE : `${BASE}${k}/`);
const keyOf = u => (u.pathname.endsWith('/') ? u.origin + u.pathname + 'index.html' : u.origin + u.pathname);
const load = (c, k) => c.addAll(BUILD[k].files.map(f => new Request(dir(k) + f, { cache: 'reload' })));

self.addEventListener('install', e => e.waitUntil((async () => {
  const have = await caches.keys();
  await load(await caches.open(name('shell')), 'shell');
  // An app opened before gets its new version now (only that app); the others stay lazy.
  for (const k of APPS) if (have.some(n => n.startsWith(`rkb-${k}-`)) && !have.includes(name(k))) await load(await caches.open(name(k)), k);
  await self.skipWaiting();
})()));

self.addEventListener('activate', e => e.waitUntil((async () => {
  const keep = new Set([CDN, ...Object.keys(BUILD).map(name)]);
  await Promise.all((await caches.keys()).filter(n => !keep.has(n)).map(n => caches.delete(n)));
  await self.clients.claim();
})()));

self.addEventListener('fetch', e => {
  const req = e.request;
  if (req.method !== 'GET') return;
  const u = new URL(req.url);
  if (u.hostname === 'cdn.jsdelivr.net') return e.respondWith(stale(req));
  if (u.origin !== location.origin || !u.pathname.startsWith(BASE)) return;
  const app = u.pathname.slice(BASE.length).split('/')[0];
  const cache = name(APPS.includes(app) ? app : 'shell');
  e.respondWith(u.pathname.endsWith('/data/news.json') ? fresh(u, cache) : lazy(u, cache));
});

// Cache first; a miss goes to the network once and is kept.
async function lazy(u, cacheName) {
  const c = await caches.open(cacheName), key = keyOf(u);
  return (await c.match(key)) ?? fetch(u.origin + u.pathname + u.search, { cache: 'reload' }).then(res => {
    if (res.ok) c.put(key, res.clone());
    return res;
  });
}
// News: the feed host first, then the bundled copy, then the last batch kept when offline.
async function fresh(u, cacheName) {
  const c = await caches.open(cacheName), key = u.origin + u.pathname;
  try {
    let res = FEED ? await fetch(FEED, { cache: 'no-store' }).catch(() => null) : null;
    if (!res?.ok) res = await fetch(u.href, { cache: 'no-store' });
    if (res.ok) c.put(key, res.clone());
    return res;
  } catch {
    return (await c.match(key)) ?? Response.error();
  }
}
// Libraries: serve the kept copy and refresh behind it.
async function stale(req) {
  const c = await caches.open(CDN), hit = await c.match(req);
  const net = fetch(req).then(res => ((res.ok || res.type === 'opaque') && c.put(req, res.clone()), res)).catch(() => hit ?? Response.error());
  return hit ?? net;
}

self.addEventListener('message', e => {
  // The page being opened asks for its own app's files, so even a first visit works offline next time.
  const app = e.data?.app;
  if (APPS.includes(app)) e.waitUntil((async () => {
    const c = await caches.open(name(app));
    if (!(await c.keys()).length) await load(c, app).catch(() => {});
  })());
  if (e.data?.cache) e.waitUntil(caches.open(CDN).then(c => c.addAll(e.data.cache)).catch(() => {}));
});
self.addEventListener('push', e => {
  const d = e.data?.json() ?? {};
  e.waitUntil(self.registration.showNotification(d.title || 'RKB', {
    body: d.body || '', tag: d.tag, renotify: true, icon: `${BASE}icons/icon-192.png`, badge: `${BASE}icons/icon-192.png`, data: { url: d.url },
  }));
});
self.addEventListener('notificationclick', e => {
  e.notification.close();
  const url = e.notification.data?.url ?? BASE;
  e.waitUntil(self.clients.matchAll({ type: 'window' }).then(list => (list.length ? list[0].focus() : self.clients.openWindow(url))));
});
