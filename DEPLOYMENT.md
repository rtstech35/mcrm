# 🚀 Render Deployment Rehberi

Bu rehber, Saha CRM Sistemi'ni Render'da deploy etmek için adım adım talimatları içerir.

## 📋 Ön Gereksinimler

- GitHub hesabı
- Render hesabı (ücretsiz)
- Projenin GitHub'da yayınlanmış olması

## 🔧 Adım 1: Render Dashboard'a Giriş

1. [Render Dashboard](https://dashboard.render.com)'a gidin
2. GitHub hesabınızla giriş yapın
3. "New +" butonuna tıklayın

## 🗄️ Adım 2: PostgreSQL Database Oluşturma

1. "New +" > "PostgreSQL" seçin
2. Konfigürasyon:
   - **Name**: `saha-crm-db`
   - **Database**: `sahacrm`
   - **User**: `sahacrm`
   - **Plan**: `Free`
   - **Region**: Size en yakın bölge
3. "Create Database" butonuna tıklayın
4. Database oluşturulduktan sonra **Internal Database URL**'i kopyalayın

## 🌐 Adım 3: Web Service Oluşturma

1. "New +" > "Web Service" seçin
2. GitHub repository'nizi bağlayın
3. Konfigürasyon:
   - **Name**: `saha-crm-sistemi`
   - **Environment**: `Node`
   - **Region**: Database ile aynı bölge
   - **Branch**: `main` (veya ana branch'iniz)
   - **Build Command**: `npm install`
   - **Start Command**: `npm start`
   - **Plan**: `Free`

## ⚙️ Adım 4: Environment Variables Ayarlama

Web service oluşturulduktan sonra, "Environment" sekmesine gidin ve şu değişkenleri ekleyin:

```
NODE_ENV=production
PORT=10000
JWT_SECRET=your_very_secure_jwt_secret_key_here_make_it_long_and_random
DATABASE_URL=postgresql://sahacrm:password@host:port/sahacrm
```

**Önemli**: `DATABASE_URL` değerini Adım 2'de kopyaladığınız Internal Database URL ile değiştirin.

## 🗃️ Adım 5: Database Schema Kurulumu

1. Web service'iniz deploy olduktan sonra
2. "Logs" sekmesine gidin
3. "Shell" butonuna tıklayın
4. Aşağıdaki komutu çalıştırın:

```bash
npm run setup-db
```

Bu komut:
- Database schema'sını oluşturacak
- Temel roller ve departmanları ekleyecek
- Admin kullanıcısı oluşturacak (admin/admin123)

## ✅ Adım 6: Test Etme

1. Web service'inizin URL'sine gidin
2. Ana sayfa yükleniyorsa başarılı!
3. `/admin` sayfasına gidin
4. Admin kullanıcısı ile giriş yapın:
   - **Kullanıcı adı**: `admin`
   - **Şifre**: `admin123`

## 🔧 Sorun Giderme

### Database Bağlantı Hatası
- Environment variables'da `DATABASE_URL` doğru mu?
- Database service aktif mi?

### Build Hatası
- `package.json` dosyası doğru mu?
- Dependencies eksik mi?

### Runtime Hatası
- Logs sekmesini kontrol edin
- Environment variables eksik mi?

## 📱 Mobil Erişim

Uygulama mobil uyumludur. Telefonunuzdan da erişebilirsiniz.

## 🔒 Güvenlik Notları

1. **JWT_SECRET**: Güçlü ve benzersiz bir anahtar kullanın
2. **Admin Şifresi**: İlk girişten sonra admin şifresini değiştirin
3. **HTTPS**: Render otomatik olarak HTTPS sağlar

## 📞 Destek

Sorun yaşarsanız:
1. Render Logs'u kontrol edin
2. Environment variables'ı doğrulayın
3. Database bağlantısını test edin

## 🎉 Başarı!

Uygulamanız başarıyla deploy edildi! 🚀

**URL**: `https://your-app-name.onrender.com`
**Admin**: `admin` / `admin123`
