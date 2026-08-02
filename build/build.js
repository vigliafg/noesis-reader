#!/usr/bin/env node
// Reassembles the split source files back into single self-contained HTML files.
// Each entry's template has its own app CSS/JS (and, for the editor, a few pre-existing
// vendored third-party blocks) replaced by placeholder tokens. This keeps every entry a
// single file at build time (required: shared as one .html, and openable via
// file:// which blocks ES modules and fetch() of local files — see refactoring-pre.md).
const fs = require('fs');
const path = require('path');

const ROOT = path.join(__dirname, '..');

// A slot is one placeholder in the template (or in already-inserted content) and the
// source it gets replaced with:
//   { placeholder, file: 'app.js' }  → that one file
//   { placeholder, dir: 'js' }       → every file in that directory, concatenated in
//                                      filename order (hence the NN- prefixes)
//
// ORDER MATTERS. The parts of a `dir` slot end up as one <script>/<style>, so renaming or
// renumbering a file changes the order things are defined and run in. `function`
// declarations hoist across the whole concatenated script, but top-level `const`/`let`
// and any statement that runs immediately do not — renumbering can break the page in ways
// no test will obviously point at. Add new files at the end, or slot them in deliberately.
// Nothing is inserted between parts (no banner comments): a pure concatenation means a
// pure file-move is verifiable by rebuilding and checking `git diff` is empty.

const ENTRIES = [
  {
    name: 'reader',
    srcDir: 'src/reader',
    outFile: 'index.html',
    slots: [
      { placeholder: '/*__NOESIS_BUILD_CSS__*/', dir: 'css' },
      { placeholder: '//__NOESIS_BUILD_JS__', dir: 'js' },
    ],
  },
  {
    name: 'editor',
    srcDir: 'src/editor',
    outFile: 'noesis-editor.html',
    slots: [
      { placeholder: '/*__NOESIS_BUILD_CSS__*/', dir: 'css' },
      { placeholder: '//__NOESIS_BUILD_JS__', dir: 'js' },
      { placeholder: '/*__NOESIS_VENDOR_SUMMERNOTE_FONTS__*/', file: 'vendor/summernote-fonts.css' },
      { placeholder: '//__NOESIS_VENDOR_TURNDOWN__', file: 'vendor/turndown.js' },
      { placeholder: '//__NOESIS_VENDOR_JSZIP__', file: 'vendor/jszip.js' },
      { placeholder: '//__NOESIS_VENDOR_HTMLDOCX__', file: 'vendor/html-docx.js' },
      { placeholder: '//__NOESIS_VENDOR_JQUERY__', file: 'vendor/jquery.js' },
      { placeholder: '//__NOESIS_VENDOR_SUMMERNOTE__', file: 'vendor/summernote.js' },
    ],
  },
];

function readSlot(srcDir, slot, entryName) {
  if (slot.file) return fs.readFileSync(path.join(srcDir, slot.file), 'utf8');

  const dir = path.join(srcDir, slot.dir);
  if (!fs.existsSync(dir)) {
    throw new Error(`${entryName}: slot directory not found: ${slot.dir}`);
  }
  const files = fs.readdirSync(dir).filter((f) => !f.startsWith('.')).sort();
  if (files.length === 0) {
    throw new Error(`${entryName}: slot directory is empty: ${slot.dir}`);
  }
  return files.map((f) => fs.readFileSync(path.join(dir, f), 'utf8')).join('');
}

function build(entry) {
  const srcDir = path.join(ROOT, entry.srcDir);
  let output = fs.readFileSync(path.join(srcDir, 'index.template.html'), 'utf8');

  for (const slot of entry.slots) {
    if (!output.includes(slot.placeholder)) {
      throw new Error(`${entry.name}: template missing placeholder ${slot.placeholder}`);
    }
    const content = readSlot(srcDir, slot, entry.name);
    // Function replacer inserts its return value literally — a plain string replacement
    // would misinterpret "$&"/"$1" etc. that appear in vendored minified JS (jQuery's
    // source literally contains "-$&" as a regex replacement pattern).
    output = output.replace(slot.placeholder, () => content);
  }

  const outPath = path.join(ROOT, entry.outFile);
  fs.writeFileSync(outPath, output, 'utf8');
  console.log(`Built ${entry.outFile} from ${entry.srcDir} (${output.length} bytes)`);
}

function buildAll() {
  for (const entry of ENTRIES) build(entry);
}

// `node build/build.js --watch` (npm run watch): rebuild whenever anything under src/
// changes, so editing a source file is enough — no need to remember to run the build.
// Editors often fire several events per save, so rebuilds are debounced. A build error
// (e.g. a half-written file) is reported and the watcher keeps running.
function watch() {
  let timer = null;
  const rebuild = () => {
    timer = null;
    try {
      buildAll();
    } catch (err) {
      console.error('Build failed:', err.message);
    }
  };

  fs.watch(path.join(ROOT, 'src'), { recursive: true }, () => {
    if (timer) clearTimeout(timer);
    timer = setTimeout(rebuild, 100);
  });

  rebuild();
  console.log('Watching src/ — edit a source file and the .html files rebuild. Ctrl+C to stop.');
}

if (process.argv.includes('--watch')) watch();
else buildAll();
