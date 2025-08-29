const express = require('express');
const sqlite3 = require('sqlite3').verbose();
const path = require('path');
const router = express.Router();

const dbPath = path.join(__dirname, '..', 'database', 'saha_crm.db');
const db = new sqlite3.Database(dbPath);

// Tüm ürünleri listele
router.get('/', (req, res) => {
  db.all('SELECT * FROM products ORDER BY id DESC', (err, products) => {
    if (err) return res.status(500).json({ error: err.message });
    res.json(products);
  });
});

// Yeni ürün ekle
router.post('/', (req, res) => {
  const { name, price, stock, unit } = req.body;
  
  db.run(
    'INSERT INTO products (name, price, stock, unit) VALUES (?, ?, ?, ?)',
    [name, price, stock, unit || 'adet'],
    function(err) {
      if (err) return res.status(500).json({ error: err.message });
      res.json({ id: this.lastID, name, price, stock, unit: unit || 'adet' });
    }
  );
});

// Ürün güncelle
router.put('/:id', (req, res) => {
  const { name, price, stock, unit } = req.body;
  
  db.run(
    'UPDATE products SET name = ?, price = ?, stock = ?, unit = ? WHERE id = ?',
    [name, price, stock, unit, req.params.id],
    function(err) {
      if (err) return res.status(500).json({ error: err.message });
      res.json({ message: 'Ürün güncellendi' });
    }
  );
});

// Ürün sil
router.delete('/:id', (req, res) => {
  db.run('DELETE FROM products WHERE id = ?', [req.params.id], function(err) {
    if (err) return res.status(500).json({ error: err.message });
    res.json({ message: 'Ürün silindi' });
  });
});

module.exports = router;
