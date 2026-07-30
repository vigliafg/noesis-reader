# Project instructions for opencode

## Mirror changes to noesis-multi

This repository (`noesis-reader`) is the source of truth for the core application code (`index.html`).
The parent repository `/home/vigliafg/Documenti/GitHub/noesis-multi/` contains variant copies
of `index.html` that must be kept in sync.

### File mapping

When you modify `index.html` in this repository, apply the same changes to **all** of these files in `noesis-multi`:

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
Tests are Node.js scripts executed via `NODE_PATH` pointing to the global puppeteer install.

### Prerequisites

- Chrome: `/usr/bin/google-chrome`
- Node.js: `v24.18.0` (via nvm)
- Puppeteer: installed globally at `/home/vigliafg/.nvm/versions/node/v24.18.0/lib/node_modules/puppeteer`
- HTTP server: `python3 -m http.server 8765 --bind 127.0.0.1` serving from project root
- `test.epub`: 64MB medical textbook with 508 spine items

### Quick Start

```bash
# 1. Start HTTP server (if not already running)
setsid python3 -m http.server 8765 --bind 127.0.0.1 -d /home/vigliafg/Documenti/GitHub/noesis-reader &>/tmp/http8765.log &

# 2. Verify server
curl -s -o /dev/null -w '%{http_code}' http://127.0.0.1:8765/index.html  # should return 200

# 3. Run test script
NODE_PATH=/home/vigliafg/.nvm/versions/node/v24.18.0/lib/node_modules \
  node /home/vigliafg/Documenti/GitHub/noesis-reader/test_collection_T1T3.js
```

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
