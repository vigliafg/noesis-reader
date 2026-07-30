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

    // ── Load reader ──
    console.log('🚀 Loading reader with debug mode...');
    await page.goto('http://127.0.0.1:8765/index.html?debug=1', { waitUntil: 'networkidle0', timeout: 40000 });
    await sleep(6000);
    record(true, 'Reader loaded');

    // ── Navigate to Chapter 26 ──
    console.log('📖 Navigating to Chapter 26...');
    const navOk = await page.evaluate(() => {
      if (typeof book === 'undefined' || !book || !book.spine) return false;
      if (typeof rendition === 'undefined') return false;
      if (book.spine.items.length > 44) {
        rendition.display(book.spine.items[44].href);
        return true;
      }
      return false;
    });
    record(navOk, 'Navigated to spine[44]');
    await sleep(5000);

    // ── Helper: collect a chunk via click → Preview → Collect ──
    async function collectMedia(page, selector) {
      const iframeEl = await page.$('#viewer iframe');
      if (!iframeEl) return false;
      const frame = await iframeEl.contentFrame();
      if (!frame) return false;

      await frame.click(selector);
      await sleep(1500);
      const pb = await page.$('#readerMdPreviewBtn');
      if (pb) { await pb.click(); await sleep(1500); }
      const cb = await page.$('#readerFsCollect');
      if (cb) { await cb.click(); await sleep(1200); }
      const cl = await page.$('#readerFsClose');
      if (cl) { await cl.click(); await sleep(500); }
      return true;
    }

    // ── Collect 1 image + 1 table ──
    console.log('\n📸 Collecting image...');
    await collectMedia(page, 'img');
    let badge = await page.$eval('#collBadge', el => el.textContent.trim());
    record(badge === '1', `Image collected, badge=${badge}`);

    console.log('📊 Collecting table...');
    await collectMedia(page, 'table');
    badge = await page.$eval('#collBadge', el => el.textContent.trim());
    record(badge === '2', `Table collected, badge=${badge}`);

    // ── Open drawer ──
    console.log('\n📂 Opening drawer...');
    await page.evaluate(() => {
      document.getElementById('rmbCollection').click();
    });
    await sleep(1000);

    // Verify 2 items visible
    const itemsCount = await page.evaluate(() => {
      return document.querySelectorAll('#collList .coll-item').length;
    });
    record(itemsCount === 2, `Drawer shows ${itemsCount} items (expected 2)`);

    // ── Helper: click filter button by data-type ──
    async function clickFilter(page, type) {
      await page.evaluate((t) => {
        const btn = document.querySelector(`.coll-ft-btn[data-type="${t}"]`);
        if (btn) btn.click();
      }, type);
      await sleep(600);
    }

    // ── Helper: count visible items and checked checkboxes ──
    async function countState(page) {
      return await page.evaluate(() => {
        const items = document.querySelectorAll('#collList .coll-item');
        const visible = Array.from(items).filter(i => i.offsetParent !== null).length;
        const checked = document.querySelectorAll('#collList .coll-checkbox input[type="checkbox"]:checked').length;
        return { visible, checked };
      });
    }

    // ── Check both checkboxes ──
    console.log('\n☑️  Checking both checkboxes...');
    await page.evaluate(() => {
      document.querySelectorAll('#collList .coll-checkbox input[type="checkbox"]').forEach(cb => { if (!cb.checked) cb.click(); });
    });
    await sleep(300);

    let state = await countState(page);
    record(state.checked === 2, `Both checked: ${state.checked} selected`);

    let selBadge = await page.$eval('#collSelBadge', el => el.textContent.trim());
    record(selBadge === '2 selected', `Badge: "${selBadge}"`);

    // ════════════════════════════════════════════
    // W3.1: Filter → Images — only image stays visible AND checked
    // ════════════════════════════════════════════
    console.log('\n🔍 W3.1: Filter → Images...');
    await clickFilter(page, 'img');
    state = await countState(page);
    record(state.visible === 1, `Filter Images: ${state.visible} visible (expected 1)`);
    record(state.checked === 1, `Filter Images: ${state.checked} checked (expected 1 — image still selected)`);

    selBadge = await page.$eval('#collSelBadge', el => el.textContent.trim());
    record(selBadge === '1 selected', `Images badge: "${selBadge}"`);

    // ════════════════════════════════════════════
    // W3.2: Filter → Tables — only table stays visible AND checked
    // ════════════════════════════════════════════
    console.log('\n🔍 W3.2: Filter → Tables...');
    await clickFilter(page, 'table');
    state = await countState(page);
    record(state.visible === 1, `Filter Tables: ${state.visible} visible (expected 1)`);
    record(state.checked === 1, `Filter Tables: ${state.checked} checked (expected 1 — table still selected)`);

    selBadge = await page.$eval('#collSelBadge', el => el.textContent.trim());
    record(selBadge === '1 selected', `Tables badge: "${selBadge}"`);

    // ════════════════════════════════════════════
    // W3.3: Back to All — both visible AND both checked
    // ════════════════════════════════════════════
    console.log('\n🔍 W3.3: Back to All...');
    await clickFilter(page, 'all');
    state = await countState(page);
    record(state.visible === 2, `Filter All: ${state.visible} visible (expected 2)`);
    record(state.checked === 2, `Filter All: ${state.checked} checked (expected 2 — both restored)`);

    selBadge = await page.$eval('#collSelBadge', el => el.textContent.trim());
    record(selBadge === '2 selected', `All badge: "${selBadge}"`);

    // ════════════════════════════════════════════
    // W3.4: Filter → Text — nothing visible, nothing checked
    // ════════════════════════════════════════════
    console.log('\n🔍 W3.4: Filter → Text (no text chunks)...');
    await clickFilter(page, 'text');
    state = await countState(page);
    record(state.visible === 0, `Filter Text: ${state.visible} visible (expected 0)`);
    record(state.checked === 0, `Filter Text: ${state.checked} checked (expected 0)`);

    selBadge = await page.$eval('#collSelBadge', el => el.textContent.trim());
    record(selBadge === '0 selected', `Text badge: "${selBadge}"`);

    // ════════════════════════════════════════════
    // W3.5: Back to All after Text — both still checked
    // ════════════════════════════════════════════
    console.log('\n🔍 W3.5: Back to All after Text filter...');
    await clickFilter(page, 'all');
    state = await countState(page);
    record(state.checked === 2, `After Text→All: ${state.checked} checked (expected 2 — both restored)`);

    // ── SUMMARY ──
    console.log(`\n${'═'.repeat(50)}`);
    console.log(`📊 TEST W3 SELEZIONE: ${pass}/${pass + fail} PASS`);
    console.log(`${'═'.repeat(50)}`);
    results.forEach(r => console.log(`  ${r}`));

  } finally {
    await browser.close();
    process.exit(fail > 0 ? 1 : 0);
  }
})();
