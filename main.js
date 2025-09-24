\
/* Minimal, stable CommonJS actor that iterates ZIPs and extracts dealer details */
const fs = require('fs');
const path = require('path');
const Apify = require('apify');
const { chromium } = require('playwright');
const { delay, acceptCookies, loadAllResults, normalizeZip, uniq } = require('./utils');

const BASE = 'https://www.bioladen.de/bio-haendler-suche';

// Simple field helpers
async function textOf(page, sel) {
    try {
        const t = await page.locator(sel).first().innerText({ timeout: 1500 });
        return t?.trim() || null;
    } catch { return null; }
}

async function hrefOf(page, sel) {
    try {
        const h = await page.locator(sel).first().getAttribute('href', { timeout: 1500 });
        return h || null;
    } catch { return null; }
}

async function extractDealerDetail(context, href, quelle_plz) {
    const url = href.startsWith('http') ? href : new URL(href, BASE).href;
    const page = await context.newPage();
    try {
        await page.goto(url, { waitUntil: 'domcontentloaded', timeout: 45000 });
        // Generic extraction heuristics (works with previous good run)
        const name = (await textOf(page, 'h1')) || (await textOf(page, 'h2'));
        const street = await textOf(page, '[class*="address"]') || await textOf(page, '.c-address, .address');
        const phone = (await hrefOf(page, 'a[href^="tel:"]'))?.replace('tel:', '') || null;
        const email = (await hrefOf(page, 'a[href^="mailto:"]'))?.replace('mailto:', '') || null;

        // find first external website link (avoid bioladen.de itself)
        let website = null;
        const links = await page.locator('a[href^="http"]').all();
        for (const l of links) {
            const h = await l.getAttribute('href');
            if (h && !h.includes('bioladen.de')) { website = h; break; }
        }

        // try to parse zip/city from any address block
        let ort = null, plz = null, strasse = null;
        if (street) {
            strasse = street.split('\n')[0]?.trim() || null;
            const addrText = street.replace(/\s+/g, ' ');
            const m = addrText.match(/(\d{5})\s+([A-Za-zÄÖÜäöüß\-\.\s]+)/);
            if (m) { plz = m[1]; ort = m[2].trim(); }
        }

        const record = {
            email: email || null,
            kategorie: 'Bioladen',
            name: name || null,
            ort: ort || null,
            plz: plz || null,
            quelle_plz: quelle_plz || null,
            strasse: strasse || null,
            telefon: phone || null,
            webseite: website || null,
            source_url: url,
        };
        await Apify.pushData(record);
        return record;
    } catch (e) {
        await Apify.utils.log.exception(e, 'Detail extraction failed');
        return null;
    } finally {
        await page.close();
    }
}

async function setZipAndSearch(page, zip) {
    // Try UI first
    const zipInputCandidates = [
        'input[placeholder*="Postleitzahl"]',
        'input[placeholder*="Ort"]',
        'input[name*="zip"]',
        'input[type="text"]',
        '#zip, #zipcode'
    ];
    let filled = false;
    for (const sel of zipInputCandidates) {
        try {
            const loc = page.locator(sel).first();
            if (await loc.isVisible({ timeout: 0 })) {
                await loc.fill('');
                await loc.type(zip, { delay: 50 });
                filled = true;
                break;
            }
        } catch {}
    }

    // Set Radius 50 km via button/select if available
    const radiusDone = await (async () => {
        const s = page.locator('select').filter({ hasText: /km/i });
        try {
            await s.first().selectOption({ label: '50 km' });
            return true;
        } catch {
            // try clicking a dropdown then choosing 50
            try {
                await page.locator('button, [role="button"]').filter({ hasText: /km/i }).first().click({ timeout: 1000 });
                await page.locator('li, [role="option"]').filter({ hasText: /50\s*km/ }).first().click({ timeout: 1000 });
                return true;
            } catch { return false; }
        }
    })();

    // Click "Bio-Händler finden" or hit Enter
    let triggered = false;
    const findBtn = page.locator('button, a').filter({ hasText: /BIO-?HÄNDLER\s*FINDEN/i }).first();
    try {
        await findBtn.click({ timeout: 1500 });
        triggered = true;
    } catch {
        try {
            await page.keyboard.press('Enter');
            triggered = true;
        } catch {}
    }

    if (!filled || !triggered) {
        // Fallback: open with URL params typically used by the site (robust to layout)
        const url = `${BASE}/?zip=${encodeURIComponent(zip)}&distance=50`;
        await page.goto(url, { waitUntil: 'domcontentloaded', timeout: 45000 });
    }
}

Apify.main(async () => {
    const input = (await Apify.getInput()) || {};
    const radiusKm = Number(input.radiusKm ?? 50);
    const startIndex = Number.isInteger(input.startIndex) ? input.startIndex : 0;
    const limit = Number.isInteger(input.limit) ? input.limit : null; // null = all

    // Load ZIPs from bundled file
    const plzPath = path.join(__dirname, 'plz_full.json');
    const raw = fs.readFileSync(plzPath, 'utf8');
    const list = JSON.parse(raw);
    let zips = list.map(normalizeZip).filter(Boolean);
    zips = uniq(zips);
    if (limit) zips = zips.slice(startIndex, startIndex + limit);
    else zips = zips.slice(startIndex);

    const browser = await chromium.launch({ headless: true, args: ['--no-sandbox'] });
    const context = await browser.newContext();
    const page = await context.newPage();

    let processed = 0;
    for (let i = 0; i < zips.length; i++) {
        const zip = zips[i];
        await Apify.utils.log.info(`=== ${i+1}/${zips.length} | PLZ ${zip} ===`);
        try {
            await page.goto(BASE, { waitUntil: 'domcontentloaded', timeout: 45000 });
            await acceptCookies(page);
            await setZipAndSearch(page, zip);

            // Ensure radius if page supports value; fallback via URL already applied.
            // Load all results, then collect detail links.
            const count = await loadAllResults(page);
            await Apify.utils.log.info(`DETAILS buttons: ${count}`);

            let hrefs = [];
            try {
                const els = await page.locator('a:has-text("DETAILS")').all();
                for (const e of els) {
                    const h = await e.getAttribute('href');
                    if (h) hrefs.push(h);
                }
            } catch {}
            const uniqueHrefs = uniq(hrefs);

            let saved = 0;
            for (const href of uniqueHrefs) {
                const rec = await extractDealerDetail(context, href, zip);
                if (rec) saved++;
            }
            await Apify.utils.log.info(`PLZ ${zip}: ${saved} neue Datensätze gespeichert`);
        } catch (err) {
            await Apify.utils.log.exception(err, `Fehler bei PLZ ${zip}`);
        }
        processed++;
        // Small polite delay
        await delay(300);
    }

    await browser.close();
    await Apify.utils.log.info(`Fertig. Bearbeitet: ${processed} PLZ(s).`);
});
