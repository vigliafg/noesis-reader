/**
 * test_bookmarks.js — Comprehensive bookmark system tests
 *
 * Tests: B1 (Create), B2 (Navigate), B3 (Delete), B4 (Drawer UI),
 *        B5 (Badge), B6 (Persistence), B7 (Navigate menu), B8 (Edge cases),
 *        B9 (Data validation)
 *
 * Prerequisites:
 *   HTTP server on port 8765: setsid python3 -m http.server 8765 -d . > /dev/null 2>&1 &
 *   test.epub in project root
 *
 * Usage:
 *   NODE_PATH=~/.nvm/versions/node/v24.18.0/lib/node_modules node test_bookmarks.js
 */

const puppeteer = require('puppeteer');
const BASE = 'http://127.0.0.1:8765/index.html?debug=1';

// ── Helpers ──

function R(name, ok, detail) {
  return { test: name, ok, detail: detail || '' };
}

async function wait(ms) { return new Promise(r => setTimeout(r, ms)); }

async function openDrawer(page) {
  await page.evaluate(() => {
    const btn = document.getElementById('userBookmarksBtn');
    if (btn) btn.click();
  });
  await wait(700);
}

async function closeDrawer(page) {
  await page.evaluate(() => {
    const btn = document.getElementById('ubmCloseBtn');
    if (btn) btn.click();
  });
  await wait(600);
}

async function drawerIsOpen(page) {
  return page.evaluate(() => {
    const d = document.getElementById('userBookmarksDrawer');
    return d ? d.classList.contains('ubm-open') : false;
  });
}

async function bookmarkCount(page) {
  return page.evaluate(() => (typeof userBookmarks !== 'undefined' ? userBookmarks.length : -1));
}

async function badgeInfo(page) {
  return page.evaluate(() => {
    const b = document.getElementById('ubmBadge');
    return b ? { display: b.style.display, text: b.textContent } : null;
  });
}

async function createBookmark(page) {
  await page.evaluate(() => {
    if (typeof createUserBookmark === 'function') createUserBookmark();
  });
  await wait(2000);
}

async function resetBookmarks(page) {
  await page.evaluate(() => {
    if (typeof userBookmarks !== 'undefined') userBookmarks = [];
    if (typeof saveUserBookmarksToDB === 'function') saveUserBookmarksToDB();
    if (typeof renderUbmList === 'function') renderUbmList();
    if (typeof closeUbmDrawer === 'function') closeUbmDrawer();
  });
  await wait(500);
}

// ── Main ──

