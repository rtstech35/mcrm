const express = require('express');
const bcrypt = require('bcryptjs');
const sqlite3 = require('sqlite3').verbose();
const path = require('path');
const router = express.Router();

const dbPath = path.join(__dirname, '..', 'database', 'saha_crm.db');
const db = new sqlite3.Database(dbPath);

// Tüm kullanıcıları listele
router.get('/', (req, res) => {
  db.all(
    `SELECT u.*, r.name as role_name, d.name as department_name 
     FROM users u 
     LEFT JOIN roles r ON u.role_id = r.id 
     LEFT JOIN departments d ON u.department_id = d.id`,
    (err, users) => {
      if (err) return res.status(500).json({ error: err.message });
      res.json(users);
    }
  );
});

// Yeni kullanıcı ekle
router.post('/', async (req, res) => {
  const { username, email, password, full_name, department_id, role_id, phone } = req.body;
  
  try {
    const hashedPassword = await bcrypt.hash(password, 10);
    
    db.run(
      'INSERT INTO users (username, email, password_hash, full_name, department_id, role_id, phone) VALUES (?, ?, ?, ?, ?, ?, ?)',
      [username, email, hashedPassword, full_name, department_id, role_id, phone],
      function(err) {
        if (err) return res.status(500).json({ error: err.message });
        res.json({ id: this.lastID, message: 'Kullanıcı oluşturuldu' });
      }
    );
  } catch (error) {
    res.status(500).json({ error: error.message });
  }
});

// Kullanıcı güncelle
router.put('/:id', (req, res) => {
  const { full_name, email, phone, department_id, role_id, is_active } = req.body;
  
  db.run(
    'UPDATE users SET full_name = ?, email = ?, phone = ?, department_id = ?, role_id = ?, is_active = ? WHERE id = ?',
    [full_name, email, phone, department_id, role_id, is_active, req.params.id],
    function(err) {
      if (err) return res.status(500).json({ error: err.message });
      res.json({ message: 'Kullanıcı güncellendi' });
    }
  );
});

// Kullanıcı sil
router.delete('/:id', (req, res) => {
  db.run('UPDATE users SET is_active = 0 WHERE id = ?', [req.params.id], function(err) {
    if (err) return res.status(500).json({ error: err.message });
    res.json({ message: 'Kullanıcı deaktif edildi' });
  });
});

module.exports = router;