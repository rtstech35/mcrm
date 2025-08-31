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
        WHEN name ILIKE '%admin%' THEN 4 -- Admin
        WHEN name ILIKE '%müdür%' OR name ILIKE '%sorumlusu%' THEN 3 -- Satış Müdürü, Depo Müdürü, Sevkiyat Sorumlusu etc.
        WHEN name ILIKE '%personeli%' OR name ILIKE '%temsilcisi%' OR name ILIKE '%sevkiyatçı%' THEN 2 -- Satış Personeli, Depo Personeli etc.
        ELSE 1
    END,
    is_active = true
WHERE level IS NULL OR is_active IS NULL;

-- Başarı mesajı
DO $$ 
BEGIN
    RAISE NOTICE 'Rol tablosu başarıyla güncellendi!';
END $$;
