    // ── State ────────────────────────────────────────────────────
    let _isMobile = () => window.innerWidth <= 768;
    let _tocOverlayOpen = false;
    let _hamburgerOpen = false;
    let _touchStartX = 0;
    let _touchStartY = 0;
    let _touchStartTime = 0;
    let _touchIsEdge = false;
    let _touchCancelled = false;

    // ── Hamburger menu ───────────────────────────────────────────
    const hamburgerBtn = document.getElementById('hamburgerBtn');
    const hamburgerBtnLib = document.getElementById('hamburgerBtnLib');
    const hamburgerDrawer = document.getElementById('hamburgerDrawer');
    const hamburgerClose = document.getElementById('hamburgerClose');
    const backdrop = document.getElementById('mobileOverlayBackdrop');

    function openHamburger() {
      const isLibrary = !libraryView.classList.contains('hidden');
      document.querySelectorAll('#hamburgerDrawer .hamburger-item').forEach(function(item) {
        if (item.classList.contains('hmb-lib')) {
          item.style.display = isLibrary ? 'flex' : 'none';
        } else if (item.classList.contains('hmb-rdr')) {
          item.style.display = isLibrary ? 'none' : 'flex';
        } else {
          item.style.display = 'flex';
        }
      });
      hamburgerDrawer.classList.add('open');
      backdrop.classList.add('visible');
      _hamburgerOpen = true;
    }
    function closeHamburger() {
      hamburgerDrawer.classList.remove('open');
      backdrop.classList.remove('visible');
      _hamburgerOpen = false;
    }
    if (hamburgerBtn) hamburgerBtn.addEventListener('click', (e) => { e.stopPropagation(); openHamburger(); });
    if (hamburgerBtnLib) hamburgerBtnLib.addEventListener('click', (e) => { e.stopPropagation(); openHamburger(); });
    if (hamburgerClose) hamburgerClose.addEventListener('click', closeHamburger);

    // ── TOC overlay toggle ───────────────────────────────────────
    function openTocOverlay() {
      const bm = document.getElementById('bookmarks');
      if (!bm) return;
      // Remount #bookmarks as a direct child of body to escape any
      // display:none / overflow:hidden / z-index ancestor issues.
      if (bm.parentNode && bm.parentNode !== document.body) {
        bm._tocOrigParent = bm.parentNode;
        bm._tocOrigNext   = bm.nextSibling;
        bm._tocOrigDisplay = bm.style.display;
        document.body.appendChild(bm);
      }
      // Force visibility with inline styles — bypasses CSS cascade entirely
      bm.style.display = 'block';
      bm.style.position = 'fixed';
      bm.style.top = '0';
      bm.style.left = '0';
      bm.style.bottom = '0';
      bm.style.width = '300px';
      bm.style.maxWidth = '85vw';
      bm.style.zIndex = '9999';
      bm.style.transform = 'translateX(0)';
      bm.style.transition = 'transform 0.28s cubic-bezier(0.4,0,0.2,1)';
      bm.style.opacity = '1';
      bm.style.pointerEvents = 'auto';
      bm.style.background = '#fff';
      bm.style.overflowY = 'auto';
      bm.style.boxShadow = '4px 0 20px rgba(0,0,0,0.4)';
      bm.classList.add('toc-overlay-open');
      backdrop.classList.add('visible');
      _tocOverlayOpen = true;
    }
    function closeTocOverlay() {
      const bm = document.getElementById('bookmarks');
      if (!bm) return;
      bm.classList.remove('toc-overlay-open');
      backdrop.classList.remove('visible');
      _tocOverlayOpen = false;
      // Restore #bookmarks to its original DOM position
      if (bm._tocOrigParent && document.contains(bm._tocOrigParent)) {
        if (bm._tocOrigNext && bm._tocOrigNext.parentNode === bm._tocOrigParent) {
          bm._tocOrigParent.insertBefore(bm, bm._tocOrigNext);
        } else {
          bm._tocOrigParent.appendChild(bm);
        }
      }
      // Reset inline styles
      bm.style.display = bm._tocOrigDisplay || '';
      bm.style.position = '';
      bm.style.top = '';
      bm.style.left = '';
      bm.style.bottom = '';
      bm.style.width = '';
      bm.style.maxWidth = '';
      bm.style.zIndex = '';
      bm.style.transform = '';
      bm.style.transition = '';
      bm.style.opacity = '';
      bm.style.pointerEvents = '';
      bm.style.background = '';
      bm.style.overflowY = '';
      bm.style.boxShadow = '';
      delete bm._tocOrigParent;
      delete bm._tocOrigNext;
      delete bm._tocOrigDisplay;
    }

    // ── Backdrop click closes any open drawer ────────────────────
    backdrop.addEventListener('click', () => {
      if (_hamburgerOpen) closeHamburger();
      if (_tocOverlayOpen) closeTocOverlay();
    });

    // ── Hamburger drawer items → trigger corresponding action (context-aware) ──
    const hamburgerReaderMap = {
      hmbToc: 'rmbToc',
      hmbBookmarks: 'rmbBookmarks',
      hmbDisplay: 'rmbDisplay',
      hmbNavigate: 'rmbNavigate',
      hmbAnnotate: 'rmbAnnotate',
      hmbExtract: 'rmbExtract',
      hmbCollection: 'rmbCollection'
    };
    const hamburgerLibHandlers = {
      hmbAddBooks: function() { var b = document.getElementById('libAddBooksBtn'); if (b) b.click(); },
      hmbLibThemeLight: function() {
        localStorage.setItem('noesis-lib-theme', 'light');
        var libView = document.getElementById('library-view');
        if (libView) libView.classList.remove('lib-dark');
        var menu = document.getElementById('libThemesMenu');
        if (menu) { menu.classList.add('hidden'); menu.classList.remove('show'); menu.classList.remove('mobile-pos'); menu.style.top = ''; }
      },
      hmbLibThemeDark: function() {
        localStorage.setItem('noesis-lib-theme', 'dark');
        var libView = document.getElementById('library-view');
        if (libView) libView.classList.add('lib-dark');
        var menu = document.getElementById('libThemesMenu');
        if (menu) { menu.classList.add('hidden'); menu.classList.remove('show'); menu.classList.remove('mobile-pos'); menu.style.top = ''; }
      },
      hmbLibTools: function() {
        var menu = document.getElementById('libToolsMenu');
        if (!menu) return;
        var opening = menu.classList.contains('hidden');
        if (opening) {
          // Close themes menu if open
          var themesMenu = document.getElementById('libThemesMenu');
          if (themesMenu) { themesMenu.classList.add('hidden'); themesMenu.classList.remove('show'); themesMenu.classList.remove('mobile-pos'); themesMenu.style.top = ''; }
          menu.classList.remove('hidden');
          menu.classList.add('mobile-pos');
          // Position below header, to the right of the hamburger
          var headerEl = document.querySelector('.library-header');
          if (headerEl) {
            menu.style.top = (headerEl.getBoundingClientRect().bottom + 8) + 'px';
          }
          var hb = document.getElementById('hamburgerBtnLib');
          if (hb) {
            menu.style.left = (hb.getBoundingClientRect().right + 4) + 'px';
          }
        } else {
          menu.classList.add('hidden');
          menu.classList.remove('mobile-pos');
          menu.style.top = '';
          menu.style.left = '';
        }
      },
      hmbLibRefresh: function() { if (typeof loadLibraryBooks === 'function') loadLibraryBooks(); }
    };
    // Items with dropdown menus need wrapper-visibility workaround on mobile
    const _dropdownItems = new Set(['hmbDisplay', 'hmbNavigate', 'hmbAnnotate', 'hmbExtract']);

    // ── Library-specific hamburger items ──
    Object.entries(hamburgerLibHandlers).forEach(function(entry) {
      const hmbId = entry[0], handler = entry[1];
      const el = document.getElementById(hmbId);
      if (!el) return;
      el.addEventListener('click', function(e) {
        e.stopPropagation();
        closeHamburger();
        handler();
      });
    });

    // ── Shared items (Library, Help): context-aware dispatch ──
    const hmbLibraryEl = document.getElementById('hmbLibrary');
    if (hmbLibraryEl) {
      hmbLibraryEl.addEventListener('click', function(e) {
        e.stopPropagation();
        closeHamburger();
        if (!libraryView.classList.contains('hidden')) {
          // Already in library — refresh
          if (typeof loadLibraryBooks === 'function') loadLibraryBooks();
        } else {
          const rmbLib = document.getElementById('rmbLibrary');
          if (rmbLib) rmbLib.click();
        }
      });
    }
    const hmbHelpEl = document.getElementById('hmbHelp');
    if (hmbHelpEl) {
      hmbHelpEl.addEventListener('click', function(e) {
        e.stopPropagation();
        closeHamburger();
        if (!libraryView.classList.contains('hidden')) {
          const libHelp = document.getElementById('libHelpBtn');
          if (libHelp) libHelp.click();
        } else {
          const rmbHelp = document.getElementById('rmbHelp');
          if (rmbHelp) rmbHelp.click();
        }
      });
    }

    // ── Reader items (mapped to menubar) ──
    Object.entries(hamburgerReaderMap).forEach(([hmbId, rmbId]) => {
      const el = document.getElementById(hmbId);
      if (!el) return;
      el.addEventListener('click', (e) => {
        e.stopPropagation(); // Prevent document-level "close all" handlers from firing
        closeHamburger();
        const target = document.getElementById(rmbId);
        if (!target) return;

        if (_dropdownItems.has(hmbId)) {
          // Parent wrapper has display:none on mobile.
          // Temporarily show it so the dropdown inside can render.
          const wrapper = target.closest('.rmb-item-wrap');
          if (wrapper) {
            wrapper.style.setProperty('display', 'block', 'important');
            target.click();
            // Poll until the dropdown closes, then revert
            const checkClosed = setInterval(() => {
              const dd = wrapper.querySelector('.display-menu.open, .rmb-navigate-menu.show, .reader-highlight-menu.show, .extract-menu.show');
              if (!dd) {
                wrapper.style.removeProperty('display');
                clearInterval(checkClosed);
              }
            }, 150);

          } else {
            target.click();
          }
        } else {
          // Direct-action items (Library, TOC, Bookmarks, Help)
          target.click();
        }
      });
    });

    // ── Override TOC button on mobile to use overlay ─────────────
    const origRmbToc = document.getElementById('rmbToc');
    if (origRmbToc) {
      origRmbToc.addEventListener('click', function(e) {
        if (_isMobile()) {
          e.stopImmediatePropagation();
          if (_tocOverlayOpen) { closeTocOverlay(); }
          else { openTocOverlay(); }
        }
      }, true); // capture phase — stopImmediate prevents original bubble handler
    }

    // ── Swipe navigation (mobile only) ───────────────────────────
    let _swipeInitialized = false;
    function initSwipeNavigation() {
      if (_swipeInitialized) return;
      const viewer = document.getElementById('viewer');
      if (!viewer) return;
      _swipeInitialized = true;

      viewer.addEventListener('touchstart', function(e) {
        if (e.touches.length !== 1) { _touchCancelled = true; return; }
        _touchStartX = e.touches[0].clientX;
        _touchStartY = e.touches[0].clientY;
        _touchStartTime = Date.now();
        _touchIsEdge = (_touchStartX <= 40);
        _touchCancelled = false;
      }, { passive: true });

      viewer.addEventListener('touchmove', function(e) {
        if (_touchCancelled || e.touches.length !== 1) return;
        const dx = e.touches[0].clientX - _touchStartX;
        const dy = e.touches[0].clientY - _touchStartY;
        // Vertical scroll detected → cancel swipe
        if (!_touchCancelled && Math.abs(dy) > Math.abs(dx) && Math.abs(dy) > 10) {
          _touchCancelled = true;
        }
      }, { passive: true });

      viewer.addEventListener('touchend', function(e) {
        if (_touchCancelled) return;
        if (!_isMobile()) return;

        const elapsed = Date.now() - _touchStartTime;
        if (elapsed > 400) return; // too slow, not a swipe

        const dx = (e.changedTouches[0] || {}).clientX - _touchStartX;
        if (!dx || Math.abs(dx) < 50) return; // too short

        // Check if user is selecting text
        const sel = window.getSelection();
        if (sel && sel.toString().length > 0) return;

        // Edge swipe: open TOC drawer
        if (_touchIsEdge && dx > 50) {
          openTocOverlay();
          return;
        }

        // Page navigation (non-edge swipe)
        if (!_touchIsEdge && rendition) {
          if (dx < -50) rendition.next();
          else if (dx > 50) rendition.prev();
        }
      }, { passive: true });
    }

    // ── Library header mobile dropdown ────────────────────────────
    // initLibraryMobileDropdown() REMOVED — hamburger menu now handles all mobile navigation

    // ── Initialize all mobile features ────────────────────────────
    (function _initMobile() {
      // Defer swipe init until rendition is ready (called from openBookFromLibrary)
      if (typeof openBookFromLibrary === 'function') {
        const _origOpenBook = openBookFromLibrary;
        openBookFromLibrary = async function(bookData) {
          await _origOpenBook(bookData);
          initSwipeNavigation();
        };
      }

      // Library mobile dropdown removed — hamburger menu handles mobile navigation

      // Responsive resize handler
      window.addEventListener('resize', () => {
        if (!_isMobile()) {
          if (_hamburgerOpen) closeHamburger();
          if (_tocOverlayOpen) closeTocOverlay();
        }
      });

      // Escape key closes any open drawer or dropdown
      document.addEventListener('keydown', (e) => {
        if (e.key === 'Escape') {
          if (_hamburgerOpen) closeHamburger();
          if (_tocOverlayOpen) closeTocOverlay();
          _closeAllReaderMenus();
        }
      });

      // Close drawers when returning to library
      const origShowLibrary = showLibrary;
      if (typeof origShowLibrary === 'function') {
        showLibrary = function() {
          if (_hamburgerOpen) closeHamburger();
          if (_tocOverlayOpen) closeTocOverlay();
          return origShowLibrary.apply(this, arguments);
        };
      }
    })();

    // ── END MOBILE RESPONSIVE HANDLERS ───────────────────────────

    // ── Shared brand animation trigger ──
    function _triggerBrandAnim() {
      var brand = document.getElementById('libBrand');
      if (!brand) return;
      brand.classList.remove('lib-br-17', 'lib-br-19', 'lib-br-30');
      void brand.offsetWidth;
      var pick = Math.floor(Math.random() * 3);
      brand.classList.add(pick === 0 ? 'lib-br-17' : (pick === 1 ? 'lib-br-19' : 'lib-br-30'));
    }

    // ── Initial brand animation on page load ──
    _triggerBrandAnim();
