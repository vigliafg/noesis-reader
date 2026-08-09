# Project instructions for opencode

## Source layout — read this first

`index.html` and `noesis-editor.html` in the repo root are **generated build output. Never
edit them directly** — edits there are overwritten by the next build. The real source is
split into readable pieces under `src/`:

- `src/reader/` → builds to `index.html`; `src/editor/` → builds to `noesis-editor.html`
- each has `index.template.html` (page skeleton + placeholder tokens), `css/`, `js/`, and
  the editor also has `vendor/` (jQuery, Summernote, Turndown, JSZip, html-docx-js)
- files in `css/`/`js/` are concatenated in filename order — that's what the `NN-` prefixes
  are for, and reordering them can break things

Build with `npm run build`, or `npm run watch` to rebuild on every save. Both need only
plain Node, no dependencies.

**After every change, run `npm run check`** (~2s): it builds, verifies each part file
parses/balances on its own, and verifies every referenced name actually exists — that last
one catches typo'd identifiers and cross-file scope mistakes that otherwise surface as a
silently dead button. Then `npm test` (~3 min) for the two Puppeteer suites; it starts its
own server on a free port, so it always tests this checkout.

**See `src/README.md`** for the full explanation, including why the output has to stay a
single self-contained file and how to verify a pure code move (rebuild → `git diff` on the
two `.html` files must be empty).

Line numbers quoted anywhere below refer to the *generated* `index.html` and are only
useful for reading, never for editing — find the code in `src/` instead.

## Mirror changes to noesis-multi

This repository (`noesis-reader`) is the source of truth for the core application code (`index.html`).
The parent repository `/home/vigliafg/Documenti/GitHub/noesis-multi/` contains variant copies
of `index.html` that must be kept in sync.

### File mapping

When you modify the reader source (`src/reader/`, i.e. what builds into `index.html`),
rebuild first, then apply the same changes to **all** of these files in `noesis-multi`
(those copies are still monolithic hand-maintained files, so the edits go into them
directly):

| Source (noesis-reader) | Targets (noesis-multi) |
|---|---|
| `index.html` | `noesis816.html` |
| `index.html` | `noesis816-full.html` |
| `index.html` | `noesis816-reader.html` |
| `index.html` | `noesis816-full-reader.html` |

### Rules

1. After each batch of changes to `index.html`, apply the **identical** edits (`oldString`/`newString`) to all four target files in `noesis-multi`.
2. After mirroring, commit and push changes in **both** repositories:
   - `noesis-reader` (current repo)
   - `noesis-multi` (parent repo)
3. Use the same commit message for both repos.

## Test Infrastructure

### Overview

The project uses **Puppeteer** (Chrome DevTools Protocol) for automated browser testing.
Puppeteer is a local dependency (`npm install`), so no `NODE_PATH` is needed.

### Prerequisites

- Chrome: `/usr/bin/google-chrome`
- `npm install` (installs Puppeteer into `./node_modules`)
- HTTP server: `python3 -m http.server 8765 --bind 127.0.0.1` serving from project root
- `test.epub`: 64MB medical textbook with 508 spine items (gitignored, must be present locally)

### Quick Start

```bash
# 1. Build first — the tests run against the generated index.html / noesis-editor.html
npm run build

# 2. Start HTTP server (if not already running), from the repo root
setsid python3 -m http.server 8765 --bind 127.0.0.1 &>/tmp/http8765.log &

# 3. Verify server
curl -s -o /dev/null -w '%{http_code}' http://127.0.0.1:8765/index.html  # should return 200

# 4. Run both suites (baseline: 31/31 and 140/140 passing, ~3 min total)
npm test
```

`npm test` starts its own server, so steps 2–3 above are only needed if you want to poke at
the page by hand. Beware: if another copy of this project is already serving on port 8765,
running a suite directly (`node test_e2e_complete.js`) will test *that* copy, not yours —
which has produced convincing-looking passes for code that was never loaded. Use `npm test`.

