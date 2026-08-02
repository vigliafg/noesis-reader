# Noesis Reader — Pre-Refactoring Review

Scope: `index.html` (reader, ~10,440 lines), `noesis-editor.html` (editor, ~3,108 lines),
`noesis816.html` (a near-duplicate of `index.html` living in this same repo), plus
`test_e2e_complete.js` / `test_editor_toolbar.js` and project docs (`AGENTS.md`, `PLAN.md`).

This is a review of what exists today, to inform a refactor plan — it does not propose
the plan itself.

---

## 1. Structural issues (the big picture)

### 1.1 The whole app is one HTML file
`index.html` is 10,443 lines: ~3,800 lines of inline `<style>`, then ~6,600 lines of
inline `<script>` with no modules, no bundler, no `import`/`export`. Everything —
IndexedDB access, EPUB parsing, UI rendering, drag/swipe gesture handling, theming,
annotation/collection logic, ZIP export, TOC rendering — lives in one global scope in
one file. There is no `src/` tree, no separation between "library view", "reader view",
"collection drawer", "chapter extraction", etc. — it's all concatenated.

`noesis-editor.html` repeats the same pattern at smaller scale (3,108 lines, one file,
inline style + script).

Consequences:
- Any change requires loading a 10k-line file into an editor/model and grep-jumping.
- No static analysis, linting, or type-checking is possible without extracting the script.
- Two people (or a person and an AI) can't easily work on different features without
  touching the same file.

