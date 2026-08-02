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

