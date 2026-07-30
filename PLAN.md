# Resoconto — 30 Luglio 2026

## ✅ Completato oggi

### Infrastruttura di test Puppeteer

- **Debug mode `?debug=1`**: flag URL che auto-carica `test.epub` senza file picker. Nessun effetto in produzione (nessun autocaricamento, nessun duplicato DB). Loading overlay mostra "🔧 Debug: loading test.epub...".
- **Script Puppeteer riutilizzabili**: 4 script di test che caricano il reader, navigano a spine[44] (capitolo 26 "Pain": 10 immagini, 9 tabelle), e verificano il DOM.
- **Pattern chiave**: riacquisizione iframe dopo `rendition.display()`, `page.$()` fresh per evitare handle DOM stantii, `page.evaluate()` per chiamate dirette a funzioni JS, handler dialog centralizzato (`page.on('dialog', ...)`) per gestire `prompt()` / `confirm()`.
- **Lesson learned**: `browser-use` agent ha bug interni (`wait_for`, `upload_file`), abbandonato in favore di Puppeteer nativo.

### Test completati — 61/61 PASS

| Script | # | Area | Risultato |
|---|---|---|---|
| `test_collection_T1T3.js` | 3 test | T1-T3: image, table, highlight collect | **3/3 ✅** |
| `test_collection_T4T6.js` | 20 test | T4-T6: drawer, filtri, selezione, delete | **20/20 ✅** |
| `test_collection_T7T9.js` | 25 test | T7-T9: viewer, export JSON/HTML/MD, import | **25/25 ✅** |
| `test_collection_T10T12.js` | 13 test | T10-T12: persistenza, edge case, UI | **13/13 ✅** |
| **Totale** | **61** | | **61/61 ✅** |

### T1-T3: Aggiunta chunk da immagine, tabella, highlight

- Click su immagine → dialog → Preview → fullscreen → **Collect** → badge=1
- Click su tabella → dialog → Preview → fullscreen → **Collect** → badge=2
- Highlight: `_showMediaDialog('text', ...)` (bypassa evento epub.js non triggerabile da Puppeteer) → Preview → **Collect** → badge=3

### T4-T6: Drawer, selezione, eliminazione

- Drawer si apre/chiude via ✕ e click fuori
- Filtri tipo (All/Text/Images/Tables) e capitolo funzionano correttamente
- Filtri resettati alla riapertura
- Checkbox singolo, multiplo, Select All, Deselect
- Cambio filtro resetta selezione
- Eliminazione singolo chunk, Clear all con conferma, badge aggiornato
- Persistenza delete dopo reload

### T7-T9: Viewer, export, import

- Viewer chunk per img, table, text con formattazione corretta
- Chiusura viewer: ✕, Escape, backdrop click
- Export JSON con tutti i metadati, prompt nome file, gestione cancel
- Export HTML con immagini base64 e colori highlight preservati
- Export MD con sintassi immagini e blocchi codice
- Export vuoto → toast (no prompt)
- Import JSON valido → confirm → chunk accodati + persistenza
- Import con validazione: JSON corrotto, chunks mancanti, tipi invalidi filtrati
- Due import consecutivi: nessuna collisione ID

### T10-T12: Persistenza, edge case, UI

- Chunk persistono dopo close/reopen libro (via Back to Library + riapri)
- Delete persiste dopo close/reopen
- Import persiste dopo close/reopen
- 102 chunk renderizzati in 1139ms 🚀
- Chunk duplicati permessi (by design)
- Tabella vuota / highlight vuoto non crashano
- Reader view nascosto correttamente in library
- Badge consistente toolbar/hamburger
- Dropdown Export/JSON modali

### Bug fixato: B1 — Canvas 4096px cap

- **File**: `index.html` — `_blobToBase64()`
- **Problema**: immagini enormi (>4096px) causano `canvas.toDataURL()` failure, rompendo la conversione blob→base64 durante l'aggiunta alla collection.
- **Fix**: cappato canvas a 4096px con scaling proporzionale, stesso pattern già usato in `copyMedia()` e `_doDownload()`.
- **Commit**: `58a58e7` (noesis-reader), `39b5f2b` (noesis-multi)

---

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

### Bug noto — Media priorità
- **Autofit toggle tabelle nel viewer non funzionante**: Il toggle autofit nel `#collViewer` per le tabelle (pulsante ⊞/⊡) non reagisce in tempo reale. Il pulsante è stato rimosso. L'overflow della tabella funziona correttamente con barre orizzontali e verticali. Da re-implementare con un approccio diverso (es. `table-layout: fixed` + `width: 100%` con toggle JS diretto sullo style dell'elemento tabella invece che su classi CSS). Priorità media.

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

