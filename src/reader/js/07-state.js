    // --- ORIGINAL READER LOGIC ---

    let book = null;
    let rendition = null;
    let fontSize = 100;
    let lineHeight = 1.2;
    let lineHeights = [1, 1.2, 1.4, 1.6, 1.8, 2.0];
    let scrollMode = false;
    let dualPageMode = false;
    let sidebarVisible = false;
    let currentTheme = 'normal';
    let currentLocation = null;
    let buttonZoom = 100; // Button zoom level: 100%, 200%, 300%

    // --- AUTO-SAVE & DISPLAY PROMPT STATE ---
    let _autoSaveTimer = null;
    let _lastAutoSavedCfi = null;
    let _lastNavigatedCfi = null;   // CFI from last real epub.js navigation (relocated event)
    let _lastSavedVisualState = null;
    var _dspTimer = null;

    // Interface customization settings
    let interfaceSettings = {
      toolbarColor: '#667eea',
      sidebarColor: '#ffffff',
      navButtonsColor: '#667eea',
      navOpacity: 0.7,
      ubmDrawerColor: '#fffde7'
    };

    const defaultInterfaceSettings = {
      toolbarColor: '#667eea',
      sidebarColor: '#ffffff',
      navButtonsColor: '#667eea',
      navOpacity: 0.7,
      ubmDrawerColor: '#fffde7'
    };

    // --- CURRENT BOOK TRACKING ---
    let currentBookId = null;
    let currentBookTitle = '';
    let _currentChapterName = ''; // tracked separately from DOM to avoid status-message pollution

    // --- COLLECTIONS ---
    let _collection = []; // [{id, type, src, alt, content, color, book, chapter, date}]

