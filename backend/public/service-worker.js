self.addEventListener('push', (event) => {
  const data = event.data?.json() || {};
  // PNG con fondo transparente, no el SVG del favicon con fondo solido: la
  // Notification API no renderiza SVG de forma confiable, y un fondo opaco
  // de borde a borde (el favicon tiene un cuadrado redondeado #1a1a19 que
  // cubre todo el lienzo) queda irreconocible cuando el SO le aplica su
  // propio recorte/mascara -- comparado con gastos-app/nono-lalo, que usan
  // el sujeto recortado sobre fondo transparente y sí se ven bien.
  event.waitUntil(self.registration.showNotification(data.title || 'Alarma', {
    body: data.body || 'Se modifico una zona',
    icon: '/icons/app-icon-notification-256.png',
    badge: '/icons/app-icon-notification-96.png',
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
