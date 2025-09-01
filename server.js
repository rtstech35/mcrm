console.log('🚀 Server başlatılıyor...');

const setupDatabase = require('./setup-database.js');
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

// ---------------- AUTH API ---------------- //
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

app.post("/api/login", async (req, res) => {
  try {
    const { username, password } = req.body;
    console.log(`🔒 Login attempt for user: ${username}`);
    
    // 1. Kullanıcıyı ve ilişkili rollerini/departmanlarını bul
    const result = await pool.query(`
      SELECT u.*, r.name as role_name, r.permissions, d.name as department_name
      FROM users u
      LEFT JOIN roles r ON u.role_id = r.id
      LEFT JOIN departments d ON u.department_id = d.id
      WHERE u.username = $1
    `, [username]);
    
    if (result.rows.length === 0) {
      console.log(`❌ Login failed: User '${username}' not found.`);
      return res.status(401).json({ error: "Kullanıcı adı veya şifre hatalı" });
    }
    
    const user = result.rows[0];
    
    // 2. Kullanıcının aktif olup olmadığını kontrol et
    if (!user.is_active) {
        console.log(`❌ Login failed: User '${username}' is not active.`);
        return res.status(403).json({ error: "Kullanıcı hesabınız pasif durumdadır. Lütfen yönetici ile iletişime geçin." });
    }

    // 3. Kullanıcının bir rolü olup olmadığını kontrol et
    if (!user.role_name) {
        console.log(`❌ Login failed: User '${username}' has no assigned role.`);
        return res.status(403).json({ error: "Hesabınıza bir rol atanmamış. Lütfen yönetici ile iletişime geçin." });
    }

    // 4. Şifreyi karşılaştır
    const isMatch = await bcrypt.compare(password, user.password_hash);
    if (!isMatch) {
      console.log(`❌ Login failed: Password mismatch for user '${username}'.`);
      return res.status(401).json({ error: "Kullanıcı adı veya şifre hatalı" });
    }

    // 5. Başarılı giriş, JWT oluştur
    console.log(`✅ Login successful for user: ${username}, Role: ${user.role_name}`);
    const token = jwt.sign(
      { userId: user.id, username: user.username, role: user.role_name, permissions: user.permissions || {} },
      JWT_SECRET || "fallback_secret_key_change_in_production",
      { expiresIn: "24h" }
    );

    // 6. Token ve kullanıcı bilgilerini döndür
    res.json({ success: true, token, user: { id: user.id, username: user.username, full_name: user.full_name, role_id: user.role_id, role_name: user.role_name, department_id: user.department_id, department_name: user.department_name, permissions: user.permissions || {} } });
    
  } catch (err) {
    console.error("Login hatası:", err);
    res.status(500).json({ error: "Sunucu hatası: " + err.message });
  }
});

// ---------------- MIDDLEWARE ---------------- //
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

// ---------------- USER PROFILE API ---------------- //
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

// ---------------- KULLANICILAR API ---------------- //
app.get("/api/users", authenticateToken, checkPermission('users.read'), async (req, res) => {
  try {
    console.log('👥 Users API çağrıldı, query:', req.query);
    const { role } = req.query;

    const tableExists = await checkTableExists('users');
    if (!tableExists) {
      return res.json({ success: true, users: [], message: 'Users tablosu henüz oluşturulmamış' });
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
        const roleSearchTerm = role.toLowerCase() === 'shipping' ? 'Sevkiyat' : role;
        whereClauses.push(`r.name ILIKE $${params.length + 1}`);
        params.push(`%${roleSearchTerm}%`);
    }

    if (whereClauses.length > 0) {
        query += ` WHERE ${whereClauses.join(' AND ')}`;
    }

    query += ` ORDER BY u.full_name ASC`;

    const result = await pool.query(query, params);
    res.json({ success: true, users: result.rows });
  } catch (error) {
    console.error('❌ Users API hatası:', error);
    res.status(500).json({ success: false, error: error.message });
  }
});

app.post("/api/users", authenticateToken, checkPermission('users.create'), async (req, res) => {
  try {
    const { username, email, password, full_name, role_id, department_id, phone } = req.body;
    if (!password || password.trim() === '') {
      return res.status(400).json({ success: false, error: 'Şifre gerekli' });
    }
    const hashedPassword = await bcrypt.hash(password.toString().trim(), 10);
    const result = await pool.query(`
      INSERT INTO users (username, email, password_hash, full_name, role_id, department_id, phone, is_active)
      VALUES ($1, $2, $3, $4, $5, $6, $7, true) RETURNING *
    `, [username, email, hashedPassword, full_name, role_id, department_id, phone]);
    res.json({ success: true, user: result.rows[0] });
  } catch (error) {
    console.error('User create hatası:', error);
    res.status(500).json({ success: false, error: error.message });
  }
});

app.get("/api/users/:id", authenticateToken, checkPermission('users.read'), async (req, res) => {
  try {
    const { id } = req.params;
    const result = await pool.query(`
      SELECT u.*, r.name as role_name, d.name as department_name FROM users u
      LEFT JOIN roles r ON u.role_id = r.id
      LEFT JOIN departments d ON u.department_id = d.id
      WHERE u.id = $1
    `, [id]);
    if (result.rows.length === 0) return res.status(404).json({ success: false, error: 'Kullanıcı bulunamadı' });
    res.json({ success: true, user: result.rows[0] });
  } catch (error) {
    console.error('User get hatası:', error);
    res.status(500).json({ success: false, error: error.message });
  }
});