### Debug Mode (`?debug=1`)

Adding `?debug=1` to the URL auto-loads `test.epub` without the file picker:
- `fetch('test.epub')` → creates synthetic `File` object → `saveBookToDB(file)` → `openBookFromLibrary(bookRecord)`
- The reader opens automatically in ~6 seconds
- **No effect in production**: condition is `if (new URL(location.href).searchParams.get('debug') === '1')`, skipped entirely without the flag

### test.epub Structure

- 508 spine items (`book.spine.items[]`)
- Chapter 26 "Pain" is at **spine index 44** (0-based)
  - 10 images, 9 tables, rich text content
  - h1: "26: Pain"
  - Use `rendition.display(book.spine.items[44].href)` to navigate there

To find a chapter by name, scan the spine:
```javascript
await page.evaluate(idx => {
  if (rendition && book.spine.items[idx]) {
    rendition.display(book.spine.items[idx].href);
  }
}, index);
// Wait 3s, then check iframe h1 text
```

### Writing Puppeteer Tests — Key Patterns

#### 1. Always re-acquire iframe after navigation
After `rendition.display()`, the EPUB iframe is reloaded. The old `contentFrame()` reference is stale:
```javascript
// WRONG — frame is stale after rendition.display()
const frame = await iframeEl.contentFrame();
await page.evaluate(() => rendition.display(...));
// frame still points to old content!

// CORRECT — re-acquire after navigation
await page.evaluate(() => rendition.display(...));
await new Promise(r => setTimeout(r, 5000));
const iframeEl = await page.$('#viewer iframe');
const frame = await iframeEl.contentFrame();
```

#### 2. Selectors reference

| Element | Selector | Notes |
|---|---|---|
| Reader view | `#reader-view` | Visible when EPUB is open |
| EPUB iframe | `#viewer iframe` | Content accessed via `contentFrame()` |
| Media dialog | `#readerMediaDialog` | Add `.visible` class check |
| Preview button | `#readerMdPreviewBtn` | **ID, not class!** |
| Exit/Close button | `#readerMdExitBtn` | **ID, not class!** |
| Fullscreen overlay | `#readerMediaFullscreen` | Add `.visible` class check |
| Collect button | `#readerFsCollect` | In fullscreen overlay toolbar |
| Close fullscreen | `#readerFsClose` | ✕ button |
| Collection badge | `#collBadge` | In reader toolbar |
| Collection drawer | `#collectionDrawer` | Add `.coll-open` class check |
| Hamburger badge | `#hmbCollBadge` | Mobile menu |
| Highlight popup | `#ctxAnnotatePopup` | `style.display !== 'none'` to check |
| Color buttons | `#ctxAnnotatePopup .ctx-annotate-option[data-color]` | yellow/green/pink |
| Preview in popup | `#ctxAnnotatePopup .ctx-preview-option` | 🔍 button |

#### 3. Checking visibility
Dialog and overlay use CSS classes, not display property:
```javascript
const dialog = await page.$('#readerMediaDialog');
const visible = dialog ? await page.evaluate(el => el.classList.contains('visible'), dialog) : false;

const fsOverlay = await page.$('#readerMediaFullscreen');
const fsVisible = fsOverlay ? await page.evaluate(el => el.classList.contains('visible'), fsOverlay) : false;
```

#### 4. T3 Highlight — special handling

The `#ctxAnnotatePopup` is triggered by epub.js `rendition.on('selected')` event, NOT by native browser text selection. Puppeteer cannot trigger this via `click({clickCount:3})`.

**Solution**: Call `window._showMediaDialog('text', { text, color })` directly — this is exactly what the 🔍 button does (line 8915 in index.html).

```javascript
await page.evaluate(() => {
  window._showMediaDialog('text', {
    text: 'Sample highlighted text for collection testing',
    color: 'yellow'
  });
});
```

