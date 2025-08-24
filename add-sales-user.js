const sqlite3 = require('sqlite3').verbose();
const bcrypt = require('bcryptjs');
const path = require('path');

const dbPath = path.join(__dirname, 'database', 'saha_crm.db');
const db = new sqlite3.Database(dbPath);

async function addSalesUser() {
  try {
    const hashedPassword = await bcrypt.hash('123456', 10);
    
    db.run(
      'INSERT OR IGNORE INTO users (username, email, password_hash, full_name, department_id, role_id) VALUES (?, ?, ?, ?, ?, ?)',
      ['satis1', 'satis1@test.com', hashedPassword, 'Satış Temsilcisi 1', 2, 2],
      function(err) {
        if (err) {
          console.error('Hata:', err.message);
        } else {
          console.log('✅ Satış temsilcisi oluşturuldu (satis1/123456)');
        }
        db.close();
      }
    );
  } catch (error) {
    console.error('Hata:', error);
  }
}

addSalesUser();