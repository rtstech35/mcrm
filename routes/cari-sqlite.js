const express = require('express');
const router = express.Router();
const sqlite3 = require('sqlite3').verbose();
const path = require('path');
const PDFDocument = require('pdfkit');
const XLSX = require('xlsx');

// Türkçe karakter dönüşüm fonksiyonu
function turkishToEnglish(text) {
  const charMap = {
    'ç': 'c', 'Ç': 'C',
    'ğ': 'g', 'Ğ': 'G', 
    'ı': 'i', 'I': 'I',
    'İ': 'I', 'i': 'i',
    'ö': 'o', 'Ö': 'O',
    'ş': 's', 'Ş': 'S',
    'ü': 'u', 'Ü': 'U'
  };
  
  return text.replace(/[çÇğĞıIİiöÖşŞüÜ]/g, function(match) {
    return charMap[match] || match;
  });
}

// SQLite veritabanı bağlantısı
const dbPath = path.join(__dirname, '..', 'database', 'saha_crm.db');
const db = new sqlite3.Database(dbPath);

// İrsaliyeler listesi
router.get('/delivery-notes', (req, res) => {
  const query = `SELECT dn.*, c.company_name as customer_name, u.full_name as created_by_name,
                        CASE WHEN dn.is_invoiced = 1 THEN 'Faturalandı' ELSE 'Bekliyor' END as invoice_status,
                        CASE WHEN dn.signature_data IS NOT NULL AND dn.signature_data != '' THEN 'İmzalı' ELSE 'İmzasız' END as signature_status
                 FROM delivery_notes dn 
                 LEFT JOIN customers c ON dn.customer_id = c.id 
                 LEFT JOIN users u ON dn.created_by = u.id 
                 ORDER BY dn.delivery_date DESC, dn.created_at DESC`;
  
  console.log('İrsaliye sorgusu çalışıyor...');
  db.all(query, [], (err, rows) => {
    if (err) {
      console.error('İrsaliye sorgu hatası:', err.message);
      return res.status(500).json({ error: err.message });
    }
    console.log('Bulunan irsaliye sayısı:', rows.length);
    console.log('İrsaliyeler:', rows);
    res.json(rows);
  });
});

// Tek irsaliye getir
router.get('/delivery-notes/:id', (req, res) => {
  const query = `SELECT dn.*, c.company_name as customer_name 
                 FROM delivery_notes dn 
                 LEFT JOIN customers c ON dn.customer_id = c.id 
                 WHERE dn.id = ?`;
  
  db.get(query, [req.params.id], (err, row) => {
    if (err) return res.status(500).json({ error: err.message });
    if (!row) return res.status(404).json({ error: 'İrsaliye bulunamadı' });
    res.json(row);
  });
});

// İrsaliye kalemlerini getir
router.get('/delivery-notes/:id/items', (req, res) => {
  const query = `SELECT dni.*, p.name as product_name 
                 FROM delivery_note_items dni 
                 LEFT JOIN products p ON dni.product_id = p.id 
                 WHERE dni.delivery_note_id = ?`;
  
  db.all(query, [req.params.id], (err, rows) => {
    if (err) return res.status(500).json({ error: err.message });
    res.json(rows);
  });
});

// Müşteriye ait irsaliyeleri getir
router.get('/customers/:customerId/delivery-notes', (req, res) => {
  const query = `SELECT dn.*, 
                        CASE WHEN dn.is_invoiced = 1 THEN 'Faturalandı' ELSE 'Bekliyor' END as invoice_status
                 FROM delivery_notes dn 
                 WHERE dn.customer_id = ? 
                 ORDER BY dn.created_at DESC`;
  
  db.all(query, [req.params.customerId], (err, rows) => {
    if (err) return res.status(500).json({ error: err.message });
    res.json(rows);
  });
});





