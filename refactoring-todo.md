# Noesis Reader — Refactoring TODO / Handoff

Read `refactoring-pre.md` first — it's the full review (structure, code issues, test
baseline, manual exploration notes). This file is the running log of what's actually been
*done* so far, and what's next. Update it as you go; it's meant to let a fresh session
pick up without re-deriving context.

## Hard constraints (don't relitigate these)

- **Both `index.html` and `noesis-editor.html` must remain single, self-contained files**
  at the end of every step. They're shared by opening the file directly (`file://`), and
  ES modules / `fetch()` of local files are blocked by CORS under `file://` — confirmed
  empirically, see `refactoring-pre.md` §6. Classic `<script>`/`<style>` are not blocked.
- **CDN `<script src>` tags stay as CDN tags** — not being vendored/inlined in this phase
  (explicit instruction; revisit later if wanted).
- Source lives split up under `src/`; the repo-root `index.html`/`noesis-editor.html` are
  **build output** — never hand-edit them directly, edit `src/` and run `npm run build`.
- `test.epub` (64MB fixture) and `node_modules/` are gitignored, present locally, not
  meant to be committed. `*.md` is gitignored by default too — new `.md` files need
  `git add -f` (see `.gitignore`, existing docs `AGENTS.md`/`PLAN.md`/`README.md` predate
  that rule).

## Done so far (2026-08-02)

