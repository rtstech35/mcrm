require("dotenv").config();
const { Pool } = require("pg");
const fs = require("fs");
const path = require("path");
const bcrypt = require("bcryptjs");

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
    const tablesToDrop = [
        'account_transactions', 'delivery_note_items', 'delivery_notes', 'customer_visits', 
        'order_items', 'orders', 'products', 'user_targets', 'appointments', 
        'appointment_participants', 'users', 'customers', 'departments', 'roles'
    ];

    for (const table of tablesToDrop) {
      try {
        await pool.query(`DROP TABLE IF EXISTS ${table} CASCADE`);
        console.log(`✅ ${table} tablosu silindi`);
      } catch (error) {
        console.log(`⚠️ ${table} tablosu zaten yok veya silinemedi`);
      }
    }

    // Schema'yı çalıştır
    console.log("📋 Database schema oluşturuluyor...");
    await pool.query(schemaSQL);
    console.log("✅ Database schema başarıyla oluşturuldu");

    // Test kullanıcılarını ekle
    console.log("📝 Test kullanıcıları ekleniyor...");
    
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
        await pool.query(`
            INSERT INTO users (username, email, password_hash, full_name, role_id, department_id, is_active) VALUES 
            ($1, $2, $3, $4, $5, $6, true)
            ON CONFLICT (username) DO NOTHING
        `, [user.username, user.email, hashedPassword, user.full_name, user.role_id, user.department_id]);
    }

    console.log(`✅ ${testUsers.length} test kullanıcısı başarıyla eklendi`);
    console.log("🎉 Database setup tamamlandı!");
    console.log("📧 Admin kullanıcısı: admin / admin123");
    console.log("🔑 Diğer kullanıcıların şifresi: 123456");

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