# 📦 PIANO COLLEZIONI — Analisi e Piano di Implementazione

## Analisi del codice esistente (noesis816-full-editor.html)

### Struttura dati

```javascript
var _collection = [];  // Array globale di chunk in memoria

// Ogni chunk:
{
  id: 'uuid',
  type: 'text' | 'img' | 'table',
  content: 'html o testo',
  src: 'base64 data URL',  // per immagini
  alt: 'alt text',
  color: 'yellow' | 'green' | 'pink',  // per highlight
  book: 'nome libro',
  chapter: 'nome capitolo',
  date: 'timestamp ISO'
}
```

### Funzioni chiave (già implementate nell'editor)

| Funzione | Descrizione |
|---|---|
| `_saveChunk(chunk)` | Assegna `id`, push in `_collection`, aggiorna contatore |
| `_deleteChunkById(id)` | Rimuove chunk da `_collection` per id |
| `_clearCollection()` | Svuota `_collection`, aggiorna contatore |
| `_updateCounter()` | Aggiorna `#chunkCounter` e `#drawerChunkCounter` con `_collection.length` |
| `_collectionDownload(data,tipo,ext,mime)` | Download file con prompt nome |
| `_exportCollectionJson()` | Export JSON con tutti i metadati |
| `_exportCollectionHtml()` | Export HTML standalone con stili inline |
| `_exportCollectionMd()` | Export Markdown |
| `_exportCollectionMdZip()` | Export MD + immagini in ZIP |
| `_generateCollectionMd()` | Genera stringa Markdown dai chunk |
| `_renderInspect()` | Popola il pannello Inspect con anteprime visuali |
| `_openInspect()` / `_closeInspect()` | Apre/chiude pannello Inspect flottante |

### Persistenza
`noesisCollectionDB` (IndexedDB) è menzionato nelle traduzioni come database per-book, ma il codice di persistenza effettivo (salvataggio/caricamento da DB) NON è stato trovato nei file HTML — è probabile che sia in fase di sviluppo o pianificato.

---

## Piano di implementazione per noesis-reader

### Panoramica

Aggiungere un nuovo pulsante **"Collection"** nella toolbar principale del reader, subito dopo Extract. Questo attiva il sistema di collezione: l'utente può raccogliere chunk (testi evidenziati, immagini, tabelle) durante la lettura e visualizzarli/gestirli in un pannello Inspect.

### Flusso utente

```
Lettura EPUB
    │
    ├─ Tap su immagine → Preview fullscreen
    │   └─ [+] Add to Collection  ← NUOVO pulsante nel toolbar
    │
    ├─ Tap su tabella → Preview fullscreen
    │   └─ [+] Add to Collection
    │
    ├─ Tap su highlight → 🔍 Preview
    │   └─ [+] Add to Collection
    │
    └─ Toolbar: [Collection] ← NUOVO pulsante
        └─ Apre Collection Inspect Panel (flottante)
            ├─ Lista chunk con anteprima
            ├─ Select/deselect
            ├─ Delete singolo chunk
            ├─ Clear all
            └─ Export: JSON, HTML, MD
```

### Fase 1: Struttura dati e persistenza

**1a. Database IndexedDB `noesisCollectionDB`**
```javascript
// Nuovo object store: 'collections'
// Key: bookId
// Value: { bookId, bookName, chunks: [...], updatedAt }

async function _saveCollectionToDB(bookId, bookName) { ... }
async function _loadCollectionFromDB(bookId) { ... }
```

**1b. Array in-memory `_collection[]`**
- Dichiarato a livello globale nel reader
- Inizializzato da DB all'apertura libro
- Salvato su DB a ogni modifica (add/delete/clear)

### Fase 2: Pulsante "Add to Collection" nel fullscreen overlay

**2a. Nuovo pulsante [+] nel toolbar fullscreen**
```html
<button class="rfs-collect" id="readerFsCollect">
  <i class="bi bi-plus-circle"></i> Collect
</button>
```
Posizionato tra Copy e Download▼.

**2b. Funzione `_addToCollection()`**
```javascript
function _addToCollection() {
  if (!_savedMedia) return;
  var chunk = {
    type: _savedMedia.type,  // 'img' | 'table' | 'text'
    data: _savedMedia.data,
    book: currentBookTitle,
    chapter: currentChapterName,
    date: new Date().toISOString()
  };
  _saveChunk(chunk);
  showToast('📦 Added to collection (' + _collection.length + ')', 'saved');
}
```

### Fase 3: Pulsante "Collection" nella toolbar

