// ─── Dialogues API (file-based: data/dialogues/chapter_<id>.json) ─────────
// CRUD บรรทัดบทสนทนา — ทุกการแก้ไข regenerate assets_preload อัตโนมัติ

const { db } = require('../db');
const { readChapter, writeChapter } = require('../../dialogue-store');
const { normalizeAssetRow } = require('../helpers');
const { assertChapterOwner, requireApiAuth } = require('../auth');

// ตรวจว่า chapter มีจริงใน DB ก่อนยุ่งกับไฟล์ (แทน FK เดิมของตาราง dialogues)
async function chapterExists(chapterId) {
  const [rows] = await db.query('SELECT chapter_id FROM chapters WHERE chapter_id = ?', [chapterId]);
  return rows.length > 0;
}

// รวบรวม asset id ทั้งหมดที่ node/line อ้างถึง (bg/bgm/sfx/characters)
// รองรับได้ทั้งโครงสร้างใหม่ (node.lines[]) และข้อมูลเก่า (line เรียงแบน)
function collectAssetIds(nodes) {
  const ids = new Set();
  const lineLike = (obj) => {
    for (const key of ['bg', 'bgm', 'sfx']) {
      if (obj[key] && Number.isFinite(Number(obj[key]))) ids.add(Number(obj[key]));
    }
    for (const c of obj.characters || []) {
      if (c && Number.isFinite(Number(c.asset_id))) ids.add(Number(c.asset_id));
    }
  };
  for (const node of nodes) {
    if (Array.isArray(node.lines) && node.lines.length) {
      node.lines.forEach(lineLike);
    } else {
      lineLike(node); // ข้อมูลเก่าแบบ flat
    }
  }
  return [...ids];
}

// สร้าง assets_preload จาก DB
async function buildAssetsPreload(lines) {
  const ids = collectAssetIds(lines);
  if (!ids.length) return [];
  const [rows] = await db.query('SELECT * FROM assets WHERE asset_id IN (?)', [ids]);
  return rows.map(normalizeAssetRow);
}

// อัปเดต metadata snapshot + preload แล้วเขียนไฟล์ (ใช้ร่วมกันทุก endpoint ที่แก้บท)
async function persistChapter(chapterId, file) {
  const [rows] = await db.query(
    `SELECT c.chapter_number, c.title, s.story_id
       FROM chapters c JOIN stories s ON s.story_id = c.story_id
      WHERE c.chapter_id = ?`,
    [chapterId]
  );
  if (rows.length) {
    file.chapter_id = rows[0].chapter_id;
    file.story_id   = rows[0].story_id;
    file.title      = rows[0].title;
  }
  file.assets_preload = await buildAssetsPreload(file.dialogues);
  await writeChapter(chapterId, file);
}

// parse characters_json / choices_json — คืน array เสมอ, throw err.status=400 ถ้าพัง
function safeParseJsonArray(value, fieldName) {
  if (value === undefined || value === null || value === '') return [];
  try {
    const parsed = typeof value === 'string' ? JSON.parse(value) : value;
    return Array.isArray(parsed) ? parsed : [parsed];
  } catch {
    const err = new Error(`${fieldName} ไม่ใช่ JSON ที่ถูกต้อง`);
    err.status = 400;
    throw err;
  }
}

