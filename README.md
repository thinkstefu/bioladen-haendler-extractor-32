# bioladen-extractor (rollback, minimal)

Stabile, einfache Actor-Version – wie beim Lauf mit ~90 Treffern.

## Was sie tut
- Öffnet https://www.bioladen.de/bio-haendler-suche
- Setzt PLZ (aus `plz_full.json`) und Radius 50 km (UI + URL-Fallback)
- Lädt **alle** Treffer der Liste (Scroll/„mehr“)
- Öffnet alle „DETAILS“-Seiten und extrahiert Felder
- Speichert jeden Datensatz mit vollständigem Schema (fehlend = `null`)

## Felder
`email, kategorie, name, ort, plz, quelle_plz, strasse, telefon, webseite, source_url`

## Input (optional)
```json
{
  "radiusKm": 50,
  "startIndex": 0,
  "limit": 100
}
```

> `limit` ist praktisch zum Testen. Weglassen = alle PLZs.

## Dockerfile-Hinweis (EACCES-Fix)
- `npm install` wird als **root** ausgeführt, danach `chown` auf `myuser`.
- Laufzeit erfolgt als `myuser`. So treten keine `EACCES`-Fehler mehr auf.
