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
