// Naikkan angka versi ini setiap kali kamu mengunggah perubahan file, supaya cache lama dibuang.
const CACHE = 'love-ocean-v18';

const ASSETS = [
  '/', '/index.html',
  '/css/style.css', '/css/mine.css', '/css/account.css', '/css/chat.css', '/css/theme-day.css',
  '/js/config.js', '/js/app.js', '/js/mine.js', '/js/account.js', '/js/push.js',
  '/privacy.html', '/tentang.html', '/css/privacy.css', '/manifest.json',
  '/day/beach.webp',
  '/day/beach2.webp',
  '/icons/logoloveocean.png', '/icons/icon-192.png', '/icons/icon-512.png', '/icons/icon-maskable-512.png'
];

self.addEventListener('install', (e) => {
  e.waitUntil(
    caches.open(CACHE)
      // Satu per satu: file yang tidak ada tidak menggagalkan seluruh pemasangan.
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

const store = (req, res) => {
  if (res && res.ok && !res.redirected) { const copy = res.clone(); caches.open(CACHE).then((c) => c.put(req, copy)); }
  return res;
};

self.addEventListener('fetch', (e) => {
  const req = e.request;
  const url = new URL(req.url);
  if (req.method !== 'GET' || url.origin !== self.location.origin) return;

  // Perantara API (/sb/) dan fungsi AI (/api/) jangan pernah disimpan: isinya percakapan dan butuh data terbaru.
  if (url.pathname.startsWith('/sb/') || url.pathname.startsWith('/api/')) return;
  // Berkas pemeriksaan Android dan 404 selalu dari server.
  if (url.pathname.startsWith('/.well-known/') || url.pathname === '/404.html') return;

  // Halaman admin tidak boleh disimpan (Cloudflare Pages mengalihkan /admin.html ke /admin).
  if (url.pathname === '/admin' || url.pathname === '/admin.html') return;

  // Halaman: internet dulu, kalau offline pakai salinan tersimpan.
  // Cloudflare Pages mengalihkan /x.html ke /x, jadi keduanya harus dikenali agar tidak menimpa halaman utama.
  if (req.mode === 'navigate') {
    const PAGES = { '/privacy': '/privacy.html', '/privacy.html': '/privacy.html', '/tentang': '/tentang.html', '/tentang.html': '/tentang.html' };
    const key = PAGES[url.pathname] || '/index.html';
    e.respondWith(
      fetch(req).then((res) => store(key, res)).catch(() => caches.match(key))
    );
    return;
  }

  // CSS dan JS: internet dulu, supaya HTML baru tidak pernah dipasangkan dengan kode lama.
  if (/\.(?:css|js|json)$/.test(url.pathname)) {
    e.respondWith(
      fetch(req).then((res) => store(req, res)).catch(() => caches.match(req))
    );
    return;
  }

  // Gambar dan berkas lain: tampilkan cache dulu, perbarui di latar belakang.
  e.respondWith(
    caches.match(req).then((hit) => {
      const net = fetch(req).then((res) => store(req, res)).catch(() => hit);
      return hit || net;
    })
  );
});

/* ---------- notifikasi balasan (Web Push) ----------
   Pesan push sengaja kosong: isi balasan tidak pernah lewat layanan push. Teksnya ditetapkan di sini. */
self.addEventListener('push', (e) => {
  e.waitUntil((async () => {
    const wins = await self.clients.matchAll({ type: 'window', includeUncontrolled: true });
    // Aplikasi sedang terbuka dan terlihat: penanda balasan di dalam aplikasi sudah cukup.
    if (wins.some((c) => c.visibilityState === 'visible' && c.focused)) return;
    await self.registration.showNotification('Love Ocean', {
      body: 'Ada balasan baru di botolmu \uD83C\uDF0A',
      icon: '/icons/icon-192.png',
      tag: 'balasan',
      renotify: true,
      data: { url: '/?botolku=1' }
    });
  })());
});

self.addEventListener('notificationclick', (e) => {
  e.notification.close();
  e.waitUntil((async () => {
    const wins = await self.clients.matchAll({ type: 'window', includeUncontrolled: true });
    for (const c of wins) {
      if (new URL(c.url).origin === self.location.origin) {
        await c.focus();
        c.postMessage({ type: 'open-mine' });
        return;
      }
    }
    await self.clients.openWindow('/?botolku=1');
  })());
});
