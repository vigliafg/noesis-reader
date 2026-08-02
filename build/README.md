# Build

`node build/build.js` (or `npm run build`) reassembles the split source files back into
the single, self-contained `index.html` and `noesis-editor.html` at the repo root.

## Why this exists

Both files must ship as one `.html` each — they're shared by opening the file directly
(`file://`), and ES modules / `fetch()` of local files are blocked by the browser's CORS
policy under `file://` (classic `<script>`/`<style>` are not). See `refactoring-pre.md`
§6 for details. So the source lives split up for editability, and this script glues it
back into the single-file form required for distribution.

## Layout

```
src/reader/   → builds index.html
src/editor/   → builds noesis-editor.html
  index.template.html   the original file, with the app's own <style>/<script> content
                         replaced by two placeholder tokens
  styles.css            the app's own CSS (was inline <style>)
  app.js                the app's own JS (was the main inline <script>)
```

Everything else (CDN `<script src>` tags, and — in the editor — a few blocks of
already-vendored third-party JS/fonts that predate this split) stays untouched in the
template, exactly where it was.

## Rules for editing

- Edit `styles.css` / `app.js` / `index.template.html` under `src/`, not the generated
  `index.html` / `noesis-editor.html` directly — those are build output and get
  overwritten.
- Run `npm run build` after any change, then verify the app still works (see
  `refactoring-pre.md` for the manual replay checklist and the E2E suite).
- No bundler, no modules, no transforms — this step is a pure mechanical extraction. It
  intentionally does not change behavior: rebuilding from the current `src/` reproduces
  the pre-split `index.html`/`noesis-editor.html` byte-for-byte.
