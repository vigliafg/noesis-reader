    window.addEventListener('DOMContentLoaded', () => {
      // ── Debug mode: auto-load test.epub (bypass file picker for testing) ──
      if (new URL(location.href).searchParams.get('debug') === '1') {
        (async () => {
          try {
            const resp = await fetch('test.epub');
            if (!resp.ok) throw new Error('test.epub not found (HTTP ' + resp.status + ')');
            const blob = await resp.blob();
            const file = new File([blob], 'test.epub', { type: 'application/epub+zip' });
            showLoading('🔧 Debug: loading test.epub...');
            const bookRecord = await saveBookToDB(file);
            hideLoading();
            await openBookFromLibrary(bookRecord);
          } catch (e) {
            console.error('Debug auto-load failed:', e);
            hideLoading();
          }
        })();
      }

      // ── Test hooks (expose internals for Puppeteer tests) ─────────
      window.__test = {
        get rendition() { return rendition; },
        get book() { return book; },
        get _collection() { return _collection; },
        _saveCollectionToDB: _saveCollectionToDB,
        _loadCollectionFromDB: _loadCollectionFromDB,
        _openCollectionDrawer: _openCollectionDrawer,
        _closeCollectionDrawer: _closeCollectionDrawer,
        _renderCollectionList: _renderCollectionList,
        _clearCollection: _clearCollection,
        _saveChunk: _saveChunk,
        _importCollectionFromJSON: _importCollectionFromJSON,
        _exportCollectionJSON: _exportCollectionJSON,
        _updateCollectionBadge: _updateCollectionBadge,
        _openChapterInEditor: _openChapterInEditor,
        _dispatchExtractDownload: _dispatchExtractDownload,
        get currentBookId() { return currentBookId; },
        get currentBookTitle() { return currentBookTitle; },
        get _currentChapterName() { return _currentChapterName; },
        get _checkedChunkIds() { return _checkedChunkIds; },
        get _extractMode() { return _extractMode; },
        set _extractMode(v) { _extractMode = v; },
        get _extractFormat() { return _extractFormat; },
        set _extractFormat(v) { _extractFormat = v; },
        get _shouldOpenEditor() { return _shouldOpenEditor; },
        set _shouldOpenEditor(v) { _shouldOpenEditor = v; },
        extractCurrentChapter: extractCurrentChapter,
        extractMultipleSections: extractMultipleSections,
      };

      // Init elements
      const libraryInput = document.getElementById('libraryInput');
      const floatingPrevBtn = document.getElementById('floatingPrevBtn');
      const floatingNextBtn = document.getElementById('floatingNextBtn');
      const dualPageBtn = document.getElementById('dualPageBtn');
      const scrollModeBtn = document.getElementById('scrollModeBtn');
      const themeBtn = document.getElementById('themeBtn');
      const toggleSidebarBtn = document.getElementById('toggleSidebarBtn');
      const extractChapterBtn = document.getElementById('extractChapterBtn');
      const bookmarks = document.getElementById('bookmarks');
      const backToLibraryBtn = document.getElementById('backToLibraryBtn');
      const typographyBtn = document.getElementById('typographyBtn');
      const typographyPopup = document.getElementById('typographyPopupMain');
      // --- Chapter Navigation (spine prev/next) ---
      const statusPrevBtn = document.getElementById('statusPrevBtn');
      const statusNextBtn = document.getElementById('statusNextBtn');
      if (statusPrevBtn) statusPrevBtn.addEventListener('click', goPrevChapter);
      if (statusNextBtn) statusNextBtn.addEventListener('click', goNextChapter);

      // --- User Bookmarks Drawer buttons ---
      document.getElementById('userBookmarksBtn').addEventListener('click', () => {
        const drawer = document.getElementById('userBookmarksDrawer');
        if (drawer.classList.contains('ubm-open')) {
          closeUbmDrawer();
        } else {
          renderUbmList();
          openUbmDrawer();
        }
      });

      document.getElementById('ubmNewBtn').addEventListener('click', () => {
        createUserBookmark();
      });

      document.getElementById('ubmCloseBtn').addEventListener('click', () => {
        closeUbmDrawer();
      });

      // ── JSON Import/Export ──
      var collImportInput = document.getElementById('collImportInput');
      var collJsonBtn = document.getElementById('collJsonBtn');
      var collJsonMenu = document.getElementById('collJsonMenu');
      collJsonBtn.addEventListener('click', function(e) {
        e.stopPropagation();
        collExportMenu.classList.remove('show');
        collJsonMenu.classList.toggle('show');
      });
      collJsonMenu.querySelectorAll('button').forEach(function(btn) {
        btn.addEventListener('click', function(e) {
          e.stopPropagation();
          collJsonMenu.classList.remove('show');
          var action = btn.dataset.action;
          if (action === 'import') collImportInput.click();
          else if (action === 'export') _exportCollectionJSON();
        });
      });
      document.addEventListener('click', function(e) {
        if (!collJsonMenu.classList.contains('show')) return;
        if (!collJsonMenu.contains(e.target) && e.target !== collJsonBtn) {
          collJsonMenu.classList.remove('show');
        }
      });
      collImportInput.addEventListener('change', function() {
        if (this.files && this.files[0]) {
          _importCollectionFromJSON(this.files[0]);
          this.value = '';
        }
      });

      document.getElementById('collClearBtn').addEventListener('click', () => {
        if (_collection.length === 0) { showToast('Collection already empty', 'saved', 2000); return; }
        if (!confirm('Clear all ' + _collection.length + ' items from collection?')) return;
        _clearCollection();
        _renderCollectionList();
        showToast('Collection cleared', 'saved', 2000);
      });

      document.getElementById('collCloseBtn').addEventListener('click', () => {
        _closeCollectionDrawer();
      });

      // ── Chunk viewer close on background click ──
      document.getElementById('collViewer').addEventListener('click', function(e) {
        if (e.target === this) _closeChunkViewer();
      });

      // ── Filter type buttons ──
      document.querySelectorAll('.coll-ft-btn').forEach(function(btn) {
        btn.addEventListener('click', function() {
          document.querySelectorAll('.coll-ft-btn').forEach(function(b) { b.classList.remove('active'); });
          btn.classList.add('active');
          _collFilterType = btn.dataset.type;
          _renderCollectionList();
        });
      });

      // ── Chapter filter ──
      document.getElementById('collChapterFilter').addEventListener('change', function() {
        _collFilterChapter = this.value;
        _renderCollectionList();
      });

      // ── Select All / Deselect ──
      document.getElementById('collSelectAllBtn').addEventListener('click', function() {
        document.querySelectorAll('#collList .coll-checkbox input[type="checkbox"]').forEach(function(cb) {
          cb.checked = true;
          var item = cb.closest('.coll-item');
          if (item) _checkedChunkIds[item.dataset.chunkId] = true;
        });
        _updateCollSelBadge();
      });
      document.getElementById('collDeselectAllBtn').addEventListener('click', function() {
        document.querySelectorAll('#collList .coll-checkbox input[type="checkbox"]').forEach(function(cb) {
          cb.checked = false;
          var item = cb.closest('.coll-item');
          if (item) delete _checkedChunkIds[item.dataset.chunkId];
        });
        _updateCollSelBadge();
      });

      // ── Chunk viewer close ──
      document.getElementById('collViewerClose').addEventListener('click', function() {
        _closeChunkViewer();
      });
      document.addEventListener('keydown', function(e) {
        if (e.key === 'Escape') _closeChunkViewer();
      });

      // Export dropdown
      var collExportBtn  = document.getElementById('collExportBtn');
      var collExportMenu = document.getElementById('collExportMenu');
      collExportBtn.addEventListener('click', function(e) {
        e.stopPropagation();
        collJsonMenu.classList.remove('show');
        collExportMenu.classList.toggle('show');
      });
      collExportMenu.querySelectorAll('button').forEach(function(btn) {
        btn.addEventListener('click', function(e) {
          e.stopPropagation();
          collExportMenu.classList.remove('show');
          var fmt = btn.dataset.fmt;
          if (fmt === 'html') _exportCollectionHTML();
          else if (fmt === 'md') _exportCollectionMD();
          else if (fmt === 'zip') _exportCollectionZIP();
        });
      });
      document.addEventListener('click', function(e) {
        if (!collExportMenu.classList.contains('show')) return;
        if (!collExportMenu.contains(e.target) && e.target !== collExportBtn) {
          collExportMenu.classList.remove('show');
        }
      });

      // Close collection drawer when clicking outside
      document.addEventListener('click', (e) => {
        const drawer = document.getElementById('collectionDrawer');
        const menuItem = document.getElementById('rmbCollection');
        if (drawer && drawer.classList.contains('coll-open')) {
          if (!drawer.contains(e.target) && e.target !== menuItem && (!menuItem || !menuItem.contains(e.target))) {
            _closeCollectionDrawer();
          }
        }
      });

      // Close drawer when clicking outside
      document.addEventListener('click', (e) => {
        const drawer = document.getElementById('userBookmarksDrawer');
        const btn = document.getElementById('userBookmarksBtn');
        if (drawer && drawer.classList.contains('ubm-open')) {
          if (!drawer.contains(e.target) && e.target !== btn && !btn.contains(e.target)) {
            closeUbmDrawer();
          }
        }
      });

      updateFontInfo();
      updateLineHeightInfo();
      extractChapterBtn.disabled = true;

      // --- Dynamic sidebar top: always flush below the actual header height ---
      function updateBookmarksTop() {
        const header = document.querySelector('header');
        if (!header || !bookmarks) return;
        const h = header.getBoundingClientRect().height;
        bookmarks.style.top = (h + 20) + 'px';
      }

      const headerEl = document.querySelector('header');
      if (headerEl && window.ResizeObserver) {
        const ro = new ResizeObserver(() => {
          // Suppress ResizeObserver loop errors (harmless)
          requestAnimationFrame(updateBookmarksTop);
        });
        ro.observe(headerEl);
      }
      // Also update on orientation change and resize
      window.addEventListener('resize', updateBookmarksTop);
      window.addEventListener('orientationchange', () => {
        setTimeout(updateBookmarksTop, 200);
      });
      // Initial call
      updateBookmarksTop();

      // Start by loading library
      loadLibraryBooks();

      // ── Library theme toggle (with dropdown) ────────────────────────────
      (function() {
        const libView = document.getElementById('library-view');
        const themesBtn = document.getElementById('libThemesBtn');
        const themesMenu = document.getElementById('libThemesMenu');
        const themeLight = document.getElementById('libThemeLight');
        const themeDark = document.getElementById('libThemeDark');
        var dark = localStorage.getItem('noesis-lib-theme') === 'dark';
        function applyLibraryTheme() {
          if (dark) {
            libView.classList.add('lib-dark');
          } else {
            libView.classList.remove('lib-dark');
          }
        }
        applyLibraryTheme();
        // Toggle dropdown (close tools if open)
        if (themesBtn) {
          themesBtn.addEventListener('click', function(e) {
            e.stopPropagation();
            var toolsMenu = document.getElementById('libToolsMenu');
            if (toolsMenu) toolsMenu.classList.add('hidden');
            themesMenu.classList.toggle('hidden');
            themesMenu.classList.toggle('show');
          });
        }
        // Light theme option
        if (themeLight) {
          themeLight.addEventListener('click', function() {
            dark = false;
            localStorage.setItem('noesis-lib-theme', 'light');
            applyLibraryTheme();
            themesMenu.classList.add('hidden');
            themesMenu.classList.remove('show');
          });
        }
        // Dark theme option
        if (themeDark) {
          themeDark.addEventListener('click', function() {
            dark = true;
            localStorage.setItem('noesis-lib-theme', 'dark');
            applyLibraryTheme();
            themesMenu.classList.add('hidden');
            themesMenu.classList.remove('show');
          });
        }
      })();
      // ── END Library theme toggle ──────────────────────────────────────

      // --- EVENT LISTENERS ---

      // Add Book
      libraryInput.addEventListener('change', async (e) => {
  const file = e.target.files[0];
  if (!file) return;

  /* Pre-validate file type before reading (fast check, no I/O) */
  const fileCheck = validateEpubFile(file);
  if (!fileCheck.valid) {
    alert(fileCheck.error);
    libraryInput.value = '';
    return;
  }

  showLoading('Adding book to library...');
  try {
    const canSave = await checkQuotaBeforeSave(file);
    if (!canSave) { hideLoading(); return; }
    await saveBookToDB(file);
    await loadLibraryBooks();
    updateStorageBar();
  } catch (err) {
    console.error(err);
    if (err.name === 'QuotaExceededError') {
      alert('Storage space full.\n\nDelete some books from the library to free up space.');
    } else if (err.message && err.message.includes('DRM')) {
      alert(err.message);
    } else if (err.message && err.message.includes('Malformed EPUB')) {
      alert(err.message);
    } else if (err.message && err.message.includes('not a valid ZIP')) {
      alert(err.message);
    } else if (err.message && err.message.includes('is not an EPUB')) {
      alert(err.message);
    } else if (err.message && err.message.includes('Cannot read')) {
      alert(err.message);
    } else {
      alert('Cannot open this EPUB. The file may be damaged or in an unsupported format.\n\nDetail: ' + err.message);
    }
  } finally {
    hideLoading();
    libraryInput.value = ''; // Reset input
  }
});

      // Add Books button (triggers libraryInput)
      const libAddBooksBtn = document.getElementById('libAddBooksBtn');
      if (libAddBooksBtn) {
        libAddBooksBtn.addEventListener('click', function() {
          document.getElementById('libraryInput').click();
        });
      }

      // Back Button
      backToLibraryBtn.addEventListener('click', () => {
        showLibrary();
      });

      // Typography Popup Toggle
      typographyBtn.onclick = (e) => {
        e.stopPropagation();
        const isShowing = typographyPopup.classList.contains('show');

        // Close theme popup if open
        const themePopupEl = document.getElementById('themePopupMain');
        if (themePopupEl) {
          themePopupEl.classList.remove('show');
          themePopupEl.style.display = 'none';
          themePopupEl.style.visibility = 'hidden';
          themePopupEl.style.opacity = '0';
        }

        if (isShowing) {
          // Hide popup
          typographyPopup.classList.remove('show');
          typographyPopup.style.display = 'none';
          typographyPopup.style.visibility = 'hidden';
          typographyPopup.style.opacity = '0';
        } else {
          // Show popup
          typographyPopup.style.display = 'block';
          typographyPopup.style.visibility = 'visible';
          typographyPopup.style.opacity = '1';
          typographyPopup.classList.add('show');
        }
      };

      // Close popup when clicking outside
      document.addEventListener('click', (e) => {
        if (!typographyPopup.contains(e.target) && e.target !== typographyBtn && !typographyBtn.contains(e.target)) {
          typographyPopup.classList.remove('show');
          typographyPopup.style.display = 'none';
          typographyPopup.style.visibility = 'hidden';
          typographyPopup.style.opacity = '0';
        }
      });

      // Font Size Controls
      document.getElementById('fontPlus1').onclick = () => {
        fontSize = Math.min(200, fontSize + 1);            updateFontInfo();
            applyTheme();
          };

      document.getElementById('fontMinus1').onclick = () => {
        fontSize = Math.max(50, fontSize - 1);            updateFontInfo();
            applyTheme();
          };

      document.getElementById('fontReset').onclick = () => {
        fontSize = 100;            updateFontInfo();
            applyTheme();
          };

      // Line Height Controls
      document.getElementById('lineHeightPlus').onclick = () => {
        const currentIndex = lineHeights.indexOf(lineHeight);
        if (currentIndex < lineHeights.length - 1) {
          lineHeight = lineHeights[currentIndex + 1];              updateLineHeightInfo();
              applyTheme();
            }
          };

      document.getElementById('lineHeightMinus').onclick = () => {
        const currentIndex = lineHeights.indexOf(lineHeight);
        if (currentIndex > 0) {
          lineHeight = lineHeights[currentIndex - 1];              updateLineHeightInfo();
              applyTheme();
            }
          };

      document.getElementById('lineHeightReset').onclick = () => {
        lineHeight = 1.2;            updateLineHeightInfo();
            applyTheme();
          };

      // Single/Dual Page Controls
      document.getElementById('singlePageBtn').onclick = async () => {
        if (!scrollMode && dualPageMode) {
          dualPageMode = false;
          dualPageBtn.classList.remove('active');
          if (book && rendition) {
            await recreateRendition();
            setStatus('Single page mode');
          }
        }
      };

      dualPageBtn.onclick = async () => {
        if (scrollMode) return;

        dualPageMode = !dualPageMode;
        dualPageBtn.classList.toggle('active', dualPageMode);

        if (book && rendition) {
          await recreateRendition();
          setStatus(dualPageMode ? 'Dual page enabled' : 'Single page enabled');
        }
      };

      floatingPrevBtn.onclick = () => rendition && rendition.prev();
      floatingNextBtn.onclick = () => rendition && rendition.next();

      // ── Mobile Touch Zones: edge-tap page navigation ──
      (function initMobileTouchZones() {
        const tzPrev = document.getElementById('touchZonePrev');
        const tzNext = document.getElementById('touchZoneNext');
        if (!tzPrev || !tzNext) return;
        let _tzDebounce = null;

        function _handleZoneTap(direction, el, e) {
          // Ignore if text is selected in the book iframe (allow copy/paste)
          try {
            const iframes = document.querySelectorAll('#viewer iframe');
            for (const iframe of iframes) {
              const doc = iframe.contentDocument || (iframe.contentWindow && iframe.contentWindow.document);
              if (!doc) continue;
              const sel = doc.getSelection ? doc.getSelection() : null;
              if (sel && !sel.isCollapsed && sel.toString().trim().length > 0) return;
            }
          } catch(e) {}
          // Only in paginated mode with sidebar closed
          if (scrollMode || sidebarVisible) return;
          // Debounce: prevent rapid double-taps
          if (_tzDebounce) return;
          _tzDebounce = setTimeout(() => { _tzDebounce = null; }, 350);
          // Visual feedback
          el.classList.add('tapped');
          setTimeout(() => el.classList.remove('tapped'), 250);
          // Navigate
          if (!rendition) return;
          direction === 'prev' ? rendition.prev() : rendition.next();
        }

        ['click', 'touchend'].forEach(evt => {
          tzPrev.addEventListener(evt, (e) => _handleZoneTap('prev', tzPrev, e));
          tzNext.addEventListener(evt, (e) => _handleZoneTap('next', tzNext, e));
        });
      })();

      const navModePopover = document.getElementById('navModePopover');
      const navOptPage    = document.getElementById('navOptPage');
      const navOptScroll  = document.getElementById('navOptScroll');

      function _syncNavModeBtn() {
        const label = scrollModeBtn.querySelector('.nav-mode-label');
        if (label) label.textContent = scrollMode ? 'Scroll Mode' : 'Page Mode';
        scrollModeBtn.classList.toggle('active', scrollMode);
        navOptPage.classList.toggle('active', !scrollMode);
        navOptScroll.classList.toggle('active', scrollMode);
        floatingPrevBtn.classList.toggle('hidden', scrollMode);
        floatingNextBtn.classList.toggle('hidden', scrollMode);
        dualPageBtn.disabled = scrollMode;
        if (scrollMode && dualPageMode) {
          dualPageMode = false;
          dualPageBtn.classList.remove('active');
        }
      }

      scrollModeBtn.onclick = (e) => {
        e.stopPropagation();
        _closeAllReaderMenus(true);
        navModePopover.classList.toggle('open');
      };

      navOptPage.onclick = async (e) => {
        e.stopPropagation();
        navModePopover.classList.remove('open');
        if (!scrollMode) return;
        scrollMode = false;
        _syncNavModeBtn();
        if (book && rendition) {
          await recreateRendition();
          setStatus('Page mode enabled');
        }
      };

      navOptScroll.onclick = async (e) => {
        e.stopPropagation();
        navModePopover.classList.remove('open');
        if (scrollMode) return;
        scrollMode = true;
        _syncNavModeBtn();
        if (book && rendition) {
          await recreateRendition();
          setStatus('Scroll mode enabled');
        }
      };


      toggleSidebarBtn.onclick = async () => {
        sidebarVisible = !sidebarVisible;
        bookmarks.classList.toggle('hidden', !sidebarVisible);

        console.log('Sidebar toggled - sidebarVisible:', sidebarVisible, 'scrollMode:', scrollMode);

        // Hide/show floating buttons and touch zones when sidebar is toggled
        if (!scrollMode) {
          floatingPrevBtn.classList.toggle('hidden', sidebarVisible);
          floatingNextBtn.classList.toggle('hidden', sidebarVisible);
          const tzPrev = document.getElementById('touchZonePrev');
          const tzNext = document.getElementById('touchZoneNext');
          if (tzPrev) tzPrev.classList.toggle('hidden', sidebarVisible);
          if (tzNext) tzNext.classList.toggle('hidden', sidebarVisible);
          console.log('Floating buttons updated - hidden:', sidebarVisible);
          
          // Recreate rendition to update padding
          if (rendition && book) {
            await recreateRendition();
          }
        }

        if (rendition) {
          // Use requestAnimationFrame to ensure resize happens in the next frame
          // to avoid ResizeObserver loop errors
          requestAnimationFrame(() => {
            setTimeout(() => {
              if (rendition) rendition.resize();
            }, 50);
          });
        }

        setStatus(sidebarVisible ? 'Bookmarks visible' : 'Bookmarks hidden');
      };

      // Theme Popup Toggle
      const themePopup = document.getElementById('themePopupMain');
      buildThemePopup();

      themeBtn.onclick = (e) => {
        e.stopPropagation();
        const isShowing = themePopup.classList.contains('show');

        // Close typography popup if open
        typographyPopup.classList.remove('show');
        typographyPopup.style.display = 'none';
        typographyPopup.style.visibility = 'hidden';
        typographyPopup.style.opacity = '0';

        if (isShowing) {
          themePopup.classList.remove('show');
          themePopup.style.display = 'none';
          themePopup.style.visibility = 'hidden';
          themePopup.style.opacity = '0';
        } else {
          themePopup.style.display = 'block';
          themePopup.style.visibility = 'visible';
          themePopup.style.opacity = '1';
          themePopup.classList.add('show');
          updateThemeSwatchActive();
        }
      };

      // Close theme popup when clicking outside
      document.addEventListener('click', (e) => {
        if (themePopup && !themePopup.contains(e.target) && e.target !== themeBtn && !themeBtn.contains(e.target)) {
          themePopup.classList.remove('show');
          themePopup.style.display = 'none';
          themePopup.style.visibility = 'hidden';
          themePopup.style.opacity = '0';
        }
      });

      // Interface Settings Button and Popup
      const interfaceBtn = document.getElementById('interfaceBtn');
      const interfacePopup = document.getElementById('interfacePopupMain');

      interfaceBtn.onclick = (e) => {
        e.stopPropagation();
        const isShowing = interfacePopup.classList.contains('show');

        // Close other popups
        typographyPopup.classList.remove('show');
        typographyPopup.style.display = 'none';
        typographyPopup.style.visibility = 'hidden';
        typographyPopup.style.opacity = '0';

        const themePopupEl = document.getElementById('themePopupMain');
        if (themePopupEl) {
          themePopupEl.classList.remove('show');
          themePopupEl.style.display = 'none';
          themePopupEl.style.visibility = 'hidden';
          themePopupEl.style.opacity = '0';
        }

        if (isShowing) {
          interfacePopup.classList.remove('show');
          interfacePopup.style.display = 'none';
          interfacePopup.style.visibility = 'hidden';
          interfacePopup.style.opacity = '0';
        } else {
          interfacePopup.style.display = 'block';
          interfacePopup.style.visibility = 'visible';
          interfacePopup.style.opacity = '1';
          interfacePopup.classList.add('show');
          updateInterfaceControls();
        }
      };

      // Close interface popup when clicking outside
      document.addEventListener('click', (e) => {
        if (interfacePopup && !interfacePopup.contains(e.target) && e.target !== interfaceBtn && !interfaceBtn.contains(e.target)) {
          interfacePopup.classList.remove('show');
          interfacePopup.style.display = 'none';
          interfacePopup.style.visibility = 'hidden';
          interfacePopup.style.opacity = '0';
        }
      });

      // Update interface controls with current values
      function updateInterfaceControls() {
        document.getElementById('toolbarColorPicker').value = interfaceSettings.toolbarColor;
        document.getElementById('sidebarColorPicker').value = interfaceSettings.sidebarColor;
        document.getElementById('navButtonsColorPicker').value = interfaceSettings.navButtonsColor;
        document.getElementById('navOpacitySlider').value = interfaceSettings.navOpacity;
        document.getElementById('navOpacityValue').textContent = interfaceSettings.navOpacity;
        document.getElementById('ubmDrawerColorPicker').value = interfaceSettings.ubmDrawerColor || '#fffde7';
      }

      // Toolbar Color
      document.getElementById('toolbarColorPicker').addEventListener('input', (e) => {
        interfaceSettings.toolbarColor = e.target.value;
        applyInterfaceSettings();
      });

      document.getElementById('toolbarColorReset').onclick = () => {
        interfaceSettings.toolbarColor = defaultInterfaceSettings.toolbarColor;
        updateInterfaceControls();
        applyInterfaceSettings();
      };

      // Sidebar Color
      document.getElementById('sidebarColorPicker').addEventListener('input', (e) => {
        interfaceSettings.sidebarColor = e.target.value;
        applyInterfaceSettings();
      });

      document.getElementById('sidebarColorReset').onclick = () => {
        interfaceSettings.sidebarColor = defaultInterfaceSettings.sidebarColor;
        updateInterfaceControls();
        applyInterfaceSettings();
      };

      // Nav Buttons Color
      document.getElementById('navButtonsColorPicker').addEventListener('input', (e) => {
        interfaceSettings.navButtonsColor = e.target.value;
        applyInterfaceSettings();
      });

      document.getElementById('navButtonsColorReset').onclick = () => {
        interfaceSettings.navButtonsColor = defaultInterfaceSettings.navButtonsColor;
        updateInterfaceControls();
        applyInterfaceSettings();
      };

      // Nav Opacity
      document.getElementById('navOpacitySlider').addEventListener('input', (e) => {
        interfaceSettings.navOpacity = parseFloat(e.target.value);
        document.getElementById('navOpacityValue').textContent = interfaceSettings.navOpacity;
        applyInterfaceSettings();
      });

      document.getElementById('navOpacityReset').onclick = () => {
        interfaceSettings.navOpacity = defaultInterfaceSettings.navOpacity;
        updateInterfaceControls();
        applyInterfaceSettings();
      };

      // Bookmark Drawer Color
      document.getElementById('ubmDrawerColorPicker').addEventListener('input', (e) => {
        interfaceSettings.ubmDrawerColor = e.target.value;
        applyInterfaceSettings();
      });

      document.getElementById('ubmDrawerColorReset').onclick = () => {
        interfaceSettings.ubmDrawerColor = defaultInterfaceSettings.ubmDrawerColor;
        updateInterfaceControls();
        applyInterfaceSettings();
      };

      // Display Settings Save Prompt buttons
      const dspSaveBtn    = document.getElementById('dspSaveBtn');
      const dspDismissBtn = document.getElementById('dspDismissBtn');
      if (dspSaveBtn) {
        dspSaveBtn.addEventListener('click', async function() {
          _hideDisplaySavePrompt();
          await saveVisualSettings();
          showToast('Display settings saved \u2713', 'saved', 2200);
        });
      }
      if (dspDismissBtn) {
        dspDismissBtn.addEventListener('click', function() {
          _hideDisplaySavePrompt();
        });
      }

      // --- READER HIGHLIGHT BUTTON LOGIC ---
      (function() {
        const hlBtn = document.getElementById('readerHighlightBtn');
        const hlMenu = document.getElementById('readerHighlightMenu');
        if (!hlBtn || !hlMenu) return;

        // Color classes for the button
        const COLOR_CLASSES = ['hl-yellow', 'hl-green', 'hl-pink', 'hl-remove'];

        function setHlBtnColor(color) {
          COLOR_CLASSES.forEach(c => hlBtn.classList.remove(c));
          if (color === 'yellow') hlBtn.classList.add('hl-yellow');
          else if (color === 'green') hlBtn.classList.add('hl-green');
          else if (color === 'pink') hlBtn.classList.add('hl-pink');
          else if (color === 'remove') hlBtn.classList.add('hl-remove');
          else hlBtn.classList.add('hl-yellow');
        }

        function getIframeSelection() {
          try {
            const iframes = document.querySelectorAll('#viewer iframe');
            for (const iframe of iframes) {
              const doc = iframe.contentDocument || (iframe.contentWindow && iframe.contentWindow.document);
              if (!doc) continue;
              const sel = doc.getSelection ? doc.getSelection() : null;
              if (sel && !sel.isCollapsed && sel.toString().trim().length > 0) return sel;
            }
          } catch(e) {}
          return null;
        }

        function applyReaderHighlight() {
          if (!rendition) return;
          // epub.js 'selected' event already provided the authoritative CFI
          const cfi = _readerPendingCfi;
          if (!cfi) {
            setStatus('Select some text first');
            return;
          }
          try {
            // Remove any existing annotation at same CFI (dedup)
            readerHighlights = readerHighlights.filter(h => h.cfi !== cfi);
            rendition.annotations.remove(cfi, 'highlight');
            // Add new highlight
            readerHighlights.push({ cfi: cfi, color: currentReaderHighlightColor });
            const _hlColor = HL_COLORS[currentReaderHighlightColor] || '#ffeb3b';
            rendition.annotations.highlight(cfi, {}, () => {}, 'epub-hl-' + currentReaderHighlightColor,
              { fill: _hlColor, 'fill-opacity': '0.5' });
            // Clear selection in iframe
            try {
              const iframes = document.querySelectorAll('#viewer iframe');
              for (const iframe of iframes) {
                const doc = iframe.contentDocument || (iframe.contentWindow && iframe.contentWindow.document);
                if (doc && doc.getSelection) doc.getSelection().removeAllRanges();
              }
            } catch(e) {}
            _readerHlHasSelection = false;
            _readerPendingCfi = null;
            hlBtn.style.outline = '';
            hlBtn.title = 'Highlight text';
            setStatus('Text highlighted ✓');
          } catch(err) {
            console.warn('Highlight error:', err);
            setStatus('Could not highlight selection');
          }
        }

        function removeReaderHighlight() {
          if (!rendition) return;
          const cfi = _readerPendingCfi;
          if (!cfi) {
            setStatus('Select highlighted text to remove it');
            return;
          }
          try {
            rendition.annotations.remove(cfi, 'highlight');
            readerHighlights = readerHighlights.filter(h => h.cfi !== cfi);
            // Clear selection in iframe
            try {
              const iframes = document.querySelectorAll('#viewer iframe');
              for (const iframe of iframes) {
                const doc = iframe.contentDocument || (iframe.contentWindow && iframe.contentWindow.document);
                if (doc && doc.getSelection) doc.getSelection().removeAllRanges();
              }
            } catch(e) {}
            _readerHlHasSelection = false;
            _readerPendingCfi = null;
            hlBtn.style.outline = '';
            hlBtn.title = 'Highlight text';
            setStatus('Highlight removed ✓');
          } catch(e) {
            setStatus('Select highlighted text to remove it');
          }
        }

        // v816-ctx: Simplified click — just apply/remove if selection exists.
        // The contextual popup handles colour picking.
        hlBtn.addEventListener('click', (e) => {
          e.stopPropagation();
          const hasSelection = !!_readerPendingCfi || (function() {
            var s = getIframeSelection();
            return !!(s && !s.isCollapsed && s.toString().trim().length > 0);
          })();
          if (hasSelection) {
            if (currentReaderHighlightColor === 'remove') {
              removeReaderHighlight();
            } else {
              applyReaderHighlight();
            }
          }
        });

        // When selection is cleared, reset pending state and hide popup
        document.addEventListener('selectionchange', () => {
          const sel = getIframeSelection();
          _readerHlHasSelection = !!(sel && !sel.isCollapsed && sel.toString().trim().length > 0);
          if (!_readerHlHasSelection) {
            _readerPendingCfi = null;
            hlBtn.style.outline = '';
            hlBtn.title = 'Highlight text';
            if (typeof _hideCtxAnnotatePopup === 'function') _hideCtxAnnotatePopup();
          }
        });

      /* ═══════════════════════════════════════════════════════
         CONTEXTUAL ANNOTATE POPUP — v816-ctx
         (inside highlight IIFE — has access to applyReaderHighlight)
         ═══════════════════════════════════════════════════════ */
      (function initCtxAnnotatePopup() {
        var popup = document.getElementById('ctxAnnotatePopup');
        if (!popup) return;
        var viewer = document.getElementById('viewer');

        function _colorDot(c) {
          var m = { yellow: '#ffeb3b', green: '#a5d6a7', pink: '#f8bbd9' };
          return c === 'remove' ? '#fff' : (m[c] || '#ffeb3b');
        }

        function _updateActiveState(color) {
          popup.querySelectorAll('.ctx-annotate-option').forEach(function(o) {
            o.classList.toggle('active', o.dataset.color === color);
          });
          var dot = document.getElementById('rmbAnnotateColor');
          if (dot) dot.style.background = _colorDot(color);
          var hmbDot = document.getElementById('hmbAnnotateColor');
          if (hmbDot) hmbDot.style.background = _colorDot(color);
        }

        function _getIframeOffset() {
          try {
            var iframe = viewer ? viewer.querySelector('iframe') : null;
            if (iframe) { var r = iframe.getBoundingClientRect(); return { top: r.top, left: r.left }; }
          } catch(e) {}
          return { top: 0, left: 0 };
        }

        window._showCtxAnnotatePopup = function() {
          var sel = getIframeSelection();
          if (!sel || sel.isCollapsed || sel.toString().trim().length === 0) return;
          _pendingPreviewText = sel.toString().trim();
          try {
            var range = sel.getRangeAt(0);
            var rect = range.getBoundingClientRect();
            var iframeOff = _getIframeOffset();
            var top = rect.bottom + iframeOff.top + 8;
            /* Center popup under the selected text line */
            var left = rect.left + iframeOff.left + (rect.width / 2) - 76; /* half of ~152px popup width */
            if (left < 8) left = 8;
            if (left + 160 > window.innerWidth - 8) left = window.innerWidth - 168;
            /* If too close to bottom, show above the selection */
            if (top + 52 > window.innerHeight) top = rect.top + iframeOff.top - 52;
            popup.style.top = top + 'px';
            popup.style.left = left + 'px';
            popup.style.display = 'flex';
            popup.classList.add('visible');
            _updateActiveState(currentReaderHighlightColor);
          } catch(e) {}
        };

        window._hideCtxAnnotatePopup = function() {
          popup.classList.remove('visible');
          setTimeout(function() { if (!popup.classList.contains('visible')) popup.style.display = 'none'; }, 180);
        };

        popup.querySelectorAll('.ctx-annotate-option').forEach(function(opt) {
          opt.addEventListener('click', function(e) {
            e.stopPropagation();
            var color = opt.dataset.color;
            currentReaderHighlightColor = color;
            var hlBtn = document.getElementById('readerHighlightBtn');
            if (hlBtn) {
              ['hl-yellow','hl-green','hl-pink','hl-remove'].forEach(function(c) { hlBtn.classList.remove(c); });
              hlBtn.style.outline = ''; hlBtn.title = 'Highlight text';
              if (color === 'yellow') hlBtn.classList.add('hl-yellow');
              else if (color === 'green') hlBtn.classList.add('hl-green');
              else if (color === 'pink') hlBtn.classList.add('hl-pink');
              else if (color === 'remove') hlBtn.classList.add('hl-remove');
            }
            _updateActiveState(color);
            window._hideCtxAnnotatePopup();
            if (color === 'remove') {
              removeReaderHighlight();
            } else {
              applyReaderHighlight();
            }
          });
        });

        // Preview button handler
        var previewBtn = popup.querySelector('.ctx-preview-option');
        if (previewBtn) {
          previewBtn.addEventListener('click', function(e) {
            e.stopPropagation();
            window._hideCtxAnnotatePopup();
            if (typeof window._showMediaDialog === 'function' && _pendingPreviewText) {
              window._showMediaDialog('text', { text: _pendingPreviewText, color: currentReaderHighlightColor });
            }
          });
        }

        document.addEventListener('click', function(e) {
          if (popup.style.display !== 'none' && !popup.contains(e.target)) {
            window._hideCtxAnnotatePopup();
          }
        });

        _updateActiveState(currentReaderHighlightColor);

      })();
      /* ── END CONTEXTUAL ANNOTATE POPUP ── */

      })();
      // --- END READER HIGHLIGHT BUTTON LOGIC ---

      // Extract Chapter Dropdown
      const extractMenu = document.getElementById('extractMenu');      extractChapterBtn.onclick = (e) => {
        e.stopPropagation();
        extractMenu.classList.toggle('show');
        // Reset mode highlight and sync action buttons on menu open
        if (extractMenu.classList.contains('show')) {
          extractMenu.querySelectorAll('.extract-menu-item').forEach(function(mi) { mi.style.background = ''; mi.style.color = ''; mi.style.fontWeight = ''; });
          _extractMode = null;
          var actions = document.getElementById('extractActions');
          if (actions) {
            if (_extractFormat === 'html-clean' || _extractFormat === 'html-annotated') {
              actions.classList.add('visible');
            } else {
              actions.classList.remove('visible');
            }
          }
        }
      };

      // Format selector buttons
      document.querySelectorAll('#extractFormatRow .extract-fmt-btn').forEach(function(btn) {
        btn.addEventListener('click', function(e) {
          e.stopPropagation();
          document.querySelectorAll('#extractFormatRow .extract-fmt-btn').forEach(function(b) { b.classList.remove('active'); });
          btn.classList.add('active');
          _extractFormat = btn.dataset.fmt;
          // Show action buttons only for html-clean / html-annotated
          var actions = document.getElementById('extractActions');
          if (actions) {
            if (_extractFormat === 'html-clean' || _extractFormat === 'html-annotated') {
              actions.classList.add('visible');
            } else {
              actions.classList.remove('visible');
            }
          }
          _extractMode = null; // reset mode on format change
        });
      });

      // Handle menu item clicks
      extractMenu.querySelectorAll('.extract-menu-item').forEach(item => {
        item.onclick = async (e) => {
          e.stopPropagation();
          
          const mode = item.dataset.mode;
          
          // For html-clean / html-annotated: select mode, don't trigger yet (action buttons do)
          if (_extractFormat === 'html-clean' || _extractFormat === 'html-annotated') {
            _extractMode = mode;
            // Highlight selected mode
            extractMenu.querySelectorAll('.extract-menu-item').forEach(function(mi) { mi.style.background = ''; mi.style.color = ''; });
            item.style.background = '#667eea';
            item.style.color      = '#ffffff';
            item.style.fontWeight = '600';
            return;
          }

          extractMenu.classList.remove('show');
          
          if (mode === 'current') {
            // Extract current chapter only (leaf node)
            await extractCurrentChapter();
          } else if (mode === 'tree') {
            // Extract current + all sublevels
            try {
              const location = rendition.currentLocation();
              if (!location || !location.start) {
                alert('Cannot determine current position');
                return;
              }

              const { entries: allEntries, title: tocLabel } = await _extractTree(location.start ? location : rendition.currentLocation());
              const overallTitle = tocLabel + ' (Complete)';
              
              await extractMultipleSections(allEntries, overallTitle);
              
            } catch (error) {
              console.error('Error extracting tree:', error);
              alert('Error extracting sections: ' + error.message);
              setStatus('Error extracting sections');
            }
          }
        };
      });

      // Action button: Extract only (download)
      var extractActionExtract = document.getElementById('extractActionExtract');
      if (extractActionExtract) {
        extractActionExtract.onclick = async function(e) {
          e.stopPropagation();
          if (!_extractMode) { showToast('Select a chapter scope first', 'warn', 2000); return; }
          _shouldOpenEditor = false;
          extractMenu.classList.remove('show');
          if (_extractMode === 'current') {
            await extractCurrentChapter();
          } else if (_extractMode === 'tree') {
            try {
              var { entries: eallEntries, title: eoverallTitle } = await _extractTree(rendition.currentLocation());
              await extractMultipleSections(eallEntries, eoverallTitle);
            } catch (err) { alert('Extraction failed: ' + err.message); }
          }
        };
      }

      // Action button: Extract + Edit (download + open editor)
      var extractActionEdit = document.getElementById('extractActionEdit');
      if (extractActionEdit) {
        extractActionEdit.onclick = async function(e) {
          e.stopPropagation();
          if (!_extractMode) { showToast('Select a chapter scope first', 'warn', 2000); return; }
          _shouldOpenEditor = true;
          extractMenu.classList.remove('show');
          if (_extractMode === 'current') {
            await extractCurrentChapter();
          } else if (_extractMode === 'tree') {
            try {
              var { entries: eallEntries, title: eoverallTitle } = await _extractTree(rendition.currentLocation());
              await extractMultipleSections(eallEntries, eoverallTitle);
            } catch (err) { alert('Extraction failed: ' + err.message); }
          }
        };
      }
    });