// İrsaliyelerden fatura oluştur
router.post('/invoices/from-delivery-notes', (req, res) => {
  const { customerId, deliveryNoteIds, manualInvoiceNumber } = req.body;
  const userId = req.user.userId;
  
  if (!deliveryNoteIds || deliveryNoteIds.length === 0) {
    return res.status(400).json({ error: 'En az bir irsaliye seçmelisiniz' });
  }
  
  // Fatura numarası oluştur
  db.get('SELECT current_value FROM sequences WHERE name = "invoice"', [], (err, seq) => {
    if (err) return res.status(500).json({ error: err.message });
    
    const invoiceNumber = manualInvoiceNumber || `FAT-${String(seq.current_value + 1).padStart(6, '0')}`;
    
    // Toplam tutarı hesapla
    const placeholders = deliveryNoteIds.map(() => '?').join(',');
    const totalQuery = `SELECT SUM(total_amount) as total FROM delivery_notes WHERE id IN (${placeholders}) AND customer_id = ?`;
    
    db.get(totalQuery, [...deliveryNoteIds, customerId], (err, result) => {
      if (err) return res.status(500).json({ error: err.message });
      
      const totalAmount = result.total || 0;
      
      // Fatura oluştur
      const insertQuery = `INSERT INTO invoices 
                          (invoice_number, customer_id, invoice_date, total_amount, remaining_amount, created_by) 
                          VALUES (?, ?, date('now'), ?, ?, ?)`;
      
      db.run(insertQuery, [invoiceNumber, customerId, totalAmount, totalAmount, userId], function(err) {
        if (err) return res.status(500).json({ error: err.message });
        
        const invoiceId = this.lastID;
        
        // İrsaliye kalemlerini al ve birleştir
        const getItemsQuery = `SELECT dni.product_id, dni.quantity, dni.unit_price, dni.unit, p.name as product_name
                              FROM delivery_note_items dni 
                              LEFT JOIN products p ON dni.product_id = p.id
                              WHERE dni.delivery_note_id IN (${placeholders})`;
        
        db.all(getItemsQuery, deliveryNoteIds, (err, items) => {
          if (err) return res.status(500).json({ error: err.message });
          
          // Aynı ürünleri birleştir
          const groupedItems = {};
          items.forEach(item => {
            const key = item.product_id;
            if (!groupedItems[key]) {
              groupedItems[key] = {
                product_id: item.product_id,
                quantity: 0,
                unit_price: parseFloat(item.unit_price),
                unit: item.unit
              };
            }
            groupedItems[key].quantity += parseFloat(item.quantity);
          });
          
          console.log('Birleştirilmiş ürünler:', groupedItems);
          
          // Birleştirilmiş kalemleri faturaya ekle
          const stmt = db.prepare(`INSERT INTO invoice_items 
                                  (invoice_id, product_id, quantity, unit_price, total_price, unit)
                                  VALUES (?, ?, ?, ?, ?, ?)`);
          
          Object.values(groupedItems).forEach(item => {
            const totalPrice = item.quantity * item.unit_price;
            stmt.run([invoiceId, item.product_id, item.quantity, item.unit_price, totalPrice, item.unit]);
          });
          
          stmt.finalize((err) => {
            if (err) return res.status(500).json({ error: err.message });
            
            // İrsaliyeleri faturalandı olarak işaretle
            const updateQuery = `UPDATE delivery_notes SET is_invoiced = 1, invoice_id = ? WHERE id IN (${placeholders})`;
            
            db.run(updateQuery, [invoiceId, ...deliveryNoteIds], (err) => {
              if (err) return res.status(500).json({ error: err.message });
              
              // Cari hesap hareketi oluştur
              const movementQuery = `INSERT INTO account_movements 
                                    (customer_id, movement_date, movement_type, reference_id, reference_number, description, debit_amount)
                                    VALUES (?, date('now'), 'invoice', ?, ?, ?, ?)`;
              
              db.run(movementQuery, [customerId, invoiceId, invoiceNumber, `${invoiceNumber} numaralı fatura`, totalAmount], (err) => {
                if (err) console.error('Cari hareket oluşturulamadı:', err);
                
                // Sequence güncelle
                db.run('UPDATE sequences SET current_value = current_value + 1 WHERE name = "invoice"', [], (err) => {
                  if (err) console.error('Sequence güncellenemedi:', err);
                  
                  res.json({ 
                    message: 'Fatura başarıyla oluşturuldu',
                    invoiceId: invoiceId,
                    invoiceNumber: invoiceNumber
                  });
                });
              });
            });
          });
        });
      });
    });
  });
});

