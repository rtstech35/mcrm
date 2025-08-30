-- Saha CRM Sistemi Veritabanı Şeması

-- Roller tablosu
CREATE TABLE IF NOT EXISTS roles (
    id SERIAL PRIMARY KEY,
    name VARCHAR(50) UNIQUE NOT NULL,
    description TEXT,
    level INTEGER DEFAULT 2, -- 1: Viewer, 2: Employee, 3: Manager, 4: Admin
    is_active BOOLEAN DEFAULT true,
    permissions JSONB,
    created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
);

-- Departmanlar tablosu
CREATE TABLE IF NOT EXISTS departments (
    id SERIAL PRIMARY KEY,
    name VARCHAR(100) NOT NULL,
    description TEXT,
    code VARCHAR(10) UNIQUE, -- Departman kısa kodu
    manager_id INTEGER, -- Departman yöneticisi (foreign key sonra eklenecek)
    is_active BOOLEAN DEFAULT true,
    created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
);

-- Kullanıcılar tablosu
CREATE TABLE IF NOT EXISTS users (
    id SERIAL PRIMARY KEY,
    username VARCHAR(50) UNIQUE NOT NULL,
    email VARCHAR(100) UNIQUE NOT NULL,
    password_hash VARCHAR(255) NOT NULL,
    phone VARCHAR(20),
    full_name VARCHAR(100) NOT NULL,
    department_id INTEGER REFERENCES departments(id),
    role_id INTEGER REFERENCES roles(id),
    monthly_sales_target DECIMAL(12,2) DEFAULT 0,
    monthly_production_target DECIMAL(12,2) DEFAULT 0,
    monthly_revenue_target DECIMAL(12,2) DEFAULT 0,
    is_active BOOLEAN DEFAULT true,
    created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
    updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
);

-- Müşteriler tablosu
CREATE TABLE IF NOT EXISTS customers (
    id SERIAL PRIMARY KEY,
    company_name VARCHAR(200) NOT NULL,
    contact_person VARCHAR(100),
    phone VARCHAR(20),
    email VARCHAR(100),
    address TEXT,
    latitude DECIMAL(10,8),
    longitude DECIMAL(11,8),
    current_account_balance DECIMAL(12,2) DEFAULT 0,
    annual_revenue DECIMAL(12,2) DEFAULT 0,
    assigned_sales_rep INTEGER REFERENCES users(id),
    customer_status VARCHAR(20) DEFAULT 'potential',
    created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
    updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
);

-- Ürünler tablosu
CREATE TABLE IF NOT EXISTS products (
    id SERIAL PRIMARY KEY,
    name VARCHAR(200) NOT NULL,
    description TEXT,
    unit_price DECIMAL(10,2) NOT NULL,
    unit VARCHAR(20) DEFAULT 'adet',
    is_active BOOLEAN DEFAULT true,
    created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
);

-- Siparişler tablosu
CREATE TABLE IF NOT EXISTS orders (
    id SERIAL PRIMARY KEY,
    order_number VARCHAR(50) UNIQUE NOT NULL,
    customer_id INTEGER REFERENCES customers(id),
    sales_rep_id INTEGER REFERENCES users(id),
    order_date DATE NOT NULL,
    delivery_date DATE,
    payment_due_date DATE,
    total_amount DECIMAL(12,2) NOT NULL,
    status VARCHAR(20) DEFAULT 'pending',
    notes TEXT,
    created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
    updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
);

-- Sipariş detayları tablosu
CREATE TABLE IF NOT EXISTS order_items (
    id SERIAL PRIMARY KEY,
    order_id INTEGER REFERENCES orders(id),
    product_id INTEGER REFERENCES products(id),
    product_name VARCHAR(200) NOT NULL,
    quantity DECIMAL(10,2) NOT NULL,
    unit_price DECIMAL(10,2) NOT NULL,
    total_price DECIMAL(12,2) NOT NULL,
    unit VARCHAR(20) DEFAULT 'adet',
    created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
);

-- Müşteri ziyaretleri tablosu
CREATE TABLE IF NOT EXISTS customer_visits (
    id SERIAL PRIMARY KEY,
    customer_id INTEGER REFERENCES customers(id),
    sales_rep_id INTEGER REFERENCES users(id),
    visit_date TIMESTAMP NOT NULL,
    visit_type VARCHAR(20) NOT NULL,
    result VARCHAR(20) NOT NULL,
    products_discussed INTEGER[],
    notes TEXT,
    next_contact_date DATE,
    created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
);

-- İrsaliyeler tablosu
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

-- İrsaliye detay tablosu
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

-- Cari hesap hareketleri tablosu
CREATE TABLE IF NOT EXISTS account_transactions (
    id SERIAL PRIMARY KEY,
    customer_id INTEGER REFERENCES customers(id),
    transaction_type VARCHAR(20) NOT NULL,
    amount DECIMAL(12,2) NOT NULL,
    transaction_date DATE NOT NULL,
    description TEXT,
    reference_number VARCHAR(50),
    created_by INTEGER REFERENCES users(id),
    created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
);

