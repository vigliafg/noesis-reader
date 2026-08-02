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

## Next: split `app.js`/`styles.css` further by feature area

This is the point where it stops being a pure no-op mechanical move and starts being an
actual refactor — go carefully, and treat the two entries somewhat independently since
`noesis-editor.html`'s `app.js` is much smaller (~1750 lines) than the reader's
(~5860 lines).

Suggested feature boundaries for `src/reader/app.js` (from `refactoring-pre.md` §1.1/§2.2 —
these are informed guesses, verify against the actual code before committing to them):
storage/quota utilities, IndexedDB (`noesisDB` + `EpubLibraryDB` — candidate to merge per
§1.5), EPUB validation/loading, library view, reader view + TOC, collection
(`_saveChunk`/`_saveCollectionToDB`/etc. — duplicated with the editor, see §1.3, a good
candidate to eventually share), chapter extraction/export (HTML/TXT/MD/EPUB/PDF/ZIP —
biggest functions live here, e.g. `_doDownload` at 357 lines, `extractCurrentChapter` at
261), gestures/swipe/touch zones, theming/display settings, bookmarks.

**Ground rules for this step, learned from the file:// investigation:**
- Splitting into multiple files is fine and safe *as source* (edit-time) as long as the
  build step concatenates them back into one `<script>`/`<style>` block per output file —
  do not emit multiple `<script src>` tags in the built output; keep the single-file
  build-time guarantee.
- Watch for **top-level (non-function-wrapped) code that calls a function defined in a
  file that will be concatenated after it** — function hoisting only applies within
  where a given chunk sits once concatenated, so ordering still matters. Calls inside
  event handlers/functions are fine (everything's loaded by the time they run); only
  immediately-executing top-level statements are at risk.
- After any split that changes what's inside `styles.css`/`app.js` (not just where the
  *file* boundaries are, but actual content movement/reordering), the rebuilt output will
  likely **not** be byte-identical even if behavior is unchanged (whitespace/ordering
  differences). At that point, byte-identity stops being a valid check — switch back to
  running the full E2E suite (`test_e2e_complete.js`, `test_editor_toolbar.js`) plus the
  manual replay checklist in `refactoring-pre.md` §5 to confirm nothing broke.

## Backlog (later, not started)

- Collapse the reader/editor duplicate `_saveChunk` family into one shared module
  (data model is already unified, code isn't — §1.3).
- Merge the two IndexedDB wrappers (`openDB`/`openNoesisDB` — §1.5).
- Decide what to do with the stale `noesis816.html` backup in this repo, and separately,
  the real hand-mirrored copies in the `noesis-multi` repo (§1.2) — out of scope for this
  repo alone.
- TypeScript migration (incremental, starting with a shared `types.ts` for the collection
  data model) — see the "final shape" discussion earlier in this project's history
  (not written down anywhere yet as of this handoff — ask if picking this up and it's not
  here, or reconstruct from conversation if available).
- Break up the largest functions (`_doDownload`, `extractCurrentChapter`, etc.) once
  they're isolated in their own module and have some test coverage.
