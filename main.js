\
'use strict';

const { Actor, log } = require('apify');
const { chromium } = require('playwright'); // Comes with the base image

// ---------- Config ----------
const BASE_URL = 'https://www.bioladen.de/bio-haendler-suche';

// Try a bunch of selectors/texts to accept cookie banners defensively
async function acceptCookies(page) {
    const candidates = [
        'text="Alle akzeptieren"',
        'text="Akzeptieren"',
        'text="Zustimmen"',
        'text="Einverstanden"',
        'button:has-text("Alle akzeptieren")',
        'button:has-text("Akzeptieren")',
        '[id*="accept"]',
        '[class*="accept"]',
        '[aria-label*="accept"]',
        '[data-testid*="accept"]'
    ];
    for (const sel of candidates) {
        const el = page.locator(sel).first();
        try {
            if (await el.count() > 0) {
                await el.click({ timeout: 1500 });
                log.info('Cookie-Banner akzeptiert.');
                break;
            }
        } catch { /* ignore */ }
    }
}

// Find the PLZ input robustly and set the value
async function setZip(page, zip) {
    const candidates = [
        'input[name*="plz"]',
        'input[id*="plz"]',
        'input[placeholder*="PLZ"]',
        'input[placeholder*="Ort"]',
        'input[type="text"]'
    ];
    for (const sel of candidates) {
        const loc = page.locator(sel).first();
        try {
            if (await loc.count() > 0) {
                await loc.fill('');
                await loc.type(String(zip), { delay: 20 });
                return true;
            }
        } catch { /* ignore */ }
    }
    return false;
}

// Set the search radius to 50 in a <select>, if present
async function setRadius50(page) {
    const candidates = [
        'select[name*="dist"]',
        'select[id*="dist"]',
        'select:has(option:has-text("50"))',
        'select:has(option:has-text("50 km"))'
    ];
    for (const sel of candidates) {
        const dd = page.locator(sel).first();
        try {
            if (await dd.count() > 0) {
                // Prefer exact 50; fallback to any option that contains "50"
                const ok50 = await dd.locator('option[value="50"]').count();
                if (ok50) {
                    await dd.selectOption('50');
                } else {
                    const opts = await dd.locator('option').all();
                    for (const o of opts) {
                        const t = (await o.textContent() || '').trim();
                        const v = (await o.getAttribute('value') || '').trim();
                        if (/^50\b/.test(v) || /\b50\b/.test(t)) {
                            await dd.selectOption(v);
                            break;
                        }
                    }
                }
                log.info('Radius auf 50 km gesetzt.');
                return true;
            }
        } catch { /* ignore */ }
    }
    return false;
}

// Click something like "Suchen"
async function clickSearch(page) {
    const candidates = [
        'button:has-text("Suchen")',
        'input[type="submit"]',
        'button[type="submit"]',
        'button:has-text("Finden")',
        'button:has-text("Suche")'
    ];
    for (const sel of candidates) {
        const btn = page.locator(sel).first();
        try {
            if (await btn.count() > 0) {
                await btn.click({ timeout: 1500 });
                return true;
            }
        } catch { /* ignore */ }
    }
    return false;
}