-- Kullanıcı hedefleri tablosu
CREATE TABLE IF NOT EXISTS user_targets (
    id SERIAL PRIMARY KEY,
    user_id INTEGER REFERENCES users(id) ON DELETE CASCADE,
    target_year INTEGER NOT NULL,
    target_month INTEGER NOT NULL, -- 1-12 arası

    -- Satış hedefleri
    sales_target DECIMAL(12,2) DEFAULT 0, -- Aylık satış hedefi (TL)
    sales_achieved DECIMAL(12,2) DEFAULT 0, -- Gerçekleşen satış

    -- Ziyaret hedefleri
    visit_target INTEGER DEFAULT 0, -- Aylık ziyaret hedefi
    visit_achieved INTEGER DEFAULT 0, -- Gerçekleşen ziyaret

    -- Üretim hedefleri (üretim personeli için)
    production_target INTEGER DEFAULT 0, -- Aylık üretim hedefi (adet)
    production_achieved INTEGER DEFAULT 0, -- Gerçekleşen üretim

    -- Ciro hedefleri
    revenue_target DECIMAL(12,2) DEFAULT 0, -- Aylık ciro hedefi (TL)
    revenue_achieved DECIMAL(12,2) DEFAULT 0, -- Gerçekleşen ciro

    -- Tahsilat hedefleri (muhasebe için)
    collection_target DECIMAL(12,2) DEFAULT 0, -- Aylık tahsilat hedefi (TL)
    collection_achieved DECIMAL(12,2) DEFAULT 0, -- Gerçekleşen tahsilat

    -- Meta bilgiler
    notes TEXT, -- Hedef notları
    is_active BOOLEAN DEFAULT true,
    created_by INTEGER REFERENCES users(id),
    created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
    updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,

    -- Benzersizlik: Bir kullanıcının aynı ay için sadece bir hedefi olabilir
    UNIQUE(user_id, target_year, target_month)
);

-- Randevu ve görevler tablosu
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

-- Varsayılan veriler
INSERT INTO roles (id, name, description, level, is_active, permissions) VALUES
(1, 'Admin', 'Sistem yöneticisi - Tüm yetkiler', 4, true, '{"all": true}'),
(2, 'Satış Müdürü', 'Satış departmanı yöneticisi', 3, true, '{
    "customers": ["read", "create", "update", "delete"], "orders": ["read", "create", "update", "delete"], "delivery": ["read"], "appointments": ["read", "create", "update", "delete"], "accounting": ["read"],
    "admin_customers": true, "admin_orders": true, "admin_appointments": true,
    "sales_dashboard": true, "sales_customers": true, "sales_orders": true, "sales_delivery_notes": true, "sales_appointments": true, "sales_accounts": true, "sales_invoices": true, "sales_map": true
}'),
(3, 'Satış Personeli', 'Sadece kendi müşterilerini görür ve işlem yapar', 2, true, '{
    "customers": ["read", "read_own", "create"], "orders": ["read", "read_own", "create"], "appointments": ["read", "read_own", "create"], "visits": ["create"],
    "sales_dashboard": true, "sales_customers": true, "sales_orders": true, "sales_appointments": true, "sales_new_visit": true, "sales_map": true
}'),
(4, 'Depo Müdürü', 'Depo ve envanter yönetimi yöneticisi', 3, true, '{
    "products": ["read", "create", "update", "delete"], "delivery": ["read"],
    "admin_products": true, "admin_delivery_notes": true
}'),
(5, 'Depo Personeli', 'Depo ve envanter işlemleri', 2, true, '{
    "products": ["read", "update"],
    "admin_products": true
}'),
(6, 'Sevkiyat Sorumlusu', 'Sevkiyat yöneticisi, kendisine atanan sevkiyatları yönetir', 3, true, '{
    "delivery": ["read", "create", "update", "delete"],
    "shipping_dashboard": true, "shipping_delivery_notes": true, "shipping_map": true, "admin_delivery_notes": true
}'),
(7, 'Sevkiyatçı', 'Kendisine atanan sevkiyatları görür ve işlem yapar', 2, true, '{
    "delivery": ["read", "read_own", "update"],
    "shipping_dashboard": true, "shipping_delivery_notes": true, "shipping_map": true
}'),
(8, 'Üretim Müdürü', 'Üretim yöneticisi, tüm siparişleri görür ve işlem yapar', 3, true, '{
    "orders": ["read", "update"], "production": ["read", "update"],
    "production_dashboard": true, "production_orders": true, "admin_orders": true
}'),
(9, 'Üretim Personeli', 'Tüm siparişleri görür ve üretim işlemlerini yapar', 2, true, '{
    "orders": ["read", "update"], "production": ["read", "update"],
    "production_dashboard": true, "production_orders": true
}'),
(10, 'Muhasebe Müdürü', 'Muhasebe departmanı yöneticisi', 3, true, '{
    "accounting": ["read", "create", "update", "delete"], "customers": ["read"], "invoices": ["read", "create", "update", "delete"],
    "accounting_dashboard": true, "accounting_customers": true, "accounting_invoices": true, "accounting_accounts": true, "accounting_delivery_notes": true, "admin_accounts": true
}'),
(11, 'Muhasebe Personeli', 'Mali işler ve muhasebe işlemleri', 2, true, '{
    "accounting": ["read", "create", "update"], "customers": ["read"], "invoices": ["read", "create", "update"],
    "accounting_dashboard": true, "accounting_customers": true, "accounting_invoices": true, "accounting_accounts": true
}')
ON CONFLICT (id) DO UPDATE SET name = EXCLUDED.name, description = EXCLUDED.description, level = EXCLUDED.level, permissions = EXCLUDED.permissions;

INSERT INTO departments (id, name, description) VALUES
(1, 'Yönetim', 'Genel Yönetim ve İdari İşler'),
(2, 'Satış', 'Satış ve Pazarlama Departmanı'),
(3, 'Depo', 'Depo ve Envanter Yönetimi'),
(4, 'Sevkiyat', 'Sevkiyat ve Lojistik'),
(5, 'Üretim', 'Üretim Departmanı'),
(6, 'Muhasebe', 'Mali İşler ve Muhasebe'),
(7, 'IT', 'Bilgi Teknolojileri ve Sistem Yönetimi')
ON CONFLICT (id) DO UPDATE SET name = EXCLUDED.name, description = EXCLUDED.description;