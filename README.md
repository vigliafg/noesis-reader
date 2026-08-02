# Noesis Reader

A monolithic EPUB library and reader built as a single HTML file. Read, annotate, bookmark, extract EPUB chapters, and **translate pages using Chrome's built-in translation engine**.

> **Editing the code?** `index.html` and `noesis-editor.html` are **generated** — they're
> assembled from the pieces under `src/` by `npm run build`. Editing them directly does
> nothing lasting; your changes are overwritten by the next build. **Read
> [`src/README.md`](src/README.md) first.**
>
> This document describes how the application *works*. It points at source files
> (`src/reader/js/…`) rather than line numbers, because line numbers in a generated file go
> stale the moment anything above them changes — as every reference in this file previously
> had.

> **Primary browser: Google Chrome** (desktop and Android). The app is tested and optimized for Chrome, which provides the richest feature set including native page translation. Some features may be degraded in other browsers.

> **Disclaimer**: This software is provided for personal, educational, and research purposes. It is the user's sole responsibility to ensure that their use of this application — including but not limited to EPUB file acquisition, content reproduction, chapter extraction, and translation — complies with all applicable laws and regulations in their jurisdiction. The authors assume no liability for any misuse or legal violations arising from the use of this software.

> **Why not a PWA?** Installing as a PWA hides Chrome's browser UI — including the address bar and the three-dot menu where the **Translate** feature lives. Since this app relies on Chrome-native services (translation, printing, etc.), it is designed to run as a regular web page. Use the shortcuts below instead.

## How to use

Open `index.html` in Chrome. All data is stored locally in IndexedDB — nothing leaves your device.

### Add to desktop / home screen

| Platform | Method |
|----------|--------|
| **Desktop (Windows/Mac/Linux)** | Bookmark the page (`Ctrl+D` / `Cmd+D`), or drag the URL to your desktop as a shortcut |
| **Android** | Chrome menu → "Add to Home screen" **without** installing as app. Or bookmark the page (`⋮` → ☆) and access it from Chrome's bookmarks |
| **iOS** | Safari → Share → "Add to Home Screen" — this creates a web clip that opens in Safari with full browser UI |

### Self-host or use cloud

The app is a single static HTML file with CDN dependencies. Serve it anywhere:

- **Local**: open `index.html` directly in Chrome
- **LAN**: `python3 -m http.server 8000`
- **Cloud**: deploy to any static host (Cloudflare Pages, GitHub Pages, Netlify, Vercel, etc.)

## Table of Contents

