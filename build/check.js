#!/usr/bin/env node
// Fast sanity check — run this after every edit. Takes about a second.
//
//   npm run check
//
// It does NOT replace `npm test` (the browser suites). It catches the mistakes that are
// cheap to catch: syntax errors, unbalanced CSS, and references to names that don't exist
// anywhere. Those are the failures that otherwise show up as a blank page or a dead button
// and cost a long debugging session.
const fs = require('fs');
const path = require('path');
const { spawnSync } = require('child_process');

const ROOT = path.join(__dirname, '..');
const JS_DIRS = ['src/reader/js', 'src/editor/js'];
const CSS_DIRS = ['src/reader/css', 'src/editor/css'];

let failures = 0;
const fail = (msg) => { console.error('  ✗ ' + msg); failures++; };
const listing = (dir) => fs.readdirSync(path.join(ROOT, dir)).filter((f) => !f.startsWith('.')).sort();

// 1. The build has to succeed at all.
console.log('Building...');
if (spawnSync(process.execPath, [path.join(__dirname, 'build.js')], { stdio: 'inherit' }).status !== 0) {
  console.error('\nBuild failed — nothing else can be checked.');
  process.exit(1);
}

// 2. Every JS part file must parse ON ITS OWN. They're concatenated into one script, so a
//    file that only parses in combination with its neighbours would still build fine — but
//    it means a block spans a file boundary, which makes the file impossible to reason
//    about or check in isolation. That has happened before; keep it from coming back.
console.log('\nChecking JS parts parse standalone...');
for (const dir of JS_DIRS) {
  for (const f of listing(dir)) {
    const file = path.join(ROOT, dir, f);
    const r = spawnSync(process.execPath, ['--check', file], { encoding: 'utf8' });
    if (r.status !== 0) {
      fail(`${dir}/${f} does not parse on its own — a block probably spans the file boundary`);
      console.error('    ' + (r.stderr || '').split('\n').slice(1, 3).join('\n    ').trim());
    }
  }
}

// 3. CSS parts must be brace-balanced, for the same reason: a rule or @media block split
//    across two files is legal after concatenation but unreadable and easy to break.
console.log('Checking CSS parts are balanced...');
for (const dir of CSS_DIRS) {
  for (const f of listing(dir)) {
    const css = fs.readFileSync(path.join(ROOT, dir, f), 'utf8').replace(/\/\*[\s\S]*?\*\//g, '');
    const depth = [...css].reduce((d, c) => d + (c === '{' ? 1 : c === '}' ? -1 : 0), 0);
    if (depth !== 0) {
      fail(`${dir}/${f} has unbalanced braces (${depth > 0 ? depth + ' unclosed' : -depth + ' extra closing'})`);
    }
  }
}

// 4. Every referenced name must be declared somewhere. This is the check that finds real
//    bugs — a typo'd identifier, or a function called across files that is actually nested
//    inside another function and therefore out of scope (a real one shipped this way for a
//    long time: the editor's New Document and Discard buttons both threw ReferenceError).
//
//    We deliberately enforce ONLY the name-resolution errors. Full type checking on this
//    codebase reports ~250 more, nearly all of the form "TS can't prove document
//    .getElementById returned an <input>" — true statements about a legacy DOM codebase,
//    but noise here, and a check nobody can ever get to zero is a check everybody ignores.
//    Names that legitimately come from elsewhere are declared in build/globals.d.ts.
console.log('Checking every name resolves...');
const NAME_ERRORS = /error TS(2304|2552|2592)\b/; // cannot find name / did you mean / needs @types
const tsc = path.join(ROOT, 'node_modules', '.bin', 'tsc');
if (!fs.existsSync(tsc)) {
  console.log('  (skipped: typescript not installed — run `npm install`)');
} else {
  const out = spawnSync(tsc, ['-p', path.join(__dirname, 'tsconfig.check.json')], { encoding: 'utf8' });
  const hits = (out.stdout || '').split('\n').filter((l) => NAME_ERRORS.test(l));
  for (const h of hits) fail(h.replace(/^.*[/\\]src[/\\]/, 'src/'));
}

console.log(failures === 0
  ? '\n✓ All checks passed.'
  : `\n✗ ${failures} problem${failures === 1 ? '' : 's'} found.`);
process.exit(failures === 0 ? 0 : 1);
