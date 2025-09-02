const express = require('express');
const bcrypt = require('bcryptjs');
const pool = require('../config/database');
const { authenticateToken, checkPermission } = require('../middleware/auth'); // Path'i düzelt
const router = express.Router();

// GET /api/users - Tüm kullanıcıları listele
router.get("/", authenticateToken, checkPermission('users.read'), async (req, res) => { // Bu endpoint server.js'den taşındı
  try {
    const { role } = req.query;

    let query = `
      SELECT u.id, u.username, u.full_name, u.email, u.phone, u.is_active, u.role_id, u.department_id,
             COALESCE(r.name, 'Rol Yok') as role_name,
             COALESCE(d.name, 'Departman Yok') as department_name
      FROM users u
      LEFT JOIN roles r ON u.role_id = r.id
      LEFT JOIN departments d ON u.department_id = d.id
    `;
    const params = [];
    const whereClauses = [];

    if (role) {
        const roleSearchTerm = role.toLowerCase() === 'shipping' ? 'Sevkiyat' : role;
        whereClauses.push(`r.name ILIKE $${params.length + 1}`);
        params.push(`%${roleSearchTerm}%`);
    }

    if (whereClauses.length > 0) {
        query += ` WHERE ${whereClauses.join(' AND ')}`;
    }

    query += ` ORDER BY u.full_name ASC`;

    const result = await pool.query(query, params);
    res.json({ success: true, users: result.rows });
  } catch (error) {
    console.error('❌ Users API hatası:', error);
    res.status(500).json({ success: false, error: error.message });
  }
});

// POST /api/users - Yeni kullanıcı ekle
router.post("/", authenticateToken, checkPermission('users.create'), async (req, res) => { // Bu endpoint server.js'den taşındı
  try {
    const { username, email, password, full_name, role_id, department_id, phone } = req.body;
    if (!password || password.trim() === '') {
      return res.status(400).json({ success: false, error: 'Şifre gerekli' });
    }
    const hashedPassword = await bcrypt.hash(password.toString().trim(), 10);
    const result = await pool.query(`
      INSERT INTO users (username, email, password_hash, full_name, role_id, department_id, phone, is_active)
      VALUES ($1, $2, $3, $4, $5, $6, $7, true) RETURNING *
    `, [username, email, hashedPassword, full_name, role_id, department_id, phone]);
    res.json({ success: true, user: result.rows[0] });
  } catch (error) {
    console.error('User create hatası:', error);
    res.status(500).json({ success: false, error: error.message });
  }
});

// GET /api/users/:id - Tek kullanıcı getir
router.get("/:id", authenticateToken, checkPermission('users.read'), async (req, res) => { // Bu endpoint server.js'den taşındı
  try {
    const { id } = req.params;
    const result = await pool.query(`
      SELECT u.*, r.name as role_name, d.name as department_name FROM users u
      LEFT JOIN roles r ON u.role_id = r.id
      LEFT JOIN departments d ON u.department_id = d.id
      WHERE u.id = $1
    `, [id]);
    if (result.rows.length === 0) return res.status(404).json({ success: false, error: 'Kullanıcı bulunamadı' });
    res.json({ success: true, user: result.rows[0] });
  } catch (error) {
    console.error('User get hatası:', error);
    res.status(500).json({ success: false, error: error.message });
  }
});

// PUT /api/users/:id - Kullanıcı güncelle
router.put("/:id", authenticateToken, checkPermission('users.update'), async (req, res) => { // Bu endpoint server.js'den taşındı
  try {
    const { id } = req.params;
    const { username, email, password, full_name, role_id, department_id, phone, is_active } = req.body;
    let query = `UPDATE users SET username = $1, email = $2, full_name = $3, role_id = $4, department_id = $5, phone = $6, is_active = $7`;
    let params = [username, email, full_name, role_id, department_id, phone, is_active];
    if (password && password.trim() !== '') {
      const hashedPassword = await bcrypt.hash(password.toString().trim(), 10);
      query += `, password_hash = $${params.length + 1} WHERE id = $${params.length + 2} RETURNING *`;
      params.push(hashedPassword, id);
    } else {
      query += ` WHERE id = $${params.length + 1} RETURNING *`;
      params.push(id);
    }
    const result = await pool.query(query, params);
    if (result.rows.length === 0) return res.status(404).json({ success: false, error: 'Kullanıcı bulunamadı' });
    res.json({ success: true, user: result.rows[0] });
  } catch (error) {
    console.error('User update hatası:', error);
    res.status(500).json({ success: false, error: error.message });
  }
});

// DELETE /api/users/:id - Kullanıcı sil
router.delete("/:id", authenticateToken, checkPermission('users.delete'), async (req, res) => { // Bu endpoint server.js'den taşındı
  try {
    const { id } = req.params;
    if (id === '1') {
        return res.status(403).json({ success: false, error: 'Admin kullanıcısı silinemez.' });
    }
    const result = await pool.query(`DELETE FROM users WHERE id = $1 RETURNING *`, [id]);
    if (result.rows.length === 0) return res.status(404).json({ success: false, error: 'Kullanıcı bulunamadı' });
    res.json({ success: true, message: 'Kullanıcı başarıyla silindi' });
  } catch (error) {
    if (error.code === '23503') {
        return res.status(409).json({ success: false, error: 'Bu kullanıcı başka kayıtlarda (sipariş, müşteri vb.) kullanıldığı için silinemez. Önce kullanıcıyı pasif hale getirmeyi deneyin.' });
    }
    console.error('User delete hatası:', error);
    res.status(500).json({ success: false, error: error.message });
  }
});

module.exports = router;