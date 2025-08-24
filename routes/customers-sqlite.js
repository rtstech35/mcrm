const express = require('express');
const sqlite3 = require('sqlite3').verbose();
const path = require('path');
const router = express.Router();

const dbPath = path.join(__dirname, '..', 'database', 'saha_crm.db');
const db = new sqlite3.Database(dbPath);

// Tüm müşterileri listele
router.get('/', (req, res) => {
  db.all(
    `SELECT c.*, u.full_name as sales_rep_name 
     FROM customers c 
     LEFT JOIN users u ON c.assigned_sales_rep = u.id`,
    (err, customers) => {
      if (err) return res.status(500).json({ error: err.message });
      res.json(customers);
    }
  );
});

// Tek müşteri getir
router.get('/:id', (req, res) => {
  db.get(
    `SELECT c.*, u.full_name as sales_rep_name 
     FROM customers c 
     LEFT JOIN users u ON c.assigned_sales_rep = u.id 
     WHERE c.id = ?`,
    [req.params.id],
    (err, customer) => {
      if (err) return res.status(500).json({ error: err.message });
      if (!customer) return res.status(404).json({ error: 'Müşteri bulunamadı' });
      res.json(customer);
    }
  );
});

// Yeni müşteri ekle
router.post('/', (req, res) => {
  const { company_name, contact_person, phone, email, address, sales_rep_id, customer_status, latitude, longitude, notes } = req.body;
  
  db.run(
    'INSERT INTO customers (company_name, contact_person, phone, email, address, assigned_sales_rep, customer_status, latitude, longitude, notes) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)',
    [company_name, contact_person, phone, email, address, sales_rep_id, customer_status, latitude, longitude, notes],
    function(err) {
      if (err) return res.status(500).json({ error: err.message });
      res.json({ id: this.lastID, message: 'Müşteri oluşturuldu' });
    }
  );
});

// Müşteri güncelle
router.put('/:id', (req, res) => {
  const { company_name, contact_person, phone, email, address, assigned_sales_rep, customer_status } = req.body;
  
  db.run(
    'UPDATE customers SET company_name = ?, contact_person = ?, phone = ?, email = ?, address = ?, assigned_sales_rep = ?, customer_status = ? WHERE id = ?',
    [company_name, contact_person, phone, email, address, assigned_sales_rep, customer_status, req.params.id],
    function(err) {
      if (err) return res.status(500).json({ error: err.message });
      res.json({ message: 'Müşteri güncellendi' });
    }
  );
});

// Müşteri sil
router.delete('/:id', (req, res) => {
  db.run('DELETE FROM customers WHERE id = ?', [req.params.id], function(err) {
    if (err) return res.status(500).json({ error: err.message });
    res.json({ message: 'Müşteri silindi' });
  });
});



module.exports = router;