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

    // --- INDEXEDDB & LIBRARY LOGIC ---

    // --- NOESIS DB (extractedChapters + snapshots) ---
    const NOESIS_DB_NAME = 'noesisDB';
    const NOESIS_DB_VERSION = 1;
    const NOESIS_STORE = 'extractedChapters';

    function openNoesisDB() {
      return new Promise((resolve, reject) => {
        const request = indexedDB.open(NOESIS_DB_NAME, NOESIS_DB_VERSION);
        var blockedTimer = null;
        request.onupgradeneeded = (event) => {
          const db = event.target.result;
          if (!db.objectStoreNames.contains(NOESIS_STORE)) {
            const store = db.createObjectStore(NOESIS_STORE, { keyPath: 'chapterId' });
            store.createIndex('bookName', 'bookName', { unique: false });
            store.createIndex('chapterName', 'chapterName', { unique: false });
          }
        };
        request.onsuccess = (event) => {
          if (blockedTimer) clearTimeout(blockedTimer);
          const db = event.target.result;
          db.onversionchange = () => { db.close(); console.warn('NoesisDB: version changed externally, connection closed.'); };
          resolve(db);
        };
        request.onerror = (event) => {
          if (blockedTimer) clearTimeout(blockedTimer);
          const error = event.target.error;
          if (error.name === 'VersionError') {
            console.warn('NoesisDB VersionError, deleting old database...');
            const deleteRequest = indexedDB.deleteDatabase(NOESIS_DB_NAME);
            deleteRequest.onsuccess = () => {
              const retryRequest = indexedDB.open(NOESIS_DB_NAME, NOESIS_DB_VERSION);
              retryRequest.onupgradeneeded = (event) => {
                const db = event.target.result;
                if (!db.objectStoreNames.contains(NOESIS_STORE)) {
                  const store = db.createObjectStore(NOESIS_STORE, { keyPath: 'chapterId' });
                  store.createIndex('bookName', 'bookName', { unique: false });
                  store.createIndex('chapterName', 'chapterName', { unique: false });
                }
              };
              retryRequest.onsuccess = (event) => {
                const db = event.target.result;
                db.onversionchange = () => { db.close(); };
                resolve(db);
              };
              retryRequest.onerror = (event) => reject(event.target.error);
              retryRequest.onblocked = () => {
                blockedTimer = setTimeout(() => {
                  reject(new Error('Database upgrade blocked by another connection. Close other tabs using the app and reload.'));
                }, 5000);
              };
            };
            deleteRequest.onerror = () => reject(error);
          } else {
            reject(error);
          }
        };
        request.onblocked = () => {
          console.warn('NoesisDB: upgrade blocked by another connection, waiting...');
          blockedTimer = setTimeout(() => {
            reject(new Error('Database upgrade blocked by another connection. Close other tabs using the app and reload.'));
          }, 5000);
        };
      });
    }

    async function saveExtractedChapterToDB(chapterRecord) {
      const db = await openNoesisDB();
      return new Promise((resolve, reject) => {
        const tx = db.transaction(NOESIS_STORE, 'readwrite');
        const store = tx.objectStore(NOESIS_STORE);
        const request = store.put(chapterRecord);
        request.onsuccess = () => resolve(chapterRecord);
        request.onerror = (e) => reject(e);
          tx.onabort = () => { console.warn('Transaction aborted:', tx.error); reject(tx.error || new Error('Transaction was aborted')); };
      });
    }

    async function deleteExtractedChapterFromDB(chapterId) {
      const db = await openNoesisDB();
      return new Promise((resolve, reject) => {
        const tx = db.transaction(NOESIS_STORE, 'readwrite');
        const store = tx.objectStore(NOESIS_STORE);
        const request = store.delete(chapterId);
        request.onsuccess = () => resolve();
        request.onerror = (e) => reject(e);
          tx.onabort = () => { console.warn('Transaction aborted:', tx.error); reject(tx.error || new Error('Transaction was aborted')); };
      });
    }

    async function deleteSnapshotFromDB(chapterId, snapshotId) {
      const record = await getExtractedChapterFromDB(chapterId);
      if (!record) return;
      record.snapshots = (record.snapshots || []).filter(s => s.snapshotId !== snapshotId);
      await saveExtractedChapterToDB(record);
    }

    async function getExtractedChapterFromDB(chapterId) {
      const db = await openNoesisDB();
      return new Promise((resolve, reject) => {
        const tx = db.transaction(NOESIS_STORE, 'readonly');
        const store = tx.objectStore(NOESIS_STORE);
        const request = store.get(chapterId);
        request.onsuccess = () => resolve(request.result || null);
        request.onerror = (e) => reject(e);
          tx.onabort = () => { console.warn('Transaction aborted:', tx.error); reject(tx.error || new Error('Transaction was aborted')); };
      });
    }
    // --- END NOESIS DB ---

    const DB_NAME = 'EpubLibraryDB';
    const DB_VERSION = 1;
    const STORE_NAME = 'books';

    // Init DB
    function openDB() {
      return new Promise((resolve, reject) => {
        const request = indexedDB.open(DB_NAME, DB_VERSION);
        var blockedTimer = null;

        request.onupgradeneeded = (event) => {
          const db = event.target.result;
          if (!db.objectStoreNames.contains(STORE_NAME)) {
            db.createObjectStore(STORE_NAME, { keyPath: 'id' });
          }
        };

        request.onsuccess = (event) => {
          if (blockedTimer) clearTimeout(blockedTimer);
          const db = event.target.result;
          db.onversionchange = () => { db.close(); console.warn('EpubLibraryDB: version changed externally, connection closed.'); };
          resolve(db);
        };

        request.onerror = (event) => {
          if (blockedTimer) clearTimeout(blockedTimer);
          const error = event.target.error;
          // Handle version error by deleting and recreating the database
          if (error.name === 'VersionError') {
            console.warn('EpubLibraryDB VersionError, deleting old database...');
            const deleteRequest = indexedDB.deleteDatabase(DB_NAME);
            deleteRequest.onsuccess = () => {
              console.log('Old database deleted, retrying...');
              // Retry opening after deletion
              const retryRequest = indexedDB.open(DB_NAME, DB_VERSION);
              retryRequest.onupgradeneeded = (event) => {
                const db = event.target.result;
                if (!db.objectStoreNames.contains(STORE_NAME)) {
                  db.createObjectStore(STORE_NAME, { keyPath: 'id' });
                }
              };
              retryRequest.onsuccess = (event) => {
                const db = event.target.result;
                db.onversionchange = () => { db.close(); };
                resolve(db);
              };
              retryRequest.onerror = (event) => reject(event.target.error);
              retryRequest.onblocked = () => {
                blockedTimer = setTimeout(() => {
                  reject(new Error('Database upgrade blocked by another connection. Close other tabs using the app and reload.'));
                }, 5000);
              };
            };
            deleteRequest.onerror = () => reject(error);
          } else {
            reject(error);
          }
        };

        request.onblocked = () => {
          console.warn('EpubLibraryDB: upgrade blocked by another connection, waiting...');
          blockedTimer = setTimeout(() => {
            reject(new Error('Database upgrade blocked by another connection. Close other tabs using the app and reload.'));
          }, 5000);
        };
      });
    }

    /* ── EPUB Validation Utilities ── */
    function validateEpubFile(file) {
      const name = file.name.toLowerCase();
      if (!name.endsWith('.epub')) {
        return { valid: false, error: 'The file "' + file.name + '" is not an EPUB. Please select a file with .epub extension.' };
      }
      if (file.type && file.type !== '' && file.type !== 'application/epub+zip') {
        return { valid: false, error: 'The file "' + file.name + '" is not a valid EPUB (detected type: ' + file.type + ').' };
      }
      return { valid: true };
    }

    async function validateEpubStructure(arrayBuffer) {
      try {
        const zip = await JSZip.loadAsync(arrayBuffer);
        const mimetypeFile = zip.file('mimetype');
        if (!mimetypeFile) {
          return { valid: false, error: 'Malformed EPUB: "mimetype" file missing.' };
        }
        const mimetypeContent = await mimetypeFile.async('string');
        if (mimetypeContent.trim() !== 'application/epub+zip') {
          return { valid: false, error: 'Malformed EPUB: invalid mimetype.' };
        }
        const containerFile = zip.file('META-INF/container.xml');
        if (!containerFile) {
          return { valid: false, error: 'Malformed EPUB: META-INF/container.xml missing.' };
        }
        const containerXml = await containerFile.async('string');
        const parser = new DOMParser();
        const doc = parser.parseFromString(containerXml, 'application/xml');
        /* getElementsByTagName is namespace-unaware and safer than querySelector for XML */
        const rootfile = doc.getElementsByTagName('rootfile')[0];
        if (!rootfile) {
          return { valid: false, error: 'Malformed EPUB: container.xml does not contain <rootfile>.' };
        }
        const opfPath = rootfile.getAttribute('full-path');
        if (!opfPath) {
          return { valid: false, error: 'Malformed EPUB: OPF path not specified in container.xml.' };
        }
        const opfFile = zip.file(opfPath);
        if (!opfFile) {
          return { valid: false, error: 'Malformed EPUB: OPF file "' + opfPath + '" not found.' };
        }
        /* Return zip object to avoid re-parsing in detectDrm */
        return { valid: true, zip: zip };
      } catch (e) {
        if (e.message && (e.message.includes('not a valid zip') || e.message.includes('corrupt') || e.message.includes('invalid'))) {
          return { valid: false, error: 'The file is not a valid ZIP archive. It may be corrupted or not an EPUB.' };
        }
        return { valid: false, error: 'Cannot read EPUB structure. The file may be damaged.' };
      }
    }

    async function detectDrm(zipOrBuffer) {
      try {
        /* Accept either a JSZip instance (from validateEpubStructure) or an ArrayBuffer */
        const zip = (zipOrBuffer && zipOrBuffer.files) ? zipOrBuffer : await JSZip.loadAsync(zipOrBuffer);
        const encryptionFile = zip.file('META-INF/encryption.xml');
        if (encryptionFile) {
          return { hasDrm: true, message: 'This EPUB is protected by DRM and cannot be read.\n\nDRM-protected files require Adobe Digital Editions or authorized software.' };
        }
        return { hasDrm: false };
      } catch (e) {
        return { hasDrm: false };
      }
    }

    async function saveBookToDB(file) {
      /* 1. Validate file type (extension + MIME) */
      const fileCheck = validateEpubFile(file);
      if (!fileCheck.valid) throw new Error(fileCheck.error);

      const arrayBuffer = await file.arrayBuffer();

      /* 2. Validate EPUB structure (ZIP, mimetype, container.xml, OPF) — returns zip for reuse */
      const structCheck = await validateEpubStructure(arrayBuffer);
      if (!structCheck.valid) throw new Error(structCheck.error);

      /* 3. Detect DRM (reuses parsed ZIP from structCheck) */
      const drmCheck = await detectDrm(structCheck.zip);
      if (drmCheck.hasDrm) throw new Error(drmCheck.message);

      /* 4. Open DB only after all validations pass */
      const db = await openDB();

      // Temporary load to get metadata
      const book = ePub(arrayBuffer);
      await book.ready;
      const metadata = await book.loaded.metadata;

      let coverUrl = '';
      try {
        coverUrl = await book.coverUrl(); // Returns a blob URL
      } catch (e) {
        console.warn('No cover found', e);
      }

      // Convert blob URL to base64 for storage (since blob URLs expire)
      let coverBase64 = null;
      if (coverUrl) {
        try {
          const response = await fetch(coverUrl);
          const blob = await response.blob();
          coverBase64 = await new Promise((resolve) => {
            const reader = new FileReader();
            reader.onloadend = () => resolve(reader.result);
            reader.readAsDataURL(blob);
          });
        } catch (e) {
          console.warn('Could not convert cover to base64');
        }
      }

      const bookRecord = {
        id: Date.now().toString(),
        title: metadata.title || file.name.replace('.epub', ''),
        author: metadata.creator || 'Unknown Author',
        data: arrayBuffer,
        cover: coverBase64,
        addedAt: Date.now()
      };

      return new Promise((resolve, reject) => {
        const tx = db.transaction(STORE_NAME, 'readwrite');
        const store = tx.objectStore(STORE_NAME);
        const request = store.add(bookRecord);

        request.onsuccess = () => resolve(bookRecord);
        request.onerror = (e) => reject(e);
          tx.onabort = () => { console.warn('Transaction aborted:', tx.error); reject(tx.error || new Error('Transaction was aborted')); };
      });
    }

    async function getAllBooks() {
      const db = await openDB();
      return new Promise((resolve, reject) => {
        const tx = db.transaction(STORE_NAME, 'readonly');
        const store = tx.objectStore(STORE_NAME);
        const request = store.getAll();

        request.onsuccess = () => resolve(request.result);
        request.onerror = (e) => reject(e);
          tx.onabort = () => { console.warn('Transaction aborted:', tx.error); reject(tx.error || new Error('Transaction was aborted')); };
      });
    }

    async function deleteBook(id) {
      const db = await openDB();
      // Delete the book record (savedState is embedded, so it's removed too)
      await new Promise((resolve, reject) => {
        const tx = db.transaction(STORE_NAME, 'readwrite');
        const store = tx.objectStore(STORE_NAME);
        const request = store.delete(id);
        request.onsuccess = () => resolve();
        request.onerror = (e) => reject(e);
          tx.onabort = () => { console.warn('Transaction aborted:', tx.error); reject(tx.error || new Error('Transaction was aborted')); };
      });
      // If this was the currently open book, reset tracking
      if (currentBookId === id) {
        currentBookId = null;
      }
      updateStorageBar();
    }

    // --- UI VIEW SWITCHING ---

    const libraryView = document.getElementById('library-view');
    const readerView = document.getElementById('reader-view');
    const bookGrid = document.getElementById('bookGrid');
    const loadingOverlay = document.getElementById('loading-overlay');
    const loadingMsg = document.getElementById('loading-msg');

    function showLoading(msg) {
      loadingMsg.textContent = msg;
      loadingOverlay.classList.remove('hidden');
    }

    function hideLoading() {
      loadingOverlay.classList.add('hidden');
    }

    async function showLibrary() {
      stopAutoSave();
      _lastSavedVisualState = null;
      _hideDisplaySavePrompt();
      readerView.classList.add('hidden');
      libraryView.classList.remove('hidden');

      // ── Random brand animation ──
      _triggerBrandAnim();

      // Save annotations before resetting
      if (currentBookId && readerHighlights.length > 0) {
        await saveVisualSettings();
      }

      // Reset reader state when leaving
      if (book) {
        book.destroy();
        book = null;
      }
      if (rendition) {
        rendition.destroy();
        rendition = null;
      }
      document.getElementById('toc').innerHTML = '';
      document.getElementById('viewer').innerHTML = '';

      // Reset tracking
      currentBookId = null;
      setStatusPath('');

      // Reset highlights
      readerHighlights = [];
      currentReaderHighlightColor = 'yellow';
      _readerPendingCfi = null;
      const hlBtn = document.getElementById('readerHighlightBtn');
      if (hlBtn) {
        hlBtn.className = 'btn btn-icon hl-yellow';
        hlBtn.style.outline = '';
        hlBtn.title = 'Highlight text';
      }
      const hlMenu = document.getElementById('readerHighlightMenu');
      if (hlMenu) hlMenu.classList.remove('show');

      // Close and clear user bookmarks drawer
      closeUbmDrawer();
      userBookmarks = [];
      renderUbmList();

      loadLibraryBooks();
    }

    function showReader() {
      libraryView.classList.add('hidden');
      readerView.classList.remove('hidden');
    }

    // ── Utility: get all extracted chapters from noesisDB ────────────────
    // ════════════════════════════════════════════════════════════════════════
    // SN56.X — FUNZIONI DI INFRASTRUTTURA
    // ════════════════════════════════════════════════════════════════════════

    // ── Lancia sn56.x con payload chapter o standalone ───────────────────────
    // ── Genera HTML leggibile offline (no toolbar) ───────────────────────────
    // includeNoesisMeta: true → noesis-origin- (reimportabile), false → noesis-extract-
    function _generateCleanHTML(bookName, chapterName, chapterId, htmlContent, includeNoesisMeta) {
      const metaTags = includeNoesisMeta ? `
<meta name="noesis-chapter-id"       content="${chapterId}">
<meta name="noesis-book-name"        content="${bookName}">
<meta name="noesis-chapter-name"     content="${chapterName}">
<meta name="noesis-snapshot-variant" content="origin">` : '';
      return `<!DOCTYPE html>
<html lang="it"><head>
<meta charset="UTF-8">${metaTags}
<title>${chapterName || bookName || 'Noesis'}</title>
<style>
body{max-width:900px;margin:auto;padding:40px 20px;font-family:system-ui;line-height:1.6;}
img{max-width:100%;height:auto;}
table{width:100%;border-collapse:collapse;}
td,th{border:1px solid #ddd;padding:8px;word-break:break-word;}
</style>
</head><body>
${htmlContent}
</body></html>`;
    }

    // ── Timestamp condiviso per la coppia extract+origin ─────────────────────
    function _buildExtractionTimestamp() {
      const d = new Date();
      return d.getFullYear().toString()
        + String(d.getMonth() + 1).padStart(2, '0')
        + String(d.getDate()).padStart(2, '0') + '_'
        + String(d.getHours()).padStart(2, '0')
        + String(d.getMinutes()).padStart(2, '0')
        + String(d.getSeconds()).padStart(2, '0');
    }

    // ── Download as Plain Text ──────────────────────────────────────────
    function _downloadAsText(htmlContent, filename) {
      const temp = document.createElement('div');
      temp.innerHTML = htmlContent;
      const ps = temp.querySelectorAll('p, h1, h2, h3, h4, h5, h6, li');
      let text = '';
      ps.forEach(function(p, i) { if (i > 0) text += '\n'; text += p.innerText; });
      if (!text) text = temp.innerText;
      _downloadFile(filename, text, 'text/plain;charset=utf-8');
    }

    // ── Download as Markdown (TurndownService) ───────────────────────────
    function _downloadAsMarkdown(htmlContent, filename) {
      const md = new TurndownService().turndown(htmlContent);
      _downloadFile(filename, md, 'text/markdown;charset=utf-8');
    }

    // ── Generate standalone EPUB ─────────────────────────────────────────
    async function _generateEpub(htmlContent, title, author, filename, styles) {
      const zip = new JSZip();
      zip.file('mimetype', 'application/epub+zip', { compression: 'STORE' });
      zip.file('META-INF/container.xml',
        '<?xml version="1.0" encoding="UTF-8"?>\n' +
        '<container version="1.0" xmlns="urn:oasis:names:tc:opendocument:xmlns:container">\n' +
        '  <rootfiles>\n' +
        '    <rootfile full-path="OEBPS/content.opf" media-type="application/oebps-package+xml"/>\n' +
        '  </rootfiles>\n' +
        '</container>');

      const temp = document.createElement('div');
      temp.innerHTML = htmlContent;
      const imgs = temp.querySelectorAll('img');
      const images = [];
      let imgIdx = 1;
      imgs.forEach(function(img) {
        const src = img.getAttribute('src');
        if (src && src.startsWith('data:')) {
          const m = src.match(/^data:image\/([^;]+);base64,(.+)$/);
          if (m) {
            const ext = m[1] === 'jpeg' ? 'jpg' : m[1];
            const safeExt = ext.replace(/[^a-zA-Z0-9]/g, '_');
            const name = 'img_' + String(imgIdx++).padStart(3, '0') + '.' + safeExt;
            images.push({ name: name, ext: ext, data: m[2] });
            img.setAttribute('src', 'images/' + name);
          }
        }
      });
      const processedHTML = temp.innerHTML;

      zip.file('OEBPS/chapter.xhtml',
        '<?xml version="1.0" encoding="UTF-8"?>\n' +
        '<!DOCTYPE html>\n' +
        '<html xmlns="http://www.w3.org/1999/xhtml" xmlns:epub="http://www.idpf.org/2007/ops">\n' +
        '<head><title>' + (title || 'Chapter') + '</title><meta charset="UTF-8"/>' +
        (styles ? '\n<style>\n' + styles + '\n</style>' : '') +
        '</head>\n' +
        '<body>' + processedHTML + '</body>\n' +
        '</html>');

      if (images.length > 0) {
        const imgFolder = zip.folder('OEBPS/images');
        images.forEach(function(img) { imgFolder.file(img.name, img.data, { base64: true }); });
      }

      const mimeMap = { png: 'image/png', jpg: 'image/jpeg', jpeg: 'image/jpeg', gif: 'image/gif', svg_xml: 'image/svg+xml', webp: 'image/webp' };
      const imageItems = images.map(function(img) {
        const safeId = img.name.replace(/[^a-zA-Z0-9]/g, '_');
        return '    <item id="img_' + safeId + '" href="images/' + img.name + '" media-type="' + (mimeMap[img.ext.replace(/[^a-zA-Z0-9]/g, '_')] || 'image/' + img.ext) + '"/>';
      }).join('\n');

      zip.file('OEBPS/content.opf',
        '<?xml version="1.0" encoding="UTF-8"?>\n' +
        '<package version="3.0" unique-identifier="book-id" xmlns="http://www.idpf.org/2007/opf">\n' +
        '  <metadata xmlns:dc="http://purl.org/dc/elements/1.1/">\n' +
        '    <dc:title>' + (title || 'Untitled') + '</dc:title>\n' +
        '    <dc:creator>' + (author || 'Unknown') + '</dc:creator>\n' +
        '    <dc:language>en</dc:language>\n' +
        '    <dc:identifier id="book-id">noesis-' + Date.now() + '</dc:identifier>\n' +
        '  </metadata>\n' +
        '  <manifest>\n' +
        '    <item id="chapter" href="chapter.xhtml" media-type="application/xhtml+xml"/>\n' +
        (imageItems ? imageItems + '\n' : '') +
        '  </manifest>\n' +
        '  <spine>\n' +
        '    <itemref idref="chapter"/>\n' +
        '  </spine>\n' +
        '</package>');

      const blob = await zip.generateAsync({ type: 'blob', mimeType: 'application/epub+zip' });
      _downloadFile(filename, blob, 'application/epub+zip');
    }

    // ── Print to PDF via browser ─────────────────────────────────────────
    function _printPDF(htmlContent) {
      let pc = document.getElementById('print-container');
      if (!pc) {
        pc = document.createElement('div');
        pc.id = 'print-container';
        pc.style.cssText = 'display:none;font-family:system-ui;max-width:750px;margin:0 auto;padding:20px;';
        document.body.appendChild(pc);
      }
      pc.innerHTML = htmlContent;
      pc.querySelectorAll('table').forEach(function(t) {
        t.removeAttribute('width');
        t.style.cssText += 'width:100%;table-layout:fixed;border-collapse:collapse;word-break:break-word;max-width:100%;';
      });
      pc.querySelectorAll('td,th').forEach(function(c) {
        c.removeAttribute('width'); c.style.width = ''; c.style.maxWidth = '';
        c.style.wordBreak = 'break-word'; c.style.overflowWrap = 'break-word'; c.style.padding = '4px';
      });
      pc.querySelectorAll('img').forEach(function(img) {
        img.removeAttribute('width'); img.removeAttribute('height');
        img.style.maxWidth = '100%'; img.style.height = 'auto';
      });
      window.print();
      setTimeout(function() { pc.innerHTML = ''; }, 1000);
    }

    // ── Dispatch extract download based on selected format ────────────────
    function _dispatchExtractDownload(bookName, chapterName, chapterId, htmlContent, timestamp, styles) {
      const sBook = bookName.replace(/[^a-zA-Z0-9]/g, '_').substring(0, 40);
      const sCh = chapterName.replace(/[^a-zA-Z0-9]/g, '_').substring(0, 40);

      switch (_extractFormat) {
        case 'html-clean':
          _autoDownloadHTML(`noesis-clean-${sBook}__${sCh}__${timestamp}.html`,
            _generateCleanHTML(bookName, chapterName, '', htmlContent, false));
          break;
        case 'html-annotated':
          _autoDownloadHTML(`noesis-annotated-${sBook}__${sCh}__${timestamp}.html`,
            _generateCleanHTML(bookName, chapterName, chapterId, htmlContent, true));
          break;
        case 'txt':
          _downloadAsText(htmlContent, `noesis-extract-${sBook}__${sCh}__${timestamp}.txt`);
          break;
        case 'md':
          _downloadAsMarkdown(htmlContent, `noesis-extract-${sBook}__${sCh}__${timestamp}.md`);
          break;
        case 'epub':
          _generateEpub(htmlContent, bookName, bookName, `noesis-extract-${sBook}__${sCh}__${timestamp}.epub`, styles || '')
            .catch(e => { console.error('EPUB generation failed:', e); alert('EPUB generation failed: ' + e.message); });
          break;
        case 'pdf':
          if (!confirm('⚠️ Make sure you\'ve scrolled all the way to the end of the chapter before exporting. Otherwise, the PDF may miss pages or show untranslated text.')) return;
          _printPDF(htmlContent);
          break;
        case 'zip':
          _extractChapterZip(htmlContent, bookName, chapterName, timestamp);
          break;
      }
      // After dispatch: open editor if Extract+Edit was requested
      if (_shouldOpenEditor) {
        _shouldOpenEditor = false;
        _openChapterInEditor(htmlContent, bookName, chapterName, chapterId);
      }
    }

    // ── Download automatico file HTML (no dialog, per coppie automatiche) ────
    // ── Extract chapter as ZIP: HTML + images/ folder ─────────────
    async function _extractChapterZip(htmlContent, bookName, chapterName, timestamp) {
      var sBook = bookName.replace(/[^a-zA-Z0-9]/g, '_').substring(0, 40);
      var sCh = chapterName.replace(/[^a-zA-Z0-9]/g, '_').substring(0, 40);
      var filename = 'noesis-zip-' + sBook + '__' + sCh + '__' + timestamp + '.zip';

      var zip = new JSZip();
      var imgIndex = 0;

      // Parse images from HTML and replace with local paths
      var temp = document.createElement('div');
      temp.innerHTML = htmlContent;
      var imgs = temp.querySelectorAll('img[src^="data:image/"]');

      for (var i = 0; i < imgs.length; i++) {
        var src = imgs[i].getAttribute('src');
        var match = src.match(/^data:image\/(png|jpeg|jpg|gif|webp);base64,(.+)$/);
        if (!match) continue;
        var ext = (match[1] === 'jpeg') ? 'jpg' : match[1];
        var base64Data = match[2];
        var imgFilename = 'image_' + (++imgIndex) + '.' + ext;
        try {
          zip.file('images/' + imgFilename, base64Data, { base64: true });
          imgs[i].setAttribute('src', 'images/' + imgFilename);
        } catch(e) {
          // leave embedded if ZIP fails
        }
      }

      zip.file('index.html', temp.innerHTML);

      try {
        showToast('📦 Creating ZIP...', 'saving', 1000);
        var blob = await zip.generateAsync({ type: 'blob' });
        _downloadFile(filename, blob, 'application/zip');
        showToast('📦 ZIP exported (' + imgIndex + ' images)', 'saved', 2500);
      } catch(e) {
        showToast('❌ Failed to create ZIP', 'error', 3000);
        console.warn('ZIP extract failed:', e);
      }
    }

    // ── Open chapter in Noesis Editor (new tab via IndexedDB) ──────
    async function _openChapterInEditor(htmlContent, bookName, chapterName, chapterId) {
      var payload = {
        mode: 'chapter',
        bookName: bookName,
        chapterName: chapterName,
        chapterId: chapterId,
        bookId: currentBookId || '',
        htmlContent: htmlContent
      };
      var payloadJson = JSON.stringify(payload);
      // Always use IndexedDB (no sessionStorage 5MB limit)
      try {
        await _storeEditorPayload(payloadJson);
      } catch(e) {
        showToast('❌ Failed to store chapter for editor', 'error', 4000);
        console.warn('IndexedDB store failed for editor payload:', e);
        return;
      }
      window.open('noesis-editor.html', '_blank');
      setStatus('✅ Editor opened in new tab');
    }

    // ── Store editor payload in IndexedDB (bridge reader→editor) ──────────
    function _storeEditorPayload(payloadJson) {
      return new Promise(function(resolve, reject) {
        var request = indexedDB.open('NoesisEditorBridgeDB', 1);
        request.onupgradeneeded = function(e) {
          var db = e.target.result;
          if (!db.objectStoreNames.contains('payloads')) {
            db.createObjectStore('payloads', { keyPath: 'id' });
          }
        };
        request.onsuccess = function(e) {
          var db = e.target.result;
          var tx = db.transaction('payloads', 'readwrite');
          var store = tx.objectStore('payloads');
          store.put({ id: 'current', data: payloadJson });
          tx.oncomplete = function() { db.close(); resolve(); };
          tx.onerror = function() { db.close(); reject(tx.error); };
        };
        request.onerror = function(e) { reject(e.target.error); };
      });
    }

    // ── Current extract format (html|txt|md|epub|pdf|zip|editor) ───
    let _extractFormat = 'html-clean';
    var _shouldOpenEditor = false;
    var _extractMode = null;

    // ── Generic file download helper ─────────────────────────────────────
    function _downloadFile(filename, data, mimeType) {
      const blob = data instanceof Blob ? data : new Blob([data], { type: mimeType });
      const url = URL.createObjectURL(blob);
      const a = document.createElement('a');
      a.href = url; a.download = filename;
      a.style.cssText = 'position:fixed;top:-999px;left:-999px;';
      document.body.appendChild(a);
      a.dispatchEvent(new MouseEvent('click', { bubbles: true, cancelable: true, view: window }));
      setTimeout(() => { document.body.removeChild(a); URL.revokeObjectURL(url); }, 8000);
    }

    function _autoDownloadHTML(filename, htmlContent) {
      _downloadFile(filename, htmlContent, 'text/html;charset=utf-8');
    }

    // ── Open extracted chapter environment from snapshot → sn56.x ──────────
    // ── New hierarchical loadLibraryBooks ─────────────────────────────────
    async function loadLibraryBooks() {
      bookGrid.innerHTML = '';
      try {
        const books = await getAllBooks();

        // Sort books by addedAt desc
        books.sort((a, b) => b.addedAt - a.addedAt);

        if (books.length === 0) {
          bookGrid.innerHTML = `
            <div class="empty-state">
              <i class="bi bi-book"></i>
              <p>Start by adding a book. Reading is the first step toward building knowledge.</p>
            </div>`;
          return;
        }


        books.forEach(book => {
          const bookRow = document.createElement('div');
          bookRow.className = 'book-row';

          // Cover HTML
          const coverHtml = book.cover
            ? `<img src="${book.cover}" alt="${book.title}">`
            : `<i class="bi bi-book"></i>`;

          bookRow.innerHTML = `
            <div class="book-header">
              <div class="book-cover-thumb" title="Open in Reader">${coverHtml}</div>
              <div class="book-meta">
                <div class="book-meta-title" title="${book.title}">${book.title}</div>
                <div class="book-meta-author">${book.author || ''}</div>
              </div>
              <div class="book-actions">
                <button class="book-delete-btn" title="Delete book"><i class="bi bi-trash"></i></button>
              </div>
            </div>
          `;

          // Click on cover → open reader
          bookRow.querySelector('.book-cover-thumb').onclick = () => openBookFromLibrary(book);

          // Delete book
          bookRow.querySelector('.book-delete-btn').onclick = async (e) => {
            e.stopPropagation();
            if (confirm(`Delete "${book.title}"?`)) {
              await deleteBook(book.id);
              loadLibraryBooks();
            }
          };

          bookGrid.appendChild(bookRow);
        });
        updateStorageBar();

      } catch (e) {
        console.error("Error loading library", e);
        bookGrid.innerHTML = '<div class="empty-state">Error loading library database.</div>';
      }
    }

    // ════════════════════════════════════════════════════════════════════════
    // IMPORT SNAPSHOTS — reimporta file snapshot da disco in noesisDB
    // ════════════════════════════════════════════════════════════════════════
    async function openBookFromLibrary(bookData) {
      showLoading('Opening Book...');
      try {
        showReader();
        document.getElementById('fileName').textContent = bookData.title;

        // Track current book ID and title
        currentBookId = bookData.id;
        currentBookTitle = bookData.title || '';

        // Load saved state (or defaults) BEFORE creating rendition
        const savedPosition = await loadAndApplyBookState(currentBookId);
        _lastSavedVisualState = _snapshotVisualState();

        // Load user bookmarks for this book
        await loadUserBookmarksFromDB(currentBookId);
        await _loadCollectionFromDB(currentBookId);
        renderUbmList();

        // Apply loaded button zoom to toolbar (zoom UI removed in menubar variant)
        const toolbar = document.querySelector('.toolbar');

        // Sync scroll mode button visual state
        const scrollModeBtn = document.getElementById('scrollModeBtn');
        if (scrollModeBtn) {
          scrollModeBtn.classList.toggle('active', scrollMode);
          const lbl = scrollModeBtn.querySelector('.nav-mode-label');
          if (lbl) lbl.textContent = scrollMode ? 'Scroll Mode' : 'Page Mode';
          const op = document.getElementById('navOptPage');
          const os = document.getElementById('navOptScroll');
          if (op) op.classList.toggle('active', !scrollMode);
          if (os) os.classList.toggle('active', scrollMode);
        }
        // Sync Navigate menubar items
        const rmbPM = document.getElementById('rmbPageModeItem');
        const rmbSM = document.getElementById('rmbScrollModeItem');
        if (rmbPM) rmbPM.classList.toggle('rmb-nav-active', !scrollMode);
        if (rmbSM) rmbSM.classList.toggle('rmb-nav-active', scrollMode);
        const rmbNM = document.getElementById('rmbNavigateMode');
        if (rmbNM) rmbNM.textContent = scrollMode ? 'Scroll' : 'Page';
        const hmbNM = document.getElementById('hmbNavigateMode');
        if (hmbNM) hmbNM.textContent = scrollMode ? 'Scroll' : 'Page';

        // Sync dual page button visual state
        const dualPageBtnEl = document.getElementById('dualPageBtn');
        if (dualPageBtnEl) {
          dualPageBtnEl.classList.toggle('active', dualPageMode);
          dualPageBtnEl.disabled = scrollMode;
        }

        // Apply UI display values
        updateFontInfo();
        updateLineHeightInfo();
        applyInterfaceSettings();

        // Initialize EPUB with the stored ArrayBuffer
        book = ePub(bookData.data);
        await book.ready;

        await recreateRendition();

        // Restore saved position if available
        if (savedPosition && savedPosition.cfi) {
          try {
            await rendition.display(savedPosition.cfi);
          } catch (e) {
            console.warn('Could not restore position, starting from beginning:', e);
            await rendition.display();
          }
        }

        // Apply theme after rendition is ready
        applyTheme();

        const nav = await book.loaded.navigation;
        renderBookmarksSimple(nav.toc);

        // Apply sidebar visibility
        const bookmarksEl = document.getElementById('bookmarks');
        bookmarksEl.classList.toggle('hidden', !sidebarVisible);

        // Enable controls
        document.getElementById('extractChapterBtn').disabled = false;
        startAutoSave();

        // Toast: show current navigation mode
        showToast(scrollMode ? 'Scroll Mode ON' : 'Page Mode ON', 'saved', 2000);

        // Update floating button visibility
        const shouldShowButtons = !scrollMode && !sidebarVisible;
        document.getElementById('floatingPrevBtn').classList.toggle('hidden', !shouldShowButtons);
        document.getElementById('floatingNextBtn').classList.toggle('hidden', !shouldShowButtons);
        // Mobile touch zones: same visibility logic
        const tzPrev = document.getElementById('touchZonePrev');
        const tzNext = document.getElementById('touchZoneNext');
        if (tzPrev) tzPrev.classList.toggle('hidden', !shouldShowButtons);
        if (tzNext) tzNext.classList.toggle('hidden', !shouldShowButtons);

        setStatus(bookData.title || 'Book opened');
        // Breadcrumb will be populated by the 'relocated' event after first display.
        // Explicit fallback: try immediately with current location.
        if (book && book.navigation && book.navigation.toc) {
          try {
            const loc = rendition.currentLocation();
            if (loc && loc.start && loc.start.href) {
              const path = findBreadcrumbInToc(book.navigation.toc, loc.start.href, '');
              if (path) setStatusPath(path);
            }
          } catch (e) { /* relocated event will handle it */ }
        }

      } catch (e) {
        console.error(e);
        alert('Failed to open book');
        showLibrary();
      } finally {
        hideLoading();
      }
    }

    // --- ORIGINAL READER LOGIC ---

    let book = null;
    let rendition = null;
    let fontSize = 100;
    let lineHeight = 1.2;
    let lineHeights = [1, 1.2, 1.4, 1.6, 1.8, 2.0];
    let scrollMode = false;
    let dualPageMode = false;
    let sidebarVisible = false;
    let currentTheme = 'normal';
    let currentLocation = null;
    let buttonZoom = 100; // Button zoom level: 100%, 200%, 300%

    // --- AUTO-SAVE & DISPLAY PROMPT STATE ---
    let _autoSaveTimer = null;
    let _lastAutoSavedCfi = null;
    let _lastNavigatedCfi = null;   // CFI from last real epub.js navigation (relocated event)
    let _lastSavedVisualState = null;
    var _dspTimer = null;

    // Interface customization settings
    let interfaceSettings = {
      toolbarColor: '#667eea',
      sidebarColor: '#ffffff',
      navButtonsColor: '#667eea',
      navOpacity: 0.7,
      ubmDrawerColor: '#fffde7'
    };

    const defaultInterfaceSettings = {
      toolbarColor: '#667eea',
      sidebarColor: '#ffffff',
      navButtonsColor: '#667eea',
      navOpacity: 0.7,
      ubmDrawerColor: '#fffde7'
    };

    // --- CURRENT BOOK TRACKING ---
    let currentBookId = null;
    let currentBookTitle = '';
    let _currentChapterName = ''; // tracked separately from DOM to avoid status-message pollution

    // --- COLLECTIONS ---
    let _collection = []; // [{id, type, src, alt, content, color, book, chapter, date}]

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

    // --- READER HIGHLIGHTS ---
    let readerHighlights = []; // [{cfi, color}]
    let currentReaderHighlightColor = 'yellow';
    let _pendingPreviewText = '';
    const HL_COLORS = { yellow: '#ffeb3b', green: '#a5d6a7', pink: '#f8bbd9' };
    let _readerHlHasSelection = false;
    let _readerPendingCfi = null; // CFI provided by epub.js 'selected' event

    // --- TOAST NOTIFICATION ---
    function showToast(msg, type = 'saving', duration = 2200) {
      const toast = document.getElementById('saveToast');
      const toastMsg = document.getElementById('saveToastMsg');
      toastMsg.textContent = msg;
      toast.className = '';             // reset classes
      toast.classList.add(type);
      // force reflow
      void toast.offsetWidth;
      toast.classList.add('show');
      clearTimeout(showToast._timer);
      showToast._timer = setTimeout(() => {
        toast.classList.remove('show');
      }, duration);
    }

    // --- AUTO-SAVE: GET CFI AT VISUAL CENTER ---
    async function _getCenterCfi() {
      if (!rendition) return null;
      if (scrollMode) {
        try {
          const iframes = document.querySelectorAll('#viewer iframe');
          if (iframes.length > 0) {
            const iframeEl = iframes[0];
            const iframeDoc = iframeEl.contentDocument || iframeEl.contentWindow.document;
            if (iframeDoc) {
              const rect = iframeEl.getBoundingClientRect();
              const cx = rect.width / 2;
              const cy = rect.height / 2;
              const el = iframeDoc.elementFromPoint(cx, cy);
              if (el) {
                const contents = rendition.getContents();
                if (contents && contents.length > 0) {
                  const cfi = contents[0].cfiFromElement(el);
                  if (cfi) return cfi;
                }
              }
            }
          }
        } catch (e) { /* fallback to currentLocation */ }
      }
      try {
        const loc = rendition.currentLocation();
        if (loc && loc.start && loc.start.cfi) return loc.start.cfi;
      } catch (e) {}
      return null;
    }

    // --- VISUAL STATE SNAPSHOT (for dirty-check) ---
    function _snapshotVisualState() {
      return JSON.stringify({
        fontSize, lineHeight, theme: currentTheme,
        scrollMode, dualPageMode, buttonZoom,
        interface: { ...interfaceSettings }
      });
    }

    // --- AUTO-SAVE: LIGHTWEIGHT POSITION-ONLY WRITE ---
    async function savePositionOnly(cfi, href) {
      if (!currentBookId || !cfi) return;
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
        const existingState = bookData.savedState || {};
        const updatedBook = {
          ...bookData,
          savedState: {
            ...existingState,
            position: { cfi, href: href || null, timestamp: Date.now() }
          }
        };
        await new Promise((resolve, reject) => {
          const tx = db.transaction(STORE_NAME, 'readwrite');
          const store = tx.objectStore(STORE_NAME);
          const req = store.put(updatedBook);
          req.onsuccess = () => resolve();
          req.onerror = () => reject(req.error);
          tx.onabort = () => { console.warn('Transaction aborted:', tx.error); reject(tx.error || new Error('Transaction was aborted')); };
        });
        _lastAutoSavedCfi = cfi;
      } catch (e) {
        console.warn('Auto-save position failed:', e);
      }
    }

    // --- VISUAL SETTINGS ONLY WRITE ---
    async function saveVisualSettings() {
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
        const existingState = bookData.savedState || {};
        const updatedBook = {
          ...bookData,
          savedState: {
            ...existingState,
            fontSize, lineHeight, theme: currentTheme,
            scrollMode, dualPageMode, buttonZoom,
            interface: { ...interfaceSettings },
            readerHighlights: readerHighlights.slice(),
            savedAt: Date.now()
          }
        };
        await new Promise((resolve, reject) => {
          const tx = db.transaction(STORE_NAME, 'readwrite');
          const store = tx.objectStore(STORE_NAME);
          const req = store.put(updatedBook);
          req.onsuccess = () => resolve();
          req.onerror = () => reject(req.error);
          tx.onabort = () => { console.warn('Transaction aborted:', tx.error); reject(tx.error || new Error('Transaction was aborted')); };
        });
        _lastSavedVisualState = _snapshotVisualState();
      } catch (e) {
        console.warn('Save visual settings failed:', e);
        showToast('Settings save failed', 'error', 3000);
      }
    }

    // --- AUTO-SAVE TIMER (3 seconds, write only on CFI change) ---
    function startAutoSave() {
      stopAutoSave();
      _lastAutoSavedCfi = null;
      _lastNavigatedCfi = null;
      _autoSaveTimer = setInterval(async () => {
        if (!rendition || !currentBookId) return;
        // Skip auto-save when browser translation is active: translation modifies
        // the iframe DOM and makes currentLocation() report wrong positions.
        // The last IDB-saved position (pre-translation) is preserved as-is.
        if (_isBrowserTranslated()) return;
        const cfi = await _getCenterCfi();
        if (!cfi || cfi === _lastAutoSavedCfi) return;
        let href = null;
        try {
          const loc = rendition.currentLocation();
          if (loc && loc.start) href = loc.start.href;
        } catch (e) {}
        await savePositionOnly(cfi, href);
      }, 3000);
    }

    function stopAutoSave() {
      if (_autoSaveTimer !== null) {
        clearInterval(_autoSaveTimer);
        _autoSaveTimer = null;
      }
    }

    // --- BROWSER TRANSLATION DETECTION ---
    // Returns true when the browser has translated the page (Chrome/Edge built-in translate).
    // Translation modifies the iframe DOM without triggering epub.js navigation events,
    // causing currentLocation() to report wrong positions → we must pause auto-save.
    function _isBrowserTranslated() {
      const html = document.documentElement;
      return html.classList.contains('translated-ltr') ||
             html.classList.contains('translated-rtl') ||
             html.hasAttribute('translated');
    }

    // --- DISPLAY SETTINGS SAVE PROMPT ---
    function _showDisplaySavePrompt() {
      if (!currentBookId) return;
      if (_snapshotVisualState() === _lastSavedVisualState) return;
      var prompt = document.getElementById('displaySavePrompt');
      if (!prompt) return;
      if (_dspTimer) { clearTimeout(_dspTimer); _dspTimer = null; }
      prompt.classList.add('show');
      _dspTimer = setTimeout(function() {
        prompt.classList.remove('show');
        _dspTimer = null;
      }, 8000);
    }

    function _hideDisplaySavePrompt() {
      var prompt = document.getElementById('displaySavePrompt');
      if (prompt) prompt.classList.remove('show');
      if (_dspTimer) { clearTimeout(_dspTimer); _dspTimer = null; }
    }

    // --- SAVE BOOK STATE TO INDEXEDDB ---
    async function saveBookState() {
      await saveVisualSettings();
      const cfi = await _getCenterCfi();
      if (cfi) {
        let href = null;
        try {
          const loc = rendition.currentLocation();
          if (loc && loc.start) href = loc.start.href;
        } catch(e) {}
        await savePositionOnly(cfi, href);
      }
    }

    // --- LOAD AND APPLY SAVED BOOK STATE ---
    async function loadAndApplyBookState(bookId) {
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

        if (!bookData || !bookData.savedState) {
          // No saved state → use all defaults
          fontSize = 100;
          lineHeight = 1.2;
          currentTheme = 'normal';
          scrollMode = false;
          dualPageMode = false;
          sidebarVisible = false;
          buttonZoom = 100;
          interfaceSettings = { ...defaultInterfaceSettings };
          readerHighlights = [];
          return null; // no saved position
        }

        const s = bookData.savedState;

        // 1. Typography
        fontSize    = (s.fontSize    !== undefined) ? s.fontSize    : 100;
        lineHeight  = (s.lineHeight  !== undefined) ? s.lineHeight  : 1.2;
        // 2. Theme
        currentTheme = s.theme || 'normal';
        // 3. Navigation
        scrollMode    = !!s.scrollMode;
        dualPageMode  = !!s.dualPageMode;
        sidebarVisible = (s.sidebarVisible !== undefined) ? !!s.sidebarVisible : false;
        // 4. Button zoom
        buttonZoom = s.buttonZoom || 100;
        // 5. Interface
        interfaceSettings = s.interface ? { ...defaultInterfaceSettings, ...s.interface } : { ...defaultInterfaceSettings };
        // 6. Reader highlights
        readerHighlights = Array.isArray(s.readerHighlights) ? s.readerHighlights.slice() : [];

        // Return position CFI (may be null)
        return s.position || null;

      } catch (e) {
        console.error('Error loading book state:', e);
        return null;
      }
    }

    function setStatus(msg) {
      document.getElementById('statusChapterName').textContent = msg;
    }

    function setStatusPath(fullPath) {
      const nameEl = document.getElementById('statusChapterName');
      if (!fullPath) {
        nameEl.textContent = '';
        _currentChapterName = '';
        return;
      }
      const parts = fullPath.split(' › ');
      _currentChapterName = parts[parts.length - 1] || '';
      if (parts.length > 1) {
        nameEl.textContent = parts[parts.length - 2] + ' → ' + parts[parts.length - 1];
      } else {
        nameEl.textContent = parts[0];
      }
      nameEl.title = fullPath;
      updateChapterNav();
    }

    // ── Spine-based chapter navigation ──
    function _findSpineIndex(href) {
      if (!book || !book.spine || !book.spine.items) return -1;
      const items = book.spine.items;
      for (let i = 0; i < items.length; i++) {
        if (items[i].href === href) return i;
        // Handle relative hrefs
        if (items[i].href.endsWith('/' + href) || href.endsWith('/' + items[i].href)) return i;
      }
      return -1;
    }

    function goPrevChapter() {
      if (!book || !rendition) return;
      const loc = rendition.currentLocation();
      if (!loc || !loc.start || !loc.start.href) return;
      const idx = _findSpineIndex(loc.start.href);
      if (idx <= 0) return;
      rendition.display(book.spine.items[idx - 1].href);
    }

    function goNextChapter() {
      if (!book || !rendition) return;
      const loc = rendition.currentLocation();
      if (!loc || !loc.start || !loc.start.href) return;
      const idx = _findSpineIndex(loc.start.href);
      if (idx < 0 || idx >= book.spine.items.length - 1) return;
      rendition.display(book.spine.items[idx + 1].href);
    }

    function updateChapterNav() {
      const prevBtn = document.getElementById('statusPrevBtn');
      const nextBtn = document.getElementById('statusNextBtn');
      if (!book || !rendition) {
        if (prevBtn) prevBtn.disabled = true;
        if (nextBtn) nextBtn.disabled = true;
        return;
      }
      const loc = rendition.currentLocation();
      if (!loc || !loc.start || !loc.start.href) {
        if (prevBtn) prevBtn.disabled = true;
        if (nextBtn) nextBtn.disabled = true;
        return;
      }
      const idx = _findSpineIndex(loc.start.href);
      if (prevBtn) prevBtn.disabled = (idx <= 0);
      if (nextBtn) nextBtn.disabled = (idx < 0 || idx >= book.spine.items.length - 1);
    }

    function updateFontInfo() {
      document.getElementById('fontInfo').textContent = fontSize + '%';
    }

    function updateLineHeightInfo() {
      document.getElementById('lineHeightInfo').textContent = lineHeight;
    }

    // Apply interface settings to UI
    function applyInterfaceSettings() {
      // Apply toolbar color
      const header = document.querySelector('header');
      if (header) {
        header.style.background = `linear-gradient(135deg, ${interfaceSettings.toolbarColor} 0%, ${adjustColor(interfaceSettings.toolbarColor, -20)} 100%)`;
      }

      // Apply sidebar color
      const bookmarks = document.getElementById('bookmarks');
      if (bookmarks) {
        bookmarks.style.background = `${hexToRgba(interfaceSettings.sidebarColor, 0.98)}`;
      }

      // Apply nav buttons color and opacity
      const navButtons = document.querySelectorAll('.floating-nav-btn');
      navButtons.forEach(btn => {
        btn.style.background = hexToRgba(interfaceSettings.navButtonsColor, interfaceSettings.navOpacity);
      });

      // Apply user bookmarks drawer color
      const ubmDrawer = document.getElementById('userBookmarksDrawer');
      if (ubmDrawer) {
        const color = interfaceSettings.ubmDrawerColor || '#fffde7';
        ubmDrawer.style.setProperty('--ubm-bg', color);
        ubmDrawer.style.background = color;
      }
    }

    // Helper: Convert hex to rgba
    function hexToRgba(hex, alpha) {
      const r = parseInt(hex.slice(1, 3), 16);
      const g = parseInt(hex.slice(3, 5), 16);
      const b = parseInt(hex.slice(5, 7), 16);
      return `rgba(${r}, ${g}, ${b}, ${alpha})`;
    }

    // Helper: Adjust color brightness
    function adjustColor(hex, percent) {
      const num = parseInt(hex.slice(1), 16);
      const amt = Math.round(2.55 * percent);
      const R = (num >> 16) + amt;
      const G = (num >> 8 & 0x00FF) + amt;
      const B = (num & 0x0000FF) + amt;
      return '#' + (0x1000000 + (R < 255 ? R < 1 ? 0 : R : 255) * 0x10000 +
        (G < 255 ? G < 1 ? 0 : G : 255) * 0x100 +
        (B < 255 ? B < 1 ? 0 : B : 255))
        .toString(16).slice(1);
    }

    async function navigateToHref(href) {
      if (!href || !rendition || !book) return;

      let target = href.trim();
      try {
        target = decodeURIComponent(target);
      } catch (e) { }

      // In scroll mode: destroy and recreate the rendition to prevent
      // backward-scroll issues when loading adjacent chapters.
      if (scrollMode) {
        // Step 1: Find the target spine item
        let targetSpineItem = null;
        let targetSpineIndex = -1;
        let targetAnchor = '';

        if (target.startsWith("epubcfi")) {
          try {
            const cfiParts = target.match(/epubcfi\(\/6\/(\d+)/);
            if (cfiParts && cfiParts[1]) {
              targetSpineIndex = (parseInt(cfiParts[1]) / 2) - 1;
              targetSpineItem = book.spine.get(targetSpineIndex);
            }
          } catch (e) {
            console.warn("Could not parse CFI:", e);
          }
        } else {
          const [pathPart, anchor] = target.split('#');
          targetAnchor = anchor || '';
          const fileName = pathPart.split('/').pop();

          let index = 0;
          book.spine.each((spineItem) => {
            if (!targetSpineItem && spineItem.href) {
              if (spineItem.href.endsWith(fileName) || spineItem.href === target || spineItem.href === pathPart) {
                targetSpineItem = spineItem;
                targetSpineIndex = index;
              }
            }
            index++;
          });
        }

        // Step 2: Destroy current rendition
        if (rendition) {
          rendition.destroy();
        }

        const viewer = document.getElementById('viewer');
        viewer.innerHTML = '';

        // Step 3: Create new rendition (using 'default' manager to prevent
        // auto-load of adjacent chapters) and register standard hooks
        rendition = book.renderTo('viewer', {
          width: '100%',
          height: '100%',
          spread: 'none',
          flow: 'scrolled',
          manager: 'default'
        });
        _registerRenditionHooks();

        // Step 4: Display the target chapter, preserving fragment anchors
        try {
          const displayTarget = targetSpineItem
            ? (targetAnchor ? targetSpineItem.href + '#' + targetAnchor : targetSpineItem.href)
            : target;
          await rendition.display(displayTarget);
        } catch (e) {
          console.error("Display failed:", e);
          await rendition.display();
        }
        return;
      }

      // For paginated mode, use normal display
      if (target.startsWith("epubcfi")) {
        try {
          await rendition.display(target);
        } catch (e) { console.error("CFI failed", e); }
        return;
      }

      try {
        await rendition.display(target);
      } catch (error1) {
        console.warn("Direct display failed, trying smart resolution...", error1);

        try {
          const [pathPart, anchor] = target.split('#');
          const fileName = pathPart.split('/').pop();

          let item = null;
          book.spine.each((spineItem) => {
            if (!item && spineItem.href && spineItem.href.endsWith(fileName)) {
              item = spineItem;
            }
          });

          if (item) {
            console.log("Found corresponding spine item:", item.href);
            const finalTarget = anchor ? `${item.href}#${anchor}` : item.href;
            await rendition.display(finalTarget);
          } else {
            if (anchor) {
              await rendition.display(anchor);
            } else {
              throw new Error("Section not found in spine");
            }
          }
        } catch (error2) {
          console.error("All navigation attempts failed:", error2);
          setStatus("Error: Could not open section. " + error2.message);
        }
      }
    }

    // Collect all TOC entries recursively starting from a root entry (includes root + all descendants)
    function collectAllSubchapters(tocEntry) {
      const result = [tocEntry];
      if (tocEntry.subitems && tocEntry.subitems.length > 0) {
        for (const subitem of tocEntry.subitems) {
          result.push(...collectAllSubchapters(subitem));
        }
      }
      return result;
    }


    // ── Unified tree extraction helper ──────────────────────────
    async function _extractTree(location) {
      if (!location || !location.start) throw new Error("Cannot determine current position");
      const nav = await book.loaded.navigation;
      const tocEntry = findTocEntry(nav.toc, location.start.href);
      if (!tocEntry) throw new Error("Cannot identify chapter in TOC");
      const allEntries = collectAllSubchapters(tocEntry);
      if (!allEntries.length) throw new Error("No subchapters found");
      const overallTitle = tocEntry.label || "Chapter";
      return { entries: allEntries, title: overallTitle };
    }
    // Extract multiple sections and combine into a single HTML document
    async function findAndLoadImage(srcPath, sectionPath) {
      const zip = book.archive.zip;
      const archiveFiles = zip ? Object.keys(zip.files) : [];
      const sectionDir = sectionPath.substring(0, sectionPath.lastIndexOf('/') + 1);
      let imgPath = sectionDir + srcPath;

      const parts = imgPath.split('/');
      const resolved = [];
      for (const part of parts) {
        if (part === '..') {
          resolved.pop();
        } else if (part !== '.' && part !== '') {
          resolved.push(part);
        }
      }
      imgPath = resolved.join('/');

      const pathsToTry = [
        imgPath,
        imgPath.replace(/^\//, ''),
        '/' + imgPath,
        srcPath,
        srcPath.replace(/^\.\.\//, ''),
      ];

      const filename = srcPath.split('/').pop();
      const matchingFiles = archiveFiles.filter(f => f.endsWith('/' + filename) || f === filename);
      pathsToTry.push(...matchingFiles);

      for (const tryPath of pathsToTry) {
        if (!tryPath) continue;
        const normalizedPath = tryPath.replace(/^\//, '');

        // Try JSZip first (embedded version)
        if (zip) {
          const zipFile = zip.files[normalizedPath];
          if (zipFile && !zipFile.dir) {
            try {
              const arrayBuffer = await zipFile.async('arraybuffer');
              return { data: arrayBuffer, path: normalizedPath };
            } catch (e) {
              console.warn('Error reading file:', normalizedPath, e);
            }
          }
        }

        // Fallback: use book.archive.request() (CDN version only)
        if (!zip) {
          try {
            var archivePath = normalizedPath.startsWith('/') ? normalizedPath : '/' + normalizedPath;
            var imgData = await book.archive.request(archivePath);
            if (imgData) {
              var arrayBuffer = imgData instanceof ArrayBuffer ? imgData : new TextEncoder().encode(imgData).buffer;
              return { data: arrayBuffer, path: normalizedPath };
            }
          } catch (e) {
            // CDN request failed, continue trying other paths
          }
        }
      }
      return null;
    }

    async function extractMultipleSections(tocEntries, overallTitle) {
      if (!book) {
        alert('Please load an EPUB first');
        return;
      }

      setStatus('Extracting sections...');

      let combinedHTML = '';
      let allStyles = '';
      const processedHrefs = new Set();

      // Process each TOC entry
      for (const tocEntry of tocEntries) {
        if (!tocEntry.href) continue;

        const baseHref = tocEntry.href.split('#')[0];
        if (processedHrefs.has(baseHref)) continue;
        processedHrefs.add(baseHref);

        try {
          const spineItem = book.spine.get(tocEntry.href);
          if (!spineItem) continue;

          const section = book.spine.get(spineItem.href);
          await section.load(book.load.bind(book));

          const doc = section.document;
          if (!doc || !doc.body) continue;

          const clonedDoc = doc.cloneNode(true);

          // Process images
          const imgElements = clonedDoc.querySelectorAll('img');
          for (const imgEl of imgElements) {
            const src = imgEl.getAttribute('src');
            if (!src || src.startsWith('data:')) {
              continue;
            }

            try {
              let imgData, mimeType;

              if (src.startsWith('blob:') || src.startsWith('http://') || src.startsWith('https://')) {
                const response = await fetch(src);
                const blob = await response.blob();
                imgData = await blob.arrayBuffer();
                mimeType = blob.type || 'image/jpeg';
              } else {
                const result = await findAndLoadImage(src, spineItem.href);
                if (!result || !result.data) continue;
                imgData = result.data;
                mimeType = 'image/jpeg';
                const view = new Uint8Array(imgData);

                if (view.length >= 4) {
                  if (view[0] === 0x89 && view[1] === 0x50 && view[2] === 0x4E && view[3] === 0x47) {
                    mimeType = 'image/png';
                  } else if (view[0] === 0x47 && view[1] === 0x49 && view[2] === 0x46 && view[3] === 0x38) {
                    mimeType = 'image/gif';
                  } else if (view[0] === 0xFF && view[1] === 0xD8 && view[2] === 0xFF) {
                    mimeType = 'image/jpeg';
                  } else if (view[0] === 0x52 && view[1] === 0x49 && view[2] === 0x46 && view[3] === 0x46) {
                    mimeType = 'image/webp';
                  } else if (view[0] === 0x3C) {
                    const textStart = new TextDecoder().decode(view.slice(0, 100));
                    if (textStart.includes('<svg') || textStart.includes('<?xml')) {
                      mimeType = 'image/svg+xml';
                    }
                  }
                }
              }

                const bytes = new Uint8Array(imgData);
                const chunkSize = 0x8000;
                let binary = '';
                for (let i = 0; i < bytes.length; i += chunkSize) {
                  const chunk = bytes.subarray(i, i + chunkSize);
                  binary += String.fromCharCode.apply(null, chunk);
                }
                const base64 = btoa(binary);
                const dataUrl = `data:${mimeType};base64,${base64}`;
                imgEl.setAttribute('src', dataUrl);
            } catch (e) {
              console.warn('Error loading image:', src, e);
            }
          }

          // Extract styles (only once from first section)
          if (allStyles === '') {
            const styleElements = doc.querySelectorAll('style');
            for (const styleEl of styleElements) {
              if (styleEl.textContent) {
                allStyles += '/* Inline style */\n' + styleEl.textContent + '\n\n';
              }
            }

            const linkElements = doc.querySelectorAll('link[rel="stylesheet"]');
            for (const link of linkElements) {
              try {
                const href = link.getAttribute('href');
                if (href) {
                  const sectionPath = spineItem.href;
                  const sectionDir = sectionPath.substring(0, sectionPath.lastIndexOf('/') + 1);
                  let cssPath = sectionDir + href;
                  const parts = cssPath.split('/');
                  const resolved = [];
                  for (const part of parts) {
                    if (part === '..') {
                      resolved.pop();
                    } else if (part !== '.' && part !== '') {
                      resolved.push(part);
                    }
                  }
                  cssPath = resolved.join('/');
                  const archivePath = cssPath.startsWith('/') ? cssPath : '/' + cssPath;
                  const cssData = await book.archive.request(archivePath);
                  if (cssData) {
                    let cssText;
                    if (typeof cssData === 'string') {
                      cssText = cssData;
                    } else {
                      cssText = new TextDecoder('utf-8').decode(cssData);
                    }
                    allStyles += `/* Stylesheet: ${href} */\n` + cssText + '\n\n';
                  }
                }
              } catch (e) {
                console.warn('Error loading stylesheet:', link.getAttribute('href'), e);
              }
            }

            const computedStyles = `
              body {
                font-family: ${window.getComputedStyle(doc.body).fontFamily};
                font-size: 16px;
                line-height: 1.6;
              }
            `;
            allStyles += computedStyles;
          }

          // Add section separator with title
          combinedHTML += `<div class="section-divider"><h2>${tocEntry.label}</h2></div>\n`;
          combinedHTML += clonedDoc.body.innerHTML + '\n\n';

        } catch (e) {
          console.warn('Error extracting section:', tocEntry.label, e);
        }
      }

      if (!combinedHTML) {
        alert('No content extracted');
        return;
      }

      // Generate final HTML (reusing template from extractCurrentChapter)
      const _msChapterId = 'ch_' + Date.now() + '_' + Math.floor(Math.random() * 1e6);
      const _msFirstSnapId = 'snap_' + Date.now() + '_' + Math.floor(Math.random() * 1e6);
      const _msFirstSnapNow = new Date().toISOString();
      const _msFirstSnapTs = _msFirstSnapNow.substring(0,4)+_msFirstSnapNow.substring(5,7)+_msFirstSnapNow.substring(8,10)
                           + '-' + _msFirstSnapNow.substring(11,13)+_msFirstSnapNow.substring(14,16)+_msFirstSnapNow.substring(17,19);
      const _msFirstSnapshot = {
        snapshotId: _msFirstSnapId,
        createdAt: _msFirstSnapNow,
        bookName: currentBookTitle || 'Unknown Book',
        chapterName: overallTitle || 'Unknown Chapter',
        description: 'origin-' + _msFirstSnapTs,
        isOrigin: true,
        content: combinedHTML
      };
      const _msChapterRecord = {
        chapterId: _msChapterId,
        bookName: currentBookTitle || 'Unknown Book',
        chapterName: overallTitle || 'Unknown Chapter',
        createdAt: new Date().toISOString(),
        snapshots: [_msFirstSnapshot]
      };
      try { await saveExtractedChapterToDB(_msChapterRecord); } catch(e) { console.warn('noesisDB save failed:', e); }

      // ── Salva nel formato selezionato ──
      const _ts2 = _buildExtractionTimestamp();
      _dispatchExtractDownload(currentBookTitle || '', overallTitle || '', _msChapterId, combinedHTML, _ts2, allStyles);

      setStatus('✅ Sections extracted! Check new tab');
    }

    function findTocEntry(items, targetHref) {
      for (const item of items) {
        if (item.href && targetHref.includes(item.href.split('#')[0])) {
          return item;
        }
        if (item.subitems) {
          const found = findTocEntry(item.subitems, targetHref);
          if (found) return found;
        }
      }
      return null;
    }

    async function extractCurrentChapter() {
      if (!book || !rendition) {
        alert('Please load an EPUB first');
        return;
      }

      setStatus('Extracting chapter...');

      try {
        const location = rendition.currentLocation();
        if (!location || !location.start) {
          alert('Cannot determine current chapter');
          return;
        }

        const currentHref = location.start.href;
        let currentSpineItem = book.spine.get(currentHref);

        if (!currentSpineItem) {
          const spineIndex = location.start.index;
          currentSpineItem = book.spine.get(spineIndex);
        }

        if (!currentSpineItem) {
          alert('Cannot find current chapter in book structure');
          return;
        }

        const nav = await book.loaded.navigation;
        let chapterTitle = 'Chapter';

        const tocEntry = findTocEntry(nav.toc, currentSpineItem.href);
        if (tocEntry) {
          chapterTitle = tocEntry.label;
        }

        setStatus('Loading chapter content...');

        // Load the section
        const section = book.spine.get(currentSpineItem.href);
        await section.load(book.load.bind(book));

        const doc = section.document;
        if (!doc || !doc.body) {
          alert('Cannot extract chapter content');
          return;
        }

        setStatus('Processing images...');

        // Clone the document to modify it
        const clonedDoc = doc.cloneNode(true);

        // Extract and convert ALL images to base64 using DOM manipulation
        const imgElements = clonedDoc.querySelectorAll('img');

        for (const imgEl of imgElements) {
          const src = imgEl.getAttribute('src');

          // Skip if already base64 or external URL
          if (!src || src.startsWith('data:')) {
            continue;
          }

          try {
            let imgData, mimeType;

            if (src.startsWith('blob:') || src.startsWith('http://') || src.startsWith('https://')) {
              const response = await fetch(src);
              const blob = await response.blob();
              imgData = await blob.arrayBuffer();
              mimeType = blob.type || 'image/jpeg';
            } else {
              const result = await findAndLoadImage(src, currentSpineItem.href);
              if (!result || !result.data) continue;
              imgData = result.data;
              mimeType = 'image/jpeg'; // default
              const view = new Uint8Array(imgData);

              if (view.length >= 4) {
                if (view[0] === 0x89 && view[1] === 0x50 && view[2] === 0x4E && view[3] === 0x47) {
                  mimeType = 'image/png';
                }
                else if (view[0] === 0x47 && view[1] === 0x49 && view[2] === 0x46 && view[3] === 0x38) {
                  mimeType = 'image/gif';
                }
                else if (view[0] === 0xFF && view[1] === 0xD8 && view[2] === 0xFF) {
                  mimeType = 'image/jpeg';
                }
                else if (view[0] === 0x52 && view[1] === 0x49 && view[2] === 0x46 && view[3] === 0x46) {
                  mimeType = 'image/webp';
                }
                else if (view[0] === 0x3C) {
                  const textStart = new TextDecoder().decode(view.slice(0, 100));
                  if (textStart.includes('<svg') || textStart.includes('<?xml')) {
                    mimeType = 'image/svg+xml';
                  }
                }
              }
            }

            // Convert ArrayBuffer to base64 in chunks
            const bytes = new Uint8Array(imgData);
            const chunkSize = 0x8000; // 32KB chunks
            let binary = '';
            for (let i = 0; i < bytes.length; i += chunkSize) {
              const chunk = bytes.subarray(i, i + chunkSize);
              binary += String.fromCharCode.apply(null, chunk);
            }
            const base64 = btoa(binary);

            const dataUrl = `data:${mimeType};base64,${base64}`;
            imgEl.setAttribute('src', dataUrl);
          } catch (e) {
            console.warn('Error loading image:', src, e);
          }
        }

        // Get HTML content from the modified document
        let htmlContent = clonedDoc.body.innerHTML;

        setStatus('Processing styles...');

        // Extract ALL CSS styles
        let allStyles = '';

        // 1. Inline styles from <style> tags
        const styleElements = doc.querySelectorAll('style');
        for (const styleEl of styleElements) {
          if (styleEl.textContent) {
            allStyles += '/* Inline style */\n' + styleEl.textContent + '\n\n';
          }
        }

        // 2. Linked stylesheets
        const linkElements = doc.querySelectorAll('link[rel="stylesheet"]');
        for (const link of linkElements) {
          try {
            const href = link.getAttribute('href');
            if (href) {
              // Manually resolve the path relative to the current section
              const sectionPath = currentSpineItem.href;
              const sectionDir = sectionPath.substring(0, sectionPath.lastIndexOf('/') + 1);

              // Combine paths and normalize
              let cssPath = sectionDir + href;
              const parts = cssPath.split('/');
              const resolved = [];
              for (const part of parts) {
                if (part === '..') {
                  resolved.pop();
                } else if (part !== '.' && part !== '') {
                  resolved.push(part);
                }
              }
              cssPath = resolved.join('/');

              const archivePath = cssPath.startsWith('/') ? cssPath : '/' + cssPath;
              const cssData = await book.archive.request(archivePath);
              if (cssData) {
                let cssText;
                if (typeof cssData === 'string') {
                  cssText = cssData;
                } else {
                  cssText = new TextDecoder('utf-8').decode(cssData);
                }
                allStyles += `/* Stylesheet: ${href} */\n` + cssText + '\n\n';
              }
            }
          } catch (e) {
            console.warn('Error loading stylesheet:', link.getAttribute('href'), e);
          }
        }

        // 3. Get computed styles from the rendered content
        const computedStyles = `
      /* Additional computed styles */
      body {
        font-family: ${window.getComputedStyle(doc.body).fontFamily};
        font-size: 16px;
        line-height: 1.6;
      }
    `;

        allStyles += computedStyles;

        // Create standalone HTML document

        // Save chapterRecord to noesisDB (Snapshot system)
        const _chapterId = 'ch_' + Date.now() + '_' + Math.floor(Math.random() * 1e6);
        const _firstSnapId = 'snap_' + Date.now() + '_' + Math.floor(Math.random() * 1e6);
        const _firstSnapNow = new Date().toISOString();
        const _firstSnapTs = _firstSnapNow.substring(0,4)+_firstSnapNow.substring(5,7)+_firstSnapNow.substring(8,10)
                           + '-' + _firstSnapNow.substring(11,13)+_firstSnapNow.substring(14,16)+_firstSnapNow.substring(17,19);
        const _firstSnapshot = {
          snapshotId: _firstSnapId,
          createdAt: _firstSnapNow,
          bookName: currentBookTitle || 'Unknown Book',
          chapterName: chapterTitle || 'Unknown Chapter',
          description: 'origin-' + _firstSnapTs,
          isOrigin: true,
          content: htmlContent
        };
        const _chapterRecord = {
          chapterId: _chapterId,
          bookName: currentBookTitle || 'Unknown Book',
          chapterName: chapterTitle || 'Unknown Chapter',
          createdAt: new Date().toISOString(),
          snapshots: [_firstSnapshot]
        };
        try {
          await saveExtractedChapterToDB(_chapterRecord);
        } catch (e) {
          console.warn('Could not save chapterRecord to noesisDB:', e);
        }

        // ── Salva nel formato selezionato ──
        const _ts = _buildExtractionTimestamp();
        _dispatchExtractDownload(currentBookTitle || '', chapterTitle || '', _chapterId, htmlContent, _ts, allStyles);

        setStatus('✅ Chapter extracted! Check new tab');

      } catch (error) {
        console.error('Error extracting chapter:', error);
        alert('Error extracting chapter: ' + error.message);
        setStatus('Error extracting chapter');
      }
    }

    // --- THEME DEFINITIONS (15 themes grouped by background) ---
    const THEME_COLORS = {
      // White backgrounds
      normal: { bg: '#ffffff', fg: '#000000', label: 'White', group: 'White' },
      softwhite: { bg: '#fafafa', fg: '#1a1a1a', label: 'Soft White', group: 'White' },
      // Cream / Sepia backgrounds
      cream: { bg: '#fdf6e3', fg: '#3b2e1a', label: 'Cream', group: 'Cream / Sepia' },
      sepia: { bg: '#f4ecd8', fg: '#3b2e1a', label: 'Sepia', group: 'Cream / Sepia' },
      parchment: { bg: '#eee5d3', fg: '#33291a', label: 'Parchment', group: 'Cream / Sepia' },
      // Light Gray backgrounds
      gray: { bg: '#e5e7eb', fg: '#1f2937', label: 'Light Gray', group: 'Light Gray' },
      coolgray: { bg: '#dfe3e8', fg: '#1c2530', label: 'Cool Gray', group: 'Light Gray' },
      warmgray: { bg: '#e8e4df', fg: '#2c2419', label: 'Warm Gray', group: 'Light Gray' },
      // Medium Gray backgrounds
      midgray: { bg: '#b0b8c1', fg: '#1a1f26', label: 'Mid Gray', group: 'Medium Gray' },
      slate: { bg: '#94a3b8', fg: '#0f172a', label: 'Slate', group: 'Medium Gray' },
      // Dark Gray backgrounds
      darkgray: { bg: '#4b5563', fg: '#f3f4f6', label: 'Dark Gray', group: 'Dark Gray' },
      charcoal: { bg: '#374151', fg: '#e5e7eb', label: 'Charcoal', group: 'Dark Gray' },
      // Dark / Black backgrounds
      dark: { bg: '#1a1a1a', fg: '#d4d4d4', label: 'Dark', group: 'Dark / Black' },
      midnight: { bg: '#0f1117', fg: '#c8cdd3', label: 'Midnight', group: 'Dark / Black' },
      truedark: { bg: '#000000', fg: '#b8b8b8', label: 'True Black', group: 'Dark / Black' }
    };

    // Build grouped structure for popup rendering
    const THEME_GROUPS = {};
    for (const [key, val] of Object.entries(THEME_COLORS)) {
      if (!THEME_GROUPS[val.group]) THEME_GROUPS[val.group] = [];
      THEME_GROUPS[val.group].push({ key, ...val });
    }

    function applyTheme() {
      if (!rendition) return;

      updateFontInfo();

      const active = THEME_COLORS[currentTheme] || THEME_COLORS.normal;

      rendition.themes.register('custom', {
        body: {
          'background': `${active.bg} !important`,
          'color': `${active.fg} !important`,
          'font-size': `${fontSize}% !important`,
          'line-height': `${lineHeight} !important`
        },
        'p, div, span, li, h1, h2, h3, h4, h5, h6': {
          'font-size': `${fontSize}% !important`,
          'color': `${active.fg} !important`,
          'line-height': `${lineHeight} !important`
        }
      });
      rendition.themes.select('custom');

      // Update active swatch indicator in popup
      updateThemeSwatchActive();
    }

    function updateThemeSwatchActive() {
      const popup = document.getElementById('themePopupMain');
      if (!popup) return;
      popup.querySelectorAll('.theme-swatch').forEach(sw => {
        sw.classList.toggle('active', sw.dataset.theme === currentTheme);
      });
    }

    function buildThemePopup() {
      const popup = document.getElementById('themePopupMain');
      if (!popup) return;
      // Keep the h3 heading, clear the rest
      const heading = popup.querySelector('h3');
      popup.innerHTML = '';
      popup.appendChild(heading);

      for (const [groupName, themes] of Object.entries(THEME_GROUPS)) {
        const groupDiv = document.createElement('div');
        groupDiv.className = 'theme-group';

        const label = document.createElement('div');
        label.className = 'theme-group-label';
        label.textContent = groupName;
        groupDiv.appendChild(label);

        const itemsDiv = document.createElement('div');
        itemsDiv.className = 'theme-group-items';

        themes.forEach(t => {
          const swatch = document.createElement('div');
          swatch.className = 'theme-swatch' + (t.key === currentTheme ? ' active' : '');
          swatch.dataset.theme = t.key;
          swatch.style.background = t.bg;
          swatch.style.color = t.fg;
          swatch.title = t.label;
          swatch.innerHTML = `<span class="swatch-label">${t.label}</span>`;
          swatch.onclick = (e) => {
            e.stopPropagation();
            currentTheme = t.key;
            applyTheme();
            setStatus(`Theme: ${t.label}`);
          };
          itemsDiv.appendChild(swatch);
        });

        groupDiv.appendChild(itemsDiv);
        popup.appendChild(groupDiv);
      }
    }

    function _registerRenditionHooks() {
      rendition.on('linkClicked', (href) => {
        navigateToHref(href);
      });

      rendition.on('relocated', (location) => {
        if (!location || !location.start || !location.start.href) return;
        setTimeout(function() { _injectIframeCloseHandler(); }, 300);
        if (location.start.cfi) _lastNavigatedCfi = location.start.cfi;
        if (book && book.navigation && book.navigation.toc) {
          const path = findBreadcrumbInToc(book.navigation.toc, location.start.href, '');
          if (path) { setStatusPath(path); _updateTocHighlight(location.start.href); }
        }
      });

      rendition.on('selected', (cfiRange, contents) => {
        _readerHlHasSelection = true;
        _readerPendingCfi = cfiRange;
        const hlBtn = document.getElementById('readerHighlightBtn');
        if (hlBtn) {
          hlBtn.style.outline = '2px solid #3b82f6';
          hlBtn.title = currentReaderHighlightColor === 'remove'
            ? 'Click to remove highlight'
            : 'Click to apply highlight';
        }
        setTimeout(function() { if (typeof _showCtxAnnotatePopup === 'function') _showCtxAnnotatePopup(); }, 60);
      });

      rendition.hooks.content.register((contents) => {
        const style = contents.document.createElement('style');
        
        const buttonsVisible = !scrollMode && !sidebarVisible;
        const buttonPad = buttonsVisible ? 25 : 0;

        style.textContent = `
          img { max-width: 100% !important; height: auto !important; cursor: pointer; }
          body { 
            padding-left: ${40 + buttonPad}px !important; 
            padding-right: ${40 + buttonPad}px !important;
            box-sizing: border-box !important;
          }
          @media (max-width: 768px) {
            body { padding-left: 24px !important; padding-right: 24px !important; }
          }
          @media (max-width: 480px) {
            body { padding-left: 16px !important; padding-right: 16px !important; }
          }
          .epub-table-scroll-wrap {
            display: block;
            width: 100%;
            overflow-x: auto;
            -webkit-overflow-scrolling: touch;
            margin: 1em 0;
            cursor: pointer;
          }
          .epub-table-scroll-wrap table {
            table-layout: auto !important;
            width: auto !important;
            max-width: none !important;
          }
          .epub-hl-yellow { background-color: #ffeb3b !important; fill: #ffeb3b !important; fill-opacity: 0.5 !important; }
          .epub-hl-green  { background-color: #a5d6a7 !important; fill: #a5d6a7 !important; fill-opacity: 0.5 !important; }
          .epub-hl-pink   { background-color: #f8bbd9 !important; fill: #f8bbd9 !important; fill-opacity: 0.5 !important; }
        `;
        contents.document.head.appendChild(style);

        if (readerHighlights.length > 0) {
          setTimeout(() => {
            readerHighlights.forEach(hl => {
              try {
                rendition.annotations.remove(hl.cfi, 'highlight');
                const _hlColor = HL_COLORS[hl.color] || '#ffeb3b';
                rendition.annotations.highlight(hl.cfi, {}, () => {}, 'epub-hl-' + hl.color,
                  { fill: _hlColor, 'fill-opacity': '0.5' });
              } catch(e) { }
            });
            // Clean up any spurious selection state triggered by highlight restoration
            _readerHlHasSelection = false;
            _readerPendingCfi = null;
            if (typeof _hideCtxAnnotatePopup === 'function') _hideCtxAnnotatePopup();
          }, 120);
        }

        const iframeDoc = contents.document;
        
        iframeDoc.querySelectorAll('table').forEach(function(table) {
          if (table.parentElement && table.parentElement.classList.contains('epub-table-scroll-wrap')) return;
          const wrap = iframeDoc.createElement('div');
          wrap.className = 'epub-table-scroll-wrap';
          table.parentNode.insertBefore(wrap, table);
          wrap.appendChild(table);
        });

        function sendMediaTap(type, data) {
          try {
            window.parent.postMessage({ epubMediaTap: true, type: type, data: data }, '*');
          } catch(e) {}
        }

        iframeDoc.querySelectorAll('img').forEach(function(img) {
          img.addEventListener('contextmenu', function(e) { e.preventDefault(); });
          img.style.webkitTouchCallout = 'none';
          img.style.userSelect = 'none';
          var touchMoved = false;
          img.addEventListener('touchstart', function(e) { touchMoved = false; e.preventDefault(); }, { passive: false });
          img.addEventListener('touchmove', function() { touchMoved = true; }, { passive: true });
          img.addEventListener('touchend', function(e) {
            if (!touchMoved) { e.preventDefault(); sendMediaTap('img', { src: img.src, alt: img.alt || '' }); }
          }, { passive: false });
          img.addEventListener('click', function() { sendMediaTap('img', { src: img.src, alt: img.alt || '' }); });
        });

        iframeDoc.querySelectorAll('.epub-table-scroll-wrap').forEach(function(wrap) {
          var table = wrap.querySelector('table');
          if (!table) return;
          var touchMoved = false;
          wrap.addEventListener('touchstart', function() { touchMoved = false; }, { passive: true });
          wrap.addEventListener('touchmove', function() { touchMoved = true; }, { passive: true });
          wrap.addEventListener('touchend', function(e) {
            if (!touchMoved) { e.preventDefault(); sendMediaTap('table', { html: table.outerHTML }); }
          }, { passive: false });
          wrap.addEventListener('click', function() { sendMediaTap('table', { html: table.outerHTML }); });
        });

        setTimeout(applyTheme, 50);
      });
    }

    async function recreateRendition() {
      if (!book) return;

      // Capture location before destroying rendition
      let savedCfi = null;
      let savedHref = null;
      if (rendition) {
        try {
          const loc = rendition.currentLocation();
          if (loc && loc.start) {
            savedCfi = loc.start.cfi;
            savedHref = loc.start.href;
          }
        } catch (e) {
          console.warn('Could not get current location:', e);
        }
        rendition.destroy();
      }

      const viewer = document.getElementById('viewer');
      viewer.innerHTML = '';

      rendition = book.renderTo('viewer', {
        width: '100%',
        height: '100%',
        spread: (dualPageMode && !scrollMode) ? 'auto' : 'none',
        flow: scrollMode ? 'scrolled' : 'paginated',
        manager: 'default'  // Always use 'default' to prevent scroll offset issues
      });

      _registerRenditionHooks();

      // Try to restore position - use CFI first, fallback to href
      let displaySuccess = false;
      if (savedCfi) {
        try {
          await rendition.display(savedCfi);
          displaySuccess = true;
        } catch (e) {
          console.warn('CFI display failed, trying href fallback:', e);
        }
      }

      if (!displaySuccess && savedHref) {
        try {
          await rendition.display(savedHref);
          displaySuccess = true;
        } catch (e) {
          console.warn('Href display failed:', e);
        }
      }

      if (!displaySuccess && currentLocation && currentLocation.start) {
        try {
          await rendition.display(currentLocation.start.cfi);
          displaySuccess = true;
        } catch (e) {
          console.warn('Fallback currentLocation display failed:', e);
        }
      }

      if (!displaySuccess) {
        await rendition.display();
      }

      applyTheme();
    }

    // Find full breadcrumb path in TOC tree for a given href
    function findBreadcrumbInToc(items, targetHref, ancestorPath) {
      const targetBase = targetHref.split('#')[0];
      for (const item of items) {
        const itemPath = ancestorPath ? ancestorPath + ' › ' + item.label : item.label;
        if (item.href) {
          const itemBase = item.href.split('#')[0];
          if (itemBase === targetBase || item.href === targetHref) {
            return itemPath;
          }
        }
        if (item.subitems && item.subitems.length > 0) {
          const found = findBreadcrumbInToc(item.subitems, targetHref, itemPath);
          if (found) return found;
        }
      }
      return null;
    }

    function renderBookmarksSimple(toc) {
      const container = document.getElementById('toc');
      container.innerHTML = '';

      const createList = (items, level, ancestorPath) => {
        const ul = document.createElement('ul');
        ul.setAttribute('translate', 'yes');
        if (level === 1) {
          ul.className = '';
        } else if (level === 2) {
          ul.className = 'sub level-2';
        } else if (level === 3) {
          ul.className = 'sub level-3';
        } else {
          ul.className = 'sub';
        }

        items.forEach(item => {
          const li = document.createElement('li');
          const hasSub = item.subitems && item.subitems.length > 0;

      li.textContent = item.label;
      li.className = hasSub ? 'expandable' : 'leaf';
      li.setAttribute('translate', 'yes');
      if (item.href) li.setAttribute('data-href', item.href);

          // Build full breadcrumb path for this item
          const itemPath = ancestorPath
            ? ancestorPath + ' › ' + item.label
            : item.label;

          li.addEventListener('click', (e) => {
            e.stopPropagation();

            if (hasSub) {
              li.classList.toggle('open');
              const subUl = li.nextElementSibling;
              if (subUl && subUl.tagName === 'UL') {
                subUl.classList.toggle('open');
              }
            }

            if (item.href) {
              navigateToHref(item.href);
              setStatusPath(itemPath);
              _updateTocHighlight(item.href);
            }
          });

          ul.appendChild(li);

          if (hasSub) {
            const subUl = createList(item.subitems, level + 1, itemPath);
            ul.appendChild(subUl);
          }
        });
        return ul;
      };

      container.appendChild(createList(toc, 1, ''));
    }

    // --- TOC current chapter highlight ---
    function _updateTocHighlight(targetHref) {
      if (!targetHref) return;
      // Remove previous highlight
      document.querySelectorAll('#bookmarks li.toc-current').forEach(function(el) {
        el.classList.remove('toc-current');
      });
      // Try exact match first
      var match = document.querySelector('#bookmarks li[data-href="' + CSS.escape(targetHref) + '"]');
      // Fallback: match base path (ignore anchor)
      if (!match) {
        var targetBase = targetHref.split('#')[0];
        var allItems = document.querySelectorAll('#bookmarks li[data-href]');
        for (var i = 0; i < allItems.length; i++) {
          if (allItems[i].getAttribute('data-href').split('#')[0] === targetBase) {
            match = allItems[i];
            break;
          }
        }
      }
      if (match) {
        match.classList.add('toc-current');
        // Expand ancestors so the highlighted item is visible
        var parent = match.parentElement;
        while (parent && parent.id !== 'bookmarks') {
          if (parent.tagName === 'UL' && parent.classList.contains('sub')) {
            parent.classList.add('open');
          }
          if (parent.tagName === 'LI' && parent.classList.contains('expandable')) {
            parent.classList.add('open');
          }
          parent = parent.parentElement;
        }
        // Scroll into view
        match.scrollIntoView({ behavior: 'smooth', block: 'nearest' });
      }
    }

    // --- TOC toolbar button handlers ---
    (function initTocToolbar() {
      var tocToolbar = document.querySelector('#bookmarks .toc-toolbar');
      if (!tocToolbar) return;

      // Close button: adaptive for mobile overlay vs desktop sidebar
      tocToolbar.querySelector('#btnTocClose').addEventListener('click', function() {
        if (window.innerWidth <= 768 && typeof closeTocOverlay === 'function') {
          closeTocOverlay();
        } else {
          var tsb = document.getElementById('toggleSidebarBtn');
          if (tsb) tsb.click();
        }
      });

      // Expand all
      tocToolbar.querySelector('#btnTocExpand').addEventListener('click', function() {
        document.querySelectorAll('#toc li.expandable').forEach(function(li) {
          li.classList.add('open');
          var ul = li.nextElementSibling;
          if (ul && ul.tagName === 'UL') ul.classList.add('open');
        });
      });

      // Collapse all
      tocToolbar.querySelector('#btnTocCollapse').addEventListener('click', function() {
        document.querySelectorAll('#toc li.expandable').forEach(function(li) {
          li.classList.remove('open');
          var ul = li.nextElementSibling;
          if (ul && ul.tagName === 'UL') ul.classList.remove('open');
        });
      });
    })();

    // =====================================================================
    // --- USER BOOKMARKS MODULE ---
    // =====================================================================

    // In-memory list for current book (array, newest first)
    let userBookmarks = [];

    // Save userBookmarks for currentBookId to IndexedDB (inside the book record)
    async function saveUserBookmarksToDB() {
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

        const updatedBook = { ...bookData, userBookmarks: userBookmarks };

        await new Promise((resolve, reject) => {
          const tx = db.transaction(STORE_NAME, 'readwrite');
          const store = tx.objectStore(STORE_NAME);
          const req = store.put(updatedBook);
          req.onsuccess = () => resolve();
          req.onerror = () => reject(req.error);
          tx.onabort = () => { console.warn('Transaction aborted:', tx.error); reject(tx.error || new Error('Transaction was aborted')); };
        });
      } catch (e) {
        console.error('Error saving user bookmarks:', e);
      }
    }

    // Load userBookmarks from DB for a given bookId
    async function loadUserBookmarksFromDB(bookId) {
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
        if (bookData && Array.isArray(bookData.userBookmarks)) {
          userBookmarks = bookData.userBookmarks;
        } else {
          userBookmarks = [];
        }
      } catch (e) {
        console.error('Error loading user bookmarks:', e);
        userBookmarks = [];
      }
    }

    // Render the drawer list from userBookmarks array
    function renderUbmList() {
      const list = document.getElementById('ubmList');
      if (!list) return;

      // Update badge
      const badge = document.getElementById('ubmBadge');
      if (badge) {
        if (userBookmarks.length > 0) {
          badge.textContent = userBookmarks.length;
          badge.style.display = 'flex';
        } else {
          badge.style.display = 'none';
        }
      }

      if (userBookmarks.length === 0) {
        list.innerHTML = '<div class="ubm-empty"><i class="bi bi-bookmark"></i>No bookmarks yet.<br><small>Press "New Bookmark" to add one.</small></div>';
        return;
      }

      list.innerHTML = '';
      userBookmarks.forEach((bm, idx) => {
        const item = document.createElement('div');
        item.className = 'ubm-item';

        const body = document.createElement('div');
        body.className = 'ubm-item-body';

        // Chapter title (condensed)
        const chapterEl = document.createElement('div');
        chapterEl.className = 'ubm-chapter';
        chapterEl.title = bm.chapter || '';
        const maxChTitle = 55;
        chapterEl.textContent = bm.chapter && bm.chapter.length > maxChTitle
          ? bm.chapter.slice(0, maxChTitle - 1) + '…'
          : (bm.chapter || '(unknown chapter)');

        // Preview (first 30 chars of page text)
        const previewEl = document.createElement('div');
        previewEl.className = 'ubm-preview';
        previewEl.textContent = bm.preview || '';

        body.appendChild(chapterEl);
        body.appendChild(previewEl);

        // Optional label
        if (bm.label) {
          const labelEl = document.createElement('div');
          labelEl.className = 'ubm-label';
          labelEl.textContent = '🏷 ' + bm.label;
          body.appendChild(labelEl);
        }

        // Date
        const dateEl = document.createElement('div');
        dateEl.className = 'ubm-date';
        const d = new Date(bm.createdAt);
        dateEl.textContent = d.toLocaleDateString() + ' ' + d.toLocaleTimeString([], {hour:'2-digit',minute:'2-digit'});
        body.appendChild(dateEl);

        // Navigate on click
        body.addEventListener('click', () => {
          if (bm.cfi) {
            rendition.display(bm.cfi).catch(() => {});
          } else if (bm.href) {
            navigateToHref(bm.href);
          }
          closeUbmDrawer();
        });

        // Delete button
        const delBtn = document.createElement('button');
        delBtn.className = 'ubm-delete-btn';
        delBtn.title = 'Delete bookmark';
        delBtn.innerHTML = '<i class="bi bi-x-lg"></i>';
        delBtn.addEventListener('click', (e) => {
          e.stopPropagation();
          userBookmarks.splice(idx, 1);
          saveUserBookmarksToDB();
          renderUbmList();
        });

        item.appendChild(body);
        item.appendChild(delBtn);
        list.appendChild(item);
      });
    }

    // Create a new bookmark at the current position
    async function createUserBookmark() {
      if (!rendition || !currentBookId) {
        showToast('No book open', 'error', 2000);
        return;
      }

      let cfi = null;
      let href = null;
      let chapter = '';
      let preview = '';

      try {
        const loc = rendition.currentLocation();
        if (loc && loc.start) {
          cfi = loc.start.cfi;
          href = loc.start.href;
        }
      } catch (e) {
        console.warn('Cannot get location:', e);
      }

      // Get chapter title from TOC
      if (href && book && book.navigation && book.navigation.toc) {
        const path = findBreadcrumbInToc(book.navigation.toc, href, '');
        if (path) {
          // Take just the last segment as chapter label
          const parts = path.split(' › ');
          chapter = parts[parts.length - 1].trim();
        }
      }
      if (!chapter) chapter = document.getElementById('statusPath').textContent || '(current position)';

      // Get preview: 100 chars starting 400 chars after the anchor position.
      //
      // Anchor = (page-1)/total * fullTextLength
      // where page/total come from loc.start.displayed — epub.js computes
      // these internally from its own layout engine, so they are always
      // correct regardless of CSS columns, zoom, or scroll mode.
      // This is the most reliable source of position within a chapter.
      try {
        preview = '';

        const iframes = document.querySelectorAll('#viewer iframe');
        const iframeEl = iframes.length > 0 ? iframes[0] : null;
        const iframeDoc = iframeEl
          ? (iframeEl.contentDocument || iframeEl.contentWindow.document)
          : null;

        if (iframeDoc && iframeDoc.body) {

          // --- Step 1: get full normalised text of the chapter ---
          const fullText = (iframeDoc.body.innerText || iframeDoc.body.textContent || '')
            .replace(/\r\n/g, '\n').replace(/\r/g, '\n')
            .replace(/\n+/g, ' ').replace(/\s+/g, ' ').trim();

          // --- Step 2: compute anchor offset from epub.js page position ---
          let anchorOffset = 0;
          try {
            const loc = rendition.currentLocation();
            if (loc && loc.start && loc.start.displayed) {
              const page  = loc.start.displayed.page  || 1;
              const total = loc.start.displayed.total || 1;
              // (page-1) so page 1 starts at offset 0
              const ratio = Math.max(0, (page - 1)) / Math.max(1, total);
              anchorOffset = Math.floor(ratio * fullText.length);
            }
          } catch (locErr) { /* anchorOffset stays 0 */ }

          // --- Step 3: slice 100 chars starting 400 chars after anchor ---
          const startPos = Math.min(
            Math.max(0, anchorOffset + 400),
            Math.max(0, fullText.length - 100)
          );
          const excerpt = fullText.slice(startPos, startPos + 100).trim();

          if (excerpt.length >= 5) {
            preview = excerpt + (fullText.length > startPos + 100 ? '…' : '');
          }
        }
      } catch (e) {
        preview = '';
      }

      // Ask for optional label (non-blocking: empty = no label)
      const label = window.prompt('Optional label for this bookmark (leave blank for none):', '');
      if (label === null) return; // user pressed Cancel

      const bm = {
        id: Date.now() + '_' + Math.random().toString(36).slice(2, 7),
        chapter: chapter,
        preview: preview,
        label: label.trim(),
        cfi: cfi,
        href: href,
        createdAt: Date.now()
      };

      // Insert newest first
      userBookmarks.unshift(bm);
      await saveUserBookmarksToDB();
      renderUbmList();
      showToast('Bookmark added ✓', 'saved', 2000);
    }

    function openUbmDrawer() {
      const header = document.querySelector('header');
      const drawer = document.getElementById('userBookmarksDrawer');
      if (!drawer) return;
      // Set the translation offset = header height so the drawer slides in
      // from top:0 and stops exactly below the header, never touching the layout.
      const headerH = header ? header.getBoundingClientRect().height : 0;
      drawer.style.setProperty('--ubm-header-height', headerH + 'px');
      drawer.classList.add('ubm-open');
    }

    function closeUbmDrawer() {
      const drawer = document.getElementById('userBookmarksDrawer');
      if (drawer) drawer.classList.remove('ubm-open');
    }

    // =====================================================================
    // --- COLLECTION DRAWER MODULE ---
    // =====================================================================
    function _openCollectionDrawer() {
      const header = document.querySelector('header');
      const drawer = document.getElementById('collectionDrawer');
      if (!drawer) return;
      const headerH = header ? header.getBoundingClientRect().height : 0;
      drawer.style.setProperty('--coll-header-height', headerH + 'px');
      drawer.classList.add('coll-open');
      // Reset filters and selection
      _collFilterType = 'all';
      _collFilterChapter = 'all';
      _checkedChunkIds = {};
      _populateChapterFilter();
      var activeBtn = document.querySelector('.coll-ft-btn.active');
      if (activeBtn) activeBtn.classList.remove('active');
      var allBtn = document.querySelector('.coll-ft-btn[data-type="all"]');
      if (allBtn) allBtn.classList.add('active');
      var chapterSel = document.getElementById('collChapterFilter');
      if (chapterSel) chapterSel.value = 'all';
    }

    function _closeCollectionDrawer() {
      const drawer = document.getElementById('collectionDrawer');
      if (drawer) drawer.classList.remove('coll-open');
    }

    function _populateChapterFilter() {
      var sel = document.getElementById('collChapterFilter');
      if (!sel) return;
      var currentVal = sel.value;
      var chapters = [];
      _collection.forEach(function(c) {
        var ch = c.chapter || 'Unknown';
        if (chapters.indexOf(ch) === -1) chapters.push(ch);
      });
      chapters.sort();
      sel.innerHTML = '<option value="all">All chapters</option>';
      chapters.forEach(function(ch) {
        sel.innerHTML += '<option value="' + ch.replace(/"/g, '&quot;') + '">' + ch.substring(0, 40) + '</option>';
      });
      if (currentVal && chapters.indexOf(currentVal) !== -1) {
        sel.value = currentVal;
      } else {
        sel.value = 'all';
      }
    }

    function _renderCollectionList() {
      var list = document.getElementById('collList');
      if (!list) return;

      if (_collection.length === 0) {
        _populateChapterFilter();
        list.innerHTML = '<div class="coll-empty"><i class="bi bi-collection"></i>No items yet.<br><small>Preview an image, table, or highlight and tap [+] Collect.</small></div>';
        _updateCollSelBadge();
        return;
      }

      _populateChapterFilter();

      // Apply filters
      var filtered = _collection.slice().reverse().filter(function(c) {
        if (_collFilterType !== 'all' && c.type !== _collFilterType) return false;
        if (_collFilterChapter !== 'all' && c.chapter !== _collFilterChapter) return false;
        return true;
      });

      if (filtered.length === 0) {
        var msg = _collection.length === 0
          ? '<i class="bi bi-collection"></i>No items yet.<br><small>Preview an image, table, or highlight and tap [+] Collect.</small>'
          : '<i class="bi bi-funnel"></i>No items match filters.<br><small>Try changing the type or chapter filter.</small>';
        list.innerHTML = '<div class="coll-empty">' + msg + '</div>';
        _updateCollSelBadge();
        return;
      }

      // Restore checkbox state from persistent _checkedChunkIds
      list.innerHTML = '';
      filtered.forEach(function(c) {
        var item = document.createElement('div');
        item.className = 'coll-item';
        item.dataset.chunkId = c.id;

        // Checkbox
        var cbWrap = document.createElement('div');
        cbWrap.className = 'coll-checkbox';
        cbWrap.addEventListener('click', function(e) { e.stopPropagation(); });
        var cb = document.createElement('input');
        cb.type = 'checkbox';
        cb.checked = !!_checkedChunkIds[c.id];
        cb.addEventListener('change', function() {
          if (this.checked) _checkedChunkIds[c.id] = true;
          else delete _checkedChunkIds[c.id];
          _updateCollSelBadge();
        });
        cbWrap.appendChild(cb);
        item.appendChild(cbWrap);

        var body = document.createElement('div');
        body.className = 'coll-item-body';

        // Header: icon + chapter + type badge
        var headerDiv = document.createElement('div');
        headerDiv.className = 'coll-header';

        var iconMap = { img: 'bi-image', text: 'bi-chat-quote', table: 'bi-table' };
        var iconClass = iconMap[c.type] || 'bi-file-earmark';
        var icon = document.createElement('i');
        icon.className = 'bi ' + iconClass + ' coll-type-icon';
        headerDiv.appendChild(icon);

        var chapterSpan = document.createElement('span');
        chapterSpan.className = 'coll-chapter';
        chapterSpan.title = c.chapter || '';
        chapterSpan.textContent = (c.chapter || 'Unknown chapter').substring(0, 60);
        headerDiv.appendChild(chapterSpan);

        var typeBadge = document.createElement('span');
        typeBadge.className = 'coll-type-badge';
        typeBadge.textContent = c.type;
        headerDiv.appendChild(typeBadge);

        body.appendChild(headerDiv);

        // Type-specific preview
        if (c.type === 'img') {
          if (c.src) {
            var thumb = document.createElement('img');
            thumb.className = 'coll-thumb';
            thumb.src = c.src;
            thumb.alt = c.alt || '';
            body.appendChild(thumb);
          }
          if (c.alt) {
            var altDiv = document.createElement('div');
            altDiv.className = 'coll-alt';
            altDiv.textContent = c.alt.substring(0, 80);
            body.appendChild(altDiv);
          }
        } else if (c.type === 'text') {
          var excerpt = document.createElement('div');
          excerpt.className = 'coll-text-excerpt';
          excerpt.textContent = (c.content || '').substring(0, 150);
          if (c.color) {
            var hlMap = { yellow: '#ffeb3b', green: '#a5d6a7', pink: '#f8bbd9' };
            excerpt.style.borderLeftColor = hlMap[c.color] || '#ffeb3b';
          }
          body.appendChild(excerpt);
        } else {
          var tablePreview = document.createElement('div');
          tablePreview.className = 'coll-table-preview';
          tablePreview.innerHTML = '<i class="bi bi-table" style="margin-right:4px;color:#10b981;"></i>Table';
          body.appendChild(tablePreview);
          if (c.content) {
            var tempDiv = document.createElement('div');
            tempDiv.innerHTML = c.content;
            var plain = (tempDiv.textContent || '').trim().substring(0, 100);
            if (plain) {
              var tableExcerpt = document.createElement('div');
              tableExcerpt.className = 'coll-text-excerpt';
              tableExcerpt.textContent = plain;
              tableExcerpt.style.borderLeftColor = '#10b981';
              body.appendChild(tableExcerpt);
            }
          }
        }

        // Date
        var dateEl = document.createElement('div');
        dateEl.className = 'coll-date';
        var d = new Date(c.date);
        dateEl.textContent = d.toLocaleDateString() + ' ' + d.toLocaleTimeString([], {hour:'2-digit',minute:'2-digit'});
        body.appendChild(dateEl);

        // Click to open chunk viewer
        body.addEventListener('click', function(e) {
          if (e.target.closest('.coll-delete-btn') || e.target.closest('.coll-checkbox')) return;
          _openChunkViewer(c);
        });

        // Delete button
        var delBtn = document.createElement('button');
        delBtn.className = 'coll-delete-btn';
        delBtn.title = 'Remove from collection';
        delBtn.innerHTML = '<i class="bi bi-x-lg"></i>';
        delBtn.addEventListener('click', function(e) {
          e.stopPropagation();
          _deleteChunkById(c.id);
          _renderCollectionList();
        });

        item.appendChild(body);
        item.appendChild(delBtn);
        list.appendChild(item);
      });
      _updateCollSelBadge();
    }

    // ── Chunk Viewer ──
    function _openChunkViewer(chunk) {
      var viewer = document.getElementById('collViewer');
      var title = document.getElementById('collViewerTitle');
      var content = document.getElementById('collViewerContent');
      if (!viewer || !content) return;

      title.textContent = (chunk.chapter || 'Unknown') + ' · ' + chunk.type;
      content.innerHTML = '';

      if (chunk.type === 'img') {
        if (chunk.src) {
          var img = document.createElement('img');
          img.src = chunk.src;
          img.alt = chunk.alt || '';
          content.appendChild(img);
        } else {
          var placeholder = document.createElement('div');
          placeholder.className = 'cv-placeholder';
          placeholder.innerHTML = '<i class="bi bi-image"></i><p>No image available</p>';
          content.appendChild(placeholder);
        }
      } else if (chunk.type === 'text') {
        var div = document.createElement('div');
        div.className = 'cv-text';
        div.textContent = chunk.content || '';
        var hlMap = { yellow: '#ffeb3b', green: '#a5d6a7', pink: '#f8bbd9' };
        if (chunk.color && hlMap[chunk.color]) {
          div.style.borderLeft = '4px solid ' + hlMap[chunk.color];
        }
        content.appendChild(div);
      } else {
        var wrap = document.createElement('div');
        wrap.className = 'cv-table-wrap';
        wrap.innerHTML = chunk.content || '';
        content.appendChild(wrap);
      }

      viewer.classList.add('visible');
    }

    function _closeChunkViewer() {
      var viewer = document.getElementById('collViewer');
      if (viewer) viewer.classList.remove('visible');
    }

    // =====================================================================
    // --- END USER BOOKMARKS MODULE ---
    // =====================================================================

    // =====================================================================
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

    window.addEventListener('DOMContentLoaded', () => {
      // ── Debug mode: auto-load test.epub (bypass file picker for testing) ──
      if (new URL(location.href).searchParams.get('debug') === '1') {
        (async () => {
          try {
            const resp = await fetch('test.epub');
            if (!resp.ok) throw new Error('test.epub not found (HTTP ' + resp.status + ')');
            const blob = await resp.blob();
            const file = new File([blob], 'test.epub', { type: 'application/epub+zip' });
            showLoading('🔧 Debug: loading test.epub...');
            const bookRecord = await saveBookToDB(file);
            hideLoading();
            await openBookFromLibrary(bookRecord);
          } catch (e) {
            console.error('Debug auto-load failed:', e);
            hideLoading();
          }
        })();
      }

      // ── Test hooks (expose internals for Puppeteer tests) ─────────
      window.__test = {
        get rendition() { return rendition; },
        get book() { return book; },
        get _collection() { return _collection; },
        _saveCollectionToDB: _saveCollectionToDB,
        _loadCollectionFromDB: _loadCollectionFromDB,
        _openCollectionDrawer: _openCollectionDrawer,
        _closeCollectionDrawer: _closeCollectionDrawer,
        _renderCollectionList: _renderCollectionList,
        _clearCollection: _clearCollection,
        _saveChunk: _saveChunk,
        _importCollectionFromJSON: _importCollectionFromJSON,
        _exportCollectionJSON: _exportCollectionJSON,
        _updateCollectionBadge: _updateCollectionBadge,
        _openChapterInEditor: _openChapterInEditor,
        _dispatchExtractDownload: _dispatchExtractDownload,
        get currentBookId() { return currentBookId; },
        get currentBookTitle() { return currentBookTitle; },
        get _currentChapterName() { return _currentChapterName; },
        get _checkedChunkIds() { return _checkedChunkIds; },
        get _extractMode() { return _extractMode; },
        set _extractMode(v) { _extractMode = v; },
        get _extractFormat() { return _extractFormat; },
        set _extractFormat(v) { _extractFormat = v; },
        get _shouldOpenEditor() { return _shouldOpenEditor; },
        set _shouldOpenEditor(v) { _shouldOpenEditor = v; },
        extractCurrentChapter: extractCurrentChapter,
        extractMultipleSections: extractMultipleSections,
      };

      // Init elements
      const libraryInput = document.getElementById('libraryInput');
      const floatingPrevBtn = document.getElementById('floatingPrevBtn');
      const floatingNextBtn = document.getElementById('floatingNextBtn');
      const dualPageBtn = document.getElementById('dualPageBtn');
      const scrollModeBtn = document.getElementById('scrollModeBtn');
      const themeBtn = document.getElementById('themeBtn');
      const toggleSidebarBtn = document.getElementById('toggleSidebarBtn');
      const extractChapterBtn = document.getElementById('extractChapterBtn');
      const bookmarks = document.getElementById('bookmarks');
      const backToLibraryBtn = document.getElementById('backToLibraryBtn');
      const typographyBtn = document.getElementById('typographyBtn');
      const typographyPopup = document.getElementById('typographyPopupMain');
      // --- Chapter Navigation (spine prev/next) ---
      const statusPrevBtn = document.getElementById('statusPrevBtn');
      const statusNextBtn = document.getElementById('statusNextBtn');
      if (statusPrevBtn) statusPrevBtn.addEventListener('click', goPrevChapter);
      if (statusNextBtn) statusNextBtn.addEventListener('click', goNextChapter);

      // --- User Bookmarks Drawer buttons ---
      document.getElementById('userBookmarksBtn').addEventListener('click', () => {
        const drawer = document.getElementById('userBookmarksDrawer');
        if (drawer.classList.contains('ubm-open')) {
          closeUbmDrawer();
        } else {
          renderUbmList();
          openUbmDrawer();
        }
      });

      document.getElementById('ubmNewBtn').addEventListener('click', () => {
        createUserBookmark();
      });

      document.getElementById('ubmCloseBtn').addEventListener('click', () => {
        closeUbmDrawer();
      });

      // ── JSON Import/Export ──
      var collImportInput = document.getElementById('collImportInput');
      var collJsonBtn = document.getElementById('collJsonBtn');
      var collJsonMenu = document.getElementById('collJsonMenu');
      collJsonBtn.addEventListener('click', function(e) {
        e.stopPropagation();
        collExportMenu.classList.remove('show');
        collJsonMenu.classList.toggle('show');
      });
      collJsonMenu.querySelectorAll('button').forEach(function(btn) {
        btn.addEventListener('click', function(e) {
          e.stopPropagation();
          collJsonMenu.classList.remove('show');
          var action = btn.dataset.action;
          if (action === 'import') collImportInput.click();
          else if (action === 'export') _exportCollectionJSON();
        });
      });
      document.addEventListener('click', function(e) {
        if (!collJsonMenu.classList.contains('show')) return;
        if (!collJsonMenu.contains(e.target) && e.target !== collJsonBtn) {
          collJsonMenu.classList.remove('show');
        }
      });
      collImportInput.addEventListener('change', function() {
        if (this.files && this.files[0]) {
          _importCollectionFromJSON(this.files[0]);
          this.value = '';
        }
      });

      document.getElementById('collClearBtn').addEventListener('click', () => {
        if (_collection.length === 0) { showToast('Collection already empty', 'saved', 2000); return; }
        if (!confirm('Clear all ' + _collection.length + ' items from collection?')) return;
        _clearCollection();
        _renderCollectionList();
        showToast('Collection cleared', 'saved', 2000);
      });

      document.getElementById('collCloseBtn').addEventListener('click', () => {
        _closeCollectionDrawer();
      });

      // ── Chunk viewer close on background click ──
      document.getElementById('collViewer').addEventListener('click', function(e) {
        if (e.target === this) _closeChunkViewer();
      });

      // ── Filter type buttons ──
      document.querySelectorAll('.coll-ft-btn').forEach(function(btn) {
        btn.addEventListener('click', function() {
          document.querySelectorAll('.coll-ft-btn').forEach(function(b) { b.classList.remove('active'); });
          btn.classList.add('active');
          _collFilterType = btn.dataset.type;
          _renderCollectionList();
        });
      });

      // ── Chapter filter ──
      document.getElementById('collChapterFilter').addEventListener('change', function() {
        _collFilterChapter = this.value;
        _renderCollectionList();
      });

      // ── Select All / Deselect ──
      document.getElementById('collSelectAllBtn').addEventListener('click', function() {
        document.querySelectorAll('#collList .coll-checkbox input[type="checkbox"]').forEach(function(cb) {
          cb.checked = true;
          var item = cb.closest('.coll-item');
          if (item) _checkedChunkIds[item.dataset.chunkId] = true;
        });
        _updateCollSelBadge();
      });
      document.getElementById('collDeselectAllBtn').addEventListener('click', function() {
        document.querySelectorAll('#collList .coll-checkbox input[type="checkbox"]').forEach(function(cb) {
          cb.checked = false;
          var item = cb.closest('.coll-item');
          if (item) delete _checkedChunkIds[item.dataset.chunkId];
        });
        _updateCollSelBadge();
      });

      // ── Chunk viewer close ──
      document.getElementById('collViewerClose').addEventListener('click', function() {
        _closeChunkViewer();
      });
      document.addEventListener('keydown', function(e) {
        if (e.key === 'Escape') _closeChunkViewer();
      });

      // Export dropdown
      var collExportBtn  = document.getElementById('collExportBtn');
      var collExportMenu = document.getElementById('collExportMenu');
      collExportBtn.addEventListener('click', function(e) {
        e.stopPropagation();
        collJsonMenu.classList.remove('show');
        collExportMenu.classList.toggle('show');
      });
      collExportMenu.querySelectorAll('button').forEach(function(btn) {
        btn.addEventListener('click', function(e) {
          e.stopPropagation();
          collExportMenu.classList.remove('show');
          var fmt = btn.dataset.fmt;
          if (fmt === 'html') _exportCollectionHTML();
          else if (fmt === 'md') _exportCollectionMD();
          else if (fmt === 'zip') _exportCollectionZIP();
        });
      });
      document.addEventListener('click', function(e) {
        if (!collExportMenu.classList.contains('show')) return;
        if (!collExportMenu.contains(e.target) && e.target !== collExportBtn) {
          collExportMenu.classList.remove('show');
        }
      });

      // Close collection drawer when clicking outside
      document.addEventListener('click', (e) => {
        const drawer = document.getElementById('collectionDrawer');
        const menuItem = document.getElementById('rmbCollection');
        if (drawer && drawer.classList.contains('coll-open')) {
          if (!drawer.contains(e.target) && e.target !== menuItem && (!menuItem || !menuItem.contains(e.target))) {
            _closeCollectionDrawer();
          }
        }
      });

      // Close drawer when clicking outside
      document.addEventListener('click', (e) => {
        const drawer = document.getElementById('userBookmarksDrawer');
        const btn = document.getElementById('userBookmarksBtn');
        if (drawer && drawer.classList.contains('ubm-open')) {
          if (!drawer.contains(e.target) && e.target !== btn && !btn.contains(e.target)) {
            closeUbmDrawer();
          }
        }
      });

      updateFontInfo();
      updateLineHeightInfo();
      extractChapterBtn.disabled = true;

      // --- Dynamic sidebar top: always flush below the actual header height ---
      function updateBookmarksTop() {
        const header = document.querySelector('header');
        if (!header || !bookmarks) return;
        const h = header.getBoundingClientRect().height;
        bookmarks.style.top = (h + 20) + 'px';
      }

      const headerEl = document.querySelector('header');
      if (headerEl && window.ResizeObserver) {
        const ro = new ResizeObserver(() => {
          // Suppress ResizeObserver loop errors (harmless)
          requestAnimationFrame(updateBookmarksTop);
        });
        ro.observe(headerEl);
      }
      // Also update on orientation change and resize
      window.addEventListener('resize', updateBookmarksTop);
      window.addEventListener('orientationchange', () => {
        setTimeout(updateBookmarksTop, 200);
      });
      // Initial call
      updateBookmarksTop();

      // Start by loading library
      loadLibraryBooks();

      // ── Library theme toggle (with dropdown) ────────────────────────────
      (function() {
        const libView = document.getElementById('library-view');
        const themesBtn = document.getElementById('libThemesBtn');
        const themesMenu = document.getElementById('libThemesMenu');
        const themeLight = document.getElementById('libThemeLight');
        const themeDark = document.getElementById('libThemeDark');
        var dark = localStorage.getItem('noesis-lib-theme') === 'dark';
        function applyLibraryTheme() {
          if (dark) {
            libView.classList.add('lib-dark');
          } else {
            libView.classList.remove('lib-dark');
          }
        }
        applyLibraryTheme();
        // Toggle dropdown (close tools if open)
        if (themesBtn) {
          themesBtn.addEventListener('click', function(e) {
            e.stopPropagation();
            var toolsMenu = document.getElementById('libToolsMenu');
            if (toolsMenu) toolsMenu.classList.add('hidden');
            themesMenu.classList.toggle('hidden');
            themesMenu.classList.toggle('show');
          });
        }
        // Light theme option
        if (themeLight) {
          themeLight.addEventListener('click', function() {
            dark = false;
            localStorage.setItem('noesis-lib-theme', 'light');
            applyLibraryTheme();
            themesMenu.classList.add('hidden');
            themesMenu.classList.remove('show');
          });
        }
        // Dark theme option
        if (themeDark) {
          themeDark.addEventListener('click', function() {
            dark = true;
            localStorage.setItem('noesis-lib-theme', 'dark');
            applyLibraryTheme();
            themesMenu.classList.add('hidden');
            themesMenu.classList.remove('show');
          });
        }
      })();
      // ── END Library theme toggle ──────────────────────────────────────

      // --- EVENT LISTENERS ---

      // Add Book
      libraryInput.addEventListener('change', async (e) => {
  const file = e.target.files[0];
  if (!file) return;

  /* Pre-validate file type before reading (fast check, no I/O) */
  const fileCheck = validateEpubFile(file);
  if (!fileCheck.valid) {
    alert(fileCheck.error);
    libraryInput.value = '';
    return;
  }

  showLoading('Adding book to library...');
  try {
    const canSave = await checkQuotaBeforeSave(file);
    if (!canSave) { hideLoading(); return; }
    await saveBookToDB(file);
    await loadLibraryBooks();
    updateStorageBar();
  } catch (err) {
    console.error(err);
    if (err.name === 'QuotaExceededError') {
      alert('Storage space full.\n\nDelete some books from the library to free up space.');
    } else if (err.message && err.message.includes('DRM')) {
      alert(err.message);
    } else if (err.message && err.message.includes('Malformed EPUB')) {
      alert(err.message);
    } else if (err.message && err.message.includes('not a valid ZIP')) {
      alert(err.message);
    } else if (err.message && err.message.includes('is not an EPUB')) {
      alert(err.message);
    } else if (err.message && err.message.includes('Cannot read')) {
      alert(err.message);
    } else {
      alert('Cannot open this EPUB. The file may be damaged or in an unsupported format.\n\nDetail: ' + err.message);
    }
  } finally {
    hideLoading();
    libraryInput.value = ''; // Reset input
  }
});

      // Add Books button (triggers libraryInput)
      const libAddBooksBtn = document.getElementById('libAddBooksBtn');
      if (libAddBooksBtn) {
        libAddBooksBtn.addEventListener('click', function() {
          document.getElementById('libraryInput').click();
        });
      }

      // Back Button
      backToLibraryBtn.addEventListener('click', () => {
        showLibrary();
      });

      // Typography Popup Toggle
      typographyBtn.onclick = (e) => {
        e.stopPropagation();
        const isShowing = typographyPopup.classList.contains('show');

        // Close theme popup if open
        const themePopupEl = document.getElementById('themePopupMain');
        if (themePopupEl) {
          themePopupEl.classList.remove('show');
          themePopupEl.style.display = 'none';
          themePopupEl.style.visibility = 'hidden';
          themePopupEl.style.opacity = '0';
        }

        if (isShowing) {
          // Hide popup
          typographyPopup.classList.remove('show');
          typographyPopup.style.display = 'none';
          typographyPopup.style.visibility = 'hidden';
          typographyPopup.style.opacity = '0';
        } else {
          // Show popup
          typographyPopup.style.display = 'block';
          typographyPopup.style.visibility = 'visible';
          typographyPopup.style.opacity = '1';
          typographyPopup.classList.add('show');
        }
      };

      // Close popup when clicking outside
      document.addEventListener('click', (e) => {
        if (!typographyPopup.contains(e.target) && e.target !== typographyBtn && !typographyBtn.contains(e.target)) {
          typographyPopup.classList.remove('show');
          typographyPopup.style.display = 'none';
          typographyPopup.style.visibility = 'hidden';
          typographyPopup.style.opacity = '0';
        }
      });

      // Font Size Controls
      document.getElementById('fontPlus1').onclick = () => {
        fontSize = Math.min(200, fontSize + 1);            updateFontInfo();
            applyTheme();
          };

      document.getElementById('fontMinus1').onclick = () => {
        fontSize = Math.max(50, fontSize - 1);            updateFontInfo();
            applyTheme();
          };

      document.getElementById('fontReset').onclick = () => {
        fontSize = 100;            updateFontInfo();
            applyTheme();
          };

      // Line Height Controls
      document.getElementById('lineHeightPlus').onclick = () => {
        const currentIndex = lineHeights.indexOf(lineHeight);
        if (currentIndex < lineHeights.length - 1) {
          lineHeight = lineHeights[currentIndex + 1];              updateLineHeightInfo();
              applyTheme();
            }
          };

      document.getElementById('lineHeightMinus').onclick = () => {
        const currentIndex = lineHeights.indexOf(lineHeight);
        if (currentIndex > 0) {
          lineHeight = lineHeights[currentIndex - 1];              updateLineHeightInfo();
              applyTheme();
            }
          };

      document.getElementById('lineHeightReset').onclick = () => {
        lineHeight = 1.2;            updateLineHeightInfo();
            applyTheme();
          };

      // Single/Dual Page Controls
      document.getElementById('singlePageBtn').onclick = async () => {
        if (!scrollMode && dualPageMode) {
          dualPageMode = false;
          dualPageBtn.classList.remove('active');
          if (book && rendition) {
            await recreateRendition();
            setStatus('Single page mode');
          }
        }
      };

      dualPageBtn.onclick = async () => {
        if (scrollMode) return;

        dualPageMode = !dualPageMode;
        dualPageBtn.classList.toggle('active', dualPageMode);

        if (book && rendition) {
          await recreateRendition();
          setStatus(dualPageMode ? 'Dual page enabled' : 'Single page enabled');
        }
      };

      floatingPrevBtn.onclick = () => rendition && rendition.prev();
      floatingNextBtn.onclick = () => rendition && rendition.next();

      // ── Mobile Touch Zones: edge-tap page navigation ──
      (function initMobileTouchZones() {
        const tzPrev = document.getElementById('touchZonePrev');
        const tzNext = document.getElementById('touchZoneNext');
        if (!tzPrev || !tzNext) return;
        let _tzDebounce = null;

        function _handleZoneTap(direction, el, e) {
          // Ignore if text is selected in the book iframe (allow copy/paste)
          try {
            const iframes = document.querySelectorAll('#viewer iframe');
            for (const iframe of iframes) {
              const doc = iframe.contentDocument || (iframe.contentWindow && iframe.contentWindow.document);
              if (!doc) continue;
              const sel = doc.getSelection ? doc.getSelection() : null;
              if (sel && !sel.isCollapsed && sel.toString().trim().length > 0) return;
            }
          } catch(e) {}
          // Only in paginated mode with sidebar closed
          if (scrollMode || sidebarVisible) return;
          // Debounce: prevent rapid double-taps
          if (_tzDebounce) return;
          _tzDebounce = setTimeout(() => { _tzDebounce = null; }, 350);
          // Visual feedback
          el.classList.add('tapped');
          setTimeout(() => el.classList.remove('tapped'), 250);
          // Navigate
          if (!rendition) return;
          direction === 'prev' ? rendition.prev() : rendition.next();
        }

        ['click', 'touchend'].forEach(evt => {
          tzPrev.addEventListener(evt, (e) => _handleZoneTap('prev', tzPrev, e));
          tzNext.addEventListener(evt, (e) => _handleZoneTap('next', tzNext, e));
        });
      })();

      const navModePopover = document.getElementById('navModePopover');
      const navOptPage    = document.getElementById('navOptPage');
      const navOptScroll  = document.getElementById('navOptScroll');

      function _syncNavModeBtn() {
        const label = scrollModeBtn.querySelector('.nav-mode-label');
        if (label) label.textContent = scrollMode ? 'Scroll Mode' : 'Page Mode';
        scrollModeBtn.classList.toggle('active', scrollMode);
        navOptPage.classList.toggle('active', !scrollMode);
        navOptScroll.classList.toggle('active', scrollMode);
        floatingPrevBtn.classList.toggle('hidden', scrollMode);
        floatingNextBtn.classList.toggle('hidden', scrollMode);
        dualPageBtn.disabled = scrollMode;
        if (scrollMode && dualPageMode) {
          dualPageMode = false;
          dualPageBtn.classList.remove('active');
        }
      }

      scrollModeBtn.onclick = (e) => {
        e.stopPropagation();
        _closeAllReaderMenus(true);
        navModePopover.classList.toggle('open');
      };

      navOptPage.onclick = async (e) => {
        e.stopPropagation();
        navModePopover.classList.remove('open');
        if (!scrollMode) return;
        scrollMode = false;
        _syncNavModeBtn();
        if (book && rendition) {
          await recreateRendition();
          setStatus('Page mode enabled');
        }
      };

      navOptScroll.onclick = async (e) => {
        e.stopPropagation();
        navModePopover.classList.remove('open');
        if (scrollMode) return;
        scrollMode = true;
        _syncNavModeBtn();
        if (book && rendition) {
          await recreateRendition();
          setStatus('Scroll mode enabled');
        }
      };


      toggleSidebarBtn.onclick = async () => {
        sidebarVisible = !sidebarVisible;
        bookmarks.classList.toggle('hidden', !sidebarVisible);

        console.log('Sidebar toggled - sidebarVisible:', sidebarVisible, 'scrollMode:', scrollMode);

        // Hide/show floating buttons and touch zones when sidebar is toggled
        if (!scrollMode) {
          floatingPrevBtn.classList.toggle('hidden', sidebarVisible);
          floatingNextBtn.classList.toggle('hidden', sidebarVisible);
          const tzPrev = document.getElementById('touchZonePrev');
          const tzNext = document.getElementById('touchZoneNext');
          if (tzPrev) tzPrev.classList.toggle('hidden', sidebarVisible);
          if (tzNext) tzNext.classList.toggle('hidden', sidebarVisible);
          console.log('Floating buttons updated - hidden:', sidebarVisible);
          
          // Recreate rendition to update padding
          if (rendition && book) {
            await recreateRendition();
          }
        }

        if (rendition) {
          // Use requestAnimationFrame to ensure resize happens in the next frame
          // to avoid ResizeObserver loop errors
          requestAnimationFrame(() => {
            setTimeout(() => {
              if (rendition) rendition.resize();
            }, 50);
          });
        }

        setStatus(sidebarVisible ? 'Bookmarks visible' : 'Bookmarks hidden');
      };

      // Theme Popup Toggle
      const themePopup = document.getElementById('themePopupMain');
      buildThemePopup();

      themeBtn.onclick = (e) => {
        e.stopPropagation();
        const isShowing = themePopup.classList.contains('show');

        // Close typography popup if open
        typographyPopup.classList.remove('show');
        typographyPopup.style.display = 'none';
        typographyPopup.style.visibility = 'hidden';
        typographyPopup.style.opacity = '0';

        if (isShowing) {
          themePopup.classList.remove('show');
          themePopup.style.display = 'none';
          themePopup.style.visibility = 'hidden';
          themePopup.style.opacity = '0';
        } else {
          themePopup.style.display = 'block';
          themePopup.style.visibility = 'visible';
          themePopup.style.opacity = '1';
          themePopup.classList.add('show');
          updateThemeSwatchActive();
        }
      };

      // Close theme popup when clicking outside
      document.addEventListener('click', (e) => {
        if (themePopup && !themePopup.contains(e.target) && e.target !== themeBtn && !themeBtn.contains(e.target)) {
          themePopup.classList.remove('show');
          themePopup.style.display = 'none';
          themePopup.style.visibility = 'hidden';
          themePopup.style.opacity = '0';
        }
      });

      // Interface Settings Button and Popup
      const interfaceBtn = document.getElementById('interfaceBtn');
      const interfacePopup = document.getElementById('interfacePopupMain');

      interfaceBtn.onclick = (e) => {
        e.stopPropagation();
        const isShowing = interfacePopup.classList.contains('show');

        // Close other popups
        typographyPopup.classList.remove('show');
        typographyPopup.style.display = 'none';
        typographyPopup.style.visibility = 'hidden';
        typographyPopup.style.opacity = '0';

        const themePopupEl = document.getElementById('themePopupMain');
        if (themePopupEl) {
          themePopupEl.classList.remove('show');
          themePopupEl.style.display = 'none';
          themePopupEl.style.visibility = 'hidden';
          themePopupEl.style.opacity = '0';
        }

        if (isShowing) {
          interfacePopup.classList.remove('show');
          interfacePopup.style.display = 'none';
          interfacePopup.style.visibility = 'hidden';
          interfacePopup.style.opacity = '0';
        } else {
          interfacePopup.style.display = 'block';
          interfacePopup.style.visibility = 'visible';
          interfacePopup.style.opacity = '1';
          interfacePopup.classList.add('show');
          updateInterfaceControls();
        }
      };

      // Close interface popup when clicking outside
      document.addEventListener('click', (e) => {
        if (interfacePopup && !interfacePopup.contains(e.target) && e.target !== interfaceBtn && !interfaceBtn.contains(e.target)) {
          interfacePopup.classList.remove('show');
          interfacePopup.style.display = 'none';
          interfacePopup.style.visibility = 'hidden';
          interfacePopup.style.opacity = '0';
        }
      });

      // Update interface controls with current values
      function updateInterfaceControls() {
        document.getElementById('toolbarColorPicker').value = interfaceSettings.toolbarColor;
        document.getElementById('sidebarColorPicker').value = interfaceSettings.sidebarColor;
        document.getElementById('navButtonsColorPicker').value = interfaceSettings.navButtonsColor;
        document.getElementById('navOpacitySlider').value = interfaceSettings.navOpacity;
        document.getElementById('navOpacityValue').textContent = interfaceSettings.navOpacity;
        document.getElementById('ubmDrawerColorPicker').value = interfaceSettings.ubmDrawerColor || '#fffde7';
      }

      // Toolbar Color
      document.getElementById('toolbarColorPicker').addEventListener('input', (e) => {
        interfaceSettings.toolbarColor = e.target.value;
        applyInterfaceSettings();
      });

      document.getElementById('toolbarColorReset').onclick = () => {
        interfaceSettings.toolbarColor = defaultInterfaceSettings.toolbarColor;
        updateInterfaceControls();
        applyInterfaceSettings();
      };

      // Sidebar Color
      document.getElementById('sidebarColorPicker').addEventListener('input', (e) => {
        interfaceSettings.sidebarColor = e.target.value;
        applyInterfaceSettings();
      });

      document.getElementById('sidebarColorReset').onclick = () => {
        interfaceSettings.sidebarColor = defaultInterfaceSettings.sidebarColor;
        updateInterfaceControls();
        applyInterfaceSettings();
      };

      // Nav Buttons Color
      document.getElementById('navButtonsColorPicker').addEventListener('input', (e) => {
        interfaceSettings.navButtonsColor = e.target.value;
        applyInterfaceSettings();
      });

      document.getElementById('navButtonsColorReset').onclick = () => {
        interfaceSettings.navButtonsColor = defaultInterfaceSettings.navButtonsColor;
        updateInterfaceControls();
        applyInterfaceSettings();
      };

      // Nav Opacity
      document.getElementById('navOpacitySlider').addEventListener('input', (e) => {
        interfaceSettings.navOpacity = parseFloat(e.target.value);
        document.getElementById('navOpacityValue').textContent = interfaceSettings.navOpacity;
        applyInterfaceSettings();
      });

      document.getElementById('navOpacityReset').onclick = () => {
        interfaceSettings.navOpacity = defaultInterfaceSettings.navOpacity;
        updateInterfaceControls();
        applyInterfaceSettings();
      };

      // Bookmark Drawer Color
      document.getElementById('ubmDrawerColorPicker').addEventListener('input', (e) => {
        interfaceSettings.ubmDrawerColor = e.target.value;
        applyInterfaceSettings();
      });

      document.getElementById('ubmDrawerColorReset').onclick = () => {
        interfaceSettings.ubmDrawerColor = defaultInterfaceSettings.ubmDrawerColor;
        updateInterfaceControls();
        applyInterfaceSettings();
      };

      // Display Settings Save Prompt buttons
      const dspSaveBtn    = document.getElementById('dspSaveBtn');
      const dspDismissBtn = document.getElementById('dspDismissBtn');
      if (dspSaveBtn) {
        dspSaveBtn.addEventListener('click', async function() {
          _hideDisplaySavePrompt();
          await saveVisualSettings();
          showToast('Display settings saved \u2713', 'saved', 2200);
        });
      }
      if (dspDismissBtn) {
        dspDismissBtn.addEventListener('click', function() {
          _hideDisplaySavePrompt();
        });
      }

      // --- READER HIGHLIGHT BUTTON LOGIC ---
      (function() {
        const hlBtn = document.getElementById('readerHighlightBtn');
        const hlMenu = document.getElementById('readerHighlightMenu');
        if (!hlBtn || !hlMenu) return;

        // Color classes for the button
        const COLOR_CLASSES = ['hl-yellow', 'hl-green', 'hl-pink', 'hl-remove'];

        function setHlBtnColor(color) {
          COLOR_CLASSES.forEach(c => hlBtn.classList.remove(c));
          if (color === 'yellow') hlBtn.classList.add('hl-yellow');
          else if (color === 'green') hlBtn.classList.add('hl-green');
          else if (color === 'pink') hlBtn.classList.add('hl-pink');
          else if (color === 'remove') hlBtn.classList.add('hl-remove');
          else hlBtn.classList.add('hl-yellow');
        }

        function getIframeSelection() {
          try {
            const iframes = document.querySelectorAll('#viewer iframe');
            for (const iframe of iframes) {
              const doc = iframe.contentDocument || (iframe.contentWindow && iframe.contentWindow.document);
              if (!doc) continue;
              const sel = doc.getSelection ? doc.getSelection() : null;
              if (sel && !sel.isCollapsed && sel.toString().trim().length > 0) return sel;
            }
          } catch(e) {}
          return null;
        }

        function applyReaderHighlight() {
          if (!rendition) return;
          // epub.js 'selected' event already provided the authoritative CFI
          const cfi = _readerPendingCfi;
          if (!cfi) {
            setStatus('Select some text first');
            return;
          }
          try {
            // Remove any existing annotation at same CFI (dedup)
            readerHighlights = readerHighlights.filter(h => h.cfi !== cfi);
            rendition.annotations.remove(cfi, 'highlight');
            // Add new highlight
            readerHighlights.push({ cfi: cfi, color: currentReaderHighlightColor });
            const _hlColor = HL_COLORS[currentReaderHighlightColor] || '#ffeb3b';
            rendition.annotations.highlight(cfi, {}, () => {}, 'epub-hl-' + currentReaderHighlightColor,
              { fill: _hlColor, 'fill-opacity': '0.5' });
            // Clear selection in iframe
            try {
              const iframes = document.querySelectorAll('#viewer iframe');
              for (const iframe of iframes) {
                const doc = iframe.contentDocument || (iframe.contentWindow && iframe.contentWindow.document);
                if (doc && doc.getSelection) doc.getSelection().removeAllRanges();
              }
            } catch(e) {}
            _readerHlHasSelection = false;
            _readerPendingCfi = null;
            hlBtn.style.outline = '';
            hlBtn.title = 'Highlight text';
            setStatus('Text highlighted ✓');
          } catch(err) {
            console.warn('Highlight error:', err);
            setStatus('Could not highlight selection');
          }
        }

        function removeReaderHighlight() {
          if (!rendition) return;
          const cfi = _readerPendingCfi;
          if (!cfi) {
            setStatus('Select highlighted text to remove it');
            return;
          }
          try {
            rendition.annotations.remove(cfi, 'highlight');
            readerHighlights = readerHighlights.filter(h => h.cfi !== cfi);
            // Clear selection in iframe
            try {
              const iframes = document.querySelectorAll('#viewer iframe');
              for (const iframe of iframes) {
                const doc = iframe.contentDocument || (iframe.contentWindow && iframe.contentWindow.document);
                if (doc && doc.getSelection) doc.getSelection().removeAllRanges();
              }
            } catch(e) {}
            _readerHlHasSelection = false;
            _readerPendingCfi = null;
            hlBtn.style.outline = '';
            hlBtn.title = 'Highlight text';
            setStatus('Highlight removed ✓');
          } catch(e) {
            setStatus('Select highlighted text to remove it');
          }
        }

        // v816-ctx: Simplified click — just apply/remove if selection exists.
        // The contextual popup handles colour picking.
        hlBtn.addEventListener('click', (e) => {
          e.stopPropagation();
          const hasSelection = !!_readerPendingCfi || (function() {
            var s = getIframeSelection();
            return !!(s && !s.isCollapsed && s.toString().trim().length > 0);
          })();
          if (hasSelection) {
            if (currentReaderHighlightColor === 'remove') {
              removeReaderHighlight();
            } else {
              applyReaderHighlight();
            }
          }
        });

        // When selection is cleared, reset pending state and hide popup
        document.addEventListener('selectionchange', () => {
          const sel = getIframeSelection();
          _readerHlHasSelection = !!(sel && !sel.isCollapsed && sel.toString().trim().length > 0);
          if (!_readerHlHasSelection) {
            _readerPendingCfi = null;
            hlBtn.style.outline = '';
            hlBtn.title = 'Highlight text';
            if (typeof _hideCtxAnnotatePopup === 'function') _hideCtxAnnotatePopup();
          }
        });

      /* ═══════════════════════════════════════════════════════
         CONTEXTUAL ANNOTATE POPUP — v816-ctx
         (inside highlight IIFE — has access to applyReaderHighlight)
         ═══════════════════════════════════════════════════════ */
      (function initCtxAnnotatePopup() {
        var popup = document.getElementById('ctxAnnotatePopup');
        if (!popup) return;
        var viewer = document.getElementById('viewer');

        function _colorDot(c) {
          var m = { yellow: '#ffeb3b', green: '#a5d6a7', pink: '#f8bbd9' };
          return c === 'remove' ? '#fff' : (m[c] || '#ffeb3b');
        }

        function _updateActiveState(color) {
          popup.querySelectorAll('.ctx-annotate-option').forEach(function(o) {
            o.classList.toggle('active', o.dataset.color === color);
          });
          var dot = document.getElementById('rmbAnnotateColor');
          if (dot) dot.style.background = _colorDot(color);
          var hmbDot = document.getElementById('hmbAnnotateColor');
          if (hmbDot) hmbDot.style.background = _colorDot(color);
        }

        function _getIframeOffset() {
          try {
            var iframe = viewer ? viewer.querySelector('iframe') : null;
            if (iframe) { var r = iframe.getBoundingClientRect(); return { top: r.top, left: r.left }; }
          } catch(e) {}
          return { top: 0, left: 0 };
        }

        window._showCtxAnnotatePopup = function() {
          var sel = getIframeSelection();
          if (!sel || sel.isCollapsed || sel.toString().trim().length === 0) return;
          _pendingPreviewText = sel.toString().trim();
          try {
            var range = sel.getRangeAt(0);
            var rect = range.getBoundingClientRect();
            var iframeOff = _getIframeOffset();
            var top = rect.bottom + iframeOff.top + 8;
            /* Center popup under the selected text line */
            var left = rect.left + iframeOff.left + (rect.width / 2) - 76; /* half of ~152px popup width */
            if (left < 8) left = 8;
            if (left + 160 > window.innerWidth - 8) left = window.innerWidth - 168;
            /* If too close to bottom, show above the selection */
            if (top + 52 > window.innerHeight) top = rect.top + iframeOff.top - 52;
            popup.style.top = top + 'px';
            popup.style.left = left + 'px';
            popup.style.display = 'flex';
            popup.classList.add('visible');
            _updateActiveState(currentReaderHighlightColor);
          } catch(e) {}
        };

        window._hideCtxAnnotatePopup = function() {
          popup.classList.remove('visible');
          setTimeout(function() { if (!popup.classList.contains('visible')) popup.style.display = 'none'; }, 180);
        };

        popup.querySelectorAll('.ctx-annotate-option').forEach(function(opt) {
          opt.addEventListener('click', function(e) {
            e.stopPropagation();
            var color = opt.dataset.color;
            currentReaderHighlightColor = color;
            var hlBtn = document.getElementById('readerHighlightBtn');
            if (hlBtn) {
              ['hl-yellow','hl-green','hl-pink','hl-remove'].forEach(function(c) { hlBtn.classList.remove(c); });
              hlBtn.style.outline = ''; hlBtn.title = 'Highlight text';
              if (color === 'yellow') hlBtn.classList.add('hl-yellow');
              else if (color === 'green') hlBtn.classList.add('hl-green');
              else if (color === 'pink') hlBtn.classList.add('hl-pink');
              else if (color === 'remove') hlBtn.classList.add('hl-remove');
            }
            _updateActiveState(color);
            window._hideCtxAnnotatePopup();
            if (color === 'remove') {
              removeReaderHighlight();
            } else {
              applyReaderHighlight();
            }
          });
        });

        // Preview button handler
        var previewBtn = popup.querySelector('.ctx-preview-option');
        if (previewBtn) {
          previewBtn.addEventListener('click', function(e) {
            e.stopPropagation();
            window._hideCtxAnnotatePopup();
            if (typeof window._showMediaDialog === 'function' && _pendingPreviewText) {
              window._showMediaDialog('text', { text: _pendingPreviewText, color: currentReaderHighlightColor });
            }
          });
        }

        document.addEventListener('click', function(e) {
          if (popup.style.display !== 'none' && !popup.contains(e.target)) {
            window._hideCtxAnnotatePopup();
          }
        });

        _updateActiveState(currentReaderHighlightColor);

      })();
      /* ── END CONTEXTUAL ANNOTATE POPUP ── */

      })();
      // --- END READER HIGHLIGHT BUTTON LOGIC ---

      // Extract Chapter Dropdown
      const extractMenu = document.getElementById('extractMenu');      extractChapterBtn.onclick = (e) => {
        e.stopPropagation();
        extractMenu.classList.toggle('show');
        // Reset mode highlight and sync action buttons on menu open
        if (extractMenu.classList.contains('show')) {
          extractMenu.querySelectorAll('.extract-menu-item').forEach(function(mi) { mi.style.background = ''; mi.style.color = ''; mi.style.fontWeight = ''; });
          _extractMode = null;
          var actions = document.getElementById('extractActions');
          if (actions) {
            if (_extractFormat === 'html-clean' || _extractFormat === 'html-annotated') {
              actions.classList.add('visible');
            } else {
              actions.classList.remove('visible');
            }
          }
        }
      };

      // Format selector buttons
      document.querySelectorAll('#extractFormatRow .extract-fmt-btn').forEach(function(btn) {
        btn.addEventListener('click', function(e) {
          e.stopPropagation();
          document.querySelectorAll('#extractFormatRow .extract-fmt-btn').forEach(function(b) { b.classList.remove('active'); });
          btn.classList.add('active');
          _extractFormat = btn.dataset.fmt;
          // Show action buttons only for html-clean / html-annotated
          var actions = document.getElementById('extractActions');
          if (actions) {
            if (_extractFormat === 'html-clean' || _extractFormat === 'html-annotated') {
              actions.classList.add('visible');
            } else {
              actions.classList.remove('visible');
            }
          }
          _extractMode = null; // reset mode on format change
        });
      });

      // Handle menu item clicks
      extractMenu.querySelectorAll('.extract-menu-item').forEach(item => {
        item.onclick = async (e) => {
          e.stopPropagation();
          
          const mode = item.dataset.mode;
          
          // For html-clean / html-annotated: select mode, don't trigger yet (action buttons do)
          if (_extractFormat === 'html-clean' || _extractFormat === 'html-annotated') {
            _extractMode = mode;
            // Highlight selected mode
            extractMenu.querySelectorAll('.extract-menu-item').forEach(function(mi) { mi.style.background = ''; mi.style.color = ''; });
            item.style.background = '#667eea';
            item.style.color      = '#ffffff';
            item.style.fontWeight = '600';
            return;
          }

          extractMenu.classList.remove('show');
          
          if (mode === 'current') {
            // Extract current chapter only (leaf node)
            await extractCurrentChapter();
          } else if (mode === 'tree') {
            // Extract current + all sublevels
            try {
              const location = rendition.currentLocation();
              if (!location || !location.start) {
                alert('Cannot determine current position');
                return;
              }

              const { entries: allEntries, title: tocLabel } = await _extractTree(location.start ? location : rendition.currentLocation());
              const overallTitle = tocLabel + ' (Complete)';
              
              await extractMultipleSections(allEntries, overallTitle);
              
            } catch (error) {
              console.error('Error extracting tree:', error);
              alert('Error extracting sections: ' + error.message);
              setStatus('Error extracting sections');
            }
          }
        };
      });

      // Action button: Extract only (download)
      var extractActionExtract = document.getElementById('extractActionExtract');
      if (extractActionExtract) {
        extractActionExtract.onclick = async function(e) {
          e.stopPropagation();
          if (!_extractMode) { showToast('Select a chapter scope first', 'warn', 2000); return; }
          _shouldOpenEditor = false;
          extractMenu.classList.remove('show');
          if (_extractMode === 'current') {
            await extractCurrentChapter();
          } else if (_extractMode === 'tree') {
            try {
              var { entries: eallEntries, title: eoverallTitle } = await _extractTree(rendition.currentLocation());
              await extractMultipleSections(eallEntries, eoverallTitle);
            } catch (err) { alert('Extraction failed: ' + err.message); }
          }
        };
      }

      // Action button: Extract + Edit (download + open editor)
      var extractActionEdit = document.getElementById('extractActionEdit');
      if (extractActionEdit) {
        extractActionEdit.onclick = async function(e) {
          e.stopPropagation();
          if (!_extractMode) { showToast('Select a chapter scope first', 'warn', 2000); return; }
          _shouldOpenEditor = true;
          extractMenu.classList.remove('show');
          if (_extractMode === 'current') {
            await extractCurrentChapter();
          } else if (_extractMode === 'tree') {
            try {
              var { entries: eallEntries, title: eoverallTitle } = await _extractTree(rendition.currentLocation());
              await extractMultipleSections(eallEntries, eoverallTitle);
            } catch (err) { alert('Extraction failed: ' + err.message); }
          }
        };
      }
    });

    /* ═══════════════════════════════════════════════════════
       HELP SYSTEM — banner firstRun, overlay shortcut, tooltip
       ═══════════════════════════════════════════════════════ */
    (function initHelpSystem() {

      /* ── Chiavi localStorage ── */
      var KEY_READER  = 'noesis-help-seen-reader';

      /* ── Helper: mostra banner la prima volta ── */
      function maybeShowBanner(seenKey, bannerId) {
        if (!localStorage.getItem(seenKey)) {
          var banner = document.getElementById(bannerId);
          if (banner) banner.classList.remove('hidden');
        }
      }

      /* ── Helper: chiudi banner e salva stato ── */
      function closeBanner(seenKey, bannerId) {
        localStorage.setItem(seenKey, '1');
        var banner = document.getElementById(bannerId);
        if (banner) banner.classList.add('hidden');
      }

      /* ── Helper: apri/chiudi overlay ── */
      function openOverlay(id) {
        var el = document.getElementById(id);
        if (el) el.classList.add('visible');
      }
      function closeOverlay(id) {
        var el = document.getElementById(id);
        if (el) el.classList.remove('visible');
      }

      /* ── Reader: banner primo avvio disabilitato ── */
      var readerView = document.getElementById('reader-view');

      /* ── Reader: pulsante ? ── */
      var readerHelpBtn = document.getElementById('readerHelpBtn');
      if (readerHelpBtn) {
        readerHelpBtn.addEventListener('click', function(e) {
          e.stopPropagation();
          openOverlay('readerHelpOverlay');
        });
      }

      /* ── Reader: chiudi overlay ── */
      var readerOverlayClose = document.getElementById('readerHelpOverlayClose');
      if (readerOverlayClose) {
        readerOverlayClose.addEventListener('click', function() {
          closeOverlay('readerHelpOverlay');
        });
      }
      var readerOverlay = document.getElementById('readerHelpOverlay');
      if (readerOverlay) {
        readerOverlay.addEventListener('click', function(e) {
          if (e.target === readerOverlay) closeOverlay('readerHelpOverlay');
        });
      }

      /* ── Reader: chiudi banner ── */
      var readerBannerClose = document.getElementById('readerBannerClose');
      if (readerBannerClose) {
        readerBannerClose.addEventListener('click', function() {
          closeBanner(KEY_READER, 'readerHelpBanner');
        });
      }

      /* ── Tastiera globale: ? apre overlay Reader ── */
      document.addEventListener('keydown', function(e) {
        if (e.key !== '?' || e.target.tagName === 'INPUT' || e.target.tagName === 'TEXTAREA') return;
        var readerVisible = readerView && !readerView.classList.contains('hidden');
        if (readerVisible) {
          var ro = document.getElementById('readerHelpOverlay');
          if (ro && ro.classList.contains('visible')) closeOverlay('readerHelpOverlay');
          else openOverlay('readerHelpOverlay');
        }
      });

      /* ── Library: banner primo avvio disabilitato ── */
      var KEY_LIBRARY = 'noesis-help-seen-library';
      var libBannerClose = document.getElementById('libBannerClose');
      if (libBannerClose) {
        libBannerClose.addEventListener('click', function() {
          localStorage.setItem(KEY_LIBRARY, '1');
          var b = document.getElementById('libHelpBanner');
          if (b) b.classList.add('hidden');
        });
      }

      /* ── Library: pulsante ? ── */
      var libHelpBtn = document.getElementById('libHelpBtn');
      if (libHelpBtn) {
        libHelpBtn.addEventListener('click', function(e) {
          e.stopPropagation();
          openOverlay('libHelpOverlay');
        });
      }

      /* ── Library: chiudi overlay ── */
      var libOverlayClose = document.getElementById('libHelpOverlayClose');
      if (libOverlayClose) {
        libOverlayClose.addEventListener('click', function() { closeOverlay('libHelpOverlay'); });
      }
      var libOverlay = document.getElementById('libHelpOverlay');
      if (libOverlay) {
        libOverlay.addEventListener('click', function(e) {
          if (e.target === libOverlay) closeOverlay('libHelpOverlay');
        });
      }

    })(); /* end initHelpSystem */

    /* ── Library: Tools dropdown ── */
    (function() {
      var toolsBtn = document.getElementById('libToolsBtn');
      var toolsMenu = document.getElementById('libToolsMenu');
      if (!toolsBtn || !toolsMenu) return;
      toolsBtn.addEventListener('click', function(e) {
        e.stopPropagation();
        var themesMenu = document.getElementById('libThemesMenu');
        if (themesMenu) { themesMenu.classList.add('hidden'); themesMenu.classList.remove('show'); }
        toolsMenu.classList.toggle('hidden');
      });
      document.addEventListener('click', function(e) {
        var themesMenu = document.getElementById('libThemesMenu');
        var themesBtn = document.getElementById('libThemesBtn');
        if (toolsMenu && !toolsMenu.contains(e.target) && !toolsBtn.contains(e.target)) {
          toolsMenu.classList.add('hidden');
        }
        if (themesMenu && !themesMenu.contains(e.target) && themesBtn && !themesBtn.contains(e.target)) {
          themesMenu.classList.add('hidden');
          themesMenu.classList.remove('show');
        }
      });
    })();


    /* ═══════════════════════════════════════════════════════
    /* ═══════════════════════════════════════════════════════
    /* Global helper: close every Reader popup/menu.
       Called before opening any popup so only one is ever visible. */
    function _closeAllReaderMenus(suppressDisplayPrompt) {
      ['typographyPopupMain','themePopupMain','interfacePopupMain'].forEach(function(id) {
        var p = document.getElementById(id);
        if (!p) return;
        p.classList.remove('show');
        p.style.display    = 'none';
        p.style.visibility = 'hidden';
        p.style.opacity    = '0';
      });
      var em = document.getElementById('extractMenu');
      if (em) { em.classList.remove('show'); em.style.display = ''; }
      /* Navigate dropdown */
      var nm = document.getElementById('rmbNavigateMenu');
      if (nm) nm.classList.remove('show');
      var nb = document.getElementById('rmbNavigate');
      if (nb) nb.classList.remove('rmb-active');
      /* Nav mode popover */
      if (typeof navModePopover !== 'undefined' && navModePopover) {
        navModePopover.classList.remove('open');
      }
      /* Display menu */
      var dm = document.getElementById('displayMenu');
      if (dm) {
        var dmWasOpen = dm.classList.contains('open');
        dm.classList.remove('open');
        dm.style.display = '';
        ['displayBodyTypo','displayBodyThemes','displayBodyInterface'].forEach(function(id) {
          var b = document.getElementById(id); if (b) b.classList.remove('open');
        });
        ['displaySecTypo','displaySecThemes','displaySecInterface'].forEach(function(id) {
          var h = document.getElementById(id); if (h) h.classList.remove('active');
        });
        if (dmWasOpen && !suppressDisplayPrompt) _showDisplaySavePrompt();
      }
    }
    /* ── Inject click handler into epub.js iframe ── */
    function _injectIframeCloseHandler() {
      var viewer = document.getElementById('viewer');
      if (!viewer) return;
      var iframe = viewer.querySelector('iframe');
      if (!iframe) return;
      try {
        var idoc = iframe.contentDocument || (iframe.contentWindow && iframe.contentWindow.document);
        if (!idoc) return;
        /* Remove old handler if present */
        if (iframe._noesisCloseHandler) {
          idoc.removeEventListener('click', iframe._noesisCloseHandler);
        }
        if (iframe._noesisSelHandler) {
          idoc.removeEventListener('selectionchange', iframe._noesisSelHandler);
        }
        iframe._noesisCloseHandler = function() { _closeAllReaderMenus(); /* Hide contextual popup only if no text is selected (otherwise user just finished selecting and popup should stay) */ if (typeof _hideCtxAnnotatePopup === 'function' && !_readerHlHasSelection && !_readerPendingCfi) { _hideCtxAnnotatePopup(); } if (window.innerWidth > 768 && typeof sidebarVisible !== 'undefined' && sidebarVisible) { var tsb = document.getElementById('toggleSidebarBtn'); if (tsb) tsb.click(); } };
        idoc.addEventListener('click', iframe._noesisCloseHandler);
        /* Also listen for selection clearing inside iframe to hide contextual popup */
        iframe._noesisSelHandler = function() {
          var sel = idoc.getSelection ? idoc.getSelection() : null;
          _readerHlHasSelection = !!(sel && !sel.isCollapsed && sel.toString().trim().length > 0);
          if (!_readerHlHasSelection) {
            _readerPendingCfi = null;
            var hb = document.getElementById('readerHighlightBtn');
            if (hb) { hb.style.outline = ''; hb.title = 'Highlight text'; }
            if (typeof _hideCtxAnnotatePopup === 'function') _hideCtxAnnotatePopup();
          }
        };
        idoc.addEventListener('selectionchange', iframe._noesisSelHandler);
      } catch(e) { /* cross-origin guard */ }
    }

    /* ── Unified click-outside: close any open reader menu/dropdown ── */
    document.addEventListener('click', function(e) {
      var target = e.target;
      var dm = document.getElementById('displayMenu');
      var em = document.getElementById('extractMenu');
      var nm = document.getElementById('rmbNavigateMenu');
      var nw = document.getElementById('rmbNavigateWrap');
      var xb = document.getElementById('extractChapterBtn');
      var dw = document.getElementById('displayDropdownWrap');
      var rd = document.getElementById('rmbDisplay');
      var re = document.getElementById('rmbExtract');
      var rw = document.getElementById('rmbExtractWrap');

      var anyOpen = false;
      if (dm && dm.classList.contains('open')) anyOpen = true;
      if (em && em.classList.contains('show')) anyOpen = true;
      if (nm && nm.classList.contains('show')) anyOpen = true;
      if (typeof navModePopover !== 'undefined' && navModePopover && navModePopover.classList.contains('open')) anyOpen = true;
      if (!anyOpen) return;

      var inside = false;
      if ((dm && dm.contains(target)) || target === rd || (dw && dw.contains(target))) inside = true;
      if ((em && em.contains(target)) || (xb && xb.contains(target)) || target === re || (rw && rw.contains(target))) inside = true;
      if ((nm && nm.contains(target)) || (nw && nw.contains(target))) inside = true;
      if (typeof navModePopover !== 'undefined' && navModePopover && navModePopover.contains(target)) inside = true;

      if (!inside) _closeAllReaderMenus();
    });

    /* ═══════════════════════════════════════════════════════
       DISPLAY MENU — accordion, moves popups inline
       ═══════════════════════════════════════════════════════ */
    (function initDisplayMenu() {

      var displayMenu = document.getElementById('displayMenu');
      var rmbDisplay  = document.getElementById('rmbDisplay');
      if (!displayMenu || !rmbDisplay) return;

      var SECTIONS = [
        { headerId: 'displaySecTypo',      bodyId: 'displayBodyTypo',      popupId: 'typographyPopupMain' },
        { headerId: 'displaySecThemes',    bodyId: 'displayBodyThemes',    popupId: 'themePopupMain'      },
        { headerId: 'displaySecInterface', bodyId: 'displayBodyInterface', popupId: 'interfacePopupMain'  },
      ];

      function _embedPopup(sec) {
        if (sec._embedded) return;
        sec._embedded = true;
        var popup = document.getElementById(sec.popupId);
        var body  = document.getElementById(sec.bodyId);
        if (!popup || !body) return;
        popup.removeAttribute('style');
        popup.style.display    = 'block';
        popup.style.position   = 'relative';
        popup.style.top        = 'auto';
        popup.style.left       = 'auto';
        popup.style.right      = 'auto';
        popup.style.transform  = 'none';
        popup.style.boxShadow  = 'none';
        popup.style.border     = 'none';
        popup.style.background = 'transparent';
        popup.style.padding    = '8px 4px 4px 4px';
        popup.style.minWidth   = '0';
        popup.style.width      = '100%';
        popup.style.zIndex     = 'auto';
        popup.style.opacity    = '1';
        popup.style.visibility = 'visible';
        var h3 = popup.querySelector('h3');
        if (h3) h3.style.display = 'none';
        body.appendChild(popup);
      }

      function _toggle(sec, forceOpen) {
        var body   = document.getElementById(sec.bodyId);
        var header = document.getElementById(sec.headerId);
        if (!body || !header) return;
        var opening = (forceOpen !== undefined) ? forceOpen : !body.classList.contains('open');
        if (opening) {
          _embedPopup(sec);
          body.classList.add('open');
          header.classList.add('active');
        } else {
          body.classList.remove('open');
          header.classList.remove('active');
        }
      }

      /* Open / close the whole Display menu */

      /* Section header clicks */
      SECTIONS.forEach(function(sec) {
        var header = document.getElementById(sec.headerId);
        if (!header) return;
        header.addEventListener('click', function(e) {
          e.stopPropagation();
          var body   = document.getElementById(sec.bodyId);
          var isOpen = body && body.classList.contains('open');
          SECTIONS.forEach(function(s) { _toggle(s, false); });
          if (!isOpen) _toggle(sec, true);
        });
      });

    })(); /* end initDisplayMenu */

    /* Patch: close Display menu when Extract or Highlight menus open */


    /* ── Editor Report: help system (iniettato nella finestra popup) ──
       La logica è già inline nel markup HTML dell'editor (vedere openQuillEditor).
       Questo blocco registra i listener dopo che il DOM è pronto. ── */
    (function initEditorHelpListeners() {
      /* Questi listener vengono aggiunti alla finestra editor (window.open).
         Poiché l'editor usa document.write, i listener vanno aggiunti
         dentro lo script inline dell'editor stesso — vedere la sezione
         "editorHelpBtn" nello script dell'editor. */
    })();

    /* ═══════════════════════════════════════════════════════
       READER MENUBAR — event handlers
       ═══════════════════════════════════════════════════════ */
    (function initReaderMenubar() {

      var rmbLibrary  = document.getElementById('rmbLibrary');
      var rmbToc      = document.getElementById('rmbToc');
      var rmbBookmarks= document.getElementById('rmbBookmarks');
      var rmbDisplay  = document.getElementById('rmbDisplay');
      var rmbNavigate = document.getElementById('rmbNavigate');
      var rmbAnnotate = document.getElementById('rmbAnnotate');
      var rmbExtract  = document.getElementById('rmbExtract');
      var rmbHelp       = document.getElementById('rmbHelp');
      var rmbCollection = document.getElementById('rmbCollection');

      var rmbNavigateMenu   = document.getElementById('rmbNavigateMenu');
      var rmbPageModeItem   = document.getElementById('rmbPageModeItem');
      var rmbScrollModeItem = document.getElementById('rmbScrollModeItem');

      // aggiorna evidenziazione voci navigate e sottotitolo bottone
      function _updateNavModeItems() {
        if (rmbPageModeItem)   rmbPageModeItem.classList.toggle('rmb-nav-active', !scrollMode);
        if (rmbScrollModeItem) rmbScrollModeItem.classList.toggle('rmb-nav-active', scrollMode);
        var modeLabel = document.getElementById('rmbNavigateMode');
        if (modeLabel) modeLabel.textContent = scrollMode ? 'Scroll' : 'Page';
        var hmbLabel = document.getElementById('hmbNavigateMode');
        if (hmbLabel) hmbLabel.textContent = scrollMode ? 'Scroll' : 'Page';
      }

      // applica cambio modalità e aggiorna UI
      async function _applyModeChange(newScrollMode) {
        if (scrollMode === newScrollMode) return;
        scrollMode = newScrollMode;
        // sync floating nav buttons and touch zones
        var fprev = document.getElementById('floatingPrevBtn');
        var fnext = document.getElementById('floatingNextBtn');
        var tzPrev = document.getElementById('touchZonePrev');
        var tzNext = document.getElementById('touchZoneNext');
        if (fprev) fprev.classList.toggle('hidden', scrollMode);
        if (fnext) fnext.classList.toggle('hidden', scrollMode);
        if (tzPrev) tzPrev.classList.toggle('hidden', scrollMode);
        if (tzNext) tzNext.classList.toggle('hidden', scrollMode);
        // sync dual page button
        var dpBtn = document.getElementById('dualPageBtn');
        if (dpBtn) {
          dpBtn.disabled = scrollMode;
          if (scrollMode && dualPageMode) {
            dualPageMode = false;
            dpBtn.classList.remove('active');
          }
        }
        _updateNavModeItems();
        if (book && rendition) {
          await recreateRendition();
          setStatus(scrollMode ? 'Scroll mode enabled' : 'Page mode enabled');
        }
      }

      // helper: chiude il Navigate menu
      function _closeNavigate() {
        if (rmbNavigateMenu) rmbNavigateMenu.classList.remove('show');
        if (rmbNavigate) rmbNavigate.classList.remove('rmb-active');
      }

      // ── Library ──
      if (rmbLibrary) {
        rmbLibrary.addEventListener('click', function(e) {
          e.stopPropagation();
          var btn = document.getElementById('backToLibraryBtn');
          if (btn) btn.click();
        });
      }

      // ── TOC ──
      if (rmbToc) {
        rmbToc.addEventListener('click', function(e) {
          e.stopPropagation();
          _closeNavigate();
          var btn = document.getElementById('toggleSidebarBtn');
          if (btn) btn.click();
        });
      }

      // ── Bookmarks ──
      if (rmbBookmarks) {
        rmbBookmarks.addEventListener('click', function(e) {
          e.stopPropagation();
          _closeNavigate();
          var btn = document.getElementById('userBookmarksBtn');
          if (btn) btn.click();
        });
      }

      // ── Display ──
      // rmbDisplay trigger: apre/chiude il menu Display
      if (rmbDisplay) {
        rmbDisplay.addEventListener('click', function(e) {
          e.stopPropagation();
          _closeNavigate();
          var displayMenu = document.getElementById('displayMenu');
          if (!displayMenu) return;
          var wasOpen = displayMenu.classList.contains('open');
          _closeAllReaderMenus(true);
          if (!wasOpen) {
            displayMenu.classList.add('open');
            rmbDisplay.classList.add('rmb-active');
          } else {
            rmbDisplay.classList.remove('rmb-active');
            _showDisplaySavePrompt();
          }
        });
      }

      // ── Navigate ──
      if (rmbNavigate) {
        rmbNavigate.addEventListener('click', function(e) {
          e.stopPropagation();
          _closeAllReaderMenus();
          var isOpen = rmbNavigateMenu && rmbNavigateMenu.classList.contains('show');
          if (!isOpen) {
            _updateNavModeItems();
            if (rmbNavigateMenu) rmbNavigateMenu.classList.add('show');
            rmbNavigate.classList.add('rmb-active');
          } else {
            _closeNavigate();
          }
        });
      }

      if (rmbPageModeItem) {
        rmbPageModeItem.addEventListener('click', async function(e) {
          e.stopPropagation();
          _closeNavigate();
          await _applyModeChange(false);
        });
      }

      if (rmbScrollModeItem) {
        rmbScrollModeItem.addEventListener('click', async function(e) {
          e.stopPropagation();
          _closeNavigate();
          await _applyModeChange(true);
        });
      }

      // ── Annotate ──
      // v816-ctx: il popup contestuale appare su selezione testo.
      // Il click su Annotate applica/rimuove highlight (via readerHighlightBtn).
      if (rmbAnnotate) {
        rmbAnnotate.addEventListener('click', function(e) {
          e.stopPropagation();
          _closeNavigate();
          _closeAllReaderMenus();
          var btn = document.getElementById('readerHighlightBtn');
          if (btn) btn.click();
          /* Update menubar + hamburger indicator dots after highlight action */
          setTimeout(function() {
            var cm = { yellow: '#ffeb3b', green: '#a5d6a7', pink: '#f8bbd9' };
            var bg = currentReaderHighlightColor === 'remove' ? '#fff' : (cm[currentReaderHighlightColor] || '#ffeb3b');
            var dot = document.getElementById('rmbAnnotateColor');
            if (dot) dot.style.background = bg;
            var hmbDot = document.getElementById('hmbAnnotateColor');
            if (hmbDot) hmbDot.style.background = bg;
          }, 50);
        });
      }

      // ── Extract ──
      if (rmbExtract) {
        rmbExtract.addEventListener('click', function(e) {
          e.stopPropagation();
          _closeNavigate();
          _closeAllReaderMenus();
          var btn = document.getElementById('extractChapterBtn');
          if (btn) btn.click();
        });
      }

      // ── Help ──
      if (rmbHelp) {
        rmbHelp.addEventListener('click', function(e) {
          e.stopPropagation();
          _closeNavigate();
          var btn = document.getElementById('readerHelpBtn');
          if (btn) btn.click();
        });
      }

      // ── Collection ──
      if (rmbCollection) {
        rmbCollection.addEventListener('click', function(e) {
          e.stopPropagation();
          _closeNavigate();
          _closeAllReaderMenus();
          _closeCollectionDrawer();
          _renderCollectionList();
          _openCollectionDrawer();
        });
      }


      // Sync rmb-active di Display quando il menu viene chiuso da _closeAllReaderMenus
      // (patch: observer sull'attributo class di displayMenu)
      var displayMenu = document.getElementById('displayMenu');
      if (displayMenu && window.MutationObserver) {
        new MutationObserver(function() {
          if (rmbDisplay) {
            if (displayMenu.classList.contains('open')) {
              rmbDisplay.classList.add('rmb-active');
            } else {
              rmbDisplay.classList.remove('rmb-active');
            }
          }
        }).observe(displayMenu, { attributes: true, attributeFilter: ['class'] });
      }

      // Aggiungere classe al header per il padding corretto
      var hdr = document.querySelector('#reader-view header');
      if (hdr) hdr.classList.add('rmb-active');

    })(); /* end initReaderMenubar */

    // --- READER PRINT SUPPORT ---
    window.addEventListener('beforeprint', function() {
      const iframes = document.querySelectorAll('#viewer iframe');
      if (!iframes.length) return;
      let existingPc = document.getElementById('reader-print-container');
      if (existingPc) existingPc.remove();
      const pc = document.createElement('div');
      pc.id = 'reader-print-container';
      let html = '';
      iframes.forEach(function(iframe) {
        if (!iframe.contentDocument || !iframe.contentDocument.body) return;
        const idoc = iframe.contentDocument;
        // Collect inline styles from epub head
        let styles = '';
        idoc.querySelectorAll('head style').forEach(function(s) {
          // Skip epub.js column-pagination rules that would clip content
          const txt = s.textContent.replace(/column[^;{]*:[^;]+;/g, '').replace(/transform:[^;]+;/g, '');
          styles += '<style>' + txt + '</style>';
        });
        html += styles + idoc.body.innerHTML;
      });
      pc.innerHTML = html;
      document.body.appendChild(pc);
    });

    window.addEventListener('afterprint', function() {
      const pc = document.getElementById('reader-print-container');
      if (pc) pc.remove();
    });

    /* ═══════════════════════════════════════════════════════════
       MOBILE RESPONSIVE HANDLERS — v812-responsive
       ═══════════════════════════════════════════════════════════ */

    // ── State ────────────────────────────────────────────────────
    let _isMobile = () => window.innerWidth <= 768;
    let _tocOverlayOpen = false;
    let _hamburgerOpen = false;
    let _touchStartX = 0;
    let _touchStartY = 0;
    let _touchStartTime = 0;
    let _touchIsEdge = false;
    let _touchCancelled = false;

    // ── Hamburger menu ───────────────────────────────────────────
    const hamburgerBtn = document.getElementById('hamburgerBtn');
    const hamburgerBtnLib = document.getElementById('hamburgerBtnLib');
    const hamburgerDrawer = document.getElementById('hamburgerDrawer');
    const hamburgerClose = document.getElementById('hamburgerClose');
    const backdrop = document.getElementById('mobileOverlayBackdrop');

    function openHamburger() {
      const isLibrary = !libraryView.classList.contains('hidden');
      document.querySelectorAll('#hamburgerDrawer .hamburger-item').forEach(function(item) {
        if (item.classList.contains('hmb-lib')) {
          item.style.display = isLibrary ? 'flex' : 'none';
        } else if (item.classList.contains('hmb-rdr')) {
          item.style.display = isLibrary ? 'none' : 'flex';
        } else {
          item.style.display = 'flex';
        }
      });
      hamburgerDrawer.classList.add('open');
      backdrop.classList.add('visible');
      _hamburgerOpen = true;
    }
    function closeHamburger() {
      hamburgerDrawer.classList.remove('open');
      backdrop.classList.remove('visible');
      _hamburgerOpen = false;
    }
    if (hamburgerBtn) hamburgerBtn.addEventListener('click', (e) => { e.stopPropagation(); openHamburger(); });
    if (hamburgerBtnLib) hamburgerBtnLib.addEventListener('click', (e) => { e.stopPropagation(); openHamburger(); });
    if (hamburgerClose) hamburgerClose.addEventListener('click', closeHamburger);

    // ── TOC overlay toggle ───────────────────────────────────────
    function openTocOverlay() {
      const bm = document.getElementById('bookmarks');
      if (!bm) return;
      // Remount #bookmarks as a direct child of body to escape any
      // display:none / overflow:hidden / z-index ancestor issues.
      if (bm.parentNode && bm.parentNode !== document.body) {
        bm._tocOrigParent = bm.parentNode;
        bm._tocOrigNext   = bm.nextSibling;
        bm._tocOrigDisplay = bm.style.display;
        document.body.appendChild(bm);
      }
      // Force visibility with inline styles — bypasses CSS cascade entirely
      bm.style.display = 'block';
      bm.style.position = 'fixed';
      bm.style.top = '0';
      bm.style.left = '0';
      bm.style.bottom = '0';
      bm.style.width = '300px';
      bm.style.maxWidth = '85vw';
      bm.style.zIndex = '9999';
      bm.style.transform = 'translateX(0)';
      bm.style.transition = 'transform 0.28s cubic-bezier(0.4,0,0.2,1)';
      bm.style.opacity = '1';
      bm.style.pointerEvents = 'auto';
      bm.style.background = '#fff';
      bm.style.overflowY = 'auto';
      bm.style.boxShadow = '4px 0 20px rgba(0,0,0,0.4)';
      bm.classList.add('toc-overlay-open');
      backdrop.classList.add('visible');
      _tocOverlayOpen = true;
    }
    function closeTocOverlay() {
      const bm = document.getElementById('bookmarks');
      if (!bm) return;
      bm.classList.remove('toc-overlay-open');
      backdrop.classList.remove('visible');
      _tocOverlayOpen = false;
      // Restore #bookmarks to its original DOM position
      if (bm._tocOrigParent && document.contains(bm._tocOrigParent)) {
        if (bm._tocOrigNext && bm._tocOrigNext.parentNode === bm._tocOrigParent) {
          bm._tocOrigParent.insertBefore(bm, bm._tocOrigNext);
        } else {
          bm._tocOrigParent.appendChild(bm);
        }
      }
      // Reset inline styles
      bm.style.display = bm._tocOrigDisplay || '';
      bm.style.position = '';
      bm.style.top = '';
      bm.style.left = '';
      bm.style.bottom = '';
      bm.style.width = '';
      bm.style.maxWidth = '';
      bm.style.zIndex = '';
      bm.style.transform = '';
      bm.style.transition = '';
      bm.style.opacity = '';
      bm.style.pointerEvents = '';
      bm.style.background = '';
      bm.style.overflowY = '';
      bm.style.boxShadow = '';
      delete bm._tocOrigParent;
      delete bm._tocOrigNext;
      delete bm._tocOrigDisplay;
    }

    // ── Backdrop click closes any open drawer ────────────────────
    backdrop.addEventListener('click', () => {
      if (_hamburgerOpen) closeHamburger();
      if (_tocOverlayOpen) closeTocOverlay();
    });

    // ── Hamburger drawer items → trigger corresponding action (context-aware) ──
    const hamburgerReaderMap = {
      hmbToc: 'rmbToc',
      hmbBookmarks: 'rmbBookmarks',
      hmbDisplay: 'rmbDisplay',
      hmbNavigate: 'rmbNavigate',
      hmbAnnotate: 'rmbAnnotate',
      hmbExtract: 'rmbExtract',
      hmbCollection: 'rmbCollection'
    };
    const hamburgerLibHandlers = {
      hmbAddBooks: function() { var b = document.getElementById('libAddBooksBtn'); if (b) b.click(); },
      hmbLibThemeLight: function() { var b = document.getElementById('libThemeLight'); if (b) b.click(); },
      hmbLibThemeDark: function() { var b = document.getElementById('libThemeDark'); if (b) b.click(); },
      hmbLibTools: function() { var b = document.getElementById('libToolsBtn'); if (b) b.click(); },
      hmbLibRefresh: function() { if (typeof loadLibraryBooks === 'function') loadLibraryBooks(); }
    };
    // Items with dropdown menus need wrapper-visibility workaround on mobile
    const _dropdownItems = new Set(['hmbDisplay', 'hmbNavigate', 'hmbAnnotate', 'hmbExtract']);

    // ── Library-specific hamburger items ──
    Object.entries(hamburgerLibHandlers).forEach(function(entry) {
      const hmbId = entry[0], handler = entry[1];
      const el = document.getElementById(hmbId);
      if (!el) return;
      el.addEventListener('click', function(e) {
        e.stopPropagation();
        closeHamburger();
        handler();
      });
    });

    // ── Shared items (Library, Help): context-aware dispatch ──
    const hmbLibraryEl = document.getElementById('hmbLibrary');
    if (hmbLibraryEl) {
      hmbLibraryEl.addEventListener('click', function(e) {
        e.stopPropagation();
        closeHamburger();
        if (!libraryView.classList.contains('hidden')) {
          // Already in library — refresh
          if (typeof loadLibraryBooks === 'function') loadLibraryBooks();
        } else {
          const rmbLib = document.getElementById('rmbLibrary');
          if (rmbLib) rmbLib.click();
        }
      });
    }
    const hmbHelpEl = document.getElementById('hmbHelp');
    if (hmbHelpEl) {
      hmbHelpEl.addEventListener('click', function(e) {
        e.stopPropagation();
        closeHamburger();
        if (!libraryView.classList.contains('hidden')) {
          const libHelp = document.getElementById('libHelpBtn');
          if (libHelp) libHelp.click();
        } else {
          const rmbHelp = document.getElementById('rmbHelp');
          if (rmbHelp) rmbHelp.click();
        }
      });
    }

    // ── Reader items (mapped to menubar) ──
    Object.entries(hamburgerReaderMap).forEach(([hmbId, rmbId]) => {
      const el = document.getElementById(hmbId);
      if (!el) return;
      el.addEventListener('click', (e) => {
        e.stopPropagation(); // Prevent document-level "close all" handlers from firing
        closeHamburger();
        const target = document.getElementById(rmbId);
        if (!target) return;

        if (_dropdownItems.has(hmbId)) {
          // Parent wrapper has display:none on mobile.
          // Temporarily show it so the dropdown inside can render.
          const wrapper = target.closest('.rmb-item-wrap');
          if (wrapper) {
            wrapper.style.setProperty('display', 'block', 'important');
            target.click();
            // Poll until the dropdown closes, then revert
            const checkClosed = setInterval(() => {
              const dd = wrapper.querySelector('.display-menu.open, .rmb-navigate-menu.show, .reader-highlight-menu.show, .extract-menu.show');
              if (!dd) {
                wrapper.style.removeProperty('display');
                clearInterval(checkClosed);
              }
            }, 150);

          } else {
            target.click();
          }
        } else {
          // Direct-action items (Library, TOC, Bookmarks, Help)
          target.click();
        }
      });
    });

    // ── Override TOC button on mobile to use overlay ─────────────
    const origRmbToc = document.getElementById('rmbToc');
    if (origRmbToc) {
      origRmbToc.addEventListener('click', function(e) {
        if (_isMobile()) {
          e.stopImmediatePropagation();
          if (_tocOverlayOpen) { closeTocOverlay(); }
          else { openTocOverlay(); }
        }
      }, true); // capture phase — stopImmediate prevents original bubble handler
    }

    // ── Swipe navigation (mobile only) ───────────────────────────
    let _swipeInitialized = false;
    function initSwipeNavigation() {
      if (_swipeInitialized) return;
      const viewer = document.getElementById('viewer');
      if (!viewer) return;
      _swipeInitialized = true;

      viewer.addEventListener('touchstart', function(e) {
        if (e.touches.length !== 1) { _touchCancelled = true; return; }
        _touchStartX = e.touches[0].clientX;
        _touchStartY = e.touches[0].clientY;
        _touchStartTime = Date.now();
        _touchIsEdge = (_touchStartX <= 40);
        _touchCancelled = false;
      }, { passive: true });

      viewer.addEventListener('touchmove', function(e) {
        if (_touchCancelled || e.touches.length !== 1) return;
        const dx = e.touches[0].clientX - _touchStartX;
        const dy = e.touches[0].clientY - _touchStartY;
        // Vertical scroll detected → cancel swipe
        if (!_touchCancelled && Math.abs(dy) > Math.abs(dx) && Math.abs(dy) > 10) {
          _touchCancelled = true;
        }
      }, { passive: true });

      viewer.addEventListener('touchend', function(e) {
        if (_touchCancelled) return;
        if (!_isMobile()) return;

        const elapsed = Date.now() - _touchStartTime;
        if (elapsed > 400) return; // too slow, not a swipe

        const dx = (e.changedTouches[0] || {}).clientX - _touchStartX;
        if (!dx || Math.abs(dx) < 50) return; // too short

        // Check if user is selecting text
        const sel = window.getSelection();
        if (sel && sel.toString().length > 0) return;

        // Edge swipe: open TOC drawer
        if (_touchIsEdge && dx > 50) {
          openTocOverlay();
          return;
        }

        // Page navigation (non-edge swipe)
        if (!_touchIsEdge && rendition) {
          if (dx < -50) rendition.next();
          else if (dx > 50) rendition.prev();
        }
      }, { passive: true });
    }

    // ── Library header mobile dropdown ────────────────────────────
    // initLibraryMobileDropdown() REMOVED — hamburger menu now handles all mobile navigation

    // ── Initialize all mobile features ────────────────────────────
    (function _initMobile() {
      // Defer swipe init until rendition is ready (called from openBookFromLibrary)
      if (typeof openBookFromLibrary === 'function') {
        const _origOpenBook = openBookFromLibrary;
        openBookFromLibrary = async function(bookData) {
          await _origOpenBook(bookData);
          initSwipeNavigation();
        };
      }

      // Library mobile dropdown removed — hamburger menu handles mobile navigation

      // Responsive resize handler
      window.addEventListener('resize', () => {
        if (!_isMobile()) {
          if (_hamburgerOpen) closeHamburger();
          if (_tocOverlayOpen) closeTocOverlay();
        }
      });

      // Escape key closes any open drawer or dropdown
      document.addEventListener('keydown', (e) => {
        if (e.key === 'Escape') {
          if (_hamburgerOpen) closeHamburger();
          if (_tocOverlayOpen) closeTocOverlay();
          _closeAllReaderMenus();
        }
      });

      // Close drawers when returning to library
      const origShowLibrary = showLibrary;
      if (typeof origShowLibrary === 'function') {
        showLibrary = function() {
          if (_hamburgerOpen) closeHamburger();
          if (_tocOverlayOpen) closeTocOverlay();
          return origShowLibrary.apply(this, arguments);
        };
      }
    })();

    // ── END MOBILE RESPONSIVE HANDLERS ───────────────────────────

    // ── Shared brand animation trigger ──
    function _triggerBrandAnim() {
      var brand = document.getElementById('libBrand');
      if (!brand) return;
      brand.classList.remove('lib-br-17', 'lib-br-19', 'lib-br-30');
      void brand.offsetWidth;
      var pick = Math.floor(Math.random() * 3);
      brand.classList.add(pick === 0 ? 'lib-br-17' : (pick === 1 ? 'lib-br-19' : 'lib-br-30'));
    }

    // ── Initial brand animation on page load ──
    _triggerBrandAnim();
