/* Vitcare POS service worker — offline-first app shell */
const VERSION = 'vitcare-v1';
const SHELL = ['/', '/login', '/dashboard', '/dashboard/pos', '/dashboard/inventory',
  '/dashboard/orders', '/dashboard/reports', '/dashboard/settings', '/shop',
  '/manifest.json', '/icon.svg', '/icon-192.png', '/icon-512.png'];

self.addEventListener('install', (e) => {
  e.waitUntil(caches.open(VERSION).then((c) => c.addAll(SHELL)).then(() => self.skipWaiting()));
});

self.addEventListener('activate', (e) => {
  e.waitUntil(
    caches.keys().then((keys) => Promise.all(keys.filter((k) => k !== VERSION).map((k) => caches.delete(k))))
      .then(() => self.clients.claim()),
  );
});

self.addEventListener('fetch', (e) => {
  const url = new URL(e.request.url);
  if (e.request.method !== 'GET') return;               // never cache mutations
  if (url.pathname.startsWith('/api/')) return;          // APIs: network only

  // Navigations: network-first, fall back to cached shell (true offline UX)
  if (e.request.mode === 'navigate') {
    e.respondWith(
      fetch(e.request)
        .then((r) => { const copy = r.clone(); caches.open(VERSION).then((c) => c.put(e.request, copy)); return r; })
        .catch(() => caches.match(e.request).then((r) => r || caches.match('/dashboard'))),
    );
    return;
  }

  // Static assets + fonts: stale-while-revalidate
  e.respondWith(
    caches.match(e.request).then((cached) => {
      const net = fetch(e.request).then((r) => {
        if (r.ok && (url.origin === location.origin || url.hostname.includes('fonts.g'))) {
          const copy = r.clone(); caches.open(VERSION).then((c) => c.put(e.request, copy));
        }
        return r;
      }).catch(() => cached);
      return cached || net;
    }),
  );
});
