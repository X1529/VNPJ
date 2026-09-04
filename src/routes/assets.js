// ─── Assets API ────────────────────────────────────────────────────────────
// CRUD asset + จัดการไฟล์จริงบนดิสก์ (upload/replace/delete)

const path = require('path');
const fs = require('fs');
const { db } = require('../db');
const { BASE_URL } = require('../config');
const { upload, MulterFileTypeError } = require('../upload');
const {
  getFolderNameByType,
  placeCharacterFile,
  safeFilePath,
  normalizeAssetRow
} = require('../helpers');
const { ownerWhere, ownerValues, requireApiAuth, assertStoryOwner } = require('../auth');

function register(app) {
  app.get('/api/assets', async (req, res) => {
    try {
      // ?mine=1 → โหมดสตูดิโอ คืนเฉพาะ asset ของเจ้าของ (user_id/guest_id)
      // ปกติ → คืนทั้งหมด (หน้าเกมโหลด asset สาธารณะจากหลายเรื่องได้)
      let rows;
      if (req.query.mine === '1') {
        const o = ownerWhere(req);
        [rows] = await db.query(
          `SELECT * FROM assets WHERE ${o.clause} ORDER BY asset_id DESC`,
          o.params
        );
      } else {
        [rows] = await db.query('SELECT * FROM assets ORDER BY asset_id DESC');
      }
      res.json(rows.map(normalizeAssetRow));
    } catch (err) {
      console.error(err);
      res.status(500).json({ error: 'Failed to fetch assets' });
    }
  });

  app.get('/api/assets/:assetId', async (req, res) => {
    try {
      const [rows] = await db.query('SELECT * FROM assets WHERE asset_id = ?', [req.params.assetId]);
      if (!rows.length) return res.status(404).json({ error: 'Asset not found' });
      res.json(normalizeAssetRow(rows[0]));
    } catch (err) {
      console.error(err);
      res.status(500).json({ error: 'Failed to fetch asset' });
    }
  });

  app.get('/api/chapters/:chapterId/assets', async (req, res) => {
    try {
      const [rows] = await db.query(
        'SELECT * FROM assets WHERE chapter_id = ? ORDER BY asset_type, asset_name',
        [req.params.chapterId]
      );
      res.json(rows.map(normalizeAssetRow));
    } catch (err) {
      console.error(err);
      res.status(500).json({ error: 'Failed to fetch chapter assets' });
    }
  });

  app.post('/api/assets', requireApiAuth, upload.single('file'), async (req, res) => {
    try {
      const { story_id, chapter_id, asset_type, asset_name } = req.body;

      if (!req.file) return res.status(400).json({ error: 'File is required' });

      // ห้ามผูก asset เข้า story ของคนอื่น (default story_id=1 ก็ต้องเป็นของผู้ใช้)
      if (story_id && !(await assertStoryOwner(req, res, story_id))) return;

      let relativePath;
      if ((asset_type || 'character').toLowerCase() === 'character') {
        relativePath = placeCharacterFile(req.file, asset_name || req.file.originalname);
      } else {
        relativePath = `/assets/${getFolderNameByType(asset_type)}/${path.basename(req.file.path)}`;
      }

      const ov = ownerValues(req);
      const [result] = await db.query(
        `INSERT INTO assets
           (story_id, chapter_id, asset_type, asset_name, file_name, file_path, mime_type, size_bytes, user_id, guest_id)
         VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
        [
          story_id || 1,
          chapter_id || null,
          asset_type || 'character',
          asset_name || req.file.originalname,
          req.file.originalname,
          relativePath,
          req.file.mimetype,
          req.file.size,
          ov.user_id,
          ov.guest_id
        ]
      );

      res.status(201).json({
        success:  true,
        asset_id: result.insertId,
        file_url: `${BASE_URL}${relativePath}`
      });
    } catch (err) {
      console.error(err);
      if (err instanceof MulterFileTypeError) {
        return res.status(400).json({ error: err.message });
      }
      res.status(500).json({ error: 'Failed to create asset' });
    }
  });

  app.put('/api/assets/:assetId', requireApiAuth, upload.single('file'), async (req, res) => {
    try {
      const { story_id, chapter_id, asset_type, asset_name } = req.body;
      const [existingRows] = await db.query(
        'SELECT * FROM assets WHERE asset_id = ?',
        [req.params.assetId]
      );

      if (!existingRows.length) return res.status(404).json({ error: 'Asset not found' });

      const existing = existingRows[0];
      // ถ้ามีการย้ายไป story อื่น ต้องเป็น story ของผู้ใช้เท่านั้น
      if (story_id && String(story_id) !== String(existing.story_id)
          && !(await assertStoryOwner(req, res, story_id))) return;
      let nextPath  = existing.file_path;
      let fileName  = existing.file_name;
      let mimeType  = existing.mime_type;
      let sizeBytes = existing.size_bytes;

      if (req.file) {
        // ลบไฟล์เก่าก่อนใช้ไฟล์ใหม่
        const oldFilePath = safeFilePath(existing.file_path);
        if (fs.existsSync(oldFilePath)) fs.unlinkSync(oldFilePath);

        if ((asset_type || existing.asset_type).toLowerCase() === 'character') {
          nextPath = placeCharacterFile(req.file, asset_name || existing.asset_name);
        } else {
          nextPath = `/assets/${getFolderNameByType(asset_type || existing.asset_type)}/${path.basename(req.file.path)}`;
        }
        fileName  = req.file.originalname;
        mimeType  = req.file.mimetype;
        sizeBytes = req.file.size;
      }

      const o = ownerWhere(req);
      await db.query(
        `UPDATE assets
         SET story_id = ?, chapter_id = ?, asset_type = ?, asset_name = ?,
             file_name = ?, file_path = ?, mime_type = ?, size_bytes = ?
         WHERE asset_id = ? AND ${o.clause}`,
        [
          story_id   || existing.story_id,
          chapter_id === '' ? null : (chapter_id || existing.chapter_id),
          asset_type || existing.asset_type,
          asset_name || existing.asset_name,
          fileName,
          nextPath,
          mimeType,
          sizeBytes,
          req.params.assetId,
          ...o.params
        ]
      );

      res.json({ success: true });
    } catch (err) {
      console.error(err);
      res.status(500).json({ error: 'Failed to update asset' });
    }
  });

  app.delete('/api/assets/:assetId', requireApiAuth, async (req, res) => {
    try {
      const o = ownerWhere(req);
      const [rows] = await db.query(
        `SELECT * FROM assets WHERE asset_id = ? AND ${o.clause}`,
        [req.params.assetId, ...o.params]
      );
      if (!rows.length) return res.status(404).json({ error: 'Asset not found' });

      // ลบไฟล์จริงออกจากดิสก์ด้วย
      const filePath = safeFilePath(rows[0].file_path);
      if (fs.existsSync(filePath)) fs.unlinkSync(filePath);

      await db.query('DELETE FROM assets WHERE asset_id = ?', [req.params.assetId]);
      res.json({ success: true });
    } catch (err) {
      console.error(err);
      res.status(500).json({ error: 'Failed to delete asset' });
    }
  });
}

module.exports = { register };
