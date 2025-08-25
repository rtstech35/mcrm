require("dotenv").config();
const express = require("express");
const cors = require("cors");
const bcrypt = require("bcryptjs");
const jwt = require("jsonwebtoken");
const { Pool } = require("pg");
const path = require("path");
const setupDatabase = require("./setup-database");

const app = express();
app.use(cors());
app.use(express.json());

// ---------------- STATİK DOSYALAR ---------------- //
app.use(express.static(path.join(__dirname, "public")));
app.get("/admin", (req, res) => {
  res.sendFile(path.join(__dirname, "public", "admin.html"));
});

app.get("/setup", (req, res) => {
  res.sendFile(path.join(__dirname, "public", "setup.html"));
});

app.get("/database-manager", (req, res) => {
  res.sendFile(path.join(__dirname, "public", "database-manager.html"));
});

// ---------------- POSTGRESQL BAĞLANTI ---------------- //
const pool = new Pool({
  connectionString: process.env.DATABASE_URL,
  ssl: { rejectUnauthorized: false },
});

// Bağlantıyı test et ve database setup yap
pool.connect()
  .then(async () => {
    console.log("✅ PostgreSQL bağlantısı başarılı");
    
    // Production'da otomatik database setup (geçici olarak devre dışı)
    if (process.env.NODE_ENV === 'production' && process.env.AUTO_SETUP === 'true') {
      try {
        console.log("🔄 Production ortamında database setup kontrol ediliyor...");
        await setupDatabase();
        console.log("✅ Database setup tamamlandı");
      } catch (error) {
        console.log("⚠️ Database setup hatası (muhtemelen zaten kurulu):", error.message);
      }
    }
  })
  .catch(err => console.error("❌ PostgreSQL bağlantı hatası:", err));

