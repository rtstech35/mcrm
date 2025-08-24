const http = require('http');
const fs = require('fs');
const path = require('path');

const server = http.createServer((req, res) => {
  if (req.url === '/' || req.url === '/index.html') {
    fs.readFile(path.join(__dirname, 'public', 'index.html'), (err, data) => {
      if (err) {
        res.writeHead(500);
        res.end('Dosya okunamadı');
        return;
      }
      res.writeHead(200, { 'Content-Type': 'text/html; charset=utf-8' });
      res.end(data);
    });
  } else if (req.url === '/api/auth/login' && req.method === 'POST') {
    let body = '';
    req.on('data', chunk => {
      body += chunk.toString();
    });
    req.on('end', () => {
      const { username, password } = JSON.parse(body);
      
      // Test kullanıcısı
      if (username === 'admin' && password === '123456') {
        res.writeHead(200, { 'Content-Type': 'application/json' });
        res.end(JSON.stringify({
          token: 'test-token-123',
          user: {
            id: 1,
            username: 'admin',
            full_name: 'Test Admin',
            role: 'admin',
            department: 'Yönetim'
          }
        }));
      } else {
        res.writeHead(401, { 'Content-Type': 'application/json' });
        res.end(JSON.stringify({ message: 'Kullanıcı adı veya şifre hatalı' }));
      }
    });
  } else {
    res.writeHead(404);
    res.end('Sayfa bulunamadı');
  }
});

const PORT = 3000;
server.listen(PORT, () => {
  console.log(`Test sunucusu http://localhost:${PORT} adresinde çalışıyor`);
  console.log('Test giriş bilgileri:');
  console.log('Kullanıcı adı: admin');
  console.log('Şifre: 123456');
});