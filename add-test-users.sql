-- Rolleri Türkçeye çevir
UPDATE roles SET name = 'Yönetici' WHERE name = 'admin';
UPDATE roles SET name = 'Satış Temsilcisi' WHERE name = 'sales_rep';
UPDATE roles SET name = 'Üretim Personeli' WHERE name = 'production';
UPDATE roles SET name = 'Sevkiyat Personeli' WHERE name = 'shipping';
UPDATE roles SET name = 'Muhasebe Personeli' WHERE name = 'accounting';

-- Test kullanıcıları ekle (şifre: 123456)
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
    is_active = true;