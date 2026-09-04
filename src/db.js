// ─── Database ──────────────────────────────────────────────────────────────
// Pool หลัก + สร้าง schema/seed ตอนบูต (CREATE IF NOT EXISTS — ไม่ลบข้อมูลเดิม)

const mysql = require('mysql2/promise');
const fs = require('fs');
const { DB_HOST, DB_USER, DB_PASS, DB_PASSWORD, DB_NAME, DB_PORT, DB_SSL, DB_SSL_CA } = process.env;
const DB_PASSWORD_VALUE = DB_PASS || DB_PASSWORD || '';

// TiDB Cloud (และ MySQL ภายนอก) ต้องต่อผ่าน TLS + port 4000
// เปิดด้วย DB_SSL=true หรือใส่ DB_SSL_CA ชี้ไฟล์ cert ที่โหลดจาก dashboard
function buildSsl() {
  if (DB_SSL_CA) {
    return {
      ca: fs.readFileSync(DB_SSL_CA),
      minVersion: 'TLSv1.2',
      rejectUnauthorized: true
    };
  }
  const host = DB_HOST || '';
  const wantSsl = String(DB_SSL || '').toLowerCase() === 'true'
    || Number(DB_PORT) === 4000
    || /tidbcloud/i.test(host);
  if (wantSsl) {
    // TiDB ใช้ public CA (ISRG Root) ที่ Node เชื่ออยู่แล้ว — ไม่ต้องแนบไฟล์ก็ได้
    return { minVersion: 'TLSv1.2', rejectUnauthorized: true };
  }
  return undefined;
}

const dbConfig = {
  host: DB_HOST || 'localhost',
  port: Number(DB_PORT) || 3306,
  user: DB_USER || 'root',
  password: DB_PASSWORD_VALUE,
  database: DB_NAME || 'vn_online',
  charset: 'utf8mb4',
  connectTimeout: 15000,
  ...(buildSsl() ? { ssl: buildSsl() } : {})
};

const db = mysql.createPool(dbConfig);

// ─── Schema migration helpers (idempotent) ──────────────────────────────────
// ใช้ ADD COLUMN / ADD CONSTRAINT แบบตรวจสอบก่อน เพื่อให้สคริปต์รันซ้ำได้
// ทั้งบน DB ใหม่ (สร้างตารางเปล่า) และ DB เดิมที่มีตาราง/คอลัมน์อยู่แล้ว

async function addColumnIfNotExists(table, column, definition) {
  const [rows] = await db.query(
    `SELECT COUNT(*) AS cnt FROM information_schema.columns
     WHERE table_schema = DATABASE() AND table_name = ? AND column_name = ?`,
    [table, column]
  );
  if (rows[0].cnt === 0) {
    await db.query(`ALTER TABLE \`${table}\` ADD COLUMN \`${column}\` ${definition}`);
    console.log(`✅ Added column ${table}.${column}`);
  }
}

async function addFkIfNotExists(table, fkName, fkDef) {
  const [rows] = await db.query(
    `SELECT COUNT(*) AS cnt FROM information_schema.table_constraints
     WHERE table_schema = DATABASE() AND table_name = ? AND constraint_name = ?`,
    [table, fkName]
  );
  if (rows[0].cnt === 0) {
    await db.query(`ALTER TABLE \`${table}\` ADD CONSTRAINT \`${fkName}\` ${fkDef}`);
    console.log(`✅ Added FK ${table}.${fkName}`);
  }
}

