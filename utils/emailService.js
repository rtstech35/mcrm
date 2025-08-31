const nodemailer = require('nodemailer');

// Mail transporter oluştur
const createTransporter = () => {
  return nodemailer.createTransporter({
    host: process.env.SMTP_HOST || 'smtp.gmail.com',
    port: process.env.SMTP_PORT || 587,
    secure: false,
    auth: {
      user: process.env.SMTP_USER || 'your-email@gmail.com',
      pass: process.env.SMTP_PASS || 'your-app-password'
    }
  });
};

// İrsaliye HTML template'i
const generateDeliveryNoteHTML = (deliveryNote, customer, items, signature) => {
  return `
    <!DOCTYPE html>
    <html>
    <head>
        <meta charset="UTF-8">
        <title>İrsaliye - ${deliveryNote.delivery_note_number}</title>
        <style>
            body { font-family: Arial, sans-serif; margin: 0; padding: 20px; background: #f5f5f5; }
            .container { max-width: 800px; margin: 0 auto; background: white; padding: 30px; border-radius: 8px; box-shadow: 0 2px 10px rgba(0,0,0,0.1); }
            .header { text-align: center; margin-bottom: 30px; border-bottom: 2px solid #007bff; padding-bottom: 20px; }
            .company-info { text-align: center; margin-bottom: 20px; }
            .delivery-info { display: grid; grid-template-columns: 1fr 1fr; gap: 30px; margin-bottom: 30px; }
            .info-box { background: #f8f9fa; padding: 15px; border-radius: 5px; }
            .info-box h3 { margin-top: 0; color: #007bff; }
            .items-table { width: 100%; border-collapse: collapse; margin-bottom: 30px; }
            .items-table th, .items-table td { border: 1px solid #ddd; padding: 12px; text-align: left; }
            .items-table th { background: #007bff; color: white; }
            .items-table tr:nth-child(even) { background: #f9f9f9; }
            .signature-section { margin-top: 30px; text-align: center; }
            .signature-box { border: 2px solid #007bff; padding: 20px; margin: 20px 0; border-radius: 5px; }
            .footer { text-align: center; margin-top: 30px; padding-top: 20px; border-top: 1px solid #ddd; color: #666; }
        </style>
    </head>
    <body>
        <div class="container">
            <div class="header">
                <h1>İRSALİYE</h1>
                <h2>${deliveryNote.delivery_note_number}</h2>
            </div>
            
            <div class="company-info">
                <h3>SAHA CRM SİSTEMİ</h3>
                <p>Adres: Örnek Mahalle, Örnek Sokak No:1, İstanbul</p>
                <p>Telefon: +90 212 555 0000 | Email: info@sahacrm.com</p>
            </div>
            
            <div class="delivery-info">
                <div class="info-box">
                    <h3>Teslim Edilen Firma</h3>
                    <p><strong>Firma:</strong> ${customer.company_name}</p>
                    <p><strong>Yetkili:</strong> ${customer.contact_person || 'Belirtilmemiş'}</p>
                    <p><strong>Telefon:</strong> ${customer.phone || 'Belirtilmemiş'}</p>
                    <p><strong>Email:</strong> ${customer.email || 'Belirtilmemiş'}</p>
                    <p><strong>Adres:</strong> ${customer.address || 'Belirtilmemiş'}</p>
                </div>
                
                <div class="info-box">
                    <h3>Teslimat Bilgileri</h3>
                    <p><strong>İrsaliye No:</strong> ${deliveryNote.delivery_note_number}</p>
                    <p><strong>Teslimat Tarihi:</strong> ${new Date(deliveryNote.delivery_date).toLocaleDateString('tr-TR')}</p>
                    <p><strong>Teslim Eden:</strong> ${deliveryNote.created_by_name || 'Sevkiyat Personeli'}</p>
                    <p><strong>Durum:</strong> Teslim Edildi</p>
                </div>
            </div>
            
            <h3>Teslim Edilen Ürünler</h3>
            <table class="items-table">
                <thead>
                    <tr>
                        <th>Ürün Adı</th>
                        <th>Miktar</th>
                        <th>Birim</th>
                        <th>Açıklama</th>
                    </tr>
                </thead>
                <tbody>
                    ${items.map(item => `
                        <tr>
                            <td>${item.product_name || 'Ürün'}</td>
                            <td>${item.quantity}</td>
                            <td>${item.unit || 'adet'}</td>
                            <td>-</td>
                        </tr>
                    `).join('')}
                </tbody>
            </table>
            
            <div class="footer">
                <p>Bu irsaliye otomatik olarak oluşturulmuştur.</p>
                <p>Herhangi bir sorunuz için lütfen bizimle iletişime geçin.</p>
            </div>
        </div>
    </body>
    </html>
  `;
};

// İrsaliye mailini gönder
const sendDeliveryNoteMail = async (deliveryNote, customer, items, signature) => {
  try {
    const transporter = createTransporter();
    
    const htmlContent = generateDeliveryNoteHTML(deliveryNote, customer, items, signature);
    
    const mailOptions = {
      from: process.env.SMTP_USER || 'noreply@sahacrm.com',
      to: customer.email,
      subject: `İrsaliye - ${deliveryNote.delivery_note_number} | ${customer.company_name}`,
      html: htmlContent
    };
    
    const result = await transporter.sendMail(mailOptions);
    console.log('İrsaliye maili gönderildi:', result.messageId);
    return { success: true, messageId: result.messageId };
    
  } catch (error) {
    console.error('Mail gönderme hatası:', error);
    return { success: false, error: error.message };
  }
};

module.exports = {
  sendDeliveryNoteMail
};