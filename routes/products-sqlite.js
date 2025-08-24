// routes/products.js
const express = require('express');
const router = express.Router();
const pool = require('../config/database');

// 📌 Tüm ürünleri listele
router.get('/', async (req, res) => {
  try {
    const result = await pool.query('SELECT * FROM products ORDER BY id DESC');
    res.json(result.rows);
  } catch (err) {
    console.error('Ürünleri çekerken hata:', err);
    res.status(500).json({ error: 'Ürünler alınamadı' });
  }
});

// 📌 Yeni ürün ekle
router.post('/', async (req, res) => {
  const { name, price, stock } = req.body;
  try {
    const result = await pool.query(
      'INSERT INTO products (name, price, stock) VALUES ($1, $2, $3) RETURNING *',
      [name, price, stock]
    );
    res.json(result.rows[0]);
  } catch (err) {
    console.error('Ürün eklenemedi:', err);
    res.status(500).json({ error: 'Ürün eklenemedi' });
  }
});

// 📌 Ürün güncelle
router.put('/:id', async (req, res) => {
  const { id } = req.params;
  const { name, price, stock } = req.body;
  try {
    const result = await pool.query(
      'UPDATE products SET name=$1, price=$2, stock=$3 WHERE id=$4 RETURNING *',
      [name, price, stock, id]
    );
    res.json(result.rows[0]);
  } catch (err) {
    console.error('Ürün güncellenemedi:', err);
    res.status(500).json({ error: 'Ürün güncellenemedi' });
  }
});

// 📌 Ürün sil
router.delete('/:id', async (req, res) => {
  const { id } = req.params;
  try {
    await pool.query('DELETE FROM products WHERE id=$1', [id]);
    res.json({ message: 'Ürün silindi' });
  } catch (err) {
    console.error('Ürün silinemedi:', err);
    res.status(500).json({ error: 'Ürün silinemedi' });
  }
});

module.exports = router;
