const sqlite3 = require('sqlite3').verbose();
const bcrypt = require('bcryptjs');
const path = require('path');

const dbPath = path.join(__dirname, 'database', 'saha_crm.db');
const db = new sqlite3.Database(dbPath);

async function addShippingUser() {
  try {
    const hashedPassword = await bcrypt.hash('123456', 10);
    
    db.run(
      'INSERT OR IGNORE INTO users (username, email, password_hash, full_name, department_id, role_id) VALUES (?, ?, ?, ?, ?, ?)',
      ['sevkiyat1', 'sevkiyat1@test.com', hashedPassword, 'Sevkiyat Personeli 1', 4, 4],
      function(err) {
        if (err) {
          console.error('Hata:', err.message);
        } else {
          console.log('✅ Sevkiyat kullanıcısı oluşturuldu (sevkiyat1/123456)');
        }
        db.close();
      }
    );
  } catch (error) {
    console.error('Hata:', error);
  }
}

addShippingUser();