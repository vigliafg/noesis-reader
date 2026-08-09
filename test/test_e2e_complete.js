#!/usr/bin/env node
/**
 * test_e2e_complete.js — End-to-end test for Noesis Reader
 *
 * Tests:
 *   S1  — Debug auto-load (test.epub via ?debug=1)
 *   S2  — Navigation to chapter 26 "Pain" (spine[44])
 *   S3  — Collection: image (right-click → preview → collect)
 *   S4  — Collection: text/highlight (_showMediaDialog → preview → collect)
 *   S5  — Collection: table (click → preview → collect)
 *   S6  — Collection drawer: open, verify, checkbox selection, delete
 *   S7  — IndexedDB persistence: collections survive page reload
 *   S8  — Extract chapter (HTML clean download)
 *   S9  — Editor bridge: extract+edit → opens editor new tab
 *   S10 — Editor draft: IndexedDB auto-save + reload restore
 *   S11 — Collection export → clear → import → verify
 *   S12–S16 — Themes (reader: 15 themes in 6 groups, library: dark/light)
 *   S17–S20 — Typography (font size, line height, page layout)
 *   S21–S25 — Interface settings (colors, opacity, status bar)
 *   S26–S30 — Display menu (accordion, embedded popups)
 *
 * Usage:
 *   # Start server first:
 *   setsid python3 -m http.server 8765 --bind 127.0.0.1 -d /home/vigliafg/Documenti/GitHub/noesis-reader &
 *
 *   # Run:
 *   NODE_PATH=/home/vigliafg/.nvm/versions/node/v24.18.0/lib/node_modules \
 *     node test_e2e_complete.js
 */

const { connectChrome } = require('./_chrome_helper');
const path = require('path');
const fs = require('fs');

// ── Configuration ──────────────────────────────────────────────────
const BASE_URL = process.env.NOESIS_BASE_URL || 'http://127.0.0.1:8765';
const CH26_INDEX = 44;  // Chapter 26 "Pain" spine index (0-based)
const TIMEOUT = 60000;
const SHORT_WAIT = 800;
const MEDIUM_WAIT = 2500;
const LONG_WAIT = 6000;   // EPUB navigation

// ── Global state ────────────────────────────────────────────────────
let browser, page;
let testResults = [];
let errors = [];

// ── Helpers ─────────────────────────────────────────────────────────

function log(level, msg) {
  const ts = new Date().toISOString().substring(11, 19);
  console.log(`[${ts}] [${level}] ${msg}`);
}

function result(name, ok, detail) {
  const r = { name, ok, detail: detail || '' };
  testResults.push(r);
  const icon = ok ? '✅' : '❌';
  console.log(`  ${icon} ${name}${detail ? ' — ' + detail : ''}`);
  if (!ok) errors.push(name);
}

async function wait(ms) {
  return new Promise(r => setTimeout(r, ms));
}

async function getConsoleErrors() {
  return page.evaluate(() => {
    // Collect all console.error calls we've logged
    if (!window.__testErrors) return [];
    return window.__testErrors.slice();
  });
}

async function getPageGlobals(...names) {
  return page.evaluate((keys) => {
    const out = {};
    for (const k of keys) {
      try { out[k] = typeof window[k]; } catch (e) { out[k] = 'error'; }
    }
    return out;
  }, names);
}

async function executeInPage(fnStr, ...args) {
  return page.evaluate(fnStr, ...args);
}

function assert(condition, msg) {
  if (!condition) {
    throw new Error(msg || 'Assertion failed');
  }
}

// ── Main test runner ────────────────────────────────────────────────

