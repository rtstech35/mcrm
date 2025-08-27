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
      res.json({ users });
    }
  );
});

// Tek kullanıcı getir
router.get('/:id', (req, res) => {
  db.get(
    `SELECT u.*, r.name as role_name, d.name as department_name 
     FROM users u 
     LEFT JOIN roles r ON u.role_id = r.id 
     LEFT JOIN departments d ON u.department_id = d.id 
     WHERE u.id = ?`,
    [req.params.id],
    (err, user) => {
      if (err) return res.status(500).json({ error: err.message });
      if (!user) return res.status(404).json({ error: 'Kullanıcı bulunamadı' });
      res.json({ user });
    }
  );
});

// Yeni kullanıcı ekle
router.post('/', async (req, res) => {
  const { username, email, password, full_name, department_id, role_id, phone } = req.body;
  
  if (!password || password.trim() === '') {
    return res.status(400).json({ error: 'Şifre gerekli' });
  }
  
  try {
    const hashedPassword = await bcrypt.hash(password.toString().trim(), 10);
    
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
router.put('/:id', async (req, res) => {
  const { full_name, email, phone, department_id, role_id, is_active, password } = req.body;
  
  try {
    let query = 'UPDATE users SET full_name = ?, email = ?, phone = ?, department_id = ?, role_id = ?, is_active = ?';
    let params = [full_name, email, phone, department_id, role_id, is_active];
    
    if (password && password.trim() !== '') {
      const hashedPassword = await bcrypt.hash(password.toString().trim(), 10);
      query += ', password_hash = ?';
      params.push(hashedPassword);
    }
    
    query += ' WHERE id = ?';
    params.push(req.params.id);
    
    db.run(query, params, function(err) {
      if (err) return res.status(500).json({ error: err.message });
      res.json({ message: 'Kullanıcı güncellendi' });
    });
  } catch (error) {
    res.status(500).json({ error: error.message });
  }
});

// Kullanıcı sil
router.delete('/:id', (req, res) => {
  db.run('UPDATE users SET is_active = 0 WHERE id = ?', [req.params.id], function(err) {
    if (err) return res.status(500).json({ error: err.message });
    res.json({ message: 'Kullanıcı deaktif edildi' });
  });
});

module.exports = router;