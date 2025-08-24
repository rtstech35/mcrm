const express = require('express');
const sqlite3 = require('sqlite3').verbose();
const path = require('path');
const router = express.Router();

const dbPath = path.join(__dirname, '..', 'database', 'saha_crm.db');
const db = new sqlite3.Database(dbPath);

// Fatura oluştur
router.post('/invoice', (req, res) => {
  const { order_id } = req.body;
  const invoice_number = 'FAT' + Date.now();
  
  // Sipariş bilgilerini al
  db.get('SELECT * FROM orders WHERE id = ?', [order_id], (err, order) => {
    if (err) return res.status(500).json({ error: err.message });
    if (!order) return res.status(404).json({ error: 'Sipariş bulunamadı' });
    
    // Cari hesaba borç kaydı ekle
    db.run(
      'INSERT INTO account_transactions (customer_id, transaction_type, amount, transaction_date, description, reference_number, created_by) VALUES (?, ?, ?, ?, ?, ?, ?)',
      [order.customer_id, 'invoice', order.total_amount, new Date().toISOString().split('T')[0], `Fatura - Sipariş #${order.order_number}`, invoice_number, req.user.userId],
      function(err) {
        if (err) return res.status(500).json({ error: err.message });
        
        // Müşteri bakiyesini güncelle
        db.run(
          'UPDATE customers SET current_account_balance = current_account_balance + ? WHERE id = ?',
          [order.total_amount, order.customer_id],
          function(err) {
            if (err) return res.status(500).json({ error: err.message });
            res.json({ invoice_number, message: 'Fatura oluşturuldu' });
          }
        );
      }
    );
  });
});

// Ödeme kaydı
router.post('/payment', (req, res) => {
  const { customer_id, transaction_type, amount, description, transaction_date } = req.body;
  const reference_number = 'ODE' + Date.now();
  
  db.run(
    'INSERT INTO account_transactions (customer_id, transaction_type, amount, transaction_date, description, reference_number, created_by) VALUES (?, ?, ?, ?, ?, ?, ?)',
    [customer_id, transaction_type, -Math.abs(amount), transaction_date, description, reference_number, req.user.userId],
    function(err) {
      if (err) return res.status(500).json({ error: err.message });
      
      // Müşteri bakiyesini güncelle
      db.run(
        'UPDATE customers SET current_account_balance = current_account_balance - ? WHERE id = ?',
        [Math.abs(amount), customer_id],
        function(err) {
          if (err) return res.status(500).json({ error: err.message });
          res.json({ reference_number, message: 'Ödeme kaydı oluşturuldu' });
        }
      );
    }
  );
});

// Cari hesap hareketleri
router.get('/transactions/:customer_id', (req, res) => {
  db.all(
    'SELECT * FROM account_transactions WHERE customer_id = ? ORDER BY transaction_date DESC',
    [req.params.customer_id],
    (err, transactions) => {
      if (err) return res.status(500).json({ error: err.message });
      res.json(transactions);
    }
  );
});

module.exports = router;