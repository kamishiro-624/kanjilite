/* KanjiLite service worker. It does one job: show review notifications (a service worker can on every browser
   that supports notifications, including Android Chrome where `new Notification()` is not allowed) and bring
   the app to the front when one is tapped. It caches nothing and never touches network requests. */
self.addEventListener('install', () => self.skipWaiting());
self.addEventListener('activate', (e) => e.waitUntil(self.clients.claim()));

self.addEventListener('notificationclick', (e) => {
  e.notification.close();
  const hash = (e.notification.data && e.notification.data.url) || '#/';
  e.waitUntil((async () => {
    const list = await self.clients.matchAll({ type: 'window', includeUncontrolled: true });
    const mine = list.find((c) => c.url.startsWith(self.registration.scope));
    if (mine) {
      try { await mine.focus(); } catch (err) { /* the browser may refuse; the message still goes through */ }
      mine.postMessage({ go: hash });
      return;
    }
    await self.clients.openWindow(self.registration.scope + hash);
  })());
});