// Tahsilat yap
router.post('/payments', (req, res) => {
  const { customerId, invoiceId, amount, paymentMethod, cashRegisterId, referenceNumber, notes } = req.body;
  const userId = req.user.userId;
  
  // Tahsilat kaydı oluştur
  const insertQuery = `INSERT INTO payments 
                      (customer_id, invoice_id, payment_date, amount, payment_method, cash_register_id, reference_number, notes, created_by)
                      VALUES (?, ?, date('now'), ?, ?, ?, ?, ?, ?)`;
  
  db.run(insertQuery, [customerId, invoiceId, amount, paymentMethod, cashRegisterId, referenceNumber, notes, userId], function(err) {
    if (err) return res.status(500).json({ error: err.message });
    
    // Fatura ödeme durumunu güncelle
    if (invoiceId) {
      db.run(`UPDATE invoices SET 
              paid_amount = paid_amount + ?, 
              remaining_amount = remaining_amount - ?,
              status = CASE 
                WHEN remaining_amount - ? <= 0 THEN 'paid'
                WHEN paid_amount + ? > 0 THEN 'partial'
                ELSE 'unpaid'
              END
              WHERE id = ?`, [amount, amount, amount, amount, invoiceId], (err) => {
        if (err) console.error('Fatura durumu güncellenemedi:', err);
      });
    }
    
    // Kasa bakiyesini güncelle
    db.run('UPDATE cash_registers SET balance = balance + ? WHERE id = ?', [amount, cashRegisterId], (err) => {
      if (err) console.error('Kasa bakiyesi güncellenemedi:', err);
    });
    
    // Cari hesap hareketi oluştur
    const movementQuery = `INSERT INTO account_movements 
                          (customer_id, movement_date, movement_type, reference_id, reference_number, description, credit_amount)
                          VALUES (?, date('now'), 'payment', ?, ?, ?, ?)`;
    
    db.run(movementQuery, [customerId, this.lastID, referenceNumber || `TAH-${this.lastID}`, `Tahsilat - ${paymentMethod}`, amount], (err) => {
      if (err) console.error('Cari hareket oluşturulamadı:', err);
      
      res.json({ message: 'Tahsilat başarıyla kaydedildi', paymentId: this.lastID });
    });
  });
});

// Müşteri cari hesap özeti
router.get('/customers/:customerId/account-summary', (req, res) => {
  const query = `SELECT 
                   SUM(debit_amount) as total_debit,
                   SUM(credit_amount) as total_credit,
                   SUM(debit_amount) - SUM(credit_amount) as balance
                 FROM account_movements 
                 WHERE customer_id = ?`;
  
  db.get(query, [req.params.customerId], (err, row) => {
    if (err) return res.status(500).json({ error: err.message });
    res.json({
      totalDebit: row.total_debit || 0,
      totalCredit: row.total_credit || 0,
      balance: row.balance || 0
    });
  });
});

// Müşteri cari hesap hareketleri
router.get('/customers/:customerId/movements', (req, res) => {
  const { start_date, end_date } = req.query;
  let query = `SELECT * FROM account_movements WHERE customer_id = ?`;
  let params = [req.params.customerId];
  
  if (start_date && end_date) {
    query += ` AND movement_date BETWEEN ? AND ?`;
    params.push(start_date, end_date);
  }
  
  query += ` ORDER BY movement_date DESC, created_at DESC`;
  
  db.all(query, params, (err, rows) => {
    if (err) return res.status(500).json({ error: err.message });
    res.json(rows);
  });
});