async function initDatabase() {
  try {
    // แยก admin connection ออกมาสร้าง DB เท่านั้น แล้วปิดทันที
    // (TiDB Cloud บางแพลนไม่มีสิทธิ์ CREATE DATABASE — ถ้าสร้างไม่ได้ให้สร้าง DB
    //  ใน dashboard เองแล้วตั้ง DB_NAME ให้ตรง แอปจะข้ามขั้นนี้ไปต่อได้)
    const admin = mysql.createPool({
      host: dbConfig.host,
      port: dbConfig.port,
      user: dbConfig.user,
      password: dbConfig.password,
      charset: 'utf8mb4',
      connectTimeout: 15000,
      ...(dbConfig.ssl ? { ssl: dbConfig.ssl } : {})
    });

    const dbName = (dbConfig.database || 'vn_online').replace(/[^a-zA-Z0-9_]/g, '') || 'vn_online';
    console.log(`Creating database ${dbName} if not exists...`);
    try {
      await admin.query(
        `CREATE DATABASE IF NOT EXISTS \`${dbName}\` CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci`
      );
    } catch (e) {
      console.warn(`⚠️ สร้าง database อัตโนมัติไม่ได้ (${e.message}) — ให้สร้าง "${dbName}" ใน TiDB dashboard เองแล้วรันใหม่อีกครั้ง`);
    }
    await admin.end();

    console.log('Preparing tables (CREATE IF NOT EXISTS)...');

    await db.query(`
      CREATE TABLE IF NOT EXISTS stories (
        story_id    INT AUTO_INCREMENT PRIMARY KEY,
        title       VARCHAR(255) NOT NULL,
        cover_url   VARCHAR(500),
        description TEXT,
        created_at  TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
        updated_at  TIMESTAMP DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP
      ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4
    `);

    await db.query(`
      CREATE TABLE IF NOT EXISTS chapters (
        chapter_id     INT AUTO_INCREMENT PRIMARY KEY,
        story_id       INT NOT NULL,
        chapter_number INT NOT NULL,
        title          VARCHAR(255) NOT NULL,
        description    TEXT,
        created_at     TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
        updated_at     TIMESTAMP DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
        UNIQUE KEY unique_story_chapter (story_id, chapter_number),
        FOREIGN KEY (story_id) REFERENCES stories(story_id) ON DELETE CASCADE
      ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4
    `);

    // size_bytes เป็น BIGINT รองรับไฟล์ใหญ่กว่า 2 GB
    await db.query(`
      CREATE TABLE IF NOT EXISTS assets (
        asset_id   INT AUTO_INCREMENT PRIMARY KEY,
        story_id   INT NOT NULL DEFAULT 1,
        chapter_id INT DEFAULT NULL,
        asset_type ENUM('character','background','bgm','sfx') NOT NULL,
        asset_name VARCHAR(150) NOT NULL,
        file_name  VARCHAR(255) NOT NULL,
        file_path  VARCHAR(500) NOT NULL,
        mime_type  VARCHAR(120) DEFAULT NULL,
        size_bytes BIGINT DEFAULT 0,
        created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
        updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
        KEY idx_story_type (story_id, asset_type),
        KEY idx_chapter (chapter_id)
      ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4
    `);

    // ─── Users (รองรับ Social Login: google_id + password_hash NULLABLE) ────
    await db.query(`
      CREATE TABLE IF NOT EXISTS users (
        user_id       INT AUTO_INCREMENT PRIMARY KEY,
        email         VARCHAR(255) NOT NULL,
        password_hash VARCHAR(255) DEFAULT NULL,
        google_id     VARCHAR(255) DEFAULT NULL,
        display_name  VARCHAR(150) DEFAULT NULL,
        avatar_url    TEXT,
        created_at    TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
        updated_at    TIMESTAMP DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
        UNIQUE KEY unique_email (email),
        UNIQUE KEY unique_google_id (google_id)
      ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4
    `);

    // ─── User Providers (รองรับหลายผู้ให้บริการ เช่น google/facebook/apple) ──
    await db.query(`
      CREATE TABLE IF NOT EXISTS user_providers (
        provider_id        INT AUTO_INCREMENT PRIMARY KEY,
        user_id            INT NOT NULL,
        provider_name      VARCHAR(50) NOT NULL,
        provider_user_id   VARCHAR(255) NOT NULL,
        created_at         TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
        UNIQUE KEY unique_provider (provider_name, provider_user_id),
        FOREIGN KEY (user_id) REFERENCES users(user_id) ON DELETE CASCADE
      ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4
    `);

    // ─── Multi-tenant / Resource Ownership (Decoupled Auth) ───────────────
    // เพิ่ม user_id (เจ้าของจริง) + guest_id (เจ้าของแบบ guest ก่อนล็อกอิน)
    // ทั้งสองเป็น NULL-able เพื่อรองรับข้อมูลเดิม (global) และ guest-then-migrate
    // ใช้ ALTER แบบตรวจสอบก่อน (idempotent) รองรับทั้ง DB ใหม่และ DB ที่รันมาแล้ว
    await addColumnIfNotExists('stories',  'user_id',  'INT NULL');
    await addColumnIfNotExists('stories',  'guest_id', 'VARCHAR(255) NULL');
    await addColumnIfNotExists('stories',  'is_published', 'TINYINT(1) NOT NULL DEFAULT 0');
    await addColumnIfNotExists('chapters', 'user_id',  'INT NULL');
    await addColumnIfNotExists('chapters', 'guest_id', 'VARCHAR(255) NULL');
    await addColumnIfNotExists('chapters', 'is_exported', 'TINYINT(1) NOT NULL DEFAULT 0');
    await addColumnIfNotExists('assets',   'user_id',  'INT NULL');
    await addColumnIfNotExists('assets',   'guest_id', 'VARCHAR(255) NULL');

    // FK ผูกกับ users — ลบ user → ลบข้อมูลที่เป็นเจ้าของตามด้วย (CASCADE)
    await addFkIfNotExists('stories',  'fk_stories_user',
      'FOREIGN KEY (user_id) REFERENCES users(user_id) ON DELETE CASCADE');
    await addFkIfNotExists('chapters', 'fk_chapters_user',
      'FOREIGN KEY (user_id) REFERENCES users(user_id) ON DELETE CASCADE');
    await addFkIfNotExists('assets',   'fk_assets_user',
      'FOREIGN KEY (user_id) REFERENCES users(user_id) ON DELETE CASCADE');

    // [JSON STORAGE] บทสนทนาไม่เก็บใน MySQL แล้ว — เก็บเป็นไฟล์
    // data/dialogues/chapter_<id>.json ต่อ chapter (ดู dialogue-store.js)

    // โปรดสร้าง mock user ก่อน seed stories (stories อ้างอิง user_id = 1 ผ่าน FK)
    await seedMockUser();
    await seedIfEmpty();
    console.log('✅ Database ready');
  } catch (err) {
    console.error('❌ Database initialization error:', err.message);
    throw err;
  }
}

    // Seed เฉพาะตอนฐานข้อมูลว่างเปล่า (ครั้งแรกสุดเท่านั้น)
    // กำหนด user_id = 1 (mock user) เพื่อให้ข้อมูลตัวอย่างปรากฏในสตูดิโอของผู้ใช้จำลอง
