// Service Worker with improved caching strategies
const CACHE_VERSION = 'v2';
const STATIC_CACHE = `closed-community-static-${CACHE_VERSION}`;
const RUNTIME_CACHE = `closed-community-runtime-${CACHE_VERSION}`;
const IMAGE_CACHE = `closed-community-images-${CACHE_VERSION}`;

// Assets to precache - these will be available offline immediately
const PRECACHE_ASSETS = [
  '/',
  '/index.html',
  '/manifest.json',
  '/icon-192.png',
  '/icon-512.png'
];

// Install event - precache static assets
self.addEventListener('install', event => {
  event.waitUntil(
    caches.open(STATIC_CACHE)
      .then(cache => cache.addAll(PRECACHE_ASSETS))
      .then(() => self.skipWaiting())
  );
});

// Activate event - clean up old caches
self.addEventListener('activate', event => {
  const currentCaches = [STATIC_CACHE, RUNTIME_CACHE, IMAGE_CACHE];
  event.waitUntil(
    caches.keys()
      .then(keys => {
        return Promise.all(
          keys.map(key => {
            if (!currentCaches.includes(key)) {
              return caches.delete(key);
            }
          })
        );
      })
      .then(() => self.clients.claim())
  );
});

// Fetch event - smart caching strategy
self.addEventListener('fetch', event => {
  const { request } = event;
  const url = new URL(request.url);

  // Skip non-GET requests
  if (request.method !== 'GET') {
    return;
  }

  // Skip chrome extensions and other protocols
  if (!url.protocol.startsWith('http')) {
    return;
  }

  // Strategy 1: Cache-first for static assets (JS, CSS, fonts, icons)
  if (request.destination === 'script' || 
      request.destination === 'style' || 
      request.destination === 'font' ||
      url.pathname.match(/\.(js|css|woff2?|ttf|otf|eot)$/)) {
    event.respondWith(
      caches.match(request).then(cached => {
        if (cached) {
          return cached;
        }
        return fetch(request).then(response => {
          if (response.ok) {
            const responseClone = response.clone();
            caches.open(STATIC_CACHE).then(cache => {
              cache.put(request, responseClone);
            });
          }
          return response;
        });
      })
    );
    return;
  }

  // Strategy 2: Cache-first for images with separate cache
  if (request.destination === 'image' || 
      url.pathname.match(/\.(png|jpg|jpeg|gif|webp|svg|avif|ico)$/)) {
    event.respondWith(
      caches.match(request).then(cached => {
        if (cached) {
          return cached;
        }
        return fetch(request).then(response => {
          if (response.ok) {
            const responseClone = response.clone();
            caches.open(IMAGE_CACHE).then(cache => {
              cache.put(request, responseClone);
            });
          }
          return response;
        }).catch(() => {
          // Return a fallback image if needed
          return new Response('', { status: 404 });
        });
      })
    );
    return;
  }

  // Strategy 3: Stale-while-revalidate for HTML and API requests
  // Serves cached version immediately while fetching update in background
  if (request.destination === 'document' || 
      url.pathname.startsWith('/api/') ||
      request.headers.get('accept')?.includes('text/html')) {
    event.respondWith(
      caches.open(RUNTIME_CACHE).then(cache => {
        return cache.match(request).then(cached => {
          const fetchPromise = fetch(request).then(response => {
            if (response.ok) {
              cache.put(request, response.clone());
            }
            return response;
          }).catch(() => cached || new Response('Offline', { status: 503 }));

          // Return cached version immediately if available, otherwise wait for fetch
          return cached || fetchPromise;
        });
      })
    );
    return;
  }

  // Strategy 4: Network-first for everything else (WebSocket, etc.)
  event.respondWith(
    fetch(request).catch(() => {
      return caches.match(request).then(cached => {
        return cached || new Response('Offline', { status: 503 });
      });
    })
  );
});
