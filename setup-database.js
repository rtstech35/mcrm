require("dotenv").config();
const { Pool } = require("pg");
const fs = require("fs");
const path = require("path");
const bcrypt = require("bcryptjs");

// ⚠️ DİKKAT: Bu script, veritabanındaki TÜM TABLOLARI SİLER ve yeniden oluşturur.
// Sadece geliştirme (development) ortamında ilk kurulum için kullanılmalıdır.
// Production (Render gibi) ortamında ASLA çalıştırılmamalıdır.
// Production ortamında veritabanı değişiklikleri için "migration" araçları kullanılmalıdır.

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

    // Örnek Müşteriler Ekle
    console.log("📝 Örnek müşteriler ekleniyor...");
    const sampleCustomers = [
        { name: 'ABC Teknoloji', person: 'Ahmet Yılmaz', phone: '05551112233', email: 'ahmet@abctek.com', address: 'Teknopark, İstanbul', rep: 2 },
        { name: 'XYZ İnşaat', person: 'Mehmet Kaya', phone: '05554445566', email: 'mehmet@xyzin.com', address: 'Maslak, İstanbul', rep: 3 },
        { name: 'Mavi Gıda Dağıtım', person: 'Ayşe Demir', phone: '05557778899', email: 'ayse@mavigida.com', address: 'Ataşehir, İstanbul', rep: 2 }
    ];
    for (const c of sampleCustomers) {
        await pool.query(`
            INSERT INTO customers (company_name, contact_person, phone, email, address, assigned_sales_rep, customer_status)
            VALUES ($1, $2, $3, $4, $5, $6, 'active')
            ON CONFLICT (company_name) DO NOTHING
        `, [c.name, c.person, c.phone, c.email, c.address, c.rep]);
    }
    console.log(`✅ ${sampleCustomers.length} örnek müşteri eklendi.`);

    // Örnek Ürünler Ekle
    console.log("📝 Örnek ürünler ekleniyor...");
    const sampleProducts = [
        { name: 'Endüstriyel Vana', code: 'VLV-001', desc: 'Yüksek basınçlı endüstriyel vana', cat: 'Makine Parçaları', price: 450.00, unit: 'adet', stock: 50 },
        { name: 'Çelik Boru', code: 'PIP-001', desc: 'Paslanmaz çelik boru (metre)', cat: 'İnşaat Malzemeleri', price: 120.50, unit: 'metre', stock: 200 },
        { name: 'Hidrolik Yağ', code: 'OIL-001', desc: 'Sentetik hidrolik sistem yağı', cat: 'Kimyasallar', price: 85.00, unit: 'litre', stock: 150 },
        { name: 'PLC Kontrol Ünitesi', code: 'PLC-001', desc: 'Programlanabilir lojik kontrolör', cat: 'Elektronik', price: 1800.00, unit: 'adet', stock: 20 },
        { name: 'Sanayi Tipi Tekerlek', code: 'WHL-001', desc: 'Ağır yükler için tekerlek', cat: 'Makine Parçaları', price: 75.00, unit: 'adet', stock: 100 }
    ];
    for (const p of sampleProducts) {
        const vatRate = 20;
        const priceWithVat = p.price * (1 + vatRate / 100);
        await pool.query(`
            INSERT INTO products (name, product_code, description, category, unit_price, vat_rate, price_with_vat, unit, stock_quantity, is_active)
            VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, true)
            ON CONFLICT (name) DO NOTHING
        `, [p.name, p.code, p.desc, p.cat, p.price, vatRate, priceWithVat, p.unit, p.stock]);
    }
    console.log(`✅ ${sampleProducts.length} örnek ürün eklendi.`);

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