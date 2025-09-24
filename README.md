# bioladen-simple-actor

Minimaler, robuster Actor zum Scrapen der Händlerdetails auf https://www.bioladen.de/bio-haendler-suche.

## Features
- Liest PLZ aus `plz_full.json` (Array aus Strings)
- Setzt Kategorien **Bioläden**, **Marktstände**, **Lieferservice**
- Setzt Radius **50 km** (über UI; ohne URL-Hacks)
- Klickt alle **Details**-Links der Trefferliste, öffnet die Seite und extrahiert:
  - `name, street, zip, city, phone, website, source_url, query_zip`
- Speichert alles im **Apify Dataset**

## Run-Optionen (optional, Input JSON)
```json
{
  "maxZips": 500,
  "startIndex": 0,
  "headless": true
}
```

## Hinweise
- Stelle das **Timeout** in den Run-Optionen auf z. B. **60 Minuten** oder mehr.
- Falls die Seite UI-Änderungen bekommt, sind Selektoren zentral in `SELECTORS` in `main.js` definiert.
- Keine `npm install` Schritte nötig – das Base-Image bringt Playwright & Apify mit.