async function seedIfEmpty() {
  const [[{ cnt }]] = await db.query('SELECT COUNT(*) AS cnt FROM stories');
  if (cnt > 0) return;

  console.log('Inserting seed data...');
  const [storyResult] = await db.query(
    `INSERT INTO stories (title, cover_url, description, user_id, is_published) VALUES (?, ?, ?, 1, 1)`,
    ['เรื่องราวในโรงเรียน', null, 'เรื่องที่เกิดขึ้นในช่วงวันเปิดเรียน']
  );
  const storyId = storyResult.insertId;

  await db.query(
    `INSERT INTO chapters (story_id, chapter_number, title, description, user_id, is_exported) VALUES
     (?, 1, 'วันเปิดเรียนวันแรก', 'วันแรกของการเปิดเรียนที่เต็มไปด้วยความตื่นตระหนก', 1, 1),
     (?, 2, 'พบกันหลังเลิกเรียน', 'การพบกันครั้งแรกหลังเลิกเรียน', 1, 1)`,
    [storyId, storyId]
  );
  console.log('✅ Seed data inserted (1 story, 2 chapters)');
}

// Seed mock user สำหรับเตรียมระบบ Google Login (ยังไม่เปิดใช้งานจริง)
// user_id = 1 จะถูกใช้เป็น current user ในระบบจำลอง (mock)
// รันแยกจาก seedIfEmpty เพื่อให้สร้างได้แม้ฐานข้อมูลเดิมมี stories อยู่แล้ว
async function seedMockUser() {
  const [[{ cnt }]] = await db.query('SELECT COUNT(*) AS cnt FROM users');
  if (cnt > 0) return;

  console.log('Inserting mock user...');
  await db.query(
    `INSERT INTO users (user_id, email, password_hash, google_id, display_name, avatar_url)
     VALUES (?, ?, NULL, ?, ?, NULL)`,
    [1, 'mock@gmail.com', '123456789', 'Mock User']
  );
  await db.query(
    `INSERT INTO user_providers (user_id, provider_name, provider_user_id)
     VALUES (?, 'google', ?)`,
    [1, '123456789']
  );
  console.log('✅ Seed mock user inserted (id=1, email=mock@gmail.com)');
}

module.exports = { db, initDatabase, seedMockUser };
