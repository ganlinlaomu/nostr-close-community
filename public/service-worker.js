// 🔄 Dynamic version - update this when deploying new versions
// Use timestamp or package version to ensure unique cache names
const VERSION = '0.1.0';
const BUILD_TIME = '2026-01-03'; // Update this on each build
const CACHE_NAME = `closed-community-pwa-v${VERSION}-${BUILD_TIME}`;

const ASSETS = [
  '/',
  '/index.html',
  '/manifest.json',
  '/icon-192.png',
  '/icon-512.png'
];

// ⚠️ Network-first strategy for HTML to always get latest version
const HTML_CACHE_NAME = `html-${CACHE_NAME}`;
const ASSETS_CACHE_NAME = `assets-${CACHE_NAME}`;

self.addEventListener('install', event => {
  console.log('[SW] Installing version:', VERSION, BUILD_TIME);
  event.waitUntil(
    caches.open(ASSETS_CACHE_NAME).then(cache => {
      // Only cache static assets, not HTML
      const staticAssets = ASSETS.filter(url => !url.endsWith('.html') && url !== '/');
      return cache.addAll(staticAssets);
    }).then(() => {
      // Force immediate activation
      return self.skipWaiting();
    })
  );
});

self.addEventListener('activate', event => {
  console.log('[SW] Activating version:', VERSION, BUILD_TIME);
  event.waitUntil(
    Promise.all([
      // Delete all old caches and check if this is an update
      caches.keys().then(keys => {
        // Check if there are any old caches (indicates this is an update, not fresh install)
        const oldCaches = keys.filter(key => 
          key !== ASSETS_CACHE_NAME && 
          key !== HTML_CACHE_NAME &&
          (key.startsWith('closed-community-pwa-') || key.startsWith('html-') || key.startsWith('assets-'))
        );
        const isUpdate = oldCaches.length > 0;
        
        console.log('[SW] Old caches found:', oldCaches.length > 0 ? oldCaches : 'none');
        console.log('[SW] Is update:', isUpdate);
        
        // Delete old caches
        return Promise.all(
          keys.map(key => {
            if (key !== ASSETS_CACHE_NAME && key !== HTML_CACHE_NAME) {
              console.log('[SW] Deleting old cache:', key);
              return caches.delete(key);
            }
          })
        ).then(() => isUpdate); // Pass isUpdate flag to next step
      }),
      // Take control of all clients immediately
      self.clients.claim()
    ]).then(([isUpdate]) => {
      // Only notify clients if this is an actual update, not a fresh install
      if (isUpdate) {
        console.log('[SW] Notifying clients about update');
        return self.clients.matchAll().then(clients => {
          clients.forEach(client => {
            client.postMessage({
              type: 'SW_UPDATED',
              version: VERSION,
              buildTime: BUILD_TIME
            });
          });
        });
      } else {
        console.log('[SW] Fresh install, not sending update notification');
      }
    })
  );
});

self.addEventListener('fetch', event => {
  const { request } = event;
  const url = new URL(request.url);

  // Network-first for HTML documents to ensure latest version
  if (request.mode === 'navigate' || request.destination === 'document') {
    event.respondWith(
      fetch(request)
        .then(response => {
          // Clone and cache the response
          const responseToCache = response.clone();
          caches.open(HTML_CACHE_NAME).then(cache => {
            cache.put(request, responseToCache);
          });
          return response;
        })
        .catch(() => {
          // Fallback to cache if offline
          return caches.match(request);
        })
    );
    return;
  }

  // Cache-first for other assets (JS, CSS, images)
  event.respondWith(
    caches.match(request).then(cachedResponse => {
      if (cachedResponse) {
        return cachedResponse;
      }
      
      // Not in cache, fetch from network
      return fetch(request).then(response => {
        // Cache successful responses
        if (response && response.status === 200) {
          const responseToCache = response.clone();
          caches.open(ASSETS_CACHE_NAME).then(cache => {
            cache.put(request, responseToCache);
          });
        }
        return response;
      });
    })
  );
});
