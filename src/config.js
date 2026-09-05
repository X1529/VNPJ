// ─── Config ────────────────────────────────────────────────────────────────
// ค่ากลางของระบบ อ่านจาก .env (dotenv ถูก require ที่ server.js ก่อนไฟล์นี้เสมอ)

const path = require('path');

// Google OAuth2 Web Client ID (สาธารณะ — ใช้ฝั่ง client สำหรับ GIS ด้วย)
const GOOGLE_CLIENT_ID = process.env.GOOGLE_CLIENT_ID || '202739387346-0aoro9gpd9ne80tuiipslpmeb82j2jnj.apps.googleusercontent.com';

const PORT = process.env.PORT || 3000;
const BASE_URL = process.env.BASE_URL || `http://localhost:${PORT}`;

// [SECURITY] เสิร์ฟเฉพาะไฟล์ frontend ใน public/ เท่านั้น
// ห้ามใช้ express.static(__dirname) เพราะจะโหลด server.js / package.json ออกไปได้
const publicDir = path.join(__dirname, '..', 'public');
const publicAssetRoot = path.join(publicDir, 'assets');

const assetDirs = {
  character:  path.join(publicAssetRoot, 'characters'),
  background: path.join(publicAssetRoot, 'backgrounds'),
  bgm:        path.join(publicAssetRoot, 'bgm'),
  sfx:        path.join(publicAssetRoot, 'sfx')
};

// โฟลเดอร์รูปปก Story (อัปโหลดจากเครื่อง)
const coverDir = path.join(publicAssetRoot, 'covers');

module.exports = { PORT, BASE_URL, GOOGLE_CLIENT_ID, publicDir, publicAssetRoot, assetDirs, coverDir };
