-- Randevu ve görevler tablosunu oluştur
-- Bu script mevcut database'e appointments tablosunu ekler

-- appointments tablosunu oluştur (eğer yoksa)
CREATE TABLE IF NOT EXISTS appointments (
    id SERIAL PRIMARY KEY,
    title VARCHAR(200) NOT NULL,
    description TEXT,
    
    -- Randevu türü
    type VARCHAR(50) NOT NULL, -- 'appointment', 'task', 'visit', 'call', 'meeting'
    priority VARCHAR(20) DEFAULT 'medium', -- 'low', 'medium', 'high', 'urgent'
    
    -- Tarih ve saat bilgileri
    start_date DATE NOT NULL,
    start_time TIME,
    end_date DATE,
    end_time TIME,
    all_day BOOLEAN DEFAULT false,
    
    -- İlişkili veriler
    customer_id INTEGER REFERENCES customers(id), -- Hangi müşteri ile ilgili
    order_id INTEGER REFERENCES orders(id), -- Hangi sipariş ile ilgili
    assigned_to INTEGER REFERENCES users(id) NOT NULL, -- Kime atandı
    
    -- Konum bilgileri
    location TEXT, -- Randevu yeri
    address TEXT, -- Adres
    latitude DECIMAL(10, 8), -- GPS koordinatları
    longitude DECIMAL(11, 8),
    
    -- Durum ve takip
    status VARCHAR(20) DEFAULT 'pending', -- 'pending', 'in_progress', 'completed', 'cancelled', 'postponed'
    completion_notes TEXT, -- Tamamlandığında notlar
    completion_date TIMESTAMP, -- Tamamlanma tarihi
    
    -- Hatırlatma
    reminder_minutes INTEGER DEFAULT 15, -- Kaç dakika önce hatırlatma
    reminder_sent BOOLEAN DEFAULT false, -- Hatırlatma gönderildi mi
    
    -- Tekrarlama (gelecek özellik)
    is_recurring BOOLEAN DEFAULT false,
    recurrence_pattern JSONB, -- Tekrarlama kuralları
    
    -- Meta bilgiler
    created_by INTEGER REFERENCES users(id),
    created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
    updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
);

-- Randevu katılımcıları tablosu (toplantılar için)
CREATE TABLE IF NOT EXISTS appointment_participants (
    id SERIAL PRIMARY KEY,
    appointment_id INTEGER REFERENCES appointments(id) ON DELETE CASCADE,
    user_id INTEGER REFERENCES users(id),
    customer_contact_id INTEGER, -- Müşteri yetkili kişisi (şimdilik sadece ID)
    participant_type VARCHAR(20) DEFAULT 'attendee', -- 'organizer', 'attendee', 'optional'
    response_status VARCHAR(20) DEFAULT 'pending', -- 'pending', 'accepted', 'declined', 'tentative'
    created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
);

-- İndeksler ekle
CREATE INDEX IF NOT EXISTS idx_appointments_assigned_to ON appointments(assigned_to);
CREATE INDEX IF NOT EXISTS idx_appointments_customer_id ON appointments(customer_id);
CREATE INDEX IF NOT EXISTS idx_appointments_start_date ON appointments(start_date);
CREATE INDEX IF NOT EXISTS idx_appointments_status ON appointments(status);
CREATE INDEX IF NOT EXISTS idx_appointments_type ON appointments(type);

CREATE INDEX IF NOT EXISTS idx_appointment_participants_appointment_id ON appointment_participants(appointment_id);
CREATE INDEX IF NOT EXISTS idx_appointment_participants_user_id ON appointment_participants(user_id);

-- Örnek randevular oluştur
DO $$ 
DECLARE
    user_record RECORD;
    customer_record RECORD;
    appointment_count INTEGER := 0;
    appointment_types TEXT[] := ARRAY['appointment', 'task', 'visit', 'call', 'meeting'];
    priorities TEXT[] := ARRAY['low', 'medium', 'high', 'urgent'];
    statuses TEXT[] := ARRAY['pending', 'in_progress', 'completed'];
BEGIN
    -- Her kullanıcı için örnek randevular oluştur
    FOR user_record IN SELECT id, full_name FROM users LIMIT 3 LOOP
        FOR customer_record IN SELECT id, company_name FROM customers LIMIT 2 LOOP
            appointment_count := appointment_count + 1;
            
            -- Farklı tarihlerde randevular oluştur
            INSERT INTO appointments (
                title, description, type, priority,
                start_date, start_time, end_date, end_time, all_day,
                assigned_to, customer_id,
                location, address,
                status, reminder_minutes, created_by
            ) VALUES (
                customer_record.company_name || ' ile ' || appointment_types[((appointment_count - 1) % 5) + 1],
                'Örnek randevu açıklaması - ' || customer_record.company_name || ' firması ile yapılacak ' || appointment_types[((appointment_count - 1) % 5) + 1],
                appointment_types[((appointment_count - 1) % 5) + 1],
                priorities[((appointment_count - 1) % 4) + 1],
                CURRENT_DATE + (appointment_count || ' days')::INTERVAL,
                CASE 
                    WHEN appointment_count % 3 = 1 THEN '09:00:00'::TIME
                    WHEN appointment_count % 3 = 2 THEN '14:00:00'::TIME
                    ELSE '16:30:00'::TIME
                END,
                CASE 
                    WHEN appointment_types[((appointment_count - 1) % 5) + 1] = 'meeting' THEN CURRENT_DATE + (appointment_count || ' days')::INTERVAL
                    ELSE NULL
                END,
                CASE 
                    WHEN appointment_types[((appointment_count - 1) % 5) + 1] = 'meeting' THEN '17:00:00'::TIME
                    ELSE NULL
                END,
                false,
                user_record.id,
                customer_record.id,
                customer_record.company_name || ' Ofisi',
                'Örnek adres - ' || customer_record.company_name,
                statuses[((appointment_count - 1) % 3) + 1],
                CASE 
                    WHEN priorities[((appointment_count - 1) % 4) + 1] = 'urgent' THEN 5
                    WHEN priorities[((appointment_count - 1) % 4) + 1] = 'high' THEN 15
                    ELSE 30
                END,
                1
            );
            
            -- Bazı randevuları tamamlanmış olarak işaretle
            IF appointment_count % 4 = 0 THEN
                UPDATE appointments SET 
                    status = 'completed',
                    completion_notes = 'Randevu başarıyla tamamlandı. Müşteri ile görüşme yapıldı.',
                    completion_date = CURRENT_TIMESTAMP - (appointment_count || ' hours')::INTERVAL
                WHERE id = (SELECT MAX(id) FROM appointments);
            END IF;
        END LOOP;
    END LOOP;
    
    -- Bazı görevler ekle (müşteri bağımsız)
    FOR user_record IN SELECT id, full_name FROM users LIMIT 2 LOOP
        appointment_count := appointment_count + 1;
        
        INSERT INTO appointments (
            title, description, type, priority,
            start_date, start_time, all_day,
            assigned_to, location,
            status, reminder_minutes, created_by
        ) VALUES (
            'Haftalık Rapor Hazırlama',
            'Haftalık satış raporunu hazırla ve yöneticiye sun',
            'task',
            'medium',
            CURRENT_DATE + 1,
            '10:00:00'::TIME,
            false,
            user_record.id,
            'Ofis',
            'pending',
            60,
            1
        );
    END LOOP;
    
    RAISE NOTICE 'Randevu sistemi başarıyla oluşturuldu ve % örnek randevu eklendi!', appointment_count;
END $$;
