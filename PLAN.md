# Piano — 2 Agosto 2026

Obiettivo: risolvere le criticità emerse dall'integrazione reader↔editor.

## Stato attuale

- **Architettura**: `index.html` (reader, ~10K righe) + `noesis-editor.html` (editor, ~2.7K righe), due file separati comunicanti via `sessionStorage` + `window.open()`
- **Branch**: `main` in entrambi i repo
- **Commit di ieri**: rename `noesis816-editor.html` → `noesis-editor.html`, fix scope `_shouldOpenEditor`, fix CSS `hidden` conflict, fix sync actions on menu open

---

## 🔴 FASE 1 — Unificazione Collection (priorità massima)

**Obiettivo**: Una sola `_collection`, condivisa reader↔editor via IndexedDB. Oggi ci sono due strutture incompatibili.

### Struttura reader (source of truth)
```js
{ id: number, type: 'img'|'text'|'table', book: "...", chapter: "...",
  date: "ISO string", src: "base64", alt: "...", content: "...", color: "yellow" }
```
✅ Persistenza IndexedDB (`noesisDB`)

### Struttura editor (da normalizzare)
```js
{ id: string, type: 'text'|'image'|'table', bookName: "...", chapterName: "...",
  timestamp: number, content: "<img src=...>" }
```
❌ Solo memoria, nessuna persistenza

### Differenze da allineare
| Campo editor | Campo reader | Azione |
|---|---|---|
| `bookName` | `book` | Rinominare |
| `chapterName` | `chapter` | Rinominare |
| `timestamp` (number) | `date` (ISO) | Convertire |
| `'image'` | `'img'` | Rinominare |
| `id` (string) | `id` (number) | `Date.now()` |
| `<img>` HTML | `src` base64 + `alt` | Estrarre src da HTML |
| assente | `color` | Aggiungere |

| Step | Task | File |
|---|---|---|
| 1.1 | Normalizzare `_enrichChunk()` e `_saveChunk()` nell'editor | `noesis-editor.html` |
| 1.2 | Aggiungere `_saveCollectionToDB()` / `_loadCollectionFromDB()` nell'editor via `noesisDB` | `noesis-editor.html` |
| 1.3 | Sostituire `_collection` in-memory con IndexedDB | `noesis-editor.html` |
| 1.4 | Adattare `_loadReaderCollections(bookId)` (già esiste) alla struttura unificata | `noesis-editor.html` |

---

## 🔴 FASE 2 — sessionStorage: gestione limite 5MB

**Problema**: se il capitolo estratto è grande (molte immagini), `sessionStorage.setItem()` può fallire.

| Step | Task | File |
|---|---|---|
| 2.1 | Se payload > ~4MB, salvare in IndexedDB con chiave temporanea invece di sessionStorage | `index.html` |
| 2.2 | Editor: `_bootPayload()` cerca prima sessionStorage, poi IndexedDB | `noesis-editor.html` |
| 2.3 | Pulire chiave temporanea dopo caricamento | `noesis-editor.html` |

---

## 🟡 FASE 3 — Persistenza capitolo nell'editor

**Problema**: se l'utente ricarica la pagina editor, perde il contenuto.

| Step | Task | File |
|---|---|---|
| 3.1 | Salvare `htmlContent` in IndexedDB ad ogni modifica (debounced 2s) | `noesis-editor.html` |
| 3.2 | A reload, recuperare da IndexedDB | `noesis-editor.html` |
| 3.3 | Bottone "Discard" per resettare | `noesis-editor.html` |

---

## 🟡 FASE 4 — Feature mancanti in `noesis-multi`

`index.html` ha feature che i 4 target (`noesis816*.html`) non hanno.

| Step | Task |
|---|---|
| 4.1 | Chapter ZIP extraction (`case 'zip'`, `_extractChapterZip`, bottone) |
| 4.2 | Collection ZIP export (`_exportCollectionZIP`, bottone, dispatch) |
| 4.3 | `_resizeBase64Image` + async `_exportCollectionHTML` |
| 4.4 | Chunk viewer placeholder (`.cv-placeholder` CSS + JS) |

---

## 🟢 FASE 5 — Pulizia codice

| Step | Task | File |
|---|---|---|
| 5.1 | Estrarre `_extractTree()` helper: 3 copie tree extraction → 1 | `index.html` + target |
| 5.2 | Completare responsive editor: inspect panel, dialog, toast, hamburger | `noesis-editor.html` |

---

## 🟢 FASE 6 — Test e commit

| Step | Task |
|---|---|
| 6.1 | Testare flusso completo: reader → extract → editor → modifica → collection → export |
| 6.2 | Commit + push in `noesis-reader` e `noesis-multi` |

---

## Ordine esecuzione

```
FASE 1 (unificazione) → FASE 2 (sessionStorage) → FASE 3 (persistenza)
                                                    ↓
                                              FASE 4 (feature noesis-multi)
                                                    ↓
                                              FASE 5 (pulizia)
                                                    ↓
                                              FASE 6 (test)
```

FASE 1 è prerequisito: finché le collection sono separate, ogni modifica rischia di rompere l'integrazione.

---

## Test infrastructure (da sessioni precedenti)

```bash
# Server
setsid python3 -m http.server 8765 --bind 127.0.0.1 -d /home/vigliafg/Documenti/GitHub/noesis-reader &

# Esegui test
NODE_PATH=/home/vigliafg/.nvm/versions/node/v24.18.0/lib/node_modules node test_collection_T1T3.js
```

### Puppeteer patterns
- Riacquisire iframe dopo `rendition.display()` (contentFrame stantio)
- `page.evaluate()` per chiamare funzioni JS direttamente
- `cb.click()` invece di `cb.checked = true` (non scatena evento change)
- Handler dialog centralizzato: `page.on('dialog', ...)`

---

## File coinvolti

| Repo | File |
|---|---|
| `noesis-reader` | `index.html`, `noesis-editor.html` |
| `noesis-multi` | `noesis816.html`, `noesis816-full.html`, `noesis816-reader.html`, `noesis816-full-reader.html`, `noesis-editor.html` |

---
