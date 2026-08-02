    // --- USER BOOKMARKS MODULE ---
    // =====================================================================

    // In-memory list for current book (array, newest first)
    let userBookmarks = [];

    // Save userBookmarks for currentBookId to IndexedDB (inside the book record)
    async function saveUserBookmarksToDB() {
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

        const updatedBook = { ...bookData, userBookmarks: userBookmarks };

        await new Promise((resolve, reject) => {
          const tx = db.transaction(STORE_NAME, 'readwrite');
          const store = tx.objectStore(STORE_NAME);
          const req = store.put(updatedBook);
          req.onsuccess = () => resolve();
          req.onerror = () => reject(req.error);
          tx.onabort = () => { console.warn('Transaction aborted:', tx.error); reject(tx.error || new Error('Transaction was aborted')); };
        });
      } catch (e) {
        console.error('Error saving user bookmarks:', e);
      }
    }

    // Load userBookmarks from DB for a given bookId
    async function loadUserBookmarksFromDB(bookId) {
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
        if (bookData && Array.isArray(bookData.userBookmarks)) {
          userBookmarks = bookData.userBookmarks;
        } else {
          userBookmarks = [];
        }
      } catch (e) {
        console.error('Error loading user bookmarks:', e);
        userBookmarks = [];
      }
    }

    // Render the drawer list from userBookmarks array
    function renderUbmList() {
      const list = document.getElementById('ubmList');
      if (!list) return;

      // Update badge
      const badge = document.getElementById('ubmBadge');
      if (badge) {
        if (userBookmarks.length > 0) {
          badge.textContent = userBookmarks.length;
          badge.style.display = 'flex';
        } else {
          badge.style.display = 'none';
        }
      }

      if (userBookmarks.length === 0) {
        list.innerHTML = '<div class="ubm-empty"><i class="bi bi-bookmark"></i>No bookmarks yet.<br><small>Press "New Bookmark" to add one.</small></div>';
        return;
      }

      list.innerHTML = '';
      userBookmarks.forEach((bm, idx) => {
        const item = document.createElement('div');
        item.className = 'ubm-item';

        const body = document.createElement('div');
        body.className = 'ubm-item-body';

        // Chapter title (condensed)
        const chapterEl = document.createElement('div');
        chapterEl.className = 'ubm-chapter';
        chapterEl.title = bm.chapter || '';
        const maxChTitle = 55;
        chapterEl.textContent = bm.chapter && bm.chapter.length > maxChTitle
          ? bm.chapter.slice(0, maxChTitle - 1) + '…'
          : (bm.chapter || '(unknown chapter)');

        // Preview (first 30 chars of page text)
        const previewEl = document.createElement('div');
        previewEl.className = 'ubm-preview';
        previewEl.textContent = bm.preview || '';

        body.appendChild(chapterEl);
        body.appendChild(previewEl);

        // Optional label
        if (bm.label) {
          const labelEl = document.createElement('div');
          labelEl.className = 'ubm-label';
          labelEl.textContent = '🏷 ' + bm.label;
          body.appendChild(labelEl);
        }

        // Date
        const dateEl = document.createElement('div');
        dateEl.className = 'ubm-date';
        const d = new Date(bm.createdAt);
        dateEl.textContent = d.toLocaleDateString() + ' ' + d.toLocaleTimeString([], {hour:'2-digit',minute:'2-digit'});
        body.appendChild(dateEl);

        // Navigate on click
        body.addEventListener('click', () => {
          if (bm.cfi) {
            rendition.display(bm.cfi).catch(() => {});
          } else if (bm.href) {
            navigateToHref(bm.href);
          }
          closeUbmDrawer();
        });

        // Delete button
        const delBtn = document.createElement('button');
        delBtn.className = 'ubm-delete-btn';
        delBtn.title = 'Delete bookmark';
        delBtn.innerHTML = '<i class="bi bi-x-lg"></i>';
        delBtn.addEventListener('click', (e) => {
          e.stopPropagation();
          userBookmarks.splice(idx, 1);
          saveUserBookmarksToDB();
          renderUbmList();
        });

        item.appendChild(body);
        item.appendChild(delBtn);
        list.appendChild(item);
      });
    }

    // Create a new bookmark at the current position
    async function createUserBookmark() {
      if (!rendition || !currentBookId) {
        showToast('No book open', 'error', 2000);
        return;
      }

      let cfi = null;
      let href = null;
      let chapter = '';
      let preview = '';

      try {
        const loc = rendition.currentLocation();
        if (loc && loc.start) {
          cfi = loc.start.cfi;
          href = loc.start.href;
        }
      } catch (e) {
        console.warn('Cannot get location:', e);
      }

      // Get chapter title from TOC
      if (href && book && book.navigation && book.navigation.toc) {
        const path = findBreadcrumbInToc(book.navigation.toc, href, '');
        if (path) {
          // Take just the last segment as chapter label
          const parts = path.split(' › ');
          chapter = parts[parts.length - 1].trim();
        }
      }
      if (!chapter) chapter = document.getElementById('statusPath').textContent || '(current position)';

      // Get preview: 100 chars starting 400 chars after the anchor position.
      //
      // Anchor = (page-1)/total * fullTextLength
      // where page/total come from loc.start.displayed — epub.js computes
      // these internally from its own layout engine, so they are always
      // correct regardless of CSS columns, zoom, or scroll mode.
      // This is the most reliable source of position within a chapter.
      try {
        preview = '';

        const iframes = document.querySelectorAll('#viewer iframe');
        const iframeEl = iframes.length > 0 ? iframes[0] : null;
        const iframeDoc = iframeEl
          ? (iframeEl.contentDocument || iframeEl.contentWindow.document)
          : null;

        if (iframeDoc && iframeDoc.body) {

          // --- Step 1: get full normalised text of the chapter ---
          const fullText = (iframeDoc.body.innerText || iframeDoc.body.textContent || '')
            .replace(/\r\n/g, '\n').replace(/\r/g, '\n')
            .replace(/\n+/g, ' ').replace(/\s+/g, ' ').trim();

          // --- Step 2: compute anchor offset from epub.js page position ---
          let anchorOffset = 0;
          try {
            const loc = rendition.currentLocation();
            if (loc && loc.start && loc.start.displayed) {
              const page  = loc.start.displayed.page  || 1;
              const total = loc.start.displayed.total || 1;
              // (page-1) so page 1 starts at offset 0
              const ratio = Math.max(0, (page - 1)) / Math.max(1, total);
              anchorOffset = Math.floor(ratio * fullText.length);
            }
          } catch (locErr) { /* anchorOffset stays 0 */ }

          // --- Step 3: slice 100 chars starting 400 chars after anchor ---
          const startPos = Math.min(
            Math.max(0, anchorOffset + 400),
            Math.max(0, fullText.length - 100)
          );
          const excerpt = fullText.slice(startPos, startPos + 100).trim();

          if (excerpt.length >= 5) {
            preview = excerpt + (fullText.length > startPos + 100 ? '…' : '');
          }
        }
      } catch (e) {
        preview = '';
      }

      // Ask for optional label (non-blocking: empty = no label)
      const label = window.prompt('Optional label for this bookmark (leave blank for none):', '');
      if (label === null) return; // user pressed Cancel

      const bm = {
        id: Date.now() + '_' + Math.random().toString(36).slice(2, 7),
        chapter: chapter,
        preview: preview,
        label: label.trim(),
        cfi: cfi,
        href: href,
        createdAt: Date.now()
      };

      // Insert newest first
      userBookmarks.unshift(bm);
      await saveUserBookmarksToDB();
      renderUbmList();
      showToast('Bookmark added ✓', 'saved', 2000);
    }

    function openUbmDrawer() {
      const header = document.querySelector('header');
      const drawer = document.getElementById('userBookmarksDrawer');
      if (!drawer) return;
      // Set the translation offset = header height so the drawer slides in
      // from top:0 and stops exactly below the header, never touching the layout.
      const headerH = header ? header.getBoundingClientRect().height : 0;
      drawer.style.setProperty('--ubm-header-height', headerH + 'px');
      drawer.classList.add('ubm-open');
    }

    function closeUbmDrawer() {
      const drawer = document.getElementById('userBookmarksDrawer');
      if (drawer) drawer.classList.remove('ubm-open');
    }

    // =====================================================================
