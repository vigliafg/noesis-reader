    // --- UI VIEW SWITCHING ---

    const libraryView = document.getElementById('library-view');
    const readerView = document.getElementById('reader-view');
    const bookGrid = document.getElementById('bookGrid');
    const loadingOverlay = document.getElementById('loading-overlay');
    const loadingMsg = document.getElementById('loading-msg');

    function showLoading(msg) {
      loadingMsg.textContent = msg;
      loadingOverlay.classList.remove('hidden');
    }

    function hideLoading() {
      loadingOverlay.classList.add('hidden');
    }

    async function showLibrary() {
      stopAutoSave();
      _lastSavedVisualState = null;
      _hideDisplaySavePrompt();
      readerView.classList.add('hidden');
      libraryView.classList.remove('hidden');

      // ── Random brand animation ──
      _triggerBrandAnim();

      // Save annotations before resetting
      if (currentBookId && readerHighlights.length > 0) {
        await saveVisualSettings();
      }

      // Reset reader state when leaving
      if (book) {
        book.destroy();
        book = null;
      }
      if (rendition) {
        rendition.destroy();
        rendition = null;
      }
      document.getElementById('toc').innerHTML = '';
      document.getElementById('viewer').innerHTML = '';

      // Reset tracking
      currentBookId = null;
      setStatusPath('');

      // Reset highlights
      readerHighlights = [];
      currentReaderHighlightColor = null;
      _readerPendingCfi = null;
      const hlBtn = document.getElementById('readerHighlightBtn');
      if (hlBtn) {
        hlBtn.className = 'btn btn-icon';
        hlBtn.style.outline = '';
        hlBtn.title = 'Select text, then pick a color';
      }
      const hlMenu = document.getElementById('readerHighlightMenu');
      if (hlMenu) hlMenu.classList.remove('show');

      // Close and clear user bookmarks drawer
      closeUbmDrawer();
      userBookmarks = [];
      renderUbmList();

      loadLibraryBooks();
    }

    function showReader() {
      libraryView.classList.add('hidden');
      readerView.classList.remove('hidden');
    }

