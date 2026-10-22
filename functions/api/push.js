// Cloudflare Pages Function: POST /api/push
// LETAK BERKAS: functions/api/push.js di akar proyek (sejajar dengan review.js).
// Dipanggil aplikasi sesaat setelah seseorang mengirim balasan. Fungsi ini memeriksa ke database siapa lawan bicaranya,
// lalu mengirim Web Push KOSONG (tanpa isi pesan) ke perangkat lawan bicara. Service worker yang menampilkan teksnya.
//
// Pengaturan di Cloudflare Pages (Settings > Variables and Secrets):
//   SUPABASE_URL, SUPABASE_SERVICE_KEY   (sudah ada untuk review.js)
//   VAPID_PUBLIC_KEY                     (teks biasa; sama dengan yang di js/config.js)
//   VAPID_PRIVATE_KEY                    (WAJIB Secret/terenkripsi)
//   VAPID_SUBJECT                        (opsional, contoh: https://loveocean.web.id)
// Setelah menambah variabel, deploy ulang.

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
// Hanya layanan push resmi browser. Mencegah fungsi ini dipakai untuk menembak alamat sembarang.
const PUSH_HOSTS = [
  /^fcm\.googleapis\.com$/,
  /^updates\.push\.services\.mozilla\.com$/,
  /\.push\.services\.mozilla\.com$/,
  /^web\.push\.apple\.com$/,
  /\.push\.apple\.com$/,
  /\.notify\.windows\.com$/
];
const MAX_AGE_MS = 5 * 60 * 1000; // balasan yang boleh dinotifikasikan: maksimal 5 menit lalu

const te = new TextEncoder();
const reply = (obj, status = 200) =>
  new Response(JSON.stringify(obj), { status, headers: { 'Content-Type': 'application/json', 'Cache-Control': 'no-store' } });

const b64uToBytes = (s) => {
  s = String(s).replace(/-/g, '+').replace(/_/g, '/');
  while (s.length % 4) s += '=';
  const bin = atob(s);
  const out = new Uint8Array(bin.length);
  for (let i = 0; i < bin.length; i++) out[i] = bin.charCodeAt(i);
  return out;
};
const bytesToB64u = (buf) => {
  const a = new Uint8Array(buf);
  let bin = '';
  for (let i = 0; i < a.length; i++) bin += String.fromCharCode(a[i]);
  return btoa(bin).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');
};

async function signingKey(env) {
  const pub = b64uToBytes(env.VAPID_PUBLIC_KEY);
  if (pub.length !== 65 || pub[0] !== 4) throw new Error('VAPID_PUBLIC_KEY tidak valid');
  const jwk = {
    kty: 'EC', crv: 'P-256', ext: true,
    d: env.VAPID_PRIVATE_KEY,
    x: bytesToB64u(pub.slice(1, 33)),
    y: bytesToB64u(pub.slice(33, 65))
  };
  return crypto.subtle.importKey('jwk', jwk, { name: 'ECDSA', namedCurve: 'P-256' }, false, ['sign']);
}

// Header Authorization VAPID (RFC 8292). WebCrypto menghasilkan tanda tangan r||s 64 byte, sesuai format JWT ES256.
async function vapidHeader(env, key, endpoint) {
  const head = bytesToB64u(te.encode(JSON.stringify({ typ: 'JWT', alg: 'ES256' })));
  const claims = bytesToB64u(te.encode(JSON.stringify({
    aud: new URL(endpoint).origin,
    exp: Math.floor(Date.now() / 1000) + 12 * 3600,
    sub: env.VAPID_SUBJECT || 'https://loveocean.web.id'
  })));
  const data = head + '.' + claims;
  const sig = await crypto.subtle.sign({ name: 'ECDSA', hash: 'SHA-256' }, key, te.encode(data));
  return 'vapid t=' + data + '.' + bytesToB64u(sig) + ', k=' + env.VAPID_PUBLIC_KEY;
}

const hostOk = (endpoint) => {
  try {
    const u = new URL(endpoint);
    return u.protocol === 'https:' && PUSH_HOSTS.some((re) => re.test(u.hostname));
  } catch (e) { return false; }
};

