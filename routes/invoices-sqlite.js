const express = require('express');
const sqlite3 = require('sqlite3').verbose();
const path = require('path');
const router = express.Router();

const dbPath = path.join(__dirname, '..', 'database', 'saha_crm.db');
const db = new sqlite3.Database(dbPath);

// Fatura tablosunu oluştur (eğer yoksa)
db.run(`
  CREATE TABLE IF NOT EXISTS invoices (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    invoice_number VARCHAR(50) UNIQUE NOT NULL,
    customer_id INTEGER NOT NULL,
    invoice_date DATE NOT NULL,
    due_date DATE,
    total_amount DECIMAL(10,2) NOT NULL,
    tax_amount DECIMAL(10,2) DEFAULT 0,
    status VARCHAR(20) DEFAULT 'draft',
    payment_date DATE,
    notes TEXT,
    created_by INTEGER,
    created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
    updated_at DATETIME DEFAULT CURRENT_TIMESTAMP,
    FOREIGN KEY (customer_id) REFERENCES customers(id),
    FOREIGN KEY (created_by) REFERENCES users(id)
  )
`);

db.run(`
  CREATE TABLE IF NOT EXISTS invoice_items (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    invoice_id INTEGER NOT NULL,
    product_id INTEGER,
    product_name VARCHAR(200) NOT NULL,
    quantity DECIMAL(10,2) NOT NULL,
    unit_price DECIMAL(10,2) NOT NULL,
    total_price DECIMAL(10,2) NOT NULL,
    unit VARCHAR(20) DEFAULT 'adet',
    created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
    FOREIGN KEY (invoice_id) REFERENCES invoices(id),
    FOREIGN KEY (product_id) REFERENCES products(id)
  )
`);

// Tüm faturaları listele
router.get('/', (req, res) => {
  const { status, customer_id } = req.query;
  
  let query = `SELECT i.*, c.company_name as customer_name, u.full_name as created_by_name
               FROM invoices i 
               LEFT JOIN customers c ON i.customer_id = c.id 
               LEFT JOIN users u ON i.created_by = u.id
               WHERE 1=1`;
  let params = [];
  
  if (status) {
    query += ' AND i.status = ?';
    params.push(status);
  }
  
  if (customer_id) {
    query += ' AND i.customer_id = ?';
    params.push(customer_id);
  }
  
  query += ' ORDER BY i.created_at DESC';
  
  db.all(query, params, (err, invoices) => {
    if (err) return res.status(500).json({ error: err.message });
    res.json(invoices);
  });
});

// İrsaliyelerden fatura oluştur
router.post('/from-delivery-notes', (req, res) => {
  const { customer_id, delivery_note_ids } = req.body;
  const userId = req.user.userId;
  
  if (!customer_id || !delivery_note_ids || delivery_note_ids.length === 0) {
    return res.status(400).json({ error: 'Müşteri ID ve irsaliye ID\'leri gerekli' });
  }
  
  // İrsaliyeleri kontrol et
  const placeholders = delivery_note_ids.map(() => '?').join(',');
  const checkQuery = `SELECT * FROM delivery_notes WHERE id IN (${placeholders}) AND customer_id = ? AND status = 'delivered' AND is_invoiced = 0`;
  
  db.all(checkQuery, [...delivery_note_ids, customer_id], (err, deliveryNotes) => {
    if (err) return res.status(500).json({ error: err.message });
    
    if (deliveryNotes.length !== delivery_note_ids.length) {
      return res.status(400).json({ error: 'Bazı irsaliyeler bulunamadı veya zaten faturalandı' });
    }
    
    // Fatura numarası oluştur
    const date = new Date();
    const year = date.getFullYear().toString().slice(-2);
    const month = (date.getMonth() + 1).toString().padStart(2, '0');
    const day = date.getDate().toString().padStart(2, '0');
    const datePrefix = 'FAT' + year + month + day;
    
    // Bugünün fatura sayısını bul
    db.get(
      'SELECT COUNT(*) as count FROM invoices WHERE DATE(created_at) = DATE("now")',
      (err, result) => {
        if (err) return res.status(500).json({ error: err.message });
        
        const invoiceCount = (result.count + 1).toString().padStart(3, '0');
        const invoiceNumber = datePrefix + invoiceCount;
        
        // Toplam tutarı hesapla
        const totalAmount = deliveryNotes.reduce((sum, dn) => sum + parseFloat(dn.total_amount), 0);
        const taxAmount = totalAmount * 0.18; // %18 KDV
        
        // Fatura oluştur
        const invoiceDate = new Date().toISOString().split('T')[0];
        const dueDate = new Date(Date.now() + 30 * 24 * 60 * 60 * 1000).toISOString().split('T')[0]; // 30 gün sonra
        
        db.run(
          `INSERT INTO invoices (invoice_number, customer_id, invoice_date, due_date, 
           total_amount, tax_amount, status, created_by) 
           VALUES (?, ?, ?, ?, ?, ?, 'draft', ?)`,
          [invoiceNumber, customer_id, invoiceDate, dueDate, totalAmount + taxAmount, taxAmount, userId],
          function(err) {
            if (err) return res.status(500).json({ error: err.message });
            
            const invoiceId = this.lastID;
            
            // İrsaliye kalemlerini fatura kalemlerine kopyala
            let itemsProcessed = 0;
            const totalItems = deliveryNotes.length;
            
            deliveryNotes.forEach(deliveryNote => {
              // İrsaliye kalemlerini al
              db.all(
                'SELECT * FROM delivery_note_items WHERE delivery_note_id = ?',
                [deliveryNote.id],
                (err, items) => {
                  if (err) {
                    console.error('İrsaliye kalemleri alınamadı:', err);
                    return;
                  }
                  
                  // Her kalemi fatura kalemine ekle
                  items.forEach(item => {
                    db.run(
                      `INSERT INTO invoice_items (invoice_id, product_id, product_name, 
                       quantity, unit_price, total_price, unit) 
                       VALUES (?, ?, ?, ?, ?, ?, ?)`,
                      [invoiceId, item.product_id, item.product_name || `Ürün ${item.product_id}`, 
                       item.quantity, item.unit_price, item.total_price, item.unit || 'adet']
                    );
                  });
                  
                  // İrsaliyeyi faturalandı olarak işaretle
                  db.run(
                    'UPDATE delivery_notes SET is_invoiced = 1, invoice_id = ? WHERE id = ?',
                    [invoiceId, deliveryNote.id]
                  );
                  
                  itemsProcessed++;
                  if (itemsProcessed === totalItems) {
                    res.json({ 
                      id: invoiceId,
                      invoice_number: invoiceNumber,
                      message: 'Fatura başarıyla oluşturuldu' 
                    });
                  }
                }
              );
            });
          }
        );
      }
    );
  });
});

