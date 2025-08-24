const sqlite3 = require('sqlite3').verbose();
const path = require('path');

const dbPath = path.join(__dirname, 'database', 'saha_crm.db');
const db = new sqlite3.Database(dbPath);

// Test müşterileri ekle
const testCustomers = [
  { company_name: 'ABC Restaurant', contact_person: 'Ahmet Yılmaz', phone: '0532-123-4567', customer_status: 'active' },
  { company_name: 'XYZ Cafe', contact_person: 'Mehmet Demir', phone: '0533-234-5678', customer_status: 'potential' },
  { company_name: 'Lezzet Lokantası', contact_person: 'Ayşe Kaya', phone: '0534-345-6789', customer_status: 'active' },
  { company_name: 'Güzel Otel', contact_person: 'Fatma Öz', phone: '0535-456-7890', customer_status: 'potential' },
  { company_name: 'Modern Restoran', contact_person: 'Ali Veli', phone: '0536-567-8901', customer_status: 'not_interested' }
];

console.log('Test müşterileri ekleniyor...');

testCustomers.forEach((customer, index) => {
  db.run(
    'INSERT OR IGNORE INTO customers (company_name, contact_person, phone, customer_status, assigned_sales_rep) VALUES (?, ?, ?, ?, ?)',
    [customer.company_name, customer.contact_person, customer.phone, customer.customer_status, 1],
    function(err) {
      if (err) {
        console.error('Hata:', err.message);
      } else {
        console.log(`✅ ${customer.company_name} eklendi`);
      }
      
      if (index === testCustomers.length - 1) {
        console.log('\n🎉 Test verileri eklendi!');
        db.close();
      }
    }
  );
});