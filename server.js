import express from 'express';
import sqlite3 from 'sqlite3';
import { open } from 'sqlite';

const app = express();
app.use(express.json());

let db;

// دالة لفتح قاعدة البيانات
async function openDb() {
  db = await open({
    filename: 'licenses.db',
    driver: sqlite3.Database,
  });

  // أنشئ الجدول إذا لم يكن موجودًا
  await db.exec(`
    CREATE TABLE IF NOT EXISTS licenses (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      license_key TEXT UNIQUE NOT NULL,
      hwid TEXT,
      expires_at TEXT,
      active BOOLEAN DEFAULT 1
    )
  `);
  console.log('Database ready.');
}

// دالة لتشغيل الخادم بعد جاهزية قاعدة البيانات
async function startServer() {
  await openDb();

  // --- ENDPOINTS ---

  // التحقق من الترخيص
  app.post('/api/verify-license', async (req, res) => {
    const { licenseKey, hwid } = req.body;

    if (!licenseKey) {
      return res.status(400).json({ valid: false, message: 'License key is required' });
    }

    try {
      const license = await db.get('SELECT * FROM licenses WHERE license_key = ?', licenseKey);

      if (!license) {
        return res.status(400).json({ valid: false, message: 'Invalid license key' });
      }

      if (!license.active) {
        return res.status(400).json({ valid: false, message: 'License is deactivated' });
      }

      const now = new Date();
      const expiresAt = new Date(license.expires_at);
      if (now > expiresAt) {
        return res.status(400).json({ valid: false, message: 'License has expired' });
      }

      // (اختياري) تحقق من HWID
      if (license.hwid && license.hwid !== hwid) {
        return res.status(400).json({ valid: false, message: 'License is bound to another machine' });
      }

      // (اختياري) ربط HWID إذا لم يكن مربوطًا
      if (!license.hwid) {
        await db.run('UPDATE licenses SET hwid = ? WHERE license_key = ?', [hwid, licenseKey]);
      }

      res.json({ valid: true, expiresAt: license.expires_at, message: 'License is valid' });
    } catch (error) {
      console.error('Database error:', error);
      res.status(500).json({ valid: false, message: 'Internal server error' });
    }
  });

  // (اختياري) endpoint لإنشاء ترخيص جديد (تحتاج حماية أقوى في الاستخدام الفعلي)
  app.post('/api/create-license', async (req, res) => {
    // هذا endpoint مخصص فقط لك (لإنشاء تراخيص للزبائن)
    // يجب حمايته بكلمة مرور أو IP معروف
    const { licenseKey, expiresAt } = req.body;
    if (!licenseKey || !expiresAt) {
      return res.status(400).json({ message: 'License key and expiration date required' });
    }

    try {
      await db.run(
        'INSERT INTO licenses (license_key, expires_at) VALUES (?, ?)',
        [licenseKey, expiresAt]
      );
      res.json({ message: 'License created successfully' });
    } catch (error) {
      if (error.code === 'SQLITE_CONSTRAINT_UNIQUE') {
        res.status(400).json({ message: 'License key already exists' });
      } else {
        console.error('Database error:', error);
        res.status(500).json({ message: 'Internal server error' });
      }
    }
  });

  // --- END OF ENDPOINTS ---

  const PORT = process.env.PORT || 3000;
  app.listen(PORT, () => {
    console.log(`License server running on port ${PORT}`);
  });
}

startServer().catch(console.error);