// Extract detail page data robustly
async function scrapeDetail(context, url, queryZip) {
    const page = await context.newPage();
    try {
        await page.goto(url, { waitUntil: 'domcontentloaded', timeout: 45000 });
        await acceptCookies(page);

        // Prefer DOM if possible
        const name = (await page.locator('h1').first().textContent().catch(() => null))?.trim() || null;

        let street = null, zip = null, city = null;

        const addressText = (await page.locator('address').first().innerText().catch(() => '')) || '';
        let addr = addressText.replace(/\u00a0/g, ' ').split('\n').map(s => s.trim()).filter(Boolean);

        if (addr.length >= 2) {
            street = addr[0] || null;
            const m = addr[1].match(/(\d{5})\s+(.+)/);
            if (m) { zip = m[1]; city = m[2].trim(); }
        } else {
            // Fallback: regex over page text
            const full = await page.evaluate(() => document.body.innerText);
            const lines = full.split('\n').map(l => l.trim()).filter(Boolean);
            // pick first ZIP line
            for (let i = 0; i < lines.length; i++) {
                const m = lines[i].match(/(\d{5})\s+(.+)/);
                if (m) {
                    zip = m[1]; city = m[2].trim();
                    street = lines[i-1]?.length > 0 ? lines[i-1] : null;
                    break;
                }
            }
        }

        // Phone via regex over visible text
        const text = await page.evaluate(() => document.body.innerText);
        let phone = null;
        const phoneMatch = text.match(/(?:Telefon|Tel\.?|Fon|Phone)\s*[:\-]?\s*([+0][\d\s\/\-\(\)]{5,})/i) || text.match(/(\+49|0)[\d\s\/\-\(\)]{6,}/);
        if (phoneMatch) phone = phoneMatch[1].replace(/\s{2,}/g, ' ').trim();

        // Website: pick first external link that's not bioladen, facebook, instagram, maps, mailto, tel
        let website = null;
        const links = await page.$$eval('a[href]', as => as.map(a => a.href));
        for (const href of links) {
            const h = href.toLowerCase();
            if (!h) continue;
            if (!/^https?:\/\//.test(h)) continue;
            if (h.includes('bioladen.de')) continue;
            if (/(facebook|instagram|goo\.gl|google|maps\.google|mailto:|tel:)/.test(h)) continue;
            website = href;
            break;
        }

        // Category heuristic
        let category = null;
        if (/marktstand/i.test(text)) category = 'Marktstand';
        else if (/liefer(ung|service)/i.test(text)) category = 'Lieferservice';
        else if (/bioladen/i.test(text)) category = 'Bioladen';

        // Normalize nulls
        const rec = {
            query_zip: String(queryZip),
            name: name ?? null,
            street: street ?? null,
            zip: zip ?? null,
            city: city ?? null,
            phone: phone ?? null,
            website: website ?? null,
            category: category ?? null,
            source_url: url
        };

        await Actor.pushData(rec);
    } catch (err) {
        log.warning(`Detail-Fehler bei ${url}: ${err.message}`);
    } finally {
        await page.close().catch(() => {});
    }
}

// Collect detail URLs from results page
async function collectDetailLinks(page) {
    // Best-effort: anchors with text "Details"
    const hrefs = await page.$$eval('a', as =>
        as.filter(a => /details/i.test(a.textContent || ''))
          .map(a => a.href).filter(Boolean)
    ).catch(() => []);

    // Fallback: cards with a detail link inside
    if (hrefs.length === 0) {
        const more = await page.$$eval('a[href*="haendlersuche"]', as =>
            as.filter(a => /detail|haendler|haendlersuche\//i.test(a.href))
              .map(a => a.href)
        ).catch(() => []);
        for (const u of more) if (!hrefs.includes(u)) hrefs.push(u);
    }
    return hrefs;
}

(async () => {
    await Actor.init();

    // Read input
    const input = await Actor.getInput() || {};
    const headless = input.headless !== false; // default true
    const maxZips = Number(input.maxZips) || null;

    // Load PLZ list
    const zips = require('./plz_full.json');
    const allZips = Array.isArray(zips) ? zips : Object.values(zips);
    const runZips = maxZips ? allZips.slice(0, maxZips) : allZips;

    log.info(`PLZ in Lauf: ${runZips.length}`);

    const browser = await chromium.launch({ headless });
    const context = await browser.newContext({ viewport: { width: 1280, height: 900 } });

    let totalSaved = 0;
    let idx = 0;

    for (const zip of runZips) {
        idx += 1;
        const page = await context.newPage();
        try {
            log.info(`=== ${idx}/${runZips.length} | PLZ ${zip} ===`);

            await page.goto(BASE_URL, { waitUntil: 'domcontentloaded', timeout: 60000 });
            await acceptCookies(page);

            const zipOk = await setZip(page, zip);
            if (!zipOk) {
                log.warning('PLZ-Feld nicht gefunden – überspringe diese PLZ.');
                await page.close();
                continue;
            }

            await setRadius50(page); // best effort
            await clickSearch(page);

            // Wait for either results or an empty state
            await page.waitForTimeout(1500);
            // attempt to wait for results area to render
            await page.waitForLoadState('networkidle', { timeout: 20000 }).catch(() => {});

            const detailLinks = await collectDetailLinks(page);
            log.info(`DETAILS buttons: ${detailLinks.length}`);

            let savedHere = 0;
            for (const href of detailLinks) {
                await scrapeDetail(context, href, zip);
                savedHere += 1;
            }

            log.info(`PLZ ${zip}: ${savedHere} Datensätze extrahiert`);
            totalSaved += savedHere;

        } catch (err) {
            log.warning(`Fehler bei PLZ ${zip}: ${err.message}`);
        } finally {
            await page.close().catch(() => {});
        }
    }

    log.info(`Fertig. Insgesamt gespeichert: ${totalSaved}`);

    await context.close().catch(() => {});
    await browser.close().catch(() => {});
    await Actor.exit();
})();
