const express = require('express');
const cors = require('cors');
const path = require('path');
const bcrypt = require('bcryptjs');
const jwt = require('jsonwebtoken');
const sqlite3 = require('sqlite3').verbose();
require('dotenv').config();

const app = express();
const PORT = process.env.PORT || 3000;

// SQLite veritabanı bağlantısı
const dbPath = path.join(__dirname, 'database', 'saha_crm.db');
const db = new sqlite3.Database(dbPath);

// Middleware
app.use(cors());
app.use(express.json());
app.use(express.static('public'));

// Giriş endpoint'i
app.post('/api/auth/login', (req, res) => {
  const { username, password } = req.body;
  
  db.get(
    `SELECT u.*, r.name as role_name, d.name as department_name 
     FROM users u 
     LEFT JOIN roles r ON u.role_id = r.id 
     LEFT JOIN departments d ON u.department_id = d.id 
     WHERE u.username = ? AND u.is_active = 1`,
    [username],
    async (err, user) => {
      if (err) {
        return res.status(500).json({ message: 'Veritabanı hatası' });
      }
      
      if (!user) {
        return res.status(401).json({ message: 'Kullanıcı adı veya şifre hatalı' });
      }
      
      try {
        const validPassword = await bcrypt.compare(password, user.password_hash);
        
        if (!validPassword) {
          return res.status(401).json({ message: 'Kullanıcı adı veya şifre hatalı' });
        }
        
        const token = jwt.sign(
          { userId: user.id, role: user.role_name },
          process.env.JWT_SECRET || 'test-secret',
          { expiresIn: '24h' }
        );
        
        res.json({
          token,
          user: {
            id: user.id,
            username: user.username,
            full_name: user.full_name,
            role: user.role_name,
            department: user.department_name
          }
        });
      } catch (error) {
        res.status(500).json({ message: 'Şifre doğrulama hatası' });
      }
    }
  );
});

// Kimlik doğrulama middleware'i
const authenticateToken = (req, res, next) => {
  const authHeader = req.headers['authorization'];
  const token = authHeader && authHeader.split(' ')[1];

  if (!token) {
    return res.status(401).json({ message: 'Token gerekli' });
  }

  try {
    const decoded = jwt.verify(token, process.env.JWT_SECRET || 'test-secret');
    req.user = decoded;
    next();
  } catch (error) {
    return res.status(403).json({ message: 'Geçersiz token' });
  }
};

// Routes (kimlik doğrulama ile korumalı)
app.use('/api/users', authenticateToken, require('./routes/users-sqlite'));
app.use('/api/customers', authenticateToken, require('./routes/customers-sqlite'));
app.use('/api/dashboard', authenticateToken, require('./routes/dashboard-sqlite'));
app.use('/api/visits', authenticateToken, require('./routes/visits-sqlite'));
app.use('/api/orders', authenticateToken, require('./routes/orders-sqlite'));
app.use('/api/order-items', authenticateToken, require('./routes/order-items-sqlite'));
app.use('/api/accounting', authenticateToken, require('./routes/accounting-sqlite'));
app.use('/api/products', authenticateToken, require('./routes/products-sqlite'));
app.use('/api/targets', authenticateToken, require('./routes/targets-sqlite'));
app.use('/api/cari', authenticateToken, require('./routes/cari-sqlite'));
app.use('/api/delivery-notes', authenticateToken, require('./routes/delivery-notes-sqlite'));
app.use('/api/invoices', authenticateToken, require('./routes/invoices-sqlite'));

// Roller ve departmanlar için basit endpoint'ler (korumalı)
app.get('/api/roles', authenticateToken, (req, res) => {
  db.all('SELECT * FROM roles', (err, roles) => {
    if (err) return res.status(500).json({ error: err.message });
    res.json(roles);
  });
});

app.get('/api/departments', authenticateToken, (req, res) => {
  db.all('SELECT * FROM departments', (err, departments) => {
    if (err) return res.status(500).json({ error: err.message });
    res.json(departments);
  });
});

// Ana sayfa
app.get('/', (req, res) => {
  res.sendFile(path.join(__dirname, 'public', 'index.html'));
});

app.listen(PORT, () => {
  console.log(`🚀 Saha CRM Sistemi ${PORT} portunda çalışıyor`);
  console.log(`📱 Web arayüzü: http://localhost:${PORT}`);
  console.log('🔑 Test giriş: admin / 123456');
});