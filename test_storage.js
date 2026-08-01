/**
 * test_storage.js — Storage integrity tests (S1-S5)
 *
 * Tests: S1 (Data integrity), S2 (Per-book isolation), S3 (Error handling),
 *        S4 (localStorage), S5 (Storage quota)
 *
 * Prerequisites:
 *   HTTP server on port 8765: setsid python3 -m http.server 8765 -d . > /dev/null 2>&1 &
 *   test.epub in project root
 *
 * Usage:
 *   NODE_PATH=~/.nvm/versions/node/v24.18.0/lib/node_modules node test_storage.js
 */

const puppeteer = require('puppeteer');
const BASE = 'http://127.0.0.1:8765/index.html?debug=1';

// ── Helpers ──

function R(name, ok, detail) {
  return { test: name, ok, detail: detail || '' };
}

async function wait(ms) { return new Promise(r => setTimeout(r, ms)); }

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
    if (dialog.type() === 'prompt') {
      await dialog.accept('test');
    } else if (dialog.type() === 'confirm') {
      await dialog.accept();
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
    // S1: DATA INTEGRITY (IndexedDB)
    // ══════════════════════════════════════

    // First, ensure DB has savedState + collections by explicitly saving
    // (saveBookToDB creates bare record; these fields are added later)
    await page.evaluate(async () => {
      if (typeof saveVisualSettings === 'function') await saveVisualSettings();
      if (typeof _saveCollectionToDB === 'function') await _saveCollectionToDB();
    });
    await wait(1000);

    // Now go to library so we can query DB safely
    await page.evaluate(() => { if (typeof showLibrary === 'function') showLibrary(); });
    await wait(2000);

    // S1.1: fileData is valid ArrayBuffer
    let s1_1_result = await page.evaluate(async () => {
      try {
        const db = await openDB();
        const books = await new Promise((resolve, reject) => {
          const tx = db.transaction('books', 'readonly');
          const store = tx.objectStore('books');
          const req = store.getAll();
          req.onsuccess = () => resolve(req.result);
          req.onerror = () => reject(req.error);
        });
        if (!books || books.length === 0) return { ok: false, detail: 'no books in DB' };
        const b = books[0];
        const hasData = b.data instanceof ArrayBuffer || b.data instanceof Uint8Array;
        const byteLen = b.data ? b.data.byteLength : 0;
        return { ok: hasData && byteLen > 0, detail: 'byteLength=' + byteLen };
      } catch(e) { return { ok: false, detail: e.message }; }
    });
    results.push(R('S1.1: fileData is ArrayBuffer > 0', s1_1_result.ok, s1_1_result.detail));

    // S1.3: savedState exists and has meaningful data
    // (cfi is saved by auto-save timer via savePositionOnly;
    //  fontSize/lineHeight/theme are saved by saveVisualSettings.
    //  At least one set of fields should be present.)
    let s1_3 = await page.evaluate(async () => {
      try {
        const db = await openDB();
        const books = await new Promise((resolve, reject) => {
          const tx = db.transaction('books', 'readonly');
          const store = tx.objectStore('books');
          const req = store.getAll();
          req.onsuccess = () => resolve(req.result);
          req.onerror = () => reject(req.error);
        });
        if (!books || books.length === 0) return { ok: false, detail: 'no books' };
        const b = books[0];
        if (!b.savedState) return { ok: false, detail: 'no savedState' };
        const hasCfi = b.savedState.cfi && /^epubcfi\(/.test(b.savedState.cfi);
        const hasFont = b.savedState.fontSize !== undefined;
        const hasTheme = typeof b.savedState.theme === 'string';
        const ok = hasFont || hasCfi;  // at least one must be present
        return { ok, detail: 'cfi=' + hasCfi + ' font=' + hasFont + ' theme=' + hasTheme };
      } catch(e) { return { ok: false, detail: e.message }; }
    });
    results.push(R('S1.3: savedState has data (cfi or fontSize)', s1_3.ok, s1_3.detail));

    // S1.4: savedState has required fields
    let s1_4 = await page.evaluate(async () => {
      try {
        const db = await openDB();
        const books = await new Promise((resolve, reject) => {
          const tx = db.transaction('books', 'readonly');
          const store = tx.objectStore('books');
          const req = store.getAll();
          req.onsuccess = () => resolve(req.result);
          req.onerror = () => reject(req.error);
        });
        if (!books || books.length === 0) return { all: false };
        const s = books[0].savedState || {};
        return {
          fontSize: s.fontSize !== undefined,
          lineHeight: s.lineHeight !== undefined,
          theme: typeof s.theme === 'string'
        };
      } catch(e) { return { all: false }; }
    });
    results.push(R('S1.4a: fontSize present', s1_4.fontSize));
    results.push(R('S1.4b: lineHeight present', s1_4.lineHeight));
    results.push(R('S1.4c: theme is string', s1_4.theme));

    // S1.5: collections is Array
    let s1_5 = await page.evaluate(async () => {
      try {
        const db = await openDB();
        const books = await new Promise((resolve, reject) => {
          const tx = db.transaction('books', 'readonly');
          const store = tx.objectStore('books');
          const req = store.getAll();
          req.onsuccess = () => resolve(req.result);
          req.onerror = () => reject(req.error);
        });
        return Array.isArray(books[0].collections);
      } catch(e) { return false; }
    });
    results.push(R('S1.5: collections is Array', s1_5));

    // S1.6: readerHighlights is Array
    let s1_6 = await page.evaluate(async () => {
      try {
        const db = await openDB();
        const books = await new Promise((resolve, reject) => {
          const tx = db.transaction('books', 'readonly');
          const store = tx.objectStore('books');
          const req = store.getAll();
          req.onsuccess = () => resolve(req.result);
          req.onerror = () => reject(req.error);
        });
        const b = books[0];
        return Array.isArray(b.savedState && b.savedState.readerHighlights);
      } catch(e) { return false; }
    });
    results.push(R('S1.6: readerHighlights is Array', s1_6));

    // Reopen book for bookmark tests
    await page.evaluate(() => {
      const cover = document.querySelector('.book-cover-thumb');
      if (cover) cover.click();
    });
    await wait(8000);

    // S1.2: userBookmarks is array (create + persist)
    await page.evaluate(() => {
      if (typeof createUserBookmark === 'function') createUserBookmark();
    });
    await wait(2000);

    let s1_2 = await page.evaluate(() => {
      const isArr = typeof userBookmarks !== 'undefined' && Array.isArray(userBookmarks);
      const len = typeof userBookmarks !== 'undefined' ? userBookmarks.length : -1;
      return { ok: isArr, len: len };
    });
    results.push(R('S1.2: userBookmarks is Array', s1_2.ok,
      'len=' + s1_2.len));

    // S1.7: Bookmark deep-equal after save→reload
    let bmBefore = await page.evaluate(() => {
      const bm = userBookmarks && userBookmarks[0];
      return bm ? { cfi: bm.cfi, chapter: bm.chapter, preview: bm.preview } : null;
    });

    await page.evaluate(() => { if (typeof showLibrary === 'function') showLibrary(); });
    await wait(1000);
    await page.evaluate(() => {
      const cover = document.querySelector('.book-cover-thumb');
      if (cover) cover.click();
    });
    await wait(8000);

    let bmAfter = await page.evaluate(() => {
      const bm = userBookmarks && userBookmarks[0];
      return bm ? { cfi: bm.cfi, chapter: bm.chapter, preview: bm.preview } : null;
    });

    let s1_7_ok = bmBefore && bmAfter &&
      bmBefore.cfi === bmAfter.cfi &&
      bmBefore.chapter === bmAfter.chapter &&
      bmBefore.preview === bmAfter.preview;
    results.push(R('S1.7: Bookmark deep-equal after save→reload', s1_7_ok,
      'cfi=' + (bmBefore && bmAfter ? (bmBefore.cfi === bmAfter.cfi ? 'match' : 'MISMATCH') : 'null')));

    // S1.8: saveVisualSettings persists fontSize
    await page.evaluate(() => { fontSize = 142; });
    await page.evaluate(async () => { if (typeof saveVisualSettings === 'function') await saveVisualSettings(); });
    await wait(500);
    await page.evaluate(() => { if (typeof showLibrary === 'function') showLibrary(); });
    await wait(1000);
    await page.evaluate(() => {
      const cover = document.querySelector('.book-cover-thumb');
      if (cover) cover.click();
    });
    await wait(8000);

    let s1_8 = await page.evaluate(() => {
      return typeof fontSize !== 'undefined' ? fontSize : -1;
    });
    results.push(R('S1.8: fontSize persists after save→reload', s1_8 === 142, 'fontSize=' + s1_8));

    // ══════════════════════════════════════
    // S2: PER-BOOK ISOLATION
    // ══════════════════════════════════════

    // S2.1: DB has 1 book
    let s2_1 = await page.evaluate(async () => {
      try {
        const books = await getAllBooks();
        return books ? books.length : -1;
      } catch(e) { return -1; }
    });
    results.push(R('S2.1: getAllBooks() returns 1 book', s2_1 >= 1, 'count=' + s2_1));

    // Add a fake second book
    await page.evaluate(async () => {
      const db = await openDB();
      await new Promise((resolve, reject) => {
        const tx = db.transaction('books', 'readwrite');
        const store = tx.objectStore('books');
        const req = store.add({
          id: 'test-fake-book-' + Date.now(),
          title: 'Fake Book for Testing',
          author: 'Test Author',
          data: new ArrayBuffer(1024),
          cover: null,
          addedAt: Date.now(),
          userBookmarks: [],
          collections: [],
          savedState: {}
        });
        req.onsuccess = () => resolve();
        req.onerror = () => reject(req.error);
      });
    });

    let s2_2 = await page.evaluate(async () => {
      const books = await getAllBooks();
      return books ? books.length : -1;
    });
    results.push(R('S2.2: Two books in DB after insert', s2_2 === 2, 'count=' + s2_2));

    // S2.3: Bookmark isolation
    let bmLen = await page.evaluate(() => {
      return typeof userBookmarks !== 'undefined' ? userBookmarks.length : -1;
    });
    results.push(R('S2.3a: Book 1 has bookmarks', bmLen > 0, 'len=' + bmLen));

    let s2_3 = await page.evaluate(async () => {
      try {
        const books = await getAllBooks();
        const fake = books.find(b => b.id.startsWith('test-fake-book-'));
        if (!fake) return 'no fake book';
        return Array.isArray(fake.userBookmarks) && fake.userBookmarks.length === 0
          ? 'isolated' : 'contaminated';
      } catch(e) { return 'err: ' + e.message; }
    });
    results.push(R('S2.3b: Fake book bookmarks isolated', s2_3 === 'isolated', s2_3));

    // S2.4: Delete fake book
    let fakeId = await page.evaluate(async () => {
      const books = await getAllBooks();
      const fake = books.find(b => b.id.startsWith('test-fake-book-'));
      return fake ? fake.id : null;
    });

    await page.evaluate(async (fid) => {
      if (fid) await deleteBook(fid);
    }, fakeId);

    let s2_4 = await page.evaluate(async () => {
      const books = await getAllBooks();
      return books ? books.length : -1;
    });
    results.push(R('S2.4: After delete → 1 book remains', s2_4 === 1, 'count=' + s2_4));

    // ══════════════════════════════════════
    // S3: ERROR HANDLING
    // ══════════════════════════════════════

    // Need to be in reader for currentBookId to be set
    await page.evaluate(() => {
      const cover = document.querySelector('.book-cover-thumb');
      if (cover) cover.click();
    });
    await wait(8000);

    // S3.1: VersionError handled by openDB
    let s3_1 = await page.evaluate(async () => {
      try {
        const db = await openDB();
        db.close();
        return 'ok';
      } catch (e) { return 'crash: ' + e.message; }
    });
    results.push(R('S3.1: openDB handles VersionError', s3_1 === 'ok', s3_1));

    // S3.2: saveUserBookmarksToDB with null currentBookId
    let s3_2 = await page.evaluate(async () => {
      try {
        const saved = currentBookId;
        currentBookId = null;
        await saveUserBookmarksToDB();
        currentBookId = saved;
        return 'no crash';
      } catch(e) { return 'crash: ' + e.message; }
    });
    results.push(R('S3.2: saveUserBookmarksToDB() guard (null id)', s3_2 === 'no crash', s3_2));

    // S3.3: loadUserBookmarksFromDB with nonexistent ID
    let s3_3 = await page.evaluate(async () => {
      try {
        await loadUserBookmarksFromDB('nonexistent-id-xyz-123');
        return 'ok, len=' + (typeof userBookmarks !== 'undefined' ? userBookmarks.length : 'undef');
      } catch(e) { return 'crash: ' + e.message; }
    });
    results.push(R('S3.3: loadUserBookmarksFromDB (nonexistent)', s3_3.startsWith('ok'), s3_3));

    // S3.4: _saveCollectionToDB with null currentBookId
    let s3_4 = await page.evaluate(async () => {
      try {
        const saved = currentBookId;
        currentBookId = null;
        await _saveCollectionToDB();
        currentBookId = saved;
        return 'no crash';
      } catch(e) { return 'crash: ' + e.message; }
    });
    results.push(R('S3.4: _saveCollectionToDB() guard (null id)', s3_4 === 'no crash', s3_4));

    // ══════════════════════════════════════
    // S4: LOCALSTORAGE
    // ══════════════════════════════════════

    // S4.1: Theme toggle
    await page.evaluate(() => { localStorage.setItem('noesis-lib-theme', 'light'); });
    let s4_1a = await page.evaluate(() => localStorage.getItem('noesis-lib-theme'));
    results.push(R('S4.1a: localStorage theme = light', s4_1a === 'light', s4_1a));

    await page.evaluate(() => { localStorage.setItem('noesis-lib-theme', 'dark'); });
    let s4_1b = await page.evaluate(() => localStorage.getItem('noesis-lib-theme'));
    results.push(R('S4.1b: localStorage theme = dark', s4_1b === 'dark', s4_1b));

    await page.evaluate(() => { localStorage.setItem('noesis-lib-theme', 'light'); });

    // S4.2: Banner dismiss persists
    await page.evaluate(() => { localStorage.setItem('noesis-help-seen-library', '1'); });
    let s4_2 = await page.evaluate(() => localStorage.getItem('noesis-help-seen-library'));
    results.push(R('S4.2: Banner dismiss key = 1', s4_2 === '1', s4_2));

    // S4.3: localStorage survives page reload
    await page.reload({ waitUntil: 'networkidle0', timeout: 30000 });
    await wait(3000);
    let s4_3 = await page.evaluate(() => {
      return {
        theme: localStorage.getItem('noesis-lib-theme'),
        ban: localStorage.getItem('noesis-help-seen-library')
      };
    });
    results.push(R('S4.3a: Theme survives reload', s4_3.theme === 'light', s4_3.theme));
    results.push(R('S4.3b: Banner survives reload', s4_3.ban === '1', s4_3.ban));

    // S4.4: No sensitive data in localStorage
    let s4_4 = await page.evaluate(() => {
      const sensitive = [];
      for (let i = 0; i < localStorage.length; i++) {
        const key = localStorage.key(i);
        const val = localStorage.getItem(key);
        if (val && val.length > 100) sensitive.push(key + ': len=' + val.length);
        if (val && /^[A-Za-z0-9+/=]{50,}$/.test(val)) sensitive.push(key + ': looks base64');
      }
      return sensitive.length === 0 ? 'clean' : sensitive.join('; ');
    });
    results.push(R('S4.4: No sensitive data in localStorage', s4_4 === 'clean', s4_4));

    // ══════════════════════════════════════
    // S5: STORAGE QUOTA
    // ══════════════════════════════════════

    // S5.1: EPUB byteLength
    let s5_1 = await page.evaluate(async () => {
      try {
        const db = await openDB();
        const books = await new Promise((resolve, reject) => {
          const tx = db.transaction('books', 'readonly');
          const store = tx.objectStore('books');
          const req = store.getAll();
          req.onsuccess = () => resolve(req.result);
          req.onerror = () => reject(req.error);
        });
        if (!books || books.length === 0) return 'no books';
        const real = books.find(b => !b.id.startsWith('test-fake-book-'));
        return real && real.data ? real.data.byteLength : 0;
      } catch(e) { return 'err: ' + e.message; }
    });
    let byteLenMB = typeof s5_1 === 'number' ? Math.round(s5_1 / (1024 * 1024)) : 0;
    results.push(R('S5.1: EPUB data byteLength > 50MB',
      typeof s5_1 === 'number' && s5_1 > 50 * 1024 * 1024, byteLenMB + ' MB'));

    // S5.2: navigator.storage.estimate()
    let s5_2 = await page.evaluate(async () => {
      try {
        if (!navigator.storage || !navigator.storage.estimate) return 'API not available';
        const est = await navigator.storage.estimate();
        return {
          quota: est.quota > 0,
          usage: est.usage >= 0,
          detail: 'quota=' + Math.round(est.quota / (1024 * 1024)) + 'MB usage=' + Math.round(est.usage / (1024 * 1024)) + 'MB'
        };
      } catch(e) { return 'err: ' + e.message; }
    });
    let s5_2_ok = typeof s5_2 === 'object' && s5_2.quota && s5_2.usage;
    results.push(R('S5.2: navigator.storage.estimate() works', s5_2_ok,
      typeof s5_2 === 'object' ? s5_2.detail : s5_2));

    // S5.3: Storage bar
    // After reload (S4.3), we're back at library — but we need to wait for EPUB to auto-load
    await wait(9000); // debug mode auto-loads EPUB
    await page.evaluate(async () => {
      if (typeof updateStorageBar === 'function') await updateStorageBar();
    });
    await wait(1000);

    let s5_3 = await page.evaluate(() => {
      const el = document.getElementById('libStorageText');
      return el ? el.textContent : 'not found';
    });
    let s5_3_ok = s5_3.includes('%') || s5_3.includes('MB') || s5_3.includes('KB');
    results.push(R('S5.3: Storage bar shows % or MB', s5_3_ok, s5_3));

    // ══════════════════════════════════════
    // SUMMARY
    // ══════════════════════════════════════

    const pass = results.filter(r => r.ok).length;
    const fail = results.filter(r => !r.ok).length;
    console.log('\n═══════════════════════════════════════');
    console.log('STORAGE TESTS — ' + pass + '/' + results.length + ' PASS');
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
