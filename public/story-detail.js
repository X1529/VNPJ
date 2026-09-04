// ════════════════════════════════════════════════════════════════════
// story-detail.js — หน้ารายละเอียดเรื่อง (สาธารณะ)
//   - โหลดเรื่อง + รายตอนที่เผยแพร่ (is_exported = 1) ผ่าน GET /api/stories/:id?public=1
//   - ผู้เล่นกด "เล่นตอนนี้" จากรายตอน → เข้าเกม (ต้องล็อกอิน)
// ════════════════════════════════════════════════════════════════════

const API_BASE = '';
const params = new URLSearchParams(window.location.search);
const storyId = params.get('id');

const loadingEl = document.getElementById('detailLoading');
const errorEl   = document.getElementById('detailError');
const errorMsg  = document.getElementById('detailErrorMsg');
const contentEl = document.getElementById('detailContent');
const coverEl   = document.getElementById('detailCover');
const titleEl   = document.getElementById('detailTitle');
const descEl    = document.getElementById('detailDesc');
const listEl    = document.getElementById('episodeList');
const emptyEl   = document.getElementById('episodeEmpty');

function escapeHtml(str) {
  return String(str)
    .replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;').replace(/'/g, '&#39;');
}

// ปลอดภัยสำหรับนำค่าไปใส่ใน string literal ของ JS (เช่น onclick="fn('...')")
function jsStr(str) {
  return String(str == null ? '' : str)
    .replace(/\\/g, '\\\\')
    .replace(/'/g, "\\'")
    .replace(/"/g, '&quot;')
    .replace(/&/g, '&amp;')
    .replace(/\r/g, '\\r')
    .replace(/\n/g, '\\n');
}

// กฎ: ต้องล็อกอินก่อนเล่นเกม
// Return-to-Source: จำ Detail ไว้ก่อนเข้า Player เพื่อให้จบเกม/กดออกกลับมาหน้านี้
async function playStory(url) {
  const me = await Auth.getMe();
  if (me) {
    if (typeof setReturnContext === 'function') setReturnContext(window.location.href);
    window.location.href = url;
    return;
  }
  try { sessionStorage.setItem('pendingGame', url); } catch (_) {}
  Auth.showLogin();
}

function goBackToSource(fallbackUrl = '/home.html') {
  if (typeof navigateBackToSource === 'function') navigateBackToSource(fallbackUrl);
  else window.location.href = fallbackUrl;
}

async function loadDetail() {
  if (!storyId) {
    errorMsg.textContent = 'ไม่ระบุเรื่อง';
    loadingEl.classList.add('hidden');
    errorEl.classList.remove('hidden');
    return;
  }
  try {
    const res = await fetch(`${API_BASE}/api/stories/${encodeURIComponent(storyId)}?public=1`);
    if (!res.ok) throw new Error('Story not found');
    const story = await res.json();

    // ส่วนหัว
    if (story.cover_url) {
      coverEl.innerHTML = `<img src="${escapeHtml(story.cover_url)}" alt="${escapeHtml(story.title || '')}" onerror="this.parentNode.innerHTML='<i class=&quot;bi bi-image&quot;></i>'">`;
    } else {
      coverEl.innerHTML = '<i class="bi bi-image"></i>';
    }
    titleEl.textContent = story.title || 'ไม่ระบุชื่อ';
    descEl.textContent = story.description || 'ยังไม่มีคำอธิบาย';

    // รายตอน (is_exported = 1 เท่านั้น)
    const eps = (story.chapters || []);
    if (!eps.length) {
      listEl.innerHTML = '';
      emptyEl.classList.remove('hidden');
    } else {
      emptyEl.classList.add('hidden');
      listEl.innerHTML = eps.map((ep) => {
        const playUrl = `/game.html?story=${encodeURIComponent(storyId)}&chapter=${encodeURIComponent(ep.chapter_number)}`;
        return `
          <div class="episode-row">
            <div class="episode-no">${ep.chapter_number}</div>
            <div class="episode-info">
              <div class="episode-title">${escapeHtml(ep.title || ('ตอนที่ ' + ep.chapter_number))}</div>
              <div class="episode-sub">ตอนที่ ${ep.chapter_number}</div>
            </div>
            <button class="btn-primary" onclick="playStory('${jsStr(playUrl)}')">
              <i class="bi bi-play-fill"></i> เล่นตอนนี้
            </button>
          </div>`;
      }).join('');
    }

    loadingEl.classList.add('hidden');
    contentEl.classList.remove('hidden');
  } catch (err) {
    errorMsg.textContent = 'ไม่พบเรื่องนี้ หรือยังไม่เผยแพร่';
    loadingEl.classList.add('hidden');
    errorEl.classList.remove('hidden');
  }
}

// ─── Settings (ค่าตั้ง) + Auth ──────────────────────────────────────
(function setupSettings() {
  const settingsBtn  = document.getElementById('settingsBtn');
  const settingsMenu = document.getElementById('settingsMenu');
  const loginBtn     = document.getElementById('loginBtn');
  const logoutBtn    = document.getElementById('logoutBtn');
  const studioLink   = document.getElementById('studioLink');
  if (!settingsBtn) return;

  async function refreshAuthUI() {
    const user = await Auth.getMe();
    const loggedIn = !!user;
    if (loginBtn)  loginBtn.classList.toggle('hidden', loggedIn);
    if (logoutBtn) logoutBtn.classList.toggle('hidden', !loggedIn);
  }

  settingsBtn.addEventListener('click', (e) => {
    e.stopPropagation();
    settingsMenu.classList.toggle('hidden');
  });
  document.addEventListener('click', (e) => {
    if (!settingsMenu.contains(e.target) && e.target !== settingsBtn) {
      settingsMenu.classList.add('hidden');
    }
  });
  if (loginBtn)  loginBtn.addEventListener('click', () => Auth.showLogin());
  if (logoutBtn) logoutBtn.addEventListener('click', () => Auth.logout('/home.html'));
  if (studioLink) studioLink.addEventListener('click', (e) => { e.preventDefault(); if (typeof setReturnContext === 'function') setReturnContext(window.location.href); window.location.href = '/dashboard'; });

  window.addEventListener('auth:changed', refreshAuthUI);
  refreshAuthUI();
})();

// ถ้ามีเกมที่รอหลังล็อกอินสำเร็จ → เข้าไปเลย
(async () => {
  const pending = sessionStorage.getItem('pendingGame');
  if (pending) {
    sessionStorage.removeItem('pendingGame');
    const me = await Auth.getMe();
    if (me) { if (typeof setReturnContext === 'function') setReturnContext(window.location.href); window.location.href = pending; return; }
  }
  loadDetail();
})();
