// OnioNet service worker. It makes the app installable on phones and shows a
// friendly page when there is no internet. It never caches farmer data or API
// responses: custody and payments must always come live from the server.
const OFFLINE = 'onionet-offline-v1';
const OFFLINE_URL = '/offline.html';

self.addEventListener('install', (event) => {
  event.waitUntil(caches.open(OFFLINE).then((cache) => cache.addAll([OFFLINE_URL, '/logo.png'])));
  self.skipWaiting();
});

self.addEventListener('activate', (event) => {
  event.waitUntil(caches.keys()
    .then((keys) => Promise.all(keys.filter((k) => k !== OFFLINE).map((k) => caches.delete(k))))
    .then(() => self.clients.claim()));
});

// Only page loads are handled: try the network, and fall back to the offline page.
self.addEventListener('fetch', (event) => {
  if (event.request.mode !== 'navigate') return;
  event.respondWith(fetch(event.request).catch(() => caches.match(OFFLINE_URL)));
});