#### 5. Helper function for collect flow
```javascript
async function clickPreviewAndCollect(page, testName, expectedBadge) {
  await new Promise(r => setTimeout(r, 1200));
  const previewBtn = await page.$('#readerMdPreviewBtn');
  if (!previewBtn) return { ok: false, reason: 'Preview button not found' };

  await previewBtn.click();
  await new Promise(r => setTimeout(r, 1500));

  const fsOverlay = await page.$('#readerMediaFullscreen');
  const fsVisible = fsOverlay ? await page.evaluate(el => el.classList.contains('visible'), fsOverlay) : false;
  if (!fsVisible) return { ok: false, reason: 'Fullscreen not visible' };

  const collectBtn = await page.$('#readerFsCollect');
  if (!collectBtn) return { ok: false, reason: 'Collect button not found' };
  await collectBtn.click();
  await new Promise(r => setTimeout(r, 1200));

  const badge = await page.$('#collBadge');
  const badgeText = badge ? await page.evaluate(el => el.textContent, badge) : '';
  return { ok: badgeText === String(expectedBadge), badgeText, expected: expectedBadge };
}
```

#### 6. Console error filtering
Ignore these known harmless messages:
- `"Failed to load resource: ... 404"` — missing favicon/resource files
- `"Blocked script execution in 'about:srcdoc'"` — sandboxed iframe warning
- `"slider-vertical"` — browser CSS compatibility warning

### Test Script: `test_collection_T1T3.js`

Located in project root. Tests T1 (image), T2 (table), T3 (highlight) collection workflow.

**Flow:**
1. Navigate to `http://127.0.0.1:8765/index.html?debug=1`
2. Wait for EPUB auto-load (~6s)
3. Navigate to chapter 26 "Pain" via `rendition.display(spine[44])`
4. T1: Click image → dialog → Preview → fullscreen → Collect → verify badge=1
5. T2: Click table → dialog → Preview → fullscreen → Collect → verify badge=2
6. T3: Call `_showMediaDialog('text',...)` → dialog → Preview → fullscreen → Collect → verify badge=3
7. Report results + console errors

**Run:**
```bash
NODE_PATH=/home/vigliafg/.nvm/versions/node/v24.18.0/lib/node_modules \
  node test_collection_T1T3.js
```

### Test Script: `test_W2_deduplica.js`

Tests W2 deduplication fix (14 tests): same image/table collected twice → badge stays 1/2, same text+color blocked, different color = new chunk.

**Flow:**
1. Load reader + navigate to chapter 26
2. Collect image → badge=1. Collect same image → badge still 1 (blocked)
3. Collect table → badge=2. Collect same table → badge still 2 (blocked)
4. Text dedup via `window._showMediaDialog('text', ...)` → Preview → Collect
   - Same text+color → blocked
   - Different color → added as new chunk

### Test Script: `test_W3_selezione.js`

Tests W3 checkbox selection persistence (20 tests): selection survives filter changes.

**Flow:**
1. Collect image + table (2 chunks)
2. Open drawer, check both checkboxes → "2 selected"
3. Filter → Images: 1 visible, 1 checked ✅
4. Filter → Tables: 1 visible, 1 checked ✅
5. Back to All: 2 visible, 2 checked ✅
6. Filter → Text (no text chunks): 0 visible, 0 checked
7. Back to All: 2 visible, 2 checked ✅ (restored even after empty filter)

### Critical Pattern: cb.checked vs cb.click()

**`cb.checked = true` does NOT fire the `change` event.** This means:
- In **test scripts**: use `cb.click()` to toggle checkboxes (fires change → updates `_checkedChunkIds`)
- In **Select All/Deselect handlers**: update `_checkedChunkIds` explicitly alongside setting `cb.checked`

```javascript
// WRONG in tests — _checkedChunkIds not updated
await page.evaluate(() => {
  document.querySelectorAll('.coll-checkbox input').forEach(cb => cb.checked = true);
});

// CORRECT in tests
await page.evaluate(() => {
  document.querySelectorAll('.coll-checkbox input').forEach(cb => { if (!cb.checked) cb.click(); });
});

// CORRECT in Select All handler
cb.checked = true;
var item = cb.closest('.coll-item');
if (item) _checkedChunkIds[item.dataset.chunkId] = true;
```

