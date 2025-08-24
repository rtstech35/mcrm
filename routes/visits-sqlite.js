const express = require('express');
const sqlite3 = require('sqlite3').verbose();
const path = require('path');
const router = express.Router();

const dbPath = path.join(__dirname, '..', 'database', 'saha_crm.db');
const db = new sqlite3.Database(dbPath);

// Ziyaret kaydet
router.post('/', (req, res) => {
  const { customer_id, visit_type, result, notes, interested_products, next_contact_date, estimated_order_amount, visit_date } = req.body;
  const sales_rep_id = req.user.userId;
  
  db.run(
    'INSERT INTO visits (customer_id, sales_rep_id, visit_type, result, notes, interested_products, next_contact_date, estimated_order_amount, visit_date) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)',
    [customer_id, sales_rep_id, visit_type, result, notes, interested_products, next_contact_date, estimated_order_amount, visit_date],
    function(err) {
      if (err) return res.status(500).json({ error: err.message });
      res.json({ id: this.lastID, message: 'Ziyaret kaydı oluşturuldu' });
    }
  );
});

// Ziyaretleri listele
router.get('/', (req, res) => {
  const sales_rep_id = req.user.userId;
  const customer_id = req.query.customer_id;
  
  let query = `SELECT v.*, c.company_name, c.contact_person 
               FROM visits v 
               LEFT JOIN customers c ON v.customer_id = c.id 
               WHERE v.sales_rep_id = ?`;
  let params = [sales_rep_id];
  
  if (customer_id) {
    query += ' AND v.customer_id = ?';
    params.push(customer_id);
  }
  
  query += ' ORDER BY v.visit_date DESC';
  
  db.all(query, params, (err, visits) => {
    if (err) return res.status(500).json({ error: err.message });
    res.json(visits);
  });
});

module.exports = router;