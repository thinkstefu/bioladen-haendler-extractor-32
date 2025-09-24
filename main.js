\
'use strict';

/**
 * Minimal, robuste Version ohne npm install.
 * - CommonJS + Actor.main (Apify v3)
 * - Playwright chromium
 * - UI-Interaktion (kein URL-Hack), robustes Fallback-Handling
 */

const { Actor, log } = require('apify');
const { chromium } = require('playwright');
const fs = require('fs');
const path = require('path');

const START_URL = 'https://www.bioladen.de/bio-haendler-suche';

const SELECTORS = {
    // ZIP Eingabefeld – mehrere Kandidaten
    zipInputs: [
        'input[name*="zip"]',
        'input[id*="zip"]',
        'input[placeholder*="PLZ"]',
        'input[placeholder*="Postleitzahl"]',
        'input[aria-label*="PLZ"]',
        'input[type="search"]',
        'input[type="text"]'
    ],
    // Radius – entweder echtes <select> oder Combobox
    radiusSelects: [
        'select[name*="radius"]',
        'select[id*="radius"]',
        'select:has(option:has-text("km"))'
    ],
    radiusComboboxes: [
        '[role="combobox"]',
        'button[aria-haspopup="listbox"]',
        'button:has-text("Umkreis")'
    ],
    // Kategorien (Labels/Checkboxen)
    categoryLabels: {
        shop: /bioläden?/i,
        market: /marktstände?/i,
        delivery: /liefer(service)?/i,
    },
    // Suchen-Button
    searchButtons: [
        'button[type="submit"]',
        'button:has-text("Suchen")',
        'button:has-text("Suche")',
        'button:has-text("Finden")',
        'input[type="submit"]'
    ],
    // Treffer-Liste
    detailsLinks: [
        'a:has-text("Details")',
        'a:has-text("DETAILS")',
        'a[href*="detail"]'
    ],
    // Detailseite (generische Container)
    detailsMain: [
        'main',
        '#main',
        '.content',
        'body'
    ],
    // Cookie-Banner
    cookieButtons: [
        'button:has-text("Alle akzeptieren")',
        'button:has-text("Akzeptieren")',
        'button:has-text("Zustimmen")',
        'button:has-text("OK")',
        'button[aria-label*="akzeptieren" i]'
    ]
};

/** small helpers */
const sleep = (ms) => new Promise((res) => setTimeout(res, ms));

async function firstVisible(page, selectors, timeout = 3000) {
    for (const sel of selectors) {
        const el = page.locator(sel).first();
        try {
            await el.waitFor({ state: 'visible', timeout });
            return el;
        } catch {}
    }
    return null;
}

async function clickIfVisible(page, selectors, timeout = 1500) {
    for (const sel of selectors) {
        const loc = page.locator(sel).first();
        try {
            await loc.waitFor({ state: 'visible', timeout });
            await loc.click({ timeout });
            return true;
        } catch {}
    }
    return false;
}

async function acceptCookies(page) {
    for (const sel of SELECTORS.cookieButtons) {
        const btn = page.locator(sel).first();
        if (await btn.count()) {
            try {
                await btn.click({ timeout: 1000 });
                log.info('Cookie-Banner akzeptiert.');
                break;
            } catch {}
        }
    }
}

async function findZipInput(page) {
    for (const sel of SELECTORS.zipInputs) {
        const loc = page.locator(sel).first();
        const cnt = await loc.count();
        if (!cnt) continue;
        try {
            await loc.waitFor({ state: 'visible', timeout: 1500 });
            return loc;
        } catch {}
    }
    return null;
}

