const CACHE_NAME = 'safecheck-offline-v2';

// Static files & core shells to pre-cache
const STATIC_ASSETS = [
  '/',
  '/index.html',
  '/manifest.json'
];

// Install event - precache core shell
self.addEventListener('install', (event) => {
  event.waitUntil(
    caches.open(CACHE_NAME).then((cache) => {
      return cache.addAll(STATIC_ASSETS).catch((err) => {
        console.warn('Pre-caching assets skipped during sw install:', err);
      });
    }).then(() => self.skipWaiting())
  );
});

// Activate event - cleanup stale caches
self.addEventListener('activate', (event) => {
  event.waitUntil(
    caches.keys().then((cacheNames) => {
      return Promise.all(
        cacheNames.map((cache) => {
          if (cache !== CACHE_NAME) {
            return caches.delete(cache);
          }
        })
      );
    }).then(() => self.clients.claim())
  );
});

// Push notification event listener (Handles server & FCM background push)
self.addEventListener('push', (event) => {
  let title = '🛡️ SafeCheck Safety Alert';
  let options = {
    body: 'Safety check-in status update.',
    icon: '/icon-192.png',
    badge: '/icon-192.png',
    vibrate: [300, 100, 300, 100, 300],
    requireInteraction: true,
    data: {
      dateOfArrival: Date.now(),
      primaryKey: '1'
    },
    actions: [
      { action: 'safe', title: "I'm Safe" },
      { action: 'open', title: 'Open SafeCheck' }
    ]
  };

  if (event.data) {
    try {
      const payload = event.data.json();
      title = payload.title || title;
      if (payload.body) options.body = payload.body;
      if (payload.icon) options.icon = payload.icon;
      if (payload.data) options.data = payload.data;
    } catch (e) {
      options.body = event.data.text() || options.body;
    }
  }

  event.waitUntil(
    self.registration.showNotification(title, options)
  );
});

// Notification click event
self.addEventListener('notificationclick', (event) => {
  event.notification.close();

  event.waitUntil(
    self.clients.matchAll({ type: 'window', includeUncontrolled: true }).then((clientList) => {
      // Focus existing window if open
      for (const client of clientList) {
        if (client.url.includes(self.location.origin) && 'focus' in client) {
          return client.focus();
        }
      }
      // Otherwise open a new tab/window
      if (self.clients.openWindow) {
        return self.clients.openWindow('/');
      }
    })
  );
});

// Fetch event - Stale-while-revalidate for assets, Network-first with cache fallback for pages
self.addEventListener('fetch', (event) => {
  const request = event.request;

  // Ignore non-GET requests or chrome-extension URLs or API routes
  if (request.method !== 'GET' || !request.url.startsWith('http') || request.url.includes('/api/')) {
    return;
  }

  // Handle HTML document navigation requests (Network-first, fallback to offline cache)
  if (request.mode === 'navigate') {
    event.respondWith(
      fetch(request)
        .then((response) => {
          if (response && response.status === 200) {
            const copy = response.clone();
            caches.open(CACHE_NAME).then((cache) => cache.put(request, copy));
          }
          return response;
        })
        .catch(() => {
          return caches.match('/') || caches.match('/index.html') || new Response(
            '<html><body><h1>SafeCheck Offline</h1><p>SafeCheck is operating offline. Your emergency contacts and active trip status remain available.</p></body></html>',
            { headers: { 'Content-Type': 'text/html' } }
          );
        })
    );
    return;
  }

  // Handle JS, CSS, fonts, icons (Stale-While-Revalidate)
  event.respondWith(
    caches.match(request).then((cachedResponse) => {
      const fetchPromise = fetch(request)
        .then((networkResponse) => {
          if (
            networkResponse &&
            networkResponse.status === 200 &&
            (networkResponse.type === 'basic' || networkResponse.type === 'cors')
          ) {
            const responseToCache = networkResponse.clone();
            caches.open(CACHE_NAME).then((cache) => cache.put(request, responseToCache));
          }
          return networkResponse;
        })
        .catch(() => cachedResponse);

      return cachedResponse || fetchPromise;
    })
  );
});
