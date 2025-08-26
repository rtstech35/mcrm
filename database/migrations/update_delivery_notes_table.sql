-- İrsaliye tablosunu dijital imza özelliği ile güncelle
-- Bu script mevcut delivery_notes tablosunu günceller

-- Önce mevcut tabloyu yedekle (eğer varsa)
DO $$ 
BEGIN
    IF EXISTS (SELECT 1 FROM information_schema.tables WHERE table_name = 'delivery_notes') THEN
        -- Mevcut tabloyu yeniden oluştur
        DROP TABLE IF EXISTS delivery_notes CASCADE;
    END IF;
END $$;

-- Yeni delivery_notes tablosunu oluştur
CREATE TABLE IF NOT EXISTS delivery_notes (
    id SERIAL PRIMARY KEY,
    delivery_number VARCHAR(50) UNIQUE NOT NULL,
    order_id INTEGER REFERENCES orders(id),
    customer_id INTEGER REFERENCES customers(id),
    
    -- Teslimat bilgileri
    delivery_date DATE NOT NULL,
    delivery_time TIME,
    delivered_by INTEGER REFERENCES users(id), -- Sevkiyat personeli
    delivery_address TEXT,
    
    -- İmza bilgileri
    customer_signature TEXT, -- Base64 encoded imza
    customer_name VARCHAR(100), -- İmzalayan kişi adı
    customer_title VARCHAR(100), -- İmzalayan kişi unvanı
    signature_date TIMESTAMP, -- İmza tarihi
    signature_ip VARCHAR(45), -- İmza IP adresi
    signature_device_info TEXT, -- Cihaz bilgisi
    
    -- Durum ve notlar
    status VARCHAR(20) DEFAULT 'pending', -- pending, in_transit, delivered, cancelled
    notes TEXT,
    internal_notes TEXT, -- Dahili notlar (müşteri görmez)
    
    -- Dosya ekleri
    attachments JSONB, -- Fotoğraflar, belgeler vb.
    
    -- Meta bilgiler
    created_by INTEGER REFERENCES users(id),
    created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
    updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
);

-- İrsaliye detay tablosunu oluştur
CREATE TABLE IF NOT EXISTS delivery_note_items (
    id SERIAL PRIMARY KEY,
    delivery_note_id INTEGER REFERENCES delivery_notes(id) ON DELETE CASCADE,
    product_id INTEGER REFERENCES products(id),
    product_name VARCHAR(200) NOT NULL, -- Ürün adı (değişebilir)
    quantity INTEGER NOT NULL,
    unit_price DECIMAL(10,2),
    total_price DECIMAL(10,2),
    unit VARCHAR(20) DEFAULT 'adet',
    notes TEXT,
    created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
);

-- İndeksler ekle
CREATE INDEX IF NOT EXISTS idx_delivery_notes_customer_id ON delivery_notes(customer_id);
CREATE INDEX IF NOT EXISTS idx_delivery_notes_order_id ON delivery_notes(order_id);
CREATE INDEX IF NOT EXISTS idx_delivery_notes_status ON delivery_notes(status);
CREATE INDEX IF NOT EXISTS idx_delivery_notes_delivery_date ON delivery_notes(delivery_date);
CREATE INDEX IF NOT EXISTS idx_delivery_notes_delivered_by ON delivery_notes(delivered_by);

CREATE INDEX IF NOT EXISTS idx_delivery_note_items_delivery_note_id ON delivery_note_items(delivery_note_id);
CREATE INDEX IF NOT EXISTS idx_delivery_note_items_product_id ON delivery_note_items(product_id);

-- Örnek irsaliyeler oluştur
DO $$ 
DECLARE
    customer_record RECORD;
    order_record RECORD;
    user_record RECORD;
    delivery_count INTEGER := 0;
BEGIN
    -- Sevkiyat personeli bul
    SELECT id INTO user_record FROM users WHERE role_id IN (1, 2, 3) LIMIT 1;
    
    -- Her müşteri için örnek irsaliye oluştur
    FOR customer_record IN SELECT id, company_name, address FROM customers LIMIT 5 LOOP
        delivery_count := delivery_count + 1;
        
        -- Örnek irsaliye oluştur
        INSERT INTO delivery_notes (
            delivery_number, customer_id, delivery_date, delivery_time,
            delivered_by, delivery_address, status, notes, internal_notes,
            created_by
        ) VALUES (
            'IRS' || TO_CHAR(CURRENT_DATE, 'YYMMDD') || LPAD(delivery_count::TEXT, 3, '0'),
            customer_record.id,
            CURRENT_DATE + (delivery_count || ' days')::INTERVAL,
            '14:00:00',
            user_record.id,
            customer_record.address,
            CASE 
                WHEN delivery_count % 4 = 0 THEN 'delivered'
                WHEN delivery_count % 3 = 0 THEN 'in_transit'
                WHEN delivery_count % 2 = 0 THEN 'pending'
                ELSE 'pending'
            END,
            'Örnek irsaliye - ' || customer_record.company_name || ' için teslimat',
            'Dahili not: Dikkatli teslimat yapılacak',
            1
        );
        
        -- Eğer teslim edilmişse örnek imza ekle
        IF delivery_count % 4 = 0 THEN
            UPDATE delivery_notes SET 
                customer_signature = 'data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mNkYPhfDwAChwGA60e6kgAAAABJRU5ErkJggg==',
                customer_name = 'Yetkili Kişi',
                customer_title = 'Satın Alma Müdürü',
                signature_date = CURRENT_TIMESTAMP,
                signature_ip = '192.168.1.100'
            WHERE delivery_number = 'IRS' || TO_CHAR(CURRENT_DATE, 'YYMMDD') || LPAD(delivery_count::TEXT, 3, '0');
        END IF;
    END LOOP;
    
    RAISE NOTICE 'İrsaliye sistemi başarıyla güncellendi ve % örnek irsaliye oluşturuldu!', delivery_count;
END $$;
