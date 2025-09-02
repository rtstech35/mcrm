console.log('🚀 Server başlatılıyor...');

const setupDatabase = require('./setup-database.js');
require("dotenv").config();
console.log('✅ Environment variables yüklendi');

const express = require("express");
const cors = require("cors");
// const bcrypt = require("bcryptjs"); // Rotalara taşındı
// const jwt = require("jsonwebtoken"); // Middleware'e taşındı
const { Pool } = require("pg");
const path = require("path");
const fs = require("fs");
console.log('✅ Temel modüller yüklendi');

// --- GÜVENLİK VE ORTAM AYARLARI ---
const JWT_SECRET = process.env.JWT_SECRET;
if (!JWT_SECRET && process.env.NODE_ENV === 'production') {
    console.error("❌ KRİTİK HATA: JWT_SECRET ortam değişkeni production ortamında zorunludur.");
    console.error("❌ Güvenlik nedeniyle sunucu başlatılamıyor. Lütfen Render panelinden JWT_SECRET değişkenini ayarlayın.");
    process.exit(1); // Sunucuyu başlatma
} else if (!JWT_SECRET) {
    console.warn("⚠️ UYARI: JWT_SECRET tanımlanmamış. Geliştirme için geçici anahtar kullanılacak. Production'da mutlaka ayarlayın!");
}

const app = express();

// Production için güvenli CORS ayarları
const allowedOrigins = process.env.NODE_ENV === 'production'
    ? (process.env.FRONTEND_URL || 'https://your-frontend-app.onrender.com') // Render'daki frontend adresiniz
    : ['http://localhost:3000', 'http://127.0.0.1:3000', 'http://localhost:5500', 'http://127.0.0.1:5500']; // Yerel geliştirme adresleri

const corsOptions = {
    origin: allowedOrigins,
    optionsSuccessStatus: 200
};
app.use(cors(corsOptions));
console.log(`✅ CORS ayarlandı. İzin verilen origin(ler): ${allowedOrigins}`);

app.use(express.json());
console.log('✅ Express app yapılandırıldı');

// ---------------- API ROTALARINI ÖNCELİKLENDİR ---------------- //
// API rotaları static dosyalardan önce tanımlanmalı

// API prefix kontrolü
app.use('/api/*', (req, res, next) => {
  console.log('🔗 API isteği:', req.method, req.url);
  next();
});

// ---------------- ROTA DOSYALARINI YÜKLE ---------------- //
const authRoutes = require('./routes/auth');
const usersRoutes = require('./routes/users');
const productsRoutes = require('./routes/products'); // Yeni
const customersRoutes = require('./routes/customers'); // Yeni
const ordersRoutes = require('./routes/orders'); // Yeni
const deliveryNotesRoutes = require('./routes/deliveryNotes'); // Yeni
const rolesRoutes = require('./routes/roles'); // Yeni
const departmentsRoutes = require('./routes/departments'); // Yeni
const appointmentsRoutes = require('./routes/appointments'); // Yeni
const visitsRoutes = require('./routes/visits'); // Yeni
const accountingRoutes = require('./routes/accounting'); // Yeni
const invoicesRoutes = require('./routes/invoices'); // Yeni
const dashboardRoutes = require('./routes/dashboard'); // Yeni
const mailRoutes = require('./routes/mail'); // Yeni
const systemRoutes = require('./routes/system'); // Yeni
const profileRoutes = require('./routes/profile'); // Yeni
const targetsRoutes = require('./routes/targets'); // Yeni
console.log('✅ Tüm rota modülleri yüklendi');

// ---------------- POSTGRESQL BAĞLANTI ---------------- //
console.log('💾 Database bağlantısı yapılandırılıyor...');
console.log('DATABASE_URL:', process.env.DATABASE_URL ? '✅ Tanımlı' : '❌ Tanımsız');

let pool;
try {
  pool = new Pool({
    connectionString: process.env.DATABASE_URL,
    ssl: { rejectUnauthorized: false },
  });
  console.log('✅ Database pool oluşturuldu');
} catch (error) {
  console.error('❌ Database pool oluşturma hatası:', error);
  // Dummy pool oluştur
  pool = {
    query: () => Promise.reject(new Error('Database bağlantısı yok')),
    connect: () => Promise.reject(new Error('Database bağlantısı yok'))
  };
}

