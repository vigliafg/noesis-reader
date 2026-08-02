    // --- COLLECTION DRAWER MODULE ---
    // =====================================================================
    function _openCollectionDrawer() {
      const header = document.querySelector('header');
      const drawer = document.getElementById('collectionDrawer');
      if (!drawer) return;
      const headerH = header ? header.getBoundingClientRect().height : 0;
      drawer.style.setProperty('--coll-header-height', headerH + 'px');
      drawer.classList.add('coll-open');
      // Reset filters and selection
      _collFilterType = 'all';
      _collFilterChapter = 'all';
      _checkedChunkIds = {};
      _populateChapterFilter();
      var activeBtn = document.querySelector('.coll-ft-btn.active');
      if (activeBtn) activeBtn.classList.remove('active');
      var allBtn = document.querySelector('.coll-ft-btn[data-type="all"]');
      if (allBtn) allBtn.classList.add('active');
      var chapterSel = document.getElementById('collChapterFilter');
      if (chapterSel) chapterSel.value = 'all';
    }

    function _closeCollectionDrawer() {
      const drawer = document.getElementById('collectionDrawer');
      if (drawer) drawer.classList.remove('coll-open');
    }

    function _populateChapterFilter() {
      var sel = document.getElementById('collChapterFilter');
      if (!sel) return;
      var currentVal = sel.value;
      var chapters = [];
      _collection.forEach(function(c) {
        var ch = c.chapter || 'Unknown';
        if (chapters.indexOf(ch) === -1) chapters.push(ch);
      });
      chapters.sort();
      sel.innerHTML = '<option value="all">All chapters</option>';
      chapters.forEach(function(ch) {
        sel.innerHTML += '<option value="' + ch.replace(/"/g, '&quot;') + '">' + ch.substring(0, 40) + '</option>';
      });
      if (currentVal && chapters.indexOf(currentVal) !== -1) {
        sel.value = currentVal;
      } else {
        sel.value = 'all';
      }
    }

    function _renderCollectionList() {
      var list = document.getElementById('collList');
      if (!list) return;

      if (_collection.length === 0) {
        _populateChapterFilter();
        list.innerHTML = '<div class="coll-empty"><i class="bi bi-collection"></i>No items yet.<br><small>Preview an image, table, or highlight and tap [+] Collect.</small></div>';
        _updateCollSelBadge();
        return;
      }

      _populateChapterFilter();

      // Apply filters
      var filtered = _collection.slice().reverse().filter(function(c) {
        if (_collFilterType !== 'all' && c.type !== _collFilterType) return false;
        if (_collFilterChapter !== 'all' && c.chapter !== _collFilterChapter) return false;
        return true;
      });

      if (filtered.length === 0) {
        var msg = _collection.length === 0
          ? '<i class="bi bi-collection"></i>No items yet.<br><small>Preview an image, table, or highlight and tap [+] Collect.</small>'
          : '<i class="bi bi-funnel"></i>No items match filters.<br><small>Try changing the type or chapter filter.</small>';
        list.innerHTML = '<div class="coll-empty">' + msg + '</div>';
        _updateCollSelBadge();
        return;
      }

      // Restore checkbox state from persistent _checkedChunkIds
      list.innerHTML = '';
      filtered.forEach(function(c) {
        var item = document.createElement('div');
        item.className = 'coll-item';
        item.dataset.chunkId = c.id;

        // Checkbox
        var cbWrap = document.createElement('div');
        cbWrap.className = 'coll-checkbox';
        cbWrap.addEventListener('click', function(e) { e.stopPropagation(); });
        var cb = document.createElement('input');
        cb.type = 'checkbox';
        cb.checked = !!_checkedChunkIds[c.id];
        cb.addEventListener('change', function() {
          if (this.checked) _checkedChunkIds[c.id] = true;
          else delete _checkedChunkIds[c.id];
          _updateCollSelBadge();
        });
        cbWrap.appendChild(cb);
        item.appendChild(cbWrap);

        var body = document.createElement('div');
        body.className = 'coll-item-body';

        // Header: icon + chapter + type badge
        var headerDiv = document.createElement('div');
        headerDiv.className = 'coll-header';

        var iconMap = { img: 'bi-image', text: 'bi-chat-quote', table: 'bi-table' };
        var iconClass = iconMap[c.type] || 'bi-file-earmark';
        var icon = document.createElement('i');
        icon.className = 'bi ' + iconClass + ' coll-type-icon';
        headerDiv.appendChild(icon);

        var chapterSpan = document.createElement('span');
        chapterSpan.className = 'coll-chapter';
        chapterSpan.title = c.chapter || '';
        chapterSpan.textContent = (c.chapter || 'Unknown chapter').substring(0, 60);
        headerDiv.appendChild(chapterSpan);

        var typeBadge = document.createElement('span');
        typeBadge.className = 'coll-type-badge';
        typeBadge.textContent = c.type;
        headerDiv.appendChild(typeBadge);

        body.appendChild(headerDiv);

        // Type-specific preview
        if (c.type === 'img') {
          if (c.src) {
            var thumb = document.createElement('img');
            thumb.className = 'coll-thumb';
            thumb.src = c.src;
            thumb.alt = c.alt || '';
            body.appendChild(thumb);
          }
          if (c.alt) {
            var altDiv = document.createElement('div');
            altDiv.className = 'coll-alt';
            altDiv.textContent = c.alt.substring(0, 80);
            body.appendChild(altDiv);
          }
        } else if (c.type === 'text') {
          var excerpt = document.createElement('div');
          excerpt.className = 'coll-text-excerpt';
          excerpt.textContent = (c.content || '').substring(0, 150);
          if (c.color) {
            var hlMap = { yellow: '#ffeb3b', green: '#a5d6a7', pink: '#f8bbd9' };
            excerpt.style.borderLeftColor = hlMap[c.color] || '#ffeb3b';
          }
          body.appendChild(excerpt);
        } else {
          var tablePreview = document.createElement('div');
          tablePreview.className = 'coll-table-preview';
          tablePreview.innerHTML = '<i class="bi bi-table" style="margin-right:4px;color:#10b981;"></i>Table';
          body.appendChild(tablePreview);
          if (c.content) {
            var tempDiv = document.createElement('div');
            tempDiv.innerHTML = c.content;
            var plain = (tempDiv.textContent || '').trim().substring(0, 100);
            if (plain) {
              var tableExcerpt = document.createElement('div');
              tableExcerpt.className = 'coll-text-excerpt';
              tableExcerpt.textContent = plain;
              tableExcerpt.style.borderLeftColor = '#10b981';
              body.appendChild(tableExcerpt);
            }
          }
        }

        // Date
        var dateEl = document.createElement('div');
        dateEl.className = 'coll-date';
        var d = new Date(c.date);
        dateEl.textContent = d.toLocaleDateString() + ' ' + d.toLocaleTimeString([], {hour:'2-digit',minute:'2-digit'});
        body.appendChild(dateEl);

        // Click to open chunk viewer
        body.addEventListener('click', function(e) {
          if (e.target.closest('.coll-delete-btn') || e.target.closest('.coll-checkbox')) return;
          _openChunkViewer(c);
        });

        // Delete button
        var delBtn = document.createElement('button');
        delBtn.className = 'coll-delete-btn';
        delBtn.title = 'Remove from collection';
        delBtn.innerHTML = '<i class="bi bi-x-lg"></i>';
        delBtn.addEventListener('click', function(e) {
          e.stopPropagation();
          _deleteChunkById(c.id);
          _renderCollectionList();
        });

        item.appendChild(body);
        item.appendChild(delBtn);
        list.appendChild(item);
      });
      _updateCollSelBadge();
    }

    // ── Chunk Viewer ──
    function _openChunkViewer(chunk) {
      var viewer = document.getElementById('collViewer');
      var title = document.getElementById('collViewerTitle');
      var content = document.getElementById('collViewerContent');
      if (!viewer || !content) return;

      title.textContent = (chunk.chapter || 'Unknown') + ' · ' + chunk.type;
      content.innerHTML = '';

      if (chunk.type === 'img') {
        if (chunk.src) {
          var img = document.createElement('img');
          img.src = chunk.src;
          img.alt = chunk.alt || '';
          content.appendChild(img);
        } else {
          var placeholder = document.createElement('div');
          placeholder.className = 'cv-placeholder';
          placeholder.innerHTML = '<i class="bi bi-image"></i><p>No image available</p>';
          content.appendChild(placeholder);
        }
      } else if (chunk.type === 'text') {
        var div = document.createElement('div');
        div.className = 'cv-text';
        div.textContent = chunk.content || '';
        var hlMap = { yellow: '#ffeb3b', green: '#a5d6a7', pink: '#f8bbd9' };
        if (chunk.color && hlMap[chunk.color]) {
          div.style.borderLeft = '4px solid ' + hlMap[chunk.color];
        }
        content.appendChild(div);
      } else {
        var wrap = document.createElement('div');
        wrap.className = 'cv-table-wrap';
        wrap.innerHTML = chunk.content || '';
        content.appendChild(wrap);
      }

      viewer.classList.add('visible');
    }

    function _closeChunkViewer() {
      var viewer = document.getElementById('collViewer');
      if (viewer) viewer.classList.remove('visible');
    }

    // =====================================================================
    // --- END USER BOOKMARKS MODULE ---
    // =====================================================================

    // =====================================================================
