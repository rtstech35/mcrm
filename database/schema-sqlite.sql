-- SQLite için Saha CRM Sistemi Veritabanı Şeması

-- Roller tablosu
CREATE TABLE IF NOT EXISTS roles (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    name VARCHAR(50) UNIQUE NOT NULL,
    description TEXT,
    permissions TEXT,
    created_at DATETIME DEFAULT CURRENT_TIMESTAMP
);

-- Departmanlar tablosu
CREATE TABLE IF NOT EXISTS departments (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    name VARCHAR(100) NOT NULL,
    description TEXT,
    created_at DATETIME DEFAULT CURRENT_TIMESTAMP
);

-- Kullanıcılar tablosu
CREATE TABLE IF NOT EXISTS users (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
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
    is_active BOOLEAN DEFAULT 1,
    created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
    updated_at DATETIME DEFAULT CURRENT_TIMESTAMP
);

-- Müşteriler tablosu
CREATE TABLE IF NOT EXISTS customers (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
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
    created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
    updated_at DATETIME DEFAULT CURRENT_TIMESTAMP
);

-- Ürünler tablosu
CREATE TABLE IF NOT EXISTS products (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    name VARCHAR(200) NOT NULL,
    description TEXT,
    unit_price DECIMAL(10,2) NOT NULL,
    unit VARCHAR(20) DEFAULT 'adet',
    is_active BOOLEAN DEFAULT 1,
    created_at DATETIME DEFAULT CURRENT_TIMESTAMP
);

-- Siparişler tablosu
CREATE TABLE IF NOT EXISTS orders (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    order_number VARCHAR(50) UNIQUE NOT NULL,
    customer_id INTEGER REFERENCES customers(id),
    sales_rep_id INTEGER REFERENCES users(id),
    order_date DATE NOT NULL,
    delivery_date DATE,
    payment_due_date DATE,
    total_amount DECIMAL(12,2) NOT NULL,
    status VARCHAR(20) DEFAULT 'pending',
    notes TEXT,
    created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
    updated_at DATETIME DEFAULT CURRENT_TIMESTAMP
);

-- Varsayılan veriler
INSERT OR IGNORE INTO roles (name, description, permissions) VALUES
('admin', 'Sistem Yöneticisi', '{"all": true}'),
('sales_rep', 'Satış Temsilcisi', '{"customers": ["read", "create", "update"], "orders": ["read", "create"]}'),
('production', 'Üretim Personeli', '{"orders": ["read", "update"], "production": ["read", "create", "update"]}'),
('shipping', 'Sevkiyat Personeli', '{"orders": ["read"], "delivery": ["read", "create", "update"]}'),
('accounting', 'Muhasebe Personeli', '{"all": ["read"], "accounting": ["read", "create", "update"]}'),
('warehouse', 'Depo Personeli', '{"orders": ["read"], "delivery": ["read"], "inventory": ["read", "create", "update"]}');

INSERT OR IGNORE INTO departments (name, description) VALUES
('Yönetim', 'Genel Yönetim ve İdari İşler'),
('Satış', 'Satış ve Pazarlama Departmanı'),
('Üretim', 'Üretim Departmanı'),
('Sevkiyat', 'Sevkiyat ve Lojistik'),
('Muhasebe', 'Mali İşler ve Muhasebe'),
('Depo', 'Depo ve Envanter Yönetimi');