/* ======================================================
 * Clean & Stable Service Worker
 * ====================================================== */

const VERSION = '0.1.0';
const CACHE_PREFIX = 'closed-community-pwa';
const ASSETS_CACHE = `${CACHE_PREFIX}-assets-${VERSION}`;
const HTML_CACHE = `${CACHE_PREFIX}-html-${VERSION}`;

self.addEventListener('install', (event) => {
  console.log('[SW] install', VERSION);
  event.waitUntil(
    Promise.all([
      caches.open(ASSETS_CACHE).then((cache) =>
        cache.addAll([
          '/manifest.json',
          '/icon-192.png',
          '/icon-512.png'
        ])
      ),
      caches.open(HTML_CACHE)
    ])
  );
});

self.addEventListener('activate', (event) => {
  console.log('[SW] activate', VERSION);
  event.waitUntil(
    caches.keys().then((keys) =>
      Promise.all(
        keys
          .filter(
            (key) =>
              key.startsWith(CACHE_PREFIX) &&
              key !== ASSETS_CACHE &&
              key !== HTML_CACHE
          )
          .map((key) => {
            console.log('[SW] Deleting old cache:', key);
            return caches.delete(key);
          })
      )
    ).then(() => self.clients.claim())
  );
});

self.addEventListener('message', (event) => {
  if (event.data?.type === 'SKIP_WAITING') {
    self.skipWaiting();
  }
});

self.addEventListener('fetch', (event) => {
  const { request } = event;
  const url = new URL(request.url);

  if (request.method !== 'GET' || url.pathname.includes('/api/')) {
    return;
  }

  if (request.mode === 'navigate') {
    event.respondWith(
      fetch(request)
        .then((response) => {
          const copy = response.clone();
          caches.open(HTML_CACHE).then((cache) => cache.put(request, copy));
          return response;
        })
        .catch(() =>
          caches.match(request).then((res) => res || caches.match('/index.html'))
        )
    );
    return;
  }

  event.respondWith(
    caches.match(request).then((cached) => {
      if (cached) return cached;
      return fetch(request).then((response) => {
        if (response && response.status === 200) {
          const copy = response.clone();
          caches.open(ASSETS_CACHE).then((cache) =>
            cache.put(request, copy)
          );
        }
        return response;
      });
    })
  );
});