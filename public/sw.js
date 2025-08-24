const CACHE_NAME = 'saha-crm-v1';
const urlsToCache = [
  '/',
  '/admin.html',
  '/sales.html',
  '/production.html',
  '/shipping.html',
  '/accounting.html',
  '/map.html',
  '/manifest.json'
];

self.addEventListener('install', (event) => {
  event.waitUntil(
    caches.open(CACHE_NAME)
      .then((cache) => cache.addAll(urlsToCache))
  );
});

// Service Worker fetch event'ini devre dışı bırakıyoruz
// self.addEventListener('fetch', (event) => {
//   event.respondWith(
//     caches.match(event.request)
//       .then((response) => {
//         if (response) {
//           return response;
//         }
//         return fetch(event.request);
//       }
//     )
//   );
// });