### W3 Architecture: _checkedChunkIds

Module-level persistent object (not DOM query) for checkbox state:

```
var _checkedChunkIds = {};   // Defined alongside _collFilterType

// On checkbox change:
if (this.checked) _checkedChunkIds[c.id] = true;
else delete _checkedChunkIds[c.id];

// On re-render:
cb.checked = !!_checkedChunkIds[c.id];

// Reset on:
// - _openCollectionDrawer(): _checkedChunkIds = {};
// - _clearCollection(): _checkedChunkIds = {};
```

This survives any number of filter changes because IDs of hidden checkboxes are preserved in the object even when their DOM elements don't exist.

### Dialog Handling in Puppeteer

**prompt() / confirm() destabilize the page** — after a native dialog, subsequent `page.click()` calls may fail silently.

**Solution for export/import tests**: use `page.evaluate()` to call JS functions directly, bypassing DOM clicks:
```javascript
// Instead of clicking Export button → dialog → handler
await page.evaluate(() => {
  _exportCollectionJSON();  // Direct call, no DOM interaction needed
});
```

**General dialog handler**: register once at page creation:
```javascript
page.on('dialog', async dialog => { await dialog.dismiss(); });
```

### Server Startup

The HTTP server must be running on port 8765 before any test script. If it hangs or the port is busy:

```bash
# Kill any process on port 8765
fuser -k 8765/tcp

# Start server (detached)
setsid python3 -m http.server 8765 -d /home/vigliafg/Documenti/GitHub/noesis-reader > /dev/null 2>&1 &

# Verify
curl -s -o /dev/null -w '%{http_code}' http://127.0.0.1:8765/index.html
# Expected: 200
```

### Known Issues

| Issue | Impact | Workaround |
|---|---|---|
| `browser-use` agent has internal bugs (`wait_for`, `upload_file`) | Cannot use for automated tests | Use Puppeteer directly |
| epub.js `selected` event not triggered by Puppeteer | Highlight popup won't appear | Call `window._showMediaDialog()` directly |
| `contentFrame()` stale after navigation | Wrong/no content in iframe | Re-acquire iframe + frame after `rendition.display()` |
| `test.epub` first page is cover (no tables/text) | T2/T3 skip on default load | Navigate to chapter 26 "Pain" (spine[44]) |
| `cb.checked = true` doesn't fire `change` event | `_checkedChunkIds` not updated | Use `cb.click()` in tests, update `_checkedChunkIds` explicitly in Select All |
| `prompt()`/`confirm()` destabilize Puppeteer page | Subsequent DOM clicks fail silently | Use `page.evaluate()` to call JS functions directly |
| Server port 8765 can hang | Tests time out | `fuser -k 8765/tcp` then restart with `setsid` |
| `page.reload()` with debug mode = new book instance | Collection lost in persist tests | Use Back to Library + re-open same book instead |

## Future Features / Roadmap

Features planned for future implementation. When the user asks to implement one of these,
refer to this section for the technical approach and the relevant source files.

### FR1 — Custom viewport themes (foreground + background color pickers)

**Goal**: Let the user create fully custom reading themes by picking a background color
and a foreground (text) color, beyond the 15 presets already in `THEME_COLORS`.

**Source files**: `src/reader/js/12-theme.js` (theme definitions, `THEME_COLORS`,
`THEME_GROUPS`, `applyTheme`), `src/reader/css/06-theme-picker.css` (popup styling),
`src/reader/index.template.html` (popup markup).

**Implementation plan**:
1. Add a "Custom" group at the bottom of `THEME_GROUPS` in `12-theme.js`, with a single
   entry `custom: { bg: '#...', fg: '#...', label: 'Custom', group: 'Custom' }`.
