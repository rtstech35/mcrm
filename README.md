# Saha CRM Sistemi

Saha operasyonları için geliştirilmiş kapsamlı CRM sistemi.

## Kurulum

1. Bağımlılıkları yükleyin:
```bash
npm install
```

2. PostgreSQL veritabanını kurun ve `.env` dosyasındaki bilgileri güncelleyin.

3. Veritabanı şemasını oluşturun:
```bash
psql -U postgres -d saha_crm -f database/schema.sql
```

4. Uygulamayı başlatın:
```bash
npm run dev
```

## Özellikler

### Admin Paneli
- Dashboard (satış, ziyaret, tahsilat grafikleri)
- Rol ve kullanıcı yönetimi
- Müşteri yönetimi
- Ürün yönetimi
- Sipariş takibi
- İrsaliye yönetimi
- Cari hesap takibi

### Satış Temsilcisi Paneli
- Kişisel dashboard
- Müşteri ziyaret yönetimi
- Randevu takibi
- Harita entegrasyonu
- Müşteri yönetimi
- Sipariş girişi

### Üretim Paneli
- Üretim dashboard'u
- Sipariş işleme
- Üretim takibi

### Sevkiyat Paneli
- Sevkiyat dashboard'u
- Bekleyen sevkiyatlar
- Dijital imza entegrasyonu

### Muhasebe/Depo Panelleri
- Fatura yönetimi
- Cari hesap takibi
- Envanter yönetimi

## Teknolojiler

- **Backend:** Node.js, Express.js
- **Veritabanı:** PostgreSQL
- **Kimlik Doğrulama:** JWT
- **Frontend:** Vanilla JavaScript (React.js'e geçiş planlanıyor)

## Geliştirme Durumu

✅ Proje kurulumu ve veritabanı şeması
🔄 Kimlik doğrulama sistemi
⏳ Admin paneli CRUD işlemleri
⏳ Dashboard ve grafikler
⏳ Satış temsilcisi paneli
⏳ Üretim paneli
⏳ Sevkiyat paneli
⏳ Muhasebe/Depo panelleri
⏳ Harita entegrasyonu
⏳ Mobil optimizasyon