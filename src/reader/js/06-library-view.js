    // ── New hierarchical loadLibraryBooks ─────────────────────────────────
    async function loadLibraryBooks() {
      bookGrid.innerHTML = '';
      try {
        const books = await getAllBooks();

        // Sort books by addedAt desc
        books.sort((a, b) => b.addedAt - a.addedAt);

        if (books.length === 0) {
          bookGrid.innerHTML = `
            <div class="empty-state">
              <i class="bi bi-book"></i>
              <p>Start by adding a book. Reading is the first step toward building knowledge.</p>
            </div>`;
          return;
        }


        books.forEach(book => {
          const bookRow = document.createElement('div');
          bookRow.className = 'book-row';

          // Cover HTML
          const coverHtml = book.cover
            ? `<img src="${book.cover}" alt="${book.title}">`
            : `<i class="bi bi-book"></i>`;

          bookRow.innerHTML = `
            <div class="book-header">
              <div class="book-cover-thumb" title="Open in Reader">${coverHtml}</div>
              <div class="book-meta">
                <div class="book-meta-title" title="${book.title}">${book.title}</div>
                <div class="book-meta-author">${book.author || ''}</div>
              </div>
              <div class="book-actions">
                <button class="book-delete-btn" title="Delete book"><i class="bi bi-trash"></i></button>
              </div>
            </div>
          `;

          // Click on cover → open reader
          bookRow.querySelector('.book-cover-thumb').onclick = () => openBookFromLibrary(book);

          // Delete book
          bookRow.querySelector('.book-delete-btn').onclick = async (e) => {
            e.stopPropagation();
            if (confirm(`Delete "${book.title}"?`)) {
              await deleteBook(book.id);
              loadLibraryBooks();
            }
          };

          bookGrid.appendChild(bookRow);
        });
        updateStorageBar();

      } catch (e) {
        console.error("Error loading library", e);
        bookGrid.innerHTML = '<div class="empty-state">Error loading library database.</div>';
      }
    }

    // ════════════════════════════════════════════════════════════════════════
    // IMPORT SNAPSHOTS — reimporta file snapshot da disco in noesisDB
    // ════════════════════════════════════════════════════════════════════════
    async function openBookFromLibrary(bookData) {
      showLoading('Opening Book...');
      try {
        showReader();
        document.getElementById('fileName').textContent = bookData.title;

        // Track current book ID and title
        currentBookId = bookData.id;
        currentBookTitle = bookData.title || '';

        // Load saved state (or defaults) BEFORE creating rendition
        const savedPosition = await loadAndApplyBookState(currentBookId);
        _lastSavedVisualState = _snapshotVisualState();

        // Load user bookmarks for this book
        await loadUserBookmarksFromDB(currentBookId);
        await _loadCollectionFromDB(currentBookId);
        renderUbmList();

        // Apply loaded button zoom to toolbar (zoom UI removed in menubar variant)
        const toolbar = document.querySelector('.toolbar');

        // Sync scroll mode button visual state
        const scrollModeBtn = document.getElementById('scrollModeBtn');
        if (scrollModeBtn) {
          scrollModeBtn.classList.toggle('active', scrollMode);
          const lbl = scrollModeBtn.querySelector('.nav-mode-label');
          if (lbl) lbl.textContent = scrollMode ? 'Scroll Mode' : 'Page Mode';
          const op = document.getElementById('navOptPage');
          const os = document.getElementById('navOptScroll');
          if (op) op.classList.toggle('active', !scrollMode);
          if (os) os.classList.toggle('active', scrollMode);
        }
        // Sync Navigate menubar items
        const rmbPM = document.getElementById('rmbPageModeItem');
        const rmbSM = document.getElementById('rmbScrollModeItem');
        if (rmbPM) rmbPM.classList.toggle('rmb-nav-active', !scrollMode);
        if (rmbSM) rmbSM.classList.toggle('rmb-nav-active', scrollMode);
        const rmbNM = document.getElementById('rmbNavigateMode');
        if (rmbNM) rmbNM.textContent = scrollMode ? 'Scroll' : 'Page';
        const hmbNM = document.getElementById('hmbNavigateMode');
        if (hmbNM) hmbNM.textContent = scrollMode ? 'Scroll' : 'Page';

        // Sync dual page button visual state
        const dualPageBtnEl = document.getElementById('dualPageBtn');
        if (dualPageBtnEl) {
          dualPageBtnEl.classList.toggle('active', dualPageMode);
          dualPageBtnEl.disabled = scrollMode;
        }

        // Apply UI display values
        updateFontInfo();
        updateLineHeightInfo();
        applyInterfaceSettings();

        // Initialize EPUB with the stored ArrayBuffer
        book = ePub(bookData.data);
        await book.ready;

        await recreateRendition();

        // Restore saved position if available
        if (savedPosition && savedPosition.cfi) {
          try {
            await rendition.display(savedPosition.cfi);
          } catch (e) {
            console.warn('Could not restore position, starting from beginning:', e);
            await rendition.display();
          }
        }

        // Apply theme after rendition is ready
        applyTheme();

        const nav = await book.loaded.navigation;
        renderBookmarksSimple(nav.toc);

        // Apply sidebar visibility
        const bookmarksEl = document.getElementById('bookmarks');
        bookmarksEl.classList.toggle('hidden', !sidebarVisible);

        // Enable controls
        document.getElementById('extractChapterBtn').disabled = false;
        startAutoSave();

        // Toast: show current navigation mode
        showToast(scrollMode ? 'Scroll Mode ON' : 'Page Mode ON', 'saved', 2000);

        // Update floating button visibility
        const shouldShowButtons = !scrollMode && !sidebarVisible;
        document.getElementById('floatingPrevBtn').classList.toggle('hidden', !shouldShowButtons);
        document.getElementById('floatingNextBtn').classList.toggle('hidden', !shouldShowButtons);
        // Mobile touch zones: same visibility logic
        const tzPrev = document.getElementById('touchZonePrev');
        const tzNext = document.getElementById('touchZoneNext');
        if (tzPrev) tzPrev.classList.toggle('hidden', !shouldShowButtons);
        if (tzNext) tzNext.classList.toggle('hidden', !shouldShowButtons);

        setStatus(bookData.title || 'Book opened');
        // Breadcrumb will be populated by the 'relocated' event after first display.
        // Explicit fallback: try immediately with current location.
        if (book && book.navigation && book.navigation.toc) {
          try {
            const loc = rendition.currentLocation();
            if (loc && loc.start && loc.start.href) {
              const path = findBreadcrumbInToc(book.navigation.toc, loc.start.href, '');
              if (path) setStatusPath(path);
            }
          } catch (e) { /* relocated event will handle it */ }
        }

      } catch (e) {
        console.error(e);
        alert('Failed to open book');
        showLibrary();
      } finally {
        hideLoading();
      }
    }