async function setZipRadiusCategoriesAndSearch(page, zip) {
    // ZIP
    const zipInput = await findZipInput(page);
    if (!zipInput) {
        log.warning('PLZ-Feld nicht gefunden.');
    } else {
        await zipInput.fill('');
        await zipInput.type(String(zip), { delay: 30 });
    }

    // Kategorien anhaken – klick auf Labels (die Inputs sind oft versteckt)
    for (const [key, regex] of Object.entries(SELECTORS.categoryLabels)) {
        const label = page.locator('label').filter({ hasText: regex }).first();
        try {
            if (await label.count()) {
                // get related input if possible
                const forAttr = await label.getAttribute('for');
                if (forAttr) {
                    const checkbox = page.locator(`#${forAttr}`);
                    const checked = await checkbox.isChecked().catch(() => false);
                    if (!checked) await label.click({ timeout: 1500 });
                } else {
                    // fallback: click label, hope it toggles
                    await label.click({ timeout: 1500 });
                }
            }
        } catch {}
    }

    // Radius 50 km
    let radiusOk = false;
    // try real <select>
    for (const sel of SELECTORS.radiusSelects) {
        const dd = page.locator(sel).first();
        if (await dd.count()) {
            try {
                await dd.selectOption({ label: '50 km' }).catch(async () => {
                    await dd.selectOption('50').catch(() => {});
                });
                radiusOk = true;
                break;
            } catch {}
        }
    }
    if (!radiusOk) {
        // try combobox/button then option
        for (const sel of SELECTORS.radiusComboboxes) {
            const cb = page.locator(sel).first();
            if (await cb.count()) {
                try {
                    await cb.click({ timeout: 1500 });
                    // option 50 km
                    const opt = page.locator('text=/^\\s*50\\s*km\\s*$/i').first();
                    if (await opt.count()) {
                        await opt.click({ timeout: 1500 });
                        radiusOk = true;
                        break;
                    }
                } catch {}
            }
        }
    }

    // Suche starten
    let searchClicked = await clickIfVisible(page, SELECTORS.searchButtons, 1500);
    if (!searchClicked && zipInput) {
        await zipInput.press('Enter').catch(() => {});
    }

    // Warten auf Ergebnisse oder "keine Ergebnisse"
    await page.waitForLoadState('networkidle', { timeout: 10000 }).catch(() => {});
    await sleep(800);
}

async function collectDetailUrls(page) {
    // alle Details-Links einsammeln, URLs absolut machen
    const urls = new Set();
    for (const sel of SELECTORS.detailsLinks) {
        const links = page.locator(sel);
        const n = await links.count();
        for (let i = 0; i < n; i++) {
            const href = await links.nth(i).getAttribute('href').catch(() => null);
            if (href) {
                const abs = new URL(href, page.url()).toString();
                urls.add(abs);
            }
        }
    }
    return Array.from(urls);
}

function extractAddressFromText(text) {
    // naive Extraktion: erste Zeile mit Straße+Hausnr, dann PLZ+Ort
    const lines = text.split(/\r?\n/).map(s => s.trim()).filter(Boolean);
    let street = null, zip = null, city = null;
    // Suche PLZ
    for (const line of lines) {
        const m = line.match(/\b(\d{5})\s+([A-Za-zÄÖÜäöüß.\- ]{2,})$/);
        if (m) {
            zip = m[1];
            city = m[2].trim();
            break;
        }
    }
    // Straße: nimm die Zeile vor PLZ/Ort oder erste Zeile, die eine Hausnummer enthält
    for (let i = 0; i < lines.length; i++) {
        const line = lines[i];
        if (/\d+/.test(line) && !/^\d{5}\b/.test(line)) {
            street = line;
            if (i+1 < lines.length && !zip) {
                const m2 = lines[i+1].match(/\b(\d{5})\s+(.+)$/);
                if (m2) {
                    zip = m2[1];
                    city = m2[2].trim();
                }
            }
            break;
        }
    }
    return { street, zip, city };
}

async function extractPhone(page) {
    // Telefon aus Link oder Text
    const telLink = await page.locator('a[href^="tel:"]').first();
    if (await telLink.count()) {
        const href = await telLink.getAttribute('href');
        if (href) return href.replace(/^tel:/, '').trim() || null;
    }
    // Fallback: Muster im Text
    const txt = await page.textContent('body').catch(() => '') || '';
    const m = txt.match(/(?:Tel\.?|Telefon)\s*:?\s*([+()\d\/\-\s]{6,})/i);
    return m ? m[1].trim() : null;
}

