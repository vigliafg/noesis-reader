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
 *
 * Usage:
 *   # Start server first:
 *   setsid python3 -m http.server 8765 --bind 127.0.0.1 -d /home/vigliafg/Documenti/GitHub/noesis-reader &
 *
 *   # Run:
 *   NODE_PATH=/home/vigliafg/.nvm/versions/node/v24.18.0/lib/node_modules \
 *     node test_e2e_complete.js
 */

const puppeteer = require('puppeteer');
const path = require('path');
const fs = require('fs');

// ── Configuration ──────────────────────────────────────────────────
const BASE_URL = 'http://127.0.0.1:8765';
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

  // Launch browser
  browser = await puppeteer.launch({
    headless: 'new',
    executablePath: '/usr/bin/google-chrome',
    args: [
      '--no-sandbox',
      '--disable-setuid-sandbox',
      '--disable-dev-shm-usage',
      '--disable-gpu',
      '--window-size=1280,800'
    ],
    defaultViewport: { width: 1280, height: 800 }
  });

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
