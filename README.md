
# bioladen-haendler-extractor (rollback, robust)

**Tut genau das Nötige:** Für jede PLZ aus `plz_full.json` die Seite
https://www.bioladen.de/bio-haendler-suche aufrufen, Suche starten, alle Treffer laden, jede Detailseite öffnen und die Felder extrahieren. Fehlende Felder werden als `null` gespeichert.

## Build & Run auf Apify
- Dockerfile verwendet `apify/actor-node-playwright-chrome:20`
- Keine EACCES-Probleme, da `package.json` mit `--chown` kopiert und als `myuser` installiert.

### Input (optional)
```json
{
  "radiusKm": 50,
  "startIndex": 0,
  "limit": null,
  "plzList": null
}
```
- `radiusKm`: angestrebter Umkreis in km (Default 50). UI und URL-Fallback.
- `startIndex`: Startindex in der PLZ-Liste.
- `limit`: Anzahl PLZs, die dieser Run abarbeitet (zum Testen).
- `plzList`: Wenn gesetzt, überschreibt `plz_full.json`.

### Output
Schreibt in das default Dataset (`Apify.pushData`) mit Spalten:
`email, kategorie, name, ort, plz, quelle_plz, strasse, telefon, webseite, source_url`

## Lokaler Test
```bash
npm install
node main.js
```

## Hinweise
- Der Crawler scrollt und klickt "mehr" so lange, bis keine neuen `DETAILS`-Buttons erscheinen.
- Wenn das PLZ-Feld im UI nicht verfügbar ist, wird ein URL-Fallback verwendet.
- Anti-Bot-Schutz: konservative Wartezeiten, `networkidle`, User-Agent gesetzt.