async function extractWebsite(page) {
    // externe Website (kein bioladen.de)
    const links = page.locator('a[href^="http"]');
    const n = await links.count().catch(() => 0);
    for (let i = 0; i < n; i++) {
        const href = (await links.nth(i).getAttribute('href').catch(() => null)) || '';
        if (href && !href.includes('bioladen.de')) return href;
    }
    return null;
}

async function parseDetail(page, url, query_zip) {
    await page.goto(url, { waitUntil: 'domcontentloaded', timeout: 30000 }).catch(() => {});
    await page.waitForLoadState('networkidle', { timeout: 10000 }).catch(() => {});
    const mainSel = await firstVisible(page, SELECTORS.detailsMain, 2000);
    const ctx = mainSel ? await mainSel.textContent().catch(() => '') : (await page.textContent('body').catch(() => ''));

    let name = null;
    // h1 oder h2 als Name
    for (const sel of ['h1','h2','.shop-title','.headline']) {
        const node = page.locator(sel).first();
        if (await node.count()) {
            const t = (await node.textContent().catch(() => '') || '').trim();
            if (t) { name = t; break; }
        }
    }

    const addr = extractAddressFromText(ctx || '');
    const phone = await extractPhone(page);
    const website = await extractWebsite(page);

    const rec = {
        query_zip,
        name: name || null,
        street: addr.street || null,
        zip: addr.zip || null,
        city: addr.city || null,
        phone: phone || null,
        website: website || null,
        source_url: url
    };
    // null-füllen für alle keys
    for (const k of Object.keys(rec)) if (rec[k] === undefined) rec[k] = null;

    await Actor.pushData(rec);
    return rec;
}

Actor.main(async () => {
    const input = await Actor.getInput() || {};
    const headless = input.headless !== false;
    const maxZips = Number.isFinite(input.maxZips) ? input.maxZips : null;
    const startIndex = Number.isFinite(input.startIndex) ? input.startIndex : 0;

    // PLZ laden
    const plzFile = path.join(__dirname, 'plz_full.json');
    const zips = JSON.parse(fs.readFileSync(plzFile, 'utf-8'));
    const list = zips.slice(startIndex, maxZips ? startIndex + maxZips : undefined);

    log.info(`PLZ in Lauf: ${list.length} (aus plz_full.json)`);

    const browser = await chromium.launch({ headless });
    const ctx = await browser.newContext();
    const page = await ctx.newPage();

    let acceptedCookies = false;
    let totalSaved = 0;

    for (let i = 0; i < list.length; i++) {
        const zip = String(list[i]).trim();
        log.info(`=== ${i + 1}/${list.length} | PLZ ${zip} ===`);

        await page.goto(START_URL, { waitUntil: 'domcontentloaded', timeout: 30000 }).catch(() => {});
        await page.waitForLoadState('networkidle', { timeout: 10000 }).catch(() => {});

        if (!acceptedCookies) {
            await acceptCookies(page).catch(() => {});
            acceptedCookies = true;
        }

        await setZipRadiusCategoriesAndSearch(page, zip);

        // Treffer einsammeln
        const urls = await collectDetailUrls(page);
        log.info(`DETAILS-Links gefunden: ${urls.length}`);

        let savedHere = 0;
        for (const url of urls) {
            try {
                const rec = await parseDetail(page, url, zip);
                savedHere++;
                totalSaved++;
            } catch (e) {
                log.warning(`Fehler bei Detail ${url}: ${e.message}`);
            }
            // zurück zur Liste (erneut öffnen der Liste)
            await page.goto(START_URL, { waitUntil: 'domcontentloaded', timeout: 30000 }).catch(() => {});
            await page.waitForLoadState('networkidle', { timeout: 10000 }).catch(() => {});
            await setZipRadiusCategoriesAndSearch(page, zip);
        }

        log.info(`PLZ ${zip}: ${savedHere} Datensätze gespeichert`);
        await sleep(400); // kleine Pause
    }

    log.info(`Fertig. Insgesamt gespeichert: ${totalSaved}`);

    await browser.close();
});
