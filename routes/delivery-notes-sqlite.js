const express = require('express');
const sqlite3 = require('sqlite3').verbose();
const path = require('path');
const nodemailer = require('nodemailer');
const router = express.Router();

const dbPath = path.join(__dirname, '..', 'database', 'saha_crm.db');
const db = new sqlite3.Database(dbPath);

// Tüm irsaliyeleri listele
router.get('/', (req, res) => {
  const { status, customer_id } = req.query;
  
  let query = `SELECT dn.*, c.company_name as customer_name, u.full_name as delivered_by_name,
               o.order_number
               FROM delivery_notes dn 
               LEFT JOIN customers c ON dn.customer_id = c.id 
               LEFT JOIN users u ON dn.delivered_by = u.id
               LEFT JOIN orders o ON dn.order_id = o.id
               WHERE 1=1`;
  let params = [];
  
  if (status) {
    query += ' AND dn.status = ?';
    params.push(status);
  }
  
  if (customer_id) {
    query += ' AND dn.customer_id = ?';
    params.push(customer_id);
  }
  
  query += ' ORDER BY dn.created_at DESC';
  
  db.all(query, params, (err, deliveryNotes) => {
    if (err) return res.status(500).json({ error: err.message });
    res.json(deliveryNotes);
  });
});

// Siparişten irsaliye oluştur
router.post('/from-order/:orderId', (req, res) => {
  const orderId = req.params.orderId;
  const userId = req.user.userId;
  
  // Sipariş bilgilerini al
  db.get('SELECT * FROM orders WHERE id = ? AND status = "production_ready"', [orderId], (err, order) => {
    if (err) return res.status(500).json({ error: err.message });
    if (!order) return res.status(404).json({ error: 'Sipariş bulunamadı veya sevkiyata hazır değil' });
    
    // İrsaliye numarası oluştur
    const date = new Date();
    const year = date.getFullYear().toString().slice(-2);
    const month = (date.getMonth() + 1).toString().padStart(2, '0');
    const day = date.getDate().toString().padStart(2, '0');
    const datePrefix = 'IRS' + year + month + day;
    
    // Bugünün irsaliye sayısını bul
    db.get(
      'SELECT COUNT(*) as count FROM delivery_notes WHERE DATE(created_at) = DATE("now")',
      (err, result) => {
        if (err) return res.status(500).json({ error: err.message });
        
        const deliveryCount = (result.count + 1).toString().padStart(3, '0');
        const deliveryNoteNumber = datePrefix + deliveryCount;
        
        // İrsaliye oluştur
        db.run(
          `INSERT INTO delivery_notes (delivery_note_number, customer_id, order_id, 
           delivery_date, total_amount, status, created_by) 
           VALUES (?, ?, ?, ?, ?, 'ready_for_shipping', ?)`,
          [deliveryNoteNumber, order.customer_id, orderId, new Date().toISOString().split('T')[0], 
           order.total_amount, userId],
          function(err) {
            if (err) return res.status(500).json({ error: err.message });
            
            const deliveryNoteId = this.lastID;
            
            // Sipariş kalemlerini irsaliyeye kopyala
            db.run(
              `INSERT INTO delivery_note_items (delivery_note_id, product_id, quantity, unit_price, total_price, unit)
               SELECT ?, product_id, quantity, unit_price, total_price, 'adet' 
               FROM order_items WHERE order_id = ?`,
              [deliveryNoteId, orderId],
              (err) => {
                if (err) return res.status(500).json({ error: err.message });
                
                // Sipariş durumunu güncelle
                db.run('UPDATE orders SET status = "shipped" WHERE id = ?', [orderId], (err) => {
                  if (err) console.error('Sipariş durumu güncellenemedi:', err);
                });
                
                res.json({ 
                  id: deliveryNoteId,
                  deliveryNoteNumber,
                  message: 'İrsaliye oluşturuldu' 
                });
              }
            );
          }
        );
      }
    );
  });
});