**3a. Nuovo pulsante nella toolbar principale**
```html
<button class="btn btn-icon" id="collectionBtn" title="Collection">
  <i class="bi bi-collection"></i>
  <span id="collectionBadge" style="display:none">0</span>
</button>
```
Posizionato dopo Extract, prima dello spacer/Help.

**3b. Badge counter**
Mostra `_collection.length` in tempo reale, come il badge dei bookmark.

### Fase 4: Collection Inspect Panel

**4a. HTML del pannello flottante**
```html
<div id="collectionInspect" class="collection-inspect-panel">
  <div class="ci-header">
    <h3>📦 Collection</h3>
    <span id="ciCount">0 chunks</span>
    <button id="ciClose">✕</button>
  </div>
  <div class="ci-toolbar">
    <button id="ciSelAll">All</button>
    <button id="ciSelNone">None</button>
    <button id="ciClearAll">🗑 Clear</button>
  </div>
  <div id="ciList" class="ci-list"></div>
  <div class="ci-footer">
    <span id="ciSelCount">0 selected</span>
    <button id="ciExportJson">JSON</button>
    <button id="ciExportHtml">HTML</button>
    <button id="ciExportMd">MD</button>
  </div>
</div>
```

**4b. CSS**
- Pannello flottante con posizione absolute/draggable
- Stile simile all'Inspect Panel dell'editor
- Responsive: su mobile occupa 90% larghezza

**4c. Funzione `_renderCollectionInspect()`**
- Itera `_collection[]`
- Per ogni chunk: anteprima (primi 100 char testo, thumbnail img, prima riga tabella)
- Checkbox per selezione, pulsante delete
- Footer con conteggio selezionati e pulsanti export

### Fase 5: Export collection

