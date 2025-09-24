\
/**
 * Small helpers for waits and extraction.
 */
const delay = (ms) => new Promise(res => setTimeout(res, ms));

async function safeClick(page, selectorOrLocator, timeout = 4000) {
    try {
        const loc = typeof selectorOrLocator === 'string' ? page.locator(selectorOrLocator) : selectorOrLocator;
        await loc.first().click({ timeout });
        return true;
    } catch { return false; }
}

async function acceptCookies(page) {
    const candidates = [
        'button:has-text("Akzeptieren")',
        'button:has-text("Einverstanden")',
        'button:has-text("Alle akzeptieren")',
        'button:has-text("OK")',
        'button[aria-label*="akzept"]',
        '[data-testid*="accept"] button',
    ];
    for (const sel of candidates) {
        if (await page.locator(sel).first().isVisible({ timeout: 0 }).catch(() => false)) {
            if (await safeClick(page, sel, 2000)) return true;
        }
    }
    return false;
}

async function loadAllResults(page) {
    // Scroll & "mehr" button handling until no new cards appear.
    let lastCount = -1;
    for (let i = 0; i < 30; i++) {
        const details = await page.locator('a:has-text("DETAILS")');
        const count = await details.count();
        if (count === lastCount) {
            // Try clicking a possible "mehr" button
            const moreSel = 'button:has-text("mehr")';
            const hadMore = await safeClick(page, moreSel, 2000);
            if (!hadMore) break;
            await delay(1200);
        } else {
            lastCount = count;
            await page.evaluate(() => window.scrollTo(0, document.body.scrollHeight));
            await delay(800);
        }
    }
    return await page.locator('a:has-text("DETAILS")').count();
}

function normalizeZip(z) {
    const s = String(z).trim();
    const m = s.match(/\d{5}/);
    return m ? m[0] : null;
}

function uniq(arr) {
    return [...new Set(arr)];
}

module.exports = { delay, safeClick, acceptCookies, loadAllResults, normalizeZip, uniq };
