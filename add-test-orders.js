const sqlite3 = require('sqlite3').verbose();
const bcrypt = require('bcryptjs');
const path = require('path');

const dbPath = path.join(__dirname, 'database', 'saha_crm.db');
const db = new sqlite3.Database(dbPath);

async function addTestData() {
  try {
    // Üretim kullanıcısı ekle
    const hashedPassword = await bcrypt.hash('123456', 10);
    
    db.run(
      'INSERT OR IGNORE INTO users (username, email, password_hash, full_name, department_id, role_id) VALUES (?, ?, ?, ?, ?, ?)',
      ['uretim1', 'uretim1@test.com', hashedPassword, 'Üretim Personeli 1', 3, 3],
      function(err) {
        if (err) console.error('Kullanıcı hatası:', err.message);
        else console.log('✅ Üretim kullanıcısı oluşturuldu (uretim1/123456)');
      }
    );
    
    // Test siparişleri ekle
    const testOrders = [
      { order_number: 'SIP001', customer_id: 1, sales_rep_id: 2, total_amount: 5000, status: 'pending' },
      { order_number: 'SIP002', customer_id: 2, sales_rep_id: 2, total_amount: 3500, status: 'production' },
      { order_number: 'SIP003', customer_id: 3, sales_rep_id: 2, total_amount: 7200, status: 'completed' },
      { order_number: 'SIP004', customer_id: 4, sales_rep_id: 2, total_amount: 2800, status: 'pending' }
    ];
    
    testOrders.forEach((order, index) => {
      db.run(
        'INSERT OR IGNORE INTO orders (order_number, customer_id, sales_rep_id, order_date, total_amount, status) VALUES (?, ?, ?, ?, ?, ?)',
        [order.order_number, order.customer_id, order.sales_rep_id, new Date().toISOString().split('T')[0], order.total_amount, order.status],
        function(err) {
          if (err) console.error('Sipariş hatası:', err.message);
          else console.log(`✅ ${order.order_number} eklendi`);
          
          if (index === testOrders.length - 1) {
            console.log('\n🎉 Test verileri eklendi!');
            db.close();
          }
        }
      );
    });
    
  } catch (error) {
    console.error('Hata:', error);
  }
}

addTestData();