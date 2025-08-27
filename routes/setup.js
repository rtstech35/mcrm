const express = require('express');
const bcrypt = require('bcryptjs');
const { Pool } = require('pg');
const router = express.Router();

// Database bağlantısı
const pool = new Pool({
    connectionString: process.env.DATABASE_URL,
    ssl: { rejectUnauthorized: false }
});

// Test verilerini oluştur - tek endpoint
router.post('/create-test-data', async (req, res) => {
    try {
        console.log('🔧 Test verileri oluşturuluyor...');
        
        // 1. Rolleri Türkçeye çevir
        await pool.query("UPDATE roles SET name = 'Yönetici' WHERE name = 'Admin'");
        await pool.query("UPDATE roles SET name = 'Satış Temsilcisi' WHERE name = 'Manager'");
        await pool.query("UPDATE roles SET name = 'Üretim Personeli' WHERE name = 'Employee'");
        await pool.query("UPDATE roles SET name = 'Sevkiyat Personeli' WHERE name = 'Viewer'");
        
        // Eksik rolleri ekle
        await pool.query(`
            INSERT INTO roles (name, description) VALUES 
            ('Muhasebe Personeli', 'Muhasebe işlemleri')
            ON CONFLICT (name) DO NOTHING
        `);
        
        console.log('✅ Roller Türkçeye çevrildi');
        
        // 2. Test kullanıcıları oluştur
        const testUsers = [
            { username: 'admin', password: '123456', full_name: 'Sistem Yöneticisi', email: 'admin@crm.com', role_name: 'Yönetici' },
            { username: 'satis', password: '123456', full_name: 'Satış Temsilcisi', email: 'satis@crm.com', role_name: 'Satış Temsilcisi' },
            { username: 'uretim', password: '123456', full_name: 'Üretim Personeli', email: 'uretim@crm.com', role_name: 'Üretim Personeli' },
            { username: 'sevkiyat', password: '123456', full_name: 'Sevkiyat Personeli', email: 'sevkiyat@crm.com', role_name: 'Sevkiyat Personeli' },
            { username: 'muhasebe', password: '123456', full_name: 'Muhasebe Personeli', email: 'muhasebe@crm.com', role_name: 'Muhasebe Personeli' }
        ];
        
        for (const user of testUsers) {
            // Rol ID'sini al
            const roleResult = await pool.query('SELECT id FROM roles WHERE name = $1', [user.role_name]);
            if (roleResult.rows.length === 0) {
                console.log(`⚠️ Rol bulunamadı: ${user.role_name}`);
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
                console.log(`✅ Kullanıcı güncellendi: ${user.username}`);
            } else {
                // Yeni kullanıcı ekle
                await pool.query(`
                    INSERT INTO users (username, password_hash, full_name, email, role_id, department_id, is_active)
                    VALUES ($1, $2, $3, $4, $5, 1, true)
                `, [user.username, hashedPassword, user.full_name, user.email, roleId]);
                console.log(`✅ Yeni kullanıcı eklendi: ${user.username}`);
            }
        }
        
        res.json({ 
            success: true, 
            message: 'Test verileri başarıyla oluşturuldu! Kullanıcılar: admin/123456, satis/123456, uretim/123456, sevkiyat/123456, muhasebe/123456' 
        });
        
    } catch (error) {
        console.error('❌ Test veri oluşturma hatası:', error);
        res.status(500).json({ 
            success: false, 
            message: `Hata: ${error.message}` 
        });
    }
});

module.exports = router;