2. Add two `<input type="color">` pickers inside the theme popup (`#themePopupMain`), in
   the custom group section: one for background (`--custom-bg`), one for text
   (`--custom-fg`). Store values in `localStorage` (`noesis-custom-theme-bg`,
   `noesis-custom-theme-fg`).
3. On color change, update `THEME_COLORS.custom.bg` / `.fg` and call `applyTheme()`.
4. Persist: on page load, read from localStorage and restore the custom colors. If no
   saved custom theme exists, default to a reasonable pair (e.g. `#fffde7` / `#1a1a1a`).
5. Add tests in `test/test_e2e_complete.js` (new group after S52): verify color pickers
   exist, change colors, verify `applyTheme` is triggered, verify localStorage persistence.

### FR2 — Custom foreground color for UI elements (Display/Interface section)

**Goal**: In the Interface settings panel (`#interfacePopupMain`), currently only
background colors can be changed (toolbar, sidebar, nav buttons, status bar, bookmark
drawer). Add foreground (text) color controls for each of these elements.

**Source files**: `src/reader/js/10-chapter-nav.js` (`applyInterfaceSettings`,
`interfaceSettings`, `defaultInterfaceSettings`), `src/reader/css/07-typography.css`
(interface popup styling), `src/reader/index.template.html` (color pickers markup).

**Implementation plan**:
1. Extend `interfaceSettings` (in `07-state.js`) with `fg` counterparts:
   `toolbarFgColor`, `sidebarFgColor`, `navButtonsFgColor`, `statusBarFgColor`.
   Same for `defaultInterfaceSettings`.
2. Add a second `<input type="color">` next to each existing background picker in
   `index.template.html`, labeled "Text" or with a text-color icon.
3. In `applyInterfaceSettings()`, apply the foreground color via `style.color` on the
   relevant elements (header, bookmarks, nav buttons, status bar).
4. Persist in `saveVisualSettings()` / `loadAndApplyBookState()` (already serializes
   `interfaceSettings` via spread, so new keys are automatically included).
5. Add tests: verify foreground pickers exist, change value, check applied style.

### FR3 — Font family selector (serif / sans-serif / monospace override)

**Goal**: Add a font selector in the Typography panel that lets the user override the
EPUB's original CSS font-family with serif, sans-serif, or monospace, applied to the
iframe content.

**Source files**: `src/reader/js/10-chapter-nav.js` (near `fontSize`/`lineHeight`
state), `src/reader/js/12-theme.js` (`applyTheme` — injects CSS into epub.js rendition),
`src/reader/index.template.html` (Typography popup).

**Implementation plan**:
1. Add a module-level variable `fontFamily` (default `''` = no override, use EPUB's
   original font). State in `07-state.js` or near `fontSize`/`lineHeight` in
   `10-chapter-nav.js`.
2. Add a `<select>` or button group in the Typography popup (`#typographyPopupMain`)
   with options: "EPUB default" (value=''), "Serif" (`Georgia, 'Times New Roman', serif`),
   "Sans-serif" (`system-ui, -apple-system, sans-serif`), "Monospace" (`'Courier New', monospace`).
3. In `applyTheme()` (`12-theme.js`), when `fontFamily` is set, add
   `'font-family': fontFamily + ' !important'` to the CSS rules injected via
   `rendition.themes.register('custom', {...})`.
4. For scroll mode (where epub.js themes may not apply the same way), also inject a
   `<style>` tag into the iframe document directly as a fallback.
5. Persist in `saveVisualSettings()` / `loadAndApplyBookState()` (add `fontFamily` to
   the saved state).
6. Add tests: verify selector exists, change font, verify it's reflected in the
   saved/restored state.

### General notes for all FRs

- After implementing any FR, run `npm run build && npm run check` then `npm test`.
- Add new test groups in `test/test_e2e_complete.js` following the existing Sxx pattern.
- Mirror changes to `noesis-multi` (4 target files) as documented above.
- All new state must be persisted via the existing `saveVisualSettings()` /
  `loadAndApplyBookState()` mechanism — don't create a separate persistence path.
