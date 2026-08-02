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
                         (and, for the editor, its vendored third-party blocks) replaced
                         by placeholder tokens
  styles.css            the app's own CSS (was inline <style>)
  app.js                the app's own JS (was the main inline <script>)
  vendor/                editor only — pre-existing vendored third-party code that
                         predates this split (not CDN-loaded), pulled out of the
                         template the same mechanical way:
    summernote-fonts.css  Summernote's icon font-face block
    turndown.js           vendored Turndown (HTML→Markdown)
    jszip.js               vendored JSZip
    html-docx.js           vendored html-docx-js

```

CDN `<script src>` tags (jszip/epubjs/turndown for the reader, jquery/summernote for the
editor) stay untouched in the template, per instruction to keep sharing the app the same
way for now.

## Rules for editing

- Edit `styles.css` / `app.js` / `index.template.html` under `src/`, not the generated
  `index.html` / `noesis-editor.html` directly — those are build output and get
  overwritten.
- Run `npm run build` after any change, then verify the app still works (see
  `refactoring-pre.md` for the manual replay checklist and the E2E suite).
- No bundler, no modules, no transforms — this step is a pure mechanical extraction. It
  intentionally does not change behavior: rebuilding from the current `src/` reproduces
  the pre-split `index.html`/`noesis-editor.html` byte-for-byte.
