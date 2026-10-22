(() => {
  'use strict';

  const CFG = window.LO_CONFIG || {};
  // Dua cara menyambung: langsung ke Supabase (SUPABASE_URL + SUPABASE_KEY), atau lewat perantara
  // Cloudflare di alamat yang sama (API_BASE: '/sb'), sehingga URL dan kunci tidak ada di browser.
  const PROXY = !!CFG.API_BASE;
  const BASE = (PROXY ? CFG.API_BASE : CFG.SUPABASE_URL || '').replace(/\/$/, '');
  const KEY = PROXY ? '' : (CFG.SUPABASE_KEY || '');
  const CONFIGURED = PROXY || !!(CFG.SUPABASE_URL && CFG.SUPABASE_KEY && !/GANTI/.test(CFG.SUPABASE_URL + CFG.SUPABASE_KEY));
  const withKey = (h) => (KEY ? Object.assign({ apikey: KEY }, h) : h);
  const MAX = 280;
  // Kunci sesi dan nama tetap sama dengan versi sebelumnya supaya akun anonim lama tetap terbaca.
  const K = {
    session: 'loveocean.session.v2', name: 'loveocean.nick.v2', seen: 'loveocean.seen.v2',
    draft: 'loveocean.draft.v3', welcome: 'loveocean.welcome.v3', sound: 'loveocean.sound.v3', age: 'loveocean.age.v1'
  };
  const $ = (s) => document.querySelector(s);

  const MOODS = {
    cinta:    { label: 'Cinta',    color: '#ff5f84' },
    rindu:    { label: 'Rindu',    color: '#a98bff' },
    semangat: { label: 'Semangat', color: '#ffb347' },
    syukur:   { label: 'Syukur',   color: '#4fd8b5' },
    curhat:   { label: 'Curhat',   color: '#6fb7ff' }
  };
  const moodOf = (k) => MOODS[k] || MOODS.cinta;

  // Posisi botol di laut: l = kiri (%), t = jarak dari cakrawala (% tinggi laut). Yang lebih jauh tampil lebih kecil.
  const SLOTS = [
    { l: 8, t: 8 }, { l: 66, t: 5 }, { l: 36, t: 20 }, { l: 12, t: 34 }, { l: 60, t: 32 }, { l: 82, t: 18 }
  ];

  const ERR = {
    tautan_dilarang: 'Nama panggilan tidak boleh berisi tautan, akun media sosial, email, atau nomor telepon.',
    terlalu_cepat: 'Pelan-pelan dulu. Tunggu beberapa detik lalu coba lagi.',
    limit_botol: 'Kamu sudah melempar 10 botol dalam 24 jam. Coba lagi besok.',
    limit_balasan: 'Terlalu banyak balasan dalam satu jam. Coba lagi nanti.',
    limit_harian: 'Kamu sudah mengambil 15 botol hari ini. Coba lagi besok.',
    percakapan_penuh: 'Percakapan ini sudah mencapai 100 balasan.',
    limit_laporan: 'Terlalu banyak laporan atau blokir hari ini. Coba lagi besok.',
    limit_lepas: 'Kamu terlalu sering melepas botol hari ini. Coba lagi besok.',
    percakapan_ditutup: 'Percakapan ini sudah ditutup. Pesan tidak bisa dikirim.',
    bottles_message_len: 'Pesan harus berisi 1 sampai 280 karakter.',
    replies_message_len: 'Pesan harus berisi 1 sampai 280 karakter.',
    pesan_kosong: 'Pesan tidak boleh kosong.',
    tidak_boleh: 'Aksi ini tidak diizinkan untuk botol tersebut.'
  };

  /* ---------- util ---------- */
  // Toast memakai popover supaya tampil di atas dialog modal (lapisan teratas browser).
  let toastTimer, toastHide;
  function toast(msg, ms) {
    const t = $('#toast');
    t.textContent = msg;
    clearTimeout(toastTimer); clearTimeout(toastHide);
    // Buka ulang setiap kali: dialog yang dibuka setelah toast sebelumnya akan menutupinya, dan ini memindahkannya ke lapisan teratas lagi.
    try { if (t.showPopover) { if (t.matches(':popover-open')) t.hidePopover(); t.showPopover(); } } catch (e) { /* abaikan */ }
    void t.offsetWidth;
    t.classList.add('show');
    toastTimer = setTimeout(() => {
      t.classList.remove('show');
      toastHide = setTimeout(() => { try { if (t.hidePopover && t.matches(':popover-open')) t.hidePopover(); } catch (e) { /* abaikan */ } }, 300);
    }, ms || 3400);
  }
  function lsGet(k, def) { try { const v = localStorage.getItem(k); return v ? JSON.parse(v) : def; } catch (e) { return def; } }
  function lsSet(k, v) { try { localStorage.setItem(k, JSON.stringify(v)); } catch (e) { /* abaikan */ } }
  function lsDel(k) { try { localStorage.removeItem(k); } catch (e) { /* abaikan */ } }
  function ago(ts) {
    const s = Math.max(0, (Date.now() - Date.parse(ts)) / 1000);
    if (s < 60) return 'baru saja';
    if (s < 3600) return Math.floor(s / 60) + ' menit lalu';
    if (s < 86400) return Math.floor(s / 3600) + ' jam lalu';
    try { return new Date(ts).toLocaleDateString('id-ID', { day: 'numeric', month: 'short' }); } catch (e) { return ''; }
  }
  function openDlg(d) { if (!d.open) d.showModal(); }
  function vib(ms) { try { if (navigator.vibrate) navigator.vibrate(ms); } catch (e) { /* abaikan */ } }
  function human(e) {
    const m = (e && e.message) || '';
    for (const k in ERR) if (m.indexOf(k) !== -1) return ERR[k];
    if (!navigator.onLine) return 'Kamu sedang offline. Sambungkan internet lalu coba lagi.';
    return 'Terjadi masalah saat menghubungi server. Coba lagi sebentar lagi.';
  }
  function el(tag, cls, text) {
    const n = document.createElement(tag);
    if (cls) n.className = cls;
    if (text != null) n.textContent = text;
    return n;
  }
  const SVGNS = 'http://www.w3.org/2000/svg';
  function useSvg(id, viewBox) {
    const s = document.createElementNS(SVGNS, 'svg');
    s.setAttribute('viewBox', viewBox);
    s.setAttribute('aria-hidden', 'true');
    const u = document.createElementNS(SVGNS, 'use');
    u.setAttribute('href', '#' + id);
    s.appendChild(u);
    return s;
  }
  function moodDot(key) {
    const d = el('span', 'mdot');
    d.style.setProperty('--mood', moodOf(key).color);
    return d;
  }
  // Penjelasan penyebab gagal tersambung, supaya pemilik tahu apa yang harus diperbaiki.
  function diagnose(e) {
    const m = ((e && e.message) || '') + ' ' + ((e && e.code) || '');
    if (!navigator.onLine) return 'Kamu sedang offline. Sambungkan internet lalu coba lagi.';
    if (/anonymous sign-ins are disabled|anonymous.*disabled/i.test(m)) return 'Masuk anonim belum diaktifkan di Supabase (Authentication > Sign In / Providers > Allow anonymous sign-ins).';
    if (/proxy belum dikonfigurasi/i.test(m)) return 'Perantara belum diatur: isi SUPABASE_URL dan SUPABASE_KEY di pengaturan Cloudflare Pages, lalu deploy ulang.';
    if (/PGRST202|could not find the function/i.test(m)) return 'Database belum diperbarui. Jalankan supabase/schema.sql di SQL Editor Supabase.';
    if (/42501|permission denied/i.test(m)) return 'Hak akses database belum sesuai. Jalankan ulang supabase/schema.sql.';
    if (/invalid api key|no api key|apikey/i.test(m) || (e && (e.status === 401 || e.status === 403))) return PROXY ? 'Perantara Cloudflare menolak. Periksa variabel SUPABASE_URL dan SUPABASE_KEY di pengaturan Cloudflare Pages.' : 'Kunci Supabase di config.js tidak diterima. Periksa SUPABASE_URL dan SUPABASE_KEY.';
    if (e && e.name === 'AbortError') return 'Server terlalu lama menjawab. Coba lagi sebentar lagi.';
    if (e && e.name === 'TypeError') return PROXY ? 'Server tidak bisa dijangkau. Periksa koneksi, lalu coba lagi.' : 'Supabase tidak bisa dijangkau. Periksa SUPABASE_URL di config.js, dan pastikan project tidak sedang dijeda (paused).';
    return human(e);
  }
  const locks = new Set();
  async function once(name, fn) {
    if (locks.has(name)) return;
    locks.add(name);
    try { return await fn(); } finally { locks.delete(name); }
  }

  /* ---------- sesi anonim (tanpa library) ---------- */
  let session = lsGet(K.session, null);
  let sessionJob = null;
  const isFresh = (x) => !!(x && x.access_token && x.expires_at * 1000 - Date.now() > 60000);
  const isEmailAccount = (x) => !!(x && x.user && x.user.email && x.user.is_anonymous !== true);
  // Satu pembaruan sesi pada satu waktu di semua tab dan jendela (token penyegar hanya bisa dipakai sekali).
  async function withLock(fn) {
    if (navigator.locks && navigator.locks.request) return navigator.locks.request('loveocean-session', fn);
    return fn();
  }
  // Tab lain memperbarui sesi: ikuti, jangan membuat akun sendiri.
  window.addEventListener('storage', (e) => { if (e.key === K.session) session = lsGet(K.session, null); });

  async function authCall(path, body) {
    const res = await fetch(BASE + '/auth/v1/' + path, {
      method: 'POST',
      headers: withKey({ 'Content-Type': 'application/json' }),
      body: JSON.stringify(body)
    });
    const data = await res.json().catch(() => ({}));
    if (!res.ok || !data.access_token) {
      const err = new Error(data.msg || data.error_description || data.message || 'auth_gagal');
      err.status = res.status;
      throw err;
    }
    return data;
  }
  function ensureSession() {
    if (isFresh(session)) return Promise.resolve(session);
    if (sessionJob) return sessionJob;
    sessionJob = withLock(async () => {
      // Saat menunggu giliran, tab lain mungkin sudah memperbarui sesi.
      const stored = lsGet(K.session, null);
      if (isFresh(stored)) { session = stored; return session; }
      let base = stored && stored.refresh_token ? stored : session;
      const before = base;
      for (let attempt = 0; base && base.refresh_token && attempt < 2; attempt++) {
        try {
          session = await authCall('token?grant_type=refresh_token', { refresh_token: base.refresh_token });
          lsSet(K.session, session);
          return session;
        } catch (e) {
          // Gangguan jaringan atau server tidak boleh mengganti akun.
          if (!navigator.onLine || ![400, 401, 403, 404, 422].includes(e.status)) throw e;
          // Ditolak: mungkin tab lain baru saja memutar token. Periksa penyimpanan sebelum menyerah.
          const again = lsGet(K.session, null);
          if (isFresh(again)) { session = again; return session; }
          if (again && again.refresh_token && again.refresh_token !== base.refresh_token) { base = again; continue; }
          break;
        }
      }
      // Server jelas menolak sesi lama: buat akun anonim baru.
      const hadEmail = isEmailAccount(before) || isEmailAccount(session);
      session = await authCall('signup', {});
      lsSet(K.session, session);
      if (hadEmail) setTimeout(() => toast('Sesi akunmu berakhir. Masuk lagi dengan email (tombol i) untuk membuka botolmu.', 7000), 300);
      return session;
    }).finally(() => { sessionJob = null; });
    return sessionJob;
  }
  async function api(path, opt, retry) {
    opt = opt || {};
    const s = await ensureSession();
    const ctl = new AbortController();
    const timer = setTimeout(() => ctl.abort(), 15000);
    let res;
    try {
      res = await fetch(BASE + path, {
        method: opt.method || 'GET',
        signal: ctl.signal,
        headers: withKey({
          Authorization: 'Bearer ' + s.access_token,
          'Content-Type': 'application/json',
          Prefer: 'return=representation'
        }),
        body: opt.body ? JSON.stringify(opt.body) : undefined
      });
    } finally { clearTimeout(timer); }
    const txt = await res.text();
    let data = null;
    try { data = txt ? JSON.parse(txt) : null; } catch (e) { /* bukan JSON */ }
    if (res.status === 401 && retry !== false) { if (session) session.expires_at = 0; return api(path, opt, false); } // paksa refresh token dulu
    if (!res.ok) {
      const err = new Error((data && (data.message || data.msg)) || res.statusText);
      err.status = res.status;
      err.code = data && data.code;
      throw err;
    }
    return data;
  }
  const rpc = (name, body) => api('/rest/v1/rpc/' + name, { method: 'POST', body: body || {} });
  const myId = () => (session && session.user && session.user.id) || '';

  // Panggilan ke endpoint auth (dipakai js/account.js): PUT user, POST otp, POST verify, dll.
  async function authReq(method, path, body, withToken) {
    const headers = withKey({ 'Content-Type': 'application/json' });
    if (withToken) { const s = await ensureSession(); headers.Authorization = 'Bearer ' + s.access_token; }
    const res = await fetch(BASE + '/auth/v1/' + path, { method, headers, body: body ? JSON.stringify(body) : undefined });
    const txt = await res.text();
    let data = null;
    try { data = txt ? JSON.parse(txt) : null; } catch (e) { /* bukan JSON */ }
    if (!res.ok) {
      const err = new Error((data && (data.msg || data.message || data.error_description)) || res.statusText);
      err.status = res.status;
      err.code = data && (data.error_code || data.code);
      throw err;
    }
    return data;
  }

  /* ---------- laut ---------- */
  let sea = { count: 0, moods: [] };
  let seaKey = '';

  function setStatus(ok, text) {
    $('#seaInfo').classList.toggle('off', !ok);
    $('#seaText').textContent = text;
  }
  function renderSea() {
    const info = sea.count > 0
      ? sea.count + ' botol sedang mengapung di laut.'
      : 'Laut sedang sepi. Lempar botol pertamamu supaya orang lain bisa menemukannya.';
    setStatus(true, info);

    const key = sea.moods.join(',');
    if (key === seaKey) return;
    seaKey = key;
    const box = $('#bottles');
    box.textContent = '';
    sea.moods.slice(0, SLOTS.length).forEach((mood, i) => {
      const p = SLOTS[i];
      const m = moodOf(mood);
      const b = el('button', 'bottle');
      b.type = 'button';
      b.style.setProperty('--l', p.l + '%');
      b.style.top = p.t + '%';
      b.style.setProperty('--mood', m.color);
      b.style.setProperty('--s', (0.7 + p.t / 100 * 0.9).toFixed(2));
      b.style.setProperty('--dur', (8 + (i * 1.7) % 6).toFixed(1) + 's');
      b.style.setProperty('--dur2', (5 + (i * 0.9) % 3).toFixed(1) + 's');
      b.style.setProperty('--delay', '-' + ((i * 2.3) % 7).toFixed(1) + 's');
      b.setAttribute('aria-label', 'Ambil botol bersuasana ' + m.label.toLowerCase());
      b.appendChild(el('span', 'shadow'));
      const sway = el('span', 'sway');
      sway.appendChild(useSvg('bottle', '0 0 150 56'));
      b.appendChild(sway);
      b.appendChild(el('span', 'water'));
      b.addEventListener('click', () => { b.classList.add('catching'); vib(12); take(mood, b); });
      box.appendChild(b);
    });
  }
  async function refreshSea() {
    try {
      const v = await rpc('sea_view');
      sea = { count: Number(v && v.count) || 0, moods: Array.isArray(v && v.moods) ? v.moods : [] };
      renderSea();
    } catch (e) { setStatus(false, 'Belum tersambung ke server. ' + diagnose(e)); }
  }

  /* ---------- botolku & penanda balasan baru ---------- */
  let myBottles = [];
  let myReplyMeta = [];
  const seen = lsGet(K.seen, {});

  function unreadFor(bid) {
    const last = seen[bid] || 0;
    return myReplyMeta.filter((r) => r.bottle_id === bid && !r.deleted_at && r.author !== myId() && Date.parse(r.created_at) > last).length;
  }
  function markSeen(bid) { seen[bid] = Date.now(); lsSet(K.seen, seen); updateBadge(); }
  const BASE_TITLE = document.title; // judul asli dari index.html (dipakai SEO), hanya diberi awalan jumlah balasan
  function updateBadge() {
    let total = 0;
    myBottles.forEach((b) => { total += unreadFor(b.id); });
    const bd = $('#badge');
    bd.textContent = total > 9 ? '9+' : total;
    bd.hidden = total === 0;
    document.title = total ? '(' + total + ') ' + BASE_TITLE : BASE_TITLE;
  }
  const DAY = 86400000;
  const daysLeft = (from, days) => Math.max(0, Math.ceil((Date.parse(from) + days * DAY - Date.now()) / DAY));
  // Status dan riwayat satu botol, dipakai di daftar Botolku dan di dalam botol.
  function statusOf(b) {
    const mine = b.author === myId();
    const n = Number(b.release_count) || 0;
    if (b.hidden) return { label: 'Sedang ditinjau', detail: 'Botol ini disembunyikan dari laut sampai peninjauan selesai.' };
    if (mine && !b.caught_by) {
      const left = ' Hilang otomatis dalam ' + daysLeft(b.created_at, 14) + ' hari.';
      return n > 0
        ? { label: 'Hanyut lagi', detail: 'Botolmu pernah ditemukan lalu dilepas kembali' + (n > 1 ? ' (' + n + ' kali)' : '') + ', dan kini hanyut lagi. Percakapan sebelumnya dihapus.' + left }
        : { label: 'Hanyut', detail: 'Botolmu masih hanyut dan belum ditemukan.' + left };
    }
    if (mine) {
      return { label: 'Ditemukan', detail: 'Seseorang menemukan botolmu. Percakapan hanya terlihat olehmu dan dia. Hilang otomatis dalam ' + daysLeft(b.caught_at || b.created_at, 30) + ' hari.' };
    }
    const replied = myReplyMeta.some((r) => r.bottle_id === b.id);
    return replied
      ? { label: 'Percakapan', detail: 'Percakapan hanya terlihat olehmu dan pembuat botol. Hilang otomatis dalam ' + daysLeft(b.caught_at || b.created_at, 30) + ' hari.' }
      : { label: 'Kamu menemukan', detail: 'Balas dalam ' + daysLeft(b.caught_at || b.created_at, 3) + ' hari, atau botol ini kembali hanyut ke laut.' };
  }
  async function loadMine() {
    myBottles = await api('/rest/v1/bottles?select=*&order=created_at.desc&limit=100');
    myReplyMeta = await api('/rest/v1/replies?select=bottle_id,author,nickname,message,created_at,deleted_at&order=created_at.desc&limit=300');
    updateBadge();
  }

  /* ---------- tombol sibuk dan peringatan kontak ---------- */
  function setBusy(btn, on) {
    btn.disabled = on;
    btn.classList.toggle('is-busy', on);
    btn.setAttribute('aria-busy', String(on));
  }
  // Tautan, nomor telepon, atau akun media sosial: tampilkan peringatan sebelum mengirim.
  const CONTACT = /(https?:\/\/|www\.|\b[a-z0-9-]+\.(?:com|net|org|id|my|co|io|me|xyz|link|app|info|site|online)\b|@[a-z0-9_.]{3,}|(?:\d[ .\-()]{0,2}){9,}|\b(?:whatsapp|telegram|instagram|tiktok|wa|ig)\b)/i;
  function confirmContact(text) {
    if (!CONTACT.test(text)) return Promise.resolve(true);
    return new Promise((resolve) => {
      const d = $('#dlgWarn');
      let result = false;
      const send = () => { result = true; d.close(); };
      const edit = () => { result = false; d.close(); };
      $('#warnSend').addEventListener('click', send, { once: true });
      $('#warnEdit').addEventListener('click', edit, { once: true });
      d.addEventListener('close', () => {
        $('#warnSend').removeEventListener('click', send);
        $('#warnEdit').removeEventListener('click', edit);
        resolve(result);
      }, { once: true });
      openDlg(d);
    });
  }

  /* ---------- lempar satu ---------- */
  const mood = 'cinta'; // pilihan suasana dihilangkan dari tampilan; semua botol memakai 'cinta'
  function saveDraft() { lsSet(K.draft, { text: $('#inMsg').value, name: $('#inName').value }); }
  function updateCount() {
    const n = $('#inMsg').value.length;
    const c = $('#count');
    c.textContent = n + ' / ' + MAX;
    c.classList.toggle('warn', n >= MAX - 30);
  }
  function openThrow() {
    if (window.LOMine) window.LOMine.close();
    const d = lsGet(K.draft, {});
    $('#inName').value = d.name != null ? d.name : lsGet(K.name, '');
    $('#inMsg').value = d.text || '';
    updateCount();
    openDlg($('#dlgThrow'));
  }
  function flyBottle(key) {
    const scene = $('.scene');
    const tx = Math.round((Math.random() * 2 - 1) * 70);
    const b = el('div', 'thrown');
    b.style.setProperty('--mood', moodOf(key).color);
    b.style.setProperty('--tx', tx + 'px');
    b.appendChild(useSvg('bottle', '0 0 150 56'));
    const ring = el('div', 'ring');
    ring.style.left = 'calc(50% + ' + tx + 'px)';
    scene.appendChild(b);
    scene.appendChild(ring);
    setTimeout(() => { b.remove(); ring.remove(); }, 4600);
  }
  function doThrow() {
    return once('throw', async () => {
      const text = $('#inMsg').value.trim();
      const name = $('#inName').value.trim().slice(0, 30);
      if (!text) { toast('Tulis pesanmu dulu sebelum melempar botol.'); $('#inMsg').focus(); return; }
      if (text.length > MAX) { toast('Pesan terlalu panjang. Maksimal ' + MAX + ' karakter.'); return; }
      if (!(await confirmContact(text))) { $('#inMsg').focus(); return; }
      const btn = $('#doThrow');
      setBusy(btn, true);
      try {
        await api('/rest/v1/bottles', { method: 'POST', body: { nickname: name, message: text, mood } });
        lsSet(K.name, name);
        lsDel(K.draft);
        $('#dlgThrow').close();
        vib([10, 40, 10]);
        flyBottle(mood);
        toast('Botolmu hanyut ke laut. Jika ada yang menemukannya, balasan muncul di Botolku.', 4800);
        loadMine().catch(() => {});
        refreshSea();
      } catch (e) { toast(diagnose(e), 5000); }
      finally { setBusy(btn, false); }
    });
  }

  /* ---------- satu botol ---------- */
  let cur = null;
  let pollTimer = null;

  let threadSig = '';
  let editing = null;
  let msgMenu = null;

  function dayKey(ts) { const d = new Date(ts); return d.getFullYear() + '-' + d.getMonth() + '-' + d.getDate(); }
  function dayLabel(ts) {
    const d = new Date(ts), now = new Date();
    const diff = Math.round((new Date(now.getFullYear(), now.getMonth(), now.getDate()) - new Date(d.getFullYear(), d.getMonth(), d.getDate())) / 86400000);
    if (diff === 0) return 'Hari ini';
    if (diff === 1) return 'Kemarin';
    try {
      return d.toLocaleDateString('id-ID', { day: 'numeric', month: 'long', year: d.getFullYear() === now.getFullYear() ? undefined : 'numeric' });
    } catch (e) { return ''; }
  }
  function clock(ts) {
    try { return new Date(ts).toLocaleTimeString('id-ID', { hour: '2-digit', minute: '2-digit' }); } catch (e) { return ''; }
  }
  function nearBottom() {
    const s = $('#bScroll');
    return !s || s.scrollHeight - s.scrollTop - s.clientHeight < 80;
  }
  function closeMsgMenu() { if (msgMenu) { msgMenu.remove(); msgMenu = null; } }
  async function copyText(s) {
    try { await navigator.clipboard.writeText(s); toast('Pesan disalin.', 1800); }
    catch (e) { toast('Pesan tidak bisa disalin di perangkat ini.'); }
  }
  // Bilah di atas kolom ketik: "Mengubah pesan" atau "Membalas ...".
  function ensureBar(id, text, onCancel) {
    let bar = $('#' + id);
    if (bar) return bar;
    bar = el('div', 'editbar');
    bar.id = id;
    bar.hidden = true;
    const x = el('button', 'editbar-x', 'Batal');
    x.type = 'button';
    x.addEventListener('click', onCancel);
    bar.appendChild(el('span', 'editbar-t', text));
    bar.appendChild(x);
    const box = $('#bReplyBox');
    box.insertBefore(bar, box.firstChild);
    return bar;
  }
  const ensureEditBar = () => ensureBar('editBar', 'Mengubah pesan', cancelEdit);
  const ensureQuoteBar = () => ensureBar('quoteBar', '', cancelReply);

  let replyTo = null; // pesan yang sedang dibalas (kutipan)
  const whoOf = (r) => (r.author === myId() ? 'Kamu' : (r.nickname || 'Anonim'));
  const previewOf = (r) => (r.deleted_at ? 'Pesan dihapus' : String(r.message || '').replace(/\s+/g, ' ').slice(0, 80));

  function startReply(r) {
    if (editing) cancelEdit();
    replyTo = r;
    const bar = ensureQuoteBar();
    bar.firstChild.textContent = 'Membalas ' + whoOf(r) + ': ' + previewOf(r);
    bar.hidden = false;
    $('#inReply').focus();
  }
  function cancelReply() {
    replyTo = null;
    const bar = $('#quoteBar');
    if (bar) bar.hidden = true;
  }
  function startEdit(r) {
    cancelReply();
    editing = r;
    ensureEditBar().hidden = false;
    const t = $('#inReply');
    t.value = r.message;
    $('#countR').textContent = r.message.length + ' / ' + MAX;
    $('#doReply').setAttribute('aria-label', 'Simpan perubahan');
    growReply();
    t.focus();
  }
  function cancelEdit() {
    editing = null;
    const bar = $('#editBar');
    if (bar) bar.hidden = true;
    $('#inReply').value = '';
    $('#countR').textContent = '0 / ' + MAX;
    $('#doReply').setAttribute('aria-label', 'Kirim balasan');
    growReply();
  }
  // Hapus untuk semua: isi pesan dikosongkan di server, kedua pihak melihat "Pesan dihapus".
  async function removeReply(r) {
    try {
      await rpc('delete_reply', { p_id: r.id });
      if (editing && editing.id === r.id) cancelEdit();
      toast('Pesan dihapus.', 1800);
      await loadReplies();
      loadMine().catch(() => {});
    } catch (e) { toast(diagnose(e), 5000); }
  }
  // Hapus untuk saya: pesan (termasuk milik lawan bicara atau yang sudah "dihapus") hilang dari tampilanmu saja.
  async function hideReplyForMe(r) {
    try {
      await rpc('hide_reply', { p_id: r.id });
      if (editing && editing.id === r.id) cancelEdit();
      if (replyTo && replyTo.id === r.id) cancelReply();
      toast('Pesan dihapus dari tampilanmu.', 1800);
      await loadReplies();
      loadMine().catch(() => {});
    } catch (e) { toast(diagnose(e), 5000); }
  }
  function showMsgMenu(row, r, mine) {
    if (msgMenu && msgMenu.previousElementSibling === row) { closeMsgMenu(); return; }
    closeMsgMenu();
    const gone = !!r.deleted_at;
    const m = el('div', 'msgmenu ' + (mine ? 'me' : 'them'));
    m.setAttribute('role', 'menu');
    m.addEventListener('click', (e) => e.stopPropagation());
    const add = (label, cls, fn) => {
      const b = el('button', 'mm' + (cls ? ' ' + cls : ''), label);
      b.type = 'button';
      b.setAttribute('role', 'menuitem');
      b.addEventListener('click', () => fn(b));
      m.appendChild(b);
    };
    // tombol dua langkah supaya tidak terhapus tidak sengaja
    const twoStep = (label, fn) => add(label, 'danger', (b) => {
      if (!b.dataset.armed) { b.dataset.armed = '1'; b.textContent = 'Yakin?'; return; }
      closeMsgMenu();
      fn();
    });
    if (!gone) {
      if (!$('#bReplyBox').hidden) add('Balas', '', () => { closeMsgMenu(); startReply(r); });
      add('Salin', '', () => { closeMsgMenu(); copyText(r.message); });
      if (mine) {
        add('Ubah', '', () => { closeMsgMenu(); startEdit(r); });
        twoStep('Hapus untuk semua', () => removeReply(r));
      }
    }
    twoStep(gone ? 'Hapus dari tampilan' : 'Hapus untuk saya', () => hideReplyForMe(r));
    row.after(m);
    msgMenu = m;
  }
  // Kutipan di dalam gelembung. Ketuk untuk melompat ke pesan aslinya.
  function quoteBlock(q) {
    const box = el('div', 'quote');
    if (!q) { box.classList.add('gone'); box.appendChild(el('span', 'q-t', 'Pesan tidak tersedia')); return box; }
    box.appendChild(el('span', 'q-who', whoOf(q)));
    box.appendChild(el('span', 'q-t', previewOf(q)));
    box.addEventListener('click', (ev) => {
      ev.preventDefault(); ev.stopPropagation();
      const target = document.querySelector('#bThread [data-id="' + q.id + '"]');
      if (!target) return;
      target.scrollIntoView({ block: 'center', behavior: 'smooth' });
      target.classList.add('flash');
      setTimeout(() => target.classList.remove('flash'), 1400);
    });
    return box;
  }
  function renderThread(replies) {
    const sig = replies.map((r) => r.id + ':' + (r.edited_at || '') + ':' + (r.deleted_at || '')).join('|');
    if (sig === threadSig) return; // tidak ada perubahan: jangan gambar ulang (menu dan posisi gulir tetap)
    threadSig = sig;
    closeMsgMenu();
    const keep = nearBottom();
    const t = $('#bThread');
    t.textContent = '';
    const byId = {};
    replies.forEach((r) => { byId[r.id] = r; });
    let day = '';
    replies.forEach((r) => {
      const k = dayKey(r.created_at);
      if (k !== day) { day = k; t.appendChild(el('div', 'daysep', dayLabel(r.created_at))); }
      const mine = r.author === myId();
      const gone = !!r.deleted_at;
      const row = el('div', 'bubble ' + (mine ? 'me' : 'them') + (gone ? ' gone' : ''));
      row.dataset.id = r.id;
      if (r.reply_to && !gone) row.appendChild(quoteBlock(byId[r.reply_to]));
      row.appendChild(el('p', 'bt', gone ? (mine ? 'Kamu menghapus pesan ini' : 'Pesan ini telah dihapus') : r.message));
      row.appendChild(el('span', 'bm', (mine ? 'Kamu' : (r.nickname || 'Anonim')) + ', ' + clock(r.created_at) + (r.edited_at && !gone ? ' · diedit' : '')));
      row.tabIndex = 0;
      row.setAttribute('role', 'button');
      row.setAttribute('aria-haspopup', 'menu');
      const open = (ev) => { ev.preventDefault(); ev.stopPropagation(); showMsgMenu(row, r, mine); };
      row.addEventListener('click', open);
      row.addEventListener('contextmenu', open);
      row.addEventListener('keydown', (ev) => { if (ev.key === 'Enter' || ev.key === ' ') open(ev); });
      t.appendChild(row);
    });
    if (keep) toBottom();
  }
  function toBottom() {
    const s = $('#bScroll');
    if (s) requestAnimationFrame(() => { s.scrollTop = s.scrollHeight; });
  }
  function growReply() {
    const t = $('#inReply');
    t.style.height = 'auto';
    // saat dialog masih tertutup, scrollHeight = 0: biarkan tinggi mengikuti min-height di CSS
    if (!t.scrollHeight) { t.style.height = ''; return; }
    const cs = getComputedStyle(t);
    const border = (parseFloat(cs.borderTopWidth) || 0) + (parseFloat(cs.borderBottomWidth) || 0);
    const h = Math.min(t.scrollHeight + border, 112);
    t.style.height = h + 'px';
    t.style.overflowY = t.scrollHeight + border > 112 ? 'auto' : 'hidden';
  }
  async function loadReplies() {
    if (!cur || document.visibilityState !== 'visible') return;
    const id = cur.id;
    try {
      const reps = await api('/rest/v1/replies?select=*&bottle_id=eq.' + encodeURIComponent(id) + '&order=created_at.asc');
      if (cur && cur.id === id) { renderThread(reps); markSeen(id); }
    } catch (e) { /* coba lagi pada putaran berikutnya */ }
  }
  function openBottle(b) {
    cur = b;
    threadSig = '';
    closeMsgMenu();
    cancelEdit();
    cancelReply();
    $('#bMenuBox').hidden = true;
    const iAmAuthor = b.author === myId();
    const m = moodOf(b.mood);
    $('#bNote').style.setProperty('--mood', m.color);
    $('#bNote').className = 'bubble first ' + (iAmAuthor ? 'me' : 'them');
    $('#bAvatar').style.setProperty('--mood', m.color);
    $('#tBottle').textContent = iAmAuthor ? 'Botol yang kamu lempar' : (b.nickname || 'Seseorang di tepi laut');
    $('#bText').textContent = b.message;
    $('#bFrom').textContent = iAmAuthor
      ? 'Dari kamu' + (b.nickname ? ' (' + b.nickname + ')' : '') + ', ' + ago(b.created_at)
      : 'Dari ' + (b.nickname || 'seseorang di tepi laut') + ', ' + ago(b.created_at);
    $('#bRelease').hidden = iAmAuthor;
    $('#bDelete').hidden = !iAmAuthor;
    $('#bReport').hidden = !!b.hidden || (iAmAuthor && !b.caught_by);
    $('#bBlock').hidden = !!b.hidden || !b.caught_by;
    $('#bReplyBox').hidden = !((!iAmAuthor || !!b.caught_by) && !b.hidden);
    const st = statusOf(b);
    $('#bHint').textContent = st.label;
    $('#bStatus').textContent = st.detail;
    $('#inReply').value = '';
    growReply();
    $('#countR').textContent = '0 / ' + MAX;
    $('#bThread').textContent = '';
    openDlg($('#dlgBottle'));
    growReply();
    $('#bScroll').scrollTop = 0;
    loadReplies();
    clearInterval(pollTimer);
    pollTimer = setInterval(loadReplies, 6000);
  }
  function doReply() {
    return once('reply', async () => {
      if (!cur) return;
      const text = $('#inReply').value.trim();
      if (!text) { toast('Tulis balasanmu dulu.'); return; }
      if (text.length > MAX) { toast('Pesan terlalu panjang. Maksimal ' + MAX + ' karakter.'); return; }
      if (!(await confirmContact(text))) { $('#inReply').focus(); return; }
      const btn = $('#doReply');
      setBusy(btn, true);
      try {
        if (editing) {
          if (text === editing.message) { cancelEdit(); return; }
          await rpc('edit_reply', { p_id: editing.id, p_message: text });
          cancelEdit();
        } else {
          const body = { bottle_id: cur.id, nickname: lsGet(K.name, ''), message: text };
          if (replyTo) body.reply_to = replyTo.id; // dikirim hanya saat membalas pesan tertentu
          await api('/rest/v1/replies', { method: 'POST', body });
          cancelReply();
          $('#inReply').value = '';
          growReply();
          $('#countR').textContent = '0 / ' + MAX;
        }
        await loadReplies();
        toBottom();
      } catch (e) { toast(diagnose(e), 5000); }
      finally { setBusy(btn, false); }
    });
  }
  function closeBottle() { clearInterval(pollTimer); pollTimer = null; cur = null; closeMsgMenu(); cancelEdit(); cancelReply(); }

  /* tombol dua langkah supaya tidak tertekan tidak sengaja */
  function confirmBtn(btn, label, action) {
    let armed = false, timer;
    btn.addEventListener('click', async () => {
      if (!armed) {
        armed = true; btn.textContent = 'Yakin?';
        timer = setTimeout(() => { armed = false; btn.textContent = label; }, 3000);
        return;
      }
      clearTimeout(timer); armed = false; btn.textContent = label;
      await action();
    });
  }
  function afterChange() { loadMine().catch(() => {}); refreshSea(); }
  // Dipakai daftar Botolku: botolmu sendiri dihapus; botol temuan dilepas kembali ke laut (percakapan ikut hilang).
  async function removeBottle(b) {
    if (b.author === myId()) await api('/rest/v1/bottles?id=eq.' + encodeURIComponent(b.id), { method: 'DELETE' });
    else await rpc('release_bottle', { p_id: b.id });
    afterChange();
  }
  // Minta AI (fungsi Cloudflare /api/review) memeriksa laporan. Gagal diam-diam: laporan tetap masuk antrean admin.
  async function requestReview(bottleId) {
    try {
      const s = await ensureSession();
      await fetch('/api/review', {
        method: 'POST',
        keepalive: true,
        headers: { Authorization: 'Bearer ' + s.access_token, 'Content-Type': 'application/json' },
        body: JSON.stringify({ bottle_id: bottleId })
      });
    } catch (e) { /* abaikan */ }
  }
  confirmBtn($('#bRelease'), 'Lepas kembali', async () => {
    if (!cur) return;
    try { await rpc('release_bottle', { p_id: cur.id }); $('#dlgBottle').close(); toast('Botol dilepas kembali ke laut.'); afterChange(); }
    catch (e) { toast(human(e)); }
  });
  // Laporan: pilih alasan. Botol langsung disembunyikan dari tampilan pelapor saja; selanjutnya ditinjau.
  $('#bReport').addEventListener('click', () => {
    if (!cur) return;
    $('#bMenuBox').hidden = true;
    $('#rNote').value = '';
    const first = document.querySelector('input[name="rReason"]');
    if (first) first.checked = true;
    openDlg($('#dlgReport'));
  });
  $('#rSend').addEventListener('click', () => once('report', async () => {
    if (!cur) return;
    const bid = cur.id; // cur menjadi null begitu dialog ditutup
    const checked = document.querySelector('input[name="rReason"]:checked');
    const cat = (checked && checked.value) || 'lainnya';
    const note = $('#rNote').value.trim().slice(0, 200);
    const btn = $('#rSend');
    setBusy(btn, true);
    try {
      await rpc('report_bottle', { p_id: bid, p_reason: note, p_category: cat });
      $('#dlgReport').close();
      $('#dlgBottle').close();
      toast('Terima kasih. Botol disembunyikan dari tampilanmu dan akan ditinjau.', 4500);
      afterChange();
      requestReview(bid);
    } catch (e) { toast(diagnose(e), 5000); }
    finally { setBusy(btn, false); }
  }));
  confirmBtn($('#bBlock'), 'Blokir pengguna ini', async () => {
    if (!cur) return;
    try {
      await rpc('block_other', { p_id: cur.id });
      $('#dlgBottle').close();
      toast('Pengguna diblokir. Kalian tidak akan dipertemukan lagi.', 4500);
      afterChange();
    } catch (e) { toast(diagnose(e), 5000); }
  });
  confirmBtn($('#bDelete'), 'Hapus botol', async () => {
    if (!cur) return;
    try { await api('/rest/v1/bottles?id=eq.' + encodeURIComponent(cur.id), { method: 'DELETE' }); $('#dlgBottle').close(); toast('Botol dihapus.'); afterChange(); }
    catch (e) { toast(human(e)); }
  });

  /* ---------- ambil ---------- */
  function setDock(disabled) { ['#btnTake', '#btnThrow', '#btnMine'].forEach((s) => { $(s).disabled = disabled; }); }
  function take(wantMood, srcEl) {
    return once('take', async () => {
      const lbl = $('#btnTake span');
      const lblOld = lbl.textContent;
      lbl.textContent = 'Mencari...';
      $('#btnTake').setAttribute('aria-busy', 'true');
      setDock(true);
      try {
        const rows = await rpc('catch_bottle', wantMood ? { p_mood: wantMood } : {});
        const b = Array.isArray(rows) ? rows[0] : rows;
        if (!b || !b.id) {
          if (srcEl) srcEl.classList.remove('catching');
          toast('Belum ada botol yang bisa diambil. Coba lagi nanti.');
          refreshSea();
          return;
        }
        vib(20);
        await loadMine().catch(() => {});
        refreshSea();
        openBottle(b);
      } catch (e) {
        if (srcEl) srcEl.classList.remove('catching');
        toast(human(e), 5000);
      } finally { setDock(!CONFIGURED); lbl.textContent = lblOld; $('#btnTake').removeAttribute('aria-busy'); }
    });
  }

  /* ---------- info, bagikan, hapus data ---------- */
  confirmBtn($('#btnWipe'), 'Hapus semua data saya', async () => {
    try {
      await rpc('delete_my_data');
      [K.session, K.name, K.seen, K.draft].forEach(lsDel);
      session = null;
      Object.keys(seen).forEach((k) => delete seen[k]);
      $('#dlgInfo').close();
      toast('Semua datamu sudah dihapus dari server dan perangkat ini.', 4500);
      myBottles = []; myReplyMeta = []; updateBadge();
      start();
    } catch (e) { toast(human(e)); }
  });
  $('#btnShare').addEventListener('click', async () => {
    const data = { title: 'Love Ocean', text: 'Tulis satu pesan hangat, masukkan ke botol, lepas ke laut.', url: location.origin };
    if (navigator.share) { try { await navigator.share(data); } catch (e) { /* dibatalkan */ } return; }
    try { await navigator.clipboard.writeText(data.url); toast('Tautan disalin.'); }
    catch (e) { toast('Bagikan tautan ini: ' + data.url, 5000); }
  });

  /* ---------- suara ombak (dibuat langsung di perangkat, tanpa berkas) ---------- */
  const snd = { ctx: null, master: null, on: false };
  function buildSound() {
    const AC = window.AudioContext || window.webkitAudioContext;
    if (!AC) return false;
    const ctx = new AC();
    const len = ctx.sampleRate * 4;
    const buf = ctx.createBuffer(1, len, ctx.sampleRate);
    const d = buf.getChannelData(0);
    let last = 0;
    for (let i = 0; i < len; i++) { last = (last + 0.02 * (Math.random() * 2 - 1)) / 1.02; d[i] = last * 3.5; }
    const src = ctx.createBufferSource();
    src.buffer = buf; src.loop = true;
    const lp = ctx.createBiquadFilter();
    lp.type = 'lowpass'; lp.frequency.value = 650; lp.Q.value = 0.4;
    const swell = ctx.createGain();
    swell.gain.value = 0.26;
    const lfo = ctx.createOscillator();
    lfo.frequency.value = 0.09;
    const lfoGain = ctx.createGain();
    lfoGain.gain.value = 0.16;
    const lfoFilter = ctx.createGain();
    lfoFilter.gain.value = 260;
    lfo.connect(lfoGain); lfoGain.connect(swell.gain);
    lfo.connect(lfoFilter); lfoFilter.connect(lp.frequency);
    const master = ctx.createGain();
    master.gain.value = 0;
    src.connect(lp); lp.connect(swell); swell.connect(master); master.connect(ctx.destination);
    src.start(); lfo.start();
    snd.ctx = ctx; snd.master = master;
    return true;
  }
  function paintSound() {
    $('#btnSound').setAttribute('aria-pressed', String(snd.on));
    $('#btnSound').setAttribute('aria-label', snd.on ? 'Matikan suara ombak' : 'Nyalakan suara ombak');
    $('#soundIcon').setAttribute('href', snd.on ? '#i-sound' : '#i-mute');
  }
  function setSound(on) {
    if (on && !snd.ctx && !buildSound()) { toast('Perangkat ini tidak mendukung suara ombak.'); return; }
    snd.on = on;
    lsSet(K.sound, on);
    if (snd.ctx) {
      if (on) snd.ctx.resume();
      snd.master.gain.setTargetAtTime(on ? 0.9 : 0, snd.ctx.currentTime, 0.5);
    }
    paintSound();
  }
  $('#btnSound').addEventListener('click', () => setSound(!snd.on));
  if (lsGet(K.sound, false)) {
    snd.on = true; paintSound();
    // Browser baru mengizinkan suara setelah sentuhan pertama.
    const wake = () => { snd.on = false; setSound(true); };
    window.addEventListener('pointerdown', wake, { once: true });
  }

  /* ---------- pasang & offline ---------- */
  let deferred;
  window.addEventListener('beforeinstallprompt', (e) => { e.preventDefault(); deferred = e; $('#installBtn').hidden = false; });
  $('#installBtn').addEventListener('click', async () => {
    if (!deferred) return;
    deferred.prompt();
    try { await deferred.userChoice; } catch (e) { /* abaikan */ }
    deferred = null; $('#installBtn').hidden = true;
  });
  window.addEventListener('appinstalled', () => { $('#installBtn').hidden = true; });
  window.addEventListener('offline', () => { setStatus(false, 'Kamu sedang offline. Menunggu koneksi.'); });
  window.addEventListener('online', () => { toast('Kamu kembali online.', 1800); start(); });
  if (/iphone|ipad|ipod/i.test(navigator.userAgent) && !navigator.standalone) $('#iosHint').hidden = false;

  /* ---------- event ---------- */
  $('#btnTake').addEventListener('click', () => take(null));
  $('#btnThrow').addEventListener('click', openThrow);
  $('#btnMine').addEventListener('click', () => { if (window.LOMine) window.LOMine.open(); });
  $('#btnInfo').addEventListener('click', () => openDlg($('#dlgInfo')));
  $('#doThrow').addEventListener('click', doThrow);
  $('#doReply').addEventListener('click', doReply);
  $('#inMsg').addEventListener('input', () => { updateCount(); saveDraft(); });
  $('#inName').addEventListener('input', saveDraft);
  $('#inReply').addEventListener('input', () => { $('#countR').textContent = $('#inReply').value.length + ' / ' + MAX; growReply(); });
  $('#inMsg').addEventListener('keydown', (e) => { if (e.key === 'Enter' && (e.ctrlKey || e.metaKey)) doThrow(); });
  // Di komputer, Enter mengirim (Shift+Enter baris baru). Di layar sentuh, Enter tetap baris baru.
  $('#inReply').addEventListener('keydown', (e) => {
    if (e.key !== 'Enter' || e.isComposing) return;
    const desktop = window.matchMedia && matchMedia('(pointer:fine)').matches;
    if ((desktop && !e.shiftKey) || e.ctrlKey || e.metaKey) { e.preventDefault(); doReply(); }
  });
  document.querySelectorAll('dialog').forEach((d) => {
    d.addEventListener('click', (e) => {
      // Tutup hanya bila yang diketuk benar-benar backdrop (di luar kotak dialog), bukan ruang padding di dalamnya.
      if (e.target !== d) return;
      const r = d.getBoundingClientRect();
      if (e.clientX < r.left || e.clientX > r.right || e.clientY < r.top || e.clientY > r.bottom) d.close();
    });
    d.querySelectorAll('[data-close]').forEach((b) => b.addEventListener('click', () => d.close()));
  });
  $('#dlgBottle').addEventListener('close', () => { closeBottle(); $('#bMenuBox').hidden = true; });
  // menu titik tiga di header chat
  $('#bMenu').addEventListener('click', (e) => { e.stopPropagation(); const m = $('#bMenuBox'); m.hidden = !m.hidden; });
  document.addEventListener('click', (e) => { const m = $('#bMenuBox'); if (!m.hidden && !m.contains(e.target)) m.hidden = true; closeMsgMenu(); });
  let ageAccepted = !!lsGet(K.age, false);
  $('#ageOk').addEventListener('change', () => { $('#welcomeGo').disabled = !$('#ageOk').checked; });
  $('#welcomeGo').addEventListener('click', () => {
    if (!$('#ageOk').checked) return;
    ageAccepted = true; lsSet(K.age, true); lsSet(K.welcome, true);
    $('#dlgWelcome').close();
  });
  // Tidak bisa ditutup sebelum menyetujui.
  $('#dlgWelcome').addEventListener('cancel', (e) => { if (!ageAccepted) e.preventDefault(); });
  $('#dlgWelcome').addEventListener('close', () => { if (!ageAccepted) setTimeout(() => openDlg($('#dlgWelcome')), 0); });
  document.addEventListener('visibilitychange', () => {
    if (document.visibilityState === 'visible') {
      if (CONFIGURED && navigator.onLine) { refreshSea(); loadMine().catch(() => {}); loadReplies(); }
      if (snd.on && snd.ctx) snd.ctx.resume();
    } else if (snd.ctx) { snd.ctx.suspend(); }
  });

  /* ---------- mulai ---------- */
  async function start() {
    if (!CONFIGURED) {
      setStatus(false, 'Server belum diatur. Isi config.js dengan data Supabase, lalu unggah ulang.');
      setDock(true);
      return;
    }
    setDock(false);
    try { await ensureSession(); await Promise.all([refreshSea(), loadMine()]); }
    catch (e) { setStatus(false, 'Belum tersambung ke server. ' + diagnose(e)); }
  }

  // Jembatan untuk js/mine.js (halaman Botolku)
  window.LO = {
    get bottles() { return myBottles; },
    get replies() { return myReplyMeta; },
    unreadFor, myId, moodOf, ago, statusOf, loadMine, openBottle, removeBottle, human, openThrow, toast, openDlg, authReq,
    get session() { return session; },
    setSession(s) { session = s; lsSet(K.session, s); },
    // dipanggil setelah masuk/menyimpan akun: muat ulang data milik akun ini
    afterAuth() { myBottles = []; myReplyMeta = []; updateBadge(); refreshSea(); loadMine().catch(() => {}); },
    async signOut() {
      try { await authReq('POST', 'logout', null, true); } catch (e) { /* abaikan */ }
      lsDel(K.session);
      session = null;
      myBottles = []; myReplyMeta = []; updateBadge();
      await start();
    }
  };

  updateCount();
  start();
  if (!ageAccepted) openDlg($('#dlgWelcome'));
  setInterval(() => {
    if (CONFIGURED && document.visibilityState === 'visible' && navigator.onLine) { refreshSea(); loadMine().catch(() => {}); }
  }, 60000);

  if ('serviceWorker' in navigator) {
    window.addEventListener('load', () => { navigator.serviceWorker.register('/service-worker.js').catch(() => {}); });
  }
})();
