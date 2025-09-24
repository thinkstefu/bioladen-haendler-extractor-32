# bioladen-extractor (Rollback-Version)

**Ziel:** Für jede PLZ aus `plz_full.json` die Seite
https://www.bioladen.de/bio-haendler-suche öffnen, Ergebnisse lesen, jede
Detailseite öffnen und Kerninformationen in das Apify Dataset schreiben.
(CSV/JSON/XLSX-Export geht dann über den Dataset-Viewer.)

Diese Version ist bewusst simpel gehalten (wie der erfolgreiche Run mit ~90 Einträgen).
- Kein erzwungener 50-km-Radius (Standard-UI bleibt bestehen)
- Sequentielles Abarbeiten, robuste Selektoren mit Fallbacks
- Fehlende Felder werden mit null befüllt

## Build & Run auf Apify
- Actor bauen (Dockerfile enthalten)
- Standard-Command: `node main.js` (Apify ruft automatisch mit xvfb-run)
- Output erscheint im *default dataset*

## Export
- CSV: *Dataset* → *Export* → `CSV`
- XLSX: *Dataset* → *Export* → `XLSX`

## Felder
- zip, name, type, street, postalCode, city, phone, website, openingHours, sourceUrl

## Hinweise
- Cookie-Banner wird automatisch bestätigt (mehrere Fallback-Selektoren)
- „Details“-Links werden nacheinander geöffnet (neuer Tab oder gleiche Seite)
- Wenn die Seite ihre Struktur ändert, kann es zu Ausfällen kommen – diese Version
  fokussiert Stabilität wie im 90er-Run, nicht Perfektion der Feldzuordnung.