// body -> line object (ใช้ field names แบบ legacy เพื่อความเข้ากันได้กับ client)
// defaults = ค่าเริ่มต้นแต่ละ field เมื่อ client ไม่ได้ส่งมา
//   - POST: id/sort_order จากไฟล์, field อื่นว่างตาม schema
//   - PUT : ค่าเดิมของ line ทั้งหมด (แก้เฉพาะ field ที่ส่งมา)
function buildLineFromRequest(body, defaults) {
  const d = {
    sort_order: 0,
    name: '', identity: '', text: '', type: 'normal', speaker: 'center',
    bg: null, bgm: null, sfx: null, characters: [], choices: [],
    ...defaults
  };

  return {
    dialogue_id: d.dialogue_id,
    sort_order:  body.sort_order !== undefined && body.sort_order !== ''
                   ? Number(body.sort_order)
                   : d.sort_order,
    name:        body.speaker_name     !== undefined ? (body.speaker_name || '')       : d.name,
    identity:    body.identity         !== undefined ? (body.identity || '')           : d.identity,
    text:        body.dialogue_text    !== undefined ? (body.dialogue_text || '')      : d.text,
    type:        body.type             !== undefined ? (body.type || 'normal')         : d.type,
    speaker:     body.speaker_position !== undefined ? (body.speaker_position || 'center') : d.speaker,
    bg:          body.background_asset_id !== undefined ? (body.background_asset_id || null) : d.bg,
    bgm:         body.bgm_asset_id        !== undefined ? (body.bgm_asset_id || null)        : d.bgm,
    sfx:         body.sfx_asset_id        !== undefined ? (body.sfx_asset_id || null)        : d.sfx,
    characters:  body.characters_json !== undefined ? safeParseJsonArray(body.characters_json, 'characters_json') : d.characters,
    choices:     body.choices_json    !== undefined ? safeParseJsonArray(body.choices_json, 'choices_json')       : d.choices
  };
}

