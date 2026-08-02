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