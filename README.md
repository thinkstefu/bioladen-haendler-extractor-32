# bioladen-haendler-extractor — Minimal (stabil)

**Was es macht:**  
- Öffnet `https://www.bioladen.de/bio-haendler-suche`
- Tippt jede PLZ aus `plz_full.json` ein
- Setzt, wenn möglich, den Umkreis auf **50 km** und aktiviert *Bioläden / Marktstände / Lieferservice*
- Öffnet **alle Detailseiten** und extrahiert **Name, Straße, PLZ, Ort, Telefon, Website, source_url, query_zip**
- Schreibt alles in das **Apify Dataset** (du kannst CSV/XLSX direkt aus dem Dataset exportieren)

## Build (keine npm-Fehler)
Das Dockerfile **führt kein `npm install` aus**. Die Abhängigkeiten (Apify SDK & Playwright) sind im Base-Image bereits vorhanden.

## Run (Apify)
- **Timeout** in den Run-Optionen auf z. B. **60 Minuten** stellen.
- Optionales Input JSON (nicht erforderlich):
  ```json
  {
    "maxZips": 200,
    "headless": true
  }
  ```

## Output
- Die Ergebnisse liegen im **Default Dataset** des Runs.
- Export-Links: CSV / XLSX / JSON sind über das Dataset verfügbar.

## Anpassungen
- Selektoren liegen zentral in `main.js` in `SELECTORS`.
- Falls die Seite das UI ändert, passen hier 1–2 Zeilen und es läuft weiter.
