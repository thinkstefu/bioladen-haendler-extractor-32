# bioladen-simple-actor

Minimaler, stabiler Apify Actor, der die Bioladen-Händlersuche scrapt.

**Was er macht**
- Öffnet https://www.bioladen.de/bio-haendler-suche
- Akzeptiert Cookie-Banner
- Setzt (wenn möglich) Radius auf 50 km
- Gibt eine PLZ ein, startet die Suche
- Öffnet nacheinander alle "Details"-Seiten und extrahiert:
  - name, street, zip, city, phone, website, category, source_url, query_zip
- Schreibt die Ergebnisse ins Apify Dataset

**Run-Optionen (optional)**

```json
{
  "maxZips": 200,
  "headless": true
}
```

**Hinweise**
- Stelle das Run-Timeout z.B. auf 60 Minuten.
- Ersetze bei Bedarf `plz_full.json` mit deiner vollständigen Liste.
