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
const pool = new Pool({
  connectionString: process.env.DATABASE_URL,
  ssl: { rejectUnauthorized: false },
});

// Bağlantıyı test et ve database setup yap
pool.connect()
  .then(async () => {
    console.log("✅ PostgreSQL bağlantısı başarılı");
    
    // Production'da otomatik database setup
    if (process.env.NODE_ENV === 'production') {
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
app.get("/api/products", async (req, res) => {
  try {
    const result = await pool.query("SELECT * FROM products ORDER BY id DESC");
    res.json(result.rows);
  } catch (err) {
    console.error("Ürünler alınamadı:", err);
    res.status(500).json({ error: "Ürünler alınamadı" });
  }
});

app.post("/api/products", async (req, res) => {
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
app.get("/api/roles", async (req, res) => {
  try {
    const result = await pool.query("SELECT * FROM roles ORDER BY name");
    res.json(result.rows);
  } catch (err) {
    console.error("Roller alınamadı:", err);
    res.status(500).json({ error: "Roller alınamadı" });
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

// Kullanıcılar API
app.get("/api/users", async (req, res) => {
  try {
    const result = await pool.query(`
      SELECT u.*, r.name as role_name, d.name as department_name
      FROM users u
      LEFT JOIN roles r ON u.role_id = r.id
      LEFT JOIN departments d ON u.department_id = d.id
      ORDER BY u.created_at DESC
    `);
    
    res.json({
      success: true,
      users: result.rows
    });
  } catch (error) {
    console.error('Users API hatası:', error);
    res.status(500).json({
      success: false,
      error: error.message
    });
  }
});

app.post("/api/users", async (req, res) => {
  try {
    const { username, email, password, full_name, role_id, department_id } = req.body;
    
    // Şifreyi hash'le
    const bcrypt = require("bcryptjs");
    const hashedPassword = await bcrypt.hash(password, 10);
    
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

// Müşteriler API
app.get("/api/customers", async (req, res) => {
  try {
    const result = await pool.query(`
      SELECT c.*, u.full_name as sales_rep_name
      FROM customers c
      LEFT JOIN users u ON c.assigned_sales_rep = u.id
      ORDER BY c.created_at DESC
    `);
    
    res.json({
      success: true,
      customers: result.rows
    });
  } catch (error) {
    console.error('Customers API hatası:', error);
    res.status(500).json({
      success: false,
      error: error.message
    });
  }
});

app.post("/api/customers", async (req, res) => {
  try {
    const { company_name, contact_person, phone, email, address, assigned_sales_rep } = req.body;
    
    const result = await pool.query(`
      INSERT INTO customers (company_name, contact_person, phone, email, address, assigned_sales_rep, customer_status)
      VALUES ($1, $2, $3, $4, $5, $6, 'potential')
      RETURNING *
    `, [company_name, contact_person, phone, email, address, assigned_sales_rep]);
    
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

// Ürünler API
app.get("/api/products", async (req, res) => {
  try {
    const result = await pool.query(`
      SELECT * FROM products 
      WHERE is_active = true
      ORDER BY created_at DESC
    `);
    
    res.json({
      success: true,
      products: result.rows
    });
  } catch (error) {
    console.error('Products API hatası:', error);
    res.status(500).json({
      success: false,
      error: error.message
    });
  }
});

app.post("/api/products", async (req, res) => {
  try {
    const { name, description, unit_price, unit } = req.body;
    
    const result = await pool.query(`
      INSERT INTO products (name, description, unit_price, unit, is_active)
      VALUES ($1, $2, $3, $4, true)
      RETURNING *
    `, [name, description, unit_price, unit]);
    
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

// Siparişler API
app.get("/api/orders", async (req, res) => {
  try {
    const result = await pool.query(`
      SELECT o.*, c.company_name, u.full_name as sales_rep_name
      FROM orders o
      LEFT JOIN customers c ON o.customer_id = c.id
      LEFT JOIN users u ON o.sales_rep_id = u.id
      ORDER BY o.created_at DESC
    `);
    
    res.json({
      success: true,
      orders: result.rows
    });
  } catch (error) {
    console.error('Orders API hatası:', error);
    res.status(500).json({
      success: false,
      error: error.message
    });
  }
});

app.post("/api/orders", async (req, res) => {
  try {
    const { order_number, customer_id, sales_rep_id, order_date, total_amount, notes } = req.body;
    
    const result = await pool.query(`
      INSERT INTO orders (order_number, customer_id, sales_rep_id, order_date, total_amount, notes, status)
      VALUES ($1, $2, $3, $4, $5, $6, 'pending')
      RETURNING *
    `, [order_number, customer_id, sales_rep_id, order_date, total_amount, notes]);
    
    res.json({
      success: true,
      order: result.rows[0]
    });
  } catch (error) {
    console.error('Order create hatası:', error);
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

app.get("/api/departments", async (req, res) => {
  try {
    const result = await pool.query("SELECT * FROM departments ORDER BY name");
    res.json({
      success: true,
      departments: result.rows
    });
  } catch (error) {
    console.error('Departments API hatası:', error);
    res.status(500).json({
      success: false,
      error: error.message
    });
  }
});

app.post("/api/departments", async (req, res) => {
  try {
    const { name, description } = req.body;
    
    const result = await pool.query(`
      INSERT INTO departments (name, description)
      VALUES ($1, $2)
      RETURNING *
    `, [name, description]);
    
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

// Cari Hesap API
app.get("/api/account-transactions", async (req, res) => {
  try {
    const result = await pool.query(`
      SELECT at.*, c.company_name as customer_name, u.full_name as created_by_name
      FROM account_transactions at
      LEFT JOIN customers c ON at.customer_id = c.id
      LEFT JOIN users u ON at.created_by = u.id
      ORDER BY at.transaction_date DESC
    `);
    
    res.json({
      success: true,
      transactions: result.rows
    });
  } catch (error) {
    console.error('Account transactions API hatası:', error);
    res.status(500).json({
      success: false,
      error: error.message
    });
  }
});

app.post("/api/account-transactions", async (req, res) => {
  try {
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