// Order items tablosunu otomatik oluştur ve güncelle
async function ensureOrderItemsTable() {
  try {
    // Tabloyu oluştur
    await pool.query(`
      CREATE TABLE IF NOT EXISTS order_items (
          id SERIAL PRIMARY KEY,
          order_id INTEGER REFERENCES orders(id) ON DELETE CASCADE,
          product_id INTEGER,
          product_name VARCHAR(200),
          quantity INTEGER NOT NULL DEFAULT 1,
          unit_price DECIMAL(10,2) DEFAULT 0,
          total_price DECIMAL(10,2) DEFAULT 0,
          unit VARCHAR(20) DEFAULT 'adet',
          created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
      );
    `);
    
    // Eksik kolonları ekle
    await pool.query(`
      DO $$
      BEGIN
          IF NOT EXISTS (SELECT 1 FROM information_schema.columns WHERE table_name = 'order_items' AND column_name = 'product_name') THEN
              ALTER TABLE order_items ADD COLUMN product_name VARCHAR(200);
          END IF;
          
          IF NOT EXISTS (SELECT 1 FROM information_schema.columns WHERE table_name = 'order_items' AND column_name = 'unit') THEN
              ALTER TABLE order_items ADD COLUMN unit VARCHAR(20) DEFAULT 'adet';
          END IF;
      END $$;
    `);
    
    console.log('✅ Order items tablosu kontrol edildi ve güncellendi');
  } catch (error) {
    console.log('⚠️ Order items tablosu oluşturulamadı:', error.message);
  }
}

// Bağlantıyı test et ve database setup yap
if (pool && pool.connect) {
    pool.connect()
        .then(async (client) => {
            try {
                console.log("✅ PostgreSQL bağlantısı başarılı");

                // 1. Check if the database is already set up by looking for a key table.
                const checkResult = await client.query(`
                    SELECT EXISTS (
                        SELECT FROM information_schema.tables 
                        WHERE table_schema = 'public' AND table_name = 'roles'
                    );
                `);
                const isSetupNeeded = !checkResult.rows[0].exists;

                if (isSetupNeeded) {
                    console.log("🚀 Veritabanı kurulumu gerekli. Kurulum script'i otomatik olarak çalıştırılıyor...");
                    await setupDatabase();
                    console.log("🎉 Veritabanı kurulumu tamamlandı. Sunucu normal şekilde devam ediyor.");
                } else {
                    console.log("✅ Veritabanı zaten kurulu. Migration'lar kontrol ediliyor...");
                    await runMigrations();
                }

                await ensureOrderItemsTable();
            } catch (setupError) {
                console.error("❌ Veritabanı kurulumu veya migration sırasında kritik hata:", setupError);
                process.exit(1); // Exit if setup fails
            } finally {
                client.release();
            }
        })
        .catch(err => {
            console.error("❌ PostgreSQL bağlantı veya kurulum hatası:", err);
            process.exit(1); // Kritik hatada sunucuyu durdur
        });
} else {
  console.log("⚠️ Database pool oluşturulamadı, server database olmadan çalışacak");
}

// Otomatik veritabanı migration fonksiyonu
async function runMigrations() {
  const client = await pool.connect();
  try {
    console.log('🔄 Veritabanı migration kontrolü başlatılıyor...');

    // 1. Migrations tablosunun varlığını kontrol et, yoksa oluştur
    await client.query(`
      CREATE TABLE IF NOT EXISTS migrations (
        id SERIAL PRIMARY KEY,
        name VARCHAR(255) UNIQUE NOT NULL,
        run_on TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP
      );
    `);

    // 2. Çalıştırılmış migration'ları al
    const ranMigrationsResult = await client.query('SELECT name FROM migrations;');
    const ranMigrations = ranMigrationsResult.rows.map(row => row.name);

    // 3. Migration dosyalarını oku
    const migrationsDir = path.join(__dirname, 'database', 'migrations');
    if (!fs.existsSync(migrationsDir)) fs.mkdirSync(migrationsDir, { recursive: true });
    
    const migrationFiles = fs.readdirSync(migrationsDir).filter(file => file.endsWith('.sql')).sort();

    // 4. Çalıştırılmamış olanları çalıştır
    for (const file of migrationFiles) {
      if (!ranMigrations.includes(file)) {
        console.log(`🚀 Yeni migration çalıştırılıyor: ${file}`);
        const sql = fs.readFileSync(path.join(migrationsDir, file), 'utf8');
        await client.query(sql);
        await client.query('INSERT INTO migrations (name) VALUES ($1)', [file]);
        console.log(`✅ Migration başarıyla tamamlandı: ${file}`);
      }
    }
    console.log('🏁 Veritabanı migration kontrolü tamamlandı.');
  } catch (err) {
    console.error('❌ Migration işlemi sırasında kritik hata:', err);
    throw err; // Sunucunun başlamasını engelle
  } finally {
    client.release();
  }
}

