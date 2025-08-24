const sqlite3 = require('sqlite3').verbose();
const path = require('path');

const dbPath = path.join(__dirname, 'database', 'saha_crm.db');
const db = new sqlite3.Database(dbPath);

console.log('Test sipariş kalemleri ekleniyor...');

// Önce siparişleri kontrol et
db.all('SELECT id, order_number FROM orders LIMIT 5', (err, orders) => {
  if (err) {
    console.error('Siparişler alınamadı:', err.message);
    return;
  }
  
  if (orders.length === 0) {
    console.log('Sipariş bulunamadı');
    db.close();
    return;
  }
  
  console.log('Bulunan siparişler:', orders);
  
  // Her sipariş için test kalemleri ekle
  orders.forEach((order, index) => {
    const testItems = [
      { product_id: 1, quantity: 10, unit_price: 25.50 },
      { product_id: 2, quantity: 5, unit_price: 45.00 },
      { product_id: 3, quantity: 8, unit_price: 15.75 }
    ];
    
    testItems.forEach(item => {
      const total_price = item.quantity * item.unit_price;
      
      db.run(
        'INSERT OR IGNORE INTO order_items (order_id, product_id, quantity, unit_price, total_price) VALUES (?, ?, ?, ?, ?)',
        [order.id, item.product_id, item.quantity, item.unit_price, total_price],
        function(err) {
          if (err) {
            console.error('Kalem eklenemedi:', err.message);
          } else {
            console.log(`✅ Sipariş ${order.order_number} için kalem eklendi`);
          }
        }
      );
    });
  });
  
  setTimeout(() => {
    console.log('\n🎯 Test sipariş kalemleri eklendi!');
    db.close();
  }, 1000);
});