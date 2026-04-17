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

// Network-first para recursos propios; no interceptamos peticiones cross-origin
// (p.ej. Google Apps Script) para evitar errores "Failed to convert value to 'Response'".
self.addEventListener('fetch', e => {
    const req = e.request;
    if (req.method !== 'GET') return;

    const url = new URL(req.url);
    if (url.origin !== self.location.origin) return;

    e.respondWith(
        fetch(req)
            .then(res => {
                if (res && res.ok) {
                    const clone = res.clone();
                    caches.open(CACHE).then(c => c.put(req, clone));
                }
                return res;
            })
            .catch(async () => {
                const cached = await caches.match(req);
                if (cached) return cached;
                if (req.mode === 'navigate') {
                    const fallback = await caches.match('./index.html');
                    if (fallback) return fallback;
                }
                return new Response('', { status: 504, statusText: 'Offline' });
            })
    );
});
