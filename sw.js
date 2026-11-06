// Service worker: makes Gridscape installable and fast on repeat visits.
//  - Pages: network first, cached copy when offline
//  - Site files and the Three.js / gifenc libraries from jsDelivr: cache first
//  - API requests: never cached here (the APIs have their own caching)
const VERSION = 'gridscape-v2';
const CORE = [
  './',
  'index.html',
  'css/style.css',
  'js/app.js', 'js/api.js', 'js/sources.js', 'js/config.js', 'js/stats.js', 'js/palettes.js',
  'js/share.js', 'js/scene.js', 'js/achievements.js', 'js/export.js', 'js/wrapped.js',
  'assets/favicon.svg', 'assets/icon-192.png', 'assets/icon-512.png',
  'assets/fonts/dejavu-sans-bold.typeface.json',
  'manifest.webmanifest',
];
const CDN = 'https://cdn.jsdelivr.net/npm/';

self.addEventListener('install', (event) => {
  event.waitUntil(caches.open(VERSION).then((c) => c.addAll(CORE)).then(() => self.skipWaiting()));
});

self.addEventListener('activate', (event) => {
  event.waitUntil(
    caches.keys()
      .then((keys) => Promise.all(keys.filter((k) => k !== VERSION).map((k) => caches.delete(k))))
      .then(() => self.clients.claim())
  );
});

self.addEventListener('fetch', (event) => {
  const req = event.request;
  if (req.method !== 'GET') return;
  const url = new URL(req.url);
  const sameOrigin = url.origin === self.location.origin;
  const cdn = req.url.startsWith(CDN);
  if (!sameOrigin && !cdn) return; // APIs, avatars, badges: straight to the network

  if (req.mode === 'navigate') {
    event.respondWith(
      fetch(req)
        .then((res) => {
          const copy = res.clone();
          caches.open(VERSION).then((c) => c.put('index.html', copy));
          return res;
        })
        .catch(() => caches.match('index.html'))
    );
    return;
  }

  event.respondWith(
    caches.match(req).then((hit) => {
      const network = fetch(req).then((res) => {
        if (res.ok && (res.type === 'basic' || res.type === 'cors')) {
          const copy = res.clone();
          caches.open(VERSION).then((c) => c.put(req, copy));
        }
        return res;
      });
      // CDN files are versioned and immutable: cache first. Own files: serve cache, refresh in background.
      if (hit) {
        if (!cdn) network.catch(() => {});
        return hit;
      }
      return network;
    })
  );
});
