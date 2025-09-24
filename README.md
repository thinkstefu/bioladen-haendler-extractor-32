# bioladen-haendler-extractor (simple)

Minimaler, robuster Actor:
- Keine `npm install` Schritte notwendig (Base-Image enthält Playwright + Apify).
- CommonJS (keine ESM-Fallen).
- Läuft über alle PLZ aus `plz_full.json`.
- Schreibt **null** bei fehlenden Feldern.
- Export via Apify Dataset (CSV/JSON).

## Run-Hinweise
- Timeout auf mind. 60 Minuten hochstellen.
- Optional: Anzahl PLZ zu Testzwecken begrenzen, indem man `plz_full.json` temporär kürzt.

## Build
Das beiliegende `Dockerfile` wird benutzt – kein Default-Dockerfile.