### 1.2 A stale local backup, plus a real manually-mirrored fork elsewhere
**Correction after checking git history** (`git log --follow --name-status`): the
`noesis816.html` file sitting in *this* repo is not an actively maintained variant. It was
created in a single commit (`088953d`, "chore: add package.json (Puppeteer deps),
package-lock.json, noesis816.html") as a **100%-copy snapshot** of `index.html` taken at
that moment — git's copy-detection confirms it (`C094 index.html noesis816.html`), and the
commit message itself calls it a "reference/alternate reader version." Since that snapshot,
`index.html` received 70+ further commits while `noesis816.html` received none (the ~500-line
diff found earlier is exactly that drift). It isn't referenced by any app code, and nothing
links to it. **It looks like an abandoned local backup, not a maintained duplicate** —
worth confirming with your father, but it's a reasonable candidate for outright deletion.
It's also currently uploaded to Cloudflare regardless (see §1.2a), so it's live, unused,
drifted dead weight in production today.

The *actually*-duplicated-and-maintained files are the ones `AGENTS.md` documents living in
a **separate parent repo** (`noesis-multi`), which holds **four more copies**
(`noesis816.html`, `noesis816-full.html`, `noesis816-reader.html`,
`noesis816-full-reader.html` — confusingly, one of them shares its name with the stale
backup above, in a different repo) that must be hand-mirrored after every edit to
`index.html`, per the instruction: "apply the identical edits... to all four target
files... commit and push in both repos... same commit message." That process (in the other
repo, not inspected here) is the real copy-paste problem: no shared source, guaranteed
drift, and every future change becomes a manual, error-prone, N-times-repeated edit. This is
almost certainly the single highest-value structural thing to fix — collapsing to one
canonical source that the variants are generated from (or deleting the variants if
they're unnecessary).

### 1.2a Deployment ships unused files, and there's no CI/CD
Deployment is via `wrangler.jsonc` (Cloudflare Workers/Pages static assets, entire repo
directory served as-is, `index.html` as the root entry point). Its `upload.exclude` list
only excludes `node_modules`, `.wrangler`, `*.epub`/`*.pdf`, most `test_*.js`, `*.md`, and a
handful of named files — it does **not** exclude `noesis816.html`, so the stale backup
described in §1.2 is currently shipped to production as a live, publicly-reachable, unused
page. `noesis-editor.html`, by contrast, *is* legitimately deployed and used —
`index.html:5346` opens it via `window.open('noesis-editor.html', '_blank')`. There is no
GitHub Actions workflow or other CI/CD config in the repo; deploys appear to be manual
(`wrangler deploy` or a dashboard-driven git integration), with no automated check (lint,
test, build) gating what gets shipped.

### 1.3 Reader and editor are two separate apps stitched together loosely
`index.html` and `noesis-editor.html` communicate via `sessionStorage` + `window.open()`,
each maintaining its own copy of concepts like "collection" (highlighted/collected
chunks). `PLAN.md` documents that these two collection data structures were **at one
point incompatible** (different field names, `timestamp` number vs `date` ISO string,
`'image'` vs `'img'`, editor memory-only with no persistence).

**Correction after checking current code and the E2E baseline (below): this was already
fixed.** Both `index.html:5696`'s `_saveChunk` and `noesis-editor.html:1582`'s `_saveChunk`
now write the same field names (`book`, `chapter`, `date` as ISO string, unified `type`
detection for `text`/`img`/`table`), and the editor now persists to IndexedDB via its own
`_saveCollectionToDB`/`_loadCollectionFromDB`. The toolbar E2E suite explicitly asserts this
("Format unified: both use bookName, chapterName, version — Strategy B applied", "Editor JSON
does NOT use reader-only fields") and passes. `PLAN.md`'s Phase 1 description is stale —
useful as history, not as current status.

**What's still true and still worth fixing:** the two files independently re-implement
functions with the *same name and same shape* (`_saveChunk`, `_saveCollectionToDB`,
`_loadCollectionFromDB`, `_clearCollection`, `_deleteChunkById`) — the data model converged,
but the code implementing it is still two hand-kept-in-sync copies, not one shared module.
A future change to this logic (e.g. a new field, a new validation rule) still has to be
applied twice by hand, with nothing to catch the two copies drifting apart again the way
the field names once did. This is a good target for the planned `core/collection.ts`
module shared by both entry points (see the "final shape" discussion elsewhere in this
project).

### 1.4 No build system, no dependency management for app code
`package.json` only lists `puppeteer` as a dependency (for tests). The app itself loads
its runtime libraries (`jszip`, `epubjs`, `turndown`, `bootstrap-icons`) from a public CDN
(`cdn.jsdelivr.net`) via `<script src>` tags with no version pinning strategy beyond a
hardcoded URL, no integrity hashes (SRI), and no offline/vendoring fallback — the app is
non-functional without that CDN, and a CDN-side change could silently break production
with no local repro path.

### 1.5 Two IndexedDB databases, opened ad hoc, no shared data layer
There are two separate hand-rolled DB wrappers in `index.html` alone: `noesisDB` (for
extracted chapters) and `EpubLibraryDB` (for books), each with its own copy-pasted
open/upgrade/retry boilerplate (~60 lines each, `openNoesisDB()` / `openDB()`), including
duplicated "if blocked, delete and retry" recovery logic. There's no single data-access
module; call sites open a raw transaction directly wherever they need one.

### 1.6 Tests are Puppeteer-only integration scripts, not a test suite — and don't currently run
`test_e2e_complete.js` (900 lines, 11 scenarios S1–S11: debug auto-load, chapter nav,
image/text/table collection, drawer, IndexedDB persistence, chapter extraction, editor
bridge, editor draft autosave, collection export/import) and `test_editor_toolbar.js`
(2,097 lines, covers the editor toolbar's HTML/JSON load-save-export and an Excalidraw
launcher) are ad hoc Puppeteer scripts, not a framework-based suite (no Jest/Playwright/etc.
— hand-rolled `result()`/`assert()` helpers, plain `node script.js` execution).

**Verified in this environment, they cannot currently run at all**, for three independent
reasons:
1. **`puppeteer` isn't installed** — `package.json` lists it as a dependency but
   `node_modules` doesn't have it (`npm ls puppeteer` returns empty). `npm install` was
   apparently never run/committed in this checkout.
2. **The required fixture is missing.** Every scenario in both scripts depends on
   `test.epub`, a 64MB medical-textbook EPUB with a specific structure (508 spine items,
   chapter 26 "Pain" at spine index 44, containing images/tables/text to exercise the
   collection features). It was deliberately excluded from git (`.gitignore`: "Test files
   (too large for Cloudflare Workers 25MB limit)") and never committed — it only ever
   existed on the machine these tests were authored on. Without it, S1 (debug auto-load)
   fails immediately and everything downstream (S2–S11) cascades from that.
3. **A manual multi-step local setup is required first**: start `python3 -m http.server
   8765` from the repo root, and (per `AGENTS.md`) use a specific Chrome binary at
   `/usr/bin/google-chrome` and a specific Node version via `NODE_PATH`. None of this is
   scripted (no `npm test`, no setup script) — it's manual steps documented in prose.

This matters directly for the refactor: **there is currently no working safety net** to
validate that a refactor preserves behavior. Given your father reported a previous
refactor attempt that "didn't work at all," restoring these tests to a runnable state
(`npm install`, obtaining or regenerating a small test EPUB fixture, scripting the server
startup) should probably happen *before* any structural refactor, not after — otherwise
regressions in behavior as complex as EPUB rendering, IndexedDB persistence, or the
reader↔editor handoff would only be caught by manual re-testing, which is exactly the kind
of thing likely to be skipped or missed under time pressure and is a plausible explanation
for why the earlier attempt broke things silently.

Separately, `AGENTS.md` documents numerous fragile workarounds baked into these tests
(stale iframe references after navigation, `cb.checked` not firing `change`, native
`prompt()`/`confirm()` "destabilizing" Puppeteer) — these are real, currently-relevant
gotchas to reuse rather than rediscover once the tests are runnable again. There is also no
unit test for any individual function — no way to test, say, `formatBytes()` or EPUB
validation logic in isolation, since nothing is modularized enough to import in isolation.
Testability is a direct casualty of not modularizing the code, and fixing that dependency
(extracting testable modules) is itself part of what a refactor would need to do.

### 1.7 Documentation encodes tribal knowledge instead of the code being self-evident
`AGENTS.md` is 306 lines of workarounds, selector tables, and "known issues" — e.g. a
table mapping UI elements to CSS selectors, and a section explaining why
`window._showMediaDialog(...)` must be called directly because Puppeteer can't trigger a
custom `selected` event. This is valuable operational knowledge, but its size and
specificity is itself a symptom: the DOM/JS surface is complex, untyped, and undiscoverable
enough that it needs a manual instead of self-describing code (types, named modules, or
component boundaries).

---

## 2. Code-level issues (within the files)

### 2.1 Everything is global
`index.html`'s script block declares ~900+ top-level `var`/`let`/`const` bindings (rough
grep count) directly in the page's global scope, plus 33 explicit `window.foo =`
assignments to deliberately expose internals (e.g. `window._showMediaDialog`, needed only
so Puppeteer tests can call them directly, per `AGENTS.md §Dialog Handling`). There's no
namespacing, module pattern, or IIFE isolation. Any two features can accidentally clash on
a variable name, and nothing prevents it.

### 2.2 Very large, multi-responsibility functions
Rough function-length audit of `index.html` (line count until the next `function`
declaration) shows several functions doing far more than one thing:

| Function | ~Lines | Starts at |
|---|---|---|
| `_doDownload` | 357 | 8277 |
| `extractCurrentChapter` | 261 | 6798 |
| `_getIframeOffset` | 219 | 9312 |
| `_closeNavigate` | 214 | 9906 |
| `applyLibraryTheme` | 210 | 8668 |
| `extractMultipleSections` | 187 | 6598 |
| `openBookFromLibrary` | 166 | 5460 |
| `_syncNavModeBtn` | 166 | 8912 |
| `closeTocOverlay` | 153 | 10176 |
| `_renderCollectionList` | 152 | 7803 |

Functions like `_doDownload` and `extractCurrentChapter` mix DOM querying, format-specific
branching (multiple export formats in one function), string/HTML building, and I/O
(download triggering) all in one block — hard to unit test, hard to reason about, and
prone to "just add another `if`" growth over time (which is visible in the size itself).

### 2.3 innerHTML-based rendering, no templating
35 direct `.innerHTML =` assignments build UI by string concatenation rather than a
templating approach or DOM APIs. This is both an XSS surface (if any book metadata,
extracted chapter text, or user-provided highlight text flows into these without
escaping — worth auditing specifically, since EPUB content is semi-untrusted input) and a
maintainability problem (markup is scattered through JS as string literals rather than
being colocated/reusable as templates or components).

### 2.4 Copy-pasted IndexedDB boilerplate
As noted in 1.5, `openNoesisDB()` and `openDB()` duplicate the same open/upgrade/
version-error/delete-and-retry dance nearly line for line. Any bug fix to this pattern
(e.g. handling a new error case) has to be applied twice, and likely a third/fourth time
once the editor's IndexedDB usage (`PLAN.md` phase 1.2) is added.

### 2.5 Inconsistent async style and error handling
The codebase mixes callback-based IndexedDB requests wrapped in `new Promise(...)`,
`async`/`await`, and older `.then()` chains inconsistently (visible even in the small
excerpt around line 4590 — `.then(function(regs) {...}).catch(function() {...})`
sitting next to `async function` elsewhere). 73 `catch` blocks exist, but there's no
consistent error-reporting strategy (some `console.error`, some `showToast`, some silent
`catch(){}`), making it hard to know what a user actually sees when something fails.

### 2.6 `PLAN.md` itself documents known duplication debt
The project's own plan file explicitly lists, as future work:
- Phase 5.1: "Estrarre `_extractTree()` helper: 3 copie tree extraction → 1" — i.e. the
  team already knows there are 3 copies of tree-extraction logic to deduplicate.
- Phase 4: a list of features present in `index.html` but missing from the `noesis-multi`
  mirror files, which is a direct symptom of the copy-file architecture in §1.2.

This confirms the duplication problems identified above are known and already causing
friction, not just theoretical.

### 2.7 Magic strings and ad hoc state instead of enums/constants
Chunk `type` is represented as different string literals in different places (`'img'` in
the reader vs `'image'` in the editor per `PLAN.md`'s table), and UI state like
`_collFilterType`, `_checkedChunkIds` are loose module-level objects mutated from many
call sites (e.g. the `_checkedChunkIds` pattern documented in `AGENTS.md`, where forgetting
to update it alongside `cb.checked = true` is a known, already-hit bug class — the docs
explicitly warn "In Select All/Deselect handlers: update `_checkedChunkIds` explicitly
alongside setting `cb.checked`", which is exactly the kind of two-places-to-update bug that
a small state-management abstraction would eliminate.

---

## 3. Summary of highest-impact problems

1. **File-level duplication** (`index.html` ↔ `noesis816.html` ↔ 4 more copies in
   `noesis-multi`) — same code copy-pasted 6 ways, manually kept in sync, already drifting.
2. **No module system** — one 10k-line file, one 3k-line file, everything in global scope.
3. **Two incompatible, duplicated "collection" data models** between reader and editor,
   including duplicate function names implementing diverging logic.
4. **Duplicated low-level plumbing** (IndexedDB open/upgrade boilerplate, tree extraction
   logic — 3 copies per the team's own plan).
5. **Untestable code** — no unit tests possible without extraction; testing exists only as
   slow, environment-fragile Puppeteer scripts with documented flakiness workarounds.
6. **Unbounded function size** — several 150–350 line functions mixing multiple concerns.
7. **String-built UI (`innerHTML`)** instead of any templating/component boundary,
   with unaudited injection risk from EPUB-sourced content.
8. **Runtime dependencies loaded from an unpinned CDN** with no local fallback.

These map fairly directly to a refactor plan: (a) pick one canonical source file and stop
hand-mirroring, (b) extract the inline script into real ES modules with a lightweight
bundler, (c) unify the reader/editor data model behind one shared data-access layer,
(d) break up the largest functions along their existing seams, and (e) add unit tests for
the now-isolated modules before touching behavior.

## 4. Established baseline (2026-08-02)

`test.epub` was obtained and `puppeteer` installed locally (`npm install puppeteer`).
Both suites were run against the current, unmodified `index.html` / `noesis-editor.html`,
served via `python3 -m http.server` from the repo root:

- `test_e2e_complete.js`: **31/31 passed** (S1–S11, all scenarios).
- `test_editor_toolbar.js`: **140/140 passed**.

This is the reference to diff future changes against. It also resolved the open question
in §1.3 above (data model already unified) and confirms the app's core flows — EPUB load,
navigation, collection (image/text/table), IndexedDB persistence, chapter extraction, the
reader↔editor bridge, and the full editor toolbar — all currently work correctly. Any
refactor step should be validated by re-running both scripts and getting the same 31/140
passing counts before being considered safe to build on.

Note: `test_e2e_complete.js`/`test_editor_toolbar.js` hardcode `BASE_URL =
'http://127.0.0.1:8765'`; this environment already had an unrelated process bound to
that port serving a different, unrelated directory, so the baseline run above used a
patched copy pointed at port 8766 instead. Worth being aware of if `8765` is ever
unexpectedly occupied — check what's actually listening before trusting a "server
reachable" check.

## 5. Manual exploration — what's real but untested (2026-08-02)

Before writing more tests, I drove the app by hand with Puppeteer (screenshots, not just
assertions) to see what actually exists beyond what the current 171 passing assertions
touch. Both suites bootstrap via `?debug=1`, which skips the library UI and jumps straight
into a book — so an entire layer of the app (library management) and most of the reader's
menu bar are never exercised by the existing tests at all.

**Confirmed working by hand, real EPUB, no `debug=1` shortcut:**
- Library import via the actual file `<input>` (not the debug fetch bypass): cover
  thumbnail extraction, book metadata (title/author) parsing, and the storage-usage bar
  all rendered correctly for the real 64MB `test.epub`.
- Opening a book from the library into the reader.
- **TOC overlay** (Library / TOC / Bookmarks / Display / Navigate / Annotate / Extract /
  Collection / Help toolbar) — opens, lists the full nested chapter tree (Volume I/II,
  sub-chapters), closes correctly.
- **Display menu** — Typography / Themes / Interface submenus render.
- **Navigate menu** — Page Mode / Scroll Mode toggle renders.
- **Extract menu** — a full matrix of options: format (HTML clean, HTML annotated, TXT,
  MD, EPUB, PDF, ZIP) × scope (current chapter only vs. current + sublevels) × action
  (Extract vs. Extract + Edit).

**Inconclusive, worth a follow-up look:** clicking "Bookmarks" produced no visible change
while still on the EPUB's cover page (no text/CFI selected yet) — this may be correct
behavior (nothing to bookmark yet) or a real bug; I didn't have time to navigate past the
cover and retest. Flagging rather than concluding either way.

**Console noise observed matches what `AGENTS.md` already documents as harmless**: a 404
(favicon) and repeated "Blocked script execution in 'about:srcdoc' because the document's
frame is sandboxed" (the EPUB content iframe's sandbox attribute) — consistent with known,
non-actionable noise, not new problems.

### What this means for test coverage

Cross-referencing every `function` name declared in `index.html` against both test files
shows roughly **two-thirds of named functions are never mentioned in either test file** —
a blunt proxy (plenty of those are internal helpers exercised indirectly through DOM
clicks), but combined with the hands-on click-through above, it points at the same real
gap: **the existing suite is deep on one path (debug-loaded book → collection workflow →
editor bridge) and has no coverage at all of library management or most of the reader's
own toolbar.** Concretely, zero automated coverage today on:

- **Library management**: real file import (vs. debug fetch), delete book, storage-quota
  warnings/exceeded handling, multi-book list rendering.
- **TOC UI** — current tests navigate chapters only via a direct
  `rendition.display(spine.items[44].href)` call, never by clicking TOC → clicking an
  entry.
- **Bookmarks** — create, list, jump-to, delete: entirely untested (and the one manual
  interaction I tried didn't show an obvious result — see above).
- **Display menu** — theme switching (light/dark/others), font size, line height,
  interface settings: all untested.
- **Navigate mode toggle** (Page ↔ Scroll) and actual prev/next arrow clicks or swipe
  gestures: untested (tests only ever call `rendition.display()` directly).
- **5 of the 7 Extract formats** (HTML annotated, TXT, MD, EPUB, PDF) and the "current +
  sublevels" scope: untested — only plain HTML-clean, current-chapter-only extraction is
  covered (S8).
- **In-book text highlighting** via the "Annotate" menu / `ctxAnnotatePopup` — this is
  distinct from the "collection" feature the existing tests cover thoroughly, and has zero
  coverage of its own.
- **Error paths**: invalid/corrupt file upload, DRM-protected EPUB rejection, storage quota
  actually being exceeded.
- **Reader-side responsive/mobile behavior** (hamburger drawer, touch zones) — the existing
  `R1`/`R2` responsive scenarios only cover the *editor* toolbar, not the reader.

### Recommendation

Not writing new automated tests for these right now — this phase targets the same output
`index.html`/`noesis-editor.html` (§6), assembled from split source rather than hand-edited,
so behavior shouldn't change and the existing 171-assertion suite is the safety net for
that. Codifying the gaps above into tests is a job for once the code is actually being
restructured (post-split), not for a step that's supposed to be a no-op.

Instead, this is a **manual replay checklist** — re-click through these by hand after the
split lands, as a second check beyond the automated suite, since these are real features the
suite can't currently vouch for either way:
- Real (non-debug) library import, opening a book, delete book.
- Open TOC via the toolbar button (not the direct `rendition.display()` call the tests use)
  and click an entry.
- Open Bookmarks past the cover page (revisit the inconclusive result above) — create,
  jump to, delete one.
- Display menu: switch a theme, change font size.
- Navigate menu: toggle Page ↔ Scroll mode, click prev/next.
- Extract: try one format other than HTML-clean (e.g. TXT or MD).
- Select some real chapter text and use "Annotate" (in-book highlight, not "Collection").

## 6. Before refactoring: restore a working safety net — done

You mentioned a previous refactor attempt was tried and "didn't work at all." Given
§1.6, a plausible contributing factor is that there was no runnable automated test suite
to catch regressions along the way. **This is now resolved** (§4): `puppeteer` is
installed, `test.epub` is in place, and both suites run and pass in full.

Also relevant to that earlier failed attempt: while investigating how to split the app
into smaller source files without breaking its single-file-sharing requirement, we
confirmed empirically that **ES modules (`<script type="module">`, `import`/`export`)
fail silently under `file://`** due to Chrome's CORS policy treating local files as
opaque origins — while classic `<script src>` does not have this restriction. If the
earlier attempt modularized using `import`/`export`, that would fully explain a page that
loads to a blank/broken shell the moment it's opened by double-click (as opposed to
through a server), with no obvious error unless the browser console was checked. The
planned approach (source split using classic scripts only, reassembled at build time into
one file, ES modules/TypeScript handled at build-time only and compiled to a plain
non-module bundle) avoids this failure mode by construction.

Recommended order of operations from here:
1. ~~Get `test_e2e_complete.js` runnable again~~ — done, see §4.
2. ~~Run the existing suite against the current, unrefactored `index.html` to get a
   known-good baseline~~ — done, see §4 (31/31 and 140/140 passing).
3. ~~Begin the source-split step~~ — done (2026-08-02), see §7.

## 7. First split increment: mechanical extraction (2026-08-02)

Did the smallest possible cut, deliberately not a feature-based split yet: each entry's
single inline `<style>` block and single main inline `<script>` block moved out to
`src/reader/{styles.css,app.js}` and `src/editor/{styles.css,app.js}`, with a template
(`src/*/index.template.html`) holding two placeholder tokens where they used to be.
`build/build.js` (`npm run build`) substitutes them back in.

CDN `<script src>` tags stay untouched, per your instruction to keep sharing the app the
same way for now. The editor also had some already-vendored third-party JS (turndown,
jszip, html-docx-js) and a font-face `<style>` pasted inline from before this session —
left alone in the template too, since they're not app code.

**Verified, not just assumed:** rebuilding from `src/` right now reproduces `index.html`
and `noesis-editor.html` **byte-for-byte identical** to what was there before (`cmp`/`md5sum`
match exactly) — so this step is provably a no-op today. Both E2E suites still pass in full
(31/31, 140/140) and the rebuilt `index.html` still works correctly when opened directly via
`file://` (checked with Puppeteer, zero console errors).

One real bug surfaced and fixed along the way, worth remembering for later steps: the
first version of `build.js` used `template.replace(placeholder, css)` /
`.replace(placeholder, js)` — `String.prototype.replace` treats `$&`, `$1` etc. in the
**replacement** argument specially, and the vendored jQuery source in the editor literally
contains `"-$&"` as a regex pattern, which got misinterpreted and silently corrupted the
output. Fixed by using a function replacer (`.replace(placeholder, () => js)`), which
inserts its return value literally. Any future string-templating step in this codebase
should use function replacers, not plain string replacements, given how much minified
third-party code with `$`-containing strings is embedded in these files.

This increment intentionally does not attempt to modularize by feature, dedupe the two
files, or touch the `noesis816.html`/`noesis-multi` situation — those are separate,
larger steps for later.