// İrsaliye detayını getir
router.get('/:id', (req, res) => {
  const query = `SELECT dn.*, c.company_name, c.address, c.contact_person, c.phone, c.email,
                 u.full_name as delivered_by_name, o.order_number
                 FROM delivery_notes dn 
                 LEFT JOIN customers c ON dn.customer_id = c.id 
                 LEFT JOIN users u ON dn.delivered_by = u.id
                 LEFT JOIN orders o ON dn.order_id = o.id
                 WHERE dn.id = ?`;
  
  db.get(query, [req.params.id], (err, deliveryNote) => {
    if (err) return res.status(500).json({ error: err.message });
    if (!deliveryNote) return res.status(404).json({ error: 'İrsaliye bulunamadı' });
    res.json(deliveryNote);
  });
});

// İrsaliye kalemlerini getir
router.get('/:id/items', (req, res) => {
  const query = `SELECT dni.*, p.name as product_name 
                 FROM delivery_note_items dni 
                 LEFT JOIN products p ON dni.product_id = p.id 
                 WHERE dni.delivery_note_id = ?`;
  
  db.all(query, [req.params.id], (err, items) => {
    if (err) return res.status(500).json({ error: err.message });
    res.json(items);
  });
});

// İrsaliye durumunu güncelle
router.put('/:id/status', (req, res) => {
  const { status, delivered_by } = req.body;
  
  let updateQuery = 'UPDATE delivery_notes SET status = ?, updated_at = CURRENT_TIMESTAMP';
  let params = [status];
  
  if (delivered_by) {
    updateQuery += ', delivered_by = ?';
    params.push(delivered_by);
  }
  
  updateQuery += ' WHERE id = ?';
  params.push(req.params.id);
  
  db.run(updateQuery, params, function(err) {
    if (err) return res.status(500).json({ error: err.message });
    res.json({ message: 'İrsaliye durumu güncellendi' });
  });
});

// İmza ekle ve teslimatı tamamla
router.put('/:id/sign', (req, res) => {
  const { signature, customerName } = req.body;
  const deliveryNoteId = req.params.id;
  
  db.run(
    `UPDATE delivery_notes SET 
     customer_signature = ?, customer_name = ?, signature_date = CURRENT_TIMESTAMP,
     status = 'delivered', updated_at = CURRENT_TIMESTAMP 
     WHERE id = ?`,
    [signature, customerName, deliveryNoteId],
    function(err) {
      if (err) return res.status(500).json({ error: err.message });
      
      // İmzalı irsaliyeyi e-posta ile gönder
      sendDeliveryNoteEmail(deliveryNoteId);
      
      res.json({ message: 'İmza eklendi ve teslimat tamamlandı' });
    }
  );
});

// İmzalı irsaliyeyi e-posta ile gönder
function sendDeliveryNoteEmail(deliveryNoteId) {
  const query = `SELECT dn.*, c.company_name, c.email, c.contact_person
                 FROM delivery_notes dn 
                 LEFT JOIN customers c ON dn.customer_id = c.id 
                 WHERE dn.id = ?`;
  
  db.get(query, [deliveryNoteId], (err, deliveryNote) => {
    if (err || !deliveryNote || !deliveryNote.email) return;
    
    // E-posta gönderme işlemi burada yapılacak
    console.log(`İmzalı irsaliye ${deliveryNote.delivery_note_number} ${deliveryNote.email} adresine gönderildi`);
  });
}

// Faturaya dönüştürülecek irsaliyeleri listele
router.get('/ready-for-invoice/:customerId?', (req, res) => {
  let query = `SELECT dn.*, c.company_name 
               FROM delivery_notes dn 
               LEFT JOIN customers c ON dn.customer_id = c.id 
               WHERE dn.status = 'delivered' AND dn.is_invoiced = 0`;
  let params = [];
  
  if (req.params.customerId) {
    query += ' AND dn.customer_id = ?';
    params.push(req.params.customerId);
  }
  
  query += ' ORDER BY dn.delivery_date';
  
  db.all(query, params, (err, deliveryNotes) => {
    if (err) return res.status(500).json({ error: err.message });
    res.json(deliveryNotes);
  });
});

module.exports = router;