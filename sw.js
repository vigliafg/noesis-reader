// ═══════════════════════════════════════════════════════════
// NOESIS SERVICE WORKER
// ═══════════════════════════════════════════════════════════
// VERSION: 816   <-- aggiorna questo commento a ogni release
//                      (deve matchare NOESIS_VERSION nell'HTML)
// ═══════════════════════════════════════════════════════════
// Regole di avanzamento versione:
//   1. Incrementa il numero in NOESIS_VERSION nell'HTML
//   2. Cambia il commento VERSION qui sopra con lo stesso valore
//   3. Rinomina l'HTML: noesis{VERSION}-reader.html
//   4. Deploy di entrambi i file. Il browser rileva lo SW
//      byte-diverso, lo installa, e al refresh l'utente
//      ottiene la nuova versione con cache pulita.
// ═══════════════════════════════════════════════════════════

var APP_VERSION = (function() {
  try {
    var q = new URL(self.location.href).searchParams.get('v');
    return q || '0';
  } catch(e) { return '0'; }
})();

var CACHE_NAME = 'noesis-reader-v' + APP_VERSION;
var CDN_URLS = [
  'https://cdn.jsdelivr.net/npm/bootstrap-icons@1.11.3/font/bootstrap-icons.min.css',
  'https://cdn.jsdelivr.net/npm/jszip@3.10.1/dist/jszip.min.js',
  'https://cdn.jsdelivr.net/npm/epubjs@0.3.93/dist/epub.min.js',
];

self.addEventListener('install', function(event) {
  console.log('SW: installing ' + CACHE_NAME);
  event.waitUntil(
    caches.open(CACHE_NAME).then(function(cache) {
      return cache.addAll(CDN_URLS).catch(function(err) {
        console.warn('SW: CDN pre-cache warning', err);
      });
    })
  );
  self.skipWaiting();
});

self.addEventListener('activate', function(event) {
  console.log('SW: activating ' + CACHE_NAME);
  event.waitUntil(
    caches.keys().then(function(keys) {
      return Promise.all(
        keys.filter(function(key) { return key !== CACHE_NAME; })
            .map(function(key) {
              console.log('SW: deleting old cache ' + key);
              return caches.delete(key);
            })
      );
    })
  );
  self.clients.claim();
});

self.addEventListener('fetch', function(event) {
  if (event.request.method !== 'GET') return;

  var url = new URL(event.request.url);

  // CDN resources: cache-first
  if (CDN_URLS.some(function(cdn) { return url.href.indexOf(cdn) === 0; })) {
    event.respondWith(
      caches.match(event.request).then(function(cached) {
        var fetched = fetch(event.request).then(function(response) {
          if (response && response.status === 200) {
            var clone = response.clone();
            caches.open(CACHE_NAME).then(function(cache) { cache.put(event.request, clone); });
          }
          return response;
        }).catch(function() { return cached; });
        return cached || fetched;
      })
    );
    return;
  }

  // Same-origin: stale-while-revalidate
  if (url.origin === self.location.origin) {
    event.respondWith(
      caches.match(event.request).then(function(cached) {
        var fetched = fetch(event.request).then(function(response) {
          if (response && response.status === 200) {
            var clone = response.clone();
            caches.open(CACHE_NAME).then(function(cache) { cache.put(event.request, clone); });
          }
          return response;
        }).catch(function() { return cached; });
        return cached || fetched;
      })
    );
  }
});

self.addEventListener('message', function(event) {
  if (event.data && event.data.type === 'SKIP_WAITING') {
    self.skipWaiting();
  }
});
