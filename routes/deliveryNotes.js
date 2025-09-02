const express = require('express');
const pool = require('../config/database');
const { authenticateToken, checkPermission } = require('../middleware/auth');
const { sendDeliveryCompletionEmail } = require('../utils/mailer');
const router = express.Router();

// Tüm irsaliyeleri listele
router.get("/", authenticateToken, checkPermission('delivery.read'), async (req, res) => {
  try {
    const { status, customer_id, include } = req.query;
    const { userId, permissions } = req.user;
 
    let query;
    const params = [];
    const whereClauses = [];

    if (include === 'items') {
      query = `
        SELECT 
          dn.*, c.company_name, c.address as customer_address, c.latitude, c.longitude,
          u.full_name as delivered_by_name, o.order_number,
          COALESCE(json_agg(json_build_object('id', dni.id, 'product_id', dni.product_id, 'product_name', COALESCE(dni.product_name, p.name, 'Bilinmeyen Ürün'), 'quantity', dni.quantity, 'unit', dni.unit)) FILTER (WHERE dni.id IS NOT NULL), '[]'::jsonb) as items
        FROM delivery_notes dn
        LEFT JOIN customers c ON dn.customer_id = c.id
        LEFT JOIN users u ON dn.delivered_by = u.id
        LEFT JOIN orders o ON dn.order_id = o.id
        LEFT JOIN delivery_note_items dni ON dni.delivery_note_id = dn.id
        LEFT JOIN products p ON dni.product_id = p.id
      `;
    } else {
      query = `
        SELECT dn.*, c.company_name, c.address as customer_address, c.latitude, c.longitude,
               u.full_name as delivered_by_name, o.order_number
        FROM delivery_notes dn
        LEFT JOIN customers c ON dn.customer_id = c.id
        LEFT JOIN users u ON dn.delivered_by = u.id
        LEFT JOIN orders o ON dn.order_id = o.id
      `;
    }

    if (status) whereClauses.push(`dn.status = $${params.push(status)}`);
    if (customer_id) whereClauses.push(`dn.customer_id = $${params.push(customer_id)}`);

    const deliveryPerms = permissions.delivery || [];
    const isShipper = deliveryPerms.includes('read_own') && !deliveryPerms.includes('read') && !permissions.all;

    if (isShipper) {
        if (status) {
            whereClauses.push(`dn.delivered_by = $${params.push(userId)}`);
        } else {
            whereClauses.push(`(dn.status = 'pending' OR dn.delivered_by = $${params.push(userId)})`);
        }
    }

    if (whereClauses.length > 0) query += ` WHERE ${whereClauses.join(' AND ')}`;
    if (include === 'items') query += ` GROUP BY dn.id, c.id, u.id, o.id`;
    query += ` ORDER BY dn.created_at DESC`;

    const result = await pool.query(query, params);
    res.json({ success: true, delivery_notes: result.rows });
  } catch (error) {
    console.error('Delivery Notes API hatası:', error);
    res.status(500).json({ success: false, error: error.message });
  }
});

// Tek irsaliye getir
router.get("/:id", authenticateToken, checkPermission('delivery.read'), async (req, res) => {
  try {
    const { id } = req.params;
    const result = await pool.query(`
      SELECT dn.*, c.company_name as customer_name, c.address as customer_address,
             u.full_name as delivered_by_name, o.order_number, o.total_amount
      FROM delivery_notes dn
      LEFT JOIN customers c ON dn.customer_id = c.id
      LEFT JOIN users u ON dn.delivered_by = u.id
      LEFT JOIN orders o ON dn.order_id = o.id
      WHERE dn.id = $1
    `, [id]);
    if (result.rows.length === 0) return res.status(404).json({ success: false, error: 'İrsaliye bulunamadı' });
    res.json({ success: true, delivery_note: result.rows[0] });
  } catch (error) {
    res.status(500).json({ success: false, error: error.message });
  }
});

// İrsaliye kalemlerini getir
router.get("/:id/items", authenticateToken, checkPermission('delivery.read'), async (req, res) => {
  try {
    const { id } = req.params;
    const result = await pool.query(`
      SELECT dni.*, p.name as product_name_from_db
      FROM delivery_note_items dni
      LEFT JOIN products p ON dni.product_id = p.id
      WHERE dni.delivery_note_id = $1 ORDER BY dni.id
    `, [id]);
    const items = result.rows.map(item => ({ ...item, product_name: item.product_name || item.product_name_from_db || 'Bilinmeyen Ürün' }));
    res.json({ success: true, items: items });
  } catch (error) {
    res.status(500).json({ success: false, error: error.message });
  }
});

// Yeni irsaliye numarası oluştur
router.get("/generate-number", authenticateToken, checkPermission('delivery.create'), async (req, res) => {
  try {
    const now = new Date();
    const deliveryNumber = `IRS${now.getFullYear().toString().substr(-2)}${(now.getMonth() + 1).toString().padStart(2, '0')}${now.getDate().toString().padStart(2, '0')}${Math.floor(Math.random() * 999).toString().padStart(3, '0')}`;
    res.json({ success: true, delivery_number: deliveryNumber });
  } catch (error) {
    res.status(500).json({ success: false, error: error.message });
  }
});

