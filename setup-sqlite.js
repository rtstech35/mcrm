const sqlite3 = require('sqlite3').verbose();
const fs = require('fs');
const path = require('path');
const bcrypt = require('bcryptjs');

const dbPath = path.join(__dirname, 'database', 'saha_crm.db');

async function setupDatabase() {
  return new Promise((resolve, reject) => {
    const db = new sqlite3.Database(dbPath, async (err) => {
      if (err) {
        reject(err);
        return;
      }
      
      console.log('✅ SQLite veritabanı oluşturuldu');
      
      try {
        // Şemayı yükle
        const schema = fs.readFileSync('./database/schema-sqlite.sql', 'utf8');
        const statements = schema.split(';').filter(stmt => stmt.trim());
        
        for (const statement of statements) {
          if (statement.trim()) {
            await new Promise((resolve, reject) => {
              db.run(statement, (err) => {
                if (err) reject(err);
                else resolve();
              });
            });
          }
        }
        
        console.log('✅ Şema yüklendi');
        
        // Test kullanıcısı oluştur
        const hashedPassword = await bcrypt.hash('123456', 10);
        
        db.run(
          'INSERT OR IGNORE INTO users (username, email, password_hash, full_name, department_id, role_id) VALUES (?, ?, ?, ?, ?, ?)',
          ['admin', 'admin@test.com', hashedPassword, 'Test Admin', 1, 1],
          (err) => {
            if (err) {
              console.log('⚠️  Test kullanıcısı zaten mevcut');
            } else {
              console.log('✅ Test kullanıcısı oluşturuldu (admin/123456)');
            }
            
            db.close();
            console.log('\n🎉 SQLite kurulumu tamamlandı!');
            console.log('Sunucuyu başlatmak için: npm start');
            resolve();
          }
        );
        
      } catch (error) {
        reject(error);
      }
    });
  });
}

setupDatabase().catch(console.error);