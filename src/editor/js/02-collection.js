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

