/* Love Ocean: akun opsional. Pengguna tetap anonim; akun bisa disimpan dengan email (kode verifikasi),
   atau masuk ke akun yang sudah ada. Memakai jembatan window.LO dari app.js. */
(() => {
  'use strict';
  const LO = window.LO;
  if (!LO) return;
  const $ = (s) => document.querySelector(s);
  let mode = 'save';   // 'save' = simpan akun anonim ini, 'login' = masuk ke akun yang sudah ada
  let email = '';
  let coolTimer = null;

  const logged = () => {
    const s = LO.session;
    return !!(s && s.user && s.user.email && s.user.is_anonymous !== true);
  };
  function errText(e) {
    const m = ((e && e.message) || '') + ' ' + ((e && e.code) || '');
    if (/over_email_send_rate_limit|rate limit|only request this after|too many/i.test(m)) return 'Terlalu banyak permintaan. Tunggu beberapa menit lalu coba lagi.';
    if (/email.*(invalid|valid)|validation/i.test(m)) return 'Alamat email tidak valid.';
    if (/otp_expired|expired|invalid|token/i.test(m)) return 'Kode salah atau sudah kedaluwarsa. Periksa kodenya atau kirim ulang.';
    if (/signup.*disabled|signups not allowed|user not found|otp_disabled/i.test(m)) return 'Email ini belum punya akun. Pilih "Simpan akun ini" untuk mendaftarkannya.';
    return LO.human(e);
  }
  const exists = (e) => /already|exists|registered|email_exists|not unique|duplicate/i.test(((e && e.message) || '') + ' ' + ((e && e.code) || ''));
  const setErr = (t) => { $('#acctErr').textContent = t || ''; };

  /* ---------- bagian akun di dialog Info ---------- */
  function paintInfo() {
    const box = $('#acctText');
    const btn = $('#btnAcct');
    const sw = $('#btnAcctLogin');
    box.textContent = '';
    if (logged()) {
      box.appendChild(document.createTextNode('Akunmu tersimpan: '));
      const b = document.createElement('span');
      b.className = 'acct-email';
      b.textContent = LO.session.user.email;
      box.appendChild(b);
      box.appendChild(document.createTextNode('. Masuk dengan email yang sama di perangkat lain untuk membuka botolmu.'));
      btn.textContent = 'Keluar';
      sw.hidden = true;
    } else {
      box.textContent = 'Kamu memakai akun anonim di perangkat ini. Simpan akunmu dengan email supaya botol dan percakapanmu tidak hilang saat berganti perangkat atau data browser terhapus. Pesanmu tetap anonim.';
      btn.textContent = 'Simpan akunku';
      sw.hidden = false;
    }
  }

  /* ---------- dialog akun ---------- */
  function showStep(n) {
    $('#acctStep1').hidden = n !== 1;
    $('#acctStep2').hidden = n !== 2;
    setErr('');
  }
  function paintMode() {
    const save = mode === 'save';
    $('#tAccount').textContent = save ? 'Simpan akunku' : 'Masuk ke akunmu';
    $('#acctIntro').textContent = save
      ? 'Masukkan email. Kami kirim kode verifikasi, tanpa password. Botol yang sudah kamu punya ikut tersimpan.'
      : 'Masukkan email akun yang sudah kamu simpan. Kami kirim kode masuk.';
    $('#acctWarn').hidden = save;
    $('#acctSwitch').textContent = save ? 'Sudah punya akun? Masuk' : 'Belum punya akun? Simpan akun ini';
  }
  function openAcct(m) {
    mode = m;
    email = '';
    $('#acctEmail').value = '';
    $('#acctCode').value = '';
    paintMode();
    showStep(1);
    LO.openDlg($('#dlgAccount'));
    setTimeout(() => { try { $('#acctEmail').focus(); } catch (e) { /* abaikan */ } }, 60);
  }
  function cooldown(sec) {
    clearInterval(coolTimer);
    const b = $('#acctResend');
    let left = sec;
    b.disabled = true;
    const tick = () => {
      if (left <= 0) { clearInterval(coolTimer); b.disabled = false; b.textContent = 'Kirim ulang kode'; return; }
      b.textContent = 'Kirim ulang kode (' + left + ')';
      left--;
    };
    tick();
    coolTimer = setInterval(tick, 1000);
  }
  async function requestCode() {
    const v = $('#acctEmail').value.trim().toLowerCase();
    if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(v)) { setErr('Alamat email tidak valid.'); return; }
    email = v;
    const btn = $('#acctSend');
    btn.disabled = true;
    setErr('');
    try {
      if (mode === 'save') {
        try { await LO.authReq('PUT', 'user', { email }, true); }
        catch (e) {
          if (exists(e)) { mode = 'login'; paintMode(); setErr('Email ini sudah terdaftar. Kami kirim kode masuk.'); await LO.authReq('POST', 'otp', { email, create_user: false }); }
          else throw e;
        }
      } else {
        await LO.authReq('POST', 'otp', { email, create_user: false });
      }
      $('#acctSent').textContent = 'Kode dikirim ke ' + email + '. Periksa kotak masuk dan folder spam.';
      showStep(2);
      cooldown(60);
      $('#acctCode').value = '';
      setTimeout(() => { try { $('#acctCode').focus(); } catch (e) { /* abaikan */ } }, 60);
    } catch (e) { setErr(errText(e)); }
    finally { btn.disabled = false; }
  }
  async function resend() {
    setErr('');
    try {
      if (mode === 'save') await LO.authReq('PUT', 'user', { email }, true);
      else await LO.authReq('POST', 'otp', { email, create_user: false });
      cooldown(60);
    } catch (e) { setErr(errText(e)); }
  }
  async function verify() {
    const token = $('#acctCode').value.replace(/\D/g, '');
    if (token.length < 6) { setErr('Masukkan kode dari email (6 angka atau lebih).'); return; }
    const btn = $('#acctVerify');
    btn.disabled = true;
    setErr('');
    try {
      const type = mode === 'save' ? 'email_change' : 'email';
      const data = await LO.authReq('POST', 'verify', { type, email, token });
      if (data && data.access_token) LO.setSession(data);
      else {
        const u = await LO.authReq('GET', 'user', null, true);
        const s = LO.session; s.user = u; LO.setSession(s);
      }
      LO.afterAuth();
      $('#dlgAccount').close();
      paintInfo();
      LO.toast(mode === 'save' ? 'Akunmu tersimpan. Masuk dengan email ini di perangkat lain.' : 'Berhasil masuk.', 4200);
    } catch (e) { setErr(errText(e)); }
    finally { btn.disabled = false; }
  }

  /* ---------- event ---------- */
  $('#btnAcct').addEventListener('click', async () => {
    if (logged()) {
      if (!confirm('Keluar dari akun ini di perangkat ini? Botolmu tetap tersimpan di akun.')) return;
      $('#dlgInfo').close();
      await LO.signOut();
      paintInfo();
      LO.toast('Kamu sudah keluar. Sekarang memakai akun anonim baru.', 4200);
    } else { $('#dlgInfo').close(); openAcct('save'); }
  });
  $('#btnAcctLogin').addEventListener('click', () => { $('#dlgInfo').close(); openAcct('login'); });
  $('#btnInfo').addEventListener('click', paintInfo);
  $('#acctSwitch').addEventListener('click', () => { mode = mode === 'save' ? 'login' : 'save'; paintMode(); showStep(1); });
  $('#acctSend').addEventListener('click', requestCode);
  $('#acctEmail').addEventListener('keydown', (e) => { if (e.key === 'Enter') { e.preventDefault(); requestCode(); } });
  $('#acctVerify').addEventListener('click', verify);
  $('#acctCode').addEventListener('input', () => { const el = $('#acctCode'); el.value = el.value.replace(/\D/g, '').slice(0, 10); });
  $('#acctCode').addEventListener('keydown', (e) => { if (e.key === 'Enter') { e.preventDefault(); verify(); } });
  $('#acctResend').addEventListener('click', resend);
  $('#acctChange').addEventListener('click', () => showStep(1));
  $('#dlgAccount').addEventListener('close', () => clearInterval(coolTimer));
  paintInfo();
})();
