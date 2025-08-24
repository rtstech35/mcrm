const sqlite3 = require('sqlite3').verbose();
const path = require('path');

const dbPath = path.join(__dirname, '..', 'database', 'saha_crm.db');

const db = new sqlite3.Database(dbPath, (err) => {
  if (err) {
    console.error('SQLite bağlantı hatası:', err.message);
  } else {
    console.log('SQLite veritabanına bağlandı');
  }
});

module.exports = db;