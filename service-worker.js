// Naikkan angka versi ini setiap kali kamu mengunggah perubahan file, supaya pengguna mendapat versi terbaru.
const CACHE = 'love-ocean-v5';

// Harus sama dengan yang dimuat index.html (css/..., js/...).
const ASSETS = [
  '/', '/index.html',
  '/css/style.css', '/css/mine.css', '/css/account.css', '/css/chat.css',
  '/js/config.js', '/js/app.js', '/js/mine.js', '/js/account.js',
  '/privacy.html', '/privacy.css', '/manifest.json',
  '/icons/icon-192.png', '/icons/icon-512.png', '/icons/icon-maskable-512.png', '/icons/apple-touch-icon.png'
];

self.addEventListener('install', (e) => {
  e.waitUntil(
    caches.open(CACHE)
      // Satu per satu: file yang tidak ada tidak lagi menggagalkan seluruh pemasangan.
      // cache: 'reload' memastikan yang disimpan adalah versi terbaru dari server.
      .then((c) => Promise.allSettled(ASSETS.map((u) => c.add(new Request(u, { cache: 'reload' })))))
      .then(() => self.skipWaiting())
  );
});

self.addEventListener('activate', (e) => {
  e.waitUntil(
    caches.keys()
      .then((keys) => Promise.all(keys.filter((k) => k !== CACHE).map((k) => caches.delete(k))))
      .then(() => self.clients.claim())
  );
});

self.addEventListener('fetch', (e) => {
  const req = e.request;
  const url = new URL(req.url);
  if (req.method !== 'GET' || url.origin !== self.location.origin) return;

  // Perantara API (API_BASE: '/sb') dan fungsi AI (/api/) jangan pernah disimpan: isinya percakapan dan butuh data terbaru.
  if (url.pathname.startsWith('/sb/') || url.pathname.startsWith('/api/')) return;

  // Halaman admin tidak boleh disimpan. Tanpa ini, tersimpan di kunci '/index.html' dan menimpa halaman utama saat offline.
  if (url.pathname === '/admin' || url.pathname === '/admin.html') return;

  // Halaman: coba internet dulu, kalau offline pakai salinan tersimpan.
  if (req.mode === 'navigate') {
    const key = url.pathname === '/privacy.html' ? '/privacy.html' : '/index.html';
    e.respondWith(
      fetch(req).then((res) => {
        if (res && res.ok) { const copy = res.clone(); caches.open(CACHE).then((c) => c.put(key, copy)); }
        return res;
      }).catch(() => caches.match(key))
    );
    return;
  }

  // File lain: tampilkan cache dulu, perbarui di latar belakang.
  e.respondWith(
    caches.match(req).then((hit) => {
      const net = fetch(req).then((res) => {
        if (res && res.ok) { const copy = res.clone(); caches.open(CACHE).then((c) => c.put(req, copy)); }
        return res;
      }).catch(() => hit);
      return hit || net;
    })
  );
});
