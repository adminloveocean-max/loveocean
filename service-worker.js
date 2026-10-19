// Naikkan angka versi ini setiap kali kamu mengunggah perubahan file, supaya cache lama dibuang.
const CACHE = 'love-ocean-v7';

// Harus sama dengan yang dimuat index.html dan css/theme-night.css (folder night/ ada di akar, sejajar dengan css/).
const NIGHT = [
  'sky.webp', 'island.png', 'ship.png', 'stars-a.webp', 'stars-b.webp', 'clouds-far.webp', 'clouds-near.webp',
  'sea-a.webp', 'sea-b.webp', 'sand.webp', 'swash.webp', 'starfish.png', 'shell1.png', 'shell2.png',
  'palm-left.png', 'palm-right.png', 'bottle-a.png', 'bottle-b.png'
].map((f) => '/night/' + f);

const ASSETS = [
  '/', '/index.html',
  '/css/style.css', '/css/mine.css', '/css/account.css', '/css/chat.css', '/css/theme-night.css',
  '/js/config.js', '/js/app.js', '/js/mine.js', '/js/account.js',
  '/privacy.html', '/css/privacy.css', '/manifest.json',
  '/icons/logoloveocean.png', '/icons/icon-512.png',
  ...NIGHT
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

  // Halaman admin tidak boleh disimpan (Cloudflare Pages mengalihkan /admin.html ke /admin).
  if (url.pathname === '/admin' || url.pathname === '/admin.html') return;

  // Halaman: internet dulu, kalau offline pakai salinan tersimpan.
  // Cloudflare Pages mengalihkan /privacy.html ke /privacy, jadi keduanya harus dikenali agar tidak menimpa halaman utama.
  if (req.mode === 'navigate') {
    const key = (url.pathname === '/privacy' || url.pathname === '/privacy.html') ? '/privacy.html' : '/index.html';
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
