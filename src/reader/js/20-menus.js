
    /* ── Library: Tools dropdown ── */
    (function() {
      var toolsBtn = document.getElementById('libToolsBtn');
      var toolsMenu = document.getElementById('libToolsMenu');
      if (!toolsBtn || !toolsMenu) return;
      toolsBtn.addEventListener('click', function(e) {
        e.stopPropagation();
        var themesMenu = document.getElementById('libThemesMenu');
        if (themesMenu) { themesMenu.classList.add('hidden'); themesMenu.classList.remove('show'); }
        toolsMenu.classList.toggle('hidden');
      });
      document.addEventListener('click', function(e) {
        var themesMenu = document.getElementById('libThemesMenu');
        var themesBtn = document.getElementById('libThemesBtn');
        if (toolsMenu && !toolsMenu.contains(e.target) && !toolsBtn.contains(e.target)) {
          toolsMenu.classList.add('hidden');
        }
        if (themesMenu && !themesMenu.contains(e.target) && themesBtn && !themesBtn.contains(e.target)) {
          themesMenu.classList.add('hidden');
          themesMenu.classList.remove('show');
        }
      });
    })();


    /* ═══════════════════════════════════════════════════════
    /* ═══════════════════════════════════════════════════════
    /* Global helper: close every Reader popup/menu.
       Called before opening any popup so only one is ever visible. */
    function _closeAllReaderMenus(suppressDisplayPrompt) {
      ['typographyPopupMain','themePopupMain','interfacePopupMain'].forEach(function(id) {
        var p = document.getElementById(id);
        if (!p) return;
        p.classList.remove('show');
        p.style.display    = 'none';
        p.style.visibility = 'hidden';
        p.style.opacity    = '0';
      });
      var em = document.getElementById('extractMenu');
      if (em) { em.classList.remove('show'); em.style.display = ''; }
      /* Navigate dropdown */
      var nm = document.getElementById('rmbNavigateMenu');
      if (nm) nm.classList.remove('show');
      var nb = document.getElementById('rmbNavigate');
      if (nb) nb.classList.remove('rmb-active');
      /* Nav mode popover */
      if (typeof navModePopover !== 'undefined' && navModePopover) {
        navModePopover.classList.remove('open');
      }
      /* Display menu */
      var dm = document.getElementById('displayMenu');
      if (dm) {
        var dmWasOpen = dm.classList.contains('open');
        dm.classList.remove('open');
        dm.style.display = '';
        ['displayBodyTypo','displayBodyThemes','displayBodyInterface'].forEach(function(id) {
          var b = document.getElementById(id); if (b) b.classList.remove('open');
        });
        ['displaySecTypo','displaySecThemes','displaySecInterface'].forEach(function(id) {
          var h = document.getElementById(id); if (h) h.classList.remove('active');
        });
        if (dmWasOpen && !suppressDisplayPrompt) _showDisplaySavePrompt();
      }
    }
    /* ── Inject click handler into epub.js iframe ── */
    function _injectIframeCloseHandler() {
      var viewer = document.getElementById('viewer');
      if (!viewer) return;
      var iframe = viewer.querySelector('iframe');
      if (!iframe) return;
      try {
        var idoc = iframe.contentDocument || (iframe.contentWindow && iframe.contentWindow.document);
        if (!idoc) return;
        /* Remove old handler if present */
        if (iframe._noesisCloseHandler) {
          idoc.removeEventListener('click', iframe._noesisCloseHandler);
        }
        if (iframe._noesisSelHandler) {
          idoc.removeEventListener('selectionchange', iframe._noesisSelHandler);
        }
        iframe._noesisCloseHandler = function() { _closeAllReaderMenus(); /* Hide contextual popup only if no text is selected (otherwise user just finished selecting and popup should stay) */ if (typeof _hideCtxAnnotatePopup === 'function' && !_readerHlHasSelection && !_readerPendingCfi) { _hideCtxAnnotatePopup(); } if (window.innerWidth > 768 && typeof sidebarVisible !== 'undefined' && sidebarVisible) { var tsb = document.getElementById('toggleSidebarBtn'); if (tsb) tsb.click(); } };
        idoc.addEventListener('click', iframe._noesisCloseHandler);
        /* Also listen for selection clearing inside iframe to hide contextual popup */
        iframe._noesisSelHandler = function() {
          var sel = idoc.getSelection ? idoc.getSelection() : null;
          _readerHlHasSelection = !!(sel && !sel.isCollapsed && sel.toString().trim().length > 0);
          if (!_readerHlHasSelection) {
            _readerPendingCfi = null;
            var hb = document.getElementById('readerHighlightBtn');
            if (hb) { hb.style.outline = ''; hb.title = 'Highlight text'; }
            if (typeof _hideCtxAnnotatePopup === 'function') _hideCtxAnnotatePopup();
          }
        };
        idoc.addEventListener('selectionchange', iframe._noesisSelHandler);
      } catch(e) { /* cross-origin guard */ }
    }

    /* ── Unified click-outside: close any open reader menu/dropdown ── */
    document.addEventListener('click', function(e) {
      var target = e.target;
      var dm = document.getElementById('displayMenu');
      var em = document.getElementById('extractMenu');
      var nm = document.getElementById('rmbNavigateMenu');
      var nw = document.getElementById('rmbNavigateWrap');
      var xb = document.getElementById('extractChapterBtn');
      var dw = document.getElementById('displayDropdownWrap');
      var rd = document.getElementById('rmbDisplay');
      var re = document.getElementById('rmbExtract');
      var rw = document.getElementById('rmbExtractWrap');

      var anyOpen = false;
      if (dm && dm.classList.contains('open')) anyOpen = true;
      if (em && em.classList.contains('show')) anyOpen = true;
      if (nm && nm.classList.contains('show')) anyOpen = true;
      if (typeof navModePopover !== 'undefined' && navModePopover && navModePopover.classList.contains('open')) anyOpen = true;
      if (!anyOpen) return;

      var inside = false;
      if ((dm && dm.contains(target)) || target === rd || (dw && dw.contains(target))) inside = true;
      if ((em && em.contains(target)) || (xb && xb.contains(target)) || target === re || (rw && rw.contains(target))) inside = true;
      if ((nm && nm.contains(target)) || (nw && nw.contains(target))) inside = true;
      if (typeof navModePopover !== 'undefined' && navModePopover && navModePopover.contains(target)) inside = true;

      if (!inside) _closeAllReaderMenus();
    });

    /* ═══════════════════════════════════════════════════════
       DISPLAY MENU — accordion, moves popups inline
       ═══════════════════════════════════════════════════════ */
    (function initDisplayMenu() {

      var displayMenu = document.getElementById('displayMenu');
      var rmbDisplay  = document.getElementById('rmbDisplay');
      if (!displayMenu || !rmbDisplay) return;

      var SECTIONS = [
        { headerId: 'displaySecTypo',      bodyId: 'displayBodyTypo',      popupId: 'typographyPopupMain' },
        { headerId: 'displaySecThemes',    bodyId: 'displayBodyThemes',    popupId: 'themePopupMain'      },
        { headerId: 'displaySecInterface', bodyId: 'displayBodyInterface', popupId: 'interfacePopupMain'  },
      ];

      function _embedPopup(sec) {
        if (sec._embedded) return;
        sec._embedded = true;
        var popup = document.getElementById(sec.popupId);
        var body  = document.getElementById(sec.bodyId);
        if (!popup || !body) return;
        popup.removeAttribute('style');
        popup.style.display    = 'block';
        popup.style.position   = 'relative';
        popup.style.top        = 'auto';
        popup.style.left       = 'auto';
        popup.style.right      = 'auto';
        popup.style.transform  = 'none';
        popup.style.boxShadow  = 'none';
        popup.style.border     = 'none';
        popup.style.background = 'transparent';
        popup.style.padding    = '8px 4px 4px 4px';
        popup.style.minWidth   = '0';
        popup.style.width      = '100%';
        popup.style.zIndex     = 'auto';
        popup.style.opacity    = '1';
        popup.style.visibility = 'visible';
        var h3 = popup.querySelector('h3');
        if (h3) h3.style.display = 'none';
        body.appendChild(popup);
      }

      function _toggle(sec, forceOpen) {
        var body   = document.getElementById(sec.bodyId);
        var header = document.getElementById(sec.headerId);
        if (!body || !header) return;
        var opening = (forceOpen !== undefined) ? forceOpen : !body.classList.contains('open');
        if (opening) {
          _embedPopup(sec);
          body.classList.add('open');
          header.classList.add('active');
        } else {
          body.classList.remove('open');
          header.classList.remove('active');
        }
      }

      /* Open / close the whole Display menu */

      /* Section header clicks */
      SECTIONS.forEach(function(sec) {
        var header = document.getElementById(sec.headerId);
        if (!header) return;
        header.addEventListener('click', function(e) {
          e.stopPropagation();
          var body   = document.getElementById(sec.bodyId);
          var isOpen = body && body.classList.contains('open');
          SECTIONS.forEach(function(s) { _toggle(s, false); });
          if (!isOpen) _toggle(sec, true);
        });
      });

    })(); /* end initDisplayMenu */

    /* Patch: close Display menu when Extract or Highlight menus open */


    /* ── Editor Report: help system (iniettato nella finestra popup) ──
       La logica è già inline nel markup HTML dell'editor (vedere openQuillEditor).
       Questo blocco registra i listener dopo che il DOM è pronto. ── */
    (function initEditorHelpListeners() {
      /* Questi listener vengono aggiunti alla finestra editor (window.open).
         Poiché l'editor usa document.write, i listener vanno aggiunti
         dentro lo script inline dell'editor stesso — vedere la sezione
         "editorHelpBtn" nello script dell'editor. */
    })();

    /* ═══════════════════════════════════════════════════════
       READER MENUBAR — event handlers
       ═══════════════════════════════════════════════════════ */
    (function initReaderMenubar() {

      var rmbLibrary  = document.getElementById('rmbLibrary');
      var rmbToc      = document.getElementById('rmbToc');
      var rmbBookmarks= document.getElementById('rmbBookmarks');
      var rmbDisplay  = document.getElementById('rmbDisplay');
      var rmbNavigate = document.getElementById('rmbNavigate');
      var rmbAnnotate = document.getElementById('rmbAnnotate');
      var rmbExtract  = document.getElementById('rmbExtract');
      var rmbHelp       = document.getElementById('rmbHelp');
      var rmbCollection = document.getElementById('rmbCollection');

      var rmbNavigateMenu   = document.getElementById('rmbNavigateMenu');
      var rmbPageModeItem   = document.getElementById('rmbPageModeItem');
      var rmbScrollModeItem = document.getElementById('rmbScrollModeItem');

      // aggiorna evidenziazione voci navigate e sottotitolo bottone
      function _updateNavModeItems() {
        if (rmbPageModeItem)   rmbPageModeItem.classList.toggle('rmb-nav-active', !scrollMode);
        if (rmbScrollModeItem) rmbScrollModeItem.classList.toggle('rmb-nav-active', scrollMode);
        var modeLabel = document.getElementById('rmbNavigateMode');
        if (modeLabel) modeLabel.textContent = scrollMode ? 'Scroll' : 'Page';
        var hmbLabel = document.getElementById('hmbNavigateMode');
        if (hmbLabel) hmbLabel.textContent = scrollMode ? 'Scroll' : 'Page';
      }

      // applica cambio modalità e aggiorna UI
      async function _applyModeChange(newScrollMode) {
        if (scrollMode === newScrollMode) return;
        scrollMode = newScrollMode;
        // sync floating nav buttons and touch zones
        var fprev = document.getElementById('floatingPrevBtn');
        var fnext = document.getElementById('floatingNextBtn');
        var tzPrev = document.getElementById('touchZonePrev');
        var tzNext = document.getElementById('touchZoneNext');
        if (fprev) fprev.classList.toggle('hidden', scrollMode);
        if (fnext) fnext.classList.toggle('hidden', scrollMode);
        if (tzPrev) tzPrev.classList.toggle('hidden', scrollMode);
        if (tzNext) tzNext.classList.toggle('hidden', scrollMode);
        // sync dual page button
        var dpBtn = document.getElementById('dualPageBtn');
        if (dpBtn) {
          dpBtn.disabled = scrollMode;
          if (scrollMode && dualPageMode) {
            dualPageMode = false;
            dpBtn.classList.remove('active');
          }
        }
        _updateNavModeItems();
        if (book && rendition) {
          await recreateRendition();
          setStatus(scrollMode ? 'Scroll mode enabled' : 'Page mode enabled');
        }
      }

      // helper: chiude il Navigate menu
      function _closeNavigate() {
        if (rmbNavigateMenu) rmbNavigateMenu.classList.remove('show');
        if (rmbNavigate) rmbNavigate.classList.remove('rmb-active');
      }

      // ── Library ──
      if (rmbLibrary) {
        rmbLibrary.addEventListener('click', function(e) {
          e.stopPropagation();
          var btn = document.getElementById('backToLibraryBtn');
          if (btn) btn.click();
        });
      }

      // ── TOC ──
      if (rmbToc) {
        rmbToc.addEventListener('click', function(e) {
          e.stopPropagation();
          _closeNavigate();
          var btn = document.getElementById('toggleSidebarBtn');
          if (btn) btn.click();
        });
      }

      // ── Bookmarks ──
      if (rmbBookmarks) {
        rmbBookmarks.addEventListener('click', function(e) {
          e.stopPropagation();
          _closeNavigate();
          var btn = document.getElementById('userBookmarksBtn');
          if (btn) btn.click();
        });
      }

      // ── Display ──
      // rmbDisplay trigger: apre/chiude il menu Display
      if (rmbDisplay) {
        rmbDisplay.addEventListener('click', function(e) {
          e.stopPropagation();
          _closeNavigate();
          var displayMenu = document.getElementById('displayMenu');
          if (!displayMenu) return;
          var wasOpen = displayMenu.classList.contains('open');
          _closeAllReaderMenus(true);
          if (!wasOpen) {
            displayMenu.classList.add('open');
            rmbDisplay.classList.add('rmb-active');
          } else {
            rmbDisplay.classList.remove('rmb-active');
            _showDisplaySavePrompt();
          }
        });
      }

      // ── Navigate ──
      if (rmbNavigate) {
        rmbNavigate.addEventListener('click', function(e) {
          e.stopPropagation();
          _closeAllReaderMenus();
          var isOpen = rmbNavigateMenu && rmbNavigateMenu.classList.contains('show');
          if (!isOpen) {
            _updateNavModeItems();
            if (rmbNavigateMenu) rmbNavigateMenu.classList.add('show');
            rmbNavigate.classList.add('rmb-active');
          } else {
            _closeNavigate();
          }
        });
      }

      if (rmbPageModeItem) {
        rmbPageModeItem.addEventListener('click', async function(e) {
          e.stopPropagation();
          _closeNavigate();
          await _applyModeChange(false);
        });
      }

      if (rmbScrollModeItem) {
        rmbScrollModeItem.addEventListener('click', async function(e) {
          e.stopPropagation();
          _closeNavigate();
          await _applyModeChange(true);
        });
      }

      // ── Annotate ──
      // v816-ctx: il popup contestuale appare su selezione testo.
      // Il click su Annotate applica/rimuove highlight (via readerHighlightBtn).
      if (rmbAnnotate) {
        rmbAnnotate.addEventListener('click', function(e) {
          e.stopPropagation();
          _closeNavigate();
          _closeAllReaderMenus();
          var btn = document.getElementById('readerHighlightBtn');
          if (btn) btn.click();
          /* Update menubar + hamburger indicator dots after highlight action */
          setTimeout(function() {
            var cm = { yellow: '#ffeb3b', green: '#a5d6a7', pink: '#f8bbd9' };
            var bg = currentReaderHighlightColor === 'remove' ? '#fff' : (cm[currentReaderHighlightColor] || '#ffeb3b');
            var dot = document.getElementById('rmbAnnotateColor');
            if (dot) dot.style.background = bg;
            var hmbDot = document.getElementById('hmbAnnotateColor');
            if (hmbDot) hmbDot.style.background = bg;
          }, 50);
        });
      }

      // ── Extract ──
      if (rmbExtract) {
        rmbExtract.addEventListener('click', function(e) {
          e.stopPropagation();
          _closeNavigate();
          _closeAllReaderMenus();
          var btn = document.getElementById('extractChapterBtn');
          if (btn) btn.click();
        });
      }

      // ── Help ──
      if (rmbHelp) {
        rmbHelp.addEventListener('click', function(e) {
          e.stopPropagation();
          _closeNavigate();
          var btn = document.getElementById('readerHelpBtn');
          if (btn) btn.click();
        });
      }

      // ── Collection ──
      if (rmbCollection) {
        rmbCollection.addEventListener('click', function(e) {
          e.stopPropagation();
          _closeNavigate();
          _closeAllReaderMenus();
          _closeCollectionDrawer();
          _renderCollectionList();
          _openCollectionDrawer();
        });
      }


      // Sync rmb-active di Display quando il menu viene chiuso da _closeAllReaderMenus
      // (patch: observer sull'attributo class di displayMenu)
      var displayMenu = document.getElementById('displayMenu');
      if (displayMenu && window.MutationObserver) {
        new MutationObserver(function() {
          if (rmbDisplay) {
            if (displayMenu.classList.contains('open')) {
              rmbDisplay.classList.add('rmb-active');
            } else {
              rmbDisplay.classList.remove('rmb-active');
            }
          }
        }).observe(displayMenu, { attributes: true, attributeFilter: ['class'] });
      }

      // Aggiungere classe al header per il padding corretto
      var hdr = document.querySelector('#reader-view header');
      if (hdr) hdr.classList.add('rmb-active');

    })(); /* end initReaderMenubar */

    // --- READER PRINT SUPPORT ---
    window.addEventListener('beforeprint', function() {
      const iframes = document.querySelectorAll('#viewer iframe');
      if (!iframes.length) return;
      let existingPc = document.getElementById('reader-print-container');
      if (existingPc) existingPc.remove();
      const pc = document.createElement('div');
      pc.id = 'reader-print-container';
      let html = '';
      iframes.forEach(function(iframe) {
        if (!iframe.contentDocument || !iframe.contentDocument.body) return;
        const idoc = iframe.contentDocument;
        // Collect inline styles from epub head
        let styles = '';
        idoc.querySelectorAll('head style').forEach(function(s) {
          // Skip epub.js column-pagination rules that would clip content
          const txt = s.textContent.replace(/column[^;{]*:[^;]+;/g, '').replace(/transform:[^;]+;/g, '');
          styles += '<style>' + txt + '</style>';
        });
        html += styles + idoc.body.innerHTML;
      });
      pc.innerHTML = html;
      document.body.appendChild(pc);
    });

    window.addEventListener('afterprint', function() {
      const pc = document.getElementById('reader-print-container');
      if (pc) pc.remove();
    });

    /* ═══════════════════════════════════════════════════════════
       MOBILE RESPONSIVE HANDLERS — v812-responsive
       ═══════════════════════════════════════════════════════════ */

