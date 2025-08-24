const BASE_URL = "https://mcrm-lx1p.onrender.com";

// Test için genel fetch fonksiyonu
async function testAPI(endpoint) {
  try {
    const res = await fetch(`${BASE_URL}${endpoint}`);
    const text = await res.text(); // Önce text alıyoruz
    try {
      const data = JSON.parse(text); // JSON parse etmeye çalış
      console.log(`✅ ${endpoint} çalışıyor:`, data);
    } catch {
      console.warn(`⚠️ ${endpoint} JSON değil (HTML veya hata sayfası döndü):`, text);
    }
  } catch (err) {
    console.error(`❌ ${endpoint} hata verdi:`, err);
  }
}

// Test edilecek endpointler
const endpoints = [
  "/api/customers",
  "/api/products",
  "/api/orders",
  "/api/stats"
];

// Testleri çalıştır
endpoints.forEach(ep => testAPI(ep));

