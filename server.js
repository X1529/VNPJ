// ─── Visual Novel Studio — Server Entrypoint ──────────────────────────────
// โครงสร้าง:
//   src/config.js            ค่ากลาง (PORT, BASE_URL, paths)
//   src/db.js                MySQL pool + initDatabase
//   src/upload.js            multer config (จำกัดขนาด/ชนิดไฟล์)
//   src/helpers.js           ฟังก์ชันกลาง (path safety, asset normalize)
//   src/routes/*.js          API routes แยกตาม resource
//   dialogue-store.js        อ่าน/เขียนไฟล์บทสนทนา data/dialogues/

require('dotenv').config();
const express = require('express');
const cors = require('cors');
const compression = require('compression');
const path = require('path');
const multer = require('multer');

const { PORT, BASE_URL, publicDir } = require('./src/config');
const { initDatabase } = require('./src/db');
const { MulterFileTypeError } = require('./src/upload');
const { sessionMiddleware, ownerMiddleware } = require('./src/auth');

const app = express();

// ─── Middleware ────────────────────────────────────────────────────────────

// จำกัดขนาด body ป้องกัน DoS ด้วย JSON ยักษ์ (โดยเฉพาะ /bulk save)
app.use(express.json({ limit: '10mb' }));

// CORS: เปิดเฉพาะ origin ที่กำหนด (ค่าจาก .env CORS_ORIGIN คั่นด้วยคอมมา)
// ถ้าไม่เซ็ต ให้ใช้ BASE_URL (same-origin) — ห้ามเปิดทุก origin
const allowedOrigins = (process.env.CORS_ORIGIN || BASE_URL)
  .split(',').map(s => s.trim()).filter(Boolean);
app.use(cors({
  origin: (origin, cb) => {
    // ไม่มี origin header (server-to-server / curl) อนุญาต
    if (!origin || allowedOrigins.includes(origin)) return cb(null, true);
    return cb(null, false);
  },
  credentials: true
}));
// ปล่อยให้ป๊อปอัป Google Sign-In คุยกับหน้าเว็บหลักได้ (แก้ปัญหา COOP block postMessage)
app.use((req, res, next) => {
  res.setHeader('Cross-Origin-Opener-Policy', 'same-origin-allow-popups');
  next();
});
// Security headers (แทน helmet โดยไม่เพิ่ม dependency)
app.use((req, res, next) => {
  res.setHeader('X-Content-Type-Options', 'nosniff');
  res.setHeader('X-Frame-Options', 'DENY');
  res.setHeader('Referrer-Policy', 'no-referrer');
  res.setHeader('Cross-Origin-Resource-Policy', 'same-origin');
  next();
});
// gzip ตอนตอบ JSON ใหญ่ (chapter เดียวอาจหลายร้อย KB) — ลด bandwidth 70-90%
app.use(compression());

// ─── Rate limiting (in-memory, กัน brute-force / abuse) ────────────────────
function createRateLimiter({ windowMs, max, message }) {
  const hits = new Map();
  setInterval(() => hits.clear(), windowMs).unref?.();
  return (req, res, next) => {
    const key = req.ip || req.socket.remoteAddress || 'unknown';
    const now = Date.now();
    const rec = hits.get(key) || { count: 0, reset: now + windowMs };
    if (now > rec.reset) { rec.count = 0; rec.reset = now + windowMs; }
    rec.count += 1;
    hits.set(key, rec);
    if (rec.count > max) {
      return res.status(429).json({ error: message || 'Too many requests' });
    }
    next();
  };
}
// จำกัดทั่วไปสำหรับ API ทั้งหมด
app.use('/api', createRateLimiter({
  windowMs: 10 * 60 * 1000, max: 600,
  message: 'Too many requests, please slow down'
}));
// จำกัดเข้มงวดสำหรับจุดที่เกี่ยวกับการล็อกอิน
const authLimiter = createRateLimiter({
  windowMs: 60 * 1000, max: 15,
  message: 'Too many login attempts, please try again later'
});
app.use('/api/auth', authLimiter);
app.use('/api/login', authLimiter);

app.use(sessionMiddleware());
// กำหนด req.owner (user จาก session หรือ guest จาก cookie) ให้ทุก API
// ใช้ scope ข้อมูลแบบ Multi-tenant / Data Isolation ใน route ต่างๆ
app.use('/api', ownerMiddleware());

// ─── Pages ─────────────────────────────────────────────────────────────────
// ⚠️ ต้อง register ก่อน express.static มิฉะนั้น static จะเสิร์ฟ dashboard.html
//    ได้โดยไม่ผ่านการตรวจสอบสิทธิ์

const page = (name) => path.join(publicDir, name);
const dashboard = (req, res) => res.sendFile(page('dashboard.html'));

// หน้า Dashboard/CMS โหลดเสมอ ฝั่ง client จะตรวจสอบสิทธิ์ผ่าน /api/me
// แล้วแสดง Alert Dialog ล็อกอินหากยังไม่ล็อกอิน (กันได้ระดับ UX)
// ส่วนการเขียนข้อมูลจริง (POST/PUT/DELETE) ทุก route ต้องผ่าน requireApiAuth
// (ดูใน src/routes/*.js) — ไม่อนุญาตให้ guest เขียน/ลบข้อมูล
const dashboardRoutes = ['/', '/dashboard', '/dashboard.html', '/index.html', '/asset-manager', '/CRUD_asset.html'];
dashboardRoutes.forEach((route) => app.get(route, dashboard));
app.get('/game', (req, res) => res.sendFile(page('game.html')));

// Static ต้องอยู่หลัง page routes (home.html + asset สาธารณะ)
app.use(express.static(publicDir));

// ─── API Routes (ลำดับการ register สำคัญ — ห้ามสลับ) ──────────────────────

require('./src/routes/assets').register(app);
require('./src/routes/stories').register(app);
require('./src/routes/chapters').register(app);
require('./src/routes/dialogues').register(app);
require('./src/routes/users').register(app);

// ─── Global Error Handler ──────────────────────────────────────────────────

app.use((err, req, res, next) => {
  if (err instanceof MulterFileTypeError || err instanceof multer.MulterError) {
    return res.status(400).json({ error: err.message });
  }
  // body ใหญ่เกิน limit (express.json)
  if (err.statusCode === 413 || err.type === 'entity.too.large') {
    return res.status(413).json({ error: 'Request body too large' });
  }

  console.error('Unhandled error:', err);
  res.status(500).json({ error: 'Internal server error' });
});

// ─── Start ─────────────────────────────────────────────────────────────────

async function startServer() {
  await initDatabase();
  app.listen(PORT, () => {
    console.log(`✅ Server running at ${BASE_URL}`);
  }).on('error', (err) => {
    // เช่น EADDRINUSE — มี process อื่นใช้ port อยู่
    console.error(`❌ เปิด port ${PORT} ไม่สำเร็จ: ${err.message}`);
    console.error('   ลองปิด process เดิม หรือรัน: PORT=3001 node server.js');
    process.exit(1);
  });
}

startServer();
