    // --- READER HIGHLIGHTS ---
    let readerHighlights = []; // [{cfi, color}]
    let currentReaderHighlightColor = 'yellow';
    let _pendingPreviewText = '';
    const HL_COLORS = { yellow: '#ffeb3b', green: '#a5d6a7', pink: '#f8bbd9' };
    let _readerHlHasSelection = false;
    let _readerPendingCfi = null; // CFI provided by epub.js 'selected' event

    // --- TOAST NOTIFICATION ---
    function showToast(msg, type = 'saving', duration = 2200) {
      const toast = document.getElementById('saveToast');
      const toastMsg = document.getElementById('saveToastMsg');
      toastMsg.textContent = msg;
      toast.className = '';             // reset classes
      toast.classList.add(type);
      // force reflow
      void toast.offsetWidth;
      toast.classList.add('show');
      clearTimeout(showToast._timer);
      showToast._timer = setTimeout(() => {
        toast.classList.remove('show');
      }, duration);
    }

    // --- AUTO-SAVE: GET CFI AT VISUAL CENTER ---
    async function _getCenterCfi() {
      if (!rendition) return null;
      if (scrollMode) {
        try {
          const iframes = document.querySelectorAll('#viewer iframe');
          if (iframes.length > 0) {
            const iframeEl = iframes[0];
            const iframeDoc = iframeEl.contentDocument || iframeEl.contentWindow.document;
            if (iframeDoc) {
              const rect = iframeEl.getBoundingClientRect();
              const cx = rect.width / 2;
              const cy = rect.height / 2;
              const el = iframeDoc.elementFromPoint(cx, cy);
              if (el) {
                const contents = rendition.getContents();
                if (contents && contents.length > 0) {
                  const cfi = contents[0].cfiFromElement(el);
                  if (cfi) return cfi;
                }
              }
            }
          }
        } catch (e) { /* fallback to currentLocation */ }
      }
      try {
        const loc = rendition.currentLocation();
        if (loc && loc.start && loc.start.cfi) return loc.start.cfi;
      } catch (e) {}
      return null;
    }

    // --- VISUAL STATE SNAPSHOT (for dirty-check) ---
    function _snapshotVisualState() {
      return JSON.stringify({
        fontSize, lineHeight, theme: currentTheme,
        scrollMode, dualPageMode, buttonZoom,
        interface: { ...interfaceSettings }
      });
    }

    // --- AUTO-SAVE: LIGHTWEIGHT POSITION-ONLY WRITE ---
    async function savePositionOnly(cfi, href) {
      if (!currentBookId || !cfi) return;
      try {
        const db = await openDB();
        const bookData = await new Promise((resolve, reject) => {
          const tx = db.transaction(STORE_NAME, 'readonly');
          const store = tx.objectStore(STORE_NAME);
          const req = store.get(currentBookId);
          req.onsuccess = () => resolve(req.result);
          req.onerror = () => reject(req.error);
          tx.onabort = () => { console.warn('Transaction aborted:', tx.error); reject(tx.error || new Error('Transaction was aborted')); };
        });
        if (!bookData) return;
        const existingState = bookData.savedState || {};
        const updatedBook = {
          ...bookData,
          savedState: {
            ...existingState,
            position: { cfi, href: href || null, timestamp: Date.now() }
          }
        };
        await new Promise((resolve, reject) => {
          const tx = db.transaction(STORE_NAME, 'readwrite');
          const store = tx.objectStore(STORE_NAME);
          const req = store.put(updatedBook);
          req.onsuccess = () => resolve();
          req.onerror = () => reject(req.error);
          tx.onabort = () => { console.warn('Transaction aborted:', tx.error); reject(tx.error || new Error('Transaction was aborted')); };
        });
        _lastAutoSavedCfi = cfi;
      } catch (e) {
        console.warn('Auto-save position failed:', e);
      }
    }

    // --- VISUAL SETTINGS ONLY WRITE ---
    async function saveVisualSettings() {
      if (!currentBookId) return;
      try {
        const db = await openDB();
        const bookData = await new Promise((resolve, reject) => {
          const tx = db.transaction(STORE_NAME, 'readonly');
          const store = tx.objectStore(STORE_NAME);
          const req = store.get(currentBookId);
          req.onsuccess = () => resolve(req.result);
          req.onerror = () => reject(req.error);
          tx.onabort = () => { console.warn('Transaction aborted:', tx.error); reject(tx.error || new Error('Transaction was aborted')); };
        });
        if (!bookData) return;
        const existingState = bookData.savedState || {};
        const updatedBook = {
          ...bookData,
          savedState: {
            ...existingState,
            fontSize, lineHeight, theme: currentTheme,
            scrollMode, dualPageMode, buttonZoom,
            interface: { ...interfaceSettings },
            readerHighlights: readerHighlights.slice(),
            savedAt: Date.now()
          }
        };
        await new Promise((resolve, reject) => {
          const tx = db.transaction(STORE_NAME, 'readwrite');
          const store = tx.objectStore(STORE_NAME);
          const req = store.put(updatedBook);
          req.onsuccess = () => resolve();
          req.onerror = () => reject(req.error);
          tx.onabort = () => { console.warn('Transaction aborted:', tx.error); reject(tx.error || new Error('Transaction was aborted')); };
        });
        _lastSavedVisualState = _snapshotVisualState();
      } catch (e) {
        console.warn('Save visual settings failed:', e);
        showToast('Settings save failed', 'error', 3000);
      }
    }

    // --- AUTO-SAVE TIMER (3 seconds, write only on CFI change) ---
    function startAutoSave() {
      stopAutoSave();
      _lastAutoSavedCfi = null;
      _lastNavigatedCfi = null;
      _autoSaveTimer = setInterval(async () => {
        if (!rendition || !currentBookId) return;
        // Skip auto-save when browser translation is active: translation modifies
        // the iframe DOM and makes currentLocation() report wrong positions.
        // The last IDB-saved position (pre-translation) is preserved as-is.
        if (_isBrowserTranslated()) return;
        const cfi = await _getCenterCfi();
        if (!cfi || cfi === _lastAutoSavedCfi) return;
        let href = null;
        try {
          const loc = rendition.currentLocation();
          if (loc && loc.start) href = loc.start.href;
        } catch (e) {}
        await savePositionOnly(cfi, href);
      }, 3000);
    }

    function stopAutoSave() {
      if (_autoSaveTimer !== null) {
        clearInterval(_autoSaveTimer);
        _autoSaveTimer = null;
      }
    }

    // --- BROWSER TRANSLATION DETECTION ---
    // Returns true when the browser has translated the page (Chrome/Edge built-in translate).
    // Translation modifies the iframe DOM without triggering epub.js navigation events,
    // causing currentLocation() to report wrong positions → we must pause auto-save.
    function _isBrowserTranslated() {
      const html = document.documentElement;
      return html.classList.contains('translated-ltr') ||
             html.classList.contains('translated-rtl') ||
             html.hasAttribute('translated');
    }

    // --- DISPLAY SETTINGS SAVE PROMPT ---
    function _showDisplaySavePrompt() {
      if (!currentBookId) return;
      if (_snapshotVisualState() === _lastSavedVisualState) return;
      var prompt = document.getElementById('displaySavePrompt');
      if (!prompt) return;
      if (_dspTimer) { clearTimeout(_dspTimer); _dspTimer = null; }
      prompt.classList.add('show');
      _dspTimer = setTimeout(function() {
        prompt.classList.remove('show');
        _dspTimer = null;
      }, 8000);
    }

    function _hideDisplaySavePrompt() {
      var prompt = document.getElementById('displaySavePrompt');
      if (prompt) prompt.classList.remove('show');
      if (_dspTimer) { clearTimeout(_dspTimer); _dspTimer = null; }
    }

    // --- SAVE BOOK STATE TO INDEXEDDB ---
    async function saveBookState() {
      await saveVisualSettings();
      const cfi = await _getCenterCfi();
      if (cfi) {
        let href = null;
        try {
          const loc = rendition.currentLocation();
          if (loc && loc.start) href = loc.start.href;
        } catch(e) {}
        await savePositionOnly(cfi, href);
      }
    }

    // --- LOAD AND APPLY SAVED BOOK STATE ---
    async function loadAndApplyBookState(bookId) {
      try {
        const db = await openDB();
        const bookData = await new Promise((resolve, reject) => {
          const tx = db.transaction(STORE_NAME, 'readonly');
          const store = tx.objectStore(STORE_NAME);
          const req = store.get(bookId);
          req.onsuccess = () => resolve(req.result);
          req.onerror = () => reject(req.error);
          tx.onabort = () => { console.warn('Transaction aborted:', tx.error); reject(tx.error || new Error('Transaction was aborted')); };
        });

        if (!bookData || !bookData.savedState) {
          // No saved state → use all defaults
          fontSize = 100;
          lineHeight = 1.2;
          currentTheme = 'normal';
          scrollMode = false;
          dualPageMode = false;
          sidebarVisible = false;
          buttonZoom = 100;
          interfaceSettings = { ...defaultInterfaceSettings };
          readerHighlights = [];
          return null; // no saved position
        }

        const s = bookData.savedState;

        // 1. Typography
        fontSize    = (s.fontSize    !== undefined) ? s.fontSize    : 100;
        lineHeight  = (s.lineHeight  !== undefined) ? s.lineHeight  : 1.2;
        // 2. Theme
        currentTheme = s.theme || 'normal';
        // 3. Navigation
        scrollMode    = !!s.scrollMode;
        dualPageMode  = !!s.dualPageMode;
        sidebarVisible = (s.sidebarVisible !== undefined) ? !!s.sidebarVisible : false;
        // 4. Button zoom
        buttonZoom = s.buttonZoom || 100;
        // 5. Interface
        interfaceSettings = s.interface ? { ...defaultInterfaceSettings, ...s.interface } : { ...defaultInterfaceSettings };
        // 6. Reader highlights
        readerHighlights = Array.isArray(s.readerHighlights) ? s.readerHighlights.slice() : [];

        // Return position CFI (may be null)
        return s.position || null;

      } catch (e) {
        console.error('Error loading book state:', e);
        return null;
      }
    }

    function setStatus(msg) {
      document.getElementById('statusChapterName').textContent = msg;
    }

    function setStatusPath(fullPath) {
      const nameEl = document.getElementById('statusChapterName');
      if (!fullPath) {
        nameEl.textContent = '';
        _currentChapterName = '';
        return;
      }
      const parts = fullPath.split(' › ');
      _currentChapterName = parts[parts.length - 1] || '';
      if (parts.length > 1) {
        nameEl.textContent = parts[parts.length - 2] + ' → ' + parts[parts.length - 1];
      } else {
        nameEl.textContent = parts[0];
      }
      nameEl.title = fullPath;
      updateChapterNav();
    }