export async function onRequestPost({ request, env }) {
  if (!env.SUPABASE_URL || !env.SUPABASE_SERVICE_KEY || !env.VAPID_PUBLIC_KEY || !env.VAPID_PRIVATE_KEY) {
    return reply({ ok: false, error: 'belum_diatur' }, 500);
  }
  const base = env.SUPABASE_URL.replace(/\/$/, '');
  const key = env.SUPABASE_SERVICE_KEY;
  const sb = (path, opt = {}) => fetch(base + path, {
    method: opt.method || 'GET',
    body: opt.body,
    headers: Object.assign({ apikey: key, Authorization: 'Bearer ' + key, 'Content-Type': 'application/json' }, opt.headers || {})
  });
  const rows = async (res) => { const j = await res.json().catch(() => []); return Array.isArray(j) ? j : []; };

  // 1. Siapa yang memanggil? Token dicek langsung ke Supabase.
  const token = (request.headers.get('Authorization') || '').replace(/^Bearer\s+/i, '');
  if (!token) return reply({ ok: false, error: 'tidak_boleh' }, 401);
  const ures = await fetch(base + '/auth/v1/user', { headers: { apikey: key, Authorization: 'Bearer ' + token } });
  if (!ures.ok) return reply({ ok: false, error: 'tidak_boleh' }, 401);
  const user = await ures.json().catch(() => null);
  if (!user || !user.id) return reply({ ok: false, error: 'tidak_boleh' }, 401);

  let body = {};
  try { body = await request.json(); } catch (e) { /* kosong */ }
  if (!UUID.test(body.bottle_id || '')) return reply({ ok: false, error: 'tidak_valid' }, 400);

  // 2. Balasan terbaru milik pemanggil di botol ini. Harus baru, belum dihapus.
  const rep = (await rows(await sb('/rest/v1/replies?select=id,created_at,deleted_at&bottle_id=eq.' + body.bottle_id +
    '&author=eq.' + user.id + '&order=created_at.desc&limit=1')))[0];
  if (!rep || rep.deleted_at || Date.now() - Date.parse(rep.created_at) > MAX_AGE_MS) return reply({ ok: true, skipped: 'tidak_ada_balasan_baru' });

  // 3. Siapa lawan bicaranya?
  const bottle = (await rows(await sb('/rest/v1/bottles?select=author,caught_by,hidden&id=eq.' + body.bottle_id)))[0];
  if (!bottle || bottle.hidden || !bottle.caught_by) return reply({ ok: true, skipped: 'botol_tidak_aktif' });
  if (user.id !== bottle.author && user.id !== bottle.caught_by) return reply({ ok: false, error: 'tidak_boleh' }, 403);
  const to = user.id === bottle.author ? bottle.caught_by : bottle.author;

  // 4. Hormati blokir dan botol yang disembunyikan oleh penerima.
  const [blk, hid] = await Promise.all([
    rows(await sb('/rest/v1/user_blocks?select=blocker&blocker=eq.' + to + '&blocked=eq.' + user.id)),
    rows(await sb('/rest/v1/bottle_hidden?select=user_id&user_id=eq.' + to + '&bottle_id=eq.' + body.bottle_id))
  ]);
  if (blk.length || hid.length) return reply({ ok: true, skipped: 'diblokir' });

  // 5. Klaim satu kali per balasan.
  const claim = await rows(await sb('/rest/v1/push_sent', {
    method: 'POST',
    headers: { Prefer: 'resolution=ignore-duplicates,return=representation' },
    body: JSON.stringify({ reply_id: rep.id })
  }));
  if (!claim.length) return reply({ ok: true, skipped: 'sudah_dikirim' });

  // 6. Kirim ke semua perangkat penerima. Perangkat yang sudah tidak berlaku (404/410) dihapus.
  const subs = await rows(await sb('/rest/v1/push_subs?select=endpoint&user_id=eq.' + to + '&limit=5'));
  if (!subs.length) return reply({ ok: true, sent: 0 });
  let signer;
  try { signer = await signingKey(env); } catch (e) { return reply({ ok: false, error: 'kunci_vapid_salah' }, 500); }

  let sent = 0;
  await Promise.all(subs.map(async (s) => {
    if (!hostOk(s.endpoint)) { await sb('/rest/v1/push_subs?endpoint=eq.' + encodeURIComponent(s.endpoint), { method: 'DELETE' }); return; }
    try {
      const res = await fetch(s.endpoint, {
        method: 'POST',
        headers: {
          Authorization: await vapidHeader(env, signer, s.endpoint),
          TTL: '86400',
          Urgency: 'normal',
          Topic: 'balasan' // beberapa balasan beruntun yang belum sampai digabung jadi satu
        }
      });
      if (res.status === 404 || res.status === 410) {
        await sb('/rest/v1/push_subs?endpoint=eq.' + encodeURIComponent(s.endpoint), { method: 'DELETE' });
      } else if (res.ok) sent++;
    } catch (e) { /* abaikan: perangkat lain tetap dicoba */ }
  }));
  return reply({ ok: true, sent });
}
