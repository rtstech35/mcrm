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

    // Önce tüm tabloları sil (temiz başlangıç için)
    console.log("🗑️ Mevcut tablolar temizleniyor...");
    const dropQueries = [
      "DROP TABLE IF EXISTS account_transactions CASCADE",
      "DROP TABLE IF EXISTS delivery_notes CASCADE",
      "DROP TABLE IF EXISTS customer_visits CASCADE",
      "DROP TABLE IF EXISTS order_items CASCADE", 
      "DROP TABLE IF EXISTS orders CASCADE",
      "DROP TABLE IF EXISTS products CASCADE",
      "DROP TABLE IF EXISTS customers CASCADE",
      "DROP TABLE IF EXISTS users CASCADE",
      "DROP TABLE IF EXISTS departments CASCADE",
      "DROP TABLE IF EXISTS roles CASCADE"
    ];

    for (const query of dropQueries) {
      try {
        await pool.query(query);
        console.log(`✅ ${query.split(' ')[2]} tablosu silindi`);
      } catch (error) {
        console.log(`⚠️ ${query.split(' ')[2]} tablosu zaten yok`);
      }
    }

    // Schema'yı çalıştır
    console.log("📋 Database schema oluşturuluyor...");
    await pool.query(schemaSQL);
    console.log("✅ Database schema başarıyla oluşturuldu");

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