app.put("/api/users/:id", authenticateToken, checkPermission('users.update'), async (req, res) => {
  try {
    const { id } = req.params;
    const { username, email, password, full_name, role_id, department_id, phone, is_active } = req.body;
    let query = `UPDATE users SET username = $1, email = $2, full_name = $3, role_id = $4, department_id = $5, phone = $6, is_active = $7`;
    let params = [username, email, full_name, role_id, department_id, phone, is_active];
    if (password && password.trim() !== '') {
      const hashedPassword = await bcrypt.hash(password.toString().trim(), 10);
      query += `, password_hash = $${params.length + 1} WHERE id = $${params.length + 2} RETURNING *`;
      params.push(hashedPassword, id);
    } else {
      query += ` WHERE id = $${params.length + 1} RETURNING *`;
      params.push(id);
    }
    const result = await pool.query(query, params);
    if (result.rows.length === 0) return res.status(404).json({ success: false, error: 'Kullanıcı bulunamadı' });
    res.json({ success: true, user: result.rows[0] });
  } catch (error) {
    console.error('User update hatası:', error);
    res.status(500).json({ success: false, error: error.message });
  }
});

app.delete("/api/users/:id", authenticateToken, checkPermission('users.delete'), async (req, res) => {
  try {
    const { id } = req.params;
    const result = await pool.query(`DELETE FROM users WHERE id = $1 RETURNING *`, [id]);
    if (result.rows.length === 0) return res.status(404).json({ success: false, error: 'Kullanıcı bulunamadı' });
    res.json({ success: true, message: 'Kullanıcı başarıyla silindi' });
  } catch (error) {
    console.error('User delete hatası:', error);
    res.status(500).json({ success: false, error: error.message });
  }
});

// ---------------- ÜRÜNLER API ---------------- //
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

