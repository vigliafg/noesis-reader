
    /* ═══════════════════════════════════════════════════════
       HELP SYSTEM — banner firstRun, overlay shortcut, tooltip
       ═══════════════════════════════════════════════════════ */
    (function initHelpSystem() {

      /* ── Chiavi localStorage ── */
      var KEY_READER  = 'noesis-help-seen-reader';

      /* ── Helper: mostra banner la prima volta ── */
      function maybeShowBanner(seenKey, bannerId) {
        if (!localStorage.getItem(seenKey)) {
          var banner = document.getElementById(bannerId);
          if (banner) banner.classList.remove('hidden');
        }
      }

      /* ── Helper: chiudi banner e salva stato ── */
      function closeBanner(seenKey, bannerId) {
        localStorage.setItem(seenKey, '1');
        var banner = document.getElementById(bannerId);
        if (banner) banner.classList.add('hidden');
      }

      /* ── Helper: apri/chiudi overlay ── */
      function openOverlay(id) {
        var el = document.getElementById(id);
        if (el) el.classList.add('visible');
      }
      function closeOverlay(id) {
        var el = document.getElementById(id);
        if (el) el.classList.remove('visible');
      }

      /* ── Reader: banner primo avvio disabilitato ── */
      var readerView = document.getElementById('reader-view');

      /* ── Reader: pulsante ? ── */
      var readerHelpBtn = document.getElementById('readerHelpBtn');
      if (readerHelpBtn) {
        readerHelpBtn.addEventListener('click', function(e) {
          e.stopPropagation();
          openOverlay('readerHelpOverlay');
        });
      }

      /* ── Reader: chiudi overlay ── */
      var readerOverlayClose = document.getElementById('readerHelpOverlayClose');
      if (readerOverlayClose) {
        readerOverlayClose.addEventListener('click', function() {
          closeOverlay('readerHelpOverlay');
        });
      }
      var readerOverlay = document.getElementById('readerHelpOverlay');
      if (readerOverlay) {
        readerOverlay.addEventListener('click', function(e) {
          if (e.target === readerOverlay) closeOverlay('readerHelpOverlay');
        });
      }

      /* ── Reader: chiudi banner ── */
      var readerBannerClose = document.getElementById('readerBannerClose');
      if (readerBannerClose) {
        readerBannerClose.addEventListener('click', function() {
          closeBanner(KEY_READER, 'readerHelpBanner');
        });
      }

      /* ── Tastiera globale: ? apre overlay Reader ── */
      document.addEventListener('keydown', function(e) {
        if (e.key !== '?' || e.target.tagName === 'INPUT' || e.target.tagName === 'TEXTAREA') return;
        var readerVisible = readerView && !readerView.classList.contains('hidden');
        if (readerVisible) {
          var ro = document.getElementById('readerHelpOverlay');
          if (ro && ro.classList.contains('visible')) closeOverlay('readerHelpOverlay');
          else openOverlay('readerHelpOverlay');
        }
      });

      /* ── Library: banner primo avvio disabilitato ── */
      var KEY_LIBRARY = 'noesis-help-seen-library';
      var libBannerClose = document.getElementById('libBannerClose');
      if (libBannerClose) {
        libBannerClose.addEventListener('click', function() {
          localStorage.setItem(KEY_LIBRARY, '1');
          var b = document.getElementById('libHelpBanner');
          if (b) b.classList.add('hidden');
        });
      }

      /* ── Library: pulsante ? ── */
      var libHelpBtn = document.getElementById('libHelpBtn');
      if (libHelpBtn) {
        libHelpBtn.addEventListener('click', function(e) {
          e.stopPropagation();
          openOverlay('libHelpOverlay');
        });
      }

      /* ── Library: chiudi overlay ── */
      var libOverlayClose = document.getElementById('libHelpOverlayClose');
      if (libOverlayClose) {
        libOverlayClose.addEventListener('click', function() { closeOverlay('libHelpOverlay'); });
      }
      var libOverlay = document.getElementById('libHelpOverlay');
      if (libOverlay) {
        libOverlay.addEventListener('click', function(e) {
          if (e.target === libOverlay) closeOverlay('libHelpOverlay');
        });
      }

    })(); /* end initHelpSystem */
