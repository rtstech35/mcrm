const express = require('express');
const sqlite3 = require('sqlite3').verbose();
const path = require('path');
const router = express.Router();

const dbPath = path.join(__dirname, '..', 'database', 'saha_crm.db');
const db = new sqlite3.Database(dbPath);

// Tüm siparişleri listele
router.get('/', (req, res) => {
  const customer_id = req.query.customer_id;
  
  let query = `SELECT o.*, c.company_name as customer_name, u.full_name as sales_rep_name 
               FROM orders o 
               LEFT JOIN customers c ON o.customer_id = c.id 
               LEFT JOIN users u ON o.sales_rep_id = u.id`;
  let params = [];
  
  if (customer_id) {
    query += ' WHERE o.customer_id = ?';
    params.push(customer_id);
  }
  
  query += ' ORDER BY o.created_at DESC';
  
  db.all(query, params, (err, orders) => {
    if (err) return res.status(500).json({ error: err.message });
    res.json(orders);
  });
});

// Sipariş durumu güncelle
router.put('/:id/status', (req, res) => {
  const { status } = req.body;
  
  db.run(
    'UPDATE orders SET status = ?, updated_at = CURRENT_TIMESTAMP WHERE id = ?',
    [status, req.params.id],
    function(err) {
      if (err) return res.status(500).json({ error: err.message });
      res.json({ message: 'Sipariş durumu güncellendi' });
    }
  );
});

// Üretimi tamamla ve sevkiyata hazır yap
router.put('/:id/production-complete', (req, res) => {
  db.run(
    'UPDATE orders SET status = "production_ready", updated_at = CURRENT_TIMESTAMP WHERE id = ?',
    [req.params.id],
    function(err) {
      if (err) return res.status(500).json({ error: err.message });
      res.json({ message: 'Üretim tamamlandı, sevkiyata hazır' });
    }
  );
});



// Yeni sipariş oluştur
router.post('/', (req, res) => {
  const { customer_id, order_date, delivery_date, payment_due_date, items, notes } = req.body;
  const sales_rep_id = req.user.userId;
  
  // Sipariş numarası oluştur: YYAAGGG### formatında
  const date = new Date(order_date);
  const year = date.getFullYear().toString().slice(-2);
  const month = (date.getMonth() + 1).toString().padStart(2, '0');
  const day = date.getDate().toString().padStart(2, '0');
  const datePrefix = year + month + day;
  
  // Bugünün sipariş sayısını bul
  db.get(
    'SELECT COUNT(*) as count FROM orders WHERE DATE(order_date) = DATE(?)',
    [order_date],
    (err, result) => {
      if (err) return res.status(500).json({ error: err.message });
      
      const orderCount = (result.count + 1).toString().padStart(3, '0');
      const order_number = datePrefix + orderCount;
      
      // Toplam tutar hesapla
      const total_amount = items.reduce((sum, item) => sum + (item.quantity * item.unit_price), 0);
      
      // Siparişi oluştur
      db.run(
        'INSERT INTO orders (order_number, customer_id, sales_rep_id, order_date, delivery_date, payment_due_date, total_amount, notes) VALUES (?, ?, ?, ?, ?, ?, ?, ?)',
        [order_number, customer_id, sales_rep_id, order_date, delivery_date, payment_due_date, total_amount, notes],
        function(err) {
          if (err) return res.status(500).json({ error: err.message });
          
          const order_id = this.lastID;
          
          // Sipariş kalemlerini ekle
          const stmt = db.prepare('INSERT INTO order_items (order_id, product_id, quantity, unit_price, total_price) VALUES (?, ?, ?, ?, ?)');
          
          items.forEach(item => {
            stmt.run([order_id, item.product_id, item.quantity, item.unit_price, item.quantity * item.unit_price]);
          });
          
          stmt.finalize((err) => {
            if (err) return res.status(500).json({ error: err.message });
            res.json({ id: order_id, order_number, message: 'Sipariş oluşturuldu' });
          });
        }
      );
    }
  );
});

