# Implementation Plan — Next Session

**Date**: July 27, 2026  
**Total estimated time**: ~3.5 hours  
**Order**: 3 → 1 → 2 → 4

---

## Ambito 3: Logo e nome nell'interfaccia

**Stato attuale**: Library header sinistra vuota (solo hamburger nascosto), reader header senza logo.

**Cosa fare**: Aggiungere "📚 NOESIS" in piccolo nella `.library-header-left`.

```
[📚 NOESIS]                    [ADD BOOKS] [THEMES] [TOOLS]
```

**Modifiche**:
1. Aggiungere `<span class="lib-brand">📚 NOESIS</span>` nella `.library-header-left`
2. CSS: `.lib-brand { font-size: 13px; opacity: 0.85; letter-spacing: 0.05em; font-family: system-ui; }`
3. Opzionale: stesso span nella reader header accanto al back button

**Stima**: ~20 righe, 15 minuti.

---

## Ambito 1: Extract multi-formato

**Stato attuale**: Menu Extract con 2 opzioni (current chapter, current + sublevels), entrambi salvano solo HTML.

**Cosa fare**: Aggiungere selettore di formato. 4 formati disponibili.

### Formati

| # | Formato | Generazione | Estensione | Complessità |
|---|---|---|---|---|
| 1 | **HTML** | Già esistente (`_autoDownloadHTML`) | `.html` | ✅ Fatto |
| 2 | **Plain Text** | `textContent` del capitolo, strip HTML | `.txt` | Bassa |
| 3 | **Markdown** | Conversione HTML→MD: heading, p, strong, em, a, img, table, ul/ol, blockquote | `.md` | Media |
| 4 | **EPUB standalone** | JSZip: mimetype, container.xml, OPF, chapter XHTML + immagini embeddate | `.epub` | Alta |

### EPUB con immagini — algoritmo `generateEpub(title, author, htmlContent, epubArrayBuffer)`

```
1. Apri l'EPUB originale con JSZip (da epubArrayBuffer in IDB)
2. Scansiona htmlContent per tutti i <img src="...">
3. Per ogni immagine:
   a. Se src è relativo (../images/xxx) → estrai da JSZip, salva in OEBPS/images/
   b. Se src è data URL → decodifica base64, salva in OEBPS/images/
   c. Se src è URL esterno → fetch, salva in OEBPS/images/
   d. Aggiorna src → "images/nomefile.jpg"
   e. Aggiungi <item> al manifest OPF con media-type corretto
4. Crea struttura EPUB con JSZip:
   - mimetype (STORE, no compression)
   - META-INF/container.xml
   - OEBPS/content.opf (metadata + manifest + spine)
   - OEBPS/chapter.xhtml
   - OEBPS/images/*
5. Genera blob e trigger download
```

**Dipendenze**: JSZip (✅ già caricato v3.10.1), epubArrayBuffer da IndexedDB (`bookData.data`)

**Modifiche**:
- HTML: aggiungere selettore formato nel dropdown extract
- JS: `_downloadAsText()`, `_downloadAsMarkdown()`, `_generateEpub()`, `_embedImages()`
- JS: modificare handler click extract per usare il formato selezionato

**Stima**: ~155 righe, ~1.5 ore.

---

## Ambito 2: Salva media dal preview

**Stato attuale**: Cliccando su immagine/tabella nell'EPUB → dialog "Preview/Exit" → overlay fullscreen con [✕] per chiudere.

**Cosa fare**: Aggiungere pulsante "Save" nell'overlay fullscreen.

### Formati

| Tipo media | Formati | Come |
|---|---|---|
| **Immagine** | PNG (originale), JPEG (convertito) | Data URL → canvas.toBlob() per JPEG, download diretto per PNG |
| **Tabella** | CSV, HTML | CSV: itera `<tr>/<td>`, virgole. HTML: contenuto già disponibile |

### Algoritmo `saveMedia()`

```
1. Se pending.type === 'img':
   a. Crea <canvas>, disegna immagine
   b. canvas.toBlob('image/jpeg', 0.9) → download JPEG
   c. Oppure download diretto del src originale (PNG)
2. Se pending.type === 'table':
   a. Estrai tutte le righe: [...table.querySelectorAll('tr')]
   b. Per ogni riga: [...tr.querySelectorAll('td,th')].map(td => td.textContent)
   c. Unisci con virgole → Blob → download CSV
   d. Oppure table.outerHTML → Blob → download HTML
```

**Modifiche**:
- HTML: `<button id="readerFsSave">Save</button>` nell'overlay fullscreen
- JS: `saveMedia()` con logica per tipo
- CSS: stile pulsante Save

**Stima**: ~75 righe, 1 ora.

---

## Ambito 4: Studio — Pubblicità non intrusiva

**Obiettivo**: Analizzare come inserire pubblicità senza impattare la lettura. **Solo analisi, nessuna implementazione.**

### Principio guida

> Mai interrompere la lettura. Mai.

### Punti di inserimento (dal meno al più intrusivo)

| # | Punto | Momento | Intrusività |
|---|---|---|---|
| A | Library: banner tra i libri | Ogni N libri, banner nativo | ⭐ Bassa |
| B | Transizione capitolo | Dopo N cambi capitolo, mini-banner status bar | ⭐ Bassa |
| C | Ritorno alla library | Dopo lettura, banner | ⭐ Bassa |
| D | Idle timeout | Dopo N minuti senza interazione | ⭐ Molto bassa |

### Cosa NON fare

- ❌ Popup/interstitial durante la lettura
- ❌ Banner fisso nel reader
- ❌ Video autoplay
- ❌ Ads che coprono il testo

### Da testare nella sessione

Prototipo di banner nativo nella library view con JSON di "libri sponsorizzati" finti. Valutare impatto visivo.

### Tecnologie da valutare

- Google AdSense (display nativi)
- Carbon Ads (design pulito, developer/tech)
- Auto-gestito (affiliati Amazon libri)
- Modello freemium (no ads, abbonamento)

**Stima**: 30 minuti (analisi, prototipo, decisione).

---

## Timeline

| Ora | Ambito | Attività |
|---|---|---|
| 0:00 | **3 — Logo** | Aggiungere "📚 NOESIS" nella library header |
| 0:15 | **1 — Extract** | Plain Text + Markdown |
| 0:35 | **1 — Extract** | EPUB con immagini embeddate |
| 1:30 | **2 — Save media** | Pulsante Save in preview fullscreen |
| 2:30 | **4 — Studio ads** | Prototipo banner nativo in library |
| 3:00 | Test + commit | Browser-use test, commit, push |

---

## Note tecniche

- JSZip v3.10.1 già caricato via CDN
- EPUB originale accessibile come ArrayBuffer in IndexedDB: `bookData.data`
- Metadati disponibili: `currentBookTitle`, `bookData.title`, `bookData.author`
- Funzione di download esistente: `_autoDownloadHTML(filename, htmlContent)` — da generalizzare
- Usare `allowMultiple: true` con cautela — ha causato SyntaxError in passato
