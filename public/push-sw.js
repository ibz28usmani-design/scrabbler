/* Scrabbler's push notifications, loaded into the service worker. */
self.addEventListener('push', (event) => {
  let data = {};
  try {
    data = event.data ? event.data.json() : {};
  } catch {
    data = { title: 'Scrabbler', body: event.data ? event.data.text() : '' };
  }
  event.waitUntil(
    self.registration.showNotification(data.title || 'Scrabbler', {
      body: data.body || '',
      tag: data.tag,
      icon: 'icon-192.png',
      badge: 'icon-192.png',
      data: { url: data.url || './' },
    }),
  );
});

self.addEventListener('notificationclick', (event) => {
  event.notification.close();
  let url = new URL((event.notification.data && event.notification.data.url) || './', self.registration.scope).href;
  // Only ever into the app: a push payload can't send a tap off to another site.
  if (!url.startsWith(self.registration.scope)) url = self.registration.scope;
  event.waitUntil(
    self.clients.matchAll({ type: 'window', includeUncontrolled: true }).then((windows) => {
      for (const w of windows) {
        if ('focus' in w) {
          w.postMessage({ type: 'scrabbler-open', url });
          return w.focus();
        }
      }
      return self.clients.openWindow(url);
    }),
  );
});
