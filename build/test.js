#!/usr/bin/env node
// Runs the end-to-end suites against THIS checkout.
//
// Why this exists: the suites need the pages over http:// (not file://), and they used to
// rely on you having started `python3 -m http.server 8765` by hand. If something else was
// already listening on 8765 — another checkout, someone else's server — the tests would
// happily run against *that* and report passes for code you never wrote. This starts its
// own server on a free port, points the suites at it, and shuts it down afterwards.
const http = require('http');
const fs = require('fs');
const path = require('path');
const { spawn } = require('child_process');

const ROOT = path.join(__dirname, '..');
const SUITES = ['test_e2e_complete.js', 'test_editor_toolbar.js'];

const TYPES = {
  '.html': 'text/html', '.js': 'text/javascript', '.css': 'text/css',
  '.json': 'application/json', '.epub': 'application/epub+zip',
  '.png': 'image/png', '.svg': 'image/svg+xml',
};

const server = http.createServer((req, res) => {
  const rel = decodeURIComponent(req.url.split('?')[0]).replace(/^\/+/, '') || 'index.html';
  const file = path.join(ROOT, rel);
  // Don't serve anything outside the repo.
  if (!file.startsWith(ROOT) || !fs.existsSync(file) || fs.statSync(file).isDirectory()) {
    res.writeHead(404); res.end('not found'); return;
  }
  res.writeHead(200, {
    'Content-Type': TYPES[path.extname(file)] || 'application/octet-stream',
    'Cache-Control': 'no-store', // always test what's on disk right now
  });
  fs.createReadStream(file).pipe(res);
});

// NOTE: this must stay asynchronous. `spawnSync` here would block the event loop for the
// whole run, so the server above could never answer a request and every suite would hang
// waiting on it — which is exactly what happened the first time this was written.
function run(suite, baseUrl) {
  return new Promise((resolve) => {
    console.log(`── ${suite} ──`);
    const child = spawn(process.execPath, [suite], {
      cwd: ROOT,
      stdio: 'inherit',
      env: { ...process.env, NOESIS_BASE_URL: baseUrl },
    });
    child.on('close', (code) => resolve(code === 0));
  });
}

server.listen(0, '127.0.0.1', async () => {
  const baseUrl = `http://127.0.0.1:${server.address().port}`;
  console.log(`Serving ${ROOT} at ${baseUrl}\n`);

  let ok = true;
  for (const suite of SUITES) {
    const started = Date.now();
    const passed = await run(suite, baseUrl);
    console.log(`   ${suite}: ${passed ? 'passed' : 'FAILED'} in ${Math.round((Date.now() - started) / 1000)}s\n`);
    if (!passed) ok = false;
  }

  server.close();
  process.exit(ok ? 0 : 1);
});