// Müşteriye ait faturaları getir
router.get('/customers/:customerId/invoices', (req, res) => {
  const query = `SELECT i.*, 
                        (i.total_amount - COALESCE(i.paid_amount, 0)) as remaining_amount,
                        CASE 
                          WHEN i.status = 'paid' THEN 'Ödendi'
                          WHEN i.status = 'partial' THEN 'Kısmi Ödendi' 
                          ELSE 'Ödenmedi'
                        END as status_text
                 FROM invoices i 
                 WHERE i.customer_id = ? 
                 ORDER BY i.invoice_date DESC`;
  
  db.all(query, [req.params.customerId], (err, rows) => {
    if (err) return res.status(500).json({ error: err.message });
    res.json(rows);
  });
});

// Müşteriye ait tahsilatları getir
router.get('/customers/:customerId/payments', (req, res) => {
  const query = `SELECT p.*, i.invoice_number, cr.name as cash_register_name
                 FROM payments p 
                 LEFT JOIN invoices i ON p.invoice_id = i.id
                 LEFT JOIN cash_registers cr ON p.cash_register_id = cr.id
                 WHERE p.customer_id = ? 
                 ORDER BY p.payment_date DESC`;
  
  db.all(query, [req.params.customerId], (err, rows) => {
    if (err) return res.status(500).json({ error: err.message });
    res.json(rows);
  });
});

// İrsaliye kalemlerini getir
router.get('/delivery-notes/:id/items', (req, res) => {
  const query = `SELECT dni.*, p.name as product_name 
                 FROM delivery_note_items dni 
                 LEFT JOIN products p ON dni.product_id = p.id 
                 WHERE dni.delivery_note_id = ?`;
  
  db.all(query, [req.params.id], (err, rows) => {
    if (err) return res.status(500).json({ error: err.message });
    res.json(rows);
  });
});

// Tek fatura getir
router.get('/invoices/:id', (req, res) => {
  const query = `SELECT i.*, c.company_name as customer_name,
                        CASE 
                          WHEN i.status = 'paid' THEN 'Ödendi'
                          WHEN i.status = 'partial' THEN 'Kısmi Ödendi' 
                          ELSE 'Ödenmedi'
                        END as status_text
                 FROM invoices i 
                 LEFT JOIN customers c ON i.customer_id = c.id
                 WHERE i.id = ?`;
  
  db.get(query, [req.params.id], (err, row) => {
    if (err) return res.status(500).json({ error: err.message });
    if (!row) return res.status(404).json({ error: 'Fatura bulunamadı' });
    res.json(row);
  });
});

// Fatura kalemlerini getir
router.get('/invoices/:id/items', (req, res) => {
  const query = `SELECT ii.*, p.name as product_name 
                 FROM invoice_items ii 
                 LEFT JOIN products p ON ii.product_id = p.id 
                 WHERE ii.invoice_id = ?`;
  
  db.all(query, [req.params.id], (err, rows) => {
    if (err) return res.status(500).json({ error: err.message });
    res.json(rows);
  });
});

// Faturaya dahil irsaliyeleri getir
router.get('/invoices/:id/delivery-notes', (req, res) => {
  const query = `SELECT dn.id, dn.delivery_note_number, dn.delivery_date
                 FROM delivery_notes dn 
                 WHERE dn.invoice_id = ?
                 ORDER BY dn.delivery_date`;
  
  db.all(query, [req.params.id], (err, rows) => {
    if (err) return res.status(500).json({ error: err.message });
    res.json(rows);
  });
});

