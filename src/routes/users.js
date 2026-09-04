// ─── Users API (Mock / Future Google Login) ──────────────────────────────────

const { GOOGLE_CLIENT_ID } = require('../config');
const {
  getCurrentUser, requireApiAuth, findUserByGoogleId, createUserFromGoogle,
  migrateGuestToUser
} = require('../auth');

function register(app) {
  // คืน Client ID ให้ฝั่ง browser ใช้ init Google Identity Services
  app.get('/api/config', (req, res) => {
    res.json({ googleClientId: GOOGLE_CLIENT_ID });
  });

  // ล็อกอิน (ตอนนี้จำลอง: ใช้ mock user id=1)
  // ⚠️ อนุญาตเฉพาะในโหมด development เท่านั้น — ใน production ให้ใช้ /api/auth/google
  // ป้องกันการปลอมแปลงเป็นเจ้าของ seed data (user id=1) ได้ง่ายๆ
  app.post('/api/login', async (req, res) => {
    if (process.env.NODE_ENV === 'production') {
      return res.status(403).json({ error: 'Mock login disabled in production' });
    }
    try {
      const user = await getCurrentUser(); // mock user id=1
      req.session.userId = user.user_id;
      // Migration: ย้ายข้อมูล guest (ถ้ามี) มาเป็นของ user นี้
      const gid = req.owner && req.owner.kind === 'guest' ? req.owner.guestId : null;
      await migrateGuestToUser(gid, user.user_id);
      res.clearCookie('guest_id');
      res.json(user);
    } catch (err) {
      console.error(err);
      res.status(500).json({ error: 'Login failed' });
    }
  });

  // ล็อกอินด้วย Google: รับ credential (JWT) จาก GIS แล้วตรวจสอบกับ Google
  app.post('/api/auth/google', async (req, res) => {
    try {
      const { credential } = req.body;
      if (!credential) return res.status(400).json({ error: 'Missing credential' });

      // ⚠️ ต้องตรวจสอบลายเซ็น (signature) ของ ID token ผ่าน Google
      //    วิธีที่ง่ายและปลอดภัยคือส่งไปให้ tokeninfo ตรวจสอบให้
      let info;
      try {
        const verifyRes = await fetch(
          `https://oauth2.googleapis.com/tokeninfo?id_token=${encodeURIComponent(credential)}`
        );
        info = await verifyRes.json();
        if (!verifyRes.ok || info.error) {
          return res.status(401).json({ error: 'Invalid Google token', detail: info.error_description });
        }
      } catch (netErr) {
        console.error('Google tokeninfo error:', netErr);
        return res.status(502).json({ error: 'Unable to verify Google token' });
      }

      // ตรวจ aud / iss / exp (tokeninfo ตรวจ signature ให้แล้ว)
      if (info.aud !== GOOGLE_CLIENT_ID) {
        return res.status(401).json({ error: 'Client ID mismatch (GOOGLE_CLIENT_ID in .env ไม่ตรงกับฝั่ง Google Console)' });
      }
      if (!String(info.iss || '').includes('accounts.google.com')) {
        return res.status(401).json({ error: 'Invalid issuer' });
      }
      if (info.exp && Date.now() / 1000 > Number(info.exp)) {
        return res.status(401).json({ error: 'Token expired' });
      }

      const googleId = info.sub;
      let user = await findUserByGoogleId(googleId);
      if (!user) {
        const userId = await createUserFromGoogle({
          email: info.email,
          googleId,
          displayName: info.name,
          avatarUrl: info.picture
        });
        user = await findUserByGoogleId(googleId);
        if (!user) {
          return res.status(500).json({ error: 'Failed to create user' });
        }
      }

      req.session.userId = user.user_id;
      // Migration: ย้ายข้อมูล guest (ถ้ามี) มาเป็นของ user นี้
      const gid = req.owner && req.owner.kind === 'guest' ? req.owner.guestId : null;
      await migrateGuestToUser(gid, user.user_id);
      res.clearCookie('guest_id');
      res.json(user);
    } catch (err) {
      console.error('Google auth error:', err);
      res.status(500).json({ error: 'Google login failed', detail: err.message });
    }
  });

  // ออกจากระบบ
  app.post('/api/logout', (req, res) => {
    req.session.destroy(() => {
      res.clearCookie('connect.sid');
      res.json({ success: true });
    });
  });

  // โปรไฟล์ผู้ใช้ปัจจุบัน (คืนผู้ใช้ที่ล็อกอินจริง จาก session)
  app.get('/api/me', requireApiAuth, async (req, res) => {
    try {
      const user = await getCurrentUser(req.session.userId);
      if (!user) return res.status(404).json({ error: 'Not logged in' });
      res.json(user);
    } catch (err) {
      console.error(err);
      res.status(500).json({ error: 'Failed to load user' });
    }
  });
}

module.exports = { register };
