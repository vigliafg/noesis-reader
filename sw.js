// Self-unregistering service worker. DO NOT DELETE — it looks unused because nothing
// registers it, but that is the point: earlier versions of this app were installable as a
// PWA, and anyone who visited back then still has a service worker registered. Their
// browser re-fetches this file to check for updates; serving this version is what removes
// it. Deleting the file would leave those users stuck with the old cached worker.
// (src/reader/js/00-errors.js also unregisters any worker on page load.)

self.addEventListener('install', function() {
  self.skipWaiting();
});

self.addEventListener('activate', function() {
  self.registration.unregister().then(function() {
    return self.clients.matchAll();
  }).then(function(clients) {
    clients.forEach(function(client) { client.navigate(client.url); });
  });
});
