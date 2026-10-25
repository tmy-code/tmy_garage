// Loaded into the generated service worker (vite.config.ts, workbox.importScripts): shows Reminders sent by the server.
self.addEventListener('push', (event) => {
  const message = event.data ? event.data.json() : {};
  event.waitUntil(
    self.registration.showNotification(message.title || 'TMY Garage', {
      body: message.body || '',
      icon: '/icon.svg',
      // A newer Reminder replaces the previous one instead of piling up.
      tag: 'reminders',
      data: { url: message.url || '/' },
    }),
  );
});

self.addEventListener('notificationclick', (event) => {
  event.notification.close();
  const url = new URL(event.notification.data?.url || '/', self.location.origin).href;
  event.waitUntil(
    self.clients.matchAll({ type: 'window', includeUncontrolled: true }).then((windows) => {
      const open = windows.find((w) => new URL(w.url).origin === self.location.origin);
      if (open)
        return open
          .navigate(url)
          .then((w) => (w || open).focus())
          .catch(() => self.clients.openWindow(url));
      return self.clients.openWindow(url);
    }),
  );
});
