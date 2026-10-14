(() => {
  'use strict';

  const CFG = window.LO_CONFIG || {};
  const CONFIGURED = !!(CFG.SUPABASE_URL && CFG.SUPABASE_KEY && !/GANTI/.test(CFG.SUPABASE_URL + CFG.SUPABASE_KEY));
  const MAX = 280;
  // Kunci sesi dan nama tetap sama dengan versi sebelumnya supaya akun anonim lama tetap terbaca.
  const K = {
    session: 'loveocean.session.v2', name: 'loveocean.nick.v2', seen: 'loveocean.seen.v2',
    draft: 'loveocean.draft.v3', welcome: 'loveocean.welcome.v3', sound: 'loveocean.sound.v3'
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
    tautan_dilarang: 'Pesan tidak boleh berisi tautan, akun media sosial, email, atau nomor telepon.',
    terlalu_cepat: 'Pelan-pelan dulu. Tunggu beberapa detik lalu coba lagi.',
    limit_botol: 'Kamu sudah melempar 10 botol dalam 24 jam. Coba lagi besok.',
    limit_balasan: 'Terlalu banyak balasan dalam satu jam. Coba lagi nanti.',
    limit_harian: 'Kamu sudah mengambil 15 botol hari ini. Coba lagi besok.',
    percakapan_penuh: 'Percakapan ini sudah mencapai 100 balasan.',
    tidak_boleh: 'Aksi ini tidak diizinkan untuk botol tersebut.'
  };

  /* ---------- util ---------- */
  let toastTimer;
  function toast(msg, ms) {
    const t = $('#toast');
    t.textContent = msg;
    t.classList.add('show');
    clearTimeout(toastTimer);
    toastTimer = setTimeout(() => t.classList.remove('show'), ms || 3400);
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
  const locks = new Set();
  async function once(name, fn) {
    if (locks.has(name)) return;
    locks.add(name);
    try { return await fn(); } finally { locks.delete(name); }
  }

  /* ---------- sesi anonim (tanpa library) ---------- */
  let session = lsGet(K.session, null);
  let sessionJob = null;

  async function authCall(path, body) {
    const res = await fetch(CFG.SUPABASE_URL + '/auth/v1/' + path, {
      method: 'POST',
      headers: { apikey: CFG.SUPABASE_KEY, 'Content-Type': 'application/json' },
      body: JSON.stringify(body)
    });
    const data = await res.json().catch(() => ({}));
    if (!res.ok || !data.access_token) throw new Error(data.msg || data.error_description || data.message || 'auth_gagal');
    return data;
  }
  function ensureSession() {
    if (session && session.expires_at * 1000 - Date.now() > 60000) return Promise.resolve(session);
    if (sessionJob) return sessionJob;
    sessionJob = (async () => {
      try {
        if (session && session.refresh_token) {
          try {
            session = await authCall('token?grant_type=refresh_token', { refresh_token: session.refresh_token });
            lsSet(K.session, session);
            return session;
          } catch (e) { if (!navigator.onLine) throw e; }
        }
        session = await authCall('signup', {});
        lsSet(K.session, session);
        return session;
      } finally { sessionJob = null; }
    })();
    return sessionJob;
  }
  async function api(path, opt, retry) {
    opt = opt || {};
    const s = await ensureSession();
    const ctl = new AbortController();
    const timer = setTimeout(() => ctl.abort(), 15000);
    let res;
    try {
      res = await fetch(CFG.SUPABASE_URL + path, {
        method: opt.method || 'GET',
        signal: ctl.signal,
        headers: {
          apikey: CFG.SUPABASE_KEY,
          Authorization: 'Bearer ' + s.access_token,
          'Content-Type': 'application/json',
          Prefer: 'return=representation'
        },
        body: opt.body ? JSON.stringify(opt.body) : undefined
      });
    } finally { clearTimeout(timer); }
    const txt = await res.text();
    let data = null;
    try { data = txt ? JSON.parse(txt) : null; } catch (e) { /* bukan JSON */ }
    if (res.status === 401 && retry !== false) { session = null; lsDel(K.session); return api(path, opt, false); }
    if (!res.ok) {
      const err = new Error((data && (data.message || data.msg)) || res.statusText);
      err.status = res.status;
      throw err;
    }
    return data;
  }
  const rpc = (name, body) => api('/rest/v1/rpc/' + name, { method: 'POST', body: body || {} });
  const myId = () => (session && session.user && session.user.id) || '';

  /* ---------- ombak ---------- */
  function wavePath(a) {
    let d = 'M0 24 Q25 ' + (24 - a) + ' 50 24';
    for (let x = 100; x <= 800; x += 50) d += ' T' + x + ' 24';
    return d + ' V46 H0 Z';
  }
  function buildWaves() {
    const add = (box, cls, amp) => {
      const s = document.createElementNS(SVGNS, 'svg');
      s.setAttribute('class', 'wave ' + cls);
      s.setAttribute('viewBox', '0 0 800 46');
      s.setAttribute('preserveAspectRatio', 'none');
      const p = document.createElementNS(SVGNS, 'path');
      p.setAttribute('d', wavePath(amp));
      s.appendChild(p);
      $(box).appendChild(s);
    };
    add('#wavesBack', 'w1', 7); add('#wavesBack', 'w2', 9);
    add('#wavesFront', 'w3', 10); add('#wavesFront', 'w4', 12);
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
      b.style.left = p.l + '%';
      b.style.top = p.t + '%';
      b.style.setProperty('--mood', m.color);
      b.style.setProperty('--s', (0.66 + p.t / 100 * 1.05).toFixed(2));
      b.style.setProperty('--dur', (8 + (i * 1.7) % 6).toFixed(1) + 's');
      b.style.setProperty('--delay', '-' + ((i * 2.3) % 7).toFixed(1) + 's');
      b.setAttribute('aria-label', 'Ambil botol bersuasana ' + m.label.toLowerCase());
      const sway = el('span', 'sway');
      sway.appendChild(useSvg('bottle', '0 0 48 80'));
      b.appendChild(sway);
      b.addEventListener('click', () => { b.classList.add('catching'); vib(12); take(mood, b); });
      box.appendChild(b);
    });
  }
  async function refreshSea() {
    try {
      const v = await rpc('sea_view');
      sea = { count: Number(v && v.count) || 0, moods: Array.isArray(v && v.moods) ? v.moods : [] };
      renderSea();
    } catch (e) { setStatus(false, 'Belum tersambung ke server. ' + human(e)); }
  }

  /* ---------- botolku & penanda balasan baru ---------- */
  let myBottles = [];
  let myReplyMeta = [];
  const seen = lsGet(K.seen, {});

  function unreadFor(bid) {
    const last = seen[bid] || 0;
    return myReplyMeta.filter((r) => r.bottle_id === bid && r.author !== myId() && Date.parse(r.created_at) > last).length;
  }
  function markSeen(bid) { seen[bid] = Date.now(); lsSet(K.seen, seen); updateBadge(); }
  function updateBadge() {
    let total = 0;
    myBottles.forEach((b) => { total += unreadFor(b.id); });
    const bd = $('#badge');
    bd.textContent = total > 9 ? '9+' : total;
    bd.hidden = total === 0;
    document.title = total ? '(' + total + ') Love Ocean' : 'Love Ocean';
  }
  async function loadMine() {
    myBottles = await api('/rest/v1/bottles?select=*&order=created_at.desc&limit=100');
    myReplyMeta = await api('/rest/v1/replies?select=bottle_id,author,created_at&order=created_at.desc&limit=500');
    updateBadge();
  }

  /* ---------- lempar satu ---------- */
  let mood = 'cinta';
  function buildMoods() {
    const box = $('#moodPick');
    Object.keys(MOODS).forEach((key) => {
      const lab = el('label', 'chip');
      lab.style.setProperty('--mood', MOODS[key].color);
      const inp = document.createElement('input');
      inp.type = 'radio'; inp.name = 'mood'; inp.value = key;
      inp.addEventListener('change', () => { mood = key; saveDraft(); });
      lab.appendChild(inp);
      lab.appendChild(el('span', 'chipface', MOODS[key].label));
      box.appendChild(lab);
    });
  }
  function setMood(key) {
    mood = MOODS[key] ? key : 'cinta';
    document.querySelectorAll('#moodPick input').forEach((i) => { i.checked = i.value === mood; });
  }
  function saveDraft() { lsSet(K.draft, { mood, text: $('#inMsg').value, name: $('#inName').value }); }
  function updateCount() {
    const n = $('#inMsg').value.length;
    const c = $('#count');
    c.textContent = n + ' / ' + MAX;
    c.classList.toggle('warn', n >= MAX - 30);
  }
  function openThrow() {
    $('#dlgMine').close();
    const d = lsGet(K.draft, {});
    $('#inName').value = d.name != null ? d.name : lsGet(K.name, '');
    $('#inMsg').value = d.text || '';
    setMood(d.mood);
    updateCount();
    openDlg($('#dlgThrow'));
  }
  function flyBottle(key) {
    const scene = $('.scene');
    const tx = Math.round((Math.random() * 2 - 1) * 70);
    const b = el('div', 'thrown');
    b.style.setProperty('--mood', moodOf(key).color);
    b.style.setProperty('--tx', tx + 'px');
    b.appendChild(useSvg('bottle', '0 0 48 80'));
    const ring = el('div', 'ring');
    ring.style.left = 'calc(50% + ' + tx + 'px)';
    scene.appendChild(b);
    scene.appendChild(ring);
    setTimeout(() => { b.remove(); ring.remove(); }, 4600);
  }
  function doThrow() {
    return once('throw', async () => {
      const text = $('#inMsg').value.trim().slice(0, MAX);
      const name = $('#inName').value.trim().slice(0, 30);
      if (!text) { toast('Tulis pesanmu dulu sebelum melempar botol.'); $('#inMsg').focus(); return; }
      const btn = $('#doThrow');
      btn.disabled = true;
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
      } catch (e) { toast(human(e), 5000); }
      finally { btn.disabled = false; }
    });
  }

  /* ---------- satu botol ---------- */
  let cur = null;
  let pollTimer = null;

  function renderThread(replies) {
    const t = $('#bThread');
    t.textContent = '';
    replies.forEach((r) => {
      const mine = r.author === myId();
      const row = el('div', 'bubble ' + (mine ? 'me' : 'them'));
      row.appendChild(el('p', 'bt', r.message));
      row.appendChild(el('span', 'bm', (mine ? 'Kamu' : (r.nickname || 'Anonim')) + ', ' + ago(r.created_at)));
      t.appendChild(row);
    });
    t.scrollTop = t.scrollHeight;
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
    const iAmAuthor = b.author === myId();
    const m = moodOf(b.mood);
    $('#bNote').style.setProperty('--mood', m.color);
    $('#tBottle').textContent = iAmAuthor ? 'Botol yang kamu lempar' : 'Botol yang kamu temukan';
    const mo = $('#bMood');
    mo.textContent = '';
    mo.appendChild(moodDot(b.mood));
    mo.appendChild(document.createTextNode(m.label));
    $('#bText').textContent = b.message;
    $('#bFrom').textContent = iAmAuthor
      ? 'Dari kamu' + (b.nickname ? ' (' + b.nickname + ')' : '')
      : 'Dari ' + (b.nickname || 'seseorang di tepi laut');
    $('#bRelease').hidden = iAmAuthor;
    $('#bDelete').hidden = !iAmAuthor;
    $('#bReport').hidden = !!b.hidden;
    $('#bReplyBox').hidden = !((!iAmAuthor || !!b.caught_by) && !b.hidden);
    $('#bHint').textContent = b.hidden
      ? 'Botol ini sedang ditinjau dan disembunyikan dari laut.'
      : iAmAuthor
        ? (b.caught_by ? 'Seseorang menemukan botolmu. Percakapan ini hanya terlihat olehmu dan dia.' : 'Botolmu masih hanyut. Belum ada yang menemukannya.')
        : 'Hanya kamu dan pembuat botol yang bisa melihat percakapan ini.';
    $('#inReply').value = '';
    $('#countR').textContent = '0 / ' + MAX;
    $('#bThread').textContent = '';
    openDlg($('#dlgBottle'));
    loadReplies();
    clearInterval(pollTimer);
    pollTimer = setInterval(loadReplies, 6000);
  }
  function doReply() {
    return once('reply', async () => {
      if (!cur) return;
      const text = $('#inReply').value.trim().slice(0, MAX);
      if (!text) { toast('Tulis balasanmu dulu.'); return; }
      const btn = $('#doReply');
      btn.disabled = true;
      try {
        await api('/rest/v1/replies', { method: 'POST', body: { bottle_id: cur.id, nickname: lsGet(K.name, ''), message: text } });
        $('#inReply').value = '';
        $('#countR').textContent = '0 / ' + MAX;
        await loadReplies();
      } catch (e) { toast(human(e), 5000); }
      finally { btn.disabled = false; }
    });
  }
  function closeBottle() { clearInterval(pollTimer); pollTimer = null; cur = null; }

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
  confirmBtn($('#bRelease'), 'Lepas kembali', async () => {
    if (!cur) return;
    try { await rpc('release_bottle', { p_id: cur.id }); $('#dlgBottle').close(); toast('Botol dilepas kembali ke laut.'); afterChange(); }
    catch (e) { toast(human(e)); }
  });
  confirmBtn($('#bReport'), 'Laporkan', async () => {
    if (!cur) return;
    try { await rpc('report_bottle', { p_id: cur.id, p_reason: '' }); $('#dlgBottle').close(); toast('Terima kasih. Botol ini sudah disembunyikan dan akan ditinjau.', 4500); afterChange(); }
    catch (e) { toast(human(e)); }
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
      } finally { setDock(!CONFIGURED); }
    });
  }

  /* ---------- botolku ---------- */
  async function openMine() {
    openDlg($('#dlgMine'));
    const list = $('#mineList');
    list.textContent = '';
    list.appendChild(el('p', 'empty', 'Memuat botolmu...'));
    try { await loadMine(); } catch (e) { list.textContent = ''; list.appendChild(el('p', 'empty', human(e))); return; }
    list.textContent = '';
    if (!myBottles.length) {
      list.appendChild(el('p', 'empty', 'Belum ada botol. Tekan "Lempar satu" untuk menulis pesan pertamamu, atau "Ambil" untuk menemukan botol orang lain.'));
      return;
    }
    myBottles.forEach((b) => {
      const iAmAuthor = b.author === myId();
      const it = el('button', 'item');
      it.type = 'button';
      it.style.setProperty('--mood', moodOf(b.mood).color);
      const un = unreadFor(b.id);
      const tag = el('div', 'tag');
      tag.appendChild(moodDot(b.mood));
      tag.appendChild(document.createTextNode(
        b.hidden ? 'Sedang ditinjau'
          : iAmAuthor ? (b.caught_by ? 'Kamu lempar, sudah ditemukan' : 'Kamu lempar, masih hanyut')
            : 'Kamu temukan'));
      if (un) tag.appendChild(el('b', 'new', un + ' balasan baru'));
      it.appendChild(tag);
      it.appendChild(el('p', 'prev', b.message.length > 110 ? b.message.slice(0, 110) + '...' : b.message));
      it.appendChild(el('span', 'when', ago(b.created_at)));
      it.addEventListener('click', () => { $('#dlgMine').close(); openBottle(b); });
      list.appendChild(it);
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
  $('#btnMine').addEventListener('click', openMine);
  $('#btnInfo').addEventListener('click', () => openDlg($('#dlgInfo')));
  $('#doThrow').addEventListener('click', doThrow);
  $('#doReply').addEventListener('click', doReply);
  $('#mineThrow').addEventListener('click', openThrow);
  $('#inMsg').addEventListener('input', () => { updateCount(); saveDraft(); });
  $('#inName').addEventListener('input', saveDraft);
  $('#inReply').addEventListener('input', () => { $('#countR').textContent = $('#inReply').value.length + ' / ' + MAX; });
  $('#inMsg').addEventListener('keydown', (e) => { if (e.key === 'Enter' && (e.ctrlKey || e.metaKey)) doThrow(); });
  $('#inReply').addEventListener('keydown', (e) => { if (e.key === 'Enter' && (e.ctrlKey || e.metaKey)) doReply(); });
  document.querySelectorAll('dialog').forEach((d) => {
    d.addEventListener('click', (e) => { if (e.target === d) d.close(); });
    d.querySelectorAll('[data-close]').forEach((b) => b.addEventListener('click', () => d.close()));
  });
  $('#dlgBottle').addEventListener('close', closeBottle);
  $('#welcomeGo').addEventListener('click', () => $('#dlgWelcome').close());
  $('#dlgWelcome').addEventListener('close', () => lsSet(K.welcome, true));
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
    catch (e) { setStatus(false, 'Belum tersambung ke server. ' + human(e)); }
  }

  buildWaves();
  buildMoods();
  setMood('cinta');
  updateCount();
  start();
  if (!lsGet(K.welcome, false)) openDlg($('#dlgWelcome'));
  setInterval(() => {
    if (CONFIGURED && document.visibilityState === 'visible' && navigator.onLine) { refreshSea(); loadMine().catch(() => {}); }
  }, 30000);

  if ('serviceWorker' in navigator) {
    window.addEventListener('load', () => { navigator.serviceWorker.register('/service-worker.js').catch(() => {}); });
  }
})();