1. **E2E baseline established** — `test_e2e_complete.js` 31/31, `test_editor_toolbar.js`
   140/140, both passing. This is the safety net; re-run after any step that could change
   behavior (i.e. anything that *isn't* a provably byte-identical rebuild).
2. **Manual exploration** of real-but-untested features (library management, TOC,
   bookmarks, theming, navigate modes, extract formats, in-book highlighting) — see
   `refactoring-pre.md` §5 for the list and the **manual replay checklist** to run through
   by hand once real code changes (not just mechanical splits) start landing.
3. **First split increment** (`refactoring-pre.md` §7): moved each entry's inline
   `<style>`/`<script>` into `src/{reader,editor}/{styles.css,app.js}` + a template with
   placeholder tokens. `npm run build` (`build/build.js`) reassembles them.
4. **Vendor extraction** (this step): pulled the editor's pre-existing vendored
   third-party blocks (Summernote fonts, Turndown, JSZip, html-docx-js — these were
   already inlined directly in the file before this refactor started, not CDN-loaded) out
   into `src/editor/vendor/*`, same placeholder-token mechanism.
5. **Verified byte-identical, both times** — rebuilding from `src/` reproduces the
   pre-split `index.html`/`noesis-editor.html` exactly (`md5sum` match). Because of that,
   the E2E suite was **not** re-run after step 4 — a byte-identical rebuild can't have
   changed behavior, so there's nothing new to catch. If a future step is *not*
   byte-identical (i.e. actually changes generated output), re-run the suite before
   calling it done.
6. Found and fixed one real bug in `build.js` along the way: `String.replace(placeholder,
   content)` mangles `$&`/`$1`-style sequences in the replacement string — jQuery's
   vendored source literally contains `"-$&"`. Fixed with a function replacer
   (`.replace(placeholder, () => content)`). Any future templating code in this repo
   should use function replacers, not plain string replacements — there's a lot of
   minified third-party code with `$`-bearing strings sitting in these files.

7. **Steps 1–5 of the plan below are now DONE** (2026-08-02, later the same day). Actual
   result:
   - `build/build.js` grew `dir:` slots (a placeholder filled from a whole directory,
     filename-sorted) and a `--watch` mode.
   - `src/reader/app.js` → **21 files** in `src/reader/js/` (`00-errors.js` … `20-mobile.js`).
     Every boundary landed on the anchors listed in Step 2 below; no rows had to merge.
   - `src/editor/app.js` → **11 files** in `src/editor/js/` (`00-collection-db.js` …
     `10-snapshots.js`), plus jQuery 3.7.1 and Summernote Lite 0.9.1 pulled out of the
     middle of the app code into `src/editor/vendor/{jquery,summernote}.js`. Their
     `/* … inline */` banner comments stayed behind in `05-init-editor.js` next to the
     placeholders. Note the real file was 1750 lines, not 1749 — no trailing newline.
   - `src/reader/styles.css` → **15 files** in `src/reader/css/`; `src/editor/styles.css` →
     **8 files** in `src/editor/css/`. Two boundaries moved from the suggestions below:
     reader 2985→2949 (2985 was mid-section) and editor 896→891 (896 was *inside* the
     `@media (max-width: 768px)` block opened at 895 — exactly the failure mode the step
     warned about).
   - **Every split verified byte-identical** — rebuild produced a zero-byte diff on
     `index.html`/`noesis-editor.html` at each stage.
   - `package.json`: added `watch` and `test` scripts. `src/README.md` written (the
     orientation doc). `AGENTS.md` updated: points at `src/`, and its Test Infrastructure
     section's stale absolute paths from another machine were fixed.
   - **Final E2E run: `test_e2e_complete.js` 31/31, `test_editor_toolbar.js` 140/140** —
     unchanged from baseline.
   - Two trailing-newline bugs were hit and fixed during the work (a vendor file keeping
     its extracted `\n` on top of the placeholder line's own; an off-by-one end boundary on
     a file with no final newline). If a future split produces a non-empty diff of a few
     bytes, look there first.

8. **Follow-up round: verification tooling + two real bug fixes** (2026-08-02).
   - **Fixed a bad split boundary.** `17-media-dialog.js` opened a `DOMContentLoaded` block
     that `18-reader-ui.js` closed — the agent doing the split misread which `});` was the
     closer. Output was always correct, but neither file parsed standalone. Re-split into
     `17-media-dialog.js` / `18-dom-ready.js` / `19-reader-ui.js`, renumbering menus→`20`,
     mobile→`21`. All 32 JS part files now parse on their own, and `npm run check`
     enforces it so it can't silently come back.
   - **Found and fixed two real, pre-existing bugs.** `_deleteContentDraft` and
     `_discardDocument` were declared *inside* `function initEditor()` but called from
     top-level scope in `01-document.js`. The editor's **New Document** and **Discard**
     buttons both threw `ReferenceError`. Confirmed in a real browser against the
     pre-refactor `noesis-editor.html` from git, so this predates all of this work — the
     140/140 editor suite passed because it drives those functions through `window.__test`,
     which is the one path that worked. Fixed by hoisting the draft-persistence family
     (`_DRAFT_KEY`, `_saveContentDraft`, `_loadContentDraft`, `_deleteContentDraft`,
     `_discardDocument`) out of `initEditor` to file top level.
   - **`npm run check` (~2s)** — `build/check.js`. Builds, then checks (a) each JS part
     parses standalone, (b) each CSS part is brace-balanced, (c) **every referenced name
     resolves**. (c) is TypeScript in linter mode via `build/tsconfig.check.json` +
     `build/globals.d.ts`, enforcing *only* TS2304/TS2552/TS2592. Deliberately not full
     type checking: that reports ~250 more, ~85% of them "TS can't prove
     `getElementById` returned an `<input>`" — see the reasoning in `build/check.js`. The
     name check is what found the two bugs above.
   - **`npm test` now starts its own server** (`build/test.js`) on a free port. Previously
     `BASE_URL` was hardcoded to `127.0.0.1:8765`, so the suites tested *whatever* was
     serving on that port. During this session that was another user's checkout — an
     earlier "31/31, 140/140" was measured against the wrong files. Both suites now honour
     `NOESIS_BASE_URL`. **If you write a server that runs the suites in-process, it must
     use async `spawn`, not `spawnSync`** — `spawnSync` blocks the event loop, so the
     server can't answer and every suite hangs. That cost 20 minutes here.
   - **Real E2E baseline, verified against this checkout: 31/31 (96s) and 140/140 (85s),
     ~3 minutes total.** The "~7 min" figure from the previous round was inflated.

---

# Plan for the remaining work (revised 2026-08-02) — Steps 1–5 COMPLETE

Kept below as the record of *why* the structure looks like it does. Only the Backlog at
the bottom is still outstanding.

## Guiding decision: keep the build boring

The previous draft of this file proposed esbuild + TypeScript + a shared `core/` module
layer. **That is now explicitly out of scope**, for two reasons:

1. **Goal is maintainability by a non-specialist**, not enterprise tooling. `npm run
   build` today is `node build/build.js` — no bundler, no transpiler, no `node_modules`
   needed to build (puppeteer is only needed for the *tests*). Adding esbuild/TS means the
   next person has to learn a toolchain before they can move a line of CSS. Not worth it.
2. **The "duplicated" reader/editor code is not actually duplicated** — checked. The
   reader's `_saveCollectionToDB`/`_loadCollectionFromDB`/`_saveChunk` are `async`/`await`
   over `currentBookId`/`STORE_NAME` with toast reporting; the editor's are
   callback/`Promise`-style over `_bookId`/`_COL_STORE_NAME` with `snToast`. They're
   *semantically parallel*, not textually shared. Merging them is a behavior-affecting
   rewrite of the persistence layer — the highest-risk change available — for a payoff of
   ~80 saved lines. Deferred to backlog, deliberately.

So: this phase is **100% mechanical**. Every step is a pure line-range move of existing
bytes into more files, plus a build step that concatenates them back in a declared order.

## The verification rule that makes this safe

A pure line-range split, concatenated back in the same order, produces a **byte-identical**
`index.html` / `noesis-editor.html`. So the check after every step is:

```sh
npm run build && git diff --stat -- index.html noesis-editor.html   # must be EMPTY
```

Empty diff = provably zero behavior change, no need to run the E2E suite. **If that diff
is ever non-empty, the step was done wrong** — something got reordered, or a trailing
newline was added/dropped when writing a part file. Fix the split rather than accepting
the diff. (Watch trailing newlines specifically: splitting `sed -n 'A,Bp'` style output
and re-joining is where a stray `\n` creeps in.)

E2E is only needed for the doc/`package.json` steps at the end, and as one final
confirmation run.

## Step 1 — `build/build.js`: concatenate a directory into a slot

Change the slot format so a placeholder can be filled from *many* files instead of one:

- keep `{ placeholder, file }` working for the vendor slots (single file each),
- add `{ placeholder, dir }` → reads every file in `path.join(srcDir, dir)`, sorts by
  filename (that's what the numeric `NN-` prefixes below are for), concatenates in that
  order, no separators/banners inserted (banners would break byte-identity — skip them).
- Keep the existing function-replacer (`() => content`) — see Done §6.
- Error loudly if the dir is missing or empty, same spirit as the existing missing
  placeholder check.

The `NN-` numeric prefix is the ordering mechanism and it matters: these files are
concatenated into one script, and **top-level statements that execute immediately can call
functions defined in a later chunk only if hoisting covers them** — hoisting works across
the concatenated whole for `function` declarations, but `const`/`let` at top level do not
hoist, and any immediately-running top-level call is order-sensitive. Since this phase
preserves the original order exactly, that risk is zero *now*; it becomes real the moment
someone renumbers a file. Say so in a comment in `build.js`.

## Step 2 — split `src/reader/app.js` (5858 lines) into `src/reader/js/`

Target boundaries below. Line numbers are from the current `src/reader/app.js` and are
**approximate section anchors** — the implementer must snap each boundary to the nearest
*top-level* statement edge (indent-4 in this file) and verify brace/paren balance per
file. Do not split inside a function body. Adjust and record the real ranges.

| file | approx. lines | contents |
|---|---|---|
| `00-errors.js`           | 1–16      | global error handler, old service-worker unregister |
| `01-storage.js`          | 17–88     | `formatBytes`, `getStorageInfo`, `updateStorageBar`, `checkQuotaBeforeSave` |
| `02-db.js`               | 89–267    | `noesisDB` (extracted chapters/snapshots) + `EpubLibraryDB` open/upgrade |
| `03-epub-library.js`     | 268–431   | EPUB validation, DRM detect, `saveBookToDB`/`getAllBooks`/`deleteBook` |
| `04-views.js`            | 432–505   | loading overlay, `showLibrary`/`showReader` |
| `05-extract-export.js`   | 506–812   | clean-HTML gen, txt/md/epub/pdf/zip writers, editor bridge, `_downloadFile` |
| `06-library-view.js`     | 813–998   | `loadLibraryBooks`, `openBookFromLibrary`, snapshot import |
| `07-state.js`            | 999–1044  | reader globals, autosave/display-prompt state, current-book tracking |
| `08-collection.js`       | 1045–1413 | collection model, badges, JSON/HTML/MD/ZIP export, import |
| `09-autosave.js`         | 1414–1705 | toast, CFI center, autosave timers, book-state save/load, status bar |
| `10-chapter-nav.js`      | 1706–1812 | spine prev/next, font/line-height info, interface settings, color utils |
| `11-chapter-extract.js`  | 1813–2445 | `navigateToHref`, tree extraction, `extractCurrentChapter` (the big ones) |
| `12-theme.js`            | 2446–2553 | 15 theme definitions, `applyTheme`, theme popup |
| `13-rendition.js`        | 2554–2750 | epub.js rendition hooks, `recreateRendition` |
| `14-toc.js`              | 2751–2903 | breadcrumbs, `renderBookmarksSimple`, TOC highlight + toolbar |
| `15-user-bookmarks.js`   | 2904–3173 | user bookmarks module (save/load/render/create, drawer) |
| `16-collection-drawer.js`| 3174–3423 | collection drawer, chapter filter, chunk viewer |
| `17-media-dialog.js`     | 3424–4171 | media tap handler + preview dialog + `_doDownload` + test hooks |
| `18-reader-ui.js`        | 4172–5051 | file input, sidebar sizing, theme toggle, event listeners, touch zones, highlight logic, help overlays |
| `19-menus.js`            | 5052–5521 | reader menu system, iframe click injection, navigate modes, print |
| `20-mobile.js`           | 5522–5858 | hamburger, TOC overlay, drawers, swipe nav, brand animation |

Note `17-media-dialog.js` and `18-reader-ui.js` sit inside/around a large listener block
(`window.addEventListener('DOMContentLoaded', …)` opens ~3822 and its indent-0 `});` is at
4171). **A file boundary must not land inside that block** — snap outward. If honouring
that forces two of the rows above to merge, merge them and note it.

## Step 3 — split `src/editor/app.js` (1749 lines) into `src/editor/js/`

Two things happen here. First, **finish the vendor extraction**: lines ~917–924 of
`src/editor/app.js` contain inlined minified **jQuery 3.7.1** and **Summernote Lite
0.9.1** sitting in the middle of application code. Move them to
`src/editor/vendor/jquery.js` and `src/editor/vendor/summernote.js` with their own
placeholders, exactly like the existing vendor slots. They must stay at the same position
in the output (Summernote's init runs right after), so the placeholders go in the
corresponding `NN-` app file, not in the template.

Then split the rest:

| file | approx. lines | contents |
|---|---|---|
| `00-collection-db.js`  | 1–113     | `_openColDB`, collection save/load, reader-collection bridge |
| `01-document.js`       | 114–155   | `_newDocument`, first `DOMContentLoaded` |
| `02-collection.js`     | 156–332   | `snToast`, timestamps, `_enrichChunk`/`_saveChunk`/`_clearCollection`, counter |
| `03-collection-io.js`  | 333–531   | add-chunk button, import/export JSON/MD/HTML/ZIP |
| `04-inspect.js`        | 532–903   | inspect panel, filters, injection, chunk fullscreen |
| `05-init-editor.js`    | 904–1202  | clear confirm, **the two vendor placeholders**, `_calcEditorHeight`, `initEditor` |
| `06-export.js`         | 1203–1289 | `download`/`getContent`, TXT/MD/ZIP/JSON/PDF/DOCX export |
| `07-dropdowns.js`      | 1290–1353 | dropdown open/close/toggle wiring |
| `08-import.js`         | 1354–1528 | `_loadChapterFile`, snapshot grouping, import dialog |
| `09-bridge.js`         | 1529–1558 | `_idbPost`, `postMessage` listener (reader↔editor bridge) |
| `10-snapshots.js`      | 1559–end  | export-main button, `exportHTMLBook`, remainder |

## Step 4 — split the two `styles.css` files the same way

Same mechanism (`dir` slot), same byte-identity check. Split at the existing top-level
`/* --- SECTION --- */` comments — they're already there and already describe the
structure, so this is the least-judgement part of the job.

`src/reader/styles.css` (3829 lines) → `src/reader/css/`, roughly:
`00-global.css` (1–21), `01-library.css` (22–678), `02-reader.css` (679–891),
`03-bookmarks-drawer.css` (892–977), `04-collection-drawer.css` (978–1592),
`05-extract-menu.css` (1593–1736), `06-theme-picker.css` (1737–2351),
`07-typography.css` (2352–2507), `08-media-dialog.css` (2508–2755),
`09-display-prompt.css` (2756–2804), `10-highlight.css` (2805–2984),
`11-help-overlays.css` (2985–3510), `12-nav-mode.css` (3511–3566),
`13-print.css` (3567–3592), `14-mobile.css` (3593–3829).

`src/editor/styles.css` (1001 lines) → `src/editor/css/`, roughly:
`00-base.css` (1–45), `01-help-overlay.css` (46–153), `02-toolbar.css` (154–325),
`03-inspect.css` (326–562), `04-import-overlay.css` (563–676),
`05-chunk-fullscreen.css` (677–765), `06-hamburger.css` (766–895),
`07-mobile.css` (896–end).

**CSS ordering is load-bearing** (cascade + later `@media` overrides). Preserving original
order is mandatory — which the byte-identity check enforces for free.

## Step 5 — docs + scripts + watch mode (the only non-byte-identical step)

- `npm run watch` (`node build/build.js --watch`): `fs.watch` on `src/` with a 100ms
  debounce, rebuilds on save, keeps running through build errors. Zero dependencies, ~20
  lines. This is the intended day-to-day workflow — leave it running, edit `src/`, refresh
  the browser. Nobody should have to remember to run a build.

- `package.json`: add `"test": "node test_e2e_complete.js && node test_editor_toolbar.js"`
  so the suite has an obvious entry point.
- Write `src/README.md` — the orientation doc for whoever picks this up next. Must say, in
  plain language: root `.html` files are generated, never edit them; edit `src/`, run
  `npm run build`; what each directory is; that `NN-` prefixes control concatenation order
  and renumbering can break things; how to add a new file (drop it in the dir with a
  number, rebuild — no build.js edit needed); and how to verify (`git diff` must be empty
  for a pure move, otherwise run `npm test`).
- Update `AGENTS.md` to point at the `src/` layout instead of the monolithic files.
- Re-run both E2E suites once at the end and record the counts here.

## Backlog (later, not started)

- **Make `npm test` faster than ~3 min.** It's dominated by `test.epub` — a 64MB, 508-spine
  fixture that every reader test loads and epub.js re-parses, plus per-section polling
  waits (~7s each across ~10 sections). A small purpose-built fixture EPUB (a handful of
  chapters with one image and one table) would likely cut it to well under a minute, at the
  cost of no longer exercising a realistically large book. Worth doing: a suite that's slow
  is a suite that stops being run. `npm run check` covers the fast path meanwhile.
- **Consider widening the name check.** Full `checkJs` reports ~250 further errors; the
  single biggest cluster is DOM lookups typed wider than the code assumes
  (`.style` on `Element`, `.value`/`.files`/`.disabled` on `HTMLElement`, `.result` on
  `EventTarget`). Clearing them means annotating call sites or introducing typed
  `getElementById` helpers — a real code change, not a structural one, and the payoff is
  smaller than the name check's was.

- Collapse the reader/editor collection-persistence pair into one shared implementation
  (`_saveChunk`/`_saveCollectionToDB`/`_loadCollectionFromDB`) — deliberately deferred, see
  "Guiding decision" above. Needs the manual replay checklist (`refactoring-pre.md` §5),
  not just E2E.
- Merge the two reader-side IndexedDB wrappers (`openDB`/`openNoesisDB` — §1.5).
- Break up the largest functions (`_doDownload` ~127 lines, `extractCurrentChapter` ~229)
  once they're isolated in their own file.
- Decide whether to vendor the CDN libraries (jszip, epubjs, turndown, bootstrap-icons;
  jquery/summernote are already inlined) — removes the CDN-availability dependency (§1.4)
  at the cost of file size.
- Decide what to do with the stale `noesis816.html` backup, and the `noesis-multi` repo's
  4 hand-mirrored copies (§1.2) — out of scope for this repo alone.
- CI: `npm run build` + `npm test` gating deploys; `wrangler.jsonc` currently serves the
  repo root, which is also the build output dir — fine as-is, but worth stating (§1.2a).
