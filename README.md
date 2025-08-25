# Saha CRM Sistemi

Saha Operasyonları CRM Sistemi - Node.js ve PostgreSQL ile geliştirilmiş web uygulaması.

## 🚀 Render'da Deployment

Bu projeyi Render'da çalıştırmak için aşağıdaki adımları takip edin:

### 1. Render Dashboard'a Giriş
- [Render Dashboard](https://dashboard.render.com)'a gidin
- GitHub hesabınızla giriş yapın

### 2. Yeni Web Service Oluşturma
- "New +" butonuna tıklayın
- "Web Service" seçin
- GitHub repository'nizi bağlayın

### 3. Konfigürasyon
- **Name**: `saha-crm-sistemi`
- **Environment**: `Node`
- **Build Command**: `npm install`
- **Start Command**: `npm start`
- **Plan**: `Free`

### 4. Environment Variables
Aşağıdaki environment değişkenlerini ekleyin:

```
NODE_ENV=production
PORT=10000
JWT_SECRET=your_secure_jwt_secret_here
DATABASE_URL=your_postgresql_connection_string
```

### 5. PostgreSQL Database
- "New +" > "PostgreSQL"
- Database adı: `saha-crm-db`
- Plan: `Free`
- Oluşturulan DATABASE_URL'i kopyalayıp environment variables'a ekleyin

### 6. Database Schema
Database oluşturulduktan sonra, `database/schema.sql` dosyasındaki SQL komutlarını çalıştırın.

## 🛠️ Lokal Geliştirme

### Gereksinimler
- Node.js 16+
- PostgreSQL 12+

### Kurulum
```bash
# Dependencies yükle
npm install

# Environment dosyasını oluştur
cp env.example .env

# .env dosyasını düzenle
# Database bilgilerini ve JWT_SECRET'ı ayarla

# Database'i kur
npm run setup

# Uygulamayı başlat
npm run dev
```

## 📁 Proje Yapısı

```
mcrm/
├── config/          # Database konfigürasyonu
├── database/        # SQL dosyaları
├── middleware/      # Auth middleware
├── models/          # Data modelleri
├── public/          # Frontend dosyaları
├── routes/          # API routes
├── utils/           # Yardımcı fonksiyonlar
├── server.js        # Ana server dosyası
└── package.json     # Dependencies
```

## 🔧 API Endpoints

- `POST /api/login` - Kullanıcı girişi
- `POST /api/register` - Kullanıcı kaydı
- `GET /api/customers` - Müşteri listesi
- `POST /api/customers` - Yeni müşteri ekleme
- `GET /api/orders` - Sipariş listesi
- `POST /api/orders` - Yeni sipariş ekleme

## 📱 Özellikler

- ✅ Kullanıcı yönetimi ve authentication
- ✅ Müşteri yönetimi
- ✅ Sipariş takibi
- ✅ Ziyaret planlaması
- ✅ Raporlama
- ✅ Mobil uyumlu arayüz

## 🔒 Güvenlik

- JWT token authentication
- Password hashing (bcrypt)
- CORS protection
- Environment variables

## 📞 Destek

Herhangi bir sorun yaşarsanız, lütfen issue açın veya iletişime geçin.