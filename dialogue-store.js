// ─── Dialogue Store: เก็บบทสนทนาเป็นไฟล์ JSON 1 ไฟล์ต่อ 1 chapter ─────────
// โครงสร้างไฟล์: data/dialogues/chapter_<id>.json
// {
//   "chapter_id": 1,
//   "story_id": 1,
//   "title": "วันเปิดเรียนวันแรก",   // snapshot ตอน write (GET จะ override ด้วยค่าล่าสุดจาก DB)
//   "next_id": 32,                  // id ถัดไปที่จะใช้
//   "assets_preload": [ ...asset rows ที่ chapter นี้ใช้ (รูปแบบเดียวกับ GET /api/assets)... ],
//   "dialogues": [ ...บรรทัดบทสนทนา... ]
// }
//
// หลักการ: 1 Chapter = 1 JSON Document — เกมอ่าน "ทั้ง chapter ทีเดียว" ตอนเริ่มเล่น
// ทำให้ scale บทหลักล้านบรรทัดได้โดยไม่เพิ่มภาระ DB (ไฟล์ static เอาขึ้น CDN ตรงๆ ได้)
// การเขียนไฟล์เป็นแบบ atomic (tmp + rename) กันไฟล์พังถ้า process ตายกลางทาง

const path = require('path');
const fsp = require('fs/promises');

const dataRoot = path.join(__dirname, 'data', 'dialogues');

// ─── Per-chapter write lock ───────────────────────────────────────────────────
// กัน race condition ตอนอ่าน-แก้-เขียนไฟล์พร้อมกัน (read-modify-write)
// แต่ละ chapter จะมี queue ของ promise เรียงกัน คนถัดไปรอจนคนก่อนเสร็จ
const writeLocks = new Map();

function withChapterLock(chapterId, task) {
  const key = `c${chapterId}`;
  const prev = writeLocks.get(key) || Promise.resolve();
  let release;
  const myTurn = new Promise((res) => { release = res; });
  const run = myTurn.then(task);
  // chained กลืน rejection ด้วย เพื่อไม่ให้ queue ขาดช่วง
  const chained = run.then(() => {}, () => {});
  writeLocks.set(key, chained);
  // คิวถึงตาเราแล้ว (prev จบ) → ให้ task ทำงาน
  prev.finally(() => release());
  // ทำความสะอาด map เมื่อ queue นี้จบ
  chained.finally(() => {
    if (writeLocks.get(key) === chained) writeLocks.delete(key);
  });
  return run;
}

function chapterFile(chapterId) {
  return path.join(dataRoot, `chapter_${parseInt(chapterId, 10)}.json`);
}

function emptyChapter(chapterId) {
  return {
    chapter_id: parseInt(chapterId, 10),
    story_id: null,
    title: '',
    next_id: 1,
    assets_preload: [],
    dialogues: []
  };
}

async function readChapter(chapterId) {
  try {
    const raw = await fsp.readFile(chapterFile(chapterId), 'utf8');
    const data = JSON.parse(raw);
    return {
      ...emptyChapter(chapterId),
      ...data,
      next_id: Number(data.next_id) || 1,
      assets_preload: Array.isArray(data.assets_preload) ? data.assets_preload : [],
      dialogues: Array.isArray(data.dialogues) ? data.dialogues : []
    };
  } catch (err) {
    if (err.code === 'ENOENT') {
      // chapter ยังไม่มีไฟล์ = ยังไม่มีบทสนทนา (ไม่ใช่ error)
      return emptyChapter(chapterId);
    }
    throw err;
  }
}

async function writeChapter(chapterId, data) {
  return withChapterLock(chapterId, async () => {
    await fsp.mkdir(dataRoot, { recursive: true });
    const finalPath = chapterFile(chapterId);
    const tmpPath = `${finalPath}.tmp`;
    await fsp.writeFile(tmpPath, JSON.stringify(data, null, 2), 'utf8');
    await fsp.rename(tmpPath, finalPath);
  });
}

async function deleteChapterFile(chapterId) {
  try {
    await fsp.unlink(chapterFile(chapterId));
  } catch (err) {
    if (err.code !== 'ENOENT') throw err;
  }
}

module.exports = { readChapter, writeChapter, deleteChapterFile, emptyChapter, dataRoot };
