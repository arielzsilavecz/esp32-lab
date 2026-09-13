self.addEventListener('push', (event) => {
  const data = event.data?.json() || {};
  // PNG, no el SVG del favicon: la Notification API (y en particular el
  // badge de la barra de estado de Android) no renderiza SVG de forma
  // confiable -- con el SVG el icono no aparecia.
  event.waitUntil(self.registration.showNotification(data.title || 'Alarma', {
    body: data.body || 'Se modifico una zona',
    icon: '/icons/app-icon-256.png',
    badge: '/icons/app-icon-96.png',
    tag: data.tag || 'alarma-cambio-zona',
    renotify: true,
    data: { url: data.url || '/' },
  }));
});

self.addEventListener('notificationclick', (event) => {
  event.notification.close();
  const targetUrl = new URL(event.notification.data?.url || '/', self.location.origin).href;

  event.waitUntil((async () => {
    const windows = await self.clients.matchAll({ type: 'window', includeUncontrolled: true });
    const existing = windows.find((client) => client.url.startsWith(self.location.origin));
    if (existing) {
      await existing.navigate(targetUrl);
      return existing.focus();
    }
    return self.clients.openWindow(targetUrl);
  })());
});