**5a. Funzioni di export** (porting dall'editor)
```javascript
function _exportCollectionJson() { ... }
function _exportCollectionHtml() { ... }
function _exportCollectionMd() { ... }
```
Riutilizzano `_downloadFile()` già esistente nel reader.

**5b. Formati**
- **JSON**: tutti i chunk + metadati libro/capitolo
- **HTML**: documento standalone con stili, immagini base64
- **MD**: Markdown con riferimenti ai tipi chunk

### Fase 6: Propagazione

Dopo l'implementazione in `index.html`, propagare a tutti e 4 i file `noesis-multi`.

---

## Riepilogo modifiche necessarie

| # | Area | Cosa | Righe stimate |
|---|---|---|---|
| 1 | JS Globals | `_collection[]`, `_bookId`, variabili globali | 5 |
| 2 | IndexedDB | `_saveCollectionToDB()`, `_loadCollectionFromDB()` | 40 |
| 3 | HTML overlay | Pulsante [+] nel toolbar fullscreen | 2 |
| 4 | JS overlay | `_addToCollection()`, evento click | 15 |
| 5 | HTML toolbar | Pulsante "Collection" + badge | 3 |
| 6 | CSS | Stili pannello Inspect + badge + pulsante Collect | 60 |
| 7 | HTML panel | Collection Inspect Panel completo | 25 |
| 8 | JS panel | `_renderInspect()`, `_openInspect()`, `_closeInspect()` | 80 |
| 9 | JS export | `_exportCollectionJson/Html/Md()` | 60 |
| 10 | JS core | `_saveChunk()`, `_deleteChunkById()`, `_clearCollection()`, `_updateCounter()` | 30 |
| **Totale** | | | ~320 righe |

---

# Vecchio piano (28 Luglio 2026)

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

---

# Piano — 29 Luglio 2026

## Obiettivo: Test approfonditi + Analisi punti deboli del workflow Collection

### Strategia

1. **Mappatura completa del workflow** — ogni touchpoint del ciclo di vita di un chunk
2. **Test funzionali** — verifica che ogni azione produca il risultato atteso
3. **Test di correttezza I/O** — verifica che i dati in input e output siano corretti e integri
4. **Analisi punti deboli** — identificare bug, edge case, race condition, UX problematica
5. **Opportunità di miglioramento** — nuove feature da innestare sulla base Collection

---

## 1. MAPPATURA COMPLETA DEL WORKFLOW

### A. Creazione chunk

| # | Entry point | Trigger | Dati raccolti | Funzione |
|---|---|---|---|---|
| A1 | Immagine | Tap su `<img>` nell'iframe EPUB | `{ type:'img', data:{ src, alt } }` | `sendMediaTap('img', ...)` → `showDialog()` |
| A2 | Tabella | Tap su `<table>` nell'iframe EPUB | `{ type:'table', data:{ html, caption } }` | `sendMediaTap('table', ...)` → `showDialog()` |
| A3 | Highlight testo | Long-press/selezione → popup 🔍 | `{ type:'text', data:{ text, color } }` | `ctxAnnotatePopup` → `_showMediaDialog()` |

### B. Preview + Collect

| # | Step | Trigger | Funzione | Output |
|---|---|---|---|---|
| B1 | Preview dialog | `showDialog()` | Mostra dialog centrato con pulsanti Preview/Close | `#readerMediaDialog.visible` |
| B2 | Apri fullscreen | Click "Preview" | `doPreview()` | `#readerMediaFullscreen` + toolbar (Copy, Download▼, Collect, ✕) |
| B3 | Collect | Click [+] Collect | `_addToCollection()` | Chunk salvato in `_collection[]`, persistito DB, toast |
| B4 | Conversione img | Dentro `_addToCollection()` | `_blobToBase64(src)` | Blob URL → base64 data URL (persistente) |

### C. Gestione Collection (Drawer)

| # | Step | Trigger | Funzione | Output |
|---|---|---|---|---|
| C1 | Apri drawer | Click "Collection" in toolbar o hamburger | `_openCollectionDrawer()` | Reset filtri, `#collectionDrawer.coll-open` |
| C2 | Carica dati | All'apertura libro | `_loadCollectionFromDB(bookId)` | `_collection[]` popolato da IndexedDB |
| C3 | Render lista | `_openCollectionDrawer()` → | `_renderCollectionList()` | Lista chunk con checkbox, preview, delete btn |
| C4 | Filtro tipo | Click pulsante filtro (All/Text/Images/Tables) | `_collFilterType = ...` → `_renderCollectionList()` | Lista filtrata |
| C5 | Filtro capitolo | Change select capitolo | `_collFilterChapter = ...` → `_renderCollectionList()` | Lista filtrata |
| C6 | Selezione | Checkbox su chunk | `_updateCollSelBadge()` | Badge "N selected" aggiornato |
| C7 | Select All | Click "Select all" | Tutti i checkbox checkati → `_updateCollSelBadge()` | Badge aggiornato |
| C8 | Deselect All | Click "Deselect" | Tutti i checkbox deselezionati → `_updateCollSelBadge()` | Badge: nascosto |
| C9 | Apri viewer | Click sul body del chunk | `_openChunkViewer(chunk)` | `#collViewer.visible` — img autofit, testo formattato, tabella overflow |
| C10 | Chiudi viewer | ✕ o Escape o click fuori | `_closeChunkViewer()` | Viewer nascosto |
| C11 | Elimina singolo | Click ✕ su chunk | `_deleteChunkById(id)` → `_renderCollectionList()` | Chunk rimosso, DB aggiornato |
| C12 | Clear all | Click 🗑 Clear | `_clearCollection()` → `_renderCollectionList()` | Tutti i chunk rimossi, DB aggiornato |

### D. Export / Import

| # | Step | Trigger | Funzione | Output |
|---|---|---|---|---|
| D1 | Export JSON | Collection▼ → Export collection | `_exportCollectionJSON()` | `prompt()` nome → file `.json` scaricato |
| D2 | Import JSON | Collection▼ → Import collection → file picker | `_importCollectionFromJSON(file)` | Validazione → confirm → accodamento → persist → re-render |
| D3 | Export HTML | Chunks▼ → HTML | `_exportCollectionHTML()` | File `.html` standalone con stili inline |
| D4 | Export MD | Chunks▼ → Markdown | `_exportCollectionMD()` | File `.md` con # headings e blocchi |

### E. Persistenza

| # | Step | Trigger | Funzione | Output |
|---|---|---|---|---|
| E1 | Salva | Ogni modifica (add/delete/clear/import) | `_saveCollectionToDB()` | `bookData.collections` in IndexedDB (`noesisReaderDB`, STORE_NAME) |
| E2 | Carica | `openBook()` | `_loadCollectionFromDB(bookId)` | `_collection[]` popolato, badge aggiornato |
| E3 | Fallback | DB non disponibile / errore | `_collection = []` | Array vuoto, funzionamento degradato |

### F. UI signals

| # | Elemento | Posizione | Comportamento |
|---|---|---|---|
| F1 | Badge counter | `#collBadge` nella toolbar (desktop) | Mostra `_collection.length`, hidden se 0 |
| F2 | Badge counter | `#hmbCollBadge` nel menu hamburger (mobile) | Stesso valore di F1 |
| F3 | Toast | `showToast()` globale | Feedback per add, export, import, delete, errori |
| F4 | Dropdown modali | Collection▼ / Chunks▼ | Aprendo uno, l'altro si chiude |

---

## 2. TEST PLAN — Funzionalità

### T1: Aggiunta chunk da immagine

- [ ] **T1.1** Aprire EPUB, tappare su un'immagine → preview dialog appare
- [ ] **T1.2** Click "Preview" → fullscreen overlay con toolbar (Copy, Download▼, Collect, ✕)
- [ ] **T1.3** Click Collect → toast "📦 Added to collection (N)"
- [ ] **T1.4** Badge counter toolbar `N` visibile
- [ ] **T1.5** Badge hamburger `N` visibile (in modalità mobile)
- [ ] **T1.6** Chiudere e riaprire il reader → badge ancora `N`
- [ ] **T1.7** Aprire drawer → immagine visibile con thumbnail + alt text
- [ ] **T1.8** Click sull'immagine nel drawer → viewer con img in autofit

### T2: Aggiunta chunk da tabella

- [ ] **T2.1** Tappare su tabella → preview → Collect
- [ ] **T2.2** Nel drawer: badge "table", preview tabella, excerpt testo
- [ ] **T2.3** Click → viewer con tabella, overflow orizzontale e verticale funzionanti
- [ ] **T2.4** Verificare scroll orizzontale su tabelle larghe (>viewport)

### T3: Aggiunta chunk da highlight

- [ ] **T3.1** Selezionare testo → popup 🔍 → highlight → Preview → Collect
- [ ] **T3.2** Nel drawer: icona `bi-chat-quote`, colore bordo sinistro corrispondente
- [ ] **T3.3** Click → viewer con testo formattato, colore sfondo highlight
- [ ] **T3.4** Testo preservato integralmente (non troncato nel viewer)

### T4: Gestione drawer

- [ ] **T4.1** Aprire drawer vuoto → messaggio "No items yet" con istruzioni
- [ ] **T4.2** Aprire drawer con chunk → lista popolata, ordine cronologico inverso (più recente in cima)
- [ ] **T4.3** Filtro tipo: All → Text → solo text chunk visibili
- [ ] **T4.4** Filtro tipo: Images → solo img chunk visibili
- [ ] **T4.5** Filtro tipo: Tables → solo table chunk visibili
- [ ] **T4.6** Filtro capitolo: selezionare capitolo → solo chunk di quel capitolo visibili
- [ ] **T4.7** Filtri combinati: tipo + capitolo → intersezione corretta
- [ ] **T4.8** Filtri resettati all'apertura drawer
- [ ] **T4.9** Drawer chiuso click su ✕
- [ ] **T4.10** Drawer chiuso click fuori
- [ ] **T4.11** Drawer accessibile da hamburger menu (mobile)

### T5: Selezione chunk

- [ ] **T5.1** Checkbox singolo → badge "1 selected"
- [ ] **T5.2** Due checkbox → badge "2 selected"
- [ ] **T5.3** Select All → tutti checkati, badge corretto
- [ ] **T5.4** Deselect → tutti deselezionati, badge nascosto
- [ ] **T5.5** Dopo cambio filtro, selezione resettata
- [ ] **T5.6** Export con selezione: esporta solo i selezionati
- [ ] **T5.7** Export senza selezione: esporta tutti (comportamento default)

### T6: Eliminazione

- [ ] **T6.1** Click ✕ su singolo chunk → rimosso, badge aggiornato, DB aggiornato
- [ ] **T6.2** Clear all → confirm dialog → tutti rimossi
- [ ] **T6.3** Clear all senza chunk → messaggio "Collection already empty"
- [ ] **T6.4** Dopo delete, riaprire reader → chunk non più presente

### T7: Viewer chunk

- [ ] **T7.1** Viewer immagine: img in autofit entro viewport
- [ ] **T7.2** Viewer testo: testo completo, colore highlight, font serif
- [ ] **T7.3** Viewer tabella: scroll orizzontale e verticale
- [ ] **T7.4** Chiudi viewer: ✕ button
- [ ] **T7.5** Chiudi viewer: tasto Escape
- [ ] **T7.6** Chiudi viewer: click su sfondo scuro
- [ ] **T7.7** Titolo viewer mostra capitolo + tipo

### T8: Export

- [ ] **T8.1** Export JSON → prompt nome → file scaricato con nome corretto
- [ ] **T8.2** JSON contiene: name, book, exportedAt, count, chunks[]
- [ ] **T8.3** JSON chunks contengono tutti i campi (id, type, src/content, alt, color, chapter, date)
- [ ] **T8.4** Export HTML → file `.html` standalone valido
- [ ] **T8.5** HTML: immagini in base64 visualizzate correttamente
- [ ] **T8.6** HTML: colori highlight preservati
- [ ] **T8.7** Export MD → file `.md` con sintassi corretta
- [ ] **T8.8** MD: immagini con sintassi `![alt](base64)`
- [ ] **T8.9** Export senza chunk → toast "No items to export"
- [ ] **T8.10** Export annullato (prompt cancel) → nessun download

### T9: Import

- [ ] **T9.1** Import JSON valido → confirm → chunk accodati, badge aggiornato
- [ ] **T9.2** JSON senza `chunks` array → errore "Invalid collection file"
- [ ] **T9.3** JSON vuoto (`chunks: []`) → errore "Collection file is empty"
- [ ] **T9.4** JSON con chunk invalidi (type mancante/sconosciuto) → filtrati, conteggio skipped
- [ ] **T9.5** Import annullato (confirm cancel) → nessuna modifica
- [ ] **T9.6** Due import consecutivi → nessuna collisione ID (Date.now + random)
- [ ] **T9.7** Import con immagini base64 → visualizzate correttamente nel drawer e viewer
- [ ] **T9.8** Import con testo/colore → colore preservato
- [ ] **T9.9** Import da file corrotto/non-JSON → errore "Invalid JSON file"
- [ ] **T9.10** File inesistente/non leggibile → errore "Failed to read file"

### T10: Persistenza

- [ ] **T10.1** Aggiungere chunk, chiudere reader, riaprire stesso libro → chunk presente
- [ ] **T10.2** Aprire libro diverso → collection vuota (per-book storage)
- [ ] **T10.3** Tornare al primo libro → collection ancora presente
- [ ] **T10.4** Eliminare chunk, riaprire → chunk non presente
- [ ] **T10.5** Import chunk, riaprire → chunk importati presenti
- [ ] **T10.6** DB corrotto/non disponibile → `_collection = []` senza crash

### T11: Edge case

- [ ] **T11.1** Aggiungere stesso chunk due volte → due entry separate (non deduplica)
- [ ] **T11.2** Collection molto grande (100+ chunk) → performance rendering accettabile
- [ ] **T11.3** Immagine enorme (base64 > 10MB) → conversione e salvataggio funzionano
- [ ] **T11.4** Tabella senza contenuto → non crasha, mostra label vuota
- [ ] **T11.5** Testo vuoto nell'highlight → gestito
- [ ] **T11.6** Nessun libro aperto → Collection▼ disabilitato/nascosto?

### T12: UI / UX

- [ ] **T12.1** Dropdown Collection▼ e Chunks▼ modali (uno chiude l'altro)
- [ ] **T12.2** Select capitolo sufficientemente largo (320px)
- [ ] **T12.3** Badge contatore coerente tra toolbar e hamburger
- [ ] **T12.4** Toast visibili e con durata appropriata
- [ ] **T12.5** Pulsante Collect disabilitato durante elaborazione (evita double-click)

---

## 3. TEST PLAN — Correttezza Input/Output

### I/O 1: `_addToCollection()`

| Input | Output atteso | Da verificare |
|---|---|---|
| `_savedMedia.type = 'img'`, `src = blob:...` | `chunk.src` = data URL base64 PNG | Formato corretto, immagine visualizzabile |
| `_savedMedia.type = 'img'`, `src = data:...` | `chunk.src` = stesso data URL (non ricodificato) | Nessuna doppia conversione |
| `_savedMedia.type = 'img'`, `src = null/undefined` | `chunk.src = ''` | Nessun crash, thumbnail vuota nel drawer |
| `_savedMedia.type = 'text'`, `text = "Hello"`, `color = 'yellow'` | `chunk.content = "Hello"`, `chunk.color = 'yellow'` | Colori mappati correttamente |
| `_savedMedia.type = 'table'`, `html = "<table>..."` | `chunk.content = "<table>..."` | HTML preservato |
| `_savedMedia = null` | Nessuna azione | Funzione ritorna subito |

### I/O 2: `_importCollectionFromJSON()`

| Input | Output atteso | Da verificare |
|---|---|---|
| File JSON valido con 3 chunk | 3 chunk accodati, ID riassegnati, `book` aggiornato | ID non collidono con esistenti |
| Chunk `type: 'video'` (non valido) | Filtrato via, conteggiato come skipped | Messaggio confirm corretto |
| Chunk `type: 'img'` senza `src` | Filtrato via | Validazione funziona |
| Chunk `type: 'text'` senza `content` | Filtrato via | Validazione funziona |
| File non-JSON (binario, XML, etc.) | `JSON.parse` lancia eccezione → toast "Invalid JSON file" | Catch funziona |
| File con `chunks: null` | Errore "missing chunks array" | Controllo tipo array |

### I/O 3: `_exportCollectionJSON()`

| Input | Output atteso | Da verificare |
|---|---|---|
| 2 chunk selezionati | JSON con `count: 2`, `chunks.length === 2` | Coerenza count |
| Nome prompt vuoto | Usa `currentBookTitle` come fallback | `trim()` gestisce stringa vuota |
| Prompt annullato (null) | Nessun download, nessun toast errore | Return anticipato |
| Nessun chunk disponibile | Toast "No items to export" | Return anticipato |

### I/O 4: `_exportCollectionHTML()` / `_exportCollectionMD()`

| Input | Output atteso | Da verificare |
|---|---|---|
| Chunk img con `src` base64 | Tag `<img src="data:...">` nell'HTML, `![alt](data:...)` nell'MD | Sintassi corretta |
| Chunk text con newline | `white-space: pre-wrap` in HTML, `> ` prefix in MD | Formattazione preservata |
| Chunk table | HTML della tabella embeddato | Tabella renderizzata correttamente |

### I/O 5: Persistenza DB

| Input | Output atteso | Da verificare |
|---|---|---|
| `_collection = [3 chunk]`, `_saveCollectionToDB()` | `bookData.collections` in IndexedDB = array di 3 chunk | Deep copy (`slice()`) |
| `_loadCollectionFromDB(bookId)` | `_collection` = array dal DB | Badge aggiornato |
| `currentBookId = null` | `_saveCollectionToDB()` ritorna subito | Nessun errore |
| DB non disponibile (bloccato, versione errata) | `_loadCollectionFromDB` → `_collection = []` | Nessun crash |

---

## 4. ANALISI PUNTI DEBOLI

### 🟡 Priorità Media

| # | Problema | Causa | Impatto |
|---|---|---|---|
| W1 | **Autofit tabelle viewer non funzionante** | CSS flexbox + toggle class non reattivo. Rimosso toggle, rimasto solo overflow scroll | UX: nessun autofit disponibile per tabelle nel viewer |
| W2 | **Nessuna deduplica chunk** | `_addToCollection()` non controlla se chunk identico già esiste | UX: possibile aggiungere lo stesso contenuto più volte |
| W3 | **Selezione persa al cambio filtro** | `_renderCollectionList()` ricostruisce DOM, checkbox resettati | UX: cambio filtro = selezione persa |
| W4 | **Immagine nel viewer non ha fallback se `src` vuoto** | `_openChunkViewer` crea `<img src="">` anche per chunk senza src | Visual: icona broken image |
| W5 | **Export HTML: immagini base64 giganti rendono il file enorme** | Nessuna compressione o resize prima dell'export | File > 50MB possibili con molte immagini |

### 🟢 Priorità Bassa

| # | Problema | Causa | Impatto |
|---|---|---|---|
| W6 | **Nessun ordinamento personalizzato** | I chunk sono sempre in ordine cronologico inverso | UX: impossibile riordinare manualmente |
| W7 | **Nessuna ricerca full-text nei chunk** | Manca campo di ricerca nel drawer | UX: difficile trovare chunk specifico in collezioni grandi |
| W8 | **Nessun undo dopo delete** | `_deleteChunkById` è irreversibile | UX: cancellazione accidentale = chunk perso |
| W9 | **Toast "Saved" fuorviante dopo export** | Dice "Exported" ma in realtà è un download | UX: wording ambiguo |
| W10 | **Nessuna preview durante l'import** | L'utente vede solo un count, non il contenuto | UX: import alla cieca |

---

## 5. OPPORTUNITÀ DI MIGLIORAMENTO

### 🌟 Nuove feature (in ordine di valore/effort)

| # | Feature | Valore | Effort | Descrizione |
|---|---|---|---|---|
| M1 | **Esporta ZIP con immagini** | Alto | Medio | Invece di embeddare base64, crea ZIP con HTML + cartella `images/`. Riduce dimensione file dell'80% |
| M2 | **Drag & drop riordino chunk** | Alto | Medio | Riordinare chunk nel drawer via drag handle. Persiste ordinamento in `_collection` |
| M3 | **Merge / unione chunk** | Alto | Basso | Selezionare N chunk → "Merge" → unico chunk combinato (utile per unire highlight dello stesso tema) |
| M4 | **Note/annotazioni su chunk** | Alto | Medio | Aggiungere campo `note` ad ogni chunk, editabile inline nel drawer |
| M5 | **Preview prima dell'import** | Medio | Basso | Mostrare una mini-lista dei chunk nel JSON prima di confermare l'import |
| M6 | **Template export personalizzabili** | Medio | Alto | Esportare con template definiti dall'utente (es. "Scheda di studio" con campi specifici) |
| M7 | **Cerca/filtra per testo** | Medio | Basso | Campo search nel drawer che filtra per contenuto testuale |
| M8 | **Undo delete (soft delete)** | Basso | Basso | Spostare chunk in `_trash[]` invece di eliminarli, con "Empty trash" periodico |
| M9 | **Condivisione via Web Share API** | Basso | Basso | Bottone "Share" che usa `navigator.share()` per inviare collezione JSON |
| M10 | **Auto-tagging per capitolo** | Basso | Basso | Se il chunk ha `chapter`, mostrare un tag colorato nel drawer invece del testo |

---

## 6. SCHEDA TECNICA RIASSUNTIVA

### Funzioni implementate

```
_collection[]                    — Array globale in memoria
_saveCollectionToDB()            — Persiste su IndexedDB (async)
_loadCollectionFromDB(bookId)    — Carica da IndexedDB (async)
_updateCollectionBadge()         — Aggiorna #collBadge e #hmbCollBadge
_saveChunk(chunk)                — Assegna ID + date, push, persist, badge
_deleteChunkById(id)             — Filter via ID, persist, badge
_clearCollection()               — Svuota array, persist, badge
_getSelectedOrAll()              — Query checkbox checked → array chunk
_updateCollSelBadge()            — Conta checkbox checked → #collSelBadge
_exportCollectionJSON()          — prompt() nome → JSON → download
_exportCollectionHTML()          — Genera HTML standalone → download
_exportCollectionMD()            — Genera Markdown → download
_importCollectionFromJSON(file)  — FileReader → parse → valida → accoda → persist
_addToCollection() [async]       — Da _savedMedia a chunk, con conversione img base64
_blobToBase64(src)               — Converte blob/http URL in data URL PNG
_openCollectionDrawer()          — Mostra drawer, reset filtri
_closeCollectionDrawer()         — Nasconde drawer
_populateChapterFilter()         — Popola <select> capitoli da _collection
_renderCollectionList()          — Renderizza lista con checkbox, filtri, preview
_openChunkViewer(chunk)          — Apre viewer overlay per tipo
_closeChunkViewer()              — Chiude viewer overlay
```

### Struttura chunk

```javascript
{
  id: Number,        // Date.now() + offset (+ random per import)
  type: 'img'|'text'|'table',
  src: String,       // Data URL base64 (solo img)
  alt: String,       // Testo alternativo (solo img)
  content: String,   // HTML o testo (text e table)
  color: String,     // 'yellow'|'green'|'pink' (solo text highlight)
  book: String,      // Titolo libro
  chapter: String,   // Nome capitolo
  date: String       // ISO timestamp
}
```

### Elementi DOM

```
#collectionDrawer              — Drawer overlay (dall'alto)
#collList                      — Lista chunk
#collHeader                    — Header con bottoni
#collJsonBtn / #collJsonMenu   — Dropdown Collection (import/export JSON)
#collExportBtn / #collExportMenu — Dropdown Chunks (HTML/MD)
#collClearBtn                  — Pulsante Clear all
#collCloseBtn                  — Pulsante chiudi drawer
#collFilterBar                 — Filtri tipo (All, Text, Images, Tables)
#collChapterFilter             — Select capitolo
#collSelectAllBtn / #collDeselectAllBtn — Selezione bulk
#collSelBadge                  — Badge "N selected"
#collViewer                    — Overlay viewer chunk
#collViewerContent             — Contenuto viewer
#collBadge                     — Badge nella toolbar principale
#hmbCollBadge                  — Badge nel menu hamburger
#readerFsCollect               — Pulsante Collect nel fullscreen preview
```

### Persistenza

```
Database:  noesisReaderDB (stesso DB del reader)
Store:     STORE_NAME (lo stesso usato per book storage)
Key:       currentBookId (stringa, book identifier)
Campo:     bookData.collections = Array<chunk>
```

---

## 7. ORDINE DEL GIORNO — 29 Luglio

1. **Mattina**: Esecuzione sistematica del test plan (sezione 2 e 3)
   - Test T1-T3: aggiunta chunk da tutti i tipi
   - Test T4-T5: gestione drawer e selezione
   - Test T6: eliminazione
   - Test T7-T9: viewer, export, import
   - Test T10: persistenza
   - Test T11-T12: edge case e UI

2. **Pomeriggio**:
   - Verifica correttezza I/O (sezione 3)
   - Annotare bug trovati nei test
   - Prioritizzare fix
   - Valutare opportunità di miglioramento (sezione 5)
   - Pianificare prossima iterazione di sviluppo