// ---------------- ROLLER API ---------------- //
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
app.get("/api/roles/:id", authenticateToken, checkPermission('roles.read'), async (req, res) => {
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
app.post("/api/roles", authenticateToken, checkPermission('roles.create'), async (req, res) => {
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
      INSERT INTO roles (name, description, level, is_active, permissions)
      VALUES ($1, $2, $3, $4, '{}'::jsonb)
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
app.put("/api/roles/:id", authenticateToken, checkPermission('roles.update'), async (req, res) => {
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
app.delete("/api/roles/:id", authenticateToken, checkPermission('roles.delete'), async (req, res) => {
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
app.put("/api/roles/:id/permissions", authenticateToken, checkPermission('roles.update'), async (req, res) => {
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

// ---------------- DEPARTMANLAR API ---------------- //
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
app.get("/api/departments/:id", authenticateToken, checkPermission('departments.read'), async (req, res) => {
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
app.post("/api/departments", authenticateToken, checkPermission('departments.create'), async (req, res) => {
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
app.put("/api/departments/:id", authenticateToken, checkPermission('departments.update'), async (req, res) => {
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
app.delete("/api/departments/:id", authenticateToken, checkPermission('departments.delete'), async (req, res) => {
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

// ---------------- HEDEFLER API ---------------- //
app.get("/api/user-targets", authenticateToken, checkPermission('admin_dashboard'), async (req, res) => {
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
app.get("/api/user-targets/:userId", authenticateToken, checkPermission('admin_dashboard'), async (req, res) => {
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
app.post("/api/user-targets", authenticateToken, checkPermission('admin_dashboard'), async (req, res) => {
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
app.put("/api/user-targets/:userId", authenticateToken, checkPermission('admin_dashboard'), async (req, res) => {
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
app.delete("/api/user-targets/:id", authenticateToken, checkPermission('admin_dashboard'), async (req, res) => {
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

// ---------------- KASA YÖNETİMİ API ---------------- //
app.get("/api/cash-registers", authenticateToken, checkPermission('accounting.read'), async (req, res) => {
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

// ---------------- İRSALİYE API ---------------- //
app.get("/api/delivery-notes", authenticateToken, checkPermission('delivery.read'), async (req, res) => {
  try {
    // Tablonun varlığı migration'lar ve setup script'i ile garanti altına alınmalıdır.
    // API endpoint'i içinde tablo oluşturmak hatalara yol açabilir ve kodun okunabilirliğini düşürür.
    // Bu nedenle on-the-fly tablo oluşturma mantığı kaldırıldı.

    const { status, customer_id, include } = req.query;
    const { userId, permissions } = req.user;
 
    let query;
    const params = [];
    const whereClauses = [];

    if (include === 'items') {
      // N+1 problemini çözmek için JOIN ve JSON Aggregation kullanan sorgu
      query = `
        SELECT 
          dn.*,
          c.company_name as customer_name,
          c.address as customer_address,
          c.latitude, 
          c.longitude,
          u.full_name as delivered_by_name,
          o.order_number,
          COALESCE(json_agg(
            json_build_object(
              'id', dni.id,
              'product_id', dni.product_id,
              'product_name', COALESCE(dni.product_name, p.name, 'Bilinmeyen Ürün'),
              'quantity', dni.quantity,
              'unit', dni.unit
            )
          ) FILTER (WHERE dni.id IS NOT NULL), '[]'::jsonb) as items
        FROM delivery_notes dn
        LEFT JOIN customers c ON dn.customer_id = c.id
        LEFT JOIN users u ON dn.delivered_by = u.id
        LEFT JOIN orders o ON dn.order_id = o.id
        LEFT JOIN delivery_note_items dni ON dni.delivery_note_id = dn.id
        LEFT JOIN products p ON dni.product_id = p.id
      `;
    } else {
      // Orijinal, daha basit sorgu
      query = `
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
    }

    if (status) {
      whereClauses.push(`dn.status = $${params.push(status)}`);
    }
    if (customer_id) {
      whereClauses.push(`dn.customer_id = $${params.push(customer_id)}`);
    }

    // Filter if the user has 'read_own' but not the general 'read' permission (and is not admin)
    const deliveryPerms = permissions.delivery || [];
    const isShipper = deliveryPerms.includes('read_own') && !deliveryPerms.includes('read') && !permissions.all;

    if (isShipper) {
        // This is a shipper user. Apply special filtering.
        if (status === 'pending') {
            // Shippers can see all pending items to take one.
            // The `dn.status = 'pending'` clause is already added. No extra filter needed.
        } else if (status) { // 'in_transit', 'delivered', etc.
            // For any other specific status, they only see their own.
            whereClauses.push(`dn.delivered_by = $${params.push(userId)}`);
        } else { // status is undefined or empty string (dashboard or "All my shipments" view)
            // They see all pending items AND their own items of other statuses.
            whereClauses.push(`(dn.status = 'pending' OR dn.delivered_by = $${params.push(userId)})`);
        }
    }

    if (whereClauses.length > 0) {
        query += ` WHERE ${whereClauses.join(' AND ')}`;
    }

    if (include === 'items') {
      query += ` GROUP BY dn.id, c.id, u.id, o.id`;
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

// İrsaliye kalemlerini getir
app.get("/api/delivery-notes/:id/items", authenticateToken, checkPermission('delivery.read'), async (req, res) => {
  try {
    const { id } = req.params;
    const result = await pool.query(`
      SELECT dni.*, p.name as product_name_from_db
      FROM delivery_note_items dni
      LEFT JOIN products p ON dni.product_id = p.id
      WHERE dni.delivery_note_id = $1
      ORDER BY dni.id
    `, [id]);

    // Fallback to product_name from products table if it's not in delivery_note_items
    const items = result.rows.map(item => ({
        ...item,
        product_name: item.product_name || item.product_name_from_db || 'Bilinmeyen Ürün'
    }));

    res.json({ success: true, items: items });
  } catch (error) {
    console.error(`Delivery note items API hatası (ID: ${req.params.id}):`, error);
    res.status(500).json({ success: false, error: error.message });
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
             u_signer.full_name as signer_name,
             o.order_number,
             u_creator.full_name as created_by_name
      FROM delivery_notes dn
      LEFT JOIN customers c ON dn.customer_id = c.id
      LEFT JOIN orders o ON dn.order_id = o.id
      LEFT JOIN users u_signer ON dn.delivered_by = u_signer.id
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
                <h3>MARUPAK</h3>
                <p>Adres: Türkoba Mah.Eski Çatalca Yolu cd.No:5 Büyükçekmece/İstanbul</p>
                <p>Telefon: +90 212 346 84 90 | Email: info@marupak.com</p>
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
                            <td>${item.product_name || 'Ürün Adı Bilinmiyor'}</td>
                            <td>${item.quantity}</td>
                            <td>${item.unit || 'adet'}</td>
                        </tr>
                    `).join('')}
                </tbody>
            </table>
            <div class="signature-section">
                <h3>Teslimat Onayı</h3>
                <div class="signature-section">
                    <div class="signature-box">
                        <p><strong>Teslim Alındı</strong></p>
                        <p>Tarih: ${new Date(delivery.delivery_date).toLocaleDateString('tr-TR')}</p>
                        <p>Teslim Alan: ________________</p>
                        <p>İmza: ________________</p>
                    </div>
                </div>
            </div>
            
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
app.put("/api/delivery-notes/:id/sign", authenticateToken, checkPermission('delivery.update'), async (req, res) => {
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

    const updatedDeliveryNote = result.rows[0];

    // İlgili siparişin durumunu da 'delivered' olarak güncelle
    if (updatedDeliveryNote.order_id) {
        try {
            await pool.query(
                `UPDATE orders SET status = 'delivered', updated_at = CURRENT_TIMESTAMP WHERE id = $1`,
                [updatedDeliveryNote.order_id]
            );
            console.log(`✅ Sipariş durumu (ID: ${updatedDeliveryNote.order_id}) 'delivered' olarak güncellendi.`);
        } catch (orderUpdateError) {
            console.error(`Sipariş durumu güncellenirken hata (ID: ${updatedDeliveryNote.order_id}):`, orderUpdateError.message);
        }
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

// ---------------- RANDEVU/GÖREV API ---------------- //
app.get("/api/appointments", authenticateToken, checkPermission('appointments.read'), async (req, res) => {
  try {
    const { type, status, assigned_to, customer_id, start_date, end_date } = req.query;
    const { userId, role, permissions } = req.user;

    let query = `
      SELECT a.id, a.title, a.description, a.type, a.priority, a.start_date, a.start_time, a.status,
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

    if (start_date && end_date) {
      whereClauses.push(`a.start_date BETWEEN $${params.push(start_date)} AND $${params.push(end_date)}`);
    } else if (start_date) {
      whereClauses.push(`a.start_date = $${params.push(start_date)}`);
    }

    // Yetkiye göre filtrele
    const appointmentPerms = permissions.appointments || [];
    if (appointmentPerms.includes('read_own') && !appointmentPerms.includes('read') && !permissions.all) {
        whereClauses.push(`a.assigned_to = $${params.push(userId)}`);
    } else if (assigned_to) { // Yönetici/Admin belirli bir kullanıcıyı filtreleyebilir
      whereClauses.push(`a.assigned_to = $${params.push(parseInt(assigned_to))}`);
    }

    if (whereClauses.length > 0) {
      query += ` WHERE ${whereClauses.join(' AND ')}`;
    }
    query += ` ORDER BY a.start_date ASC, a.start_time ASC`;
    const result = await pool.query(query, params);

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
app.get("/api/appointments/:id", authenticateToken, checkPermission('appointments.read'), async (req, res) => {
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
app.post("/api/appointments", authenticateToken, checkPermission('appointments.create'), async (req, res) => {
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
app.put("/api/appointments/:id", authenticateToken, checkPermission('appointments.update'), async (req, res) => {
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
app.post("/api/appointments/:id/complete", authenticateToken, checkPermission('appointments.update'), async (req, res) => {
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
app.delete("/api/appointments/:id", authenticateToken, checkPermission('appointments.delete'), async (req, res) => {
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

// ---------------- MUHASEBE API ---------------- //
app.get("/api/accounting/summary", authenticateToken, checkPermission('accounting.read'), async (req, res) => {
  try {
    const result = await pool.query(`
      SELECT
        c.id as customer_id,
        c.company_name,
        c.contact_person,
        COALESCE(SUM(CASE WHEN at.transaction_type = 'debit' OR at.transaction_type = 'invoice' THEN at.amount ELSE 0 END), 0) as total_debit,
        COALESCE(SUM(CASE WHEN at.transaction_type = 'credit' OR at.transaction_type = 'payment' THEN at.amount ELSE 0 END), 0) as total_credit
      FROM customers c
      LEFT JOIN account_transactions at ON c.id = at.customer_id
      GROUP BY c.id, c.company_name, c.contact_person
      ORDER BY c.company_name
    `);

    const summary = result.rows.map(row => ({
      ...row,
      balance: parseFloat(row.total_debit) - parseFloat(row.total_credit)
    }));

    res.json({ success: true, summary: summary });
  } catch (error) {
    console.error('Accounting summary API hatası:', error);
    res.status(500).json({ success: false, error: error.message });
  }
});

// Müşteri Cari Hesap Hareketleri
app.get("/api/accounting/history/:customerId", authenticateToken, checkPermission('accounting.read'), async (req, res) => {
  try {
    const { customerId } = req.params;
    const result = await pool.query(`
      SELECT * FROM account_transactions
      WHERE customer_id = $1
      ORDER BY transaction_date DESC, created_at DESC
    `, [customerId]);

    res.json({ success: true, history: result.rows });
  } catch (error) {
    console.error('Accounting history API hatası:', error);
    res.status(500).json({ success: false, error: error.message });
  }
});

app.get("/api/visits", authenticateToken, checkPermission('visits.read'), async (req, res) => {
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

// ---------------- ZİYARETLER API ---------------- //
app.post("/api/visits", authenticateToken, async (req, res) => {
  const client = await pool.connect();
  try {
    await client.query('BEGIN');

    // UYARI: Bu tablo oluşturma işlemi migration dosyasına taşınmalıdır.
    await client.query(`
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
    const { customer_id, visit_type, result, notes, next_contact_date, visit_date } = req.body;
    const sales_rep_id = req.user.userId;
    console.log('📝 Yeni ziyaret kaydı:', req.body);

    const newVisit = await client.query(
      `INSERT INTO customer_visits (customer_id, sales_rep_id, visit_date, visit_type, result, notes, next_contact_date)
       VALUES ($1, $2, $3, $4, $5, $6, $7)
       RETURNING *`,
      [customer_id, sales_rep_id, visit_date, visit_type, result, notes, next_contact_date || null]
    );

    // Müşteri durumunu güncelle
    let newStatus = 'potential'; // Varsayılan
    if (result === 'sale' || result === 'positive') {
        newStatus = 'active';
    } else if (result === 'not_interested' || result === 'negative') {
        newStatus = 'not_interested';
    }

    await client.query(
        'UPDATE customers SET customer_status = $1 WHERE id = $2',
        [newStatus, customer_id]
    );

    await client.query('COMMIT');
    res.status(201).json({
      success: true,
      visit: newVisit.rows[0]
    });
  } catch (error)
  {
    await client.query('ROLLBACK');
    console.error('Visit create hatası:', error);
    res.status(500).json({ success: false, error: error.message });
  } finally {
    client.release();
  }
});
// ---------------- MÜŞTERİLER API ---------------- //
app.get("/api/customers", authenticateToken, checkPermission('customers.read'), async (req, res) => {
  try {
    console.log('🏢 Customers API çağrıldı');

    const tableCheck = await pool.query(`
      SELECT EXISTS (
        SELECT FROM information_schema.tables WHERE table_schema = 'public' AND table_name = 'customers'
      );
    `);

    if (!tableCheck.rows[0].exists) {
      return res.json({
        success: true,
        customers: [],
        message: 'Customers tablosu henüz oluşturulmamış'
      });
    }

    const { userId, permissions } = req.user;
    const { north, south, east, west } = req.query;

    let query = `
      SELECT c.*,
             COALESCE(u.full_name, 'Atanmamış') as sales_rep_name
      FROM customers c
      LEFT JOIN users u ON c.assigned_sales_rep = u.id
    `;
    const params = [];
    const whereClauses = [];
    
    const customerPerms = permissions.customers || [];
    if (customerPerms.includes('read_own') && !customerPerms.includes('read') && !permissions.all) {
      whereClauses.push(`c.assigned_sales_rep = $${params.length + 1}`);
      params.push(userId);
    }

    if (north && south && east && west) {
        whereClauses.push(`c.latitude IS NOT NULL AND c.longitude IS NOT NULL`);
        whereClauses.push(`c.latitude <= $${params.length + 1}`);
        params.push(parseFloat(north));
        whereClauses.push(`c.latitude >= $${params.length + 1}`);
        params.push(parseFloat(south));
        whereClauses.push(`c.longitude <= $${params.length + 1}`);
        params.push(parseFloat(east));
        whereClauses.push(`c.longitude >= $${params.length + 1}`);
        params.push(parseFloat(west));
    }

    if (whereClauses.length > 0) {
        query += ` WHERE ${whereClauses.join(' AND ')}`;
    }

    query += ` ORDER BY c.created_at DESC`;

    const result = await pool.query(query, params);

    res.json({ success: true, customers: result.rows });
  } catch (error) {
    console.error('❌ Customers API hatası:', error);
    res.status(500).json({ success: false, error: error.message });
  }
});

app.post("/api/customers", authenticateToken, checkPermission('customers.create'), async (req, res) => {
  try {
    const { company_name, contact_person, phone, mobile_phone, email, address, assigned_sales_rep, latitude, longitude, customer_status } = req.body;
    const finalLatitude = latitude === '' ? null : latitude;
    const finalLongitude = longitude === '' ? null : longitude;
    let validSalesRepId = null;
    if (assigned_sales_rep) {
      const userCheck = await pool.query('SELECT id FROM users WHERE id = $1', [assigned_sales_rep]);
      if (userCheck.rows.length > 0) validSalesRepId = assigned_sales_rep;
    }
    if (!validSalesRepId) validSalesRepId = req.user.userId;
    const result = await pool.query(`
      INSERT INTO customers (company_name, contact_person, phone, mobile_phone, email, address, assigned_sales_rep, latitude, longitude, customer_status)
      VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10) RETURNING *
    `, [company_name, contact_person, phone, mobile_phone, email, address, validSalesRepId, finalLatitude, finalLongitude, customer_status || 'potential']);
    res.json({ success: true, customer: result.rows[0] });
  } catch (error) {
    console.error('Customer create hatası:', error);
    res.status(500).json({ success: false, error: error.message });
  }
});

// ---------------- FATURALAR API ---------------- //
app.get("/api/invoices", authenticateToken, checkPermission('accounting.read'), async (req, res) => {
  try {
    // Önce invoices tablosunun varlığını kontrol et
    const tableExists = await checkTableExists('invoices');
    
    if (!tableExists) {
      console.log('⚠️ Invoices tablosu bulunamadı. Lütfen migration çalıştırın.');
      return res.json({ success: true, invoices: [] });
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
app.post("/api/invoices/from-delivery", authenticateToken, checkPermission('accounting.create'), async (req, res) => {
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
app.post("/api/invoices/bulk-from-deliveries", authenticateToken, checkPermission('accounting.create'), async (req, res) => {
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
app.delete("/api/invoices/:id", authenticateToken, checkPermission('accounting.delete'), async (req, res) => {
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
app.post("/api/invoices/:id/payment", authenticateToken, checkPermission('accounting.update'), async (req, res) => {
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

// ---------------- SİPARİŞLER API ---------------- //
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

// Sipariş kalemini güncelle (üretim için)
app.put("/api/order-items/:itemId", authenticateToken, checkPermission('orders.update'), async (req, res) => {
    const client = await pool.connect();
    try {
        await client.query('BEGIN');
        const { itemId } = req.params;
        const { quantity } = req.body;

        if (isNaN(quantity) || quantity < 0) {
            return res.status(400).json({ success: false, error: 'Geçersiz miktar' });
        }

        // 1. Get order_id before any modification
        const itemResult = await client.query('SELECT order_id FROM order_items WHERE id = $1', [itemId]);
        if (itemResult.rows.length === 0) {
            throw new Error('Sipariş kalemi bulunamadı');
        }
        const { order_id } = itemResult.rows[0];

        // 2. Update or delete the item
        if (quantity == 0) {
            await client.query('DELETE FROM order_items WHERE id = $1', [itemId]);
        } else {
            await client.query(
                `UPDATE order_items 
                 SET quantity = $1, total_price = unit_price * $1 
                 WHERE id = $2`,
                [quantity, itemId]
            );
        }

        // 3. Recalculate the total amount for the order
        const totalResult = await client.query(
            `SELECT COALESCE(SUM(total_price), 0) as new_total FROM order_items WHERE order_id = $1`,
            [order_id]
        );
        const newTotalAmount = totalResult.rows[0].new_total;

        // 4. Update the order's total amount
        await client.query(
            `UPDATE orders SET total_amount = $1, updated_at = CURRENT_TIMESTAMP WHERE id = $2`,
            [newTotalAmount, order_id]
        );

        await client.query('COMMIT');
        res.json({ success: true, message: 'Sipariş kalemi güncellendi' });

    } catch (error) {
        await client.query('ROLLBACK');
        console.error('Order item update error:', error);
        res.status(500).json({ success: false, error: error.message });
    } finally {
        client.release();
    }
});

// Üretimi tamamla
app.put("/api/orders/:id/production-complete", authenticateToken, checkPermission('orders.update'), async (req, res) => {
    try {
        const { id } = req.params;
        const result = await pool.query(
            `UPDATE orders SET status = 'production_ready', updated_at = CURRENT_TIMESTAMP WHERE id = $1 RETURNING *`,
            [id]
        );

        if (result.rows.length === 0) {
            return res.status(404).json({ success: false, error: 'Sipariş bulunamadı' });
        }

        res.json({ success: true, message: 'Üretim tamamlandı, sipariş sevkiyata hazır.', order: result.rows[0] });
    } catch (error) {
        console.error('Production complete error:', error);
        res.status(500).json({ success: false, error: error.message });
    }
});
// Siparişten irsaliye oluştur
app.post("/api/delivery-notes/from-order/:orderId", authenticateToken, checkPermission('delivery.create'), async (req, res) => {
    const client = await pool.connect();
    try {
        await client.query('BEGIN');
        const { orderId } = req.params;

        const orderResult = await client.query('SELECT * FROM orders WHERE id = $1', [orderId]);
        if (orderResult.rows.length === 0) throw new Error('Sipariş bulunamadı');
        const order = orderResult.rows[0];

        const now = new Date();
        const deliveryNumber = `IRS${now.getFullYear().toString().slice(-2)}${(now.getMonth() + 1).toString().padStart(2, '0')}${now.getDate().toString().padStart(2, '0')}${now.getHours()}${now.getMinutes()}${now.getSeconds()}`;

        const deliveryNoteResult = await client.query(`INSERT INTO delivery_notes (delivery_number, order_id, customer_id, delivery_date, delivery_address, status, created_by) VALUES ($1, $2, $3, $4, (SELECT address FROM customers WHERE id = $3), 'pending', $5) RETURNING id`, [deliveryNumber, order.id, order.customer_id, new Date(), req.user.userId]);
        const newDeliveryNoteId = deliveryNoteResult.rows[0].id;

        const orderItemsResult = await client.query('SELECT * FROM order_items WHERE order_id = $1', [orderId]);
        if (orderItemsResult.rows.length === 0) throw new Error('Siparişte hiç ürün kalemi bulunamadı.');

        for (const item of orderItemsResult.rows) {
            await client.query(`INSERT INTO delivery_note_items (delivery_note_id, product_id, product_name, quantity, unit_price, total_price, unit) VALUES ($1, $2, $3, $4, $5, $6, $7)`, [newDeliveryNoteId, item.product_id, item.product_name, item.quantity, item.unit_price, item.total_price, item.unit]);
        }

        await client.query(`UPDATE orders SET status = 'shipping', updated_at = CURRENT_TIMESTAMP WHERE id = $1`, [orderId]);

        await client.query('COMMIT');
        res.status(201).json({ success: true, message: 'İrsaliye başarıyla oluşturuldu.', deliveryNoteNumber: deliveryNumber, deliveryNoteId: newDeliveryNoteId });
    } catch (error) {
        await client.query('ROLLBACK');
        console.error('Delivery note from order creation error:', error);
        res.status(500).json({ success: false, error: error.message });
    } finally {
        client.release();
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
        const deliveryNoteResult = await client.query(`
          INSERT INTO delivery_notes (
            delivery_number, order_id, customer_id, delivery_date,
            delivery_address, status, created_by, delivered_by
          ) VALUES ($1, $2, $3, $4, $5, 'pending', $6, $7) RETURNING id
        `, [
          deliveryNumber,
          id,
          updatedOrder.customer_id,
          updatedOrder.delivery_date || new Date(),
          deliveryAddress,
          req.user.userId,
          deliveryPersonId
        ]);
        const newDeliveryNoteId = deliveryNoteResult.rows[0].id;
        console.log(`✅ Sipariş ${id} için otomatik irsaliye oluşturuldu. ID: ${newDeliveryNoteId}`);

        // Sipariş kalemlerini irsaliye kalemlerine kopyala
        const orderItemsResult = await client.query('SELECT * FROM order_items WHERE order_id = $1', [id]);
        for (const item of orderItemsResult.rows) {
            await client.query(`
                INSERT INTO delivery_note_items (delivery_note_id, product_id, product_name, quantity, unit_price, total_price, unit)
                VALUES ($1, $2, $3, $4, $5, $6, $7)
            `, [newDeliveryNoteId, item.product_id, item.product_name, item.quantity, item.unit_price, item.total_price, item.unit]);
        }
        console.log(`✅ ${orderItemsResult.rows.length} kalem irsaliyeye kopyalandı.`);
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

// Müşteri güncelle
app.put("/api/customers/:id", authenticateToken, checkPermission('customers.update'), async (req, res) => {
  try {
    const { id } = req.params;
    const { company_name, contact_person, phone, mobile_phone, email, address, assigned_sales_rep, latitude, longitude } = req.body;

    // Gelen boş string'leri veritabanı için NULL'a çevir
    const finalLatitude = latitude === '' ? null : latitude;
    const finalLongitude = longitude === '' ? null : longitude;

    const result = await pool.query(`
      UPDATE customers SET
        company_name = $1,
        contact_person = $2,
        phone = $3,
        mobile_phone = $4,
        email = $5,
        address = $6,
        assigned_sales_rep = $7,
        latitude = $8,
        longitude = $9,
        updated_at = CURRENT_TIMESTAMP
      WHERE id = $10
      RETURNING *
    `, [company_name, contact_person, phone, mobile_phone, email, address, assigned_sales_rep, finalLatitude, finalLongitude, id]);

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
app.get("/api/sales/dashboard/:userId", authenticateToken, async (req, res) => {
    try {
        const requestedUserId = parseInt(req.params.userId, 10);
        const { userId: loggedInUserId, role: loggedInUserRole } = req.user;

        // Admin ve Satış Müdürü herkesin dashboard'unu görebilir.
        // Diğer kullanıcılar (örn. Satış Personeli) sadece kendininkini görebilir.
        // Rol adı 'Yönetici' olarak düzeltildi.
        const canViewAll = loggedInUserRole === 'Yönetici' || loggedInUserRole === 'Satış Müdürü';

        if (!canViewAll && loggedInUserId !== requestedUserId) {
            return res.status(403).json({ success: false, error: 'Bu dashboardı görüntüleme yetkiniz yok.' });
        }

        const userId = requestedUserId;
        const currentYear = new Date().getFullYear();
        const currentMonth = new Date().getMonth() + 1;

        // 1. Get user targets
        const targetsResult = await pool.query(`
            SELECT * FROM user_targets 
            WHERE user_id = $1 AND target_year = $2 AND target_month = $3
        `, [userId, currentYear, currentMonth]);
        const targets = targetsResult.rows[0] || {};

        // 2. Get user sales for the month and parse safely
        const salesResult = await pool.query(`
            SELECT COALESCE(SUM(total_amount), 0) as total 
            FROM orders 
            WHERE sales_rep_id = $1 
              AND status NOT IN ('cancelled', 'iptal') -- İptal edilen siparişleri hariç tut
              AND EXTRACT(YEAR FROM order_date) = $2 
              AND EXTRACT(MONTH FROM order_date) = $3
        `, [userId, currentYear, currentMonth]);
        const currentMonthlySales = parseFloat(salesResult.rows[0]?.total || 0);

        // 3. Get user visits for the month and parse safely
        const visitsResult = await pool.query(`
            SELECT COUNT(*) as count
            FROM customer_visits
            WHERE sales_rep_id = $1
              AND EXTRACT(YEAR FROM visit_date) = $2
              AND EXTRACT(MONTH FROM visit_date) = $3
        `, [userId, currentYear, currentMonth]);
        const currentMonthlyVisits = parseInt(visitsResult.rows[0]?.count || 0);

        // 4. Get user collections for the month and parse safely
        const collectionsResult = await pool.query(`
            SELECT COALESCE(SUM(at.amount), 0) as total
            FROM account_transactions at
            JOIN customers c ON at.customer_id = c.id
            WHERE c.assigned_sales_rep = $1
              AND at.transaction_type = 'credit'
              AND EXTRACT(YEAR FROM at.transaction_date) = $2
              AND EXTRACT(MONTH FROM at.transaction_date) = $3
        `, [userId, currentYear, currentMonth]);
        const currentMonthlyCollection = parseFloat(collectionsResult.rows[0]?.total || 0);

        res.json({
            success: true,
            stats: {
                monthlySalesTarget: parseFloat(targets.sales_target || 0),
                currentMonthlySales: currentMonthlySales,
                monthlyVisitTarget: parseInt(targets.visit_target || 0),
                currentMonthlyVisits: currentMonthlyVisits,
                monthlyCollectionTarget: parseFloat(targets.collection_target || 0),
                currentMonthlyCollection: currentMonthlyCollection,
            }
        });

    } catch (error) {
        console.error(`Sales dashboard stats error for user ${req.params.userId}:`, error);
        res.status(500).json({ success: false, error: error.message });
    }
});

// Üretim personeli dashboard stats
app.get("/api/production/dashboard/:userId", authenticateToken, async (req, res) => {
    try {
        const requestedUserId = parseInt(req.params.userId, 10);
        const { userId: loggedInUserId, role: loggedInUserRole } = req.user;

        const canViewAll = ['Yönetici', 'Üretim Müdürü'].includes(loggedInUserRole);
        if (!canViewAll && loggedInUserId !== requestedUserId) {
            return res.status(403).json({ success: false, error: 'Bu dashboardı görüntüleme yetkiniz yok.' });
        }

        const userId = requestedUserId;
        const currentYear = new Date().getFullYear();
        const currentMonth = new Date().getMonth() + 1;

        // Hedefler
        const targetsResult = await pool.query(`
            SELECT production_target FROM user_targets 
            WHERE user_id = $1 AND target_year = $2 AND target_month = $3
        `, [userId, currentYear, currentMonth]);
        const productionTarget = parseInt(targetsResult.rows[0]?.production_target) || 0;

        // Gerçekleşen üretim (tamamlanan siparişler)
        const achievedResult = await pool.query(`
            SELECT COUNT(*) as count FROM orders WHERE status = 'completed'
        `);
        const productionAchieved = parseInt(achievedResult.rows[0].count);

        // Sipariş durumları
        const orderStatusResult = await pool.query(`SELECT status, COUNT(*) as count FROM orders GROUP BY status`);
        const orderStatuses = orderStatusResult.rows.reduce((acc, row) => {
            if (row.status) acc[row.status] = parseInt(row.count);
            return acc;
        }, {});

        res.json({
            success: true,
            stats: {
                productionTarget,
                productionAchieved,
                pendingOrders: orderStatuses.pending || 0,
                productionOrders: orderStatuses.production || 0,
                completedOrders: orderStatuses.completed || 0,
                readyForDelivery: orderStatuses.ready_for_delivery || 0,
            }
        });
    } catch (error) {
        console.error(`Production dashboard stats error for user ${req.params.userId}:`, error);
        res.status(500).json({ success: false, error: error.message });
    }
});

// Sevkiyat personeli dashboard stats
app.get("/api/shipping/dashboard/:userId", authenticateToken, async (req, res) => {
    try {
        const requestedUserId = parseInt(req.params.userId, 10);
        const { userId: loggedInUserId, role: loggedInUserRole } = req.user;

        const canViewAll = ['Yönetici', 'Sevkiyat Sorumlusu'].includes(loggedInUserRole);
        if (!canViewAll && loggedInUserId !== requestedUserId) {
            return res.status(403).json({ success: false, error: 'Bu dashboardı görüntüleme yetkiniz yok.' });
        }

        const userId = requestedUserId;
        const currentYear = new Date().getFullYear();
        const currentMonth = new Date().getMonth() + 1;

        // Hedefler
        const targetsResult = await pool.query(`
            SELECT shipping_target FROM user_targets 
            WHERE user_id = $1 AND target_year = $2 AND target_month = $3
        `, [userId, currentYear, currentMonth]);
        const shippingTarget = parseInt(targetsResult.rows[0]?.shipping_target) || 0;

        // Gerçekleşen sevkiyat (teslim edilen irsaliyeler)
        const achievedResult = await pool.query(`
            SELECT COUNT(*) as count FROM delivery_notes WHERE delivered_by = $1 AND status = 'delivered'
        `, [userId]);
        const shippingAchieved = parseInt(achievedResult.rows[0].count);

        // İrsaliye durumları
        const deliveryStatusResult = await pool.query(`SELECT status, COUNT(*) as count FROM delivery_notes GROUP BY status`);
        const deliveryStatuses = deliveryStatusResult.rows.reduce((acc, row) => {
            if (row.status) acc[row.status] = parseInt(row.count);
            return acc;
        }, {});

        res.json({
            success: true,
            stats: {
                shippingTarget,
                shippingAchieved,
                pendingDeliveries: deliveryStatuses.pending || 0,
                inTransitDeliveries: deliveryStatuses.in_transit || 0,
                completedDeliveries: deliveryStatuses.delivered || 0,
            }
        });
    } catch (error) {
        console.error(`Shipping dashboard stats error for user ${req.params.userId}:`, error);
        res.status(500).json({ success: false, error: error.message });
    }
});

// Muhasebe dashboard stats
app.get("/api/accounting/dashboard/:userId", authenticateToken, async (req, res) => {
    try {
        const summaryResult = await pool.query(`
            SELECT
                COALESCE(SUM(CASE WHEN transaction_type = 'debit' THEN amount ELSE 0 END), 0) as total_debit,
                COALESCE(SUM(CASE WHEN transaction_type = 'credit' THEN amount ELSE 0 END), 0) as total_credit
            FROM account_transactions
        `);
        const summary = summaryResult.rows[0];
        const balance = parseFloat(summary.total_debit) - parseFloat(summary.total_credit);

        res.json({ success: true, stats: { ...summary, balance } });
    } catch (error) {
        console.error(`Accounting dashboard stats error:`, error);
        res.status(500).json({ success: false, error: error.message });
    }
});

// Admin dashboard stats
app.get("/api/dashboard/stats", authenticateToken, async (req, res) => {
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
        const orderStatusResult = await pool.query(`SELECT status, COUNT(*) as count FROM orders GROUP BY status`);
        const orderStatuses = orderStatusResult.rows.reduce((acc, row) => {
            if (row.status) acc[row.status] = parseInt(row.count);
            return acc;
        }, {});
        stats.pendingOrders = orderStatuses.pending || 0;
        stats.productionOrders = orderStatuses.production || 0;
        stats.completedOrders = orderStatuses.completed || 0;
        stats.deliveredOrders = orderStatuses.delivered || 0;

        // --- HEDEFLER VE GERÇEKLEŞMELER ---

        // 1. Bu ay için toplam hedefleri al
        const targetsResult = await pool.query(`
            SELECT 
                COALESCE(SUM(sales_target), 0) as monthlySalesTarget,
                COALESCE(SUM(visit_target), 0) as monthlyVisitTarget,
                COALESCE(SUM(collection_target), 0) as monthlyCollectionTarget
            FROM user_targets
            WHERE target_year = $1 AND target_month = $2
        `, [currentYear, currentMonth]);
        
        const monthlyTargets = targetsResult.rows[0] || {};
        stats.monthlySalesTarget = parseFloat(monthlyTargets.monthlysalestarget);
        stats.monthlyVisitTarget = parseInt(monthlyTargets.monthlyvisittarget);
        stats.monthlyCollectionTarget = parseFloat(monthlyTargets.monthlycollectiontarget);

        // 2. Bu ay için gerçekleşen değerleri al
        const realizedValues = await Promise.all([
            // Gerçekleşen Satış
            pool.query(`SELECT COALESCE(SUM(total_amount), 0) as total FROM orders WHERE status NOT IN ('cancelled', 'iptal') AND EXTRACT(YEAR FROM order_date) = $1 AND EXTRACT(MONTH FROM order_date) = $2`, [currentYear, currentMonth]),
            // Gerçekleşen Ziyaret
            pool.query(`SELECT COUNT(*) as count FROM customer_visits WHERE EXTRACT(YEAR FROM visit_date) = $1 AND EXTRACT(MONTH FROM visit_date) = $2`, [currentYear, currentMonth]),
            // Gerçekleşen Tahsilat
            pool.query(`SELECT COALESCE(SUM(amount), 0) as total FROM account_transactions WHERE transaction_type = 'credit' AND EXTRACT(YEAR FROM transaction_date) = $1 AND EXTRACT(MONTH FROM transaction_date) = $2`, [currentYear, currentMonth])
        ]);

        stats.currentMonthlySales = parseFloat(realizedValues[0].rows[0].total);
        stats.currentMonthlyVisits = parseInt(realizedValues[1].rows[0].count);
        stats.currentMonthlyCollection = parseFloat(realizedValues[2].rows[0].total);

        res.json({ success: true, stats: stats });
    } catch (error) {
        console.error('Admin Dashboard stats API hatası:', error);
        res.status(500).json({ success: false, error: error.message, stats: {} });
    }
});

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
    
    // Eğer teslimat tarihi boş gelirse, veritabanına NULL olarak kaydet.
    const finalDeliveryDate = delivery_date || null;

    const result = await pool.query(`
      INSERT INTO orders (order_number, customer_id, sales_rep_id, order_date, delivery_date, total_amount, notes, status)
      VALUES ($1, $2, $3, $4, $5, $6, $7, 'pending')
      RETURNING *
    `, [orderNum, customer_id, sales_rep_id, order_date, finalDeliveryDate, parseFloat(total_amount), notes]);
    
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

// ---------------- MAIL API ---------------- //
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

// ---------------- DASHBOARD API ---------------- //
app.get("/api/dashboard/monthly-sales", authenticateToken, async (req, res) => {
    try {
        const currentYear = new Date().getFullYear();
        const currentMonth = new Date().getMonth() + 1;
        const salesResult = await pool.query(`
            SELECT COALESCE(SUM(total_amount), 0) as monthlySales 
            FROM orders 
            WHERE EXTRACT(YEAR FROM order_date) = $1 AND EXTRACT(MONTH FROM order_date) = $2
        `, [currentYear, currentMonth]);
        const monthlySales = parseFloat(salesResult.rows[0].monthlysales) || 0;
        let monthlyTarget = 0;
        const tableExists = await checkTableExists('user_targets');
        if (tableExists) {
            const targetResult = await pool.query(`
                SELECT COALESCE(SUM(sales_target), 0) as totalTarget
                FROM user_targets
                WHERE target_year = $1 AND target_month = $2
            `, [currentYear, currentMonth]);
            monthlyTarget = parseFloat(targetResult.rows[0].totaltarget) || 0;
        }
        res.json({ success: true, monthlySales: monthlySales, target: monthlyTarget });
    } catch (error) {
        console.error('Monthly sales hatası:', error);
        res.status(500).json({ success: false, monthlySales: 0, target: 0, error: error.message });
    }
});

app.get("/api/dashboard/customer-status", authenticateToken, async (req, res) => {
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
    res.status(500).json({ success: false, active: 0, potential: 0, inactive: 0 });
  }
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
