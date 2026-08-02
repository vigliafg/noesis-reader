    // --- MAIN READER MEDIA TAP HANDLER (via postMessage from epub iframe) ---
    // =====================================================================
    (function() {
      var dialog    = document.getElementById('readerMediaDialog');
      var fsOverlay = document.getElementById('readerMediaFullscreen');
      var fsContent = document.getElementById('readerFsContent');
      var fsCaption = document.getElementById('readerFsCaption');
      var fsClose       = document.getElementById('readerFsClose');
      var fsDownload    = document.getElementById('readerFsDownload');
      var fsDownloadMenu = document.getElementById('readerFsDownloadMenu');
      var fsCopy        = document.getElementById('readerFsCopy');
      var fsCollect     = document.getElementById('readerFsCollect');
      var pending = null;
      var _savedMedia = null; // { type, data }

      function hideDialog() {
        dialog.classList.remove('visible');
        dialog.style.top = '';
        dialog.style.left = '';
        pending = null;
      }

      // Expose showDialog globally for highlight preview
      window._showMediaDialog = showDialog;

      function showDialog(type, data) {
        pending = { type: type, data: data };
        dialog.classList.add('visible');
        // Center dialog in viewport
        var vw = window.innerWidth, vh = window.innerHeight;
        var dw = dialog.offsetWidth || 280, dh = dialog.offsetHeight || 80;
        dialog.style.top  = Math.max(8, (vh - dh) / 2) + 'px';
        dialog.style.left = Math.max(8, (vw - dw) / 2) + 'px';
      }

      function doPreview() {
        if (!pending) return;
        var type = pending.type, data = pending.data;
        _savedMedia = { type: type, data: data };
        _populateDownloadMenu();
        hideDialog();
        fsContent.innerHTML = '';
        if (type === 'img') {
          var img = document.createElement('img');
          img.src = data.src;
          img.alt = data.alt || '';
          fsContent.appendChild(img);
          fsCaption.textContent = data.alt || '';
        } else if (type === 'text') {
          var div = document.createElement('div');
          div.className = 'rfs-text-preview';
          div.textContent = data.text;
          var hlBg = { yellow: '#ffeb3b', green: '#a5d6a7', pink: '#f8bbd9' }[data.color] || '#ffeb3b';
          div.style.background = 'rgba(' + parseInt(hlBg.slice(1,3),16) + ',' + parseInt(hlBg.slice(3,5),16) + ',' + parseInt(hlBg.slice(5,7),16) + ',0.12)';
          div.style.borderLeftColor = hlBg;
          fsContent.appendChild(div);
          fsCaption.textContent = 'Highlight: ' + (data.color || 'yellow');
        } else {
          var wrap = document.createElement('div');
          wrap.className = 'rfs-table-wrap';
          wrap.innerHTML = data.html;
          fsContent.appendChild(wrap);
          fsCaption.textContent = '';
        }
        fsOverlay.classList.add('visible');
      }

      document.getElementById('readerMdPreviewBtn').addEventListener('click', function(e) {
        e.stopPropagation();
        doPreview();
      });
      document.getElementById('readerMdExitBtn').addEventListener('click', function(e) {
        e.stopPropagation();
        hideDialog();
      });

      fsClose.addEventListener('click', function() { fsOverlay.classList.remove('visible'); });

      // ── Populate download menu based on media type ────────────────
      function _populateDownloadMenu() {
        if (!_savedMedia) return;
        fsDownloadMenu.innerHTML = '';
        if (_savedMedia.type === 'img') {
          ['PNG', 'JPEG'].forEach(function(fmt) {
            var btn = document.createElement('button');
            btn.textContent = fmt;
            btn.addEventListener('click', function(e) {
              e.stopPropagation();
              fsDownloadMenu.classList.remove('show');
              _doDownload(fmt);
            });
            fsDownloadMenu.appendChild(btn);
          });
        } else if (_savedMedia.type === 'text') {
          ['TXT', 'MD', 'HTML'].forEach(function(fmt) {
            var btn = document.createElement('button');
            btn.textContent = fmt;
            btn.addEventListener('click', function(e) {
              e.stopPropagation();
              fsDownloadMenu.classList.remove('show');
              _doDownload(fmt);
            });
            fsDownloadMenu.appendChild(btn);
          });
        } else {
          ['HTML', 'CSV'].forEach(function(fmt) {
            var btn = document.createElement('button');
            btn.textContent = fmt;
            btn.addEventListener('click', function(e) {
              e.stopPropagation();
              fsDownloadMenu.classList.remove('show');
              _doDownload(fmt);
            });
            fsDownloadMenu.appendChild(btn);
          });
        }
      }

      // ── Sanitize filename ─────────────────────────────────────────
      function _sanitizeFilename(name) {
        return name.replace(/[\\/:*?"<>|]/g, '').replace(/\s+/g, ' ').trim().substring(0, 200) || 'file';
      }

      // ── Download button (toggle menu) ────────────────────────────
      fsDownload.addEventListener('click', function(e) {
        e.stopPropagation();
        fsDownloadMenu.classList.toggle('show');
      });

      // ── Close download menu on outside click ─────────────────────
      document.addEventListener('click', function(e) {
        if (!fsDownloadMenu.contains(e.target) && e.target !== fsDownload) {
          fsDownloadMenu.classList.remove('show');
        }
      });

      // ── Copy button ──────────────────────────────────────────────
      fsCopy.addEventListener('click', function(e) {
        e.stopPropagation();
        copyMedia();
      });

      // ── Collect button ───────────────────────────────────────────
      fsCollect.addEventListener('click', async function(e) {
        e.stopPropagation();
        fsCollect.disabled = true;
        await _addToCollection();
        fsCollect.disabled = false;
      });

      async function _addToCollection() {
        if (!_savedMedia) return;
        var chapterName = _currentChapterName || '';
        var chunk = { type: _savedMedia.type, chapter: chapterName };
        if (_savedMedia.type === 'img') {
          var rawSrc = _savedMedia.data.src;
          chunk.alt = _savedMedia.data.alt || '';
          // Convert blob/http URLs to base64 for persistence across page reloads
          if (rawSrc && (rawSrc.startsWith('blob:') || rawSrc.startsWith('http'))) {
            try {
              chunk.src = await _blobToBase64(rawSrc);
            } catch (e) {
              console.warn('Image conversion failed, storing original:', e);
              chunk.src = rawSrc;
            }
          } else {
            chunk.src = rawSrc || '';
          }
        } else if (_savedMedia.type === 'text') {
          chunk.content = _savedMedia.data.text;
          chunk.color = _savedMedia.data.color || 'yellow';
        } else {
          chunk.content = _savedMedia.data.html;
        }
        // Deduplication: skip if identical chunk already exists
        var isDuplicate = _collection.some(function(existing) {
          if (existing.type !== chunk.type) return false;
          if (chunk.type === 'img') return existing.src === chunk.src;
          if (chunk.type === 'text') return existing.content === chunk.content && existing.color === chunk.color;
          if (chunk.type === 'table') return existing.content === chunk.content;
          return false;
        });
        if (isDuplicate) {
          showToast('📦 Already in collection', 'saved');
          return;
        }
        _saveChunk(chunk);
        showToast('📦 Added to collection (' + _collection.length + ')', 'saved');
      }

      // Convert image URL (blob/http) to base64 data URL
      function _blobToBase64(src) {
        return new Promise(function(resolve, reject) {
          var img = new Image();
          img.crossOrigin = 'Anonymous';
          img.onload = function() {
            var maxDim = 4096;
            var w = img.naturalWidth, h = img.naturalHeight;
            if (w > maxDim || h > maxDim) {
              var scale = Math.min(maxDim / w, maxDim / h);
              w = Math.round(w * scale);
              h = Math.round(h * scale);
            }
            var canvas = document.createElement('canvas');
            canvas.width = w;
            canvas.height = h;
            var ctx = canvas.getContext('2d');
            ctx.drawImage(img, 0, 0, w, h);
            try {
              resolve(canvas.toDataURL('image/png'));
            } catch (e) {
              reject(e);
            }
          };
          img.onerror = function() { reject(new Error('Failed to load image')); };
          img.src = src;
        });
      }

      async function copyMedia() {
        if (!_savedMedia) return;
        try {
          if (_savedMedia.type === 'img') {
            var img = new Image();
            img.crossOrigin = 'Anonymous';
            await new Promise(function(resolve, reject) {
              img.onload = resolve;
              img.onerror = reject;
              img.src = _savedMedia.data.src;
            });
            var maxDim = 4096;
            var w = img.naturalWidth, h = img.naturalHeight;
            if (w > maxDim || h > maxDim) {
              var scale = Math.min(maxDim / w, maxDim / h);
              w = Math.round(w * scale);
              h = Math.round(h * scale);
            }
            var canvas = document.createElement('canvas');
            canvas.width = w;
            canvas.height = h;
            var ctx = canvas.getContext('2d');
            ctx.drawImage(img, 0, 0, w, h);
            var blob = await new Promise(function(resolve) {
              canvas.toBlob(resolve, 'image/png');
            });
            await navigator.clipboard.write([
              new ClipboardItem({ 'image/png': blob })
            ]);
          } else if (_savedMedia.type === 'text') {
            await navigator.clipboard.writeText(_savedMedia.data.text);
          } else {
            var tableHtml = _savedMedia.data.html;
            var tempDiv = document.createElement('div');
            tempDiv.innerHTML = tableHtml;
            var plainText = (tempDiv.textContent || '').trim();
            var htmlBlob = new Blob([tableHtml], { type: 'text/html' });
            var textBlob = new Blob([plainText], { type: 'text/plain' });
            await navigator.clipboard.write([
              new ClipboardItem({
                'text/html': htmlBlob,
                'text/plain': textBlob
              })
            ]);
          }
          showToast('✅ Copied to clipboard', 'saved', 2000);
        } catch (e) {
          console.error('Copy failed:', e);
          showToast('❌ Copy failed', 'error', 2500);
        }
      }

      // ── Core download logic ──────────────────────────────────────
      function _doDownload(fmt) {
        if (!_savedMedia) return;
        var ts = Date.now();
        var proposal, ext, mime, content;

        if (_savedMedia.type === 'img') {
          var alt = (_savedMedia.data.alt || '').trim();
          proposal = alt ? _sanitizeFilename(alt) : 'image-' + ts;
          ext = fmt === 'JPEG' ? 'jpg' : 'png';
          var propFilename = prompt('Save as:', proposal + '.' + ext);
          if (!propFilename) return;

          var mimeFmt = fmt === 'JPEG' ? 'image/jpeg' : 'image/png';
          var quality = fmt === 'JPEG' ? 0.92 : 1.0;
          var img = new Image();
          img.onload = function() {
            var maxDim = 4096;
            var w = img.naturalWidth, h = img.naturalHeight;
            if (w > maxDim || h > maxDim) {
              var scale = Math.min(maxDim / w, maxDim / h);
              w = Math.round(w * scale);
              h = Math.round(h * scale);
            }
            var canvas = document.createElement('canvas');
            canvas.width = w;
            canvas.height = h;
            var ctx = canvas.getContext('2d');
            ctx.drawImage(img, 0, 0, w, h);
            canvas.toBlob(function(blob) {
              _downloadFile(propFilename, blob, mimeFmt);
              showToast('✅ Saved as ' + propFilename, 'saved', 2200);
            }, mimeFmt, quality);
          };
          img.onerror = function() {
            showToast('❌ Failed to load image', 'error', 2500);
          };
          img.src = _savedMedia.data.src;
        } else if (_savedMedia.type === 'text') {
          var text = _savedMedia.data.text;
          var color = _savedMedia.data.color || 'yellow';
          var sColor = color.charAt(0).toUpperCase() + color.slice(1);
          proposal = 'highlight-' + ts;
          if (fmt === 'TXT') {
            ext = 'txt'; mime = 'text/plain;charset=utf-8';
            var propFilename = prompt('Save as:', proposal + '.' + ext);
            if (!propFilename) return;
            content = '[Highlight: ' + sColor + ']\n\n' + text;
            _downloadFile(propFilename, content, mime);
            showToast('✅ Saved as ' + propFilename, 'saved', 2200);
          } else if (fmt === 'MD') {
            ext = 'md'; mime = 'text/markdown;charset=utf-8';
            var propFilename = prompt('Save as:', proposal + '.' + ext);
            if (!propFilename) return;
            content = '> **' + sColor + ' highlight:**\n>\n> ' + text.replace(/\n/g, '\n> ');
            _downloadFile(propFilename, content, mime);
            showToast('✅ Saved as ' + propFilename, 'saved', 2200);
          } else if (fmt === 'HTML') {
            ext = 'html'; mime = 'text/html;charset=utf-8';
            var propFilename = prompt('Save as:', proposal + '.' + ext);
            if (!propFilename) return;
            var hlBg = { yellow: '#ffeb3b', green: '#a5d6a7', pink: '#f8bbd9' }[color] || '#ffeb3b';
            content = '<!DOCTYPE html>\n<html><head><meta charset="UTF-8"><title>Highlight</title>' +
              '<style>body{font-family:Georgia,serif;max-width:700px;margin:40px auto;padding:20px;font-size:18px;line-height:1.9}' +
              '.hl{background:' + hlBg + ';padding:2px 0;}</style></head><body>' +
              '<p class="hl">' + text.replace(/&/g,'&amp;').replace(/</g,'&lt;').replace(/>/g,'&gt;').replace(/\n/g,'<br>') + '</p>' +
              '<p style="color:#888;font-size:13px;margin-top:20px;">Highlight: ' + sColor + '</p></body></html>';
            _downloadFile(propFilename, content, mime);
            showToast('✅ Saved as ' + propFilename, 'saved', 2200);
          }
        } else {
          if (fmt === 'HTML') {
            proposal = 'table-' + ts;
            ext = 'html'; mime = 'text/html;charset=utf-8';
            var propFilename = prompt('Save as:', proposal + '.' + ext);
            if (!propFilename) return;
            content = '<!DOCTYPE html>\n<html><head><meta charset="UTF-8"><title>Table</title>' +
              '<style>body{font-family:system-ui;max-width:900px;margin:20px auto;padding:20px}' +
              'table{border-collapse:collapse;width:100%}td,th{border:1px solid #ccc;padding:6px 10px}</style>' +
              '</head><body>' + _savedMedia.data.html + '</body></html>';
            _downloadFile(propFilename, content, mime);
            showToast('✅ Saved as ' + propFilename, 'saved', 2200);
          } else {
            proposal = 'table-' + ts;
            ext = 'csv'; mime = 'text/csv;charset=utf-8';
            var propFilename = prompt('Save as:', proposal + '.' + ext);
            if (!propFilename) return;
            var temp = document.createElement('div');
            temp.innerHTML = _savedMedia.data.html;
            var table = temp.querySelector('table');
            if (!table) {
              showToast('❌ No table found', 'error', 2500);
              return;
            }
            var rows = table.querySelectorAll('tr');
            var csv = '';
            rows.forEach(function(row) {
              var cells = row.querySelectorAll('td, th');
              var rowData = [];
              cells.forEach(function(cell) {
                rowData.push('"' + (cell.textContent || '').replace(/"/g, '""') + '"');
              });
              csv += rowData.join(',') + '\n';
            });
            _downloadFile(propFilename, csv, mime);
            showToast('✅ Saved as ' + propFilename, 'saved', 2200);
          }
        }
      }

      fsOverlay.addEventListener('click', function(e) {
        if (e.target === fsOverlay) fsOverlay.classList.remove('visible');
      });

      document.addEventListener('click', function(e) {
        if (dialog.classList.contains('visible') && !dialog.contains(e.target)) {
          hideDialog();
        }
      });

      // Listen for postMessage from epub iframe
      window.addEventListener('message', function(e) {
        if (!e.data || !e.data.epubMediaTap) return;
        showDialog(e.data.type, e.data.data);
      });
    })();

