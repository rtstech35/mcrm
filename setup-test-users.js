const { Pool } = require('pg');

const pool = new Pool({
    connectionString: process.env.DATABASE_URL,
    ssl: process.env.NODE_ENV === 'production' ? { rejectUnauthorized: false } : false
});

async function setupTestUsers() {
    try {
        console.log('Test kullanıcıları ekleniyor...');

        // Rolleri Türkçeye çevir
        await pool.query(`
            UPDATE roles SET name = 'Yönetici' WHERE name = 'admin';
            UPDATE roles SET name = 'Satış Temsilcisi' WHERE name = 'sales_rep';
            UPDATE roles SET name = 'Üretim Personeli' WHERE name = 'production';
            UPDATE roles SET name = 'Sevkiyat Personeli' WHERE name = 'shipping';
            UPDATE roles SET name = 'Muhasebe Personeli' WHERE name = 'accounting';
        `);

        // Test kullanıcıları ekle (şifre: 123456)
        await pool.query(`
            INSERT INTO users (username, password_hash, full_name, email, role_id, is_active) 
            VALUES 
            ('admin', '$2a$10$92IXUNpkjO0rOQ5byMi.Ye4oKoEa3Ro9llC/.og/at2.uheWG/igi', 'Yönetici Kullanıcı', 'admin@test.com', (SELECT id FROM roles WHERE name = 'Yönetici'), true),
            ('satis', '$2a$10$92IXUNpkjO0rOQ5byMi.Ye4oKoEa3Ro9llC/.og/at2.uheWG/igi', 'Satış Temsilcisi', 'satis@test.com', (SELECT id FROM roles WHERE name = 'Satış Temsilcisi'), true),
            ('uretim', '$2a$10$92IXUNpkjO0rOQ5byMi.Ye4oKoEa3Ro9llC/.og/at2.uheWG/igi', 'Üretim Personeli', 'uretim@test.com', (SELECT id FROM roles WHERE name = 'Üretim Personeli'), true),
            ('sevkiyat', '$2a$10$92IXUNpkjO0rOQ5byMi.Ye4oKoEa3Ro9llC/.og/at2.uheWG/igi', 'Sevkiyat Personeli', 'sevkiyat@test.com', (SELECT id FROM roles WHERE name = 'Sevkiyat Personeli'), true),
            ('muhasebe', '$2a$10$92IXUNpkjO0rOQ5byMi.Ye4oKoEa3Ro9llC/.og/at2.uheWG/igi', 'Muhasebe Personeli', 'muhasebe@test.com', (SELECT id FROM roles WHERE name = 'Muhasebe Personeli'), true)
            ON CONFLICT (username) DO UPDATE SET
                password_hash = EXCLUDED.password_hash,
                full_name = EXCLUDED.full_name,
                email = EXCLUDED.email,
                role_id = EXCLUDED.role_id,
                is_active = true
        `);

        console.log('✓ Test kullanıcıları başarıyla eklendi!');
        console.log('\n=== Test Kullanıcıları ===');
        console.log('admin / 123456 (Yönetici)');
        console.log('satis / 123456 (Satış Temsilcisi)');
        console.log('uretim / 123456 (Üretim Personeli)');
        console.log('sevkiyat / 123456 (Sevkiyat Personeli)');
        console.log('muhasebe / 123456 (Muhasebe Personeli)');

    } catch (error) {
        console.error('Hata:', error);
    } finally {
        await pool.end();
        process.exit();
    }
}

setupTestUsers();