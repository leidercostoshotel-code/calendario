const CACHE = 'agenda-v1';
const ASSETS = ['./', './index.html', './icon.svg', './manifest.json'];

// Instala y cachea los archivos base
self.addEventListener('install', e => {
    self.skipWaiting();
    e.waitUntil(
        caches.open(CACHE).then(c => c.addAll(ASSETS).catch(() => {}))
    );
});

// Limpia caches viejos y toma control inmediato
self.addEventListener('activate', e => {
    e.waitUntil(
        caches.keys()
            .then(keys => Promise.all(keys.filter(k => k !== CACHE).map(k => caches.delete(k))))
            .then(() => self.clients.claim())
    );
});

// Network-first: siempre intenta la red para tener la versión más nueva,
// cae al caché solo si no hay conexión
self.addEventListener('fetch', e => {
    if (e.request.method !== 'GET') return;
    e.respondWith(
        fetch(e.request)
            .then(res => {
                if (res.ok) {
                    const clone = res.clone();
                    caches.open(CACHE).then(c => c.put(e.request, clone));
                }
                return res;
            })
            .catch(() => caches.match(e.request))
    );
});
