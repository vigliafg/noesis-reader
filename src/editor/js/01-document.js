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
  _saveCollectionToDB();
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

