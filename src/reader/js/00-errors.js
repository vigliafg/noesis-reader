    // --- ERROR HANDLING ---
    // Prevent ResizeObserver loop limit exceeded error from showing up
    // This is common with complex layout engines like epub.js inside iframes
    window.addEventListener('error', (e) => {
      if (e.message === 'ResizeObserver loop completed with undelivered notifications.') {
        e.stopImmediatePropagation();
      }
    });

    // Unregister previous PWA service worker
    if ('serviceWorker' in navigator) {
      navigator.serviceWorker.getRegistrations().then(function(regs) {
      regs.forEach(function(r) { r.unregister(); });
    }).catch(function() { /* service worker not available in file:// context */ });
    }

