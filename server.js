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
    
    // Roller (Yetkiler)
    await pool.query(`
      INSERT INTO roles (id, name, description) VALUES
      (1, 'Admin', 'Sistem yöneticisi - Tüm yetkiler'),
      (2, 'Manager', 'Yönetici - Departman yönetimi'),
      (3, 'Employee', 'Çalışan - Temel işlemler'),
      (4, 'Viewer', 'Görüntüleyici - Sadece okuma')
      ON CONFLICT (id) DO NOTHING
    `);

    // Departmanlar (Bölümler)
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

    // 2. Her departman ve rol kombinasyonu için kullanıcı oluştur
    const hashedPassword = await bcrypt.hash('123456', 10);

    for (const dept of departmentsResult.rows) {
      for (const role of rolesResult.rows) {
        const username = `${dept.name.toLowerCase().replace(/\s+/g, '')}_${role.name.toLowerCase()}`;
        const fullName = `${dept.name} ${role.name}`;
        const email = `${username}@example.com`;

        await pool.query(`
          INSERT INTO users (username, password_hash, full_name, email, role_id, department_id, is_active)
          VALUES ($1, $2, $3, $4, $5, $6, true)
          ON CONFLICT (username) DO NOTHING
        `, [username, hashedPassword, fullName, email, role.id, dept.id]);

        stats.users++;
      }
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
      const hashedPassword = await bcrypt.hash(password, 10);
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

// Tek müşteri getir
app.get("/api/customers/:id", async (req, res) => {
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
app.put("/api/customers/:id", async (req, res) => {
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
app.delete("/api/customers/:id", async (req, res) => {
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
app.get("/api/visits", async (req, res) => {
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

// Siparişler API
app.get("/api/orders", async (req, res) => {
  try {
    const { customer_id } = req.query;
    let query = `
      SELECT o.*, c.company_name, u.full_name as sales_rep_name
      FROM orders o
      LEFT JOIN customers c ON o.customer_id = c.id
      LEFT JOIN users u ON o.sales_rep_id = u.id
      ORDER BY o.created_at DESC
    `;
    let params = [];

    if (customer_id) {
      query = `
        SELECT o.*, c.company_name, u.full_name as sales_rep_name
        FROM orders o
        LEFT JOIN customers c ON o.customer_id = c.id
        LEFT JOIN users u ON o.sales_rep_id = u.id
        WHERE o.customer_id = $1
        ORDER BY o.created_at DESC
      `;
      params = [customer_id];
    }

    const result = await pool.query(query, params);

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
  res.status(404).json({ error: 'Endpoint bulunamadı' });
});

// ---------------- SUNUCU ---------------- //
const PORT = process.env.PORT || 10000;
app.listen(PORT, () => {
  console.log(`🚀 Server running on port ${PORT}`);
  console.log(`📱 Environment: ${process.env.NODE_ENV || 'development'}`);
  console.log(`🔐 JWT Secret: ${process.env.JWT_SECRET ? '✅ Tanımlı' : '❌ Tanımsız'}`);
});