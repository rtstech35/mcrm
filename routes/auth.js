const express = require('express');
const bcrypt = require('bcryptjs');
const jwt = require('jsonwebtoken');
const pool = require('../config/database');
require("dotenv").config();

const router = express.Router();
const JWT_SECRET = process.env.JWT_SECRET;

router.post("/register", async (req, res) => {
  try {
    const { username, password, full_name, email, role_id, department_id } = req.body;
    const existingUser = await pool.query("SELECT * FROM users WHERE username = $1", [username]);
    if (existingUser.rows.length > 0) {
      return res.status(400).json({ error: "Kullanıcı zaten mevcut" });
    }
    const hashedPassword = await bcrypt.hash(password, 10);
    await pool.query(
      "INSERT INTO users (username, password_hash, full_name, email, role_id, department_id, is_active) VALUES ($1, $2, $3, $4, $5, $6, $7)",
      [username, hashedPassword, full_name || username, email, role_id || 1, department_id || 5, true]
    );
    res.json({ success: true, message: "Kullanıcı başarıyla eklendi" });
  } catch (err) {
    console.error("Register hatası:", err);
    res.status(500).json({ error: "Kayıt sırasında hata oluştu" });
  }
});

router.post("/login", async (req, res) => {
  try {
    const { username, password } = req.body;
    console.log(`🔒 Login attempt for user: ${username}`);
    
    const result = await pool.query(`
      SELECT u.*, r.name as role_name, r.permissions, d.name as department_name
      FROM users u
      LEFT JOIN roles r ON u.role_id = r.id
      LEFT JOIN departments d ON u.department_id = d.id
      WHERE u.username = $1
    `, [username]);
    
    if (result.rows.length === 0) {
      console.log(`❌ Login failed: User '${username}' not found.`);
      return res.status(401).json({ error: "Kullanıcı adı veya şifre hatalı" });
    }
    
    const user = result.rows[0];
    
    if (!user.is_active) {
        console.log(`❌ Login failed: User '${username}' is not active.`);
        return res.status(403).json({ error: "Kullanıcı hesabınız pasif durumdadır. Lütfen yönetici ile iletişime geçin." });
    }

    if (!user.role_name) {
        console.log(`❌ Login failed: User '${username}' has no assigned role.`);
        return res.status(403).json({ error: "Hesabınıza bir rol atanmamış. Lütfen yönetici ile iletişime geçin." });
    }

    const isMatch = await bcrypt.compare(password, user.password_hash);
    if (!isMatch) {
      console.log(`❌ Login failed: Password mismatch for user '${username}'.`);
      return res.status(401).json({ error: "Kullanıcı adı veya şifre hatalı" });
    }

    console.log(`✅ Login successful for user: ${username}, Role: ${user.role_name}`);
    const token = jwt.sign(
      { userId: user.id, username: user.username, role: user.role_name, permissions: user.permissions || {} },
      JWT_SECRET || "fallback_secret_key_change_in_production",
      { expiresIn: "24h" }
    );

    res.json({ 
        success: true, 
        token, 
        user: { 
            id: user.id, username: user.username, full_name: user.full_name, 
            role_id: user.role_id, role_name: user.role_name, 
            department_id: user.department_id, department_name: user.department_name, 
            permissions: user.permissions || {} 
        } 
    });
  } catch (err) {
    console.error("Login hatası:", err);
    res.status(500).json({ error: "Sunucu hatası: " + err.message });
  }
});

module.exports = router;