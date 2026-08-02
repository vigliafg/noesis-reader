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
