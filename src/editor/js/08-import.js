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