// Fatura numarasını güncelle
router.put('/invoices/:id/update-number', (req, res) => {
  const { invoiceNumber } = req.body;
  
  if (!invoiceNumber) {
    return res.status(400).json({ error: 'Fatura numarası gerekli' });
  }
  
  // Aynı numaradan başka fatura var mı kontrol et
  db.get('SELECT id FROM invoices WHERE invoice_number = ? AND id != ?', [invoiceNumber, req.params.id], (err, existing) => {
    if (err) return res.status(500).json({ error: err.message });
    
    if (existing) {
      return res.status(400).json({ error: 'Bu fatura numarası zaten kullanılıyor' });
    }
    
    // Fatura numarasını güncelle
    db.run('UPDATE invoices SET invoice_number = ? WHERE id = ?', [invoiceNumber, req.params.id], function(err) {
      if (err) return res.status(500).json({ error: err.message });
      
      if (this.changes === 0) {
        return res.status(404).json({ error: 'Fatura bulunamadı' });
      }
      
      res.json({ message: 'Fatura numarası başarıyla güncellendi' });
    });
  });
});

// Müşteri ekstre PDF
router.get('/customers/:customerId/ekstre-pdf', (req, res) => {
  const { customerId } = req.params;
  const { start_date, end_date } = req.query;
  
  // Müşteri ve hareket bilgilerini al
  db.get('SELECT * FROM customers WHERE id = ?', [customerId], (err, customer) => {
    if (err) return res.status(500).json({ error: err.message });
    
    const query = `SELECT * FROM account_movements 
                   WHERE customer_id = ? AND movement_date BETWEEN ? AND ?
                   ORDER BY movement_date ASC`;
    
    db.all(query, [customerId, start_date, end_date], (err, movements) => {
      if (err) return res.status(500).json({ error: err.message });
      
      // PDF oluştur
      const doc = new PDFDocument();
      
      // Dosya adını düzenle
      const fileCompanyNamePDF = turkishToEnglish(customer.company_name).replace(/[^a-zA-Z0-9]/g, '');
      const fileName = `${fileCompanyNamePDF}-Cari-Ekstre.pdf`;
      
      res.setHeader('Content-Type', 'application/pdf');
      res.setHeader('Content-Disposition', `attachment; filename="${fileName}"`);
      
      doc.pipe(res);
      
      // Başlık
      doc.fontSize(20).text('MUSTERI EKSTRESI', { align: 'center' });
      doc.moveDown();
      
      // Müşteri bilgileri
      const convertedCompanyNamePDF = turkishToEnglish(customer.company_name);
      doc.fontSize(12)
         .text(`Musteri: ${convertedCompanyNamePDF}`)
         .text(`Tarih Araligi: ${start_date} - ${end_date}`)
         .moveDown();
      
      // Tablo başlıkları
      const startX = 50;
      let y = doc.y;
      
      doc.text('Tarih', startX, y)
         .text('Aciklama', startX + 80, y)
         .text('Borc', startX + 250, y)
         .text('Alacak', startX + 320, y)
         .text('Bakiye', startX + 390, y);
      
      y += 20;
      doc.moveTo(startX, y).lineTo(500, y).stroke();
      y += 10;
      
      // Hareketler
      let runningBalance = 0;
      movements.forEach(movement => {
        runningBalance += (movement.debit_amount || 0) - (movement.credit_amount || 0);
        
        doc.text(movement.movement_date, startX, y)
           .text(movement.description.substring(0, 20), startX + 80, y)
           .text((movement.debit_amount || 0).toString(), startX + 250, y)
           .text((movement.credit_amount || 0).toString(), startX + 320, y)
           .text(runningBalance.toString(), startX + 390, y);
        
        y += 15;
        
        if (y > 700) {
          doc.addPage();
          y = 50;
        }
      });
      
      doc.end();
    });
  });
});

