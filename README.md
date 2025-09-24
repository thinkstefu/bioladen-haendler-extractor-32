# bioladen.de Händler-Scraper (Rollback)

**Ziel**: Genau das Verhalten des erfolgreichen Laufs vom 11:35 reproduzieren (ca. 90 Ergebnisse auf 5 PLZ) – nur erweitert auf *alle* PLZ aus `plz_full.json`.

## Stack
- apify 3.4.5
- playwright 1.55.1
- Base image: apify/actor-node-playwright-chrome:20
- CommonJS, `Apify.main(...)`

## Start
- Im Apify Actor einfach dieses Repo bauen – CMD ist `node main.js`. Apify führt automatisch `xvfb-run` hinzu.
- Optionaler Input (JSON):
  ```json
  {
    "baseUrl": "https://www.bioladen.de/bio-haendler-suche",
    "radiusKm": 25,
    "limit": 50
  }
  ```
  - `baseUrl` ist optional; Default siehe Code.
  - `radiusKm` = 25 (wie im Referenzlauf). Möglich sind 10/25/50.
  - `limit` verarbeitet nur die ersten N PLZ aus `plz_full.json` (zum Testen).

## Output
Jeder Händler als Datensatz mit Feldern:
`email, kategorie, name, ort, plz, quelle_plz, strasse, telefon, webseite, source_url` (fehlende Felder = `null`).

