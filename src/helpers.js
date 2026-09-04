// ─── Helpers ───────────────────────────────────────────────────────────────
// ฟังก์ชันกลางที่หลาย route ใช้ร่วมกัน (ไม่ยุ่ง req/res โดยตรง)

const fs = require('fs');
const path = require('path');
const { BASE_URL, assetDirs } = require('./config');

function getFolderNameByType(type) {
  switch ((type || 'character').toLowerCase()) {
    case 'background': return 'backgrounds';
    case 'bgm':        return 'bgm';
    case 'sfx':        return 'sfx';
    default:           return 'characters';
  }
}

// โฟลเดอร์ย่อยตามตัวละคร: asset_name ตัดที่ "_" แรก (ดอนกิโฆเต้_ยิ้ม -> ดอนกิโฆเต้)
// \p{M} ครอบสระ/วรรณยุกต์ไทยที่เป็น combining marks ไม่ให้ถูกแทนด้วย _
function characterSubfolder(assetName) {
  const prefix = String(assetName || '').split('_')[0].trim();
  const safe = prefix.replace(/[^\p{L}\p{N}\p{M}_-]+/gu, '_').slice(0, 80);
  return safe || 'uncategorized';
}

// ย้ายไฟล์ที่ multer เซฟไว้แล้วเข้าโฟลเดอร์ย่อยตัวละคร คืน relative path สำหรับ DB
function placeCharacterFile(file, assetName) {
  const sub = characterSubfolder(assetName);
  const destDir = path.join(assetDirs.character, sub);
  fs.mkdirSync(destDir, { recursive: true });
  const destAbs = path.join(destDir, path.basename(file.path));
  if (path.resolve(destAbs) !== path.resolve(file.path)) {
    fs.renameSync(file.path, destAbs);
  }
  return `/assets/characters/${sub}/${path.basename(file.path)}`;
}

// sanitize file path ก่อน join เพื่อป้องกัน path traversal
// คืน absolute path ที่รับประกันว่าไม่หลุดออกจาก publicDir (ไม่งั้น throw)
function safeFilePath(relativePath) {
  const publicRoot = path.resolve(__dirname, '..', 'public');
  // ตัด slash หน้า (ค่าใน DB เก็บแบบ "/assets/...") แล้ว resolve เทียบกับ publicRoot
  const rel = String(relativePath == null ? '' : relativePath).replace(/^[/\\]+/, '');
  const resolved = path.resolve(publicRoot, rel);
  if (resolved !== publicRoot && !resolved.startsWith(publicRoot + path.sep)) {
    throw new Error(`Invalid file path (traversal): ${relativePath}`);
  }
  return resolved;
}

// row จาก DB -> object มาตรฐานที่ client ใช้ (+file_url เต็ม)
function normalizeAssetRow(row) {
  return {
    asset_id:   row.asset_id,
    story_id:   row.story_id,
    chapter_id: row.chapter_id,
    asset_type: row.asset_type,
    asset_name: row.asset_name,
    file_name:  row.file_name,
    file_path:  row.file_path,
    mime_type:  row.mime_type,
    size_bytes: row.size_bytes,
    created_at: row.created_at,
    updated_at: row.updated_at,
    file_url:   row.file_path ? `${BASE_URL}${row.file_path}` : null
  };
}

module.exports = {
  getFolderNameByType,
  characterSubfolder,
  placeCharacterFile,
  safeFilePath,
  normalizeAssetRow
};
