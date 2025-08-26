-- Departman tablosuna yeni kolonlar ekle
-- Bu script mevcut database'i günceller

-- Code kolonu ekle (eğer yoksa)
DO $$ 
BEGIN
    IF NOT EXISTS (SELECT 1 FROM information_schema.columns WHERE table_name = 'departments' AND column_name = 'code') THEN
        ALTER TABLE departments ADD COLUMN code VARCHAR(10) UNIQUE;
        COMMENT ON COLUMN departments.code IS 'Departman kısa kodu (örn: SALES, PROD)';
    END IF;
END $$;

-- Manager_id kolonu ekle (eğer yoksa)
DO $$ 
BEGIN
    IF NOT EXISTS (SELECT 1 FROM information_schema.columns WHERE table_name = 'departments' AND column_name = 'manager_id') THEN
        ALTER TABLE departments ADD COLUMN manager_id INTEGER;
        COMMENT ON COLUMN departments.manager_id IS 'Departman yöneticisinin user ID si';
    END IF;
END $$;

-- is_active kolonu ekle (eğer yoksa)
DO $$ 
BEGIN
    IF NOT EXISTS (SELECT 1 FROM information_schema.columns WHERE table_name = 'departments' AND column_name = 'is_active') THEN
        ALTER TABLE departments ADD COLUMN is_active BOOLEAN DEFAULT true;
        COMMENT ON COLUMN departments.is_active IS 'Departmanın aktif olup olmadığını belirtir';
    END IF;
END $$;

-- Foreign key constraint ekle (eğer yoksa)
DO $$ 
BEGIN
    IF NOT EXISTS (
        SELECT 1 FROM information_schema.table_constraints 
        WHERE constraint_name = 'departments_manager_id_fkey' 
        AND table_name = 'departments'
    ) THEN
        ALTER TABLE departments ADD CONSTRAINT departments_manager_id_fkey 
        FOREIGN KEY (manager_id) REFERENCES users(id);
    END IF;
END $$;

-- Mevcut departmanları güncelle
UPDATE departments SET 
    is_active = true,
    code = CASE 
        WHEN name ILIKE '%satış%' OR name ILIKE '%sales%' THEN 'SALES'
        WHEN name ILIKE '%üretim%' OR name ILIKE '%production%' THEN 'PROD'
        WHEN name ILIKE '%sevkiyat%' OR name ILIKE '%shipping%' THEN 'SHIP'
        WHEN name ILIKE '%muhasebe%' OR name ILIKE '%accounting%' THEN 'ACC'
        WHEN name ILIKE '%it%' OR name ILIKE '%bilgi%' THEN 'IT'
        WHEN name ILIKE '%insan%' OR name ILIKE '%hr%' THEN 'HR'
        WHEN name ILIKE '%kalite%' OR name ILIKE '%quality%' THEN 'QC'
        ELSE UPPER(LEFT(name, 4))
    END
WHERE is_active IS NULL OR code IS NULL;

-- Başarı mesajı
DO $$ 
BEGIN
    RAISE NOTICE 'Departman tablosu başarıyla güncellendi!';
END $$;
