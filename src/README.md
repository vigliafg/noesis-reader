# `src/` — where you actually edit the code

## The one rule

**`index.html` and `noesis-editor.html` in the repo root are generated files. Never edit
them.** Any change you make there will be silently thrown away the next time the project
is built. Edit the files under `src/` instead, and the two `.html` files get rebuilt from
them.

Why they exist at all: both apps have to stay *single self-contained `.html` files*, so
they can be sent to someone who just double-clicks them. Opening a page from `file://`
blocks the browser features that would let one HTML file load its JavaScript from another
(ES modules and `fetch()`), so everything genuinely has to end up inside the one file. The
build is what lets us keep the source split into readable pieces anyway.

## Working on it

```sh
npm run watch    # rebuilds automatically every time you save a file under src/
```

Leave that running in a terminal while you work, then just refresh the browser.

```sh
npm run build    # one-off build
npm run check    # ~2 seconds — run this after every change
npm test         # the browser test suites — ~3 minutes, run before you finish
```

**`npm run check` is the one to use constantly.** It builds, then verifies three things
that are cheap to get wrong and expensive to discover later:

1. every JS part file parses on its own,
2. every CSS part file has balanced braces,
3. **every name the code references actually exists somewhere.**

That third one is the valuable one. If you type `showLoadng()` instead of `showLoading()`,
or call a function that turns out to be nested inside another function in a different file,
this tells you in two seconds — instead of it showing up as a button that silently does
nothing. A real bug of exactly that kind (the editor's New Document and Discard buttons)
lived in this codebase for a long time and is what prompted adding the check.

It deliberately does *not* do full type checking. That would report ~250 more complaints,
almost all of them "TypeScript can't prove `getElementById` returned an `<input>`" — true,
but not worth acting on here, and a check nobody can get to zero is a check everybody
learns to ignore.

`npm run build` and `npm run watch` need nothing installed — plain Node, no dependencies.
`npm run check` and `npm test` need `npm install` first (TypeScript and Puppeteer). Note
`npm test` starts its own web server on a free port, so it always tests *this* checkout —
it can't accidentally test some other copy that happens to be running.

## Layout

```
src/
  reader/                  → builds to index.html          (the EPUB reader)
    index.template.html    the page skeleton: <head>, markup, CDN <script> tags,
                           and the placeholder tokens the build fills in
    css/                   the stylesheet, in pieces
    js/                    the application code, in pieces
  editor/                  → builds to noesis-editor.html   (the chapter editor)
    index.template.html
    css/
    js/
    vendor/                third-party libraries that live inside the file
                           (jQuery, Summernote, Turndown, JSZip, html-docx-js)
build/build.js             the build script — ~90 lines, read it, it's short
build/check.js             the fast check (`npm run check`)
build/test.js              starts a server, runs the browser suites (`npm test`)
build/globals.d.ts         declares names that come from outside the source (jQuery,
                           JSZip, epub.js …) so the name check has no false
                           positives — read the warning at its top before adding
```

The pieces are named `00-something.js`, `01-something-else.js`, and so on. The name says
what's in it; the number says where it goes.

## How the build works

`build/build.js` reads `index.template.html`, finds the placeholder tokens in it
(`/*__NOESIS_BUILD_CSS__*/`, `//__NOESIS_BUILD_JS__`, and the `//__NOESIS_VENDOR_*__`
ones), and replaces each with the contents of the corresponding file or directory. A
directory's files are concatenated **in filename order** — that's what the number prefixes
are for. Nothing is inserted between them; the result is exactly as if you'd typed all
those files into one big `<script>`.

### Adding a new piece

Drop a file into `css/` or `js/` with a number prefix and rebuild. You do **not** need to
edit `build.js` — it picks up whatever is in the directory.

### The one thing that can bite you: order

Because the pieces become a single script, the order they're concatenated in is the order
the browser sees. Renaming or renumbering a file changes that order. Regular `function`
declarations survive being moved around, but anything that *runs immediately* at the top
level, and any top-level `const`/`let`, does not. CSS is even more sensitive: later rules
override earlier ones by design, and the mobile `@media` sections are at the end for
exactly that reason.

So: **add new files at the end, and don't renumber existing ones without a reason.**

## Checking you didn't break anything

If you only *moved* code between files without changing it, the generated HTML should come
out exactly the same as before:

```sh
npm run build && git diff --stat -- index.html noesis-editor.html   # should be empty
```

An empty diff proves nothing changed, and no further testing is needed. If you actually
changed code, that diff *will* show something — that's expected — and the check becomes
`npm run check`, then `npm test`, plus clicking through the app yourself.
