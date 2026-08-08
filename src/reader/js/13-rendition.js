    function _registerRenditionHooks() {
      rendition.on('linkClicked', (href) => {
        navigateToHref(href);
      });

      rendition.on('relocated', (location) => {
        if (!location || !location.start || !location.start.href) return;
        setTimeout(function() { _injectIframeCloseHandler(); }, 300);
        if (location.start.cfi) _lastNavigatedCfi = location.start.cfi;
        if (book && book.navigation && book.navigation.toc) {
          const path = findBreadcrumbInToc(book.navigation.toc, location.start.href, '');
          if (path) { setStatusPath(path); _updateTocHighlight(location.start.href); }
        }
      });

      rendition.on('selected', (cfiRange, contents) => {
        _readerHlHasSelection = true;
        _readerPendingCfi = cfiRange;
        const hlBtn = document.getElementById('readerHighlightBtn');
        if (hlBtn) {
          hlBtn.style.outline = '2px solid #3b82f6';
          hlBtn.title = currentReaderHighlightColor === 'remove'
            ? 'Click to remove highlight'
            : (currentReaderHighlightColor ? 'Click to apply highlight' : 'Select text, then pick a color');
        }
        setTimeout(function() { if (typeof _showCtxAnnotatePopup === 'function') _showCtxAnnotatePopup(); }, 60);
      });

      rendition.hooks.content.register((contents) => {
        const style = contents.document.createElement('style');
        
        const buttonsVisible = !scrollMode && !sidebarVisible;
        const buttonPad = buttonsVisible ? 25 : 0;

        style.textContent = `
          img { max-width: 100% !important; height: auto !important; cursor: pointer; }
          body { 
            padding-left: ${40 + buttonPad}px !important; 
            padding-right: ${40 + buttonPad}px !important;
            box-sizing: border-box !important;
          }
          @media (max-width: 768px) {
            body { padding-left: 24px !important; padding-right: 24px !important; }
          }
          @media (max-width: 480px) {
            body { padding-left: 16px !important; padding-right: 16px !important; }
          }
          .epub-table-scroll-wrap {
            display: block;
            width: 100%;
            overflow-x: auto;
            -webkit-overflow-scrolling: touch;
            margin: 1em 0;
            cursor: pointer;
          }
          .epub-table-scroll-wrap table {
            table-layout: auto !important;
            width: auto !important;
            max-width: none !important;
          }
          .epub-hl-yellow { background-color: #ffeb3b !important; fill: #ffeb3b !important; fill-opacity: 0.5 !important; }
          .epub-hl-green  { background-color: #a5d6a7 !important; fill: #a5d6a7 !important; fill-opacity: 0.5 !important; }
          .epub-hl-pink   { background-color: #f8bbd9 !important; fill: #f8bbd9 !important; fill-opacity: 0.5 !important; }
        `;
        contents.document.head.appendChild(style);

        if (readerHighlights.length > 0) {
          setTimeout(() => {
            readerHighlights.forEach(hl => {
              try {
                rendition.annotations.remove(hl.cfi, 'highlight');
                const _hlColor = HL_COLORS[hl.color] || '#ffeb3b';
                rendition.annotations.highlight(hl.cfi, {}, () => {}, 'epub-hl-' + hl.color,
                  { fill: _hlColor, 'fill-opacity': '0.5' });
              } catch(e) { }
            });
            // Clean up any spurious selection state triggered by highlight restoration
            _readerHlHasSelection = false;
            _readerPendingCfi = null;
            if (typeof _hideCtxAnnotatePopup === 'function') _hideCtxAnnotatePopup();
          }, 120);
        }

        const iframeDoc = contents.document;
        
        iframeDoc.querySelectorAll('table').forEach(function(table) {
          if (table.parentElement && table.parentElement.classList.contains('epub-table-scroll-wrap')) return;
          const wrap = iframeDoc.createElement('div');
          wrap.className = 'epub-table-scroll-wrap';
          table.parentNode.insertBefore(wrap, table);
          wrap.appendChild(table);
        });

        function sendMediaTap(type, data) {
          try {
            window.parent.postMessage({ epubMediaTap: true, type: type, data: data }, '*');
          } catch(e) {}
        }

        iframeDoc.querySelectorAll('img').forEach(function(img) {
          img.addEventListener('contextmenu', function(e) { e.preventDefault(); });
          img.style.webkitTouchCallout = 'none';
          img.style.userSelect = 'none';
          var touchMoved = false;
          img.addEventListener('touchstart', function(e) { touchMoved = false; e.preventDefault(); }, { passive: false });
          img.addEventListener('touchmove', function() { touchMoved = true; }, { passive: true });
          img.addEventListener('touchend', function(e) {
            if (!touchMoved) { e.preventDefault(); sendMediaTap('img', { src: img.src, alt: img.alt || '' }); }
          }, { passive: false });
          img.addEventListener('click', function() { sendMediaTap('img', { src: img.src, alt: img.alt || '' }); });
        });

        iframeDoc.querySelectorAll('.epub-table-scroll-wrap').forEach(function(wrap) {
          var table = wrap.querySelector('table');
          if (!table) return;
          var touchMoved = false;
          wrap.addEventListener('touchstart', function() { touchMoved = false; }, { passive: true });
          wrap.addEventListener('touchmove', function() { touchMoved = true; }, { passive: true });
          wrap.addEventListener('touchend', function(e) {
            if (!touchMoved) { e.preventDefault(); sendMediaTap('table', { html: table.outerHTML }); }
          }, { passive: false });
          wrap.addEventListener('click', function() { sendMediaTap('table', { html: table.outerHTML }); });
        });

        setTimeout(applyTheme, 50);
      });
    }

    async function recreateRendition() {
      if (!book) return;

      // Capture location before destroying rendition
      let savedCfi = null;
      let savedHref = null;
      if (rendition) {
        try {
          const loc = rendition.currentLocation();
          if (loc && loc.start) {
            savedCfi = loc.start.cfi;
            savedHref = loc.start.href;
          }
        } catch (e) {
          console.warn('Could not get current location:', e);
        }
        rendition.destroy();
      }

      const viewer = document.getElementById('viewer');
      viewer.innerHTML = '';

      rendition = book.renderTo('viewer', {
        width: '100%',
        height: '100%',
        spread: (dualPageMode && !scrollMode) ? 'auto' : 'none',
        flow: scrollMode ? 'scrolled' : 'paginated',
        manager: 'default'  // Always use 'default' to prevent scroll offset issues
      });

      _registerRenditionHooks();

      // Try to restore position - use CFI first, fallback to href
      let displaySuccess = false;
      if (savedCfi) {
        try {
          await rendition.display(savedCfi);
          displaySuccess = true;
        } catch (e) {
          console.warn('CFI display failed, trying href fallback:', e);
        }
      }

      if (!displaySuccess && savedHref) {
        try {
          await rendition.display(savedHref);
          displaySuccess = true;
        } catch (e) {
          console.warn('Href display failed:', e);
        }
      }

      if (!displaySuccess && currentLocation && currentLocation.start) {
        try {
          await rendition.display(currentLocation.start.cfi);
          displaySuccess = true;
        } catch (e) {
          console.warn('Fallback currentLocation display failed:', e);
        }
      }

      if (!displaySuccess) {
        await rendition.display();
      }

      applyTheme();
    }

    // Find full breadcrumb path in TOC tree for a given href
