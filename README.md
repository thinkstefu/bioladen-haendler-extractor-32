# Hotfix: Missing `apify` module

You saw this error:
```
Error: Cannot find module 'apify'
Require stack:
- /usr/src/app/main.js
```
Root cause: The Docker image did not run `npm install`, so the `apify` package wasn't present.
This hotfix restores a safe install step in the Dockerfile **as root**, avoids permission issues,
and declares `apify@^3.4.5` (SDK v3) plus `playwright` in `package.json`.

## How to use
1. Replace your Actor's **Dockerfile** and **package.json** with the ones in this ZIP.
2. Make sure your code uses Apify SDK v3 style:
   - `const { Actor, log } = require('apify')`
   - `await Actor.init()` / `await Actor.exit()` **or** `Actor.main(async () => { ... })`
   - `await Actor.pushData(item)` instead of `Apify.pushData(item)`
3. Rebuild the Actor and run again.

> Note: Base image `apify/actor-node-playwright-chrome:20` already contains browsers,
> so this install does **not** download them again. The `npm install` only installs Node modules.

## Tip
If you previously saw `TypeError: Apify.main is not a function`, you are on SDK v3.
Switch to `Actor.main(...)` and replace `Apify.*` helpers with `Actor.*` equivalents.
