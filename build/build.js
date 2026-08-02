#!/usr/bin/env node
// Reassembles the split source files back into single self-contained HTML files.
// Each entry's template has its own app CSS/JS (and, for the editor, a few pre-existing
// vendored third-party blocks) replaced by placeholder tokens. This keeps every entry a
// single file at build time (required: shared as one .html, and openable via
// file:// which blocks ES modules and fetch() of local files — see refactoring-pre.md).
const fs = require('fs');
const path = require('path');

const ROOT = path.join(__dirname, '..');

const ENTRIES = [
  {
    name: 'reader',
    srcDir: 'src/reader',
    outFile: 'index.html',
    slots: [
      { placeholder: '/*__NOESIS_BUILD_CSS__*/', file: 'styles.css' },
      { placeholder: '//__NOESIS_BUILD_JS__', file: 'app.js' },
    ],
  },
  {
    name: 'editor',
    srcDir: 'src/editor',
    outFile: 'noesis-editor.html',
    slots: [
      { placeholder: '/*__NOESIS_BUILD_CSS__*/', file: 'styles.css' },
      { placeholder: '//__NOESIS_BUILD_JS__', file: 'app.js' },
      { placeholder: '/*__NOESIS_VENDOR_SUMMERNOTE_FONTS__*/', file: 'vendor/summernote-fonts.css' },
      { placeholder: '//__NOESIS_VENDOR_TURNDOWN__', file: 'vendor/turndown.js' },
      { placeholder: '//__NOESIS_VENDOR_JSZIP__', file: 'vendor/jszip.js' },
      { placeholder: '//__NOESIS_VENDOR_HTMLDOCX__', file: 'vendor/html-docx.js' },
    ],
  },
];

function build(entry) {
  const srcDir = path.join(ROOT, entry.srcDir);
  let output = fs.readFileSync(path.join(srcDir, 'index.template.html'), 'utf8');

  for (const slot of entry.slots) {
    if (!output.includes(slot.placeholder)) {
      throw new Error(`${entry.name}: template missing placeholder ${slot.placeholder}`);
    }
    const content = fs.readFileSync(path.join(srcDir, slot.file), 'utf8');
    // Function replacer inserts its return value literally — a plain string replacement
    // would misinterpret "$&"/"$1" etc. that appear in vendored minified JS (jQuery's
    // source literally contains "-$&" as a regex replacement pattern).
    output = output.replace(slot.placeholder, () => content);
  }

  const outPath = path.join(ROOT, entry.outFile);
  fs.writeFileSync(outPath, output, 'utf8');
  console.log(`Built ${entry.outFile} from ${entry.srcDir} (${output.length} bytes)`);
}

for (const entry of ENTRIES) build(entry);
