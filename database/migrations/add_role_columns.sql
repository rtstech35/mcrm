-- Rol tablosuna yeni kolonlar ekle
-- Bu script mevcut database'i günceller

-- Level kolonu ekle (eğer yoksa)
DO $$ 
BEGIN
    IF NOT EXISTS (SELECT 1 FROM information_schema.columns WHERE table_name = 'roles' AND column_name = 'level') THEN
        ALTER TABLE roles ADD COLUMN level INTEGER DEFAULT 2;
        COMMENT ON COLUMN roles.level IS '1: Viewer, 2: Employee, 3: Manager, 4: Admin';
    END IF;
END $$;

-- is_active kolonu ekle (eğer yoksa)
DO $$ 
BEGIN
    IF NOT EXISTS (SELECT 1 FROM information_schema.columns WHERE table_name = 'roles' AND column_name = 'is_active') THEN
        ALTER TABLE roles ADD COLUMN is_active BOOLEAN DEFAULT true;
        COMMENT ON COLUMN roles.is_active IS 'Rolün aktif olup olmadığını belirtir';
    END IF;
END $$;

-- Mevcut rolleri güncelle
UPDATE roles SET 
    level = CASE 
        WHEN name ILIKE '%admin%' THEN 4
        WHEN name ILIKE '%manager%' THEN 3
        WHEN name ILIKE '%employee%' OR name ILIKE '%sales%' OR name ILIKE '%production%' OR name ILIKE '%shipping%' OR name ILIKE '%accounting%' OR name ILIKE '%warehouse%' THEN 2
        ELSE 1
    END,
    is_active = true
WHERE level IS NULL OR is_active IS NULL;

-- Temel rollerin varlığını kontrol et ve eksikleri ekle
INSERT INTO roles (name, description, level, is_active, permissions) 
SELECT * FROM (VALUES
    ('Admin', 'Sistem Yöneticisi - Tüm yetkilere sahip', 4, true, '{"all": true}'::jsonb),
    ('Manager', 'Departman Yöneticisi - Yönetim yetkileri', 3, true, '{"department": ["read", "create", "update"], "reports": ["read"]}'::jsonb),
    ('Employee', 'Çalışan - Temel işlem yetkileri', 2, true, '{"basic": ["read", "create", "update"]}'::jsonb),
    ('Viewer', 'Görüntüleyici - Sadece okuma yetkisi', 1, true, '{"all": ["read"]}'::jsonb)
) AS new_roles(name, description, level, is_active, permissions)
WHERE NOT EXISTS (
    SELECT 1 FROM roles WHERE roles.name = new_roles.name
);

-- Başarı mesajı
DO $$ 
BEGIN
    RAISE NOTICE 'Rol tablosu başarıyla güncellendi!';
END $$;
