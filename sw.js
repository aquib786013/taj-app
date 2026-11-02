/* Service worker: makes the app open and work with no internet.
   Network-first (so updates show up as soon as you are online), cache fallback (so it still opens offline).
   Change CACHE name when you release a new version. */
const CACHE = 'taj-v2';
const ASSETS = ['./', 'index.html', 'style.css', 'logic.js', 'db.js', 'sync.js', 'app.js', 'manifest.json', 'icon-192.png', 'icon-512.png'];

self.addEventListener('install', function (e) {
  e.waitUntil(caches.open(CACHE).then(function (c) { return c.addAll(ASSETS); }).then(function () { return self.skipWaiting(); }));
});

self.addEventListener('activate', function (e) {
  e.waitUntil(caches.keys().then(function (keys) {
    return Promise.all(keys.filter(function (k) { return k !== CACHE; }).map(function (k) { return caches.delete(k); }));
  }).then(function () { return self.clients.claim(); }));
});

function networkFirst(req) {
  return new Promise(function (resolve) {
    let done = false;
    const finish = function (r) { if (!done && r) { done = true; resolve(r); } };
    // On a very slow connection, use the saved copy after 3 seconds.
    const timer = setTimeout(function () { caches.match(req, { ignoreSearch: true }).then(finish); }, 3000);
    fetch(req).then(function (res) {
      clearTimeout(timer);
      if (res && res.ok) { const copy = res.clone(); caches.open(CACHE).then(function (c) { c.put(req, copy); }); }
      finish(res);
    }).catch(function () {
      clearTimeout(timer);
      caches.match(req, { ignoreSearch: true }).then(function (hit) {
        if (hit) return finish(hit);
        if (req.mode === 'navigate') return caches.match('index.html').then(function (h) { finish(h || Response.error()); });
        finish(Response.error());
      });
    });
  });
}

self.addEventListener('fetch', function (e) {
  if (e.request.method !== 'GET') return;
  if (new URL(e.request.url).origin !== self.location.origin) return;
  e.respondWith(networkFirst(e.request));
});