// Fatura detayını getir
router.get('/:id', (req, res) => {
  const query = `SELECT i.*, c.company_name, c.address, c.contact_person, c.phone, c.email,
                 u.full_name as created_by_name
                 FROM invoices i 
                 LEFT JOIN customers c ON i.customer_id = c.id 
                 LEFT JOIN users u ON i.created_by = u.id
                 WHERE i.id = ?`;
  
  db.get(query, [req.params.id], (err, invoice) => {
    if (err) return res.status(500).json({ error: err.message });
    if (!invoice) return res.status(404).json({ error: 'Fatura bulunamadı' });
    res.json(invoice);
  });
});

// Fatura kalemlerini getir
router.get('/:id/items', (req, res) => {
  const query = `SELECT ii.*, p.name as product_name 
                 FROM invoice_items ii 
                 LEFT JOIN products p ON ii.product_id = p.id 
                 WHERE ii.invoice_id = ?`;
  
  db.all(query, [req.params.id], (err, items) => {
    if (err) return res.status(500).json({ error: err.message });
    res.json(items);
  });
});

// Fatura durumunu güncelle
router.put('/:id/status', (req, res) => {
  const { status } = req.body;
  
  db.run(
    'UPDATE invoices SET status = ?, updated_at = CURRENT_TIMESTAMP WHERE id = ?',
    [status, req.params.id],
    function(err) {
      if (err) return res.status(500).json({ error: err.message });
      res.json({ message: 'Fatura durumu güncellendi' });
    }
  );
});

// Faturayı gönder
router.put('/:id/send', (req, res) => {
  db.run(
    'UPDATE invoices SET status = "sent", updated_at = CURRENT_TIMESTAMP WHERE id = ?',
    [req.params.id],
    function(err) {
      if (err) return res.status(500).json({ error: err.message });
      
      // E-posta gönderme işlemi burada yapılabilir
      console.log(`Fatura ${req.params.id} müşteriye gönderildi`);
      
      res.json({ message: 'Fatura müşteriye gönderildi' });
    }
  );
});

// Faturayı ödendi olarak işaretle
router.put('/:id/mark-paid', (req, res) => {
  const paymentDate = new Date().toISOString().split('T')[0];
  
  db.run(
    'UPDATE invoices SET status = "paid", payment_date = ?, updated_at = CURRENT_TIMESTAMP WHERE id = ?',
    [paymentDate, req.params.id],
    function(err) {
      if (err) return res.status(500).json({ error: err.message });
      res.json({ message: 'Fatura ödendi olarak işaretlendi' });
    }
  );
});

module.exports = router;