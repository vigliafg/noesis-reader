# noesis-reader

PWA version of the Noesis EPUB reader — deployable on Cloudflare Pages.

## Files

| File | Role |
|------|------|
| `index.html` | Monolithic app: Library + Reader + all logic |
| `sw.js` | Service Worker for offline caching & auto-update |
| `_headers` | Cloudflare Pages cache rules |

## Deploy on Cloudflare Pages

1. Push this repo to GitHub / GitLab
2. In Cloudflare Dashboard → Workers & Pages → Create → Pages → Connect Git
3. Select the repository. Settings:
   - **Build command**: leave empty (static site)
   - **Output directory**: `/` (root)
4. Deploy. Cloudflare serves `index.html` by default and applies `_headers`.

## Version Advancement Rules

The version number is **the single source of truth** for cache invalidation and PWA updates.
It lives in two places and **must always match**:

| Location | Field |
|----------|-------|
| `index.html` | `var NOESIS_VERSION = 'N'` |
| `sw.js` | `// VERSION: N` (comment at top) |

### When to increment

- Any change to `index.html` (HTML, CSS, or JS)
- Any change to `sw.js`
- Updating CDN dependency versions

### Release checklist

1. **Increment** `NOESIS_VERSION` in `index.html` (e.g., `'816'` → `'817'`)
2. **Update** the `VERSION` comment in `sw.js` to the same value
3. **Deploy** both files. The browser detects the byte-different `sw.js`, triggers the update flow, and assigns a new cache namespace (`noesis-reader-v817`). Old caches are auto-cleaned.

### How auto-update works

- `index.html` registers SW with `sw.js?v={VERSION}` as query param
- On page load, the browser fetches `sw.js` and compares it byte-for-byte with the installed one
- If different → **install** event → new `CACHE_NAME` → pre-caches CDN + origin
- `skipWaiting()` + `clients.claim()` → new SW takes control immediately
- On next refresh, all resources come from the new cache. Old cache is deleted during `activate`.
- `_headers` sets `Cache-Control: max-age=0` on `/sw.js` so Cloudflare never serves a stale copy

### What happens if version doesn't match

- **SW comment outdated but HTML incremented**: SW will re-fetch (query param differs), but byte-content is same → browser won't reinstall. Cache stays on old namespace.
- **Both incremented**: Full update cycle runs. Old cache cleaned.
