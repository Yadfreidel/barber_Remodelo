// Service worker de avisos (Web Push). No guarda la web en caché: solo muestra los avisos y abre la app.
// El aviso no trae datos del cliente; al abrirlo, la app exige iniciar sesión y comprueba los permisos.
self.addEventListener('install', () => self.skipWaiting());
self.addEventListener('activate', evento => evento.waitUntil(self.clients.claim()));

self.addEventListener('push', evento => {
    let datos = {};
    try { datos = evento.data ? evento.data.json() : {}; } catch { datos = {}; }
    const url = new URL(datos.url || './?panel=notificaciones', self.registration.scope).href;
    evento.waitUntil(self.registration.showNotification(datos.titulo || 'Barbería', {
        body: datos.cuerpo || 'Abre la app para ver el detalle.',
        tag: datos.etiqueta || 'barberia',
        icon: 'assets/imagenes/icono-192.png',
        badge: 'assets/imagenes/icono-192.png',
        data: { url }
    }));
});

self.addEventListener('notificationclick', evento => {
    evento.notification.close();
    const url = evento.notification.data?.url || self.registration.scope;
    evento.waitUntil((async () => {
        const ventanas = await self.clients.matchAll({ type: 'window', includeUncontrolled: true });
        const abierta = ventanas.find(v => v.url.startsWith(self.registration.scope));
        if (abierta) {
            abierta.postMessage({ tipo: 'abrir-aviso', url });
            return abierta.focus();
        }
        return self.clients.openWindow(url);
    })());
});