// Müşteri ekstre Excel
router.get('/customers/:customerId/ekstre-excel', (req, res) => {
  const { customerId } = req.params;
  const { start_date, end_date } = req.query;
  
  // Müşteri ve hareket bilgilerini al
  db.get('SELECT * FROM customers WHERE id = ?', [customerId], (err, customer) => {
    if (err) return res.status(500).json({ error: err.message });
    
    const query = `SELECT * FROM account_movements 
                   WHERE customer_id = ? AND movement_date BETWEEN ? AND ?
                   ORDER BY movement_date ASC`;
    
    db.all(query, [customerId, start_date, end_date], (err, movements) => {
      if (err) return res.status(500).json({ error: err.message });
      
      // Excel verilerini hazırla
      const data = [];
      
      // Müşteri adını dönüştür
      const convertedCompanyName = turkishToEnglish(customer.company_name);
      
      // Başlık satırı
      data.push(['MUSTERI EKSTRESI']);
      data.push([`Musteri: ${convertedCompanyName}`]);
      data.push([`Tarih Araligi: ${start_date} - ${end_date}`]);
      data.push([]); // Boş satır
      
      // Tablo başlıkları
      data.push(['Tarih', 'Aciklama', 'Borc', 'Alacak', 'Bakiye']);
      
      // Hareketler
      let runningBalance = 0;
      movements.forEach(movement => {
        runningBalance += (movement.debit_amount || 0) - (movement.credit_amount || 0);
        data.push([
          movement.movement_date,
          movement.description,
          movement.debit_amount || 0,
          movement.credit_amount || 0,
          runningBalance
        ]);
      });
      
      // Excel dosyası oluştur
      const ws = XLSX.utils.aoa_to_sheet(data);
      const wb = XLSX.utils.book_new();
      XLSX.utils.book_append_sheet(wb, ws, 'Ekstre');
      
      // Buffer olarak yaz
      const buffer = XLSX.write(wb, { type: 'buffer', bookType: 'xlsx' });
      
      // Dosya adını düzenle
      const fileCompanyName = turkishToEnglish(customer.company_name).replace(/[^a-zA-Z0-9]/g, '');
      const fileName = `${fileCompanyName}-Cari-Ekstre.xlsx`;
      
      res.setHeader('Content-Type', 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet');
      res.setHeader('Content-Disposition', `attachment; filename="${fileName}"`);
      res.send(buffer);
    });
  });
});

// Kasalar listesi
router.get('/cash-registers', (req, res) => {
  const query = 'SELECT * FROM cash_registers WHERE is_active = 1 ORDER BY name';
  
  db.all(query, [], (err, rows) => {
    if (err) return res.status(500).json({ error: err.message });
    res.json(rows);
  });
});

// Müşteriye ait faturaları getir (query parametreli)
router.get('/invoices', (req, res) => {
  const customerId = req.query.customer_id;
  
  if (customerId) {
    const query = `SELECT i.*, 
                          (i.total_amount - COALESCE(i.paid_amount, 0)) as remaining_amount,
                          CASE 
                            WHEN i.status = 'paid' THEN 'Ödendi'
                            WHEN i.status = 'partial' THEN 'Kısmi Ödendi' 
                            ELSE 'Ödenmedi'
                          END as status_text
                   FROM invoices i 
                   WHERE i.customer_id = ? 
                   ORDER BY i.invoice_date DESC`;
    
    db.all(query, [customerId], (err, rows) => {
      if (err) return res.status(500).json({ error: err.message });
      res.json(rows);
    });
  } else {
    // Tüm faturaları getir
    const query = `SELECT i.*, c.company_name as customer_name, u.full_name as created_by_name
                   FROM invoices i 
                   LEFT JOIN customers c ON i.customer_id = c.id 
                   LEFT JOIN users u ON i.created_by = u.id 
                   ORDER BY i.created_at DESC`;
    
    db.all(query, [], (err, rows) => {
      if (err) return res.status(500).json({ error: err.message });
      res.json(rows);
    });
  }
});

module.exports = router;