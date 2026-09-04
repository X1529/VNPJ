// ════════════════════════════════════════════════════════════════════
// shared-auth.js — โมดูลล็อกอินร่วม (Single Source of Truth)
// ใช้งานทั้งหน้า home และ dashboard เพื่อให้ล็อกอินเป็นหนึ่งเดียว:
//   - initGoogle: ดึง Client ID จาก /api/config แล้ว init Google Identity Services
//   - showLogin: เปิดป๊อปอัป/Modal ล็อกอิน Google
//   - getMe: ตรวจสอบผู้ใช้ปัจจุบันผ่าน session (/api/me)
//   - logout: เรียก /api/logout แล้ว reload
// Session ใช้ cookie เดียวกัน (same-origin) จึงสถานะตรงกันทุกหน้า
// ════════════════════════════════════════════════════════════════════

(function () {
  const API_BASE = window.location.origin;

  let gsiReady = false;
  let clientId = null;

  function getOverlay() {
    // ใช้ modal ที่มีอยู่ใน dashboard.html ถ้ามี มิฉะนั้นสร้างใหม่ (สำหรับ home)
    return document.getElementById('login-modal-overlay') ||
           document.getElementById('google-login-overlay');
  }

  function ensureModal() {
    let overlay = getOverlay();
    if (overlay) return overlay;

    overlay = document.createElement('div');
    overlay.id = 'google-login-overlay';
    overlay.className = 'modal-overlay hidden';
    overlay.innerHTML =
      '<div class="modal-box" role="dialog" aria-modal="true" style="text-align:center;">' +
        '<div class="modal-icon info"><i class="bi bi-google"></i></div>' +
        '<h3 class="modal-title">เข้าสู่ระบบ</h3>' +
        '<p class="modal-message">กรุณาล็อกอินด้วยบัญชี Google เพื่อใช้งาน</p>' +
        '<div id="google-signin-btn" style="display:flex; justify-content:center; margin-top:16px;"></div>' +
      '</div>';
    document.body.appendChild(overlay);
    return overlay;
  }

  async function initGoogle() {
    if (gsiReady) return;
    if (typeof google === 'undefined' || !google.accounts) {
      // รอสคริปต์ GIS โหลด (async defer) แล้วลองใหม่
      setTimeout(initGoogle, 300);
      return;
    }
    try {
      const cfg = await fetch(`${API_BASE}/api/config`).then(r => r.json());
      clientId = cfg.googleClientId;
      if (!clientId) return;

      google.accounts.id.initialize({
        client_id: clientId,
        callback: handleCredential
      });
      const btn = document.getElementById('google-signin-btn');
      if (btn) {
        google.accounts.id.renderButton(btn, { theme: 'outline', size: 'large', width: 260 });
      }
      gsiReady = true;
    } catch (e) {
      console.error('Google init error', e);
    }
  }

  async function handleCredential(response) {
    try {
      const res = await fetch(`${API_BASE}/api/auth/google`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ credential: response.credential })
      });
      if (!res.ok) throw new Error('Google login failed');
      const overlay = getOverlay();
      if (overlay) overlay.classList.add('hidden');
      window.dispatchEvent(new CustomEvent('auth:changed'));
      window.location.reload(); // รีเฟรชเพื่อโหลดหน้าด้วย session ใหม่
    } catch (e) {
      alert('ล็อกอินด้วย Google ไม่สำเร็จ');
    }
  }

  function showLogin() {
    const overlay = ensureModal();
    initGoogle();
    overlay.classList.remove('hidden');
  }

  async function getMe() {
    try {
      const res = await fetch(`${API_BASE}/api/me`);
      if (!res.ok) return null;
      return await res.json();
    } catch (_) {
      return null;
    }
  }

  function logout(redirectTo) {
    // ใช้ keepalive เพื่อให้ POST ยังส่งไปถึงแม้กำลัง navigate หน้าใหม่
    // (ป้องกันกรณีตั้ง window.location แล้ว request ถูกยกเลิก → session ไม่ถูกทำลาย)
    try {
      fetch(`${API_BASE}/api/logout`, { method: 'POST', keepalive: true });
    } catch (_) { /* ไม่สำคัญ */ }
    window.dispatchEvent(new CustomEvent('auth:changed'));
    // logout จริง (เคลียร์ session) แล้วไปหน้าที่ระบุ — ค่าเริ่มเป็น reload หน้าปัจจุบัน
    if (redirectTo) window.location.href = redirectTo;
    else window.location.reload();
  }

  window.Auth = { showLogin, getMe, logout, initGoogle, ensureModal };

  // ─── Return-to-Source Flow ("เข้าจากทางไหน ออกไปทางนั้น") ──────────
  // ใช้ sessionStorage (per-tab) จำหน้าต้นทางก่อนเปลี่ยนหน้า (Browse/Studio/Detail/Player)
  const VN_RETURN_KEY = 'vn_return_url';
  function setReturnContext(customUrl = null) {
    try {
      const returnUrl = customUrl || window.location.href;
      sessionStorage.setItem(VN_RETURN_KEY, returnUrl);
    } catch (_) { /* storage อาจใช้ไม่ได้ (private mode) — ข้าม */ }
  }
  function getReturnContext(fallbackUrl = '/home.html') {
    try {
      const returnUrl = sessionStorage.getItem(VN_RETURN_KEY);
      return returnUrl || fallbackUrl;
    } catch (_) {
      return fallbackUrl;
    }
  }
  function navigateBackToSource(fallbackUrl = '/home.html') {
    const targetUrl = getReturnContext(fallbackUrl);
    try { sessionStorage.removeItem(VN_RETURN_KEY); } catch (_) {}
    window.location.href = targetUrl;
  }
  window.setReturnContext = setReturnContext;
  window.getReturnContext = getReturnContext;
  window.navigateBackToSource = navigateBackToSource;
  window.ReturnNav = { set: setReturnContext, get: getReturnContext, back: navigateBackToSource };
})();
