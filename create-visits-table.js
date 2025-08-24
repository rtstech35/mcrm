const sqlite3 = require('sqlite3').verbose();
const path = require('path');

const dbPath = path.join(__dirname, 'database', 'saha_crm.db');
const db = new sqlite3.Database(dbPath);

console.log('Visits tablosu oluşturuluyor...');

db.run(`
  CREATE TABLE IF NOT EXISTS visits (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    customer_id INTEGER NOT NULL,
    sales_rep_id INTEGER NOT NULL,
    visit_type TEXT NOT NULL,
    result TEXT NOT NULL,
    notes TEXT,
    interested_products TEXT,
    next_contact_date DATE,
    estimated_order_amount DECIMAL(10,2),
    visit_date DATETIME NOT NULL,
    created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
    FOREIGN KEY (customer_id) REFERENCES customers(id),
    FOREIGN KEY (sales_rep_id) REFERENCES users(id)
  )
`, (err) => {
  if (err) {
    console.error('Hata:', err.message);
  } else {
    console.log('✅ Visits tablosu oluşturuldu');
  }
  db.close();
});