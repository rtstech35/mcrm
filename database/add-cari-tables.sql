-- İrsaliyeler tablosu
CREATE TABLE IF NOT EXISTS delivery_notes (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    delivery_note_number VARCHAR(50) UNIQUE NOT NULL,
    customer_id INTEGER NOT NULL,
    order_id INTEGER,
    delivery_date DATE NOT NULL,
    total_amount DECIMAL(10,2) NOT NULL DEFAULT 0,
    notes TEXT,
    signature_data TEXT, -- Base64 imza verisi
    is_invoiced BOOLEAN DEFAULT FALSE,
    invoice_id INTEGER,
    created_by INTEGER,
    created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
    updated_at DATETIME DEFAULT CURRENT_TIMESTAMP,
    FOREIGN KEY (customer_id) REFERENCES customers(id),
    FOREIGN KEY (order_id) REFERENCES orders(id),
    FOREIGN KEY (invoice_id) REFERENCES invoices(id),
    FOREIGN KEY (created_by) REFERENCES users(id)
);

-- İrsaliye kalemleri tablosu
CREATE TABLE IF NOT EXISTS delivery_note_items (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    delivery_note_id INTEGER NOT NULL,
    product_id INTEGER NOT NULL,
    quantity DECIMAL(10,2) NOT NULL,
    unit_price DECIMAL(10,2) NOT NULL,
    total_price DECIMAL(10,2) NOT NULL,
    unit VARCHAR(20) DEFAULT 'adet',
    created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
    FOREIGN KEY (delivery_note_id) REFERENCES delivery_notes(id),
    FOREIGN KEY (product_id) REFERENCES products(id)
);

-- Faturalar tablosu
CREATE TABLE IF NOT EXISTS invoices (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    invoice_number VARCHAR(50) UNIQUE NOT NULL,
    customer_id INTEGER NOT NULL,
    invoice_date DATE NOT NULL,
    due_date DATE,
    total_amount DECIMAL(10,2) NOT NULL DEFAULT 0,
    paid_amount DECIMAL(10,2) NOT NULL DEFAULT 0,
    remaining_amount DECIMAL(10,2) NOT NULL DEFAULT 0,
    status VARCHAR(20) DEFAULT 'unpaid', -- unpaid, partial, paid
    notes TEXT,
    created_by INTEGER,
    created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
    updated_at DATETIME DEFAULT CURRENT_TIMESTAMP,
    FOREIGN KEY (customer_id) REFERENCES customers(id),
    FOREIGN KEY (created_by) REFERENCES users(id)
);

-- Fatura kalemleri tablosu
CREATE TABLE IF NOT EXISTS invoice_items (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    invoice_id INTEGER NOT NULL,
    delivery_note_id INTEGER,
    product_id INTEGER NOT NULL,
    quantity DECIMAL(10,2) NOT NULL,
    unit_price DECIMAL(10,2) NOT NULL,
    total_price DECIMAL(10,2) NOT NULL,
    unit VARCHAR(20) DEFAULT 'adet',
    created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
    FOREIGN KEY (invoice_id) REFERENCES invoices(id),
    FOREIGN KEY (delivery_note_id) REFERENCES delivery_notes(id),
    FOREIGN KEY (product_id) REFERENCES products(id)
);

-- Kasalar tablosu
CREATE TABLE IF NOT EXISTS cash_registers (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    name VARCHAR(100) NOT NULL,
    type VARCHAR(20) NOT NULL, -- cash, bank, pos
    balance DECIMAL(10,2) NOT NULL DEFAULT 0,
    is_active BOOLEAN DEFAULT TRUE,
    created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
    updated_at DATETIME DEFAULT CURRENT_TIMESTAMP
);

-- Tahsilatlar tablosu
CREATE TABLE IF NOT EXISTS payments (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    customer_id INTEGER NOT NULL,
    invoice_id INTEGER,
    payment_date DATE NOT NULL,
    amount DECIMAL(10,2) NOT NULL,
    payment_method VARCHAR(20) NOT NULL, -- cash, transfer, pos
    cash_register_id INTEGER NOT NULL,
    reference_number VARCHAR(100),
    notes TEXT,
    created_by INTEGER,
    created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
    FOREIGN KEY (customer_id) REFERENCES customers(id),
    FOREIGN KEY (invoice_id) REFERENCES invoices(id),
    FOREIGN KEY (cash_register_id) REFERENCES cash_registers(id),
    FOREIGN KEY (created_by) REFERENCES users(id)
);

-- Cari hesap hareketleri tablosu
CREATE TABLE IF NOT EXISTS account_movements (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    customer_id INTEGER NOT NULL,
    movement_date DATE NOT NULL,
    movement_type VARCHAR(20) NOT NULL, -- invoice, payment, adjustment
    reference_id INTEGER, -- invoice_id veya payment_id
    reference_number VARCHAR(100),
    description TEXT,
    debit_amount DECIMAL(10,2) DEFAULT 0, -- borç
    credit_amount DECIMAL(10,2) DEFAULT 0, -- alacak
    balance DECIMAL(10,2) DEFAULT 0,
    created_by INTEGER,
    created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
    FOREIGN KEY (customer_id) REFERENCES customers(id),
    FOREIGN KEY (created_by) REFERENCES users(id)
);

-- Varsayılan kasaları ekle
INSERT OR IGNORE INTO cash_registers (name, type, balance) VALUES 
('Nakit Kasa', 'cash', 0),
('Banka Hesabı', 'bank', 0),
('POS Cihazı', 'pos', 0);

-- İrsaliye numarası için sequence
CREATE TABLE IF NOT EXISTS sequences (
    name VARCHAR(50) PRIMARY KEY,
    current_value INTEGER DEFAULT 0
);

INSERT OR IGNORE INTO sequences (name, current_value) VALUES 
('delivery_note', 1000),
('invoice', 2000);