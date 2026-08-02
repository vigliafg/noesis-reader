    // --- STORAGE UTILITIES ---
    function formatBytes(bytes) {
      if (!bytes || bytes === 0) return '0 B';
      var units = ['B', 'KB', 'MB', 'GB'];
      var i = Math.floor(Math.log(bytes) / Math.log(1024));
      if (i >= units.length) i = units.length - 1;
      return (bytes / Math.pow(1024, i)).toFixed(i === 0 ? 0 : 1) + ' ' + units[i];
    }

    async function getStorageInfo() {
      try {
        if (!navigator.storage || !navigator.storage.estimate) return null;
        var estimate = await navigator.storage.estimate();
        return { usage: estimate.usage || 0, quota: estimate.quota || 0 };
      } catch (e) {
        console.warn('Storage estimate failed:', e);
        return null;
      }
    }

    async function updateStorageBar() {
      var bar = document.getElementById('libStorageBar');
      if (!bar) return;
      var textEl = document.getElementById('libStorageText');
      var booksEl = document.getElementById('libStorageBooks');
      if (!textEl) return;

      var info = await getStorageInfo();
      var bookCount = 0;
      try {
        var books = await getAllBooks();
        bookCount = books ? books.length : 0;
      } catch (e) { /* ignore */ }

      if (info) {
        var used = formatBytes(info.usage);
        var total = formatBytes(info.quota);
        var pct = info.quota > 0 ? Math.round((info.usage / info.quota) * 100) : 0;
        textEl.textContent = '\uD83D\uDCC1 ' + used + ' / ' + total + ' (' + pct + '%)';
      } else {
        textEl.textContent = '\uD83D\uDCC1 Storage info non disponibile';
      }
      if (booksEl && bookCount > 0) {
        booksEl.textContent = bookCount + ' libri';
        booksEl.style.display = '';
      } else if (booksEl) {
        booksEl.style.display = 'none';
      }
      bar.classList.remove('hidden');
    }

    async function checkQuotaBeforeSave(file) {
      var info = await getStorageInfo();
      if (!info) return true; // can't check, allow save
      var remaining = info.quota - info.usage;
      if (file.size > remaining) {
        var needed = formatBytes(file.size);
        var free = formatBytes(remaining);
        alert('Insufficient space.\n\nThe file is ' + needed + ' but you only have ' + free + ' free.\nDelete some books from the library to make room.');
        return false;
      }
      return true;
    }

    (function requestPersistentStorage() {
      if (navigator.storage && navigator.storage.persist) {
        navigator.storage.persist().then(function(granted) {
          if (granted) console.log('Storage persistente: concesso');
        }).catch(function() {});
      }
    })();

