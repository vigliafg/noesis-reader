#!/usr/bin/env node
/**
 * test_bookmarks.js — End-to-end test for User Bookmarks feature
 *
 * Tests:
 *   B1 — Drawer: open via menubar, verify visible, close via close button
 *   B2 — Create bookmark via direct call (dialog accepted), verify badge = 1
 *   B3 — Drawer renders the bookmark with chapter, preview, label
 *   B4 — Delete bookmark, verify badge back to 0
 *   B5 — Persistence: save to IndexedDB, verify with direct DB read, reload via loadUserBookmarksFromDB
 *
 * Usage:
 *   npm test  (runs via build/test.js which starts its own server)
 */

const puppeteer = require('puppeteer');
const path = require('path');
const fs = require('fs');

// ── Configuration ──────────────────────────────────────────────────
const BASE_URL = process.env.NOESIS_BASE_URL || 'http://127.0.0.1:8765';
const TIMEOUT = 60000;
const SHORT_WAIT = 800;
const MEDIUM_WAIT = 2500;
const LONG_WAIT = 6000;

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

// ── Main test runner ────────────────────────────────────────────────
(async () => {
  log('INFO', 'Starting Bookmark E2E test suite');
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
    log('INFO', 'Server reachable');
  } catch (e) {
    log('FATAL', 'Cannot reach server: ' + e.message);
    process.exit(1);
  }

  browser = await puppeteer.launch({
    headless: 'new',
    executablePath: '/usr/bin/google-chrome',
    args: ['--no-sandbox', '--disable-setuid-sandbox', '--disable-dev-shm-usage', '--disable-gpu', '--window-size=1280,800'],
    defaultViewport: { width: 1280, height: 800 }
  });

  page = await browser.newPage();
  page.setDefaultTimeout(TIMEOUT);

  // Accept bookmark label prompts (press OK with empty label)
  page.on('dialog', async (dialog) => {
    if (dialog.type() === 'prompt') {
      await dialog.accept('');
    } else {
      await dialog.dismiss();
    }
  });

  try {
    // =================================================================
    // B1: DRAWER — OPEN AND CLOSE
    // =================================================================
    log('INFO', '--- B1: Drawer open/close ---');

    await page.goto(BASE_URL + '/index.html?debug=1', { waitUntil: 'networkidle2' });
    await wait(LONG_WAIT + 2000);

    const readerVisible = await page.evaluate(() => {
      const rv = document.getElementById('reader-view');
      return rv && rv.style.display !== 'none';
    });
    result('B1 — Reader loaded', readerVisible);
    if (!readerVisible) throw new Error('Reader did not load');

    const rmbBookmarks = await page.$('#rmbBookmarks');
    result('B1 — Menubar Bookmarks button exists', !!rmbBookmarks);

    if (rmbBookmarks) {
      await rmbBookmarks.click();
      await wait(MEDIUM_WAIT);

      const drawerOpen = await page.evaluate(() => {
        const d = document.getElementById('userBookmarksDrawer');
        return d && d.classList.contains('ubm-open');
      });
      result('B1 — Drawer opens on menubar click', drawerOpen);

      const emptyMsg = await page.evaluate(() => {
        const list = document.getElementById('ubmList');
        const empty = list ? list.querySelector('.ubm-empty') : null;
        return empty ? empty.textContent.trim() : '';
      });
      result('B1 — Empty state message shown', emptyMsg.includes('No bookmarks yet'),
        'Text: "' + emptyMsg + '"');

      const closeBtn = await page.$('#ubmCloseBtn');
      if (closeBtn) {
        await closeBtn.click();
        await wait(SHORT_WAIT);
        const drawerClosed = await page.evaluate(() => {
          const d = document.getElementById('userBookmarksDrawer');
          return d && !d.classList.contains('ubm-open');
        });
        result('B1 — Drawer closes via close button', drawerClosed);
      } else {
        result('B1 — Close button found', false, '#ubmCloseBtn missing');
      }
    }

    // =================================================================
    // B2: CREATE BOOKMARK
    // =================================================================
    log('INFO', '--- B2: Create bookmark ---');

    let ready = false;
    for (let i = 0; i < 10; i++) {
      const status = await page.evaluate(() => {
        const t = window.__test;
        return !!(t && t.rendition && t.book);
      });
      if (status) { ready = true; break; }
      await wait(2000);
    }
    result('B2 — Rendition ready', ready);
    if (!ready) throw new Error('Rendition never became ready');

    await page.evaluate(() => {
      const items = window.__test.book.spine.items;
      if (items.length > 2) window.__test.rendition.display(items[2].href);
    });
    await wait(LONG_WAIT + 2000);

    await page.evaluate(() => window.__test.createUserBookmark());
    await wait(MEDIUM_WAIT);

    const badgeText = await page.evaluate(() => {
      const b = document.getElementById('ubmBadge');
      return b ? { text: b.textContent, display: b.style.display } : null;
    });
    result('B2 — Badge shows 1 after create', badgeText && badgeText.text === '1',
      'Badge: ' + JSON.stringify(badgeText));

    const bmCount = await page.evaluate(() => (window.__test.userBookmarks || []).length);
    result('B2 — In-memory array has 1 bookmark', bmCount === 1, 'Count: ' + bmCount);

    // =================================================================
    // B3: DRAWER RENDERS BOOKMARK
    // =================================================================
    log('INFO', '--- B3: Drawer renders bookmark ---');

    await page.evaluate(() => window.__test.openUbmDrawer());
    await wait(MEDIUM_WAIT);

    const drawerItems = await page.evaluate(() => {
      const items = document.querySelectorAll('#ubmList .ubm-item');
      return {
        count: items.length,
        hasChapter: items.length > 0 ? !!items[0].querySelector('.ubm-chapter') : false,
        hasPreview: items.length > 0 ? !!items[0].querySelector('.ubm-preview') : false,
        chapterText: items.length > 0 ? items[0].querySelector('.ubm-chapter').textContent.trim() : '',
        hasDeleteBtn: items.length > 0 ? !!items[0].querySelector('.ubm-delete-btn') : false,
        hasLabel: items.length > 0 ? !!items[0].querySelector('.ubm-label') : false,
      };
    });
    result('B3 — Drawer shows 1 bookmark item', drawerItems.count === 1);
    result('B3 — Item has chapter title', drawerItems.hasChapter, 'Chapter: ' + drawerItems.chapterText);
    result('B3 — Item has preview text', drawerItems.hasPreview);
    result('B3 — Item has delete button', drawerItems.hasDeleteBtn);
    result('B3 — No label shown (prompt accepted empty)', !drawerItems.hasLabel);

    await page.evaluate(() => window.__test.closeUbmDrawer());
    await wait(SHORT_WAIT);

    // =================================================================
    // B4: DELETE BOOKMARK
    // =================================================================
    log('INFO', '--- B4: Delete bookmark ---');

    await page.evaluate(() => window.__test.openUbmDrawer());
    await wait(SHORT_WAIT);

    const deleted = await page.evaluate(() => {
      const btn = document.querySelector('#ubmList .ubm-delete-btn');
      if (!btn) return false;
      btn.click();
      return true;
    });
    await wait(MEDIUM_WAIT);
    result('B4 — Delete button clicked', deleted);

    const afterDel = await page.evaluate(() => (window.__test.userBookmarks || []).length);
    result('B4 — In-memory array empty after delete', afterDel === 0);

    const badgeAfterDel = await page.evaluate(() => {
      const b = document.getElementById('ubmBadge');
      return b ? { text: b.textContent, display: b.style.display } : null;
    });
    result('B4 — Badge hidden after delete',
      badgeAfterDel && badgeAfterDel.display === 'none',
      'Display: ' + (badgeAfterDel ? badgeAfterDel.display : 'null'));

    const emptyAfterDel = await page.evaluate(() => {
      const empty = document.querySelector('#ubmList .ubm-empty');
      return empty ? empty.textContent.includes('No bookmarks yet') : false;
    });
    result('B4 — Empty state restored after delete', emptyAfterDel);

    await page.evaluate(() => window.__test.closeUbmDrawer());
    await wait(SHORT_WAIT);

    // =================================================================
    // B5: PERSISTENCE — SAVE TO INDEXEDDB, VERIFY DIRECTLY
    // =================================================================
    log('INFO', '--- B5: Persistence ---');

    // Navigate to another chapter for variety
    await page.evaluate(() => {
      const items = window.__test.book.spine.items;
      if (items.length > 5) window.__test.rendition.display(items[5].href);
    });
    await wait(LONG_WAIT + 2000);

    // Create a bookmark with a label
    page.removeAllListeners('dialog');
    page.on('dialog', async (dialog) => {
      if (dialog.type() === 'prompt') await dialog.accept('Test Label');
      else await dialog.dismiss();
    });

    await page.evaluate(() => window.__test.createUserBookmark());
    await wait(MEDIUM_WAIT);

    // Restore default handler
    page.removeAllListeners('dialog');
    page.on('dialog', async (dialog) => {
      if (dialog.type() === 'prompt') await dialog.accept('');
      else await dialog.dismiss();
    });

    const preSave = await page.evaluate(() => (window.__test.userBookmarks || []).length);
    result('B5 — Bookmark in memory', preSave === 1, 'Count: ' + preSave);

    // Save and capture bookId
    const savedData = await page.evaluate(async () => {
      await window.__test.saveUserBookmarksToDB();
      return {
        bookId: window.__test.currentBookId,
        count: (window.__test.userBookmarks || []).length,
        hasCfi: !!(window.__test.userBookmarks[0] && window.__test.userBookmarks[0].cfi),
        label: window.__test.userBookmarks[0] ? window.__test.userBookmarks[0].label : '',
      };
    });
    await wait(MEDIUM_WAIT);

    result('B5 — Saved to DB', savedData.count === 1);
    result('B5 — Bookmark has CFI', savedData.hasCfi);
    result('B5 — Label is "Test Label"', savedData.label === 'Test Label',
      'Label: "' + savedData.label + '"');

    // Verify directly in IndexedDB
    const dbCheck = await page.evaluate((bookId) => {
      return new Promise((resolve) => {
        try {
          const req = indexedDB.open('EpubLibraryDB', 1);
          req.onsuccess = function(e) {
            const db = e.target.result;
            const getReq = db.transaction('books', 'readonly').objectStore('books').get(bookId);
            getReq.onsuccess = function() {
              const r = getReq.result;
              db.close();
              const ok = r && Array.isArray(r.userBookmarks) && r.userBookmarks.length === 1;
              resolve({
                found: ok,
                count: ok ? r.userBookmarks.length : 0,
                hasLabel: ok && r.userBookmarks[0].label === 'Test Label',
              });
            };
            getReq.onerror = () => { db.close(); resolve({ found: false }); };
          };
          req.onerror = () => resolve({ found: false });
        } catch(e) { resolve({ found: false }); }
      });
    }, savedData.bookId);
    result('B5 — Persisted in IndexedDB', dbCheck.found && dbCheck.count === 1,
      'Found: ' + dbCheck.found + ', count: ' + dbCheck.count);
    result('B5 — Label persisted in IndexedDB', dbCheck.hasLabel);

    // Clear memory, then reload from DB
    await page.evaluate(() => {
      window.__test.userBookmarks.splice(0);
      window.__test.renderUbmList();
    });
    await wait(SHORT_WAIT);

    const cleared = await page.evaluate(() => (window.__test.userBookmarks || []).length);
    result('B5 — Cleared from memory', cleared === 0);

    await page.evaluate((bookId) => window.__test.loadUserBookmarksFromDB(bookId), savedData.bookId);
    await wait(MEDIUM_WAIT);

    const restored = await page.evaluate(() => (window.__test.userBookmarks || []).length);
    result('B5 — Restored via loadUserBookmarksFromDB', restored === 1,
      'Count: ' + restored);

    if (restored > 0) {
      const rLabel = await page.evaluate(() =>
        window.__test.userBookmarks[0] ? window.__test.userBookmarks[0].label : '');
      result('B5 — Label restored correctly', rLabel === 'Test Label',
        'Label: "' + rLabel + '"');
    }

    // Clean up for next run
    await page.evaluate(() => {
      window.__test.userBookmarks.splice(0);
      window.__test.renderUbmList();
      window.__test.saveUserBookmarksToDB();
    });
    await wait(SHORT_WAIT);

    // =================================================================
    // SUMMARY
    // =================================================================
    log('INFO', '');
    log('INFO', '═══════════════════════════════════════════════');
    log('INFO', '         BOOKMARK E2E TEST RESULTS');
    log('INFO', '═══════════════════════════════════════════════');

    const passed = testResults.filter(r => r.ok).length;
    const failed = testResults.filter(r => !r.ok).length;
    const total = testResults.length;

    console.log('');
    for (const r of testResults) {
      console.log(`  ${r.ok ? '✅' : '❌'} ${r.name}${r.detail ? ' — ' + r.detail : ''}`);
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

    const reportPath = path.join(__dirname, 'test_bookmarks_report.json');
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
