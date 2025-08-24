const sqlite3 = require('sqlite3').verbose();
const path = require('path');

const dbPath = path.join(__dirname, 'database', 'saha_crm.db');
const db = new sqlite3.Database(dbPath);

const testProducts = [
  { name: 'Premium Kahve', description: 'Özel harman kahve', unit_price: 45.50, unit: 'kg' },
  { name: 'Çay Bardağı', description: 'Cam çay bardağı', unit_price: 12.00, unit: 'adet' },
  { name: 'Şeker', description: 'Toz şeker', unit_price: 8.75, unit: 'kg' },
  { name: 'Süt', description: 'Tam yağlı süt', unit_price: 6.50, unit: 'lt' }
];

console.log('Test ürünleri ekleniyor...');

testProducts.forEach((product, index) => {
  db.run(
    'INSERT OR IGNORE INTO products (name, description, unit_price, unit) VALUES (?, ?, ?, ?)',
    [product.name, product.description, product.unit_price, product.unit],
    function(err) {
      if (err) console.error('Hata:', err.message);
      else console.log(`✅ ${product.name} eklendi`);
      
      if (index === testProducts.length - 1) {
        console.log('\n🎉 Test ürünleri eklendi!');
        db.close();
      }
    }
  );
});