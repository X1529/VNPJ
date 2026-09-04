// ─── Stories API ───────────────────────────────────────────────────────────
// CRUD story — ลบ story = ลบไฟล์ asset + ไฟล์บทสนทนาของทุก chapter ในเรื่องด้วย

const fs = require('fs');
const path = require('path');
const { db } = require('../db');
const { deleteChapterFile } = require('../../dialogue-store');
const { safeFilePath } = require('../helpers');
const { BASE_URL } = require('../config');
const { coverUpload, MulterFileTypeError } = require('../upload');
const { ownerWhere, ownerValues, requireApiAuth } = require('../auth');

function register(app) {
  // อัปโหลดรูปปก Story จากเครื่อง localhost → คืน URL
  app.post('/api/stories/cover', requireApiAuth, coverUpload.single('file'), async (req, res) => {
    try {
      if (!req.file) return res.status(400).json({ error: 'File is required' });
      const relativePath = `/assets/covers/${path.basename(req.file.path)}`;
      res.status(201).json({ file_url: `${BASE_URL}${relativePath}` });
    } catch (err) {
      console.error(err);
      if (err instanceof MulterFileTypeError) return res.status(400).json({ error: err.message });
      res.status(500).json({ error: 'Failed to upload cover' });
    }
  });

  app.get('/api/stories', async (req, res) => {
    try {
      // ?discover=1 → โหมดสาธารณะ (หน้า Browse/Home) คืนเฉพาะเรื่องที่เผยแพร่
      //   แล้วมีอย่างน้อยหนึ่งตอน (episode) ที่ส่งออก (is_exported = true)
      // ปกติ → scope เฉพาะเจ้าของ (user_id หรือ guest_id) สำหรับสตูดิโอ
      let rows;
      if (req.query.discover === '1') {
        [rows] = await db.query(
          `SELECT s.* FROM stories s
           WHERE s.is_published = 1
             AND EXISTS (
               SELECT 1 FROM chapters c
               WHERE c.story_id = s.story_id AND c.is_exported = 1
             )
           ORDER BY s.created_at DESC`
        );
      } else {
        const o = ownerWhere(req);
        [rows] = await db.query(
          `SELECT * FROM stories WHERE ${o.clause} ORDER BY created_at DESC`,
          o.params
        );
      }
      res.json(rows);
    } catch (err) {
      console.error(err);
      res.status(500).json({ error: 'Failed to fetch stories' });
    }
  });

  app.get('/api/stories/:storyId', async (req, res) => {
    try {
      // ?public=1 → โหมดสาธารณะ (หน้ารายละเอียด): คืนเรื่องที่เผยแพร่
      // พร้อมรายการตอนที่ส่งออก (is_exported = 1) ให้ผู้เล่นเลือกเล่น
      if (req.query.public === '1') {
        const [[story]] = await db.query(
          `SELECT story_id, title, description, cover_url, is_published, created_at
           FROM stories WHERE story_id = ? AND is_published = 1`,
          [req.params.storyId]
        );
        if (!story) return res.status(404).json({ error: 'Story not found' });
        const [chapters] = await db.query(
          `SELECT chapter_id, chapter_number, title, is_exported
           FROM chapters WHERE story_id = ? AND is_exported = 1
           ORDER BY chapter_number ASC`,
          [req.params.storyId]
        );
        return res.json({ ...story, chapters });
      }

      const [rows] = await db.query('SELECT * FROM stories WHERE story_id = ?', [req.params.storyId]);
      if (!rows.length) return res.status(404).json({ error: 'Story not found' });
      res.json(rows[0]);
    } catch (err) {
      console.error(err);
      res.status(500).json({ error: 'Failed to fetch story' });
    }
  });

  app.post('/api/stories', requireApiAuth, async (req, res) => {
    try {
      const { title, cover_url, description } = req.body;
      if (!title) return res.status(400).json({ error: 'Title is required' });

      const ov = ownerValues(req);
      const isPublished = req.body.is_published ? 1 : 0;
      const [result] = await db.query(
        'INSERT INTO stories (title, cover_url, description, user_id, guest_id, is_published) VALUES (?, ?, ?, ?, ?, ?)',
        [title, cover_url || null, description || null, ov.user_id, ov.guest_id, isPublished]
      );

      res.status(201).json({
        story_id:    result.insertId,
        title,
        cover_url:   cover_url || null,
        description: description || null
      });
    } catch (err) {
      console.error(err);
      res.status(500).json({ error: 'Failed to create story' });
    }
  });

  app.put('/api/stories/:storyId', requireApiAuth, async (req, res) => {
    try {
      const { title, cover_url, description } = req.body;
      const isPublished = req.body.is_published ? 1 : 0;
      const o = ownerWhere(req);
      const [result] = await db.query(
        `UPDATE stories SET title = ?, cover_url = ?, description = ?, is_published = ?
         WHERE story_id = ? AND ${o.clause}`,
        [title, cover_url || null, description || null, isPublished, req.params.storyId, ...o.params]
      );
      if (result.affectedRows === 0) return res.status(404).json({ error: 'Story not found' });
      res.json({ success: true });
    } catch (err) {
      console.error(err);
      res.status(500).json({ error: 'Failed to update story' });
    }
  });

  app.delete('/api/stories/:storyId', requireApiAuth, async (req, res) => {
    try {
      // ลบไฟล์บนดิสก์ของ assets ทั้งหมดใน story ก่อน (record เองถูก cascade)
      const o = ownerWhere(req);

      // รวบรวม file_path ของ asset ทั้งหมดใน story (ก่อนลบ record)
      const [assets] = await db.query(
        `SELECT file_path FROM assets WHERE story_id = ? AND ${o.clause}`,
        [req.params.storyId, ...o.params]
      );

      // ลบ asset rows ของ story นี้ก่อน (scoped ด้วยเจ้าของ)
      await db.query(
        `DELETE FROM assets WHERE story_id = ? AND ${o.clause}`,
        [req.params.storyId, ...o.params]
      );

      // ลบไฟล์จริงเฉพาะ path ที่ "ไม่มี asset ใดอ้างอิงอีก" (กันลบไฟล์ที่แชร์ข้าม story)
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

      // จำ chapter ids ไว้ลบไฟล์บทสนทนาหลัง record ถูกลบ
      const [chapters] = await db.query(
        'SELECT chapter_id FROM chapters WHERE story_id = ?',
        [req.params.storyId]
      );

      const [result] = await db.query(
        `DELETE FROM stories WHERE story_id = ? AND ${o.clause}`,
        [req.params.storyId, ...o.params]
      );
      if (result.affectedRows === 0) return res.status(404).json({ error: 'Story not found' });

      for (const ch of chapters) {
        await deleteChapterFile(ch.chapter_id);
      }

      res.json({ success: true });
    } catch (err) {
      console.error(err);
      res.status(500).json({ error: 'Failed to delete story' });
    }
  });
}

module.exports = { register };
