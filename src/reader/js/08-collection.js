    async function _saveCollectionToDB() {
      if (!currentBookId) return;
      try {
        const db = await openDB();
        const bookData = await new Promise((resolve, reject) => {
          const tx = db.transaction(STORE_NAME, 'readonly');
          const store = tx.objectStore(STORE_NAME);
          const req = store.get(currentBookId);
          req.onsuccess = () => resolve(req.result);
          req.onerror = () => reject(req.error);
          tx.onabort = () => { console.warn('Transaction aborted:', tx.error); reject(tx.error || new Error('Transaction was aborted')); };
        });
        if (!bookData) return;
        bookData.collections = _collection.slice();
        await new Promise((resolve, reject) => {
          const tx = db.transaction(STORE_NAME, 'readwrite');
          const store = tx.objectStore(STORE_NAME);
          const req = store.put(bookData);
          req.onsuccess = () => resolve();
          req.onerror = () => reject(req.error);
          tx.onabort = () => { console.warn('Transaction aborted:', tx.error); reject(tx.error || new Error('Transaction was aborted')); };
        });
      } catch (e) {
        console.warn('Save collection failed:', e);
        showToast('❌ Collection save failed', 'error', 3000);
      }
    }

    async function _loadCollectionFromDB(bookId) {
      try {
        const db = await openDB();
        const bookData = await new Promise((resolve, reject) => {
          const tx = db.transaction(STORE_NAME, 'readonly');
          const store = tx.objectStore(STORE_NAME);
          const req = store.get(bookId);
          req.onsuccess = () => resolve(req.result);
          req.onerror = () => reject(req.error);
          tx.onabort = () => { console.warn('Transaction aborted:', tx.error); reject(tx.error || new Error('Transaction was aborted')); };
        });
        _collection = (bookData && bookData.collections) ? bookData.collections : [];
        _updateCollectionBadge();
      } catch (e) {
        console.warn('Load collection failed:', e);
        _collection = [];
        _updateCollectionBadge();
      }
    }

    function _updateCollectionBadge() {
      var badge = document.getElementById('collBadge');
      var hmbBadge = document.getElementById('hmbCollBadge');
      var len = _collection.length;
      if (badge) {
        if (len > 0) {
          badge.textContent = len;
          badge.style.display = 'inline-block';
        } else {
          badge.style.display = 'none';
        }
      }
      if (hmbBadge) {
        if (len > 0) {
          hmbBadge.textContent = len;
          hmbBadge.style.display = 'inline-block';
        } else {
          hmbBadge.style.display = 'none';
        }
      }
    }

    function _saveChunk(chunk) {
      // Detect type (like editor's _enrichChunk)
      var c = chunk.content || '';
      var type = chunk.type || 'text';
      if (!chunk.type) {
        if (/<table[\s>]/i.test(c)) type = 'table';
        else if (/<img[\s>]/i.test(c)) type = 'img';
      }

      var toStore = Object.assign({}, chunk, {
        id: Date.now(),
        type: type,
        book: currentBookTitle || 'Unknown Book',
        chapter: _currentChapterName || '',
        date: new Date().toISOString()
      });
      _collection.push(toStore);
      _saveCollectionToDB();
      _updateCollectionBadge();
      return toStore;
    }

    function _deleteChunkById(id) {
      _collection = _collection.filter(function(c) { return c.id !== id; });
      _saveCollectionToDB();
      _updateCollectionBadge();
    }

    function _clearCollection() {
      _collection = [];
      _checkedChunkIds = {};
      _saveCollectionToDB();
      _updateCollectionBadge();
    }

    // ── Collection Export ───────────────────────────────────────────
    function _sanitizeExportName(name) {
      return (name || 'collection').replace(/[\\/:*?"<>|]/g, '').trim().replace(/\s+/g, '-').substring(0, 100) || 'collection';
    }

    // ── Collection filters state ──
    var _collFilterType = 'all';
    var _collFilterChapter = 'all';
    var _checkedChunkIds = {}; // Persist checkbox selection across filter re-renders

    function _getSelectedOrAll() {
      if (!_collection.length) return [];
      var checkedBoxes = document.querySelectorAll('#collList .coll-checkbox input[type="checkbox"]:checked');
      if (checkedBoxes.length === 0) return _collection.slice();
      var selectedIds = [];
      checkedBoxes.forEach(function(cb) { selectedIds.push(Number(cb.closest('.coll-item').dataset.chunkId)); });
      return _collection.filter(function(c) { return selectedIds.indexOf(c.id) !== -1; });
    }

    function _updateCollSelBadge() {
      var badge = document.getElementById('collSelBadge');
      if (!badge) return;
      var checked = document.querySelectorAll('#collList .coll-checkbox input[type="checkbox"]:checked');
      badge.textContent = checked.length + ' selected';
    }

    function _exportCollectionJSON() {
      var chunks = _getSelectedOrAll();
      if (!chunks.length) { showToast('No items to export', 'error', 2000); return; }
      var collName = prompt('Collection name:', (currentBookTitle || 'Collection'));
      if (collName === null) return; // user cancelled
      collName = collName.trim() || (currentBookTitle || 'Collection');
      var json = JSON.stringify({
        version: 1,
        name: collName,
        bookName: currentBookTitle || 'Collection',
        chapterName: _currentChapterName || '',
        exportedAt: new Date().toISOString(),
        count: chunks.length,
        chunks: chunks
      }, null, 2);
      _downloadFile(_sanitizeExportName(collName) + '.json', json, 'application/json;charset=utf-8');
      showToast('📦 Exported "' + collName + '" (' + chunks.length + ' chunks)', 'saved');
    }

    function _importCollectionFromJSON(file) {
      var reader = new FileReader();
      reader.onload = function(e) {
        try {
          var data = JSON.parse(e.target.result);
          if (!data.chunks || !Array.isArray(data.chunks)) {
            showToast('❌ Invalid collection file: missing chunks array', 'error', 3000);
            return;
          }
          if (data.chunks.length === 0) {
            showToast('⚠ Collection file is empty', 'error', 2000);
            return;
          }
          var collName = data.name || 'Imported';
          var ALLOWED_TYPES = ['img', 'text', 'table'];
          var validChunks = data.chunks.filter(function(c) {
            if (!c.type || ALLOWED_TYPES.indexOf(c.type) === -1) return false;
            if (c.type === 'img' && !c.src) return false;
            if ((c.type === 'text' || c.type === 'table') && !c.content) return false;
            return true;
          });
          if (validChunks.length === 0) {
            showToast('❌ No valid chunks found in file', 'error', 3000);
            return;
          }
          var skipped = data.chunks.length - validChunks.length;
          var confirmMsg = 'Import "' + collName + '"?';
          if (skipped > 0) confirmMsg += '\n(' + skipped + ' invalid chunks will be skipped)';
          confirmMsg += '\n' + validChunks.length + ' chunks will be appended to current collection.';
          if (!confirm(confirmMsg)) return;
          // Reassign IDs to avoid collisions and set current book/chapter context
          var now = Date.now();
          validChunks.forEach(function(c, i) {
            c.id = now + i + Math.floor(Math.random() * 100000);
            c.book = currentBookTitle || c.book || 'Unknown';
            c.date = c.date || new Date().toISOString();
          });
          _collection = _collection.concat(validChunks);
          _saveCollectionToDB();
          _updateCollectionBadge();
          _renderCollectionList();
          showToast('📥 Imported "' + collName + '" (' + validChunks.length + ' chunks)', 'saved');
        } catch (err) {
          console.error('Import JSON failed:', err);
          showToast('❌ Invalid JSON file', 'error', 3000);
        }
      };
      reader.onerror = function() { showToast('❌ Failed to read file', 'error', 3000); };
      reader.readAsText(file);
    }

    // ── Image resizer for export (reduces base64 bloat) ───────────────
    // Converts to JPEG to shrink file size; PNG transparency is lost on resize.
    function _resizeBase64Image(src, maxDim) {
      maxDim = maxDim || 1200;
      return new Promise(function(resolve) {
        var img = new Image();
        img.onload = function() {
          var w = img.naturalWidth, h = img.naturalHeight;
          if (w <= maxDim && h <= maxDim) { resolve(src); return; }
          var scale = Math.min(maxDim / w, maxDim / h);
          var canvas = document.createElement('canvas');
          canvas.width = Math.round(w * scale);
          canvas.height = Math.round(h * scale);
          var ctx = canvas.getContext('2d');
          ctx.drawImage(img, 0, 0, canvas.width, canvas.height);
          resolve(canvas.toDataURL('image/jpeg', 0.85));
        };
        img.onerror = function() { resolve(src); };
        img.src = src;
      });
    }

    async function _exportCollectionHTML() {
      var chunks = _getSelectedOrAll();
      if (!chunks.length) { showToast('No items to export', 'error', 2000); return; }

      // Resize images before embedding (reduces HTML file size)
      var MAX_DIM = 1200;
      var processed = await Promise.all(chunks.map(function(c) {
        if (c.type === 'img' && c.src && c.src.startsWith('data:image/')) {
          return _resizeBase64Image(c.src, MAX_DIM).then(function(resized) {
            var copy = {};
            for (var k in c) copy[k] = c[k];
            copy.src = resized;
            return copy;
          });
        }
        return c;
      }));

      var parts = [];
      parts.push('<!DOCTYPE html>\n<html><head><meta charset="UTF-8"><title>' + (currentBookTitle || 'Collection') + '</title>');
      parts.push('<style>body{font-family:system-ui,sans-serif;max-width:800px;margin:40px auto;padding:20px;color:#1f2937}');
      parts.push('h1{color:#065f46;border-bottom:2px solid #10b981;padding-bottom:8px}');
      parts.push('.chunk{border:1px solid #e5e7eb;border-radius:8px;padding:16px;margin:16px 0}');
      parts.push('.chunk-meta{font-size:12px;color:#6b7280;margin-bottom:8px}');
      parts.push('.chunk-type{background:#d1fae5;color:#065f46;padding:2px 8px;border-radius:4px;font-size:11px;font-weight:600;text-transform:uppercase}');
      parts.push('.chunk-content{margin-top:8px;line-height:1.6}');
      parts.push('.chunk-content img{max-width:100%;border-radius:4px}');
      parts.push('.chunk-content table{border-collapse:collapse;width:100%}');
      parts.push('.chunk-content td,.chunk-content th{border:1px solid #d1d5db;padding:6px 10px}');
      parts.push('</style></head><body>');
      parts.push('<h1>📦 ' + (currentBookTitle || 'Collection') + '</h1>');
      parts.push('<p>' + processed.length + ' chunks exported on ' + new Date().toLocaleString() + '</p>');
      processed.forEach(function(c, i) {
        parts.push('<div class="chunk">');
        parts.push('<div class="chunk-meta"><span class="chunk-type">' + c.type + '</span> ' + (c.chapter || '') + ' · ' + new Date(c.date).toLocaleString() + '</div>');
        parts.push('<div class="chunk-content">');
        if (c.type === 'img') {
          parts.push(c.src ? '<img src="' + c.src + '" alt="' + (c.alt || '') + '">' : '');
          if (c.alt) parts.push('<p>' + c.alt + '</p>');
        } else if (c.type === 'text') {
          parts.push('<blockquote style="border-left:4px solid ' + ({yellow:'#ffeb3b',green:'#a5d6a7',pink:'#f8bbd9'}[c.color]||'#ffeb3b') + ';padding-left:12px;margin:0;white-space:pre-wrap;">' + (c.content || '') + '</blockquote>');
        } else {
          parts.push(c.content || '');
        }
        parts.push('</div></div>');
      });
      parts.push('</body></html>');
      _downloadFile(_sanitizeExportName(currentBookTitle) + '-collection.html', parts.join('\n'), 'text/html;charset=utf-8');
      showToast('📦 Exported ' + processed.length + ' chunks as HTML', 'saved');
    }

    function _exportCollectionMD() {
      var chunks = _getSelectedOrAll();
      if (!chunks.length) { showToast('No items to export', 'error', 2000); return; }
      var lines = [];
      lines.push('# 📦 ' + (currentBookTitle || 'Collection'));
      lines.push('');
      lines.push('*' + chunks.length + ' chunks exported on ' + new Date().toLocaleString() + '*');
      lines.push('');
      for (var i = 0; i < chunks.length; i++) {
        var c = chunks[i];
        lines.push('---');
        lines.push('');
        lines.push('### ' + (i + 1) + '. ' + c.type.toUpperCase() + ' — ' + (c.chapter || 'Unknown chapter'));
        lines.push('');
        if (c.type === 'img') {
          lines.push('![(' + (c.alt || 'image') + ')](' + (c.src || '') + ')');
          if (c.alt) lines.push('*' + c.alt + '*');
        } else if (c.type === 'text') {
          lines.push('> ' + (c.content || '').replace(/\n/g, '\n> '));
          if (c.color) lines.push('*Color: ' + c.color + '*');
        } else {
          lines.push((c.content || '').replace(/<[^>]*>/g, ''));
        }
        lines.push('');
      }
      _downloadFile(_sanitizeExportName(currentBookTitle) + '-collection.md', lines.join('\n'), 'text/markdown;charset=utf-8');
      showToast('📦 Exported ' + chunks.length + ' chunks as Markdown', 'saved');
    }

    // ── Export as ZIP: HTML + images/ folder ──────────────────────
    async function _exportCollectionZIP() {
      var chunks = _getSelectedOrAll();
      if (!chunks.length) { showToast('No items to export', 'error', 2000); return; }

      var zip = new JSZip();
      var imgIndex = 0;
      var parts = [];

      parts.push('<!DOCTYPE html>\n<html><head><meta charset="UTF-8"><title>' + (currentBookTitle || 'Collection') + '</title>');
      parts.push('<style>body{font-family:system-ui,sans-serif;max-width:800px;margin:40px auto;padding:20px;color:#1f2937}');
      parts.push('h1{color:#065f46;border-bottom:2px solid #10b981;padding-bottom:8px}');
      parts.push('.chunk{border:1px solid #e5e7eb;border-radius:8px;padding:16px;margin:16px 0}');
      parts.push('.chunk-meta{font-size:12px;color:#6b7280;margin-bottom:8px}');
      parts.push('.chunk-type{background:#d1fae5;color:#065f46;padding:2px 8px;border-radius:4px;font-size:11px;font-weight:600;text-transform:uppercase}');
      parts.push('.chunk-content{margin-top:8px;line-height:1.6}');
      parts.push('.chunk-content img{max-width:100%;border-radius:4px}');
      parts.push('.chunk-content table{border-collapse:collapse;width:100%}');
      parts.push('.chunk-content td,.chunk-content th{border:1px solid #d1d5db;padding:6px 10px}');
      parts.push('</style></head><body>');
      parts.push('<h1>📦 ' + (currentBookTitle || 'Collection') + '</h1>');
      parts.push('<p>' + chunks.length + ' chunks exported on ' + new Date().toLocaleString() + '</p>');

      chunks.forEach(function(c, i) {
        parts.push('<div class="chunk">');
        parts.push('<div class="chunk-meta"><span class="chunk-type">' + c.type + '</span> ' + (c.chapter || '') + ' · ' + new Date(c.date).toLocaleString() + '</div>');
        parts.push('<div class="chunk-content">');

        if (c.type === 'img' && c.src && c.src.startsWith('data:image/')) {
          var match = c.src.match(/^data:image\/(png|jpeg|jpg|gif|webp);base64,(.+)$/);
          var ext = (match && match[1] === 'jpeg') ? 'jpg' : ((match && match[1]) || 'png');
          var base64Data = match ? match[2] : c.src.split(',')[1] || '';
          var imgFilename = 'image_' + (++imgIndex) + '.' + ext;

          try {
            zip.file('images/' + imgFilename, base64Data, { base64: true });
            parts.push('<img src="images/' + imgFilename + '" alt="' + (c.alt || '') + '">');
          } catch(e) {
            parts.push('<img src="' + c.src + '" alt="' + (c.alt || '') + '">');
          }
          if (c.alt) parts.push('<p>' + c.alt + '</p>');
        } else if (c.type === 'img') {
          parts.push(c.src ? '<img src="' + c.src + '" alt="' + (c.alt || '') + '">' : '');
          if (c.alt) parts.push('<p>' + c.alt + '</p>');
        } else if (c.type === 'text') {
          parts.push('<blockquote style="border-left:4px solid ' + ({yellow:'#ffeb3b',green:'#a5d6a7',pink:'#f8bbd9'}[c.color]||'#ffeb3b') + ';padding-left:12px;margin:0;white-space:pre-wrap;">' + (c.content || '') + '</blockquote>');
        } else {
          parts.push(c.content || '');
        }
        parts.push('</div></div>');
      });
      parts.push('</body></html>');

      zip.file('index.html', parts.join('\n'));

      try {
        showToast('📦 Creating ZIP...', 'saving', 1000);
        var blob = await zip.generateAsync({ type: 'blob' });
        _downloadFile(_sanitizeExportName(currentBookTitle) + '-collection.zip', blob, 'application/zip');
        showToast('📦 Exported ' + chunks.length + ' chunks as ZIP (' + imgIndex + ' images)', 'saved');
      } catch(e) {
        showToast('❌ Failed to create ZIP file', 'error', 3000);
        console.warn('ZIP export failed:', e);
      }
    }

