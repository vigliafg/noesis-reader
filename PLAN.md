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

# Piano — 28 Luglio 2026

## Obiettivo: Rifinire le finestre di salvataggio delle preview

### Problemi attuali da risolvere

1. **Il pulsante Save usa `confirm()` nativo del browser**
   - L'esperienza utente è poco elegante: un popup di sistema chiede "Save as JPEG?" ogni volta
   - Sostituire con un selettore di formato inline nell'overlay fullscreen

2. **Manca feedback dopo il salvataggio**
   - Dopo il download non c'è nessuna conferma visiva
   - Aggiungere un toast/notifica "✅ Saved as image.jpg"

3. **Il nome file è generico** (`image.png`, `image.jpg`, `table.html`, `table.csv`)
   - Usare l'alt text dell'immagine o il caption come nome file (sanitizzato)
   - Per le tabelle, generare un nome basato sul contesto

4. **Il pulsante Save potrebbe essere migliorato visivamente**
   - Valutare un'icona più chiara (es. `⬇` → icona Bootstrap)
   - Aggiungere una leggera animazione/transizione al click

### Modifiche proposte

#### 1. Sostituire `confirm()` con selettore formato inline
```
Aggiungere due mini-bottoni sotto il pulsante Save (o un dropdown):
  [Save as PNG]  [Save as JPEG]
  [Save as CSV]  [Save as HTML]
```
Oppure: un pulsante "Save" con un piccolo dropdown/chevron per scegliere il formato.

#### 2. Aggiungere toast di conferma
Riutilizzare il sistema `#saveToast` già esistente nel reader:
```javascript
showToast('✅ Saved as image.png', 'saved');
```

#### 3. Migliorare i nomi file
- Immagini: usare `pending.data.alt` sanitizzato (rimuovere caratteri non validi) o timestamp
- Tabelle: `table-{timestamp}.html` / `table-{timestamp}.csv`

#### 4. Icona Bootstrap per il pulsante Save
Sostituire `⬇` con `<i class="bi bi-download"></i>`

### Stima
~1 ora, ~50 righe

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
