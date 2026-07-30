const puppeteer = require('puppeteer');

(async () => {
  const browser = await puppeteer.launch({
    headless: true,
    executablePath: '/usr/bin/google-chrome',
    args: ['--no-sandbox', '--disable-setuid-sandbox', '--disable-gpu']
  });
  const page = await browser.newPage();
  page.setViewport({ width: 1280, height: 900 });

  const results = [];
  const consoleErrors = [];
  page.on('console', msg => { if (msg.type() === 'error') consoleErrors.push(msg.text()); });
  page.on('pageerror', err => consoleErrors.push('PAGE ERROR: ' + err.message));

  async function clickPreviewAndCollect(page, testName, expectedBadge) {
    // Wait for dialog to appear and click Preview
    await new Promise(r => setTimeout(r, 1200));
    const previewBtn = await page.$('#readerMdPreviewBtn');
    if (!previewBtn) return { ok: false, reason: 'Preview button not found in dialog' };

    await previewBtn.click();
    await new Promise(r => setTimeout(r, 1500));

    // Check fullscreen overlay
    const fsOverlay = await page.$('#readerMediaFullscreen');
    const fsVisible = fsOverlay ? await page.evaluate(el => el.classList.contains('visible'), fsOverlay) : false;
    if (!fsVisible) return { ok: false, reason: 'Fullscreen overlay not visible after Preview' };

    // Click Collect
    const collectBtn = await page.$('#readerFsCollect');
    if (!collectBtn) return { ok: false, reason: 'Collect button not found' };

    await collectBtn.click();
    await new Promise(r => setTimeout(r, 1200));

    // Check badge
    const badge = await page.$('#collBadge');
    const badgeText = badge ? await page.evaluate(el => el.textContent, badge) : '';
    console.log(`   Badge counter: "${badgeText}"`);

    // Close fullscreen
    const closeBtn = await page.$('#readerFsClose');
    if (closeBtn) await closeBtn.click();
    await new Promise(r => setTimeout(r, 500));

    return { ok: badgeText === String(expectedBadge), badgeText, expected: expectedBadge };
  }

  try {
    // ── Navigate with debug=1 ──
    console.log('🚀 Opening http://127.0.0.1:8765/index.html?debug=1');
    await page.goto('http://127.0.0.1:8765/index.html?debug=1', { waitUntil: 'networkidle0', timeout: 40000 });
    await new Promise(r => setTimeout(r, 6000));

    const readerView = await page.$('#reader-view');
    if (!readerView) { results.push('PRE: ❌ FAIL - Reader view not visible'); throw new Error('Reader not loaded'); }
    console.log('✅ Reader loaded');

    // ── Navigate to chapter 26 "Pain" (spine index 44) ──
    console.log('📖 Navigating to chapter 26 "Pain" (spine[44])...');
    const navResult = await page.evaluate(() => {
      if (typeof book === 'undefined' || !book || !book.spine) return 'book not loaded';
      if (typeof rendition === 'undefined' || !rendition) return 'rendition not loaded';
      if (book.spine.items.length > 44) {
        rendition.display(book.spine.items[44].href);
        return 'navigated to spine[44]';
      }
      return 'spine too short: ' + book.spine.items.length + ' items';
    });
    console.log('   Navigation: ' + navResult);
    await new Promise(r => setTimeout(r, 5000)); // Wait for chapter to render

    // Re-acquire iframe after navigation (iframe was reloaded!)
    const iframeEl = await page.$('#viewer iframe');
    if (!iframeEl) { results.push('PRE: ❌ FAIL - No iframe found'); throw new Error('No iframe'); }
    const frame = await iframeEl.contentFrame();
    if (!frame) { results.push('PRE: ❌ FAIL - Cannot access iframe content'); throw new Error('Cannot access iframe'); }
    console.log('✅ EPUB iframe accessible (chapter 26)');

    // Debug: show what's in the iframe
    const tagCounts = await frame.evaluate(() => {
      const tags = [...document.querySelectorAll('*')].map(e => e.tagName.toLowerCase());
      const counts = {}; tags.forEach(t => counts[t] = (counts[t]||0)+1);
      return counts;
    });
    console.log('   Iframe tags:', JSON.stringify(tagCounts));
    const bodySample = await frame.evaluate(() => (document.body?.textContent || '').substring(0, 200));
    console.log('   Body sample:', bodySample.replace(/\s+/g, ' ').trim().substring(0, 100));

    // ═══════════════════════════════ T1 — IMAGE ═══════════════════════════════
    console.log('\n📸 T1: Testing image collection...');
    const imgs = await frame.$$('img');
    console.log(`   Found ${imgs.length} images in EPUB`);
    if (imgs.length === 0) {
      results.push('T1: ⚠️ SKIP - No images in EPUB');
    } else {
      await imgs[0].click();
      await new Promise(r => setTimeout(r, 1500));

      const dialog = await page.$('#readerMediaDialog');
      const dialogVisible = dialog ? await page.evaluate(el => el.classList.contains('visible'), dialog) : false;
      console.log(`   Dialog visible: ${dialogVisible}`);

      if (!dialogVisible) {
        results.push('T1: ❌ FAIL - Dialog did not appear after image click');
      } else {
        const r = await clickPreviewAndCollect(page, 'T1', 1);
        if (r.ok) {
          results.push('T1: ✅ PASS - Image collected, badge=1');
        } else {
          results.push(`T1: ⚠️ PARTIAL - ${r.reason}, badge="${r.badgeText}" expected "${r.expected}"`);
        }
      }

      // Close dialog if still open
      const exitBtn = await page.$('#readerMdExitBtn');
      if (exitBtn) {
        try { await exitBtn.click(); } catch(e) {}
        await new Promise(r => setTimeout(r, 300));
      }
    }

    // ═══════════════════════════════ T2 — TABLE ═══════════════════════════════
    console.log('\n📊 T2: Testing table collection...');
    const tables = await frame.$$('table');
    console.log(`   Found ${tables.length} tables in EPUB`);
    if (tables.length === 0) {
      results.push('T2: ⚠️ SKIP - No tables in EPUB (test.epub might not contain tables)');
    } else {
      await tables[0].click();
      const dialog = await page.$('#readerMediaDialog');
      const dialogVisible = dialog ? await page.evaluate(el => el.classList.contains('visible'), dialog) : false;
      console.log(`   Dialog visible: ${dialogVisible}`);

      if (!dialogVisible) {
        results.push('T2: ❌ FAIL - Dialog did not appear after table click');
      } else {
        const r = await clickPreviewAndCollect(page, 'T2', 2);
        if (r.ok) {
          results.push('T2: ✅ PASS - Table collected, badge=2');
        } else {
          results.push(`T2: ⚠️ PARTIAL - ${r.reason}, badge="${r.badgeText}" expected "${r.expected}"`);
        }
      }

      const exitBtn = await page.$('#readerMdExitBtn');
      if (exitBtn) { try { await exitBtn.click(); } catch(e) {} }
    }

    // ═══════════════════════════════ T3 — HIGHLIGHT ═══════════════════════════════
    console.log('\n🖊️  T3: Testing highlight collection...');
    try {
      // The highlight popup is triggered by epub.js 'selected' event (not native browser selection).
      // Simulate the flow: highlight → preview button (🔍) → _showMediaDialog('text', ...)
      // This is what the preview button in the popup does (line 8915).
      const simulated = await page.evaluate(() => {
        if (typeof window._showMediaDialog !== 'function') return 'no _showMediaDialog';
        window._showMediaDialog('text', { text: 'Sample highlighted text from Pain chapter for collection testing', color: 'yellow' });
        return 'called';
      });
      console.log(`   Simulated highlight preview: ${simulated}`);
      await new Promise(r => setTimeout(r, 1500));

      if (simulated !== 'called') {
        results.push('T3: ❌ FAIL - _showMediaDialog not available');
      } else {
        const dialog = await page.$('#readerMediaDialog');
        const dialogVisible = dialog ? await page.evaluate(el => el.classList.contains('visible'), dialog) : false;
        console.log(`   Media dialog visible: ${dialogVisible}`);

        if (!dialogVisible) {
          results.push('T3: ❌ FAIL - Media dialog not visible after highlight preview');
        } else {
          const r = await clickPreviewAndCollect(page, 'T3', 3);
          if (r.ok) {
            results.push('T3: ✅ PASS - Highlight collected, badge=3');
          } else {
            results.push(`T3: ⚠️ PARTIAL - ${r.reason}, badge="${r.badgeText}" expected "${r.expected}"`);
          }
        }
      }
    } catch (e) {
      results.push('T3: ❌ FAIL - Exception: ' + e.message);
    }

  } catch (e) {
    console.error('FATAL:', e.message);
    results.push('FATAL: ' + e.message);
  } finally {
    console.log('\n═══════════════════════════════════');
    console.log('📋 TEST RESULTS');
    console.log('═══════════════════════════════════');
    results.forEach(r => console.log(r));

    console.log('\n🔴 Console Errors:');
    if (consoleErrors.length === 0) {
      console.log('   (none)');
    } else {
      const filtered = consoleErrors.filter(e =>
        !e.includes('slider-vertical') &&
        !e.includes('Blocked script execution') &&
        !e.includes('about:srcdoc')
      );
      if (filtered.length === 0) {
        console.log('   (none significant — only harmless browser warnings)');
      } else {
        filtered.forEach(e => console.log('   ' + e));
      }
    }

    await browser.close();
  }
})();
