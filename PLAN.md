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
