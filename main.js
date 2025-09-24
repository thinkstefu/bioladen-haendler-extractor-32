\
    const { Actor, Dataset, log } = require('apify');
    const { chromium } = require('playwright');
    const fs = require('fs');
    const path = require('path');

    // ---------- Config ----------
    const START_URL = 'https://www.bioladen.de/bio-haendler-suche';
    const RADIUS_LABELS = [/50\s*km/i, /50/];
    const CATEGORY_LABELS = [/bioläden?/i, /marktstände?/i, /liefer( ?service|ungen)?/i];

    const SELECTORS = {
        zipCandidates: [
            'input[placeholder*="PLZ"]',
            'input[placeholder*="PLZ oder"]',
            'input[aria-label*="PLZ"]',
            'input[name*="plz"]',
            'input[type="search"]',
            'input[type="text"]'
        ],
        searchButtonCandidates: [
            'button:has-text("Suchen")',
            'button[aria-label*="Suchen"]',
            'button[type="submit"]',
            'form button',
            'button:has(svg)'
        ],
        radiusCandidates: [
            'select',
            '[role="combobox"]',
            'button[aria-haspopup="listbox"]',
            '.select-trigger',
        ],
        resultsContainer: [
            '[data-results]',
            '.search-results',
            'section:has(h2:has-text("Treffer")), section:has(h2:has-text("Ergebnisse"))',
            'main'
        ],
        resultCards: [
            'a:has-text("Details")',
            'a:has(.icon):has-text("Details")',
            'a[href*="/bio-haendler/"]',
            '[data-testid*="result"] a',
            'article a'
        ],
        detailName: [
            'h1',
            'header h1',
            'article h1',
            '[data-testid="store-name"]'
        ],
        detailAddressBlock: [
            'address',
            '.address',
            '[data-testid="address"]',
            'section:has(h2:has-text("Adresse"))',
            'section:has(h3:has-text("Adresse"))'
        ],
        detailPhone: [
            'a[href^="tel:"]',
            'section:has-text("Telefon") a[href^="tel:"]'
        ],
        detailWebsite: [
            'a[href^="http"]:not([href*="facebook"]):not([href*="instagram"]):not([href*="twitter"])',
        ],
        categoryToggles: [
            'label:has-text("Bioladen")',
            'label:has-text("Marktstand")',
            'label:has-text("Lieferservice")',
            'button[role="switch"]',
            'input[type="checkbox"]'
        ]
    };

    function firstTruthy(arr) {
        for (const v of arr) if (v) return v;
        return null;
    }

    async function queryOne(page, selectors, { visible = true, timeout = 1000 } = {}) {
        for (const sel of selectors) {
            try {
                const el = await page.locator(sel).first();
                if (visible) await el.waitFor({ state: 'visible', timeout });
                else await el.waitFor({ state: 'attached', timeout });
                return el;
            } catch {}
        }
        return null;
    }

    async function click50km(page) {
        // Try to open a radius control and pick "50 km" by text
        for (const sel of SELECTORS.radiusCandidates) {
            const ctrl = page.locator(sel).first();
            try {
                await ctrl.waitFor({ state: 'visible', timeout: 1000 });
                await ctrl.click({ delay: 30 });
                // try options in open popup / listbox
                const option = page.locator('text=/\\b50\\s*km?\\b/i').first();
                try {
                    await option.waitFor({ state: 'visible', timeout: 1000 });
                    await option.click({ delay: 30 });
                    return true;
                } catch {}
                // try select element set
                const selectEl = await ctrl.elementHandle();
                if (selectEl) {
                    const tag = await (await selectEl.getProperty('tagName')).jsonValue();
                    if (String(tag).toLowerCase() === 'select') {
                        await page.selectOption(sel, { label: '50 km' }).catch(async () => {
                            await page.selectOption(sel, { value: '50' }).catch(() => {});
                        });
                        return true;
                    }
                }
            } catch {}
        }
        return false;
    }

    async function ensureCategories(page) {
        // Try to (en)able the three categories if present.
        for (const label of CATEGORY_LABELS) {
            const lab = page.locator(`label:has-text("${label.source.replace(/\\\\/g,'\\')}")`).first();
            try {
                await lab.waitFor({ state: 'visible', timeout: 500 });
                // If label wraps an input, toggle it to checked
                const inp = lab.locator('input[type="checkbox"]').first();
                const hasInp = await inp.count();
                if (hasInp) {
                    const checked = await inp.isChecked();
                    if (!checked) await lab.click({ delay: 20 });
                    continue;
                }
                // otherwise just click label (for custom switches)
                await lab.click({ delay: 20 });
            } catch {}
        }
    }

    async function setZipAndSearch(page, zip) {
        const zipInput = await queryOne(page, SELECTORS.zipCandidates, { visible: true, timeout: 2000 });
        if (!zipInput) {
            log.warning('PLZ-Feld nicht gefunden – versuche trotzdem zu suchen.');
        } else {
            await zipInput.fill('');
            await zipInput.type(String(zip), { delay: 30 });
        }

        await ensureCategories(page);
        const radiusOk = await click50km(page);
        if (!radiusOk) log.warning('50‑km Radius im UI nicht gefunden – fahre ohne Radius-Setzen fort.');

        // Try click search
        let clicked = false;
        for (const sel of SELECTORS.searchButtonCandidates) {
            try {
                const btn = page.locator(sel).first();
                await btn.waitFor({ state: 'visible', timeout: 1000 });
                await btn.click({ delay: 20 });
                clicked = true;
                break;
            } catch {}
        }
        if (!clicked) {
            // Fallback: press Enter in zip field
            if (zipInput) {
                await zipInput.press('Enter').catch(() => {});
            } else {
                // Last resort: reload with query params (if supported later)
                await page.reload();
            }
        }

        // wait for results area / or any card
        try {
            const container = await queryOne(page, SELECTORS.resultsContainer, { visible: true, timeout: 5000 });
            if (!container) await page.waitForLoadState('networkidle', { timeout: 5000 });
        } catch {}
        await page.waitForTimeout(800);
    }

    function parseAddress(text) {
        if (!text) return { street: null, zip: null, city: null };
        const clean = text.replace(/\s+/g, ' ').trim();
        // Very loose patterns: "... Straße 1, 12345 Musterstadt"
        const m = clean.match(/^(.*?),?\s*(\d{4,5})\s+(.+)$/);
        if (m) {
            return { street: m[1].trim() || null, zip: m[2] || null, city: m[3].trim() || null };
        }
        return { street: clean || null, zip: null, city: null };
    }

    async function extractDetail(page) {
        const url = page.url();
        // Name
        let name = null;
        for (const sel of SELECTORS.detailName) {
            try {
                const t = await page.locator(sel).first().textContent({ timeout: 500 });
                if (t && t.trim()) { name = t.trim(); break; }
            } catch {}
        }
        // Address
        let addressText = null;
        for (const sel of SELECTORS.detailAddressBlock) {
            try {
                const handle = page.locator(sel).first();
                await handle.waitFor({ state: 'visible', timeout: 500 });
                const t = await handle.textContent();
                if (t && t.trim()) { addressText = t; break; }
            } catch {}
        }
        const { street, zip, city } = parseAddress(addressText);

        // Phone
        let phone = null;
        for (const sel of SELECTORS.detailPhone) {
            try {
                const href = await page.locator(sel).first().getAttribute('href', { timeout: 200 });
                if (href && href.startsWith('tel:')) { phone = href.replace('tel:', '').trim(); break; }
            } catch {}
        }

        // Website
        let website = null;
        for (const sel of SELECTORS.detailWebsite) {
            try {
                const links = page.locator(sel);
                const count = await links.count();
                for (let i = 0; i < count; i++) {
                    const a = links.nth(i);
                    const href = (await a.getAttribute('href')) || '';
                    if (!href) continue;
                    if (/bioladen\.de/i.test(href)) continue;
                    if (/facebook|instagram|twitter|tiktok|youtube/i.test(href)) continue;
                    website = href;
                    break;
                }
                if (website) break;
            } catch {}
        }

        return {
            name: name || null,
            street: street || null,
            zip: zip || null,
            city: city || null,
            phone: phone || null,
            website: website || null,
            source_url: url || null,
        };
    }

    async function collectDetailLinks(page) {
        // Try to gather detail links from results
        for (const sel of SELECTORS.resultCards) {
            const els = page.locator(sel);
            const n = await els.count().catch(() => 0);
            if (n > 0) {
                const hrefs = [];
                for (let i = 0; i < n; i++) {
                    const a = els.nth(i);
                    const href = await a.getAttribute('href').catch(() => null);
                    if (href && /^https?:\/\//i.test(href)) hrefs.push(href);
                    else if (href && href.startsWith('/')) hrefs.push(new URL(href, START_URL).toString());
                }
                // Deduplicate
                return [...new Set(hrefs)];
            }
        }
        return [];
    }

    async function runForZip(browser, zip) {
        const ctx = await browser.newContext();
        const page = await ctx.newPage();

        // Cookie silence
        page.on('dialog', d => d.dismiss().catch(() => {}));

        await page.goto(START_URL, { waitUntil: 'domcontentloaded', timeout: 30000 });

        // Try to accept cookies quickly
        const cookieBtns = page.locator('button:has-text("Akzeptieren"), button:has-text("Einverstanden"), button:has-text("Alle akzeptieren")');
        try { await cookieBtns.first().click({ timeout: 2000 }); } catch {}

        // Search
        await setZipAndSearch(page, zip);

        // Collect links
        const links = await collectDetailLinks(page);

        const out = [];
        for (const link of links) {
            try {
                const p2 = await ctx.newPage();
                await p2.goto(link, { waitUntil: 'domcontentloaded', timeout: 30000 });
                const item = await extractDetail(p2);
                item.query_zip = String(zip);
                out.push(item);
                await p2.close();
            } catch (e) {
                log.warning(`Detail fehlgeschlagen (${link}): ${e.message}`);
            }
        }

        await ctx.close();
        return out;
    }

    function readPlzList() {
        const p = path.join(process.cwd(), 'plz_full.json');
        if (!fs.existsSync(p)) {
            log.error('plz_full.json nicht gefunden!');
            return [];
        }
        try {
            const raw = JSON.parse(fs.readFileSync(p, 'utf-8'));
            // Accept array of strings/numbers or object with property
            const arr = Array.isArray(raw) ? raw : raw?.plz || [];
            return arr.map(String);
        } catch (e) {
            log.error(`plz_full.json konnte nicht gelesen werden: ${e.message}`);
            return [];
        }
    }

    (async () => {
        await Actor.init();
        const input = await Actor.getInput() || {};
        const { maxZips = 200, headless = true } = input;

        const allPlz = readPlzList();
        if (allPlz.length === 0) {
            log.error('Keine PLZ geladen – Abbruch.');
            await Actor.exit();
            return;
        }

        log.info(`Starte mit ${allPlz.length} PLZ...`);

        const browser = await chromium.launch({ headless });
        let total = 0;

        for (let i = 0; i < allPlz.length; i++) {
            const zip = allPlz[i];
            log.info(`=== ${i + 1}/${allPlz.length} | PLZ ${zip} ===`);
            const items = await runForZip(browser, zip);
            if (items.length) {
                for (const it of items) await Dataset.pushData(it);
                total += items.length;
                log.info(`PLZ ${zip}: ${items.length} Datensätze gespeichert`);
            } else {
                log.info(`PLZ ${zip}: keine Datensätze gefunden`);
            }

            // Soft throttle
            await Actor.sleep(250);
        }

        await browser.close();
        log.info(`Fertig. Insgesamt gespeichert: ${total}`);
        await Actor.exit();
    })();
