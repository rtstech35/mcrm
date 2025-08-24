const sqlite3 = require('sqlite3').verbose();
const path = require('path');

const dbPath = path.join(__dirname, 'database', 'saha_crm.db');
const db = new sqlite3.Database(dbPath);

const currentMonth = new Date().toISOString().slice(0, 7);

const testTargets = [
  { user_id: 2, target_type: 'sales', target_value: 75000, target_month: currentMonth },
  { user_id: 2, target_type: 'visits', target_value: 25, target_month: currentMonth },
  { user_id: 3, target_type: 'production', target_value: 500, target_month: currentMonth },
  { user_id: 4, target_type: 'shipping', target_value: 300, target_month: currentMonth }
];

console.log('Test hedefleri ekleniyor...');

testTargets.forEach((target, index) => {
  db.run(
    'INSERT OR REPLACE INTO user_targets (user_id, target_type, target_value, target_month) VALUES (?, ?, ?, ?)',
    [target.user_id, target.target_type, target.target_value, target.target_month],
    function(err) {
      if (err) console.error('Hata:', err.message);
      else console.log(`✅ Hedef eklendi: ${target.target_type} - ${target.target_value}`);
      
      if (index === testTargets.length - 1) {
        console.log('\n🎯 Test hedefleri eklendi!');
        db.close();
      }
    }
  );
});