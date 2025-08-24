const { Pool } = require('pg');
const fs = require('fs');
const bcrypt = require('bcryptjs');

// Veritabanı bağlantısı (veritabanı olmadan)
const adminPool = new Pool({
  host: 'localhost',
  port: 5432,
  user: 'postgres',
  password: 'password',
  database: 'postgres'
});

// Ana veritabanı bağlantısı
const pool = new Pool({
  host: 'localhost',
  port: 5432,
  user: 'postgres',
  password: 'password',
  database: 'saha_crm'
});

async function setupDatabase() {
  try {
    // Veritabanı oluştur
    console.log('Veritabanı oluşturuluyor...');
    await adminPool.query('CREATE DATABASE saha_crm');
    console.log('✅ Veritabanı oluşturuldu');
    
    // Şemayı yükle
    console.log('Şema yükleniyor...');
    const schema = fs.readFileSync('./database/schema.sql', 'utf8');
    await pool.query(schema);
    console.log('✅ Şema yüklendi');
    
    // Test kullanıcısı oluştur
    console.log('Test kullanıcısı oluşturuluyor...');
    const hashedPassword = await bcrypt.hash('123456', 10);
    await pool.query(
      'INSERT INTO users (username, email, password_hash, full_name, department_id, role_id) VALUES ($1, $2, $3, $4, $5, $6)',
      ['admin', 'admin@test.com', hashedPassword, 'Test Admin', 1, 1]
    );
    console.log('✅ Test kullanıcısı oluşturuldu (admin/123456)');
    
    console.log('\n🎉 Kurulum tamamlandı!');
    console.log('Sunucuyu başlatmak için: npm start');
    
  } catch (error) {
    if (error.code === '42P04') {
      console.log('⚠️  Veritabanı zaten mevcut, şema yükleniyor...');
      try {
        const schema = fs.readFileSync('./database/schema.sql', 'utf8');
        await pool.query(schema);
        console.log('✅ Şema güncellendi');
      } catch (schemaError) {
        console.log('⚠️  Şema zaten mevcut');
      }
    } else {
      console.error('❌ Hata:', error.message);
    }
  } finally {
    await adminPool.end();
    await pool.end();
  }
}

setupDatabase();