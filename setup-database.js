require("dotenv").config();
const { Pool } = require("pg");
const fs = require("fs");
const path = require("path");

async function setupDatabase() {
  console.log("🚀 Database setup başlatılıyor...");
  
  // Database bağlantısı
  const pool = new Pool({
    connectionString: process.env.DATABASE_URL,
    ssl: { rejectUnauthorized: false },
  });

  try {
    // Bağlantıyı test et
    await pool.connect();
    console.log("✅ Database bağlantısı başarılı");

    // Schema dosyasını oku
    const schemaPath = path.join(__dirname, "database", "schema.sql");
    const schemaSQL = fs.readFileSync(schemaPath, "utf8");

    // Schema'yı çalıştır (IF NOT EXISTS ile)
    console.log("📋 Database schema kontrol ediliyor...");
    try {
      await pool.query(schemaSQL);
      console.log("✅ Database schema başarıyla oluşturuldu");
    } catch (error) {
      if (error.code === '42P07') {
        console.log("✅ Database schema zaten mevcut, devam ediliyor...");
      } else {
        throw error;
      }
    }

    // Temel verileri ekle
    console.log("📝 Temel veriler ekleniyor...");
    
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

    console.log("✅ Temel veriler başarıyla eklendi");
    console.log("🎉 Database setup tamamlandı!");
    console.log("📧 Admin kullanıcısı: admin / admin123");

  } catch (error) {
    console.error("❌ Database setup hatası:", error);
    throw error;
  } finally {
    await pool.end();
  }
}

// Script doğrudan çalıştırılırsa
if (require.main === module) {
  setupDatabase()
    .then(() => {
      console.log("✅ Setup başarıyla tamamlandı");
      process.exit(0);
    })
    .catch((error) => {
      console.error("❌ Setup başarısız:", error);
      process.exit(1);
    });
}

module.exports = setupDatabase;