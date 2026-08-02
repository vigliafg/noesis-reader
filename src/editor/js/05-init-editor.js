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
   CONTENT DRAFT PERSISTENCE + DISCARD
   Top-level (not inside initEditor): _newDocument in 01-document.js and the
   Discard button both call these across file boundaries.
════════════════════════════════════════════════ */
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

/* ════════════════════════════════════════════════
   INIT SUMMERNOTE (caricamento dinamico)
════════════════════════════════════════════════ */
/* jQuery 3.7.1 inline */
/*! jQuery v3.7.1 | (c) OpenJS Foundation and other contributors | jquery.org/license */
//__NOESIS_VENDOR_JQUERY__

/* Summernote Lite 0.9.1 inline */
/*! Summernote v0.9.1 | (c) 2013~ Hackerwins and contributors | MIT license */
//__NOESIS_VENDOR_SUMMERNOTE__
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

