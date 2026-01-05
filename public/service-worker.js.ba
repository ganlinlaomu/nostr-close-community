/* ======================================================
 *  Clean & Stable Service Worker
 *  - Update controlled by page (registration.waiting)
 *  - No false update notifications
 * ====================================================== */

const VERSION = '0.1.0'; // ⚠️ 只在真正发版时手动改
const CACHE_PREFIX = 'closed-community-pwa';

const ASSETS_CACHE = `${CACHE_PREFIX}-assets-${VERSION}`;
const HTML_CACHE = `${CACHE_PREFIX}-html-${VERSION}`;

/**
 * Install
 * - Cache only immutable static assets
 * - DO NOT call skipWaiting here
 */
self.addEventListener('install', (event) => {
  console.log('[SW] install', VERSION);

  event.waitUntil(
    caches.open(ASSETS_CACHE).then((cache) =>
      cache.addAll([
        '/manifest.json',
        '/icon-192.png',
        '/icon-512.png'
      ])
    )
  );
});

/**
 * Activate
 * - Clean old caches
 * - Take control of clients
 */
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
            console.log('[SW] delete old cache:', key);
            return caches.delete(key);
          })
      )
    ).then(() => self.clients.claim())
  );
});

/**
 * Message
 * - Page explicitly tells SW to activate new version
 */
self.addEventListener('message', (event) => {
  if (event.data?.type === 'SKIP_WAITING') {
    console.log('[SW] skipWaiting requested');
    self.skipWaiting();
  }
});

/**
 * Fetch
 * - HTML: network-first (always try latest)
 * - Other assets: cache-first
 */
self.addEventListener('fetch', (event) => {
  const { request } = event;

  // HTML navigation requests
  if (request.mode === 'navigate') {
    event.respondWith(
      fetch(request)
        .then((response) => {
          const copy = response.clone();
          caches.open(HTML_CACHE).then((cache) => {
            cache.put(request, copy);
          });
          return response;
        })
        .catch(() => caches.match(request))
    );
    return;
  }

  // Static assets
  event.respondWith(
    caches.match(request).then((cached) => {
      if (cached) return cached;

      return fetch(request).then((response) => {
        if (response && response.status === 200) {
          const copy = response.clone();
          caches.open(ASSETS_CACHE).then((cache) => {
            cache.put(request, copy);
          });
        }
        return response;
      });
    })
  );
});
