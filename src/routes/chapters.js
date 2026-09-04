// ─── Chapters API ──────────────────────────────────────────────────────────
// CRUD chapter + endpoint อ่าน episode ของเกม (รวม assets_preload)

const fs = require('fs');
const { db } = require('../db');
const { readChapter, deleteChapterFile } = require('../../dialogue-store');
const { safeFilePath } = require('../helpers');
const { ownerWhere, ownerValues, assertStoryOwner, requireApiAuth } = require('../auth');

function register(app) {
  app.get('/api/stories/:storyId/chapters', async (req, res) => {
    try {
      // ?public=1 → โหมดสาธารณะ (หน้า Browse): คืนเฉพาะตอนที่ส่งออก (is_exported=1)
      // ของเรื่องที่เผยแพร่ ให้ผู้เล่นเลือกตอนได้โดยไม่ต้องล็อกอิน
      if (req.query.public === '1') {
        const [[story]] = await db.query(
          'SELECT story_id, is_published FROM stories WHERE story_id = ?',
          [req.params.storyId]
        );
        if (!story || !story.is_published) {
          return res.status(404).json({ error: 'Story not found' });
        }
        const [rows] = await db.query(
          `SELECT chapter_id, chapter_number, title, is_exported
           FROM chapters WHERE story_id = ? AND is_exported = 1
           ORDER BY chapter_number ASC`,
          [req.params.storyId]
        );
        return res.json({ story_id: Number(req.params.storyId), chapters: rows });
      }

      // ปกติ → scope เฉพาะ chapter ของเจ้าของ (user_id/guest_id) ใน story นี้
      const o = ownerWhere(req);
      const [rows] = await db.query(
        `SELECT * FROM chapters WHERE story_id = ? AND ${o.clause} ORDER BY chapter_number ASC`,
        [req.params.storyId, ...o.params]
      );
      res.json({ story_id: Number(req.params.storyId), chapters: rows });
    } catch (err) {
      console.error(err);
      res.status(500).json({ error: 'Failed to fetch chapters' });
    }
  });

  app.get('/api/chapters/:chapterId', async (req, res) => {
    try {
      const [rows] = await db.query('SELECT * FROM chapters WHERE chapter_id = ?', [req.params.chapterId]);
      if (!rows.length) return res.status(404).json({ error: 'Chapter not found' });
      res.json(rows[0]);
    } catch (err) {
      console.error(err);
      res.status(500).json({ error: 'Failed to fetch chapter' });
    }
  });

  app.post('/api/stories/:storyId/chapters', requireApiAuth, async (req, res) => {
    try {
      // ป้องกันสร้าง chapter ใน story ของคนอื่น
      if (!(await assertStoryOwner(req, res, req.params.storyId))) return;

      const { chapter_number, title, description } = req.body;
      if (!chapter_number || !title) {
        return res.status(400).json({ error: 'Chapter number and title are required' });
      }

      const ov = ownerValues(req);
      const isExported = req.body.is_exported ? 1 : 0;
      const [result] = await db.query(
        'INSERT INTO chapters (story_id, chapter_number, title, description, user_id, guest_id, is_exported) VALUES (?, ?, ?, ?, ?, ?, ?)',
        [req.params.storyId, chapter_number, title, description || null, ov.user_id, ov.guest_id, isExported]
      );

      res.status(201).json({
        chapter_id:     result.insertId,
        story_id:       Number(req.params.storyId),
        chapter_number,
        title,
        description:    description || null
      });
    } catch (err) {
      console.error(err);
      if (err.code === 'ER_DUP_ENTRY') {
        return res.status(409).json({ error: 'Chapter number already exists in this story' });
      }
      res.status(500).json({ error: 'Failed to create chapter' });
    }
  });

  app.put('/api/chapters/:chapterId', requireApiAuth, async (req, res) => {
    try {
      const { chapter_number, title, description } = req.body;
      const isExported = req.body.is_exported ? 1 : 0;
      const o = ownerWhere(req);
      const [result] = await db.query(
        `UPDATE chapters SET chapter_number = ?, title = ?, description = ?, is_exported = ?
         WHERE chapter_id = ? AND ${o.clause}`,
        [chapter_number, title, description || null, isExported, req.params.chapterId, ...o.params]
      );
      if (result.affectedRows === 0) return res.status(404).json({ error: 'Chapter not found' });
      res.json({ success: true });
    } catch (err) {
      console.error(err);
      res.status(500).json({ error: 'Failed to update chapter' });
    }
  });

  app.delete('/api/chapters/:chapterId', requireApiAuth, async (req, res) => {
    try {
      const o = ownerWhere(req);

      // รวบรวม file_path ของ asset ของ chapter นี้ (ก่อนลบ record)
      const [assets] = await db.query(
        `SELECT file_path FROM assets WHERE chapter_id = ? AND ${o.clause}`,
        [req.params.chapterId, ...o.params]
      );
      // ลบ asset rows ของ chapter นี้ก่อน (scoped ด้วยเจ้าของ)
      await db.query(
        `DELETE FROM assets WHERE chapter_id = ? AND ${o.clause}`,
        [req.params.chapterId, ...o.params]
      );
      // ลบไฟล์จริงเฉพาะ path ที่ไม่มี asset ใดอ้างอิงอีก (กันลบไฟล์ที่แชร์ข้าม chapter/story)
      for (const asset of assets) {
        const [refs] = await db.query(
          'SELECT COUNT(*) AS cnt FROM assets WHERE file_path = ?',
          [asset.file_path]
        );
        if (refs[0].cnt === 0) {
          const filePath = safeFilePath(asset.file_path);
          if (fs.existsSync(filePath)) fs.unlinkSync(filePath);
        }
      }

      const [result] = await db.query(
        `DELETE FROM chapters WHERE chapter_id = ? AND ${o.clause}`,
        [req.params.chapterId, ...o.params]
      );
      if (result.affectedRows === 0) return res.status(404).json({ error: 'Chapter not found' });

      // ลบไฟล์บทสนทนาของ chapter นี้ด้วย
      await deleteChapterFile(req.params.chapterId);

      res.json({ success: true });
    } catch (err) {
      console.error(err);
      res.status(500).json({ error: 'Failed to delete chapter' });
    }
  });

  // ─── Endpoint ของเกม: อ่าน episode จาก story+chapter number ──────────────
  app.get('/api/stories/:storyId/chapters/:chapterNumber/dialogues', async (req, res) => {
    try {
      const storyId       = parseInt(req.params.storyId, 10);
      const chapterNumber = parseInt(req.params.chapterNumber, 10);

      if (isNaN(storyId) || isNaN(chapterNumber)) {
        return res.status(400).json({ error: 'Invalid story or chapter number format.' });
      }

      const [chapterRows] = await db.query(
        'SELECT * FROM chapters WHERE story_id = ? AND chapter_number = ?',
        [storyId, chapterNumber]
      );

      if (!chapterRows.length) return res.status(404).json({ error: 'Chapter not found' });

      const chapter = chapterRows[0];
      const file = await readChapter(chapter.chapter_id);
      file.dialogues.sort((a, b) => (a.sort_order || 0) - (b.sort_order || 0));

      // แผนที่ chapter_number -> is_exported ของเรื่องนี้
      // ใช้ให้ Game Engine ซ่อน/ปิดตัวเลือกที่นำไปสู่ตอนที่ยังไม่ส่งออก (Draft)
      const [allChapters] = await db.query(
        'SELECT chapter_number, is_exported FROM chapters WHERE story_id = ?',
        [storyId]
      );
      const chaptersExport = {};
      allChapters.forEach((c) => { chaptersExport[c.chapter_number] = !!c.is_exported; });

      res.json({
        story_id:       storyId,
        chapter_id:     chapter.chapter_id,
        chapter_number: chapter.chapter_number,
        chapter_title:  chapter.title,
        assets_preload: file.assets_preload || [],
        dialogue:       file.dialogues,
        chaptersExport
      });
    } catch (err) {
      console.error(err);
      res.status(500).json({ error: 'Failed to fetch chapter dialogue' });
    }
  });
}

module.exports = { register };
