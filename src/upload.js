// ─── Upload (Multer) ───────────────────────────────────────────────────────
// กติกา: จำกัด 100 MB/ไฟล์ + อนุญาตเฉพาะ MIME ที่รู้จัก

const multer = require('multer');
const fs = require('fs');
const path = require('path');
const { assetDirs, coverDir } = require('./config');

class MulterFileTypeError extends Error {
  constructor(message) {
    super(message);
    this.name = 'MulterFileTypeError';
  }
}

const ALLOWED_MIME = new Set([
  'image/png', 'image/jpeg', 'image/gif', 'image/webp',
  'audio/mpeg', 'audio/ogg', 'audio/wav', 'audio/webm', 'audio/aac'
]);

const storage = multer.diskStorage({
  destination: (req, file, cb) => {
    // req.body อาจยังไม่พร้อมตอน destination callback ถ้า field มาหลัง file
    // เลยอ่าน type จาก query string สำรองไว้ด้วย — client ควรส่ง asset_type ก่อน file field
    const type = (req.body.asset_type || req.query.asset_type || 'character').toLowerCase();
    const dir = assetDirs[type] || assetDirs.character;
    fs.mkdirSync(dir, { recursive: true });
    cb(null, dir);
  },
  filename: (req, file, cb) => {
    const uniqueSuffix = Date.now() + '-' + Math.round(Math.random() * 1e9);
    const safeName = file.originalname.replace(/[^a-zA-Z0-9._-]/g, '_');
    cb(null, uniqueSuffix + '-' + safeName);
  }
});

const upload = multer({
  storage,
  limits: { fileSize: 100 * 1024 * 1024 },
  fileFilter: (req, file, cb) => {
    if (ALLOWED_MIME.has(file.mimetype)) {
      cb(null, true);
    } else {
      cb(new MulterFileTypeError(`ไม่อนุญาตประเภทไฟล์: ${file.mimetype}`));
    }
  }
});

// อัปโหลดรูปปก Story (จำกัดเฉพาะรูปภาพ)
const coverStorage = multer.diskStorage({
  destination: (req, file, cb) => {
    fs.mkdirSync(coverDir, { recursive: true });
    cb(null, coverDir);
  },
  filename: (req, file, cb) => {
    const uniqueSuffix = Date.now() + '-' + Math.round(Math.random() * 1e9);
    const safeName = file.originalname.replace(/[^a-zA-Z0-9._-]/g, '_');
    cb(null, uniqueSuffix + '-' + safeName);
  }
});

const coverUpload = multer({
  storage: coverStorage,
  limits: { fileSize: 10 * 1024 * 1024 }, // 10 MB
  fileFilter: (req, file, cb) => {
    if (file.mimetype.startsWith('image/')) cb(null, true);
    else cb(new MulterFileTypeError(`ไม่อนุญาตประเภทไฟล์: ${file.mimetype}`));
  }
});

module.exports = { upload, coverUpload, MulterFileTypeError };
