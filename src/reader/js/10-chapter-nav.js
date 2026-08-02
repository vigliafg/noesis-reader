    // ── Spine-based chapter navigation ──
    function _findSpineIndex(href) {
      if (!book || !book.spine || !book.spine.items) return -1;
      const items = book.spine.items;
      for (let i = 0; i < items.length; i++) {
        if (items[i].href === href) return i;
        // Handle relative hrefs
        if (items[i].href.endsWith('/' + href) || href.endsWith('/' + items[i].href)) return i;
      }
      return -1;
    }

    function goPrevChapter() {
      if (!book || !rendition) return;
      const loc = rendition.currentLocation();
      if (!loc || !loc.start || !loc.start.href) return;
      const idx = _findSpineIndex(loc.start.href);
      if (idx <= 0) return;
      rendition.display(book.spine.items[idx - 1].href);
    }

    function goNextChapter() {
      if (!book || !rendition) return;
      const loc = rendition.currentLocation();
      if (!loc || !loc.start || !loc.start.href) return;
      const idx = _findSpineIndex(loc.start.href);
      if (idx < 0 || idx >= book.spine.items.length - 1) return;
      rendition.display(book.spine.items[idx + 1].href);
    }

    function updateChapterNav() {
      const prevBtn = document.getElementById('statusPrevBtn');
      const nextBtn = document.getElementById('statusNextBtn');
      if (!book || !rendition) {
        if (prevBtn) prevBtn.disabled = true;
        if (nextBtn) nextBtn.disabled = true;
        return;
      }
      const loc = rendition.currentLocation();
      if (!loc || !loc.start || !loc.start.href) {
        if (prevBtn) prevBtn.disabled = true;
        if (nextBtn) nextBtn.disabled = true;
        return;
      }
      const idx = _findSpineIndex(loc.start.href);
      if (prevBtn) prevBtn.disabled = (idx <= 0);
      if (nextBtn) nextBtn.disabled = (idx < 0 || idx >= book.spine.items.length - 1);
    }

    function updateFontInfo() {
      document.getElementById('fontInfo').textContent = fontSize + '%';
    }

    function updateLineHeightInfo() {
      document.getElementById('lineHeightInfo').textContent = lineHeight;
    }

    // Apply interface settings to UI
    function applyInterfaceSettings() {
      // Apply toolbar color
      const header = document.querySelector('header');
      if (header) {
        header.style.background = `linear-gradient(135deg, ${interfaceSettings.toolbarColor} 0%, ${adjustColor(interfaceSettings.toolbarColor, -20)} 100%)`;
      }

      // Apply sidebar color
      const bookmarks = document.getElementById('bookmarks');
      if (bookmarks) {
        bookmarks.style.background = `${hexToRgba(interfaceSettings.sidebarColor, 0.98)}`;
      }

      // Apply nav buttons color and opacity
      const navButtons = document.querySelectorAll('.floating-nav-btn');
      navButtons.forEach(btn => {
        btn.style.background = hexToRgba(interfaceSettings.navButtonsColor, interfaceSettings.navOpacity);
      });

      // Apply user bookmarks drawer color
      const ubmDrawer = document.getElementById('userBookmarksDrawer');
      if (ubmDrawer) {
        const color = interfaceSettings.ubmDrawerColor || '#fffde7';
        ubmDrawer.style.setProperty('--ubm-bg', color);
        ubmDrawer.style.background = color;
      }
    }

    // Helper: Convert hex to rgba
    function hexToRgba(hex, alpha) {
      const r = parseInt(hex.slice(1, 3), 16);
      const g = parseInt(hex.slice(3, 5), 16);
      const b = parseInt(hex.slice(5, 7), 16);
      return `rgba(${r}, ${g}, ${b}, ${alpha})`;
    }

    // Helper: Adjust color brightness
    function adjustColor(hex, percent) {
      const num = parseInt(hex.slice(1), 16);
      const amt = Math.round(2.55 * percent);
      const R = (num >> 16) + amt;
      const G = (num >> 8 & 0x00FF) + amt;
      const B = (num & 0x0000FF) + amt;
      return '#' + (0x1000000 + (R < 255 ? R < 1 ? 0 : R : 255) * 0x10000 +
        (G < 255 ? G < 1 ? 0 : G : 255) * 0x100 +
        (B < 255 ? B < 1 ? 0 : B : 255))
        .toString(16).slice(1);
    }