// Yeni irsaliye oluştur
router.post("/", authenticateToken, checkPermission('delivery.create'), async (req, res) => {
  const client = await pool.connect();
  try {
    await client.query('BEGIN');
    const { delivery_number, order_id, customer_id, delivered_by, delivery_date, delivery_time, delivery_address, notes, internal_notes, items } = req.body;

    const deliveryResult = await client.query(`
      INSERT INTO delivery_notes (delivery_number, order_id, customer_id, delivered_by, delivery_date, delivery_time, delivery_address, notes, internal_notes, status, created_by)
      VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, 'pending', $10) RETURNING *
    `, [delivery_number, order_id || null, customer_id, delivered_by || null, delivery_date, delivery_time || null, delivery_address, notes, internal_notes, req.user.userId]);
    
    const newDeliveryNoteId = deliveryResult.rows[0].id;

    if (items && items.length > 0) {
        for (const item of items) {
            await client.query(`
                INSERT INTO delivery_note_items (delivery_note_id, product_id, product_name, quantity, unit)
                VALUES ($1, $2, $3, $4, $5)
            `, [newDeliveryNoteId, item.product_id, item.product_name, item.quantity, item.unit]);
        }
    }

    await client.query('COMMIT');
    res.status(201).json({ success: true, delivery_note: deliveryResult.rows[0] });
  } catch (error) {
    await client.query('ROLLBACK');
    console.error('Delivery Note create hatası:', error);
    res.status(500).json({ success: false, error: error.message });
  } finally {
    client.release();
  }
});

// İrsaliye güncelle
router.put("/:id", authenticateToken, checkPermission('delivery.update'), async (req, res) => {
  try {
    const { id } = req.params;
    const { delivery_number, order_id, customer_id, delivered_by, delivery_date, delivery_time, delivery_address, notes, internal_notes, status } = req.body;
    const result = await pool.query(`
      UPDATE delivery_notes SET
        delivery_number = $1, order_id = $2, customer_id = $3, delivered_by = $4, delivery_date = $5,
        delivery_time = $6, delivery_address = $7, notes = $8, internal_notes = $9, status = COALESCE($10, status),
        updated_at = CURRENT_TIMESTAMP
      WHERE id = $11 RETURNING *
    `, [delivery_number, order_id || null, customer_id, delivered_by || null, delivery_date, delivery_time || null, delivery_address, notes, internal_notes, status, id]);
    if (result.rows.length === 0) return res.status(404).json({ success: false, error: 'İrsaliye bulunamadı' });
    res.json({ success: true, delivery_note: result.rows[0] });
  } catch (error) {
    res.status(500).json({ success: false, error: error.message });
  }
});

// İrsaliye durumu güncelle
router.put("/:id/status", authenticateToken, checkPermission('delivery.update'), async (req, res) => {
  try {
    const { id } = req.params;
    const { status, delivered_by } = req.body;
    const result = await pool.query(`
      UPDATE delivery_notes SET status = $1, delivered_by = COALESCE($2, delivered_by), updated_at = CURRENT_TIMESTAMP
      WHERE id = $3 RETURNING *
    `, [status, delivered_by, id]);
    if (result.rows.length === 0) return res.status(404).json({ success: false, error: 'İrsaliye bulunamadı' });

    if (status === 'delivered' && result.rows[0].order_id) {
      await pool.query(`UPDATE orders SET status = 'delivered' WHERE id = $1`, [result.rows[0].order_id]);
      sendDeliveryCompletionEmail(id).catch(err => console.error("Asenkron mail gönderme hatası:", err.message));
    }
    res.json({ success: true, delivery_note: result.rows[0] });
  } catch (error) {
    res.status(500).json({ success: false, error: error.message });
  }
});

// İrsaliye imzala
router.put("/:id/sign", authenticateToken, checkPermission('delivery.update'), async (req, res) => {
  const client = await pool.connect();
  try {
    await client.query('BEGIN');
    const { id } = req.params;
    const { customer_signature, customer_name, customer_title } = req.body;
    if (!customer_signature || !customer_name) return res.status(400).json({ success: false, error: 'İmza ve teslim alan adı gerekli' });

    const result = await client.query(`
      UPDATE delivery_notes SET
        status = 'delivered', customer_signature = $1, customer_name = $2, customer_title = $3,
        signature_date = CURRENT_TIMESTAMP, signature_ip = $4, signature_device_info = $5,
        updated_at = CURRENT_TIMESTAMP
      WHERE id = $6 RETURNING *
    `, [customer_signature, customer_name, customer_title, req.ip, req.headers['user-agent'], id]);
    if (result.rows.length === 0) throw new Error('İrsaliye bulunamadı');

    const updatedDeliveryNote = result.rows[0];
    if (updatedDeliveryNote.order_id) {
      await client.query(`UPDATE orders SET status = 'delivered', updated_at = CURRENT_TIMESTAMP WHERE id = $1`, [updatedDeliveryNote.order_id]);
    }
    
    await client.query('COMMIT');
    sendDeliveryCompletionEmail(id).catch(err => console.error("Asenkron mail gönderme hatası:", err.message));
    res.json({ success: true, message: 'Teslimat başarıyla tamamlandı', delivery_note: result.rows[0] });
  } catch (error) {
    await client.query('ROLLBACK');
    console.error('Delivery note sign error:', error);
    res.status(500).json({ success: false, error: error.message });
  } finally {
    client.release();
  }
});

// İrsaliye sil
router.delete("/:id", authenticateToken, checkPermission('delivery.delete'), async (req, res) => {
  const client = await pool.connect();
  try {
    await client.query('BEGIN');
    const { id } = req.params;
    await client.query('DELETE FROM delivery_note_items WHERE delivery_note_id = $1', [id]);
    const result = await client.query('DELETE FROM delivery_notes WHERE id = $1 RETURNING *', [id]);
    if (result.rows.length === 0) return res.status(404).json({ success: false, error: 'İrsaliye bulunamadı' });
    await client.query('COMMIT');
    res.json({ success: true, message: 'İrsaliye başarıyla silindi' });
  } catch (error) {
    await client.query('ROLLBACK');
    res.status(500).json({ success: false, error: error.message });
  } finally {
    client.release();
  }
});

module.exports = router;