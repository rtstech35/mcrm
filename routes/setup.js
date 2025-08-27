const express = require('express');
const bcrypt = require('bcryptjs');
const pool = require('../config/database');
const router = express.Router();

// Rolleri Türkçeye çevir
router.post('/update-roles', async (req, res) => {
    try {
        const { roles } = req.body;
        
        for (const role of roles) {
            await pool.query(
                'UPDATE roles SET name = $1 WHERE name = $2',
                [role.new_name, role.old_name]
            );
        }
        
        res.json({ success: true, message: 'Roller başarıyla güncellendi' });
    } catch (error) {
        console.error('Rol güncelleme hatası:', error);
        res.status(500).json({ success: false, message: error.message });
    }
});

// Test kullanıcıları oluştur
router.post('/create-test-users', async (req, res) => {
    try {
        const { users } = req.body;
        
        for (const user of users) {
            // Rol ID'sini al
            const roleResult = await pool.query('SELECT id FROM roles WHERE name = $1', [user.role_name]);
            if (roleResult.rows.length === 0) {
                console.log(`Rol bulunamadı: ${user.role_name}`);
                continue;
            }
            const roleId = roleResult.rows[0].id;
            
            // Şifreyi hash'le
            const hashedPassword = await bcrypt.hash(user.password, 10);
            
            // Kullanıcı zaten var mı kontrol et
            const existingUser = await pool.query('SELECT id FROM users WHERE username = $1', [user.username]);
            
            if (existingUser.rows.length > 0) {
                // Kullanıcı varsa güncelle
                await pool.query(`
                    UPDATE users 
                    SET password_hash = $1, full_name = $2, email = $3, role_id = $4, is_active = true
                    WHERE username = $5
                `, [hashedPassword, user.full_name, user.email, roleId, user.username]);
            } else {
                // Yeni kullanıcı ekle
                await pool.query(`
                    INSERT INTO users (username, password_hash, full_name, email, role_id, is_active)
                    VALUES ($1, $2, $3, $4, $5, true)
                `, [user.username, hashedPassword, user.full_name, user.email, roleId]);
            }
        }
        
        res.json({ success: true, message: 'Test kullanıcıları başarıyla oluşturuldu' });
    } catch (error) {
        console.error('Test kullanıcı oluşturma hatası:', error);
        res.status(500).json({ success: false, message: error.message });
    }
});

module.exports = router;