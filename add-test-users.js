require("dotenv").config();
const { Pool } = require("pg");

const pool = new Pool({
    connectionString: process.env.DATABASE_URL,
    ssl: { rejectUnauthorized: false },
});

async function addTestUsers() {
    try {
        console.log('Test kullanıcıları ekleniyor...');

        // Rolleri Türkçe olarak güncelle
        await pool.query(`
            UPDATE roles SET name = 'Yönetici' WHERE name = 'admin';
            UPDATE roles SET name = 'Satış Temsilcisi' WHERE name = 'sales_rep';
            UPDATE roles SET name = 'Üretim Personeli' WHERE name = 'production';
            UPDATE roles SET name = 'Sevkiyat Personeli' WHERE name = 'shipping';
            UPDATE roles SET name = 'Muhasebe Personeli' WHERE name = 'accounting';
        `);

        // Basit şifre hash'i (production'da bcrypt kullanın)
        const password = '$2a$10$92IXUNpkjO0rOQ5byMi.Ye4oKoEa3Ro9llC/.og/at2.uheWG/igi'; // 'password'

        // Test kullanıcıları ekle
        const testUsers = [
            {
                username: 'admin',
                password_hash: password,
                full_name: 'Yönetici Kullanıcı',
                email: 'admin@test.com',
                role: 'Yönetici'
            },
            {
                username: 'satis',
                password_hash: password,
                full_name: 'Satış Temsilcisi',
                email: 'satis@test.com',
                role: 'Satış Temsilcisi'
            },
            {
                username: 'uretim',
                password_hash: password,
                full_name: 'Üretim Personeli',
                email: 'uretim@test.com',
                role: 'Üretim Personeli'
            },
            {
                username: 'sevkiyat',
                password_hash: password,
                full_name: 'Sevkiyat Personeli',
                email: 'sevkiyat@test.com',
                role: 'Sevkiyat Personeli'
            },
            {
                username: 'muhasebe',
                password_hash: password,
                full_name: 'Muhasebe Personeli',
                email: 'muhasebe@test.com',
                role: 'Muhasebe Personeli'
            }
        ];

        for (const user of testUsers) {
            // Rol ID'sini al
            const roleResult = await pool.query('SELECT id FROM roles WHERE name = $1', [user.role]);
            if (roleResult.rows.length === 0) {
                console.log(`Rol bulunamadı: ${user.role}`);
                continue;
            }
            const roleId = roleResult.rows[0].id;

            // Kullanıcı zaten var mı kontrol et
            const existingUser = await pool.query('SELECT id FROM users WHERE username = $1', [user.username]);
            
            if (existingUser.rows.length > 0) {
                // Kullanıcı varsa güncelle
                await pool.query(`
                    UPDATE users 
                    SET password_hash = $1, full_name = $2, email = $3, role_id = $4, is_active = true
                    WHERE username = $5
                `, [user.password_hash, user.full_name, user.email, roleId, user.username]);
                console.log(`✓ ${user.username} kullanıcısı güncellendi`);
            } else {
                // Yeni kullanıcı ekle
                await pool.query(`
                    INSERT INTO users (username, password_hash, full_name, email, role_id, is_active)
                    VALUES ($1, $2, $3, $4, $5, true)
                `, [user.username, user.password_hash, user.full_name, user.email, roleId]);
                console.log(`✓ ${user.username} kullanıcısı eklendi`);
            }
        }

        console.log('\n=== Test Kullanıcıları ===');
        console.log('Kullanıcı Adı: admin, Şifre: 123456 (Yönetici)');
        console.log('Kullanıcı Adı: satis, Şifre: 123456 (Satış Temsilcisi)');
        console.log('Kullanıcı Adı: uretim, Şifre: 123456 (Üretim Personeli)');
        console.log('Kullanıcı Adı: sevkiyat, Şifre: 123456 (Sevkiyat Personeli)');
        console.log('Kullanıcı Adı: muhasebe, Şifre: 123456 (Muhasebe Personeli)');
        console.log('========================\n');

    } catch (error) {
        console.error('Hata:', error);
    } finally {
        process.exit();
    }
}

addTestUsers();