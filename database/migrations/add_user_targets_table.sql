-- Kullanıcı hedefleri tablosunu oluştur
-- Bu script mevcut database'e user_targets tablosunu ekler

-- user_targets tablosunu oluştur (eğer yoksa)
CREATE TABLE IF NOT EXISTS user_targets (
    id SERIAL PRIMARY KEY,
    user_id INTEGER REFERENCES users(id) ON DELETE CASCADE,
    target_year INTEGER NOT NULL,
    target_month INTEGER NOT NULL, -- 1-12 arası
    
    -- Satış hedefleri
    sales_target DECIMAL(12,2) DEFAULT 0, -- Aylık satış hedefi (TL)
    
    -- Ziyaret hedefleri
    visit_target INTEGER DEFAULT 0, -- Aylık ziyaret hedefi
    
    -- Üretim hedefleri (üretim personeli için)
    production_target INTEGER DEFAULT 0, -- Aylık üretim hedefi (adet)
    
    -- Sevkiyat hedefleri
    shipping_target INTEGER DEFAULT 0, -- Aylık sevkiyat hedefi (adet)
    
    -- Ciro hedefleri
    revenue_target DECIMAL(12,2) DEFAULT 0, -- Aylık ciro hedefi (TL)
    
    -- Tahsilat hedefleri (muhasebe için)
    collection_target DECIMAL(12,2) DEFAULT 0, -- Aylık tahsilat hedefi (TL)
    
    -- Meta bilgiler
    notes TEXT, -- Hedef notları
    is_active BOOLEAN DEFAULT true,
    created_by INTEGER REFERENCES users(id),
    created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
    updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
    
    -- Benzersizlik: Bir kullanıcının aynı ay için sadece bir hedefi olabilir
    UNIQUE(user_id, target_year, target_month)
);

-- İndeksler ekle
CREATE INDEX IF NOT EXISTS idx_user_targets_user_id ON user_targets(user_id);
CREATE INDEX IF NOT EXISTS idx_user_targets_year_month ON user_targets(target_year, target_month);
CREATE INDEX IF NOT EXISTS idx_user_targets_active ON user_targets(is_active);

-- Örnek hedefler ekle (mevcut kullanıcılar için)
DO $$ 
DECLARE
    user_record RECORD;
    current_year INTEGER := EXTRACT(YEAR FROM CURRENT_DATE);
    current_month INTEGER := EXTRACT(MONTH FROM CURRENT_DATE);
BEGIN
    -- Her kullanıcı için bu ay ve gelecek ay hedefleri oluştur
    FOR user_record IN SELECT id, role_id FROM users LOOP
        -- Bu ay için hedef
        INSERT INTO user_targets (
            user_id, target_year, target_month,
            sales_target, visit_target, production_target, revenue_target, collection_target,
            notes, created_by
        ) VALUES (
            user_record.id, current_year, current_month,
            CASE 
                WHEN user_record.role_id = 1 THEN 150000 -- Admin
                WHEN user_record.role_id = 2 THEN 80000  -- Manager
                WHEN user_record.role_id = 3 THEN 50000  -- Employee
                ELSE 25000 -- Diğer roller
            END,
            CASE 
                WHEN user_record.role_id IN (1, 2, 3) THEN 20 -- Satış rolleri
                ELSE 5 -- Diğer roller
            END,
            CASE 
                WHEN user_record.role_id = 3 THEN 100 -- Employee üretim hedefi
                ELSE 0
            END,
            CASE 
                WHEN user_record.role_id = 1 THEN 200000 -- Admin ciro
                WHEN user_record.role_id = 2 THEN 120000 -- Manager ciro
                ELSE 60000 -- Diğer roller
            END,
            CASE 
                WHEN user_record.role_id IN (1, 2) THEN 80000 -- Yönetici rolleri tahsilat
                ELSE 30000 -- Diğer roller
            END,
            'Otomatik oluşturulan örnek hedef',
            1
        ) ON CONFLICT (user_id, target_year, target_month) DO NOTHING;
        
        -- Gelecek ay için hedef (eğer aralık değilse)
        IF current_month < 12 THEN
            INSERT INTO user_targets (
                user_id, target_year, target_month,
                sales_target, visit_target, production_target, revenue_target, collection_target,
                notes, created_by
            ) VALUES (
                user_record.id, current_year, current_month + 1,
                CASE 
                    WHEN user_record.role_id = 1 THEN 160000 -- Admin (artırılmış)
                    WHEN user_record.role_id = 2 THEN 85000  -- Manager (artırılmış)
                    WHEN user_record.role_id = 3 THEN 55000  -- Employee (artırılmış)
                    ELSE 28000 -- Diğer roller (artırılmış)
                END,
                CASE 
                    WHEN user_record.role_id IN (1, 2, 3) THEN 22 -- Satış rolleri (artırılmış)
                    ELSE 6 -- Diğer roller (artırılmış)
                END,
                CASE 
                    WHEN user_record.role_id = 3 THEN 110 -- Employee üretim hedefi (artırılmış)
                    ELSE 0
                END,
                CASE 
                    WHEN user_record.role_id = 1 THEN 220000 -- Admin ciro (artırılmış)
                    WHEN user_record.role_id = 2 THEN 130000 -- Manager ciro (artırılmış)
                    ELSE 65000 -- Diğer roller (artırılmış)
                END,
                CASE 
                    WHEN user_record.role_id IN (1, 2) THEN 85000 -- Yönetici rolleri tahsilat (artırılmış)
                    ELSE 32000 -- Diğer roller (artırılmış)
                END,
                'Otomatik oluşturulan gelecek ay hedefi',
                1
            ) ON CONFLICT (user_id, target_year, target_month) DO NOTHING;
        END IF;
    END LOOP;
    
    RAISE NOTICE 'Kullanıcı hedefleri tablosu başarıyla oluşturuldu ve örnek veriler eklendi!';
END $$;
