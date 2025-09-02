const nodemailer = require('nodemailer');
const pool = require('../config/database');

async function sendDeliveryCompletionEmail(deliveryNoteId) {
  try {
    console.log(`📧 Mail gönderim süreci başlatılıyor, İrsaliye ID: ${deliveryNoteId}`);
    
    const settingsResult = await pool.query('SELECT * FROM mail_settings ORDER BY id DESC LIMIT 1');
    if (settingsResult.rows.length === 0) {
      console.log('⚠️ Mail ayarları bulunamadı, mail gönderilemedi.');
      return { success: false, error: 'Mail ayarları yapılmamış' };
    }
    const settings = settingsResult.rows[0];

    const deliveryResult = await pool.query(`
      SELECT dn.*, 
             c.company_name, c.contact_person, c.email as customer_email, c.phone as customer_phone, c.address as customer_address,
             u_signer.full_name as signer_name,
             o.order_number,
             u_creator.full_name as created_by_name
      FROM delivery_notes dn
      LEFT JOIN customers c ON dn.customer_id = c.id
      LEFT JOIN orders o ON dn.order_id = o.id
      LEFT JOIN users u_signer ON dn.delivered_by = u_signer.id
      LEFT JOIN users u_creator ON dn.created_by = u_creator.id
      WHERE dn.id = $1
    `, [deliveryNoteId]);
    
    if (deliveryResult.rows.length === 0) {
      console.log(`⚠️ İrsaliye bulunamadı, ID: ${deliveryNoteId}`);
      return { success: false, error: 'İrsaliye bulunamadı' };
    }
    const delivery = deliveryResult.rows[0];
    const customerEmail = delivery.customer_email;

    if (!customerEmail) {
        console.log(`⚠️ Müşteri e-posta adresi bulunamadı, ID: ${delivery.customer_id}`);
        return { success: false, error: 'Müşteri e-posta adresi yok' };
    }

    let deliveryItems = [];
    try {
        const itemsResult = await pool.query(`
            SELECT product_name, quantity, unit
            FROM delivery_note_items
            WHERE delivery_note_id = $1
        `, [deliveryNoteId]);
        deliveryItems = itemsResult.rows;
    } catch (error) {
        console.log(`⚠️ İrsaliye kalemleri alınamadı, İrsaliye ID: ${deliveryNoteId}`, error.message);
    }

    const isGmail = settings.smtp_host.includes('gmail');
    const port = parseInt(settings.smtp_port);
    const secure = isGmail ? (port === 465) : settings.smtp_secure;
    
    const transporter = nodemailer.createTransport({
      host: settings.smtp_host,
      port: port,
      secure: secure,
      auth: { user: settings.smtp_user, pass: settings.smtp_pass },
      tls: { rejectUnauthorized: false }
    });

    const subject = `Teslimat Tamamlandı - ${delivery.delivery_number}`;
    
    const htmlContent = `
    <!DOCTYPE html>
    <html>
    <body>
        <h1>Teslimat Tamamlandı</h1>
        <p>Merhaba ${delivery.company_name},</p>
        <p><b>${delivery.delivery_number}</b> numaralı irsaliyeniz başarıyla teslim edilmiştir.</p>
        <h3>Teslim Edilen Ürünler:</h3>
        <ul>
            ${deliveryItems.map(item => `<li>${item.product_name} - ${item.quantity} ${item.unit || 'adet'}</li>`).join('')}
        </ul>
        <p>İyi günler dileriz.</p>
    </body>
    </html>
  `;

    const mailOptions = {
      from: `${settings.from_name} <${settings.smtp_user}>`,
      to: customerEmail,
      subject: subject,
      html: htmlContent
    };

    await transporter.sendMail(mailOptions);
    
    await pool.query(`
      INSERT INTO sent_mails (to_email, subject, body, status, delivery_note_id, sent_by)
      VALUES ($1, $2, $3, 'sent', $4, $5)
    `, [customerEmail, subject, htmlContent, deliveryNoteId, 1]);
    
    console.log(`✅ Teslimat maili başarıyla gönderildi: ${customerEmail}`);
    return { success: true };

  } catch (error) {
    console.error(`📧 Mail gönderme hatası (İrsaliye ID: ${deliveryNoteId}):`, error);
    await pool.query(`
      INSERT INTO sent_mails (to_email, subject, body, status, error_message, delivery_note_id, sent_by)
      VALUES ($1, $2, $3, 'failed', $4, $5, $6)
    `, ['N/A', `İrsaliye ${deliveryNoteId} için mail hatası`, '', error.message, deliveryNoteId, 1]);
    return { success: false, error: error.message };
  }
}

module.exports = { sendDeliveryCompletionEmail };