// Tek sipariş getir
router.get('/:id', (req, res) => {
  const query = `SELECT o.*, c.company_name as customer_name, u.full_name as sales_rep_name 
                 FROM orders o 
                 LEFT JOIN customers c ON o.customer_id = c.id 
                 LEFT JOIN users u ON o.sales_rep_id = u.id 
                 WHERE o.id = ?`;
  
  db.get(query, [req.params.id], (err, order) => {
    if (err) return res.status(500).json({ error: err.message });
    if (!order) return res.status(404).json({ error: 'Sipariş bulunamadı' });
    res.json(order);
  });
});

// Sipariş kalemlerini getir
router.get('/:id/items', (req, res) => {
  const query = `SELECT oi.*, p.name as product_name, p.unit 
                 FROM order_items oi 
                 LEFT JOIN products p ON oi.product_id = p.id 
                 WHERE oi.order_id = ?`;
  
  db.all(query, [req.params.id], (err, items) => {
    if (err) return res.status(500).json({ error: err.message });
    res.json(items);
  });
});

// Teslimatı tamamla ve irsaliye oluştur
router.put('/:id/deliver', (req, res) => {
  const { signature, delivery_date } = req.body;
  const orderId = req.params.id;
  const userId = 1; // Sabit user ID
  
  console.log('Teslimat tamamlama başlatıldı:', { orderId, userId });
  
  // Sipariş bilgilerini al
  db.get('SELECT * FROM orders WHERE id = ?', [orderId], (err, order) => {
    if (err) return res.status(500).json({ error: err.message });
    if (!order) return res.status(404).json({ error: 'Sipariş bulunamadı' });
    
    // Siparişi teslim edildi olarak işaretle
    db.run(
      'UPDATE orders SET status = "delivered", updated_at = CURRENT_TIMESTAMP WHERE id = ?',
      [orderId],
      function(err) {
        if (err) {
          console.error('Sipariş durumu güncellenemedi:', err);
          return res.status(500).json({ error: err.message });
        }
        
        // İrsaliye oluştur
        const deliveryNoteNumber = 'IRS-' + Date.now();
        const deliveryDate = delivery_date ? delivery_date.split('T')[0] : new Date().toISOString().split('T')[0];
        
        db.run(
          'INSERT INTO delivery_notes (delivery_note_number, customer_id, order_id, delivery_date, total_amount, notes, created_by, signature_data) VALUES (?, ?, ?, ?, ?, ?, ?, ?)',
          [deliveryNoteNumber, order.customer_id, orderId, deliveryDate, order.total_amount, 'Teslim edildi', userId, signature || ''],
          function(err) {
            if (err) {
              console.error('İrsaliye oluşturulamadı:', err);
              console.error('Hata detayı:', err);
              return res.status(500).json({ error: 'Irsaliye olusturulamadi: ' + err.message });
            }
            
            const deliveryNoteId = this.lastID;
            
            // Sipariş kalemlerini irsaliyeye kopyala
            db.run(
              'INSERT INTO delivery_note_items (delivery_note_id, product_id, quantity, unit_price, total_price, unit) SELECT ?, product_id, quantity, unit_price, total_price, "adet" FROM order_items WHERE order_id = ?',
              [deliveryNoteId, orderId],
              function(err) {
                if (err) {
                  console.error('İrsaliye kalemleri kopyalanamadı:', err);
                }
                
                console.log('İrsaliye oluşturuldu:', deliveryNoteNumber);
                res.json({ 
                  message: 'Teslimat tamamlandı ve irsaliye oluşturuldu',
                  deliveryNoteNumber: deliveryNoteNumber,
                  deliveryNoteId: deliveryNoteId
                });
              }
            );
          }
        );
      }
    );
  });
});


module.exports = router;