const sqlite3 = require('sqlite3').verbose();
const path = require('path');

const dbPath = path.join(__dirname, 'database', 'saha_crm.db');
const db = new sqlite3.Database(dbPath);

// İstanbul'daki örnek konumlar
const locations = [
  { id: 1, lat: 41.0082, lng: 28.9784, address: 'Sultanahmet, İstanbul' }, // Sultanahmet
  { id: 2, lat: 41.0369, lng: 28.9857, address: 'Beyoğlu, İstanbul' }, // Beyoğlu
  { id: 3, lat: 41.0766, lng: 29.0573, address: 'Üsküdar, İstanbul' }, // Üsküdar
  { id: 4, lat: 41.0214, lng: 28.9948, address: 'Karaköy, İstanbul' }, // Karaköy
  { id: 5, lat: 41.0138, lng: 28.9497, address: 'Bakırköy, İstanbul' } // Bakırköy
];

console.log('Müşteri konumları güncelleniyor...');

locations.forEach((location, index) => {
  db.run(
    'UPDATE customers SET latitude = ?, longitude = ?, address = ? WHERE id = ?',
    [location.lat, location.lng, location.address, location.id],
    function(err) {
      if (err) {
        console.error('Hata:', err.message);
      } else {
        console.log(`✅ Müşteri ${location.id} konumu güncellendi`);
      }
      
      if (index === locations.length - 1) {
        console.log('\n🎉 Tüm müşteri konumları güncellendi!');
        db.close();
      }
    }
  );
});