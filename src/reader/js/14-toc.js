    function findBreadcrumbInToc(items, targetHref, ancestorPath) {
      const targetBase = targetHref.split('#')[0];
      for (const item of items) {
        const itemPath = ancestorPath ? ancestorPath + ' › ' + item.label : item.label;
        if (item.href) {
          const itemBase = item.href.split('#')[0];
          if (itemBase === targetBase || item.href === targetHref) {
            return itemPath;
          }
        }
        if (item.subitems && item.subitems.length > 0) {
          const found = findBreadcrumbInToc(item.subitems, targetHref, itemPath);
          if (found) return found;
        }
      }
      return null;
    }

    function renderBookmarksSimple(toc) {
      const container = document.getElementById('toc');
      container.innerHTML = '';

      const createList = (items, level, ancestorPath) => {
        const ul = document.createElement('ul');
        ul.setAttribute('translate', 'yes');
        if (level === 1) {
          ul.className = '';
        } else if (level === 2) {
          ul.className = 'sub level-2';
        } else if (level === 3) {
          ul.className = 'sub level-3';
        } else {
          ul.className = 'sub';
        }

        items.forEach(item => {
          const li = document.createElement('li');
          const hasSub = item.subitems && item.subitems.length > 0;

      li.textContent = item.label;
      li.className = hasSub ? 'expandable' : 'leaf';
      li.setAttribute('translate', 'yes');
      if (item.href) li.setAttribute('data-href', item.href);

          // Build full breadcrumb path for this item
          const itemPath = ancestorPath
            ? ancestorPath + ' › ' + item.label
            : item.label;

          li.addEventListener('click', (e) => {
            e.stopPropagation();

            if (hasSub) {
              li.classList.toggle('open');
              const subUl = li.nextElementSibling;
              if (subUl && subUl.tagName === 'UL') {
                subUl.classList.toggle('open');
              }
            }

            if (item.href) {
              navigateToHref(item.href);
              setStatusPath(itemPath);
              _updateTocHighlight(item.href);
            }
          });

          ul.appendChild(li);

          if (hasSub) {
            const subUl = createList(item.subitems, level + 1, itemPath);
            ul.appendChild(subUl);
          }
        });
        return ul;
      };

      container.appendChild(createList(toc, 1, ''));
    }

    // --- TOC current chapter highlight ---
    function _updateTocHighlight(targetHref) {
      if (!targetHref) return;
      // Remove previous highlight
      document.querySelectorAll('#bookmarks li.toc-current').forEach(function(el) {
        el.classList.remove('toc-current');
      });
      // Try exact match first
      var match = document.querySelector('#bookmarks li[data-href="' + CSS.escape(targetHref) + '"]');
      // Fallback: match base path (ignore anchor)
      if (!match) {
        var targetBase = targetHref.split('#')[0];
        var allItems = document.querySelectorAll('#bookmarks li[data-href]');
        for (var i = 0; i < allItems.length; i++) {
          if (allItems[i].getAttribute('data-href').split('#')[0] === targetBase) {
            match = allItems[i];
            break;
          }
        }
      }
      if (match) {
        match.classList.add('toc-current');
        // Expand ancestors so the highlighted item is visible
        var parent = match.parentElement;
        while (parent && parent.id !== 'bookmarks') {
          if (parent.tagName === 'UL' && parent.classList.contains('sub')) {
            parent.classList.add('open');
          }
          if (parent.tagName === 'LI' && parent.classList.contains('expandable')) {
            parent.classList.add('open');
          }
          parent = parent.parentElement;
        }
        // Scroll into view
        match.scrollIntoView({ behavior: 'smooth', block: 'nearest' });
      }
    }

    // --- TOC toolbar button handlers ---
    (function initTocToolbar() {
      var tocToolbar = document.querySelector('#bookmarks .toc-toolbar');
      if (!tocToolbar) return;

      // Close button: adaptive for mobile overlay vs desktop sidebar
      tocToolbar.querySelector('#btnTocClose').addEventListener('click', function() {
        if (window.innerWidth <= 768 && typeof closeTocOverlay === 'function') {
          closeTocOverlay();
        } else {
          var tsb = document.getElementById('toggleSidebarBtn');
          if (tsb) tsb.click();
        }
      });

      // Expand all
      tocToolbar.querySelector('#btnTocExpand').addEventListener('click', function() {
        document.querySelectorAll('#toc li.expandable').forEach(function(li) {
          li.classList.add('open');
          var ul = li.nextElementSibling;
          if (ul && ul.tagName === 'UL') ul.classList.add('open');
        });
      });

      // Collapse all
      tocToolbar.querySelector('#btnTocCollapse').addEventListener('click', function() {
        document.querySelectorAll('#toc li.expandable').forEach(function(li) {
          li.classList.remove('open');
          var ul = li.nextElementSibling;
          if (ul && ul.tagName === 'UL') ul.classList.remove('open');
        });
      });
    })();

    // =====================================================================
