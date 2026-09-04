// ─── Auth Helper (Google Login) ─────────────────────────────────────────────
// ล็อกอินผ่าน Google Identity Services: ฝั่ง client ส่ง credential (JWT) มาให้
// /api/auth/google ถอดรหัสแล้วหา/สร้าง user จาก google_id เก็บ session.userId
// getCurrentUser คืนผู้ใช้ปัจจุบันจาก session (ตอน dev มี mock user id=1 ด้วย)

const crypto = require('crypto');
const session = require('express-session');
const { db } = require('./db');

// Session middleware — เขื่อนต่อก่อน route ทั้งหมด
// ⚠️ ใน production ต้องตั้ง SESSION_SECRET ใน .env มิฉะนั้นจะหยุดทำงาน (กัน forge session)
const SESSION_SECRET = process.env.SESSION_SECRET;
if (process.env.NODE_ENV === 'production' && !SESSION_SECRET) {
  throw new Error('SECURITY: ไม่พบ SESSION_SECRET ใน production — หยุดทำงานเพื่อป้องกัน session forge');
}
function sessionMiddleware() {
  return session({
    secret: SESSION_SECRET || 'dev-secret-change-me',
    resave: false,
    saveUninitialized: false,
    cookie: {
      httpOnly: true,
      sameSite: 'lax',
      secure: process.env.NODE_ENV === 'production',
      maxAge: 1000 * 60 * 60 * 24 // 1 วัน
    }
  });
}

// ป้องกันหน้าเว็บ: ไม่ล็อกอิน → redirect ไป home
function requirePageAuth(req, res, next) {
  if (req.session && req.session.userId) return next();
  return res.redirect('/home.html');
}

// ป้องกัน API: ไม่ล็อกอิน → 401 (สำหรับ write endpoints)
function requireApiAuth(req, res, next) {
  if (req.session && req.session.userId) return next();
  return res.status(401).json({ error: 'Unauthorized' });
}

// คืนค่า user object ของผู้ใช้ตาม user_id (ตอน dev ยังมี mock user id=1)
async function getCurrentUser(userId = 1) {
  const [rows] = await db.query(
    'SELECT user_id, email, display_name, avatar_url, google_id FROM users WHERE user_id = ?',
    [userId]
  );
  return rows[0] || null;
}

// ค้นหาผู้ใช้จาก google_id (ใช้ตอนทำ Google Login จริง)
async function findUserByGoogleId(googleId) {
  const [rows] = await db.query(
    'SELECT user_id, email, display_name, avatar_url FROM users WHERE google_id = ?',
    [googleId]
  );
  return rows[0] || null;
}

// สร้างผู้ใช้ใหม่จากข้อมูล Google (ใช้ตอนทำ Google Login จริง)
async function createUserFromGoogle({ email, googleId, displayName, avatarUrl }) {
  const [result] = await db.query(
    `INSERT INTO users (email, google_id, display_name, avatar_url)
     VALUES (?, ?, ?, ?)
     ON DUPLICATE KEY UPDATE google_id = VALUES(google_id),
                             display_name = VALUES(display_name),
                             avatar_url = VALUES(avatar_url)`,
    [email, googleId, displayName, avatarUrl]
  );
  const userId = result.insertId || (await findUserByGoogleId(googleId))?.user_id;
  await db.query(
    `INSERT IGNORE INTO user_providers (user_id, provider_name, provider_user_id)
     VALUES (?, 'google', ?)`,
    [userId, googleId]
  );
  return userId;
}

// ─── Guest Session + Resource Ownership (Multi-tenant) ──────────────────────
// ผู้ใช้ที่ยังไม่ล็อกอิน จะได้ guest_id (cookie เดียวกัน ส่งอัตโนมัติกับทุก request)
// ผู้ใช้ที่ล็อกอิน จะได้ user_id จาก session
// ทุก API ใต้ /api จะผ่าน ownerMiddleware → ได้ req.owner { kind, id }
// การอ่าน/เขียนข้อมูลจึง scope ด้วย user_id หรือ guest_id เสมอ (Data Isolation)