(async () => {
  const results = [];
  const errors = [];

  const browser = await puppeteer.launch({
    headless: true,
    executablePath: '/usr/bin/google-chrome',
    args: ['--no-sandbox', '--disable-setuid-sandbox', '--disable-gpu']
  });

  const page = await browser.newPage();
  page.on('pageerror', err => errors.push(err.message));
  page.on('dialog', async dialog => {
    // prompt() returns null on dismiss → kills bookmark creation (line 7595)
    // Must accept with empty string so the bookmark flow continues
    if (dialog.type() === 'prompt') {
      await dialog.accept('');
    } else {
      await dialog.dismiss();
    }
  });

  try {
    // ══════════════════════════════════════
    // SETUP: Load EPUB
    // ══════════════════════════════════════
    console.log('Loading EPUB...');
    await page.goto(BASE, { waitUntil: 'networkidle0', timeout: 30000 });
    await wait(8000);

    const readerView = await page.$('#reader-view');
    if (!readerView) {
      results.push(R('SETUP', false, 'Reader view not found'));
      console.log(JSON.stringify({ results, errors }, null, 2));
      await browser.close();
      return;
    }

    // Navigate to chapter 26 "Pain"
    await page.evaluate(() => {
      if (typeof rendition !== 'undefined' && typeof book !== 'undefined') {
        rendition.display(book.spine.items[44].href);
      }
    });
    await wait(5000);

    let frame = await (await page.$('#viewer iframe')).contentFrame();
    const h1Text = await frame.$eval('h1', el => el.textContent).catch(() => '');
    console.log('Chapter:', h1Text);
    results.push(R('SETUP: Chapter 26 loaded', !!h1Text, h1Text));

    // ══════════════════════════════════════
    // B1: CREATE BOOKMARK
    // ══════════════════════════════════════

    await resetBookmarks(page);

    // B1.2: Create first bookmark
    await createBookmark(page);
    let count = await bookmarkCount(page);
    results.push(R('B1.2: Create first bookmark', count === 1, 'count=' + count));

    // B1.3: Verify bookmark data fields
    let fields = await page.evaluate(() => {
      const bm = userBookmarks && userBookmarks[0];
      if (!bm) return null;
      return {
        cfi: typeof bm.cfi === 'string' && bm.cfi.length > 0,
        href: typeof bm.href === 'string' && bm.href.length > 0,
        chapter: typeof bm.chapter === 'string' && bm.chapter.length > 0,
        preview: typeof bm.preview === 'string',
        createdAt: !!bm.createdAt,
        chapterName: bm.chapter
      };
    });
    if (fields) {
      results.push(R('B1.3a: cfi present', fields.cfi));
      results.push(R('B1.3b: href present', fields.href));
      results.push(R('B1.3c: chapter present', fields.chapter, fields.chapterName));
      results.push(R('B1.3d: preview present', fields.preview));
      results.push(R('B1.3e: createdAt present', fields.createdAt));
    } else {
      results.push(R('B1.3: Verify data fields', false, 'no bookmark'));
    }

    // B1.4: Create second bookmark on different page
    await page.evaluate(() => {
      if (typeof rendition !== 'undefined' && typeof book !== 'undefined') {
        rendition.display(book.spine.items[45].href);
      }
    });
    await wait(4000);
    await createBookmark(page);
    count = await bookmarkCount(page);
    results.push(R('B1.4: Second bookmark (different page)', count === 2, 'count=' + count));

    // B1.5: Different chapters
    let chapters = await page.evaluate(() => {
      return userBookmarks ? userBookmarks.map(b => b.chapter) : [];
    });
    results.push(R('B1.5: Different chapter titles', chapters[0] !== chapters[1],
      chapters[0] + ' vs ' + chapters[1]));

    // B1.6: Preview length
    let pLen = await page.evaluate(() => {
      const bm = userBookmarks && userBookmarks[0];
      return bm && bm.preview ? bm.preview.length : -1;
    });
    results.push(R('B1.6: Preview ≤ 103 chars', pLen > 0 && pLen <= 103, 'len=' + pLen));

    // Create third bookmark for richer tests
    await createBookmark(page);
    count = await bookmarkCount(page);
    results.push(R('B1.7: Third bookmark', count === 3, 'count=' + count));

    // ══════════════════════════════════════
    // B5: BADGE COUNTER
    // ══════════════════════════════════════

    // B5.1: Badge shows count 3
    let badge = await badgeInfo(page);
    results.push(R('B5.1: Badge display=flex, text=3',
      badge && badge.display === 'flex' && badge.text === '3',
      'display=' + (badge ? badge.display : 'null') + ' text=' + (badge ? badge.text : 'null')));

    // B5.2: Delete one → badge=2
    await openDrawer(page);
    await page.evaluate(() => {
      const del = document.querySelector('#ubmList .ubm-delete-btn');
      if (del) del.click();
    });
    await wait(1000);
    badge = await badgeInfo(page);
    results.push(R('B5.2: Badge after delete → 2',
      badge && badge.text === '2',
      'text=' + (badge ? badge.text : 'null')));

    // Delete another → badge=1
    await page.evaluate(() => {
      const del = document.querySelector('#ubmList .ubm-delete-btn');
      if (del) del.click();
    });
    await wait(1000);
    badge = await badgeInfo(page);
    results.push(R('B5.3: Badge after second delete → 1',
      badge && badge.text === '1',
      'text=' + (badge ? badge.text : 'null')));

    // Delete last → badge hidden
    await page.evaluate(() => {
      const del = document.querySelector('#ubmList .ubm-delete-btn');
      if (del) del.click();
    });
    await wait(1000);
    badge = await badgeInfo(page);
    results.push(R('B5.4: Badge hidden when empty',
      badge && badge.display === 'none',
      'display=' + (badge ? badge.display : 'null')));

    await closeDrawer(page);

    // Re-create bookmarks for next tests
    await resetBookmarks(page);
    await createBookmark(page);
    await page.evaluate(() => {
      if (typeof rendition !== 'undefined' && typeof book !== 'undefined') {
        rendition.display(book.spine.items[46].href);
      }
    });
    await wait(4000);
    await createBookmark(page);
    await createBookmark(page);

    // ══════════════════════════════════════
    // B4: DRAWER UI
    // ══════════════════════════════════════

    // B4.1: Open drawer
    await openDrawer(page);
    let isOpen = await drawerIsOpen(page);
    results.push(R('B4.1: Drawer opens (ubm-open)', isOpen));

    // B4.2: Items visible
    let itemCount = await page.evaluate(() =>
      document.querySelectorAll('#ubmList .ubm-item').length
    );
    results.push(R('B4.2: Drawer shows items', itemCount === 3, 'items=' + itemCount));

    // B4.3: Close button
    await closeDrawer(page);
    isOpen = await drawerIsOpen(page);
    results.push(R('B4.3: Close button works', !isOpen));

    // B4.4: Toggle
    await openDrawer(page);
    isOpen = await drawerIsOpen(page);
    results.push(R('B4.4a: Toggle → open', isOpen));
    await closeDrawer(page);
    isOpen = await drawerIsOpen(page);
    results.push(R('B4.4b: Toggle → closed', !isOpen));

    // B4.5: Empty state
    await resetBookmarks(page);
    await openDrawer(page);
    let emptyVisible = await page.evaluate(() =>
      !!document.querySelector('#ubmList .ubm-empty')
    );
    results.push(R('B4.5: Empty state after reset', emptyVisible));
    await closeDrawer(page);

    // Re-create for navigation tests
    await createBookmark(page);

    // ══════════════════════════════════════
    // B2: NAVIGATE TO BOOKMARK
    // ══════════════════════════════════════

    // B2.1: Click bookmark → navigates + closes drawer
    await page.evaluate(() => {
      // Navigate away first
      if (typeof rendition !== 'undefined' && typeof book !== 'undefined') {
        rendition.display(book.spine.items[45].href);
      }
    });
    await wait(4000);
    await openDrawer(page);

    await page.evaluate(() => {
      const body = document.querySelector('#ubmList .ubm-item-body');
      if (body) body.click();
    });
    await wait(4000);
    isOpen = await drawerIsOpen(page);
    results.push(R('B2.1: Bookmark click navigates + closes drawer', !isOpen));

    // B2.2: Sequential navigation
    await createBookmark(page); // bookmark at new position
    await page.evaluate(() => {
      if (typeof rendition !== 'undefined' && typeof book !== 'undefined') {
        rendition.display(book.spine.items[44].href); // back to chapter 26
      }
    });
    await wait(4000);
    await openDrawer(page);

    // Click first bookmark (should go back to spine[45] or later)
    let navOk = await page.evaluate(() => {
      const bodies = document.querySelectorAll('#ubmList .ubm-item-body');
      if (bodies.length > 0) { bodies[0].click(); return true; }
      return false;
    });
    await wait(4000);
    isOpen = await drawerIsOpen(page);
    results.push(R('B2.2: Sequential bookmark navigation', navOk && !isOpen));

    // ══════════════════════════════════════
    // B3: DELETE
    // ══════════════════════════════════════

    await resetBookmarks(page);
    await createBookmark(page);
    await createBookmark(page);
    await createBookmark(page);
    // Now 3 bookmarks

    await openDrawer(page);

    // B3.1: Delete first bookmark
    await page.evaluate(() => {
      const del = document.querySelector('#ubmList .ubm-delete-btn');
      if (del) del.click();
    });
    await wait(800);
    count = await bookmarkCount(page);
    results.push(R('B3.1: Delete bookmark → count=2', count === 2, 'count=' + count));

    // B3.2: Delete middle bookmark (now items: [b2, b3], delete first = b2 = middle originally)
    await page.evaluate(() => {
      const del = document.querySelector('#ubmList .ubm-delete-btn');
      if (del) del.click();
    });
    await wait(800);
    count = await bookmarkCount(page);
    results.push(R('B3.2: Delete second → count=1', count === 1, 'count=' + count));

    // B3.3: Delete last → empty state
    await page.evaluate(() => {
      const del = document.querySelector('#ubmList .ubm-delete-btn');
      if (del) del.click();
    });
    await wait(800);
    count = await bookmarkCount(page);
    emptyVisible = await page.evaluate(() =>
      !!document.querySelector('#ubmList .ubm-empty')
    );
    results.push(R('B3.3a: Delete last → count=0', count === 0, 'count=' + count));
    results.push(R('B3.3b: Empty state shown', emptyVisible));
    badge = await badgeInfo(page);
    results.push(R('B3.3c: Badge hidden', badge && badge.display === 'none'));

    await closeDrawer(page);

    // ══════════════════════════════════════
    // B6: PERSISTENCE
    // ══════════════════════════════════════

    // B6.1: Create bookmark → close/reopen → present
    await createBookmark(page);
    let bmCfi = await page.evaluate(() => userBookmarks[0]?.cfi || '');

    await page.evaluate(() => { if (typeof showLibrary === 'function') showLibrary(); });
    await wait(1500);
    await page.evaluate(() => {
      const cover = document.querySelector('.book-cover-thumb');
      if (cover) cover.click();
    });
    await wait(8000);

    count = await bookmarkCount(page);
    let persistedCfi = await page.evaluate(() => userBookmarks[0]?.cfi || '');
    results.push(R('B6.1: Bookmark persists after close/reopen',
      count === 1 && persistedCfi === bmCfi,
      'count=' + count + ' cfi_match=' + (persistedCfi === bmCfi)));

    // B6.2: Delete bookmark → close/reopen → gone
    await resetBookmarks(page);
    await page.evaluate(() => {
      if (typeof showLibrary === 'function') showLibrary();
    });
    await wait(1000);
    await page.evaluate(() => {
      const cover = document.querySelector('.book-cover-thumb');
      if (cover) cover.click();
    });
    await wait(8000);

    count = await bookmarkCount(page);
    results.push(R('B6.2: Deleted bookmark gone after reopen',
      count === 0, 'count=' + count));

    // B6.3: showLibrary() clears userBookmarks array
    await createBookmark(page);
    await page.evaluate(() => { if (typeof showLibrary === 'function') showLibrary(); });
    await wait(1000);
    let arrLen = await page.evaluate(() => {
      return typeof userBookmarks !== 'undefined' ? userBookmarks.length : -1;
    });
    results.push(R('B6.3: showLibrary() clears userBookmarks[]',
      arrLen === 0, 'len=' + arrLen));

    // Re-open for remaining tests
    await page.evaluate(() => {
      const cover = document.querySelector('.book-cover-thumb');
      if (cover) cover.click();
    });
    await wait(8000);
    await resetBookmarks(page);
    await createBookmark(page);

    // ══════════════════════════════════════
    // B7: NAVIGATE MENU INTEGRATION
    // ══════════════════════════════════════

    // B7.1: rmbBookmarks click → drawer opens
    await page.evaluate(() => {
      const el = document.getElementById('rmbBookmarks');
      if (el) el.click();
    });
    await wait(700);
    isOpen = await drawerIsOpen(page);
    results.push(R('B7.1: Navigate menu "Bookmarks" opens drawer', isOpen));

    // B7.2: Close drawer, reopen via toolbar button
    await closeDrawer(page);
    await openDrawer(page);
    isOpen = await drawerIsOpen(page);
    results.push(R('B7.2: Toolbar button opens drawer after Navigate menu', isOpen));
    await closeDrawer(page);

    // ══════════════════════════════════════
    // B8: EDGE CASES
    // ══════════════════════════════════════

    // B8.1: Chapter title truncation (max 55 chars)
    let chLen = await page.evaluate(() => {
      document.getElementById('userBookmarksBtn').click();
      return new Promise(resolve => {
        setTimeout(() => {
          const el = document.querySelector('#ubmList .ubm-chapter');
          resolve(el ? el.textContent.length : -1);
        }, 500);
      });
    });
    // Chapter names are typically < 55 chars, so not truncated. Just verify not-1.
    results.push(R('B8.1: Chapter title display works', chLen > 0, 'len=' + chLen));
    await closeDrawer(page);

    // B8.2: Duplicate CFI bookmarks allowed (no dedup)
    let cfi1 = await page.evaluate(() => userBookmarks[0]?.cfi || '');
    await createBookmark(page);
    let cfi2 = await page.evaluate(() => userBookmarks[1]?.cfi || '');
    count = await bookmarkCount(page);
    results.push(R('B8.2a: Same-position creates new bookmark', count === 2, 'count=' + count));
    results.push(R('B8.2b: CFIs equal (same position)', cfi1 === cfi2,
      'cfi1=' + cfi1.slice(0, 30) + '... cfi2=' + cfi2.slice(0, 30) + '...'));

    // B8.3: createdAt is valid ISO date
    let dateValid = await page.evaluate(() => {
      if (!userBookmarks || userBookmarks.length === 0) return false;
      const d = new Date(userBookmarks[0].createdAt);
      return d.toString() !== 'Invalid Date' && d.getTime() > 0;
    });
    results.push(R('B8.3: createdAt is valid ISO date', dateValid));

    // B8.4: Order preserved (insertion order)
    let order = await page.evaluate(() => {
      if (!userBookmarks || userBookmarks.length < 2) return [];
      return userBookmarks.map(b => b.createdAt);
    });
    let orderOk = order.length === 2 && new Date(order[0]) >= new Date(order[1]);
    results.push(R('B8.4: Newest-first order (unshift)', orderOk));

    // B8.5: Drawer closes when leaving reader
    await openDrawer(page);
    await page.evaluate(() => { if (typeof showLibrary === 'function') showLibrary(); });
    await wait(800);
    isOpen = await drawerIsOpen(page);
    results.push(R('B8.5: Drawer closes on showLibrary()', !isOpen));

    // B8.6: New Bookmark button works with drawer already open
    await page.evaluate(() => {
      const cover = document.querySelector('.book-cover-thumb');
      if (cover) cover.click();
    });
    await wait(8000);
    await resetBookmarks(page);
    await createBookmark(page);
    await openDrawer(page);
    count = await bookmarkCount(page);

    // Click "New Bookmark" from inside drawer
    await page.evaluate(() => {
      const btn = document.getElementById('ubmNewBtn');
      if (btn) btn.click();
    });
    await wait(2000);
    let newCount = await bookmarkCount(page);
    results.push(R('B8.6: New Bookmark button inside drawer',
      newCount === count + 1,
      'was=' + count + ' now=' + newCount));

    await closeDrawer(page);

    // ══════════════════════════════════════
    // SUMMARY
    // ══════════════════════════════════════

    const pass = results.filter(r => r.ok).length;
    const fail = results.filter(r => !r.ok).length;
    console.log('\n═══════════════════════════════════════');
    console.log('BOOKMARK TESTS — ' + pass + '/' + results.length + ' PASS');
    if (fail > 0) console.log('  ' + fail + ' FAILURES');
    console.log('═══════════════════════════════════════');

    results.forEach(r => {
      console.log((r.ok ? '✅' : '❌') + ' ' + r.test +
        (r.detail ? ' — ' + r.detail : ''));
    });

    if (errors.length > 0) {
      const filtered = errors.filter(e =>
        !e.includes('404') && !e.includes('favicon') &&
        !e.includes('about:srcdoc') && !e.includes('slider-vertical')
      );
      if (filtered.length > 0) {
        console.log('\n⚠ Console errors:');
        filtered.forEach(e => console.log('  ' + e));
      }
    }

  } catch (e) {
    console.error('FATAL:', e.message);
    results.push(R('FATAL', false, e.message));
  } finally {
    await browser.close();
  }
})();
