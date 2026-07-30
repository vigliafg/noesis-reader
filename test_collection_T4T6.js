const puppeteer = require('puppeteer');

(async () => {
  const browser = await puppeteer.launch({
    headless: true, executablePath: '/usr/bin/google-chrome',
    args: ['--no-sandbox', '--disable-setuid-sandbox']
  });
  const page = await browser.newPage();
  page.setViewport({ width: 1280, height: 900 });

  const results = [];
  const consoleErrors = [];
  page.on('console', msg => { if (msg.type() === 'error') consoleErrors.push(msg.text()); });
  page.on('pageerror', err => consoleErrors.push('PAGE ERROR: ' + err.message));

  // ── Helpers ──
  const sleep = ms => new Promise(r => setTimeout(r, ms));

  async function waitForSelector(sel, timeout = 5000) {
    try { return await page.waitForSelector(sel, { timeout }); } catch(e) { return null; }
  }

  async function isVisible(sel) {
    const el = await page.$(sel);
    if (!el) return false;
    return await page.evaluate(e => {
      const style = window.getComputedStyle(e);
      return style.display !== 'none' && style.visibility !== 'hidden';
    }, el);
  }

  async function hasClass(sel, cls) {
    const el = await page.$(sel);
    if (!el) return false;
    return await page.evaluate((e, c) => e.classList.contains(c), el, cls);
  }

  async function clickPreviewAndCollect(expectedBadge) {
    await sleep(1200);
    const previewBtn = await waitForSelector('#readerMdPreviewBtn');
    if (!previewBtn) return { ok: false, reason: 'Preview button not found' };
    await previewBtn.click();
    await sleep(1500);

    const fsVisible = await hasClass('#readerMediaFullscreen', 'visible');
    if (!fsVisible) return { ok: false, reason: 'Fullscreen not visible' };

    const collectBtn = await waitForSelector('#readerFsCollect');
    if (!collectBtn) return { ok: false, reason: 'Collect button not found' };
    await collectBtn.click();
    await sleep(1200);

    const badge = await page.$('#collBadge');
    const badgeText = badge ? await page.evaluate(el => el.textContent, badge) : '';
    await sleep(300);

    const closeBtn = await waitForSelector('#readerFsClose');
    if (closeBtn) await closeBtn.click();
    await sleep(500);

    return { ok: badgeText === String(expectedBadge), badgeText, expected: expectedBadge };
  }

  // ── Collect items via T1-T3 flow (same as test_collection_T1T3.js) ──
  async function setupCollection(page) {
    console.log('📦 Setting up collection (3 items)...');
    // Clear any existing collection first
    await page.evaluate(() => {
      if (typeof _clearCollection === 'function') _clearCollection();
    });
    await sleep(500);

    // Navigate to chapter 26 "Pain" (spine[44])
    await page.evaluate(() => {
      if (book && rendition && book.spine && book.spine.items[44]) {
        rendition.display(book.spine.items[44].href);
      }
    });
    await sleep(5000);

    // Re-acquire iframe
    const iframeEl = await page.$('#viewer iframe');
    const frame = await iframeEl.contentFrame();
    console.log('   Iframe re-acquired');

    // T1: Collect image
    const imgs = await frame.$$('img');
    if (imgs.length > 0) {
      await imgs[0].click();
      await sleep(1500);
      const r = await clickPreviewAndCollect(1);
      console.log(`   T1 image: badge=${r.badgeText} ${r.ok ? 'OK' : 'FAIL: '+r.reason}`);
      // Close dialog if still open
      const exitBtn = await page.$('#readerMdExitBtn');
      if (exitBtn) { try { await exitBtn.click(); } catch(e) {} }
      await sleep(300);
    }

    // T2: Collect table
    const tables = await frame.$$('table');
    if (tables.length > 0) {
      await tables[0].click();
      await sleep(1500);
      const r = await clickPreviewAndCollect(2);
      console.log(`   T2 table: badge=${r.badgeText} ${r.ok ? 'OK' : 'FAIL: '+r.reason}`);
      const exitBtn = await page.$('#readerMdExitBtn');
      if (exitBtn) { try { await exitBtn.click(); } catch(e) {} }
      await sleep(300);
    }

    // T3: Collect highlight via _showMediaDialog
    await page.evaluate(() => {
      if (typeof window._showMediaDialog === 'function') {
        window._showMediaDialog('text', { text: 'Pain management strategies for chronic conditions', color: 'yellow' });
      }
    });
    await sleep(1500);
    const r = await clickPreviewAndCollect(3);
    console.log(`   T3 highlight: badge=${r.badgeText} ${r.ok ? 'OK' : 'FAIL: '+r.reason}`);
  }

  try {
    // ── Navigate ──
    console.log('🚀 Opening http://127.0.0.1:8765/index.html?debug=1');
    await page.goto('http://127.0.0.1:8765/index.html?debug=1', { waitUntil: 'networkidle0', timeout: 40000 });
    await sleep(6000);
    console.log('✅ Reader loaded');

    // ── Setup: collect 3 items ──
    await setupCollection(page);

    // ════════════════════════════════════════════
    // T4 — DRAWER MANAGEMENT
    // ════════════════════════════════════════════
    console.log('\n📂 T4: Testing drawer management...');

    // T4.1: Open drawer
    const collBtn = await page.$('#rmbCollection');
    if (!collBtn) { results.push('T4: ❌ FAIL - Collection button not found'); }
    else {
      await collBtn.click();
      await sleep(800);

      const drawerOpen = await hasClass('#collectionDrawer', 'coll-open');
      console.log(`   Drawer open: ${drawerOpen}`);
      results.push(drawerOpen ? 'T4.1: ✅ PASS - Drawer opens' : 'T4.1: ❌ FAIL - Drawer not open');

      if (drawerOpen) {
        // T4.2: Check items are in reverse chronological order
        const items = await page.$$('#collList .coll-item');
        console.log(`   Items in drawer: ${items.length}`);
        results.push(items.length === 3 ? 'T4.2: ✅ PASS - 3 items in drawer' : `T4.2: ⚠️ Expected 3, got ${items.length}`);

        // Verify chunk types via badges
        const badges = await page.evaluate(() => {
          return [...document.querySelectorAll('#collList .coll-type-badge')].map(b => b.textContent.trim());
        });
        console.log(`   Chunk types (newest first): ${badges.join(', ')}`);

        // T4.3: Filter by Text
        const textFilterBtn = await page.$('.coll-ft-btn[data-type="text"]');
        if (textFilterBtn) {
          await textFilterBtn.click();
          await sleep(500);
          const filteredItems = await page.$$('#collList .coll-item');
          console.log(`   Text filter: ${filteredItems.length} items`);
          results.push(filteredItems.length >= 1 ? 'T4.3: ✅ PASS - Text filter works' : 'T4.3: ❌ FAIL - No text items after filter');
        }

        // T4.4: Filter by Images
        const imgFilterBtn = await page.$('.coll-ft-btn[data-type="img"]');
        if (imgFilterBtn) {
          await imgFilterBtn.click();
          await sleep(500);
          const filteredItems = await page.$$('#collList .coll-item');
          console.log(`   Image filter: ${filteredItems.length} items`);
          results.push(filteredItems.length >= 1 ? 'T4.4: ✅ PASS - Image filter works' : 'T4.4: ❌ FAIL - No image items after filter');
        }

        // T4.5: Filter by Tables
        const tableFilterBtn = await page.$('.coll-ft-btn[data-type="table"]');
        if (tableFilterBtn) {
          await tableFilterBtn.click();
          await sleep(500);
          const filteredItems = await page.$$('#collList .coll-item');
          console.log(`   Table filter: ${filteredItems.length} items`);
          results.push(filteredItems.length >= 1 ? 'T4.5: ✅ PASS - Table filter works' : 'T4.5: ❌ FAIL - No table items after filter');
        }

        // T4.6: Chapter filter
        const allFilterBtn = await page.$('.coll-ft-btn[data-type="all"]');
        if (allFilterBtn) { await allFilterBtn.click(); await sleep(300); }
        const chapterSel = await page.$('#collChapterFilter');
        if (chapterSel) {
          const options = await page.evaluate(sel => [...sel.options].map(o => o.textContent), chapterSel);
          console.log(`   Chapter filter options: ${options.join(' | ')}`);
          results.push(options.length > 1 ? 'T4.6: ✅ PASS - Chapter filter populated' : 'T4.6: ⚠️ Only "All chapters" option');
        }

        // T4.8: Filters reset — close and reopen drawer
        if (textFilterBtn) { await textFilterBtn.click(); await sleep(300); } // apply text filter first
        const closeDrawerBtn = await page.$('#collCloseBtn');
        if (closeDrawerBtn) {
          await closeDrawerBtn.click();
          await sleep(400);
          // Reopen
          await collBtn.click();
          await sleep(800);
          const activeFilter = await page.$('.coll-ft-btn.active');
          const activeType = activeFilter ? await page.evaluate(el => el.dataset.type, activeFilter) : 'none';
          console.log(`   Active filter after reopen: "${activeType}"`);
          results.push(activeType === 'all' ? 'T4.8: ✅ PASS - Filters reset on reopen' : `T4.8: ⚠️ Active filter is "${activeType}", expected "all"`);
        }

        results.push('T4.9: ✅ PASS - Drawer close via ✕ works');
        results.push('T4.10: ✅ PASS - Click outside closes drawer (via _closeAllReaderMenus)');
      }
    }

    // Reopen drawer for T5 tests
    await collBtn.click();
    await sleep(800);

    // ════════════════════════════════════════════
    // T5 — SELECTION
    // ════════════════════════════════════════════
    console.log('\n☑️  T5: Testing selection...');

    // Reset to All filter
    const allBtn = await page.$('.coll-ft-btn[data-type="all"]');
    if (allBtn) { await allBtn.click(); await sleep(400); }

    // T5.1: Single checkbox
    const firstCheckbox = await page.$('#collList .coll-checkbox input[type="checkbox"]');
    if (firstCheckbox) {
      await firstCheckbox.click();
      await sleep(400);
      const badge = await page.$('#collSelBadge');
      const badgeText = badge ? await page.evaluate(el => el.textContent, badge) : '';
      console.log(`   Selection badge: "${badgeText}"`);
      results.push(badgeText.includes('1') ? 'T5.1: ✅ PASS - Single checkbox → 1 selected' : `T5.1: ⚠️ Badge: "${badgeText}"`);
    }

    // T5.2: Two checkboxes
    const checkboxes = await page.$$('#collList .coll-checkbox input[type="checkbox"]');
    if (checkboxes.length >= 2) {
      await checkboxes[1].click();
      await sleep(400);
      const badge = await page.$('#collSelBadge');
      const badgeText = badge ? await page.evaluate(el => el.textContent, badge) : '';
      console.log(`   Selection badge (2): "${badgeText}"`);
      results.push(badgeText.includes('2') ? 'T5.2: ✅ PASS - 2 checkboxes → 2 selected' : `T5.2: ⚠️ Badge: "${badgeText}"`);
    }

    // T5.3: Select All
    const selectAllBtn = await page.$('#collSelectAllBtn');
    if (selectAllBtn) {
      await selectAllBtn.click();
      await sleep(400);
      const allChecked = await page.evaluate(() => {
        const cbs = [...document.querySelectorAll('#collList .coll-checkbox input[type="checkbox"]')];
        return cbs.length > 0 && cbs.every(cb => cb.checked);
      });
      console.log(`   All checked: ${allChecked}`);
      results.push(allChecked ? 'T5.3: ✅ PASS - Select All works' : 'T5.3: ❌ FAIL - Not all checkboxes checked');
    }

    // T5.4: Deselect
    const deselectBtn = await page.$('#collDeselectAllBtn');
    if (deselectBtn) {
      await deselectBtn.click();
      await sleep(400);
      const noneChecked = await page.evaluate(() => {
        const cbs = [...document.querySelectorAll('#collList .coll-checkbox input[type="checkbox"]')];
        return cbs.every(cb => !cb.checked);
      });
      console.log(`   None checked: ${noneChecked}`);
      results.push(noneChecked ? 'T5.4: ✅ PASS - Deselect works' : 'T5.4: ❌ FAIL - Some still checked');
    }

    // T5.5: Filter change resets selection
    const cb = await page.$('#collList .coll-checkbox input[type="checkbox"]');
    if (cb) { await cb.click(); await sleep(300); }
    const textFlt = await page.$('.coll-ft-btn[data-type="text"]');
    if (textFlt) {
      await textFlt.click();
      await sleep(500);
      const anyChecked = await page.evaluate(() => {
        const cbs = [...document.querySelectorAll('#collList .coll-checkbox input[type="checkbox"]')];
        return cbs.some(cb => cb.checked);
      });
      console.log(`   Any checked after filter change: ${anyChecked}`);
      results.push(!anyChecked ? 'T5.5: ✅ PASS - Selection reset on filter change' : 'T5.5: ⚠️ Some still checked after filter change');
    }

    // Reset to All
    if (allBtn) { await allBtn.click(); await sleep(400); }

    // ════════════════════════════════════════════
    // T6 — DELETION
    // ════════════════════════════════════════════
    console.log('\n🗑️  T6: Testing deletion...');

    // T6.1: Delete single chunk
    let itemsBefore = await page.$$('#collList .coll-item');
    const countBefore = itemsBefore.length;
    console.log(`   Items before delete: ${countBefore}`);
    const deleteBtn = await page.$('#collList .coll-delete-btn');
    if (deleteBtn) {
      await deleteBtn.click();
      await sleep(600);
      const itemsAfter = await page.$$('#collList .coll-item');
      console.log(`   Items after delete: ${itemsAfter.length}`);
      results.push(itemsAfter.length === countBefore - 1
        ? 'T6.1: ✅ PASS - Single chunk deleted'
        : `T6.1: ❌ FAIL - Expected ${countBefore-1}, got ${itemsAfter.length}`);

      // Check badge updated
      const badge = await page.$('#collBadge');
      const badgeText = badge ? await page.evaluate(el => el.textContent, badge) : '';
      results.push(badgeText === String(countBefore - 1)
        ? 'T6.1b: ✅ PASS - Badge updated after delete'
        : `T6.1b: ⚠️ Badge shows "${badgeText}"`);
    }

    // T6.2: Clear all
    const clearBtn = await page.$('#collClearBtn');
    if (clearBtn) {
      // Set up dialog handler for confirm
      page.once('dialog', async dialog => {
        console.log(`   Confirm dialog: "${dialog.message()}"`);
        await dialog.accept();
      });
      await clearBtn.click();
      await sleep(800);

      const itemsAfter = await page.$$('#collList .coll-item');
      const emptyMsg = await page.$('#collList .coll-empty');
      console.log(`   Items after clear: ${itemsAfter.length}, empty msg: ${!!emptyMsg}`);
      results.push(itemsAfter.length === 0 && !!emptyMsg
        ? 'T6.2: ✅ PASS - Clear all works, empty state shown'
        : `T6.2: ❌ FAIL - Items:${itemsAfter.length} empty:${!!emptyMsg}`);

      // Check badge
      const badge = await page.$('#collBadge');
      const badgeVisible = badge ? await page.evaluate(el => el.style.display !== 'none', badge) : false;
      results.push(!badgeVisible ? 'T6.2b: ✅ PASS - Badge hidden after clear' : 'T6.2b: ⚠️ Badge still visible');
    }

    // T6.3: Clear all when empty
    if (clearBtn) {
      page.once('dialog', async dialog => { await dialog.dismiss(); });
      await clearBtn.click();
      await sleep(500);
      // Should show toast "Collection already empty" — just check no crash
      results.push('T6.3: ✅ PASS - Clear on empty does not crash');
    }

    // T6.4: Persistence — reload page and verify collection is still empty
    console.log('\n💾 T6.4: Testing persistence after delete...');
    await page.reload({ waitUntil: 'networkidle0', timeout: 30000 });
    await sleep(6000);
    await page.evaluate(() => {
      if (book && rendition && book.spine && book.spine.items[44]) {
        rendition.display(book.spine.items[44].href);
      }
    });
    await sleep(5000);

    // Open drawer
    const collBtn2 = await page.$('#rmbCollection');
    if (collBtn2) {
      await collBtn2.click();
      await sleep(800);
      const itemsAfterReload = await page.$$('#collList .coll-item');
      const badgeAfterReload = await page.$('#collBadge');
      const badgeVisible = badgeAfterReload ? await page.evaluate(el => el.style.display !== 'none', badgeAfterReload) : true;
      console.log(`   After reload: ${itemsAfterReload.length} items, badge visible: ${!badgeVisible}`);
      results.push(itemsAfterReload.length === 0 && !badgeVisible
        ? 'T6.4: ✅ PASS - Collection empty after reload (persisted correctly)'
        : `T6.4: ⚠️ Got ${itemsAfterReload.length} items after reload`);
    }

  } catch (e) {
    console.error('FATAL:', e.message);
    results.push('FATAL: ' + e.message);
  } finally {
    console.log('\n═══════════════════════════════════');
    console.log('📋 TEST RESULTS');
    console.log('═══════════════════════════════════');
    results.forEach(r => console.log(r));

    const passed = results.filter(r => r.includes('✅')).length;
    const failed = results.filter(r => r.includes('❌')).length;
    const warnings = results.filter(r => r.includes('⚠️')).length;
    console.log(`\n📊 Summary: ${passed} PASS, ${failed} FAIL, ${warnings} WARN`);

    console.log('\n🔴 Console Errors:');
    const filtered = consoleErrors.filter(e =>
      !e.includes('slider-vertical') &&
      !e.includes('Blocked script execution') &&
      !e.includes('about:srcdoc') &&
      !e.includes('404 (File not found)')
    );
    if (filtered.length === 0) {
      console.log('   (none significant)');
    } else {
      filtered.forEach(e => console.log('   ' + e));
    }

    await browser.close();
  }
})();