function getCookie(req, name) {
  const h = req.headers.cookie;
  if (!h) return null;
  for (const part of h.split(';')) {
    const c = part.trim();
    if (c.startsWith(name + '=')) return decodeURIComponent(c.slice(name.length + 1));
  }
  return null;
}

// คืน guest_id จาก cookie หรือสร้างใหม่แล้วฝังลง cookie (httpOnly, sameSite lax)
function ensureGuestId(req, res) {
  let gid = getCookie(req, 'guest_id');
  if (!gid) {
    gid = crypto.randomUUID();
    res.cookie('guest_id', gid, {
      httpOnly: true,
      sameSite: 'lax',
      maxAge: 1000 * 60 * 60 * 24 * 365 // 1 ปี
    });
  }
  return gid;
}

// Middleware: กำหนด req.owner จาก session (user) หรือ guest cookie
function ownerMiddleware() {
  return (req, res, next) => {
    if (req.session && req.session.userId) {
      req.owner = { kind: 'user', userId: req.session.userId };
    } else {
      req.owner = { kind: 'guest', guestId: ensureGuestId(req, res) };
    }
    next();
  };
}

// SQL WHERE clause + params สำหรับกรองข้อมูลของเจ้าของปัจจุบัน
function ownerWhere(req) {
  const o = req.owner;
  if (!o) return { clause: '1=0', params: [] };
  if (o.kind === 'user') return { clause: 'user_id = ?', params: [o.userId] };
  return { clause: 'guest_id = ?', params: [o.guestId] };
}

// คอลัมน์ที่ใส่ตอน INSERT ให้ผูกกับเจ้าของปัจจุบัน
function ownerValues(req) {
  const o = req.owner;
  if (!o) return { user_id: null, guest_id: null };
  if (o.kind === 'user') return { user_id: o.userId, guest_id: null };
  return { user_id: null, guest_id: o.guestId };
}

// ตรวจสอบว่า story เป็นของเจ้าของปัจจุบัน (ใช้ก่อนสร้าง chapter/asset)
async function assertStoryOwner(req, res, storyId) {
  const o = ownerWhere(req);
  const [rows] = await db.query(
    `SELECT story_id FROM stories WHERE story_id = ? AND ${o.clause}`,
    [storyId, ...o.params]
  );
  if (!rows.length) {
    res.status(403).json({ error: 'Forbidden: story นี้ไม่ใช่ของคุณ' });
    return false;
  }
  return true;
}

// ตรวจสอบว่า chapter เป็นของเจ้าของปัจจุบัน (ใช้ก่อนแก้ไขบทสนทนา)
async function assertChapterOwner(req, res, chapterId) {
  const o = ownerWhere(req);
  const [rows] = await db.query(
    `SELECT chapter_id FROM chapters WHERE chapter_id = ? AND ${o.clause}`,
    [chapterId, ...o.params]
  );
  if (!rows.length) {
    res.status(403).json({ error: 'Forbidden: chapter นี้ไม่ใช่ของคุณ' });
    return false;
  }
  return true;
}

// ─── Data Migration: ตอน guest ลงทะเบียน → ย้ายข้อมูลมาเป็นของ user ───────────
// ย้ายแถว user_id IS NULL AND guest_id = ? ให้ผูก user_id แล้วเคลียร์ guest_id
async function migrateGuestToUser(guestId, userId) {
  if (!guestId || !userId) return;
  for (const table of ['stories', 'chapters', 'assets']) {
    await db.query(
      `UPDATE ${table} SET user_id = ?, guest_id = NULL WHERE user_id IS NULL AND guest_id = ?`,
      [userId, guestId]
    );
  }
}

module.exports = {
  sessionMiddleware,
  requirePageAuth,
  requireApiAuth,
  getCurrentUser,
  findUserByGoogleId,
  createUserFromGoogle,
  ownerMiddleware,
  ownerWhere,
  ownerValues,
  assertStoryOwner,
  assertChapterOwner,
  migrateGuestToUser
};
