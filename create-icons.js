// Basit SVG ikonları oluştur
const fs = require('fs');

const svgIcon = `
<svg width="192" height="192" xmlns="http://www.w3.org/2000/svg">
  <rect width="192" height="192" fill="#007bff"/>
  <text x="96" y="110" font-family="Arial" font-size="60" fill="white" text-anchor="middle">CRM</text>
</svg>
`;

const svgIcon512 = `
<svg width="512" height="512" xmlns="http://www.w3.org/2000/svg">
  <rect width="512" height="512" fill="#007bff"/>
  <text x="256" y="290" font-family="Arial" font-size="160" fill="white" text-anchor="middle">CRM</text>
</svg>
`;

// SVG dosyalarını oluştur
fs.writeFileSync('./public/icon-192.svg', svgIcon);
fs.writeFileSync('./public/icon-512.svg', svgIcon512);

console.log('✅ PWA ikonları oluşturuldu (SVG formatında)');
console.log('📱 Mobil cihazlarda test edebilirsiniz');