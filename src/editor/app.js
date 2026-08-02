/* ════════════════════════════════════════════════
   GLOBALS
════════════════════════════════════════════════ */
var _collection  = [];
var _bookName    = '';
var _chapterName = '';
var _chapterId   = '';
var _mode        = 'standalone'; // 'chapter' | 'standalone'
var _toastShown  = false;     // one-time session toast for chapter mode
var _bookId      = '';        // current book id (for IndexedDB persistence)

/* ════════════════════════════════════════════════
   IndexedDB helpers — unified with reader
   DB: EpubLibraryDB  |  Store: books  |  Key: book id
════════════════════════════════════════════════ */
var _COL_DB_NAME    = 'EpubLibraryDB';
var _COL_DB_VERSION = 1;
var _COL_STORE_NAME = 'books';

function _openColDB() {
  return new Promise(function(resolve, reject) {
    var request = indexedDB.open(_COL_DB_NAME, _COL_DB_VERSION);
    var blockedTimer = null;
    request.onupgradeneeded = function(event) {
      var db = event.target.result;
      if (!db.objectStoreNames.contains(_COL_STORE_NAME)) {
        db.createObjectStore(_COL_STORE_NAME, { keyPath: 'id' });
      }
    };
    request.onsuccess = function(event) {
      if (blockedTimer) clearTimeout(blockedTimer);
      var db = event.target.result;
      db.onversionchange = function() { db.close(); console.warn('EpubLibraryDB: version changed externally, connection closed.'); };
      resolve(db);
    };
    request.onerror = function(event) {
      if (blockedTimer) clearTimeout(blockedTimer);
      var error = event.target.error;
      if (error.name === 'VersionError') {
        console.warn('EpubLibraryDB VersionError, deleting old database...');
        var deleteRequest = indexedDB.deleteDatabase(_COL_DB_NAME);
        deleteRequest.onsuccess = function() {
          var retryRequest = indexedDB.open(_COL_DB_NAME, _COL_DB_VERSION);
          retryRequest.onupgradeneeded = function(event) {
            var db = event.target.result;
            if (!db.objectStoreNames.contains(_COL_STORE_NAME)) {
              db.createObjectStore(_COL_STORE_NAME, { keyPath: 'id' });
            }
          };
          retryRequest.onsuccess = function(event) { resolve(event.target.result); };
          retryRequest.onerror = function(event) { reject(event.target.error); };
        };
        deleteRequest.onerror = function() { reject(error); };
      } else {
        reject(error);
      }
    };
  });
}

function _saveCollectionToDB() {
  if (!_bookId) return;
  _openColDB().then(function(db) {
    var tx = db.transaction(_COL_STORE_NAME, 'readonly');
    var store = tx.objectStore(_COL_STORE_NAME);
    var req = store.get(_bookId);
    req.onsuccess = function() {
      var bookData = req.result;
      if (!bookData) { db.close(); return; }
      bookData.collections = _collection.slice();
      var tx2 = db.transaction(_COL_STORE_NAME, 'readwrite');
      var store2 = tx2.objectStore(_COL_STORE_NAME);
      var putReq = store2.put(bookData);
      putReq.onsuccess = function() { db.close(); };
      putReq.onerror = function() { db.close(); console.warn('Save collection failed:', putReq.error); };
    };
    req.onerror = function() { db.close(); console.warn('Read book for collection save failed:', req.error); };
  }).catch(function(e) { console.warn('_saveCollectionToDB error:', e); });
}

function _loadCollectionFromDB(bookId) {
  if (!bookId) return Promise.resolve();
  return _openColDB().then(function(db) {
    return new Promise(function(resolve, reject) {
      var tx = db.transaction(_COL_STORE_NAME, 'readonly');
      var store = tx.objectStore(_COL_STORE_NAME);
      var req = store.get(bookId);
      req.onsuccess = function() {
        var bookData = req.result;
        _collection = (bookData && bookData.collections) ? bookData.collections : [];
        _updateCounter();
        db.close();
        resolve();
      };
      req.onerror = function() { db.close(); console.warn('Load collection failed:', req.error); _collection = []; _updateCounter(); resolve(); };
    });
  }).catch(function(e) { console.warn('_loadCollectionFromDB error:', e); _collection = []; _updateCounter(); });
}

/* ════════════════════════════════════════════════
   Load reader collections from shared IndexedDB
   (bridge: opens reader's EpubLibraryDB/books)
════════════════════════════════════════════════ */
function _loadReaderCollections(bookId) {
  if (!bookId) return;
  _loadCollectionFromDB(bookId).then(function() {
    if (_collection.length > 0) {
      snToast('Loaded ' + _collection.length + ' collection items from library');
    }
  });
}


/* ════════════════════════════════════════════════
   NEW — svuota l'editor (con salvataggio opzionale)
════════════════════════════════════════════════ */
function _newDocument() {
  var currentContent = getContent();
  var isEmpty = !currentContent || currentContent.replace(/<[^>]*>/g,'').trim() === '';

  if (!isEmpty) {
    var save = confirm('Salvare il documento corrente prima di crearne uno nuovo?');
    if (save) {
      // Esegue il salvataggio snapshot (clean + annotated)
      document.getElementById('chExportMainBtn').click();
    }
  }

  // Delete existing draft before reset
  _deleteContentDraft();
  // Reset filters
  _inspFilterType = 'all';
  _inspFilterChapter = 'all';

  // Reset editor e variabili di contesto
  $('#editor').summernote('code', '');
  _bookName    = '';
  _chapterName = '';
  _chapterId   = '';
  _bookId      = '';
  _mode        = 'standalone';
  _collection  = [];
  _updateCounter();
  document.getElementById('appHeaderTitle').textContent = 'Noesis Editor';
  snToast('Nuovo documento');
}

document.addEventListener('DOMContentLoaded', function() {
  var btn = document.getElementById('chNewBtn');
  if (!btn) return;
  btn.addEventListener('click', function() { _newDocument(); });
  var discardBtn = document.getElementById('chDiscardBtn');
  if (discardBtn) discardBtn.addEventListener('click', function() { _discardDocument(); });
});

/* ════════════════════════════════════════════════
   TOAST
════════════════════════════════════════════════ */
var _toastTimer = null;
function snToast(msg) {
  var t = document.getElementById('sn-toast');
  t.textContent = msg;
  t.classList.add('show');
  if (_toastTimer) clearTimeout(_toastTimer);
  _toastTimer = setTimeout(function() { t.classList.remove('show'); }, 2000);
}

/* ════════════════════════════════════════════════
   COLLECTION CORE (identico a noesis720)
════════════════════════════════════════════════ */
function _buildTimestamp() {
  var d = new Date(), p = function(n){ return String(n).padStart(2,'0'); };
  return d.getFullYear() + p(d.getMonth()+1) + p(d.getDate()) +
         '_' + p(d.getHours()) + p(d.getMinutes()) + p(d.getSeconds());
}

/* ── Costruisce il nome base file secondo lo schema noesis-{tipo}-book__chapter__TS
   tipo: es. 'clean', 'annot', 'html', 'docx', 'text', 'markdown', 'mdzip',
             'jsondoc', 'collection', 'colhtml', 'colmd', 'colzip'
   Se custom è fornito, viene appeso: noesis-tipo-book__chapter__TS_custom
─────────────────────────────────────────────────────────────────────── */
function _buildFileBase(tipo, custom) {
  var bookSlug    = (_bookName    || 'noesis').replace(/[^a-zA-Z0-9]/g, '_').substring(0, 40);
  var chapterSlug = (_chapterName || '').replace(/[^a-zA-Z0-9]/g, '_').substring(0, 40);
  var ts   = _buildTimestamp();
  var base = 'noesis-' + tipo + '-' + bookSlug;
  if (chapterSlug) base += '__' + chapterSlug;
  base += '__' + ts;
  if (custom && custom.trim()) base += '_' + custom.trim().replace(/[^a-zA-Z0-9_\-]/g, '_');
  return base;
}

/* ── Mostra un solo prompt con la parte automatica visibile come label ── */
function _promptCustom(tipo, ext) {
  var autoBase = _buildFileBase(tipo);
  var label = prompt(autoBase + '  →  aggiungi etichetta (invio per saltare):') ;
  // null = annullato, '' = invio senza testo
  if (label === null) return null; // utente ha annullato
  return _buildFileBase(tipo, label) + ext;
}

function _enrichChunk(chunk) {
  var c = chunk.content || '';
  var type = 'text';
  if (/<table[\s>]/i.test(c))    type = 'table';
  else if (/<img[\s>]/i.test(c)) type = 'img';

  var src = '', alt = '';
  if (type === 'img') {
    var mSrc = c.match(/src="([^"]*)"/);
    var mAlt = c.match(/alt="([^"]*)"/);
    if (mSrc) src = mSrc[1];
    if (mAlt) alt = mAlt[1];
  }

  return Object.assign({}, chunk, {
    type:    type,
    book:    _bookName,
    chapter: _chapterName,
    date:    new Date(chunk.timestamp || Date.now()).toISOString(),
    src:     src,
    alt:     alt,
    color:   chunk.color || 'yellow'
  });
}

function _saveChunk(chunk) {
  var toStore = Object.assign({}, chunk);
  toStore.id = Date.now();
  _collection.push(toStore);
  _saveCollectionToDB();
  _updateCounter();
  return toStore.id;
}

function _deleteChunkById(id) {
  _collection = _collection.filter(function(c) { return c.id !== id; });
  _saveCollectionToDB();
}

function _clearCollection() {
  _collection = [];
  _saveCollectionToDB();
  _updateCounter();
}

function _updateCounter() {
  document.getElementById('chunkCounter').textContent = _collection.length;
  var dcc = document.getElementById('drawerChunkCounter'); if (dcc) dcc.textContent = _collection.length;
}

/* Intercetta immagini cliccate e dblclick per raccolta collezione */
document.addEventListener('DOMContentLoaded', function() {
  // Aspetta che Summernote crei .note-editable
  var checkEditable = setInterval(function() {
    var editable = document.querySelector('.note-editable');
    if (!editable) return;
    clearInterval(checkEditable);

    // Mousedown diretto sul DOM — traccia immagini e tabelle
    editable.addEventListener('mousedown', function(e) {
      var t = e.target;
      // Immagine
      if (t && t.nodeName === 'IMG') {
        _selectedImg   = t;
        _selectedTable = null;
      }
      // Cella o tabella
      else if (t && (t.nodeName === 'TD' || t.nodeName === 'TH' ||
                     t.nodeName === 'TABLE' || t.nodeName === 'TR' ||
                     (t.closest && t.closest('table')))) {
        _selectedImg   = null;
        var tbl = t.nodeName === 'TABLE' ? t :
                  (t.closest ? t.closest('table') : null);
        _selectedTable = tbl || null;
      }
      else {
        _selectedImg   = null;
        _selectedTable = null;
      }
    });
    editable.addEventListener('touchstart', function(e) {
      var t = e.touches && e.touches[0] && document.elementFromPoint(
        e.touches[0].clientX, e.touches[0].clientY
      );
      if (t && t.nodeName === 'IMG') {
        _selectedImg = t;
      } else {
        _selectedImg = null;
      }
    }, { passive: true });

      // Doppio click su immagine → aggiunge direttamente alla collezione
    editable.addEventListener('dblclick', function(e) {
      var img = null;
      if (e.target.nodeName === 'IMG') img = e.target;
      else if (e.target.closest && e.target.closest('img')) img = e.target.closest('img');
      if (!img) return;
      e.preventDefault();
      e.stopPropagation();
      var html = img.outerHTML;
      var chunk = _enrichChunk({ content: html, timestamp: Date.now() });
      _saveChunk(chunk);
      _updateCounter();
      snToast('Image added (' + _collection.length + ')');
    });

    // Longpress su immagine (touch) → aggiunge alla collezione
    var _lpTimer = null;
    editable.addEventListener('touchstart', function(e) {
      var img = null;
      if (e.target.nodeName === 'IMG') img = e.target;
      else if (e.target.closest && e.target.closest('img')) img = e.target.closest('img');
      if (!img) return;
      _lpTimer = setTimeout(function() {
        var html = img.outerHTML;
        var chunk = _enrichChunk({ content: html, timestamp: Date.now() });
        _saveChunk(chunk);
        _updateCounter();
        snToast('Image added (' + _collection.length + ')');
      }, 600);
    }, { passive: true });
    editable.addEventListener('touchend', function() {
      if (_lpTimer) { clearTimeout(_lpTimer); _lpTimer = null; }
    }, { passive: true });
    editable.addEventListener('touchmove', function() {
      if (_lpTimer) { clearTimeout(_lpTimer); _lpTimer = null; }
    }, { passive: true });

  }, 200);
});

/* ════════════════════════════════════════════════
   BOTTONE [+] — aggiunge selezione
════════════════════════════════════════════════ */
document.getElementById('addChunkBtn').addEventListener('click', function() {
  var editable = document.querySelector('.note-editable');
  if (!editable) { snToast('Editor not ready'); return; }

  var html = '';

  // Caso 1: immagine — _selectedImg impostata da mousedown (desktop) o touchstart (Android)
  if (_selectedImg) {
    html = _selectedImg.outerHTML;
  }

  // Caso 2: tabella — tracciata da mousedown su _selectedTable
  if (!html.trim() && _selectedTable) {
    var wrap = _selectedTable.parentElement;
    html = (wrap && wrap !== editable) ? wrap.outerHTML : _selectedTable.outerHTML;
  }

  // Caso 3: selezione testo normale
  if (!html.trim()) {
    var sel = window.getSelection();
    if (sel && sel.rangeCount > 0 && !sel.isCollapsed && editable.contains(sel.anchorNode)) {
      var range = sel.getRangeAt(0);
      var div = document.createElement('div');
      div.appendChild(range.cloneContents());
      html = div.innerHTML;
    }
  }

  if (!html.trim()) {
    snToast('Select text, image or table');
    return;
  }

  var chunk = _enrichChunk({ content: html, timestamp: Date.now() });
  _saveChunk(chunk);
  _updateCounter();
  _selectedImg   = null;
  _selectedTable = null;
  snToast('Added to collection (' + _collection.length + ')');
});

/* ════════════════════════════════════════════════
   MENU COLLEZIONE
════════════════════════════════════════════════ */
/* ── Menu collezione: usa touchend per Android ── */




document.addEventListener('DOMContentLoaded', function() {
});



/* ════════════════════════════════════════════════
   IMPORT
════════════════════════════════════════════════ */
function _importCollection() {
  var inp = document.getElementById('collectionImportInput');
  inp.value = '';
  inp.click();
}
document.getElementById('collectionImportInput').addEventListener('change', function() {
  var file = this.files && this.files[0];
  if (!file) return;
  var fr = new FileReader();
  fr.onload = function(ev) {
    try {
      var data = JSON.parse(ev.target.result);
      var incoming = Array.isArray(data) ? data :
                     (Array.isArray(data.chunks) ? data.chunks : null);
      if (!incoming) { snToast('Invalid file'); return; }
      incoming.forEach(function(chunk) {
        var c = Object.assign({}, chunk);
        c.id = Date.now() + '_' + Math.floor(Math.random() * 1e9);
        _collection.push(c);
      });
      _updateCounter();
      snToast('Imported ' + incoming.length + ' chunks (' + _collection.length + ' total)');
    } catch(err) {
      snToast('Error reading JSON');
    }
  };
  fr.onerror = function() { snToast('Error reading file'); };
  fr.readAsText(file);
});

/* ════════════════════════════════════════════════
   EXPORT COLLEZIONE
════════════════════════════════════════════════ */
function _collectionDownload(data, tipo, ext, mimeType) {
  if (_collection.length === 0) { snToast('Collection is empty'); return false; }
  var filename = _promptCustom(tipo, ext);
  if (!filename) return false;
  var blob = data instanceof Blob ? data : new Blob([data], { type: mimeType });
  var url = URL.createObjectURL(blob);
  var a = document.createElement('a');
  a.href = url; a.download = filename; a.click();
  URL.revokeObjectURL(url);
  snToast('Exported ' + _collection.length + ' chunks');
  return true;
}

function _generateCollectionMd(keepImages) {
  var nL = '\n';
  var md = '# ' + (_chapterName || _bookName || 'Collection') + nL + nL;
  _collection.forEach(function(c, i) {
    if (c.label) md += '### ' + c.label + nL + nL;
    if (c.type === 'img') {
      if (keepImages) md += '![Image](images/image_' + i + '.png)' + nL + nL;
      else            md += '*[Image omitted]*' + nL + nL;
    } else if (c.type === 'table') {
      var tmp = document.createElement('div');
      tmp.innerHTML = c.content;
      var tbl = tmp.querySelector('table');
      md += (tbl ? '<table>' + tbl.innerHTML + '</table>' : '*[Table]*') + nL + nL;
    } else {
      var tmp2 = document.createElement('div');
      tmp2.innerHTML = c.content;
      md += tmp2.textContent + nL + nL;
    }
  });
  return md;
}

function _exportCollectionJson() {
  var payload = JSON.stringify({
    version: 1,
    exportedAt: new Date().toISOString(),
    bookName: _bookName,
    chapterName: _chapterName,
    chunks: _collection
  }, null, 2);
  _collectionDownload(payload, 'collection', '.json', 'application/json');
}

function _exportCollectionMd() {
  _collectionDownload(_generateCollectionMd(false), 'colmd', '.md', 'text/markdown');
}

function _exportCollectionMdZip() {
  if (_collection.length === 0) { snToast('Collection is empty'); return; }
  var filename = _promptCustom('colzip', '.zip');
  if (!filename) return;
  var mdName = filename.replace('.zip', '.md');
  var zip = new JSZip();
  var imgFolder = zip.folder('images');
  var md = _generateCollectionMd(true);
  _collection.forEach(function(c, i) {
    if (c.type === 'img') {
      var tmp = document.createElement('div');
      tmp.innerHTML = c.content;
      var imgEl = tmp.querySelector('img');
      if (imgEl && imgEl.src.indexOf('base64,') !== -1) {
        var b64 = imgEl.src.split('base64,')[1];
        if (b64) imgFolder.file('image_' + i + '.png', b64, { base64: true });
      }
    }
  });
  zip.file(mdName, md);
  zip.generateAsync({ type: 'blob' }).then(function(blob) {
    var url = URL.createObjectURL(blob);
    var a = document.createElement('a');
    a.href = url; a.download = filename; a.click();
    URL.revokeObjectURL(url);
    snToast('Exported ZIP with ' + _collection.length + ' chunks');
  });
}

function _exportCollectionHtml() {
  var html = '<!DOCTYPE html><html lang="it"><head><meta charset="UTF-8">' +
    '<title>' + (_chapterName || _bookName || 'Collection') + '</title>' +
    '<style>body{max-width:800px;margin:30px auto;font-family:sans-serif;line-height:1.6;}' +
    'img{max-width:100%;height:auto;}' +
    'table{width:100%;table-layout:fixed;border-collapse:collapse;word-wrap:break-word;}' +
    'td,th{word-wrap:break-word;max-width:0;border:1px solid #ddd;padding:6px;}' +
    '.chunk{margin-bottom:24px;padding-bottom:24px;border-bottom:1px solid #eee;}' +
    'h1{color:#1e293b;}h3{color:#6366f1;}</style></head><body>';
  html += '<h1>' + (_chapterName || _bookName || 'Collection') + '</h1>';
  _collection.forEach(function(c, i) {
    html += '<div class="chunk">';
    if (c.label) html += '<h3>' + c.label + '</h3>';
    if (c.type === 'img') {
      var tmp = document.createElement('div');
      tmp.innerHTML = c.content;
      var imgEl = tmp.querySelector('img');
      if (imgEl) html += '<img src="' + imgEl.src + '" alt="chunk ' + (i+1) + '">';
    } else {
      html += c.content;
    }
    html += '</div>';
  });
  html += '</body></html>';
  _collectionDownload(html, 'colhtml', '.html', 'text/html;charset=utf-8');
}

/* ════════════════════════════════════════════════
   INSPECT & DELETE
════════════════════════════════════════════════ */

/* Tracks selected chunk ids in inspect panel */
var _inspectSelected = {};
var _savedRange = null; // range salvato all'apertura inspect (per inject al cursore)
var _inspFilterType = 'all';
var _inspFilterChapter = 'all';

function _openInspect() {
  _inspectSelected = {};
  // Salva la posizione del cursore nell'editor prima di aprire il panel
  if (typeof $ !== 'undefined' && $('#editor').data('summernote')) {
    $('#editor').summernote('saveRange');
    _savedRange = true;
  } else {
    _savedRange = false;
  }
  var panel = document.getElementById('inspectPanel');
  // Show backdrop on mobile
  var backdrop = document.getElementById('mobileOverlayBackdropEditor');
  if (backdrop && window.innerWidth <= 768) backdrop.classList.add('visible');
  panel.classList.add('open');
  // Centra il panel la prima volta (o se non ha coordinate esplicite)
  if (!panel.style.left || panel.style.transform) {
    var pw = panel.offsetWidth  || Math.min(window.innerWidth * 0.9, 720);
    var ph = panel.offsetHeight || window.innerHeight * 0.85;
    panel.style.transform = '';
    panel.style.left = Math.max(0, (window.innerWidth  - pw) / 2) + 'px';
    panel.style.top  = Math.max(0, (window.innerHeight - ph) / 2) + 'px';
  }
  _renderInspect();
}

/* Inject di un singolo chunk alla posizione del cursore salvata */
function _injectChunkAtCursor(chunk) {
  if (typeof $ === 'undefined' || !$('#editor').data('summernote')) {
    snToast('Editor not ready');
    return;
  }
  // Ripristina il range salvato
  $('#editor').summernote('restoreRange');
  $('#editor').summernote('focus');
  // Crea un nodo wrapper con il contenuto del chunk
  var wrapper = document.createElement('div');
  wrapper.innerHTML = chunk.content || '';
  var nodes = Array.prototype.slice.call(wrapper.childNodes);
  if (nodes.length === 0) { snToast('Empty chunk'); return; }
  // Inserisci in ordine (reverse + insertNode mantiene la sequenza)
  nodes.reverse().forEach(function(node) {
    $('#editor').summernote('insertNode', node);
  });
  // Aggiorna il range salvato alla nuova posizione del cursore
  $('#editor').summernote('saveRange');
  snToast('Chunk inserito al cursore \u2193');
}
function _closeInspect() {
  document.getElementById('inspectPanel').classList.remove('open');
  var backdrop = document.getElementById('mobileOverlayBackdropEditor');
  if (backdrop) backdrop.classList.remove('visible');
}
document.getElementById('inspectClose').addEventListener('click', _closeInspect);

/* ════════════════════════════════════════════════
   DRAG (move) e RESIZE del panel flottante
════════════════════════════════════════════════ */
(function() {
  var panel  = document.getElementById('inspectPanel');
  var header = document.getElementById('inspectHeader');
  var handle = document.getElementById('inspectResizeHandle');

  /* ── helper: posizione pointer da mouse o touch ── */
  function _getXY(e) {
    if (e.touches && e.touches[0]) return { x: e.touches[0].clientX, y: e.touches[0].clientY };
    return { x: e.clientX, y: e.clientY };
  }

  /* ── DRAG (move) ── */
  var _drag = { active: false, startX: 0, startY: 0, origL: 0, origT: 0 };

  function _dragStart(e) {
    if (e.target.closest('#inspectClose')) return;
    // Rimuovi transform se ancora presente (prima apertura)
    if (panel.style.transform) {
      var r = panel.getBoundingClientRect();
      panel.style.left = r.left + 'px';
      panel.style.top  = r.top  + 'px';
      panel.style.transform = '';
    }
    var xy = _getXY(e);
    _drag.active = true;
    _drag.startX = xy.x;
    _drag.startY = xy.y;
    _drag.origL  = parseInt(panel.style.left, 10) || 0;
    _drag.origT  = parseInt(panel.style.top,  10) || 0;
    e.preventDefault();
  }
  function _dragMove(e) {
    if (!_drag.active) return;
    var xy = _getXY(e);
    var dx = xy.x - _drag.startX;
    var dy = xy.y - _drag.startY;
    var newL = Math.max(0, Math.min(_drag.origL + dx, window.innerWidth  - panel.offsetWidth));
    var newT = Math.max(0, Math.min(_drag.origT + dy, window.innerHeight - panel.offsetHeight));
    panel.style.left = newL + 'px';
    panel.style.top  = newT + 'px';
    e.preventDefault();
  }
  function _dragEnd() { _drag.active = false; }

  header.addEventListener('mousedown',  _dragStart);
  header.addEventListener('touchstart', _dragStart, { passive: false });
  document.addEventListener('mousemove',  _dragMove);
  document.addEventListener('touchmove',  _dragMove, { passive: false });
  document.addEventListener('mouseup',    _dragEnd);
  document.addEventListener('touchend',   _dragEnd);

  /* ── RESIZE (handle angolo basso-destra) ── */
  var _rsz = { active: false, startX: 0, startY: 0, origW: 0, origH: 0 };

  function _rszStart(e) {
    var xy = _getXY(e);
    _rsz.active = true;
    _rsz.startX = xy.x;
    _rsz.startY = xy.y;
    _rsz.origW  = panel.offsetWidth;
    _rsz.origH  = panel.offsetHeight;
    e.preventDefault();
    e.stopPropagation();
  }
  function _rszMove(e) {
    if (!_rsz.active) return;
    var xy = _getXY(e);
    var newW = Math.max(260, _rsz.origW + (xy.x - _rsz.startX));
    var newH = Math.max(200, _rsz.origH + (xy.y - _rsz.startY));
    // Clamp ai bordi del viewport
    var panelL = parseInt(panel.style.left, 10) || 0;
    var panelT = parseInt(panel.style.top,  10) || 0;
    newW = Math.min(newW, window.innerWidth  - panelL - 4);
    newH = Math.min(newH, window.innerHeight - panelT - 4);
    panel.style.width  = newW + 'px';
    panel.style.height = newH + 'px';
    e.preventDefault();
  }
  function _rszEnd() { _rsz.active = false; }

  handle.addEventListener('mousedown',  _rszStart);
  handle.addEventListener('touchstart', _rszStart, { passive: false });
  document.addEventListener('mousemove',  _rszMove);
  document.addEventListener('touchmove',  _rszMove, { passive: false });
  document.addEventListener('mouseup',    _rszEnd);
  document.addEventListener('touchend',   _rszEnd);
})();

function _updateInspectFooter() {
  var count = Object.keys(_inspectSelected).filter(function(k) { return _inspectSelected[k]; }).length;
  document.getElementById('inspectSelCount').textContent = count + ' selected';
  document.getElementById('inspectInjectBtn').disabled = count === 0;
}

document.getElementById('inspectSelAll').addEventListener('click', function() {
  _collection.forEach(function(c) { _inspectSelected[c.id] = true; });
  document.querySelectorAll('.chunk-item').forEach(function(el) { el.classList.add('selected'); });
  document.querySelectorAll('.chunk-check-wrap input[type="checkbox"]').forEach(function(cb) { cb.checked = true; });
  _updateInspectFooter();
});

document.getElementById('inspectSelNone').addEventListener('click', function() {
  _inspectSelected = {};
  document.querySelectorAll('.chunk-item').forEach(function(el) { el.classList.remove('selected'); });
  document.querySelectorAll('.chunk-check-wrap input[type="checkbox"]').forEach(function(cb) { cb.checked = false; });
  _updateInspectFooter();
});

// ── Inspect filter: type buttons ──
document.querySelectorAll('#inspectFilterTypes .insp-ft-btn').forEach(function(btn) {
  btn.addEventListener('click', function() {
    document.querySelectorAll('#inspectFilterTypes .insp-ft-btn').forEach(function(b) { b.classList.remove('active'); });
    btn.classList.add('active');
    _inspFilterType = btn.dataset.type;
    _renderInspect();
  });
});

// ── Inspect filter: chapter dropdown ──
var inspChFilter = document.getElementById('inspectChapterFilter');
if (inspChFilter) {
  inspChFilter.addEventListener('change', function() {
    _inspFilterChapter = inspChFilter.value;
    _renderInspect();
  });
}

document.getElementById('inspectInjectBtn').addEventListener('click', function() {
  var selected = _collection.filter(function(c) { return _inspectSelected[c.id]; });
  if (selected.length === 0) return;
  var html = selected.map(function(c) { return c.content; }).join('\n');
  if (typeof $ !== 'undefined' && $('#editor').data('summernote')) {
    $('#editor').summernote('code', $('#editor').summernote('code') + html);
    snToast(selected.length + ' chunk' + (selected.length !== 1 ? 's' : '') + ' injected into editor');
  } else {
    snToast('Editor not ready');
    return;
  }
  _closeInspect();
});

function _populateInspectChapterFilter() {
  var sel = document.getElementById('inspectChapterFilter');
  if (!sel) return;
  var chapters = [];
  _collection.forEach(function(c) {
    var ch = c.chapter || 'Unknown';
    if (chapters.indexOf(ch) === -1) chapters.push(ch);
  });
  chapters.sort();
  var prev = sel.value;
  sel.innerHTML = '<option value="all">All chapters</option>';
  chapters.forEach(function(ch) {
    sel.innerHTML += '<option value="' + ch + '">' + ch + '</option>';
  });
  if (chapters.indexOf(prev) !== -1) sel.value = prev;
}

function _renderInspect() {
  var list = document.getElementById('inspectList');
  var title = document.getElementById('inspectTitle');
  var chunks = _collection.slice();

  // Apply filters
  if (_inspFilterType !== 'all') chunks = chunks.filter(function(c) { return c.type === _inspFilterType; });
  if (_inspFilterChapter !== 'all') chunks = chunks.filter(function(c) { return c.chapter === _inspFilterChapter; });

  title.textContent = 'Collection — ' + chunks.length + ' chunk' + (chunks.length !== 1 ? 's' : '');
  list.innerHTML = '';
  _populateInspectChapterFilter();
  _updateInspectFooter();
  if (chunks.length === 0) {
    var msg = _collection.length === 0
      ? '<div class="inspect-empty">No chunks in collection yet.</div>'
      : '<div class="inspect-empty">No chunks match filters.</div>';
    list.innerHTML = msg;
    return;
  }
  chunks.forEach(function(chunk, idx) {
    var typeLabel = (chunk.type || 'text');
    if (typeLabel === 'img') typeLabel = 'image';
    typeLabel = typeLabel.charAt(0).toUpperCase() + typeLabel.slice(1);
    var meta = '';
    if (chunk.book)    meta += ' · ' + chunk.book;
    if (chunk.chapter) meta += ' › ' + chunk.chapter;

    var item = document.createElement('div');
    item.className = 'chunk-item' + (_inspectSelected[chunk.id] ? ' selected' : '');

    /* ── Checkbox column ── */
    var checkWrap = document.createElement('label');
    checkWrap.className = 'chunk-check-wrap';
    checkWrap.title = 'Select for injection';
    var cb = document.createElement('input');
    cb.type = 'checkbox';
    cb.checked = !!_inspectSelected[chunk.id];
    (function(chunkId, itemEl) {
      cb.addEventListener('change', function() {
        _inspectSelected[chunkId] = cb.checked;
        itemEl.classList.toggle('selected', cb.checked);
        _updateInspectFooter();
      });
    })(chunk.id, item);
    checkWrap.appendChild(cb);

    /* ── Body ── */
    var body = document.createElement('div');
    body.className = 'chunk-body';

    var label = document.createElement('div');
    label.className = 'chunk-label';
    label.textContent = '#' + (idx + 1) + ' — ' + typeLabel + meta;

    var preview = document.createElement('div');
    preview.className = 'chunk-preview';
    preview.innerHTML = chunk.content || '';

    // Color highlight preview for text chunks
    if (chunk.type === 'text' && chunk.color) {
      var hlMap = { yellow: '#ffeb3b', green: '#a5d6a7', pink: '#f8bbd9' };
      preview.style.borderLeft = '3px solid ' + (hlMap[chunk.color] || '#ffeb3b');
      preview.style.paddingLeft = '8px';
    }

    body.appendChild(label);
    body.appendChild(preview);

    // Date
    if (chunk.date) {
      var dateEl = document.createElement('div');
      dateEl.className = 'insp-date';
      var d = new Date(chunk.date);
      dateEl.textContent = d.toLocaleDateString() + ' ' + d.toLocaleTimeString([], {hour:'2-digit',minute:'2-digit'});
      body.appendChild(dateEl);
    }

    /* ── Action buttons ── */
    var delBtn = document.createElement('button');
    delBtn.className = 'chunk-del';
    delBtn.title = 'Remove chunk';
    delBtn.innerHTML = '<i class="bi bi-x-circle"></i>';
    (function(chunkId) {
      delBtn.addEventListener('click', function(e) {
        e.stopPropagation();
        _deleteChunkById(chunkId);
        delete _inspectSelected[chunkId];
        _updateCounter();
        snToast('Chunk removed (' + _collection.length + ' remaining)');
        _renderInspect();
      });
    })(chunk.id);

    var fsBtn = document.createElement('button');
    fsBtn.className = 'chunk-fs';
    fsBtn.title = 'View fullscreen';
    fsBtn.innerHTML = '<i class="bi bi-fullscreen"></i>';
    (function(chunkContent, chunkLabel) {
      fsBtn.addEventListener('click', function(e) {
        e.stopPropagation();
        _openChunkFs(chunkContent, chunkLabel);
      });
    })(chunk.content, '#' + (idx + 1) + ' — ' + typeLabel + meta);

    /* ── Pulsante "↓ qui" — inject al cursore ── */
    var insertBtn = document.createElement('button');
    insertBtn.className = 'chunk-insert-here';
    insertBtn.title = 'Inserisci alla posizione del cursore';
    insertBtn.innerHTML = '<i class="bi bi-cursor-text"></i>';
    (function(c) {
      insertBtn.addEventListener('click', function(e) {
        e.stopPropagation();
        _injectChunkAtCursor(c);
      });
    })(chunk);

    var actions = document.createElement('div');
    actions.className = 'chunk-actions';
    actions.appendChild(insertBtn);
    actions.appendChild(fsBtn);
    actions.appendChild(delBtn);

    item.appendChild(checkWrap);
    item.appendChild(body);
    item.appendChild(actions);
    list.appendChild(item);
  });
}

/* ════════════════════════════════════════════════
   CHUNK FULLSCREEN
════════════════════════════════════════════════ */
function _openChunkFs(content, label) {
  document.getElementById('chunkFsLabel').textContent = label || 'Chunk';
  document.getElementById('chunkFsBody').innerHTML = content || '';
  document.getElementById('chunkFsOverlay').classList.add('open');
}
function _closeChunkFs() {
  document.getElementById('chunkFsOverlay').classList.remove('open');
  document.getElementById('chunkFsBody').innerHTML = '';
}
document.getElementById('chunkFsClose').addEventListener('click', _closeChunkFs);
document.getElementById('chunkFsOverlay').addEventListener('click', function(e) {
  if (e.target === this) _closeChunkFs();
});

/* ════════════════════════════════════════════════
   CLEAR
════════════════════════════════════════════════ */
function _confirmClear() {
  if (_collection.length === 0) { snToast('Collection already empty'); return; }
  if (!confirm('Clear the collection? (' + _collection.length + ' chunks)')) return;
  _clearCollection();
  snToast('Collection cleared');
}

/* ════════════════════════════════════════════════
   INIT SUMMERNOTE (caricamento dinamico)
════════════════════════════════════════════════ */
/* jQuery 3.7.1 inline */
/*! jQuery v3.7.1 | (c) OpenJS Foundation and other contributors | jquery.org/license */
!function(e,t){"use strict";"object"==typeof module&&"object"==typeof module.exports?module.exports=e.document?t(e,!0):function(e){if(!e.document)throw new Error("jQuery requires a window with a document");return t(e)}:t(e)}("undefined"!=typeof window?window:this,function(ie,e){"use strict";var oe=[],r=Object.getPrototypeOf,ae=oe.slice,g=oe.flat?function(e){return oe.flat.call(e)}:function(e){return oe.concat.apply([],e)},s=oe.push,se=oe.indexOf,n={},i=n.toString,ue=n.hasOwnProperty,o=ue.toString,a=o.call(Object),le={},v=function(e){return"function"==typeof e&&"number"!=typeof e.nodeType&&"function"!=typeof e.item},y=function(e){return null!=e&&e===e.window},C=ie.document,u={type:!0,src:!0,nonce:!0,noModule:!0};function m(e,t,n){var r,i,o=(n=n||C).createElement("script");if(o.text=e,t)for(r in u)(i=t[r]||t.getAttribute&&t.getAttribute(r))&&o.setAttribute(r,i);n.head.appendChild(o).parentNode.removeChild(o)}function x(e){return null==e?e+"":"object"==typeof e||"function"==typeof e?n[i.call(e)]||"object":typeof e}var t="3.7.1",l=/HTML$/i,ce=function(e,t){return new ce.fn.init(e,t)};function c(e){var t=!!e&&"length"in e&&e.length,n=x(e);return!v(e)&&!y(e)&&("array"===n||0===t||"number"==typeof t&&0<t&&t-1 in e)}function fe(e,t){return e.nodeName&&e.nodeName.toLowerCase()===t.toLowerCase()}ce.fn=ce.prototype={jquery:t,constructor:ce,length:0,toArray:function(){return ae.call(this)},get:function(e){return null==e?ae.call(this):e<0?this[e+this.length]:this[e]},pushStack:function(e){var t=ce.merge(this.constructor(),e);return t.prevObject=this,t},each:function(e){return ce.each(this,e)},map:function(n){return this.pushStack(ce.map(this,function(e,t){return n.call(e,t,e)}))},slice:function(){return this.pushStack(ae.apply(this,arguments))},first:function(){return this.eq(0)},last:function(){return this.eq(-1)},even:function(){return this.pushStack(ce.grep(this,function(e,t){return(t+1)%2}))},odd:function(){return this.pushStack(ce.grep(this,function(e,t){return t%2}))},eq:function(e){var t=this.length,n=+e+(e<0?t:0);return this.pushStack(0<=n&&n<t?[this[n]]:[])},end:function(){return this.prevObject||this.constructor()},push:s,sort:oe.sort,splice:oe.splice},ce.extend=ce.fn.extend=function(){var e,t,n,r,i,o,a=arguments[0]||{},s=1,u=arguments.length,l=!1;for("boolean"==typeof a&&(l=a,a=arguments[s]||{},s++),"object"==typeof a||v(a)||(a={}),s===u&&(a=this,s--);s<u;s++)if(null!=(e=arguments[s]))for(t in e)r=e[t],"__proto__"!==t&&a!==r&&(l&&r&&(ce.isPlainObject(r)||(i=Array.isArray(r)))?(n=a[t],o=i&&!Array.isArray(n)?[]:i||ce.isPlainObject(n)?n:{},i=!1,a[t]=ce.extend(l,o,r)):void 0!==r&&(a[t]=r));return a},ce.extend({expando:"jQuery"+(t+Math.random()).replace(/\D/g,""),isReady:!0,error:function(e){throw new Error(e)},noop:function(){},isPlainObject:function(e){var t,n;return!(!e||"[object Object]"!==i.call(e))&&(!(t=r(e))||"function"==typeof(n=ue.call(t,"constructor")&&t.constructor)&&o.call(n)===a)},isEmptyObject:function(e){var t;for(t in e)return!1;return!0},globalEval:function(e,t,n){m(e,{nonce:t&&t.nonce},n)},each:function(e,t){var n,r=0;if(c(e)){for(n=e.length;r<n;r++)if(!1===t.call(e[r],r,e[r]))break}else for(r in e)if(!1===t.call(e[r],r,e[r]))break;return e},text:function(e){var t,n="",r=0,i=e.nodeType;if(!i)while(t=e[r++])n+=ce.text(t);return 1===i||11===i?e.textContent:9===i?e.documentElement.textContent:3===i||4===i?e.nodeValue:n},makeArray:function(e,t){var n=t||[];return null!=e&&(c(Object(e))?ce.merge(n,"string"==typeof e?[e]:e):s.call(n,e)),n},inArray:function(e,t,n){return null==t?-1:se.call(t,e,n)},isXMLDoc:function(e){var t=e&&e.namespaceURI,n=e&&(e.ownerDocument||e).documentElement;return!l.test(t||n&&n.nodeName||"HTML")},merge:function(e,t){for(var n=+t.length,r=0,i=e.length;r<n;r++)e[i++]=t[r];return e.length=i,e},grep:function(e,t,n){for(var r=[],i=0,o=e.length,a=!n;i<o;i++)!t(e[i],i)!==a&&r.push(e[i]);return r},map:function(e,t,n){var r,i,o=0,a=[];if(c(e))for(r=e.length;o<r;o++)null!=(i=t(e[o],o,n))&&a.push(i);else for(o in e)null!=(i=t(e[o],o,n))&&a.push(i);return g(a)},guid:1,support:le}),"function"==typeof Symbol&&(ce.fn[Symbol.iterator]=oe[Symbol.iterator]),ce.each("Boolean Number String Function Array Date RegExp Object Error Symbol".split(" "),function(e,t){n["[object "+t+"]"]=t.toLowerCase()});var pe=oe.pop,de=oe.sort,he=oe.splice,ge="[\\x20\\t\\r\\n\\f]",ve=new RegExp("^"+ge+"+|((?:^|[^\\\\])(?:\\\\.)*)"+ge+"+$","g");ce.contains=function(e,t){var n=t&&t.parentNode;return e===n||!(!n||1!==n.nodeType||!(e.contains?e.contains(n):e.compareDocumentPosition&&16&e.compareDocumentPosition(n)))};var f=/([\0-\x1f\x7f]|^-?\d)|^-$|[^\x80-\uFFFF\w-]/g;function p(e,t){return t?"\0"===e?"\ufffd":e.slice(0,-1)+"\\"+e.charCodeAt(e.length-1).toString(16)+" ":"\\"+e}ce.escapeSelector=function(e){return(e+"").replace(f,p)};var ye=C,me=s;!function(){var e,b,w,o,a,T,r,C,d,i,k=me,S=ce.expando,E=0,n=0,s=W(),c=W(),u=W(),h=W(),l=function(e,t){return e===t&&(a=!0),0},f="checked|selected|async|autofocus|autoplay|controls|defer|disabled|hidden|ismap|loop|multiple|open|readonly|required|scoped",t="(?:\\\\[\\da-fA-F]{1,6}"+ge+"?|\\\\[^\\r\\n\\f]|[\\w-]|[^\0-\\x7f])+",p="\\["+ge+"*("+t+")(?:"+ge+"*([*^$|!~]?=)"+ge+"*(?:'((?:\\\\.|[^\\\\'])*)'|\"((?:\\\\.|[^\\\\\"])*)\"|("+t+"))|)"+ge+"*\\]",g=":("+t+")(?:\\((('((?:\\\\.|[^\\\\'])*)'|\"((?:\\\\.|[^\\\\\"])*)\")|((?:\\\\.|[^\\\\()[\\]]|"+p+")*)|.*)\\)|)",v=new RegExp(ge+"+","g"),y=new RegExp("^"+ge+"*,"+ge+"*"),m=new RegExp("^"+ge+"*([>+~]|"+ge+")"+ge+"*"),x=new RegExp(ge+"|>"),j=new RegExp(g),A=new RegExp("^"+t+"$"),D={ID:new RegExp("^#("+t+")"),CLASS:new RegExp("^\\.("+t+")"),TAG:new RegExp("^("+t+"|[*])"),ATTR:new RegExp("^"+p),PSEUDO:new RegExp("^"+g),CHILD:new RegExp("^:(only|first|last|nth|nth-last)-(child|of-type)(?:\\("+ge+"*(even|odd|(([+-]|)(\\d*)n|)"+ge+"*(?:([+-]|)"+ge+"*(\\d+)|))"+ge+"*\\)|)","i"),bool:new RegExp("^(?:"+f+")$","i"),needsContext:new RegExp("^"+ge+"*[>+~]|:(even|odd|eq|gt|lt|nth|first|last)(?:\\("+ge+"*((?:-\\d)?\\d*)"+ge+"*\\)|)(?=[^-]|$)","i")},N=/^(?:input|select|textarea|button)$/i,q=/^h\d$/i,L=/^(?:#([\w-]+)|(\w+)|\.([\w-]+))$/,H=/[+~]/,O=new RegExp("\\\\[\\da-fA-F]{1,6}"+ge+"?|\\\\([^\\r\\n\\f])","g"),P=function(e,t){var n="0x"+e.slice(1)-65536;return t||(n<0?String.fromCharCode(n+65536):String.fromCharCode(n>>10|55296,1023&n|56320))},M=function(){V()},R=J(function(e){return!0===e.disabled&&fe(e,"fieldset")},{dir:"parentNode",next:"legend"});try{k.apply(oe=ae.call(ye.childNodes),ye.childNodes),oe[ye.childNodes.length].nodeType}catch(e){k={apply:function(e,t){me.apply(e,ae.call(t))},call:function(e){me.apply(e,ae.call(arguments,1))}}}function I(t,e,n,r){var i,o,a,s,u,l,c,f=e&&e.ownerDocument,p=e?e.nodeType:9;if(n=n||[],"string"!=typeof t||!t||1!==p&&9!==p&&11!==p)return n;if(!r&&(V(e),e=e||T,C)){if(11!==p&&(u=L.exec(t)))if(i=u[1]){if(9===p){if(!(a=e.getElementById(i)))return n;if(a.id===i)return k.call(n,a),n}else if(f&&(a=f.getElementById(i))&&I.contains(e,a)&&a.id===i)return k.call(n,a),n}else{if(u[2])return k.apply(n,e.getElementsByTagName(t)),n;if((i=u[3])&&e.getElementsByClassName)return k.apply(n,e.getElementsByClassName(i)),n}if(!(h[t+" "]||d&&d.test(t))){if(c=t,f=e,1===p&&(x.test(t)||m.test(t))){(f=H.test(t)&&U(e.parentNode)||e)==e&&le.scope||((s=e.getAttribute("id"))?s=ce.escapeSelector(s):e.setAttribute("id",s=S)),o=(l=Y(t)).length;while(o--)l[o]=(s?"#"+s:":scope")+" "+Q(l[o]);c=l.join(",")}try{return k.apply(n,f.querySelectorAll(c)),n}catch(e){h(t,!0)}finally{s===S&&e.removeAttribute("id")}}}return re(t.replace(ve,"$1"),e,n,r)}function W(){var r=[];return function e(t,n){return r.push(t+" ")>b.cacheLength&&delete e[r.shift()],e[t+" "]=n}}function F(e){return e[S]=!0,e}function $(e){var t=T.createElement("fieldset");try{return!!e(t)}catch(e){return!1}finally{t.parentNode&&t.parentNode.removeChild(t),t=null}}function B(t){return function(e){return fe(e,"input")&&e.type===t}}function _(t){return function(e){return(fe(e,"input")||fe(e,"button"))&&e.type===t}}function z(t){return function(e){return"form"in e?e.parentNode&&!1===e.disabled?"label"in e?"label"in e.parentNode?e.parentNode.disabled===t:e.disabled===t:e.isDisabled===t||e.isDisabled!==!t&&R(e)===t:e.disabled===t:"label"in e&&e.disabled===t}}function X(a){return F(function(o){return o=+o,F(function(e,t){var n,r=a([],e.length,o),i=r.length;while(i--)e[n=r[i]]&&(e[n]=!(t[n]=e[n]))})})}function U(e){return e&&"undefined"!=typeof e.getElementsByTagName&&e}function V(e){var t,n=e?e.ownerDocument||e:ye;return n!=T&&9===n.nodeType&&n.documentElement&&(r=(T=n).documentElement,C=!ce.isXMLDoc(T),i=r.matches||r.webkitMatchesSelector||r.msMatchesSelector,r.msMatchesSelector&&ye!=T&&(t=T.defaultView)&&t.top!==t&&t.addEventListener("unload",M),le.getById=$(function(e){return r.appendChild(e).id=ce.expando,!T.getElementsByName||!T.getElementsByName(ce.expando).length}),le.disconnectedMatch=$(function(e){return i.call(e,"*")}),le.scope=$(function(){return T.querySelectorAll(":scope")}),le.cssHas=$(function(){try{return T.querySelector(":has(*,:jqfake)"),!1}catch(e){return!0}}),le.getById?(b.filter.ID=function(e){var t=e.replace(O,P);return function(e){return e.getAttribute("id")===t}},b.find.ID=function(e,t){if("undefined"!=typeof t.getElementById&&C){var n=t.getElementById(e);return n?[n]:[]}}):(b.filter.ID=function(e){var n=e.replace(O,P);return function(e){var t="undefined"!=typeof e.getAttributeNode&&e.getAttributeNode("id");return t&&t.value===n}},b.find.ID=function(e,t){if("undefined"!=typeof t.getElementById&&C){var n,r,i,o=t.getElementById(e);if(o){if((n=o.getAttributeNode("id"))&&n.value===e)return[o];i=t.getElementsByName(e),r=0;while(o=i[r++])if((n=o.getAttributeNode("id"))&&n.value===e)return[o]}return[]}}),b.find.TAG=function(e,t){return"undefined"!=typeof t.getElementsByTagName?t.getElementsByTagName(e):t.querySelectorAll(e)},b.find.CLASS=function(e,t){if("undefined"!=typeof t.getElementsByClassName&&C)return t.getElementsByClassName(e)},d=[],$(function(e){var t;r.appendChild(e).innerHTML="<a id='"+S+"' href='' disabled='disabled'></a><select id='"+S+"-\r\\' disabled='disabled'><option selected=''></option></select>",e.querySelectorAll("[selected]").length||d.push("\\["+ge+"*(?:value|"+f+")"),e.querySelectorAll("[id~="+S+"-]").length||d.push("~="),e.querySelectorAll("a#"+S+"+*").length||d.push(".#.+[+~]"),e.querySelectorAll(":checked").length||d.push(":checked"),(t=T.createElement("input")).setAttribute("type","hidden"),e.appendChild(t).setAttribute("name","D"),r.appendChild(e).disabled=!0,2!==e.querySelectorAll(":disabled").length&&d.push(":enabled",":disabled"),(t=T.createElement("input")).setAttribute("name",""),e.appendChild(t),e.querySelectorAll("[name='']").length||d.push("\\["+ge+"*name"+ge+"*="+ge+"*(?:''|\"\")")}),le.cssHas||d.push(":has"),d=d.length&&new RegExp(d.join("|")),l=function(e,t){if(e===t)return a=!0,0;var n=!e.compareDocumentPosition-!t.compareDocumentPosition;return n||(1&(n=(e.ownerDocument||e)==(t.ownerDocument||t)?e.compareDocumentPosition(t):1)||!le.sortDetached&&t.compareDocumentPosition(e)===n?e===T||e.ownerDocument==ye&&I.contains(ye,e)?-1:t===T||t.ownerDocument==ye&&I.contains(ye,t)?1:o?se.call(o,e)-se.call(o,t):0:4&n?-1:1)}),T}for(e in I.matches=function(e,t){return I(e,null,null,t)},I.matchesSelector=function(e,t){if(V(e),C&&!h[t+" "]&&(!d||!d.test(t)))try{var n=i.call(e,t);if(n||le.disconnectedMatch||e.document&&11!==e.document.nodeType)return n}catch(e){h(t,!0)}return 0<I(t,T,null,[e]).length},I.contains=function(e,t){return(e.ownerDocument||e)!=T&&V(e),ce.contains(e,t)},I.attr=function(e,t){(e.ownerDocument||e)!=T&&V(e);var n=b.attrHandle[t.toLowerCase()],r=n&&ue.call(b.attrHandle,t.toLowerCase())?n(e,t,!C):void 0;return void 0!==r?r:e.getAttribute(t)},I.error=function(e){throw new Error("Syntax error, unrecognized expression: "+e)},ce.uniqueSort=function(e){var t,n=[],r=0,i=0;if(a=!le.sortStable,o=!le.sortStable&&ae.call(e,0),de.call(e,l),a){while(t=e[i++])t===e[i]&&(r=n.push(i));while(r--)he.call(e,n[r],1)}return o=null,e},ce.fn.uniqueSort=function(){return this.pushStack(ce.uniqueSort(ae.apply(this)))},(b=ce.expr={cacheLength:50,createPseudo:F,match:D,attrHandle:{},find:{},relative:{">":{dir:"parentNode",first:!0}," ":{dir:"parentNode"},"+":{dir:"previousSibling",first:!0},"~":{dir:"previousSibling"}},preFilter:{ATTR:function(e){return e[1]=e[1].replace(O,P),e[3]=(e[3]||e[4]||e[5]||"").replace(O,P),"~="===e[2]&&(e[3]=" "+e[3]+" "),e.slice(0,4)},CHILD:function(e){return e[1]=e[1].toLowerCase(),"nth"===e[1].slice(0,3)?(e[3]||I.error(e[0]),e[4]=+(e[4]?e[5]+(e[6]||1):2*("even"===e[3]||"odd"===e[3])),e[5]=+(e[7]+e[8]||"odd"===e[3])):e[3]&&I.error(e[0]),e},PSEUDO:function(e){var t,n=!e[6]&&e[2];return D.CHILD.test(e[0])?null:(e[3]?e[2]=e[4]||e[5]||"":n&&j.test(n)&&(t=Y(n,!0))&&(t=n.indexOf(")",n.length-t)-n.length)&&(e[0]=e[0].slice(0,t),e[2]=n.slice(0,t)),e.slice(0,3))}},filter:{TAG:function(e){var t=e.replace(O,P).toLowerCase();return"*"===e?function(){return!0}:function(e){return fe(e,t)}},CLASS:function(e){var t=s[e+" "];return t||(t=new RegExp("(^|"+ge+")"+e+"("+ge+"|$)"))&&s(e,function(e){return t.test("string"==typeof e.className&&e.className||"undefined"!=typeof e.getAttribute&&e.getAttribute("class")||"")})},ATTR:function(n,r,i){return function(e){var t=I.attr(e,n);return null==t?"!="===r:!r||(t+="","="===r?t===i:"!="===r?t!==i:"^="===r?i&&0===t.indexOf(i):"*="===r?i&&-1<t.indexOf(i):"$="===r?i&&t.slice(-i.length)===i:"~="===r?-1<(" "+t.replace(v," ")+" ").indexOf(i):"|="===r&&(t===i||t.slice(0,i.length+1)===i+"-"))}},CHILD:function(d,e,t,h,g){var v="nth"!==d.slice(0,3),y="last"!==d.slice(-4),m="of-type"===e;return 1===h&&0===g?function(e){return!!e.parentNode}:function(e,t,n){var r,i,o,a,s,u=v!==y?"nextSibling":"previousSibling",l=e.parentNode,c=m&&e.nodeName.toLowerCase(),f=!n&&!m,p=!1;if(l){if(v){while(u){o=e;while(o=o[u])if(m?fe(o,c):1===o.nodeType)return!1;s=u="only"===d&&!s&&"nextSibling"}return!0}if(s=[y?l.firstChild:l.lastChild],y&&f){p=(a=(r=(i=l[S]||(l[S]={}))[d]||[])[0]===E&&r[1])&&r[2],o=a&&l.childNodes[a];while(o=++a&&o&&o[u]||(p=a=0)||s.pop())if(1===o.nodeType&&++p&&o===e){i[d]=[E,a,p];break}}else if(f&&(p=a=(r=(i=e[S]||(e[S]={}))[d]||[])[0]===E&&r[1]),!1===p)while(o=++a&&o&&o[u]||(p=a=0)||s.pop())if((m?fe(o,c):1===o.nodeType)&&++p&&(f&&((i=o[S]||(o[S]={}))[d]=[E,p]),o===e))break;return(p-=g)===h||p%h==0&&0<=p/h}}},PSEUDO:function(e,o){var t,a=b.pseudos[e]||b.setFilters[e.toLowerCase()]||I.error("unsupported pseudo: "+e);return a[S]?a(o):1<a.length?(t=[e,e,"",o],b.setFilters.hasOwnProperty(e.toLowerCase())?F(function(e,t){var n,r=a(e,o),i=r.length;while(i--)e[n=se.call(e,r[i])]=!(t[n]=r[i])}):function(e){return a(e,0,t)}):a}},pseudos:{not:F(function(e){var r=[],i=[],s=ne(e.replace(ve,"$1"));return s[S]?F(function(e,t,n,r){var i,o=s(e,null,r,[]),a=e.length;while(a--)(i=o[a])&&(e[a]=!(t[a]=i))}):function(e,t,n){return r[0]=e,s(r,null,n,i),r[0]=null,!i.pop()}}),has:F(function(t){return function(e){return 0<I(t,e).length}}),contains:F(function(t){return t=t.replace(O,P),function(e){return-1<(e.textContent||ce.text(e)).indexOf(t)}}),lang:F(function(n){return A.test(n||"")||I.error("unsupported lang: "+n),n=n.replace(O,P).toLowerCase(),function(e){var t;do{if(t=C?e.lang:e.getAttribute("xml:lang")||e.getAttribute("lang"))return(t=t.toLowerCase())===n||0===t.indexOf(n+"-")}while((e=e.parentNode)&&1===e.nodeType);return!1}}),target:function(e){var t=ie.location&&ie.location.hash;return t&&t.slice(1)===e.id},root:function(e){return e===r},focus:function(e){return e===function(){try{return T.activeElement}catch(e){}}()&&T.hasFocus()&&!!(e.type||e.href||~e.tabIndex)},enabled:z(!1),disabled:z(!0),checked:function(e){return fe(e,"input")&&!!e.checked||fe(e,"option")&&!!e.selected},selected:function(e){return e.parentNode&&e.parentNode.selectedIndex,!0===e.selected},empty:function(e){for(e=e.firstChild;e;e=e.nextSibling)if(e.nodeType<6)return!1;return!0},parent:function(e){return!b.pseudos.empty(e)},header:function(e){return q.test(e.nodeName)},input:function(e){return N.test(e.nodeName)},button:function(e){return fe(e,"input")&&"button"===e.type||fe(e,"button")},text:function(e){var t;return fe(e,"input")&&"text"===e.type&&(null==(t=e.getAttribute("type"))||"text"===t.toLowerCase())},first:X(function(){return[0]}),last:X(function(e,t){return[t-1]}),eq:X(function(e,t,n){return[n<0?n+t:n]}),even:X(function(e,t){for(var n=0;n<t;n+=2)e.push(n);return e}),odd:X(function(e,t){for(var n=1;n<t;n+=2)e.push(n);return e}),lt:X(function(e,t,n){var r;for(r=n<0?n+t:t<n?t:n;0<=--r;)e.push(r);return e}),gt:X(function(e,t,n){for(var r=n<0?n+t:n;++r<t;)e.push(r);return e})}}).pseudos.nth=b.pseudos.eq,{radio:!0,checkbox:!0,file:!0,password:!0,image:!0})b.pseudos[e]=B(e);for(e in{submit:!0,reset:!0})b.pseudos[e]=_(e);function G(){}function Y(e,t){var n,r,i,o,a,s,u,l=c[e+" "];if(l)return t?0:l.slice(0);a=e,s=[],u=b.preFilter;while(a){for(o in n&&!(r=y.exec(a))||(r&&(a=a.slice(r[0].length)||a),s.push(i=[])),n=!1,(r=m.exec(a))&&(n=r.shift(),i.push({value:n,type:r[0].replace(ve," ")}),a=a.slice(n.length)),b.filter)!(r=D[o].exec(a))||u[o]&&!(r=u[o](r))||(n=r.shift(),i.push({value:n,type:o,matches:r}),a=a.slice(n.length));if(!n)break}return t?a.length:a?I.error(e):c(e,s).slice(0)}function Q(e){for(var t=0,n=e.length,r="";t<n;t++)r+=e[t].value;return r}function J(a,e,t){var s=e.dir,u=e.next,l=u||s,c=t&&"parentNode"===l,f=n++;return e.first?function(e,t,n){while(e=e[s])if(1===e.nodeType||c)return a(e,t,n);return!1}:function(e,t,n){var r,i,o=[E,f];if(n){while(e=e[s])if((1===e.nodeType||c)&&a(e,t,n))return!0}else while(e=e[s])if(1===e.nodeType||c)if(i=e[S]||(e[S]={}),u&&fe(e,u))e=e[s]||e;else{if((r=i[l])&&r[0]===E&&r[1]===f)return o[2]=r[2];if((i[l]=o)[2]=a(e,t,n))return!0}return!1}}function K(i){return 1<i.length?function(e,t,n){var r=i.length;while(r--)if(!i[r](e,t,n))return!1;return!0}:i[0]}function Z(e,t,n,r,i){for(var o,a=[],s=0,u=e.length,l=null!=t;s<u;s++)(o=e[s])&&(n&&!n(o,r,i)||(a.push(o),l&&t.push(s)));return a}function ee(d,h,g,v,y,e){return v&&!v[S]&&(v=ee(v)),y&&!y[S]&&(y=ee(y,e)),F(function(e,t,n,r){var i,o,a,s,u=[],l=[],c=t.length,f=e||function(e,t,n){for(var r=0,i=t.length;r<i;r++)I(e,t[r],n);return n}(h||"*",n.nodeType?[n]:n,[]),p=!d||!e&&h?f:Z(f,u,d,n,r);if(g?g(p,s=y||(e?d:c||v)?[]:t,n,r):s=p,v){i=Z(s,l),v(i,[],n,r),o=i.length;while(o--)(a=i[o])&&(s[l[o]]=!(p[l[o]]=a))}if(e){if(y||d){if(y){i=[],o=s.length;while(o--)(a=s[o])&&i.push(p[o]=a);y(null,s=[],i,r)}o=s.length;while(o--)(a=s[o])&&-1<(i=y?se.call(e,a):u[o])&&(e[i]=!(t[i]=a))}}else s=Z(s===t?s.splice(c,s.length):s),y?y(null,t,s,r):k.apply(t,s)})}function te(e){for(var i,t,n,r=e.length,o=b.relative[e[0].type],a=o||b.relative[" "],s=o?1:0,u=J(function(e){return e===i},a,!0),l=J(function(e){return-1<se.call(i,e)},a,!0),c=[function(e,t,n){var r=!o&&(n||t!=w)||((i=t).nodeType?u(e,t,n):l(e,t,n));return i=null,r}];s<r;s++)if(t=b.relative[e[s].type])c=[J(K(c),t)];else{if((t=b.filter[e[s].type].apply(null,e[s].matches))[S]){for(n=++s;n<r;n++)if(b.relative[e[n].type])break;return ee(1<s&&K(c),1<s&&Q(e.slice(0,s-1).concat({value:" "===e[s-2].type?"*":""})).replace(ve,"$1"),t,s<n&&te(e.slice(s,n)),n<r&&te(e=e.slice(n)),n<r&&Q(e))}c.push(t)}return K(c)}function ne(e,t){var n,v,y,m,x,r,i=[],o=[],a=u[e+" "];if(!a){t||(t=Y(e)),n=t.length;while(n--)(a=te(t[n]))[S]?i.push(a):o.push(a);(a=u(e,(v=o,m=0<(y=i).length,x=0<v.length,r=function(e,t,n,r,i){var o,a,s,u=0,l="0",c=e&&[],f=[],p=w,d=e||x&&b.find.TAG("*",i),h=E+=null==p?1:Math.random()||.1,g=d.length;for(i&&(w=t==T||t||i);l!==g&&null!=(o=d[l]);l++){if(x&&o){a=0,t||o.ownerDocument==T||(V(o),n=!C);while(s=v[a++])if(s(o,t||T,n)){k.call(r,o);break}i&&(E=h)}m&&((o=!s&&o)&&u--,e&&c.push(o))}if(u+=l,m&&l!==u){a=0;while(s=y[a++])s(c,f,t,n);if(e){if(0<u)while(l--)c[l]||f[l]||(f[l]=pe.call(r));f=Z(f)}k.apply(r,f),i&&!e&&0<f.length&&1<u+y.length&&ce.uniqueSort(r)}return i&&(E=h,w=p),c},m?F(r):r))).selector=e}return a}function re(e,t,n,r){var i,o,a,s,u,l="function"==typeof e&&e,c=!r&&Y(e=l.selector||e);if(n=n||[],1===c.length){if(2<(o=c[0]=c[0].slice(0)).length&&"ID"===(a=o[0]).type&&9===t.nodeType&&C&&b.relative[o[1].type]){if(!(t=(b.find.ID(a.matches[0].replace(O,P),t)||[])[0]))return n;l&&(t=t.parentNode),e=e.slice(o.shift().value.length)}i=D.needsContext.test(e)?0:o.length;while(i--){if(a=o[i],b.relative[s=a.type])break;if((u=b.find[s])&&(r=u(a.matches[0].replace(O,P),H.test(o[0].type)&&U(t.parentNode)||t))){if(o.splice(i,1),!(e=r.length&&Q(o)))return k.apply(n,r),n;break}}}return(l||ne(e,c))(r,t,!C,n,!t||H.test(e)&&U(t.parentNode)||t),n}G.prototype=b.filters=b.pseudos,b.setFilters=new G,le.sortStable=S.split("").sort(l).join("")===S,V(),le.sortDetached=$(function(e){return 1&e.compareDocumentPosition(T.createElement("fieldset"))}),ce.find=I,ce.expr[":"]=ce.expr.pseudos,ce.unique=ce.uniqueSort,I.compile=ne,I.select=re,I.setDocument=V,I.tokenize=Y,I.escape=ce.escapeSelector,I.getText=ce.text,I.isXML=ce.isXMLDoc,I.selectors=ce.expr,I.support=ce.support,I.uniqueSort=ce.uniqueSort}();var d=function(e,t,n){var r=[],i=void 0!==n;while((e=e[t])&&9!==e.nodeType)if(1===e.nodeType){if(i&&ce(e).is(n))break;r.push(e)}return r},h=function(e,t){for(var n=[];e;e=e.nextSibling)1===e.nodeType&&e!==t&&n.push(e);return n},b=ce.expr.match.needsContext,w=/^<([a-z][^\/\0>:\x20\t\r\n\f]*)[\x20\t\r\n\f]*\/?>(?:<\/\1>|)$/i;function T(e,n,r){return v(n)?ce.grep(e,function(e,t){return!!n.call(e,t,e)!==r}):n.nodeType?ce.grep(e,function(e){return e===n!==r}):"string"!=typeof n?ce.grep(e,function(e){return-1<se.call(n,e)!==r}):ce.filter(n,e,r)}ce.filter=function(e,t,n){var r=t[0];return n&&(e=":not("+e+")"),1===t.length&&1===r.nodeType?ce.find.matchesSelector(r,e)?[r]:[]:ce.find.matches(e,ce.grep(t,function(e){return 1===e.nodeType}))},ce.fn.extend({find:function(e){var t,n,r=this.length,i=this;if("string"!=typeof e)return this.pushStack(ce(e).filter(function(){for(t=0;t<r;t++)if(ce.contains(i[t],this))return!0}));for(n=this.pushStack([]),t=0;t<r;t++)ce.find(e,i[t],n);return 1<r?ce.uniqueSort(n):n},filter:function(e){return this.pushStack(T(this,e||[],!1))},not:function(e){return this.pushStack(T(this,e||[],!0))},is:function(e){return!!T(this,"string"==typeof e&&b.test(e)?ce(e):e||[],!1).length}});var k,S=/^(?:\s*(<[\w\W]+>)[^>]*|#([\w-]+))$/;(ce.fn.init=function(e,t,n){var r,i;if(!e)return this;if(n=n||k,"string"==typeof e){if(!(r="<"===e[0]&&">"===e[e.length-1]&&3<=e.length?[null,e,null]:S.exec(e))||!r[1]&&t)return!t||t.jquery?(t||n).find(e):this.constructor(t).find(e);if(r[1]){if(t=t instanceof ce?t[0]:t,ce.merge(this,ce.parseHTML(r[1],t&&t.nodeType?t.ownerDocument||t:C,!0)),w.test(r[1])&&ce.isPlainObject(t))for(r in t)v(this[r])?this[r](t[r]):this.attr(r,t[r]);return this}return(i=C.getElementById(r[2]))&&(this[0]=i,this.length=1),this}return e.nodeType?(this[0]=e,this.length=1,this):v(e)?void 0!==n.ready?n.ready(e):e(ce):ce.makeArray(e,this)}).prototype=ce.fn,k=ce(C);var E=/^(?:parents|prev(?:Until|All))/,j={children:!0,contents:!0,next:!0,prev:!0};function A(e,t){while((e=e[t])&&1!==e.nodeType);return e}ce.fn.extend({has:function(e){var t=ce(e,this),n=t.length;return this.filter(function(){for(var e=0;e<n;e++)if(ce.contains(this,t[e]))return!0})},closest:function(e,t){var n,r=0,i=this.length,o=[],a="string"!=typeof e&&ce(e);if(!b.test(e))for(;r<i;r++)for(n=this[r];n&&n!==t;n=n.parentNode)if(n.nodeType<11&&(a?-1<a.index(n):1===n.nodeType&&ce.find.matchesSelector(n,e))){o.push(n);break}return this.pushStack(1<o.length?ce.uniqueSort(o):o)},index:function(e){return e?"string"==typeof e?se.call(ce(e),this[0]):se.call(this,e.jquery?e[0]:e):this[0]&&this[0].parentNode?this.first().prevAll().length:-1},add:function(e,t){return this.pushStack(ce.uniqueSort(ce.merge(this.get(),ce(e,t))))},addBack:function(e){return this.add(null==e?this.prevObject:this.prevObject.filter(e))}}),ce.each({parent:function(e){var t=e.parentNode;return t&&11!==t.nodeType?t:null},parents:function(e){return d(e,"parentNode")},parentsUntil:function(e,t,n){return d(e,"parentNode",n)},next:function(e){return A(e,"nextSibling")},prev:function(e){return A(e,"previousSibling")},nextAll:function(e){return d(e,"nextSibling")},prevAll:function(e){return d(e,"previousSibling")},nextUntil:function(e,t,n){return d(e,"nextSibling",n)},prevUntil:function(e,t,n){return d(e,"previousSibling",n)},siblings:function(e){return h((e.parentNode||{}).firstChild,e)},children:function(e){return h(e.firstChild)},contents:function(e){return null!=e.contentDocument&&r(e.contentDocument)?e.contentDocument:(fe(e,"template")&&(e=e.content||e),ce.merge([],e.childNodes))}},function(r,i){ce.fn[r]=function(e,t){var n=ce.map(this,i,e);return"Until"!==r.slice(-5)&&(t=e),t&&"string"==typeof t&&(n=ce.filter(t,n)),1<this.length&&(j[r]||ce.uniqueSort(n),E.test(r)&&n.reverse()),this.pushStack(n)}});var D=/[^\x20\t\r\n\f]+/g;function N(e){return e}function q(e){throw e}function L(e,t,n,r){var i;try{e&&v(i=e.promise)?i.call(e).done(t).fail(n):e&&v(i=e.then)?i.call(e,t,n):t.apply(void 0,[e].slice(r))}catch(e){n.apply(void 0,[e])}}ce.Callbacks=function(r){var e,n;r="string"==typeof r?(e=r,n={},ce.each(e.match(D)||[],function(e,t){n[t]=!0}),n):ce.extend({},r);var i,t,o,a,s=[],u=[],l=-1,c=function(){for(a=a||r.once,o=i=!0;u.length;l=-1){t=u.shift();while(++l<s.length)!1===s[l].apply(t[0],t[1])&&r.stopOnFalse&&(l=s.length,t=!1)}r.memory||(t=!1),i=!1,a&&(s=t?[]:"")},f={add:function(){return s&&(t&&!i&&(l=s.length-1,u.push(t)),function n(e){ce.each(e,function(e,t){v(t)?r.unique&&f.has(t)||s.push(t):t&&t.length&&"string"!==x(t)&&n(t)})}(arguments),t&&!i&&c()),this},remove:function(){return ce.each(arguments,function(e,t){var n;while(-1<(n=ce.inArray(t,s,n)))s.splice(n,1),n<=l&&l--}),this},has:function(e){return e?-1<ce.inArray(e,s):0<s.length},empty:function(){return s&&(s=[]),this},disable:function(){return a=u=[],s=t="",this},disabled:function(){return!s},lock:function(){return a=u=[],t||i||(s=t=""),this},locked:function(){return!!a},fireWith:function(e,t){return a||(t=[e,(t=t||[]).slice?t.slice():t],u.push(t),i||c()),this},fire:function(){return f.fireWith(this,arguments),this},fired:function(){return!!o}};return f},ce.extend({Deferred:function(e){var o=[["notify","progress",ce.Callbacks("memory"),ce.Callbacks("memory"),2],["resolve","done",ce.Callbacks("once memory"),ce.Callbacks("once memory"),0,"resolved"],["reject","fail",ce.Callbacks("once memory"),ce.Callbacks("once memory"),1,"rejected"]],i="pending",a={state:function(){return i},always:function(){return s.done(arguments).fail(arguments),this},"catch":function(e){return a.then(null,e)},pipe:function(){var i=arguments;return ce.Deferred(function(r){ce.each(o,function(e,t){var n=v(i[t[4]])&&i[t[4]];s[t[1]](function(){var e=n&&n.apply(this,arguments);e&&v(e.promise)?e.promise().progress(r.notify).done(r.resolve).fail(r.reject):r[t[0]+"With"](this,n?[e]:arguments)})}),i=null}).promise()},then:function(t,n,r){var u=0;function l(i,o,a,s){return function(){var n=this,r=arguments,e=function(){var e,t;if(!(i<u)){if((e=a.apply(n,r))===o.promise())throw new TypeError("Thenable self-resolution");t=e&&("object"==typeof e||"function"==typeof e)&&e.then,v(t)?s?t.call(e,l(u,o,N,s),l(u,o,q,s)):(u++,t.call(e,l(u,o,N,s),l(u,o,q,s),l(u,o,N,o.notifyWith))):(a!==N&&(n=void 0,r=[e]),(s||o.resolveWith)(n,r))}},t=s?e:function(){try{e()}catch(e){ce.Deferred.exceptionHook&&ce.Deferred.exceptionHook(e,t.error),u<=i+1&&(a!==q&&(n=void 0,r=[e]),o.rejectWith(n,r))}};i?t():(ce.Deferred.getErrorHook?t.error=ce.Deferred.getErrorHook():ce.Deferred.getStackHook&&(t.error=ce.Deferred.getStackHook()),ie.setTimeout(t))}}return ce.Deferred(function(e){o[0][3].add(l(0,e,v(r)?r:N,e.notifyWith)),o[1][3].add(l(0,e,v(t)?t:N)),o[2][3].add(l(0,e,v(n)?n:q))}).promise()},promise:function(e){return null!=e?ce.extend(e,a):a}},s={};return ce.each(o,function(e,t){var n=t[2],r=t[5];a[t[1]]=n.add,r&&n.add(function(){i=r},o[3-e][2].disable,o[3-e][3].disable,o[0][2].lock,o[0][3].lock),n.add(t[3].fire),s[t[0]]=function(){return s[t[0]+"With"](this===s?void 0:this,arguments),this},s[t[0]+"With"]=n.fireWith}),a.promise(s),e&&e.call(s,s),s},when:function(e){var n=arguments.length,t=n,r=Array(t),i=ae.call(arguments),o=ce.Deferred(),a=function(t){return function(e){r[t]=this,i[t]=1<arguments.length?ae.call(arguments):e,--n||o.resolveWith(r,i)}};if(n<=1&&(L(e,o.done(a(t)).resolve,o.reject,!n),"pending"===o.state()||v(i[t]&&i[t].then)))return o.then();while(t--)L(i[t],a(t),o.reject);return o.promise()}});var H=/^(Eval|Internal|Range|Reference|Syntax|Type|URI)Error$/;ce.Deferred.exceptionHook=function(e,t){ie.console&&ie.console.warn&&e&&H.test(e.name)&&ie.console.warn("jQuery.Deferred exception: "+e.message,e.stack,t)},ce.readyException=function(e){ie.setTimeout(function(){throw e})};var O=ce.Deferred();function P(){C.removeEventListener("DOMContentLoaded",P),ie.removeEventListener("load",P),ce.ready()}ce.fn.ready=function(e){return O.then(e)["catch"](function(e){ce.readyException(e)}),this},ce.extend({isReady:!1,readyWait:1,ready:function(e){(!0===e?--ce.readyWait:ce.isReady)||(ce.isReady=!0)!==e&&0<--ce.readyWait||O.resolveWith(C,[ce])}}),ce.ready.then=O.then,"complete"===C.readyState||"loading"!==C.readyState&&!C.documentElement.doScroll?ie.setTimeout(ce.ready):(C.addEventListener("DOMContentLoaded",P),ie.addEventListener("load",P));var M=function(e,t,n,r,i,o,a){var s=0,u=e.length,l=null==n;if("object"===x(n))for(s in i=!0,n)M(e,t,s,n[s],!0,o,a);else if(void 0!==r&&(i=!0,v(r)||(a=!0),l&&(a?(t.call(e,r),t=null):(l=t,t=function(e,t,n){return l.call(ce(e),n)})),t))for(;s<u;s++)t(e[s],n,a?r:r.call(e[s],s,t(e[s],n)));return i?e:l?t.call(e):u?t(e[0],n):o},R=/^-ms-/,I=/-([a-z])/g;function W(e,t){return t.toUpperCase()}function F(e){return e.replace(R,"ms-").replace(I,W)}var $=function(e){return 1===e.nodeType||9===e.nodeType||!+e.nodeType};function B(){this.expando=ce.expando+B.uid++}B.uid=1,B.prototype={cache:function(e){var t=e[this.expando];return t||(t={},$(e)&&(e.nodeType?e[this.expando]=t:Object.defineProperty(e,this.expando,{value:t,configurable:!0}))),t},set:function(e,t,n){var r,i=this.cache(e);if("string"==typeof t)i[F(t)]=n;else for(r in t)i[F(r)]=t[r];return i},get:function(e,t){return void 0===t?this.cache(e):e[this.expando]&&e[this.expando][F(t)]},access:function(e,t,n){return void 0===t||t&&"string"==typeof t&&void 0===n?this.get(e,t):(this.set(e,t,n),void 0!==n?n:t)},remove:function(e,t){var n,r=e[this.expando];if(void 0!==r){if(void 0!==t){n=(t=Array.isArray(t)?t.map(F):(t=F(t))in r?[t]:t.match(D)||[]).length;while(n--)delete r[t[n]]}(void 0===t||ce.isEmptyObject(r))&&(e.nodeType?e[this.expando]=void 0:delete e[this.expando])}},hasData:function(e){var t=e[this.expando];return void 0!==t&&!ce.isEmptyObject(t)}};var _=new B,z=new B,X=/^(?:\{[\w\W]*\}|\[[\w\W]*\])$/,U=/[A-Z]/g;function V(e,t,n){var r,i;if(void 0===n&&1===e.nodeType)if(r="data-"+t.replace(U,"-$&").toLowerCase(),"string"==typeof(n=e.getAttribute(r))){try{n="true"===(i=n)||"false"!==i&&("null"===i?null:i===+i+""?+i:X.test(i)?JSON.parse(i):i)}catch(e){}z.set(e,t,n)}else n=void 0;return n}ce.extend({hasData:function(e){return z.hasData(e)||_.hasData(e)},data:function(e,t,n){return z.access(e,t,n)},removeData:function(e,t){z.remove(e,t)},_data:function(e,t,n){return _.access(e,t,n)},_removeData:function(e,t){_.remove(e,t)}}),ce.fn.extend({data:function(n,e){var t,r,i,o=this[0],a=o&&o.attributes;if(void 0===n){if(this.length&&(i=z.get(o),1===o.nodeType&&!_.get(o,"hasDataAttrs"))){t=a.length;while(t--)a[t]&&0===(r=a[t].name).indexOf("data-")&&(r=F(r.slice(5)),V(o,r,i[r]));_.set(o,"hasDataAttrs",!0)}return i}return"object"==typeof n?this.each(function(){z.set(this,n)}):M(this,function(e){var t;if(o&&void 0===e)return void 0!==(t=z.get(o,n))?t:void 0!==(t=V(o,n))?t:void 0;this.each(function(){z.set(this,n,e)})},null,e,1<arguments.length,null,!0)},removeData:function(e){return this.each(function(){z.remove(this,e)})}}),ce.extend({queue:function(e,t,n){var r;if(e)return t=(t||"fx")+"queue",r=_.get(e,t),n&&(!r||Array.isArray(n)?r=_.access(e,t,ce.makeArray(n)):r.push(n)),r||[]},dequeue:function(e,t){t=t||"fx";var n=ce.queue(e,t),r=n.length,i=n.shift(),o=ce._queueHooks(e,t);"inprogress"===i&&(i=n.shift(),r--),i&&("fx"===t&&n.unshift("inprogress"),delete o.stop,i.call(e,function(){ce.dequeue(e,t)},o)),!r&&o&&o.empty.fire()},_queueHooks:function(e,t){var n=t+"queueHooks";return _.get(e,n)||_.access(e,n,{empty:ce.Callbacks("once memory").add(function(){_.remove(e,[t+"queue",n])})})}}),ce.fn.extend({queue:function(t,n){var e=2;return"string"!=typeof t&&(n=t,t="fx",e--),arguments.length<e?ce.queue(this[0],t):void 0===n?this:this.each(function(){var e=ce.queue(this,t,n);ce._queueHooks(this,t),"fx"===t&&"inprogress"!==e[0]&&ce.dequeue(this,t)})},dequeue:function(e){return this.each(function(){ce.dequeue(this,e)})},clearQueue:function(e){return this.queue(e||"fx",[])},promise:function(e,t){var n,r=1,i=ce.Deferred(),o=this,a=this.length,s=function(){--r||i.resolveWith(o,[o])};"string"!=typeof e&&(t=e,e=void 0),e=e||"fx";while(a--)(n=_.get(o[a],e+"queueHooks"))&&n.empty&&(r++,n.empty.add(s));return s(),i.promise(t)}});var G=/[+-]?(?:\d*\.|)\d+(?:[eE][+-]?\d+|)/.source,Y=new RegExp("^(?:([+-])=|)("+G+")([a-z%]*)$","i"),Q=["Top","Right","Bottom","Left"],J=C.documentElement,K=function(e){return ce.contains(e.ownerDocument,e)},Z={composed:!0};J.getRootNode&&(K=function(e){return ce.contains(e.ownerDocument,e)||e.getRootNode(Z)===e.ownerDocument});var ee=function(e,t){return"none"===(e=t||e).style.display||""===e.style.display&&K(e)&&"none"===ce.css(e,"display")};function te(e,t,n,r){var i,o,a=20,s=r?function(){return r.cur()}:function(){return ce.css(e,t,"")},u=s(),l=n&&n[3]||(ce.cssNumber[t]?"":"px"),c=e.nodeType&&(ce.cssNumber[t]||"px"!==l&&+u)&&Y.exec(ce.css(e,t));if(c&&c[3]!==l){u/=2,l=l||c[3],c=+u||1;while(a--)ce.style(e,t,c+l),(1-o)*(1-(o=s()/u||.5))<=0&&(a=0),c/=o;c*=2,ce.style(e,t,c+l),n=n||[]}return n&&(c=+c||+u||0,i=n[1]?c+(n[1]+1)*n[2]:+n[2],r&&(r.unit=l,r.start=c,r.end=i)),i}var ne={};function re(e,t){for(var n,r,i,o,a,s,u,l=[],c=0,f=e.length;c<f;c++)(r=e[c]).style&&(n=r.style.display,t?("none"===n&&(l[c]=_.get(r,"display")||null,l[c]||(r.style.display="")),""===r.style.display&&ee(r)&&(l[c]=(u=a=o=void 0,a=(i=r).ownerDocument,s=i.nodeName,(u=ne[s])||(o=a.body.appendChild(a.createElement(s)),u=ce.css(o,"display"),o.parentNode.removeChild(o),"none"===u&&(u="block"),ne[s]=u)))):"none"!==n&&(l[c]="none",_.set(r,"display",n)));for(c=0;c<f;c++)null!=l[c]&&(e[c].style.display=l[c]);return e}ce.fn.extend({show:function(){return re(this,!0)},hide:function(){return re(this)},toggle:function(e){return"boolean"==typeof e?e?this.show():this.hide():this.each(function(){ee(this)?ce(this).show():ce(this).hide()})}});var xe,be,we=/^(?:checkbox|radio)$/i,Te=/<([a-z][^\/\0>\x20\t\r\n\f]*)/i,Ce=/^$|^module$|\/(?:java|ecma)script/i;xe=C.createDocumentFragment().appendChild(C.createElement("div")),(be=C.createElement("input")).setAttribute("type","radio"),be.setAttribute("checked","checked"),be.setAttribute("name","t"),xe.appendChild(be),le.checkClone=xe.cloneNode(!0).cloneNode(!0).lastChild.checked,xe.innerHTML="<textarea>x</textarea>",le.noCloneChecked=!!xe.cloneNode(!0).lastChild.defaultValue,xe.innerHTML="<option></option>",le.option=!!xe.lastChild;var ke={thead:[1,"<table>","</table>"],col:[2,"<table><colgroup>","</colgroup></table>"],tr:[2,"<table><tbody>","</tbody></table>"],td:[3,"<table><tbody><tr>","</tr></tbody></table>"],_default:[0,"",""]};function Se(e,t){var n;return n="undefined"!=typeof e.getElementsByTagName?e.getElementsByTagName(t||"*"):"undefined"!=typeof e.querySelectorAll?e.querySelectorAll(t||"*"):[],void 0===t||t&&fe(e,t)?ce.merge([e],n):n}function Ee(e,t){for(var n=0,r=e.length;n<r;n++)_.set(e[n],"globalEval",!t||_.get(t[n],"globalEval"))}ke.tbody=ke.tfoot=ke.colgroup=ke.caption=ke.thead,ke.th=ke.td,le.option||(ke.optgroup=ke.option=[1,"<select multiple='multiple'>","</select>"]);var je=/<|&#?\w+;/;function Ae(e,t,n,r,i){for(var o,a,s,u,l,c,f=t.createDocumentFragment(),p=[],d=0,h=e.length;d<h;d++)if((o=e[d])||0===o)if("object"===x(o))ce.merge(p,o.nodeType?[o]:o);else if(je.test(o)){a=a||f.appendChild(t.createElement("div")),s=(Te.exec(o)||["",""])[1].toLowerCase(),u=ke[s]||ke._default,a.innerHTML=u[1]+ce.htmlPrefilter(o)+u[2],c=u[0];while(c--)a=a.lastChild;ce.merge(p,a.childNodes),(a=f.firstChild).textContent=""}else p.push(t.createTextNode(o));f.textContent="",d=0;while(o=p[d++])if(r&&-1<ce.inArray(o,r))i&&i.push(o);else if(l=K(o),a=Se(f.appendChild(o),"script"),l&&Ee(a),n){c=0;while(o=a[c++])Ce.test(o.type||"")&&n.push(o)}return f}var De=/^([^.]*)(?:\.(.+)|)/;function Ne(){return!0}function qe(){return!1}function Le(e,t,n,r,i,o){var a,s;if("object"==typeof t){for(s in"string"!=typeof n&&(r=r||n,n=void 0),t)Le(e,s,n,r,t[s],o);return e}if(null==r&&null==i?(i=n,r=n=void 0):null==i&&("string"==typeof n?(i=r,r=void 0):(i=r,r=n,n=void 0)),!1===i)i=qe;else if(!i)return e;return 1===o&&(a=i,(i=function(e){return ce().off(e),a.apply(this,arguments)}).guid=a.guid||(a.guid=ce.guid++)),e.each(function(){ce.event.add(this,t,i,r,n)})}function He(e,r,t){t?(_.set(e,r,!1),ce.event.add(e,r,{namespace:!1,handler:function(e){var t,n=_.get(this,r);if(1&e.isTrigger&&this[r]){if(n)(ce.event.special[r]||{}).delegateType&&e.stopPropagation();else if(n=ae.call(arguments),_.set(this,r,n),this[r](),t=_.get(this,r),_.set(this,r,!1),n!==t)return e.stopImmediatePropagation(),e.preventDefault(),t}else n&&(_.set(this,r,ce.event.trigger(n[0],n.slice(1),this)),e.stopPropagation(),e.isImmediatePropagationStopped=Ne)}})):void 0===_.get(e,r)&&ce.event.add(e,r,Ne)}ce.event={global:{},add:function(t,e,n,r,i){var o,a,s,u,l,c,f,p,d,h,g,v=_.get(t);if($(t)){n.handler&&(n=(o=n).handler,i=o.selector),i&&ce.find.matchesSelector(J,i),n.guid||(n.guid=ce.guid++),(u=v.events)||(u=v.events=Object.create(null)),(a=v.handle)||(a=v.handle=function(e){return"undefined"!=typeof ce&&ce.event.triggered!==e.type?ce.event.dispatch.apply(t,arguments):void 0}),l=(e=(e||"").match(D)||[""]).length;while(l--)d=g=(s=De.exec(e[l])||[])[1],h=(s[2]||"").split(".").sort(),d&&(f=ce.event.special[d]||{},d=(i?f.delegateType:f.bindType)||d,f=ce.event.special[d]||{},c=ce.extend({type:d,origType:g,data:r,handler:n,guid:n.guid,selector:i,needsContext:i&&ce.expr.match.needsContext.test(i),namespace:h.join(".")},o),(p=u[d])||((p=u[d]=[]).delegateCount=0,f.setup&&!1!==f.setup.call(t,r,h,a)||t.addEventListener&&t.addEventListener(d,a)),f.add&&(f.add.call(t,c),c.handler.guid||(c.handler.guid=n.guid)),i?p.splice(p.delegateCount++,0,c):p.push(c),ce.event.global[d]=!0)}},remove:function(e,t,n,r,i){var o,a,s,u,l,c,f,p,d,h,g,v=_.hasData(e)&&_.get(e);if(v&&(u=v.events)){l=(t=(t||"").match(D)||[""]).length;while(l--)if(d=g=(s=De.exec(t[l])||[])[1],h=(s[2]||"").split(".").sort(),d){f=ce.event.special[d]||{},p=u[d=(r?f.delegateType:f.bindType)||d]||[],s=s[2]&&new RegExp("(^|\\.)"+h.join("\\.(?:.*\\.|)")+"(\\.|$)"),a=o=p.length;while(o--)c=p[o],!i&&g!==c.origType||n&&n.guid!==c.guid||s&&!s.test(c.namespace)||r&&r!==c.selector&&("**"!==r||!c.selector)||(p.splice(o,1),c.selector&&p.delegateCount--,f.remove&&f.remove.call(e,c));a&&!p.length&&(f.teardown&&!1!==f.teardown.call(e,h,v.handle)||ce.removeEvent(e,d,v.handle),delete u[d])}else for(d in u)ce.event.remove(e,d+t[l],n,r,!0);ce.isEmptyObject(u)&&_.remove(e,"handle events")}},dispatch:function(e){var t,n,r,i,o,a,s=new Array(arguments.length),u=ce.event.fix(e),l=(_.get(this,"events")||Object.create(null))[u.type]||[],c=ce.event.special[u.type]||{};for(s[0]=u,t=1;t<arguments.length;t++)s[t]=arguments[t];if(u.delegateTarget=this,!c.preDispatch||!1!==c.preDispatch.call(this,u)){a=ce.event.handlers.call(this,u,l),t=0;while((i=a[t++])&&!u.isPropagationStopped()){u.currentTarget=i.elem,n=0;while((o=i.handlers[n++])&&!u.isImmediatePropagationStopped())u.rnamespace&&!1!==o.namespace&&!u.rnamespace.test(o.namespace)||(u.handleObj=o,u.data=o.data,void 0!==(r=((ce.event.special[o.origType]||{}).handle||o.handler).apply(i.elem,s))&&!1===(u.result=r)&&(u.preventDefault(),u.stopPropagation()))}return c.postDispatch&&c.postDispatch.call(this,u),u.result}},handlers:function(e,t){var n,r,i,o,a,s=[],u=t.delegateCount,l=e.target;if(u&&l.nodeType&&!("click"===e.type&&1<=e.button))for(;l!==this;l=l.parentNode||this)if(1===l.nodeType&&("click"!==e.type||!0!==l.disabled)){for(o=[],a={},n=0;n<u;n++)void 0===a[i=(r=t[n]).selector+" "]&&(a[i]=r.needsContext?-1<ce(i,this).index(l):ce.find(i,this,null,[l]).length),a[i]&&o.push(r);o.length&&s.push({elem:l,handlers:o})}return l=this,u<t.length&&s.push({elem:l,handlers:t.slice(u)}),s},addProp:function(t,e){Object.defineProperty(ce.Event.prototype,t,{enumerable:!0,configurable:!0,get:v(e)?function(){if(this.originalEvent)return e(this.originalEvent)}:function(){if(this.originalEvent)return this.originalEvent[t]},set:function(e){Object.defineProperty(this,t,{enumerable:!0,configurable:!0,writable:!0,value:e})}})},fix:function(e){return e[ce.expando]?e:new ce.Event(e)},special:{load:{noBubble:!0},click:{setup:function(e){var t=this||e;return we.test(t.type)&&t.click&&fe(t,"input")&&He(t,"click",!0),!1},trigger:function(e){var t=this||e;return we.test(t.type)&&t.click&&fe(t,"input")&&He(t,"click"),!0},_default:function(e){var t=e.target;return we.test(t.type)&&t.click&&fe(t,"input")&&_.get(t,"click")||fe(t,"a")}},beforeunload:{postDispatch:function(e){void 0!==e.result&&e.originalEvent&&(e.originalEvent.returnValue=e.result)}}}},ce.removeEvent=function(e,t,n){e.removeEventListener&&e.removeEventListener(t,n)},ce.Event=function(e,t){if(!(this instanceof ce.Event))return new ce.Event(e,t);e&&e.type?(this.originalEvent=e,this.type=e.type,this.isDefaultPrevented=e.defaultPrevented||void 0===e.defaultPrevented&&!1===e.returnValue?Ne:qe,this.target=e.target&&3===e.target.nodeType?e.target.parentNode:e.target,this.currentTarget=e.currentTarget,this.relatedTarget=e.relatedTarget):this.type=e,t&&ce.extend(this,t),this.timeStamp=e&&e.timeStamp||Date.now(),this[ce.expando]=!0},ce.Event.prototype={constructor:ce.Event,isDefaultPrevented:qe,isPropagationStopped:qe,isImmediatePropagationStopped:qe,isSimulated:!1,preventDefault:function(){var e=this.originalEvent;this.isDefaultPrevented=Ne,e&&!this.isSimulated&&e.preventDefault()},stopPropagation:function(){var e=this.originalEvent;this.isPropagationStopped=Ne,e&&!this.isSimulated&&e.stopPropagation()},stopImmediatePropagation:function(){var e=this.originalEvent;this.isImmediatePropagationStopped=Ne,e&&!this.isSimulated&&e.stopImmediatePropagation(),this.stopPropagation()}},ce.each({altKey:!0,bubbles:!0,cancelable:!0,changedTouches:!0,ctrlKey:!0,detail:!0,eventPhase:!0,metaKey:!0,pageX:!0,pageY:!0,shiftKey:!0,view:!0,"char":!0,code:!0,charCode:!0,key:!0,keyCode:!0,button:!0,buttons:!0,clientX:!0,clientY:!0,offsetX:!0,offsetY:!0,pointerId:!0,pointerType:!0,screenX:!0,screenY:!0,targetTouches:!0,toElement:!0,touches:!0,which:!0},ce.event.addProp),ce.each({focus:"focusin",blur:"focusout"},function(r,i){function o(e){if(C.documentMode){var t=_.get(this,"handle"),n=ce.event.fix(e);n.type="focusin"===e.type?"focus":"blur",n.isSimulated=!0,t(e),n.target===n.currentTarget&&t(n)}else ce.event.simulate(i,e.target,ce.event.fix(e))}ce.event.special[r]={setup:function(){var e;if(He(this,r,!0),!C.documentMode)return!1;(e=_.get(this,i))||this.addEventListener(i,o),_.set(this,i,(e||0)+1)},trigger:function(){return He(this,r),!0},teardown:function(){var e;if(!C.documentMode)return!1;(e=_.get(this,i)-1)?_.set(this,i,e):(this.removeEventListener(i,o),_.remove(this,i))},_default:function(e){return _.get(e.target,r)},delegateType:i},ce.event.special[i]={setup:function(){var e=this.ownerDocument||this.document||this,t=C.documentMode?this:e,n=_.get(t,i);n||(C.documentMode?this.addEventListener(i,o):e.addEventListener(r,o,!0)),_.set(t,i,(n||0)+1)},teardown:function(){var e=this.ownerDocument||this.document||this,t=C.documentMode?this:e,n=_.get(t,i)-1;n?_.set(t,i,n):(C.documentMode?this.removeEventListener(i,o):e.removeEventListener(r,o,!0),_.remove(t,i))}}}),ce.each({mouseenter:"mouseover",mouseleave:"mouseout",pointerenter:"pointerover",pointerleave:"pointerout"},function(e,i){ce.event.special[e]={delegateType:i,bindType:i,handle:function(e){var t,n=e.relatedTarget,r=e.handleObj;return n&&(n===this||ce.contains(this,n))||(e.type=r.origType,t=r.handler.apply(this,arguments),e.type=i),t}}}),ce.fn.extend({on:function(e,t,n,r){return Le(this,e,t,n,r)},one:function(e,t,n,r){return Le(this,e,t,n,r,1)},off:function(e,t,n){var r,i;if(e&&e.preventDefault&&e.handleObj)return r=e.handleObj,ce(e.delegateTarget).off(r.namespace?r.origType+"."+r.namespace:r.origType,r.selector,r.handler),this;if("object"==typeof e){for(i in e)this.off(i,t,e[i]);return this}return!1!==t&&"function"!=typeof t||(n=t,t=void 0),!1===n&&(n=qe),this.each(function(){ce.event.remove(this,e,n,t)})}});var Oe=/<script|<style|<link/i,Pe=/checked\s*(?:[^=]|=\s*.checked.)/i,Me=/^\s*<!\[CDATA\[|\]\]>\s*$/g;function Re(e,t){return fe(e,"table")&&fe(11!==t.nodeType?t:t.firstChild,"tr")&&ce(e).children("tbody")[0]||e}function Ie(e){return e.type=(null!==e.getAttribute("type"))+"/"+e.type,e}function We(e){return"true/"===(e.type||"").slice(0,5)?e.type=e.type.slice(5):e.removeAttribute("type"),e}function Fe(e,t){var n,r,i,o,a,s;if(1===t.nodeType){if(_.hasData(e)&&(s=_.get(e).events))for(i in _.remove(t,"handle events"),s)for(n=0,r=s[i].length;n<r;n++)ce.event.add(t,i,s[i][n]);z.hasData(e)&&(o=z.access(e),a=ce.extend({},o),z.set(t,a))}}function $e(n,r,i,o){r=g(r);var e,t,a,s,u,l,c=0,f=n.length,p=f-1,d=r[0],h=v(d);if(h||1<f&&"string"==typeof d&&!le.checkClone&&Pe.test(d))return n.each(function(e){var t=n.eq(e);h&&(r[0]=d.call(this,e,t.html())),$e(t,r,i,o)});if(f&&(t=(e=Ae(r,n[0].ownerDocument,!1,n,o)).firstChild,1===e.childNodes.length&&(e=t),t||o)){for(s=(a=ce.map(Se(e,"script"),Ie)).length;c<f;c++)u=e,c!==p&&(u=ce.clone(u,!0,!0),s&&ce.merge(a,Se(u,"script"))),i.call(n[c],u,c);if(s)for(l=a[a.length-1].ownerDocument,ce.map(a,We),c=0;c<s;c++)u=a[c],Ce.test(u.type||"")&&!_.access(u,"globalEval")&&ce.contains(l,u)&&(u.src&&"module"!==(u.type||"").toLowerCase()?ce._evalUrl&&!u.noModule&&ce._evalUrl(u.src,{nonce:u.nonce||u.getAttribute("nonce")},l):m(u.textContent.replace(Me,""),u,l))}return n}function Be(e,t,n){for(var r,i=t?ce.filter(t,e):e,o=0;null!=(r=i[o]);o++)n||1!==r.nodeType||ce.cleanData(Se(r)),r.parentNode&&(n&&K(r)&&Ee(Se(r,"script")),r.parentNode.removeChild(r));return e}ce.extend({htmlPrefilter:function(e){return e},clone:function(e,t,n){var r,i,o,a,s,u,l,c=e.cloneNode(!0),f=K(e);if(!(le.noCloneChecked||1!==e.nodeType&&11!==e.nodeType||ce.isXMLDoc(e)))for(a=Se(c),r=0,i=(o=Se(e)).length;r<i;r++)s=o[r],u=a[r],void 0,"input"===(l=u.nodeName.toLowerCase())&&we.test(s.type)?u.checked=s.checked:"input"!==l&&"textarea"!==l||(u.defaultValue=s.defaultValue);if(t)if(n)for(o=o||Se(e),a=a||Se(c),r=0,i=o.length;r<i;r++)Fe(o[r],a[r]);else Fe(e,c);return 0<(a=Se(c,"script")).length&&Ee(a,!f&&Se(e,"script")),c},cleanData:function(e){for(var t,n,r,i=ce.event.special,o=0;void 0!==(n=e[o]);o++)if($(n)){if(t=n[_.expando]){if(t.events)for(r in t.events)i[r]?ce.event.remove(n,r):ce.removeEvent(n,r,t.handle);n[_.expando]=void 0}n[z.expando]&&(n[z.expando]=void 0)}}}),ce.fn.extend({detach:function(e){return Be(this,e,!0)},remove:function(e){return Be(this,e)},text:function(e){return M(this,function(e){return void 0===e?ce.text(this):this.empty().each(function(){1!==this.nodeType&&11!==this.nodeType&&9!==this.nodeType||(this.textContent=e)})},null,e,arguments.length)},append:function(){return $e(this,arguments,function(e){1!==this.nodeType&&11!==this.nodeType&&9!==this.nodeType||Re(this,e).appendChild(e)})},prepend:function(){return $e(this,arguments,function(e){if(1===this.nodeType||11===this.nodeType||9===this.nodeType){var t=Re(this,e);t.insertBefore(e,t.firstChild)}})},before:function(){return $e(this,arguments,function(e){this.parentNode&&this.parentNode.insertBefore(e,this)})},after:function(){return $e(this,arguments,function(e){this.parentNode&&this.parentNode.insertBefore(e,this.nextSibling)})},empty:function(){for(var e,t=0;null!=(e=this[t]);t++)1===e.nodeType&&(ce.cleanData(Se(e,!1)),e.textContent="");return this},clone:function(e,t){return e=null!=e&&e,t=null==t?e:t,this.map(function(){return ce.clone(this,e,t)})},html:function(e){return M(this,function(e){var t=this[0]||{},n=0,r=this.length;if(void 0===e&&1===t.nodeType)return t.innerHTML;if("string"==typeof e&&!Oe.test(e)&&!ke[(Te.exec(e)||["",""])[1].toLowerCase()]){e=ce.htmlPrefilter(e);try{for(;n<r;n++)1===(t=this[n]||{}).nodeType&&(ce.cleanData(Se(t,!1)),t.innerHTML=e);t=0}catch(e){}}t&&this.empty().append(e)},null,e,arguments.length)},replaceWith:function(){var n=[];return $e(this,arguments,function(e){var t=this.parentNode;ce.inArray(this,n)<0&&(ce.cleanData(Se(this)),t&&t.replaceChild(e,this))},n)}}),ce.each({appendTo:"append",prependTo:"prepend",insertBefore:"before",insertAfter:"after",replaceAll:"replaceWith"},function(e,a){ce.fn[e]=function(e){for(var t,n=[],r=ce(e),i=r.length-1,o=0;o<=i;o++)t=o===i?this:this.clone(!0),ce(r[o])[a](t),s.apply(n,t.get());return this.pushStack(n)}});var _e=new RegExp("^("+G+")(?!px)[a-z%]+$","i"),ze=/^--/,Xe=function(e){var t=e.ownerDocument.defaultView;return t&&t.opener||(t=ie),t.getComputedStyle(e)},Ue=function(e,t,n){var r,i,o={};for(i in t)o[i]=e.style[i],e.style[i]=t[i];for(i in r=n.call(e),t)e.style[i]=o[i];return r},Ve=new RegExp(Q.join("|"),"i");function Ge(e,t,n){var r,i,o,a,s=ze.test(t),u=e.style;return(n=n||Xe(e))&&(a=n.getPropertyValue(t)||n[t],s&&a&&(a=a.replace(ve,"$1")||void 0),""!==a||K(e)||(a=ce.style(e,t)),!le.pixelBoxStyles()&&_e.test(a)&&Ve.test(t)&&(r=u.width,i=u.minWidth,o=u.maxWidth,u.minWidth=u.maxWidth=u.width=a,a=n.width,u.width=r,u.minWidth=i,u.maxWidth=o)),void 0!==a?a+"":a}function Ye(e,t){return{get:function(){if(!e())return(this.get=t).apply(this,arguments);delete this.get}}}!function(){function e(){if(l){u.style.cssText="position:absolute;left:-11111px;width:60px;margin-top:1px;padding:0;border:0",l.style.cssText="position:relative;display:block;box-sizing:border-box;overflow:scroll;margin:auto;border:1px;padding:1px;width:60%;top:1%",J.appendChild(u).appendChild(l);var e=ie.getComputedStyle(l);n="1%"!==e.top,s=12===t(e.marginLeft),l.style.right="60%",o=36===t(e.right),r=36===t(e.width),l.style.position="absolute",i=12===t(l.offsetWidth/3),J.removeChild(u),l=null}}function t(e){return Math.round(parseFloat(e))}var n,r,i,o,a,s,u=C.createElement("div"),l=C.createElement("div");l.style&&(l.style.backgroundClip="content-box",l.cloneNode(!0).style.backgroundClip="",le.clearCloneStyle="content-box"===l.style.backgroundClip,ce.extend(le,{boxSizingReliable:function(){return e(),r},pixelBoxStyles:function(){return e(),o},pixelPosition:function(){return e(),n},reliableMarginLeft:function(){return e(),s},scrollboxSize:function(){return e(),i},reliableTrDimensions:function(){var e,t,n,r;return null==a&&(e=C.createElement("table"),t=C.createElement("tr"),n=C.createElement("div"),e.style.cssText="position:absolute;left:-11111px;border-collapse:separate",t.style.cssText="box-sizing:content-box;border:1px solid",t.style.height="1px",n.style.height="9px",n.style.display="block",J.appendChild(e).appendChild(t).appendChild(n),r=ie.getComputedStyle(t),a=parseInt(r.height,10)+parseInt(r.borderTopWidth,10)+parseInt(r.borderBottomWidth,10)===t.offsetHeight,J.removeChild(e)),a}}))}();var Qe=["Webkit","Moz","ms"],Je=C.createElement("div").style,Ke={};function Ze(e){var t=ce.cssProps[e]||Ke[e];return t||(e in Je?e:Ke[e]=function(e){var t=e[0].toUpperCase()+e.slice(1),n=Qe.length;while(n--)if((e=Qe[n]+t)in Je)return e}(e)||e)}var et=/^(none|table(?!-c[ea]).+)/,tt={position:"absolute",visibility:"hidden",display:"block"},nt={letterSpacing:"0",fontWeight:"400"};function rt(e,t,n){var r=Y.exec(t);return r?Math.max(0,r[2]-(n||0))+(r[3]||"px"):t}function it(e,t,n,r,i,o){var a="width"===t?1:0,s=0,u=0,l=0;if(n===(r?"border":"content"))return 0;for(;a<4;a+=2)"margin"===n&&(l+=ce.css(e,n+Q[a],!0,i)),r?("content"===n&&(u-=ce.css(e,"padding"+Q[a],!0,i)),"margin"!==n&&(u-=ce.css(e,"border"+Q[a]+"Width",!0,i))):(u+=ce.css(e,"padding"+Q[a],!0,i),"padding"!==n?u+=ce.css(e,"border"+Q[a]+"Width",!0,i):s+=ce.css(e,"border"+Q[a]+"Width",!0,i));return!r&&0<=o&&(u+=Math.max(0,Math.ceil(e["offset"+t[0].toUpperCase()+t.slice(1)]-o-u-s-.5))||0),u+l}function ot(e,t,n){var r=Xe(e),i=(!le.boxSizingReliable()||n)&&"border-box"===ce.css(e,"boxSizing",!1,r),o=i,a=Ge(e,t,r),s="offset"+t[0].toUpperCase()+t.slice(1);if(_e.test(a)){if(!n)return a;a="auto"}return(!le.boxSizingReliable()&&i||!le.reliableTrDimensions()&&fe(e,"tr")||"auto"===a||!parseFloat(a)&&"inline"===ce.css(e,"display",!1,r))&&e.getClientRects().length&&(i="border-box"===ce.css(e,"boxSizing",!1,r),(o=s in e)&&(a=e[s])),(a=parseFloat(a)||0)+it(e,t,n||(i?"border":"content"),o,r,a)+"px"}function at(e,t,n,r,i){return new at.prototype.init(e,t,n,r,i)}ce.extend({cssHooks:{opacity:{get:function(e,t){if(t){var n=Ge(e,"opacity");return""===n?"1":n}}}},cssNumber:{animationIterationCount:!0,aspectRatio:!0,borderImageSlice:!0,columnCount:!0,flexGrow:!0,flexShrink:!0,fontWeight:!0,gridArea:!0,gridColumn:!0,gridColumnEnd:!0,gridColumnStart:!0,gridRow:!0,gridRowEnd:!0,gridRowStart:!0,lineHeight:!0,opacity:!0,order:!0,orphans:!0,scale:!0,widows:!0,zIndex:!0,zoom:!0,fillOpacity:!0,floodOpacity:!0,stopOpacity:!0,strokeMiterlimit:!0,strokeOpacity:!0},cssProps:{},style:function(e,t,n,r){if(e&&3!==e.nodeType&&8!==e.nodeType&&e.style){var i,o,a,s=F(t),u=ze.test(t),l=e.style;if(u||(t=Ze(s)),a=ce.cssHooks[t]||ce.cssHooks[s],void 0===n)return a&&"get"in a&&void 0!==(i=a.get(e,!1,r))?i:l[t];"string"===(o=typeof n)&&(i=Y.exec(n))&&i[1]&&(n=te(e,t,i),o="number"),null!=n&&n==n&&("number"!==o||u||(n+=i&&i[3]||(ce.cssNumber[s]?"":"px")),le.clearCloneStyle||""!==n||0!==t.indexOf("background")||(l[t]="inherit"),a&&"set"in a&&void 0===(n=a.set(e,n,r))||(u?l.setProperty(t,n):l[t]=n))}},css:function(e,t,n,r){var i,o,a,s=F(t);return ze.test(t)||(t=Ze(s)),(a=ce.cssHooks[t]||ce.cssHooks[s])&&"get"in a&&(i=a.get(e,!0,n)),void 0===i&&(i=Ge(e,t,r)),"normal"===i&&t in nt&&(i=nt[t]),""===n||n?(o=parseFloat(i),!0===n||isFinite(o)?o||0:i):i}}),ce.each(["height","width"],function(e,u){ce.cssHooks[u]={get:function(e,t,n){if(t)return!et.test(ce.css(e,"display"))||e.getClientRects().length&&e.getBoundingClientRect().width?ot(e,u,n):Ue(e,tt,function(){return ot(e,u,n)})},set:function(e,t,n){var r,i=Xe(e),o=!le.scrollboxSize()&&"absolute"===i.position,a=(o||n)&&"border-box"===ce.css(e,"boxSizing",!1,i),s=n?it(e,u,n,a,i):0;return a&&o&&(s-=Math.ceil(e["offset"+u[0].toUpperCase()+u.slice(1)]-parseFloat(i[u])-it(e,u,"border",!1,i)-.5)),s&&(r=Y.exec(t))&&"px"!==(r[3]||"px")&&(e.style[u]=t,t=ce.css(e,u)),rt(0,t,s)}}}),ce.cssHooks.marginLeft=Ye(le.reliableMarginLeft,function(e,t){if(t)return(parseFloat(Ge(e,"marginLeft"))||e.getBoundingClientRect().left-Ue(e,{marginLeft:0},function(){return e.getBoundingClientRect().left}))+"px"}),ce.each({margin:"",padding:"",border:"Width"},function(i,o){ce.cssHooks[i+o]={expand:function(e){for(var t=0,n={},r="string"==typeof e?e.split(" "):[e];t<4;t++)n[i+Q[t]+o]=r[t]||r[t-2]||r[0];return n}},"margin"!==i&&(ce.cssHooks[i+o].set=rt)}),ce.fn.extend({css:function(e,t){return M(this,function(e,t,n){var r,i,o={},a=0;if(Array.isArray(t)){for(r=Xe(e),i=t.length;a<i;a++)o[t[a]]=ce.css(e,t[a],!1,r);return o}return void 0!==n?ce.style(e,t,n):ce.css(e,t)},e,t,1<arguments.length)}}),((ce.Tween=at).prototype={constructor:at,init:function(e,t,n,r,i,o){this.elem=e,this.prop=n,this.easing=i||ce.easing._default,this.options=t,this.start=this.now=this.cur(),this.end=r,this.unit=o||(ce.cssNumber[n]?"":"px")},cur:function(){var e=at.propHooks[this.prop];return e&&e.get?e.get(this):at.propHooks._default.get(this)},run:function(e){var t,n=at.propHooks[this.prop];return this.options.duration?this.pos=t=ce.easing[this.easing](e,this.options.duration*e,0,1,this.options.duration):this.pos=t=e,this.now=(this.end-this.start)*t+this.start,this.options.step&&this.options.step.call(this.elem,this.now,this),n&&n.set?n.set(this):at.propHooks._default.set(this),this}}).init.prototype=at.prototype,(at.propHooks={_default:{get:function(e){var t;return 1!==e.elem.nodeType||null!=e.elem[e.prop]&&null==e.elem.style[e.prop]?e.elem[e.prop]:(t=ce.css(e.elem,e.prop,""))&&"auto"!==t?t:0},set:function(e){ce.fx.step[e.prop]?ce.fx.step[e.prop](e):1!==e.elem.nodeType||!ce.cssHooks[e.prop]&&null==e.elem.style[Ze(e.prop)]?e.elem[e.prop]=e.now:ce.style(e.elem,e.prop,e.now+e.unit)}}}).scrollTop=at.propHooks.scrollLeft={set:function(e){e.elem.nodeType&&e.elem.parentNode&&(e.elem[e.prop]=e.now)}},ce.easing={linear:function(e){return e},swing:function(e){return.5-Math.cos(e*Math.PI)/2},_default:"swing"},ce.fx=at.prototype.init,ce.fx.step={};var st,ut,lt,ct,ft=/^(?:toggle|show|hide)$/,pt=/queueHooks$/;function dt(){ut&&(!1===C.hidden&&ie.requestAnimationFrame?ie.requestAnimationFrame(dt):ie.setTimeout(dt,ce.fx.interval),ce.fx.tick())}function ht(){return ie.setTimeout(function(){st=void 0}),st=Date.now()}function gt(e,t){var n,r=0,i={height:e};for(t=t?1:0;r<4;r+=2-t)i["margin"+(n=Q[r])]=i["padding"+n]=e;return t&&(i.opacity=i.width=e),i}function vt(e,t,n){for(var r,i=(yt.tweeners[t]||[]).concat(yt.tweeners["*"]),o=0,a=i.length;o<a;o++)if(r=i[o].call(n,t,e))return r}function yt(o,e,t){var n,a,r=0,i=yt.prefilters.length,s=ce.Deferred().always(function(){delete u.elem}),u=function(){if(a)return!1;for(var e=st||ht(),t=Math.max(0,l.startTime+l.duration-e),n=1-(t/l.duration||0),r=0,i=l.tweens.length;r<i;r++)l.tweens[r].run(n);return s.notifyWith(o,[l,n,t]),n<1&&i?t:(i||s.notifyWith(o,[l,1,0]),s.resolveWith(o,[l]),!1)},l=s.promise({elem:o,props:ce.extend({},e),opts:ce.extend(!0,{specialEasing:{},easing:ce.easing._default},t),originalProperties:e,originalOptions:t,startTime:st||ht(),duration:t.duration,tweens:[],createTween:function(e,t){var n=ce.Tween(o,l.opts,e,t,l.opts.specialEasing[e]||l.opts.easing);return l.tweens.push(n),n},stop:function(e){var t=0,n=e?l.tweens.length:0;if(a)return this;for(a=!0;t<n;t++)l.tweens[t].run(1);return e?(s.notifyWith(o,[l,1,0]),s.resolveWith(o,[l,e])):s.rejectWith(o,[l,e]),this}}),c=l.props;for(!function(e,t){var n,r,i,o,a;for(n in e)if(i=t[r=F(n)],o=e[n],Array.isArray(o)&&(i=o[1],o=e[n]=o[0]),n!==r&&(e[r]=o,delete e[n]),(a=ce.cssHooks[r])&&"expand"in a)for(n in o=a.expand(o),delete e[r],o)n in e||(e[n]=o[n],t[n]=i);else t[r]=i}(c,l.opts.specialEasing);r<i;r++)if(n=yt.prefilters[r].call(l,o,c,l.opts))return v(n.stop)&&(ce._queueHooks(l.elem,l.opts.queue).stop=n.stop.bind(n)),n;return ce.map(c,vt,l),v(l.opts.start)&&l.opts.start.call(o,l),l.progress(l.opts.progress).done(l.opts.done,l.opts.complete).fail(l.opts.fail).always(l.opts.always),ce.fx.timer(ce.extend(u,{elem:o,anim:l,queue:l.opts.queue})),l}ce.Animation=ce.extend(yt,{tweeners:{"*":[function(e,t){var n=this.createTween(e,t);return te(n.elem,e,Y.exec(t),n),n}]},tweener:function(e,t){v(e)?(t=e,e=["*"]):e=e.match(D);for(var n,r=0,i=e.length;r<i;r++)n=e[r],yt.tweeners[n]=yt.tweeners[n]||[],yt.tweeners[n].unshift(t)},prefilters:[function(e,t,n){var r,i,o,a,s,u,l,c,f="width"in t||"height"in t,p=this,d={},h=e.style,g=e.nodeType&&ee(e),v=_.get(e,"fxshow");for(r in n.queue||(null==(a=ce._queueHooks(e,"fx")).unqueued&&(a.unqueued=0,s=a.empty.fire,a.empty.fire=function(){a.unqueued||s()}),a.unqueued++,p.always(function(){p.always(function(){a.unqueued--,ce.queue(e,"fx").length||a.empty.fire()})})),t)if(i=t[r],ft.test(i)){if(delete t[r],o=o||"toggle"===i,i===(g?"hide":"show")){if("show"!==i||!v||void 0===v[r])continue;g=!0}d[r]=v&&v[r]||ce.style(e,r)}if((u=!ce.isEmptyObject(t))||!ce.isEmptyObject(d))for(r in f&&1===e.nodeType&&(n.overflow=[h.overflow,h.overflowX,h.overflowY],null==(l=v&&v.display)&&(l=_.get(e,"display")),"none"===(c=ce.css(e,"display"))&&(l?c=l:(re([e],!0),l=e.style.display||l,c=ce.css(e,"display"),re([e]))),("inline"===c||"inline-block"===c&&null!=l)&&"none"===ce.css(e,"float")&&(u||(p.done(function(){h.display=l}),null==l&&(c=h.display,l="none"===c?"":c)),h.display="inline-block")),n.overflow&&(h.overflow="hidden",p.always(function(){h.overflow=n.overflow[0],h.overflowX=n.overflow[1],h.overflowY=n.overflow[2]})),u=!1,d)u||(v?"hidden"in v&&(g=v.hidden):v=_.access(e,"fxshow",{display:l}),o&&(v.hidden=!g),g&&re([e],!0),p.done(function(){for(r in g||re([e]),_.remove(e,"fxshow"),d)ce.style(e,r,d[r])})),u=vt(g?v[r]:0,r,p),r in v||(v[r]=u.start,g&&(u.end=u.start,u.start=0))}],prefilter:function(e,t){t?yt.prefilters.unshift(e):yt.prefilters.push(e)}}),ce.speed=function(e,t,n){var r=e&&"object"==typeof e?ce.extend({},e):{complete:n||!n&&t||v(e)&&e,duration:e,easing:n&&t||t&&!v(t)&&t};return ce.fx.off?r.duration=0:"number"!=typeof r.duration&&(r.duration in ce.fx.speeds?r.duration=ce.fx.speeds[r.duration]:r.duration=ce.fx.speeds._default),null!=r.queue&&!0!==r.queue||(r.queue="fx"),r.old=r.complete,r.complete=function(){v(r.old)&&r.old.call(this),r.queue&&ce.dequeue(this,r.queue)},r},ce.fn.extend({fadeTo:function(e,t,n,r){return this.filter(ee).css("opacity",0).show().end().animate({opacity:t},e,n,r)},animate:function(t,e,n,r){var i=ce.isEmptyObject(t),o=ce.speed(e,n,r),a=function(){var e=yt(this,ce.extend({},t),o);(i||_.get(this,"finish"))&&e.stop(!0)};return a.finish=a,i||!1===o.queue?this.each(a):this.queue(o.queue,a)},stop:function(i,e,o){var a=function(e){var t=e.stop;delete e.stop,t(o)};return"string"!=typeof i&&(o=e,e=i,i=void 0),e&&this.queue(i||"fx",[]),this.each(function(){var e=!0,t=null!=i&&i+"queueHooks",n=ce.timers,r=_.get(this);if(t)r[t]&&r[t].stop&&a(r[t]);else for(t in r)r[t]&&r[t].stop&&pt.test(t)&&a(r[t]);for(t=n.length;t--;)n[t].elem!==this||null!=i&&n[t].queue!==i||(n[t].anim.stop(o),e=!1,n.splice(t,1));!e&&o||ce.dequeue(this,i)})},finish:function(a){return!1!==a&&(a=a||"fx"),this.each(function(){var e,t=_.get(this),n=t[a+"queue"],r=t[a+"queueHooks"],i=ce.timers,o=n?n.length:0;for(t.finish=!0,ce.queue(this,a,[]),r&&r.stop&&r.stop.call(this,!0),e=i.length;e--;)i[e].elem===this&&i[e].queue===a&&(i[e].anim.stop(!0),i.splice(e,1));for(e=0;e<o;e++)n[e]&&n[e].finish&&n[e].finish.call(this);delete t.finish})}}),ce.each(["toggle","show","hide"],function(e,r){var i=ce.fn[r];ce.fn[r]=function(e,t,n){return null==e||"boolean"==typeof e?i.apply(this,arguments):this.animate(gt(r,!0),e,t,n)}}),ce.each({slideDown:gt("show"),slideUp:gt("hide"),slideToggle:gt("toggle"),fadeIn:{opacity:"show"},fadeOut:{opacity:"hide"},fadeToggle:{opacity:"toggle"}},function(e,r){ce.fn[e]=function(e,t,n){return this.animate(r,e,t,n)}}),ce.timers=[],ce.fx.tick=function(){var e,t=0,n=ce.timers;for(st=Date.now();t<n.length;t++)(e=n[t])()||n[t]!==e||n.splice(t--,1);n.length||ce.fx.stop(),st=void 0},ce.fx.timer=function(e){ce.timers.push(e),ce.fx.start()},ce.fx.interval=13,ce.fx.start=function(){ut||(ut=!0,dt())},ce.fx.stop=function(){ut=null},ce.fx.speeds={slow:600,fast:200,_default:400},ce.fn.delay=function(r,e){return r=ce.fx&&ce.fx.speeds[r]||r,e=e||"fx",this.queue(e,function(e,t){var n=ie.setTimeout(e,r);t.stop=function(){ie.clearTimeout(n)}})},lt=C.createElement("input"),ct=C.createElement("select").appendChild(C.createElement("option")),lt.type="checkbox",le.checkOn=""!==lt.value,le.optSelected=ct.selected,(lt=C.createElement("input")).value="t",lt.type="radio",le.radioValue="t"===lt.value;var mt,xt=ce.expr.attrHandle;ce.fn.extend({attr:function(e,t){return M(this,ce.attr,e,t,1<arguments.length)},removeAttr:function(e){return this.each(function(){ce.removeAttr(this,e)})}}),ce.extend({attr:function(e,t,n){var r,i,o=e.nodeType;if(3!==o&&8!==o&&2!==o)return"undefined"==typeof e.getAttribute?ce.prop(e,t,n):(1===o&&ce.isXMLDoc(e)||(i=ce.attrHooks[t.toLowerCase()]||(ce.expr.match.bool.test(t)?mt:void 0)),void 0!==n?null===n?void ce.removeAttr(e,t):i&&"set"in i&&void 0!==(r=i.set(e,n,t))?r:(e.setAttribute(t,n+""),n):i&&"get"in i&&null!==(r=i.get(e,t))?r:null==(r=ce.find.attr(e,t))?void 0:r)},attrHooks:{type:{set:function(e,t){if(!le.radioValue&&"radio"===t&&fe(e,"input")){var n=e.value;return e.setAttribute("type",t),n&&(e.value=n),t}}}},removeAttr:function(e,t){var n,r=0,i=t&&t.match(D);if(i&&1===e.nodeType)while(n=i[r++])e.removeAttribute(n)}}),mt={set:function(e,t,n){return!1===t?ce.removeAttr(e,n):e.setAttribute(n,n),n}},ce.each(ce.expr.match.bool.source.match(/\w+/g),function(e,t){var a=xt[t]||ce.find.attr;xt[t]=function(e,t,n){var r,i,o=t.toLowerCase();return n||(i=xt[o],xt[o]=r,r=null!=a(e,t,n)?o:null,xt[o]=i),r}});var bt=/^(?:input|select|textarea|button)$/i,wt=/^(?:a|area)$/i;function Tt(e){return(e.match(D)||[]).join(" ")}function Ct(e){return e.getAttribute&&e.getAttribute("class")||""}function kt(e){return Array.isArray(e)?e:"string"==typeof e&&e.match(D)||[]}ce.fn.extend({prop:function(e,t){return M(this,ce.prop,e,t,1<arguments.length)},removeProp:function(e){return this.each(function(){delete this[ce.propFix[e]||e]})}}),ce.extend({prop:function(e,t,n){var r,i,o=e.nodeType;if(3!==o&&8!==o&&2!==o)return 1===o&&ce.isXMLDoc(e)||(t=ce.propFix[t]||t,i=ce.propHooks[t]),void 0!==n?i&&"set"in i&&void 0!==(r=i.set(e,n,t))?r:e[t]=n:i&&"get"in i&&null!==(r=i.get(e,t))?r:e[t]},propHooks:{tabIndex:{get:function(e){var t=ce.find.attr(e,"tabindex");return t?parseInt(t,10):bt.test(e.nodeName)||wt.test(e.nodeName)&&e.href?0:-1}}},propFix:{"for":"htmlFor","class":"className"}}),le.optSelected||(ce.propHooks.selected={get:function(e){var t=e.parentNode;return t&&t.parentNode&&t.parentNode.selectedIndex,null},set:function(e){var t=e.parentNode;t&&(t.selectedIndex,t.parentNode&&t.parentNode.selectedIndex)}}),ce.each(["tabIndex","readOnly","maxLength","cellSpacing","cellPadding","rowSpan","colSpan","useMap","frameBorder","contentEditable"],function(){ce.propFix[this.toLowerCase()]=this}),ce.fn.extend({addClass:function(t){var e,n,r,i,o,a;return v(t)?this.each(function(e){ce(this).addClass(t.call(this,e,Ct(this)))}):(e=kt(t)).length?this.each(function(){if(r=Ct(this),n=1===this.nodeType&&" "+Tt(r)+" "){for(o=0;o<e.length;o++)i=e[o],n.indexOf(" "+i+" ")<0&&(n+=i+" ");a=Tt(n),r!==a&&this.setAttribute("class",a)}}):this},removeClass:function(t){var e,n,r,i,o,a;return v(t)?this.each(function(e){ce(this).removeClass(t.call(this,e,Ct(this)))}):arguments.length?(e=kt(t)).length?this.each(function(){if(r=Ct(this),n=1===this.nodeType&&" "+Tt(r)+" "){for(o=0;o<e.length;o++){i=e[o];while(-1<n.indexOf(" "+i+" "))n=n.replace(" "+i+" "," ")}a=Tt(n),r!==a&&this.setAttribute("class",a)}}):this:this.attr("class","")},toggleClass:function(t,n){var e,r,i,o,a=typeof t,s="string"===a||Array.isArray(t);return v(t)?this.each(function(e){ce(this).toggleClass(t.call(this,e,Ct(this),n),n)}):"boolean"==typeof n&&s?n?this.addClass(t):this.removeClass(t):(e=kt(t),this.each(function(){if(s)for(o=ce(this),i=0;i<e.length;i++)r=e[i],o.hasClass(r)?o.removeClass(r):o.addClass(r);else void 0!==t&&"boolean"!==a||((r=Ct(this))&&_.set(this,"__className__",r),this.setAttribute&&this.setAttribute("class",r||!1===t?"":_.get(this,"__className__")||""))}))},hasClass:function(e){var t,n,r=0;t=" "+e+" ";while(n=this[r++])if(1===n.nodeType&&-1<(" "+Tt(Ct(n))+" ").indexOf(t))return!0;return!1}});var St=/\r/g;ce.fn.extend({val:function(n){var r,e,i,t=this[0];return arguments.length?(i=v(n),this.each(function(e){var t;1===this.nodeType&&(null==(t=i?n.call(this,e,ce(this).val()):n)?t="":"number"==typeof t?t+="":Array.isArray(t)&&(t=ce.map(t,function(e){return null==e?"":e+""})),(r=ce.valHooks[this.type]||ce.valHooks[this.nodeName.toLowerCase()])&&"set"in r&&void 0!==r.set(this,t,"value")||(this.value=t))})):t?(r=ce.valHooks[t.type]||ce.valHooks[t.nodeName.toLowerCase()])&&"get"in r&&void 0!==(e=r.get(t,"value"))?e:"string"==typeof(e=t.value)?e.replace(St,""):null==e?"":e:void 0}}),ce.extend({valHooks:{option:{get:function(e){var t=ce.find.attr(e,"value");return null!=t?t:Tt(ce.text(e))}},select:{get:function(e){var t,n,r,i=e.options,o=e.selectedIndex,a="select-one"===e.type,s=a?null:[],u=a?o+1:i.length;for(r=o<0?u:a?o:0;r<u;r++)if(((n=i[r]).selected||r===o)&&!n.disabled&&(!n.parentNode.disabled||!fe(n.parentNode,"optgroup"))){if(t=ce(n).val(),a)return t;s.push(t)}return s},set:function(e,t){var n,r,i=e.options,o=ce.makeArray(t),a=i.length;while(a--)((r=i[a]).selected=-1<ce.inArray(ce.valHooks.option.get(r),o))&&(n=!0);return n||(e.selectedIndex=-1),o}}}}),ce.each(["radio","checkbox"],function(){ce.valHooks[this]={set:function(e,t){if(Array.isArray(t))return e.checked=-1<ce.inArray(ce(e).val(),t)}},le.checkOn||(ce.valHooks[this].get=function(e){return null===e.getAttribute("value")?"on":e.value})});var Et=ie.location,jt={guid:Date.now()},At=/\?/;ce.parseXML=function(e){var t,n;if(!e||"string"!=typeof e)return null;try{t=(new ie.DOMParser).parseFromString(e,"text/xml")}catch(e){}return n=t&&t.getElementsByTagName("parsererror")[0],t&&!n||ce.error("Invalid XML: "+(n?ce.map(n.childNodes,function(e){return e.textContent}).join("\n"):e)),t};var Dt=/^(?:focusinfocus|focusoutblur)$/,Nt=function(e){e.stopPropagation()};ce.extend(ce.event,{trigger:function(e,t,n,r){var i,o,a,s,u,l,c,f,p=[n||C],d=ue.call(e,"type")?e.type:e,h=ue.call(e,"namespace")?e.namespace.split("."):[];if(o=f=a=n=n||C,3!==n.nodeType&&8!==n.nodeType&&!Dt.test(d+ce.event.triggered)&&(-1<d.indexOf(".")&&(d=(h=d.split(".")).shift(),h.sort()),u=d.indexOf(":")<0&&"on"+d,(e=e[ce.expando]?e:new ce.Event(d,"object"==typeof e&&e)).isTrigger=r?2:3,e.namespace=h.join("."),e.rnamespace=e.namespace?new RegExp("(^|\\.)"+h.join("\\.(?:.*\\.|)")+"(\\.|$)"):null,e.result=void 0,e.target||(e.target=n),t=null==t?[e]:ce.makeArray(t,[e]),c=ce.event.special[d]||{},r||!c.trigger||!1!==c.trigger.apply(n,t))){if(!r&&!c.noBubble&&!y(n)){for(s=c.delegateType||d,Dt.test(s+d)||(o=o.parentNode);o;o=o.parentNode)p.push(o),a=o;a===(n.ownerDocument||C)&&p.push(a.defaultView||a.parentWindow||ie)}i=0;while((o=p[i++])&&!e.isPropagationStopped())f=o,e.type=1<i?s:c.bindType||d,(l=(_.get(o,"events")||Object.create(null))[e.type]&&_.get(o,"handle"))&&l.apply(o,t),(l=u&&o[u])&&l.apply&&$(o)&&(e.result=l.apply(o,t),!1===e.result&&e.preventDefault());return e.type=d,r||e.isDefaultPrevented()||c._default&&!1!==c._default.apply(p.pop(),t)||!$(n)||u&&v(n[d])&&!y(n)&&((a=n[u])&&(n[u]=null),ce.event.triggered=d,e.isPropagationStopped()&&f.addEventListener(d,Nt),n[d](),e.isPropagationStopped()&&f.removeEventListener(d,Nt),ce.event.triggered=void 0,a&&(n[u]=a)),e.result}},simulate:function(e,t,n){var r=ce.extend(new ce.Event,n,{type:e,isSimulated:!0});ce.event.trigger(r,null,t)}}),ce.fn.extend({trigger:function(e,t){return this.each(function(){ce.event.trigger(e,t,this)})},triggerHandler:function(e,t){var n=this[0];if(n)return ce.event.trigger(e,t,n,!0)}});var qt=/\[\]$/,Lt=/\r?\n/g,Ht=/^(?:submit|button|image|reset|file)$/i,Ot=/^(?:input|select|textarea|keygen)/i;function Pt(n,e,r,i){var t;if(Array.isArray(e))ce.each(e,function(e,t){r||qt.test(n)?i(n,t):Pt(n+"["+("object"==typeof t&&null!=t?e:"")+"]",t,r,i)});else if(r||"object"!==x(e))i(n,e);else for(t in e)Pt(n+"["+t+"]",e[t],r,i)}ce.param=function(e,t){var n,r=[],i=function(e,t){var n=v(t)?t():t;r[r.length]=encodeURIComponent(e)+"="+encodeURIComponent(null==n?"":n)};if(null==e)return"";if(Array.isArray(e)||e.jquery&&!ce.isPlainObject(e))ce.each(e,function(){i(this.name,this.value)});else for(n in e)Pt(n,e[n],t,i);return r.join("&")},ce.fn.extend({serialize:function(){return ce.param(this.serializeArray())},serializeArray:function(){return this.map(function(){var e=ce.prop(this,"elements");return e?ce.makeArray(e):this}).filter(function(){var e=this.type;return this.name&&!ce(this).is(":disabled")&&Ot.test(this.nodeName)&&!Ht.test(e)&&(this.checked||!we.test(e))}).map(function(e,t){var n=ce(this).val();return null==n?null:Array.isArray(n)?ce.map(n,function(e){return{name:t.name,value:e.replace(Lt,"\r\n")}}):{name:t.name,value:n.replace(Lt,"\r\n")}}).get()}});var Mt=/%20/g,Rt=/#.*$/,It=/([?&])_=[^&]*/,Wt=/^(.*?):[ \t]*([^\r\n]*)$/gm,Ft=/^(?:GET|HEAD)$/,$t=/^\/\//,Bt={},_t={},zt="*/".concat("*"),Xt=C.createElement("a");function Ut(o){return function(e,t){"string"!=typeof e&&(t=e,e="*");var n,r=0,i=e.toLowerCase().match(D)||[];if(v(t))while(n=i[r++])"+"===n[0]?(n=n.slice(1)||"*",(o[n]=o[n]||[]).unshift(t)):(o[n]=o[n]||[]).push(t)}}function Vt(t,i,o,a){var s={},u=t===_t;function l(e){var r;return s[e]=!0,ce.each(t[e]||[],function(e,t){var n=t(i,o,a);return"string"!=typeof n||u||s[n]?u?!(r=n):void 0:(i.dataTypes.unshift(n),l(n),!1)}),r}return l(i.dataTypes[0])||!s["*"]&&l("*")}function Gt(e,t){var n,r,i=ce.ajaxSettings.flatOptions||{};for(n in t)void 0!==t[n]&&((i[n]?e:r||(r={}))[n]=t[n]);return r&&ce.extend(!0,e,r),e}Xt.href=Et.href,ce.extend({active:0,lastModified:{},etag:{},ajaxSettings:{url:Et.href,type:"GET",isLocal:/^(?:about|app|app-storage|.+-extension|file|res|widget):$/.test(Et.protocol),global:!0,processData:!0,async:!0,contentType:"application/x-www-form-urlencoded; charset=UTF-8",accepts:{"*":zt,text:"text/plain",html:"text/html",xml:"application/xml, text/xml",json:"application/json, text/javascript"},contents:{xml:/\bxml\b/,html:/\bhtml/,json:/\bjson\b/},responseFields:{xml:"responseXML",text:"responseText",json:"responseJSON"},converters:{"* text":String,"text html":!0,"text json":JSON.parse,"text xml":ce.parseXML},flatOptions:{url:!0,context:!0}},ajaxSetup:function(e,t){return t?Gt(Gt(e,ce.ajaxSettings),t):Gt(ce.ajaxSettings,e)},ajaxPrefilter:Ut(Bt),ajaxTransport:Ut(_t),ajax:function(e,t){"object"==typeof e&&(t=e,e=void 0),t=t||{};var c,f,p,n,d,r,h,g,i,o,v=ce.ajaxSetup({},t),y=v.context||v,m=v.context&&(y.nodeType||y.jquery)?ce(y):ce.event,x=ce.Deferred(),b=ce.Callbacks("once memory"),w=v.statusCode||{},a={},s={},u="canceled",T={readyState:0,getResponseHeader:function(e){var t;if(h){if(!n){n={};while(t=Wt.exec(p))n[t[1].toLowerCase()+" "]=(n[t[1].toLowerCase()+" "]||[]).concat(t[2])}t=n[e.toLowerCase()+" "]}return null==t?null:t.join(", ")},getAllResponseHeaders:function(){return h?p:null},setRequestHeader:function(e,t){return null==h&&(e=s[e.toLowerCase()]=s[e.toLowerCase()]||e,a[e]=t),this},overrideMimeType:function(e){return null==h&&(v.mimeType=e),this},statusCode:function(e){var t;if(e)if(h)T.always(e[T.status]);else for(t in e)w[t]=[w[t],e[t]];return this},abort:function(e){var t=e||u;return c&&c.abort(t),l(0,t),this}};if(x.promise(T),v.url=((e||v.url||Et.href)+"").replace($t,Et.protocol+"//"),v.type=t.method||t.type||v.method||v.type,v.dataTypes=(v.dataType||"*").toLowerCase().match(D)||[""],null==v.crossDomain){r=C.createElement("a");try{r.href=v.url,r.href=r.href,v.crossDomain=Xt.protocol+"//"+Xt.host!=r.protocol+"//"+r.host}catch(e){v.crossDomain=!0}}if(v.data&&v.processData&&"string"!=typeof v.data&&(v.data=ce.param(v.data,v.traditional)),Vt(Bt,v,t,T),h)return T;for(i in(g=ce.event&&v.global)&&0==ce.active++&&ce.event.trigger("ajaxStart"),v.type=v.type.toUpperCase(),v.hasContent=!Ft.test(v.type),f=v.url.replace(Rt,""),v.hasContent?v.data&&v.processData&&0===(v.contentType||"").indexOf("application/x-www-form-urlencoded")&&(v.data=v.data.replace(Mt,"+")):(o=v.url.slice(f.length),v.data&&(v.processData||"string"==typeof v.data)&&(f+=(At.test(f)?"&":"?")+v.data,delete v.data),!1===v.cache&&(f=f.replace(It,"$1"),o=(At.test(f)?"&":"?")+"_="+jt.guid+++o),v.url=f+o),v.ifModified&&(ce.lastModified[f]&&T.setRequestHeader("If-Modified-Since",ce.lastModified[f]),ce.etag[f]&&T.setRequestHeader("If-None-Match",ce.etag[f])),(v.data&&v.hasContent&&!1!==v.contentType||t.contentType)&&T.setRequestHeader("Content-Type",v.contentType),T.setRequestHeader("Accept",v.dataTypes[0]&&v.accepts[v.dataTypes[0]]?v.accepts[v.dataTypes[0]]+("*"!==v.dataTypes[0]?", "+zt+"; q=0.01":""):v.accepts["*"]),v.headers)T.setRequestHeader(i,v.headers[i]);if(v.beforeSend&&(!1===v.beforeSend.call(y,T,v)||h))return T.abort();if(u="abort",b.add(v.complete),T.done(v.success),T.fail(v.error),c=Vt(_t,v,t,T)){if(T.readyState=1,g&&m.trigger("ajaxSend",[T,v]),h)return T;v.async&&0<v.timeout&&(d=ie.setTimeout(function(){T.abort("timeout")},v.timeout));try{h=!1,c.send(a,l)}catch(e){if(h)throw e;l(-1,e)}}else l(-1,"No Transport");function l(e,t,n,r){var i,o,a,s,u,l=t;h||(h=!0,d&&ie.clearTimeout(d),c=void 0,p=r||"",T.readyState=0<e?4:0,i=200<=e&&e<300||304===e,n&&(s=function(e,t,n){var r,i,o,a,s=e.contents,u=e.dataTypes;while("*"===u[0])u.shift(),void 0===r&&(r=e.mimeType||t.getResponseHeader("Content-Type"));if(r)for(i in s)if(s[i]&&s[i].test(r)){u.unshift(i);break}if(u[0]in n)o=u[0];else{for(i in n){if(!u[0]||e.converters[i+" "+u[0]]){o=i;break}a||(a=i)}o=o||a}if(o)return o!==u[0]&&u.unshift(o),n[o]}(v,T,n)),!i&&-1<ce.inArray("script",v.dataTypes)&&ce.inArray("json",v.dataTypes)<0&&(v.converters["text script"]=function(){}),s=function(e,t,n,r){var i,o,a,s,u,l={},c=e.dataTypes.slice();if(c[1])for(a in e.converters)l[a.toLowerCase()]=e.converters[a];o=c.shift();while(o)if(e.responseFields[o]&&(n[e.responseFields[o]]=t),!u&&r&&e.dataFilter&&(t=e.dataFilter(t,e.dataType)),u=o,o=c.shift())if("*"===o)o=u;else if("*"!==u&&u!==o){if(!(a=l[u+" "+o]||l["* "+o]))for(i in l)if((s=i.split(" "))[1]===o&&(a=l[u+" "+s[0]]||l["* "+s[0]])){!0===a?a=l[i]:!0!==l[i]&&(o=s[0],c.unshift(s[1]));break}if(!0!==a)if(a&&e["throws"])t=a(t);else try{t=a(t)}catch(e){return{state:"parsererror",error:a?e:"No conversion from "+u+" to "+o}}}return{state:"success",data:t}}(v,s,T,i),i?(v.ifModified&&((u=T.getResponseHeader("Last-Modified"))&&(ce.lastModified[f]=u),(u=T.getResponseHeader("etag"))&&(ce.etag[f]=u)),204===e||"HEAD"===v.type?l="nocontent":304===e?l="notmodified":(l=s.state,o=s.data,i=!(a=s.error))):(a=l,!e&&l||(l="error",e<0&&(e=0))),T.status=e,T.statusText=(t||l)+"",i?x.resolveWith(y,[o,l,T]):x.rejectWith(y,[T,l,a]),T.statusCode(w),w=void 0,g&&m.trigger(i?"ajaxSuccess":"ajaxError",[T,v,i?o:a]),b.fireWith(y,[T,l]),g&&(m.trigger("ajaxComplete",[T,v]),--ce.active||ce.event.trigger("ajaxStop")))}return T},getJSON:function(e,t,n){return ce.get(e,t,n,"json")},getScript:function(e,t){return ce.get(e,void 0,t,"script")}}),ce.each(["get","post"],function(e,i){ce[i]=function(e,t,n,r){return v(t)&&(r=r||n,n=t,t=void 0),ce.ajax(ce.extend({url:e,type:i,dataType:r,data:t,success:n},ce.isPlainObject(e)&&e))}}),ce.ajaxPrefilter(function(e){var t;for(t in e.headers)"content-type"===t.toLowerCase()&&(e.contentType=e.headers[t]||"")}),ce._evalUrl=function(e,t,n){return ce.ajax({url:e,type:"GET",dataType:"script",cache:!0,async:!1,global:!1,converters:{"text script":function(){}},dataFilter:function(e){ce.globalEval(e,t,n)}})},ce.fn.extend({wrapAll:function(e){var t;return this[0]&&(v(e)&&(e=e.call(this[0])),t=ce(e,this[0].ownerDocument).eq(0).clone(!0),this[0].parentNode&&t.insertBefore(this[0]),t.map(function(){var e=this;while(e.firstElementChild)e=e.firstElementChild;return e}).append(this)),this},wrapInner:function(n){return v(n)?this.each(function(e){ce(this).wrapInner(n.call(this,e))}):this.each(function(){var e=ce(this),t=e.contents();t.length?t.wrapAll(n):e.append(n)})},wrap:function(t){var n=v(t);return this.each(function(e){ce(this).wrapAll(n?t.call(this,e):t)})},unwrap:function(e){return this.parent(e).not("body").each(function(){ce(this).replaceWith(this.childNodes)}),this}}),ce.expr.pseudos.hidden=function(e){return!ce.expr.pseudos.visible(e)},ce.expr.pseudos.visible=function(e){return!!(e.offsetWidth||e.offsetHeight||e.getClientRects().length)},ce.ajaxSettings.xhr=function(){try{return new ie.XMLHttpRequest}catch(e){}};var Yt={0:200,1223:204},Qt=ce.ajaxSettings.xhr();le.cors=!!Qt&&"withCredentials"in Qt,le.ajax=Qt=!!Qt,ce.ajaxTransport(function(i){var o,a;if(le.cors||Qt&&!i.crossDomain)return{send:function(e,t){var n,r=i.xhr();if(r.open(i.type,i.url,i.async,i.username,i.password),i.xhrFields)for(n in i.xhrFields)r[n]=i.xhrFields[n];for(n in i.mimeType&&r.overrideMimeType&&r.overrideMimeType(i.mimeType),i.crossDomain||e["X-Requested-With"]||(e["X-Requested-With"]="XMLHttpRequest"),e)r.setRequestHeader(n,e[n]);o=function(e){return function(){o&&(o=a=r.onload=r.onerror=r.onabort=r.ontimeout=r.onreadystatechange=null,"abort"===e?r.abort():"error"===e?"number"!=typeof r.status?t(0,"error"):t(r.status,r.statusText):t(Yt[r.status]||r.status,r.statusText,"text"!==(r.responseType||"text")||"string"!=typeof r.responseText?{binary:r.response}:{text:r.responseText},r.getAllResponseHeaders()))}},r.onload=o(),a=r.onerror=r.ontimeout=o("error"),void 0!==r.onabort?r.onabort=a:r.onreadystatechange=function(){4===r.readyState&&ie.setTimeout(function(){o&&a()})},o=o("abort");try{r.send(i.hasContent&&i.data||null)}catch(e){if(o)throw e}},abort:function(){o&&o()}}}),ce.ajaxPrefilter(function(e){e.crossDomain&&(e.contents.script=!1)}),ce.ajaxSetup({accepts:{script:"text/javascript, application/javascript, application/ecmascript, application/x-ecmascript"},contents:{script:/\b(?:java|ecma)script\b/},converters:{"text script":function(e){return ce.globalEval(e),e}}}),ce.ajaxPrefilter("script",function(e){void 0===e.cache&&(e.cache=!1),e.crossDomain&&(e.type="GET")}),ce.ajaxTransport("script",function(n){var r,i;if(n.crossDomain||n.scriptAttrs)return{send:function(e,t){r=ce("<script>").attr(n.scriptAttrs||{}).prop({charset:n.scriptCharset,src:n.url}).on("load error",i=function(e){r.remove(),i=null,e&&t("error"===e.type?404:200,e.type)}),C.head.appendChild(r[0])},abort:function(){i&&i()}}});var Jt,Kt=[],Zt=/(=)\?(?=&|$)|\?\?/;ce.ajaxSetup({jsonp:"callback",jsonpCallback:function(){var e=Kt.pop()||ce.expando+"_"+jt.guid++;return this[e]=!0,e}}),ce.ajaxPrefilter("json jsonp",function(e,t,n){var r,i,o,a=!1!==e.jsonp&&(Zt.test(e.url)?"url":"string"==typeof e.data&&0===(e.contentType||"").indexOf("application/x-www-form-urlencoded")&&Zt.test(e.data)&&"data");if(a||"jsonp"===e.dataTypes[0])return r=e.jsonpCallback=v(e.jsonpCallback)?e.jsonpCallback():e.jsonpCallback,a?e[a]=e[a].replace(Zt,"$1"+r):!1!==e.jsonp&&(e.url+=(At.test(e.url)?"&":"?")+e.jsonp+"="+r),e.converters["script json"]=function(){return o||ce.error(r+" was not called"),o[0]},e.dataTypes[0]="json",i=ie[r],ie[r]=function(){o=arguments},n.always(function(){void 0===i?ce(ie).removeProp(r):ie[r]=i,e[r]&&(e.jsonpCallback=t.jsonpCallback,Kt.push(r)),o&&v(i)&&i(o[0]),o=i=void 0}),"script"}),le.createHTMLDocument=((Jt=C.implementation.createHTMLDocument("").body).innerHTML="<form></form><form></form>",2===Jt.childNodes.length),ce.parseHTML=function(e,t,n){return"string"!=typeof e?[]:("boolean"==typeof t&&(n=t,t=!1),t||(le.createHTMLDocument?((r=(t=C.implementation.createHTMLDocument("")).createElement("base")).href=C.location.href,t.head.appendChild(r)):t=C),o=!n&&[],(i=w.exec(e))?[t.createElement(i[1])]:(i=Ae([e],t,o),o&&o.length&&ce(o).remove(),ce.merge([],i.childNodes)));var r,i,o},ce.fn.load=function(e,t,n){var r,i,o,a=this,s=e.indexOf(" ");return-1<s&&(r=Tt(e.slice(s)),e=e.slice(0,s)),v(t)?(n=t,t=void 0):t&&"object"==typeof t&&(i="POST"),0<a.length&&ce.ajax({url:e,type:i||"GET",dataType:"html",data:t}).done(function(e){o=arguments,a.html(r?ce("<div>").append(ce.parseHTML(e)).find(r):e)}).always(n&&function(e,t){a.each(function(){n.apply(this,o||[e.responseText,t,e])})}),this},ce.expr.pseudos.animated=function(t){return ce.grep(ce.timers,function(e){return t===e.elem}).length},ce.offset={setOffset:function(e,t,n){var r,i,o,a,s,u,l=ce.css(e,"position"),c=ce(e),f={};"static"===l&&(e.style.position="relative"),s=c.offset(),o=ce.css(e,"top"),u=ce.css(e,"left"),("absolute"===l||"fixed"===l)&&-1<(o+u).indexOf("auto")?(a=(r=c.position()).top,i=r.left):(a=parseFloat(o)||0,i=parseFloat(u)||0),v(t)&&(t=t.call(e,n,ce.extend({},s))),null!=t.top&&(f.top=t.top-s.top+a),null!=t.left&&(f.left=t.left-s.left+i),"using"in t?t.using.call(e,f):c.css(f)}},ce.fn.extend({offset:function(t){if(arguments.length)return void 0===t?this:this.each(function(e){ce.offset.setOffset(this,t,e)});var e,n,r=this[0];return r?r.getClientRects().length?(e=r.getBoundingClientRect(),n=r.ownerDocument.defaultView,{top:e.top+n.pageYOffset,left:e.left+n.pageXOffset}):{top:0,left:0}:void 0},position:function(){if(this[0]){var e,t,n,r=this[0],i={top:0,left:0};if("fixed"===ce.css(r,"position"))t=r.getBoundingClientRect();else{t=this.offset(),n=r.ownerDocument,e=r.offsetParent||n.documentElement;while(e&&(e===n.body||e===n.documentElement)&&"static"===ce.css(e,"position"))e=e.parentNode;e&&e!==r&&1===e.nodeType&&((i=ce(e).offset()).top+=ce.css(e,"borderTopWidth",!0),i.left+=ce.css(e,"borderLeftWidth",!0))}return{top:t.top-i.top-ce.css(r,"marginTop",!0),left:t.left-i.left-ce.css(r,"marginLeft",!0)}}},offsetParent:function(){return this.map(function(){var e=this.offsetParent;while(e&&"static"===ce.css(e,"position"))e=e.offsetParent;return e||J})}}),ce.each({scrollLeft:"pageXOffset",scrollTop:"pageYOffset"},function(t,i){var o="pageYOffset"===i;ce.fn[t]=function(e){return M(this,function(e,t,n){var r;if(y(e)?r=e:9===e.nodeType&&(r=e.defaultView),void 0===n)return r?r[i]:e[t];r?r.scrollTo(o?r.pageXOffset:n,o?n:r.pageYOffset):e[t]=n},t,e,arguments.length)}}),ce.each(["top","left"],function(e,n){ce.cssHooks[n]=Ye(le.pixelPosition,function(e,t){if(t)return t=Ge(e,n),_e.test(t)?ce(e).position()[n]+"px":t})}),ce.each({Height:"height",Width:"width"},function(a,s){ce.each({padding:"inner"+a,content:s,"":"outer"+a},function(r,o){ce.fn[o]=function(e,t){var n=arguments.length&&(r||"boolean"!=typeof e),i=r||(!0===e||!0===t?"margin":"border");return M(this,function(e,t,n){var r;return y(e)?0===o.indexOf("outer")?e["inner"+a]:e.document.documentElement["client"+a]:9===e.nodeType?(r=e.documentElement,Math.max(e.body["scroll"+a],r["scroll"+a],e.body["offset"+a],r["offset"+a],r["client"+a])):void 0===n?ce.css(e,t,i):ce.style(e,t,n,i)},s,n?e:void 0,n)}})}),ce.each(["ajaxStart","ajaxStop","ajaxComplete","ajaxError","ajaxSuccess","ajaxSend"],function(e,t){ce.fn[t]=function(e){return this.on(t,e)}}),ce.fn.extend({bind:function(e,t,n){return this.on(e,null,t,n)},unbind:function(e,t){return this.off(e,null,t)},delegate:function(e,t,n,r){return this.on(t,e,n,r)},undelegate:function(e,t,n){return 1===arguments.length?this.off(e,"**"):this.off(t,e||"**",n)},hover:function(e,t){return this.on("mouseenter",e).on("mouseleave",t||e)}}),ce.each("blur focus focusin focusout resize scroll click dblclick mousedown mouseup mousemove mouseover mouseout mouseenter mouseleave change select submit keydown keypress keyup contextmenu".split(" "),function(e,n){ce.fn[n]=function(e,t){return 0<arguments.length?this.on(n,null,e,t):this.trigger(n)}});var en=/^[\s\uFEFF\xA0]+|([^\s\uFEFF\xA0])[\s\uFEFF\xA0]+$/g;ce.proxy=function(e,t){var n,r,i;if("string"==typeof t&&(n=e[t],t=e,e=n),v(e))return r=ae.call(arguments,2),(i=function(){return e.apply(t||this,r.concat(ae.call(arguments)))}).guid=e.guid=e.guid||ce.guid++,i},ce.holdReady=function(e){e?ce.readyWait++:ce.ready(!0)},ce.isArray=Array.isArray,ce.parseJSON=JSON.parse,ce.nodeName=fe,ce.isFunction=v,ce.isWindow=y,ce.camelCase=F,ce.type=x,ce.now=Date.now,ce.isNumeric=function(e){var t=ce.type(e);return("number"===t||"string"===t)&&!isNaN(e-parseFloat(e))},ce.trim=function(e){return null==e?"":(e+"").replace(en,"$1")},"function"==typeof define&&define.amd&&define("jquery",[],function(){return ce});var tn=ie.jQuery,nn=ie.$;return ce.noConflict=function(e){return ie.$===ce&&(ie.$=nn),e&&ie.jQuery===ce&&(ie.jQuery=tn),ce},"undefined"==typeof e&&(ie.jQuery=ie.$=ce),ce});

/* Summernote Lite 0.9.1 inline */
/*! Summernote v0.9.1 | (c) 2013~ Hackerwins and contributors | MIT license */
!function(t,e){if("object"==typeof exports&&"object"==typeof module)module.exports=e(require("jquery"));else if("function"==typeof define&&define.amd)define(["jquery"],e);else{var o="object"==typeof exports?e(require("jquery")):e(t.jQuery);for(var n in o)("object"==typeof exports?exports:t)[n]=o[n]}}(self,(t=>(()=>{"use strict";var e={7e3:(t,e,o)=>{var n=o(8938),i=o.n(n);i().summernote=i().summernote||{lang:{}},i().extend(!0,i().summernote.lang,{"en-US":{font:{bold:"Bold",italic:"Italic",underline:"Underline",clear:"Remove Font Style",height:"Line Height",name:"Font Family",strikethrough:"Strikethrough",subscript:"Subscript",superscript:"Superscript",size:"Font Size",sizeunit:"Font Size Unit"},image:{image:"Picture",insert:"Insert Image",resizeFull:"Resize full",resizeHalf:"Resize half",resizeQuarter:"Resize quarter",resizeNone:"Original size",floatLeft:"Float Left",floatRight:"Float Right",floatNone:"Remove float",shapeRounded:"Shape: Rounded",shapeCircle:"Shape: Circle",shapeThumbnail:"Shape: Thumbnail",shapeNone:"Shape: None",dragImageHere:"Drag image or text here",dropImage:"Drop image or Text",selectFromFiles:"Select from files",maximumFileSize:"Maximum file size",maximumFileSizeError:"Maximum file size exceeded.",url:"Image URL",remove:"Remove Image",original:"Original"},video:{video:"Video",videoLink:"Video Link",insert:"Insert Video",url:"Video URL",providers:"(YouTube, Google Drive, Vimeo, Vine, Instagram, DailyMotion, Youku, Peertube)"},link:{link:"Link",insert:"Insert Link",unlink:"Unlink",edit:"Edit",textToDisplay:"Text to display",url:"To what URL should this link go?",openInNewWindow:"Open in new window"},table:{table:"Table",addRowAbove:"Add row above",addRowBelow:"Add row below",addColLeft:"Add column left",addColRight:"Add column right",delRow:"Delete row",delCol:"Delete column",delTable:"Delete table"},hr:{insert:"Insert Horizontal Rule"},style:{style:"Style",p:"Normal",blockquote:"Quote",pre:"Code",h1:"Header 1",h2:"Header 2",h3:"Header 3",h4:"Header 4",h5:"Header 5",h6:"Header 6"},lists:{unordered:"Unordered list",ordered:"Ordered list"},options:{help:"Help",fullscreen:"Full Screen",codeview:"Code View"},paragraph:{paragraph:"Paragraph",outdent:"Outdent",indent:"Indent",left:"Align left",center:"Align center",right:"Align right",justify:"Justify full"},color:{recent:"Recent Color",more:"More Color",background:"Background Color",foreground:"Text Color",transparent:"Transparent",setTransparent:"Set transparent",reset:"Reset",resetToDefault:"Reset to default",cpSelect:"Select"},shortcut:{shortcuts:"Keyboard shortcuts",close:"Close",textFormatting:"Text formatting",action:"Action",paragraphFormatting:"Paragraph formatting",documentStyle:"Document Style",extraKeys:"Extra keys"},help:{escape:"Escape",insertParagraph:"Insert Paragraph",undo:"Undo the last command",redo:"Redo the last command",tab:"Tab",untab:"Untab",bold:"Set a bold style",italic:"Set a italic style",underline:"Set a underline style",strikethrough:"Set a strikethrough style",removeFormat:"Clean a style",justifyLeft:"Set left align",justifyCenter:"Set center align",justifyRight:"Set right align",justifyFull:"Set full align",insertUnorderedList:"Toggle unordered list",insertOrderedList:"Toggle ordered list",outdent:"Outdent on current paragraph",indent:"Indent on current paragraph",formatPara:"Change current block's format as a paragraph(P tag)",formatH1:"Change current block's format as H1",formatH2:"Change current block's format as H2",formatH3:"Change current block's format as H3",formatH4:"Change current block's format as H4",formatH5:"Change current block's format as H5",formatH6:"Change current block's format as H6",insertHorizontalRule:"Insert horizontal rule","linkDialog.show":"Show Link Dialog"},history:{undo:"Undo",redo:"Redo"},specialChar:{specialChar:"SPECIAL CHARACTERS",select:"Select Special characters"},output:{noSelection:"No Selection Made!"}}})},8938:e=>{e.exports=t}},o={};function n(t){var i=o[t];if(void 0!==i)return i.exports;var r=o[t]={exports:{}};return e[t](r,r.exports,n),r.exports}n.n=t=>{var e=t&&t.__esModule?()=>t.default:()=>t;return n.d(e,{a:e}),e},n.d=(t,e)=>{for(var o in e)n.o(e,o)&&!n.o(t,o)&&Object.defineProperty(t,o,{enumerable:!0,get:e[o]})},n.o=(t,e)=>Object.prototype.hasOwnProperty.call(t,e);var i=n(8938),r=n.n(i),a=(n(7e3),["sans-serif","serif","monospace","cursive","fantasy"]);function s(t){return-1===r().inArray(t.toLowerCase(),a)?"'".concat(t,"'"):t}var l,c=navigator.userAgent,u=/MSIE|Trident/i.test(c);if(u){var d=/MSIE (\d+[.]\d+)/.exec(c);d&&(l=parseFloat(d[1])),(d=/Trident\/.*rv:([0-9]{1,}[.0-9]{0,})/.exec(c))&&(l=parseFloat(d[1]))}var f=/Edge\/\d+/.test(c),h="ontouchstart"in window||navigator.MaxTouchPoints>0||navigator.msMaxTouchPoints>0,p=u?"DOMCharacterDataModified DOMSubtreeModified DOMNodeInserted":"input";const m={isMac:navigator.appVersion.indexOf("Mac")>-1,isMSIE:u,isEdge:f,isFF:!f&&/firefox/i.test(c),isPhantom:/PhantomJS/i.test(c),isWebkit:!f&&/webkit/i.test(c),isChrome:!f&&/chrome/i.test(c),isSafari:!f&&/safari/i.test(c)&&!/chrome/i.test(c),browserVersion:l,isSupportTouch:h,isFontInstalled:function(){var t=document.createElement("canvas"),e=t.getContext("2d",{willReadFrequently:!0});function o(t,o){return e.clearRect(0,0,40,20),e.font="20px "+s(t)+', "'+o+'"',e.fillText("mw",20,10),e.getImageData(0,0,40,20).data.join("")}return t.width=40,t.height=20,e.textAlign="center",e.fillStyle="black",e.textBaseline="middle",function(t){var e="Comic Sans MS"===t?"Courier New":"Comic Sans MS";return o(e,e)!==o(t,e)}}(),isW3CRangeSupport:!!document.createRange,inputEventName:p,genericFontFamilies:a,validFontName:s};var v=0;const g={eq:function(t){return function(e){return t===e}},eq2:function(t,e){return t===e},peq2:function(t){return function(e,o){return e[t]===o[t]}},ok:function(){return!0},fail:function(){return!1},self:function(t){return t},not:function(t){return function(){return!t.apply(t,arguments)}},and:function(t,e){return function(o){return t(o)&&e(o)}},invoke:function(t,e){return function(){return t[e].apply(t,arguments)}},resetUniqueId:function(){v=0},uniqueId:function(t){var e=++v+"";return t?t+e:e},rect2bnd:function(t){var e=r()(document);return{top:t.top+e.scrollTop(),left:t.left+e.scrollLeft(),width:t.right-t.left,height:t.bottom-t.top}},invertObject:function(t){var e={};for(var o in t)Object.prototype.hasOwnProperty.call(t,o)&&(e[t[o]]=o);return e},namespaceToCamel:function(t,e){return(e=e||"")+t.split(".").map((function(t){return t.substring(0,1).toUpperCase()+t.substring(1)})).join("")},debounce:function(t,e,o){var n;return function(){var i=this,r=arguments,a=o&&!n;clearTimeout(n),n=setTimeout((function(){n=null,o||t.apply(i,r)}),e),a&&t.apply(i,r)}},isValidUrl:function(t){return/[-a-zA-Z0-9@:%._\+~#=]{2,256}\.[a-z]{2,6}\b([-a-zA-Z0-9@:%_\+.~#?&//=]*)/gi.test(t)}};function b(t){return t[0]}function y(t){return t[t.length-1]}function k(t){return t.slice(1)}function w(t,e){if(t&&t.length&&e){if(t.indexOf)return-1!==t.indexOf(e);if(t.contains)return t.contains(e)}return!1}const C={head:b,last:y,initial:function(t){return t.slice(0,t.length-1)},tail:k,prev:function(t,e){if(t&&t.length&&e){var o=t.indexOf(e);return-1===o?null:t[o-1]}return null},next:function(t,e){if(t&&t.length&&e){var o=t.indexOf(e);return-1===o?null:t[o+1]}return null},find:function(t,e){for(var o=0,n=t.length;o<n;o++){var i=t[o];if(e(i))return i}},contains:w,all:function(t,e){for(var o=0,n=t.length;o<n;o++)if(!e(t[o]))return!1;return!0},sum:function(t,e){return e=e||g.self,t.reduce((function(t,o){return t+e(o)}),0)},from:function(t){for(var e=[],o=t.length,n=-1;++n<o;)e[n]=t[n];return e},isEmpty:function(t){return!t||!t.length},clusterBy:function(t,e){return t.length?k(t).reduce((function(t,o){var n=y(t);return e(y(n),o)?n[n.length]=o:t[t.length]=[o],t}),[[b(t)]]):[]},compact:function(t){for(var e=[],o=0,n=t.length;o<n;o++)t[o]&&e.push(t[o]);return e},unique:function(t){for(var e=[],o=0,n=t.length;o<n;o++)w(e,t[o])||e.push(t[o]);return e}};var S=String.fromCharCode(160);function x(t){return t&&r()(t).hasClass("note-editable")}function T(t){return t=t.toUpperCase(),function(e){return e&&e.nodeName.toUpperCase()===t}}function E(t){return t&&3===t.nodeType}function P(t){return t&&/^BR|^IMG|^HR|^IFRAME|^BUTTON|^INPUT|^AUDIO|^VIDEO|^EMBED/.test(t.nodeName.toUpperCase())}function N(t){return!x(t)&&(t&&/^DIV|^P|^LI|^H[1-7]/.test(t.nodeName.toUpperCase()))}var $=T("PRE"),I=T("LI");var R=T("TABLE"),A=T("DATA");function L(t){return!(B(t)||F(t)||D(t)||N(t)||R(t)||j(t)||A(t))}function F(t){return t&&/^UL|^OL/.test(t.nodeName.toUpperCase())}var D=T("HR");function H(t){return t&&/^TD|^TH/.test(t.nodeName.toUpperCase())}var j=T("BLOCKQUOTE");function B(t){return H(t)||j(t)||x(t)}var O=T("A");var z=T("BODY");var M=m.isMSIE&&m.browserVersion<11?"&nbsp;":"<br>";function U(t){return E(t)?t.nodeValue.length:t?t.childNodes.length:0}function W(t){var e=U(t);return 0===e||(!E(t)&&1===e&&t.innerHTML===M||!(!C.all(t.childNodes,E)||""!==t.innerHTML))}function K(t){P(t)||U(t)||(t.innerHTML=M)}function q(t,e){for(;t;){if(e(t))return t;if(x(t))break;t=t.parentNode}return null}function V(t,e){e=e||g.fail;var o=[];return q(t,(function(t){return x(t)||o.push(t),e(t)})),o}function _(t,e){e=e||g.fail;for(var o=[];t&&!e(t);)o.push(t),t=t.nextSibling;return o}function G(t,e){var o=e.nextSibling,n=e.parentNode;return o?n.insertBefore(t,o):n.appendChild(t),t}function Z(t,e,o){return r().each(e,(function(e,n){!o&&I(t)&&null===t.firstChild&&F(n)&&t.appendChild(ut("br")),t.appendChild(n)})),t}function Y(t){return 0===t.offset}function X(t){return t.offset===U(t.node)}function Q(t){return Y(t)||X(t)}function J(t,e){for(;t&&t!==e;){if(0!==et(t))return!1;t=t.parentNode}return!0}function tt(t,e){if(!e)return!1;for(;t&&t!==e;){if(et(t)!==U(t.parentNode)-1)return!1;t=t.parentNode}return!0}function et(t){for(var e=0;t=t.previousSibling;)e+=1;return e}function ot(t){return!!(t&&t.childNodes&&t.childNodes.length)}function nt(t,e){var o,n;if(0===t.offset){if(x(t.node))return null;o=t.node.parentNode,n=et(t.node)}else ot(t.node)?n=U(o=t.node.childNodes[t.offset-1]):(o=t.node,n=e?0:t.offset-1);return{node:o,offset:n}}function it(t,e){var o,n;if(U(t.node)===t.offset){if(x(t.node))return null;var i=at(t.node);i?(o=i,n=0):(o=t.node.parentNode,n=et(t.node)+1)}else ot(t.node)?(o=t.node.childNodes[t.offset],n=0):(o=t.node,n=e?U(t.node):t.offset+1);return{node:o,offset:n}}function rt(t,e){var o,n=0;if(U(t.node)===t.offset){if(x(t.node))return null;o=t.node.parentNode,n=et(t.node)+1,x(o)&&(o=t.node.nextSibling,n=0)}else ot(t.node)?(o=t.node.childNodes[t.offset],n=0):(o=t.node,n=e?U(t.node):t.offset+1);return{node:o,offset:n}}function at(t){if(t.nextSibling&&t.parent===t.nextSibling.parent)return E(t.nextSibling)?t.nextSibling:at(t.nextSibling)}function st(t,e){return t.node===e.node&&t.offset===e.offset}function lt(t,e){var o=e&&e.isSkipPaddingBlankHTML,n=e&&e.isNotSplitEdgePoint,i=e&&e.isDiscardEmptySplits;if(i&&(o=!0),Q(t)&&(E(t.node)||n)){if(Y(t))return t.node;if(X(t))return t.node.nextSibling}if(E(t.node))return t.node.splitText(t.offset);var r=_(t.node.childNodes[t.offset]),a=G(t.node.cloneNode(!1),t.node);return Z(a,r),o||(K(t.node),K(a)),i&&(W(t.node)&&dt(t.node),W(a))?(dt(a),t.node.nextSibling):a}function ct(t,e,o){var n=V(e.node,g.eq(t));if(!n.length)return null;if(1===n.length)return lt(e,o);if(n.length>2){var i=n.slice(0,n.length-1).find((function(t){return t.nextSibling}));if(i&&0!=e.offset&&X(e)){var r,a=i.nextSibling;1==a.nodeType?(n=V(r=a.childNodes[0],g.eq(t)),e={node:r,offset:0}):3!=a.nodeType||a.data.match(/[\n\r]/g)||(n=V(r=a,g.eq(t)),e={node:r,offset:0})}}return n.reduce((function(t,n){return t===e.node&&(t=lt(e,o)),lt({node:n,offset:t?et(t):U(n)},o)}))}function ut(t){return document.createElement(t)}function dt(t,e){if(t&&t.parentNode){if(t.removeNode)return t.removeNode(e);var o=t.parentNode;if(!e){for(var n=[],i=0,r=t.childNodes.length;i<r;i++)n.push(t.childNodes[i]);for(var a=0,s=n.length;a<s;a++)o.insertBefore(n[a],t)}o.removeChild(t)}}var ft=T("TEXTAREA");function ht(t,e){var o=ft(t[0])?t.val():t.html();return e?o.replace(/[\n\r]/g,""):o}const pt={NBSP_CHAR:S,ZERO_WIDTH_NBSP_CHAR:"\ufeff",blank:M,emptyPara:"<p>".concat(M,"</p>"),makePredByNodeName:T,isEditable:x,isControlSizing:function(t){return t&&r()(t).hasClass("note-control-sizing")},isText:E,isElement:function(t){return t&&1===t.nodeType},isVoid:P,isPara:N,isPurePara:function(t){return N(t)&&!I(t)},isHeading:function(t){return t&&/^H[1-7]/.test(t.nodeName.toUpperCase())},isInline:L,isBlock:g.not(L),isBodyInline:function(t){return L(t)&&!q(t,N)},isBody:z,isParaInline:function(t){return L(t)&&!!q(t,N)},isPre:$,isList:F,isTable:R,isData:A,isCell:H,isBlockquote:j,isBodyContainer:B,isAnchor:O,isDiv:T("DIV"),isLi:I,isBR:T("BR"),isSpan:T("SPAN"),isB:T("B"),isU:T("U"),isS:T("S"),isI:T("I"),isImg:T("IMG"),isTextarea:ft,deepestChildIsEmpty:function(t){do{if(null===t.firstElementChild||""===t.firstElementChild.innerHTML)break}while(t=t.firstElementChild);return W(t)},isEmpty:W,isEmptyAnchor:g.and(O,W),isClosestSibling:function(t,e){return t.nextSibling===e||t.previousSibling===e},withClosestSiblings:function(t,e){e=e||g.ok;var o=[];return t.previousSibling&&e(t.previousSibling)&&o.push(t.previousSibling),o.push(t),t.nextSibling&&e(t.nextSibling)&&o.push(t.nextSibling),o},nodeLength:U,isLeftEdgePoint:Y,isRightEdgePoint:X,isEdgePoint:Q,isLeftEdgeOf:J,isRightEdgeOf:tt,isLeftEdgePointOf:function(t,e){return Y(t)&&J(t.node,e)},isRightEdgePointOf:function(t,e){return X(t)&&tt(t.node,e)},prevPoint:nt,nextPoint:it,nextPointWithEmptyNode:rt,isSamePoint:st,isVisiblePoint:function(t){if(E(t.node)||!ot(t.node)||W(t.node))return!0;var e=t.node.childNodes[t.offset-1],o=t.node.childNodes[t.offset];return!((e&&!P(e)||o&&!P(o))&&!R(o))},prevPointUntil:function(t,e){for(;t;){if(e(t))return t;t=nt(t)}return null},nextPointUntil:function(t,e){for(;t;){if(e(t))return t;t=it(t)}return null},isCharPoint:function(t){if(!E(t.node))return!1;var e=t.node.nodeValue.charAt(t.offset-1);return e&&" "!==e&&e!==S},isSpacePoint:function(t){if(!E(t.node))return!1;var e=t.node.nodeValue.charAt(t.offset-1);return" "===e||e===S},walkPoint:function(t,e,o,n){for(var i=t;i&&i.node&&(o(i),!st(i,e));){i=rt(i,n&&t.node!==i.node&&e.node!==i.node)}},ancestor:q,singleChildAncestor:function(t,e){for(t=t.parentNode;t&&1===U(t);){if(e(t))return t;if(x(t))break;t=t.parentNode}return null},listAncestor:V,lastAncestor:function(t,e){var o=V(t);return C.last(o.filter(e))},listNext:_,listPrev:function(t,e){e=e||g.fail;for(var o=[];t&&!e(t);)o.push(t),t=t.previousSibling;return o},listDescendant:function(t,e){var o=[];return e=e||g.ok,function n(i){t!==i&&e(i)&&o.push(i);for(var r=0,a=i.childNodes.length;r<a;r++)n(i.childNodes[r])}(t),o},commonAncestor:function(t,e){for(var o=V(t),n=e;n;n=n.parentNode)if(o.indexOf(n)>-1)return n;return null},wrap:function(t,e){var o=t.parentNode,n=r()("<"+e+">")[0];return o.insertBefore(n,t),n.appendChild(t),n},insertAfter:G,appendChildNodes:Z,position:et,hasChildren:ot,makeOffsetPath:function(t,e){return V(e,g.eq(t)).map(et).reverse()},fromOffsetPath:function(t,e){for(var o=t,n=0,i=e.length;n<i;n++)o=o.childNodes.length<=e[n]?o.childNodes[o.childNodes.length-1]:o.childNodes[e[n]];return o},splitTree:ct,splitPoint:function(t,e){var o,n,i=e?N:B,r=V(t.node,i),a=C.last(r)||t.node;i(a)?(o=r[r.length-2],n=a):n=(o=a).parentNode;var s=o&&ct(o,t,{isSkipPaddingBlankHTML:e,isNotSplitEdgePoint:e});return s||n!==t.node||(s=t.node.childNodes[t.offset]),{rightNode:s,container:n}},create:ut,createText:function(t){return document.createTextNode(t)},remove:dt,removeWhile:function(t,e){for(;t&&!x(t)&&e(t);){var o=t.parentNode;dt(t),t=o}},replace:function(t,e){if(t.nodeName.toUpperCase()===e.toUpperCase())return t;var o=ut(e);return t.style.cssText&&(o.style.cssText=t.style.cssText),Z(o,C.from(t.childNodes)),G(o,t),dt(t),o},html:function(t,e){var o=ht(t);if(e){o=(o=o.replace(/<(\/?)(\b(?!!)[^>\s]*)(.*?)(\s*\/?>)/g,(function(t,e,o){o=o.toUpperCase();var n=/^DIV|^TD|^TH|^P|^LI|^H[1-7]/.test(o)&&!!e,i=/^BLOCKQUOTE|^TABLE|^TBODY|^TR|^HR|^UL|^OL/.test(o);return t+(n||i?"\n":"")}))).trim()}return o},value:ht,posFromPlaceholder:function(t){var e=r()(t),o=e.offset(),n=e.outerHeight(!0);return{left:o.left,top:o.top+n}},attachEvents:function(t,e){Object.keys(e).forEach((function(o){t.on(o,e[o])}))},detachEvents:function(t,e){Object.keys(e).forEach((function(o){t.off(o,e[o])}))},isCustomStyleTag:function(t){return t&&!E(t)&&C.contains(t.classList,"note-styletag")}};function mt(t){return mt="function"==typeof Symbol&&"symbol"==typeof Symbol.iterator?function(t){return typeof t}:function(t){return t&&"function"==typeof Symbol&&t.constructor===Symbol&&t!==Symbol.prototype?"symbol":typeof t},mt(t)}function vt(t,e){for(var o=0;o<e.length;o++){var n=e[o];n.enumerable=n.enumerable||!1,n.configurable=!0,"value"in n&&(n.writable=!0),Object.defineProperty(t,gt(n.key),n)}}function gt(t){var e=function(t,e){if("object"!=mt(t)||!t)return t;var o=t[Symbol.toPrimitive];if(void 0!==o){var n=o.call(t,e||"default");if("object"!=mt(n))return n;throw new TypeError("@@toPrimitive must return a primitive value.")}return("string"===e?String:Number)(t)}(t,"string");return"symbol"==mt(e)?e:e+""}var bt=function(){return t=function t(e,o){!function(t,e){if(!(t instanceof e))throw new TypeError("Cannot call a class as a function")}(this,t),this.$note=e,this.memos={},this.modules={},this.layoutInfo={},this.options=r().extend(!0,{},o),r().summernote.ui=r().summernote.ui_template(this.options),this.ui=r().summernote.ui,this.initialize()},e=[{key:"initialize",value:function(){return this.layoutInfo=this.ui.createLayout(this.$note),this._initialize(),this.$note.hide(),this}},{key:"destroy",value:function(){this._destroy(),this.$note.removeData("summernote"),this.ui.removeLayout(this.$note,this.layoutInfo)}},{key:"reset",value:function(){var t=this.isDisabled();this.code(pt.emptyPara),this._destroy(),this._initialize(),t&&this.disable()}},{key:"_initialize",value:function(){var t=this;this.options.id=g.uniqueId(r().now()),this.options.container=this.options.container||this.layoutInfo.editor;var e=r().extend({},this.options.buttons);Object.keys(e).forEach((function(o){t.memo("button."+o,e[o])}));var o=r().extend({},this.options.modules,r().summernote.plugins||{});Object.keys(o).forEach((function(e){t.module(e,o[e],!0)})),Object.keys(this.modules).forEach((function(e){t.initializeModule(e)}))}},{key:"_destroy",value:function(){var t=this;Object.keys(this.modules).reverse().forEach((function(e){t.removeModule(e)})),Object.keys(this.memos).forEach((function(e){t.removeMemo(e)})),this.triggerEvent("destroy",this)}},{key:"code",value:function(t){var e=this.invoke("codeview.isActivated");if(void 0===t)return this.invoke("codeview.sync"),e?this.layoutInfo.codable.val():this.layoutInfo.editable.html();e?this.invoke("codeview.sync",t):this.layoutInfo.editable.html(t),this.$note.val(t),this.triggerEvent("change",t,this.layoutInfo.editable)}},{key:"isDisabled",value:function(){return"false"===this.layoutInfo.editable.attr("contenteditable")}},{key:"enable",value:function(){this.layoutInfo.editable.attr("contenteditable",!0),this.invoke("toolbar.activate",!0),this.triggerEvent("disable",!1),this.options.editing=!0}},{key:"disable",value:function(){this.invoke("codeview.isActivated")&&this.invoke("codeview.deactivate"),this.layoutInfo.editable.attr("contenteditable",!1),this.options.editing=!1,this.invoke("toolbar.deactivate",!0),this.triggerEvent("disable",!0)}},{key:"triggerEvent",value:function(){var t=C.head(arguments),e=C.tail(C.from(arguments)),o=this.options.callbacks[g.namespaceToCamel(t,"on")];o&&o.apply(this.$note[0],e),this.$note.trigger("summernote."+t,e)}},{key:"initializeModule",value:function(t){var e=this.modules[t];e.shouldInitialize=e.shouldInitialize||g.ok,e.shouldInitialize()&&(e.initialize&&e.initialize(),e.events&&pt.attachEvents(this.$note,e.events))}},{key:"module",value:function(t,e,o){if(1===arguments.length)return this.modules[t];this.modules[t]=new e(this),o||this.initializeModule(t)}},{key:"removeModule",value:function(t){var e=this.modules[t];e.shouldInitialize()&&(e.events&&pt.detachEvents(this.$note,e.events),e.destroy&&e.destroy()),delete this.modules[t]}},{key:"memo",value:function(t,e){if(1===arguments.length)return this.memos[t];this.memos[t]=e}},{key:"removeMemo",value:function(t){this.memos[t]&&this.memos[t].destroy&&this.memos[t].destroy(),delete this.memos[t]}},{key:"createInvokeHandlerAndUpdateState",value:function(t,e){var o=this;return function(n){o.createInvokeHandler(t,e)(n),o.invoke("buttons.updateCurrentStyle")}}},{key:"createInvokeHandler",value:function(t,e){var o=this;return function(n){n.preventDefault();var i=r()(n.target);o.invoke(t,e||i.closest("[data-value]").data("value"),i)}}},{key:"invoke",value:function(){var t=C.head(arguments),e=C.tail(C.from(arguments)),o=t.split("."),n=o.length>1,i=n&&C.head(o),r=n?C.last(o):C.head(o),a=this.modules[i||"editor"];return!i&&this[r]?this[r].apply(this,e):a&&a[r]&&a.shouldInitialize()?a[r].apply(a,e):void 0}}],e&&vt(t.prototype,e),o&&vt(t,o),Object.defineProperty(t,"prototype",{writable:!1}),t;var t,e,o}();function yt(t){return yt="function"==typeof Symbol&&"symbol"==typeof Symbol.iterator?function(t){return typeof t}:function(t){return t&&"function"==typeof Symbol&&t.constructor===Symbol&&t!==Symbol.prototype?"symbol":typeof t},yt(t)}function kt(t){return kt="function"==typeof Symbol&&"symbol"==typeof Symbol.iterator?function(t){return typeof t}:function(t){return t&&"function"==typeof Symbol&&t.constructor===Symbol&&t!==Symbol.prototype?"symbol":typeof t},kt(t)}function wt(t,e){for(var o=0;o<e.length;o++){var n=e[o];n.enumerable=n.enumerable||!1,n.configurable=!0,"value"in n&&(n.writable=!0),Object.defineProperty(t,Ct(n.key),n)}}function Ct(t){var e=function(t,e){if("object"!=kt(t)||!t)return t;var o=t[Symbol.toPrimitive];if(void 0!==o){var n=o.call(t,e||"default");if("object"!=kt(n))return n;throw new TypeError("@@toPrimitive must return a primitive value.")}return("string"===e?String:Number)(t)}(t,"string");return"symbol"==kt(e)?e:e+""}function St(t,e){var o,n,i=t.parentElement(),r=document.body.createTextRange(),a=C.from(i.childNodes);for(o=0;o<a.length;o++)if(!pt.isText(a[o])){if(r.moveToElementText(a[o]),r.compareEndPoints("StartToStart",t)>=0)break;n=a[o]}if(0!==o&&pt.isText(a[o-1])){var s=document.body.createTextRange(),l=null;s.moveToElementText(n||i),s.collapse(!n),l=n?n.nextSibling:i.firstChild;var c=t.duplicate();c.setEndPoint("StartToStart",s);for(var u=c.text.replace(/[\r\n]/g,"").length;u>l.nodeValue.length&&l.nextSibling;)u-=l.nodeValue.length,l=l.nextSibling;l.nodeValue;e&&l.nextSibling&&pt.isText(l.nextSibling)&&u===l.nodeValue.length&&(u-=l.nodeValue.length,l=l.nextSibling),i=l,o=u}return{cont:i,offset:o}}function xt(t){var e=document.body.createTextRange(),o=function t(e,o){var n,i;if(pt.isText(e)){var r=pt.listPrev(e,g.not(pt.isText)),a=C.last(r).previousSibling;n=a||e.parentNode,o+=C.sum(C.tail(r),pt.nodeLength),i=!a}else{if(n=e.childNodes[o]||e,pt.isText(n))return t(n,0);o=0,i=!1}return{node:n,collapseToStart:i,offset:o}}(t.node,t.offset);return e.moveToElementText(o.node),e.collapse(o.collapseToStart),e.moveStart("character",o.offset),e}r().fn.extend({summernote:function(){var t=yt(C.head(arguments)),e="string"===t,o="object"===t,n=r().extend({},r().summernote.options,o?C.head(arguments):{});n.langInfo=r().extend(!0,{},r().summernote.lang["en-US"],r().summernote.lang[n.lang]),n.icons=r().extend(!0,{},r().summernote.options.icons,n.icons),n.tooltip="auto"===n.tooltip?!m.isSupportTouch:n.tooltip,this.each((function(t,e){var o=r()(e);if(!o.data("summernote")){var i=new bt(o,n);o.data("summernote",i),o.data("summernote").triggerEvent("init",i.layoutInfo)}}));var i=this.first();if(i.length){var a=i.data("summernote");if(e)return a.invoke.apply(a,C.from(arguments));n.focus&&a.invoke("editor.focus")}return this}});var Tt=function(){function t(e,o,n,i){!function(t,e){if(!(t instanceof e))throw new TypeError("Cannot call a class as a function")}(this,t),this.sc=e,this.so=o,this.ec=n,this.eo=i,this.isOnEditable=this.makeIsOn(pt.isEditable),this.isOnList=this.makeIsOn(pt.isList),this.isOnAnchor=this.makeIsOn(pt.isAnchor),this.isOnCell=this.makeIsOn(pt.isCell),this.isOnData=this.makeIsOn(pt.isData)}return e=t,o=[{key:"nativeRange",value:function(){if(m.isW3CRangeSupport){var t=document.createRange();return t.setStart(this.sc,this.so),t.setEnd(this.ec,this.eo),t}var e=xt({node:this.sc,offset:this.so});return e.setEndPoint("EndToEnd",xt({node:this.ec,offset:this.eo})),e}},{key:"getPoints",value:function(){return{sc:this.sc,so:this.so,ec:this.ec,eo:this.eo}}},{key:"getStartPoint",value:function(){return{node:this.sc,offset:this.so}}},{key:"getEndPoint",value:function(){return{node:this.ec,offset:this.eo}}},{key:"select",value:function(){var t=this.nativeRange();if(m.isW3CRangeSupport){var e=document.getSelection();e.rangeCount>0&&e.removeAllRanges(),e.addRange(t)}else t.select();return this}},{key:"scrollIntoView",value:function(t){var e=r()(t).height();return t.scrollTop+e<this.sc.offsetTop&&(t.scrollTop+=Math.abs(t.scrollTop+e-this.sc.offsetTop)),this}},{key:"normalize",value:function(){var e=function(t,e){if(!t)return t;if(pt.isVisiblePoint(t)&&(!pt.isEdgePoint(t)||pt.isRightEdgePoint(t)&&!e||pt.isLeftEdgePoint(t)&&e||pt.isRightEdgePoint(t)&&e&&pt.isVoid(t.node.nextSibling)||pt.isLeftEdgePoint(t)&&!e&&pt.isVoid(t.node.previousSibling)||pt.isBlock(t.node)&&pt.isEmpty(t.node)))return t;var o=pt.ancestor(t.node,pt.isBlock),n=!1;if(!n){var i=pt.prevPoint(t)||{node:null};n=(pt.isLeftEdgePointOf(t,o)||pt.isVoid(i.node))&&!e}var r=!1;if(!r){var a=pt.nextPoint(t)||{node:null};r=(pt.isRightEdgePointOf(t,o)||pt.isVoid(a.node))&&e}if(n||r){if(pt.isVisiblePoint(t))return t;e=!e}return(e?pt.nextPointUntil(pt.nextPoint(t),pt.isVisiblePoint):pt.prevPointUntil(pt.prevPoint(t),pt.isVisiblePoint))||t},o=e(this.getEndPoint(),!1),n=this.isCollapsed()?o:e(this.getStartPoint(),!0);return new t(n.node,n.offset,o.node,o.offset)}},{key:"nodes",value:function(t,e){t=t||g.ok;var o=e&&e.includeAncestor,n=e&&e.fullyContains,i=this.getStartPoint(),r=this.getEndPoint(),a=[],s=[];return pt.walkPoint(i,r,(function(e){var i;pt.isEditable(e.node)||(n?(pt.isLeftEdgePoint(e)&&s.push(e.node),pt.isRightEdgePoint(e)&&C.contains(s,e.node)&&(i=e.node)):i=o?pt.ancestor(e.node,t):e.node,i&&t(i)&&a.push(i))}),!0),C.unique(a)}},{key:"commonAncestor",value:function(){return pt.commonAncestor(this.sc,this.ec)}},{key:"expand",value:function(e){var o=pt.ancestor(this.sc,e),n=pt.ancestor(this.ec,e);if(!o&&!n)return new t(this.sc,this.so,this.ec,this.eo);var i=this.getPoints();return o&&(i.sc=o,i.so=0),n&&(i.ec=n,i.eo=pt.nodeLength(n)),new t(i.sc,i.so,i.ec,i.eo)}},{key:"collapse",value:function(e){return e?new t(this.sc,this.so,this.sc,this.so):new t(this.ec,this.eo,this.ec,this.eo)}},{key:"splitText",value:function(){var e=this.sc===this.ec,o=this.getPoints();return pt.isText(this.ec)&&!pt.isEdgePoint(this.getEndPoint())&&this.ec.splitText(this.eo),pt.isText(this.sc)&&!pt.isEdgePoint(this.getStartPoint())&&(o.sc=this.sc.splitText(this.so),o.so=0,e&&(o.ec=o.sc,o.eo=this.eo-this.so)),new t(o.sc,o.so,o.ec,o.eo)}},{key:"deleteContents",value:function(){if(this.isCollapsed())return this;var e=this.splitText(),o=e.nodes(null,{fullyContains:!0}),n=pt.prevPointUntil(e.getStartPoint(),(function(t){return!C.contains(o,t.node)})),i=[];return r().each(o,(function(t,e){var o=e.parentNode;n.node!==o&&1===pt.nodeLength(o)&&i.push(o),pt.remove(e,!1)})),r().each(i,(function(t,e){pt.remove(e,!1)})),new t(n.node,n.offset,n.node,n.offset).normalize()}},{key:"makeIsOn",value:function(t){return function(){var e=pt.ancestor(this.sc,t);return!!e&&e===pt.ancestor(this.ec,t)}}},{key:"isLeftEdgeOf",value:function(t){if(!pt.isLeftEdgePoint(this.getStartPoint()))return!1;var e=pt.ancestor(this.sc,t);return e&&pt.isLeftEdgeOf(this.sc,e)}},{key:"isCollapsed",value:function(){return this.sc===this.ec&&this.so===this.eo}},{key:"wrapBodyInlineWithPara",value:function(){if(pt.isBodyContainer(this.sc)&&pt.isEmpty(this.sc))return this.sc.innerHTML=pt.emptyPara,new t(this.sc.firstChild,0,this.sc.firstChild,0);var e,o=this.normalize();if(pt.isParaInline(this.sc)||pt.isPara(this.sc))return o;if(pt.isInline(o.sc)){var n=pt.listAncestor(o.sc,g.not(pt.isInline));e=C.last(n),pt.isInline(e)||(e=n[n.length-2]||o.sc.childNodes[o.so])}else e=o.sc.childNodes[o.so>0?o.so-1:0];if(e){var i=pt.listPrev(e,pt.isParaInline).reverse();if((i=i.concat(pt.listNext(e.nextSibling,pt.isParaInline))).length){var r=pt.wrap(C.head(i),"p");pt.appendChildNodes(r,C.tail(i))}}return this.normalize()}},{key:"insertNode",value:function(t){var e=arguments.length>1&&void 0!==arguments[1]&&arguments[1],o=this;(pt.isText(t)||pt.isInline(t))&&(o=this.wrapBodyInlineWithPara().deleteContents());var n=pt.splitPoint(o.getStartPoint(),pt.isInline(t));return n.rightNode?(n.rightNode.parentNode.insertBefore(t,n.rightNode),pt.isEmpty(n.rightNode)&&(e||pt.isPara(t))&&n.rightNode.parentNode.removeChild(n.rightNode)):n.container.appendChild(t),t}},{key:"pasteHTML",value:function(t){t=((t||"")+"").trim(t);var e=r()("<div></div>").html(t)[0],o=C.from(e.childNodes),n=this,i=!1;return n.so>=0&&(o=o.reverse(),i=!0),o=o.map((function(t){return n.insertNode(t,!pt.isInline(t))})),i&&(o=o.reverse()),o}},{key:"toString",value:function(){var t=this.nativeRange();return m.isW3CRangeSupport?t.toString():t.text}},{key:"getWordRange",value:function(e){var o=this.getEndPoint();if(!pt.isCharPoint(o))return this;var n=pt.prevPointUntil(o,(function(t){return!pt.isCharPoint(t)}));return e&&(o=pt.nextPointUntil(o,(function(t){return!pt.isCharPoint(t)}))),new t(n.node,n.offset,o.node,o.offset)}},{key:"getWordsRange",value:function(e){var o=this.getEndPoint(),n=function(t){return!pt.isCharPoint(t)&&!pt.isSpacePoint(t)};if(n(o))return this;var i=pt.prevPointUntil(o,n);return e&&(o=pt.nextPointUntil(o,n)),new t(i.node,i.offset,o.node,o.offset)}},{key:"getWordsMatchRange",value:function(e){var o=this.getEndPoint(),n=pt.prevPointUntil(o,(function(n){if(!pt.isCharPoint(n)&&!pt.isSpacePoint(n))return!0;var i=new t(n.node,n.offset,o.node,o.offset),r=e.exec(i.toString());return r&&0===r.index})),i=new t(n.node,n.offset,o.node,o.offset),r=i.toString(),a=e.exec(r);return a&&a[0].length===r.length?i:null}},{key:"bookmark",value:function(t){return{s:{path:pt.makeOffsetPath(t,this.sc),offset:this.so},e:{path:pt.makeOffsetPath(t,this.ec),offset:this.eo}}}},{key:"paraBookmark",value:function(t){return{s:{path:C.tail(pt.makeOffsetPath(C.head(t),this.sc)),offset:this.so},e:{path:C.tail(pt.makeOffsetPath(C.last(t),this.ec)),offset:this.eo}}}},{key:"getClientRects",value:function(){return this.nativeRange().getClientRects()}}],o&&wt(e.prototype,o),n&&wt(e,n),Object.defineProperty(e,"prototype",{writable:!1}),e;var e,o,n}();const Et={create:function(t,e,o,n){if(4===arguments.length)return new Tt(t,e,o,n);if(2===arguments.length)return new Tt(t,e,o=t,n=e);var i=this.createFromSelection();if(!i&&1===arguments.length){var r=arguments[0];return pt.isEditable(r)&&(r=r.lastChild),this.createFromBodyElement(r,pt.emptyPara===arguments[0].innerHTML)}return i},createFromBodyElement:function(t){var e=arguments.length>1&&void 0!==arguments[1]&&arguments[1];return this.createFromNode(t).collapse(e)},createFromSelection:function(){var t,e,o,n;if(m.isW3CRangeSupport){var i=document.getSelection();if(!i||0===i.rangeCount)return null;if(pt.isBody(i.anchorNode))return null;var r=i.getRangeAt(0);t=r.startContainer,e=r.startOffset,o=r.endContainer,n=r.endOffset}else{var a=document.selection.createRange(),s=a.duplicate();s.collapse(!1);var l=a;l.collapse(!0);var c=St(l,!0),u=St(s,!1);pt.isText(c.node)&&pt.isLeftEdgePoint(c)&&pt.isTextNode(u.node)&&pt.isRightEdgePoint(u)&&u.node.nextSibling===c.node&&(c=u),t=c.cont,e=c.offset,o=u.cont,n=u.offset}return new Tt(t,e,o,n)},createFromNode:function(t){var e=t,o=0,n=t,i=pt.nodeLength(n);return pt.isVoid(e)&&(o=pt.listPrev(e).length-1,e=e.parentNode),pt.isBR(n)?(i=pt.listPrev(n).length-1,n=n.parentNode):pt.isVoid(n)&&(i=pt.listPrev(n).length,n=n.parentNode),this.create(e,o,n,i)},createFromNodeBefore:function(t){return this.createFromNode(t).collapse(!0)},createFromNodeAfter:function(t){return this.createFromNode(t).collapse()},createFromBookmark:function(t,e){var o=pt.fromOffsetPath(t,e.s.path),n=e.s.offset,i=pt.fromOffsetPath(t,e.e.path),r=e.e.offset;return new Tt(o,n,i,r)},createFromParaBookmark:function(t,e){var o=t.s.offset,n=t.e.offset,i=pt.fromOffsetPath(C.head(e),t.s.path),r=pt.fromOffsetPath(C.last(e),t.e.path);return new Tt(i,o,r,n)}};var Pt={BACKSPACE:8,TAB:9,ENTER:13,ESCAPE:27,SPACE:32,DELETE:46,LEFT:37,UP:38,RIGHT:39,DOWN:40,NUM0:48,NUM1:49,NUM2:50,NUM3:51,NUM4:52,NUM5:53,NUM6:54,NUM7:55,NUM8:56,B:66,E:69,I:73,J:74,K:75,L:76,R:82,S:83,U:85,V:86,Y:89,Z:90,SLASH:191,LEFTBRACKET:219,BACKSLASH:220,RIGHTBRACKET:221,HOME:36,END:35,PAGEUP:33,PAGEDOWN:34};const Nt={isEdit:function(t){return C.contains([Pt.BACKSPACE,Pt.TAB,Pt.ENTER,Pt.SPACE,Pt.DELETE],t)},isRemove:function(t){return C.contains([Pt.BACKSPACE,Pt.DELETE],t)},isMove:function(t){return C.contains([Pt.LEFT,Pt.UP,Pt.RIGHT,Pt.DOWN],t)},isNavigation:function(t){return C.contains([Pt.HOME,Pt.END,Pt.PAGEUP,Pt.PAGEDOWN],t)},nameFromCode:g.invertObject(Pt),code:Pt};function $t(t){return $t="function"==typeof Symbol&&"symbol"==typeof Symbol.iterator?function(t){return typeof t}:function(t){return t&&"function"==typeof Symbol&&t.constructor===Symbol&&t!==Symbol.prototype?"symbol":typeof t},$t(t)}function It(t,e){for(var o=0;o<e.length;o++){var n=e[o];n.enumerable=n.enumerable||!1,n.configurable=!0,"value"in n&&(n.writable=!0),Object.defineProperty(t,Rt(n.key),n)}}function Rt(t){var e=function(t,e){if("object"!=$t(t)||!t)return t;var o=t[Symbol.toPrimitive];if(void 0!==o){var n=o.call(t,e||"default");if("object"!=$t(n))return n;throw new TypeError("@@toPrimitive must return a primitive value.")}return("string"===e?String:Number)(t)}(t,"string");return"symbol"==$t(e)?e:e+""}var At=function(){return t=function t(e){!function(t,e){if(!(t instanceof e))throw new TypeError("Cannot call a class as a function")}(this,t),this.stack=[],this.stackOffset=-1,this.context=e,this.$editable=e.layoutInfo.editable,this.editable=this.$editable[0]},(e=[{key:"makeSnapshot",value:function(){var t=Et.create(this.editable);return{contents:this.$editable.html(),bookmark:t&&t.isOnEditable()?t.bookmark(this.editable):{s:{path:[],offset:0},e:{path:[],offset:0}}}}},{key:"applySnapshot",value:function(t){null!==t.contents&&this.$editable.html(t.contents),null!==t.bookmark&&Et.createFromBookmark(this.editable,t.bookmark).select()}},{key:"rewind",value:function(){this.$editable.html()!==this.stack[this.stackOffset].contents&&this.recordUndo(),this.stackOffset=0,this.applySnapshot(this.stack[this.stackOffset])}},{key:"commit",value:function(){this.stack=[],this.stackOffset=-1,this.recordUndo()}},{key:"reset",value:function(){this.stack=[],this.stackOffset=-1,this.$editable.html(""),this.recordUndo()}},{key:"undo",value:function(){this.$editable.html()!==this.stack[this.stackOffset].contents&&this.recordUndo(),this.stackOffset>0&&(this.stackOffset--,this.applySnapshot(this.stack[this.stackOffset]))}},{key:"redo",value:function(){this.stack.length-1>this.stackOffset&&(this.stackOffset++,this.applySnapshot(this.stack[this.stackOffset]))}},{key:"recordUndo",value:function(){this.stackOffset++,this.stack.length>this.stackOffset&&(this.stack=this.stack.slice(0,this.stackOffset)),this.stack.push(this.makeSnapshot()),this.stack.length>this.context.options.historyLimit&&(this.stack.shift(),this.stackOffset-=1)}}])&&It(t.prototype,e),o&&It(t,o),Object.defineProperty(t,"prototype",{writable:!1}),t;var t,e,o}();function Lt(t){return Lt="function"==typeof Symbol&&"symbol"==typeof Symbol.iterator?function(t){return typeof t}:function(t){return t&&"function"==typeof Symbol&&t.constructor===Symbol&&t!==Symbol.prototype?"symbol":typeof t},Lt(t)}function Ft(t,e){for(var o=0;o<e.length;o++){var n=e[o];n.enumerable=n.enumerable||!1,n.configurable=!0,"value"in n&&(n.writable=!0),Object.defineProperty(t,Dt(n.key),n)}}function Dt(t){var e=function(t,e){if("object"!=Lt(t)||!t)return t;var o=t[Symbol.toPrimitive];if(void 0!==o){var n=o.call(t,e||"default");if("object"!=Lt(n))return n;throw new TypeError("@@toPrimitive must return a primitive value.")}return("string"===e?String:Number)(t)}(t,"string");return"symbol"==Lt(e)?e:e+""}var Ht=function(){return t=function t(){!function(t,e){if(!(t instanceof e))throw new TypeError("Cannot call a class as a function")}(this,t)},e=[{key:"jQueryCSS",value:function(t,e){var o={};return r().each(e,(function(e,n){o[n]=t.css(n)})),o}},{key:"fromNode",value:function(t){var e=this.jQueryCSS(t,["font-family","font-size","text-align","list-style-type","line-height"])||{},o=t[0].style.fontSize||e["font-size"];return e["font-size"]=parseInt(o,10),e["font-size-unit"]=o.match(/[a-z%]+$/),e}},{key:"stylePara",value:function(t,e){r().each(t.nodes(pt.isPara,{includeAncestor:!0}),(function(t,o){r()(o).css(e)}))}},{key:"styleNodes",value:function(t,e){t=t.splitText();var o=e&&e.nodeName||"SPAN",n=!(!e||!e.expandClosestSibling),i=!(!e||!e.onlyPartialContains);if(t.isCollapsed())return[t.insertNode(pt.create(o))];var a=pt.makePredByNodeName(o),s=t.nodes(pt.isText,{fullyContains:!0}).map((function(t){return pt.singleChildAncestor(t,a)||pt.wrap(t,o)}));if(n){if(i){var l=t.nodes();a=g.and(a,(function(t){return C.contains(l,t)}))}return s.map((function(t){var e=pt.withClosestSiblings(t,a),o=C.head(e),n=C.tail(e);return r().each(n,(function(t,e){pt.appendChildNodes(o,e.childNodes),pt.remove(e)})),C.head(e)}))}return s}},{key:"current",value:function(t){var e=r()(pt.isElement(t.sc)?t.sc:t.sc.parentNode),o=this.fromNode(e);try{o=r().extend(o,{"font-bold":document.queryCommandState("bold")?"bold":"normal","font-italic":document.queryCommandState("italic")?"italic":"normal","font-underline":document.queryCommandState("underline")?"underline":"normal","font-subscript":document.queryCommandState("subscript")?"subscript":"normal","font-superscript":document.queryCommandState("superscript")?"superscript":"normal","font-strikethrough":document.queryCommandState("strikethrough")?"strikethrough":"normal","font-family":document.queryCommandValue("fontname")||o["font-family"]})}catch(t){}if(t.isOnList()){var n=["circle","disc","disc-leading-zero","square"].indexOf(o["list-style-type"])>-1;o["list-style"]=n?"unordered":"ordered"}else o["list-style"]="none";var i=pt.ancestor(t.sc,pt.isPara);if(i&&i.style["line-height"])o["line-height"]=i.style.lineHeight;else{var a=parseInt(o["line-height"],10)/parseInt(o["font-size"],10);o["line-height"]=a.toFixed(1)}return o.anchor=t.isOnAnchor()&&pt.ancestor(t.sc,pt.isAnchor),o.ancestors=pt.listAncestor(t.sc,pt.isEditable),o.range=t,o}}],e&&Ft(t.prototype,e),o&&Ft(t,o),Object.defineProperty(t,"prototype",{writable:!1}),t;var t,e,o}();function jt(t){return jt="function"==typeof Symbol&&"symbol"==typeof Symbol.iterator?function(t){return typeof t}:function(t){return t&&"function"==typeof Symbol&&t.constructor===Symbol&&t!==Symbol.prototype?"symbol":typeof t},jt(t)}function Bt(t,e){for(var o=0;o<e.length;o++){var n=e[o];n.enumerable=n.enumerable||!1,n.configurable=!0,"value"in n&&(n.writable=!0),Object.defineProperty(t,Ot(n.key),n)}}function Ot(t){var e=function(t,e){if("object"!=jt(t)||!t)return t;var o=t[Symbol.toPrimitive];if(void 0!==o){var n=o.call(t,e||"default");if("object"!=jt(n))return n;throw new TypeError("@@toPrimitive must return a primitive value.")}return("string"===e?String:Number)(t)}(t,"string");return"symbol"==jt(e)?e:e+""}var zt=function(){return t=function t(){!function(t,e){if(!(t instanceof e))throw new TypeError("Cannot call a class as a function")}(this,t)},e=[{key:"insertOrderedList",value:function(t){this.toggleList("OL",t)}},{key:"insertUnorderedList",value:function(t){this.toggleList("UL",t)}},{key:"indent",value:function(t){var e=this,o=Et.create(t).wrapBodyInlineWithPara(),n=o.nodes(pt.isPara,{includeAncestor:!0}),i=C.clusterBy(n,g.peq2("parentNode"));r().each(i,(function(t,o){var n=C.head(o);if(pt.isLi(n)){var i=e.findList(n.previousSibling);i?o.map((function(t){return i.appendChild(t)})):(e.wrapList(o,n.parentNode.nodeName),o.map((function(t){return t.parentNode})).map((function(t){return e.appendToPrevious(t)})))}else r().each(o,(function(t,e){r()(e).css("marginLeft",(function(t,e){return(parseInt(e,10)||0)+25}))}))})),o.select()}},{key:"outdent",value:function(t){var e=this,o=Et.create(t).wrapBodyInlineWithPara(),n=o.nodes(pt.isPara,{includeAncestor:!0}),i=C.clusterBy(n,g.peq2("parentNode"));r().each(i,(function(t,o){var n=C.head(o);pt.isLi(n)?e.releaseList([o]):r().each(o,(function(t,e){r()(e).css("marginLeft",(function(t,e){return(e=parseInt(e,10)||0)>25?e-25:""}))}))})),o.select()}},{key:"toggleList",value:function(t,e){var o=this,n=Et.create(e).wrapBodyInlineWithPara(),i=n.nodes(pt.isPara,{includeAncestor:!0}),a=n.paraBookmark(i),s=C.clusterBy(i,g.peq2("parentNode"));if(C.find(i,pt.isPurePara)){var l=[];r().each(s,(function(e,n){l=l.concat(o.wrapList(n,t))})),i=l}else{var c=n.nodes(pt.isList,{includeAncestor:!0}).filter((function(e){return!r().nodeName(e,t)}));c.length?r().each(c,(function(e,o){pt.replace(o,t)})):i=this.releaseList(s,!0)}Et.createFromParaBookmark(a,i).select()}},{key:"wrapList",value:function(t,e){var o=C.head(t),n=C.last(t),i=pt.isList(o.previousSibling)&&o.previousSibling,r=pt.isList(n.nextSibling)&&n.nextSibling,a=i||pt.insertAfter(pt.create(e||"UL"),n);return t=t.map((function(t){return pt.isPurePara(t)?pt.replace(t,"LI"):t})),pt.appendChildNodes(a,t,!0),r&&(pt.appendChildNodes(a,C.from(r.childNodes),!0),pt.remove(r)),t}},{key:"releaseList",value:function(t,e){var o=this,n=[];return r().each(t,(function(t,i){var a=C.head(i),s=C.last(i),l=e?pt.lastAncestor(a,pt.isList):a.parentNode,c=l.parentNode;if("LI"===l.parentNode.nodeName)i.map((function(t){var e=o.findNextSiblings(t);c.nextSibling?c.parentNode.insertBefore(t,c.nextSibling):c.parentNode.appendChild(t),e.length&&(o.wrapList(e,l.nodeName),t.appendChild(e[0].parentNode))})),0===l.children.length&&c.removeChild(l),0===c.childNodes.length&&c.parentNode.removeChild(c);else{var u=l.childNodes.length>1?pt.splitTree(l,{node:s.parentNode,offset:pt.position(s)+1},{isSkipPaddingBlankHTML:!0}):null,d=pt.splitTree(l,{node:a.parentNode,offset:pt.position(a)},{isSkipPaddingBlankHTML:!0});i=e?pt.listDescendant(d,pt.isLi):C.from(d.childNodes).filter(pt.isLi),!e&&pt.isList(l.parentNode)||(i=i.map((function(t){return pt.replace(t,"P")}))),r().each(C.from(i).reverse(),(function(t,e){pt.insertAfter(e,l)}));var f=C.compact([l,d,u]);r().each(f,(function(t,e){var o=[e].concat(pt.listDescendant(e,pt.isList));r().each(o.reverse(),(function(t,e){pt.nodeLength(e)||pt.remove(e,!0)}))}))}n=n.concat(i)})),n}},{key:"appendToPrevious",value:function(t){return t.previousSibling?pt.appendChildNodes(t.previousSibling,[t]):this.wrapList([t],"LI")}},{key:"findList",value:function(t){return t?C.find(t.children,(function(t){return["OL","UL"].indexOf(t.nodeName)>-1})):null}},{key:"findNextSiblings",value:function(t){for(var e=[];t.nextSibling;)e.push(t.nextSibling),t=t.nextSibling;return e}}],e&&Bt(t.prototype,e),o&&Bt(t,o),Object.defineProperty(t,"prototype",{writable:!1}),t;var t,e,o}();function Mt(t){return Mt="function"==typeof Symbol&&"symbol"==typeof Symbol.iterator?function(t){return typeof t}:function(t){return t&&"function"==typeof Symbol&&t.constructor===Symbol&&t!==Symbol.prototype?"symbol":typeof t},Mt(t)}function Ut(t,e){for(var o=0;o<e.length;o++){var n=e[o];n.enumerable=n.enumerable||!1,n.configurable=!0,"value"in n&&(n.writable=!0),Object.defineProperty(t,Wt(n.key),n)}}function Wt(t){var e=function(t,e){if("object"!=Mt(t)||!t)return t;var o=t[Symbol.toPrimitive];if(void 0!==o){var n=o.call(t,e||"default");if("object"!=Mt(n))return n;throw new TypeError("@@toPrimitive must return a primitive value.")}return("string"===e?String:Number)(t)}(t,"string");return"symbol"==Mt(e)?e:e+""}var Kt=function(){return t=function t(e){!function(t,e){if(!(t instanceof e))throw new TypeError("Cannot call a class as a function")}(this,t),this.bullet=new zt,this.options=e.options},e=[{key:"insertTab",value:function(t,e){var o=pt.createText(new Array(e+1).join(pt.NBSP_CHAR));(t=t.deleteContents()).insertNode(o,!0),(t=Et.create(o,e)).select()}},{key:"insertParagraph",value:function(t,e){e=(e=(e=e||Et.create(t)).deleteContents()).wrapBodyInlineWithPara();var o,n=pt.ancestor(e.sc,pt.isPara);if(n){if(pt.isLi(n)&&(pt.isEmpty(n)||pt.deepestChildIsEmpty(n)))return void this.bullet.toggleList(n.parentNode.nodeName);var i=null;if(1===this.options.blockquoteBreakingLevel?i=pt.ancestor(n,pt.isBlockquote):2===this.options.blockquoteBreakingLevel&&(i=pt.lastAncestor(n,pt.isBlockquote)),i){o=r()(pt.emptyPara)[0],pt.isRightEdgePoint(e.getStartPoint())&&pt.isBR(e.sc.nextSibling)&&r()(e.sc.nextSibling).remove();var a=pt.splitTree(i,e.getStartPoint(),{isDiscardEmptySplits:!0});a?a.parentNode.insertBefore(o,a):pt.insertAfter(o,i)}else{o=pt.splitTree(n,e.getStartPoint());var s=pt.listDescendant(n,pt.isEmptyAnchor);s=s.concat(pt.listDescendant(o,pt.isEmptyAnchor)),r().each(s,(function(t,e){pt.remove(e)})),(pt.isHeading(o)||pt.isPre(o)||pt.isCustomStyleTag(o))&&pt.isEmpty(o)&&(o=pt.replace(o,"p"))}}else{var l=e.sc.childNodes[e.so];o=r()(pt.emptyPara)[0],l?e.sc.insertBefore(o,l):e.sc.appendChild(o)}Et.create(o,0).normalize().select().scrollIntoView(t)}}],e&&Ut(t.prototype,e),o&&Ut(t,o),Object.defineProperty(t,"prototype",{writable:!1}),t;var t,e,o}();function qt(t){return qt="function"==typeof Symbol&&"symbol"==typeof Symbol.iterator?function(t){return typeof t}:function(t){return t&&"function"==typeof Symbol&&t.constructor===Symbol&&t!==Symbol.prototype?"symbol":typeof t},qt(t)}function Vt(t,e){for(var o=0;o<e.length;o++){var n=e[o];n.enumerable=n.enumerable||!1,n.configurable=!0,"value"in n&&(n.writable=!0),Object.defineProperty(t,_t(n.key),n)}}function _t(t){var e=function(t,e){if("object"!=qt(t)||!t)return t;var o=t[Symbol.toPrimitive];if(void 0!==o){var n=o.call(t,e||"default");if("object"!=qt(n))return n;throw new TypeError("@@toPrimitive must return a primitive value.")}return("string"===e?String:Number)(t)}(t,"string");return"symbol"==qt(e)?e:e+""}var Gt=function t(e,o,n,i){var r={colPos:0,rowPos:0},a=[],s=[];function l(t,e,o,n,i,r,s){var l={baseRow:o,baseCell:n,isRowSpan:i,isColSpan:r,isVirtual:s};a[t]||(a[t]=[]),a[t][e]=l}function c(t,e,o,n){return{baseCell:t.baseCell,action:e,virtualTable:{rowIndex:o,cellIndex:n}}}function u(t,e){if(!a[t])return e;if(!a[t][e])return e;for(var o=e;a[t][o];)if(o++,!a[t][o])return o}function d(t,e){var o=u(t.rowIndex,e.cellIndex),n=e.colSpan>1,i=e.rowSpan>1,a=t.rowIndex===r.rowPos&&e.cellIndex===r.colPos;l(t.rowIndex,o,t,e,i,n,!1);var s=e.attributes.rowSpan?parseInt(e.attributes.rowSpan.value,10):0;if(s>1)for(var c=1;c<s;c++){var d=t.rowIndex+c;f(d,o,e,a),l(d,o,t,e,!0,n,!0)}var h=e.attributes.colSpan?parseInt(e.attributes.colSpan.value,10):0;if(h>1)for(var p=1;p<h;p++){var m=u(t.rowIndex,o+p);f(t.rowIndex,m,e,a),l(t.rowIndex,m,t,e,i,!0,!0)}}function f(t,e,o,n){t===r.rowPos&&r.colPos>=o.cellIndex&&o.cellIndex<=e&&!n&&r.colPos++}function h(e){switch(o){case t.where.Column:if(e.isColSpan)return t.resultAction.SubtractSpanCount;break;case t.where.Row:if(!e.isVirtual&&e.isRowSpan)return t.resultAction.AddCell;if(e.isRowSpan)return t.resultAction.SubtractSpanCount}return t.resultAction.RemoveCell}function p(e){switch(o){case t.where.Column:if(e.isColSpan)return t.resultAction.SumSpanCount;if(e.isRowSpan&&e.isVirtual)return t.resultAction.Ignore;break;case t.where.Row:if(e.isRowSpan)return t.resultAction.SumSpanCount;if(e.isColSpan&&e.isVirtual)return t.resultAction.Ignore}return t.resultAction.AddCell}this.getActionList=function(){for(var e=o===t.where.Row?r.rowPos:-1,i=o===t.where.Column?r.colPos:-1,l=0,u=!0;u;){var d=e>=0?e:l,f=i>=0?i:l,m=a[d];if(!m)return u=!1,s;var v=m[f];if(!v)return u=!1,s;var g=t.resultAction.Ignore;switch(n){case t.requestAction.Add:g=p(v);break;case t.requestAction.Delete:g=h(v)}s.push(c(v,g,d,f)),l++}return s},e&&e.tagName&&("td"===e.tagName.toLowerCase()||"th"===e.tagName.toLowerCase())&&(r.colPos=e.cellIndex,e.parentElement&&e.parentElement.tagName&&"tr"===e.parentElement.tagName.toLowerCase()&&(r.rowPos=e.parentElement.rowIndex)),function(){for(var t=i.rows,e=0;e<t.length;e++)for(var o=t[e].cells,n=0;n<o.length;n++)d(t[e],o[n])}()};Gt.where={Row:0,Column:1},Gt.requestAction={Add:0,Delete:1},Gt.resultAction={Ignore:0,SubtractSpanCount:1,RemoveCell:2,AddCell:3,SumSpanCount:4};var Zt=function(){return t=function t(){!function(t,e){if(!(t instanceof e))throw new TypeError("Cannot call a class as a function")}(this,t)},e=[{key:"tab",value:function(t,e){var o=pt.ancestor(t.commonAncestor(),pt.isCell),n=pt.ancestor(o,pt.isTable),i=pt.listDescendant(n,pt.isCell),r=C[e?"prev":"next"](i,o);r&&Et.create(r,0).select()}},{key:"addRow",value:function(t,e){for(var o=pt.ancestor(t.commonAncestor(),pt.isCell),n=r()(o).closest("tr"),i=this.recoverAttributes(n),a=r()("<tr"+i+"></tr>"),s=new Gt(o,Gt.where.Row,Gt.requestAction.Add,r()(n).closest("table")[0]).getActionList(),l=0;l<s.length;l++){var c=s[l],u=this.recoverAttributes(c.baseCell);switch(c.action){case Gt.resultAction.AddCell:a.append("<td"+u+">"+pt.blank+"</td>");break;case Gt.resultAction.SumSpanCount:if("top"===e&&(c.baseCell.parent?c.baseCell.closest("tr").rowIndex:0)<=n[0].rowIndex){var d=r()("<div></div>").append(r()("<td"+u+">"+pt.blank+"</td>").removeAttr("rowspan")).html();a.append(d);break}var f=parseInt(c.baseCell.rowSpan,10);f++,c.baseCell.setAttribute("rowSpan",f)}}if("top"===e)n.before(a);else{if(o.rowSpan>1){var h=n[0].rowIndex+(o.rowSpan-2);return void r()(r()(n).parent().find("tr")[h]).after(r()(a))}n.after(a)}}},{key:"addCol",value:function(t,e){var o=pt.ancestor(t.commonAncestor(),pt.isCell),n=r()(o).closest("tr");r()(n).siblings().push(n);for(var i=new Gt(o,Gt.where.Column,Gt.requestAction.Add,r()(n).closest("table")[0]).getActionList(),a=0;a<i.length;a++){var s=i[a],l=this.recoverAttributes(s.baseCell);switch(s.action){case Gt.resultAction.AddCell:"right"===e?r()(s.baseCell).after("<td"+l+">"+pt.blank+"</td>"):r()(s.baseCell).before("<td"+l+">"+pt.blank+"</td>");break;case Gt.resultAction.SumSpanCount:if("right"===e){var c=parseInt(s.baseCell.colSpan,10);c++,s.baseCell.setAttribute("colSpan",c)}else r()(s.baseCell).before("<td"+l+">"+pt.blank+"</td>")}}}},{key:"recoverAttributes",value:function(t){var e="";if(!t)return e;for(var o=t.attributes||[],n=0;n<o.length;n++)"id"!==o[n].name.toLowerCase()&&o[n].specified&&(e+=" "+o[n].name+"='"+o[n].value+"'");return e}},{key:"deleteRow",value:function(t){for(var e=pt.ancestor(t.commonAncestor(),pt.isCell),o=r()(e).closest("tr"),n=o.children("td, th").index(r()(e)),i=o[0].rowIndex,a=new Gt(e,Gt.where.Row,Gt.requestAction.Delete,r()(o).closest("table")[0]).getActionList(),s=0;s<a.length;s++)if(a[s]){var l=a[s].baseCell,c=a[s].virtualTable,u=l.rowSpan&&l.rowSpan>1,d=u?parseInt(l.rowSpan,10):0;switch(a[s].action){case Gt.resultAction.Ignore:continue;case Gt.resultAction.AddCell:var f=o.next("tr")[0];if(!f)continue;var h=o[0].cells[n];u&&(d>2?(d--,f.insertBefore(h,f.cells[n]),f.cells[n].setAttribute("rowSpan",d),f.cells[n].innerHTML=""):2===d&&(f.insertBefore(h,f.cells[n]),f.cells[n].removeAttribute("rowSpan"),f.cells[n].innerHTML=""));continue;case Gt.resultAction.SubtractSpanCount:u&&(d>2?(d--,l.setAttribute("rowSpan",d),c.rowIndex!==i&&l.cellIndex===n&&(l.innerHTML="")):2===d&&(l.removeAttribute("rowSpan"),c.rowIndex!==i&&l.cellIndex===n&&(l.innerHTML="")));continue;case Gt.resultAction.RemoveCell:continue}}o.remove()}},{key:"deleteCol",value:function(t){for(var e=pt.ancestor(t.commonAncestor(),pt.isCell),o=r()(e).closest("tr"),n=o.children("td, th").index(r()(e)),i=new Gt(e,Gt.where.Column,Gt.requestAction.Delete,r()(o).closest("table")[0]).getActionList(),a=0;a<i.length;a++)if(i[a])switch(i[a].action){case Gt.resultAction.Ignore:continue;case Gt.resultAction.SubtractSpanCount:var s=i[a].baseCell;if(s.colSpan&&s.colSpan>1){var l=s.colSpan?parseInt(s.colSpan,10):0;l>2?(l--,s.setAttribute("colSpan",l),s.cellIndex===n&&(s.innerHTML="")):2===l&&(s.removeAttribute("colSpan"),s.cellIndex===n&&(s.innerHTML=""))}continue;case Gt.resultAction.RemoveCell:pt.remove(i[a].baseCell,!0);continue}}},{key:"createTable",value:function(t,e,o){for(var n,i=[],a=0;a<t;a++)i.push("<td>"+pt.blank+"</td>");n=i.join("");for(var s,l=[],c=0;c<e;c++)l.push("<tr>"+n+"</tr>");s=l.join("");var u=r()("<table>"+s+"</table>");return o&&o.tableClassName&&u.addClass(o.tableClassName),u[0]}},{key:"deleteTable",value:function(t){var e=pt.ancestor(t.commonAncestor(),pt.isCell);r()(e).closest("table").remove()}}],e&&Vt(t.prototype,e),o&&Vt(t,o),Object.defineProperty(t,"prototype",{writable:!1}),t;var t,e,o}();function Yt(t){return Yt="function"==typeof Symbol&&"symbol"==typeof Symbol.iterator?function(t){return typeof t}:function(t){return t&&"function"==typeof Symbol&&t.constructor===Symbol&&t!==Symbol.prototype?"symbol":typeof t},Yt(t)}function Xt(t,e){for(var o=0;o<e.length;o++){var n=e[o];n.enumerable=n.enumerable||!1,n.configurable=!0,"value"in n&&(n.writable=!0),Object.defineProperty(t,Qt(n.key),n)}}function Qt(t){var e=function(t,e){if("object"!=Yt(t)||!t)return t;var o=t[Symbol.toPrimitive];if(void 0!==o){var n=o.call(t,e||"default");if("object"!=Yt(n))return n;throw new TypeError("@@toPrimitive must return a primitive value.")}return("string"===e?String:Number)(t)}(t,"string");return"symbol"==Yt(e)?e:e+""}var Jt=/^[a-zA-Z0-9._%+-]+@[a-zA-Z0-9.-]+\.[a-zA-Z]{2,}$/,te=/^(\+?\d{1,3}[\s-]?)?(\d{1,4})[\s-]?(\d{1,4})[\s-]?(\d{1,4})$/,ee=/^([A-Za-z][A-Za-z0-9+-.]*\:|#|\/)/,oe=function(){return t=function t(e){var o=this;!function(t,e){if(!(t instanceof e))throw new TypeError("Cannot call a class as a function")}(this,t),this.context=e,this.$note=e.layoutInfo.note,this.$editor=e.layoutInfo.editor,this.$editable=e.layoutInfo.editable,this.options=e.options,this.lang=this.options.langInfo,this.editable=this.$editable[0],this.lastRange=null,this.snapshot=null,this.style=new Ht,this.table=new Zt,this.typing=new Kt(e),this.bullet=new zt,this.history=new At(e),this.context.memo("help.escape",this.lang.help.escape),this.context.memo("help.undo",this.lang.help.undo),this.context.memo("help.redo",this.lang.help.redo),this.context.memo("help.tab",this.lang.help.tab),this.context.memo("help.untab",this.lang.help.untab),this.context.memo("help.insertParagraph",this.lang.help.insertParagraph),this.context.memo("help.insertOrderedList",this.lang.help.insertOrderedList),this.context.memo("help.insertUnorderedList",this.lang.help.insertUnorderedList),this.context.memo("help.indent",this.lang.help.indent),this.context.memo("help.outdent",this.lang.help.outdent),this.context.memo("help.formatPara",this.lang.help.formatPara),this.context.memo("help.insertHorizontalRule",this.lang.help.insertHorizontalRule),this.context.memo("help.fontName",this.lang.help.fontName);for(var n=["bold","italic","underline","strikethrough","superscript","subscript","justifyLeft","justifyCenter","justifyRight","justifyFull","formatBlock","removeFormat","backColor"],i=0,a=n.length;i<a;i++)this[n[i]]=function(t){return function(e){o.beforeCommand(),document.execCommand(t,!1,e),o.afterCommand(!0)}}(n[i]),this.context.memo("help."+n[i],this.lang.help[n[i]]);this.fontName=this.wrapCommand((function(t){return o.fontStyling("font-family",m.validFontName(t))})),this.fontSize=this.wrapCommand((function(t){var e=o.currentStyle()["font-size-unit"];return o.fontStyling("font-size",t+e)})),this.fontSizeUnit=this.wrapCommand((function(t){var e=o.currentStyle()["font-size"];return o.fontStyling("font-size",e+t)}));for(var s=1;s<=6;s++)this["formatH"+s]=function(t){return function(){o.formatBlock("H"+t)}}(s),this.context.memo("help.formatH"+s,this.lang.help["formatH"+s]);this.insertParagraph=this.wrapCommand((function(){o.typing.insertParagraph(o.editable)})),this.insertOrderedList=this.wrapCommand((function(){o.bullet.insertOrderedList(o.editable)})),this.insertUnorderedList=this.wrapCommand((function(){o.bullet.insertUnorderedList(o.editable)})),this.indent=this.wrapCommand((function(){o.bullet.indent(o.editable)})),this.outdent=this.wrapCommand((function(){o.bullet.outdent(o.editable)})),this.insertNode=this.wrapCommand((function(t){o.isLimited(r()(t).text().length)||(o.getLastRange().insertNode(t),o.setLastRange(Et.createFromNodeAfter(t).select()))})),this.insertText=this.wrapCommand((function(t){if(!o.isLimited(t.length)){var e=o.getLastRange().insertNode(pt.createText(t));o.setLastRange(Et.create(e,pt.nodeLength(e)).select())}})),this.pasteHTML=this.wrapCommand((function(t){if(!o.isLimited(t.length)){t=o.context.invoke("codeview.purify",t);var e=o.getLastRange().pasteHTML(t);o.setLastRange(Et.createFromNodeAfter(C.last(e)).select())}})),this.formatBlock=this.wrapCommand((function(t,e){var n=o.options.callbacks.onApplyCustomStyle;n?n.call(o,e,o.context,o.onFormatBlock):o.onFormatBlock(t,e)})),this.insertHorizontalRule=this.wrapCommand((function(){var t=o.getLastRange().insertNode(pt.create("HR"));t.nextSibling&&o.setLastRange(Et.create(t.nextSibling,0).normalize().select())})),this.lineHeight=this.wrapCommand((function(t){o.style.stylePara(o.getLastRange(),{lineHeight:t})})),this.createLink=this.wrapCommand((function(t){var e=[],n=t.url,i=t.text,a=t.isNewWindow,s=o.options.linkAddNoReferrer,l=o.options.linkAddNoOpener,c=t.range||o.getLastRange(),u=i.length-c.toString().length;if(!(u>0&&o.isLimited(u))){var d=c.toString()!==i;"string"==typeof n&&(n=n.trim()),n=o.options.onCreateLink?o.options.onCreateLink(n):o.checkLinkUrl(n);var f=[];if(d){var h=(c=c.deleteContents()).insertNode(r()("<A></A>").text(i)[0]);f.push(h)}else f=o.style.styleNodes(c,{nodeName:"A",expandClosestSibling:!0,onlyPartialContains:!0});r().each(f,(function(t,o){r()(o).attr("href",n),a?(r()(o).attr("target","_blank"),s&&e.push("noreferrer"),l&&e.push("noopener"),e.length&&r()(o).attr("rel",e.join(" "))):r()(o).removeAttr("target")})),o.setLastRange(o.createRangeFromList(f).select())}})),this.color=this.wrapCommand((function(t){var e=t.foreColor,o=t.backColor;e&&document.execCommand("foreColor",!1,e),o&&document.execCommand("backColor",!1,o)})),this.foreColor=this.wrapCommand((function(t){document.execCommand("foreColor",!1,t)})),this.insertTable=this.wrapCommand((function(t){var e=t.split("x");o.getLastRange().deleteContents().insertNode(o.table.createTable(e[0],e[1],o.options))})),this.removeMedia=this.wrapCommand((function(){var t=r()(o.restoreTarget()).parent();t.closest("figure").length?t.closest("figure").remove():t=r()(o.restoreTarget()).detach(),o.setLastRange(Et.createFromSelection(t).select()),o.context.triggerEvent("media.delete",t,o.$editable)})),this.floatMe=this.wrapCommand((function(t){var e=r()(o.restoreTarget());e.toggleClass("note-float-left","left"===t),e.toggleClass("note-float-right","right"===t),e.css("float","none"===t?"":t)})),this.resize=this.wrapCommand((function(t){var e=r()(o.restoreTarget());0===(t=parseFloat(t))?e.css("width",""):e.css({width:100*t+"%",height:""})}))},e=[{key:"initialize",value:function(){var t=this;this.$editable.on("keydown",(function(e){if(e.keyCode===Nt.code.ENTER&&t.context.triggerEvent("enter",e),t.context.triggerEvent("keydown",e),t.snapshot=t.history.makeSnapshot(),t.hasKeyShortCut=!1,e.isDefaultPrevented()||(t.options.shortcuts?t.hasKeyShortCut=t.handleKeyMap(e):t.preventDefaultEditableShortCuts(e)),t.isLimited(1,e)){var o=t.getLastRange();if(o.eo-o.so==0)return!1}t.setLastRange(),t.options.recordEveryKeystroke&&!1===t.hasKeyShortCut&&t.history.recordUndo()})).on("keyup",(function(e){t.setLastRange(),t.context.triggerEvent("keyup",e)})).on("focus",(function(e){t.setLastRange(),t.context.triggerEvent("focus",e)})).on("blur",(function(e){t.context.triggerEvent("blur",e)})).on("mousedown",(function(e){t.context.triggerEvent("mousedown",e)})).on("mouseup",(function(e){t.setLastRange(),t.history.recordUndo(),t.context.triggerEvent("mouseup",e)})).on("scroll",(function(e){t.context.triggerEvent("scroll",e)})).on("paste",(function(e){t.setLastRange(),t.context.triggerEvent("paste",e)})).on("copy",(function(e){t.context.triggerEvent("copy",e)})).on("input",(function(){t.isLimited(0)&&t.snapshot&&t.history.applySnapshot(t.snapshot)})),this.$editable.attr("spellcheck",this.options.spellCheck),this.$editable.attr("autocorrect",this.options.spellCheck),this.options.disableGrammar&&this.$editable.attr("data-gramm",!1),this.$editable.html(pt.html(this.$note)||pt.emptyPara),this.$editable.on(m.inputEventName,g.debounce((function(){t.context.triggerEvent("change",t.$editable.html(),t.$editable)}),10)),this.$editable.on("focusin",(function(e){t.context.triggerEvent("focusin",e)})).on("focusout",(function(e){t.context.triggerEvent("focusout",e)})),this.options.airMode?this.options.overrideContextMenu&&this.$editor.on("contextmenu",(function(e){return t.context.triggerEvent("contextmenu",e),!1})):(this.options.width&&this.$editor.outerWidth(this.options.width),this.options.height&&this.$editable.outerHeight(this.options.height),this.options.maxHeight&&this.$editable.css("max-height",this.options.maxHeight),this.options.minHeight&&this.$editable.css("min-height",this.options.minHeight)),this.history.recordUndo(),this.setLastRange()}},{key:"destroy",value:function(){this.$editable.off()}},{key:"handleKeyMap",value:function(t){var e=this.options.keyMap[m.isMac?"mac":"pc"],o=[];t.metaKey&&o.push("CMD"),t.ctrlKey&&!t.altKey&&o.push("CTRL"),t.shiftKey&&o.push("SHIFT");var n=Nt.nameFromCode[t.keyCode];n&&o.push(n);var i=e[o.join("+")];if("TAB"!==n||this.options.tabDisable)if(i){if(!1!==this.context.invoke(i))return t.preventDefault(),!0}else Nt.isEdit(t.keyCode)&&(Nt.isRemove(t.keyCode)&&this.context.invoke("removed"),this.afterCommand());else this.afterCommand();return!1}},{key:"preventDefaultEditableShortCuts",value:function(t){(t.ctrlKey||t.metaKey)&&C.contains([66,73,85],t.keyCode)&&t.preventDefault()}},{key:"isLimited",value:function(t,e){return t=t||0,(void 0===e||!(Nt.isMove(e.keyCode)||Nt.isNavigation(e.keyCode)||e.ctrlKey||e.metaKey||C.contains([Nt.code.BACKSPACE,Nt.code.DELETE],e.keyCode)))&&this.options.maxTextLength>0&&this.$editable.text().length+t>this.options.maxTextLength}},{key:"checkLinkUrl",value:function(t){return Jt.test(t)?"mailto://"+t:te.test(t)?"tel://"+t:ee.test(t)?t:"http://"+t}},{key:"createRange",value:function(){return this.focus(),this.setLastRange(),this.getLastRange()}},{key:"createRangeFromList",value:function(t){var e=Et.createFromNodeBefore(C.head(t)).getStartPoint(),o=Et.createFromNodeAfter(C.last(t)).getEndPoint();return Et.create(e.node,e.offset,o.node,o.offset)}},{key:"setLastRange",value:function(t){t?this.lastRange=t:(this.lastRange=Et.create(this.editable),0===r()(this.lastRange.sc).closest(".note-editable").length&&(this.lastRange=Et.createFromBodyElement(this.editable)))}},{key:"getLastRange",value:function(){return this.lastRange||this.setLastRange(),this.lastRange}},{key:"saveRange",value:function(t){t&&this.getLastRange().collapse().select()}},{key:"restoreRange",value:function(){this.lastRange&&(this.lastRange.select(),this.focus())}},{key:"saveTarget",value:function(t){this.$editable.data("target",t)}},{key:"clearTarget",value:function(){this.$editable.removeData("target")}},{key:"restoreTarget",value:function(){return this.$editable.data("target")}},{key:"currentStyle",value:function(){var t=Et.create();return t&&(t=t.normalize()),t?this.style.current(t):this.style.fromNode(this.$editable)}},{key:"styleFromNode",value:function(t){return this.style.fromNode(t)}},{key:"undo",value:function(){this.context.triggerEvent("before.command",this.$editable.html()),this.history.undo(),this.context.triggerEvent("change",this.$editable.html(),this.$editable)}},{key:"commit",value:function(){this.context.triggerEvent("before.command",this.$editable.html()),this.history.commit(),this.context.triggerEvent("change",this.$editable.html(),this.$editable)}},{key:"redo",value:function(){this.context.triggerEvent("before.command",this.$editable.html()),this.history.redo(),this.context.triggerEvent("change",this.$editable.html(),this.$editable)}},{key:"beforeCommand",value:function(){this.context.triggerEvent("before.command",this.$editable.html()),document.execCommand("styleWithCSS",!1,this.options.styleWithCSS),this.focus()}},{key:"afterCommand",value:function(t){this.normalizeContent(),this.history.recordUndo(),t||this.context.triggerEvent("change",this.$editable.html(),this.$editable)}},{key:"tab",value:function(){var t=this.getLastRange();if(t.isCollapsed()&&t.isOnCell())this.table.tab(t);else{if(0===this.options.tabSize)return!1;this.isLimited(this.options.tabSize)||(this.beforeCommand(),this.typing.insertTab(t,this.options.tabSize),this.afterCommand())}}},{key:"untab",value:function(){var t=this.getLastRange();if(t.isCollapsed()&&t.isOnCell())this.table.tab(t,!0);else if(0===this.options.tabSize)return!1}},{key:"wrapCommand",value:function(t){return function(){this.beforeCommand(),t.apply(this,arguments),this.afterCommand()}}},{key:"removed",value:function(t,e,o){(t=Et.create()).isCollapsed()&&t.isOnCell()&&(o=(e=t.ec).tagName)&&1===e.childElementCount&&"BR"===e.childNodes[0].tagName&&("P"===o?e.remove():["TH","TD"].indexOf(o)>=0&&e.firstChild.remove())}},{key:"insertImage",value:function(t,e){var o,n=this;return(o=t,r().Deferred((function(t){var e=r()("<img>");e.one("load",(function(){e.off("error abort"),t.resolve(e)})).one("error abort",(function(){e.off("load").detach(),t.reject(e)})).css({display:"none"}).appendTo(document.body).attr("src",o)})).promise()).then((function(t){n.beforeCommand(),"function"==typeof e?e(t):("string"==typeof e&&t.attr("data-filename",e),t.css("width",Math.min(n.$editable.width(),t.width()))),t.show(),n.getLastRange().insertNode(t[0]),n.setLastRange(Et.createFromNodeAfter(t[0]).select()),n.afterCommand()})).fail((function(t){n.context.triggerEvent("image.upload.error",t)}))}},{key:"insertImagesAsDataURL",value:function(t){var e=this;r().each(t,(function(t,o){var n=o.name;e.options.maximumImageFileSize&&e.options.maximumImageFileSize<o.size?e.context.triggerEvent("image.upload.error",e.lang.image.maximumFileSizeError):function(t){return r().Deferred((function(e){r().extend(new FileReader,{onload:function(t){var o=t.target.result;e.resolve(o)},onerror:function(t){e.reject(t)}}).readAsDataURL(t)})).promise()}(o).then((function(t){return e.insertImage(t,n)})).fail((function(){e.context.triggerEvent("image.upload.error")}))}))}},{key:"insertImagesOrCallback",value:function(t){this.options.callbacks.onImageUpload?this.context.triggerEvent("image.upload",t):this.insertImagesAsDataURL(t)}},{key:"getSelectedText",value:function(){var t=this.getLastRange();return t.isOnAnchor()&&(t=Et.createFromNode(pt.ancestor(t.sc,pt.isAnchor))),t.toString()}},{key:"onFormatBlock",value:function(t,e){if(document.execCommand("FormatBlock",!1,m.isMSIE?"<"+t+">":t),e&&e.length&&(e[0].tagName.toUpperCase()!==t.toUpperCase()&&(e=e.find(t)),e&&e.length)){var o=this.createRange(),n=r()([o.sc,o.ec]).closest(t);n.removeClass();var i=e[0].className||"";i&&n.addClass(i)}}},{key:"formatPara",value:function(){this.formatBlock("P")}},{key:"fontStyling",value:function(t,e){var o=this.getLastRange();if(""!==o){var n=this.style.styleNodes(o);if(this.$editor.find(".note-status-output").html(""),r()(n).css(t,e),o.isCollapsed()){var i=C.head(n);i&&!pt.nodeLength(i)&&(i.innerHTML=pt.ZERO_WIDTH_NBSP_CHAR,Et.createFromNode(i.firstChild).select(),this.setLastRange(),this.$editable.data("bogus",i))}else o.select()}else{var a=r().now();this.$editor.find(".note-status-output").html('<div id="note-status-output-'+a+'" class="alert alert-info">'+this.lang.output.noSelection+"</div>"),setTimeout((function(){r()("#note-status-output-"+a).remove()}),5e3)}}},{key:"unlink",value:function(){var t=this.getLastRange();if(t.isOnAnchor()){var e=pt.ancestor(t.sc,pt.isAnchor);(t=Et.createFromNode(e)).select(),this.setLastRange(),this.beforeCommand(),document.execCommand("unlink"),this.afterCommand()}}},{key:"getLinkInfo",value:function(){this.hasFocus()||this.focus();var t=this.getLastRange().expand(pt.isAnchor),e=r()(C.head(t.nodes(pt.isAnchor))),o={range:t,text:t.toString(),url:e.length?e.attr("href"):""};return e.length&&(o.isNewWindow="_blank"===e.attr("target")),o}},{key:"addRow",value:function(t){var e=this.getLastRange(this.$editable);e.isCollapsed()&&e.isOnCell()&&(this.beforeCommand(),this.table.addRow(e,t),this.afterCommand())}},{key:"addCol",value:function(t){var e=this.getLastRange(this.$editable);e.isCollapsed()&&e.isOnCell()&&(this.beforeCommand(),this.table.addCol(e,t),this.afterCommand())}},{key:"deleteRow",value:function(){var t=this.getLastRange(this.$editable);t.isCollapsed()&&t.isOnCell()&&(this.beforeCommand(),this.table.deleteRow(t),this.afterCommand())}},{key:"deleteCol",value:function(){var t=this.getLastRange(this.$editable);t.isCollapsed()&&t.isOnCell()&&(this.beforeCommand(),this.table.deleteCol(t),this.afterCommand())}},{key:"deleteTable",value:function(){var t=this.getLastRange(this.$editable);t.isCollapsed()&&t.isOnCell()&&(this.beforeCommand(),this.table.deleteTable(t),this.afterCommand())}},{key:"resizeTo",value:function(t,e,o){var n;if(o){var i=t.y/t.x,r=e.data("ratio");n={width:r>i?t.x:t.y/r,height:r>i?t.x*r:t.y}}else n={width:t.x,height:t.y};e.css(n)}},{key:"hasFocus",value:function(){return this.$editable.is(":focus")}},{key:"focus",value:function(){this.hasFocus()||this.$editable.trigger("focus")}},{key:"isEmpty",value:function(){return pt.isEmpty(this.$editable[0])||pt.emptyPara===this.$editable.html()}},{key:"empty",value:function(){this.context.invoke("code",pt.emptyPara)}},{key:"normalizeContent",value:function(){this.$editable[0].normalize()}}],e&&Xt(t.prototype,e),o&&Xt(t,o),Object.defineProperty(t,"prototype",{writable:!1}),t;var t,e,o}();function ne(t){return ne="function"==typeof Symbol&&"symbol"==typeof Symbol.iterator?function(t){return typeof t}:function(t){return t&&"function"==typeof Symbol&&t.constructor===Symbol&&t!==Symbol.prototype?"symbol":typeof t},ne(t)}function ie(t,e){for(var o=0;o<e.length;o++){var n=e[o];n.enumerable=n.enumerable||!1,n.configurable=!0,"value"in n&&(n.writable=!0),Object.defineProperty(t,re(n.key),n)}}function re(t){var e=function(t,e){if("object"!=ne(t)||!t)return t;var o=t[Symbol.toPrimitive];if(void 0!==o){var n=o.call(t,e||"default");if("object"!=ne(n))return n;throw new TypeError("@@toPrimitive must return a primitive value.")}return("string"===e?String:Number)(t)}(t,"string");return"symbol"==ne(e)?e:e+""}var ae=function(){return t=function t(e){!function(t,e){if(!(t instanceof e))throw new TypeError("Cannot call a class as a function")}(this,t),this.context=e,this.options=e.options,this.$editable=e.layoutInfo.editable},(e=[{key:"initialize",value:function(){this.$editable.on("paste",this.pasteByEvent.bind(this))}},{key:"pasteByEvent",value:function(t){var e=this;if(!this.context.isDisabled()){var o=t.originalEvent.clipboardData;if(o&&o.items&&o.items.length){var n=o.files,i=o.getData("Text");n.length>0&&this.options.allowClipboardImagePasting&&(this.context.invoke("editor.insertImagesOrCallback",n),t.preventDefault()),i.length>0&&this.context.invoke("editor.isLimited",i.length)&&t.preventDefault()}else if(window.clipboardData){var r=window.clipboardData.getData("text");this.context.invoke("editor.isLimited",r.length)&&t.preventDefault()}setTimeout((function(){e.context.invoke("editor.afterCommand")}),10)}}}])&&ie(t.prototype,e),o&&ie(t,o),Object.defineProperty(t,"prototype",{writable:!1}),t;var t,e,o}();function se(t){return se="function"==typeof Symbol&&"symbol"==typeof Symbol.iterator?function(t){return typeof t}:function(t){return t&&"function"==typeof Symbol&&t.constructor===Symbol&&t!==Symbol.prototype?"symbol":typeof t},se(t)}function le(t,e){for(var o=0;o<e.length;o++){var n=e[o];n.enumerable=n.enumerable||!1,n.configurable=!0,"value"in n&&(n.writable=!0),Object.defineProperty(t,ce(n.key),n)}}function ce(t){var e=function(t,e){if("object"!=se(t)||!t)return t;var o=t[Symbol.toPrimitive];if(void 0!==o){var n=o.call(t,e||"default");if("object"!=se(n))return n;throw new TypeError("@@toPrimitive must return a primitive value.")}return("string"===e?String:Number)(t)}(t,"string");return"symbol"==se(e)?e:e+""}var ue=function(){return t=function t(e){!function(t,e){if(!(t instanceof e))throw new TypeError("Cannot call a class as a function")}(this,t),this.context=e,this.$eventListener=r()(document),this.$editor=e.layoutInfo.editor,this.$editable=e.layoutInfo.editable,this.options=e.options,this.lang=this.options.langInfo,this.documentEventHandlers={},this.$dropzone=r()(['<div class="note-dropzone">','<div class="note-dropzone-message"></div>',"</div>"].join("")).prependTo(this.$editor)},e=[{key:"initialize",value:function(){this.options.disableDragAndDrop?(this.documentEventHandlers.onDrop=function(t){t.preventDefault()},this.$eventListener=this.$dropzone,this.$eventListener.on("drop",this.documentEventHandlers.onDrop)):this.attachDragAndDropEvent()}},{key:"attachDragAndDropEvent",value:function(){var t=this,e=r()(),o=this.$dropzone.find(".note-dropzone-message");this.documentEventHandlers.onDragenter=function(n){var i=t.context.invoke("codeview.isActivated"),r=t.$editor.width()>0&&t.$editor.height()>0;i||e.length||!r||(t.$editor.addClass("dragover"),t.$dropzone.width(t.$editor.width()),t.$dropzone.height(t.$editor.height()),o.text(t.lang.image.dragImageHere)),e=e.add(n.target)},this.documentEventHandlers.onDragleave=function(o){(e=e.not(o.target)).length&&"BODY"!==o.target.nodeName||(e=r()(),t.$editor.removeClass("dragover"))},this.documentEventHandlers.onDrop=function(){e=r()(),t.$editor.removeClass("dragover")},this.$eventListener.on("dragenter",this.documentEventHandlers.onDragenter).on("dragleave",this.documentEventHandlers.onDragleave).on("drop",this.documentEventHandlers.onDrop),this.$dropzone.on("dragenter",(function(){t.$dropzone.addClass("hover"),o.text(t.lang.image.dropImage)})).on("dragleave",(function(){t.$dropzone.removeClass("hover"),o.text(t.lang.image.dragImageHere)})),this.$dropzone.on("drop",(function(e){var o=e.originalEvent.dataTransfer;e.preventDefault(),o&&o.files&&o.files.length?(t.$editable.trigger("focus"),t.context.invoke("editor.insertImagesOrCallback",o.files)):r().each(o.types,(function(e,n){if(!(n.toLowerCase().indexOf("_moz_")>-1)){var i=o.getData(n);n.toLowerCase().indexOf("text")>-1?t.context.invoke("editor.pasteHTML",i):r()(i).each((function(e,o){t.context.invoke("editor.insertNode",o)}))}}))})).on("dragover",!1)}},{key:"destroy",value:function(){var t=this;Object.keys(this.documentEventHandlers).forEach((function(e){t.$eventListener.off(e.slice(2).toLowerCase(),t.documentEventHandlers[e])})),this.documentEventHandlers={}}}],e&&le(t.prototype,e),o&&le(t,o),Object.defineProperty(t,"prototype",{writable:!1}),t;var t,e,o}();function de(t){return de="function"==typeof Symbol&&"symbol"==typeof Symbol.iterator?function(t){return typeof t}:function(t){return t&&"function"==typeof Symbol&&t.constructor===Symbol&&t!==Symbol.prototype?"symbol":typeof t},de(t)}function fe(t,e){var o="undefined"!=typeof Symbol&&t[Symbol.iterator]||t["@@iterator"];if(!o){if(Array.isArray(t)||(o=function(t,e){if(t){if("string"==typeof t)return he(t,e);var o={}.toString.call(t).slice(8,-1);return"Object"===o&&t.constructor&&(o=t.constructor.name),"Map"===o||"Set"===o?Array.from(t):"Arguments"===o||/^(?:Ui|I)nt(?:8|16|32)(?:Clamped)?Array$/.test(o)?he(t,e):void 0}}(t))||e&&t&&"number"==typeof t.length){o&&(t=o);var n=0,i=function(){};return{s:i,n:function(){return n>=t.length?{done:!0}:{done:!1,value:t[n++]}},e:function(t){throw t},f:i}}throw new TypeError("Invalid attempt to iterate non-iterable instance.\nIn order to be iterable, non-array objects must have a [Symbol.iterator]() method.")}var r,a=!0,s=!1;return{s:function(){o=o.call(t)},n:function(){var t=o.next();return a=t.done,t},e:function(t){s=!0,r=t},f:function(){try{a||null==o.return||o.return()}finally{if(s)throw r}}}}function he(t,e){(null==e||e>t.length)&&(e=t.length);for(var o=0,n=Array(e);o<e;o++)n[o]=t[o];return n}function pe(t,e){for(var o=0;o<e.length;o++){var n=e[o];n.enumerable=n.enumerable||!1,n.configurable=!0,"value"in n&&(n.writable=!0),Object.defineProperty(t,me(n.key),n)}}function me(t){var e=function(t,e){if("object"!=de(t)||!t)return t;var o=t[Symbol.toPrimitive];if(void 0!==o){var n=o.call(t,e||"default");if("object"!=de(n))return n;throw new TypeError("@@toPrimitive must return a primitive value.")}return("string"===e?String:Number)(t)}(t,"string");return"symbol"==de(e)?e:e+""}var ve=function(){return t=function t(e){!function(t,e){if(!(t instanceof e))throw new TypeError("Cannot call a class as a function")}(this,t),this.context=e,this.$editor=e.layoutInfo.editor,this.$editable=e.layoutInfo.editable,this.$codable=e.layoutInfo.codable,this.options=e.options,this.CodeMirrorConstructor=window.CodeMirror,this.options.codemirror.CodeMirrorConstructor&&(this.CodeMirrorConstructor=this.options.codemirror.CodeMirrorConstructor)},e=[{key:"sync",value:function(t){var e=this.isActivated(),o=this.CodeMirrorConstructor;e&&(t?o?this.$codable.data("cmEditor").getDoc().setValue(t):this.$codable.val(t):o&&this.$codable.data("cmEditor").save())}},{key:"initialize",value:function(){var t=this;this.$codable.on("keyup",(function(e){e.keyCode===Nt.code.ESCAPE&&t.deactivate()}))}},{key:"isActivated",value:function(){return this.$editor.hasClass("codeview")}},{key:"toggle",value:function(){this.isActivated()?this.deactivate():this.activate(),this.context.triggerEvent("codeview.toggled")}},{key:"purify",value:function(t){if(this.options.codeviewFilter&&(t=t.replace(this.options.codeviewFilterRegex,""),this.options.codeviewIframeFilter)){var e=this.options.codeviewIframeWhitelistSrc.concat(this.options.codeviewIframeWhitelistSrcBase);t=t.replace(/(<iframe.*?>.*?(?:<\/iframe>)?)/gi,(function(t){if(/<.+src(?==?('|"|\s)?)[\s\S]+src(?=('|"|\s)?)[^>]*?>/i.test(t))return"";var o,n=fe(e);try{for(n.s();!(o=n.n()).done;){var i=o.value;if(new RegExp('src="(https?:)?//'+i.replace(/[-\/\\^$*+?.()|[\]{}]/g,"\\$&")+'/(.+)"').test(t))return t}}catch(t){n.e(t)}finally{n.f()}return""}))}return t}},{key:"activate",value:function(){var t=this,e=this.CodeMirrorConstructor;if(this.$codable.val(pt.html(this.$editable,this.options.prettifyHtml)),this.$codable.height(this.$editable.height()),this.context.invoke("toolbar.updateCodeview",!0),this.context.invoke("airPopover.updateCodeview",!0),this.$editor.addClass("codeview"),this.$codable.trigger("focus"),e){var o=e.fromTextArea(this.$codable[0],this.options.codemirror);if(this.options.codemirror.tern){var n=new e.TernServer(this.options.codemirror.tern);o.ternServer=n,o.on("cursorActivity",(function(t){n.updateArgHints(t)}))}o.on("blur",(function(e){t.context.triggerEvent("blur.codeview",o.getValue(),e)})),o.on("change",(function(){t.context.triggerEvent("change.codeview",o.getValue(),o)})),o.setSize(null,this.$editable.outerHeight()),this.$codable.data("cmEditor",o)}else this.$codable.on("blur",(function(e){t.context.triggerEvent("blur.codeview",t.$codable.val(),e)})),this.$codable.on("input",(function(){t.context.triggerEvent("change.codeview",t.$codable.val(),t.$codable)}))}},{key:"deactivate",value:function(){if(this.CodeMirrorConstructor){var t=this.$codable.data("cmEditor");this.$codable.val(t.getValue()),t.toTextArea()}var e=this.purify(pt.value(this.$codable,this.options.prettifyHtml)||pt.emptyPara),o=this.$editable.html()!==e;this.$editable.html(e),this.$editable.height(this.options.height?this.$codable.height():"auto"),this.$editor.removeClass("codeview"),o&&this.context.triggerEvent("change",this.$editable.html(),this.$editable),this.$editable.trigger("focus"),this.context.invoke("toolbar.updateCodeview",!1),this.context.invoke("airPopover.updateCodeview",!1)}},{key:"destroy",value:function(){this.isActivated()&&this.deactivate()}}],e&&pe(t.prototype,e),o&&pe(t,o),Object.defineProperty(t,"prototype",{writable:!1}),t;var t,e,o}();function ge(t){return ge="function"==typeof Symbol&&"symbol"==typeof Symbol.iterator?function(t){return typeof t}:function(t){return t&&"function"==typeof Symbol&&t.constructor===Symbol&&t!==Symbol.prototype?"symbol":typeof t},ge(t)}function be(t,e){for(var o=0;o<e.length;o++){var n=e[o];n.enumerable=n.enumerable||!1,n.configurable=!0,"value"in n&&(n.writable=!0),Object.defineProperty(t,ye(n.key),n)}}function ye(t){var e=function(t,e){if("object"!=ge(t)||!t)return t;var o=t[Symbol.toPrimitive];if(void 0!==o){var n=o.call(t,e||"default");if("object"!=ge(n))return n;throw new TypeError("@@toPrimitive must return a primitive value.")}return("string"===e?String:Number)(t)}(t,"string");return"symbol"==ge(e)?e:e+""}var ke=function(){return t=function t(e){!function(t,e){if(!(t instanceof e))throw new TypeError("Cannot call a class as a function")}(this,t),this.$document=r()(document),this.$statusbar=e.layoutInfo.statusbar,this.$editable=e.layoutInfo.editable,this.$codable=e.layoutInfo.codable,this.options=e.options},(e=[{key:"initialize",value:function(){var t=this;this.options.airMode||this.options.disableResizeEditor?this.destroy():this.$statusbar.on("mousedown touchstart",(function(e){e.preventDefault(),e.stopPropagation();var o=t.$editable.offset().top-t.$document.scrollTop(),n=t.$codable.offset().top-t.$document.scrollTop(),i=function(e){var i="mousemove"==e.type?e:e.originalEvent.touches[0],r=i.clientY-(o+24),a=i.clientY-(n+24);r=t.options.minheight>0?Math.max(r,t.options.minheight):r,r=t.options.maxHeight>0?Math.min(r,t.options.maxHeight):r,a=t.options.minheight>0?Math.max(a,t.options.minheight):a,a=t.options.maxHeight>0?Math.min(a,t.options.maxHeight):a,t.$editable.height(r),t.$codable.height(a)};t.$document.on("mousemove touchmove",i).one("mouseup touchend",(function(){t.$document.off("mousemove touchmove",i)}))}))}},{key:"destroy",value:function(){this.$statusbar.off(),this.$statusbar.addClass("locked")}}])&&be(t.prototype,e),o&&be(t,o),Object.defineProperty(t,"prototype",{writable:!1}),t;var t,e,o}();function we(t){return we="function"==typeof Symbol&&"symbol"==typeof Symbol.iterator?function(t){return typeof t}:function(t){return t&&"function"==typeof Symbol&&t.constructor===Symbol&&t!==Symbol.prototype?"symbol":typeof t},we(t)}function Ce(t,e){for(var o=0;o<e.length;o++){var n=e[o];n.enumerable=n.enumerable||!1,n.configurable=!0,"value"in n&&(n.writable=!0),Object.defineProperty(t,Se(n.key),n)}}function Se(t){var e=function(t,e){if("object"!=we(t)||!t)return t;var o=t[Symbol.toPrimitive];if(void 0!==o){var n=o.call(t,e||"default");if("object"!=we(n))return n;throw new TypeError("@@toPrimitive must return a primitive value.")}return("string"===e?String:Number)(t)}(t,"string");return"symbol"==we(e)?e:e+""}var xe=function(){return t=function t(e){var o=this;!function(t,e){if(!(t instanceof e))throw new TypeError("Cannot call a class as a function")}(this,t),this.context=e,this.$editor=e.layoutInfo.editor,this.$toolbar=e.layoutInfo.toolbar,this.$editable=e.layoutInfo.editable,this.$codable=e.layoutInfo.codable,this.$window=r()(window),this.$scrollbar=r()("html, body"),this.scrollbarClassName="note-fullscreen-body",this.onResize=function(){o.resizeTo({h:o.$window.height()-o.$toolbar.outerHeight()})}},(e=[{key:"resizeTo",value:function(t){this.$editable.css("height",t.h),this.$codable.css("height",t.h),this.$codable.data("cmeditor")&&this.$codable.data("cmeditor").setsize(null,t.h)}},{key:"toggle",value:function(){this.$editor.toggleClass("fullscreen");var t=this.isFullscreen();this.$scrollbar.toggleClass(this.scrollbarClassName,t),t?(this.$editable.data("orgHeight",this.$editable.css("height")),this.$editable.data("orgMaxHeight",this.$editable.css("maxHeight")),this.$editable.css("maxHeight",""),this.$window.on("resize",this.onResize).trigger("resize")):(this.$window.off("resize",this.onResize),this.resizeTo({h:this.$editable.data("orgHeight")}),this.$editable.css("maxHeight",this.$editable.css("orgMaxHeight"))),this.context.invoke("toolbar.updateFullscreen",t)}},{key:"isFullscreen",value:function(){return this.$editor.hasClass("fullscreen")}},{key:"destroy",value:function(){this.$scrollbar.removeClass(this.scrollbarClassName)}}])&&Ce(t.prototype,e),o&&Ce(t,o),Object.defineProperty(t,"prototype",{writable:!1}),t;var t,e,o}();function Te(t){return Te="function"==typeof Symbol&&"symbol"==typeof Symbol.iterator?function(t){return typeof t}:function(t){return t&&"function"==typeof Symbol&&t.constructor===Symbol&&t!==Symbol.prototype?"symbol":typeof t},Te(t)}function Ee(t,e){for(var o=0;o<e.length;o++){var n=e[o];n.enumerable=n.enumerable||!1,n.configurable=!0,"value"in n&&(n.writable=!0),Object.defineProperty(t,Pe(n.key),n)}}function Pe(t){var e=function(t,e){if("object"!=Te(t)||!t)return t;var o=t[Symbol.toPrimitive];if(void 0!==o){var n=o.call(t,e||"default");if("object"!=Te(n))return n;throw new TypeError("@@toPrimitive must return a primitive value.")}return("string"===e?String:Number)(t)}(t,"string");return"symbol"==Te(e)?e:e+""}var Ne=function(){return t=function t(e){var o=this;!function(t,e){if(!(t instanceof e))throw new TypeError("Cannot call a class as a function")}(this,t),this.context=e,this.$document=r()(document),this.$editingArea=e.layoutInfo.editingArea,this.options=e.options,this.lang=this.options.langInfo,this.events={"summernote.mousedown":function(t,e){o.update(e.target,e)&&e.preventDefault()},"summernote.keyup summernote.scroll summernote.change summernote.dialog.shown":function(){o.update()},"summernote.disable summernote.blur":function(){o.hide()},"summernote.codeview.toggled":function(){o.update()}}},e=[{key:"initialize",value:function(){var t=this;this.$handle=r()(['<div class="note-handle">','<div class="note-control-selection">','<div class="note-control-selection-bg"></div>','<div class="note-control-holder note-control-nw"></div>','<div class="note-control-holder note-control-ne"></div>','<div class="note-control-holder note-control-sw"></div>','<div class="',this.options.disableResizeImage?"note-control-holder":"note-control-sizing",' note-control-se"></div>',this.options.disableResizeImage?"":'<div class="note-control-selection-info"></div>',"</div>","</div>"].join("")).prependTo(this.$editingArea),this.$handle.on("mousedown",(function(e){if(pt.isControlSizing(e.target)){e.preventDefault(),e.stopPropagation();var o=t.$handle.find(".note-control-selection").data("target"),n=o.offset(),i=t.$document.scrollTop(),r=function(e){t.context.invoke("editor.resizeTo",{x:e.clientX-n.left,y:e.clientY-(n.top-i)},o,!e.shiftKey),t.update(o[0],e)};t.$document.on("mousemove",r).one("mouseup",(function(e){e.preventDefault(),t.$document.off("mousemove",r),t.context.invoke("editor.afterCommand")})),o.data("ratio")||o.data("ratio",o.height()/o.width())}})),this.$handle.on("wheel",(function(e){e.preventDefault(),t.update()}))}},{key:"destroy",value:function(){this.$handle.remove()}},{key:"update",value:function(t,e){if(this.context.isDisabled())return!1;var o=pt.isImg(t),n=this.$handle.find(".note-control-selection");if(this.context.invoke("imagePopover.update",t,e),o){var i=r()(t),a=this.$editingArea[0].getBoundingClientRect(),s=t.getBoundingClientRect();n.css({display:"block",left:s.left-a.left,top:s.top-a.top,width:s.width,height:s.height}).data("target",i);var l=new Image;l.src=i.attr("src");var c=s.width+"x"+s.height+" ("+this.lang.image.original+": "+l.width+"x"+l.height+")";n.find(".note-control-selection-info").text(c),this.context.invoke("editor.saveTarget",t)}else this.hide();return o}},{key:"hide",value:function(){this.context.invoke("editor.clearTarget"),this.$handle.children().hide()}}],e&&Ee(t.prototype,e),o&&Ee(t,o),Object.defineProperty(t,"prototype",{writable:!1}),t;var t,e,o}();function $e(t){return $e="function"==typeof Symbol&&"symbol"==typeof Symbol.iterator?function(t){return typeof t}:function(t){return t&&"function"==typeof Symbol&&t.constructor===Symbol&&t!==Symbol.prototype?"symbol":typeof t},$e(t)}function Ie(t,e){for(var o=0;o<e.length;o++){var n=e[o];n.enumerable=n.enumerable||!1,n.configurable=!0,"value"in n&&(n.writable=!0),Object.defineProperty(t,Re(n.key),n)}}function Re(t){var e=function(t,e){if("object"!=$e(t)||!t)return t;var o=t[Symbol.toPrimitive];if(void 0!==o){var n=o.call(t,e||"default");if("object"!=$e(n))return n;throw new TypeError("@@toPrimitive must return a primitive value.")}return("string"===e?String:Number)(t)}(t,"string");return"symbol"==$e(e)?e:e+""}var Ae=/^([A-Za-z][A-Za-z0-9+-.]*\:[\/]{2}|tel:|mailto:[A-Z0-9._%+-]+@|xmpp:[A-Z0-9._%+-]+@)?(www\.)?(.+)$/i,Le=function(){return t=function t(e){var o=this;!function(t,e){if(!(t instanceof e))throw new TypeError("Cannot call a class as a function")}(this,t),this.context=e,this.options=e.options,this.$editable=e.layoutInfo.editable,this.events={"summernote.keyup":function(t,e){e.isDefaultPrevented()||o.handleKeyup(e)},"summernote.keydown":function(t,e){o.handleKeydown(e)}}},(e=[{key:"initialize",value:function(){this.lastWordRange=null}},{key:"destroy",value:function(){this.lastWordRange=null}},{key:"replace",value:function(){if(this.lastWordRange){var t=this.lastWordRange.toString(),e=t.match(Ae);if(e&&(e[1]||e[2])){var o=e[1]?t:"http://"+t,n=this.options.showDomainOnlyForAutolink?t.replace(/^(?:https?:\/\/)?(?:tel?:?)?(?:mailto?:?)?(?:xmpp?:?)?(?:www\.)?/i,"").split("/")[0]:t,i=r()("<a></a>").html(n).attr("href",o)[0];this.context.options.linkTargetBlank&&r()(i).attr("target","_blank"),this.lastWordRange.insertNode(i),this.lastWordRange=null,this.context.invoke("editor.focus"),this.context.triggerEvent("change",this.$editable.html(),this.$editable)}}}},{key:"handleKeydown",value:function(t){if(C.contains([Nt.code.ENTER,Nt.code.SPACE],t.keyCode)){var e=this.context.invoke("editor.createRange").getWordRange();this.lastWordRange=e}}},{key:"handleKeyup",value:function(t){(Nt.code.SPACE===t.keyCode||Nt.code.ENTER===t.keyCode&&!t.shiftKey)&&this.replace()}}])&&Ie(t.prototype,e),o&&Ie(t,o),Object.defineProperty(t,"prototype",{writable:!1}),t;var t,e,o}();function Fe(t){return Fe="function"==typeof Symbol&&"symbol"==typeof Symbol.iterator?function(t){return typeof t}:function(t){return t&&"function"==typeof Symbol&&t.constructor===Symbol&&t!==Symbol.prototype?"symbol":typeof t},Fe(t)}function De(t,e){for(var o=0;o<e.length;o++){var n=e[o];n.enumerable=n.enumerable||!1,n.configurable=!0,"value"in n&&(n.writable=!0),Object.defineProperty(t,He(n.key),n)}}function He(t){var e=function(t,e){if("object"!=Fe(t)||!t)return t;var o=t[Symbol.toPrimitive];if(void 0!==o){var n=o.call(t,e||"default");if("object"!=Fe(n))return n;throw new TypeError("@@toPrimitive must return a primitive value.")}return("string"===e?String:Number)(t)}(t,"string");return"symbol"==Fe(e)?e:e+""}var je=function(){return t=function t(e){var o=this;!function(t,e){if(!(t instanceof e))throw new TypeError("Cannot call a class as a function")}(this,t),this.$note=e.layoutInfo.note,this.events={"summernote.change":function(){o.$note.val(e.invoke("code"))}}},(e=[{key:"shouldInitialize",value:function(){return pt.isTextarea(this.$note[0])}}])&&De(t.prototype,e),o&&De(t,o),Object.defineProperty(t,"prototype",{writable:!1}),t;var t,e,o}();function Be(t){return Be="function"==typeof Symbol&&"symbol"==typeof Symbol.iterator?function(t){return typeof t}:function(t){return t&&"function"==typeof Symbol&&t.constructor===Symbol&&t!==Symbol.prototype?"symbol":typeof t},Be(t)}function Oe(t,e){for(var o=0;o<e.length;o++){var n=e[o];n.enumerable=n.enumerable||!1,n.configurable=!0,"value"in n&&(n.writable=!0),Object.defineProperty(t,ze(n.key),n)}}function ze(t){var e=function(t,e){if("object"!=Be(t)||!t)return t;var o=t[Symbol.toPrimitive];if(void 0!==o){var n=o.call(t,e||"default");if("object"!=Be(n))return n;throw new TypeError("@@toPrimitive must return a primitive value.")}return("string"===e?String:Number)(t)}(t,"string");return"symbol"==Be(e)?e:e+""}var Me=function(){return t=function t(e){var o=this;!function(t,e){if(!(t instanceof e))throw new TypeError("Cannot call a class as a function")}(this,t),this.context=e,this.options=e.options.replace||{},this.keys=[Nt.code.ENTER,Nt.code.SPACE,Nt.code.PERIOD,Nt.code.COMMA,Nt.code.SEMICOLON,Nt.code.SLASH],this.previousKeydownCode=null,this.events={"summernote.keyup":function(t,e){e.isDefaultPrevented()||o.handleKeyup(e)},"summernote.keydown":function(t,e){o.handleKeydown(e)}}},(e=[{key:"shouldInitialize",value:function(){return!!this.options.match}},{key:"initialize",value:function(){this.lastWord=null}},{key:"destroy",value:function(){this.lastWord=null}},{key:"replace",value:function(){if(this.lastWord){var t=this,e=this.lastWord.toString();this.options.match(e,(function(e){if(e){var o="";if("string"==typeof e?o=pt.createText(e):e instanceof jQuery?o=e[0]:e instanceof Node&&(o=e),!o)return;t.lastWord.insertNode(o),t.lastWord=null,t.context.invoke("editor.focus")}}))}}},{key:"handleKeydown",value:function(t){if(this.previousKeydownCode&&C.contains(this.keys,this.previousKeydownCode))this.previousKeydownCode=t.keyCode;else{if(C.contains(this.keys,t.keyCode)){var e=this.context.invoke("editor.createRange").getWordRange();this.lastWord=e}this.previousKeydownCode=t.keyCode}}},{key:"handleKeyup",value:function(t){C.contains(this.keys,t.keyCode)&&this.replace()}}])&&Oe(t.prototype,e),o&&Oe(t,o),Object.defineProperty(t,"prototype",{writable:!1}),t;var t,e,o}();function Ue(t){return Ue="function"==typeof Symbol&&"symbol"==typeof Symbol.iterator?function(t){return typeof t}:function(t){return t&&"function"==typeof Symbol&&t.constructor===Symbol&&t!==Symbol.prototype?"symbol":typeof t},Ue(t)}function We(t,e){for(var o=0;o<e.length;o++){var n=e[o];n.enumerable=n.enumerable||!1,n.configurable=!0,"value"in n&&(n.writable=!0),Object.defineProperty(t,Ke(n.key),n)}}function Ke(t){var e=function(t,e){if("object"!=Ue(t)||!t)return t;var o=t[Symbol.toPrimitive];if(void 0!==o){var n=o.call(t,e||"default");if("object"!=Ue(n))return n;throw new TypeError("@@toPrimitive must return a primitive value.")}return("string"===e?String:Number)(t)}(t,"string");return"symbol"==Ue(e)?e:e+""}var qe=function(){return t=function t(e){var o=this;!function(t,e){if(!(t instanceof e))throw new TypeError("Cannot call a class as a function")}(this,t),this.context=e,this.$editingArea=e.layoutInfo.editingArea,this.options=e.options,!0===this.options.inheritPlaceholder&&(this.options.placeholder=this.context.$note.attr("placeholder")||this.options.placeholder),this.events={"summernote.init summernote.change":function(){o.update()},"summernote.codeview.toggled":function(){o.update()}}},(e=[{key:"shouldInitialize",value:function(){return!!this.options.placeholder}},{key:"initialize",value:function(){var t=this;this.$placeholder=r()('<div class="note-placeholder"></div>'),this.$placeholder.on("click",(function(){t.context.invoke("focus")})).html(this.options.placeholder).prependTo(this.$editingArea),this.update()}},{key:"destroy",value:function(){this.$placeholder.remove()}},{key:"update",value:function(){var t=!this.context.invoke("codeview.isActivated")&&this.context.invoke("editor.isEmpty");this.$placeholder.toggle(t)}}])&&We(t.prototype,e),o&&We(t,o),Object.defineProperty(t,"prototype",{writable:!1}),t;var t,e,o}();function Ve(t){return Ve="function"==typeof Symbol&&"symbol"==typeof Symbol.iterator?function(t){return typeof t}:function(t){return t&&"function"==typeof Symbol&&t.constructor===Symbol&&t!==Symbol.prototype?"symbol":typeof t},Ve(t)}function _e(t,e){for(var o=0;o<e.length;o++){var n=e[o];n.enumerable=n.enumerable||!1,n.configurable=!0,"value"in n&&(n.writable=!0),Object.defineProperty(t,Ge(n.key),n)}}function Ge(t){var e=function(t,e){if("object"!=Ve(t)||!t)return t;var o=t[Symbol.toPrimitive];if(void 0!==o){var n=o.call(t,e||"default");if("object"!=Ve(n))return n;throw new TypeError("@@toPrimitive must return a primitive value.")}return("string"===e?String:Number)(t)}(t,"string");return"symbol"==Ve(e)?e:e+""}var Ze=function(){return t=function t(e){!function(t,e){if(!(t instanceof e))throw new TypeError("Cannot call a class as a function")}(this,t),this.ui=r().summernote.ui,this.context=e,this.$toolbar=e.layoutInfo.toolbar,this.options=e.options,this.lang=this.options.langInfo,this.invertedKeyMap=g.invertObject(this.options.keyMap[m.isMac?"mac":"pc"])},e=[{key:"representShortcut",value:function(t){var e=this.invertedKeyMap[t];return this.options.shortcuts&&e?(m.isMac&&(e=e.replace("CMD","⌘").replace("SHIFT","⇧"))," ("+(e=e.replace("BACKSLASH","\\").replace("SLASH","/").replace("LEFTBRACKET","[").replace("RIGHTBRACKET","]"))+")"):""}},{key:"button",value:function(t){return!this.options.tooltip&&t.tooltip&&delete t.tooltip,t.container=this.options.container,this.ui.button(t)}},{key:"initialize",value:function(){this.addToolbarButtons(),this.addImagePopoverButtons(),this.addLinkPopoverButtons(),this.addTablePopoverButtons(),this.fontInstalledMap={}}},{key:"destroy",value:function(){delete this.fontInstalledMap}},{key:"isFontInstalled",value:function(t){return Object.prototype.hasOwnProperty.call(this.fontInstalledMap,t)||(this.fontInstalledMap[t]=m.isFontInstalled(t)||C.contains(this.options.fontNamesIgnoreCheck,t)),this.fontInstalledMap[t]}},{key:"isFontDeservedToAdd",value:function(t){return""!==(t=t.toLowerCase())&&this.isFontInstalled(t)&&-1===m.genericFontFamilies.indexOf(t)}},{key:"colorPalette",value:function(t,e,o,n){var i=this;return this.ui.buttonGroup({className:"note-color "+t,children:[this.button({className:"note-current-color-button",contents:this.ui.icon(this.options.icons.font+" note-recent-color"),tooltip:e,click:function(t){var e=r()(t.currentTarget);o&&n?i.context.invoke("editor.color",{backColor:e.attr("data-backColor"),foreColor:e.attr("data-foreColor")}):o?i.context.invoke("editor.color",{backColor:e.attr("data-backColor")}):n&&i.context.invoke("editor.color",{foreColor:e.attr("data-foreColor")})},callback:function(t){var e=t.find(".note-recent-color");o&&(e.css("background-color",i.options.colorButton.backColor),t.attr("data-backColor",i.options.colorButton.backColor)),n?(e.css("color",i.options.colorButton.foreColor),t.attr("data-foreColor",i.options.colorButton.foreColor)):e.css("color","transparent")}}),this.button({className:"dropdown-toggle",contents:this.ui.dropdownButtonContents("",this.options),tooltip:this.lang.color.more,data:{toggle:"dropdown"}}),this.ui.dropdown({items:(o?['<div class="note-palette">','<div class="note-palette-title">'+this.lang.color.background+"</div>","<div>",'<button type="button" class="note-color-reset btn btn-light btn-default" data-event="backColor" data-value="transparent">',this.lang.color.transparent,"</button>","</div>",'<div class="note-holder" data-event="backColor">\x3c!-- back colors --\x3e</div>',"<div>",'<button type="button" class="note-color-select btn btn-light btn-default" data-event="openPalette" data-value="backColorPicker-'+this.options.id+'">',this.lang.color.cpSelect,"</button>",'<input type="color" id="backColorPicker-'+this.options.id+'" class="note-btn note-color-select-btn" value="'+this.options.colorButton.backColor+'" data-event="backColorPalette-'+this.options.id+'">',"</div>",'<div class="note-holder-custom" id="backColorPalette-'+this.options.id+'" data-event="backColor"></div>',"</div>"].join(""):"")+(n?['<div class="note-palette">','<div class="note-palette-title">'+this.lang.color.foreground+"</div>","<div>",'<button type="button" class="note-color-reset btn btn-light btn-default" data-event="removeFormat" data-value="foreColor">',this.lang.color.resetToDefault,"</button>","</div>",'<div class="note-holder" data-event="foreColor">\x3c!-- fore colors --\x3e</div>',"<div>",'<button type="button" class="note-color-select btn btn-light btn-default" data-event="openPalette" data-value="foreColorPicker-'+this.options.id+'">',this.lang.color.cpSelect,"</button>",'<input type="color" id="foreColorPicker-'+this.options.id+'" class="note-btn note-color-select-btn" value="'+this.options.colorButton.foreColor+'" data-event="foreColorPalette-'+this.options.id+'">',"</div>",'<div class="note-holder-custom" id="foreColorPalette-'+this.options.id+'" data-event="foreColor"></div>',"</div>"].join(""):""),callback:function(t){t.find(".note-holder").each((function(t,e){var o=r()(e);o.append(i.ui.palette({colors:i.options.colors,colorsName:i.options.colorsName,eventName:o.data("event"),container:i.options.container,tooltip:i.options.tooltip}).render())}));var e=[["#FFFFFF","#FFFFFF","#FFFFFF","#FFFFFF","#FFFFFF","#FFFFFF","#FFFFFF","#FFFFFF"]];t.find(".note-holder-custom").each((function(t,o){var n=r()(o);n.append(i.ui.palette({colors:e,colorsName:e,eventName:n.data("event"),container:i.options.container,tooltip:i.options.tooltip}).render())})),t.find("input[type=color]").each((function(e,o){r()(o).on("change",(function(){var e=t.find("#"+r()(this).data("event")).find(".note-color-btn").first(),o=this.value.toUpperCase();e.css("background-color",o).attr("aria-label",o).attr("data-value",o).attr("data-original-title",o),e.trigger("click")}))}))},click:function(e){e.stopPropagation();var o=r()("."+t).find(".note-dropdown-menu"),n=r()(e.target),a=n.data("event"),s=n.attr("data-value");if("openPalette"===a){var l=o.find("#"+s),c=r()(o.find("#"+l.data("event")).find(".note-color-row")[0]),u=c.find(".note-color-btn").last().detach(),d=l.val();u.css("background-color",d).attr("aria-label",d).attr("data-value",d).attr("data-original-title",d),c.prepend(u),l.trigger("click")}else{if(C.contains(["backColor","foreColor"],a)){var f="backColor"===a?"background-color":"color",h=n.closest(".note-color").find(".note-recent-color"),p=n.closest(".note-color").find(".note-current-color-button");h.css(f,s),p.attr("data-"+a,s)}i.context.invoke("editor."+a,s)}}})]}).render()}},{key:"addToolbarButtons",value:function(){var t=this;this.context.memo("button.style",(function(){return t.ui.buttonGroup([t.button({className:"dropdown-toggle",contents:t.ui.dropdownButtonContents(t.ui.icon(t.options.icons.magic),t.options),tooltip:t.lang.style.style,data:{toggle:"dropdown"}}),t.ui.dropdown({className:"dropdown-style",items:t.options.styleTags,title:t.lang.style.style,template:function(e){"string"==typeof e&&(e={tag:e,title:Object.prototype.hasOwnProperty.call(t.lang.style,e)?t.lang.style[e]:e});var o=e.tag,n=e.title;return"<"+o+(e.style?' style="'+e.style+'" ':"")+(e.className?' class="'+e.className+'"':"")+">"+n+"</"+o+">"},click:t.context.createInvokeHandler("editor.formatBlock")})]).render()}));for(var e=function(){var e=t.options.styleTags[o];t.context.memo("button.style."+e,(function(){return t.button({className:"note-btn-style-"+e,contents:'<div data-value="'+e+'">'+e.toUpperCase()+"</div>",tooltip:t.lang.style[e],click:t.context.createInvokeHandler("editor.formatBlock")}).render()}))},o=0,n=this.options.styleTags.length;o<n;o++)e();this.context.memo("button.bold",(function(){return t.button({className:"note-btn-bold",contents:t.ui.icon(t.options.icons.bold),tooltip:t.lang.font.bold+t.representShortcut("bold"),click:t.context.createInvokeHandlerAndUpdateState("editor.bold")}).render()})),this.context.memo("button.italic",(function(){return t.button({className:"note-btn-italic",contents:t.ui.icon(t.options.icons.italic),tooltip:t.lang.font.italic+t.representShortcut("italic"),click:t.context.createInvokeHandlerAndUpdateState("editor.italic")}).render()})),this.context.memo("button.underline",(function(){return t.button({className:"note-btn-underline",contents:t.ui.icon(t.options.icons.underline),tooltip:t.lang.font.underline+t.representShortcut("underline"),click:t.context.createInvokeHandlerAndUpdateState("editor.underline")}).render()})),this.context.memo("button.clear",(function(){return t.button({contents:t.ui.icon(t.options.icons.eraser),tooltip:t.lang.font.clear+t.representShortcut("removeFormat"),click:t.context.createInvokeHandler("editor.removeFormat")}).render()})),this.context.memo("button.strikethrough",(function(){return t.button({className:"note-btn-strikethrough",contents:t.ui.icon(t.options.icons.strikethrough),tooltip:t.lang.font.strikethrough+t.representShortcut("strikethrough"),click:t.context.createInvokeHandlerAndUpdateState("editor.strikethrough")}).render()})),this.context.memo("button.superscript",(function(){return t.button({className:"note-btn-superscript",contents:t.ui.icon(t.options.icons.superscript),tooltip:t.lang.font.superscript,click:t.context.createInvokeHandlerAndUpdateState("editor.superscript")}).render()})),this.context.memo("button.subscript",(function(){return t.button({className:"note-btn-subscript",contents:t.ui.icon(t.options.icons.subscript),tooltip:t.lang.font.subscript,click:t.context.createInvokeHandlerAndUpdateState("editor.subscript")}).render()})),this.context.memo("button.fontname",(function(){var e=t.context.invoke("editor.currentStyle");return t.options.addDefaultFonts&&r().each(e["font-family"].split(","),(function(e,o){o=o.trim().replace(/['"]+/g,""),t.isFontDeservedToAdd(o)&&-1===t.options.fontNames.indexOf(o)&&t.options.fontNames.push(o)})),t.ui.buttonGroup([t.button({className:"dropdown-toggle",contents:t.ui.dropdownButtonContents('<span class="note-current-fontname"></span>',t.options),tooltip:t.lang.font.name,data:{toggle:"dropdown"}}),t.ui.dropdownCheck({className:"dropdown-fontname",checkClassName:t.options.icons.menuCheck,items:t.options.fontNames.filter(t.isFontInstalled.bind(t)),title:t.lang.font.name,template:function(t){return'<span style="font-family: '+m.validFontName(t)+'">'+t+"</span>"},click:t.context.createInvokeHandlerAndUpdateState("editor.fontName")})]).render()})),this.context.memo("button.fontsize",(function(){return t.ui.buttonGroup([t.button({className:"dropdown-toggle",contents:t.ui.dropdownButtonContents('<span class="note-current-fontsize"></span>',t.options),tooltip:t.lang.font.size,data:{toggle:"dropdown"}}),t.ui.dropdownCheck({className:"dropdown-fontsize",checkClassName:t.options.icons.menuCheck,items:t.options.fontSizes,title:t.lang.font.size,click:t.context.createInvokeHandlerAndUpdateState("editor.fontSize")})]).render()})),this.context.memo("button.fontsizeunit",(function(){return t.ui.buttonGroup([t.button({className:"dropdown-toggle",contents:t.ui.dropdownButtonContents('<span class="note-current-fontsizeunit"></span>',t.options),tooltip:t.lang.font.sizeunit,data:{toggle:"dropdown"}}),t.ui.dropdownCheck({className:"dropdown-fontsizeunit",checkClassName:t.options.icons.menuCheck,items:t.options.fontSizeUnits,title:t.lang.font.sizeunit,click:t.context.createInvokeHandlerAndUpdateState("editor.fontSizeUnit")})]).render()})),this.context.memo("button.color",(function(){return t.colorPalette("note-color-all",t.lang.color.recent,!0,!0)})),this.context.memo("button.forecolor",(function(){return t.colorPalette("note-color-fore",t.lang.color.foreground,!1,!0)})),this.context.memo("button.backcolor",(function(){return t.colorPalette("note-color-back",t.lang.color.background,!0,!1)})),this.context.memo("button.ul",(function(){return t.button({contents:t.ui.icon(t.options.icons.unorderedlist),tooltip:t.lang.lists.unordered+t.representShortcut("insertUnorderedList"),click:t.context.createInvokeHandler("editor.insertUnorderedList")}).render()})),this.context.memo("button.ol",(function(){return t.button({contents:t.ui.icon(t.options.icons.orderedlist),tooltip:t.lang.lists.ordered+t.representShortcut("insertOrderedList"),click:t.context.createInvokeHandler("editor.insertOrderedList")}).render()}));var i=this.button({contents:this.ui.icon(this.options.icons.alignLeft),tooltip:this.lang.paragraph.left+this.representShortcut("justifyLeft"),click:this.context.createInvokeHandler("editor.justifyLeft")}),a=this.button({contents:this.ui.icon(this.options.icons.alignCenter),tooltip:this.lang.paragraph.center+this.representShortcut("justifyCenter"),click:this.context.createInvokeHandler("editor.justifyCenter")}),s=this.button({contents:this.ui.icon(this.options.icons.alignRight),tooltip:this.lang.paragraph.right+this.representShortcut("justifyRight"),click:this.context.createInvokeHandler("editor.justifyRight")}),l=this.button({contents:this.ui.icon(this.options.icons.alignJustify),tooltip:this.lang.paragraph.justify+this.representShortcut("justifyFull"),click:this.context.createInvokeHandler("editor.justifyFull")}),c=this.button({contents:this.ui.icon(this.options.icons.outdent),tooltip:this.lang.paragraph.outdent+this.representShortcut("outdent"),click:this.context.createInvokeHandler("editor.outdent")}),u=this.button({contents:this.ui.icon(this.options.icons.indent),tooltip:this.lang.paragraph.indent+this.representShortcut("indent"),click:this.context.createInvokeHandler("editor.indent")});this.context.memo("button.justifyLeft",g.invoke(i,"render")),this.context.memo("button.justifyCenter",g.invoke(a,"render")),this.context.memo("button.justifyRight",g.invoke(s,"render")),this.context.memo("button.justifyFull",g.invoke(l,"render")),this.context.memo("button.outdent",g.invoke(c,"render")),this.context.memo("button.indent",g.invoke(u,"render")),this.context.memo("button.paragraph",(function(){return t.ui.buttonGroup([t.button({className:"dropdown-toggle",contents:t.ui.dropdownButtonContents(t.ui.icon(t.options.icons.alignLeft),t.options),tooltip:t.lang.paragraph.paragraph,data:{toggle:"dropdown"}}),t.ui.dropdown([t.ui.buttonGroup({className:"note-align",children:[i,a,s,l]}),t.ui.buttonGroup({className:"note-list",children:[c,u]})])]).render()})),this.context.memo("button.height",(function(){return t.ui.buttonGroup([t.button({className:"dropdown-toggle",contents:t.ui.dropdownButtonContents(t.ui.icon(t.options.icons.textHeight),t.options),tooltip:t.lang.font.height,data:{toggle:"dropdown"}}),t.ui.dropdownCheck({items:t.options.lineHeights,checkClassName:t.options.icons.menuCheck,className:"dropdown-line-height",title:t.lang.font.height,click:t.context.createInvokeHandler("editor.lineHeight")})]).render()})),this.context.memo("button.table",(function(){return t.ui.buttonGroup([t.button({className:"dropdown-toggle",contents:t.ui.dropdownButtonContents(t.ui.icon(t.options.icons.table),t.options),tooltip:t.lang.table.table,data:{toggle:"dropdown"}}),t.ui.dropdown({title:t.lang.table.table,className:"note-table",items:['<div class="note-dimension-picker">','<div class="note-dimension-picker-mousecatcher" data-event="insertTable" data-value="1x1"></div>','<div class="note-dimension-picker-highlighted"></div>','<div class="note-dimension-picker-unhighlighted"></div>',"</div>",'<div class="note-dimension-display">1 x 1</div>'].join("")})],{callback:function(e){e.find(".note-dimension-picker-mousecatcher").css({width:t.options.insertTableMaxSize.col+"em",height:t.options.insertTableMaxSize.row+"em"}).on("mousedown",t.context.createInvokeHandler("editor.insertTable")).on("mousemove",t.tableMoveHandler.bind(t))}}).render()})),this.context.memo("button.link",(function(){return t.button({contents:t.ui.icon(t.options.icons.link),tooltip:t.lang.link.link+t.representShortcut("linkDialog.show"),click:t.context.createInvokeHandler("linkDialog.show")}).render()})),this.context.memo("button.picture",(function(){return t.button({contents:t.ui.icon(t.options.icons.picture),tooltip:t.lang.image.image,click:t.context.createInvokeHandler("imageDialog.show")}).render()})),this.context.memo("button.video",(function(){return t.button({contents:t.ui.icon(t.options.icons.video),tooltip:t.lang.video.video,click:t.context.createInvokeHandler("videoDialog.show")}).render()})),this.context.memo("button.hr",(function(){return t.button({contents:t.ui.icon(t.options.icons.minus),tooltip:t.lang.hr.insert+t.representShortcut("insertHorizontalRule"),click:t.context.createInvokeHandler("editor.insertHorizontalRule")}).render()})),this.context.memo("button.fullscreen",(function(){return t.button({className:"btn-fullscreen note-codeview-keep",contents:t.ui.icon(t.options.icons.arrowsAlt),tooltip:t.lang.options.fullscreen,click:t.context.createInvokeHandler("fullscreen.toggle")}).render()})),this.context.memo("button.codeview",(function(){return t.button({className:"btn-codeview note-codeview-keep",contents:t.ui.icon(t.options.icons.code),tooltip:t.lang.options.codeview,click:t.context.createInvokeHandler("codeview.toggle")}).render()})),this.context.memo("button.redo",(function(){return t.button({contents:t.ui.icon(t.options.icons.redo),tooltip:t.lang.history.redo+t.representShortcut("redo"),click:t.context.createInvokeHandler("editor.redo")}).render()})),this.context.memo("button.undo",(function(){return t.button({contents:t.ui.icon(t.options.icons.undo),tooltip:t.lang.history.undo+t.representShortcut("undo"),click:t.context.createInvokeHandler("editor.undo")}).render()})),this.context.memo("button.help",(function(){return t.button({contents:t.ui.icon(t.options.icons.question),tooltip:t.lang.options.help,click:t.context.createInvokeHandler("helpDialog.show")}).render()}))}},{key:"addImagePopoverButtons",value:function(){var t=this;this.context.memo("button.resizeFull",(function(){return t.button({contents:'<span class="note-fontsize-10">100%</span>',tooltip:t.lang.image.resizeFull,click:t.context.createInvokeHandler("editor.resize","1")}).render()})),this.context.memo("button.resizeHalf",(function(){return t.button({contents:'<span class="note-fontsize-10">50%</span>',tooltip:t.lang.image.resizeHalf,click:t.context.createInvokeHandler("editor.resize","0.5")}).render()})),this.context.memo("button.resizeQuarter",(function(){return t.button({contents:'<span class="note-fontsize-10">25%</span>',tooltip:t.lang.image.resizeQuarter,click:t.context.createInvokeHandler("editor.resize","0.25")}).render()})),this.context.memo("button.resizeNone",(function(){return t.button({contents:t.ui.icon(t.options.icons.rollback),tooltip:t.lang.image.resizeNone,click:t.context.createInvokeHandler("editor.resize","0")}).render()})),this.context.memo("button.floatLeft",(function(){return t.button({contents:t.ui.icon(t.options.icons.floatLeft),tooltip:t.lang.image.floatLeft,click:t.context.createInvokeHandler("editor.floatMe","left")}).render()})),this.context.memo("button.floatRight",(function(){return t.button({contents:t.ui.icon(t.options.icons.floatRight),tooltip:t.lang.image.floatRight,click:t.context.createInvokeHandler("editor.floatMe","right")}).render()})),this.context.memo("button.floatNone",(function(){return t.button({contents:t.ui.icon(t.options.icons.rollback),tooltip:t.lang.image.floatNone,click:t.context.createInvokeHandler("editor.floatMe","none")}).render()})),this.context.memo("button.removeMedia",(function(){return t.button({contents:t.ui.icon(t.options.icons.trash),tooltip:t.lang.image.remove,click:t.context.createInvokeHandler("editor.removeMedia")}).render()}))}},{key:"addLinkPopoverButtons",value:function(){var t=this;this.context.memo("button.linkDialogShow",(function(){return t.button({contents:t.ui.icon(t.options.icons.link),tooltip:t.lang.link.edit,click:t.context.createInvokeHandler("linkDialog.show")}).render()})),this.context.memo("button.unlink",(function(){return t.button({contents:t.ui.icon(t.options.icons.unlink),tooltip:t.lang.link.unlink,click:t.context.createInvokeHandler("editor.unlink")}).render()}))}},{key:"addTablePopoverButtons",value:function(){var t=this;this.context.memo("button.addRowUp",(function(){return t.button({className:"btn-md",contents:t.ui.icon(t.options.icons.rowAbove),tooltip:t.lang.table.addRowAbove,click:t.context.createInvokeHandler("editor.addRow","top")}).render()})),this.context.memo("button.addRowDown",(function(){return t.button({className:"btn-md",contents:t.ui.icon(t.options.icons.rowBelow),tooltip:t.lang.table.addRowBelow,click:t.context.createInvokeHandler("editor.addRow","bottom")}).render()})),this.context.memo("button.addColLeft",(function(){return t.button({className:"btn-md",contents:t.ui.icon(t.options.icons.colBefore),tooltip:t.lang.table.addColLeft,click:t.context.createInvokeHandler("editor.addCol","left")}).render()})),this.context.memo("button.addColRight",(function(){return t.button({className:"btn-md",contents:t.ui.icon(t.options.icons.colAfter),tooltip:t.lang.table.addColRight,click:t.context.createInvokeHandler("editor.addCol","right")}).render()})),this.context.memo("button.deleteRow",(function(){return t.button({className:"btn-md",contents:t.ui.icon(t.options.icons.rowRemove),tooltip:t.lang.table.delRow,click:t.context.createInvokeHandler("editor.deleteRow")}).render()})),this.context.memo("button.deleteCol",(function(){return t.button({className:"btn-md",contents:t.ui.icon(t.options.icons.colRemove),tooltip:t.lang.table.delCol,click:t.context.createInvokeHandler("editor.deleteCol")}).render()})),this.context.memo("button.deleteTable",(function(){return t.button({className:"btn-md",contents:t.ui.icon(t.options.icons.trash),tooltip:t.lang.table.delTable,click:t.context.createInvokeHandler("editor.deleteTable")}).render()}))}},{key:"build",value:function(t,e){for(var o=0,n=e.length;o<n;o++){for(var i=e[o],r=Array.isArray(i)?i[0]:i,a=Array.isArray(i)?1===i.length?[i[0]]:i[1]:[i],s=this.ui.buttonGroup({className:"note-"+r}).render(),l=0,c=a.length;l<c;l++){var u=this.context.memo("button."+a[l]);u&&s.append("function"==typeof u?u(this.context):u)}s.appendTo(t)}}},{key:"updateCurrentStyle",value:function(t){var e=t||this.$toolbar,o=this.context.invoke("editor.currentStyle");if(this.updateBtnStates(e,{".note-btn-bold":function(){return"bold"===o["font-bold"]},".note-btn-italic":function(){return"italic"===o["font-italic"]},".note-btn-underline":function(){return"underline"===o["font-underline"]},".note-btn-subscript":function(){return"subscript"===o["font-subscript"]},".note-btn-superscript":function(){return"superscript"===o["font-superscript"]},".note-btn-strikethrough":function(){return"strikethrough"===o["font-strikethrough"]}}),o["font-family"]){var n=o["font-family"].split(",").map((function(t){return t.replace(/[\'\"]/g,"").replace(/\s+$/,"").replace(/^\s+/,"")})),i=C.find(n,this.isFontInstalled.bind(this));e.find(".dropdown-fontname a").each((function(t,e){var o=r()(e),n=o.data("value")+""==i+"";o.toggleClass("checked",n)})),e.find(".note-current-fontname").text(i).css("font-family",i)}if(o["font-size"]){var a=o["font-size"];e.find(".dropdown-fontsize a").each((function(t,e){var o=r()(e),n=o.data("value")+""==a+"";o.toggleClass("checked",n)})),e.find(".note-current-fontsize").text(a);var s=o["font-size-unit"];e.find(".dropdown-fontsizeunit a").each((function(t,e){var o=r()(e),n=o.data("value")+""==s+"";o.toggleClass("checked",n)})),e.find(".note-current-fontsizeunit").text(s)}if(o["line-height"]){var l=o["line-height"];e.find(".dropdown-line-height a").each((function(t,e){var o=r()(e),n=r()(e).data("value")+""==l+"";o.toggleClass("checked",n)})),e.find(".note-current-line-height").text(l)}}},{key:"updateBtnStates",value:function(t,e){var o=this;r().each(e,(function(e,n){o.ui.toggleBtnActive(t.find(e),n())}))}},{key:"tableMoveHandler",value:function(t){var e,o=r()(t.target.parentNode),n=o.next(),i=o.find(".note-dimension-picker-mousecatcher"),a=o.find(".note-dimension-picker-highlighted"),s=o.find(".note-dimension-picker-unhighlighted");if(void 0===t.offsetX){var l=r()(t.target).offset();e={x:t.pageX-l.left,y:t.pageY-l.top}}else e={x:t.offsetX,y:t.offsetY};var c=Math.ceil(e.x/18)||1,u=Math.ceil(e.y/18)||1;a.css({width:c+"em",height:u+"em"}),i.data("value",c+"x"+u),c>3&&c<this.options.insertTableMaxSize.col&&s.css({width:c+1+"em"}),u>3&&u<this.options.insertTableMaxSize.row&&s.css({height:u+1+"em"}),n.html(c+" x "+u)}}],e&&_e(t.prototype,e),o&&_e(t,o),Object.defineProperty(t,"prototype",{writable:!1}),t;var t,e,o}();function Ye(t){return Ye="function"==typeof Symbol&&"symbol"==typeof Symbol.iterator?function(t){return typeof t}:function(t){return t&&"function"==typeof Symbol&&t.constructor===Symbol&&t!==Symbol.prototype?"symbol":typeof t},Ye(t)}function Xe(t,e){for(var o=0;o<e.length;o++){var n=e[o];n.enumerable=n.enumerable||!1,n.configurable=!0,"value"in n&&(n.writable=!0),Object.defineProperty(t,Qe(n.key),n)}}function Qe(t){var e=function(t,e){if("object"!=Ye(t)||!t)return t;var o=t[Symbol.toPrimitive];if(void 0!==o){var n=o.call(t,e||"default");if("object"!=Ye(n))return n;throw new TypeError("@@toPrimitive must return a primitive value.")}return("string"===e?String:Number)(t)}(t,"string");return"symbol"==Ye(e)?e:e+""}var Je=function(){return t=function t(e){!function(t,e){if(!(t instanceof e))throw new TypeError("Cannot call a class as a function")}(this,t),this.context=e,this.$window=r()(window),this.$document=r()(document),this.ui=r().summernote.ui,this.$note=e.layoutInfo.note,this.$editor=e.layoutInfo.editor,this.$toolbar=e.layoutInfo.toolbar,this.$editable=e.layoutInfo.editable,this.$statusbar=e.layoutInfo.statusbar,this.options=e.options,this.isFollowing=!1,this.followScroll=this.followScroll.bind(this)},(e=[{key:"shouldInitialize",value:function(){return!this.options.airMode}},{key:"initialize",value:function(){var t=this;this.options.toolbar=this.options.toolbar||[],this.options.toolbar.length?this.context.invoke("buttons.build",this.$toolbar,this.options.toolbar):this.$toolbar.hide(),this.options.toolbarContainer&&this.$toolbar.appendTo(this.options.toolbarContainer),this.changeContainer(!1),this.$note.on("summernote.keyup summernote.mouseup summernote.change",(function(){t.context.invoke("buttons.updateCurrentStyle")})),this.context.invoke("buttons.updateCurrentStyle"),this.options.followingToolbar&&this.$window.on("scroll resize",this.followScroll)}},{key:"destroy",value:function(){this.$toolbar.children().remove(),this.options.followingToolbar&&this.$window.off("scroll resize",this.followScroll)}},{key:"followScroll",value:function(){if(this.$editor.hasClass("fullscreen"))return!1;var t=this.$editor.outerHeight(),e=this.$editor.width(),o=this.$toolbar.height(),n=this.$statusbar.height(),i=0;this.options.otherStaticBar&&(i=r()(this.options.otherStaticBar).outerHeight());var a=this.$document.scrollTop(),s=this.$editor.offset().top,l=s-i,c=s+t-i-o-n;!this.isFollowing&&a>l&&a<c-o?(this.isFollowing=!0,this.$editable.css({marginTop:this.$toolbar.outerHeight()}),this.$toolbar.css({position:"fixed",top:i,width:e,zIndex:1e3})):this.isFollowing&&(a<l||a>c)&&(this.isFollowing=!1,this.$toolbar.css({position:"relative",top:0,width:"100%",zIndex:"auto"}),this.$editable.css({marginTop:""}))}},{key:"changeContainer",value:function(t){t?this.$toolbar.prependTo(this.$editor):this.options.toolbarContainer&&this.$toolbar.appendTo(this.options.toolbarContainer),this.options.followingToolbar&&this.followScroll()}},{key:"updateFullscreen",value:function(t){this.ui.toggleBtnActive(this.$toolbar.find(".btn-fullscreen"),t),this.changeContainer(t)}},{key:"updateCodeview",value:function(t){this.ui.toggleBtnActive(this.$toolbar.find(".btn-codeview"),t),t?this.deactivate():this.activate()}},{key:"activate",value:function(t){var e=this.$toolbar.find("button");t||(e=e.not(".note-codeview-keep")),this.ui.toggleBtn(e,!0)}},{key:"deactivate",value:function(t){var e=this.$toolbar.find("button");t||(e=e.not(".note-codeview-keep")),this.ui.toggleBtn(e,!1)}}])&&Xe(t.prototype,e),o&&Xe(t,o),Object.defineProperty(t,"prototype",{writable:!1}),t;var t,e,o}();function to(t){return to="function"==typeof Symbol&&"symbol"==typeof Symbol.iterator?function(t){return typeof t}:function(t){return t&&"function"==typeof Symbol&&t.constructor===Symbol&&t!==Symbol.prototype?"symbol":typeof t},to(t)}function eo(t,e){for(var o=0;o<e.length;o++){var n=e[o];n.enumerable=n.enumerable||!1,n.configurable=!0,"value"in n&&(n.writable=!0),Object.defineProperty(t,oo(n.key),n)}}function oo(t){var e=function(t,e){if("object"!=to(t)||!t)return t;var o=t[Symbol.toPrimitive];if(void 0!==o){var n=o.call(t,e||"default");if("object"!=to(n))return n;throw new TypeError("@@toPrimitive must return a primitive value.")}return("string"===e?String:Number)(t)}(t,"string");return"symbol"==to(e)?e:e+""}var no=/^[a-zA-Z0-9._%+-]+@[a-zA-Z0-9.-]+\.[a-zA-Z]{2,}$/,io=/^(\+?\d{1,3}[\s-]?)?(\d{1,4})[\s-]?(\d{1,4})[\s-]?(\d{1,4})$/,ro=/^([A-Za-z][A-Za-z0-9+-.]*\:|#|\/)/,ao=function(){return t=function t(e){!function(t,e){if(!(t instanceof e))throw new TypeError("Cannot call a class as a function")}(this,t),this.context=e,this.ui=r().summernote.ui,this.$body=r()(document.body),this.$editor=e.layoutInfo.editor,this.options=e.options,this.lang=this.options.langInfo,e.memo("help.linkDialog.show",this.options.langInfo.help["linkDialog.show"])},(e=[{key:"initialize",value:function(){var t=this.options.dialogsInBody?this.$body:this.options.container,e=['<div class="form-group note-form-group">','<label for="note-dialog-link-txt-'.concat(this.options.id,'" class="note-form-label">').concat(this.lang.link.textToDisplay,"</label>"),'<input id="note-dialog-link-txt-'.concat(this.options.id,'" class="note-link-text form-control note-form-control note-input" type="text"/>'),"</div>",'<div class="form-group note-form-group">','<label for="note-dialog-link-url-'.concat(this.options.id,'" class="note-form-label">').concat(this.lang.link.url,"</label>"),'<input id="note-dialog-link-url-'.concat(this.options.id,'" class="note-link-url form-control note-form-control note-input" type="text" value="http://"/>'),"</div>",this.options.disableLinkTarget?"":r()("<div></div>").append(this.ui.checkbox({className:"sn-checkbox-open-in-new-window",text:this.lang.link.openInNewWindow,checked:!0}).render()).html()].join(""),o='<input type="button" href="#" class="'.concat("btn btn-primary note-btn note-btn-primary note-link-btn",'" value="').concat(this.lang.link.insert,'" disabled>');this.$dialog=this.ui.dialog({className:"link-dialog",title:this.lang.link.insert,fade:this.options.dialogsFade,body:e,footer:o}).render().appendTo(t)}},{key:"destroy",value:function(){this.ui.hideDialog(this.$dialog),this.$dialog.remove()}},{key:"bindEnterKey",value:function(t,e){t.on("keypress",(function(t){t.keyCode===Nt.code.ENTER&&(t.preventDefault(),e.trigger("click"))}))}},{key:"checkLinkUrl",value:function(t){return no.test(t)?"mailto://"+t:io.test(t)?"tel://"+t:ro.test(t)?t:"http://"+t}},{key:"onCheckLinkUrl",value:function(t){var e=this;t.on("blur",(function(t){t.target.value=""==t.target.value?"":e.checkLinkUrl(t.target.value)}))}},{key:"toggleLinkBtn",value:function(t,e,o){this.ui.toggleBtn(t,e.val()&&o.val())}},{key:"showLinkDialog",value:function(t){var e=this;return r().Deferred((function(o){var n=e.$dialog.find(".note-link-text"),i=e.$dialog.find(".note-link-url"),r=e.$dialog.find(".note-link-btn"),a=e.$dialog.find(".sn-checkbox-open-in-new-window input[type=checkbox]");e.ui.onDialogShown(e.$dialog,(function(){e.context.triggerEvent("dialog.shown"),!t.url&&g.isValidUrl(t.text)&&(t.url=e.checkLinkUrl(t.text)),n.on("input paste propertychange",(function(){var o=n.val(),a=document.createElement("div");a.innerText=o,o=a.innerHTML,t.text=o,e.toggleLinkBtn(r,n,i)})).val(t.text),i.on("input paste propertychange",(function(){t.text||n.val(i.val()),e.toggleLinkBtn(r,n,i)})).val(t.url),m.isSupportTouch||i.trigger("focus"),e.toggleLinkBtn(r,n,i),e.bindEnterKey(i,r),e.bindEnterKey(n,r),e.onCheckLinkUrl(i);var s=void 0!==t.isNewWindow?t.isNewWindow:e.context.options.linkTargetBlank;a.prop("checked",s),r.one("click",(function(r){r.preventDefault(),o.resolve({range:t.range,url:i.val(),text:n.val(),isNewWindow:a.is(":checked")}),e.ui.hideDialog(e.$dialog)}))})),e.ui.onDialogHidden(e.$dialog,(function(){n.off(),i.off(),r.off(),"pending"===o.state()&&o.reject()})),e.ui.showDialog(e.$dialog)})).promise()}},{key:"show",value:function(){var t=this,e=this.context.invoke("editor.getLinkInfo");this.context.invoke("editor.saveRange"),this.showLinkDialog(e).then((function(e){t.context.invoke("editor.restoreRange"),t.context.invoke("editor.createLink",e)})).fail((function(){t.context.invoke("editor.restoreRange")}))}}])&&eo(t.prototype,e),o&&eo(t,o),Object.defineProperty(t,"prototype",{writable:!1}),t;var t,e,o}();function so(t){return so="function"==typeof Symbol&&"symbol"==typeof Symbol.iterator?function(t){return typeof t}:function(t){return t&&"function"==typeof Symbol&&t.constructor===Symbol&&t!==Symbol.prototype?"symbol":typeof t},so(t)}function lo(t,e){for(var o=0;o<e.length;o++){var n=e[o];n.enumerable=n.enumerable||!1,n.configurable=!0,"value"in n&&(n.writable=!0),Object.defineProperty(t,co(n.key),n)}}function co(t){var e=function(t,e){if("object"!=so(t)||!t)return t;var o=t[Symbol.toPrimitive];if(void 0!==o){var n=o.call(t,e||"default");if("object"!=so(n))return n;throw new TypeError("@@toPrimitive must return a primitive value.")}return("string"===e?String:Number)(t)}(t,"string");return"symbol"==so(e)?e:e+""}var uo=function(){return t=function t(e){var o=this;!function(t,e){if(!(t instanceof e))throw new TypeError("Cannot call a class as a function")}(this,t),this.context=e,this.ui=r().summernote.ui,this.options=e.options,this.events={"summernote.keyup summernote.mouseup summernote.change summernote.scroll":function(){o.update()},"summernote.disable summernote.dialog.shown":function(){o.hide()},"summernote.blur":function(t,e){e.originalEvent&&e.originalEvent.relatedTarget&&o.$popover[0].contains(e.originalEvent.relatedTarget)||o.hide()}}},(e=[{key:"shouldInitialize",value:function(){return!C.isEmpty(this.options.popover.link)}},{key:"initialize",value:function(){this.$popover=this.ui.popover({className:"note-link-popover",callback:function(t){t.find(".popover-content,.note-popover-content").prepend('<span><a target="_blank"></a>&nbsp;</span>')}}).render().appendTo(this.options.container);var t=this.$popover.find(".popover-content,.note-popover-content");this.context.invoke("buttons.build",t,this.options.popover.link),this.$popover.on("mousedown",(function(t){t.preventDefault()}))}},{key:"destroy",value:function(){this.$popover.remove()}},{key:"update",value:function(){if(this.context.invoke("editor.hasFocus")){var t=this.context.invoke("editor.getLastRange");if(t.isCollapsed()&&t.isOnAnchor()){var e=pt.ancestor(t.sc,pt.isAnchor),o=r()(e).attr("href");this.$popover.find("a").attr("href",o).text(o);var n=pt.posFromPlaceholder(e),i=r()(this.options.container).offset();n.top-=i.top,n.left-=i.left,this.$popover.css({display:"block",left:n.left,top:n.top})}else this.hide()}else this.hide()}},{key:"hide",value:function(){this.$popover.hide()}}])&&lo(t.prototype,e),o&&lo(t,o),Object.defineProperty(t,"prototype",{writable:!1}),t;var t,e,o}();function fo(t){return fo="function"==typeof Symbol&&"symbol"==typeof Symbol.iterator?function(t){return typeof t}:function(t){return t&&"function"==typeof Symbol&&t.constructor===Symbol&&t!==Symbol.prototype?"symbol":typeof t},fo(t)}function ho(t,e){for(var o=0;o<e.length;o++){var n=e[o];n.enumerable=n.enumerable||!1,n.configurable=!0,"value"in n&&(n.writable=!0),Object.defineProperty(t,po(n.key),n)}}function po(t){var e=function(t,e){if("object"!=fo(t)||!t)return t;var o=t[Symbol.toPrimitive];if(void 0!==o){var n=o.call(t,e||"default");if("object"!=fo(n))return n;throw new TypeError("@@toPrimitive must return a primitive value.")}return("string"===e?String:Number)(t)}(t,"string");return"symbol"==fo(e)?e:e+""}var mo=function(){return t=function t(e){!function(t,e){if(!(t instanceof e))throw new TypeError("Cannot call a class as a function")}(this,t),this.context=e,this.ui=r().summernote.ui,this.$body=r()(document.body),this.$editor=e.layoutInfo.editor,this.options=e.options,this.lang=this.options.langInfo},(e=[{key:"initialize",value:function(){var t="";if(this.options.maximumImageFileSize){var e=Math.floor(Math.log(this.options.maximumImageFileSize)/Math.log(1024)),o=1*(this.options.maximumImageFileSize/Math.pow(1024,e)).toFixed(2)+" "+" KMGTP"[e]+"B";t="<small>".concat(this.lang.image.maximumFileSize+" : "+o,"</small>")}var n=this.options.dialogsInBody?this.$body:this.options.container,i=['<div class="form-group note-form-group note-group-select-from-files">','<label for="note-dialog-image-file-'+this.options.id+'" class="note-form-label">'+this.lang.image.selectFromFiles+"</label>",'<input id="note-dialog-image-file-'+this.options.id+'" class="note-image-input form-control-file note-form-control note-input" ',' type="file" name="files" accept="'+this.options.acceptImageFileTypes+'" multiple="multiple"/>',t,"</div>",'<div class="form-group note-group-image-url">','<label for="note-dialog-image-url-'+this.options.id+'" class="note-form-label">'+this.lang.image.url+"</label>",'<input id="note-dialog-image-url-'+this.options.id+'" class="note-image-url form-control note-form-control note-input" type="text"/>',"</div>"].join(""),r='<input type="button" href="#" class="'.concat("btn btn-primary note-btn note-btn-primary note-image-btn",'" value="').concat(this.lang.image.insert,'" disabled>');this.$dialog=this.ui.dialog({title:this.lang.image.insert,fade:this.options.dialogsFade,body:i,footer:r}).render().appendTo(n)}},{key:"destroy",value:function(){this.ui.hideDialog(this.$dialog),this.$dialog.remove()}},{key:"bindEnterKey",value:function(t,e){t.on("keypress",(function(t){t.keyCode===Nt.code.ENTER&&(t.preventDefault(),e.trigger("click"))}))}},{key:"show",value:function(){var t=this;this.context.invoke("editor.saveRange"),this.showImageDialog().then((function(e){t.ui.hideDialog(t.$dialog),t.context.invoke("editor.restoreRange"),"string"==typeof e?t.options.callbacks.onImageLinkInsert?t.context.triggerEvent("image.link.insert",e):t.context.invoke("editor.insertImage",e):t.context.invoke("editor.insertImagesOrCallback",e)})).fail((function(){t.context.invoke("editor.restoreRange")}))}},{key:"showImageDialog",value:function(){var t=this;return r().Deferred((function(e){var o=t.$dialog.find(".note-image-input"),n=t.$dialog.find(".note-image-url"),i=t.$dialog.find(".note-image-btn");t.ui.onDialogShown(t.$dialog,(function(){t.context.triggerEvent("dialog.shown"),o.replaceWith(o.clone().on("change",(function(t){e.resolve(t.target.files||t.target.value)})).val("")),n.on("input paste propertychange",(function(){t.ui.toggleBtn(i,n.val())})).val(""),m.isSupportTouch||n.trigger("focus"),i.on("click",(function(t){t.preventDefault(),e.resolve(n.val())})),t.bindEnterKey(n,i)})),t.ui.onDialogHidden(t.$dialog,(function(){o.off(),n.off(),i.off(),"pending"===e.state()&&e.reject()})),t.ui.showDialog(t.$dialog)}))}}])&&ho(t.prototype,e),o&&ho(t,o),Object.defineProperty(t,"prototype",{writable:!1}),t;var t,e,o}();function vo(t){return vo="function"==typeof Symbol&&"symbol"==typeof Symbol.iterator?function(t){return typeof t}:function(t){return t&&"function"==typeof Symbol&&t.constructor===Symbol&&t!==Symbol.prototype?"symbol":typeof t},vo(t)}function go(t,e){for(var o=0;o<e.length;o++){var n=e[o];n.enumerable=n.enumerable||!1,n.configurable=!0,"value"in n&&(n.writable=!0),Object.defineProperty(t,bo(n.key),n)}}function bo(t){var e=function(t,e){if("object"!=vo(t)||!t)return t;var o=t[Symbol.toPrimitive];if(void 0!==o){var n=o.call(t,e||"default");if("object"!=vo(n))return n;throw new TypeError("@@toPrimitive must return a primitive value.")}return("string"===e?String:Number)(t)}(t,"string");return"symbol"==vo(e)?e:e+""}var yo=function(){return t=function t(e){var o=this;!function(t,e){if(!(t instanceof e))throw new TypeError("Cannot call a class as a function")}(this,t),this.context=e,this.ui=r().summernote.ui,this.editable=e.layoutInfo.editable[0],this.options=e.options,this.events={"summernote.disable summernote.dialog.shown":function(){o.hide()},"summernote.blur":function(t,e){e.originalEvent&&e.originalEvent.relatedTarget&&o.$popover[0].contains(e.originalEvent.relatedTarget)||o.hide()}}},e=[{key:"shouldInitialize",value:function(){return!C.isEmpty(this.options.popover.image)}},{key:"initialize",value:function(){this.$popover=this.ui.popover({className:"note-image-popover"}).render().appendTo(this.options.container);var t=this.$popover.find(".popover-content,.note-popover-content");this.context.invoke("buttons.build",t,this.options.popover.image),this.$popover.on("mousedown",(function(t){t.preventDefault()}))}},{key:"destroy",value:function(){this.$popover.remove()}},{key:"update",value:function(t,e){if(pt.isImg(t)){var o=r()(t).offset(),n=r()(this.options.container).offset(),i={};this.options.popatmouse?(i.left=e.pageX-20,i.top=e.pageY):i=o,i.top-=n.top,i.left-=n.left,this.$popover.css({display:"block",left:i.left,top:i.top})}else this.hide()}},{key:"hide",value:function(){this.$popover.hide()}}],e&&go(t.prototype,e),o&&go(t,o),Object.defineProperty(t,"prototype",{writable:!1}),t;var t,e,o}();function ko(t){return ko="function"==typeof Symbol&&"symbol"==typeof Symbol.iterator?function(t){return typeof t}:function(t){return t&&"function"==typeof Symbol&&t.constructor===Symbol&&t!==Symbol.prototype?"symbol":typeof t},ko(t)}function wo(t,e){for(var o=0;o<e.length;o++){var n=e[o];n.enumerable=n.enumerable||!1,n.configurable=!0,"value"in n&&(n.writable=!0),Object.defineProperty(t,Co(n.key),n)}}function Co(t){var e=function(t,e){if("object"!=ko(t)||!t)return t;var o=t[Symbol.toPrimitive];if(void 0!==o){var n=o.call(t,e||"default");if("object"!=ko(n))return n;throw new TypeError("@@toPrimitive must return a primitive value.")}return("string"===e?String:Number)(t)}(t,"string");return"symbol"==ko(e)?e:e+""}var So=function(){return t=function t(e){var o=this;!function(t,e){if(!(t instanceof e))throw new TypeError("Cannot call a class as a function")}(this,t),this.context=e,this.ui=r().summernote.ui,this.options=e.options,this.events={"summernote.mousedown":function(t,e){o.update(e.target)},"summernote.keyup summernote.scroll summernote.change":function(){o.update()},"summernote.disable summernote.dialog.shown":function(){o.hide()},"summernote.blur":function(t,e){e.originalEvent&&e.originalEvent.relatedTarget&&o.$popover[0].contains(e.originalEvent.relatedTarget)||o.hide()}}},e=[{key:"shouldInitialize",value:function(){return!C.isEmpty(this.options.popover.table)}},{key:"initialize",value:function(){this.$popover=this.ui.popover({className:"note-table-popover"}).render().appendTo(this.options.container);var t=this.$popover.find(".popover-content,.note-popover-content");this.context.invoke("buttons.build",t,this.options.popover.table),m.isFF&&document.execCommand("enableInlineTableEditing",!1,!1),this.$popover.on("mousedown",(function(t){t.preventDefault()}))}},{key:"destroy",value:function(){this.$popover.remove()}},{key:"update",value:function(t){if(this.context.isDisabled())return!1;var e=pt.isCell(t)||pt.isCell(null==t?void 0:t.parentElement);if(e){var o=pt.posFromPlaceholder(t),n=r()(this.options.container).offset();o.top-=n.top,o.left-=n.left,this.$popover.css({display:"block",left:o.left,top:o.top})}else this.hide();return e}},{key:"hide",value:function(){this.$popover.hide()}}],e&&wo(t.prototype,e),o&&wo(t,o),Object.defineProperty(t,"prototype",{writable:!1}),t;var t,e,o}();function xo(t){return xo="function"==typeof Symbol&&"symbol"==typeof Symbol.iterator?function(t){return typeof t}:function(t){return t&&"function"==typeof Symbol&&t.constructor===Symbol&&t!==Symbol.prototype?"symbol":typeof t},xo(t)}function To(t,e){for(var o=0;o<e.length;o++){var n=e[o];n.enumerable=n.enumerable||!1,n.configurable=!0,"value"in n&&(n.writable=!0),Object.defineProperty(t,Eo(n.key),n)}}function Eo(t){var e=function(t,e){if("object"!=xo(t)||!t)return t;var o=t[Symbol.toPrimitive];if(void 0!==o){var n=o.call(t,e||"default");if("object"!=xo(n))return n;throw new TypeError("@@toPrimitive must return a primitive value.")}return("string"===e?String:Number)(t)}(t,"string");return"symbol"==xo(e)?e:e+""}var Po=function(){return t=function t(e){!function(t,e){if(!(t instanceof e))throw new TypeError("Cannot call a class as a function")}(this,t),this.context=e,this.ui=r().summernote.ui,this.$body=r()(document.body),this.$editor=e.layoutInfo.editor,this.options=e.options,this.lang=this.options.langInfo},(e=[{key:"initialize",value:function(){var t=this.options.dialogsInBody?this.$body:this.options.container,e=['<div class="form-group note-form-group row-fluid">','<label for="note-dialog-video-url-'.concat(this.options.id,'" class="note-form-label">').concat(this.lang.video.url,' <small class="text-muted">').concat(this.lang.video.providers,"</small></label>"),'<input id="note-dialog-video-url-'.concat(this.options.id,'" class="note-video-url form-control note-form-control note-input" type="text"/>'),"</div>"].join(""),o='<input type="button" href="#" class="'.concat("btn btn-primary note-btn note-btn-primary note-video-btn",'" value="').concat(this.lang.video.insert,'" disabled>');this.$dialog=this.ui.dialog({title:this.lang.video.insert,fade:this.options.dialogsFade,body:e,footer:o}).render().appendTo(t)}},{key:"destroy",value:function(){this.ui.hideDialog(this.$dialog),this.$dialog.remove()}},{key:"bindEnterKey",value:function(t,e){t.on("keypress",(function(t){t.keyCode===Nt.code.ENTER&&(t.preventDefault(),e.trigger("click"))}))}},{key:"createVideoNode",value:function(t){var e,o=t.match(/(?:youtu\.be\/|youtube\.com\/(?:[^\/\n\s]+\/\S+\/|(?:v|e(?:mbed)?)\/|\S*?[?&]v=|shorts\/|live\/))([^&\n?]+)(?:.*[?&]t=([^&\n]+))?.*/),n=t.match(/(?:\.|\/\/)drive\.google\.com\/file\/d\/(.[a-zA-Z0-9_-]*)\/view/),i=t.match(/(?:www\.|\/\/)instagram\.com\/(reel|p)\/(.[a-zA-Z0-9_-]*)/),a=t.match(/\/\/vine\.co\/v\/([a-zA-Z0-9]+)/),s=t.match(/\/\/(player\.)?vimeo\.com\/([a-z]*\/)*(\d+)[?]?.*/),l=t.match(/.+dailymotion.com\/(video|hub)\/([^_]+)[^#]*(#video=([^_&]+))?/),c=t.match(/\/\/v\.youku\.com\/v_show\/id_(\w+)=*\.html/),u=t.match(/\/\/(.*)\/videos\/watch\/([^?]*)(?:\?(?:start=(\w*))?(?:&stop=(\w*))?(?:&loop=([10]))?(?:&autoplay=([10]))?(?:&muted=([10]))?)?/),d=t.match(/\/\/v\.qq\.com.*?vid=(.+)/),f=t.match(/\/\/v\.qq\.com\/x?\/?(page|cover).*?\/([^\/]+)\.html\??.*/),h=t.match(/^.+.(mp4|m4v)$/),p=t.match(/^.+.(ogg|ogv)$/),m=t.match(/^.+.(webm)$/),v=t.match(/(?:www\.|\/\/)facebook\.com\/([^\/]+)\/videos\/([0-9]+)/);if(o&&11===o[1].length){var g=o[1],b=0;if(void 0!==o[2]){var y=o[2].match(/^(?:(\d+)h)?(?:(\d+)m)?(?:(\d+)s)?$/);if(y)for(var k=[3600,60,1],w=0,C=k.length;w<C;w++)b+=void 0!==y[w+1]?k[w]*parseInt(y[w+1],10):0;else b=parseInt(o[2],10)}e=r()("<iframe>").attr("frameborder",0).attr("src","//www.youtube.com/embed/"+g+(b>0?"?start="+b:"")).attr("width","640").attr("height","360")}else if(n&&n[0].length)e=r()("<iframe>").attr("frameborder",0).attr("src","https://drive.google.com/file/d/"+n[1]+"/preview").attr("width","640").attr("height","480");else if(i&&i[0].length)e=r()("<iframe>").attr("frameborder",0).attr("src","https://instagram.com/p/"+i[2]+"/embed/").attr("width","612").attr("height","710").attr("scrolling","no").attr("allowtransparency","true");else if(a&&a[0].length)e=r()("<iframe>").attr("frameborder",0).attr("src",a[0]+"/embed/simple").attr("width","600").attr("height","600").attr("class","vine-embed");else if(s&&s[3].length)e=r()("<iframe webkitallowfullscreen mozallowfullscreen allowfullscreen>").attr("frameborder",0).attr("src","//player.vimeo.com/video/"+s[3]).attr("width","640").attr("height","360");else if(l&&l[2].length)e=r()("<iframe>").attr("frameborder",0).attr("src","//www.dailymotion.com/embed/video/"+l[2]).attr("width","640").attr("height","360");else if(c&&c[1].length)e=r()("<iframe webkitallowfullscreen mozallowfullscreen allowfullscreen>").attr("frameborder",0).attr("height","498").attr("width","510").attr("src","//player.youku.com/embed/"+c[1]);else if(u&&u[0].length){var S=0;"undefined"!==u[2]&&(S=u[2]);var x=0;"undefined"!==u[3]&&(x=u[3]);var T=0;"undefined"!==u[4]&&(T=u[4]);var E=0;"undefined"!==u[5]&&(E=u[5]);var P=0;"undefined"!==u[6]&&(P=u[6]),e=r()('<iframe allowfullscreen sandbox="allow-same-origin allow-scripts allow-popups">').attr("frameborder",0).attr("src","//"+u[1]+"/videos/embed/"+u[2]+"?loop="+T+"&autoplay="+E+"&muted="+P+(S>0?"&start="+S:"")+(x>0?"&end="+b:"")).attr("width","560").attr("height","315")}else if(d&&d[1].length||f&&f[2].length){var N=d&&d[1].length?d[1]:f[2];e=r()("<iframe webkitallowfullscreen mozallowfullscreen allowfullscreen>").attr("frameborder",0).attr("height","310").attr("width","500").attr("src","https://v.qq.com/txp/iframe/player.html?vid="+N+"&amp;auto=0")}else if(h||p||m)e=r()("<video controls>").attr("src",t).attr("width","640").attr("height","360");else{if(!v||!v[0].length)return!1;e=r()("<iframe>").attr("frameborder",0).attr("src","https://www.facebook.com/plugins/video.php?href="+encodeURIComponent(v[0])+"&show_text=0&width=560").attr("width","560").attr("height","301").attr("scrolling","no").attr("allowtransparency","true")}return e.addClass("note-video-clip"),e[0]}},{key:"show",value:function(){var t=this,e=this.context.invoke("editor.getSelectedText");this.context.invoke("editor.saveRange"),this.showVideoDialog(e).then((function(e){t.ui.hideDialog(t.$dialog),t.context.invoke("editor.restoreRange");var o=t.createVideoNode(e);o&&t.context.invoke("editor.insertNode",o)})).fail((function(){t.context.invoke("editor.restoreRange")}))}},{key:"showVideoDialog",value:function(){var t=this;return r().Deferred((function(e){var o=t.$dialog.find(".note-video-url"),n=t.$dialog.find(".note-video-btn");t.ui.onDialogShown(t.$dialog,(function(){t.context.triggerEvent("dialog.shown"),o.on("input paste propertychange",(function(){t.ui.toggleBtn(n,o.val())})),m.isSupportTouch||o.trigger("focus"),n.on("click",(function(t){t.preventDefault(),e.resolve(o.val())})),t.bindEnterKey(o,n)})),t.ui.onDialogHidden(t.$dialog,(function(){o.off(),n.off(),"pending"===e.state()&&e.reject()})),t.ui.showDialog(t.$dialog)}))}}])&&To(t.prototype,e),o&&To(t,o),Object.defineProperty(t,"prototype",{writable:!1}),t;var t,e,o}();function No(t){return No="function"==typeof Symbol&&"symbol"==typeof Symbol.iterator?function(t){return typeof t}:function(t){return t&&"function"==typeof Symbol&&t.constructor===Symbol&&t!==Symbol.prototype?"symbol":typeof t},No(t)}function $o(t,e){for(var o=0;o<e.length;o++){var n=e[o];n.enumerable=n.enumerable||!1,n.configurable=!0,"value"in n&&(n.writable=!0),Object.defineProperty(t,Io(n.key),n)}}function Io(t){var e=function(t,e){if("object"!=No(t)||!t)return t;var o=t[Symbol.toPrimitive];if(void 0!==o){var n=o.call(t,e||"default");if("object"!=No(n))return n;throw new TypeError("@@toPrimitive must return a primitive value.")}return("string"===e?String:Number)(t)}(t,"string");return"symbol"==No(e)?e:e+""}var Ro=function(){return t=function t(e){!function(t,e){if(!(t instanceof e))throw new TypeError("Cannot call a class as a function")}(this,t),this.context=e,this.ui=r().summernote.ui,this.$body=r()(document.body),this.$editor=e.layoutInfo.editor,this.options=e.options,this.lang=this.options.langInfo},e=[{key:"initialize",value:function(){var t=this.options.dialogsInBody?this.$body:this.options.container,e=['<p class="text-center">','<a href="http://summernote.org/" target="_blank" rel="noopener noreferrer">Summernote 0.9.1</a> · ','<a href="https://github.com/summernote/summernote" target="_blank" rel="noopener noreferrer">Project</a> · ','<a href="https://github.com/summernote/summernote/issues" target="_blank" rel="noopener noreferrer">Issues</a>',"</p>"].join("");this.$dialog=this.ui.dialog({title:this.lang.options.help,fade:this.options.dialogsFade,body:this.createShortcutList(),footer:e,callback:function(t){t.find(".modal-body,.note-modal-body").css({"max-height":300,overflow:"scroll"})}}).render().appendTo(t)}},{key:"destroy",value:function(){this.ui.hideDialog(this.$dialog),this.$dialog.remove()}},{key:"createShortcutList",value:function(){var t=this,e=this.options.keyMap[m.isMac?"mac":"pc"];return Object.keys(e).map((function(o){var n=e[o],i=r()('<div><div class="help-list-item"></div></div>');return i.append(r()("<label><kbd>"+o+"</kdb></label>").css({width:180,"margin-right":10})).append(r()("<span></span>").html(t.context.memo("help."+n)||n)),i.html()})).join("")}},{key:"showHelpDialog",value:function(){var t=this;return r().Deferred((function(e){t.ui.onDialogShown(t.$dialog,(function(){t.context.triggerEvent("dialog.shown"),e.resolve()})),t.ui.showDialog(t.$dialog)})).promise()}},{key:"show",value:function(){var t=this;this.context.invoke("editor.saveRange"),this.showHelpDialog().then((function(){t.context.invoke("editor.restoreRange")}))}}],e&&$o(t.prototype,e),o&&$o(t,o),Object.defineProperty(t,"prototype",{writable:!1}),t;var t,e,o}();function Ao(t){return Ao="function"==typeof Symbol&&"symbol"==typeof Symbol.iterator?function(t){return typeof t}:function(t){return t&&"function"==typeof Symbol&&t.constructor===Symbol&&t!==Symbol.prototype?"symbol":typeof t},Ao(t)}function Lo(t,e){for(var o=0;o<e.length;o++){var n=e[o];n.enumerable=n.enumerable||!1,n.configurable=!0,"value"in n&&(n.writable=!0),Object.defineProperty(t,Fo(n.key),n)}}function Fo(t){var e=function(t,e){if("object"!=Ao(t)||!t)return t;var o=t[Symbol.toPrimitive];if(void 0!==o){var n=o.call(t,e||"default");if("object"!=Ao(n))return n;throw new TypeError("@@toPrimitive must return a primitive value.")}return("string"===e?String:Number)(t)}(t,"string");return"symbol"==Ao(e)?e:e+""}var Do=function(){return t=function t(e){var o=this;!function(t,e){if(!(t instanceof e))throw new TypeError("Cannot call a class as a function")}(this,t),this.context=e,this.ui=r().summernote.ui,this.options=e.options,this.hidable=!0,this.onContextmenu=!1,this.pageX=null,this.pageY=null,this.events={"summernote.contextmenu":function(t){o.options.editing&&(t.preventDefault(),t.stopPropagation(),o.onContextmenu=!0,o.update(!0))},"summernote.mousedown":function(t,e){o.pageX=e.pageX,o.pageY=e.pageY},"summernote.keyup summernote.mouseup summernote.scroll":function(t,e){if(o.options.editing&&!o.onContextmenu){if("keyup"==e.type){var n=o.context.invoke("editor.getLastRange").getWordRange(),i=g.rect2bnd(C.last(n.getClientRects()));o.pageX=i.left,o.pageY=i.top}else o.pageX=e.pageX,o.pageY=e.pageY;o.update()}o.onContextmenu=!1},"summernote.disable summernote.change summernote.dialog.shown summernote.blur":function(){o.hide()},"summernote.focusout":function(){o.$popover.is(":active,:focus")||o.hide()}}},(e=[{key:"shouldInitialize",value:function(){return this.options.airMode&&!C.isEmpty(this.options.popover.air)}},{key:"initialize",value:function(){var t=this;this.$popover=this.ui.popover({className:"note-air-popover"}).render().appendTo(this.options.container);var e=this.$popover.find(".popover-content");this.context.invoke("buttons.build",e,this.options.popover.air),this.$popover.on("mousedown",(function(){t.hidable=!1})),this.$popover.on("mouseup",(function(){t.hidable=!0}))}},{key:"destroy",value:function(){this.$popover.remove()}},{key:"update",value:function(t){var e=this.context.invoke("editor.currentStyle");if(!e.range||e.range.isCollapsed()&&!t)this.hide();else{var o={left:this.pageX,top:this.pageY},n=r()(this.options.container).offset();o.top-=n.top,o.left-=n.left,this.$popover.css({display:"block",left:Math.max(o.left,0)+-5,top:o.top+5}),this.context.invoke("buttons.updateCurrentStyle",this.$popover)}}},{key:"updateCodeview",value:function(t){this.ui.toggleBtnActive(this.$popover.find(".btn-codeview"),t),t&&this.hide()}},{key:"hide",value:function(){this.hidable&&this.$popover.hide()}}])&&Lo(t.prototype,e),o&&Lo(t,o),Object.defineProperty(t,"prototype",{writable:!1}),t;var t,e,o}();function Ho(t){return Ho="function"==typeof Symbol&&"symbol"==typeof Symbol.iterator?function(t){return typeof t}:function(t){return t&&"function"==typeof Symbol&&t.constructor===Symbol&&t!==Symbol.prototype?"symbol":typeof t},Ho(t)}function jo(t,e){for(var o=0;o<e.length;o++){var n=e[o];n.enumerable=n.enumerable||!1,n.configurable=!0,"value"in n&&(n.writable=!0),Object.defineProperty(t,Bo(n.key),n)}}function Bo(t){var e=function(t,e){if("object"!=Ho(t)||!t)return t;var o=t[Symbol.toPrimitive];if(void 0!==o){var n=o.call(t,e||"default");if("object"!=Ho(n))return n;throw new TypeError("@@toPrimitive must return a primitive value.")}return("string"===e?String:Number)(t)}(t,"string");return"symbol"==Ho(e)?e:e+""}var Oo=function(){return t=function t(e){var o=this;!function(t,e){if(!(t instanceof e))throw new TypeError("Cannot call a class as a function")}(this,t),this.context=e,this.ui=r().summernote.ui,this.$editable=e.layoutInfo.editable,this.options=e.options,this.hint=this.options.hint||[],this.direction=this.options.hintDirection||"bottom",this.hints=Array.isArray(this.hint)?this.hint:[this.hint],this.events={"summernote.keyup":function(t,e){e.isDefaultPrevented()||o.handleKeyup(e)},"summernote.keydown":function(t,e){o.handleKeydown(e)},"summernote.disable summernote.dialog.shown summernote.blur":function(){o.hide()}}},e=[{key:"shouldInitialize",value:function(){return this.hints.length>0}},{key:"initialize",value:function(){var t=this;this.lastWordRange=null,this.matchingWord=null,this.$popover=this.ui.popover({className:"note-hint-popover",hideArrow:!0,direction:""}).render().appendTo(this.options.container),this.$popover.hide(),this.$content=this.$popover.find(".popover-content,.note-popover-content"),this.$content.on("click",".note-hint-item",(function(e){t.$content.find(".active").removeClass("active"),r()(e.currentTarget).addClass("active"),t.replace()})),this.$popover.on("mousedown",(function(t){t.preventDefault()}))}},{key:"destroy",value:function(){this.$popover.remove()}},{key:"selectItem",value:function(t){this.$content.find(".active").removeClass("active"),t.addClass("active"),this.$content[0].scrollTop=t[0].offsetTop-this.$content.innerHeight()/2}},{key:"moveDown",value:function(){var t=this.$content.find(".note-hint-item.active"),e=t.next();if(e.length)this.selectItem(e);else{var o=t.parent().next();o.length||(o=this.$content.find(".note-hint-group").first()),this.selectItem(o.find(".note-hint-item").first())}}},{key:"moveUp",value:function(){var t=this.$content.find(".note-hint-item.active"),e=t.prev();if(e.length)this.selectItem(e);else{var o=t.parent().prev();o.length||(o=this.$content.find(".note-hint-group").last()),this.selectItem(o.find(".note-hint-item").last())}}},{key:"replace",value:function(){var t=this.$content.find(".note-hint-item.active");if(t.length){var e=this.nodeFromItem(t);if(null!==this.matchingWord&&0===this.matchingWord.length)this.lastWordRange.so=this.lastWordRange.eo;else if(null!==this.matchingWord&&this.matchingWord.length>0&&!this.lastWordRange.isCollapsed()){var o=this.lastWordRange.eo-this.lastWordRange.so-this.matchingWord.length;o>0&&(this.lastWordRange.so+=o)}if(this.lastWordRange.insertNode(e),"next"===this.options.hintSelect){var n=document.createTextNode("");r()(e).after(n),Et.createFromNodeBefore(n).select()}else Et.createFromNodeAfter(e).select();this.lastWordRange=null,this.hide(),this.context.invoke("editor.focus"),this.context.triggerEvent("change",this.$editable.html(),this.$editable)}}},{key:"nodeFromItem",value:function(t){var e=this.hints[t.data("index")],o=t.data("item"),n=e.content?e.content(o):o;return"string"==typeof n&&(n=pt.createText(n)),n}},{key:"createItemTemplates",value:function(t,e){var o=this.hints[t];return e.map((function(e,n){var i=r()('<div class="note-hint-item"></div>');return i.append(o.template?o.template(e):e+""),i.data({index:t,item:e}),0===t&&0===n&&i.addClass("active"),i}))}},{key:"handleKeydown",value:function(t){this.$popover.is(":visible")&&(t.keyCode===Nt.code.ENTER?(t.preventDefault(),this.replace()):t.keyCode===Nt.code.UP?(t.preventDefault(),this.moveUp()):t.keyCode===Nt.code.DOWN&&(t.preventDefault(),this.moveDown()))}},{key:"searchKeyword",value:function(t,e,o){var n=this.hints[t];if(n&&n.match.test(e)&&n.search){var i=n.match.exec(e);this.matchingWord=i[0],n.search(i[1],o)}else o()}},{key:"createGroup",value:function(t,e){var o=this,n=r()('<div class="note-hint-group note-hint-group-'+t+'"></div>');return this.searchKeyword(t,e,(function(e){(e=e||[]).length&&(n.html(o.createItemTemplates(t,e)),o.show())})),n}},{key:"handleKeyup",value:function(t){var e=this;if(!C.contains([Nt.code.ENTER,Nt.code.UP,Nt.code.DOWN],t.keyCode)){var o,n,i=this.context.invoke("editor.getLastRange");if("words"===this.options.hintMode){if(o=i.getWordsRange(i),n=o.toString(),this.hints.forEach((function(t){if(t.match.test(n))return o=i.getWordsMatchRange(t.match),!1})),!o)return void this.hide();n=o.toString()}else o=i.getWordRange(),n=o.toString();if(this.hints.length&&n){this.$content.empty();var a=g.rect2bnd(C.last(o.getClientRects())),s=r()(this.options.container).offset();a&&(a.top-=s.top,a.left-=s.left,this.$popover.hide(),this.lastWordRange=o,this.hints.forEach((function(t,o){t.match.test(n)&&e.createGroup(o,n).appendTo(e.$content)})),this.$content.find(".note-hint-item").first().addClass("active"),"top"===this.direction?this.$popover.css({left:a.left,top:a.top-this.$popover.outerHeight()-5}):this.$popover.css({left:a.left,top:a.top+a.height+5}))}else this.hide()}}},{key:"show",value:function(){this.$popover.show()}},{key:"hide",value:function(){this.$popover.hide()}}],e&&jo(t.prototype,e),o&&jo(t,o),Object.defineProperty(t,"prototype",{writable:!1}),t;var t,e,o}();function zo(t){return zo="function"==typeof Symbol&&"symbol"==typeof Symbol.iterator?function(t){return typeof t}:function(t){return t&&"function"==typeof Symbol&&t.constructor===Symbol&&t!==Symbol.prototype?"symbol":typeof t},zo(t)}function Mo(t,e){for(var o=0;o<e.length;o++){var n=e[o];n.enumerable=n.enumerable||!1,n.configurable=!0,"value"in n&&(n.writable=!0),Object.defineProperty(t,Uo(n.key),n)}}function Uo(t){var e=function(t,e){if("object"!=zo(t)||!t)return t;var o=t[Symbol.toPrimitive];if(void 0!==o){var n=o.call(t,e||"default");if("object"!=zo(n))return n;throw new TypeError("@@toPrimitive must return a primitive value.")}return("string"===e?String:Number)(t)}(t,"string");return"symbol"==zo(e)?e:e+""}r().summernote=r().extend(r().summernote,{version:"0.9.1",plugins:{},dom:pt,range:Et,lists:C,options:{langInfo:r().summernote.lang["en-US"],editing:!0,modules:{editor:oe,clipboard:ae,dropzone:ue,codeview:ve,statusbar:ke,fullscreen:xe,handle:Ne,hintPopover:Oo,autoLink:Le,autoSync:je,autoReplace:Me,placeholder:qe,buttons:Ze,toolbar:Je,linkDialog:ao,linkPopover:uo,imageDialog:mo,imagePopover:yo,tablePopover:So,videoDialog:Po,helpDialog:Ro,airPopover:Do},buttons:{},lang:"en-US",followingToolbar:!1,toolbarPosition:"top",otherStaticBar:"",codeviewKeepButton:!1,toolbar:[["style",["style"]],["font",["bold","underline","clear"]],["fontname",["fontname"]],["color",["color"]],["para",["ul","ol","paragraph"]],["table",["table"]],["insert",["link","picture","video"]],["view",["fullscreen","codeview","help"]]],popatmouse:!0,popover:{image:[["resize",["resizeFull","resizeHalf","resizeQuarter","resizeNone"]],["float",["floatLeft","floatRight","floatNone"]],["remove",["removeMedia"]]],link:[["link",["linkDialogShow","unlink"]]],table:[["add",["addRowDown","addRowUp","addColLeft","addColRight"]],["delete",["deleteRow","deleteCol","deleteTable"]]],air:[["color",["color"]],["font",["bold","underline","clear"]],["para",["ul","paragraph"]],["table",["table"]],["insert",["link","picture"]],["view",["fullscreen","codeview"]]]},linkAddNoReferrer:!1,addLinkNoOpener:!1,airMode:!1,overrideContextMenu:!1,width:null,height:null,linkTargetBlank:!0,focus:!1,tabDisable:!1,tabSize:4,styleWithCSS:!1,shortcuts:!0,textareaAutoSync:!0,tooltip:"auto",container:null,maxTextLength:0,blockquoteBreakingLevel:2,spellCheck:!0,disableGrammar:!1,placeholder:null,inheritPlaceholder:!1,recordEveryKeystroke:!1,historyLimit:200,showDomainOnlyForAutolink:!1,hintMode:"word",hintSelect:"after",hintDirection:"bottom",styleTags:["p","blockquote","pre","h1","h2","h3","h4","h5","h6"],fontNames:["Arial","Arial Black","Comic Sans MS","Courier New","Helvetica Neue","Helvetica","Impact","Lucida Grande","Tahoma","Times New Roman","Verdana"],fontNamesIgnoreCheck:[],addDefaultFonts:!0,fontSizes:["8","9","10","11","12","14","18","24","36"],fontSizeUnits:["px","pt"],colors:[["#000000","#424242","#636363","#9C9C94","#CEC6CE","#EFEFEF","#F7F7F7","#FFFFFF"],["#FF0000","#FF9C00","#FFFF00","#00FF00","#00FFFF","#0000FF","#9C00FF","#FF00FF"],["#F7C6CE","#FFE7CE","#FFEFC6","#D6EFD6","#CEDEE7","#CEE7F7","#D6D6E7","#E7D6DE"],["#E79C9C","#FFC69C","#FFE79C","#B5D6A5","#A5C6CE","#9CC6EF","#B5A5D6","#D6A5BD"],["#E76363","#F7AD6B","#FFD663","#94BD7B","#73A5AD","#6BADDE","#8C7BC6","#C67BA5"],["#CE0000","#E79439","#EFC631","#6BA54A","#4A7B8C","#3984C6","#634AA5","#A54A7B"],["#9C0000","#B56308","#BD9400","#397B21","#104A5A","#085294","#311873","#731842"],["#630000","#7B3900","#846300","#295218","#083139","#003163","#21104A","#4A1031"]],colorsName:[["Black","Tundora","Dove Gray","Star Dust","Pale Slate","Gallery","Alabaster","White"],["Red","Orange Peel","Yellow","Green","Cyan","Blue","Electric Violet","Magenta"],["Azalea","Karry","Egg White","Zanah","Botticelli","Tropical Blue","Mischka","Twilight"],["Tonys Pink","Peach Orange","Cream Brulee","Sprout","Casper","Perano","Cold Purple","Careys Pink"],["Mandy","Rajah","Dandelion","Olivine","Gulf Stream","Viking","Blue Marguerite","Puce"],["Guardsman Red","Fire Bush","Golden Dream","Chelsea Cucumber","Smalt Blue","Boston Blue","Butterfly Bush","Cadillac"],["Sangria","Mai Tai","Buddha Gold","Forest Green","Eden","Venice Blue","Meteorite","Claret"],["Rosewood","Cinnamon","Olive","Parsley","Tiber","Midnight Blue","Valentino","Loulou"]],colorButton:{foreColor:"#000000",backColor:"#FFFF00"},lineHeights:["1.0","1.2","1.4","1.5","1.6","1.8","2.0","3.0"],tableClassName:"table table-bordered",insertTableMaxSize:{col:10,row:10},dialogsInBody:!1,dialogsFade:!1,maximumImageFileSize:null,acceptImageFileTypes:"image/*",allowClipboardImagePasting:!0,callbacks:{onBeforeCommand:null,onBlur:null,onBlurCodeview:null,onChange:null,onChangeCodeview:null,onDialogShown:null,onEnter:null,onFocus:null,onImageLinkInsert:null,onImageUpload:null,onImageUploadError:null,onInit:null,onKeydown:null,onKeyup:null,onMousedown:null,onMouseup:null,onPaste:null,onScroll:null},codemirror:{mode:"text/html",htmlMode:!0,lineNumbers:!0},codeviewFilter:!0,codeviewFilterRegex:/<\/*(?:applet|b(?:ase|gsound|link)|embed|frame(?:set)?|ilayer|l(?:ayer|ink)|meta|object|s(?:cript|tyle)|t(?:itle|extarea)|xml)[^>]*?>/gi,codeviewIframeFilter:!0,codeviewIframeWhitelistSrc:[],codeviewIframeWhitelistSrcBase:["www.youtube.com","www.youtube-nocookie.com","www.facebook.com","vine.co","instagram.com","player.vimeo.com","www.dailymotion.com","player.youku.com","jumpingbean.tv","v.qq.com"],keyMap:{pc:{ESC:"escape",ENTER:"insertParagraph","CTRL+Z":"undo","CTRL+Y":"redo",TAB:"tab","SHIFT+TAB":"untab","CTRL+B":"bold","CTRL+I":"italic","CTRL+U":"underline","CTRL+SHIFT+S":"strikethrough","CTRL+BACKSLASH":"removeFormat","CTRL+SHIFT+L":"justifyLeft","CTRL+SHIFT+E":"justifyCenter","CTRL+SHIFT+R":"justifyRight","CTRL+SHIFT+J":"justifyFull","CTRL+SHIFT+NUM7":"insertUnorderedList","CTRL+SHIFT+NUM8":"insertOrderedList","CTRL+LEFTBRACKET":"outdent","CTRL+RIGHTBRACKET":"indent","CTRL+NUM0":"formatPara","CTRL+NUM1":"formatH1","CTRL+NUM2":"formatH2","CTRL+NUM3":"formatH3","CTRL+NUM4":"formatH4","CTRL+NUM5":"formatH5","CTRL+NUM6":"formatH6","CTRL+ENTER":"insertHorizontalRule","CTRL+K":"linkDialog.show"},mac:{ESC:"escape",ENTER:"insertParagraph","CMD+Z":"undo","CMD+SHIFT+Z":"redo",TAB:"tab","SHIFT+TAB":"untab","CMD+B":"bold","CMD+I":"italic","CMD+U":"underline","CMD+SHIFT+S":"strikethrough","CMD+BACKSLASH":"removeFormat","CMD+SHIFT+L":"justifyLeft","CMD+SHIFT+E":"justifyCenter","CMD+SHIFT+R":"justifyRight","CMD+SHIFT+J":"justifyFull","CMD+SHIFT+NUM7":"insertUnorderedList","CMD+SHIFT+NUM8":"insertOrderedList","CMD+LEFTBRACKET":"outdent","CMD+RIGHTBRACKET":"indent","CMD+NUM0":"formatPara","CMD+NUM1":"formatH1","CMD+NUM2":"formatH2","CMD+NUM3":"formatH3","CMD+NUM4":"formatH4","CMD+NUM5":"formatH5","CMD+NUM6":"formatH6","CMD+ENTER":"insertHorizontalRule","CMD+K":"linkDialog.show"}},icons:{align:"note-icon-align",alignCenter:"note-icon-align-center",alignJustify:"note-icon-align-justify",alignLeft:"note-icon-align-left",alignRight:"note-icon-align-right",rowBelow:"note-icon-row-below",colBefore:"note-icon-col-before",colAfter:"note-icon-col-after",rowAbove:"note-icon-row-above",rowRemove:"note-icon-row-remove",colRemove:"note-icon-col-remove",indent:"note-icon-align-indent",outdent:"note-icon-align-outdent",arrowsAlt:"note-icon-arrows-alt",bold:"note-icon-bold",caret:"note-icon-caret",circle:"note-icon-circle",close:"note-icon-close",code:"note-icon-code",eraser:"note-icon-eraser",floatLeft:"note-icon-float-left",floatRight:"note-icon-float-right",font:"note-icon-font",frame:"note-icon-frame",italic:"note-icon-italic",link:"note-icon-link",unlink:"note-icon-chain-broken",magic:"note-icon-magic",menuCheck:"note-icon-menu-check",minus:"note-icon-minus",orderedlist:"note-icon-orderedlist",pencil:"note-icon-pencil",picture:"note-icon-picture",question:"note-icon-question",redo:"note-icon-redo",rollback:"note-icon-rollback",square:"note-icon-square",strikethrough:"note-icon-strikethrough",subscript:"note-icon-subscript",superscript:"note-icon-superscript",table:"note-icon-table",textHeight:"note-icon-text-height",trash:"note-icon-trash",underline:"note-icon-underline",undo:"note-icon-undo",unorderedlist:"note-icon-unorderedlist",video:"note-icon-video"}}});var Wo=function(){return t=function t(e,o,n,i){!function(t,e){if(!(t instanceof e))throw new TypeError("Cannot call a class as a function")}(this,t),this.markup=e,this.children=o,this.options=n,this.callback=i},(e=[{key:"render",value:function(t){var e=r()(this.markup);if(this.options&&this.options.contents&&e.html(this.options.contents),this.options&&this.options.className&&e.addClass(this.options.className),this.options&&this.options.data&&r().each(this.options.data,(function(t,o){e.attr("data-"+t,o)})),this.options&&this.options.click&&e.on("click",this.options.click),this.children){var o=e.find(".note-children-container");this.children.forEach((function(t){t.render(o.length?o:e)}))}return this.callback&&this.callback(e,this.options),this.options&&this.options.callback&&this.options.callback(e),t&&t.append(e),e}}])&&Mo(t.prototype,e),o&&Mo(t,o),Object.defineProperty(t,"prototype",{writable:!1}),t;var t,e,o}();const Ko=function(t,e){return function(){var o="object"===zo(arguments[1])?arguments[1]:arguments[0],n=Array.isArray(arguments[0])?arguments[0]:[];return o&&o.children&&(n=o.children),new Wo(t,n,o,e)}};function qo(t){return qo="function"==typeof Symbol&&"symbol"==typeof Symbol.iterator?function(t){return typeof t}:function(t){return t&&"function"==typeof Symbol&&t.constructor===Symbol&&t!==Symbol.prototype?"symbol":typeof t},qo(t)}function Vo(t,e){for(var o=0;o<e.length;o++){var n=e[o];n.enumerable=n.enumerable||!1,n.configurable=!0,"value"in n&&(n.writable=!0),Object.defineProperty(t,_o(n.key),n)}}function _o(t){var e=function(t,e){if("object"!=qo(t)||!t)return t;var o=t[Symbol.toPrimitive];if(void 0!==o){var n=o.call(t,e||"default");if("object"!=qo(n))return n;throw new TypeError("@@toPrimitive must return a primitive value.")}return("string"===e?String:Number)(t)}(t,"string");return"symbol"==qo(e)?e:e+""}const Go=function(){return t=function t(e,o){if(function(t,e){if(!(t instanceof e))throw new TypeError("Cannot call a class as a function")}(this,t),this.$node=e,this.options=r().extend({},{title:"",target:o.container,trigger:"hover focus",placement:"bottom"},o),this.$tooltip=r()(['<div class="note-tooltip">','<div class="note-tooltip-arrow"></div>','<div class="note-tooltip-content"></div>',"</div>"].join("")),"manual"!==this.options.trigger){var n=this.show.bind(this),i=this.hide.bind(this),a=this.toggle.bind(this);this.options.trigger.split(" ").forEach((function(t){"hover"===t?(e.off("mouseenter mouseleave"),e.on("mouseenter",n).on("mouseleave",i)):"click"===t?e.on("click",a):"focus"===t&&e.on("focus",n).on("blur",i)}))}},(e=[{key:"show",value:function(){var t=this.$node,e=t.offset(),o=r()(this.options.target).offset();e.top-=o.top,e.left-=o.left;var n=this.$tooltip,i=this.options.title||t.attr("title")||t.data("title"),a=this.options.placement||t.data("placement");n.addClass(a),n.find(".note-tooltip-content").text(i),n.appendTo(this.options.target);var s=t.outerWidth(),l=t.outerHeight(),c=n.outerWidth(),u=n.outerHeight();"bottom"===a?n.css({top:e.top+l,left:e.left+(s/2-c/2)}):"top"===a?n.css({top:e.top-u,left:e.left+(s/2-c/2)}):"left"===a?n.css({top:e.top+(l/2-u/2),left:e.left-c}):"right"===a&&n.css({top:e.top+(l/2-u/2),left:e.left+s}),n.addClass("in")}},{key:"hide",value:function(){var t=this;this.$tooltip.removeClass("in"),setTimeout((function(){t.$tooltip.remove()}),200)}},{key:"toggle",value:function(){this.$tooltip.hasClass("in")?this.hide():this.show()}}])&&Vo(t.prototype,e),o&&Vo(t,o),Object.defineProperty(t,"prototype",{writable:!1}),t;var t,e,o}();function Zo(t){return Zo="function"==typeof Symbol&&"symbol"==typeof Symbol.iterator?function(t){return typeof t}:function(t){return t&&"function"==typeof Symbol&&t.constructor===Symbol&&t!==Symbol.prototype?"symbol":typeof t},Zo(t)}function Yo(t,e){for(var o=0;o<e.length;o++){var n=e[o];n.enumerable=n.enumerable||!1,n.configurable=!0,"value"in n&&(n.writable=!0),Object.defineProperty(t,Xo(n.key),n)}}function Xo(t){var e=function(t,e){if("object"!=Zo(t)||!t)return t;var o=t[Symbol.toPrimitive];if(void 0!==o){var n=o.call(t,e||"default");if("object"!=Zo(n))return n;throw new TypeError("@@toPrimitive must return a primitive value.")}return("string"===e?String:Number)(t)}(t,"string");return"symbol"==Zo(e)?e:e+""}var Qo=function(){return t=function t(e,o){!function(t,e){if(!(t instanceof e))throw new TypeError("Cannot call a class as a function")}(this,t),this.$button=e,this.options=r().extend({},{target:o.container},o),this.setEvent()},e=[{key:"setEvent",value:function(){var t=this;this.$button.on("click",(function(e){t.toggle(),e.stopImmediatePropagation()}))}},{key:"clear",value:function(){var t=r()(".note-btn-group.open");t.find(".note-btn.active").removeClass("active"),t.removeClass("open")}},{key:"show",value:function(){this.$button.addClass("active"),this.$button.parent().addClass("open");var t=this.$button.next(),e=t.offset(),o=t.outerWidth(),n=r()(window).width(),i=parseFloat(r()(this.options.target).css("margin-right"));e.left+o>n-i?t.css("margin-left",n-i-(e.left+o)):t.css("margin-left","")}},{key:"hide",value:function(){this.$button.removeClass("active"),this.$button.parent().removeClass("open")}},{key:"toggle",value:function(){var t=this.$button.parent().hasClass("open");this.clear(),t?this.hide():this.show()}}],e&&Yo(t.prototype,e),o&&Yo(t,o),Object.defineProperty(t,"prototype",{writable:!1}),t;var t,e,o}();r()(document).on("click.note-dropdown-menu",(function(t){r()(t.target).closest(".note-btn-group").length||(r()(".note-btn-group.open .note-btn.active").removeClass("active"),r()(".note-btn-group.open").removeClass("open"))})),r()(document).on("click.note-dropdown-menu",(function(t){r()(t.target).closest(".note-dropdown-menu").parent().removeClass("open"),r()(t.target).closest(".note-dropdown-menu").parent().find(".note-btn.active").removeClass("active")}));const Jo=Qo;function tn(t){return tn="function"==typeof Symbol&&"symbol"==typeof Symbol.iterator?function(t){return typeof t}:function(t){return t&&"function"==typeof Symbol&&t.constructor===Symbol&&t!==Symbol.prototype?"symbol":typeof t},tn(t)}function en(t,e){for(var o=0;o<e.length;o++){var n=e[o];n.enumerable=n.enumerable||!1,n.configurable=!0,"value"in n&&(n.writable=!0),Object.defineProperty(t,on(n.key),n)}}function on(t){var e=function(t,e){if("object"!=tn(t)||!t)return t;var o=t[Symbol.toPrimitive];if(void 0!==o){var n=o.call(t,e||"default");if("object"!=tn(n))return n;throw new TypeError("@@toPrimitive must return a primitive value.")}return("string"===e?String:Number)(t)}(t,"string");return"symbol"==tn(e)?e:e+""}const nn=function(){return t=function t(e){!function(t,e){if(!(t instanceof e))throw new TypeError("Cannot call a class as a function")}(this,t),this.$modal=e,this.$backdrop=r()('<div class="note-modal-backdrop"></div>')},(e=[{key:"show",value:function(){var t=this;this.$backdrop.appendTo(document.body).show(),this.$modal.addClass("open").show(),this.$modal.trigger("note.modal.show"),this.$modal.off("click",".close").on("click",".close",this.hide.bind(this)),this.$modal.on("keydown",(function(e){27===e.which&&(e.preventDefault(),t.hide())}))}},{key:"hide",value:function(){this.$modal.removeClass("open").hide(),this.$backdrop.hide(),this.$modal.trigger("note.modal.hide"),this.$modal.off("keydown")}}])&&en(t.prototype,e),o&&en(t,o),Object.defineProperty(t,"prototype",{writable:!1}),t;var t,e,o}();var rn=Ko('<div class="note-editor note-frame"></div>'),an=Ko('<div class="note-toolbar" role="toolbar"></div>'),sn=Ko('<div class="note-editing-area"></div>'),ln=Ko('<textarea class="note-codable" aria-multiline="true"></textarea>'),cn=Ko('<div class="note-editable" contentEditable="true" role="textbox" aria-multiline="true"></div>'),un=Ko(['<output class="note-status-output" role="status" aria-live="polite"></output>','<div class="note-statusbar" role="status">','<div class="note-resizebar" aria-label="resize">','<div class="note-icon-bar"></div>','<div class="note-icon-bar"></div>','<div class="note-icon-bar"></div>',"</div>","</div>"].join("")),dn=Ko('<div class="note-editor note-airframe"></div>'),fn=Ko(['<div class="note-editable" contentEditable="true" role="textbox" aria-multiline="true"></div>','<output class="note-status-output" role="status" aria-live="polite"></output>'].join("")),hn=Ko('<div class="note-btn-group"></div>'),pn=Ko('<button type="button" class="note-btn" tabindex="-1"></button>',(function(t,e){e&&e.tooltip&&(t.attr({"aria-label":e.tooltip}),t.data("_lite_tooltip",new Go(t,{title:e.tooltip,container:e.container})).on("click",(function(t){r()(t.currentTarget).data("_lite_tooltip").hide()}))),e.contents&&t.html(e.contents),e&&e.data&&"dropdown"===e.data.toggle&&t.data("_lite_dropdown",new Jo(t,{container:e.container})),e&&e.codeviewKeepButton&&t.addClass("note-codeview-keep")})),mn=Ko('<div class="note-dropdown-menu" role="list"></div>',(function(t,e){var o=Array.isArray(e.items)?e.items.map((function(t){var o="string"==typeof t?t:t.value||"",n=e.template?e.template(t):t,i=r()('<a class="note-dropdown-item" href="#" data-value="'+o+'" role="listitem" aria-label="'+o+'"></a>');return i.html(n).data("item",t),i})):e.items;t.html(o).attr({"aria-label":e.title}),t.on("click","> .note-dropdown-item",(function(t){var o=r()(this),n=o.data("item"),i=o.data("value");n.click?n.click(o):e.itemClick&&e.itemClick(t,n,i)})),e&&e.codeviewKeepButton&&t.addClass("note-codeview-keep")})),vn=Ko('<div class="note-dropdown-menu note-check" role="list"></div>',(function(t,e){var o=Array.isArray(e.items)?e.items.map((function(t){var o="string"==typeof t?t:t.value||"",n=e.template?e.template(t):t,i=r()('<a class="note-dropdown-item" href="#" data-value="'+o+'" role="listitem" aria-label="'+t+'"></a>');return i.html([In(e.checkClassName)," ",n]).data("item",t),i})):e.items;t.html(o).attr({"aria-label":e.title}),t.on("click","> .note-dropdown-item",(function(t){var o=r()(this),n=o.data("item"),i=o.data("value");n.click?n.click(o):e.itemClick&&e.itemClick(t,n,i)})),e&&e.codeviewKeepButton&&t.addClass("note-codeview-keep")})),gn=function(t,e){return t+" "+In(e.icons.caret,"span")},bn=function(t,e){return hn([pn({className:"dropdown-toggle",contents:t.title+" "+In("note-icon-caret"),tooltip:t.tooltip,data:{toggle:"dropdown"}}),mn({className:t.className,items:t.items,template:t.template,itemClick:t.itemClick})],{callback:e}).render()},yn=function(t,e){return hn([pn({className:"dropdown-toggle",contents:t.title+" "+In("note-icon-caret"),tooltip:t.tooltip,data:{toggle:"dropdown"}}),vn({className:t.className,checkClassName:t.checkClassName,items:t.items,template:t.template,itemClick:t.itemClick})],{callback:e}).render()},kn=function(t){return hn([pn({className:"dropdown-toggle",contents:t.title+" "+In("note-icon-caret"),tooltip:t.tooltip,data:{toggle:"dropdown"}}),mn([hn({className:"note-align",children:t.items[0]}),hn({className:"note-list",children:t.items[1]})])]).render()},wn=function(t){return hn([pn({className:"dropdown-toggle",contents:t.title+" "+In("note-icon-caret"),tooltip:t.tooltip,data:{toggle:"dropdown"}}),mn({className:"note-table",items:['<div class="note-dimension-picker">','<div class="note-dimension-picker-mousecatcher" data-event="insertTable" data-value="1x1"></div>','<div class="note-dimension-picker-highlighted"></div>','<div class="note-dimension-picker-unhighlighted"></div>',"</div>",'<div class="note-dimension-display">1 x 1</div>'].join("")})],{callback:function(e){e.find(".note-dimension-picker-mousecatcher").css({width:t.col+"em",height:t.row+"em"}).on("mouseup",t.itemClick).on("mousemove",(function(e){!function(t,e,o){var n,i=r()(t.target.parentNode),a=i.next(),s=i.find(".note-dimension-picker-mousecatcher"),l=i.find(".note-dimension-picker-highlighted"),c=i.find(".note-dimension-picker-unhighlighted");if(void 0===t.offsetX){var u=r()(t.target).offset();n={x:t.pageX-u.left,y:t.pageY-u.top}}else n={x:t.offsetX,y:t.offsetY};var d=Math.ceil(n.x/18)||1,f=Math.ceil(n.y/18)||1;l.css({width:d+"em",height:f+"em"}),s.data("value",d+"x"+f),d>3&&d<e&&c.css({width:d+1+"em"}),f>3&&f<o&&c.css({height:f+1+"em"}),a.html(d+" x "+f)}(e,t.col,t.row)}))}}).render()},Cn=Ko('<div class="note-color-palette"></div>',(function(t,e){for(var o=[],n=0,i=e.colors.length;n<i;n++){for(var a=e.eventName,s=e.colors[n],l=e.colorsName[n],c=[],u=0,d=s.length;u<d;u++){var f=s[u],h=l[u];c.push(['<button type="button" class="note-btn note-color-btn"','style="background-color:',f,'" ','data-event="',a,'" ','data-value="',f,'" ','data-title="',h,'" ','aria-label="',h,'" ','data-toggle="button" tabindex="-1"></button>'].join(""))}o.push('<div class="note-color-row">'+c.join("")+"</div>")}t.html(o.join("")),t.find(".note-color-btn").each((function(){r()(this).data("_lite_tooltip",new Go(r()(this),{container:e.container}))}))})),Sn=function(t,e){return hn({className:"note-color",children:[pn({className:"note-current-color-button",contents:t.title,tooltip:t.lang.color.recent,click:t.currentClick,callback:function(t){var o=t.find(".note-recent-color");"foreColor"!==e&&(o.css("background-color","#FFFF00"),t.attr("data-backColor","#FFFF00"))}}),pn({className:"dropdown-toggle",contents:In("note-icon-caret"),tooltip:t.lang.color.more,data:{toggle:"dropdown"}}),mn({items:["<div>",'<div class="note-btn-group btn-background-color">','<div class="note-palette-title">'+t.lang.color.background+"</div>","<div>",'<button type="button" class="note-color-reset note-btn note-btn-block" data-event="backColor" data-value="transparent">',t.lang.color.transparent,"</button>","</div>",'<div class="note-holder" data-event="backColor"></div>','<div class="btn-sm">','<input type="color" id="html5bcp" class="note-btn btn-default" value="#21104A" style="width:100%;" data-value="cp">','<button type="button" class="note-color-reset btn" data-event="backColor" data-value="cpbackColor">',t.lang.color.cpSelect,"</button>","</div>","</div>",'<div class="note-btn-group btn-foreground-color">','<div class="note-palette-title">'+t.lang.color.foreground+"</div>","<div>",'<button type="button" class="note-color-reset note-btn note-btn-block" data-event="removeFormat" data-value="foreColor">',t.lang.color.resetToDefault,"</button>","</div>",'<div class="note-holder" data-event="foreColor"></div>','<div class="btn-sm">','<input type="color" id="html5fcp" class="note-btn btn-default" value="#21104A" style="width:100%;" data-value="cp">','<button type="button" class="note-color-reset btn" data-event="foreColor" data-value="cpforeColor">',t.lang.color.cpSelect,"</button>","</div>","</div>","</div>"].join(""),callback:function(o){o.find(".note-holder").each((function(){var e=r()(this);e.append(Cn({colors:t.colors,eventName:e.data("event")}).render())})),"fore"===e?(o.find(".btn-background-color").hide(),o.css({"min-width":"210px"})):"back"===e&&(o.find(".btn-foreground-color").hide(),o.css({"min-width":"210px"}))},click:function(o){var n=r()(o.target),i=n.data("event"),a=n.data("value"),s=document.getElementById("html5fcp").value,l=document.getElementById("html5bcp").value;if("cp"===a?o.stopPropagation():"cpbackColor"===a?a=l:"cpforeColor"===a&&(a=s),i&&a){var c="backColor"===i?"background-color":"color",u=n.closest(".note-color").find(".note-recent-color"),d=n.closest(".note-color").find(".note-current-color-button");u.css(c,a),d.attr("data-"+i,a),"fore"===e?t.itemClick("foreColor",a):"back"===e?t.itemClick("backColor",a):t.itemClick(i,a)}}})]}).render()},xn=Ko('<div class="note-modal" aria-hidden="false" tabindex="-1" role="dialog"></div>',(function(t,e){e.fade&&t.addClass("fade"),t.attr({"aria-label":e.title}),t.html(['<div class="note-modal-content">',e.title?'<div class="note-modal-header"><button type="button" class="close" aria-label="Close" aria-hidden="true"><i class="note-icon-close"></i></button><h4 class="note-modal-title">'+e.title+"</h4></div>":"",'<div class="note-modal-body">'+e.body+"</div>",e.footer?'<div class="note-modal-footer">'+e.footer+"</div>":"","</div>"].join("")),t.data("modal",new nn(t,e))})),Tn=function(t){var e='<div class="note-form-group"><label for="note-dialog-video-url-'+t.id+'" class="note-form-label">'+t.lang.video.url+' <small class="text-muted">'+t.lang.video.providers+'</small></label><input id="note-dialog-video-url-'+t.id+'" class="note-video-url note-input" type="text"/></div>',o=['<button type="button" href="#" class="note-btn note-btn-primary note-video-btn disabled" disabled>',t.lang.video.insert,"</button>"].join("");return xn({title:t.lang.video.insert,fade:t.fade,body:e,footer:o}).render()},En=function(t){var e='<div class="note-form-group note-group-select-from-files"><label for="note-dialog-image-file-'+t.id+'" class="note-form-label">'+t.lang.image.selectFromFiles+'</label><input id="note-dialog-image-file-'+t.id+'" class="note-note-image-input note-input" type="file" name="files" accept="image/*" multiple="multiple"/>'+t.imageLimitation+'</div><div class="note-form-group"><label for="note-dialog-image-url-'+t.id+'" class="note-form-label">'+t.lang.image.url+'</label><input id="note-dialog-image-url-'+t.id+'" class="note-image-url note-input" type="text"/></div>',o=['<button href="#" type="button" class="note-btn note-btn-primary note-btn-large note-image-btn disabled" disabled>',t.lang.image.insert,"</button>"].join("");return xn({title:t.lang.image.insert,fade:t.fade,body:e,footer:o}).render()},Pn=function(t){var e='<div class="note-form-group"><label for="note-dialog-link-txt-'+t.id+'" class="note-form-label">'+t.lang.link.textToDisplay+'</label><input id="note-dialog-link-txt-'+t.id+'" class="note-link-text note-input" type="text"/></div><div class="note-form-group"><label for="note-dialog-link-url-'+t.id+'" class="note-form-label">'+t.lang.link.url+'</label><input id="note-dialog-link-url-'+t.id+'" class="note-link-url note-input" type="text" value="http://"/></div>'+(t.disableLinkTarget?"":'<div class="checkbox"><label for="note-dialog-link-nw-'+t.id+'"><input id="note-dialog-link-nw-'+t.id+'" type="checkbox" checked> '+t.lang.link.openInNewWindow+"</label></div>"),o=['<button href="#" type="button" class="note-btn note-btn-primary note-link-btn disabled" disabled>',t.lang.link.insert,"</button>"].join("");return xn({className:"link-dialog",title:t.lang.link.insert,fade:t.fade,body:e,footer:o}).render()},Nn=Ko(['<div class="note-popover bottom">','<div class="note-popover-arrow"></div>','<div class="popover-content note-children-container"></div>',"</div>"].join(""),(function(t,e){var o=void 0!==e.direction?e.direction:"bottom";t.addClass(o).hide(),e.hideArrow&&t.find(".note-popover-arrow").hide()})),$n=Ko('<div class="checkbox"></div>',(function(t,e){t.html(["<label"+(e.id?' for="note-'+e.id+'"':"")+">",'<input role="checkbox" type="checkbox"'+(e.id?' id="note-'+e.id+'"':""),e.checked?" checked":"",' aria-checked="'+(e.checked?"true":"false")+'"/>',e.text?e.text:"","</label>"].join(""))})),In=function(t,e){return t.match(/^</)?t:"<"+(e=e||"i")+' class="'+t+'"></'+e+">"};return r().summernote=r().extend(r().summernote,{ui_template:function(t){return{editor:rn,toolbar:an,editingArea:sn,codable:ln,editable:cn,statusbar:un,airEditor:dn,airEditable:fn,buttonGroup:hn,button:pn,dropdown:mn,dropdownCheck:vn,dropdownButton:bn,dropdownButtonContents:gn,dropdownCheckButton:yn,paragraphDropdownButton:kn,tableDropdownButton:wn,colorDropdownButton:Sn,palette:Cn,dialog:xn,videoDialog:Tn,imageDialog:En,linkDialog:Pn,popover:Nn,checkbox:$n,icon:In,options:t,toggleBtn:function(t,e){t.toggleClass("disabled",!e),t.attr("disabled",!e)},toggleBtnActive:function(t,e){t.toggleClass("active",e)},check:function(t,e){t.find(".checked").removeClass("checked"),t.find('[data-value="'+e+'"]').addClass("checked")},onDialogShown:function(t,e){t.one("note.modal.show",e)},onDialogHidden:function(t,e){t.one("note.modal.hide",e)},showDialog:function(t){t.data("modal").show()},hideDialog:function(t){t.data("modal").hide()},getPopoverContent:function(t){return t.find(".note-popover-content")},getDialogBody:function(t){return t.find(".note-modal-body")},createLayout:function(e){var o=(t.airMode?dn([sn([ln(),fn()])]):"bottom"===t.toolbarPosition?rn([sn([ln(),cn()]),an(),un()]):rn([an(),sn([ln(),cn()]),un()])).render();return o.insertAfter(e),{note:e,editor:o,toolbar:o.find(".note-toolbar"),editingArea:o.find(".note-editing-area"),editable:o.find(".note-editable"),codable:o.find(".note-codable"),statusbar:o.find(".note-statusbar")}},removeLayout:function(t,e){t.html(e.editable.html()),e.editor.remove(),t.off("summernote"),t.show()}}},interface:"lite"}),{}})()));
initEditor();

function _calcEditorHeight() {
  var bottomToolbar = document.getElementById('bottom-toolbar');
  var snToolbar     = document.querySelector('.note-toolbar');
  var snStatusbar   = document.querySelector('.note-statusbar');
  var headerEl      = document.querySelector('header');
  var containerPad  = 16; // padding-top di #editor-container

  var headerH    = headerEl     ? headerEl.getBoundingClientRect().height     : 0;
  var snToolbarH = snToolbar    ? snToolbar.getBoundingClientRect().height    : 0;
  var snStatusH  = snStatusbar  ? snStatusbar.getBoundingClientRect().height  : 0;
  var btH        = bottomToolbar? bottomToolbar.getBoundingClientRect().height: 60;

  var available = window.innerHeight - headerH - snToolbarH - snStatusH - btH - containerPad;
  return Math.max(120, available);
}

function initEditor() {
  $(document).ready(function() {

    $('#editor').summernote({
      height: _calcEditorHeight(),
      lang: 'en-US',
      toolbar: [
        ['style',    ['style']],
        ['font',     ['bold', 'italic', 'underline', 'strikethrough',
                      'superscript', 'subscript', 'clear']],
        ['fontname', ['fontname']],
        ['fontsize', ['fontsize']],
        ['color',    ['color']],
        ['para',     ['ul', 'ol', 'paragraph']],
        ['height',   ['height']],
        ['table',    ['table']],
        ['insert',   ['link', 'picture', 'video', 'hr']],
        ['view',     ['fullscreen', 'codeview', 'help']]
      ],
      styleTags: ['p', 'h1', 'h2', 'h3', 'h4', 'h5', 'h6', 'blockquote', 'pre'],
      fontNames: ['Arial', 'Arial Black', 'Comic Sans MS', 'Courier New',
                  'Georgia', 'Times New Roman', 'Verdana', 'system-ui'],
      fontNamesIgnoreCheck: ['system-ui'],
      lineHeights: ['1.0', '1.2', '1.4', '1.5', '1.6', '1.8', '2.0', '2.5', '3.0'],
      callbacks: {
        onImageUpload: function(files) {
          Array.from(files).forEach(function(file) {
            var reader = new FileReader();
            reader.onload = function(e) {
              $('#editor').summernote('insertImage', e.target.result, file.name);
            };
            reader.readAsDataURL(file);
          });
        },
        onChange: function(contents) {
          if (_draftTimer) clearTimeout(_draftTimer);
          _draftTimer = setTimeout(function() {
            _saveContentDraft();
          }, 2000);
        }
      }
    });

    _updateCounter();

    /* ── Boot: legge data island se iniettato da noesis720 ── */
    (function _bootPayload() {
      var payloadEl = document.getElementById('noesisPayload');
      var raw;
      if (payloadEl) {
        raw = payloadEl.textContent;
      }
      if (raw) {
        // Payload from DOM element (inline injection), process synchronously
        _processPayload(raw);
        return;
      }
      // Payload from IndexedDB (bridge reader→editor)
      _loadEditorPayload().then(function(rawPayload) {
        if (rawPayload) {
          _processPayload(rawPayload);
          return;
        }
        // No bridge payload → try loading saved draft
        _loadContentDraft(function(draft) {
          if (!draft) return; // standalone fallback: editor vuoto
          if (!confirm('Unsaved draft found from ' + new Date(draft.savedAt).toLocaleString() + '. Restore it?')) {
            _deleteContentDraft();
            return;
          }
          _mode = 'standalone';
          $('#editor').summernote('code', draft.content);
          snToast('Draft restored');
        });
      });

      function _processPayload(raw) {
        var payload;
        try { payload = JSON.parse(raw); } catch(e) { return; }
        if (!payload) return;

        _mode        = payload.mode        || 'standalone';
        _bookName    = payload.bookName    || '';
        _chapterName = payload.chapterName || '';
        _chapterId   = payload.chapterId   || '';
        _bookId      = payload.bookId      || '';

        // Carica contenuto in Summernote
        if (payload.htmlContent) {
          $('#editor').summernote('code', payload.htmlContent);
        }

        // Carica collezioni dal reader (IndexedDB bridge)
        if (_bookId) _loadReaderCollections(_bookId);

        // Aggiorna titolo header con contesto
        var headerEl = document.getElementById('appHeaderTitle');
        if (headerEl && _bookName) {
          headerEl.textContent = (_chapterName || _bookName) +
            (_mode === 'chunks' ? ' — Report' : '');
        }

        // In modalità chunks: disabilita snapshot export (nessun chapterId)
        if (_mode === 'chunks') {
          var btn = document.getElementById('chExportMainBtn');
          if (btn) {
            btn.disabled = true;
            btn.title = 'Snapshot disabled in Report mode (no chapterId)';
            btn.style.opacity = '0.4';
            btn.style.cursor  = 'not-allowed';
          }
        }

        // Toast informativo una volta per sessione, solo in chapter mode
        if (_mode === 'chapter' && !_toastShown) {
          _toastShown = true;
          setTimeout(function() {
            snToast('Save snapshots to filesystem to find them in the Noesis library.');
          }, 1200);
        }
      }
    })();

    // ── Load editor payload from IndexedDB (bridge reader→editor) ─────────
    function _loadEditorPayload() {
      return new Promise(function(resolve) {
        var request = indexedDB.open('NoesisEditorBridgeDB', 1);
        request.onsuccess = function(e) {
          var db = e.target.result;
          if (!db.objectStoreNames.contains('payloads')) { db.close(); resolve(null); return; }
          var tx = db.transaction('payloads', 'readonly');
          var store = tx.objectStore('payloads');
          var req = store.get('current');
          req.onsuccess = function() {
            var entry = req.result;
            if (!entry || !entry.data) { db.close(); resolve(null); return; }
            var raw = entry.data;
            // Clean up after reading
            var tx2 = db.transaction('payloads', 'readwrite');
            var store2 = tx2.objectStore('payloads');
            store2.delete('current');
            tx2.oncomplete = function() { db.close(); resolve(raw); };
            tx2.onerror = function() { db.close(); resolve(raw); };
          };
          req.onerror = function() { db.close(); resolve(null); };
        };
        request.onerror = function() { resolve(null); };
      });
    }

    // ── Content draft persistence (debounced auto-save) ──────────────
    var _draftTimer = null;
    var _DRAFT_KEY = '_draft_'; // fixed key — single draft, survives reload

    function _saveContentDraft() {
      var content = getContent();
      if (!content || content === '<p><br></p>' || content === '<p>&nbsp;</p>') return;
      var request = indexedDB.open('NoesisEditorDraftsDB', 1);
      request.onupgradeneeded = function(e) {
        var db = e.target.result;
        if (!db.objectStoreNames.contains('drafts')) {
          db.createObjectStore('drafts', { keyPath: 'id' });
        }
      };
      request.onsuccess = function(e) {
        var db = e.target.result;
        var tx = db.transaction('drafts', 'readwrite');
        var store = tx.objectStore('drafts');
        store.put({ id: _DRAFT_KEY, content: content, savedAt: new Date().toISOString() });
        tx.oncomplete = function() { db.close(); };
      };
    }

    function _loadContentDraft(callback) {
      var request = indexedDB.open('NoesisEditorDraftsDB', 1);
      request.onupgradeneeded = function(e) {
        var db = e.target.result;
        if (!db.objectStoreNames.contains('drafts')) {
          db.createObjectStore('drafts', { keyPath: 'id' });
        }
      };
      request.onsuccess = function(e) {
        var db = e.target.result;
        if (!db.objectStoreNames.contains('drafts')) { db.close(); callback(null); return; }
        var tx = db.transaction('drafts', 'readonly');
        var store = tx.objectStore('drafts');
        var req = store.get(_DRAFT_KEY);
        req.onsuccess = function() {
          var entry = req.result;
          db.close();
          callback(entry && entry.content ? entry : null);
        };
        req.onerror = function() { db.close(); callback(null); };
      };
      request.onerror = function() { callback(null); };
    }

    function _deleteContentDraft() {
      var request = indexedDB.open('NoesisEditorDraftsDB', 1);
      request.onupgradeneeded = function(e) {
        var db = e.target.result;
        if (!db.objectStoreNames.contains('drafts')) {
          db.createObjectStore('drafts', { keyPath: 'id' });
        }
      };
      request.onsuccess = function(e) {
        var db = e.target.result;
        if (!db.objectStoreNames.contains('drafts')) { db.close(); return; }
        var tx = db.transaction('drafts', 'readwrite');
        var store = tx.objectStore('drafts');
        store.delete(_DRAFT_KEY);
        tx.oncomplete = function() { db.close(); };
      };
    }

    function _discardDocument() {
      _deleteContentDraft();
      _inspFilterType = 'all';
      _inspFilterChapter = 'all';
      $('#editor').summernote('code', '');
      _bookName    = '';
      _chapterName = '';
      _chapterId   = '';
      _bookId      = '';
      _mode        = 'standalone';
      _collection  = [];
      _saveCollectionToDB();
      _updateCounter();
      document.getElementById('appHeaderTitle').textContent = 'Noesis Editor';
      snToast('Draft discarded');
    }

    // Ricalcola altezza editor al resize / cambio orientamento
    function _resizeEditor() {
      var h = _calcEditorHeight();
      $('.note-editable').css('height', h + 'px');
    }
    window.addEventListener('resize', _resizeEditor);

    // ── Test hooks (expose internals for Puppeteer tests) ───────
    window.__test = {
      _saveContentDraft: _saveContentDraft,
      _loadContentDraft: _loadContentDraft,
      _deleteContentDraft: _deleteContentDraft,
      _discardDocument: _discardDocument,
      get _collection() { return _collection; },
      get _bookId() { return _bookId; },
      get _bookName() { return _bookName; },
      get _chapterId() { return _chapterId; },
      get _chapterName() { return _chapterName; },
      _saveCollectionToDB: (typeof _saveCollectionToDB === 'function') ? _saveCollectionToDB : null,
      _loadCollectionFromDB: (typeof _loadCollectionFromDB === 'function') ? _loadCollectionFromDB : null,
    };
    // Aspetta che Summernote abbia renderizzato toolbar e statusbar prima di misurare
    requestAnimationFrame(function() {
      requestAnimationFrame(_resizeEditor);
    });

  }); // fine ready
} // fine initEditor

/* ════════════════════════════════════════════════
   UTILITY DOWNLOAD (documento)
════════════════════════════════════════════════ */
function download(filename, data, type) {
  type = type || 'text/plain;charset=utf-8';
  var blob = data instanceof Blob ? data : new Blob([data], { type: type });
  var url = URL.createObjectURL(blob);
  var a = document.createElement('a');
  a.href = url; a.download = filename; a.click();
  URL.revokeObjectURL(url);
}

function getContent() {
  return $('#editor').summernote('code');
}

/* ════════════════════════════════════════════════
   EXPORT DOCUMENTO
════════════════════════════════════════════════ */

function exportTXT() {
  var filename = _promptCustom('text', '.txt');
  if (!filename) return;
  var temp = document.createElement('div');
  temp.innerHTML = getContent();
  var ps = temp.querySelectorAll('p, h1, h2, h3, h4, h5, h6, li');
  var text = '';
  ps.forEach(function(p, i) { if (i > 0) text += '\n'; text += p.innerText; });
  if (!text) text = temp.innerText;
  download(filename, text);
}

function exportMD() {
  var filename = _promptCustom('markdown', '.md');
  if (!filename) return;
  download(filename, new TurndownService().turndown(getContent()));
}

function exportMDZip() {
  var filename = _promptCustom('mdzip', '.zip');
  if (!filename) return;
  var mdName = filename.replace('.zip', '.md');
  var zip = new JSZip();
  var imgs = zip.folder('images');
  var markdown = new TurndownService().turndown(getContent());
  var idx = 1;
  markdown = markdown.replace(/!\[([^\]]*)\]\(data:image\/([^;]+);base64,([^)]+)\)/g,
    function(m, alt, ext, b64) {
      var name = 'img_' + String(idx++).padStart(3,'0') + '.' + ext;
      imgs.file(name, b64, { base64: true });
      return '![' + alt + '](images/' + name + ')';
    });
  zip.file(mdName, markdown);
  zip.generateAsync({ type:'blob' }).then(function(blob) { download(filename, blob); });
}

function exportDocJSON() {
  var filename = _promptCustom('jsondoc', '.json');
  if (!filename) return;
  download(filename, JSON.stringify({ html: getContent() }, null, 2));
}

function exportPDF() {
  var pc = document.getElementById('print-container');
  pc.innerHTML = getContent();
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

function exportDOCX() {
  var filename = _promptCustom('docx', '.docx');
  if (!filename) return;
  download(filename, window.htmlDocx.asBlob(getContent()));
}

/* ════════════════════════════════════════════════
   DROPDOWN MANAGEMENT
════════════════════════════════════════════════ */
function _closeAllDropdowns() {
  document.querySelectorAll('.tb-dropdown-menu').forEach(function(m) {
    m.classList.remove('open');
    m.style.display = '';
    m.style.transform = ''; /* reset transform residuo da drawer */
  });
}

function _toggleDropdown(menuId, triggerEl) {
  var menu = document.getElementById(menuId);
  var isOpen = menu.classList.contains('open');
  _closeAllDropdowns();
  if (!isOpen) {
    menu.classList.add('open');
    // Posiziona il menu sopra il bottone usando fixed + getBoundingClientRect
    var rect = triggerEl.getBoundingClientRect();
    // Mostra temporaneamente per misurare l'altezza
    menu.style.visibility = 'hidden';
    menu.style.left = '0px';
    menu.style.top = '0px';
    var menuH = menu.offsetHeight;
    var menuW = menu.offsetWidth;
    // Calcola posizione centrata sopra il bottone
    var left = rect.left + rect.width / 2 - menuW / 2;
    var top  = rect.top - menuH - 8;
    // Clamp ai bordi del viewport
    left = Math.max(6, Math.min(left, window.innerWidth - menuW - 6));
    top  = Math.max(6, top);
    menu.style.left = left + 'px';
    menu.style.top  = top  + 'px';
    menu.style.visibility = 'visible';
  }
}

// Close dropdowns on outside tap/click
document.addEventListener('click', function(e) {
  if (!e.target.closest('.tb-dropdown-wrap')) _closeAllDropdowns();
});

// Chapter import button
document.getElementById('chImportBtn').addEventListener('click', function(e) {
  e.stopPropagation();
  _toggleDropdown('chImportMenu', this);
});
// Chapter more button
document.getElementById('chMoreBtn').addEventListener('click', function(e) {
  e.stopPropagation();
  _toggleDropdown('chMoreMenu', this);
});
// Collection more button
document.getElementById('colMoreBtn').addEventListener('click', function(e) {
  e.stopPropagation();
  _toggleDropdown('colMoreMenu', this);
});

/* ════════════════════════════════════════════════
   CHAPTER IMPORT (standalone fallback)
   Legge meta tag noesis-* se presenti, altrimenti chiede via prompt.
   Import clean e annotated usano stessa logica — la distinzione è solo
   visiva: clean rimuove background-color, annotated li preserva.
════════════════════════════════════════════════ */
function _loadChapterFile(file, isAnnotated) {
  var fr = new FileReader();
  fr.onload = function(e) {
    var raw = e.target.result;

    // Leggi meta tag noesis-* se presenti
    var metaBookMatch    = raw.match(/<meta[^>]+name="noesis-book-name"[^>]+content="([^"]*)"[^>]*>/i);
    var metaChapMatch    = raw.match(/<meta[^>]+name="noesis-chapter-name"[^>]+content="([^"]*)"[^>]*>/i);
    var metaIdMatch      = raw.match(/<meta[^>]+name="noesis-chapter-id"[^>]+content="([^"]*)"[^>]*>/i);
    var metaBook    = metaBookMatch  ? metaBookMatch[1]  : '';
    var metaChap    = metaChapMatch  ? metaChapMatch[1]  : '';
    var metaId      = metaIdMatch    ? metaIdMatch[1]    : '';

    // Suggerimento da nome file se meta tag assente
    var suggested = file.name
      .replace(/_clean\.html?$/i,'').replace(/_annotated\.html?$/i,'')
      .replace(/\.html?$/i,'')
      .replace(/__.*$/,'').replace(/_/g,' ');

    var book    = metaBook || prompt('Book name:', suggested) || suggested;
    var chapter = metaChap || prompt('Chapter name:', '') || '';
    _bookName    = book.trim();
    _chapterName = chapter.trim();
    if (metaId) _chapterId = metaId;

    // Estrai solo il body (rimuovi style e meta viewport)
    var html = raw;
    html = html.replace(/<style[^>]*>[\s\S]*?<\/style>/gi, '');
    html = html.replace(/<meta[^>]*(viewport)[^>]*>/gi, '');
    // Estrai contenuto body se presente, altrimenti usa tutto
    var bodyMatch = html.match(/<body[^>]*>([\s\S]*?)<\/body>/i);
    html = bodyMatch ? bodyMatch[1] : html;

    // Se import clean: rimuovi background-color residui
    if (!isAnnotated) {
      html = html.replace(/background-color\s*:[^;'"]+[;'"]/gi, function(m) {
        return m.replace(/background-color\s*:[^;'"]+/, 'background-color:transparent');
      });
    }

    $('#editor').summernote('code', html);
    // Aggiorna header
    var headerEl = document.getElementById('appHeaderTitle');
    if (headerEl) headerEl.textContent = _chapterName || _bookName || 'Noesis Editor';
    snToast((isAnnotated ? 'Annotated' : 'Clean') + ' HTML loaded: ' + (_bookName || file.name));
  };
  fr.onerror = function() { snToast('Error reading file'); };
  fr.readAsText(file);
}

/* ════════════════════════════════════════════════
   IMPORT DIALOG
════════════════════════════════════════════════ */

function _fmtSnapDate(isoStr) {
  var d = new Date(isoStr);
  var dd = String(d.getDate()).padStart(2,'0');
  var mm = String(d.getMonth()+1).padStart(2,'0');
  var yy = String(d.getFullYear()).slice(-2);
  var HH = String(d.getHours()).padStart(2,'0');
  var MM = String(d.getMinutes()).padStart(2,'0');
  return dd+'/'+mm+'/'+yy+'  '+HH+':'+MM;
}

function _groupSnapshots(snaps) {
  var annot = [], clean = [];
  snaps.forEach(function(s) {
    var desc = s.description || '';
    if (/^clean/i.test(desc)) { clean.push(s); }
    else { annot.push(s); } // Annotated, First Snapshot, other
  });
  function byDate(a,b) { return a.createdAt > b.createdAt ? -1 : 1; }
  return { annot: annot.sort(byDate), clean: clean.sort(byDate) };
}

function _loadFromSnapshot(snap) {
  $('#editor').summernote('code', snap.content || '');
  if (snap.bookName)    _bookName    = snap.bookName;
  if (snap.chapterName) _chapterName = snap.chapterName;
  var h = document.getElementById('appHeaderTitle');
  if (h) h.textContent = _chapterName || _bookName || 'Noesis Editor';
  snToast('Loaded: ' + (snap.description || 'snapshot'));
}

function _renderImportGroup(label, snaps, allSnaps) {
  if (!snaps.length) return '';
  var h = '<div class="ch-import-group-label">' + label + '</div>';
  h += '<div style="display:flex;flex-direction:column;gap:2px;margin-bottom:14px;">';
  snaps.forEach(function(snap, i) {
    var isLatest = (i === 0);
    var desc = snap.description || '(no description)';
    var star = snap.isOrigin ? '<span class="ch-import-origin-star">★</span>' : '';
    h += '<div class="ch-import-row' + (isLatest ? ' latest' : '') + '" data-snap-id="' + snap.snapshotId + '">' +
      '<span class="ch-import-dot"></span>' +
      '<span class="ch-import-ts">' + _fmtSnapDate(snap.createdAt) + '</span>' +
      '<span class="ch-import-desc" title="' + desc + '">' + desc + star + '</span>' +
      '</div>';
  });
  h += '</div>';
  return h;
}

function _openImportDialog() {
  _closeAllDropdowns();
  var overlay = document.getElementById('chImportOverlay');
  var body    = document.getElementById('chImportBody');
  overlay.classList.add('open');

  if (!_chapterId) {
    body.innerHTML = '<p style="color:#9ca3af;text-align:center;padding:24px 10px;font-size:13px;">No chapter loaded — use the button below to import any HTML file.</p>';
    return;
  }

  body.innerHTML = '<p style="color:#9ca3af;text-align:center;padding:24px 10px;font-size:13px;">Loading snapshots…</p>';

  _idbPost('get', { chapterId: _chapterId }).then(function(record) {
    if (!record || !(record.snapshots || []).length) {
      body.innerHTML = '<p style="color:#9ca3af;text-align:center;padding:24px 10px;font-size:13px;">No snapshots saved yet for this chapter.</p>';
      return;
    }
    var groups = _groupSnapshots(record.snapshots);
    var html = '';
    var ctx = [record.bookName, record.chapterName].filter(Boolean).join(' \u2014 ');
    if (ctx) {
      html += '<div style="font-size:13px;font-weight:600;color:#374151;margin-bottom:8px;">' + ctx + '</div>';
      html += '<div style="border-bottom:1px solid #e5e7eb;margin-bottom:12px;"></div>';
    }
    html += _renderImportGroup('ANNOTATED', groups.annot, record.snapshots);
    html += _renderImportGroup('CLEAN', groups.clean, record.snapshots);
    body.innerHTML = html;

    body.querySelectorAll('.ch-import-row').forEach(function(row) {
      row.addEventListener('click', function() {
        var sid = this.getAttribute('data-snap-id');
        var snap = record.snapshots.find(function(s) { return s.snapshotId === sid; });
        if (snap) {
          _loadFromSnapshot(snap);
          document.getElementById('chImportOverlay').classList.remove('open');
        }
      });
    });
  }).catch(function(e) {
    body.innerHTML = '<p style="color:#ef4444;text-align:center;padding:24px 10px;font-size:13px;">Could not load snapshots from Library.</p>';
    console.warn('Import dialog error:', e);
  });
}

document.getElementById('chImportBtn').addEventListener('click', _openImportDialog);

document.getElementById('chImportClose').addEventListener('click', function() {
  document.getElementById('chImportOverlay').classList.remove('open');
});
document.getElementById('chImportOverlay').addEventListener('click', function(e) {
  if (e.target === this) this.classList.remove('open');
});

document.getElementById('chImportFileBtn').addEventListener('click', function() {
  document.getElementById('chImportFileInput').value = '';
  document.getElementById('chImportFileInput').click();
});
document.getElementById('chImportFileInput').addEventListener('change', function() {
  var file = this.files && this.files[0];
  if (!file) return;
  document.getElementById('chImportOverlay').classList.remove('open');
  // Rileva variante dal meta tag; default: preserva tutto (isAnnotated=true)
  var fr = new FileReader();
  fr.onload = function(e) {
    var raw = e.target.result;
    var variantMatch = raw.match(/<meta[^>]+name="noesis-snapshot-variant"[^>]+content="([^"]*)"[^>]*>/i);
    var isAnnotated = variantMatch ? (variantMatch[1] !== 'clean') : true;
    _loadChapterFile(file, isAnnotated);
  };
  fr.readAsText(file);
});

/* ════════════════════════════════════════════════
   IDB BRIDGE — delega operazioni IDB al parent/opener
   (contesto blob: blocca IndexedDB diretto)
════════════════════════════════════════════════ */
var _idbCallbacks = {};
var _idbCallbackId = 0;

function _idbPost(op, payload) {
  return new Promise(function(resolve, reject) {
    var target = window.opener || window.parent;
    if (!target || target === window) { reject(new Error('No opener/parent')); return; }
    var id = ++_idbCallbackId;
    _idbCallbacks[id] = { resolve: resolve, reject: reject };
    target.postMessage({ __noesisIDB: true, id: id, op: op, payload: payload }, '*');
    setTimeout(function() {
      if (_idbCallbacks[id]) { delete _idbCallbacks[id]; reject(new Error('IDB timeout')); }
    }, 8000);
  });
}

window.addEventListener('message', function(e) {
  var d = e.data;
  if (!d || !d.__noesisIDBResponse) return;
  var cb = _idbCallbacks[d.id];
  if (!cb) return;
  delete _idbCallbacks[d.id];
  if (d.error) cb.reject(new Error(d.error));
  else cb.resolve(d.result);
});

/* ════════════════════════════════════════════════
   CHAPTER EXPORT: noesis-clean- + noesis-annot- simultanei
   — naming: noesis-{tipo}-book__chapter__TS_{custom}.html
   — un solo prompt per il campo custom opzionale
   — meta tag noesis-* per import nella libreria
   — clean: rimuove tutti i background-color inline
   — annot: contenuto esattamente com'è
   — salva anche due snapshot in IDB (se aperto da noesis)
════════════════════════════════════════════════ */
document.getElementById('chExportMainBtn').addEventListener('click', function() {
  var docContent = getContent();

  // Un solo prompt — parte automatica visibile come label
  var autoBase = _buildFileBase('clean');
  var label = prompt(autoBase + '  \u2192  aggiungi etichetta (invio per saltare):');
  if (label === null) return; // utente ha annullato

  var fnClean = _buildFileBase('clean', label) + '.html';
  var fnAnnot = _buildFileBase('annot', label) + '.html';

  // Meta tag noesis-* (critico per import nella libreria)
  var metaTags =
    '<meta name="noesis-chapter-id"       content="' + (_chapterId   || '') + '">\n' +
    '<meta name="noesis-book-name"        content="' + (_bookName    || '') + '">\n' +
    '<meta name="noesis-chapter-name"     content="' + (_chapterName || '') + '">\n';

  var sharedHead =
    '<!DOCTYPE html>\n<html lang="it"><head>\n' +
    '<meta charset="UTF-8">\n' +
    metaTags +
    '<title>' + (_chapterName || _bookName || 'Chapter') + '</title>\n' +
    '<style>\n' +
    'body{max-width:750px;margin:auto;padding:20px;font-family:system-ui;line-height:1.6;}\n' +
    'img,figure{max-width:100%;height:auto;}\n' +
    'table{width:100%;table-layout:fixed;border-collapse:collapse;}\n' +
    'td,th{border:1px solid #ccc;padding:6px;word-break:break-word;}\n' +
    '</style>\n';

  // clean: rimuove background-color inline
  var cleanContent = docContent.replace(/background-color\s*:[^;'";)]+[;]/gi, '')
                               .replace(/background-color\s*:[^"']+(?=["'])/gi, '');

  var cleanHtml = sharedHead +
    '<meta name="noesis-snapshot-variant" content="clean">\n' +
    '</head><body>\n' + cleanContent + '\n</body></html>';

  var annotHtml = sharedHead +
    '<meta name="noesis-snapshot-variant" content="annot">\n' +
    '</head><body>\n' + docContent + '\n</body></html>';

  download(fnClean, '\uFEFF' + cleanHtml, 'text/html;charset=utf-8');
  download(fnAnnot, '\uFEFF' + annotHtml, 'text/html;charset=utf-8');
  snToast('Snapshot saved: ' + fnClean.split('/').pop());

  // ── Salva anche in IDB (quando aperto da noesis con chapterId) ──
  if (_chapterId) {
    var now = new Date().toISOString();
    var tsStr = now.substring(0,4)+now.substring(5,7)+now.substring(8,10)
              + '-' + now.substring(11,13)+now.substring(14,16)+now.substring(17,19);
    var descSuffix = label ? '-' + label.trim().replace(/[^a-zA-Z0-9_\- ]/g, '_') : '';
    var ts = Date.now();
    var _snapAnnot = {
      snapshotId: 'snap_' + ts + '_' + Math.floor(Math.random() * 1e6),
      createdAt: now,
      bookName: _bookName || '',
      chapterName: _chapterName || '',
      description: 'annot-' + tsStr + descSuffix,
      content: docContent
    };
    var _snapClean = {
      snapshotId: 'snap_' + (ts + 1) + '_' + Math.floor(Math.random() * 1e6),
      createdAt: now,
      bookName: _bookName || '',
      chapterName: _chapterName || '',
      description: 'clean-' + tsStr + descSuffix,
      content: cleanContent
    };
    _idbPost('get', { chapterId: _chapterId }).then(function(record) {
      if (!record) {
        record = {
          chapterId: _chapterId,
          bookName: _bookName || '',
          chapterName: _chapterName || '',
          createdAt: now,
          snapshots: []
        };
      }
      // Annot prima (ts più alto = più recente nella visualizzazione Library)
      record.snapshots.unshift(_snapClean);
      record.snapshots.unshift(_snapAnnot);
      return _idbPost('put', { record: record });
    }).catch(function(e) {
      console.warn('IDB chapter snapshot save failed:', e);
      snToast('\u26a0\ufe0f Saved to disk only \u2014 Library not updated');
    });
  }
});

/* ── legacy exportHTMLBook kept for compatibility ── */
function exportHTMLBook() {
  var filename = prompt('File name:', 'book.html') || 'book.html';
  var content = getContent();
  var html = '<!DOCTYPE html>\n<html><head><meta charset="UTF-8">\n<style>\n' +
    'body{max-width:750px;margin:auto;padding:20px;font-family:system-ui;}\n' +
    'img,figure{max-width:100%;height:auto;}\n' +
    'table{width:100%;table-layout:fixed;border-collapse:collapse;}\n' +
    'td,th{border:1px solid #ccc;padding:6px;word-break:break-word;}\n' +
    '</style></head><body>' + content + '</body></html>';
  download(filename, '\uFEFF' + html, 'text/html;charset=utf-8');
}

/* ════════════════════════════════════════════════
   HELP OVERLAY
════════════════════════════════════════════════ */
(function() {
  var overlay = document.getElementById('editorHelpOverlay');
  var openBtn  = document.getElementById('editorHelpBtn');
  var closeBtn = document.getElementById('editorHelpClose');

  function openHelp()  { overlay.classList.add('visible'); }
  function closeHelp() { overlay.classList.remove('visible'); }

  openBtn.addEventListener('click', openHelp);
  closeBtn.addEventListener('click', closeHelp);
  overlay.addEventListener('click', function(e) {
    if (e.target === overlay) closeHelp();
  });
  document.addEventListener('keydown', function(e) {
    if (e.key === 'Escape' && overlay.classList.contains('visible')) closeHelp();
  });
})();

// ── Hamburger menu handlers (mobile) ──
(function() {
  const hamburgerBtn = document.getElementById('hamburgerBtnEditor');
  const drawer = document.getElementById('hamburgerDrawerEditor');
  const backdrop = document.getElementById('mobileOverlayBackdropEditor');
  const closeBtn = document.getElementById('hamburgerCloseEditor');
  if (!hamburgerBtn || !drawer || !backdrop) return;
  function openDrawer() { drawer.classList.add('open'); backdrop.classList.add('visible'); document.body.style.overflow = 'hidden'; }
  function closeDrawer() { drawer.classList.remove('open'); backdrop.classList.remove('visible'); document.body.style.overflow = ''; }
  hamburgerBtn.addEventListener('click', openDrawer);
  if (closeBtn) closeBtn.addEventListener('click', closeDrawer);
  backdrop.addEventListener('click', closeDrawer);
  document.addEventListener('keydown', function(e) { if (e.key === 'Escape' && drawer.classList.contains('open')) closeDrawer(); });
  // Wire hamburger items to toolbar buttons
  var actionMap = {
    'ch-new': '#chNewBtn', 'ch-import': '#chImportBtn',
    'ch-export': '#chExportMainBtn', 'ch-more': '#chMoreBtn',
    'col-add': '#addChunkBtn', 'col-import': '#colImportBtn',
    'col-export': '#colExportBtn', 'col-inspect': '#colInspectBtn',
    'col-clear': '#colClearBtn', 'col-more': '#colMoreBtn',
    'excalidraw': '#excalidrawBtn'
  };
  drawer.querySelectorAll('.hamburger-item[data-action]').forEach(function(item) {
    item.addEventListener('click', function(e) {
      var action = this.getAttribute('data-action');
      if (action === 'ch-more' || action === 'col-more') {
        e.stopPropagation(); /* Blocca il click-outside handler di document */
        /* Dropdown speciale da drawer: posiziona centrato sullo schermo */
        var menuId = action === 'ch-more' ? 'chMoreMenu' : 'colMoreMenu';
        var menu = document.getElementById(menuId);
        if (!menu) { closeDrawer(); return; }
        _closeAllDropdowns();
        if (menu.classList.contains('open')) {
          menu.classList.remove('open');
          /* Ripristina stili inline così _toggleDropdown desktop funziona */
          menu.style.position = ''; menu.style.left = ''; menu.style.top = '';
          menu.style.transform = ''; menu.style.zIndex = '';
          menu.style.maxHeight = ''; menu.style.overflowY = '';
          menu.style.display = '';
        }
        else {
          /* Sposta il menu nel body per bypassare display:none del padre */
          document.body.appendChild(menu);
          menu.style.position = 'fixed';
          menu.style.left = '50%';
          menu.style.top = '50%';
          menu.style.transform = 'translate(-50%, -50%)';
          menu.style.zIndex = '10000';
          menu.style.maxHeight = '70vh';
          menu.style.overflowY = 'auto';
          menu.classList.add('open');
        }
      } else {
        var sel = actionMap[action];
        if (sel) { var btn = document.querySelector(sel); if (btn) btn.click(); }
      }
      closeDrawer();
    });
  });
})();