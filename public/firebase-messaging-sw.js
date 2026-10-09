// Firebase Cloud Messaging Service Worker
importScripts('https://www.gstatic.com/firebasejs/10.8.0/firebase-app-compat.js');
importScripts('https://www.gstatic.com/firebasejs/10.8.0/firebase-messaging-compat.js');

// Push listener for background FCM messages
self.addEventListener('push', function(event) {
  let title = '🛡️ SafeCheck Safety Alert';
  let options = {
    body: 'Safety check-in notification.',
    icon: '/icon-192.png',
    badge: '/icon-192.png',
    vibrate: [300, 100, 300, 100, 300],
    requireInteraction: true,
    data: {
      url: '/'
    }
  };

  if (event.data) {
    try {
      const data = event.data.json();
      if (data.notification) {
        title = data.notification.title || title;
        options.body = data.notification.body || options.body;
        options.icon = data.notification.icon || options.icon;
      }
      if (data.data) {
        options.data = data.data;
      }
    } catch (e) {
      options.body = event.data.text() || options.body;
    }
  }

  event.waitUntil(
    self.registration.showNotification(title, options)
  );
});

self.addEventListener('notificationclick', function(event) {
  event.notification.close();
  event.waitUntil(
    clients.matchAll({ type: 'window', includeUncontrolled: true }).then(function(clientList) {
      for (let i = 0; i < clientList.length; i++) {
        let client = clientList[i];
        if (client.url && 'focus' in client) {
          return client.focus();
        }
      }
      if (clients.openWindow) {
        return clients.openWindow('/');
      }
    })
  );
});