// ---------------- TEST ---------------- //
app.get("/", (req, res) => {
  res.send("Saha CRM Sistemi Çalışıyor 🚀 (Postgres)");
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
      [username, hashedPassword, full_name || username, email, role_id || 1, department_id || 1, true]
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
    const result = await pool.query("SELECT * FROM users WHERE username = $1", [username]);
    
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
        { userId: user.id, username: user.username, role: 'admin' },
        process.env.JWT_SECRET || "fallback_secret_key_change_in_production",
        { expiresIn: "24h" }
      );
      
      return res.json({ 
        success: true,
        token,
        user: {
          id: user.id,
          username: user.username,
          full_name: user.full_name,
          role: 'admin'
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
          { userId: user.id, username: user.username, role: 'admin' },
          process.env.JWT_SECRET || "fallback_secret_key_change_in_production",
          { expiresIn: "24h" }
        );
        
        return res.json({ 
          success: true,
          token,
          user: {
            id: user.id,
            username: user.username,
            full_name: user.full_name,
            role: 'admin'
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

  jwt.verify(token, process.env.JWT_SECRET || "fallback_secret_key_change_in_production", (err, user) => {
    if (err) {
      return res.status(403).json({ error: 'Geçersiz token' });
    }
    req.user = user;
    next();
  });
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
app.get("/api/products", authenticateToken, async (req, res) => {
  try {
    const result = await pool.query("SELECT * FROM products ORDER BY id DESC");
    res.json(result.rows);
  } catch (err) {
    console.error("Ürünler alınamadı:", err);
    res.status(500).json({ error: "Ürünler alınamadı" });
  }
});

app.post("/api/products", authenticateToken, async (req, res) => {
  try {
    const { name, price, description, category } = req.body;
    if (!name || !price) {
      return res.status(400).json({ error: "Ürün adı ve fiyat zorunlu" });
    }
    
    await pool.query(
      "INSERT INTO products (name, price, description, category) VALUES ($1, $2, $3, $4)",
      [name, parseFloat(price), description || '', category || 'Genel']
    );
    
    res.json({ success: true, message: "Ürün başarıyla eklendi" });
  } catch (err) {
    console.error("Ürün eklenemedi:", err);
    res.status(500).json({ error: "Ürün eklenemedi" });
  }
});

// ---------------- SİPARİŞLER ---------------- //
app.get("/api/orders", authenticateToken, async (req, res) => {
  try {
    const result = await pool.query(
      `SELECT o.*, p.name as product_name, c.name as customer_name
       FROM orders o 
       LEFT JOIN products p ON o.product_id = p.id 
       LEFT JOIN customers c ON o.customer_id = c.id
       ORDER BY o.created_at DESC`
    );
    res.json(result.rows);
  } catch (err) {
    console.error("Siparişler alınamadı:", err);
    res.status(500).json({ error: "Siparişler alınamadı" });
  }
});

app.post("/api/orders", authenticateToken, async (req, res) => {
  try {
    const { customer_id, product_id, quantity, notes } = req.body;
    if (!customer_id || !product_id || !quantity) {
      return res.status(400).json({ error: "Müşteri, ürün ve miktar zorunlu" });
    }
    
    await pool.query(
      "INSERT INTO orders (customer_id, product_id, quantity, notes, status, created_by) VALUES ($1, $2, $3, $4, $5, $6)",
      [customer_id, product_id, parseInt(quantity), notes || '', 'pending', req.user.userId]
    );
    
    res.json({ success: true, message: "Sipariş başarıyla eklendi" });
  } catch (err) {
    console.error("Sipariş eklenemedi:", err);
    res.status(500).json({ error: "Sipariş eklenemedi" });
  }
});

// ---------------- MÜŞTERİLER ---------------- //
app.get("/api/customers", authenticateToken, async (req, res) => {
  try {
    const result = await pool.query("SELECT * FROM customers ORDER BY created_at DESC");
    res.json(result.rows);
  } catch (err) {
    console.error("Müşteriler alınamadı:", err);
    res.status(500).json({ error: "Müşteriler alınamadı" });
  }
});

app.post("/api/customers", authenticateToken, async (req, res) => {
  try {
    const { name, phone, email, address, company } = req.body;
    if (!name) {
      return res.status(400).json({ error: "Müşteri adı zorunlu" });
    }
    
    await pool.query(
      "INSERT INTO customers (name, phone, email, address, company) VALUES ($1, $2, $3, $4, $5)",
      [name, phone || '', email || '', address || '', company || '']
    );
    
    res.json({ success: true, message: "Müşteri başarıyla eklendi" });
  } catch (err) {
    console.error("Müşteri eklenemedi:", err);
    res.status(500).json({ error: "Müşteri eklenemedi" });
  }
});

// ---------------- DASHBOARD STATS ---------------- //
app.get("/api/stats", authenticateToken, async (req, res) => {
  try {
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
    const monthlyOrdersResult = await pool.query(
      "SELECT COUNT(*) as total FROM orders WHERE DATE_TRUNC('month', created_at) = DATE_TRUNC('month', CURRENT_DATE)"
    );
    const monthlyOrders = parseInt(monthlyOrdersResult.rows[0].total);

    res.json({
      totalOrders,
      totalCustomers, 
      totalProducts,
      monthlyOrders,
      totalRevenue: totalOrders * 150, // Dummy calculation
    });
  } catch (err) {
    console.error("Stats hatası:", err);
    res.json({
      totalOrders: 0,
      totalCustomers: 0,
      totalProducts: 0,
      monthlyOrders: 0,
      totalRevenue: 0
    });
  }
});

// ---------------- ROLES & DEPARTMENTS ---------------- //
app.get("/api/roles", authenticateToken, async (req, res) => {
  try {
    const result = await pool.query("SELECT * FROM roles ORDER BY name");
    res.json(result.rows);
  } catch (err) {
    console.error("Roller alınamadı:", err);
    res.status(500).json({ error: "Roller alınamadı" });
  }
});

app.get("/api/departments", authenticateToken, async (req, res) => {
  try {
    const result = await pool.query("SELECT * FROM departments ORDER BY name");
    res.json(result.rows);
  } catch (err) {
    console.error("Departmanlar alınamadı:", err);
    res.status(500).json({ error: "Departmanlar alınamadı" });
  }
});

// ---------------- SETUP ENDPOINTS ---------------- //
app.post("/api/setup-database", async (req, res) => {
  try {
    console.log('🔧 Database setup başlatılıyor...');
    await setupDatabase();
    res.json({ 
      success: true,
      message: 'Database başarıyla kuruldu',
      admin: {
        username: 'admin',
        password: 'admin123'
      }
    });
  } catch (error) {
    console.error('🔧 Database setup hatası:', error);
    res.status(500).json({ 
      error: error.message,
      message: 'Database setup başarısız'
    });
  }
});

app.post("/api/reset-database", async (req, res) => {
  try {
    console.log('🗑️ Database reset başlatılıyor...');
    const resetDatabase = require("./reset-database");
    await resetDatabase();
    res.json({ 
      success: true,
      message: 'Database başarıyla sıfırlandı ve yeniden kuruldu',
      admin: {
        username: 'admin',
        password: 'admin123'
      }
    });
  } catch (error) {
    console.error('🗑️ Database reset hatası:', error);
    res.status(500).json({ 
      error: error.message,
      message: 'Database reset başarısız'
    });
  }
});

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
    
    // Roller
    await pool.query(`
      INSERT INTO roles (id, name, description) VALUES 
      (1, 'Admin', 'Sistem yöneticisi'),
      (2, 'Sales', 'Satış temsilcisi'),
      (3, 'Production', 'Üretim sorumlusu'),
      (4, 'Shipping', 'Sevkiyat sorumlusu'),
      (5, 'Accounting', 'Muhasebe sorumlusu')
      ON CONFLICT (id) DO NOTHING
    `);

    // Departmanlar
    await pool.query(`
      INSERT INTO departments (id, name, description) VALUES 
      (1, 'IT', 'Bilgi Teknolojileri'),
      (2, 'Sales', 'Satış Departmanı'),
      (3, 'Production', 'Üretim Departmanı'),
      (4, 'Shipping', 'Sevkiyat Departmanı'),
      (5, 'Accounting', 'Muhasebe Departmanı')
      ON CONFLICT (id) DO NOTHING
    `);

    // Admin kullanıcısı
    const bcrypt = require("bcryptjs");
    const hashedPassword = await bcrypt.hash("admin123", 10);
    
    await pool.query(`
      INSERT INTO users (username, email, password_hash, full_name, role_id, department_id, is_active) VALUES 
      ('admin', 'admin@sahacrm.com', $1, 'Sistem Yöneticisi', 1, 1, true)
      ON CONFLICT (username) DO NOTHING
    `, [hashedPassword]);

    // Örnek ürünler
    await pool.query(`
      INSERT INTO products (name, description, unit_price, unit) VALUES 
      ('Ürün A', 'Örnek ürün açıklaması', 100.00, 'adet'),
      ('Ürün B', 'İkinci örnek ürün', 150.00, 'kg'),
      ('Ürün C', 'Üçüncü örnek ürün', 75.50, 'metre')
      ON CONFLICT DO NOTHING
    `);

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
    await pool.query("INSERT INTO departments (id, name) VALUES (1, 'IT') ON CONFLICT (id) DO NOTHING");
    
    // Sonra ekle
    const result = await pool.query(
      `INSERT INTO users (username, password_hash, full_name, email, role_id, department_id, is_active) 
       VALUES ($1, $2, $3, $4, $5, $6, $7) 
       RETURNING id, username`,
      ['admin1', hashedPassword, 'Admin User', 'admin@test.com', 1, 1, true]
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
  res.status(404).json({ error: 'Endpoint bulunamadı' });
});

// ---------------- SUNUCU ---------------- //
const PORT = process.env.PORT || 10000;
app.listen(PORT, () => {
  console.log(`🚀 Server running on port ${PORT}`);
  console.log(`📱 Environment: ${process.env.NODE_ENV || 'development'}`);
  console.log(`🔐 JWT Secret: ${process.env.JWT_SECRET ? '✅ Tanımlı' : '❌ Tanımsız'}`);
});