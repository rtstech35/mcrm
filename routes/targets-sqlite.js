const express = require('express');
const sqlite3 = require('sqlite3').verbose();
const path = require('path');
const router = express.Router();

const dbPath = path.join(__dirname, '..', 'database', 'saha_crm.db');
const db = new sqlite3.Database(dbPath);

// Hedef belirleme/güncelleme
router.post('/', (req, res) => {
  const { user_id, target_type, target_value, target_month } = req.body;
  
  db.run(
    `INSERT OR REPLACE INTO user_targets (user_id, target_type, target_value, target_month, updated_at) 
     VALUES (?, ?, ?, ?, CURRENT_TIMESTAMP)`,
    [user_id, target_type, target_value, target_month],
    function(err) {
      if (err) return res.status(500).json({ error: err.message });
      res.json({ message: 'Hedef belirlendi' });
    }
  );
});

// Kullanıcının hedeflerini getir
router.get('/user/:userId', (req, res) => {
  const currentMonth = new Date().toISOString().slice(0, 7); // YYYY-MM
  
  db.all(
    'SELECT * FROM user_targets WHERE user_id = ? AND target_month = ?',
    [req.params.userId, currentMonth],
    (err, targets) => {
      if (err) return res.status(500).json({ error: err.message });
      res.json(targets);
    }
  );
});

// Tüm kullanıcıların hedeflerini getir (admin için)
router.get('/', (req, res) => {
  const currentMonth = new Date().toISOString().slice(0, 7);
  
  db.all(
    `SELECT ut.*, u.full_name, r.name as role 
     FROM user_targets ut 
     LEFT JOIN users u ON ut.user_id = u.id 
     LEFT JOIN roles r ON u.role_id = r.id
     WHERE ut.target_month = ?
     ORDER BY u.full_name`,
    [currentMonth],
    (err, targets) => {
      if (err) return res.status(500).json({ error: err.message });
      res.json(targets);
    }
  );
});

module.exports = router;