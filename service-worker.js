// TareMate service worker: cache the app shell for offline use.
// Camera frames are never cached or sent anywhere. Bump VERSION on each release.
const VERSION = 'taremate-v0.1.0';
const SHELL = [
  './', './index.html', './manifest.webmanifest', './styles/app.css',
  './src/app.js', './src/camera.js', './src/frame-processing.js', './src/weight-reader.js',
  './src/digit-templates.js', './src/reading-filter.js', './src/stability-detector.js',
  './src/weighing-machine.js', './src/audio-feedback.js', './src/settings.js',
  './icons/icon-192.png', './icons/icon-512.png', './icons/icon-maskable-512.png',
];

self.addEventListener('install', (e) => {
  e.waitUntil(caches.open(VERSION).then((c) => c.addAll(SHELL)).then(() => self.skipWaiting()));
});

self.addEventListener('activate', (e) => {
  e.waitUntil(caches.keys()
    .then((keys) => Promise.all(keys.filter((k) => k !== VERSION).map((k) => caches.delete(k))))
    .then(() => self.clients.claim()));
});

self.addEventListener('fetch', (e) => {
  const url = new URL(e.request.url);
  if (e.request.method !== 'GET' || url.origin !== location.origin) return;
  if (url.pathname.includes('/test-assets/')) return; // demo media: network only
  // Cache-first for the shell, falling back to network (and caching same-origin GETs).
  e.respondWith(
    caches.match(e.request, { ignoreSearch: true }).then((hit) => hit || fetch(e.request).then((res) => {
      if (res.ok && res.type === 'basic') {
        const copy = res.clone();
        caches.open(VERSION).then((c) => c.put(e.request, copy));
      }
      return res;
    }).catch(() => (e.request.mode === 'navigate' ? caches.match('./index.html') : Response.error())))
  );
});
