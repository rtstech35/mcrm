const sqlite3 = require('sqlite3').verbose();
const path = require('path');

const dbPath = path.join(__dirname, 'database', 'saha_crm.db');
const db = new sqlite3.Database(dbPath);

console.log('Hedefler tablosu oluşturuluyor...');

db.run(`
  CREATE TABLE IF NOT EXISTS user_targets (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    user_id INTEGER NOT NULL,
    target_type TEXT NOT NULL, -- 'sales', 'visits', 'production', 'shipping'
    target_value INTEGER NOT NULL,
    target_month TEXT NOT NULL, -- 'YYYY-MM' format
    created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
    updated_at DATETIME DEFAULT CURRENT_TIMESTAMP,
    FOREIGN KEY (user_id) REFERENCES users(id),
    UNIQUE(user_id, target_type, target_month)
  )
`, (err) => {
  if (err) {
    console.error('Hata:', err.message);
  } else {
    console.log('✅ User targets tablosu oluşturuldu');
  }
  db.close();
});