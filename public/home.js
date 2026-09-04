// ════════════════════════════════════════════════════════════════════
// Visual Novel Studio — home.js
// หน้าหลัก / หน้าฟีด (Home Page / Content Feed / Browse Page)
// ดึงรายการเรื่องจาก GET /api/stories แล้วเรนเดอร์เป็น Feed ให้ผู้ใช้สำรวจ
// ════════════════════════════════════════════════════════════════════

// API base — หน้านี้รันฝั่ง client บน same-origin กับ server จึงใช้ '/api'
const API_BASE = '';

const feedEl       = document.getElementById('storyFeed');
const loadingEl    = document.getElementById('feedLoading');
const emptyEl      = document.getElementById('feedEmpty');
const errorEl      = document.getElementById('feedError');
const retryBtn     = document.getElementById('retryBtn');
const searchInput  = document.getElementById('searchInput');
const categoryTabs = document.getElementById('categoryTabs');

// สถานะภายใน (state) ของ Feed
let allStories = [];
let activeFilter = 'all';
let searchTerm = '';

// ─── ดึงข้อมูลจาก API ────────────────────────────────────────────────
async function loadStories() {
  showState('loading');
  try {
    const res = await fetch(`${API_BASE}/api/stories?discover=1`);
    if (!res.ok) throw new Error(`HTTP ${res.status}`);
    const data = await res.json();
    allStories = Array.isArray(data) ? data : [];
    renderFeed();
  } catch (err) {
    console.error('โหลด stories ไม่สำเร็จ:', err);
    showState('error');
  }
}

// ─── เรนเดอร์ Feed ตาม filter + คำค้นหา ──────────────────────────────
function renderFeed() {
  const stories = filterStories(allStories);

  if (allStories.length === 0) {
    showState('empty');
    return;
  }
  if (stories.length === 0) {
    feedEl.innerHTML = `
      <div class="home-state">
        <i class="bi bi-emoji-neutral"></i>
        <p>ไม่พบเรื่องที่ตรงกับการค้นหา</p>
      </div>`;
    return;
  }

  feedEl.innerHTML = stories.map(renderCard).join('');
  showState('feed');
}

// ─── ตรรก์กรอง (Browse) — โครงเตรียมไว้ เชื่อม logic จริงทีหลัง ────────
function filterStories(stories) {
  let list = [...stories];

  if (activeFilter === 'newest') {
    // เรียงล่าสุดก่อน (.created_at DESC จาก API อยู่แล้ว)
    list = list.slice(0, 12);
  } else if (activeFilter === 'popular') {
    // TODO: เรียงตามยอดวิว/ความนิยม (ต้องมี field เพิ่มใน DB)
    list = list.slice(0, 12);
  }

  if (searchTerm) {
    const q = searchTerm.toLowerCase();
    list = list.filter((s) =>
      (s.title || '').toLowerCase().includes(q) ||
      (s.description || '').toLowerCase().includes(q)
    );
  }

  return list;
}

// ─── สร้าง Card 1 ใบ ─────────────────────────────────────────────────
function renderCard(story) {
  const id      = story.story_id;
  const title   = escapeHtml(story.title || 'ไม่ระบุชื่อ');
  const desc    = escapeHtml(story.description || 'ยังไม่มีคำอธิบาย');
  const cover   = story.cover_url || '';
  const coverHtml = cover
    ? `<img src="${escapeHtml(cover)}" alt="${title}" loading="lazy"
            onerror="this.parentNode.innerHTML='<span class=&quot;cover-fallback&quot;><i class=&quot;bi bi-image&quot;></i></span>'">`
    : `<span class="cover-fallback"><i class="bi bi-image"></i></span>`;

  // คลิกทั้งใบ → ไปหน้ารายละเอียดเรื่อง (แสดงรายตอน + ปุ่มเล่นตอน)
  const detailUrl = `/story-detail.html?id=${encodeURIComponent(id)}`;

  return `
    <article class="story-card" data-story-id="${id}"
             onclick="goStoryDetail('${jsStr(detailUrl)}')">
      <div class="story-cover">
        ${coverHtml}
        <span class="story-badge"><i class="bi bi-chevron-right"></i> รายละเอียด</span>
      </div>
      <div class="story-body">
        <h3 class="story-title">${title}</h3>
        <p class="story-desc">${desc}</p>
      </div>
    </article>`;
}

// ─── จัดการสถานะแสดงผล ──────────────────────────────────────────────
function showState(state) {
  loadingEl.classList.toggle('hidden', state !== 'loading');
  emptyEl.classList.toggle('hidden',   state !== 'empty');
  errorEl.classList.toggle('hidden',   state !== 'error');
  feedEl.classList.toggle('hidden',    state === 'loading' || state === 'empty' || state === 'error');
}

// ─── Event Listeners ─────────────────────────────────────────────────
searchInput.addEventListener('input', (e) => {
  searchTerm = e.target.value.trim();
  renderFeed();
});

categoryTabs.addEventListener('click', (e) => {
  const btn = e.target.closest('.home-tab');
  if (!btn) return;
  activeFilter = btn.dataset.filter;
  categoryTabs.querySelectorAll('.home-tab').forEach((b) => b.classList.remove('active'));
  btn.classList.add('active');
  renderFeed();
});

retryBtn.addEventListener('click', loadStories);

// เข้าสตูดิโอ: ไปที่ dashboard (ตัว dashboard จะเช็คสิทธิ์และแสดงป็อปอัพล็อกอิน)
// Return-to-Source: จำ Browse (home) ไว้ก่อน เพื่อกดย้อนกลับจาก Studio ได้ถูก
function goStoryDetail(url) {
  if (typeof setReturnContext === 'function') setReturnContext(window.location.href);
  window.location.href = url;
}
const studioLink = document.getElementById('studioLink');
if (studioLink) {
  studioLink.addEventListener('click', (e) => {
    e.preventDefault();
    if (typeof setReturnContext === 'function') setReturnContext(window.location.href);
    window.location.href = '/dashboard';
  });
}

// ─── Utils ───────────────────────────────────────────────────────────
function escapeHtml(str) {
  return String(str)
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#39;');
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

// ─── เริ่มต้น ────────────────────────────────────────────────────────
loadStories();

// ─── Settings (ค่าตั้ง) + Auth ──────────────────────────────────────
(function setupSettings() {
  const settingsBtn  = document.getElementById('settingsBtn');
  const settingsMenu = document.getElementById('settingsMenu');
  const loginBtn     = document.getElementById('loginBtn');
  const logoutBtn    = document.getElementById('logoutBtn');
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

  if (logoutBtn) {
    logoutBtn.addEventListener('click', () => {
      settingsMenu.classList.add('hidden');
      Auth.logout();
    });
  }

  if (loginBtn) {
    loginBtn.addEventListener('click', () => {
      settingsMenu.classList.add('hidden');
      Auth.showLogin(); // ล็อกอิน Google ตรงบนหน้า home (โมดูลร่วมเดียวกับ dashboard)
    });
  }

  refreshAuthUI();
})();

// หมายเหตุ: หน้า home เป็นหน้าสาธารณะ (Browse) จึงไม่บังคับล็อกอินตอนโหลด
// การล็อกอินทำผ่านปุ่ม "ค่าตั้ง" (Auth.showLogin) ซึ่งใช้โมดูลร่วมเดียวกับ dashboard
// ทำให้ login เป็นหนึ่งเดียวกันทุกหน้า
