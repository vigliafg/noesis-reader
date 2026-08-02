// Names that exist at runtime but aren't declared in the source we check.
//
// This file exists so `npm run check` can do one job well: tell you when the code
// references a name that is defined NOWHERE. That check is only useful if it has no false
// positives, so every genuinely-external name has to be declared here.
//
// Keep this list honest. Declaring a name here tells the checker "trust me, this exists at
// runtime" — if that's not true, you've hidden a real bug instead of fixing one. Only add
// something after confirming where it actually comes from.

// ── Third-party libraries loaded from CDN <script> tags in the templates ──
declare const JSZip: any;          // jszip — reader + editor
declare const ePub: any;           // epub.js — reader
declare const TurndownService: any; // turndown — reader + editor (editor's copy is vendored)
declare const htmlDocx: any;       // html-docx-js — editor (vendored)

// ── jQuery + Summernote (vendored inline in noesis-editor.html) ──
declare const $: any;
declare const jQuery: any;

// ── Cross-file references that are assigned onto `window` at runtime ──
// These are real globals; they're written as `window.foo = ...` and read as bare `foo`,
// which the checker can't connect. Each is also guarded by `typeof foo === 'function'` at
// its call sites, so a missing one degrades rather than throws.
declare let _hideCtxAnnotatePopup: any;
declare let _showCtxAnnotatePopup: any;

// ── Implicit globals (assigned without a declaration, sloppy-mode) ──
// Not great practice, but they are genuinely created at runtime. Declared here rather than
// changed, because fixing them means touching behaviour, not structure.
declare let navModePopover: any;
declare let _selectedImg: any;
declare let _selectedTable: any;
