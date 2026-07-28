# Resoconto — 27 Luglio 2026

## ✅ Completato oggi

### Ambito 3: Logo 📚 NOESIS
- Aggiunto `<span class="lib-brand">📚 NOESIS</span>` nella library header ✅
- CSS dedicato ✅
- Commit: `feat: aggiunto logo 📚 NOESIS nella library header`

### Ambito 1: Extract multi-formato (già completato in sessione precedente, verificato e propagato)
- Format selector con 5 formati: HTML, TXT, MD, EPUB, PDF ✅
- Funzioni: `_downloadAsText`, `_downloadAsMarkdown`, `_generateEpub`, `_printPDF`, `_downloadFile` ✅
- `_dispatchExtractDownload` con switch case ✅
- Commit: `feat: extract multi-formato (HTML, TXT, MD, EPUB, PDF)`

### Evoluzione Ambito 1: Split HTML clean / HTML annotated
- Sostituito il singolo pulsante "HTML" con due pulsanti separati:
  - **HTML clean** (`data-fmt="html-clean"`): scarica file pulito senza meta Noesis, offline reading
  - **HTML annot.** (`data-fmt="html-annotated"`): scarica file con meta Noesis, reimportabile in libreria
- Modificato `_dispatchExtractDownload`: rimosso `case 'html'` (doppio download), aggiunti `case 'html-clean'` e `case 'html-annotated'` (download singolo)
- `_extractFormat` default: `'html'` → `'html-clean'`
- **Pipeline index.html**: split formato soltanto (nessun prompt Editor — `_openSn56` non esiste nel source)
- **Pipeline noesis816 (4 target)**: split formato + dopo download HTML, `confirm('Open in Noesis Editor?')` che chiama `_openSn56(payload)`
- Commit: `feat: split HTML extract in html-clean e html-annotated + prompt Open in Editor`

### Fix CSS: Format buttons layout
- `.extract-fmt-btn`: `flex: 1 1 auto`, `min-width: 55px`, `font-size: 10px`, `line-height: 1.2`
- Rimosso `white-space: nowrap` e `letter-spacing` per consentire wrapping
- `.extract-format-row`: padding ridotto
- I 6 bottoni ora si dispongono correttamente su 2 righe in dropdown stretti
- Commit: incluso nel commit split HTML

### Fix CSS: Extract dropdown alignment
- `.extract-dropdown`: `display: inline-block` → `display: flex; align-items: center; height: 35px`
- Risolve il disallineamento del pulsante "Extract" nella toolbar durante resize
- Commit: incluso nel commit split HTML

### Fix: Turndown CDN in noesis816-full-reader.html
- `noesis816-full-reader.html` non aveva TurndownService (né embedded né CDN)
- Aggiunto `<script src="https://cdn.jsdelivr.net/npm/turndown@7.2.2/dist/turndown.js"></script>`
- Commit: incluso nel commit split HTML

### Ambito 2: Save media dal preview
- Aggiunto pulsante "⬇ Save" nell'overlay fullscreen (`#readerMediaFullscreen`)
- Posizionato in alto a sinistra (simmetrico al ✕ di chiusura)
- CSS: stile verde `#10b981`, hover `#059669`
- **JS `saveMedia()`**:
  - **Immagini**: `confirm()` sceglie JPEG (canvas.toBlob) o PNG (canvas.toBlob)
  - **Tabelle**: `confirm()` sceglie HTML (documento completo con stili) o CSV (iterazione tr/td, quoting corretto)
- **Fix bug critico**: `doPreview()` chiama `hideDialog()` che azzera `pending = null`. Aggiunto `_savedMedia` per persistere i dati oltre `hideDialog()`.
- Commit: `fix: Save button not working — pending nullified by hideDialog before saveMedia runs`

### Propagazione a noesis-multi
- Tutte le modifiche propagate ai 4 file target: `noesis816.html`, `noesis816-reader.html`, `noesis816-full.html`, `noesis816-full-reader.html`
- 3 commit totali oggi in ciascun repo

### Bug noto — Bassa priorità
- **Extract button alignment durante resize**: passando da finestra stretta (hamburger mode) a desktop con dropdown Extract aperto, il pulsante "Extract" nella toolbar appare leggermente più alto. Funziona correttamente in modalità solo-mobile e solo-desktop. Il bug è solo transitorio durante il resize. Registrato come bassa priorità.

---

# Piano — 28 Luglio 2026 ✅ COMPLETATO

## Obiettivo: Rifinire le finestre di salvataggio delle preview

### Modifiche realizzate

#### 1. Nuova toolbar nell'overlay fullscreen
- **Copy** (`readerFsCopy`): copia in clipboard via `navigator.clipboard.write()`
  - Immagini: canvas → blob PNG → `ClipboardItem({ 'image/png': blob })`
  - Tabelle: sia `text/html` (solo table HTML) che `text/plain` (testo pulito)
  - Canvas capped a 4096px per evitare errori su immagini enormi
- **Download ▼** (`readerFsDownload`): dropdown con selettore formato
  - Immagini: PNG / JPEG
  - Tabelle: HTML / CSV
  - Menu popolato dinamicamente in `_populateDownloadMenu()` chiamato da `doPreview()`
- **Close ✕** (`readerFsClose`): invariato

#### 2. `prompt()` per nome file con proposta
- Immagini: `alt` text sanitizzato (o `image-{timestamp}`)
- Tabelle: `table-{timestamp}`
- Funzione `_sanitizeFilename()` rimuove caratteri illegali, normalizza spazi

#### 3. Toast di feedback
- `showToast('✅ Saved as ...', 'saved')` dopo download
- `showToast('✅ Copied to clipboard', 'saved')` dopo copy
- `showToast('❌ Copy failed', 'error')` / `showToast('❌ Failed to load image', 'error')` per errori

#### 4. Canvas dimension capping a 4096px
- Sia in `copyMedia()` che in `_doDownload()` per prevenire overflow canvas

### File modificati
| File | Modifiche |
|---|---|
| `index.html` | CSS, HTML, JS — nuovo overlay + funzioni |
| `noesis816.html` | Mirror completo |
| `noesis816-full.html` | Mirror completo |
| `noesis816-reader.html` | Mirror completo |
| `noesis816-full-reader.html` | Mirror completo |

### Commit
| Repo | Commit | Messaggio |
|---|---|---|
| `noesis-reader` | `b7868ff` | feat: redesign media preview overlay — Copy, Download▼ format selector, prompt() filename, showToast feedback |
| `noesis-multi` | `21a4151` | feat: redesign media preview overlay — Copy, Download▼ format selector, prompt() filename, showToast feedback |

---

# Vecchio piano (28 Luglio 2026)

---

## Commit di oggi (noesis-reader)

| Commit | Messaggio |
|---|---|
| `cd512d0` | feat: split HTML extract in html-clean e html-annotated + fix CSS format buttons layout + fix extract dropdown alignment |
| `52b7461` | fix: Save button not working — pending nullified by hideDialog before saveMedia runs |

## Commit di oggi (noesis-multi)

| Commit | Messaggio |
|---|---|
| `ce3c32b` | feat: split HTML extract in html-clean e html-annotated + prompt Editor + fix CSS + Turndown CDN |
| `e9f3cb8` | fix: Save button not working — pending nullified by hideDialog before saveMedia runs |