// ---------------- ROTALARI KULLAN ---------------- //
app.use('/api/auth', authRoutes);
app.use('/api/users', usersRoutes);
app.use('/api/products', productsRoutes);
app.use('/api/customers', customersRoutes);
app.use('/api/orders', ordersRoutes);
app.use('/api/delivery-notes', deliveryNotesRoutes);
app.use('/api/roles', rolesRoutes);
app.use('/api/departments', departmentsRoutes);
app.use('/api/appointments', appointmentsRoutes);
app.use('/api/visits', visitsRoutes);
app.use('/api/accounting', accountingRoutes);
app.use('/api/invoices', invoicesRoutes);
app.use('/api/dashboard', dashboardRoutes);
app.use('/api/mail', mailRoutes);
app.use('/api/system', systemRoutes);
app.use('/api/profile', profileRoutes);
app.use('/api/user-targets', targetsRoutes);
// ---------------- YARDIMCI FONKSİYONLAR ---------------- //

// Güvenli tablo kontrolü yardımcı fonksiyonu
async function checkTableExists(tableName) {
  try {
    const result = await pool.query(`
      SELECT EXISTS (
        SELECT FROM information_schema.tables WHERE table_schema = 'public' AND table_name = $1
      );
    `, [tableName]);
    return result.rows[0].exists;
  } catch (error) {
    console.error(`Tablo kontrolü hatası (${tableName}):`, error);
    return false;
  }
}

// ---------------- TEST ---------------- //
app.get("/", (req, res) => {
  // Ana sayfa isteği geldiğinde doğrudan login sayfasını (index.html) gönder.
  // Bu, kullanıcıların test sayfası yerine giriş ekranını görmesini sağlar.
  res.sendFile(path.join(__dirname, "public", "index.html"));
});

// ---------------- STATİK DOSYALAR (API'lerden sonra) ---------------- //
app.use(express.static(path.join(__dirname, "public")));

app.get("/admin", (req, res) => {
  res.sendFile(path.join(__dirname, "public", "admin.html"));
});

app.get("/admin-simple", (req, res) => {
  res.sendFile(path.join(__dirname, "public", "admin-simple.html"));
});

app.get("/setup", (req, res) => {
  res.sendFile(path.join(__dirname, "public", "setup.html"));
});

app.get("/database-manager", (req, res) => {
  res.sendFile(path.join(__dirname, "public", "database-manager.html"));
});

// ---------------- 404 HANDLER ---------------- //
app.use((req, res) => {
  console.log('404 - Bulunamayan endpoint:', req.method, req.url);
  res.status(404).json({ error: 'Endpoint bulunamadı: ' + req.url });
});

// ---------------- SUNUCU ---------------- //
const PORT = process.env.PORT || 10000;
app.listen(PORT, () => {
  console.log(`🚀 Server running on port ${PORT}`);
  console.log(`📱 Environment: ${process.env.NODE_ENV || 'development'}`);
  console.log(`🔐 JWT Secret: ${process.env.JWT_SECRET ? '✅ Tanımlı' : '❌ Tanımsız'}`);
  console.log(`💾 Database URL: ${process.env.DATABASE_URL ? '✅ Tanımlı' : '❌ Tanımsız'}`);
  console.log(`🌐 Server URL: https://mcrm-lx1p.onrender.com`);
});

// ---------------- ERROR HANDLER ---------------- //
app.use((err, req, res, next) => {
  console.error('Sunucu hatası:', err);
  res.status(500).json({ error: 'Sunucu hatası oluştu' });
});
