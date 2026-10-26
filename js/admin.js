(() => {
  'use strict';

  const CFG = window.LO_CONFIG || {};
  const PROXY = !!CFG.API_BASE;
  const BASE = (PROXY ? CFG.API_BASE : CFG.SUPABASE_URL || '').replace(/\/$/, '');
  const KEY = PROXY ? '' : (CFG.SUPABASE_KEY || '');
  const withKey = (h) => (KEY ? Object.assign({ apikey: KEY }, h) : h);
  const SESSION_KEY = 'loveocean.admin.v1';
  /* ---------- Turnstile (aktif hanya bila TURNSTILE_SITE_KEY diisi di config.js; kosong = perilaku lama) ---------- */
  const TS_KEY = CFG.TURNSTILE_SITE_KEY || '';
  let tsLoad = null;
  function loadTurnstile() {
    if (window.turnstile) return Promise.resolve();
    if (tsLoad) return tsLoad;
    tsLoad = new Promise((resolve, reject) => {
      const s = document.createElement('script');
      s.src = 'https://challenges.cloudflare.com/turnstile/v0/api.js?render=explicit';
      s.async = true;
      s.onload = () => resolve();
      s.onerror = () => { tsLoad = null; s.remove(); reject(new Error('captcha_gagal')); };
      document.head.appendChild(s);
    });
    return tsLoad;
  }
  // Satu token sekali pakai. Kotak tantangan memakai popover supaya tampil di atas dialog modal.
  async function captchaToken() {
    if (!TS_KEY) return '';
    await loadTurnstile();
    return new Promise((resolve, reject) => {
      const box = document.createElement('div');
      box.setAttribute('popover', 'manual');
      box.style.border = '0'; box.style.padding = '0'; box.style.background = 'transparent'; box.style.overflow = 'visible';
      document.body.appendChild(box);
      try { box.showPopover(); } catch (e) { /* tanpa popover: tetap jalan */ }
      let id = null, done = false, timer = null;
      const finish = (fn, v) => {
        if (done) return;
        done = true; clearTimeout(timer);
        try { if (id !== null) window.turnstile.remove(id); } catch (e) { /* abaikan */ }
        try { box.hidePopover(); } catch (e) { /* abaikan */ }
        box.remove();
        fn(v);
      };
      timer = setTimeout(() => finish(reject, new Error('captcha_gagal')), 45000);
      try {
        id = window.turnstile.render(box, {
          sitekey: TS_KEY, appearance: 'interaction-only',
          callback: (t) => finish(resolve, t),
          'error-callback': () => finish(reject, new Error('captcha_gagal'))
        });
      } catch (e) { finish(reject, new Error('captcha_gagal')); }
    });
  }
  const captchaBody = async (extra) => {
    const t = await captchaToken();
    return t ? Object.assign({}, extra, { gotrue_meta_security: { captcha_token: t } }) : (extra || {});
  };

  const $ = (s) => document.querySelector(s);

  const VERDICT = {
    sah:       { text: 'AI: pelanggaran jelas', cls: 'bad' },
    ragu:      { text: 'AI: ragu, perlu ditinjau', cls: 'warn' },
    tidak_sah: { text: 'AI: tidak melanggar', cls: 'ok' },
    gagal:     { text: 'AI gagal memeriksa', cls: 'muted' },
    memeriksa: { text: 'Sedang diperiksa AI', cls: 'muted' },
    none:      { text: 'Belum diperiksa AI', cls: 'muted' }
  };
  const CATEGORY = {
    pelecehan: 'Pelecehan', seksual: 'Seksual', kebencian: 'Kebencian', ancaman: 'Ancaman',
    penipuan_spam: 'Penipuan/spam', data_pribadi: 'Data pribadi', menyakiti_diri: 'Menyakiti diri',
    lainnya: 'Lainnya', tidak_ada: ''
  };
  const NOTE = {
    tinjau: 'Laporan yang dinilai AI melanggar, ragu, atau gagal diperiksa. Pelapor sudah tidak melihat botolnya; botol disembunyikan dari semua orang setelah AI menilai melanggar, dua pelapor, atau keputusanmu.',
    ai: 'Laporan yang ditutup AI karena dinilai tidak melanggar. Botolnya tidak berubah. Kamu bisa membukanya lagi (botol disembunyikan untuk semua).',
    selesai: 'Laporan yang sudah kamu putuskan.'
  };

  /* ---------- util ---------- */
  let toastTimer;
  function toast(msg, ms) {
    const t = $('#toast');
    t.textContent = msg;
    t.classList.add('show');
    clearTimeout(toastTimer);
    toastTimer = setTimeout(() => t.classList.remove('show'), ms || 3200);
  }
  function el(tag, cls, text) {
    const n = document.createElement(tag);
    if (cls) n.className = cls;
    if (text != null) n.textContent = text;
    return n;
  }
  function lsGet(k) { try { const v = localStorage.getItem(k); return v ? JSON.parse(v) : null; } catch (e) { return null; } }
  function lsSet(k, v) { try { localStorage.setItem(k, JSON.stringify(v)); } catch (e) { /* abaikan */ } }
  function lsDel(k) { try { localStorage.removeItem(k); } catch (e) { /* abaikan */ } }
  function ago(ts) {
    const s = Math.max(0, (Date.now() - Date.parse(ts)) / 1000);
    if (s < 60) return 'baru saja';
    if (s < 3600) return Math.floor(s / 60) + ' menit lalu';
    if (s < 86400) return Math.floor(s / 3600) + ' jam lalu';
    try { return new Date(ts).toLocaleDateString('id-ID', { day: 'numeric', month: 'short', hour: '2-digit', minute: '2-digit' }); } catch (e) { return ''; }
  }
  function show(id) {
    ['#viewLogin', '#viewDenied', '#viewQueue'].forEach((s) => { $(s).hidden = s !== id; });
    $('#btnOut').hidden = id === '#viewLogin';
  }
  function explain(e) {
    const m = (e && e.message) || '';
    if (/PGRST202|could not find the function/i.test(m)) return 'Database belum diperbarui. Jalankan schema.sql terbaru di Supabase.';
    if (/tidak_boleh/.test(m)) return 'Aksi ditolak. Pastikan akunmu admin dan laporannya masih ada.';
    if (e && e.message === 'login') return 'Sesi habis. Masuk lagi.';
    if (!navigator.onLine) return 'Kamu sedang offline.';
    return 'Terjadi masalah saat menghubungi server. Coba lagi.';
  }

  /* ---------- sesi admin ---------- */
  let sess = lsGet(SESSION_KEY);

  function normalize(d) {
    return {
      access_token: d.access_token,
      refresh_token: d.refresh_token,
      expires_at: d.expires_at || Math.floor(Date.now() / 1000) + (d.expires_in || 3600)
    };
  }
  function setSess(s) { sess = s; if (s) lsSet(SESSION_KEY, s); else lsDel(SESSION_KEY); }

  async function authPost(path, body) {
    const res = await fetch(BASE + '/auth/v1/' + path, {
      method: 'POST',
      headers: withKey({ 'Content-Type': 'application/json' }),
      body: JSON.stringify(body)
    });
    const data = await res.json().catch(() => ({}));
    if (!res.ok) throw new Error(data.msg || data.error_description || data.message || 'auth_gagal');
    return data;
  }
  async function token() {
    if (!sess) throw new Error('login');
    if (sess.expires_at * 1000 - Date.now() < 60000) {
      try { setSess(normalize(await authPost('token?grant_type=refresh_token', { refresh_token: sess.refresh_token }))); }
      catch (e) { setSess(null); throw new Error('login'); }
    }
    return sess.access_token;
  }
  async function rpc(name, body) {
    const t = await token();
    const res = await fetch(BASE + '/rest/v1/rpc/' + name, {
      method: 'POST',
      headers: withKey({ Authorization: 'Bearer ' + t, 'Content-Type': 'application/json' }),
      body: JSON.stringify(body || {})
    });
    const txt = await res.text();
    let data = null;
    try { data = txt ? JSON.parse(txt) : null; } catch (e) { /* bukan JSON */ }
    if (!res.ok) {
      const err = new Error((data && (data.message || data.msg)) || res.statusText);
      err.status = res.status;
      throw err;
    }
    return data;
  }
  async function runReview(reportId) {
    const t = await token();
    const res = await fetch('/api/review', {
      method: 'POST',
      headers: { Authorization: 'Bearer ' + t, 'Content-Type': 'application/json' },
      body: JSON.stringify({ report_id: reportId })
    });
    return res.ok;
  }

  /* ---------- masuk ---------- */
  let loginEmail = '';
  function loginError(msg) { $('#loginErr').textContent = msg || ''; }

  $('#btnSend').addEventListener('click', async () => {
    const email = $('#email').value.trim().toLowerCase();
    if (!/^[^@\s]+@[^@\s]+\.[^@\s]+$/.test(email)) { loginError('Isi email yang valid.'); return; }
    const btn = $('#btnSend');
    btn.disabled = true; loginError('');
    try {
      await authPost('otp', await captchaBody({ email, create_user: false }));
      loginEmail = email;
      $('#sentTo').textContent = 'Kode dikirim ke ' + email + '. Cek kotak masuk dan folder spam.';
      $('#step1').hidden = true; $('#step2').hidden = false;
      $('#code').focus();
    } catch (e) {
      loginError(/captcha/i.test(e.message || '') ? 'Verifikasi keamanan gagal. Muat ulang halaman lalu coba lagi.' : /signups not allowed|not found/i.test(e.message || '')
        ? 'Email ini belum terdaftar. Masuk dulu di aplikasi lewat "Simpan akunku", lalu coba lagi.'
        : 'Kode gagal dikirim. Coba lagi sebentar lagi.');
    } finally { btn.disabled = false; }
  });
  $('#btnVerify').addEventListener('click', async () => {
    const code = $('#code').value.trim();
    if (!code) { loginError('Isi kode verifikasi.'); return; }
    const btn = $('#btnVerify');
    btn.disabled = true; loginError('');
    try {
      const d = await authPost('verify', { type: 'email', email: loginEmail, token: code });
      if (!d.access_token) throw new Error('kode');
      setSess(normalize(d));
      $('#code').value = '';
      await start();
    } catch (e) { loginError('Kode salah atau sudah kedaluwarsa.'); }
    finally { btn.disabled = false; }
  });
  $('#btnBack').addEventListener('click', () => { $('#step2').hidden = true; $('#step1').hidden = false; loginError(''); });
  $('#btnOut').addEventListener('click', () => { setSess(null); data = { counts: {}, items: [] }; show('#viewLogin'); $('#step1').hidden = false; $('#step2').hidden = true; });
  $('#email').addEventListener('keydown', (e) => { if (e.key === 'Enter') $('#btnSend').click(); });
  $('#code').addEventListener('keydown', (e) => { if (e.key === 'Enter') $('#btnVerify').click(); });

  /* ---------- antrean ---------- */
  let tab = 'tinjau';
  let data = { counts: {}, items: [] };
  const autoTried = new Set();

  function twoStep(btn, label, action) {
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
  function actionBtn(label, cls, onClick, confirm) {
    const b = el('button', 'act' + (cls ? ' ' + cls : ''), label);
    b.type = 'button';
    if (confirm) twoStep(b, label, onClick);
    else b.addEventListener('click', onClick);
    return b;
  }
  async function resolve(id, action, okMsg) {
    try { await rpc('admin_resolve', { p_report: id, p_action: action }); toast(okMsg); await load(); }
    catch (e) { toast(explain(e), 4500); }
  }
  async function recheck(id) {
    try {
      await rpc('admin_recheck', { p_report: id });
      toast('AI memeriksa ulang...');
      const ok = await runReview(id);
      if (!ok) toast('Fungsi AI belum bisa dijangkau. Periksa pengaturan Cloudflare Pages.', 5000);
      await load();
    } catch (e) { toast(explain(e), 4500); }
  }

  function card(it) {
    const c = el('article', 'card');
    const v = VERDICT[it.ai_status || 'none'] || VERDICT.none;

    const head = el('div', 'chips');
    head.appendChild(el('span', 'chip ' + v.cls, v.text));
    const cat = CATEGORY[it.ai_category];
    if (cat) head.appendChild(el('span', 'chip', cat));
    if (it.ai_confidence != null && it.ai_status && it.ai_status !== 'memeriksa') head.appendChild(el('span', 'chip', 'yakin ' + it.ai_confidence + '%'));
    if (it.report_category && CATEGORY[it.report_category]) head.appendChild(el('span', 'chip', 'Pelapor: ' + CATEGORY[it.report_category]));
    if (it.hidden) head.appendChild(el('span', 'chip', 'disembunyikan'));
    if (it.bottle_deleted) head.appendChild(el('span', 'chip warn', 'botol sudah dihapus (isi dari salinan laporan)'));
    head.appendChild(el('span', 'when', ago(it.created_at)));
    c.appendChild(head);

    if (it.ai_reason) c.appendChild(el('p', 'why', it.ai_reason));
    if (it.reason) c.appendChild(el('p', 'why', 'Alasan pelapor: ' + it.reason));

    const first = el('div', 'msg first');
    first.appendChild(el('span', 'who', 'Pembuat botol' + (it.bottle_nickname ? ' (' + it.bottle_nickname + ')' : '')));
    first.appendChild(el('p', 'txt', it.bottle_message));
    c.appendChild(first);

    const thread = Array.isArray(it.thread) ? it.thread : [];
    if (thread.length) {
      const d = el('details', 'thread');
      d.appendChild(el('summary', null, 'Percakapan (' + thread.length + ' pesan)'));
      thread.forEach((m) => {
        const row = el('div', 'msg');
        row.appendChild(el('span', 'who', (m.role === 'pembuat' ? 'Pembuat' : 'Penemu') + (m.nickname ? ' (' + m.nickname + ')' : '') + ', ' + ago(m.created_at) + (m.edited ? ' · diedit' : '')));
        row.appendChild(el('p', 'txt' + (m.deleted ? ' gone' : ''), m.deleted ? '(pesan dihapus pengirim)' : m.message));
        d.appendChild(row);
      });
      c.appendChild(d);
    }

    const acts = el('div', 'acts');
    if (tab === 'tinjau') {
      acts.appendChild(actionBtn('Pulihkan botol', 'ok', () => resolve(it.id, 'pulihkan', 'Botol dipulihkan ke laut.'), true));
      acts.appendChild(actionBtn('Hapus botol', 'bad', () => resolve(it.id, 'hapus', 'Botol dihapus.'), true));
      acts.appendChild(actionBtn('Blokir pembuat', 'bad', () => resolve(it.id, 'blokir_pembuat', 'Pembuat diblokir.'), true));
      if (it.caught) acts.appendChild(actionBtn('Blokir penemu', 'bad', () => resolve(it.id, 'blokir_penemu', 'Penemu diblokir.'), true));
      if (it.ai_status !== 'sah') acts.appendChild(actionBtn('Periksa AI lagi', '', () => recheck(it.id)));
    } else if (tab === 'ai') {
      acts.appendChild(actionBtn('Buka lagi dan sembunyikan', 'warn', () => resolve(it.id, 'tinjau_ulang', 'Botol disembunyikan lagi dan masuk antrean.'), true));
      acts.appendChild(actionBtn('Hapus botol', 'bad', () => resolve(it.id, 'hapus', 'Botol dihapus.'), true));
    } else if (it.resolved_action) {
      acts.appendChild(el('span', 'when', 'Keputusan: ' + it.resolved_action.replace(/_/g, ' ')));
    }
    if (acts.childNodes.length) c.appendChild(acts);
    return c;
  }

  function render() {
    const n = data.counts || {};
    $('#cTinjau').textContent = n.tinjau || 0;
    $('#cAi').textContent = n.ai || 0;
    $('#cSelesai').textContent = n.selesai || 0;
    document.title = (n.tinjau ? '(' + n.tinjau + ') ' : '') + 'Admin Love Ocean';
    document.querySelectorAll('.tab').forEach((b) => b.setAttribute('aria-selected', String(b.dataset.tab === tab)));
    $('#tabNote').textContent = NOTE[tab];
    const list = $('#list');
    list.textContent = '';
    if (!data.items.length) { list.appendChild(el('p', 'empty', 'Tidak ada laporan di sini.')); return; }
    data.items.forEach((it) => list.appendChild(card(it)));
  }

  // Laporan yang belum sempat diperiksa AI (misalnya koneksi putus) diperiksa otomatis saat admin membuka antrean.
  async function autoReview() {
    const todo = data.items.filter((it) => tab === 'tinjau' && !it.ai_status && !autoTried.has(it.id)).slice(0, 5);
    if (!todo.length) return;
    todo.forEach((it) => autoTried.add(it.id));
    await Promise.all(todo.map((it) => runReview(it.id).catch(() => false)));
    await load(true);
  }

  async function load(quiet) {
    try {
      data = await rpc('admin_reports', { p_tab: tab });
      if (!data || !Array.isArray(data.items)) data = { counts: {}, items: [] };
      render();
      if (!quiet) autoReview();
    } catch (e) {
      if (e.message === 'login') { setSess(null); show('#viewLogin'); loginError('Sesi habis. Masuk lagi.'); return; }
      toast(explain(e), 5000);
    }
  }

  document.querySelectorAll('.tab').forEach((b) => b.addEventListener('click', () => { tab = b.dataset.tab; load(); }));
  $('#btnRefresh').addEventListener('click', () => load());
  setInterval(() => { if (sess && document.visibilityState === 'visible' && !$('#viewQueue').hidden) load(true); }, 30000);

  /* ---------- mulai ---------- */
  async function start() {
    if (!BASE || (!PROXY && !KEY)) { show('#viewLogin'); loginError('config.js belum diisi.'); return; }
    if (!sess) { show('#viewLogin'); return; }
    try {
      const ok = await rpc('is_admin');
      if (ok !== true) { show('#viewDenied'); return; }
      show('#viewQueue');
      await load();
    } catch (e) {
      if (e.message === 'login') { show('#viewLogin'); return; }
      show('#viewLogin');
      loginError(explain(e));
    }
  }
  start();
})();
