/* Love Ocean: halaman Botolku (daftar percakapan layar penuh).
   Dimuat setelah app.js dan memakai jembatan window.LO yang disediakan app.js. */
(() => {
  'use strict';
  const LO = window.LO;
  if (!LO) return; // app.js tidak termuat: tombol Botolku memakai tampilan lama
  const $ = (s) => document.querySelector(s);
  const SVGNS = 'http://www.w3.org/2000/svg';
  const DAYS_AGO = 7;

  let isOpen = false;
  let pushed = false;
  let pollTimer = null;

  function el(tag, cls, text) {
    const n = document.createElement(tag);
    if (cls) n.className = cls;
    if (text != null) n.textContent = text;
    return n;
  }
  function icon(id) {
    const s = document.createElementNS(SVGNS, 'svg');
    s.setAttribute('class', 'ic');
    s.setAttribute('viewBox', '0 0 24 24');
    s.setAttribute('aria-hidden', 'true');
    const u = document.createElementNS(SVGNS, 'use');
    u.setAttribute('href', '#' + id);
    s.appendChild(u);
    return s;
  }
  // Tombol hapus langsung di daftar. Dua langkah supaya tidak tertekan tidak sengaja.
  function delBtn(b) {
    const own = b.author === LO.myId();
    const label = own ? 'Hapus botol' : 'Lepas botol';
    const btn = el('button', 'c-del');
    btn.type = 'button';
    btn.setAttribute('aria-label', label);
    btn.title = label;
    let armed = false, timer;
    function reset() { armed = false; btn.classList.remove('armed'); btn.textContent = ''; btn.appendChild(icon('i-trash')); }
    reset();
    btn.addEventListener('click', async (ev) => {
      ev.stopPropagation();
      if (!armed) {
        armed = true;
        btn.classList.add('armed');
        btn.textContent = own ? 'Hapus?' : 'Lepas?';
        timer = setTimeout(reset, 3000);
        return;
      }
      clearTimeout(timer);
      btn.disabled = true;
      try {
        await LO.removeBottle(b);
        LO.toast(own ? 'Botol dihapus.' : 'Botol dilepas kembali ke laut.');
      } catch (err) {
        LO.toast(LO.human(err), 4500);
        btn.disabled = false;
        reset();
        return;
      }
      refresh(false);
    });
    return btn;
  }
  const pad = (n) => (n < 10 ? '0' : '') + n;
  function stamp(ts) {
    const d = new Date(ts);
    if (isNaN(d)) return '';
    const hm = pad(d.getHours()) + ':' + pad(d.getMinutes());
    const day = (t) => new Date(t.getFullYear(), t.getMonth(), t.getDate());
    const diff = Math.round((day(new Date()) - day(d)) / 864e5);
    if (diff <= 0) return hm;
    if (diff === 1) return 'kemarin ' + hm;
    try {
      if (diff < DAYS_AGO) {
        const w = d.toLocaleDateString('id-ID', { weekday: 'long' });
        return w.charAt(0).toUpperCase() + w.slice(1);
      }
      return d.toLocaleDateString('id-ID', { day: 'numeric', month: 'short' });
    } catch (e) { return ''; }
  }

  function entries() {
    const me = LO.myId();
    const lastBy = {};
    const otherNick = {};
    // balasan diurutkan terbaru dulu, jadi yang pertama ditemukan adalah yang terakhir
    LO.replies.forEach((r) => {
      if (!lastBy[r.bottle_id]) lastBy[r.bottle_id] = r;
      if (r.author !== me && !(r.bottle_id in otherNick)) otherNick[r.bottle_id] = r.nickname || '';
    });
    return LO.bottles.map((b) => {
      const mine = b.author === me;
      const last = lastBy[b.id];
      let name;
      if (b.hidden) name = 'Sedang ditinjau';
      else if (mine) name = b.caught_by ? (otherNick[b.id] || 'Seseorang') : 'Botol hanyut';
      else name = b.nickname || 'Seseorang di tepi laut';
      let text, ts;
      if (last) { text = (last.author === me ? 'Kamu: ' : '') + (last.deleted_at ? 'Pesan dihapus' : (last.message || '')); ts = last.created_at; }
      else { text = (mine ? 'Kamu: ' : '') + (b.message || ''); ts = b.created_at; }
      return { b, name, text: text.replace(/\s+/g, ' '), ts, unread: LO.unreadFor(b.id), stat: LO.statusOf(b).label };
    }).sort((x, y) => Date.parse(y.ts) - Date.parse(x.ts));
  }

  function render() {
    const box = $('#mineChats');
    const keep = box.scrollTop;
    box.textContent = '';
    const list = entries();
    if (!list.length) {
      box.appendChild(el('p', 'mine-empty', 'Belum ada botol. Tekan tombol hati di bawah untuk menulis pesan pertamamu, atau tutup halaman ini dan tekan "Ambil" untuk menemukan botol orang lain.'));
      return;
    }
    list.forEach((e) => {
      const row = el('div', 'chat-row' + (e.unread ? ' unread' : ''));
      const open = el('button', 'c-open');
      open.type = 'button';
      row.style.setProperty('--mood', LO.moodOf(e.b.mood).color);
      const ava = el('span', 'c-ava');
      ava.setAttribute('aria-hidden', 'true');
      ava.appendChild(icon('i-heart'));
      const main = el('span', 'c-main');
      const top = el('span', 'c-top');
      top.appendChild(el('span', 'c-name', e.name));
      top.appendChild(el('span', 'c-time', stamp(e.ts)));
      const bot = el('span', 'c-bot');
      bot.appendChild(el('span', 'c-prev', e.text));
      if (e.unread) bot.appendChild(el('b', 'c-badge', e.unread > 9 ? '9+' : String(e.unread)));
      main.appendChild(top);
      main.appendChild(bot);
      main.appendChild(el('span', 'c-stat', e.stat));
      open.appendChild(ava);
      open.appendChild(main);
      open.addEventListener('click', () => LO.openBottle(e.b));
      row.appendChild(open);
      row.appendChild(delBtn(e.b));
      box.appendChild(row);
    });
    box.scrollTop = keep;
  }

  async function refresh(showError) {
    try { await LO.loadMine(); if (isOpen) render(); }
    catch (e) {
      if (showError && isOpen) {
        const box = $('#mineChats');
        box.textContent = '';
        box.appendChild(el('p', 'mine-empty', LO.human(e)));
      }
    }
  }

  function open() {
    if (isOpen) return;
    isOpen = true;
    $('#pageMine').hidden = false;
    if (!pushed) { try { history.pushState({ mine: 1 }, ''); pushed = true; } catch (e) { /* abaikan */ } }
    const box = $('#mineChats');
    box.textContent = '';
    box.appendChild(el('p', 'mine-empty', 'Memuat botolmu...'));
    // tampilkan data yang sudah ada dulu bila ada, lalu segarkan
    if (LO.bottles.length) render();
    refresh(true);
    clearInterval(pollTimer);
    pollTimer = setInterval(() => { if (document.visibilityState === 'visible') refresh(false); }, 15000);
  }
  function hide() {
    if (!isOpen) return;
    isOpen = false;
    $('#pageMine').hidden = true;
    clearInterval(pollTimer);
    pollTimer = null;
  }
  function close() {
    hide();
    if (pushed) { pushed = false; try { history.back(); } catch (e) { /* abaikan */ } }
  }

  $('#mineBack').addEventListener('click', close);
  $('#mineFab').addEventListener('click', () => {
    const wasPushed = pushed;
    close();
    if (!wasPushed) { LO.openThrow(); return; }
    // Tunggu riwayat selesai mundur supaya entri dialog baru tidak ikut terhapus.
    let done = false;
    const go = () => { if (done) return; done = true; LO.openThrow(); };
    window.addEventListener('popstate', () => setTimeout(go, 0), { once: true });
    setTimeout(go, 400);
  });
  window.addEventListener('popstate', () => {
    if (window.LOBack && window.LOBack.swallow()) return;
    if (isOpen) { pushed = false; hide(); }
  });
  // setelah percakapan ditutup, kembali ke daftar dan perbarui tanda balasan baru
  $('#dlgBottle').addEventListener('close', () => { if (isOpen) { render(); refresh(false); } });

  window.LOMine = { open, close, refresh: () => refresh(false) };
})();
