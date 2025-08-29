const express = require('express');
const sqlite3 = require('sqlite3').verbose();
const path = require('path');
const router = express.Router();

const dbPath = path.join(__dirname, '..', 'database', 'saha_crm.db');
const db = new sqlite3.Database(dbPath);

// Sipariş kalemleri ekle
router.post('/', (req, res) => {
  const { order_id, items } = req.body;
  
  const stmt = db.prepare('INSERT INTO order_items (order_id, product_id, quantity, unit_price, total_price) VALUES (?, ?, ?, ?, ?)');
  
  items.forEach(item => {
    stmt.run([order_id, item.product_id, item.quantity, item.unit_price, item.total_price]);
  });
  
  stmt.finalize((err) => {
    if (err) return res.status(500).json({ error: err.message });
    res.json({ message: 'Sipariş kalemleri eklendi' });
  });
});

// Sipariş kalemlerini getir
router.get('/', (req, res) => {
  const order_id = req.query.order_id;
  
  if (!order_id) {
    return res.status(400).json({ error: 'order_id gerekli' });
  }
  
  db.all(
    `SELECT oi.*, p.name as product_name, p.description as product_description, p.unit as product_unit 
     FROM order_items oi 
     LEFT JOIN products p ON oi.product_id = p.id 
     WHERE oi.order_id = ?`,
    [order_id],
    (err, items) => {
      if (err) return res.status(500).json({ error: err.message });
      res.json(items);
    }
  );
});

// Sipariş kalemlerini getir (eski format)
router.get('/:order_id', (req, res) => {
  db.all(
    `SELECT oi.*, p.name as product_name, p.description as product_description, p.unit as product_unit 
     FROM order_items oi 
     LEFT JOIN products p ON oi.product_id = p.id 
     WHERE oi.order_id = ?`,
    [req.params.order_id],
    (err, items) => {
      if (err) return res.status(500).json({ error: err.message });
      res.json(items);
    }
  );
});

module.exports = router;