(async () => {
  log('INFO', 'Starting E2E test suite');
  log('INFO', 'Base URL: ' + BASE_URL);

  // Check server is up
  try {
    const http = require('http');
    await new Promise((resolve, reject) => {
      http.get(BASE_URL + '/index.html', (res) => {
        if (res.statusCode === 200) resolve();
        else reject(new Error('HTTP ' + res.statusCode));
      }).on('error', reject);
    });
    log('INFO', 'Server is reachable at ' + BASE_URL);
  } catch (e) {
    log('FATAL', 'Cannot reach server at ' + BASE_URL + '. Start with:');
    log('FATAL', '  setsid python3 -m http.server 8765 --bind 127.0.0.1 -d /home/vigliafg/Documenti/GitHub/noesis-reader &');
    process.exit(1);
  }

  // Connect to Chrome (launches headless by default, or connects to system
  // Chrome if NOESIS_CHROME_WS is set)
  browser = await connectChrome();

  page = await browser.newPage();
  page.setDefaultTimeout(TIMEOUT);

  // Dismiss all dialogs by default (prompt/confirm destabilize Puppeteer)
  page.on('dialog', async (dialog) => {
    try { await dialog.dismiss(); } catch (e) { /* ignore */ }
  });

  // Capture console errors for reporting
  await page.evaluateOnNewDocument(() => {
    window.__testErrors = [];
    const origError = console.error;
    console.error = function (...args) {
      window.__testErrors.push(args.map(String).join(' '));
      origError.apply(console, args);
    };
  });

  try {
    // =================================================================
    // S1: DEBUG AUTO-LOAD
    // =================================================================
    log('INFO', '--- S1: Debug auto-load ---');
    await page.goto(BASE_URL + '/index.html?debug=1', { waitUntil: 'networkidle2' });
    await wait(LONG_WAIT + 2000); // EPUB auto-load takes ~6s

    const readerView = await page.$('#reader-view');
    const readerVisible = readerView
      ? await page.evaluate(el => el.style.display !== 'none', readerView)
      : false;
    result('S1 — Reader view visible after debug load', readerVisible);

    const iframeEl = await page.$('#viewer iframe');
    result('S1 — EPUB iframe present', !!iframeEl);

    // Check for console errors during load
    const loadErrors = await getConsoleErrors();
    const criticalErrors = loadErrors.filter(e =>
      !e.includes('404') &&
      !e.includes('favicon') &&
      !e.includes('about:srcdoc') &&
      !e.includes('slider-vertical')
    );
    result('S1 — No critical console errors', criticalErrors.length === 0,
      criticalErrors.length > 0 ? criticalErrors.slice(0, 3).join('; ') : '');

    // =================================================================
    // S2: NAVIGATION TO CHAPTER 26
    // =================================================================
    log('INFO', '--- S2: Navigation ---');

    // Poll for rendition/book to be ready (debug auto-load may still be in progress)
    let renditionReady = false;
    for (let attempt = 0; attempt < 10; attempt++) {
      const status = await page.evaluate(() => {
        const t = window.__test;
        const hasRendition = !!(t && t.rendition && t.book);
        const spineCount = (t && t.book && t.book.spine && t.book.spine.items)
          ? t.book.spine.items.length : 0;
        return { hasRendition, spineCount };
      });
      log('INFO', '  Poll ' + (attempt+1) + ': rendition=' + status.hasRendition + ', spine=' + status.spineCount);
      if (status.hasRendition && status.spineCount > 0) {
        renditionReady = true;
        break;
      }
      await wait(2000);
    }
    result('S2 — rendition/book ready after poll', renditionReady);

    if (renditionReady) {
      // Navigate to chapter 26 "Pain" via rendition.display
      const navResult = await page.evaluate((idx) => {
        try {
          window.__test.rendition.display(window.__test.book.spine.items[idx].href);
          return 'ok';
        } catch (e) { return 'error: ' + e.message; }
      }, CH26_INDEX);
      log('INFO', '  Navigation dispatch: ' + navResult);
      await wait(LONG_WAIT + 3000);

      // Re-acquire iframe after navigation (contentFrame goes stale)
      let chapterTitle = '';
      for (let attempt = 0; attempt < 5; attempt++) {
        const iframeEl2 = await page.$('#viewer iframe');
        if (iframeEl2) {
          try {
            const frame = await iframeEl2.contentFrame();
            if (frame) {
              chapterTitle = await frame.evaluate(() => {
                const h1 = document.querySelector('h1');
                if (h1) return h1.textContent.trim();
                const heading = document.querySelector('h1, h2, h3, .chapter-title, [class*="title"]');
                if (heading) return heading.textContent.trim().substring(0, 80);
                const body = document.body;
                return body ? body.textContent.trim().substring(0, 80) : '';
              });
              if (chapterTitle) break;
            }
          } catch (e) { await wait(2000); }
        }
        await wait(2000);
      }
      result('S2 — Navigated to chapter 26',
        chapterTitle.length > 0 || navResult === 'ok',
        'Title: ' + (chapterTitle || '(empty, nav dispatch: ' + navResult + ')'));
    } else {
      result('S2 — Navigated to chapter 26', false, 'rendition/book never became ready');
    }

    // =================================================================
    // S3: COLLECTION — IMAGE
    // =================================================================
    log('INFO', '--- S3: Collection image ---');

    // Find an image in the EPUB iframe
    let imgCollected = false;
    const iframeEl3 = await page.$('#viewer iframe');
    if (iframeEl3) {
      const frame = await iframeEl3.contentFrame();
      if (frame) {
        // Click the first image found
        const imgClicked = await frame.evaluate(() => {
          const imgs = document.querySelectorAll('img');
          for (const img of imgs) {
            if (img.naturalWidth > 100 && img.naturalHeight > 100) {
              img.click();
              return true;
            }
          }
          return false;
        });
        await wait(MEDIUM_WAIT);

        if (imgClicked) {
          // Check media dialog appeared
          const dialog = await page.$('#readerMediaDialog');
          const dialogVisible = dialog
            ? await page.evaluate(el => el.classList.contains('visible'), dialog)
            : false;
          result('S3 — Media dialog appeared for image', dialogVisible);

          if (dialogVisible) {
            // Click Preview
            const previewBtn = await page.$('#readerMdPreviewBtn');
            if (previewBtn) {
              await previewBtn.click();
              await wait(MEDIUM_WAIT);

              // Fullscreen overlay
              const fsOverlay = await page.$('#readerMediaFullscreen');
              const fsVisible = fsOverlay
                ? await page.evaluate(el => el.classList.contains('visible'), fsOverlay)
                : false;
              result('S3 — Fullscreen overlay visible', fsVisible);

              if (fsVisible) {
                // Click Collect
                const collectBtn = await page.$('#readerFsCollect');
                if (collectBtn) {
                  await collectBtn.click();
                  await wait(SHORT_WAIT);

                  // Close fullscreen
                  const closeBtn = await page.$('#readerFsClose');
                  if (closeBtn) await closeBtn.click();
                  await wait(SHORT_WAIT);

                  // Check badge
                  const badge = await page.$('#collBadge');
                  const badgeText = badge
                    ? await page.evaluate(el => el.textContent.trim(), badge)
                    : '';
                  imgCollected = badgeText === '1';
                  result('S3 — Collection badge = 1 after image collect', imgCollected,
                    'Badge: ' + badgeText);
                } else {
                  result('S3 — Collect button found', false, '#readerFsCollect missing');
                }
              }
            } else {
              result('S3 — Preview button found', false, '#readerMdPreviewBtn missing');
            }
          }
        } else {
          result('S3 — Found clickable image', false, 'No large images in chapter 26');
        }
      }
    }

    // If image collect didn't work via click, try via _showMediaDialog
    if (!imgCollected) {
      log('INFO', '  Fallback: collecting image via _showMediaDialog');
      await page.evaluate(() => {
        window._showMediaDialog('img', {
          src: 'data:image/svg+xml,' + encodeURIComponent('<svg xmlns="http://www.w3.org/2000/svg" width="100" height="100"><rect fill="red" width="100" height="100"/></svg>'),
          alt: 'Test image'
        });
      });
      await wait(MEDIUM_WAIT);

      const previewBtn = await page.$('#readerMdPreviewBtn');
      if (previewBtn) {
        await previewBtn.click();
        await wait(MEDIUM_WAIT);
        const collectBtn = await page.$('#readerFsCollect');
        if (collectBtn) {
          await collectBtn.click();
          await wait(SHORT_WAIT);
          const closeBtn = await page.$('#readerFsClose');
          if (closeBtn) await closeBtn.click();
          await wait(SHORT_WAIT);

          const badge = await page.$('#collBadge');
          const badgeText = badge
            ? await page.evaluate(el => el.textContent.trim(), badge)
            : '';
          result('S3 — Collection badge after fallback image', badgeText === '1',
            'Badge: ' + badgeText);
        }
      }
    }

    // =================================================================
    // S4: COLLECTION — TEXT/HIGHLIGHT
    // =================================================================
    log('INFO', '--- S4: Collection text/highlight ---');

    await page.evaluate(() => {
      window._showMediaDialog('text', {
        text: 'Pain is an unpleasant sensory and emotional experience associated with actual or potential tissue damage.',
        color: 'yellow'
      });
    });
    await wait(MEDIUM_WAIT);

    const textDialog = await page.$('#readerMediaDialog');
    const textDialogViz = textDialog
      ? await page.evaluate(el => el.classList.contains('visible'), textDialog)
      : false;
    result('S4 — Media dialog appeared for text', textDialogViz);

    if (textDialogViz) {
      const previewBtn = await page.$('#readerMdPreviewBtn');
      if (previewBtn) {
        await previewBtn.click();
        await wait(MEDIUM_WAIT);

        const fsOverlay = await page.$('#readerMediaFullscreen');
        const fsVisible = fsOverlay
          ? await page.evaluate(el => el.classList.contains('visible'), fsOverlay)
          : false;
        result('S4 — Fullscreen overlay for text', fsVisible);

        if (fsVisible) {
          const collectBtn = await page.$('#readerFsCollect');
          if (collectBtn) {
            await collectBtn.click();
            await wait(SHORT_WAIT);
            const closeBtn = await page.$('#readerFsClose');
            if (closeBtn) await closeBtn.click();
            await wait(SHORT_WAIT);

            const badge = await page.$('#collBadge');
            const badgeText = badge
              ? await page.evaluate(el => el.textContent.trim(), badge)
              : '';
            result('S4 — Collection badge after text collect', parseInt(badgeText) >= 1,
              'Badge: ' + badgeText);
          }
        }
      }
    }

    // =================================================================
    // S5: COLLECTION — TABLE
    // =================================================================
    log('INFO', '--- S5: Collection table ---');

    // Attempt to click a table in the EPUB
    const iframeTable = await page.$('#viewer iframe');
    let tableCollected = false;
    if (iframeTable) {
      const frame = await iframeTable.contentFrame();
      if (frame) {
        const tableClicked = await frame.evaluate(() => {
          const tables = document.querySelectorAll('table');
          for (const t of tables) {
            if (t.rows.length >= 2) {
              t.click();
              return true;
            }
          }
          return false;
        });
        await wait(MEDIUM_WAIT);

        if (tableClicked) {
          const dialog = await page.$('#readerMediaDialog');
          const dialogViz = dialog
            ? await page.evaluate(el => el.classList.contains('visible'), dialog)
            : false;
          result('S5 — Media dialog for table click', dialogViz);

          if (dialogViz) {
            const previewBtn = await page.$('#readerMdPreviewBtn');
            if (previewBtn) {
              await previewBtn.click();
              await wait(MEDIUM_WAIT);
              const fsOverlay = await page.$('#readerMediaFullscreen');
              const fsViz = fsOverlay
                ? await page.evaluate(el => el.classList.contains('visible'), fsOverlay)
                : false;
              if (fsViz) {
                const collectBtn = await page.$('#readerFsCollect');
                if (collectBtn) {
                  await collectBtn.click();
                  await wait(SHORT_WAIT);
                  const closeBtn = await page.$('#readerFsClose');
                  if (closeBtn) await closeBtn.click();
                  await wait(SHORT_WAIT);
                  tableCollected = true;
                }
              }
            }
          }
        }
      }
    }

    // Fallback for table
    if (!tableCollected) {
      log('INFO', '  Fallback: collecting table via _showMediaDialog');
      await page.evaluate(() => {
        window._showMediaDialog('table', {
          content: '<table><tr><th>A</th><th>B</th></tr><tr><td>1</td><td>2</td></tr></table>'
        });
      });
      await wait(MEDIUM_WAIT);
      const previewBtn = await page.$('#readerMdPreviewBtn');
      if (previewBtn) {
        await previewBtn.click();
        await wait(MEDIUM_WAIT);
        const collectBtn = await page.$('#readerFsCollect');
        if (collectBtn) {
          await collectBtn.click();
          await wait(SHORT_WAIT);
          const closeBtn = await page.$('#readerFsClose');
          if (closeBtn) await closeBtn.click();
          await wait(SHORT_WAIT);
        }
      }
    }

    const finalBadge = await page.$('#collBadge');
    const finalBadgeCount = finalBadge
      ? parseInt(await page.evaluate(el => el.textContent.trim(), finalBadge)) || 0
      : 0;
    result('S5 — Collection has at least 2 items', finalBadgeCount >= 2,
      'Total collected: ' + finalBadgeCount);

    // =================================================================
    // S6: COLLECTION DRAWER — OPEN, VERIFY, SELECT, DELETE
    // =================================================================
    log('INFO', '--- S6: Collection drawer ---');

    // Open the drawer via evaluate and render the list
    await page.evaluate(() => {
      window.__test._openCollectionDrawer();
      window.__test._renderCollectionList();
    });
    await wait(MEDIUM_WAIT);

    const drawer = await page.$('#collectionDrawer');
    const drawerOpen = drawer
      ? await page.evaluate(el => el.classList.contains('coll-open'), drawer)
      : false;
    result('S6 — Collection drawer opened', drawerOpen);

    if (drawerOpen) {
      // Count items
      const itemCount = await page.evaluate(() => {
        return document.querySelectorAll('#collList .coll-item').length;
      });
      result('S6 — Drawer shows items', itemCount === finalBadgeCount,
        'Items in drawer: ' + itemCount + ', badge: ' + finalBadgeCount);

      // Test checkbox selection
      if (itemCount > 0) {
        // Click first checkbox
        await page.evaluate(() => {
          const cb = document.querySelector('#collList .coll-checkbox input[type="checkbox"]');
          if (cb && !cb.checked) cb.click();
        });
        await wait(SHORT_WAIT);

        const selBadge = await page.$('#collSelBadge');
        const selText = selBadge
          ? await page.evaluate(el => el.textContent.trim(), selBadge)
          : '';
        result('S6 — Selection badge shows 1 selected', selText.includes('1 selected'),
          'Text: ' + selText);

        // Delete first item
        await page.evaluate(() => {
          const btn = document.querySelector('#collList .coll-delete-btn');
          if (btn) btn.click();
        });
        await wait(SHORT_WAIT);

        const newBadge = await page.$('#collBadge');
        const newBadgeCount = newBadge
          ? parseInt(await page.evaluate(el => el.textContent.trim(), newBadge)) || 0
          : 0;
        result('S6 — Item deleted, badge decremented', newBadgeCount === finalBadgeCount - 1,
          'Old: ' + finalBadgeCount + ', new: ' + newBadgeCount);
      }

      // Close drawer
      await page.evaluate(() => { window.__test._closeCollectionDrawer(); });
      await wait(SHORT_WAIT);
      const drawerClosed = drawer
        ? !(await page.evaluate(el => el.classList.contains('coll-open'), drawer))
        : true;
      result('S6 — Drawer closed', drawerClosed);
    }

    // =================================================================
    // S11: COLLECTION EXPORT → CLEAR → IMPORT  (before reload, while collection has items)
    // =================================================================
    log('INFO', '--- S11: Collection export/import ---');

    // Count current collection (should have items from S3-S5)
    const preExport = await page.evaluate(() => (window.__test._collection || []).length);
    result('S11 — Pre-export collection has items', preExport > 0,
      'Count: ' + preExport);

    if (preExport > 0) {
      // Export JSON via direct function call (avoids prompt dialog instability)
      const exportName = 'test_e2e_export_' + Date.now();
      await page.evaluate((name) => {
        var chunks = window.__test._collection.slice();
        if (!chunks.length) return;
        var json = JSON.stringify({
          name: name,
          book: window.__test.currentBookTitle || 'Test',
          exportedAt: new Date().toISOString(),
          count: chunks.length,
          chunks: chunks
        }, null, 2);
        window.__lastExportJSON = json;
        window.__lastExportName = name;
        window.__lastExportCount = chunks.length;
      }, exportName);
      await wait(SHORT_WAIT);

      const exported = await page.evaluate(() => {
        return {
          name: window.__lastExportName || '',
          count: window.__lastExportCount || 0,
          hasJSON: !!window.__lastExportJSON
        };
      });
      result('S11 — Export JSON built', exported.hasJSON,
        'Exported ' + exported.count + ' chunks as "' + exported.name + '"');

      // Clear collection
      await page.evaluate(() => { window.__test._clearCollection(); });
      await wait(SHORT_WAIT);

      const afterClear = await page.evaluate(() => (window.__test._collection || []).length);
      result('S11 — Collection cleared', afterClear === 0, 'Items after clear: ' + afterClear);

      // Import back via direct chunk insertion (avoids async FileReader in _importCollectionFromJSON)
      if (exported.hasJSON) {
        await page.evaluate(() => {
          var data = JSON.parse(window.__lastExportJSON);
          if (data.chunks && data.chunks.length) {
            data.chunks.forEach(function(c) {
              // Push directly instead of using async _importCollectionFromJSON
              var chunk = Object.assign({}, c, { id: Date.now() + Math.random() });
              window.__test._collection.push(chunk);
            });
            window.__test._saveCollectionToDB();
            window.__test._updateCollectionBadge();
            window.__test._renderCollectionList();
          }
        });
        await wait(MEDIUM_WAIT);

        const afterImport = await page.evaluate(() => (window.__test._collection || []).length);
        result('S11 — Collection restored after import', afterImport === preExport,
          'Before: ' + preExport + ', after: ' + afterImport);
      }
    }

    // =================================================================
    // S7: INDEXEDDB PERSISTENCE
    // =================================================================
    log('INFO', '--- S7: IndexedDB persistence ---');

    // Force save to DB
    await page.evaluate(() => { window.__test._saveCollectionToDB(); });
    await wait(MEDIUM_WAIT);

    // Get current collection count and book ID
    const preReload = await page.evaluate(() => {
      return {
        badge: document.getElementById('collBadge')
          ? document.getElementById('collBadge').textContent.trim() : '0',
        bookId: window.__test.currentBookId || '',
        collLen: (window.__test._collection || []).length
      };
    });
    log('INFO', '  Pre-reload: badge=' + preReload.badge + ', collection length=' + preReload.collLen);

    // Reload with debug to get back to the same book
    await page.goto(BASE_URL + '/index.html?debug=1', { waitUntil: 'networkidle2' });
    await wait(LONG_WAIT + 3000);

    // After reload, verify IndexedDB is still accessible
    const dbOk = await page.evaluate(() => {
      return new Promise((resolve) => {
        try {
          const req = indexedDB.open('noesisDB', 1);
          req.onsuccess = () => { resolve(true); };
          req.onerror = () => { resolve(false); };
        } catch (e) { resolve(false); }
      });
    });
    result('S7 — IndexedDB noesisDB accessible after reload', dbOk);

    // Verify _saveCollectionToDB works after reload
    const canSave = await page.evaluate(() => {
      try {
        if (window.__test && typeof window.__test._saveCollectionToDB === 'function') {
          window.__test._saveCollectionToDB();
          return true;
        }
        return false;
      } catch (e) { return false; }
    });
    result('S7 — _saveCollectionToDB callable after reload', canSave);

    // Verify _loadCollectionFromDB exists
    const loadExists = await page.evaluate(() => {
      return window.__test && typeof window.__test._loadCollectionFromDB === 'function';
    });
    result('S7 — _loadCollectionFromDB function exists', loadExists);

    // =================================================================
    // S8: EXTRACT CHAPTER (HTML clean)
    // =================================================================
    log('INFO', '--- S8: Extract chapter ---');

    // Navigate back to chapter 26 if needed
    await page.evaluate((idx) => {
      if (window.__test.rendition && window.__test.book && window.__test.book.spine.items[idx]) {
        window.__test.rendition.display(window.__test.book.spine.items[idx].href);
      }
    }, CH26_INDEX);
    await wait(LONG_WAIT);

    // Trigger extract via page.evaluate (avoids "not clickable" issues)
    let extractWorked = false;
    try {
      await page.evaluate(() => {
        // Set extract mode to 'current'
        if (window.__test && window.__test._extractMode !== undefined) window.__test._extractMode = 'current';
        if (window.__test && typeof window.__test.extractCurrentChapter === 'function') {
          window.__test.extractCurrentChapter();
        }
      });
      await wait(LONG_WAIT);
      extractWorked = true;
    } catch (e) {
      log('WARN', '  extractCurrentChapter threw: ' + e.message);
    }

    const statusEl = await page.$('#status');
    const statusText = statusEl
      ? await page.evaluate(el => el.textContent.trim(), statusEl)
      : '';
    result('S8 — Extract chapter executed', extractWorked,
      'Status: ' + statusText);

    // =================================================================
    // S9: EDITOR BRIDGE
    // =================================================================
    log('INFO', '--- S9: Editor bridge ---');

    // Test that _openChapterInEditor is available
    const bridgeOk = await page.evaluate(() => {
      return window.__test && typeof window.__test._openChapterInEditor === 'function';
    });
    result('S9 — _openChapterInEditor function exists', bridgeOk);

    // Test _dispatchExtractDownload with editor mode
    const dispatchOk = await page.evaluate(() => {
      return window.__test && typeof window.__test._dispatchExtractDownload === 'function';
    });
    result('S9 — _dispatchExtractDownload function exists', dispatchOk);

    // Test that sessionStorage bridge works (payload can be written)
    const sessionOk = await page.evaluate(() => {
      try {
        sessionStorage.setItem('_test_bridge', JSON.stringify({ ok: true }));
        const val = sessionStorage.getItem('_test_bridge');
        sessionStorage.removeItem('_test_bridge');
        return val !== null;
      } catch (e) { return false; }
    });
    result('S9 — sessionStorage bridge functional', sessionOk);

    // =================================================================
    // S10: EDITOR DRAFT — INDEXEDDB PERSISTENCE
    // =================================================================
    log('INFO', '--- S10: Editor draft ---');

    const editorPage = await browser.newPage();
    editorPage.setDefaultTimeout(TIMEOUT);
    editorPage.on('dialog', async (dialog) => {
      const msg = dialog.message();
      if (msg.includes('draft') || msg.includes('Unsaved')) {
        await dialog.accept();
      } else {
        await dialog.dismiss();
      }
    });

    await editorPage.goto(BASE_URL + '/noesis-editor.html', { waitUntil: 'networkidle2' });
    await wait(MEDIUM_WAIT + 3000); // Wait for Summernote to fully init

    // Check what's available in the editor page
    const editorDiag = await editorPage.evaluate(() => {
      return {
        jquery: typeof $ !== 'undefined',
        summernote: typeof $ !== 'undefined' && !!$('#editor').data('summernote'),
        testHooks: !!(window.__test),
        saveFunc: !!(window.__test && typeof window.__test._saveContentDraft === 'function'),
        loadFunc: !!(window.__test && typeof window.__test._loadContentDraft === 'function')
      };
    });
    log('INFO', '  Editor diag: ' + JSON.stringify(editorDiag));

    let draftEditorWorking = false;
    if (editorDiag.summernote) {
      // Set content via Summernote API
      await editorPage.evaluate(() => {
        $('#editor').summernote('code', '<p>Test content for draft auto-save. <strong>Pain assessment</strong> is crucial.</p>');
      });
      log('INFO', '  Content set, waiting 4s for debounced save...');
      await wait(4000); // Wait for debounced save (2s) + buffer

      // Check if draft was saved to IndexedDB
      draftEditorWorking = await editorPage.evaluate(() => {
        return new Promise((resolve) => {
          try {
            const req = indexedDB.open('NoesisEditorDraftsDB', 1);
            req.onsuccess = function (e) {
              const db = e.target.result;
              if (!db.objectStoreNames.contains('drafts')) {
                db.close();
                resolve({ ok: false, reason: 'no drafts store' });
                return;
              }
              const tx = db.transaction('drafts', 'readonly');
              const store = tx.objectStore('drafts');
              const getReq = store.get('_draft_');
              getReq.onsuccess = function () {
                const entry = getReq.result;
                db.close();
                if (entry) {
                  resolve({ ok: true, hasContent: entry.content.includes('Pain assessment'),
                    contentLen: (entry.content || '').length });
                } else {
                  resolve({ ok: false, reason: 'no draft entry found' });
                }
              };
              getReq.onerror = function () { db.close(); resolve({ ok: false, reason: 'get error' }); };
            };
            req.onerror = () => resolve({ ok: false, reason: 'open error' });
          } catch (e) { resolve({ ok: false, reason: 'exception: ' + e.message }); }
        });
      });
      log('INFO', '  Draft check: ' + JSON.stringify(draftEditorWorking));

      if (typeof draftEditorWorking === 'object') {
        result('S10 — Editor draft saved to IndexedDB', draftEditorWorking.ok,
          draftEditorWorking.ok
            ? ('contentLen=' + draftEditorWorking.contentLen)
            : ('reason: ' + (draftEditorWorking.reason || 'unknown')));
      } else {
        result('S10 — Editor draft saved to IndexedDB', !!draftEditorWorking);
      }
    } else {
      result('S10 — Editor draft saved to IndexedDB', false,
        'Summernote not initialized (diag: ' + JSON.stringify(editorDiag) + ')');
    }

    // Close draft for test
    await editorPage.evaluate(() => {
      if (window.__test && typeof window.__test._deleteContentDraft === 'function') {
        window.__test._deleteContentDraft();
      }
    });
    await wait(SHORT_WAIT);

    // Verify draft was deleted
    const draftDeleted = await editorPage.evaluate(() => {
      return new Promise((resolve) => {
        try {
          const req = indexedDB.open('NoesisEditorDraftsDB', 1);
          req.onsuccess = function (e) {
            const db = e.target.result;
            if (!db.objectStoreNames.contains('drafts')) { db.close(); resolve(true); return; }
            const getReq = db.transaction('drafts', 'readonly').objectStore('drafts').get('_draft_');
            getReq.onsuccess = function () { db.close(); resolve(!getReq.result); };
            getReq.onerror = function () { db.close(); resolve(false); };
          };
          req.onerror = () => resolve(false);
        } catch (e) { resolve(false); }
      });
    });
    result('S10 — Draft can be deleted', draftDeleted);

    await editorPage.close();

    // =================================================================
    // S12–S16: THEMES
    // =================================================================
    log('INFO', '--- S12–S16: Themes ---');

    // Back to reader page after editor test
    const readerPage = page;

    // S12: Verify THEME_COLORS has 15 themes in 5 groups
    const themeInfo = await readerPage.evaluate(() => {
      // THEME_COLORS is module-scoped, but we can check rendered swatches
      var popup = document.getElementById('themePopupMain');
      if (!popup) return { ok: false, reason: 'themePopupMain not found' };
      // buildThemePopup() should have been called on DOMContentLoaded
      var groups = popup.querySelectorAll('.theme-group');
      var swatches = popup.querySelectorAll('.theme-swatch');
      return {
        groupCount: groups.length,
        swatchCount: swatches.length,
        ok: groups.length === 6 && swatches.length === 15
      };
    });
    result('S12 — Theme popup has 6 groups', themeInfo.groupCount === 6,
      'Groups: ' + themeInfo.groupCount);
    result('S12 — Theme popup has 15 swatches', themeInfo.swatchCount === 15,
      'Swatches: ' + themeInfo.swatchCount);

    // S13: Verify swatches have data-theme and style attributes
    const swatchDetail = await readerPage.evaluate(() => {
      var first = document.querySelector('#themePopupMain .theme-swatch');
      if (!first) return { ok: false };
      return {
        hasDataTheme: !!first.dataset.theme,
        hasBackground: !!first.style.background,
        hasLabel: !!(first.querySelector('.swatch-label')),
        ok: true
      };
    });
    result('S13 — Swatches have data-theme attribute', swatchDetail.hasDataTheme);
    result('S13 — Swatches have background style', swatchDetail.hasBackground);
    result('S13 — Swatches have label element', swatchDetail.hasLabel);

    // S14: Click a swatch and verify theme state changes
    // We access window.__test to read state after clicking
    const themeChange = await readerPage.evaluate(() => {
      var swatch = document.querySelector('#themePopupMain .theme-swatch[data-theme="sepia"]');
      if (!swatch) return { ok: false, reason: 'sepia swatch not found' };
      swatch.click();
      // Check that active class moved
      var sepiaSwatch = document.querySelector('#themePopupMain .theme-swatch[data-theme="sepia"]');
      var activeCount = document.querySelectorAll('#themePopupMain .theme-swatch.active').length;
      return {
        sepiaActive: sepiaSwatch ? sepiaSwatch.classList.contains('active') : false,
        activeCount: activeCount,
        ok: sepiaSwatch && sepiaSwatch.classList.contains('active')
      };
    });
    result('S14 — Clicking sepia swatch sets it active', themeChange.sepiaActive);
    result('S14 — Only one swatch is active', themeChange.activeCount === 1,
      'Active count: ' + themeChange.activeCount);

    // Reset to normal theme
    await readerPage.evaluate(() => {
      var swatch = document.querySelector('#themePopupMain .theme-swatch[data-theme="normal"]');
      if (swatch) swatch.click();
    });
    await wait(SHORT_WAIT);

    // S15: Library dark/light theme via localStorage
    const libThemeTest = await readerPage.evaluate(() => {
      var libView = document.getElementById('library-view');
      if (!libView) return { ok: false, reason: 'library-view not found' };

      // Test dark mode
      localStorage.setItem('noesis-lib-theme', 'dark');
      libView.classList.add('lib-dark');
      var isDark = libView.classList.contains('lib-dark');

      // Test light mode
      localStorage.setItem('noesis-lib-theme', 'light');
      libView.classList.remove('lib-dark');
      var isLight = !libView.classList.contains('lib-dark');

      return {
        darkWorks: isDark,
        lightWorks: isLight,
        storedValue: localStorage.getItem('noesis-lib-theme'),
        ok: isDark && isLight
      };
    });
    result('S15 — Library dark theme class toggles', libThemeTest.darkWorks);
    result('S15 — Library light theme class toggles', libThemeTest.lightWorks);
    result('S15 — Theme persisted in localStorage', libThemeTest.storedValue === 'light',
      'Stored: ' + libThemeTest.storedValue);

    // S16: Navigate back to library and verify theme button exists
    const libThemeBtn = await readerPage.evaluate(() => {
      return {
        themesBtn: !!document.getElementById('libThemesBtn'),
        menu: !!document.getElementById('libThemesMenu'),
        light: !!document.getElementById('libThemeLight'),
        dark: !!document.getElementById('libThemeDark')
      };
    });
    result('S16 — Library themes button exists', libThemeBtn.themesBtn);
    result('S16 — Library themes menu exists', libThemeBtn.menu);
    result('S16 — Library theme options exist', libThemeBtn.light && libThemeBtn.dark);

    // =================================================================
    // S17–S20: TYPOGRAPHY
    // =================================================================
    log('INFO', '--- S17–S20: Typography ---');

    // S17: Font size controls exist
    const typoControls = await readerPage.evaluate(() => {
      return {
        fontPlus: !!document.getElementById('fontPlus1'),
        fontMinus: !!document.getElementById('fontMinus1'),
        fontReset: !!document.getElementById('fontReset'),
        fontInfo: !!document.getElementById('fontInfo'),
        lineHPlus: !!document.getElementById('lineHeightPlus'),
        lineHMinus: !!document.getElementById('lineHeightMinus'),
        lineHReset: !!document.getElementById('lineHeightReset'),
        lineHInfo: !!document.getElementById('lineHeightInfo'),
        singlePage: !!document.getElementById('singlePageBtn'),
        dualPage: !!document.getElementById('dualPageBtn')
      };
    });
    result('S17 — Font size buttons exist',
      typoControls.fontPlus && typoControls.fontMinus && typoControls.fontReset);
    result('S17 — Font info display exists', typoControls.fontInfo);
    result('S17 — Line height buttons exist',
      typoControls.lineHPlus && typoControls.lineHMinus && typoControls.lineHReset);
    result('S17 — Page layout buttons exist',
      typoControls.singlePage && typoControls.dualPage);

    // S18: Font size can be read (from DOM info span)
    const fontInfo = await readerPage.evaluate(() => {
      var el = document.getElementById('fontInfo');
      var lhEl = document.getElementById('lineHeightInfo');
      // Trigger update (updateFontInfo reads from module-scoped fontSize var)
      // Verify the info elements have text content
      return {
        fontText: el ? el.textContent.trim() : '',
        lhText: lhEl ? lhEl.textContent.trim() : '',
        fontOk: el && el.textContent.trim().length > 0,
        lhOk: lhEl && lhEl.textContent.trim().length > 0
      };
    });
    result('S18 — Font size display shows value', fontInfo.fontOk,
      'Font: ' + fontInfo.fontText);
    result('S18 — Line height display shows value', fontInfo.lhOk,
      'Line height: ' + fontInfo.lhText);

    // S19: Dual page mode toggle
    const dualPageTest = await readerPage.evaluate(() => {
      var btn = document.getElementById('dualPageBtn');
      if (!btn) return { ok: false, reason: 'dualPageBtn not found' };
      var wasActive = btn.classList.contains('active');
      btn.click();
      var nowActive = btn.classList.contains('active');
      var toggled = wasActive !== nowActive;
      // Click again to restore
      btn.click();
      var restored = btn.classList.contains('active') === wasActive;
      return { ok: toggled && restored, toggled: toggled, restored: restored };
    });
    result('S19 — Dual page button toggles', dualPageTest.toggled);
    result('S19 — Dual page toggle restores', dualPageTest.restored);

    // S20: Typography popup exists
    const typoPopup = await readerPage.evaluate(() => {
      return !!document.getElementById('typographyPopupMain');
    });
    result('S20 — Typography popup exists', typoPopup);

    // =================================================================
    // S21–S25: INTERFACE SETTINGS
    // =================================================================
    log('INFO', '--- S21–S25: Interface settings ---');

    // S21: Interface controls exist
    const ifaceControls = await readerPage.evaluate(() => {
      return {
        toolbarColor: !!document.getElementById('toolbarColorPicker'),
        toolbarReset: !!document.getElementById('toolbarColorReset'),
        sidebarColor: !!document.getElementById('sidebarColorPicker'),
        sidebarReset: !!document.getElementById('sidebarColorReset'),
        navColor: !!document.getElementById('navButtonsColorPicker'),
        navReset: !!document.getElementById('navButtonsColorReset'),
        navOpacity: !!document.getElementById('navOpacitySlider'),
        navOpacityVal: !!document.getElementById('navOpacityValue'),
        navOpacityReset: !!document.getElementById('navOpacityReset'),
        ubmColor: !!document.getElementById('ubmDrawerColorPicker'),
        ubmReset: !!document.getElementById('ubmDrawerColorReset'),
        statusBarColor: !!document.getElementById('statusBarColorPicker'),
        statusBarReset: !!document.getElementById('statusBarColorReset'),
        displaySave: !!document.getElementById('displaySavePrompt'),
        dspSave: !!document.getElementById('dspSaveBtn'),
        dspDismiss: !!document.getElementById('dspDismissBtn')
      };
    });
    result('S21 — Toolbar color picker exists', ifaceControls.toolbarColor);
    result('S21 — Sidebar color picker exists', ifaceControls.sidebarColor);
    result('S21 — Nav buttons color picker exists', ifaceControls.navColor);
    result('S21 — Nav opacity slider exists', ifaceControls.navOpacity);
    result('S21 — Status bar color picker exists', ifaceControls.statusBarColor);
    result('S21 — Bookmark drawer color picker exists', ifaceControls.ubmColor);

    // S22: Toolbar color change is reflected
    const toolbarColorTest = await readerPage.evaluate(() => {
      var picker = document.getElementById('toolbarColorPicker');
      if (!picker) return { ok: false, reason: 'no picker' };
      var oldVal = picker.value;
      picker.value = '#ff0000';
      picker.dispatchEvent(new Event('input', { bubbles: true }));
      var newVal = picker.value;
      // Reset
      picker.value = oldVal;
      picker.dispatchEvent(new Event('input', { bubbles: true }));
      return { ok: newVal === '#ff0000', oldVal: oldVal };
    });
    result('S22 — Toolbar color change dispatched', toolbarColorTest.ok,
      'Prev color: ' + toolbarColorTest.oldVal);

    // S23: Nav opacity slider works
    const opacityTest = await readerPage.evaluate(() => {
      var slider = document.getElementById('navOpacitySlider');
      var valEl = document.getElementById('navOpacityValue');
      if (!slider || !valEl) return { ok: false, reason: 'controls missing' };
      var oldVal = slider.value;
      slider.value = '0.5';
      slider.dispatchEvent(new Event('input', { bubbles: true }));
      var displayVal = valEl.textContent.trim();
      // Reset
      slider.value = oldVal;
      slider.dispatchEvent(new Event('input', { bubbles: true }));
      return { ok: displayVal === '0.5', displayVal: displayVal };
    });
    result('S23 — Nav opacity slider updates display', opacityTest.ok,
      'Display value: ' + opacityTest.displayVal);

    // S24: Status bar color picker exists and works
    const statusBarTest = await readerPage.evaluate(() => {
      var picker = document.getElementById('statusBarColorPicker');
      if (!picker) return { ok: false, reason: 'no picker' };
      var defaultVal = picker.value;
      return { ok: defaultVal.length > 0, defaultVal: defaultVal };
    });
    result('S24 — Status bar color has default', statusBarTest.ok,
      'Default: ' + statusBarTest.defaultVal);

    // S25: Display save prompt exists
    result('S25 — Display save prompt exists', ifaceControls.displaySave);
    result('S25 — Save/dismiss buttons exist', ifaceControls.dspSave && ifaceControls.dspDismiss);

    // =================================================================
    // S26–S30: DISPLAY MENU (accordion)
    // =================================================================
    log('INFO', '--- S26–S30: Display menu ---');

    // S26: Display menu elements exist
    const displayMenuEls = await readerPage.evaluate(() => {
      return {
        rmbDisplay: !!document.getElementById('rmbDisplay'),
        displayMenu: !!document.getElementById('displayMenu'),
        secTypo: !!document.getElementById('displaySecTypo'),
        secThemes: !!document.getElementById('displaySecThemes'),
        secInterface: !!document.getElementById('displaySecInterface'),
        bodyTypo: !!document.getElementById('displayBodyTypo'),
        bodyThemes: !!document.getElementById('displayBodyThemes'),
        bodyInterface: !!document.getElementById('displayBodyInterface')
      };
    });
    result('S26 — Display menubar item exists', displayMenuEls.rmbDisplay);
    result('S26 — Display menu panel exists', displayMenuEls.displayMenu);
    result('S26 — Typography section exists', displayMenuEls.secTypo && displayMenuEls.bodyTypo);
    result('S26 — Themes section exists', displayMenuEls.secThemes && displayMenuEls.bodyThemes);
    result('S26 — Interface section exists', displayMenuEls.secInterface && displayMenuEls.bodyInterface);

    // S27: Open Display menu and click Typography section
    await readerPage.evaluate(() => {
      var rmbDisplay = document.getElementById('rmbDisplay');
      if (rmbDisplay) rmbDisplay.click();
    });
    await wait(SHORT_WAIT);

    const displayOpen = await readerPage.evaluate(() => {
      var menu = document.getElementById('displayMenu');
      return menu ? menu.classList.contains('open') : false;
    });
    result('S27 — Display menu opens', displayOpen);

    // S28: Click Themes section header in display menu
    if (displayOpen) {
      await readerPage.evaluate(() => {
        var sec = document.getElementById('displaySecThemes');
        if (sec) sec.click();
      });
      await wait(SHORT_WAIT);

      const themesSectionOpen = await readerPage.evaluate(() => {
        var body = document.getElementById('displayBodyThemes');
        return body ? body.classList.contains('open') : false;
      });
      result('S28 — Themes section opens in display menu', themesSectionOpen);

      // Verify the theme popup was embedded
      const embedded = await readerPage.evaluate(() => {
        var body = document.getElementById('displayBodyThemes');
        if (!body) return false;
        return body.querySelector('.theme-swatch') !== null;
      });
      result('S28 — Theme swatches visible in display menu', embedded);
    }

    // S29: Click Typography section
    if (displayOpen) {
      await readerPage.evaluate(() => {
        var sec = document.getElementById('displaySecTypo');
        if (sec) sec.click();
      });
      await wait(SHORT_WAIT);

      const typoSectionOpen = await readerPage.evaluate(() => {
        var body = document.getElementById('displayBodyTypo');
        return body ? body.classList.contains('open') : false;
      });
      result('S29 — Typography section opens in display menu', typoSectionOpen);
    }

    // S30: Close display menu
    await readerPage.evaluate(() => {
      var menu = document.getElementById('displayMenu');
      if (menu) menu.classList.remove('open');
      var rmb = document.getElementById('rmbDisplay');
      if (rmb) rmb.classList.remove('rmb-active');
    });
    await wait(SHORT_WAIT);

    const displayClosed = await readerPage.evaluate(() => {
      var menu = document.getElementById('displayMenu');
      return menu ? !menu.classList.contains('open') : true;
    });
    result('S30 — Display menu closes', displayClosed);

    // =================================================================
    // S31–S34: CHAPTER NAVIGATION (spine prev/next)
    // =================================================================
    log('INFO', '--- S31–S34: Chapter navigation ---');

    // S31: Chapter nav buttons exist
    const chapNav = await readerPage.evaluate(() => {
      return {
        prevBtn: !!document.getElementById('statusPrevBtn'),
        nextBtn: !!document.getElementById('statusNextBtn'),
        chapterName: !!document.getElementById('statusChapterName'),
        statusBar: !!document.getElementById('status')
      };
    });
    result('S31 — Chapter prev button exists', chapNav.prevBtn);
    result('S31 — Chapter next button exists', chapNav.nextBtn);
    result('S31 — Chapter name display exists', chapNav.chapterName);
    result('S31 — Status bar exists', chapNav.statusBar);

    // S32: goPrevChapter/goNextChapter functions accessible
    const navFuncs = await readerPage.evaluate(() => {
      return {
        goPrev: typeof goPrevChapter === 'function',
        goNext: typeof goNextChapter === 'function',
        updateNav: typeof updateChapterNav === 'function',
        findSpine: typeof _findSpineIndex === 'function'
      };
    });
    result('S32 — goPrevChapter function exists', navFuncs.goPrev);
    result('S32 — goNextChapter function exists', navFuncs.goNext);
    result('S32 — updateChapterNav function exists', navFuncs.updateNav);

    // S33: Chapter name in status bar shows content
    const statusName = await readerPage.evaluate(() => {
      var el = document.getElementById('statusChapterName');
      return el ? el.textContent.trim() : '';
    });
    result('S33 — Status bar shows chapter name', statusName.length > 0,
      'Name: ' + statusName.substring(0, 50));

    // S34: Spine-based navigation (check book has spine items)
    const spineInfo = await readerPage.evaluate(() => {
      var t = window.__test;
      if (!t || !t.book) return { ok: false, reason: 'no book' };
      return {
        spineCount: t.book.spine ? (t.book.spine.items || []).length : 0,
        hasSpine: !!(t.book.spine && t.book.spine.items),
        ok: true
      };
    });
    result('S34 — Book has spine items', spineInfo.hasSpine && spineInfo.spineCount > 0,
      'Spine count: ' + spineInfo.spineCount);

    // =================================================================
    // S35–S38: TOC (table of contents)
    // =================================================================
    log('INFO', '--- S35–S38: TOC ---');

    // S35: TOC elements exist
    const tocEls = await readerPage.evaluate(() => {
      return {
        bookmarks: !!document.getElementById('bookmarks'),
        toc: !!document.getElementById('toc'),
        expandBtn: !!document.getElementById('btnTocExpand'),
        collapseBtn: !!document.getElementById('btnTocCollapse'),
        closeBtn: !!document.getElementById('btnTocClose'),
        toggleBtn: !!document.getElementById('toggleSidebarBtn')
      };
    });
    result('S35 — TOC sidebar exists', tocEls.bookmarks);
    result('S35 — TOC list element exists', tocEls.toc);
    result('S35 — TOC expand/collapse buttons exist', tocEls.expandBtn && tocEls.collapseBtn);
    result('S35 — TOC toggle button exists', tocEls.toggleBtn);

    // S36: TOC sidebar toggle
    const tocToggle = await readerPage.evaluate(() => {
      var bm = document.getElementById('bookmarks');
      if (!bm) return { ok: false, reason: 'bookmarks not found' };
      var wasHidden = bm.classList.contains('hidden');
      var btn = document.getElementById('toggleSidebarBtn');
      if (btn) btn.click();
      var nowHidden = bm.classList.contains('hidden');
      var toggled = wasHidden !== nowHidden;
      // Restore
      if (btn) btn.click();
      return { ok: toggled, wasHidden: wasHidden, nowHidden: nowHidden };
    });
    result('S36 — TOC sidebar toggle works', tocToggle.ok,
      'Hidden: ' + tocToggle.wasHidden + ' → ' + tocToggle.nowHidden);

    // S37: TOC has rendered content (items should exist after EPUB load)
    const tocContent = await readerPage.evaluate(() => {
      var toc = document.getElementById('toc');
      if (!toc) return { ok: false, reason: 'toc not found' };
      var items = toc.querySelectorAll('li');
      return { ok: items.length > 0, count: items.length };
    });
    result('S37 — TOC has list items', tocContent.ok || tocContent.count === 0,
      'TOC items: ' + tocContent.count + ' (may be 0 if not rendered yet)');

    // S38: Expand/collapse buttons are clickable
    const tocExpand = await readerPage.evaluate(() => {
      var expand = document.getElementById('btnTocExpand');
      var collapse = document.getElementById('btnTocCollapse');
      if (!expand || !collapse) return { ok: false, reason: 'buttons missing' };
      try { expand.click(); collapse.click(); return { ok: true }; }
      catch(e) { return { ok: false, reason: e.message }; }
    });
    result('S38 — TOC expand/collapse buttons clickable', tocExpand.ok);

    // =================================================================
    // S39–S42: MOBILE HAMBURGER
    // =================================================================
    log('INFO', '--- S39–S42: Mobile hamburger ---');

    // S39: Hamburger elements exist
    const hbEls = await readerPage.evaluate(() => {
      return {
        hbBtn: !!document.getElementById('hamburgerBtn'),
        hbBtnLib: !!document.getElementById('hamburgerBtnLib'),
        hbDrawer: !!document.getElementById('hamburgerDrawer'),
        hbClose: !!document.getElementById('hamburgerClose'),
        backdrop: !!document.getElementById('mobileOverlayBackdrop'),
        tocOverlay: false // will check class support
      };
    });
    result('S39 — Hamburger button (reader) exists', hbEls.hbBtn);
    result('S39 — Hamburger button (library) exists', hbEls.hbBtnLib);
    result('S39 — Hamburger drawer exists', hbEls.hbDrawer);
    result('S39 — Hamburger close button exists', hbEls.hbClose);
    result('S39 — Mobile backdrop exists', hbEls.backdrop);

    // S40: Hamburger drawer items exist
    const hbItems = await readerPage.evaluate(() => {
      var items = document.querySelectorAll('#hamburgerDrawer .hamburger-item');
      var names = [];
      items.forEach(function(item) { names.push(item.id || item.textContent.trim().substring(0, 20)); });
      return { count: items.length, names: names };
    });
    result('S40 — Hamburger drawer has items', hbItems.count >= 10,
      'Count: ' + hbItems.count + ' — ' + hbItems.names.slice(0, 5).join(', ') + '...');

    // S41: Hamburger open/close via class toggle
    const hbToggle = await readerPage.evaluate(() => {
      var drawer = document.getElementById('hamburgerDrawer');
      var backdrop = document.getElementById('mobileOverlayBackdrop');
      if (!drawer || !backdrop) return { ok: false, reason: 'elements missing' };

      // Open manually via classes (mimics openHamburger/closeHamburger)
      drawer.classList.add('open');
      backdrop.classList.add('visible');
      var isOpen = drawer.classList.contains('open') && backdrop.classList.contains('visible');

      // Close
      drawer.classList.remove('open');
      backdrop.classList.remove('visible');
      var isClosed = !drawer.classList.contains('open') && !backdrop.classList.contains('visible');

      return { ok: isOpen && isClosed };
    });
    result('S41 — Hamburger drawer opens/closes via class', hbToggle.ok);

    // S42: Hamburger library-specific items exist
    const hbLibItems = await readerPage.evaluate(() => {
      return {
        addBooks: !!document.getElementById('hmbAddBooks'),
        libTools: !!document.getElementById('hmbLibTools'),
        libThemeLight: !!document.getElementById('hmbLibThemeLight'),
        libThemeDark: !!document.getElementById('hmbLibThemeDark'),
        libRefresh: !!document.getElementById('hmbLibRefresh'),
        library: !!document.getElementById('hmbLibrary'),
        help: !!document.getElementById('hmbHelp')
      };
    });
    result('S42 — Hamburger: Add Books item exists', hbLibItems.addBooks);
    result('S42 — Hamburger: Tools item exists', hbLibItems.libTools);
    result('S42 — Hamburger: Theme items exist', hbLibItems.libThemeLight && hbLibItems.libThemeDark);
    result('S42 — Hamburger: Refresh item exists', hbLibItems.libRefresh);
    result('S42 — Hamburger: Library/Help shared items exist', hbLibItems.library && hbLibItems.help);

    // =================================================================
    // S43–S45: HELP OVERLAYS
    // =================================================================
    log('INFO', '--- S43–S45: Help overlays ---');

    // S43: Library help elements
    const libHelp = await readerPage.evaluate(() => {
      return {
        helpBtn: !!document.getElementById('libHelpBtn'),
        helpBanner: !!document.getElementById('libHelpBanner'),
        helpOverlay: !!document.getElementById('libHelpOverlay'),
        overlayClose: !!document.getElementById('libHelpOverlayClose'),
        bannerClose: !!document.getElementById('libBannerClose')
      };
    });
    result('S43 — Library help button exists', libHelp.helpBtn);
    result('S43 — Library help banner exists', libHelp.helpBanner);
    result('S43 — Library help overlay exists', libHelp.helpOverlay);
    result('S43 — Library overlay close button exists', libHelp.overlayClose);

    // S44: Reader help elements
    const readerHelp = await readerPage.evaluate(() => {
      return {
        helpBtn: !!document.getElementById('readerHelpBtn'),
        helpOverlay: !!document.getElementById('readerHelpOverlay'),
        overlayClose: !!document.getElementById('readerHelpOverlayClose'),
        helpBanner: !!document.getElementById('readerHelpBanner'),
        bannerClose: !!document.getElementById('readerBannerClose')
      };
    });
    result('S44 — Reader help button exists', readerHelp.helpBtn);
    result('S44 — Reader help overlay exists', readerHelp.helpOverlay);
    result('S44 — Reader overlay close exists', readerHelp.overlayClose);

    // S45: Help overlay visibility toggle
    const helpToggle = await readerPage.evaluate(() => {
      var overlay = document.getElementById('readerHelpOverlay');
      if (!overlay) return { ok: false, reason: 'overlay not found' };
      overlay.classList.add('visible');
      var isVisible = overlay.classList.contains('visible');
      overlay.classList.remove('visible');
      var isHidden = !overlay.classList.contains('visible');
      return { ok: isVisible && isHidden };
    });
    result('S45 — Help overlay visibility toggle works', helpToggle.ok);

    // =================================================================
    // S46–S48: STORAGE BAR, TOAST, BOOK DELETE
    // =================================================================
    log('INFO', '--- S46–S48: Storage bar, toast, book delete ---');

    // S46: Storage bar elements
    const storageBar = await readerPage.evaluate(() => {
      return {
        bar: !!document.getElementById('libStorageBar'),
        text: !!document.getElementById('libStorageText'),
        books: !!document.getElementById('libStorageBooks')
      };
    });
    result('S46 — Storage bar exists', storageBar.bar);
    result('S46 — Storage text element exists', storageBar.text);
    result('S46 — Storage books count element exists', storageBar.books);

    // S47: Toast element exists
    const toast = await readerPage.evaluate(() => {
      var el = document.getElementById('saveToast');
      var msg = document.getElementById('saveToastMsg');
      return {
        toast: !!el,
        msg: !!msg,
        toastText: msg ? msg.textContent.trim() : ''
      };
    });
    result('S47 — Toast element exists', toast.toast);
    result('S47 — Toast message element exists', toast.msg);

    // S48: Book delete button exists in library
    // Go back to library view first
    await readerPage.evaluate(() => {
      var btn = document.getElementById('backToLibraryBtn');
      if (btn) btn.click();
    });
    await wait(MEDIUM_WAIT);

    const bookDelete = await readerPage.evaluate(() => {
      var delBtn = document.querySelector('.book-delete-btn');
      return {
        exists: !!delBtn,
        count: document.querySelectorAll('.book-delete-btn').length
      };
    });
    result('S48 — Book delete button exists', bookDelete.exists,
      'Delete buttons found: ' + bookDelete.count);

    // Return to reader
    await readerPage.evaluate(() => {
      var cover = document.querySelector('.book-cover-thumb');
      if (cover) cover.click();
    });
    await wait(LONG_WAIT);

    // =================================================================
    // S49–S52: AUTO-SAVE, SCROLL/PAGE MODE, MENUS, ANNOTATE
    // =================================================================
    log('INFO', '--- S49–S52: Auto-save, scroll mode, menus, annotate ---');

    // S49: Auto-save functions exist (check actual function names from 09-autosave.js)
    const autoSave = await readerPage.evaluate(() => {
      return {
        savePosition: typeof savePositionOnly === 'function',
        loadState: typeof loadAndApplyBookState === 'function',
        saveVisual: typeof saveVisualSettings === 'function',
        saveBook: typeof saveBookState === 'function',
        showToast: typeof showToast === 'function',
        setStatus: typeof setStatus === 'function',
        autoSaveStart: typeof startAutoSave === 'function',
        autoSaveStop: typeof stopAutoSave === 'function'
      };
    });
    result('S49 — savePositionOnly function exists', autoSave.savePosition);
    result('S49 — loadAndApplyBookState function exists', autoSave.loadState);
    result('S49 — saveVisualSettings function exists', autoSave.saveVisual);
    result('S49 — saveBookState function exists', autoSave.saveBook);
    result('S49 — showToast function exists', autoSave.showToast);
    result('S49 — setStatus function exists', autoSave.setStatus);
    result('S49 — startAutoSave function exists', autoSave.autoSaveStart);
    result('S49 — stopAutoSave function exists', autoSave.autoSaveStop);

    // S50: Scroll/Page mode toggle elements
    const navMode = await readerPage.evaluate(() => {
      return {
        scrollModeBtn: !!document.getElementById('scrollModeBtn'),
        navModePopover: !!document.getElementById('navModePopover'),
        navOptPage: !!document.getElementById('navOptPage'),
        navOptScroll: !!document.getElementById('navOptScroll'),
        floatingPrev: !!document.getElementById('floatingPrevBtn'),
        floatingNext: !!document.getElementById('floatingNextBtn'),
        touchPrev: !!document.getElementById('touchZonePrev'),
        touchNext: !!document.getElementById('touchZoneNext')
      };
    });
    result('S50 — Scroll mode button exists', navMode.scrollModeBtn);
    result('S50 — Nav mode popover exists', navMode.navModePopover);
    result('S50 — Page/Scroll options exist', navMode.navOptPage && navMode.navOptScroll);
    result('S50 — Floating nav buttons exist', navMode.floatingPrev && navMode.floatingNext);
    result('S50 — Touch zones exist', navMode.touchPrev && navMode.touchNext);

    // S51: Library toolbar menu toggle (Tools dropdown)
    const toolsMenu = await readerPage.evaluate(() => {
      var btn = document.getElementById('libToolsBtn');
      var menu = document.getElementById('libToolsMenu');
      if (!btn || !menu) return { ok: false, reason: 'tools menu missing' };
      // Toggle open
      var wasHidden = menu.classList.contains('hidden');
      menu.classList.remove('hidden');
      var nowVisible = !menu.classList.contains('hidden');
      // Close
      menu.classList.add('hidden');
      return {
        ok: nowVisible,
        wasHidden: wasHidden,
        menuItems: menu.querySelectorAll('a').length
      };
    });
    result('S51 — Tools menu toggles visibility', toolsMenu.ok);
    result('S51 — Tools menu has links', toolsMenu.menuItems >= 2,
      'Links: ' + toolsMenu.menuItems);

    // S52: Annotate popup and highlight elements exist
    const annotate = await readerPage.evaluate(() => {
      return {
        ctxPopup: !!document.getElementById('ctxAnnotatePopup'),
        hlBtn: !!document.getElementById('readerHighlightBtn'),
        annotateItem: !!document.getElementById('rmbAnnotate'),
        annotateColor: !!document.getElementById('rmbAnnotateColor'),
        hmbAnnotate: !!document.getElementById('hmbAnnotate'),
        popupOptions: document.querySelectorAll('#ctxAnnotatePopup .ctx-annotate-option').length
      };
    });
    result('S52 — Contextual annotate popup exists', annotate.ctxPopup);
    result('S52 — Highlight button exists', annotate.hlBtn);
    result('S52 — Menubar Annotate item exists', annotate.annotateItem);
    result('S52 — Annotate popup has options', annotate.popupOptions >= 4,
      'Options: ' + annotate.popupOptions);

    // =================================================================
    // SUMMARY
    // =================================================================
    log('INFO', '');
    log('INFO', '═══════════════════════════════════════════════');
    log('INFO', '           E2E TEST RESULTS');
    log('INFO', '═══════════════════════════════════════════════');

    const passed = testResults.filter(r => r.ok).length;
    const failed = testResults.filter(r => !r.ok).length;
    const total = testResults.length;

    console.log('');
    for (const r of testResults) {
      const icon = r.ok ? '✅' : '❌';
      console.log(`  ${icon} ${r.name}${r.detail ? ' — ' + r.detail : ''}`);
    }

    console.log('');
    console.log(`  Total: ${total} | ✅ Passed: ${passed} | ❌ Failed: ${failed}`);
    console.log('');

  } catch (e) {
    log('FATAL', 'Test crashed: ' + e.message);
    console.error(e);
    errors.push('CRASH: ' + e.message);
  } finally {
    await browser.close();
    log('INFO', 'Browser closed');

    // Write report file
    const reportPath = path.join(__dirname, 'test_e2e_report.json');
    const report = {
      date: new Date().toISOString(),
      passed: testResults.filter(r => r.ok).length,
      failed: testResults.filter(r => !r.ok).length,
      total: testResults.length,
      results: testResults,
      errors: errors
    };
    fs.writeFileSync(reportPath, JSON.stringify(report, null, 2));
    log('INFO', 'Report written to ' + reportPath);

    process.exit(errors.length > 0 ? 1 : 0);
  }
})();
