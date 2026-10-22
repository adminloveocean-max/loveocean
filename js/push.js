/* Love Ocean: notifikasi balasan (Web Push). Memakai jembatan window.LO dari app.js.
   Notifikasi tidak memuat isi pesan; hanya memberi tahu ada balasan baru. */
(() => {
  'use strict';
  const LO = window.LO;
  if (!LO) return;
  const KEY = (window.LO_CONFIG || {}).VAPID_PUBLIC_KEY || '';
  const $ = (s) => document.querySelector(s);
  const box = $('#pushBox');
  if (!box || !KEY) return; // kunci belum diisi di config.js: fitur disembunyikan

  const supported = 'serviceWorker' in navigator && 'PushManager' in window && 'Notification' in window;
  const keyBytes = (() => {
    const s = KEY.replace(/-/g, '+').replace(/_/g, '/');
    const bin = atob(s + '='.repeat((4 - (s.length % 4)) % 4));
    return Uint8Array.from(bin, (c) => c.charCodeAt(0));
  })();

  async function currentSub() {
    if (!supported) return null;
    try { return await (await navigator.serviceWorker.ready).pushManager.getSubscription(); } catch (e) { return null; }
  }
  async function register(sub) {
    const j = sub.toJSON();
    await LO.rpc('push_register', {
      p_endpoint: j.endpoint,
      p_p256dh: (j.keys && j.keys.p256dh) || null,
      p_auth: (j.keys && j.keys.auth) || null
    });
  }

  async function paint() {
    const text = $('#pushText');
    const btn = $('#btnPush');
    box.hidden = false;
    btn.hidden = false;
    btn.disabled = false;
    if (!supported) {
      text.textContent = 'Browser ini belum mendukung notifikasi. Di iPhone, tambahkan Love Ocean ke Layar Utama lebih dulu, lalu buka dari sana.';
      btn.hidden = true;
      return;
    }
    if (Notification.permission === 'denied') {
      text.textContent = 'Notifikasi diblokir untuk Love Ocean. Izinkan lewat pengaturan situs atau pengaturan aplikasi di HP-mu, lalu buka halaman ini lagi.';
      btn.hidden = true;
      return;
    }
    const sub = Notification.permission === 'granted' ? await currentSub() : null;
    if (sub) {
      text.textContent = 'Notifikasi balasan aktif di perangkat ini. Isinya tidak memuat pesanmu.';
      btn.textContent = 'Matikan notifikasi';
      btn.dataset.on = '1';
    } else {
      text.textContent = 'Dapatkan pemberitahuan saat seseorang membalas botolmu, walau aplikasi sedang ditutup. Isinya tidak memuat pesanmu.';
      btn.textContent = 'Aktifkan notifikasi';
      btn.dataset.on = '';
    }
  }

  async function enable() {
    const perm = await Notification.requestPermission();
    if (perm !== 'granted') { LO.toast('Izin notifikasi tidak diberikan.'); return; }
    const reg = await navigator.serviceWorker.ready;
    let sub = await reg.pushManager.getSubscription();
    if (sub) {
      // Langganan lama dengan kunci lain (mis. kunci diganti) tidak bisa dipakai.
      const k = sub.options && sub.options.applicationServerKey;
      if (k && new Uint8Array(k).join() !== keyBytes.join()) { await sub.unsubscribe(); sub = null; }
    }
    if (!sub) sub = await reg.pushManager.subscribe({ userVisibleOnly: true, applicationServerKey: keyBytes });
    await register(sub);
    LO.toast('Notifikasi balasan diaktifkan.');
  }
  async function disable() {
    const sub = await currentSub();
    if (!sub) return;
    try { await LO.rpc('push_unregister', { p_endpoint: sub.endpoint }); } catch (e) { /* tetap lanjut mematikan di perangkat */ }
    await sub.unsubscribe();
    LO.toast('Notifikasi dimatikan.');
  }

  let busy = false;
  $('#btnPush').addEventListener('click', async () => {
    if (busy) return;
    busy = true;
    $('#btnPush').disabled = true;
    try { if ($('#btnPush').dataset.on) await disable(); else await enable(); }
    catch (e) { LO.toast(LO.human(e), 5000); }
    finally { busy = false; await paint(); }
  });

  // Hubungkan ulang perangkat ini ke akun yang sedang aktif (mis. setelah masuk dengan email).
  async function sync() {
    if (!supported || Notification.permission !== 'granted') return;
    const sub = await currentSub();
    if (sub) { try { await register(sub); } catch (e) { /* coba lagi lain kali */ } }
  }
  const afterAuth = LO.afterAuth;
  LO.afterAuth = function () { afterAuth.apply(LO, arguments); setTimeout(sync, 1500); };
  // Keluar dari akun: perangkat ini berhenti menerima notifikasi untuk akun tersebut.
  const signOut = LO.signOut;
  LO.signOut = async function () {
    try { await disable(); } catch (e) { /* abaikan */ }
    return signOut.apply(LO, arguments);
  };

  new MutationObserver(() => { if ($('#dlgInfo').open) paint(); }).observe($('#dlgInfo'), { attributes: true, attributeFilter: ['open'] });

  // Ketukan pada notifikasi membuka daftar Botolku.
  const openMine = () => { if (window.LOMine) window.LOMine.open(); };
  if (/[?&]botolku=1\b/.test(location.search)) {
    try { history.replaceState(null, '', location.pathname); } catch (e) { /* abaikan */ }
    setTimeout(openMine, 600);
  }
  if ('serviceWorker' in navigator) {
    navigator.serviceWorker.addEventListener('message', (e) => { if (e.data && e.data.type === 'open-mine') openMine(); });
  }

  window.addEventListener('load', () => setTimeout(sync, 3000));
})();
