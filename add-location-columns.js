const sqlite3 = require('sqlite3').verbose();
const path = require('path');

const dbPath = path.join(__dirname, 'database', 'saha_crm.db');
const db = new sqlite3.Database(dbPath);

console.log('Konum sütunları ekleniyor...');

db.run('ALTER TABLE customers ADD COLUMN latitude REAL', (err) => {
  if (err && !err.message.includes('duplicate column')) {
    console.error('Latitude sütunu eklenemedi:', err.message);
  } else {
    console.log('✅ Latitude sütunu eklendi');
  }
});

db.run('ALTER TABLE customers ADD COLUMN longitude REAL', (err) => {
  if (err && !err.message.includes('duplicate column')) {
    console.error('Longitude sütunu eklenemedi:', err.message);
  } else {
    console.log('✅ Longitude sütunu eklendi');
  }
});

db.run('ALTER TABLE customers ADD COLUMN notes TEXT', (err) => {
  if (err && !err.message.includes('duplicate column')) {
    console.error('Notes sütunu eklenemedi:', err.message);
  } else {
    console.log('✅ Notes sütunu eklendi');
  }
  db.close();
});