const puppeteer = require('puppeteer');

const sleep = ms => new Promise(r => setTimeout(r, ms));

(async () => {
  let pass = 0, fail = 0;
  const results = [];

  function record(ok, msg) {
    results.push(`${ok ? '✅' : '❌'} ${msg}`);
    if (ok) pass++; else fail++;
    console.log(`   ${ok ? '✅' : '❌'} ${msg}`);
  }

  const browser = await puppeteer.launch({
    headless: true,
    executablePath: '/usr/bin/google-chrome',
    args: ['--no-sandbox', '--disable-setuid-sandbox', '--disable-gpu']
  });

  try {
    const page = await browser.newPage();
    page.setViewport({ width: 1280, height: 900 });
    page.on('console', msg => { if (msg.type() === 'error') console.log(`   [console.error] ${msg.text()}`); });
    page.on('dialog', async dialog => { await dialog.dismiss(); });

    console.log('🚀 Loading reader with debug mode...');
    await page.goto('http://127.0.0.1:8765/index.html?debug=1', { waitUntil: 'networkidle0', timeout: 40000 });
    await sleep(6000);

    const readerView = await page.$('#reader-view');
    record(!!readerView, 'Reader view visible');

    // ── Navigate to Chapter 26 "Pain" ──
    console.log('📖 Navigating to Chapter 26 "Pain" (spine[44])...');
    const navResult = await page.evaluate(() => {
      if (typeof book === 'undefined' || !book || !book.spine) return 'book not loaded';
      if (typeof rendition === 'undefined' || !rendition) return 'rendition not loaded';
      if (book.spine.items.length > 44) {
        rendition.display(book.spine.items[44].href);
        return 'navigated';
      }
      return 'spine too short: ' + (book.spine.items ? book.spine.items.length : 'no items');
    });
    console.log(`   Navigation: ${navResult}`);
    record(navResult === 'navigated', `Navigated to spine[44]`);
    await sleep(5000);

    // Re-acquire iframe after navigation
    const iframeEl = await page.$('#viewer iframe');
    if (!iframeEl) {
      record(false, 'No iframe found');
    } else {
      const frame = await iframeEl.contentFrame();
      record(!!frame, 'EPUB iframe accessible');

      const imgCount = await frame.evaluate(() => document.querySelectorAll('img').length);
      const tableCount = await frame.evaluate(() => document.querySelectorAll('table').length);
      console.log(`   Chapter has ${imgCount} images, ${tableCount} tables`);
      record(imgCount > 0, `Found ${imgCount} images`);
      record(tableCount > 0, `Found ${tableCount} tables`);

      // ════════════════════════════════════════════
      // W2.1: IMAGE DEDUP — same image twice → badge=1
      // ════════════════════════════════════════════
      console.log('\n📸 W2.1: Testing IMAGE deduplication...');

      // First Collect
      await frame.click('img');
      await sleep(1500);
      let previewBtn = await page.$('#readerMdPreviewBtn');
      if (previewBtn) { await previewBtn.click(); await sleep(1500); }
      let collectBtn = await page.$('#readerFsCollect');
      if (collectBtn) { await collectBtn.click(); await sleep(1500); }
      // Close fullscreen
      let closeBtn = await page.$('#readerFsClose');
      if (closeBtn) { await closeBtn.click(); await sleep(500); }

      let badge = await page.$eval('#collBadge', el => el.textContent.trim());
      record(badge === '1', `Badge after 1st image Collect: ${badge} (expected: 1)`);

      // Second Collect — same image
      const iframeEl2 = await page.$('#viewer iframe');
      const frame2 = iframeEl2 ? await iframeEl2.contentFrame() : null;
      if (frame2) {
        await frame2.click('img');
        await sleep(1500);
        previewBtn = await page.$('#readerMdPreviewBtn');
        if (previewBtn) { await previewBtn.click(); await sleep(1500); }
        collectBtn = await page.$('#readerFsCollect');
        if (collectBtn) { await collectBtn.click(); await sleep(1500); }
        closeBtn = await page.$('#readerFsClose');
        if (closeBtn) { await closeBtn.click(); await sleep(500); }
      }

      badge = await page.$eval('#collBadge', el => el.textContent.trim());
      record(badge === '1', `Badge after 2nd image Collect: ${badge} (expected: 1 — duplicate blocked)`);

      const collLen = await page.evaluate(() => typeof _collection !== 'undefined' ? _collection.length : -1);
      record(collLen === 1, `_collection.length = ${collLen} (expected: 1)`);

      // ════════════════════════════════════════════
      // W2.2: TABLE DEDUP — same table twice → badge=2 (img + table = 2)
      // ════════════════════════════════════════════
      console.log('\n📊 W2.2: Testing TABLE deduplication...');

      const iframeEl3 = await page.$('#viewer iframe');
      const frame3 = iframeEl3 ? await iframeEl3.contentFrame() : null;
      if (frame3) {
        await frame3.click('table');
        await sleep(1500);
        previewBtn = await page.$('#readerMdPreviewBtn');
        if (previewBtn) { await previewBtn.click(); await sleep(1500); }
        collectBtn = await page.$('#readerFsCollect');
        if (collectBtn) { await collectBtn.click(); await sleep(1500); }
        closeBtn = await page.$('#readerFsClose');
        if (closeBtn) { await closeBtn.click(); await sleep(500); }
      }

      badge = await page.$eval('#collBadge', el => el.textContent.trim());
      record(badge === '2', `Badge after 1st table Collect: ${badge} (expected: 2)`);

      // Second Collect — same table → blocked
      const iframeEl4 = await page.$('#viewer iframe');
      const frame4 = iframeEl4 ? await iframeEl4.contentFrame() : null;
      if (frame4) {
        await frame4.click('table');
        await sleep(1500);
        previewBtn = await page.$('#readerMdPreviewBtn');
        if (previewBtn) { await previewBtn.click(); await sleep(1500); }
        collectBtn = await page.$('#readerFsCollect');
        if (collectBtn) { await collectBtn.click(); await sleep(1500); }
        closeBtn = await page.$('#readerFsClose');
        if (closeBtn) { await closeBtn.click(); await sleep(500); }
      }

      badge = await page.$eval('#collBadge', el => el.textContent.trim());
      record(badge === '2', `Badge after 2nd table Collect: ${badge} (expected: 2 — duplicate blocked)`);

      const collLen2 = await page.evaluate(() => typeof _collection !== 'undefined' ? _collection.length : -1);
      record(collLen2 === 2, `_collection.length = ${collLen2} (expected: 2)`);

      // ════════════════════════════════════════════
      // W2.3: TEXT DEDUP via showDialog → Preview → Collect
      // ════════════════════════════════════════════
      console.log('\n📝 W2.3: Testing TEXT deduplication...');

      // Helper: collect text via showDialog → Preview → Collect
      async function collectText(page, text, color) {
        await page.evaluate((t, c) => {
          window._showMediaDialog('text', { text: t, color: c });
        }, text, color);
        await sleep(1200);
        const pb = await page.$('#readerMdPreviewBtn');
        if (pb) { await pb.click(); await sleep(1200); }
        const cb = await page.$('#readerFsCollect');
        if (cb) { await cb.click(); await sleep(1200); }
        const cl = await page.$('#readerFsClose');
        if (cl) { await cl.click(); await sleep(500); }
        return await page.$eval('#collBadge', el => el.textContent.trim());
      }

      // First text: "Dedup test highlight", yellow → should add
      const badgeBefore = await page.$eval('#collBadge', el => el.textContent.trim());
      console.log(`   Badge before text: ${badgeBefore}`);
      const badgeT1 = await collectText(page, 'Dedup test highlight', 'yellow');
      record(badgeT1 === String(Number(badgeBefore) + 1), `Text added: badge ${badgeBefore} → ${badgeT1}`);

      // Same text, same color → should be blocked
      const badgeT2 = await collectText(page, 'Dedup test highlight', 'yellow');
      record(badgeT2 === badgeT1, `Same text+color blocked: badge remains ${badgeT2}`);

      // Same text, different color → should be ADDED
      const badgeT3 = await collectText(page, 'Dedup test highlight', 'green');
      record(badgeT3 === String(Number(badgeT1) + 1), `Different color added: badge ${badgeT1} → ${badgeT3}`);
    }

    // ── SUMMARY ──
    console.log(`\n${'═'.repeat(50)}`);
    console.log(`📊 TEST W2 DEDUPLICA: ${pass}/${pass + fail} PASS`);
    console.log(`${'═'.repeat(50)}`);
    results.forEach(r => console.log(`  ${r}`));

  } finally {
    await browser.close();
    process.exit(fail > 0 ? 1 : 0);
  }
})();
