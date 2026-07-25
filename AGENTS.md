# Project instructions for opencode

## Mirror changes to noesis-multi

This repository (`noesis-reader`) is the source of truth for the core application code (`index.html`).
The parent repository `/home/vigliafg/Documenti/GitHub/noesis-multi/` contains variant copies
of `index.html` that must be kept in sync.

### File mapping

When you modify `index.html` in this repository, apply the same changes to **all** of these files in `noesis-multi`:

| Source (noesis-reader) | Targets (noesis-multi) |
|---|---|
| `index.html` | `noesis816.html` |
| `index.html` | `noesis816-full.html` |
| `index.html` | `noesis816-reader.html` |
| `index.html` | `noesis816-full-reader.html` |

### Rules

1. After each batch of changes to `index.html`, apply the **identical** edits (`oldString`/`newString`) to all four target files in `noesis-multi`.
2. After mirroring, commit and push changes in **both** repositories:
   - `noesis-reader` (current repo)
   - `noesis-multi` (parent repo)
3. Use the same commit message for both repos.
