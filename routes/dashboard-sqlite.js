const express = require('express');
const sqlite3 = require('sqlite3').verbose();
const path = require('path');
const router = express.Router();

const dbPath = path.join(__dirname, '..', 'database', 'saha_crm.db');
const db = new sqlite3.Database(dbPath);

// Dashboard istatistikleri
router.get('/stats', (req, res) => {
  const stats = {};
  
  // Toplam kullanıcı sayısı
  db.get('SELECT COUNT(*) as total FROM users WHERE is_active = 1', (err, result) => {
    if (err) return res.status(500).json({ error: err.message });
    stats.totalUsers = result.total;
    
    // Toplam müşteri sayısı
    db.get('SELECT COUNT(*) as total FROM customers', (err, result) => {
      if (err) return res.status(500).json({ error: err.message });
      stats.totalCustomers = result.total;
      
      // Aktif müşteri sayısı
      db.get('SELECT COUNT(*) as total FROM customers WHERE customer_status = "active"', (err, result) => {
        if (err) return res.status(500).json({ error: err.message });
        stats.activeCustomers = result.total;
        
        // Potansiyel müşteri sayısı
        db.get('SELECT COUNT(*) as total FROM customers WHERE customer_status = "potential"', (err, result) => {
          if (err) return res.status(500).json({ error: err.message });
          stats.potentialCustomers = result.total;
          
          res.json(stats);
        });
      });
    });
  });
});

// Aylık satış verileri (örnek veri)
router.get('/monthly-sales', (req, res) => {
  const monthlyData = [
    { month: 'Ocak', target: 100000, actual: 85000 },
    { month: 'Şubat', target: 120000, actual: 95000 },
    { month: 'Mart', target: 110000, actual: 125000 },
    { month: 'Nisan', target: 130000, actual: 115000 },
    { month: 'Mayıs', target: 140000, actual: 135000 },
    { month: 'Haziran', target: 150000, actual: 145000 }
  ];
  
  res.json(monthlyData);
});

// Müşteri durumu dağılımı
router.get('/customer-status', (req, res) => {
  db.all(
    `SELECT customer_status, COUNT(*) as count 
     FROM customers 
     GROUP BY customer_status`,
    (err, results) => {
      if (err) return res.status(500).json({ error: err.message });
      res.json(results);
    }
  );
});

module.exports = router;