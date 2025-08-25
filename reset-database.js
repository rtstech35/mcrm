require("dotenv").config();
const { Pool } = require("pg");

async function resetDatabase() {
  console.log("🗑️ Database reset başlatılıyor...");
  
  // Database bağlantısı
  const pool = new Pool({
    connectionString: process.env.DATABASE_URL,
    ssl: { rejectUnauthorized: false },
  });

  try {
    // Bağlantıyı test et
    await pool.connect();
    console.log("✅ Database bağlantısı başarılı");

    // Tüm tabloları sil
    console.log("🗑️ Mevcut tablolar siliniyor...");
    
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

    console.log("✅ Tüm tablolar silindi");

    // Setup script'ini çalıştır
    console.log("🔄 Database yeniden kuruluyor...");
    const setupDatabase = require("./setup-database");
    await setupDatabase();

    console.log("🎉 Database başarıyla sıfırlandı ve yeniden kuruldu!");
    console.log("📧 Admin kullanıcısı: admin / admin123");

  } catch (error) {
    console.error("❌ Database reset hatası:", error);
    throw error;
  } finally {
    await pool.end();
  }
}

// Script doğrudan çalıştırılırsa
if (require.main === module) {
  resetDatabase()
    .then(() => {
      console.log("✅ Reset başarıyla tamamlandı");
      process.exit(0);
    })
    .catch((error) => {
      console.error("❌ Reset başarısız:", error);
      process.exit(1);
    });
}

module.exports = resetDatabase;
