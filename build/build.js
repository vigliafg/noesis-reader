#!/usr/bin/env node
// Reassembles the split source files back into single self-contained HTML files.
// Each entry's <style>/<script> app code lives in src/<entry>/{styles.css,app.js};
// the template has them replaced by placeholder tokens. This keeps every entry a
// single file at build time (required: shared as one .html, and openable via
// file:// which blocks ES modules and fetch() of local files — see refactoring-pre.md).
const fs = require('fs');
const path = require('path');

const ROOT = path.join(__dirname, '..');

const ENTRIES = [
  { name: 'reader', srcDir: 'src/reader', outFile: 'index.html' },
  { name: 'editor', srcDir: 'src/editor', outFile: 'noesis-editor.html' },
];

function build(entry) {
  const srcDir = path.join(ROOT, entry.srcDir);
  const template = fs.readFileSync(path.join(srcDir, 'index.template.html'), 'utf8');
  const css = fs.readFileSync(path.join(srcDir, 'styles.css'), 'utf8');
  const js = fs.readFileSync(path.join(srcDir, 'app.js'), 'utf8');

  if (!template.includes('/*__NOESIS_BUILD_CSS__*/')) {
    throw new Error(`${entry.name}: template missing CSS placeholder`);
  }
  if (!template.includes('//__NOESIS_BUILD_JS__')) {
    throw new Error(`${entry.name}: template missing JS placeholder`);
  }

  // Function replacers insert their return value literally — plain string replacements
  // would misinterpret "$&"/"$1" etc. that appear in vendored minified JS (jQuery's
  // source literally contains "-$&" as a regex replacement pattern).
  const output = template
    .replace('/*__NOESIS_BUILD_CSS__*/', () => css)
    .replace('//__NOESIS_BUILD_JS__', () => js);

  const outPath = path.join(ROOT, entry.outFile);
  fs.writeFileSync(outPath, output, 'utf8');
  console.log(`Built ${entry.outFile} from ${entry.srcDir} (${output.length} bytes)`);
}

for (const entry of ENTRIES) build(entry);
