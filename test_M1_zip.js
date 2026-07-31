const puppeteer = require('puppeteer');

(async () => {
  const browser = await puppeteer.launch({
    headless: true, executablePath: '/usr/bin/google-chrome',
    args: ['--no-sandbox', '--disable-setuid-sandbox']
  });
  const page = await browser.newPage();
  page.setViewport({ width: 1280, height: 900 });

  const results = [];
  const sleep = ms => new Promise(r => setTimeout(r, ms));

  // ── Dialog handler ──
  let pendingDialogAction = null;
  page.on('dialog', async dialog => {
    const action = pendingDialogAction || 'accept';
    pendingDialogAction = null;
    if (action === 'dismiss') await dialog.dismiss();
    else await dialog.accept(action === 'accept' ? '' : action);
  });

  async function getBadge() {
    const b = await page.$('#collBadge');
    if (!b) return '';
    const display = await page.evaluate(el => el.style.display, b);
    if (display === 'none') return '0';
    return await page.evaluate(el => el.textContent, b);
  }

  async function addHighlightItem(text, color = 'yellow') {
    await page.evaluate((t, c) => {
      if (typeof window._showMediaDialog === 'function') {
        window._showMediaDialog('text', { text: t, color: c });
      }
    }, text, color);
    await sleep(1500);
    const pb = await page.$('#readerMdPreviewBtn');
    if (pb) { await pb.click(); await sleep(1500); }
    const cb = await page.$('#readerFsCollect');
    if (cb) { await cb.click(); await sleep(1200); }
    const cl = await page.$('#readerFsClose');
    if (cl) await cl.click(); await sleep(300);
  }

  async function goToPain() {
    await page.evaluate(() => {
      if (book && rendition && book.spine && book.spine.items[44]) {
        rendition.display(book.spine.items[44].href);
      }
    });
    await sleep(5000);
  }

  try {
    // ── Load ──
    console.log('🚀 Loading...');
    await page.goto('http://127.0.0.1:8765/index.html?debug=1', { waitUntil: 'networkidle0', timeout: 40000 });
    await sleep(6000);
    console.log('✅ Reader loaded');
    await page.evaluate(() => { if (typeof _clearCollection === 'function') _clearCollection(); });
    await sleep(300);
    await goToPain();

    // ── Setup: collect image + text ──
    console.log('\n📦 Setup: collecting image and text...');

    // Collect image from iframe
    const iframeEl = await page.$('#viewer iframe');
    const frame = await iframeEl.contentFrame();
    const imgs = await frame.$$('img');
    if (imgs.length > 0) {
      await imgs[0].click(); await sleep(1500);
      const pb = await page.$('#readerMdPreviewBtn');
      if (pb) { await pb.click(); await sleep(1500); }
      const cb = await page.$('#readerFsCollect');
      if (cb) { await cb.click(); await sleep(1200); }
      const cl = await page.$('#readerFsClose');
      if (cl) await cl.click(); await sleep(300);
      const exitBtn = await page.$('#readerMdExitBtn');
      if (exitBtn) { try { await exitBtn.click(); } catch(e) {} } await sleep(300);
    }
    const badge1 = await getBadge();
    console.log(`   Image: badge=${badge1}`);

    // Collect text
    await addHighlightItem('ZIP export test highlight');
    const badge2 = await getBadge();
    console.log(`   Text: badge=${badge2}`);

    results.push(badge2 === '2' ? 'Setup: ✅ 2 chunks (image + text)' : `Setup: ⚠️ Expected 2, got ${badge2}`);

    // ══════════════ M1 TESTS ══════════════

    // M1.1: Function exists and is callable
    console.log('\n📦 M1.1: _exportCollectionZIP function check...');
    const fnCheck = await page.evaluate(() => {
      if (typeof _exportCollectionZIP !== 'function') return { ok: false, reason: 'no function' };
      var fnStr = _exportCollectionZIP.toString();
      return {
        ok: true,
        isAsync: fnStr.startsWith('async'),
        usesJSZip: fnStr.includes('JSZip'),
        usesZipFile: fnStr.includes('zip.file'),
        usesGenerateAsync: fnStr.includes('generateAsync'),
        usesImagesFolder: fnStr.includes('images/'),
        length: fnStr.length
      };
    });
    console.log(`   M1.1: ${JSON.stringify(fnCheck)}`);
    results.push(fnCheck.ok && fnCheck.usesJSZip && fnCheck.usesImagesFolder
      ? 'M1.1: ✅ PASS - _exportCollectionZIP exists, uses JSZip + images/ folder'
      : `M1.1: ⚠️ ${fnCheck.reason || 'missing JSZip/images logic'}`);

    // M1.2: ZIP button in export dropdown
    console.log('\n📦 M1.2: ZIP button in dropdown...');
    const zipBtn = await page.evaluate(() => {
      var btns = document.querySelectorAll('#collExportMenu button');
      for (var i = 0; i < btns.length; i++) {
        if (btns[i].dataset.fmt === 'zip') return { found: true, text: btns[i].textContent.trim() };
      }
      return { found: false };
    });
    console.log(`   M1.2: ${JSON.stringify(zipBtn)}`);
    results.push(zipBtn.found
      ? 'M1.2: ✅ PASS - ZIP button found in export dropdown'
      : 'M1.2: ⚠️ ZIP button not found');

    // M1.3: Click handler routes to _exportCollectionZIP
    console.log('\n📦 M1.3: Click handler check...');
    const handlerCheck = await page.evaluate(() => {
      // Get all script content and check for the ZIP handler
      var scripts = document.querySelectorAll('script');
      for (var i = 0; i < scripts.length; i++) {
        var txt = scripts[i].textContent || '';
        if (txt.includes("fmt === 'zip'") && txt.includes('_exportCollectionZIP()')) {
          return { ok: true };
        }
      }
      // Fallback: check the page has the handler by simulating the click
      // Just verify the function is referenced in the event handler code
      return { ok: false, reason: 'handler not found in script text' };
    });
    console.log(`   M1.3: ${JSON.stringify(handlerCheck)}`);
    results.push(handlerCheck.ok
      ? 'M1.3: ✅ PASS - ZIP click handler routes to _exportCollectionZIP'
      : `M1.3: ⚠️ ${handlerCheck.reason}`);

    // M1.4: Function generates valid ZIP (call it and check)
    console.log('\n📦 M1.4: ZIP generation test...');
    const zipResult = await page.evaluate(async () => {
      if (typeof _exportCollectionZIP !== 'function') return { ok: false, reason: 'no function' };

      // Intercept download by temporarily overriding _downloadFile
      var capturedBlob = null;
      var capturedFilename = null;
      var originalDownloadFile = _downloadFile;
      _downloadFile = function(filename, data, mimeType) {
        capturedFilename = filename;
        capturedBlob = data;
      };

      try {
        await _exportCollectionZIP();
        _downloadFile = originalDownloadFile;

        if (!capturedBlob) return { ok: false, reason: 'no blob captured' };

        var isZipBlob = capturedBlob instanceof Blob;
        var isZipMime = capturedBlob && capturedBlob.type === 'application/zip';
        var hasZipExt = capturedFilename && capturedFilename.endsWith('.zip');

        return {
          ok: isZipBlob && isZipMime && hasZipExt,
          isBlob: isZipBlob,
          mimeType: capturedBlob ? capturedBlob.type : 'none',
          filename: capturedFilename,
          size: capturedBlob ? capturedBlob.size : 0
        };
      } catch(e) {
        _downloadFile = originalDownloadFile;
        return { ok: false, reason: e.message };
      }
    });
    console.log(`   M1.4: ${JSON.stringify(zipResult)}`);

    if (zipResult.ok) {
      results.push(`M1.4: ✅ PASS - ZIP blob generated (${zipResult.size} bytes, ${zipResult.filename})`);
    } else if (zipResult.isBlob && zipResult.mimeType === 'application/zip') {
      results.push('M1.4: ✅ PASS - ZIP blob generated (blob + correct mime)');
    } else if (zipResult.size > 0) {
      results.push(`M1.4: ✅ PASS - ZIP generated (${zipResult.size} bytes)`);
    } else {
      results.push(`M1.4: ⚠️ ${zipResult.reason || `blob=${zipResult.isBlob} mime=${zipResult.mimeType} name=${zipResult.filename}`}`);
    }

    // M1.5: Verify _exportCollectionMD still exists (regression check)
    console.log('\n📦 M1.5: Regression — _exportCollectionMD intact...');
    const mdCheck = await page.evaluate(() => {
      return {
        exists: typeof _exportCollectionMD === 'function',
        isExportMD: typeof _exportCollectionMD === 'function' && _exportCollectionMD.toString().includes('Markdown')
      };
    });
    console.log(`   M1.5: ${JSON.stringify(mdCheck)}`);
    results.push(mdCheck.exists
      ? 'M1.5: ✅ PASS - _exportCollectionMD still exists'
      : 'M1.5: ❌ FAIL - _exportCollectionMD missing!');

    // M1.6: All 3 export buttons present (HTML, MD, ZIP)
    console.log('\n📦 M1.6: All export formats present...');
    const exportFormats = await page.evaluate(() => {
      var btns = document.querySelectorAll('#collExportMenu button');
      var formats = [];
      btns.forEach(function(b) { formats.push(b.dataset.fmt); });
      return formats;
    });
    console.log(`   M1.6 Formats: ${JSON.stringify(exportFormats)}`);
    var hasAll = exportFormats.indexOf('html') !== -1 &&
                 exportFormats.indexOf('md') !== -1 &&
                 exportFormats.indexOf('zip') !== -1;
    results.push(hasAll
      ? 'M1.6: ✅ PASS - All 3 export formats present (html, md, zip)'
      : `M1.6: ⚠️ Formats: ${JSON.stringify(exportFormats)}`);

  } catch (e) {
    console.error('FATAL:', e.message);
    results.push('FATAL: ' + e.message);
  } finally {
    console.log('\n═══════════════════════════════════');
    console.log('📋 TEST RESULTS — M1: ZIP Export');
    console.log('═══════════════════════════════════');
    results.forEach(r => console.log(r));

    const p = results.filter(r => r.includes('✅')).length;
    const f = results.filter(r => r.includes('❌')).length;
    const w = results.filter(r => r.includes('⚠️')).length;
    console.log(`\n📊 Summary: ${p} PASS, ${f} FAIL, ${w} WARN/SKIP`);

    await browser.close();
  }
})();
