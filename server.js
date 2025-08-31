console.log('🚀 Server başlatılıyor...');

require("dotenv").config();
console.log('✅ Environment variables yüklendi');

const express = require("express");
const cors =require("cors");
const bcrypt = require("bcryptjs");
const jwt = require("jsonwebtoken");
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

let setupDatabase;
try {
  setupDatabase = require("./setup-database");
  console.log('✅ setup-database.js yüklendi');
} catch (error) {
  console.log('⚠️ setup-database.js yüklenemedi:', error.message);
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
    .then(async () => {
      console.log("✅ PostgreSQL bağlantısı başarılı");

      // Veritabanı migration'larını çalıştır (Production için güvenli)
      await runMigrations();
      
      // Order items tablosunu kontrol et
      await ensureOrderItemsTable();

      // DİKKAT: Production'da otomatik ve yıkıcı database setup'ı engelle!
      if (process.env.NODE_ENV !== 'production') {
        try {
          console.log("🔄 Geliştirme ortamı için database setup kontrol ediliyor...");
          if (setupDatabase) {
            await setupDatabase();
            console.log("✅ Geliştirme ortamı için database setup tamamlandı");
          } else {
            console.log("⚠️ setupDatabase fonksiyonu bulunamadı, manuel kurulum gerekli");
          }
        } catch (error) {
          console.log("⚠️ Database setup hatası:", error.message);
        }
      } else {
        console.log("✅ Production ortamı, otomatik database setup atlandı.");
      }
    })
    .catch(err => {
      console.error("❌ PostgreSQL bağlantı hatası:", err);
      console.log("⚠️ Server database olmadan devam ediyor...");
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

// ---------------- TEST ---------------- //
app.get("/", (req, res) => {
  res.send(`
    <html>
      <head><title>CRM Server Status</title></head>
      <body style="font-family: Arial; padding: 20px;">
        <h1>🚀 Saha CRM Sistemi Çalışıyor</h1>
        <p><strong>Server Durumu:</strong> ✅ Aktif</p>
        <p><strong>Zaman:</strong> ${new Date().toLocaleString('tr-TR')}</p>
        <p><strong>Environment:</strong> ${process.env.NODE_ENV || 'development'}</p>
        <p><strong>Database URL:</strong> ${process.env.DATABASE_URL ? '✅ Tanımlı' : '❌ Tanımsız'}</p>
        <hr>
        <h3>Test Linkleri:</h3>
        <ul>
          <li><a href="/setup">Setup Sayfası</a></li>
          <li><a href="/admin">Admin Paneli</a></li>
          <li><a href="/api/health">Health Check API</a></li>
        </ul>
      </body>
    </html>
  `);
});

// Database durumu kontrol API'si
app.get("/api/health", async (req, res) => {
  try {
    console.log("🏥 Health check API çağrıldı");

    // Database bağlantısını test et
    const timeResult = await pool.query('SELECT NOW() as current_time');
    console.log("✅ Database bağlantısı çalışıyor");

    // Tabloları kontrol et
    const tablesResult = await pool.query(`
      SELECT table_name
      FROM information_schema.tables
      WHERE table_schema = 'public'
      ORDER BY table_name
    `);

    const tables = tablesResult.rows.map(row => row.table_name);
    console.log("📋 Mevcut tablolar:", tables);

    // Her tablo için kayıt sayısını kontrol et
    const tableCounts = {};
    for (const table of tables) {
      try {
        const countResult = await pool.query(`SELECT COUNT(*) as count FROM ${table}`);
        tableCounts[table] = parseInt(countResult.rows[0].count);
      } catch (error) {
        tableCounts[table] = `Hata: ${error.message}`;
      }
    }

    res.json({
      success: true,
      database_time: timeResult.rows[0].current_time,
      tables: tables,
      table_counts: tableCounts,
      environment: process.env.NODE_ENV || 'development',
      database_url_exists: !!process.env.DATABASE_URL
    });

  } catch (error) {
    console.error("❌ Health check hatası:", error);
    res.status(500).json({
      success: false,
      error: error.message,
      stack: process.env.NODE_ENV === 'development' ? error.stack : undefined
    });
  }
});

// ---------------- AUTH ---------------- //
app.post("/api/register", async (req, res) => {
  try {
    console.log("Register isteği geldi:", req.body);
    const { username, password, full_name, email, role_id, department_id } = req.body;
    
    // Kullanıcı kontrolü
    const existingUser = await pool.query("SELECT * FROM users WHERE username = $1", [username]);
    console.log("Register kontrol sonucu:", existingUser.rows.length);

    if (existingUser.rows.length > 0) {
      return res.status(400).json({ error: "Kullanıcı zaten mevcut" });
    }

    // Şifreyi hash'le
    const hashedPassword = await bcrypt.hash(password, 10);
    
    // Yeni kullanıcı ekle
    await pool.query(
      "INSERT INTO users (username, password_hash, full_name, email, role_id, department_id, is_active) VALUES ($1, $2, $3, $4, $5, $6, $7)",
      [username, hashedPassword, full_name || username, email, role_id || 1, department_id || 5, true]
    );

    console.log("Yeni kullanıcı eklendi:", username);
    res.json({ success: true, message: "Kullanıcı başarıyla eklendi" });
  } catch (err) {
    console.error("Register hatası:", err);
    res.status(500).json({ error: "Kayıt sırasında hata oluştu" });
  }
});

// ---------------- LOGIN ENDPOINT (DÜZELME TESTİ) ---------------- //
app.post("/api/login", async (req, res) => {
  try {
    console.log("🔍 BASIT TEST - Login isteği:", req.body);
    const { username, password } = req.body;
    
    // Kullanıcıyı ara
    const result = await pool.query(`
      SELECT u.*, r.name as role_name, r.permissions, d.name as department_name
      FROM users u
      LEFT JOIN roles r ON u.role_id = r.id
      LEFT JOIN departments d ON u.department_id = d.id
      WHERE u.username = $1
    `, [username]);
    
    if (result.rows.length === 0) {
      console.log("❌ Kullanıcı bulunamadı");
      return res.status(401).json({ error: "Kullanıcı adı veya şifre hatalı" });
    }
    
    const user = result.rows[0];
    console.log("✅ Kullanıcı bulundu:", user.username);
    console.log("DB'deki şifre:", user.password_hash);
    console.log("Girilen şifre:", password);
    
    // GEÇICI: Düz metin karşılaştırması
    if (user.password_hash === password) {
      console.log("✅ Düz metin şifre eşleşti!");
      
      // JWT token oluştur
      const token = jwt.sign(
        { 
          userId: user.id, 
          username: user.username, 
          role: user.role_name,
          permissions: user.permissions || {} // Yetkileri token'a ekle
        },
        JWT_SECRET || "fallback_secret_key_change_in_production", // Geliştirme için fallback
        { expiresIn: "24h" }
      );
      
      return res.json({ 
        success: true,
        token,
        user: {
          id: user.id,
          username: user.username,
          full_name: user.full_name,
          role_id: user.role_id,
          role_name: user.role_name,
          department_id: user.department_id,
          department_name: user.department_name,
          permissions: user.permissions || {}
        }
      });
    }
    
    // bcrypt dene
    try {
      const isMatch = await bcrypt.compare(password, user.password_hash);
      console.log("bcrypt sonucu:", isMatch);
      
      if (isMatch) {
        console.log("✅ bcrypt şifre eşleşti!");
        
        const token = jwt.sign(
          { 
            userId: user.id, 
            username: user.username, 
            role: user.role_name,
            permissions: user.permissions || {} // Yetkileri token'a ekle
          },
          JWT_SECRET || "fallback_secret_key_change_in_production",
          { expiresIn: "24h" }
        );
        
        return res.json({ 
          success: true,
          token,
          user: {
            id: user.id,
            username: user.username,
            full_name: user.full_name,
            role_id: user.role_id,
            role_name: user.role_name,
            department_id: user.department_id,
            department_name: user.department_name,
            permissions: user.permissions || {}
          }
        });
      }
    } catch (bcryptError) {
      console.log("bcrypt hatası:", bcryptError.message);
    }
    
    console.log("❌ Hiçbir şifre yöntemi çalışmadı");
    return res.status(401).json({ error: "Kullanıcı adı veya şifre hatalı" });
    
  } catch (err) {
    console.error("Login hatası:", err);
    res.status(500).json({ error: "Sunucu hatası: " + err.message });
  }
});

// ---------------- JWT MIDDLEWARE ---------------- //
const authenticateToken = (req, res, next) => {
  const authHeader = req.headers['authorization'];
  const token = authHeader && authHeader.split(' ')[1];

  if (!token) {
    return res.status(401).json({ error: 'Access token gerekli' });
  }

  jwt.verify(token, JWT_SECRET || "fallback_secret_key_change_in_production", (err, user) => {
    if (err) {
      return res.status(403).json({ error: 'Geçersiz token' });
    }
    // Güvenlik önlemi: Eğer permissions string ise, JSON.parse yap
    if (user && user.permissions && typeof user.permissions === 'string') {
        try {
            user.permissions = JSON.parse(user.permissions);
        } catch (e) {
            console.error('JWT permissions parse hatası:', e);
            user.permissions = {};
        }
    }
    req.user = user;
    next();
  });
};

// ---------------- PERMISSION MIDDLEWARE ---------------- //
const checkPermission = (requiredPermission) => {
  return (req, res, next) => {
    // req.user, authenticateToken middleware'i tarafından eklenir ve yetkileri içermelidir.
    const permissions = req.user.permissions || {};

    // Admin (permissions.all: true) tüm yetkilere sahiptir ve kontrolü geçer.
    if (permissions.all === true) {
      return next();
    }

    const [module, action] = requiredPermission.split('.');
    const userModulePermissions = permissions[module];

    // If the required action is 'read', also allow if the user has 'read_own'.
    // The endpoint itself is responsible for filtering the data.
    if (action === 'read' && userModulePermissions && Array.isArray(userModulePermissions) && userModulePermissions.includes('read_own')) {
        return next();
    }

    if (userModulePermissions && (userModulePermissions === true || (Array.isArray(userModulePermissions) && userModulePermissions.includes(action)))) {
      return next();
    }

    // Yetki yoksa 403 Forbidden hatası döndür.
    return res.status(403).json({ 
      success: false, 
      error: 'Bu işlem için yetkiniz yok.' 
    });
  };
};

// ---------------- USER PROFILE ---------------- //
app.get("/api/profile", authenticateToken, async (req, res) => {
  try {
    const result = await pool.query(
      `SELECT u.id, u.username, u.full_name, u.email, u.phone, 
              r.name as role_name, d.name as department_name
       FROM users u 
       LEFT JOIN roles r ON u.role_id = r.id 
       LEFT JOIN departments d ON u.department_id = d.id 
       WHERE u.id = $1`,
      [req.user.userId]
    );
    
    if (result.rows.length === 0) {
      return res.status(404).json({ error: 'Kullanıcı bulunamadı' });
    }
    
    res.json(result.rows[0]);
  } catch (err) {
    console.error("Profile hatası:", err);
    res.status(500).json({ error: "Profil bilgileri alınamadı" });
  }
});

// ---------------- ÜRÜNLER ---------------- //
// Ürün ekleme (Yetki kontrolü eklendi)
app.post("/api/products", authenticateToken, checkPermission('products.create'), async (req, res) => {
  try {
    const { name, description, unit_price, vat_rate, unit, category, stock_quantity, min_stock_level } = req.body;

    console.log('Ürün ekleme isteği:', req.body);

    // Önce products tablosunun kolonlarını kontrol et
    const columnsResult = await pool.query(`
      SELECT column_name FROM information_schema.columns
      WHERE table_name = 'products'
    `);

    const columns = columnsResult.rows.map(row => row.column_name);
    const hasVatColumns = columns.includes('vat_rate') && columns.includes('price_with_vat');
    const hasStockColumns = columns.includes('stock_quantity') && columns.includes('min_stock_level');
    const hasCategoryColumn = columns.includes('category');

    let query, params;
    const vatRateValue = parseFloat(vat_rate) || 20;
    const unitPriceValue = parseFloat(unit_price);
    const priceWithVat = unitPriceValue * (1 + vatRateValue / 100);

    if (hasVatColumns && hasStockColumns && hasCategoryColumn) {
      // Tüm kolonlar var
      query = `
        INSERT INTO products (name, description, unit_price, vat_rate, price_with_vat, unit, category, stock_quantity, min_stock_level, is_active)
        VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, true)
        RETURNING *
      `;
      params = [name, description, unitPriceValue, vatRateValue, priceWithVat, unit, category, 
                parseInt(stock_quantity) || 0, parseInt(min_stock_level) || 0];
    } else {
      // Temel kolonlar
      query = `
        INSERT INTO products (name, description, unit_price, unit, is_active)
        VALUES ($1, $2, $3, $4, true)
        RETURNING *
      `;
      params = [name, description, unitPriceValue, unit];
    }

    const result = await pool.query(query, params);

    res.json({
      success: true,
      product: result.rows[0]
    });
  } catch (error) {
    console.error('Product create hatası:', error);
    res.status(500).json({
      success: false,
      error: error.message
    });
  }
});

// Ürün güncelleme (Yetki kontrolü eklendi)
app.put("/api/products/:id", authenticateToken, checkPermission('products.update'), async (req, res) => {
  try {
    const { id } = req.params;
    const { name, description, unit_price, vat_rate, unit, category, stock_quantity, min_stock_level, is_active } = req.body;

    // Kolonları kontrol et
    const columnsResult = await pool.query(`
      SELECT column_name FROM information_schema.columns
      WHERE table_name = 'products'
    `);

    const columns = columnsResult.rows.map(row => row.column_name);
    const hasVatColumns = columns.includes('vat_rate') && columns.includes('price_with_vat');
    const hasStockColumns = columns.includes('stock_quantity') && columns.includes('min_stock_level');
    const hasCategoryColumn = columns.includes('category');

    let query, params;
    const vatRateValue = parseFloat(vat_rate) || 20;
    const unitPriceValue = parseFloat(unit_price);
    const priceWithVat = unitPriceValue * (1 + vatRateValue / 100);

    if (hasVatColumns && hasStockColumns && hasCategoryColumn) {
      query = `
        UPDATE products SET
          name = $1,
          description = $2,
          unit_price = $3,
          vat_rate = $4,
          price_with_vat = $5,
          unit = $6,
          category = $7,
          stock_quantity = $8,
          min_stock_level = $9,
          is_active = $10
        WHERE id = $11
        RETURNING *
      `;
      params = [name, description, unitPriceValue, vatRateValue, priceWithVat, unit, category,
                parseInt(stock_quantity) || 0, parseInt(min_stock_level) || 0, is_active !== false, id];
    } else {
      query = `
        UPDATE products SET
          name = $1,
          description = $2,
          unit_price = $3,
          unit = $4,
          is_active = $5
        WHERE id = $6
        RETURNING *
      `;
      params = [name, description, unitPriceValue, unit, is_active !== false, id];
    }

    const result = await pool.query(query, params);

    if (result.rows.length === 0) {
      return res.status(404).json({
        success: false,
        error: 'Ürün bulunamadı'
      });
    }

    res.json({
      success: true,
      product: result.rows[0]
    });
  } catch (error) {
    console.error('Product update hatası:', error);
    res.status(500).json({
      success: false,
      error: error.message
    });
  }
});

// Tek ürün getir (Yetki kontrolü eklendi)
app.get("/api/products/:id", authenticateToken, checkPermission('products.read'), async (req, res) => {
  try {
    const { id } = req.params;
    const result = await pool.query('SELECT * FROM products WHERE id = $1', [id]);

    if (result.rows.length === 0) {
      return res.status(404).json({
        success: false,
        error: 'Ürün bulunamadı'
      });
    }

    res.json({
      success: true,
      product: result.rows[0]
    });
  } catch (error) {
    console.error('Product get hatası:', error);
    res.status(500).json({
      success: false,
      error: error.message
    });
  }
});

// Ürün sil (Yetki kontrolü eklendi)
app.delete("/api/products/:id", authenticateToken, checkPermission('products.delete'), async (req, res) => {
  try {
    const { id } = req.params;

    const result = await pool.query('DELETE FROM products WHERE id = $1 RETURNING *', [id]);

    if (result.rows.length === 0) {
      return res.status(404).json({
        success: false,
        error: 'Ürün bulunamadı'
      });
    }

    res.json({
      success: true,
      message: 'Ürün başarıyla silindi'
    });
  } catch (error) {
    console.error('Product delete hatası:', error);
    res.status(500).json({
      success: false,
      error: error.message
    });
  }
});

// Ürün kategorileri (Yetki kontrolü eklendi)
app.get("/api/product-categories", authenticateToken, checkPermission('products.read'), async (req, res) => {
  try {
    const result = await pool.query(`
      SELECT DISTINCT category
      FROM products
      WHERE category IS NOT NULL AND category != ''
      ORDER BY category
    `);

    const categories = result.rows.map(row => row.category);
    
    // Varsayılan kategoriler ekle
    const defaultCategories = ['Elektronik', 'Gıda', 'Tekstil', 'Makine', 'Kimyasal', 'Diğer'];
    const allCategories = [...new Set([...categories, ...defaultCategories])];

    res.json({
      success: true,
      categories: allCategories
    });
  } catch (error) {
    console.error('Categories API hatası:', error);
    res.json({
      success: true,
      categories: ['Elektronik', 'Gıda', 'Tekstil', 'Makine', 'Kimyasal', 'Diğer']
    });
  }
});


// ---------------- SİPARİŞLER (ESKİ - KALDIRILDI) ---------------- //
// Bu endpoint'ler yeni API'lerle değiştirildi

// ---------------- MÜŞTERİLER (ESKİ - KALDIRILDI) ---------------- //
// Bu endpoint'ler yeni API'lerle değiştirildi

// ---------------- DASHBOARD STATS ---------------- //
app.get("/api/stats", async (req, res) => {
  try {
    console.log("📊 Dashboard stats isteği geldi");
    
    // Toplam siparişler
    const ordersResult = await pool.query("SELECT COUNT(*) as total FROM orders");
    const totalOrders = parseInt(ordersResult.rows[0].total);

    // Toplam müşteriler
    const customersResult = await pool.query("SELECT COUNT(*) as total FROM customers");
    const totalCustomers = parseInt(customersResult.rows[0].total);

    // Toplam ürünler
    const productsResult = await pool.query("SELECT COUNT(*) as total FROM products");
    const totalProducts = parseInt(productsResult.rows[0].total);

    // Bu ay siparişler
    const monthlyOrdersResult = await pool.query(`
      SELECT COUNT(*) as total FROM orders 
      WHERE EXTRACT(MONTH FROM order_date) = EXTRACT(MONTH FROM CURRENT_DATE)
      AND EXTRACT(YEAR FROM order_date) = EXTRACT(YEAR FROM CURRENT_DATE)
    `);
    const monthlyOrders = parseInt(monthlyOrdersResult.rows[0].total);

    // Toplam gelir hesaplama
    const revenueResult = await pool.query("SELECT COALESCE(SUM(total_amount), 0) as total FROM orders");
    const totalRevenue = parseFloat(revenueResult.rows[0].total);

    console.log("✅ Dashboard stats başarıyla hesaplandı");

    res.json({
      success: true,
      totalOrders,
      totalCustomers, 
      totalProducts,
      monthlyOrders,
      totalRevenue: totalRevenue || 0,
    });
  } catch (err) {
    console.error("❌ Dashboard stats hatası:", err);
    res.status(500).json({
      success: false,
      error: err.message,
      totalOrders: 0,
      totalCustomers: 0,
      totalProducts: 0,
      monthlyOrders: 0,
      totalRevenue: 0
    });
  }
});

// Dashboard için basit stats (authentication olmadan)
app.get("/api/dashboard-stats", async (req, res) => {
  try {
    console.log("📊 Basit dashboard stats isteği geldi");
    
    // Toplam sipariş sayısı
    const ordersResult = await pool.query("SELECT COUNT(*) as total FROM orders");
    const totalOrders = parseInt(ordersResult.rows[0].total);

    // Toplam müşteri sayısı
    const customersResult = await pool.query("SELECT COUNT(*) as total FROM customers");
    const totalCustomers = parseInt(customersResult.rows[0].total);

    // Toplam ürün sayısı
    const productsResult = await pool.query("SELECT COUNT(*) as total FROM products");
    const totalProducts = parseInt(productsResult.rows[0].total);

    res.json({
      success: true,
      totalOrders,
      totalCustomers, 
      totalProducts,
      message: "Stats başarıyla alındı"
    });
  } catch (err) {
    console.error("❌ Basit dashboard stats hatası:", err);
    res.status(500).json({
      success: false,
      error: err.message,
      totalOrders: 0,
      totalCustomers: 0,
      totalProducts: 0
    });
  }
});

// ---------------- ROLES & DEPARTMENTS ---------------- //



// Database durumu kontrolü
app.get("/api/database-status", async (req, res) => {
  try {
    const result = await pool.query(`
      SELECT 
        current_database() as database,
        inet_server_addr() as host,
        inet_server_port() as port
    `);
    
    const dbInfo = result.rows[0];
    
    // Tabloları kontrol et
    const tablesResult = await pool.query(`
      SELECT table_name 
      FROM information_schema.tables 
      WHERE table_schema = 'public'
      ORDER BY table_name
    `);
    
    res.json({
      success: true,
      database: dbInfo.database,
      host: dbInfo.host,
      port: dbInfo.port,
      tables: tablesResult.rows.map(row => ({ name: row.table_name }))
    });
  } catch (error) {
    console.error('Database status hatası:', error);
    res.status(500).json({
      success: false,
      message: error.message
    });
  }
});

// Sadece schema kurulumu
app.post("/api/setup-schema-only", async (req, res) => {
  try {
    console.log('📋 Schema kurulumu başlatılıyor...');
    const fs = require("fs");
    const path = require("path");
    
    const schemaPath = path.join(__dirname, "database", "schema.sql");
    const schemaSQL = fs.readFileSync(schemaPath, "utf8");
    
    await pool.query(schemaSQL);
    
    res.json({
      success: true,
      message: 'Database schema başarıyla oluşturuldu'
    });
  } catch (error) {
    console.error('Schema kurulum hatası:', error);
    res.status(500).json({
      success: false,
      message: error.message
    });
  }
});

// Örnek veri ekleme
app.post("/api/add-sample-data", async (req, res) => {
  try {
    console.log('📝 Örnek veriler ekleniyor...');
    
    // Roller (Yetkiler)
    await pool.query(`
      INSERT INTO roles (id, name, description, level, is_active) VALUES
      (1, 'Yönetici', 'Sistem yöneticisi - Tüm yetkiler', 4, true),
      (2, 'Satış Temsilcisi', 'Satış işlemleri ve müşteri yönetimi', 2, true),
      (3, 'Üretim Personeli', 'Üretim planlama ve operasyonları', 2, true),
      (4, 'Sevkiyat Personeli', 'Lojistik ve teslimat işlemleri', 2, true),
      (5, 'Muhasebe Personeli', 'Mali işler ve muhasebe', 2, true)
      ON CONFLICT (id) DO NOTHING
    `);

    // Departmanlar (Bölümler)
    await pool.query(`
      INSERT INTO departments (id, name, description) VALUES
      (1, 'Satış Departmanı', 'Müşteri ilişkileri ve satış işlemleri'),
      (2, 'Üretim Departmanı', 'Üretim planlama ve operasyonları'),
      (3, 'Sevkiyat Departmanı', 'Lojistik ve teslimat işlemleri'),
      (4, 'Muhasebe Departmanı', 'Mali işler ve muhasebe'),
      (5, 'IT Departmanı', 'Bilgi teknolojileri ve sistem yönetimi')
      ON CONFLICT (id) DO NOTHING
    `);

    // Admin kullanıcısı
    const bcrypt = require("bcryptjs");
    const hashedPassword = await bcrypt.hash("admin123", 10);
    
    await pool.query(`
      INSERT INTO users (username, email, password_hash, full_name, role_id, department_id, is_active) VALUES
      ('admin', 'admin@sahacrm.com', $1, 'Sistem Yöneticisi', 1, 5, true)
      ON CONFLICT (username) DO NOTHING
    `, [hashedPassword]);

    res.json({
      success: true,
      message: 'Örnek veriler başarıyla eklendi'
    });
  } catch (error) {
    console.error('Örnek veri ekleme hatası:', error);
    res.status(500).json({
      success: false,
      message: error.message
    });
  }
});

// Tüm verileri silme
app.post("/api/clear-all-data", async (req, res) => {
  try {
    console.log('🗑️ Tüm veriler siliniyor...');

    const tables = [
      'customer_visits',
      'order_items',
      'orders',
      'products',
      'customers',
      'users',
      'departments',
      'roles'
    ];

    for (const table of tables) {
      await pool.query(`DELETE FROM ${table}`);
      console.log(`✅ ${table} tablosundaki veriler silindi`);
    }

    res.json({
      success: true,
      message: 'Tüm veriler başarıyla silindi'
    });
  } catch (error) {
    console.error('Veri silme hatası:', error);
    res.status(500).json({
      success: false,
      message: error.message
    });
  }
});

// Rol ve Departman verilerini düzelt
app.post("/api/fix-roles-departments", async (req, res) => {
  try {
    console.log('🔧 Rol ve Departman verileri düzeltiliyor...');

    // Önce yeni rolleri ekle (mevcut ID'leri güncelle)
    await pool.query(`
      INSERT INTO roles (id, name, description) VALUES
      (1, 'Admin', 'Sistem yöneticisi - Tüm yetkiler'),
      (2, 'Manager', 'Yönetici - Departman yönetimi'),
      (3, 'Employee', 'Çalışan - Temel işlemler'),
      (4, 'Viewer', 'Görüntüleyici - Sadece okuma')
      ON CONFLICT (id) DO UPDATE SET
        name = EXCLUDED.name,
        description = EXCLUDED.description
    `);

    // Eski rolleri sil (5 ve üzeri ID'ler)
    await pool.query('DELETE FROM roles WHERE id > 4');

    // Kullanıcıların rol_id'lerini güncelle (eski rol ID'leri varsa)
    await pool.query(`
      UPDATE users SET role_id = 1
      WHERE role_id NOT IN (1, 2, 3, 4) OR role_id IS NULL
    `);

    // Departmanları güncelle
    await pool.query(`
      INSERT INTO departments (id, name, description) VALUES
      (1, 'Satış Departmanı', 'Müşteri ilişkileri ve satış işlemleri'),
      (2, 'Üretim Departmanı', 'Üretim planlama ve operasyonları'),
      (3, 'Sevkiyat Departmanı', 'Lojistik ve teslimat işlemleri'),
      (4, 'Muhasebe Departmanı', 'Mali işler ve muhasebe'),
      (5, 'IT Departmanı', 'Bilgi teknolojileri ve sistem yönetimi'),
      (6, 'İnsan Kaynakları', 'Personel yönetimi ve işe alım'),
      (7, 'Kalite Kontrol', 'Ürün kalitesi ve standartlar')
      ON CONFLICT (id) DO UPDATE SET
        name = EXCLUDED.name,
        description = EXCLUDED.description
    `);

    // Eski departmanları sil (8 ve üzeri ID'ler)
    await pool.query('DELETE FROM departments WHERE id > 7');

    // Kullanıcıların department_id'lerini güncelle
    await pool.query(`
      UPDATE users SET department_id = 5
      WHERE department_id NOT IN (1, 2, 3, 4, 5, 6, 7) OR department_id IS NULL
    `);

    res.json({
      success: true,
      message: 'Rol ve Departman verileri başarıyla düzeltildi'
    });
  } catch (error) {
    console.error('Rol/Departman düzeltme hatası:', error);
    res.status(500).json({
      success: false,
      message: error.message
    });
  }
});

// Güvenli rol/departman ekleme (mevcut verileri korur)
app.post("/api/add-missing-roles-departments", async (req, res) => {
  try {
    console.log('🔧 Eksik rol ve departman verileri ekleniyor...');

    // Eksik rolleri ekle
    await pool.query(`
      INSERT INTO roles (id, name, description) VALUES
      (1, 'Admin', 'Sistem yöneticisi - Tüm yetkiler'),
      (2, 'Manager', 'Yönetici - Departman yönetimi'),
      (3, 'Employee', 'Çalışan - Temel işlemler'),
      (4, 'Viewer', 'Görüntüleyici - Sadece okuma')
      ON CONFLICT (id) DO NOTHING
    `);

    // Eksik departmanları ekle
    await pool.query(`
      INSERT INTO departments (id, name, description) VALUES
      (1, 'Satış Departmanı', 'Müşteri ilişkileri ve satış işlemleri'),
      (2, 'Üretim Departmanı', 'Üretim planlama ve operasyonları'),
      (3, 'Sevkiyat Departmanı', 'Lojistik ve teslimat işlemleri'),
      (4, 'Muhasebe Departmanı', 'Mali işler ve muhasebe'),
      (5, 'IT Departmanı', 'Bilgi teknolojileri ve sistem yönetimi'),
      (6, 'İnsan Kaynakları', 'Personel yönetimi ve işe alım'),
      (7, 'Kalite Kontrol', 'Ürün kalitesi ve standartlar')
      ON CONFLICT (id) DO NOTHING
    `);

    res.json({
      success: true,
      message: 'Eksik rol ve departman verileri güvenli şekilde eklendi'
    });
  } catch (error) {
    console.error('Güvenli rol/departman ekleme hatası:', error);
    res.status(500).json({
      success: false,
      message: error.message
    });
  }
});

// Products tablosuna KDV kolonları ekle
app.post("/api/migrate-products-vat", async (req, res) => {
  try {
    console.log('🔧 Products tablosuna KDV kolonları ekleniyor...');

    // Kolonları ekle (eğer yoksa)
    await pool.query(`
      ALTER TABLE products
      ADD COLUMN IF NOT EXISTS vat_rate DECIMAL(5,2) DEFAULT 20,
      ADD COLUMN IF NOT EXISTS price_with_vat DECIMAL(10,2)
    `);

    // Mevcut ürünler için KDV dahil fiyatı hesapla
    await pool.query(`
      UPDATE products
      SET price_with_vat = unit_price * (1 + COALESCE(vat_rate, 20) / 100)
      WHERE price_with_vat IS NULL
    `);

    res.json({
      success: true,
      message: 'Products tablosu KDV kolonları ile güncellendi'
    });
  } catch (error) {
    console.error('Products migration hatası:', error);
    res.status(500).json({
      success: false,
      message: error.message
    });
  }
});

// Kapsamlı örnek veri oluştur
app.post("/api/create-comprehensive-data", async (req, res) => {
  try {
    console.log('🎯 Kapsamlı örnek veri oluşturuluyor...');

    const bcrypt = require("bcryptjs");
    let stats = { users: 0, customers: 0, products: 0, transactions: 0 };

    // 1. Roller ve departmanları kontrol et
    const rolesResult = await pool.query('SELECT * FROM roles ORDER BY id');
    const departmentsResult = await pool.query('SELECT * FROM departments ORDER BY id');

    // 2. Belirtilen test kullanıcılarını oluştur
    const testUsers = [
      { username: 'admin', password: 'admin123', full_name: 'Admin', email: 'admin@sahacrm.com', role_id: 1, department_id: 1 },
      { username: 'satismuduru', password: '123456', full_name: 'Satış Müdürü', email: 'satismuduru@test.com', role_id: 2, department_id: 2 },
      { username: 'satispersoneli', password: '123456', full_name: 'Satış Personeli', email: 'satispersoneli@test.com', role_id: 3, department_id: 2 },
      { username: 'depomuduru', password: '123456', full_name: 'Depo Müdürü', email: 'depomuduru@test.com', role_id: 4, department_id: 3 },
      { username: 'depopersoneli', password: '123456', full_name: 'Depo Personeli', email: 'depopersoneli@test.com', role_id: 5, department_id: 3 },
      { username: 'sevkiyatsorumlusu', password: '123456', full_name: 'Sevkiyat Sorumlusu', email: 'sevkiyatsorumlusu@test.com', role_id: 6, department_id: 4 },
      { username: 'sevkiyatci', password: '123456', full_name: 'Sevkiyatçı', email: 'sevkiyatci@test.com', role_id: 7, department_id: 4 },
      { username: 'uretimmeduru', password: '123456', full_name: 'Üretim Müdürü', email: 'uretimmeduru@test.com', role_id: 8, department_id: 5 },
      { username: 'uretimpersoneli', password: '123456', full_name: 'Üretim Personeli', email: 'uretimpersoneli@test.com', role_id: 9, department_id: 5 },
      { username: 'muhasebemuduru', password: '123456', full_name: 'Muhasebe Müdürü', email: 'muhasebemuduru@test.com', role_id: 10, department_id: 6 },
      { username: 'muhasebepersoneli', password: '123456', full_name: 'Muhasebe Personeli', email: 'muhasebepersoneli@test.com', role_id: 11, department_id: 6 }
    ];

    for (const user of testUsers) {
        const hashedPassword = await bcrypt.hash(user.password, 10);
        const result = await pool.query(`
            INSERT INTO users (username, email, password_hash, full_name, role_id, department_id, is_active) VALUES ($1, $2, $3, $4, $5, $6, true)
            ON CONFLICT (username) DO NOTHING
        `, [user.username, user.email, hashedPassword, user.full_name, user.role_id, user.department_id]);
        if (result.rowCount > 0) stats.users++;
    }

    // 3. 5 adet müşteri oluştur
    const customerNames = [
      'ABC Teknoloji Ltd. Şti.',
      'XYZ İnşaat A.Ş.',
      'Mavi Deniz Lojistik',
      'Altın Gıda San. Tic.',
      'Yeşil Enerji Çözümleri'
    ];

    const contactPersons = ['Ahmet Yılmaz', 'Fatma Kaya', 'Mehmet Demir', 'Ayşe Şahin', 'Ali Özkan'];
    const phones = ['0555 123 4567', '0532 987 6543', '0544 111 2233', '0505 444 5566', '0533 777 8899'];

    // Satış temsilcisi olarak ilk kullanıcıyı al
    const salesRepResult = await pool.query('SELECT id FROM users WHERE is_active = true LIMIT 1');
    const salesRepId = salesRepResult.rows[0]?.id || 1;

    for (let i = 0; i < 5; i++) {
      // Önce müşteri var mı kontrol et
      const existingCustomer = await pool.query('SELECT id FROM customers WHERE company_name = $1', [customerNames[i]]);

      if (existingCustomer.rows.length === 0) {
        await pool.query(`
          INSERT INTO customers (company_name, contact_person, phone, email, address, assigned_sales_rep, customer_status)
          VALUES ($1, $2, $3, $4, $5, $6, 'active')
        `, [
          customerNames[i],
          contactPersons[i],
          phones[i],
          `info@${customerNames[i].toLowerCase().replace(/\s+/g, '').replace(/[^a-z0-9]/g, '')}.com`,
          `${customerNames[i]} Adresi, İstanbul`,
          salesRepId
        ]);

        stats.customers++;
      }
    }

    // 4. 5 adet ürün oluştur
    const products = [
      { name: 'Premium Yazılım Paketi', price: 2500.00, description: 'Kurumsal yazılım çözümü', unit: 'adet' },
      { name: 'Endüstriyel Makine', price: 15000.00, description: 'Yüksek performanslı üretim makinesi', unit: 'adet' },
      { name: 'Lojistik Hizmeti', price: 500.00, description: 'Kapıdan kapıya teslimat', unit: 'ton' },
      { name: 'Organik Gıda Paketi', price: 150.00, description: 'Doğal ve sağlıklı gıda ürünleri', unit: 'kg' },
      { name: 'Solar Panel Sistemi', price: 8000.00, description: 'Yenilenebilir enerji çözümü', unit: 'kW' }
    ];

    for (const product of products) {
      // Önce ürün var mı kontrol et
      const existingProduct = await pool.query('SELECT id FROM products WHERE name = $1', [product.name]);

      if (existingProduct.rows.length === 0) {
        // Önce vat_rate ve price_with_vat kolonları var mı kontrol et
        const columnsResult = await pool.query(`
          SELECT column_name FROM information_schema.columns
          WHERE table_name = 'products' AND column_name IN ('vat_rate', 'price_with_vat')
        `);

        const hasVatColumns = columnsResult.rows.length === 2;

        if (hasVatColumns) {
          const vatRate = 20;
          const priceWithVat = product.price * (1 + vatRate / 100);

          await pool.query(`
            INSERT INTO products (name, description, unit_price, vat_rate, price_with_vat, unit, is_active)
            VALUES ($1, $2, $3, $4, $5, $6, true)
          `, [product.name, product.description, product.price, vatRate, priceWithVat, product.unit]);
        } else {
          await pool.query(`
            INSERT INTO products (name, description, unit_price, unit, is_active)
            VALUES ($1, $2, $3, $4, true)
          `, [product.name, product.description, product.price, product.unit]);
        }

        stats.products++;
      }
    }

    // 5. Her müşteri için borç ve alacak kaydı oluştur
    const customersResult = await pool.query('SELECT id, company_name FROM customers ORDER BY id LIMIT 5');

    for (const customer of customersResult.rows) {
      // Mevcut işlemleri kontrol et
      const existingTransactions = await pool.query(
        'SELECT COUNT(*) as count FROM account_transactions WHERE customer_id = $1',
        [customer.id]
      );

      if (parseInt(existingTransactions.rows[0].count) === 0) {
        // Borç kaydı
        await pool.query(`
          INSERT INTO account_transactions (customer_id, transaction_type, amount, transaction_date, description, reference_number, created_by)
          VALUES ($1, 'debit', $2, CURRENT_DATE - INTERVAL '30 days', $3, $4, $5)
        `, [
          customer.id,
          Math.floor(Math.random() * 5000) + 1000, // 1000-6000 TL arası
          `${customer.company_name} - Satış faturası`,
          `FAT-${Date.now()}-${customer.id}`,
          salesRepId
        ]);

        // Alacak kaydı
        await pool.query(`
          INSERT INTO account_transactions (customer_id, transaction_type, amount, transaction_date, description, reference_number, created_by)
          VALUES ($1, 'credit', $2, CURRENT_DATE - INTERVAL '15 days', $3, $4, $5)
        `, [
          customer.id,
          Math.floor(Math.random() * 3000) + 500, // 500-3500 TL arası
          `${customer.company_name} - Ödeme`,
          `ODM-${Date.now()}-${customer.id}`,
          salesRepId
        ]);

        stats.transactions += 2;
      }
    }

    res.json({
      success: true,
      message: 'Kapsamlı örnek veri başarıyla oluşturuldu',
      stats: stats
    });

  } catch (error) {
    console.error('Kapsamlı veri oluşturma hatası:', error);
    res.status(500).json({
      success: false,
      message: error.message
    });
  }
});

// Rol Yönetimi API'leri
app.get("/api/roles", authenticateToken, checkPermission('roles.read'), async (req, res) => {
  try {
    const result = await pool.query(`
      SELECT r.*,
             COUNT(u.id) as user_count
      FROM roles r
      LEFT JOIN users u ON r.id = u.role_id
      GROUP BY r.id, r.name, r.description, r.created_at
      ORDER BY r.id ASC
    `);

    console.log('Roles API - Bulunan rol sayısı:', result.rows.length);

    res.json({
      success: true,
      roles: result.rows
    });
  } catch (error) {
    console.error('Roles API hatası:', error);
    res.status(500).json({
      success: false,
      error: error.message
    });
  }
});

// Tek rol getir
app.get("/api/roles/:id", async (req, res) => {
  try {
    const { id } = req.params;
    const result = await pool.query(`
      SELECT r.*,
             COUNT(u.id) as user_count
      FROM roles r
      LEFT JOIN users u ON r.id = u.role_id
      WHERE r.id = $1
      GROUP BY r.id, r.name, r.description, r.created_at, r.level, r.is_active, r.permissions
    `, [id]);

    if (result.rows.length === 0) {
      return res.status(404).json({
        success: false,
        error: 'Rol bulunamadı'
      });
    }

    res.json({
      success: true,
      role: result.rows[0]
    });
  } catch (error) {
    console.error('Role get hatası:', error);
    res.status(500).json({
      success: false,
      error: error.message
    });
  }
});

// Yeni rol oluştur
app.post("/api/roles", async (req, res) => {
  try {
    const { name, description, level, is_active } = req.body;

    // Rol adı benzersizlik kontrolü
    const existingRole = await pool.query('SELECT id FROM roles WHERE name = $1', [name]);
    if (existingRole.rows.length > 0) {
      return res.status(400).json({
        success: false,
        error: 'Bu rol adı zaten kullanılıyor'
      });
    }

    const result = await pool.query(`
      INSERT INTO roles (name, description, level, is_active)
      VALUES ($1, $2, $3, $4)
      RETURNING *
    `, [name, description, level || 2, is_active !== false]);

    res.json({
      success: true,
      role: result.rows[0]
    });
  } catch (error) {
    console.error('Role create hatası:', error);
    res.status(500).json({
      success: false,
      error: error.message
    });
  }
});

// Rol güncelle
app.put("/api/roles/:id", async (req, res) => {
  try {
    const { id } = req.params;
    const { name, description, level, is_active } = req.body;

    // Admin rolü koruması
    if (id === '1') {
      return res.status(403).json({
        success: false,
        error: 'Admin rolü değiştirilemez'
      });
    }

    // Rol adı benzersizlik kontrolü (kendisi hariç)
    const existingRole = await pool.query('SELECT id FROM roles WHERE name = $1 AND id != $2', [name, id]);
    if (existingRole.rows.length > 0) {
      return res.status(400).json({
        success: false,
        error: 'Bu rol adı zaten kullanılıyor'
      });
    }

    const result = await pool.query(`
      UPDATE roles SET
        name = $1,
        description = $2,
        level = $3,
        is_active = $4,
        updated_at = CURRENT_TIMESTAMP
      WHERE id = $5
      RETURNING *
    `, [name, description, level || 2, is_active !== false, id]);

    if (result.rows.length === 0) {
      return res.status(404).json({
        success: false,
        error: 'Rol bulunamadı'
      });
    }

    res.json({
      success: true,
      role: result.rows[0]
    });
  } catch (error) {
    console.error('Role update hatası:', error);
    res.status(500).json({
      success: false,
      error: error.message
    });
  }
});

// Rol sil
app.delete("/api/roles/:id", async (req, res) => {
  try {
    const { id } = req.params;

    // Admin rolü koruması
    if (id === '1') {
      return res.status(403).json({
        success: false,
        error: 'Admin rolü silinemez'
      });
    }

    // Bu role sahip kullanıcı var mı kontrol et
    const usersWithRole = await pool.query('SELECT COUNT(*) as count FROM users WHERE role_id = $1', [id]);
    const userCount = parseInt(usersWithRole.rows[0].count);

    if (userCount > 0) {
      // Kullanıcıları varsayılan role (Employee - ID: 3) ata
      await pool.query('UPDATE users SET role_id = 3 WHERE role_id = $1', [id]);
    }

    const result = await pool.query('DELETE FROM roles WHERE id = $1 RETURNING *', [id]);

    if (result.rows.length === 0) {
      return res.status(404).json({
        success: false,
        error: 'Rol bulunamadı'
      });
    }

    res.json({
      success: true,
      message: `Rol başarıyla silindi. ${userCount} kullanıcı Employee rolüne atandı.`
    });
  } catch (error) {
    console.error('Role delete hatası:', error);
    res.status(500).json({
      success: false,
      error: error.message
    });
  }
});

// Rol yetkilerini güncelle
app.put("/api/roles/:id/permissions", authenticateToken, async (req, res) => {
  try {
    // Sadece "all: true" yetkisine sahip Admin'in yetkisi olmalı
    if (!req.user.permissions || req.user.permissions.all !== true) {
        return res.status(403).json({ success: false, error: 'Bu işlem için yetkiniz yok.' });
    }

    const { id } = req.params;
    const { permissions } = req.body;

    if (id === '1') {
        return res.status(403).json({ success: false, error: 'Admin rolünün yetkileri değiştirilemez.' });
    }

    const result = await pool.query(
        'UPDATE roles SET permissions = $1, updated_at = CURRENT_TIMESTAMP WHERE id = $2 RETURNING *',
        [permissions, id]
    );

    if (result.rows.length === 0) {
        return res.status(404).json({ success: false, error: 'Rol bulunamadı' });
    }

    res.json({ success: true, message: 'Rol yetkileri başarıyla güncellendi.', role: result.rows[0] });
  } catch (error) {
    console.error('Role permissions update error:', error);
    res.status(500).json({ success: false, error: error.message });
  }
});
// Rol sistemi migration
app.post("/api/migrate-roles", async (req, res) => {
  try {
    console.log('🔄 Rol sistemi migration başlatılıyor...');

    // Level ve is_active kolonlarını ekle (eğer yoksa)
    await pool.query(`ALTER TABLE roles ADD COLUMN IF NOT EXISTS level INTEGER DEFAULT 2;`);
    await pool.query(`ALTER TABLE roles ADD COLUMN IF NOT EXISTS is_active BOOLEAN DEFAULT true;`);

    // Mevcut rolleri güncelle
    await pool.query(`
      UPDATE roles SET
          level = CASE
              WHEN name ILIKE '%yönetici%' THEN 4
              WHEN name ILIKE '%temsilcisi%' THEN 2
              WHEN name ILIKE '%personeli%' THEN 2
              ELSE 1
          END,
          is_active = true
      WHERE level IS NULL OR is_active IS NULL;
    `);

    // Temel rollerin varlığını kontrol et ve eksikleri ekle
    const basicRoles = [
      { id: 1, name: 'Yönetici', description: 'Sistem yöneticisi - Tüm yetkiler', level: 4, permissions: '{"all": true}' },
      { id: 2, name: 'Satış Temsilcisi', description: 'Satış işlemleri ve müşteri yönetimi', level: 2, permissions: '{}' },
      { id: 3, name: 'Üretim Personeli', description: 'Üretim planlama ve operasyonları', level: 2, permissions: '{}' },
      { id: 4, name: 'Sevkiyat Personeli', description: 'Lojistik ve teslimat işlemleri', level: 2, permissions: '{}' },
      { id: 5, name: 'Muhasebe Personeli', description: 'Mali işler ve muhasebe', level: 2, permissions: '{}' },
      { id: 6, name: 'Depo Personeli', description: 'Depo ve envanter yönetimi', level: 2, permissions: '{}' }
    ];

    for (const role of basicRoles) {
      await pool.query(`
        INSERT INTO roles (id, name, description, level, is_active, permissions) VALUES ($1, $2, $3, $4, true, $5::jsonb)
        ON CONFLICT (id) DO UPDATE SET name = EXCLUDED.name, description = EXCLUDED.description, level = EXCLUDED.level;
      `, [role.id, role.name, role.description, role.level, role.permissions]);
    }

    console.log('✅ Rol sistemi migration tamamlandı');

    res.json({
      success: true,
      message: 'Rol sistemi başarıyla güncellendi'
    });

  } catch (error) {
    console.error('Rol migration hatası:', error);
    res.status(500).json({
      success: false,
      message: error.message
    });
  }
});

// Departman Yönetimi API'leri
app.get("/api/departments", authenticateToken, checkPermission('departments.read'), async (req, res) => {
  try {
    console.log('🏢 Departments API çağrıldı');

    // Önce departments tablosunun var olup olmadığını kontrol et
    const tableExists = await checkTableExists('departments');

    if (!tableExists) {
      console.log('⚠️ Departments tablosu bulunamadı');
      return res.json({
        success: true,
        departments: [],
        message: 'Departments tablosu henüz oluşturulmamış'
      });
    }

    const result = await pool.query(`
      SELECT d.*,
             COALESCE(COUNT(u.id), 0) as user_count,
             COALESCE(m.full_name, 'Yönetici Yok') as manager_name
      FROM departments d
      LEFT JOIN users u ON d.id = u.department_id
      LEFT JOIN users m ON d.manager_id = m.id
      GROUP BY d.id, d.name, d.description, d.code, d.manager_id, d.is_active, d.created_at, m.full_name
      ORDER BY d.id ASC
    `);

    console.log('✅ Departments API - Bulunan departman sayısı:', result.rows.length);

    res.json({
      success: true,
      departments: result.rows
    });
  } catch (error) {
    console.error('❌ Departments API hatası:', error);
    res.status(500).json({
      success: false,
      error: error.message,
      details: 'Departments tablosu veya ilişkili tablolar bulunamadı'
    });
  }
});

// Tek departman getir
app.get("/api/departments/:id", async (req, res) => {
  try {
    const { id } = req.params;
    const result = await pool.query(`
      SELECT d.*,
             COUNT(u.id) as user_count,
             m.full_name as manager_name
      FROM departments d
      LEFT JOIN users u ON d.id = u.department_id
      LEFT JOIN users m ON d.manager_id = m.id
      WHERE d.id = $1
      GROUP BY d.id, d.name, d.description, d.code, d.manager_id, d.is_active, d.created_at, m.full_name
    `, [id]);

    if (result.rows.length === 0) {
      return res.status(404).json({
        success: false,
        error: 'Departman bulunamadı'
      });
    }

    res.json({
      success: true,
      department: result.rows[0]
    });
  } catch (error) {
    console.error('Department get hatası:', error);
    res.status(500).json({
      success: false,
      error: error.message
    });
  }
});

// Yeni departman oluştur
app.post("/api/departments", async (req, res) => {
  try {
    const { name, description, code, manager_id, is_active } = req.body;

    // Departman adı benzersizlik kontrolü
    const existingDept = await pool.query('SELECT id FROM departments WHERE name = $1', [name]);
    if (existingDept.rows.length > 0) {
      return res.status(400).json({
        success: false,
        error: 'Bu departman adı zaten kullanılıyor'
      });
    }

    // Kod benzersizlik kontrolü (eğer kod verilmişse)
    if (code) {
      const existingCode = await pool.query('SELECT id FROM departments WHERE code = $1', [code]);
      if (existingCode.rows.length > 0) {
        return res.status(400).json({
          success: false,
          error: 'Bu departman kodu zaten kullanılıyor'
        });
      }
    }

    const result = await pool.query(`
      INSERT INTO departments (name, description, code, manager_id, is_active)
      VALUES ($1, $2, $3, $4, $5)
      RETURNING *
    `, [name, description, code || null, manager_id || null, is_active !== false]);

    res.json({
      success: true,
      department: result.rows[0]
    });
  } catch (error) {
    console.error('Department create hatası:', error);
    res.status(500).json({
      success: false,
      error: error.message
    });
  }
});

// Departman güncelle
app.put("/api/departments/:id", async (req, res) => {
  try {
    const { id } = req.params;
    const { name, description, code, manager_id, is_active } = req.body;

    // Departman adı benzersizlik kontrolü (kendisi hariç)
    const existingDept = await pool.query('SELECT id FROM departments WHERE name = $1 AND id != $2', [name, id]);
    if (existingDept.rows.length > 0) {
      return res.status(400).json({
        success: false,
        error: 'Bu departman adı zaten kullanılıyor'
      });
    }

    // Kod benzersizlik kontrolü (eğer kod verilmişse ve kendisi hariç)
    if (code) {
      const existingCode = await pool.query('SELECT id FROM departments WHERE code = $1 AND id != $2', [code, id]);
      if (existingCode.rows.length > 0) {
        return res.status(400).json({
          success: false,
          error: 'Bu departman kodu zaten kullanılıyor'
        });
      }
    }

    const result = await pool.query(`
      UPDATE departments SET
        name = $1,
        description = $2,
        code = $3,
        manager_id = $4,
        is_active = $5
      WHERE id = $6
      RETURNING *
    `, [name, description, code || null, manager_id || null, is_active !== false, id]);

    if (result.rows.length === 0) {
      return res.status(404).json({
        success: false,
        error: 'Departman bulunamadı'
      });
    }

    res.json({
      success: true,
      department: result.rows[0]
    });
  } catch (error) {
    console.error('Department update hatası:', error);
    res.status(500).json({
      success: false,
      error: error.message
    });
  }
});

// Departman sil
app.delete("/api/departments/:id", async (req, res) => {
  try {
    const { id } = req.params;

    // Bu departmana ait kullanıcı var mı kontrol et
    const usersInDept = await pool.query('SELECT COUNT(*) as count FROM users WHERE department_id = $1', [id]);
    const userCount = parseInt(usersInDept.rows[0].count);

    if (userCount > 0) {
      // Kullanıcıları varsayılan departmana (Satış Departmanı - ID: 1) ata
      await pool.query('UPDATE users SET department_id = 1 WHERE department_id = $1', [id]);
    }

    const result = await pool.query('DELETE FROM departments WHERE id = $1 RETURNING *', [id]);

    if (result.rows.length === 0) {
      return res.status(404).json({
        success: false,
        error: 'Departman bulunamadı'
      });
    }

    res.json({
      success: true,
      message: `Departman başarıyla silindi. ${userCount} kullanıcı Satış Departmanına atandı.`
    });
  } catch (error) {
    console.error('Department delete hatası:', error);
    res.status(500).json({
      success: false,
      error: error.message
    });
  }
});

// Departman sistemi migration
app.post("/api/migrate-departments", async (req, res) => {
  try {
    console.log('🏢 Departman sistemi migration başlatılıyor...');

    // Code kolonu ekle (eğer yoksa)
    await pool.query(`
      DO $$
      BEGIN
          IF NOT EXISTS (SELECT 1 FROM information_schema.columns WHERE table_name = 'departments' AND column_name = 'code') THEN
              ALTER TABLE departments ADD COLUMN code VARCHAR(10) UNIQUE;
          END IF;
      END $$;
    `);

    // Manager_id kolonu ekle (eğer yoksa)
    await pool.query(`
      DO $$
      BEGIN
          IF NOT EXISTS (SELECT 1 FROM information_schema.columns WHERE table_name = 'departments' AND column_name = 'manager_id') THEN
              ALTER TABLE departments ADD COLUMN manager_id INTEGER;
          END IF;
      END $$;
    `);

    // is_active kolonu ekle (eğer yoksa)
    await pool.query(`
      DO $$
      BEGIN
          IF NOT EXISTS (SELECT 1 FROM information_schema.columns WHERE table_name = 'departments' AND column_name = 'is_active') THEN
              ALTER TABLE departments ADD COLUMN is_active BOOLEAN DEFAULT true;
          END IF;
      END $$;
    `);

    // Foreign key constraint ekle (eğer yoksa)
    await pool.query(`
      DO $$
      BEGIN
          IF NOT EXISTS (
              SELECT 1 FROM information_schema.table_constraints
              WHERE constraint_name = 'departments_manager_id_fkey'
              AND table_name = 'departments'
          ) THEN
              ALTER TABLE departments ADD CONSTRAINT departments_manager_id_fkey
              FOREIGN KEY (manager_id) REFERENCES users(id);
          END IF;
      END $$;
    `);

    // Mevcut departmanları güncelle
    await pool.query(`
      UPDATE departments SET
          is_active = true,
          code = CASE
              WHEN name ILIKE '%satış%' OR name ILIKE '%sales%' THEN 'SALES'
              WHEN name ILIKE '%üretim%' OR name ILIKE '%production%' THEN 'PROD'
              WHEN name ILIKE '%sevkiyat%' OR name ILIKE '%shipping%' THEN 'SHIP'
              WHEN name ILIKE '%muhasebe%' OR name ILIKE '%accounting%' THEN 'ACC'
              WHEN name ILIKE '%it%' OR name ILIKE '%bilgi%' THEN 'IT'
              WHEN name ILIKE '%insan%' OR name ILIKE '%hr%' THEN 'HR'
              WHEN name ILIKE '%kalite%' OR name ILIKE '%quality%' THEN 'QC'
              ELSE UPPER(LEFT(name, 4))
          END
      WHERE is_active IS NULL OR code IS NULL;
    `);

    console.log('✅ Departman sistemi migration tamamlandı');

    res.json({
      success: true,
      message: 'Departman sistemi başarıyla güncellendi'
    });

  } catch (error) {
    console.error('Departman migration hatası:', error);
    res.status(500).json({
      success: false,
      message: error.message
    });
  }
});

// Kullanıcı Hedefleri API'leri
app.get("/api/user-targets", async (req, res) => {
  try {
    const { year, month, user_id } = req.query;

    let query = `
      SELECT ut.*,
             u.full_name, u.username, u.email,
             r.name as role_name,
             d.name as department_name
      FROM user_targets ut
      JOIN users u ON ut.user_id = u.id
      LEFT JOIN roles r ON u.role_id = r.id
      LEFT JOIN departments d ON u.department_id = d.id
      WHERE ut.is_active = true
    `;

    const params = [];
    let paramIndex = 1;

    if (year) {
      query += ` AND ut.target_year = $${paramIndex}`;
      params.push(parseInt(year));
      paramIndex++;
    }

    if (month) {
      query += ` AND ut.target_month = $${paramIndex}`;
      params.push(parseInt(month));
      paramIndex++;
    }

    if (user_id) {
      query += ` AND ut.user_id = $${paramIndex}`;
      params.push(parseInt(user_id));
      paramIndex++;
    }

    query += ` ORDER BY ut.target_year DESC, ut.target_month DESC, u.full_name ASC`;

    const result = await pool.query(query, params);

    console.log('User Targets API - Bulunan hedef sayısı:', result.rows.length);

    res.json({
      success: true,
      targets: result.rows
    });
  } catch (error) {
    console.error('User Targets API hatası:', error);
    res.status(500).json({
      success: false,
      error: error.message
    });
  }
});

// Tek kullanıcının belirli ay hedefini getir
app.get("/api/user-targets/:userId", async (req, res) => {
  try {
    const { userId } = req.params;
    const { year, month } = req.query;

    const result = await pool.query(`
      SELECT ut.*,
             u.full_name, u.username, u.email,
             r.name as role_name,
             d.name as department_name
      FROM user_targets ut
      JOIN users u ON ut.user_id = u.id
      LEFT JOIN roles r ON u.role_id = r.id
      LEFT JOIN departments d ON u.department_id = d.id
      WHERE ut.user_id = $1 AND ut.target_year = $2 AND ut.target_month = $3
    `, [userId, year, month]);

    res.json({
      success: true,
      target: result.rows[0] || null
    });
  } catch (error) {
    console.error('User Target get hatası:', error);
    res.status(500).json({
      success: false,
      error: error.message
    });
  }
});

// Yeni hedef oluştur
app.post("/api/user-targets", async (req, res) => {
  try {
    const {
      user_id, target_year, target_month,
      sales_target, visit_target, production_target, shipping_target,
      revenue_target, collection_target, notes
    } = req.body;

    // Aynı kullanıcı için aynı ay hedefi var mı kontrol et
    const existingTarget = await pool.query(
      'SELECT id FROM user_targets WHERE user_id = $1 AND target_year = $2 AND target_month = $3',
      [user_id, target_year, target_month]
    );

    if (existingTarget.rows.length > 0) {
      return res.status(400).json({
        success: false,
        error: 'Bu kullanıcı için bu ay zaten hedef belirlenmiş'
      });
    }

    const result = await pool.query(`
      INSERT INTO user_targets (
        user_id, target_year, target_month, sales_target, 
        visit_target, production_target, shipping_target,
        revenue_target, collection_target, notes,
        created_by
      ) VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11)
      RETURNING *
    `, [
      user_id, target_year, target_month,
      sales_target || 0, visit_target || 0, production_target || 0, shipping_target || 0,
      revenue_target || 0, collection_target || 0, notes,
      1 // TODO: Gerçek kullanıcı ID'si
    ]);

    res.json({
      success: true,
      target: result.rows[0]
    });
  } catch (error) {
    console.error('User Target create hatası:', error);
    res.status(500).json({
      success: false,
      error: error.message
    });
  }
});

// Hedef güncelle (UPSERT: Update or Insert)
app.put("/api/user-targets/:userId", async (req, res) => {
  try {
    const { userId } = req.params;
    const {
      target_year, target_month,
      sales_target, visit_target, production_target,
      shipping_target,
      revenue_target, collection_target, notes
    } = req.body;

    const result = await pool.query(`
      INSERT INTO user_targets (
        user_id, target_year, target_month,
        sales_target, visit_target, production_target, shipping_target,
        revenue_target, collection_target, notes, created_by
      ) VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11)
      ON CONFLICT (user_id, target_year, target_month)
      DO UPDATE SET
        sales_target = EXCLUDED.sales_target,
        visit_target = EXCLUDED.visit_target,
        production_target = EXCLUDED.production_target,
        shipping_target = EXCLUDED.shipping_target,
        revenue_target = EXCLUDED.revenue_target,
        collection_target = EXCLUDED.collection_target,
        notes = EXCLUDED.notes,
        updated_at = CURRENT_TIMESTAMP
      RETURNING *
    `, [
      userId, target_year, target_month,
      sales_target || 0, visit_target || 0, production_target || 0,
      shipping_target || 0, revenue_target || 0, collection_target || 0,
      notes, 1 // TODO: created_by/updated_by
    ]);

    res.json({
      success: true,
      target: result.rows[0]
    });
  } catch (error) {
    console.error('User Target UPSERT hatası:', error);
    res.status(500).json({
      success: false,
      error: error.message
    });
  }
});

// Hedef sil
app.delete("/api/user-targets/:id", async (req, res) => {
  try {
    const { id } = req.params;

    const result = await pool.query('DELETE FROM user_targets WHERE id = $1 RETURNING *', [id]);

    if (result.rows.length === 0) {
      return res.status(404).json({
        success: false,
        error: 'Hedef bulunamadı'
      });
    }

    res.json({
      success: true,
      message: 'Hedef başarıyla silindi'
    });
  } catch (error) {
    console.error('User Target delete hatası:', error);
    res.status(500).json({
      success: false,
      error: error.message
    });
  }
});

// Hedef sistemi migration
app.post("/api/migrate-targets", async (req, res) => {
  try {
    console.log('🎯 Hedef sistemi migration başlatılıyor...');

    // user_targets tablosunu oluştur
    await pool.query(`
      CREATE TABLE IF NOT EXISTS user_targets (
          id SERIAL PRIMARY KEY,
          user_id INTEGER REFERENCES users(id) ON DELETE CASCADE,
          target_year INTEGER NOT NULL,
          target_month INTEGER NOT NULL,

          sales_target DECIMAL(12,2) DEFAULT 0,
          sales_achieved DECIMAL(12,2) DEFAULT 0,

          visit_target INTEGER DEFAULT 0,
          visit_achieved INTEGER DEFAULT 0,

          production_target INTEGER DEFAULT 0,
          production_achieved INTEGER DEFAULT 0,

          shipping_target INTEGER DEFAULT 0,
          shipping_achieved INTEGER DEFAULT 0,

          revenue_target DECIMAL(12,2) DEFAULT 0,
          revenue_achieved DECIMAL(12,2) DEFAULT 0,

          collection_target DECIMAL(12,2) DEFAULT 0,
          collection_achieved DECIMAL(12,2) DEFAULT 0,

          notes TEXT,
          is_active BOOLEAN DEFAULT true,
          created_by INTEGER REFERENCES users(id),
          created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
          updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,

          UNIQUE(user_id, target_year, target_month)
      );
    `);

    // İndeksler ekle
    await pool.query(`
      CREATE INDEX IF NOT EXISTS idx_user_targets_user_id ON user_targets(user_id);
      CREATE INDEX IF NOT EXISTS idx_user_targets_year_month ON user_targets(target_year, target_month);
      CREATE INDEX IF NOT EXISTS idx_user_targets_active ON user_targets(is_active);
    `);

    // Örnek hedefler oluştur
    const currentYear = new Date().getFullYear();
    const currentMonth = new Date().getMonth() + 1;

    const users = await pool.query('SELECT id, role_id FROM users');

    for (const user of users.rows) {
      let salesTarget = 0, visitTarget = 0, productionTarget = 0, shippingTarget = 0, revenueTarget = 0, collectionTarget = 0;

      // Role-based default targets
      switch(user.role_id) {
        case 1: // Admin
            salesTarget = 150000;
            visitTarget = 20;
            productionTarget = 100;
            shippingTarget = 120;
            revenueTarget = 200000;
            collectionTarget = 80000;
            break;
        case 2: // Sales
            salesTarget = 80000;
            visitTarget = 40;
            revenueTarget = 120000;
            collectionTarget = 60000;
            break;
        case 3: // Production
            productionTarget = 150;
            break;
        case 4: // Shipping
            shippingTarget = 200;
            break;
        case 5: // Accounting
            revenueTarget = 500000;
            collectionTarget = 250000;
            break;
      }

      await pool.query(`
        INSERT INTO user_targets (
          user_id, target_year, target_month,
          sales_target, visit_target, production_target, shipping_target, revenue_target, collection_target,
          notes, created_by
        ) VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11)
        ON CONFLICT (user_id, target_year, target_month) DO NOTHING
      `, [
        user.id, currentYear, currentMonth, salesTarget, visitTarget, productionTarget, 
        shippingTarget, revenueTarget, collectionTarget,
        'Otomatik oluşturulan örnek hedef', 1
      ]);

      // Gelecek ay için hedef (eğer aralık değilse)
      if (currentMonth < 12) {
        await pool.query(`
          INSERT INTO user_targets (
            user_id, target_year, target_month,
            sales_target, visit_target, production_target, shipping_target, revenue_target, collection_target,
            notes, created_by
          ) VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11)
          ON CONFLICT (user_id, target_year, target_month) DO NOTHING
        `, [
          user.id, currentYear, currentMonth + 1, Math.round(salesTarget * 1.1), visitTarget + 2, 
          productionTarget + 10, shippingTarget + 15, Math.round(revenueTarget * 1.1), 
          Math.round(collectionTarget * 1.05),
          'Otomatik oluşturulan gelecek ay hedefi', 1
        ]);
      }
    }

    console.log('✅ Hedef sistemi migration tamamlandı');

    res.json({
      success: true,
      message: 'Hedef sistemi başarıyla oluşturuldu'
    });

  } catch (error) {
    console.error('Hedef migration hatası:', error);
    res.status(500).json({
      success: false,
      message: error.message
    });
  }
});

// Kasa Yönetimi API'leri
app.get("/api/cash-registers", async (req, res) => {
  try {
    // Önce cash_registers tablosunun varlığını kontrol et
    const tableExists = await checkTableExists('cash_registers');
    
    if (!tableExists) {
      console.log('⚠️ Cash_registers tablosu bulunamadı, oluşturuluyor...');
      
      // Tabloyu oluştur
      await pool.query(`
        CREATE TABLE IF NOT EXISTS cash_registers (
            id SERIAL PRIMARY KEY,
            name VARCHAR(100) NOT NULL,
            description TEXT,
            balance DECIMAL(12,2) DEFAULT 0,
            is_active BOOLEAN DEFAULT true,
            created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
        );
      `);
      
      // Örnek kasalar ekle
      await pool.query(`
        INSERT INTO cash_registers (name, description, balance) VALUES
        ('Ana Kasa', 'Merkez kasa', 50000.00),
        ('Banka Hesabı', 'İş Bankası hesabı', 125000.00),
        ('POS Cihazı', 'Kredi kartı tahsilatları', 0.00)
        ON CONFLICT DO NOTHING
      `);
      
      console.log('✅ Cash_registers tablosu oluşturuldu');
    }

    const result = await pool.query(`
      SELECT * FROM cash_registers
      WHERE is_active = true
      ORDER BY name ASC
    `);

    console.log('Cash Registers API - Bulunan kasa sayısı:', result.rows.length);

    res.json({
      success: true,
      cash_registers: result.rows
    });
  } catch (error) {
    console.error('Cash Registers API hatası:', error);
    res.status(500).json({
      success: false,
      error: error.message,
      cash_registers: [
        { id: 1, name: 'Ana Kasa', balance: 50000.00 },
        { id: 2, name: 'Banka Hesabı', balance: 125000.00 }
      ]
    });
  }
});

// İrsaliye Yönetimi API'leri
app.get("/api/delivery-notes", authenticateToken, checkPermission('delivery.read'), async (req, res) => {
  try {
    // Tablonun varlığı migration'lar ve setup script'i ile garanti altına alınmalıdır.
    // API endpoint'i içinde tablo oluşturmak hatalara yol açabilir ve kodun okunabilirliğini düşürür.
    // Bu nedenle on-the-fly tablo oluşturma mantığı kaldırıldı.

    const { status, customer_id } = req.query;
    const { userId, permissions } = req.user;
 
    let query = `
      SELECT dn.*,
            c.company_name as customer_name,
            c.address as customer_address,
            c.latitude, 
            c.longitude,
            u.full_name as delivered_by_name,
            o.order_number
      FROM delivery_notes dn
      LEFT JOIN customers c ON dn.customer_id = c.id
      LEFT JOIN users u ON dn.delivered_by = u.id
      LEFT JOIN orders o ON dn.order_id = o.id
    `;

    const params = [];
    const whereClauses = [];

    if (status) {
      whereClauses.push(`dn.status = $${params.push(status)}`);
    }
    
    if (customer_id) {
      whereClauses.push(`dn.customer_id = $${params.push(customer_id)}`);
    }

    // Filter if the user has 'read_own' but not the general 'read' permission (and is not admin)
    const deliveryPerms = permissions.delivery || [];
    if (deliveryPerms.includes('read_own') && !deliveryPerms.includes('read') && !permissions.all) {
      // Sevkiyatçı veya Sorumlu sadece kendine atananları görür
      whereClauses.push(`dn.delivered_by = $${params.push(userId)}`);
    } 

    if (whereClauses.length > 0) {
        query += ` WHERE ${whereClauses.join(' AND ')}`;
    }

    query += ` ORDER BY dn.created_at DESC`;

    const result = await pool.query(query, params);

    console.log('Delivery Notes API - Bulunan irsaliye sayısı:', result.rows.length);

    res.json({
      success: true,
      delivery_notes: result.rows
    });
  } catch (error) {
    console.error('Delivery Notes API hatası:', error);
    res.status(500).json({
      success: false,
      error: error.message,
      delivery_notes: []
    });
  }
});

// Tek irsaliye getir
app.get("/api/delivery-notes/:id", authenticateToken, checkPermission('delivery.read'), async (req, res) => {
  try {
    const { id } = req.params;
    const result = await pool.query(`
      SELECT dn.*,
             c.company_name as customer_name,
             c.address as customer_address,
             u.full_name as delivered_by_name,
             o.order_number,
             o.total_amount
      FROM delivery_notes dn
      LEFT JOIN customers c ON dn.customer_id = c.id
      LEFT JOIN users u ON dn.delivered_by = u.id
      LEFT JOIN orders o ON dn.order_id = o.id
      WHERE dn.id = $1
    `, [id]);

    if (result.rows.length === 0) {
      return res.status(404).json({
        success: false,
        error: 'İrsaliye bulunamadı'
      });
    }

    res.json({
      success: true,
      delivery_note: result.rows[0]
    });
  } catch (error) {
    console.error('Delivery Note get hatası:', error);
    res.status(500).json({
      success: false,
      error: error.message
    });
  }
});

app.get("/api/delivery-notes/generate-number", authenticateToken, checkPermission('delivery.create'), async (req, res) => {
  try {
    const now = new Date();
    const year = now.getFullYear().toString().substr(-2);
    const month = (now.getMonth() + 1).toString().padStart(2, '0');
    const day = now.getDate().toString().padStart(2, '0');
    const randomNum = Math.floor(Math.random() * 999) + 1;
    const sequenceNumber = randomNum.toString().padStart(3, '0');

    const deliveryNumber = `IRS${year}${month}${day}${sequenceNumber}`;

    res.json({
      success: true,
      delivery_number: deliveryNumber
    });
  } catch (error) {
    console.error('Delivery number generation error:', error);
    res.status(500).json({
      success: false,
      error: error.message
    });
  }
});

app.post("/api/delivery-notes", authenticateToken, checkPermission('delivery.create'), async (req, res) => {
  try {
    const {
      delivery_number, order_id, customer_id, delivered_by,
      delivery_date, delivery_time, delivery_address, notes, internal_notes
    } = req.body;

    // İrsaliye numarası benzersizlik kontrolü
    const existingDelivery = await pool.query('SELECT id FROM delivery_notes WHERE delivery_number = $1', [delivery_number]);
    if (existingDelivery.rows.length > 0) {
      return res.status(400).json({
        success: false,
        error: 'Bu irsaliye numarası zaten kullanılıyor'
      });
    }

    const result = await pool.query(`
      INSERT INTO delivery_notes (
        delivery_number, order_id, customer_id, delivered_by,
        delivery_date, delivery_time, delivery_address, notes, internal_notes,
        status, created_by
      ) VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11)
      RETURNING *
    `, [
      delivery_number, order_id || null, customer_id, delivered_by || null,
      delivery_date, delivery_time || null, delivery_address, notes, internal_notes,
      'pending', req.user.userId
    ]);

    res.json({
      success: true,
      delivery_note: result.rows[0]
    });
  } catch (error) {
    console.error('Delivery Note create hatası:', error);
    res.status(500).json({
      success: false,
      error: error.message
    });
  }
});

// İrsaliye güncelle
app.put("/api/delivery-notes/:id", authenticateToken, checkPermission('delivery.update'), async (req, res) => {
  try {
    const { id } = req.params;
    const {
      delivery_number, order_id, customer_id, delivered_by,
      delivery_date, delivery_time, delivery_address, notes, internal_notes, status
    } = req.body;

    // İrsaliye numarası benzersizlik kontrolü (kendisi hariç)
    const existingDelivery = await pool.query('SELECT id FROM delivery_notes WHERE delivery_number = $1 AND id != $2', [delivery_number, id]);
    if (existingDelivery.rows.length > 0) {
      return res.status(400).json({
        success: false,
        error: 'Bu irsaliye numarası zaten kullanılıyor'
      });
    }

    const result = await pool.query(`
      UPDATE delivery_notes SET
        delivery_number = $1,
        order_id = $2,
        customer_id = $3,
        delivered_by = $4,
        delivery_date = $5,
        delivery_time = $6,
        delivery_address = $7,
        notes = $8,
        internal_notes = $9,
        status = COALESCE($10, status),
        updated_at = CURRENT_TIMESTAMP
      WHERE id = $11
      RETURNING *
    `, [
      delivery_number, order_id || null, customer_id, delivered_by || null,
      delivery_date, delivery_time || null, delivery_address, notes, internal_notes,
      status, id
    ]);

    if (result.rows.length === 0) {
      return res.status(404).json({
        success: false,
        error: 'İrsaliye bulunamadı'
      });
    }

    res.json({
      success: true,
      delivery_note: result.rows[0]
    });
  } catch (error) {
    console.error('Delivery Note update hatası:', error);
    res.status(500).json({
      success: false,
      error: error.message
    });
  }
});

// İrsaliye durumu güncelle
app.put("/api/delivery-notes/:id/status", authenticateToken, checkPermission('delivery.update'), async (req, res) => {
  try {
    const { id } = req.params;
    const { status, delivered_by } = req.body;

    const result = await pool.query(`
      UPDATE delivery_notes SET
        status = $1,
        delivered_by = COALESCE($2, delivered_by),
        updated_at = CURRENT_TIMESTAMP
      WHERE id = $3
      RETURNING *
    `, [status, delivered_by, id]);

    if (result.rows.length === 0) {
      return res.status(404).json({
        success: false,
        error: 'İrsaliye bulunamadı'
      });
    }

    // Eğer durum 'delivered' ise, ilgili siparişin durumunu da güncelle ve mail gönder
    if (status === 'delivered' && result.rows[0].order_id) {
      try {
        await pool.query(`
          UPDATE orders SET status = 'delivered' WHERE id = $1
        `, [result.rows[0].order_id]);
        console.log('Sipariş durumu delivered olarak güncellendi:', result.rows[0].order_id);
        
        // Müşteri email adresini al ve mail gönder
        const customerResult = await pool.query(`
          SELECT c.email FROM customers c
          JOIN delivery_notes dn ON c.id = dn.customer_id
          WHERE dn.id = $1
        `, [id]);
        
        if (customerResult.rows.length > 0 && customerResult.rows[0].email) {
          try {
            await fetch('/api/mail/delivery-completed', {
              method: 'POST',
              headers: {
                'Content-Type': 'application/json',
                'Authorization': req.headers.authorization
              },
              body: JSON.stringify({
                delivery_note_id: id,
                customer_email: customerResult.rows[0].email
              })
            });
            console.log('İrsaliye teslim maili gönderildi');
          } catch (mailError) {
            console.error('İrsaliye mail gönderme hatası:', mailError.message);
          }
        }
      } catch (orderUpdateError) {
        console.error('Sipariş durumu güncellenemedi:', orderUpdateError.message);
      }
    }

    res.json({
      success: true,
      delivery_note: result.rows[0]
    });
  } catch (error) {
    console.error('Delivery Note status update hatası:', error);
    res.status(500).json({
      success: false,
      error: error.message
    });
  }
});

// E-posta gönderme yardımcı fonksiyonu
async function sendDeliveryCompletionEmail(deliveryNoteId) {
  try {
    console.log(`📧 Mail gönderim süreci başlatılıyor, İrsaliye ID: ${deliveryNoteId}`);
    
    // Mail ayarlarını al
    const settingsResult = await pool.query('SELECT * FROM mail_settings ORDER BY id DESC LIMIT 1');
    if (settingsResult.rows.length === 0) {
      console.log('⚠️ Mail ayarları bulunamadı, mail gönderilemedi.');
      return { success: false, error: 'Mail ayarları yapılmamış' };
    }
    const settings = settingsResult.rows[0];

    // İrsaliye ve müşteri bilgilerini al
    const deliveryResult = await pool.query(`
      SELECT dn.*, 
             c.company_name, c.contact_person, c.email as customer_email, c.phone as customer_phone, c.address as customer_address,
             o.order_number,
             u_creator.full_name as created_by_name
      FROM delivery_notes dn
      LEFT JOIN customers c ON dn.customer_id = c.id
      LEFT JOIN orders o ON dn.order_id = o.id
      LEFT JOIN users u_creator ON dn.created_by = u_creator.id
      WHERE dn.id = $1
    `, [deliveryNoteId]);
    
    if (deliveryResult.rows.length === 0) {
      console.log(`⚠️ İrsaliye bulunamadı, ID: ${deliveryNoteId}`);
      return { success: false, error: 'İrsaliye bulunamadı' };
    }
    const delivery = deliveryResult.rows[0];
    const customerEmail = delivery.customer_email;

    if (!customerEmail) {
        console.log(`⚠️ Müşteri e-posta adresi bulunamadı, ID: ${delivery.customer_id}`);
        return { success: false, error: 'Müşteri e-posta adresi yok' };
    }

    // İrsaliye kalemlerini al
    let deliveryItems = [];
    try {
        const itemsResult = await pool.query(`
            SELECT product_name, quantity, unit
            FROM delivery_note_items
            WHERE delivery_note_id = $1
        `, [deliveryNoteId]);
        deliveryItems = itemsResult.rows;
    } catch (error) {
        console.log(`⚠️ İrsaliye kalemleri alınamadı, İrsaliye ID: ${deliveryNoteId}`, error.message);
    }

    const nodemailer = require('nodemailer');
    const isGmail = settings.smtp_host.includes('gmail');
    const port = parseInt(settings.smtp_port);
    const secure = isGmail ? (port === 465) : settings.smtp_secure;
    
    const transporter = nodemailer.createTransport({
      host: settings.smtp_host,
      port: port,
      secure: secure,
      auth: { user: settings.smtp_user, pass: settings.smtp_pass },
      tls: { rejectUnauthorized: false }
    });

    const subject = `Teslimat Tamamlandı - ${delivery.delivery_number}`;
    
    const htmlContent = `
    <!DOCTYPE html>
    <html>
    <head>
        <meta charset="UTF-8">
        <title>İrsaliye - ${delivery.delivery_number}</title>
        <style>
            body { font-family: Arial, sans-serif; margin: 0; padding: 20px; background: #f5f5f5; }
            .container { max-width: 800px; margin: 0 auto; background: white; padding: 30px; border-radius: 8px; box-shadow: 0 2px 10px rgba(0,0,0,0.1); }
            .header { text-align: center; margin-bottom: 30px; border-bottom: 2px solid #007bff; padding-bottom: 20px; }
            .company-info { text-align: center; margin-bottom: 20px; }
            .delivery-info { display: grid; grid-template-columns: 1fr 1fr; gap: 30px; margin-bottom: 30px; }
            .info-box { background: #f8f9fa; padding: 15px; border-radius: 5px; }
            .info-box h3 { margin-top: 0; color: #007bff; }
            .items-table { width: 100%; border-collapse: collapse; margin-bottom: 30px; }
            .items-table th, .items-table td { border: 1px solid #ddd; padding: 12px; text-align: left; }
            .items-table th { background: #007bff; color: white; }
            .items-table tr:nth-child(even) { background: #f9f9f9; }
            .signature-section { margin-top: 30px; text-align: center; }
            .signature-box { border: 2px solid #007bff; padding: 20px; margin: 20px 0; border-radius: 5px; }
            .footer { text-align: center; margin-top: 30px; padding-top: 20px; border-top: 1px solid #ddd; color: #666; }
        </style>
    </head>
    <body>
        <div class="container">
            <div class="header">
                <h1>İRSALİYE</h1>
                <h2>${delivery.delivery_number}</h2>
            </div>
            
            <div class="company-info">
                <h3>SAHA CRM SİSTEMİ</h3>
                <p>Adres: Örnek Mahalle, Örnek Sokak No:1, İstanbul</p>
                <p>Telefon: +90 212 555 0000 | Email: info@sahacrm.com</p>
            </div>
            
            <div class="delivery-info">
                <div class="info-box">
                    <h3>Teslim Edilen Firma</h3>
                    <p><strong>Firma:</strong> ${delivery.company_name}</p>
                    <p><strong>Yetkili:</strong> ${delivery.contact_person || 'Belirtilmemiş'}</p>
                    <p><strong>Telefon:</strong> ${delivery.customer_phone || 'Belirtilmemiş'}</p>
                    <p><strong>Email:</strong> ${delivery.customer_email || 'Belirtilmemiş'}</p>
                    <p><strong>Adres:</strong> ${delivery.customer_address || 'Belirtilmemiş'}</p>
                </div>
                
                <div class="info-box">
                    <h3>Teslimat Bilgileri</h3>
                    <p><strong>İrsaliye No:</strong> ${delivery.delivery_number}</p>
                    <p><strong>Teslimat Tarihi:</strong> ${new Date(delivery.delivery_date).toLocaleDateString('tr-TR')}</p>
                    <p><strong>Teslim Eden:</strong> ${delivery.created_by_name || 'Sevkiyat Personeli'}</p>
                    <p><strong>Durum:</strong> Teslim Edildi</p>
                </div>
            </div>
            
            <h3>Teslim Edilen Ürünler</h3>
            <table class="items-table">
                <thead>
                    <tr>
                        <th>Ürün Adı</th>
                        <th>Miktar</th>
                        <th>Birim</th>
                    </tr>
                </thead>
                <tbody>
                    ${deliveryItems.map(item => `
                        <tr>
                            <td>${item.product_name || 'Ürün'}</td>
                            <td>${item.quantity}</td>
                            <td>${item.unit || 'adet'}</td>
                        </tr>
                    `).join('')}
                </tbody>
            </table>
            
            ${delivery.customer_signature ? `
                <div class="signature-section">
                    <h3>Teslim Alındı Onayı</h3>
                    <div class="signature-box">
                        <p><strong>Dijital İmza ile Teslim Alınmıştır</strong></p>
                        <img src="${delivery.customer_signature}" alt="Dijital İmza" style="max-width: 300px; max-height: 150px; border: 1px solid #ddd; margin: 10px 0;">
                        <p>Tarih: ${new Date(delivery.signature_date).toLocaleDateString('tr-TR')}</p>
                        <p>Teslim Alan: ${delivery.customer_name || 'Yetkili Kişi'}</p>
                    </div>
                </div>
            ` : `
                <div class="signature-section">
                    <div class="signature-box">
                        <p><strong>Teslim Alındı</strong></p>
                        <p>Tarih: ${new Date(delivery.delivery_date).toLocaleDateString('tr-TR')}</p>
                        <p>Teslim Alan: ________________</p>
                        <p>İmza: ________________</p>
                    </div>
                </div>
            `}
            
            <div class="footer">
                <p>Bu irsaliye otomatik olarak oluşturulmuştur.</p>
                <p>Herhangi bir sorunuz için lütfen bizimle iletişime geçin.</p>
            </div>
        </div>
    </body>
    </html>
  `;

    const mailOptions = {
      from: `${settings.from_name} <${settings.smtp_user}>`,
      to: customerEmail,
      subject: subject,
      html: htmlContent
    };

    await transporter.sendMail(mailOptions);
    
    await pool.query(`
      INSERT INTO sent_mails (to_email, subject, body, status, delivery_note_id, sent_by)
      VALUES ($1, $2, $3, 'sent', $4, $5)
    `, [customerEmail, subject, htmlContent, deliveryNoteId, 1]);
    
    console.log(`✅ Teslimat maili başarıyla gönderildi: ${customerEmail}`);
    return { success: true };

  } catch (error) {
    console.error(`📧 Mail gönderme hatası (İrsaliye ID: ${deliveryNoteId}):`, error);
    await pool.query(`
      INSERT INTO sent_mails (to_email, subject, body, status, error_message, delivery_note_id, sent_by)
      VALUES ($1, $2, $3, 'failed', $4, $5, $6)
    `, ['N/A', `İrsaliye ${deliveryNoteId} için mail hatası`, '', error.message, deliveryNoteId, 1]);
    return { success: false, error: error.message };
  }
}

// İrsaliye imzala ve teslimatı tamamla
app.put("/api/delivery-notes/:id/sign", authenticateToken, async (req, res) => {
  try {
    const { id } = req.params;
    const { customer_signature, customer_name, customer_title } = req.body;

    if (!customer_signature || !customer_name) {
      return res.status(400).json({ success: false, error: 'İmza ve teslim alan adı gerekli' });
    }

    const result = await pool.query(`
      UPDATE delivery_notes SET
        status = 'delivered',
        customer_signature = $1,
        customer_name = $2,
        customer_title = $3,
        signature_date = CURRENT_TIMESTAMP,
        signature_ip = $4,
        signature_device_info = $5,
        updated_at = CURRENT_TIMESTAMP
      WHERE id = $6
      RETURNING *
    `, [
      customer_signature, customer_name, customer_title,
      req.ip,
      req.headers['user-agent'],
      id
    ]);

    if (result.rows.length === 0) {
      return res.status(404).json({ success: false, error: 'İrsaliye bulunamadı' });
    }

    // Teslimat tamamlandığında mail gönder
    sendDeliveryCompletionEmail(id);

    res.json({
      success: true,
      message: 'Teslimat başarıyla tamamlandı',
      delivery_note: result.rows[0]
    });
  } catch (error) {
    console.error('Delivery note sign error:', error);
    res.status(500).json({ success: false, error: error.message });
  }
});

// İrsaliye sil
app.delete("/api/delivery-notes/:id", authenticateToken, checkPermission('delivery.delete'), async (req, res) => {
  try {
    const { id } = req.params;

    const result = await pool.query('DELETE FROM delivery_notes WHERE id = $1 RETURNING *', [id]);

    if (result.rows.length === 0) {
      return res.status(404).json({
        success: false,
        error: 'İrsaliye bulunamadı'
      });
    }

    res.json({
      success: true,
      message: 'İrsaliye başarıyla silindi'
    });
  } catch (error) {
    console.error('Delivery Note delete hatası:', error);
    res.status(500).json({
      success: false,
      error: error.message
    });
  }
});

// İrsaliye sistemi migration
app.post("/api/migrate-delivery-notes", async (req, res) => {
  try {
    console.log('📋 İrsaliye sistemi migration başlatılıyor...');

    // Mevcut delivery_notes tablosunu sil ve yeniden oluştur
    await pool.query('DROP TABLE IF EXISTS delivery_note_items CASCADE');
    await pool.query('DROP TABLE IF EXISTS delivery_notes CASCADE');

    // Yeni delivery_notes tablosunu oluştur
    await pool.query(`
      CREATE TABLE delivery_notes (
          id SERIAL PRIMARY KEY,
          delivery_number VARCHAR(50) UNIQUE NOT NULL,
          order_id INTEGER REFERENCES orders(id),
          customer_id INTEGER REFERENCES customers(id),

          delivery_date DATE NOT NULL,
          delivery_time TIME,
          delivered_by INTEGER REFERENCES users(id),
          delivery_address TEXT,

          customer_signature TEXT,
          customer_name VARCHAR(100),
          customer_title VARCHAR(100),
          signature_date TIMESTAMP,
          signature_ip VARCHAR(45),
          signature_device_info TEXT,

          status VARCHAR(20) DEFAULT 'pending',
          notes TEXT,
          internal_notes TEXT,

          attachments JSONB,

          created_by INTEGER REFERENCES users(id),
          created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
          updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
      );
    `);

    // İrsaliye detay tablosunu oluştur
    await pool.query(`
      CREATE TABLE delivery_note_items (
          id SERIAL PRIMARY KEY,
          delivery_note_id INTEGER REFERENCES delivery_notes(id) ON DELETE CASCADE,
          product_id INTEGER REFERENCES products(id),
          product_name VARCHAR(200) NOT NULL,
          quantity INTEGER NOT NULL,
          unit_price DECIMAL(10,2),
          total_price DECIMAL(10,2),
          unit VARCHAR(20) DEFAULT 'adet',
          notes TEXT,
          created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
      );
    `);

    // İndeksler ekle
    await pool.query(`
      CREATE INDEX idx_delivery_notes_customer_id ON delivery_notes(customer_id);
      CREATE INDEX idx_delivery_notes_order_id ON delivery_notes(order_id);
      CREATE INDEX idx_delivery_notes_status ON delivery_notes(status);
      CREATE INDEX idx_delivery_notes_delivery_date ON delivery_notes(delivery_date);
      CREATE INDEX idx_delivery_note_items_delivery_note_id ON delivery_note_items(delivery_note_id);
    `);

    // Örnek irsaliyeler oluştur
    const customers = await pool.query('SELECT id, company_name, address FROM customers LIMIT 5');
    const users = await pool.query('SELECT id FROM users LIMIT 1');

    if (customers.rows.length > 0 && users.rows.length > 0) {
      const userId = users.rows[0].id;

      for (let i = 0; i < customers.rows.length; i++) {
        const customer = customers.rows[i];
        const deliveryNumber = `IRS${new Date().getFullYear().toString().substr(-2)}${(new Date().getMonth() + 1).toString().padStart(2, '0')}${new Date().getDate().toString().padStart(2, '0')}${(i + 1).toString().padStart(3, '0')}`;

        const deliveryDate = new Date();
        deliveryDate.setDate(deliveryDate.getDate() + i);

        const status = i % 4 === 0 ? 'delivered' : i % 3 === 0 ? 'in_transit' : 'pending';

        const result = await pool.query(`
          INSERT INTO delivery_notes (
            delivery_number, customer_id, delivery_date, delivery_time,
            delivered_by, delivery_address, status, notes, internal_notes,
            created_by
          ) VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10)
          RETURNING id
        `, [
          deliveryNumber, customer.id, deliveryDate.toISOString().split('T')[0], '14:00:00',
          userId, customer.address, status,
          `Örnek irsaliye - ${customer.company_name} için teslimat`,
          'Dahili not: Dikkatli teslimat yapılacak', userId
        ]);

        // Eğer teslim edilmişse örnek imza ekle
        if (status === 'delivered') {
          await pool.query(`
            UPDATE delivery_notes SET
              customer_signature = $1,
              customer_name = $2,
              customer_title = $3,
              signature_date = $4,
              signature_ip = $5
            WHERE id = $6
          `, [
            'data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mNkYPhfDwAChwGA60e6kgAAAABJRU5ErkJggg==',
            'Yetkili Kişi', 'Satın Alma Müdürü', new Date(), '192.168.1.100',
            result.rows[0].id
          ]);
        }
      }
    }

    console.log('✅ İrsaliye sistemi migration tamamlandı');

    res.json({
      success: true,
      message: 'İrsaliye sistemi başarıyla güncellendi'
    });

  } catch (error) {
    console.error('İrsaliye migration hatası:', error);
    res.status(500).json({
      success: false,
      message: error.message
    });
  }
});

// Randevu/Görev Yönetimi API'leri
app.get("/api/appointments", authenticateToken, checkPermission('appointments.read'), async (req, res) => {
  try {
    const { type, status, assigned_to, customer_id, start_date } = req.query;
    const { userId, role } = req.user;

    let query = `
      SELECT a.*,
             u.id as user_id,
             u.full_name as assigned_to_name,
             r.name as assigned_to_role,
             c.company_name as customer_name
      FROM appointments a
      LEFT JOIN users u ON a.assigned_to = u.id
      LEFT JOIN roles r ON u.role_id = r.id
      LEFT JOIN customers c ON a.customer_id = c.id
    `;

    const params = [];
    const whereClauses = [];

    if (type) {
      whereClauses.push(`a.type = $${params.push(type)}`);
    }

    if (status) {
      whereClauses.push(`a.status = $${params.push(status)}`);
    }

    if (customer_id) {
      whereClauses.push(`a.customer_id = $${params.push(parseInt(customer_id))}`);
    }

    if (start_date) {
      whereClauses.push(`a.start_date = $${params.push(start_date)}`);
    }

    // Admin tüm randevuları görebilir, diğerleri sadece kendininkini
    if (role !== 'Yönetici') {
      whereClauses.push(`a.assigned_to = $${params.push(userId)}`);
    } else if (assigned_to) { // Admin ise ve belirli bir kullanıcıyı filtrelemek istiyorsa
      whereClauses.push(`a.assigned_to = $${params.push(parseInt(assigned_to))}`);
    }

    if (whereClauses.length > 0) {
      query += ` WHERE ${whereClauses.join(' AND ')}`;
    }

    query += ` ORDER BY a.start_date ASC, a.start_time ASC`;

    const result = await pool.query(query, params);

    // Eğer whereClauses boşsa ve rol admin değilse, yine de filtrele
    if (whereClauses.length === 0 && role !== 'Yönetici') {
        const filteredResults = result.rows.filter(apt => apt.user_id === userId);
        return res.json({ success: true, appointments: filteredResults });
    }

    console.log('Appointments API - Bulunan randevu sayısı:', result.rows.length);

    res.json({
      success: true,
      appointments: result.rows
    });
  } catch (error) {
    console.error('Appointments API hatası:', error);
    res.status(500).json({
      success: false,
      error: error.message
    });
  }
});

// Tek randevu getir
app.get("/api/appointments/:id", async (req, res) => {
  try {
    const { id } = req.params;
    const result = await pool.query(`
      SELECT a.*,
             u.full_name as assigned_to_name,
             r.name as assigned_to_role,
             c.company_name as customer_name
      FROM appointments a
      LEFT JOIN users u ON a.assigned_to = u.id
      LEFT JOIN roles r ON u.role_id = r.id
      LEFT JOIN customers c ON a.customer_id = c.id
      WHERE a.id = $1
    `, [id]);

    if (result.rows.length === 0) {
      return res.status(404).json({
        success: false,
        error: 'Randevu bulunamadı'
      });
    }

    res.json({
      success: true,
      appointment: result.rows[0]
    });
  } catch (error) {
    console.error('Appointment get hatası:', error);
    res.status(500).json({
      success: false,
      error: error.message
    });
  }
});

// Yeni randevu oluştur
app.post("/api/appointments", async (req, res) => {
  try {
    const {
      title, description, type, priority,
      start_date, start_time, end_date, end_time, all_day,
      assigned_to, customer_id, order_id,
      location, address, latitude, longitude,
      reminder_minutes
    } = req.body;

    const result = await pool.query(`
      INSERT INTO appointments (
        title, description, type, priority,
        start_date, start_time, end_date, end_time, all_day,
        assigned_to, customer_id, order_id,
        location, address, latitude, longitude,
        reminder_minutes, created_by
      ) VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12, $13, $14, $15, $16, $17, $18)
      RETURNING *
    `, [
      title, description, type, priority,
      start_date, start_time || null, end_date || null, end_time || null, all_day || false,
      assigned_to, customer_id || null, order_id || null,
      location, address, latitude || null, longitude || null,
      reminder_minutes || 15, 1 // TODO: Gerçek kullanıcı ID'si
    ]);

    res.json({
      success: true,
      appointment: result.rows[0]
    });
  } catch (error) {
    console.error('Appointment create hatası:', error);
    res.status(500).json({
      success: false,
      error: error.message
    });
  }
});

// Randevu güncelle
app.put("/api/appointments/:id", async (req, res) => {
  try {
    const { id } = req.params;
    const {
      title, description, type, priority,
      start_date, start_time, end_date, end_time, all_day,
      assigned_to, customer_id, order_id,
      location, address, latitude, longitude,
      reminder_minutes, status
    } = req.body;

    const result = await pool.query(`
      UPDATE appointments SET
        title = $1,
        description = $2,
        type = $3,
        priority = $4,
        start_date = $5,
        start_time = $6,
        end_date = $7,
        end_time = $8,
        all_day = $9,
        assigned_to = $10,
        customer_id = $11,
        order_id = $12,
        location = $13,
        address = $14,
        latitude = $15,
        longitude = $16,
        reminder_minutes = $17,
        status = COALESCE($18, status),
        updated_at = CURRENT_TIMESTAMP
      WHERE id = $19
      RETURNING *
    `, [
      title, description, type, priority,
      start_date, start_time || null, end_date || null, end_time || null, all_day || false,
      assigned_to, customer_id || null, order_id || null,
      location, address, latitude || null, longitude || null,
      reminder_minutes || 15, status, id
    ]);

    if (result.rows.length === 0) {
      return res.status(404).json({
        success: false,
        error: 'Randevu bulunamadı'
      });
    }

    res.json({
      success: true,
      appointment: result.rows[0]
    });
  } catch (error) {
    console.error('Appointment update hatası:', error);
    res.status(500).json({
      success: false,
      error: error.message
    });
  }
});

// Randevu tamamla
app.post("/api/appointments/:id/complete", async (req, res) => {
  try {
    const { id } = req.params;
    const { completion_notes } = req.body;

    const result = await pool.query(`
      UPDATE appointments SET
        status = 'completed',
        completion_notes = $1,
        completion_date = CURRENT_TIMESTAMP,
        updated_at = CURRENT_TIMESTAMP
      WHERE id = $2
      RETURNING *
    `, [completion_notes, id]);

    if (result.rows.length === 0) {
      return res.status(404).json({
        success: false,
        error: 'Randevu bulunamadı'
      });
    }

    res.json({
      success: true,
      appointment: result.rows[0]
    });
  } catch (error) {
    console.error('Appointment complete hatası:', error);
    res.status(500).json({
      success: false,
      error: error.message
    });
  }
});

// Randevu sil
app.delete("/api/appointments/:id", async (req, res) => {
  try {
    const { id } = req.params;

    const result = await pool.query('DELETE FROM appointments WHERE id = $1 RETURNING *', [id]);

    if (result.rows.length === 0) {
      return res.status(404).json({
        success: false,
        error: 'Randevu bulunamadı'
      });
    }

    res.json({
      success: true,
      message: 'Randevu başarıyla silindi'
    });
  } catch (error) {
    console.error('Appointment delete hatası:', error);
    res.status(500).json({
      success: false,
      error: error.message
    });
  }
});

// Randevu sistemi migration
app.post("/api/migrate-appointments", async (req, res) => {
  try {
    console.log('📅 Randevu sistemi migration başlatılıyor...');

    // appointments tablosunu oluştur
    await pool.query(`
      CREATE TABLE IF NOT EXISTS appointments (
          id SERIAL PRIMARY KEY,
          title VARCHAR(200) NOT NULL,
          description TEXT,

          type VARCHAR(50) NOT NULL,
          priority VARCHAR(20) DEFAULT 'medium',

          start_date DATE NOT NULL,
          start_time TIME,
          end_date DATE,
          end_time TIME,
          all_day BOOLEAN DEFAULT false,

          customer_id INTEGER REFERENCES customers(id),
          order_id INTEGER REFERENCES orders(id),
          assigned_to INTEGER REFERENCES users(id) NOT NULL,

          location TEXT,
          address TEXT,
          latitude DECIMAL(10, 8),
          longitude DECIMAL(11, 8),

          status VARCHAR(20) DEFAULT 'pending',
          completion_notes TEXT,
          completion_date TIMESTAMP,

          reminder_minutes INTEGER DEFAULT 15,
          reminder_sent BOOLEAN DEFAULT false,

          is_recurring BOOLEAN DEFAULT false,
          recurrence_pattern JSONB,

          created_by INTEGER REFERENCES users(id),
          created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
          updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
      );
    `);

    // appointment_participants tablosunu oluştur
    await pool.query(`
      CREATE TABLE IF NOT EXISTS appointment_participants (
          id SERIAL PRIMARY KEY,
          appointment_id INTEGER REFERENCES appointments(id) ON DELETE CASCADE,
          user_id INTEGER REFERENCES users(id),
          customer_contact_id INTEGER,
          participant_type VARCHAR(20) DEFAULT 'attendee',
          response_status VARCHAR(20) DEFAULT 'pending',
          created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
      );
    `);

    // İndeksler ekle
    await pool.query(`
      CREATE INDEX IF NOT EXISTS idx_appointments_assigned_to ON appointments(assigned_to);
      CREATE INDEX IF NOT EXISTS idx_appointments_customer_id ON appointments(customer_id);
      CREATE INDEX IF NOT EXISTS idx_appointments_start_date ON appointments(start_date);
      CREATE INDEX IF NOT EXISTS idx_appointments_status ON appointments(status);
      CREATE INDEX IF NOT EXISTS idx_appointments_type ON appointments(type);
    `);

    // Örnek randevular oluştur
    const users = await pool.query('SELECT id, full_name FROM users LIMIT 3');
    const customers = await pool.query('SELECT id, company_name FROM customers LIMIT 2');

    if (users.rows.length > 0 && customers.rows.length > 0) {
      const appointmentTypes = ['appointment', 'task', 'visit', 'call', 'meeting'];
      const priorities = ['low', 'medium', 'high', 'urgent'];
      const statuses = ['pending', 'in_progress', 'completed'];

      let appointmentCount = 0;

      for (const user of users.rows) {
        for (const customer of customers.rows) {
          appointmentCount++;

          const type = appointmentTypes[(appointmentCount - 1) % 5];
          const priority = priorities[(appointmentCount - 1) % 4];
          const status = statuses[(appointmentCount - 1) % 3];

          const startDate = new Date();
          startDate.setDate(startDate.getDate() + appointmentCount);

          const startTime = appointmentCount % 3 === 1 ? '09:00:00' :
                           appointmentCount % 3 === 2 ? '14:00:00' : '16:30:00';

          const result = await pool.query(`
            INSERT INTO appointments (
              title, description, type, priority,
              start_date, start_time, assigned_to, customer_id,
              location, address, status, reminder_minutes, created_by
            ) VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12, $13)
            RETURNING id
          `, [
            `${customer.company_name} ile ${type}`,
            `Örnek randevu açıklaması - ${customer.company_name} firması ile yapılacak ${type}`,
            type, priority,
            startDate.toISOString().split('T')[0], startTime,
            user.id, customer.id,
            `${customer.company_name} Ofisi`,
            `Örnek adres - ${customer.company_name}`,
            status,
            priority === 'urgent' ? 5 : priority === 'high' ? 15 : 30,
            1
          ]);

          // Bazı randevuları tamamlanmış olarak işaretle
          if (appointmentCount % 4 === 0) {
            await pool.query(`
              UPDATE appointments SET
                status = 'completed',
                completion_notes = 'Randevu başarıyla tamamlandı. Müşteri ile görüşme yapıldı.',
                completion_date = CURRENT_TIMESTAMP - INTERVAL '${appointmentCount} hours'
              WHERE id = $1
            `, [result.rows[0].id]);
          }
        }
      }

      // Bazı görevler ekle (müşteri bağımsız)
      for (const user of users.rows.slice(0, 2)) {
        appointmentCount++;

        await pool.query(`
          INSERT INTO appointments (
            title, description, type, priority,
            start_date, start_time, all_day,
            assigned_to, location, status, reminder_minutes, created_by
          ) VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12)
        `, [
          'Haftalık Rapor Hazırlama',
          'Haftalık satış raporunu hazırla ve yöneticiye sun',
          'task', 'medium',
          new Date(Date.now() + 24 * 60 * 60 * 1000).toISOString().split('T')[0],
          '10:00:00', false,
          user.id, 'Ofis', 'pending', 60, 1
        ]);
      }
    }

    console.log('✅ Randevu sistemi migration tamamlandı');

    res.json({
      success: true,
      message: 'Randevu sistemi başarıyla oluşturuldu'
    });

  } catch (error) {
    console.error('Randevu migration hatası:', error);
    res.status(500).json({
      success: false,
      message: error.message
    });
  }
});

// Backup alma
app.post("/api/backup-database", async (req, res) => {
  try {
    console.log('💾 Database backup alınıyor...');
    
    const backupId = `backup_${Date.now()}`;
    
    // Basit backup - tablo yapılarını ve verileri JSON olarak döndür
    const tables = ['roles', 'departments', 'users', 'products', 'customers', 'orders', 'order_items', 'customer_visits'];
    const backup = {};
    
    for (const table of tables) {
      try {
        const result = await pool.query(`SELECT * FROM ${table}`);
        backup[table] = result.rows;
      } catch (error) {
        console.log(`⚠️ ${table} tablosu bulunamadı`);
      }
    }
    
    res.json({
      success: true,
      message: 'Database backup başarıyla alındı',
      backupId: backupId,
      backup: backup
    });
  } catch (error) {
    console.error('Backup hatası:', error);
    res.status(500).json({
      success: false,
      message: error.message
    });
  }
});

// Bağlantı testi
app.get("/api/test-connection", async (req, res) => {
  try {
    const startTime = Date.now();
    await pool.query('SELECT 1');
    const responseTime = Date.now() - startTime;
    
    res.json({
      success: true,
      message: 'Database bağlantısı başarılı',
      responseTime: responseTime
    });
  } catch (error) {
    console.error('Bağlantı test hatası:', error);
    res.status(500).json({
      success: false,
      message: error.message
    });
  }
});

// Dashboard için eksik endpoint'ler
app.get("/api/dashboard/monthly-sales", async (req, res) => {
  try {
    const result = await pool.query(`
      SELECT COALESCE(SUM(total_amount), 0) as monthlySales 
      FROM orders 
      WHERE EXTRACT(MONTH FROM order_date) = EXTRACT(MONTH FROM CURRENT_DATE)
      AND EXTRACT(YEAR FROM order_date) = EXTRACT(YEAR FROM CURRENT_DATE)
    `);
    
    res.json({
      success: true,
      monthlySales: parseFloat(result.rows[0].monthlysales) || 0,
      target: 600000
    });
  } catch (error) {
    console.error('Monthly sales hatası:', error);
    res.status(500).json({
      success: false,
      monthlySales: 0,
      target: 600000
    });
  }
});

// Hedefler API - Sales.html için
app.get("/api/targets/user/:userId", async (req, res) => {
  try {
    const { userId } = req.params;
    console.log('🎯 Kullanıcı hedefleri istendi:', userId);
    
    // Örnek hedef verileri döndür
    const targets = [
      {
        id: 1,
        user_id: userId,
        target_type: 'sales',
        target_value: 100000,
        achieved_value: 75000,
        target_month: new Date().getMonth() + 1,
        target_year: new Date().getFullYear()
      },
      {
        id: 2,
        user_id: userId,
        target_type: 'visits',
        target_value: 30,
        achieved_value: 22,
        target_month: new Date().getMonth() + 1,
        target_year: new Date().getFullYear()
      }
    ];
    
    res.json({
      success: true,
      targets: targets
    });
  } catch (error) {
    console.error('User targets hatası:', error);
    res.status(500).json({
      success: false,
      targets: []
    });
  }
});

// Ziyaretler API - Sales.html için
app.post("/api/visits", authenticateToken, async (req, res) => {
  try {
    const { customer_id, visit_type, result, notes, next_contact_date, visit_date } = req.body;
    const sales_rep_id = req.user.userId;
    console.log('📝 Yeni ziyaret kaydı:', req.body);

    // customer_visits tablosu yoksa oluştur
    await pool.query(`
      CREATE TABLE IF NOT EXISTS customer_visits (
        id SERIAL PRIMARY KEY,
        customer_id INTEGER REFERENCES customers(id),
        sales_rep_id INTEGER REFERENCES users(id),
        visit_date TIMESTAMP NOT NULL,
        visit_type VARCHAR(50),
        result VARCHAR(50),
        notes TEXT,
        next_contact_date DATE,
        created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
      );
    `);

    const newVisit = await pool.query(
      `INSERT INTO customer_visits (customer_id, sales_rep_id, visit_date, visit_type, result, notes, next_contact_date)
       VALUES ($1, $2, $3, $4, $5, $6, $7)
       RETURNING *`,
      [customer_id, sales_rep_id, visit_date, visit_type, result, notes, next_contact_date || null]
    );

    res.status(201).json({
      success: true,
      visit: newVisit.rows[0]
    });
  } catch (error) {
    console.error('Visit create hatası:', error);
    res.status(500).json({
      success: false,
      error: error.message
    });
  }
});

app.get("/api/dashboard/customer-status", async (req, res) => {
  try {
    const result = await pool.query(`
      SELECT 
        COUNT(CASE WHEN customer_status = 'active' THEN 1 END) as active,
        COUNT(CASE WHEN customer_status = 'potential' THEN 1 END) as potential,
        COUNT(CASE WHEN customer_status = 'inactive' THEN 1 END) as inactive
      FROM customers
    `);
    
    const row = result.rows[0];
    res.json({
      success: true,
      active: parseInt(row.active) || 0,
      potential: parseInt(row.potential) || 0,
      inactive: parseInt(row.inactive) || 0
    });
  } catch (error) {
    console.error('Customer status hatası:', error);
    res.status(500).json({
      success: false,
      active: 0,
      potential: 0,
      inactive: 0
    });
  }
});

// Test API'si - Database bağlantısını kontrol et
app.get("/api/test", async (req, res) => {
  try {
    console.log("🧪 Test API çağrıldı");

    // Database bağlantısını test et
    const result = await pool.query('SELECT NOW() as current_time');
    console.log("✅ Database bağlantısı çalışıyor:", result.rows[0]);

    // Tabloları kontrol et
    const tables = await pool.query(`
      SELECT table_name
      FROM information_schema.tables
      WHERE table_schema = 'public'
      ORDER BY table_name
    `);

    console.log("📋 Mevcut tablolar:", tables.rows.map(t => t.table_name));

    res.json({
      success: true,
      message: "API çalışıyor",
      database_time: result.rows[0].current_time,
      tables: tables.rows.map(t => t.table_name),
      environment: process.env.NODE_ENV || 'development'
    });

  } catch (error) {
    console.error("❌ Test API hatası:", error);
    res.status(500).json({
      success: false,
      error: error.message,
      stack: error.stack
    });
  }
});

// Setup endpoint
app.get("/api/setup", async (req, res) => {
  try {
    console.log('🔧 Setup başlatılıyor...');
    
    const bcrypt = require("bcryptjs");
    
    // Basit tablolar oluştur
    await pool.query(`
      CREATE TABLE IF NOT EXISTS roles (
        id SERIAL PRIMARY KEY,
        name VARCHAR(50) UNIQUE NOT NULL
      );
      
      CREATE TABLE IF NOT EXISTS departments (
        id SERIAL PRIMARY KEY,
        name VARCHAR(100) NOT NULL
      );
      
      CREATE TABLE IF NOT EXISTS users (
        id SERIAL PRIMARY KEY,
        username VARCHAR(50) UNIQUE NOT NULL,
        email VARCHAR(100) UNIQUE NOT NULL,
        password_hash VARCHAR(255) NOT NULL,
        full_name VARCHAR(100) NOT NULL,
        role_id INTEGER,
        department_id INTEGER,
        is_active BOOLEAN DEFAULT true,
        created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
      );
      
      CREATE TABLE IF NOT EXISTS customers (
        id SERIAL PRIMARY KEY,
        company_name VARCHAR(200) NOT NULL,
        contact_person VARCHAR(100),
        phone VARCHAR(20),
        email VARCHAR(100),
        address TEXT,
        assigned_sales_rep INTEGER,
        customer_status VARCHAR(20) DEFAULT 'potential',
        created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
      );
      
      CREATE TABLE IF NOT EXISTS products (
        id SERIAL PRIMARY KEY,
        name VARCHAR(200) NOT NULL,
        description TEXT,
        unit_price DECIMAL(10,2) NOT NULL,
        unit VARCHAR(20) DEFAULT 'adet',
        is_active BOOLEAN DEFAULT true,
        created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
      );
      
      CREATE TABLE IF NOT EXISTS orders (
        id SERIAL PRIMARY KEY,
        order_number VARCHAR(50) UNIQUE NOT NULL,
        customer_id INTEGER,
        sales_rep_id INTEGER,
        order_date DATE NOT NULL,
        total_amount DECIMAL(12,2) NOT NULL,
        status VARCHAR(20) DEFAULT 'pending',
        notes TEXT,
        created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
      );
    `);
    
    // Temel veriler
    await pool.query(`INSERT INTO roles (id, name) VALUES (1, 'Admin') ON CONFLICT (name) DO NOTHING`);
    await pool.query(`INSERT INTO departments (id, name) VALUES (1, 'IT') ON CONFLICT (id) DO NOTHING`);
    
    // Admin kullanıcısı
    const hashedPassword = await bcrypt.hash("admin123", 10);
    await pool.query(`
      INSERT INTO users (username, email, password_hash, full_name, role_id, department_id, is_active) VALUES 
      ('admin', 'admin@sahacrm.com', $1, 'Sistem Yöneticisi', 1, 1, true)
      ON CONFLICT (username) DO NOTHING
    `, [hashedPassword]);
    
    res.json({ 
      success: true,
      message: 'Database başarıyla kuruldu!',
      admin: { username: 'admin', password: 'admin123' }
    });
    
  } catch (error) {
    console.error('Setup hatası:', error);
    res.status(500).json({ error: error.message });
  }
});

// Güvenli tablo kontrolü yardımcı fonksiyonu
async function checkTableExists(tableName) {
  try {
    const result = await pool.query(`
      SELECT EXISTS (
        SELECT FROM information_schema.tables
        WHERE table_schema = 'public'
        AND table_name = $1
      );
    `, [tableName]);
    return result.rows[0].exists;
  } catch (error) {
    console.error(`Tablo kontrolü hatası (${tableName}):`, error);
    return false;
  }
}

// Kullanıcılar API
app.get("/api/users", authenticateToken, checkPermission('users.read'), async (req, res) => {
  try {
    console.log('👥 Users API çağrıldı, query:', req.query);
    const { role } = req.query;

    // Önce users tablosunun var olup olmadığını kontrol et
    const tableExists = await checkTableExists('users');
    if (!tableExists) {
      console.log('⚠️ Users tablosu bulunamadı');
      return res.json({
        success: true,
        users: [],
        message: 'Users tablosu henüz oluşturulmamış'
      });
    }

    let query = `
      SELECT u.id, u.username, u.full_name, u.email, u.phone, u.is_active, u.role_id, u.department_id,
             COALESCE(r.name, 'Rol Yok') as role_name,
             COALESCE(d.name, 'Departman Yok') as department_name
      FROM users u
      LEFT JOIN roles r ON u.role_id = r.id
      LEFT JOIN departments d ON u.department_id = d.id
    `;
    const params = [];
    const whereClauses = [];

    if (role) {
        // Gelen role parametresine göre esnek arama yap (örn: "shipping" -> "Sevkiyat")
        const roleSearchTerm = role.toLowerCase() === 'shipping' ? 'Sevkiyat' : role;
        whereClauses.push(`r.name ILIKE $${params.length + 1}`);
        params.push(`%${roleSearchTerm}%`);
    }

    if (whereClauses.length > 0) {
        query += ` WHERE ${whereClauses.join(' AND ')}`;
    }

    query += ` ORDER BY u.full_name ASC`;

    const result = await pool.query(query, params);

    console.log(`✅ Users API - Rol "${role || 'Tümü'}" için ${result.rows.length} kullanıcı bulundu.`);

    res.json({
      success: true,
      users: result.rows
    });
  } catch (error) {
    console.error('❌ Users API hatası:', error);
    res.status(500).json({
      success: false,
      error: error.message,
      details: 'Users tablosu veya ilişkili tablolar bulunamadı'
    });
  }
});

app.post("/api/users", async (req, res) => {
  try {
    const { username, email, password, full_name, role_id, department_id } = req.body;
    
    // Şifre kontrolü
    if (!password || password.trim() === '') {
      return res.status(400).json({
        success: false,
        error: 'Şifre gerekli'
      });
    }
    
    // Şifreyi hash'le
    const bcrypt = require("bcryptjs");
    const hashedPassword = await bcrypt.hash(password.toString().trim(), 10);
    
    const result = await pool.query(`
      INSERT INTO users (username, email, password_hash, full_name, role_id, department_id, is_active)
      VALUES ($1, $2, $3, $4, $5, $6, true)
      RETURNING *
    `, [username, email, hashedPassword, full_name, role_id, department_id]);
    
    res.json({
      success: true,
      user: result.rows[0]
    });
  } catch (error) {
    console.error('User create hatası:', error);
    res.status(500).json({
      success: false,
      error: error.message
    });
  }
});

// Tek kullanıcı getir
app.get("/api/users/:id", async (req, res) => {
  try {
    const { id } = req.params;
    const result = await pool.query(`
      SELECT u.*, r.name as role_name, d.name as department_name
      FROM users u
      LEFT JOIN roles r ON u.role_id = r.id
      LEFT JOIN departments d ON u.department_id = d.id
      WHERE u.id = $1
    `, [id]);

    if (result.rows.length === 0) {
      return res.status(404).json({
        success: false,
        error: 'Kullanıcı bulunamadı'
      });
    }

    res.json({
      success: true,
      user: result.rows[0]
    });
  } catch (error) {
    console.error('User get hatası:', error);
    res.status(500).json({
      success: false,
      error: error.message
    });
  }
});

// Kullanıcı güncelle
app.put("/api/users/:id", async (req, res) => {
  try {
    const { id } = req.params;
    const { username, email, password, full_name, role_id, department_id, phone } = req.body;

    let query = `
      UPDATE users SET
        username = $1,
        email = $2,
        full_name = $3,
        role_id = $4,
        department_id = $5,
        phone = $6
    `;
    let params = [username, email, full_name, role_id, department_id, phone];

    // Eğer şifre verilmişse, hash'leyip güncelle
    if (password && password.trim() !== '') {
      const bcrypt = require("bcryptjs");
      const hashedPassword = await bcrypt.hash(password.toString().trim(), 10);
      query += `, password_hash = $7 WHERE id = $8 RETURNING *`;
      params.push(hashedPassword, id);
    } else {
      query += ` WHERE id = $7 RETURNING *`;
      params.push(id);
    }

    const result = await pool.query(query, params);

    if (result.rows.length === 0) {
      return res.status(404).json({
        success: false,
        error: 'Kullanıcı bulunamadı'
      });
    }

    res.json({
      success: true,
      user: result.rows[0]
    });
  } catch (error) {
    console.error('User update hatası:', error);
    res.status(500).json({
      success: false,
      error: error.message
    });
  }
});

// Kullanıcı sil
app.delete("/api/users/:id", async (req, res) => {
  try {
    const { id } = req.params;

    const result = await pool.query(`
      DELETE FROM users WHERE id = $1 RETURNING *
    `, [id]);

    if (result.rows.length === 0) {
      return res.status(404).json({
        success: false,
        error: 'Kullanıcı bulunamadı'
      });
    }

    res.json({
      success: true,
      message: 'Kullanıcı başarıyla silindi'
    });
  } catch (error) {
    console.error('User delete hatası:', error);
    res.status(500).json({
      success: false,
      error: error.message
    });
  }
});

// Müşteriler API
app.get("/api/customers", authenticateToken, checkPermission('customers.read'), async (req, res) => {
  try {
    console.log('🏢 Customers API çağrıldı');

    // Önce customers tablosunun var olup olmadığını kontrol et
    const tableCheck = await pool.query(`
      SELECT EXISTS (
        SELECT FROM information_schema.tables
        WHERE table_schema = 'public'
        AND table_name = 'customers'
      );
    `);

    if (!tableCheck.rows[0].exists) {
      console.log('⚠️ Customers tablosu bulunamadı');
      return res.json({
        success: true,
        customers: [],
        message: 'Customers tablosu henüz oluşturulmamış'
      });
    }

    const { userId, permissions } = req.user;

    let query = `
      SELECT c.*,
             COALESCE(u.full_name, 'Atanmamış') as sales_rep_name
      FROM customers c
      LEFT JOIN users u ON c.assigned_sales_rep = u.id
    `;
    const params = [];
    
    // Filter if the user has 'read_own' but not the general 'read' permission (and is not admin)
    const customerPerms = permissions.customers || [];
    if (customerPerms.includes('read_own') && !customerPerms.includes('read') && !permissions.all) {
      // Satış Personeli sadece kendi müşterilerini görür
      query += ` WHERE c.assigned_sales_rep = $1`;
      params.push(userId);
    } 

    query += ` ORDER BY c.created_at DESC`;

    const result = await pool.query(query, params);

    console.log('✅ Customers API - Bulunan müşteri sayısı:', result.rows.length);

    res.json({
      success: true,
      customers: result.rows
    });
  } catch (error) {
    console.error('❌ Customers API hatası:', error);
    res.status(500).json({
      success: false,
      error: error.message,
      details: 'Customers tablosu veya ilişkili tablolar bulunamadı'
    });
  }
});

app.post("/api/customers", authenticateToken, checkPermission('customers.create'), async (req, res) => {
  try {
    const { company_name, contact_person, phone, email, address, assigned_sales_rep } = req.body;
    
    // Geçerli bir sales_rep ID'si olup olmadığını kontrol et
    let validSalesRepId = null;
    if (assigned_sales_rep) {
      const userCheck = await pool.query('SELECT id FROM users WHERE id = $1', [assigned_sales_rep]);
      if (userCheck.rows.length > 0) {
        validSalesRepId = assigned_sales_rep;
      }
    }
    
    // Eğer geçerli değilse, ilk kullanıcıyı ata
    if (!validSalesRepId) {
      const firstUser = await pool.query('SELECT id FROM users ORDER BY id LIMIT 1');
      validSalesRepId = firstUser.rows.length > 0 ? firstUser.rows[0].id : null;
    }
    
    const result = await pool.query(`
      INSERT INTO customers (company_name, contact_person, phone, email, address, assigned_sales_rep, customer_status)
      VALUES ($1, $2, $3, $4, $5, $6, 'potential')
      RETURNING *
    `, [company_name, contact_person, phone, email, address, validSalesRepId]);
    
    res.json({
      success: true,
      customer: result.rows[0]
    });
  } catch (error) {
    console.error('Customer create hatası:', error);
    res.status(500).json({
      success: false,
      error: error.message
    });
  }
});

// Faturalar API
app.get("/api/invoices", async (req, res) => {
  try {
    // Önce invoices tablosunun varlığını kontrol et
    const tableExists = await checkTableExists('invoices');
    
    if (!tableExists) {
      console.log('⚠️ Invoices tablosu bulunamadı, oluşturuluyor...');
      
      // Tabloyu oluştur
      await pool.query(`
        CREATE TABLE IF NOT EXISTS invoices (
            id SERIAL PRIMARY KEY,
            invoice_number VARCHAR(50) UNIQUE NOT NULL,
            customer_id INTEGER REFERENCES customers(id),
            delivery_note_id INTEGER,
            subtotal DECIMAL(12,2) DEFAULT 0,
            vat_amount DECIMAL(12,2) DEFAULT 0,
            total_amount DECIMAL(12,2) NOT NULL,
            paid_amount DECIMAL(12,2) DEFAULT 0,
            remaining_amount DECIMAL(12,2),
            status VARCHAR(20) DEFAULT 'draft',
            invoice_date DATE DEFAULT CURRENT_DATE,
            due_date DATE,
            paid_date DATE,
            delivery_note_ids JSONB,
            consolidated_items JSONB,
            created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
        );
      `);
      
      console.log('✅ Invoices tablosu oluşturuldu');
    }
    
    const { customer_id } = req.query;
    
    let query = `
      SELECT i.*, c.company_name as customer_name
      FROM invoices i
      LEFT JOIN customers c ON i.customer_id = c.id
    `;
    const params = [];
    
    if (customer_id) {
      query += ` WHERE i.customer_id = $1`;
      params.push(customer_id);
    }
    
    query += ` ORDER BY i.created_at DESC`;
    
    const result = await pool.query(query, params);
    res.json({ success: true, invoices: result.rows });
  } catch (error) {
    console.error('Invoices API hatası:', error);
    res.status(500).json({ 
      success: false, 
      error: error.message,
      invoices: []
    });
  }
});

// İrsaliyeden fatura oluştur
app.post("/api/invoices/from-delivery", async (req, res) => {
  try {
    const { delivery_note_id } = req.body;
    
    // İrsaliye bilgilerini al
    const deliveryResult = await pool.query(`
      SELECT dn.*, c.id as customer_id, c.company_name
      FROM delivery_notes dn
      LEFT JOIN customers c ON dn.customer_id = c.id
      WHERE dn.id = $1
    `, [delivery_note_id]);
    
    if (deliveryResult.rows.length === 0) {
      return res.status(404).json({ success: false, error: 'İrsaliye bulunamadı' });
    }
    
    const delivery = deliveryResult.rows[0];
    const invoiceNumber = 'FAT' + Date.now().toString().slice(-6);
    
    // Sipariş tutarlarını al
    const orderResult = await pool.query(`
      SELECT total_amount FROM orders WHERE id = $1
    `, [delivery.order_id]);
    
    const totalAmount = orderResult.rows[0]?.total_amount || 0;
    const vatAmount = totalAmount * 0.20;
    const totalWithVat = totalAmount + vatAmount;
    
    // Fatura oluştur
    const invoiceResult = await pool.query(`
      INSERT INTO invoices (
        invoice_number, delivery_note_id, customer_id, 
        subtotal, vat_amount, total_amount, status, due_date
      ) VALUES ($1, $2, $3, $4, $5, $6, 'draft', $7)
      RETURNING *
    `, [
      invoiceNumber, delivery_note_id, delivery.customer_id,
      totalAmount, vatAmount, totalWithVat, 
      new Date(Date.now() + 30 * 24 * 60 * 60 * 1000) // 30 gün vade
    ]);
    
    res.json({ success: true, invoice: invoiceResult.rows[0] });
  } catch (error) {
    res.status(500).json({ success: false, error: error.message });
  }
});

// Çoklu irsaliyeden birleşik fatura oluştur
app.post("/api/invoices/bulk-from-deliveries", async (req, res) => {
  try {
    const { delivery_note_ids } = req.body;
    
    if (!delivery_note_ids || delivery_note_ids.length === 0) {
      return res.status(400).json({ success: false, error: 'İrsaliye seçilmedi' });
    }
    
    // İrsaliye bilgilerini al
    const deliveriesResult = await pool.query(`
      SELECT dn.*, c.id as customer_id, c.company_name, o.id as order_id
      FROM delivery_notes dn
      LEFT JOIN customers c ON dn.customer_id = c.id
      LEFT JOIN orders o ON dn.order_id = o.id
      WHERE dn.id = ANY($1)
    `, [delivery_note_ids]);
    
    const deliveries = deliveriesResult.rows;
    if (deliveries.length === 0) {
      return res.status(404).json({ success: false, error: 'İrsaliye bulunamadı' });
    }
    
    // Aynı müşteri kontrolü
    const customerIds = [...new Set(deliveries.map(d => d.customer_id))];
    if (customerIds.length > 1) {
      return res.status(400).json({ success: false, error: 'Farklı müşterilerin irsaliyeleri birleştirilemez' });
    }
    
    const customerId = customerIds[0];
    const invoiceNumber = 'FAT' + Date.now().toString().slice(-6);
    
    // Tüm sipariş kalemlerini al ve birleştir
    const orderIds = deliveries.map(d => d.order_id).filter(Boolean);
    const itemsResult = await pool.query(`
      SELECT oi.*, p.name as product_name
      FROM order_items oi
      LEFT JOIN products p ON oi.product_id = p.id
      WHERE oi.order_id = ANY($1)
    `, [orderIds]);
    
    // Aynı ürünleri birleştir
    const consolidatedItems = {};
    itemsResult.rows.forEach(item => {
      const key = item.product_id;
      if (consolidatedItems[key]) {
        consolidatedItems[key].quantity += item.quantity;
        consolidatedItems[key].total_price += item.total_price;
      } else {
        consolidatedItems[key] = { ...item };
      }
    });
    
    const totalAmount = Object.values(consolidatedItems).reduce((sum, item) => sum + item.total_price, 0);
    const vatAmount = totalAmount * 0.20;
    const totalWithVat = totalAmount + vatAmount;
    
    // Fatura oluştur
    const invoiceResult = await pool.query(`
      INSERT INTO invoices (
        invoice_number, customer_id, subtotal, vat_amount, total_amount, 
        status, due_date, delivery_note_ids, consolidated_items
      ) VALUES ($1, $2, $3, $4, $5, 'draft', $6, $7, $8)
      RETURNING *
    `, [
      invoiceNumber, customerId, totalAmount, vatAmount, totalWithVat,
      new Date(Date.now() + 30 * 24 * 60 * 60 * 1000),
      JSON.stringify(delivery_note_ids),
      JSON.stringify(Object.values(consolidatedItems))
    ]);
    
    // İrsaliyeleri faturalanıyor olarak işaretle
    await pool.query(`
      UPDATE delivery_notes SET invoice_id = $1 WHERE id = ANY($2)
    `, [invoiceResult.rows[0].id, delivery_note_ids]);
    
    res.json({ success: true, invoice: invoiceResult.rows[0] });
  } catch (error) {
    res.status(500).json({ success: false, error: error.message });
  }
});

// Fatura sil
app.delete("/api/invoices/:id", async (req, res) => {
  try {
    const { id } = req.params;
    
    // İlişkili irsaliyeleri temizle
    await pool.query('UPDATE delivery_notes SET invoice_id = NULL WHERE invoice_id = $1', [id]);
    
    // Faturayı sil
    const result = await pool.query('DELETE FROM invoices WHERE id = $1 RETURNING *', [id]);
    
    if (result.rows.length === 0) {
      return res.status(404).json({ success: false, error: 'Fatura bulunamadı' });
    }
    
    res.json({ success: true, message: 'Fatura silindi' });
  } catch (error) {
    res.status(500).json({ success: false, error: error.message });
  }
});

// Fatura ödeme kaydet
app.post("/api/invoices/:id/payment", async (req, res) => {
  try {
    const { id } = req.params;
    const { amount } = req.body;
    
    // Faturayı ödendi olarak işaretle
    await pool.query(`
      UPDATE invoices SET status = 'paid', paid_date = CURRENT_TIMESTAMP
      WHERE id = $1
    `, [id]);
    
    // Cari hesaba alacak kaydet
    const invoiceResult = await pool.query('SELECT customer_id FROM invoices WHERE id = $1', [id]);
    const customerId = invoiceResult.rows[0]?.customer_id;
    
    if (customerId) {
      await pool.query(`
        INSERT INTO account_transactions (
          customer_id, transaction_type, amount, transaction_date, 
          description, reference_number, created_by
        ) VALUES ($1, 'credit', $2, CURRENT_DATE, $3, $4, 1)
      `, [
        customerId, amount, 'Fatura ödemesi', `FAT-${id}`
      ]);
    }
    
    res.json({ success: true });
  } catch (error) {
    res.status(500).json({ success: false, error: error.message });
  }
});

// Tek sipariş getir
app.get("/api/orders/:id", authenticateToken, checkPermission('orders.read'), async (req, res) => {
  try {
    const { id } = req.params;
    const result = await pool.query(`
      SELECT o.*, c.company_name
      FROM orders o
      LEFT JOIN customers c ON o.customer_id = c.id
      WHERE o.id = $1
    `, [id]);

    if (result.rows.length === 0) {
      return res.status(404).json({ success: false, error: 'Sipariş bulunamadı' });
    }

    res.json({ success: true, order: result.rows[0] });
  } catch (error) {
    res.status(500).json({ success: false, error: error.message });
  }
});

// Sipariş kalemlerini getir
app.get("/api/orders/:id/items", authenticateToken, checkPermission('orders.read'), async (req, res) => {
  try {
    const { id } = req.params;
    console.log(`🔍 Sipariş ${id} için kalemler isteniyor...`);
    
    // Önce order_items tablosunun varlığını kontrol et
    const tableCheck = await pool.query(`
      SELECT EXISTS (
        SELECT FROM information_schema.tables
        WHERE table_schema = 'public'
        AND table_name = 'order_items'
      );
    `);
    
    if (!tableCheck.rows[0].exists) {
      console.log('⚠️ order_items tablosu bulunamadı, örnek veri döndürülüyor');
      const sampleItems = [
        { id: 1, product_name: 'Demir Profil 40x40', quantity: 10, unit: 'adet', unit_price: 25.50, total_price: 255.00 },
        { id: 2, product_name: 'Çelik Levha 2mm', quantity: 5, unit: 'm²', unit_price: 120.00, total_price: 600.00 }
      ];
      return res.json({ success: true, items: sampleItems });
    }
    
    // Önce tüm order_items'ları kontrol et
    const allItemsCheck = await pool.query('SELECT COUNT(*) as count FROM order_items');
    console.log(`📊 Toplam order_items sayısı: ${allItemsCheck.rows[0].count}`);
    
    const result = await pool.query(`
      SELECT oi.id, oi.order_id, oi.product_id,
             COALESCE(oi.product_name, p.name, 'Bilinmeyen Ürün') as product_name,
             oi.quantity, 
             COALESCE(oi.unit_price, p.unit_price, 0) as unit_price,
             oi.total_price, 
             COALESCE(oi.unit, p.unit, 'adet') as unit,
             p.description as product_description
      FROM order_items oi
      LEFT JOIN products p ON oi.product_id = p.id
      WHERE oi.order_id = $1 
      ORDER BY oi.id
    `, [id]);
    
    console.log(`📋 Sipariş ${id} için ${result.rows.length} kalem bulundu:`);
    result.rows.forEach((item, index) => {
      console.log(`  ${index + 1}. ${item.product_name} - ${item.quantity} ${item.unit} - ${item.unit_price} TL`);
    });



    if (result.rows.length === 0) {
      console.log(`⚠️ Sipariş ${id} için hiç kalem bulunamadı`);
      return res.json({ success: true, items: [] });
    }

    res.json({ success: true, items: result.rows });
  } catch (error) {
    console.error('❌ Order items API hatası:', error);
    res.status(500).json({ success: false, error: error.message, items: [] });
  }
});

// Sipariş durumu güncelle
app.put("/api/orders/:id/status", authenticateToken, checkPermission('orders.update'), async (req, res) => {
  const client = await pool.connect();
  try {
    await client.query('BEGIN');

    const { id } = req.params;
    const { status } = req.body;
    
    const result = await client.query(`
      UPDATE orders SET status = $1, updated_at = CURRENT_TIMESTAMP WHERE id = $2 RETURNING *
    `, [status, id]);
    
    if (result.rows.length === 0) {
      await client.query('ROLLBACK');
      return res.status(404).json({ success: false, error: 'Sipariş bulunamadı' });
    }

    const updatedOrder = result.rows[0];

    // Eğer üretim tamamlandıysa (status='completed'), sevkiyat için otomatik irsaliye oluştur
    if (status === 'completed') {
      // Bu sipariş için zaten bir irsaliye var mı kontrol et
      const existingNote = await client.query('SELECT id FROM delivery_notes WHERE order_id = $1', [id]);
      
      if (existingNote.rows.length === 0) {
        // Müşteri adresini al
        const customerResult = await client.query('SELECT address FROM customers WHERE id = $1', [updatedOrder.customer_id]);
        const deliveryAddress = customerResult.rows[0]?.address || 'Adres bulunamadı';

        // Otomatik atama için bir sevkiyatçı bul (rol_id = 7)
        const deliveryPersonResult = await client.query(
            `SELECT id FROM users WHERE role_id = 7 AND is_active = true ORDER BY id LIMIT 1`
        );
        const deliveryPersonId = deliveryPersonResult.rows.length > 0 ? deliveryPersonResult.rows[0].id : null;

        if (deliveryPersonId) {
            console.log(`🚚 Otomatik atama: İrsaliye, sevkiyatçı ID ${deliveryPersonId} üzerine atandı.`);
        } else {
            console.log(`⚠️ Otomatik atama için aktif sevkiyatçı bulunamadı. İrsaliye atama bekleyecek.`);
        }

        // İrsaliye numarası oluştur
        const now = new Date();
        const year = now.getFullYear().toString().substr(-2);
        const month = (now.getMonth() + 1).toString().padStart(2, '0');
        const day = now.getDate().toString().padStart(2, '0');
        const randomNum = Math.floor(Math.random() * 9999) + 1;
        const sequenceNumber = randomNum.toString().padStart(4, '0');
        const deliveryNumber = `IRS${year}${month}${day}${sequenceNumber}`;

        // İrsaliye oluştur
        await client.query(`
          INSERT INTO delivery_notes (
            delivery_number, order_id, customer_id, delivery_date, 
            delivery_address, status, created_by, delivered_by
          ) VALUES ($1, $2, $3, $4, $5, 'pending', $6, $7)
        `, [
          deliveryNumber,
          id,
          updatedOrder.customer_id,
          updatedOrder.delivery_date || new Date(),
          deliveryAddress,
          req.user.userId,
          deliveryPersonId
        ]);
        console.log(`✅ Sipariş ${id} için otomatik irsaliye oluşturuldu.`);
      }
    }
    
    await client.query('COMMIT');
    res.json({ success: true, order: updatedOrder });
  } catch (error) {
    await client.query('ROLLBACK');
    console.error('Sipariş durumu güncelleme hatası:', error);
    res.status(500).json({ success: false, error: error.message });
  } finally {
    client.release();
  }
});

// Tek müşteri getir
app.get("/api/customers/:id", authenticateToken, checkPermission('customers.read'), async (req, res) => {
  try {
    const { id } = req.params;
    const result = await pool.query(`
      SELECT c.*, u.full_name as sales_rep_name
      FROM customers c
      LEFT JOIN users u ON c.assigned_sales_rep = u.id
      WHERE c.id = $1
    `, [id]);

    if (result.rows.length === 0) {
      return res.status(404).json({
        success: false,
        error: 'Müşteri bulunamadı'
      });
    }

    res.json({
      success: true,
      customer: result.rows[0]
    });
  } catch (error) {
    console.error('Customer get hatası:', error);
    res.status(500).json({
      success: false,
      error: error.message
    });
  }
});

// Müşteri güncelle
app.put("/api/customers/:id", authenticateToken, checkPermission('customers.update'), async (req, res) => {
  try {
    const { id } = req.params;
    const { company_name, contact_person, phone, email, address, assigned_sales_rep } = req.body;

    const result = await pool.query(`
      UPDATE customers SET
        company_name = $1,
        contact_person = $2,
        phone = $3,
        email = $4,
        address = $5,
        assigned_sales_rep = $6
      WHERE id = $7
      RETURNING *
    `, [company_name, contact_person, phone, email, address, assigned_sales_rep, id]);

    if (result.rows.length === 0) {
      return res.status(404).json({
        success: false,
        error: 'Müşteri bulunamadı'
      });
    }

    res.json({
      success: true,
      customer: result.rows[0]
    });
  } catch (error) {
    console.error('Customer update hatası:', error);
    res.status(500).json({
      success: false,
      error: error.message
    });
  }
});

// Müşteri sil
app.delete("/api/customers/:id", authenticateToken, checkPermission('customers.delete'), async (req, res) => {
  try {
    const { id } = req.params;

    const result = await pool.query(`
      DELETE FROM customers WHERE id = $1 RETURNING *
    `, [id]);

    if (result.rows.length === 0) {
      return res.status(404).json({
        success: false,
        error: 'Müşteri bulunamadı'
      });
    }

    res.json({
      success: true,
      message: 'Müşteri başarıyla silindi'
    });
  } catch (error) {
    console.error('Customer delete hatası:', error);
    res.status(500).json({
      success: false,
      error: error.message
    });
  }
});

// Ürünler API
app.get("/api/products", authenticateToken, checkPermission('products.read'), async (req, res) => {
  try {
    console.log('📋 Products API çağrıldı');

    const result = await pool.query(`
      SELECT * FROM products
      ORDER BY name ASC
    `);

    console.log('✅ Products API - Bulunan ürün sayısı:', result.rows.length);

    res.json({
      success: true,
      products: result.rows
    });
  } catch (error) {
    console.error('❌ Products API hatası:', error);
    res.status(500).json({
      success: false,
      error: "Ürünler yüklenirken bir veritabanı hatası oluştu.",
      details: error.message
    });
  }
});

app.post("/api/products", authenticateToken, checkPermission('products.create'), async (req, res) => {
  try {
    const { name, description, unit_price, vat_rate, price_with_vat, unit } = req.body;

    console.log('Ürün ekleme isteği:', req.body);

    // Önce vat_rate ve price_with_vat kolonları var mı kontrol et
    const columnsResult = await pool.query(`
      SELECT column_name FROM information_schema.columns
      WHERE table_name = 'products' AND column_name IN ('vat_rate', 'price_with_vat')
    `);

    const hasVatColumns = columnsResult.rows.length === 2;
    let result;

    if (hasVatColumns) {
      // KDV kolonları varsa tam insert
      result = await pool.query(`
        INSERT INTO products (name, description, unit_price, vat_rate, price_with_vat, unit, is_active)
        VALUES ($1, $2, $3, $4, $5, $6, true)
        RETURNING *
      `, [name, description, parseFloat(unit_price), parseFloat(vat_rate), parseFloat(price_with_vat), unit]);
    } else {
      // KDV kolonları yoksa basit insert
      result = await pool.query(`
        INSERT INTO products (name, description, unit_price, unit, is_active)
        VALUES ($1, $2, $3, $4, true)
        RETURNING *
      `, [name, description, parseFloat(unit_price), unit]);
    }

    res.json({
      success: true,
      product: result.rows[0]
    });
  } catch (error) {
    console.error('Product create hatası:', error);
    res.status(500).json({
      success: false,
      error: error.message
    });
  }
});

// Ziyaretler API
app.get("/api/visits", authenticateToken, checkPermission('visits.read'), async (req, res) => {
  try {
    const { customer_id } = req.query;
    let query = `
      SELECT cv.*, c.company_name, u.full_name as sales_rep_name
      FROM customer_visits cv
      LEFT JOIN customers c ON cv.customer_id = c.id
      LEFT JOIN users u ON cv.sales_rep_id = u.id
      ORDER BY cv.visit_date DESC
    `;
    let params = [];

    if (customer_id) {
      query = `
        SELECT cv.*, c.company_name, u.full_name as sales_rep_name
        FROM customer_visits cv
        LEFT JOIN customers c ON cv.customer_id = c.id
        LEFT JOIN users u ON cv.sales_rep_id = u.id
        WHERE cv.customer_id = $1
        ORDER BY cv.visit_date DESC
      `;
      params = [customer_id];
    }

    const result = await pool.query(query, params);

    res.json({
      success: true,
      visits: result.rows
    });
  } catch (error) {
    console.error('Visits API hatası:', error);
    res.status(500).json({
      success: false,
      error: error.message
    });
  }
});

// Satış personeli dashboard stats
app.get("/api/sales/dashboard/:userId", async (req, res) => {
    try {
        const { userId } = req.params;
        const currentYear = new Date().getFullYear();
        const currentMonth = new Date().getMonth() + 1;

        // 1. Get user targets
        const targetsResult = await pool.query(`
            SELECT * FROM user_targets 
            WHERE user_id = $1 AND target_year = $2 AND target_month = $3
        `, [userId, currentYear, currentMonth]);
        const targets = targetsResult.rows[0] || {};

        // 2. Get user sales for the month
        const salesResult = await pool.query(`
            SELECT COALESCE(SUM(total_amount), 0) as total
            FROM orders
            WHERE sales_rep_id = $1 
              AND EXTRACT(YEAR FROM order_date) = $2
              AND EXTRACT(MONTH FROM order_date) = $3
        `, [userId, currentYear, currentMonth]);
        const currentMonthlySales = parseFloat(salesResult.rows[0].total);

        // 3. Get user visits for the month
        const visitsResult = await pool.query(`
            SELECT COUNT(*) as count
            FROM customer_visits
            WHERE sales_rep_id = $1
              AND EXTRACT(YEAR FROM visit_date) = $2
              AND EXTRACT(MONTH FROM visit_date) = $3
        `, [userId, currentYear, currentMonth]);
        const currentMonthlyVisits = parseInt(visitsResult.rows[0].count);

        // 4. Get user collections for the month
        const collectionsResult = await pool.query(`
            SELECT COALESCE(SUM(amount), 0) as total
            FROM account_transactions
            WHERE created_by = $1
              AND transaction_type = 'credit'
              AND EXTRACT(YEAR FROM transaction_date) = $2
              AND EXTRACT(MONTH FROM transaction_date) = $3
        `, [userId, currentYear, currentMonth]);
        const currentMonthlyCollection = parseFloat(collectionsResult.rows[0].total);

        res.json({
            success: true,
            stats: {
                monthlySalesTarget: parseFloat(targets.sales_target) || 0,
                currentMonthlySales: currentMonthlySales,
                monthlyVisitTarget: parseInt(targets.visit_target) || 0,
                currentMonthlyVisits: currentMonthlyVisits,
                monthlyCollectionTarget: parseFloat(targets.collection_target) || 0,
                currentMonthlyCollection: currentMonthlyCollection,
            }
        });

    } catch (error) {
        console.error(`Sales dashboard stats error for user ${req.params.userId}:`, error);
        res.status(500).json({ success: false, error: error.message });
    }
});

// Admin dashboard stats
app.get("/api/dashboard/stats", async (req, res) => {
  try {
    console.log('📊 Admin Dashboard stats isteği geldi');
    const stats = {};
    const currentYear = new Date().getFullYear();
    const currentMonth = new Date().getMonth() + 1;

    // General counts
    const counts = await Promise.all([
      pool.query('SELECT COUNT(*) FROM users'),
      pool.query('SELECT COUNT(*) FROM customers'),
      pool.query('SELECT COUNT(*) FROM orders'),
      pool.query('SELECT COUNT(*) FROM products')
    ]);
    stats.userCount = parseInt(counts[0].rows[0].count);
    stats.customerCount = parseInt(counts[1].rows[0].count);
    stats.orderCount = parseInt(counts[2].rows[0].count);
    stats.productCount = parseInt(counts[3].rows[0].count);

    // Order statuses
    const orderStatusResult = await pool.query(`
      SELECT status, COUNT(*) as count FROM orders GROUP BY status
    `);
    const orderStatuses = orderStatusResult.rows.reduce((acc, row) => {
      acc[row.status] = parseInt(row.count);
      return acc;
    }, {});
    stats.pendingOrders = orderStatuses.pending || 0;
    stats.productionOrders = orderStatuses.production || 0;
    stats.completedOrders = orderStatuses.completed || 0;
    stats.deliveredOrders = orderStatuses.delivered || 0;

    res.json({ success: true, stats: stats });
  } catch (error) {
    console.error('Admin Dashboard stats API hatası:', error);
    res.status(500).json({ success: false, error: error.message });
  }
});

// Siparişler API
app.get("/api/orders", authenticateToken, checkPermission('orders.read'), async (req, res) => {
  try {
    console.log('📦 Orders API çağrıldı');

    // Önce orders tablosunun var olup olmadığını kontrol et
    const tableCheck = await pool.query(`
      SELECT EXISTS (
        SELECT FROM information_schema.tables
        WHERE table_schema = 'public'
        AND table_name = 'orders'
      );
    `);

    if (!tableCheck.rows[0].exists) {
      console.log('⚠️ Orders tablosu bulunamadı');
      return res.json({
        success: true,
        orders: [],
        message: 'Orders tablosu henüz oluşturulmamış'
      });
    }

    const { customer_id } = req.query;
    let query = `
      SELECT o.*,
             COALESCE(c.company_name, 'Müşteri Yok') as company_name,
             COALESCE(u.full_name, 'Atanmamış') as sales_rep_name
      FROM orders o
      LEFT JOIN customers c ON o.customer_id = c.id
      LEFT JOIN users u ON o.sales_rep_id = u.id
    `;
    let params = [];
    let whereClauses = [];

    if (customer_id) {
      params.push(customer_id);
      whereClauses.push(`o.customer_id = $${params.length}`);
    }
    
    // Yetkiye göre filtrele
    const { userId, permissions } = req.user;
    const orderPerms = permissions.orders || [];
    if (orderPerms.includes('read_own') && !orderPerms.includes('read') && !permissions.all) {
      // Satış Personeli sadece kendi siparişlerini görür
      whereClauses.push(`o.sales_rep_id = $${params.push(userId)}`);
    }


    if (whereClauses.length > 0) {
      query += ` WHERE ${whereClauses.join(' AND ')}`;
    }

    query += ` ORDER BY o.created_at DESC`;

    const result = await pool.query(query, params);

    console.log('✅ Orders API - Bulunan sipariş sayısı:', result.rows.length);

    res.json({
      success: true,
      orders: result.rows
    });
  } catch (error) {
    console.error('❌ Orders API hatası:', error);
    res.status(500).json({
      success: false,
      error: error.message,
      details: 'Orders tablosu veya ilişkili tablolar bulunamadı'
    });
  }
});

app.post("/api/orders", authenticateToken, checkPermission('orders.create'), async (req, res) => {
  try {
    console.log('📦 Sipariş oluşturma isteği:', req.body);
    
    const { customer_id, order_date, delivery_date, total_amount, notes, items } = req.body;
    const sales_rep_id = req.user.userId; // Token'dan gelen kullanıcı ID'sini al
    
    // Sipariş numarası oluştur
    const orderNum = `SIP${Date.now()}`;
    
    const result = await pool.query(`
      INSERT INTO orders (order_number, customer_id, sales_rep_id, order_date, delivery_date, total_amount, notes, status)
      VALUES ($1, $2, $3, $4, $5, $6, $7, 'pending')
      RETURNING *
    `, [orderNum, customer_id, sales_rep_id, order_date, delivery_date, parseFloat(total_amount), notes]);
    
    const orderId = result.rows[0].id;
    console.log(`📦 Sipariş oluşturuldu, ID: ${orderId}`);
    
    // Sipariş kalemlerini ekle (DAHA GÜVENLİ YÖNTEM)
    if (items && items.length > 0) {
      console.log(`📦 ${items.length} ürün ekleniyor...`);
      
      for (const item of items) {
        try {
          const productId = item.product_id || item.id;
          if (!productId) {
            console.warn('Ürün ID olmadan kalem atlanıyor:', item);
            continue;
          }
          
          // Ürün bilgilerini her zaman veritabanından alarak veri bütünlüğünü sağla
          const productResult = await pool.query('SELECT name, unit_price, unit FROM products WHERE id = $1', [productId]);
          
          if (productResult.rows.length === 0) {
            console.warn(`Ürün bulunamadı (ID: ${productId}), kalem atlanıyor.`);
            continue;
          }
          
          const dbProduct = productResult.rows[0];
          const productName = dbProduct.name;
          const unit = dbProduct.unit || 'adet';
          // Fiyat override edilebilir, edilmemişse veritabanından al
          const unitPrice = parseFloat(item.unit_price || item.price || dbProduct.unit_price || 0);
          const quantity = parseInt(item.quantity) || 1;
          const totalPrice = unitPrice * quantity;
          
          const itemResult = await pool.query(`
            INSERT INTO order_items (order_id, product_id, product_name, quantity, unit_price, total_price, unit)
            VALUES ($1, $2, $3, $4, $5, $6, $7)
            RETURNING id
          `, [orderId, productId, productName, quantity, unitPrice, totalPrice, unit]);
          
          console.log(`✅ Kalem eklendi, ID: ${itemResult.rows[0].id}`);
          
        } catch (itemError) {
          console.error(`❌ Ürün ekleme hatası:`, itemError.message);
          // Hata olsa bile devam et
        }
      }
    } else {
      console.log('⚠️ Hiç ürün gönderilmedi');
    }
    
    // Eklenen kalemleri kontrol et
    const itemsCheck = await pool.query('SELECT COUNT(*) as count FROM order_items WHERE order_id = $1', [orderId]);
    console.log(`📊 Sipariş ${orderId} için ${itemsCheck.rows[0].count} kalem eklendi`);
    
    console.log('✅ Sipariş oluşturuldu:', result.rows[0]);
    
    res.json({
      success: true,
      order: result.rows[0],
      order_number: result.rows[0].order_number
    });
  } catch (error) {
    console.error('❌ Order create hatası:', error);
    res.status(500).json({
      success: false,
      error: error.message
    });
  }
});

// Roller ve Departmanlar API
app.get("/api/roles", async (req, res) => {
  try {
    const result = await pool.query("SELECT * FROM roles ORDER BY name");
    res.json({
      success: true,
      roles: result.rows
    });
  } catch (error) {
    console.error('Roles API hatası:', error);
    res.status(500).json({
      success: false,
      error: error.message
    });
  }
});

// Duplicate departman API'leri silindi

// Cari Hesap API
app.get("/api/account-transactions", async (req, res) => {
  try {
    // Önce account_transactions tablosunun varlığını kontrol et
    const tableExists = await checkTableExists('account_transactions');
    
    if (!tableExists) {
      console.log('⚠️ Account_transactions tablosu bulunamadı, oluşturuluyor...');
      
      // Tabloyu oluştur
      await pool.query(`
        CREATE TABLE IF NOT EXISTS account_transactions (
            id SERIAL PRIMARY KEY,
            customer_id INTEGER REFERENCES customers(id),
            transaction_type VARCHAR(20) NOT NULL, -- 'debit' or 'credit'
            amount DECIMAL(12,2) NOT NULL,
            transaction_date DATE NOT NULL,
            description TEXT,
            reference_number VARCHAR(100),
            created_by INTEGER REFERENCES users(id),
            created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
        );
      `);
      
      console.log('✅ Account_transactions tablosu oluşturuldu');
    }
    
    const { customer_id, transaction_type, start_date, end_date } = req.query;
    
    let query = `
      SELECT at.*, c.company_name as customer_name, u.full_name as created_by_name
      FROM account_transactions at
      LEFT JOIN customers c ON at.customer_id = c.id
      LEFT JOIN users u ON at.created_by = u.id
      WHERE 1=1
    `;
    const params = [];
    let paramIndex = 1;
    
    if (customer_id) {
      query += ` AND at.customer_id = $${paramIndex}`;
      params.push(customer_id);
      paramIndex++;
    }
    
    if (transaction_type) {
      query += ` AND at.transaction_type = $${paramIndex}`;
      params.push(transaction_type);
      paramIndex++;
    }
    
    if (start_date) {
      query += ` AND at.transaction_date >= $${paramIndex}`;
      params.push(start_date);
      paramIndex++;
    }
    
    if (end_date) {
      query += ` AND at.transaction_date <= $${paramIndex}`;
      params.push(end_date);
      paramIndex++;
    }
    
    query += ` ORDER BY at.transaction_date DESC`;
    
    const result = await pool.query(query, params);
    
    res.json({
      success: true,
      transactions: result.rows
    });
  } catch (error) {
    console.error('Account transactions API hatası:', error);
    res.status(500).json({
      success: false,
      error: error.message,
      transactions: []
    });
  }
});

app.post("/api/account-transactions", async (req, res) => {
  try {
    // Önce account_transactions tablosunun varlığını kontrol et
    const tableExists = await checkTableExists('account_transactions');
    
    if (!tableExists) {
      // Tabloyu oluştur
      await pool.query(`
        CREATE TABLE IF NOT EXISTS account_transactions (
            id SERIAL PRIMARY KEY,
            customer_id INTEGER REFERENCES customers(id),
            transaction_type VARCHAR(20) NOT NULL,
            amount DECIMAL(12,2) NOT NULL,
            transaction_date DATE NOT NULL,
            description TEXT,
            reference_number VARCHAR(100),
            created_by INTEGER REFERENCES users(id),
            created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
        );
      `);
    }
    
    const { customer_id, transaction_type, amount, transaction_date, description, reference_number } = req.body;
    
    const result = await pool.query(`
      INSERT INTO account_transactions (customer_id, transaction_type, amount, transaction_date, description, reference_number, created_by)
      VALUES ($1, $2, $3, $4, $5, $6, 1)
      RETURNING *
    `, [customer_id, transaction_type, amount, transaction_date, description, reference_number]);
    
    res.json({
      success: true,
      transaction: result.rows[0]
    });
  } catch (error) {
    console.error('Transaction create hatası:', error);
    res.status(500).json({
      success: false,
      error: error.message
    });
  }
});

// Hedefler API
app.get("/api/targets", async (req, res) => {
  try {
    const result = await pool.query(`
      SELECT u.id, u.full_name, u.monthly_sales_target, u.monthly_production_target, u.monthly_revenue_target
      FROM users u
      WHERE u.is_active = true
      ORDER BY u.full_name
    `);
    
    res.json({
      success: true,
      targets: result.rows
    });
  } catch (error) {
    console.error('Targets API hatası:', error);
    res.status(500).json({
      success: false,
      error: error.message
    });
  }
});

app.post("/api/targets", async (req, res) => {
  try {
    const { user_id, monthly_sales_target, monthly_production_target, monthly_revenue_target } = req.body;
    
    const result = await pool.query(`
      UPDATE users 
      SET monthly_sales_target = $2, monthly_production_target = $3, monthly_revenue_target = $4
      WHERE id = $1
      RETURNING *
    `, [user_id, monthly_sales_target, monthly_production_target, monthly_revenue_target]);
    
    res.json({
      success: true,
      target: result.rows[0]
    });
  } catch (error) {
    console.error('Target update hatası:', error);
    res.status(500).json({
      success: false,
      error: error.message
    });
  }
});

// Tek hedef getir
app.get("/api/targets/:id", async (req, res) => {
  try {
    const { id } = req.params;
    const result = await pool.query(`
      SELECT u.id, u.full_name, u.username, u.monthly_sales_target, u.monthly_production_target, u.monthly_revenue_target
      FROM users u
      WHERE u.id = $1 AND u.is_active = true
    `, [id]);

    if (result.rows.length === 0) {
      return res.status(404).json({
        success: false,
        error: 'Hedef bulunamadı'
      });
    }

    res.json({
      success: true,
      target: result.rows[0]
    });
  } catch (error) {
    console.error('Target get hatası:', error);
    res.status(500).json({
      success: false,
      error: error.message
    });
  }
});

// Hedef güncelle
app.put("/api/targets/:id", async (req, res) => {
  try {
    const { id } = req.params;
    const { monthly_sales_target, monthly_production_target, monthly_revenue_target } = req.body;

    const result = await pool.query(`
      UPDATE users
      SET monthly_sales_target = $1,
          monthly_production_target = $2,
          monthly_revenue_target = $3
      WHERE id = $4 AND is_active = true
      RETURNING id, full_name, monthly_sales_target, monthly_production_target, monthly_revenue_target
    `, [monthly_sales_target, monthly_production_target, monthly_revenue_target, id]);

    if (result.rows.length === 0) {
      return res.status(404).json({
        success: false,
        error: 'Kullanıcı bulunamadı'
      });
    }

    res.json({
      success: true,
      target: result.rows[0]
    });
  } catch (error) {
    console.error('Target update hatası:', error);
    res.status(500).json({
      success: false,
      error: error.message
    });
  }
});

// ---------------- STATS API ---------------- //
app.get("/api/stats", async (req, res) => {
  try {
    // Toplam sipariş sayısı
    const ordersResult = await pool.query("SELECT COUNT(*) as total FROM orders");
    const totalOrders = parseInt(ordersResult.rows[0].total);
    
    // Toplam müşteri sayısı
    const customersResult = await pool.query("SELECT COUNT(*) as total FROM customers");
    const totalCustomers = parseInt(customersResult.rows[0].total);
    
    // Toplam ürün sayısı
    const productsResult = await pool.query("SELECT COUNT(*) as total FROM products");
    const totalProducts = parseInt(productsResult.rows[0].total);
    
    // Bu ay sipariş sayısı
    const monthlyOrdersResult = await pool.query(`
      SELECT COUNT(*) as total 
      FROM orders 
      WHERE EXTRACT(MONTH FROM order_date) = EXTRACT(MONTH FROM CURRENT_DATE)
      AND EXTRACT(YEAR FROM order_date) = EXTRACT(YEAR FROM CURRENT_DATE)
    `);
    const monthlyOrders = parseInt(monthlyOrdersResult.rows[0].total);
    
    res.json({
      success: true,
      totalOrders,
      totalCustomers,
      totalProducts,
      monthlyOrders
    });
  } catch (error) {
    console.error('Stats API hatası:', error);
    res.status(500).json({
      success: false,
      error: error.message
    });
  }
});

// ---------------- MAIL SYSTEM ---------------- //
// Mail ayarları kaydet
app.post("/api/mail/settings", async (req, res) => {
  try {
    const { smtp_host, smtp_port, smtp_user, smtp_pass, from_name, smtp_secure } = req.body;
    
    await pool.query(`
      CREATE TABLE IF NOT EXISTS mail_settings (
        id SERIAL PRIMARY KEY,
        smtp_host VARCHAR(255),
        smtp_port INTEGER DEFAULT 587,
        smtp_user VARCHAR(255),
        smtp_pass VARCHAR(255),
        from_name VARCHAR(255) DEFAULT 'Saha CRM',
        smtp_secure BOOLEAN DEFAULT false,
        updated_by INTEGER,
        created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
        updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
      );
    `);
    
    await pool.query(`
      INSERT INTO mail_settings (smtp_host, smtp_port, smtp_user, smtp_pass, from_name, smtp_secure, updated_by)
      VALUES ($1, $2, $3, $4, $5, $6, $7)
      ON CONFLICT (id) DO UPDATE SET
        smtp_host = EXCLUDED.smtp_host,
        smtp_port = EXCLUDED.smtp_port,
        smtp_user = EXCLUDED.smtp_user,
        smtp_pass = EXCLUDED.smtp_pass,
        from_name = EXCLUDED.from_name,
        smtp_secure = EXCLUDED.smtp_secure,
        updated_at = CURRENT_TIMESTAMP
    `, [smtp_host, smtp_port, smtp_user, smtp_pass, from_name, smtp_secure, 1]);
    
    res.json({ success: true, message: 'Mail ayarları kaydedildi' });
  } catch (error) {
    res.status(500).json({ success: false, error: error.message });
  }
});

// Mail ayarlarını getir
app.get("/api/mail/settings", async (req, res) => {
  try {
    const result = await pool.query('SELECT * FROM mail_settings ORDER BY id DESC LIMIT 1');
    res.json({ success: true, settings: result.rows[0] || null });
  } catch (error) {
    res.status(500).json({ success: false, error: error.message });
  }
});

// Gönderilen mailleri listele
app.get("/api/mail/sent", async (req, res) => {
  try {
    await pool.query(`
      CREATE TABLE IF NOT EXISTS sent_mails (
        id SERIAL PRIMARY KEY,
        to_email VARCHAR(255) NOT NULL,
        subject VARCHAR(500) NOT NULL,
        body TEXT,
        status VARCHAR(20) DEFAULT 'pending',
        error_message TEXT,
        delivery_note_id INTEGER,
        sent_by INTEGER,
        created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
      );
    `);
    
    const { status } = req.query;
    let query = 'SELECT * FROM sent_mails';
    let params = [];
    
    if (status) {
      query += ' WHERE status = $1';
      params.push(status);
    }
    
    query += ' ORDER BY created_at DESC LIMIT 100';
    
    const result = await pool.query(query, params);
    res.json({ success: true, mails: result.rows });
  } catch (error) {
    res.status(500).json({ success: false, error: error.message });
  }
});

// Test mail gönder
app.post("/api/mail/test", async (req, res) => {
  try {
    const { to_email, subject, message } = req.body;
    
    const settingsResult = await pool.query('SELECT * FROM mail_settings ORDER BY id DESC LIMIT 1');
    if (settingsResult.rows.length === 0) {
      return res.status(400).json({ success: false, error: 'Mail ayarları yapılmamış' });
    }
    
    const settings = settingsResult.rows[0];
    
    try {
      const nodemailer = require('nodemailer');
      
      // Gmail için özel ayarlar
      const isGmail = settings.smtp_host.includes('gmail');
      const port = parseInt(settings.smtp_port);
      const secure = isGmail ? (port === 465) : settings.smtp_secure;
      
      const transporter = nodemailer.createTransport({
        host: settings.smtp_host,
        port: port,
        secure: secure,
        auth: {
          user: settings.smtp_user,
          pass: settings.smtp_pass
        },
        tls: {
          rejectUnauthorized: false
        }
      });
      
      const mailOptions = {
        from: `${settings.from_name} <${settings.smtp_user}>`,
        to: to_email,
        subject: subject,
        text: message,
        html: `<p>${message.replace(/\n/g, '<br>')}</p>`
      };
      
      await transporter.sendMail(mailOptions);
      
      await pool.query(`
        INSERT INTO sent_mails (to_email, subject, body, status, sent_by)
        VALUES ($1, $2, $3, 'sent', $4)
      `, [to_email, subject, message, 1]);
      
      res.json({ success: true, message: 'Test mail başarıyla gönderildi' });
    } catch (mailError) {
      await pool.query(`
        INSERT INTO sent_mails (to_email, subject, body, status, error_message, sent_by)
        VALUES ($1, $2, $3, 'failed', $4, $5)
      `, [to_email, subject, message, mailError.message, 1]);
      
      throw mailError;
    }
  } catch (error) {
    res.status(500).json({ success: false, error: error.message });
  }
});

// SMTP bağlantı testi
app.post("/api/mail/test-connection", async (req, res) => {
  try {
    const { smtp_host, smtp_port, smtp_user, smtp_pass, smtp_secure } = req.body;
    
    const nodemailer = require('nodemailer');
    
    // Gmail için özel ayarlar
    const isGmail = smtp_host.includes('gmail');
    const port = parseInt(smtp_port);
    const secure = isGmail ? (port === 465) : smtp_secure;
    
    const transporter = nodemailer.createTransport({
      host: smtp_host,
      port: port,
      secure: secure,
      auth: {
        user: smtp_user,
        pass: smtp_pass
      },
      tls: {
        rejectUnauthorized: false
      }
    });
    
    // Bağlantıyı test et
    await transporter.verify();
    
    res.json({ success: true, message: 'SMTP bağlantısı başarılı' });
  } catch (error) {
    res.status(500).json({ success: false, error: error.message });
  }
});

// ---------------- DEBUG ENDPOINTS (Geçici) ---------------- //
app.post("/api/create-admin", async (req, res) => {
  try {
    console.log('🔧 Admin oluşturuluyor...');
    
    const hashedPassword = await bcrypt.hash('1234', 10);
    console.log('🔧 Hash oluşturuldu:', hashedPassword.substring(0, 20) + '...');
    
    // Önce sil
    await pool.query("DELETE FROM users WHERE username = 'admin1'");
    console.log('🔧 Eski admin silindi');
    
    // Roles ve departments oluştur
    await pool.query("INSERT INTO roles (id, name) VALUES (1, 'Admin') ON CONFLICT (id) DO NOTHING");
    await pool.query("INSERT INTO departments (id, name) VALUES (5, 'IT Departmanı') ON CONFLICT (id) DO NOTHING");
    
    // Sonra ekle
    const result = await pool.query(
      `INSERT INTO users (username, password_hash, full_name, email, role_id, department_id, is_active) 
       VALUES ($1, $2, $3, $4, $5, $6, $7) 
       RETURNING id, username`,
      ['admin1', hashedPassword, 'Admin User', 'admin@test.com', 1, 5, true]
    );
    
    console.log('🔧 Yeni admin eklendi:', result.rows[0]);
    
    res.json({ 
      success: true,
      message: 'Admin kullanıcı oluşturuldu',
      user: result.rows[0],
      credentials: {
        username: 'admin1',
        password: '1234'
      }
    });
    
  } catch (error) {
    console.error('🔧 Admin oluşturma hatası:', error);
    res.status(500).json({ error: error.message });
  }
});

// ---------------- ERROR HANDLER ---------------- //
app.use((err, req, res, next) => {
  console.error('Sunucu hatası:', err);
  res.status(500).json({ error: 'Sunucu hatası oluştu' });
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