- [Browser-Native Page Translation](#browser-native-page-translation)
- [Architecture Overview](#architecture-overview)
- [CDN Dependencies](#cdn-dependencies)
- [IndexedDB Storage](#indexeddb-storage)
- [Library View](#library-view)
- [Reader View](#reader-view)
- [Reader Menubar](#reader-menubar)
- [Display Menu (Accordion)](#display-menu-accordion)
- [Auto-Save System](#auto-save-system)
- [User Bookmarks System](#user-bookmarks-system)
- [Highlights &amp; Annotations](#highlights--annotations)
- [Chapter Extraction](#chapter-extraction)
- [Snapshot System](#snapshot-system)
- [Media Preview](#media-preview)
- [Print Support](#print-support)
- [Mobile Responsive](#mobile-responsive)
- [Help System](#help-system)
- [Interface Customization](#interface-customization)
- [Browser Compatibility](#browser-compatibility)

---

## Browser-Native Page Translation

Noesis Reader leverages **the browser's own translation engine** — no external APIs, no token limits, no configuration needed. When you load an EPUB, every page is a standard HTML document rendered inside an iframe. Chrome's built-in translation service (Google Translate) treats each page as translatable web content.

### How to translate an EPUB while reading

1. Open a book in the Reader view
2. Right-click anywhere on the page text → **"Translate to [your language]"**
3. Or use the Translate icon in the Chrome address bar
4. Chrome translates the current page and auto-translates subsequent pages as you navigate

### How the app protects your reading position during translation

Browser translation modifies the iframe DOM (it rewraps text nodes in `<font>` tags), which would normally cause epub.js to report wrong position CFIs. Noesis Reader detects translation state and prevents corruption:

```
Chrome adds classes to <html> during translation:
  translated-ltr  → left-to-right translation active
  translated-rtl  → right-to-left translation active
  translated      → generic translation attribute
```

**When translation is active**, the auto-save system **pauses itself** (`_isBrowserTranslated()`, src/reader/js/09-autosave.js) — it stops writing position updates to IndexedDB. This ensures that the pre-translation reading position (which is correct) is preserved. When translation ends, auto-save resumes automatically.

The Table of Contents is also marked with `translate="yes"` attributes so chapter titles get translated alongside the content.

> This feature relies on the browser's native `translated-ltr` / `translated-rtl` CSS classes on `<html>`, which are specific to Chromium-based browsers (Chrome, Edge, Brave, Opera, etc.).

---

## Architecture Overview

Noesis Reader is a single-page application with two main views that toggle via CSS `display`/`hidden` class switching:

- **Library View** (`#library-view`): Book management, import, display of extracted chapters and snapshots
- **Reader View** (`#reader-view`): Full EPUB reader with menubar, viewer iframe, TOC sidebar, status bar

View switching is handled by `showLibrary()` (src/reader/js/04-views.js) and `showReader()` (src/reader/js/04-views.js). The global `loadingOverlay` (`#loading-overlay`) provides visual feedback during async operations.

```javascript
// Key state variables
let book = null;           // epub.js Book instance
let rendition = null;      // epub.js Rendition instance
let fontSize = 100;        // Font size percentage
let lineHeight = 1.2;      // Line height multiplier
let scrollMode = false;    // Paginated vs scroll mode
let dualPageMode = false;  // Single vs dual page spread
let sidebarVisible = false;// TOC sidebar visibility
let currentTheme = 'normal';// Active reading theme key
let currentBookId = null;  // ID of the currently open book
let currentBookTitle = ''; // Title of currently open book
```

---

## CDN Dependencies

All loaded from jsDelivr CDN:

| Library | Version | URL |
|---------|---------|-----|
| Bootstrap Icons | 1.11.3 | `cdn.jsdelivr.net/npm/bootstrap-icons@1.11.3/font/bootstrap-icons.min.css` |
| JSZip | 3.10.1 | `cdn.jsdelivr.net/npm/jszip@3.10.1/dist/jszip.min.js` |
| epub.js | 0.3.93 | `cdn.jsdelivr.net/npm/epubjs@0.3.93/dist/epub.min.js` |



---

## IndexedDB Storage

Two databases:

### 1. EpubLibraryDB (`EpubLibraryDB`, version 1)

**Store**: `books` (keyPath: `'id'`)

Schema for each book record:
```
{
  id: string,          // Date.now().toString()
  title: string,        // From EPUB metadata
  author: string,       // From EPUB metadata
  data: ArrayBuffer,    // Raw EPUB file
  cover: string|null,   // Cover image as base64 data URL
  addedAt: number,      // Timestamp
  savedState: {         // Auto-saved reading state
    position: { cfi, href, timestamp },
    fontSize, lineHeight, theme, scrollMode,
    dualPageMode, buttonZoom,
    interface: { toolbarColor, sidebarColor, navButtonsColor, navOpacity, ubmDrawerColor },
    readerHighlights: [{ cfi, color }],
    savedAt
  },
  userBookmarks: [{     // User-created bookmarks
    id, chapter, preview, label, cfi, href, createdAt
  }]
}
```

Key functions: `openDB()` (src/reader/js/02-db.js), `saveBookToDB()` (src/reader/js/03-epub-library.js), `getAllBooks()` (src/reader/js/03-epub-library.js), `deleteBook()` (src/reader/js/03-epub-library.js).

### 2. noesisDB (`noesisDB`, version 1)

**Store**: `extractedChapters` (keyPath: `'chapterId'`)

Indexes: `bookName`, `chapterName`

Schema for each chapter record:
```
{
  chapterId: string,
  bookName: string,
  chapterName: string,
  createdAt: string (ISO),
  snapshots: [{
    snapshotId: string,
    createdAt: string (ISO),
    bookName: string,
    chapterName: string,
    description: string,    // e.g. "origin-20240101-120000"
    isOrigin: boolean,
    content: string         // Full HTML content
  }]
}
```

Key functions: `openNoesisDB()` (src/reader/js/02-db.js), `saveExtractedChapterToDB()` (src/reader/js/02-db.js), `getExtractedChapterFromDB()` (src/reader/js/02-db.js), `deleteExtractedChapterFromDB()` (src/reader/js/02-db.js), `deleteSnapshotFromDB()` (src/reader/js/02-db.js).

---

## Library View

### DOM Structure

```
#library-view
├── .library-header (sticky, gradient purple)
│   ├── .library-header-left (hamburger button)
│   └── .library-header-right
│       ├── #libraryInput (file input, hidden)
│       ├── #libAddBooksBtn → "ADD BOOKS"
│       ├── .lib-themes-dropdown
│       │   ├── #libThemesBtn → "THEMES"
│       │   └── .lib-themes-menu (Light / Dark)
│       ├── .lib-tools-dropdown
│       │   ├── #libToolsBtn → "TOOLS"
│       │   └── .lib-tools-menu (3 external links)
│       └── #libHelpBtn → "HELP"
├── #bookGrid.library-grid (book rows injected here)
└── .help-banner / .help-overlay
```

### Book Import

**Flow** (`libAddBooksBtn` click → `libraryInput.click()` → `change` event):

1. User clicks "ADD BOOKS" → triggers hidden file input
2. `saveBookToDB(file)` (src/reader/js/03-epub-library.js): 
   - Reads file as ArrayBuffer
   - Instantiates `ePub(arrayBuffer)` for metadata extraction
   - Extracts cover image via `book.coverUrl()` → fetches blob → converts to base64
   - Stores full record (data + metadata) in EpubLibraryDB
3. `loadLibraryBooks()` refreshes the book grid

### Book Listing

`loadLibraryBooks()` (src/reader/js/06-library-view.js) queries all books from EpubLibraryDB, sorts by `addedAt` descending, and renders each as a `.book-row`:

```
.book-row
├── .book-header
│   ├── .book-cover-thumb (clickable → open reader)
│   ├── .book-meta
│   │   ├── .book-meta-title (italic, 2-line clamp)
│   │   └── .book-meta-author (uppercase, small)
│   └── .book-actions
│       └── .book-delete-btn (trash icon)
└── .chapters-section (extracted chapters, if any)
```

Empty state: Shows centered message "Start by adding a book..." with book icon.

**Stats**: Lines 3956-3971 — each book row renders with cover (base64 image or Bootstrap icon), title, and author. 

**Delete book**: Confirmation dialog, then calls `deleteBook(id)` which removes the EpubLibraryDB record. Also resets `currentBookId` if the deleted book was open.

### Cover Extraction
During import (`saveBookToDB`):
1. `book.coverUrl()` fetches a blob URL from the EPUB
2. The blob is fetched via `fetch()`
3. Converted to base64 via `FileReader.readAsDataURL()`
4. Stored as `coverBase64` in the book record

### Library Themes

**Light/Dark toggle**: Managed via CSS custom properties. The `#library-view` element defines ~30 CSS variables for colors. Adding class `lib-dark` switches to dark theme values. Preference stored in `localStorage` under key `noesis-lib-theme`.

Theme variables include: background, header, text, import button, row borders, cover shadows, badges, chapter borders, snapshot indicators, delete buttons.

### Tools Dropdown

Positioned as a dropdown menu with three external links:
1. **noesis-epub-tools** (`https://noesis-epub-tools.vercel.app/`) — EPUB editing web app
2. **Pandoc Online** (`https://pandoc.org/app`) — Universal document converter
3. **Mozilla PDF Viewer** (`https://mozilla.github.io/pdf.js/web/viewer.html`) — PDF reader

All links open in new tabs.

### Help System (Library)

- **Help button** (`#libHelpBtn`, src/reader/index.template.html): Opens overlay with button reference
- **Help overlay** (`#libHelpOverlay`, src/reader/index.template.html): Full reference with groups for Adding/Opening Books, Extracted Chapters, Snapshots, and Interface
- **Help banner** (`#libHelpBanner`, src/reader/index.template.html): First-run banner with key action hints
- Close via Escape key, backdrop click, or close button

### Extracted Chapters Display

The `loadLibraryBooks()` function currently only renders book headers (the extracted chapters rendering may be handled externally). The DOM structure defines:
- `.chapters-section` — container with left padding
- `.chapter-entry` — each with left accent border
- `.chapter-name-btn` — clickable chapter title
- `.chapter-snap-count` — badge showing snapshot count
- `.chapter-delete-btn` — shown on hover
- Snapshot list with green dot for latest, date, description label

---

## Reader View

### DOM Structure

```
#reader-view
├── header (gradient, sticky)
│   ├── nav.reader-menubar (all items)
│   ├── #ctxAnnotatePopup (contextual highlight popup)
│   ├── Compatibility elements (hidden original toolbar buttons)
│   └── Typography/Theme/Interface popups (hidden, inline in Display menu)
├── #container
│   ├── #bookmarks (TOC sidebar)
│   └── #viewer (epub.js iframe target)
├── #floatingPrevBtn / #floatingNextBtn
├── #touchZonePrev / #touchZoneNext (mobile only)
├── #userBookmarksDrawer
├── #status (chapter nav status bar)
├── #saveToast
├── #displaySavePrompt
├── #readerMediaDialog
└── #readerMediaFullscreen
```

### Opening a Book

`openBookFromLibrary(bookData)` (src/reader/js/06-library-view.js):
1. Switches to Reader view via `showReader()`
2. Loads saved state from IndexedDB via `loadAndApplyBookState()`
3. Loads user bookmarks via `loadUserBookmarksFromDB()`
4. Syncs UI state (scroll mode button, dual page button, font info, line height)
5. Creates epub.js instance: `book = ePub(bookData.data)`
6. Calls `recreateRendition()` to create the reading iframe
7. Restores saved CFI position if available
8. Applies theme, renders TOC, starts auto-save timer
9. Shows/hides floating nav buttons and touch zones based on mode

### epub.js Rendition

`recreateRendition()` (src/reader/js/13-rendition.js):
- Destroys existing rendition and clears viewer
- Creates new rendition with:
  - `spread`: `'auto'` (dual page) or `'none'` (single page)
  - `flow`: `'scrolled'` or `'paginated'`
  - `manager`: `'default'` (avoiding continuous manager's scroll issues)
- Registers event handlers:
  - `linkClicked` → `navigateToHref()`
  - `relocated` → updates breadcrumb path via `findBreadcrumbInToc()`, tracks `_lastNavigatedCfi`
  - `selected` → stores `_readerPendingCfi`, highlights highlight button outline, shows contextual annotate popup
- Content hook: Injects inline styles for images, tables, padding (accounts for floating button width), CSS classes for highlight colors
- Restores saved highlights with 120ms delay
- Wraps tables in scrollable divs, attaches media tap handlers
- Attempts to restore position: CFI → href → currentLocation → start

### TOC Sidebar / Overlay

**Desktop**: `#bookmarks` is a fixed sidebar (280px width) positioned from header top to bottom. Toggle via `toggleSidebarBtn` → `sidebarVisible` flag. Slides in/out with CSS transition.

**Mobile** (≤768px): Becomes an overlay from the left edge (300px, max 85vw). Remounted as direct child of `#body` with forced inline styles for reliable visibility. Opened via edge swipe or hamburger → TOC item.

**TOC Rendering** (`renderBookmarksSimple()`, src/reader/js/14-toc.js):
- Recursive tree rendering with up to 3 levels
- Expandable items (▶/▼ indicators) for entries with subitems
- Click navigates via `navigateToHref()` and updates breadcrumb path
- Uses `book.loaded.navigation.toc` from epub.js

### Reading Modes

#### Paginated Mode (default)
- `flow: 'paginated'`, `manager: 'default'`
- Left/Right arrow keys navigate pages
- Floating nav buttons visible
- Touch zones visible on mobile
- `rendition.prev()` / `rendition.next()` for page turns

#### Scroll Mode
- `flow: 'scrolled'`, `manager: 'default'`
- Continuous vertical scroll within each spine item
- Floating nav buttons hidden
- Dual page disabled (button grayed)
- TOC navigation uses special handling: recreates rendition with `manager: 'default'` to prevent backward scroll issues

**Toggle**: Via Navigate dropdown in menubar, or via the old `navModePopover` on the legacy toolbar.
`_syncNavModeBtn()` (src/reader/js/18-dom-ready.js) syncs all UI elements. Mode change triggers `recreateRendition()`.

### Dual Page
Toggle via `dualPageBtn` (src/reader/js/18-dom-ready.js) or the single/dual buttons in Typography. Sets `dualPageMode` flag, changes `spread` to `'auto'` or `'none'`, triggers rendition recreation. Disabled in scroll mode.

### Font Size &amp; Line Height

- **Font size**: Range 50-200%, 1% steps via `fontPlus1`/`fontMinus1`/`fontReset`. Updates `fontSize` variable and calls `applyTheme()` to inject into CSS.
- **Line height**: Predefined steps `[1, 1.2, 1.4, 1.6, 1.8, 2.0]` via `lineHeightPlus`/`lineHeightMinus`/`lineHeightReset`.
- `updateFontInfo()` / `updateLineHeightInfo()` update the display values in the popup and accordion panels.

### Floating Nav Buttons

Two fixed buttons (`#floatingPrevBtn`, `#floatingNextBtn`) at left/right edges:
- 25px wide, 200px high, ~50% vertical center
- Purple gradient background with backdrop blur
- Fade out in scroll mode or when sidebar is open
- Opacity 0.7 → 1 on hover
- Scale to 0.95 on active
- Responsive sizing: 22px/180px at 768px, 20px/150px at 480px

### Status Bar &amp; Chapter Nav

`#status` bar at the bottom of reader view:
- **Left button** (`#statusPrevBtn`): Previous spine item (◀)
- **Center** (`#statusChapterName`): Breadcrumb path (e.g., "Part I → Chapter 1"), with hover tooltip showing full path
- **Right button** (`#statusNextBtn`): Next spine item (▶)
- Disabled state when at first/last chapter
- Mobile: enlarged to 44×44px for WCAG 2.1 compliance
- Spine-based navigation via `_findSpineIndex()` (src/reader/js/10-chapter-nav.js)

### Keyboard Shortcuts

| Key | Action |
|-----|--------|
| `←` / `→` | Previous / next page (paginated mode) |
| `?` | Toggle Help overlay (Reader view only) |
| `Escape` | Close hamburger drawer, TOC overlay, or all reader menus |

---

## Reader Menubar

Replaces the original toolbar buttons. Uses a flexbox nav with inline items:

| Item | ID | Behavior |
|------|-----|----------|
| **☰ Hamburger** | `#hamburgerBtn` | Mobile menu (visible ≤768px) |
| **Library** | `#rmbLibrary` | Returns to library view (triggers `backToLibraryBtn.click()`) |
| **TOC** | `#rmbToc` | Toggles sidebar (desktop) / overlay (mobile) |
| **Bookmarks** | `#rmbBookmarks` | Toggles user bookmarks drawer + badge count |
| **Display** | `#rmbDisplay` | Opens accordion menu (Typography/Themes/Interface) |
| **Navigate** | `#rmbNavigate` | Dropdown: Page Mode / Scroll Mode + current mode badge |
| **Annotate** | `#rmbAnnotate` | Applies/removes highlight at current selection + color dot indicator |
| **Extract** | `#rmbExtract` | Dropdown: Current chapter / Current + sublevels |
| **Help** | `#rmbHelp` | Opens keyboard shortcut overlay |

**Styling**: 
- `.rmb-item`: 18px horizontal padding, semitransparent white text, hover/active backgrounds
- `.rmb-active`: Increased opacity background for active state
- Color dot on Annotate item reflects current highlight color
- Navigate mode badge shows "Page" or "Scroll"

**Event handlers** (`initReaderMenubar`). Each menubar item delegates to the original hidden toolbar button or directly calls the relevant function. A MutationObserver syncs the `rmb-active` class on the Display menu trigger.

---

## Display Menu (Accordion)

Replaces the three separate popups (Typography, Themes, Interface). The menu is an accordion with three collapsible sections rendered inline.

**Structure**:
```
.display-menu
├── .display-section-header → "Typography"
│   └── .display-section-body (contains typography popup inline)
├── .display-sep
├── .display-section-header → "Themes"
│   └── .display-section-body (contains theme popup inline)
├── .display-sep
└── .display-section-header → "Interface"
    └── .display-section-body (contains interface popup inline)
```

**Behavior**:
- Only one section open at a time
- Opening a section auto-closes others
- Content is "embedded" (moved from popup DOM to section body) on first open
- When menu closes and settings changed, shows the display save prompt
- Chevron rotates 90° on active section

### Typography Section
Inline rendering of `typographyPopupMain`:
- **Font Size**: +/- buttons, reset, current value display (50-200%)
- **Line Height**: +/- buttons (steps), reset, current value (1-2.0)
- **Page View**: Single Page / Dual Page toggle buttons

### Themes Section
Inline rendering of `themePopupMain`. Contains 15 reading themes in 5 groups:

| Group | Themes |
|-------|--------|
| **White** | White (`#ffffff`), Soft White (`#fafafa`) |
| **Cream / Sepia** | Cream (`#fdf6e3`), Sepia (`#f4ecd8`), Parchment (`#eee5d3`) |
| **Light Gray** | Light Gray (`#e5e7eb`), Cool Gray (`#dfe3e8`), Warm Gray (`#e8e4df`) |
| **Medium Gray** | Mid Gray (`#b0b8c1`), Slate (`#94a3b8`) |
| **Dark / Black** | Dark Gray (`#4b5563`), Charcoal (`#374151`), Dark (`#1a1a1a`), Midnight (`#0f1117`), True Black (`#000000`) |

Theme application (`applyTheme()`, src/reader/js/12-theme.js):
- Registers `custom` theme on epub.js rendition with background, foreground, font-size, line-height
- Applies to `body` and all text elements (`p, div, span, li, h1-h6`)
- Uses `!important` to override EPUB's own styles
- Active swatch gets blue border + glow indicator

### Interface Section
Inline rendering of `interfacePopupMain`. Five settings:

| Setting | Input | Default |
|---------|-------|---------|
| Toolbar Color | Color picker | `#667eea` |
| Sidebar Color | Color picker | `#ffffff` |
| Nav Buttons Color | Color picker | `#667eea` |
| Nav Opacity | Range slider (0.1-1.0) | `0.7` |
| Bookmark Drawer Color | Color picker | `#fffde7` |

Each has a reset button. Values stored in `interfaceSettings` object and applied via `applyInterfaceSettings()` (src/reader/js/10-chapter-nav.js), which:
- Updates header gradient via CSS
- Sets sidebar background with alpha
- Applies color+opacity to floating nav buttons
- Sets `--ubm-bg` custom property on bookmarks drawer

---

## Auto-Save System

### Position Auto-Save
Interval timer (`startAutoSave()`, src/reader/js/09-autosave.js): Every 3 seconds:
1. Calls `_getCenterCfi()` (src/reader/js/09-autosave.js):
   - In scroll mode: uses `iframeDoc.elementFromPoint(centerX, centerY)` then `contents[0].cfiFromElement(el)` to get CFI at visual center
   - In paginated mode: uses `rendition.currentLocation().start.cfi`
2. Skips if CFI unchanged from last save
3. Skips if browser translation is active (`_isBrowserTranslated()`, src/reader/js/09-autosave.js) — detects `translated-ltr`/`translated-rtl` classes on `<html>`
4. Writes position-only (CFI + href + timestamp) to savedState via `savePositionOnly()` (src/reader/js/09-autosave.js)

### Visual Settings Save Prompt
When visual settings change (detected by `_snapshotVisualState()` comparing to `_lastSavedVisualState`):
- A prompt (`#displaySavePrompt`) slides up from the bottom
- Auto-dismisses after 8 seconds
- User can click "Save" to persist or "✕" to dismiss
- Save writes full visual state to IndexedDB via `saveVisualSettings()` (src/reader/js/09-autosave.js)

### Loading State
`loadAndApplyBookState()` (src/reader/js/09-autosave.js) reads `savedState` from the book record and restores:
- font size, line height, theme, scroll mode, dual page mode, sidebar visibility
- button zoom, interface settings, reader highlights
- Returns saved position (CFI) for restoration

### Visual State Snapshot
`_snapshotVisualState()` (src/reader/js/09-autosave.js) creates a JSON string of all display-relevant settings for dirty-checking. Compared against `_lastSavedVisualState` to determine if the "Save display settings?" prompt should appear.

---

## User Bookmarks System

### Storage
Bookmarks are stored in the `userBookmarks` field of the book record in EpubLibraryDB. In-memory array `userBookmarks` (src/reader/js/15-user-bookmarks.js) mirrors the DB.

### Bookmark Structure
```javascript
{
  id: "timestamp_random",
  chapter: "Chapter title from breadcrumb",
  preview: "~100 chars of text from the page",
  label: "User-provided optional label",
  cfi: "epubcfi(...)",    // CFI position
  href: "section.xhtml",   // Spine href
  createdAt: timestamp
}
```

### Creating a Bookmark
`createUserBookmark()` (src/reader/js/15-user-bookmarks.js):
1. Gets current CFI and href from rendition
2. Resolves chapter title from TOC breadcrumb via `findBreadcrumbInToc()`
3. Extracts ~100 chars of preview text: computes anchor offset from epub.js page position (`loc.start.displayed.page/total`), then takes 100 chars starting 400 chars after the anchor
4. Prompts for optional label (via `window.prompt()`)
5. Generates unique ID, inserts at start of array, saves to DB

### Drawer UI
- **Toggle**: `userBookmarksBtn` click
- **Slide animation**: Transform `translateY(-200%)` / `translateY(var(--ubm-header-height))` with cubic-bezier transition
- **Header**: "My Bookmarks" title, "New Bookmark" button, close button
- **List items**: Chapter title (truncated to 55 chars), preview text (2-line clamp), optional label, date
- **Click**: Navigates to bookmark's CFI or href, closes drawer
- **Delete**: Each item has an × button
- **Close**: Click-outside detection auto-closes drawer
- **Badge**: Count badge on the bookmarks button in the toolbar
- **Empty state**: "No bookmarks yet" with icon

---

## Highlights &amp; Annotations

### Color Selection
Three highlight colors + remove option:
- **Yellow** (`#ffeb3b`)
- **Green** (`#a5d6a7`)
- **Pink** (`#f8bbd9`)
- **Remove** (red × indication)

### Contextual Annotate Popup (v816-ctx)

When text is selected in the epub iframe, a contextual popup (`#ctxAnnotatePopup`, src/reader/index.template.html) appears near the selection:
- 4 color dots (yellow, green, pink, remove) in a small floating toolbar
- Positioned below or above the selection rect
- Background blurs when clicking outside
- Animated entry: `opacity 0→1`, `transform scale 0.92→1`

Implementation:
- `_showCtxAnnotatePopup()`: Computes position relative to iframe offset, shows popup near selection
- `_hideCtxAnnotatePopup()`: Hides with transition delay
- Clicking a color: Sets `currentReaderHighlightColor`, applies/removes highlight, updates indicator dots in menubar and hamburger menu

### Apply / Remove Flow
`applyReaderHighlight()` (src/reader/js/18-dom-ready.js):
1. Deduplicates: removes existing highlight at same CFI
2. Calls `rendition.annotations.highlight(cfi, {}, cb, cssClass, {fill, fill-opacity})`
3. Stores `{cfi, color}` in `readerHighlights` array
4. Clears iframe selection

`removeReaderHighlight()` (src/reader/js/18-dom-ready.js):
1. Calls `rendition.annotations.remove(cfi, 'highlight')`
2. Filters highlight from array

### Storage &amp; Restoration
- Highlights stored in `savedState.readerHighlights` (saved with visual settings)
- Restored on rendition creation via content hook: iterates `readerHighlights` array, applies each via `annotations.highlight()` with appropriate CSS class

### CSS Classes
- `.epub-hl-yellow`, `.epub-hl-green`, `.epub-hl-pink` styled in the injected iframe stylesheet
- Button in toolbar gets color class (`hl-yellow`, `hl-green`, `hl-pink`, `hl-remove`) for visual feedback

---

## Chapter Extraction

Two extraction modes available via the Extract dropdown in both menubar and legacy toolbar.

### Single Chapter

`extractCurrentChapter()` (src/reader/js/11-chapter-extract.js):
1. Gets current location from rendition
2. Resolves spine item and finds title via TOC
3. Loads the section content, clones the DOM
4. **Image processing**:
   - Iterates all `<img>` elements
   - Skips already-base64 images
   - For blob/http images: fetches and converts
   - For relative paths: resolves via `findAndLoadImage()` (src/reader/js/11-chapter-extract.js) which searches JSZip archive using path resolution (handles `..`, `.`, absolute/relative paths)
   - Detects MIME type from magic bytes (PNG, GIF, JPEG, WebP, SVG)
   - Converts ArrayBuffer to base64 in 32KB chunks
   - Replaces `src` attribute with `data:...` URL
5. **Style processing**:
   - Extracts all `<style>` elements
   - Resolves and fetches linked stylesheets from archive
   - Adds computed body font family
6. **Output generation**:
   - Generates clean HTML via `_generateCleanHTML()` (src/reader/js/05-extract-export.js) with optional meta tags
   - Creates chapter record in noesisDB with `origin-<timestamp>` snapshot
   - Auto-downloads two files (1.5s delay between them):
     - `noesis-extract-<Book>__<Chapter>__<timestamp>.html` (no meta, for offline reading)
     - `noesis-origin-<Book>__<Chapter>__<timestamp>.html` (with meta tags, reimportable)

### Current + Sublevels

`extractMultipleSections()` (src/reader/js/11-chapter-extract.js):
1. Uses `collectAllSubchapters()` (src/reader/js/11-chapter-extract.js) to recursively collect all TOC entries from the current node downward
2. Iterates each entry, loads section, clones DOM
3. Processes images the same way (with embedded base64)
4. Extracts styles from first section only (shared across all)
5. Concatenates all section HTML with `<h2>` dividers
6. Saves as a single chapter record in noesisDB
7. Auto-downloads the extract/origin HTML pair

### Auto-Download
`_autoDownloadHTML()` (src/reader/js/05-extract-export.js): Creates a Blob URL, programmatically clicks a hidden `<a>` element, cleans up after 8 seconds. No user dialog — files save directly to default download location.

### Helper: findAndLoadImage
`findAndLoadImage()` (src/reader/js/11-chapter-extract.js): Resolves image paths by trying multiple strategies:
1. Path relative to section directory
2. Normalized path (without leading `/`)
3. Absolute path
4. Original src
5. Filename-only matching in archive

Uses JSZip for EPUB archive access, with fallback to `book.archive.request()` for CDN version.

---

## Snapshot System

Each extracted chapter has a `snapshots` array in the `noesisDB` database. The initial extraction creates an "origin" snapshot (`isOrigin: true`) containing the full chapter HTML content.

**Snapshot structure**:
```javascript
{
  snapshotId: "snap_<timestamp>_<random>",
  createdAt: ISO datetime,
  bookName: string,
  chapterName: string,
  description: "origin-<YYYYMMDD-HHmmss>" (or custom),
  isOrigin: boolean,
  content: string  // Full HTML with embedded images
}
```

**Operations**:
- `saveExtractedChapterToDB()` (src/reader/js/02-db.js): Upserts a chapter record with snapshots
- `deleteSnapshotFromDB()` (src/reader/js/02-db.js): Removes a single snapshot from a chapter's array
- `deleteExtractedChapterFromDB()` (src/reader/js/02-db.js): Removes entire chapter record
- `getExtractedChapterFromDB()` (src/reader/js/02-db.js): Retrieves a chapter record by ID

The chapter records are displayed in the library view per book, with snapshot count badges and individual snapshot rows.

---

## Media Preview

### Images &amp; Tables Fullscreen

The reader supports tapping/clicking on images and tables in the epub content for a fullscreen preview.

**How it works**:
1. Content hook injects event handlers into the epub iframe
2. On image/table tap, sends a `postMessage` to the parent window with `{epubMediaTap: true, type, data}`
3. Parent window listener receives the message and shows the `#readerMediaDialog`
4. Dialog has "Preview" and "Exit" buttons
5. "Preview" opens the `#readerMediaFullscreen` overlay

**Features**:
- Images: displayed full-width, max 75vh
- Tables: rendered in a white scrollable container
- Caption shown below content
- Close via × button, click outside, or Escape key
- Mobile touch handling: contextmenu prevented, `touchstart`/`touchend` with move detection
- User-select disabled on images

---

## Print Support

Print handler:

**`beforeprint` event**:
1. Finds all iframes in the viewer
2. Collects their `body.innerHTML` along with `<style>` tags from their `<head>`
3. Strips epub.js column-pagination rules that would clip content: removes `column-*` and `transform-*` CSS
4. Injects into `#reader-print-container` (hidden during normal view)

**CSS**:
- In `@media print`: hides `#library-view` and `#reader-view`, shows `#reader-print-container`
- Applies system font, max-width 900px, centered, with padding
- Line height 1.6

**`afterprint` event**: Removes the print container from DOM.

---

## Mobile Responsive

### Breakpoints
- **≤768px**: Tablet/mobile layout
- **≤480px**: Smartphone optimizations

### Hamburger Menu
- **`#hamburgerBtn`** (reader) and **`#hamburgerBtnLib`** (library): Visible only ≤768px
- Opens `#hamburgerDrawer` (280px, max 85vw) sliding from left
- **Context-aware items**: `.hmb-lib` shown in library, `.hmb-rdr` shown in reader, no-class items shown in both
- Items map to existing menubar/header button functionality
- Backdrop (`#mobileOverlayBackdrop`) appears behind all overlays
- Close via × button, backdrop click, Escape key, or item selection
- Dropdown items (Display, Navigate, Annotate, Extract): temporarily show parent wrapper on mobile to render the dropdown

### TOC Overlay
- On mobile (≤768px): TOC remounts as direct child of `<body>` for reliable z-index/visibility
- Full-height overlay from left edge, 300px wide with shadow
- Opened via TOC menubar item, hamburger → TOC, or edge swipe
- Open/close methods: `openTocOverlay()` / `closeTocOverlay()`
- Restoration of original DOM position on close

### Mobile Touch Zones
- Two invisible zones at left/right edges of screen, displayed only on mobile
- 12vw wide, 70vh tall, centered vertically
- Chevron indicators with subtle border styling
- **Behavior**:
  - Ignore if text is selected (allow copy/paste)
  - Only active in paginated mode with sidebar closed
  - 350ms debounce to prevent rapid double-taps
  - Visual tap feedback: gradient glow background + chevron color change
  - Previous: left zone, Next: right zone
- Listen on both `click` and `touchend` events

### Swipe Navigation
- Initialized after rendition is ready (monkey-patches `openBookFromLibrary`)
- Implemented on the `#viewer` element
- **Touch tracking**: `touchstart` records position/time, `touchmove` cancels if vertical scroll detected, `touchend` evaluates
- **Edge swipe** (touch starts ≤40px from left edge, swipe right >50px): Opens TOC overlay
- **Non-edge swipe**: Previous (right swipe >50px) / Next (left swipe >50px)
- Requirements: swipe duration ≤400ms, minimum distance 50px, no text selection active

### Library Mobile
- Header buttons hidden: `#libThemesBtn`, `#libToolsBtn`, `#libHelpBtn` → accessible via hamburger
- Library theme toggle options available in hamburger
- Book cards: smaller covers (44-52px), adjusted padding

### General Mobile
- Touch targets enlarged to ≥44px for WCAG 2.1 (via `@media (pointer: coarse)`)
- `touch-action: manipulation` on all elements
- Floating nav buttons hidden (replaced by touch zones)
- Reader header hides title elements on small screens
- Resize handler: closes all drawers when returning to desktop width
- Escape key closes all drawers and menus

---

## Help System

Three-tier help system:

### 1. Tooltips (`[data-tip]`)
Available on toolbar/menubar buttons. CSS-only via `::after` pseudo-elements with delayed appearance (0.55s hover). Dark background, white text, max-width 220px. `[data-tip-down]` variant for buttons at the top of the screen.

### 2. First-Run Banners
Both library and reader have welcome banners that appear on first visit (controlled by `localStorage` keys `noesis-help-seen-library` and `noesis-help-seen-reader`). Currently disabled (banners stay hidden permanently). Banners include:
- Key action hints styled as steps
- Close button to dismiss permanently

### 3. Help Overlays
Dark-themed fullscreen overlays with:
- **Library overlay** (`#libHelpOverlay`): Button reference with groups for Adding/Opening Books, Extracted Chapters, Snapshots, Interface
- **Reader overlay** (`#readerHelpOverlay`): Button reference with groups for Navigation/View, Appearance/Reading, Saving/Extraction, Keyboard shortcuts
- Close via × button, background click, or Escape key
- Opened via HELP button or `?` key (reader only)

---

## Interface Customization

Five customizable interface settings stored in `interfaceSettings` object:

| Setting | Key | Default | Controls |
|---------|-----|---------|----------|
| Toolbar Color | `toolbarColor` | `#667eea` | Header gradient (with -20 brightness variant for bottom) |
| Sidebar Color | `sidebarColor` | `#ffffff` | TOC sidebar background (at 98% opacity) |
| Nav Buttons Color | `navButtonsColor` | `#667eea` | Floating nav button background |
| Nav Opacity | `navOpacity` | `0.7` | Floating nav button opacity (combined with color via `hexToRgba`) |
| Bookmark Drawer Color | `ubmDrawerColor` | `#fffde7` | CSS custom property `--ubm-bg` on drawer |

**Application** (`applyInterfaceSettings()`, src/reader/js/10-chapter-nav.js):
- Sets `header.style.background = linear-gradient(135deg, toolbarColor, adjustColor(toolbarColor, -20))`
- Sets `#bookmarks.style.background = hexToRgba(sidebarColor, 0.98)`
- Applies color + opacity to all `.floating-nav-btn` elements
- Sets `#userBookmarksDrawer` background and `--ubm-bg` custom property

**Utility functions**:
- `hexToRgba(hex, alpha)` (src/reader/js/10-chapter-nav.js): Parses hex to `rgba(r,g,b,a)`
- `adjustColor(hex, percent)` (src/reader/js/10-chapter-nav.js): Brightens/darkens a hex color by percentage

Settings are persisted in `savedState.interface` and restored on book open.

---

## Data Flow Summary

```
                 ┌──────────────────────────┐
                 │     EpubLibraryDB (IDB)   │
                 │  store: books            │
                 │  ├── data (ArrayBuffer)  │
                 │  ├── savedState          │
                 │  │   ├── position (CFI)  │
                 │  │   ├── visual settings │
                 │  │   └── highlights[]    │
                 │  └── userBookmarks[]     │
                 └──────────────────────────┘
                           ↕
┌─────────────┐    ┌─────────────┐    ┌──────────────┐
│ Library View │───▶│ Reader View │───▶│ noesisDB     │
│ - Import     │    │ - epub.js   │    │ - chapters   │
│ - Browse     │    │ - Rendition │    │ - snapshots   │
│ - Delete     │    │ - Auto-save │    └──────────────┘
│ - Themes     │    │ - Bookmarks │
└─────────────┘    │ - Highlights│
                   │ - Extract   │
                   └─────────────┘
```

1. **Import**: File → ArrayBuffer → epub.js metadata → base64 cover → `saveBookToDB()` → EpubLibraryDB
2. **Open**: DB read → `loadAndApplyBookState()` → epub.js instantiation → `recreateRendition()` → restore position
3. **Read**: epub.js renders in iframe → `relocated` fires → auto-save timer writes position CFI every 3s
4. **Customize**: Display changes → `_showDisplaySavePrompt()` → user saves → `saveVisualSettings()` → DB update
5. **Bookmark**: Current position → TOC lookup → preview extract → `saveUserBookmarksToDB()`
6. **Highlight**: Selection → CFI from epub.js → `applyReaderHighlight()` → annotations API → saved in state
7. **Extract**: Current spine item → load section → process images (base64) → extract styles → `saveExtractedChapterToDB()` → auto-download HTML pair

---

## Browser recommendation

Use **Google Chrome** (desktop or Android). The app relies on Chrome-native services:

- **Built-in page translation** (right-click → Translate). The app detects translation state and protects your reading position during translation.
- **IndexedDB** for reliable local storage of books, bookmarks, and reading state.
- **CSS `backdrop-filter`** for frosted-glass UI effects (header, floating nav buttons, bookmark drawer).

Other Chromium browsers (Edge, Brave, Opera) also work. **Firefox** works for basic reading but lacks built-in translation. **Safari** has partial support — epub.js rendering may be inconsistent and IndexedDB storage is more restricted.

> **Do not install as a PWA/app.** PWA installation removes Chrome's browser UI (address bar, three-dot menu), blocking access to the **Translate** feature and other Chrome-native services. Use bookmarks or desktop shortcuts instead.