function register(app) {
  // รายการ lines ทั้ง chapter (เรียงตาม sort_order)
  app.get('/api/chapters/:chapterId/dialogues', async (req, res) => {
    try {
      const { dialogues } = await readChapter(req.params.chapterId);
      dialogues.sort((a, b) => (a.sort_order || 0) - (b.sort_order || 0));
      res.json(dialogues);
    } catch (err) {
      console.error(err);
      res.status(500).json({ error: 'Failed to fetch dialogues' });
    }
  });

  app.post('/api/chapters/:chapterId/dialogues', requireApiAuth, async (req, res) => {
    try {
      const chapterId = parseInt(req.params.chapterId, 10);
      if (!(await assertChapterOwner(req, res, chapterId))) return;

      const file = await readChapter(chapterId);
      const line = buildLineFromRequest(req.body || {}, {
        dialogue_id: file.next_id,
        sort_order:  file.dialogues.length
      });

      file.dialogues.push(line);
      file.next_id += 1;
      await persistChapter(chapterId, file);

      res.status(201).json(line);
    } catch (err) {
      console.error(err);
      if (err.status) return res.status(err.status).json({ error: err.message });
      res.status(500).json({ error: 'Failed to create dialogue' });
    }
  });

  // ─── Bulk save (Node Graph Editor) ────────────────────────────────
  // รับ nodes ทั้ง chapter (พร้อม pos_x/pos_y, lines[] และ choices[] ที่ next = dialogue_id)
  // แล้วเขียนทั้งไฟล์แบบ atomic — ไม่กระทบ endpoint รายบรรทัดอื่น
  // ⚠️ ต้องลงทะเบียนก่อน route /:lineId มิฉะนั้น Express จะจับ "bulk" เป็น lineId
  app.put('/api/chapters/:chapterId/dialogues/bulk', requireApiAuth, async (req, res) => {
    try {
      const chapterId = parseInt(req.params.chapterId, 10);
      if (!(await assertChapterOwner(req, res, chapterId))) return;

      const incoming = Array.isArray(req.body.dialogues) ? req.body.dialogues : [];
      const file = await readChapter(chapterId);

      file.dialogues = incoming.map((n) => {
        // รองรับข้อมูลเก่า (node มี text โดยตรง ไม่มี lines[])
        const hasLines = Array.isArray(n.lines) && n.lines.length;
        const lines = hasLines
          ? n.lines.map((l) => ({
              speaker:       l.speaker || 'center',
              name:          l.name || '',
              identity:      l.identity || '',
              text:          l.text || '',
              bg:            l.bg ?? null,
              bgm:           l.bgm ?? null,
              sfx:           l.sfx ?? null,
              characters:    Array.isArray(l.characters) ? l.characters : [],
              flash:         !!l.flash,
              flashDuration: Number(l.flashDuration) || 400,
              shake:         !!l.shake,
              shakeType:     l.shakeType || 'shake-horizontal',
              shakeDuration: Number(l.shakeDuration) || 300
            }))
          : (n.text || n.name || n.bg || (n.characters && n.characters.length))
              ? [{
                  speaker:       n.speaker || 'center',
                  name:          n.name || '',
                  identity:      n.identity || '',
                  text:          n.text || '',
                  bg:            n.bg ?? null,
                  bgm:           n.bgm ?? null,
                  sfx:           n.sfx ?? null,
                  characters:    Array.isArray(n.characters) ? n.characters : [],
                  flash:         !!n.flash,
                  flashDuration: Number(n.flashDuration) || 400,
                  shake:         !!n.shake,
                  shakeType:     n.shakeType || 'shake-horizontal',
                  shakeDuration: Number(n.shakeDuration) || 300
                }]
              : [];

        return {
          dialogue_id: Number(n.dialogue_id),
          sort_order:  typeof n.sort_order === 'number' ? n.sort_order : Number(n.sort_order) || 0,
          title:       n.title || '',
          pos_x:       typeof n.pos_x === 'number' ? n.pos_x : 0,
          pos_y:       typeof n.pos_y === 'number' ? n.pos_y : 0,
          lines,
          nextChapter: (typeof n.nextChapter === 'number') ? n.nextChapter
                        : (n.nextChapter != null ? Number(n.nextChapter) : null),
          choices:     Array.isArray(n.choices) ? n.choices.map((c) => ({
                         text: c.text || '',
                         next: (c.next === '' || c.next === null || c.next === undefined) ? null : Number(c.next)
                       })) : []
        };
      });

      await persistChapter(chapterId, file);
      res.json({ success: true, count: file.dialogues.length });
    } catch (err) {
      console.error(err);
      res.status(500).json({ error: 'Failed to save graph' });
    }
  });

  app.put('/api/chapters/:chapterId/dialogues/:lineId', requireApiAuth, async (req, res) => {
    try {
      const chapterId = parseInt(req.params.chapterId, 10);
      const lineId    = parseInt(req.params.lineId, 10);

      if (!(await assertChapterOwner(req, res, chapterId))) return;

      const file = await readChapter(chapterId);
      const idx  = file.dialogues.findIndex(l => l.dialogue_id === lineId);
      if (idx === -1) return res.status(404).json({ error: 'Dialogue not found' });

      // field ไหนไม่ได้ส่งมา ให้คงค่าเดิมไว้ (ไม่เขียนทับด้วย null)
      file.dialogues[idx] = buildLineFromRequest(req.body || {}, file.dialogues[idx]);
      file.dialogues[idx].dialogue_id = lineId;

      await persistChapter(chapterId, file);
      res.json(file.dialogues[idx]);
    } catch (err) {
      console.error(err);
      if (err.status) return res.status(err.status).json({ error: err.message });
      res.status(500).json({ error: 'Failed to update dialogue' });
    }
  });

    app.delete('/api/chapters/:chapterId/dialogues/:lineId', requireApiAuth, async (req, res) => {
      try {
        const chapterId = parseInt(req.params.chapterId, 10);
        const lineId    = parseInt(req.params.lineId, 10);

        if (!(await assertChapterOwner(req, res, chapterId))) return;

        const file     = await readChapter(chapterId);
        const before   = file.dialogues.length;
        file.dialogues = file.dialogues.filter(l => l.dialogue_id !== lineId);

        if (file.dialogues.length === before) return res.status(404).json({ error: 'Dialogue not found' });

        await persistChapter(chapterId, file);
        res.json({ success: true });
      } catch (err) {
        console.error(err);
        res.status(500).json({ error: 'Failed to delete dialogue' });
      }
    });
  }

module.exports = { register };
