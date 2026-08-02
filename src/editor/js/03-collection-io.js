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

