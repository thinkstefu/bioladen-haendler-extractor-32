'use strict';

// CommonJS only. No ESM, no top-level awaits.
const Apify = require('apify');
const { chromium } = require('playwright');
const fs = require('fs');
const path = require('path');

function sleep(ms) { return new Promise(res => setTimeout(res, ms)); }

function normalizePlzList(raw) {
  // Accepts: array of strings OR array of objects with { plz } OR any structure containing 5-digit patterns.
  const out = new Set();
  const push = (s) => {
    const m = String(s).match(/\b\d{5}\b/g);
    if (m) m.forEach(z => out.add(z));
  };
  if (Array.isArray(raw)) {
    for (const item of raw) {
      if (typeof item === 'string' || typeof item === 'number') push(item);
      else if (item && typeof item === 'object') {
        for (const v of Object.values(item)) push(v);
      }
    }
  } else if (raw && typeof raw === 'object') {
    for (const v of Object.values(raw)) push(v);
  }
  return Array.from(out);
}

async function acceptCookies(page) {
  const selectors = [
    'button:has-text("Alle akzeptieren")',
    'button:has-text("Akzeptieren")',
    'button:has-text("Zustimmen")',
    'button[aria-label="Alle akzeptieren"]',
    '[data-accept*="all"]',
  ];
  for (const sel of selectors) {
    try {
      const btn = await page.$(sel);
      if (btn) {
        await btn.click({ timeout: 2000 });
        await sleep(300);
        break;
      }
    } catch {}
  }
}

async function gotoSearch(context) {
  const page = await context.newPage();
  await page.goto('https://www.bioladen.de/bio-haendler-suche', { waitUntil: 'domcontentloaded', timeout: 45000 });
  await acceptCookies(page);
  return page;
}

async function setZipAndRadius(page, zip) {
  // Try UI first
  const zipSelectors = [
    'input[name*="zip"]',
    'input[placeholder*="PLZ"]',
    'input[aria-label*="PLZ"]',
    'input[type="search"]',
    '#tx_stores_locator_zip',
  ];
  let zipField = null;
  for (const sel of zipSelectors) {
    try {
      zipField = await page.waitForSelector(sel, { timeout: 1500 });
      if (zipField) break;
    } catch {}
  }
  if (zipField) {
    await zipField.fill('');
    await zipField.type(String(zip), { delay: 10 });
    // radius: try a select or a button/aria listbox pattern
    let radiusSet = false;
    const select = await page.$('select[name*="distance"], select#tx_stores_locator_distance');
    if (select) {
      try {
        await select.selectOption({ label: '50 km' }).catch(async () => {
          await select.selectOption('50').catch(() => {});
        });
        radiusSet = true;
      } catch {}
    } else {
      // Try clicking a dropdown that opens a list
      try {
        const dd = await page.$('[role="combobox"], button[aria-haspopup="listbox"], .selectric');
        if (dd) {
          await dd.click();
          const opt = await page.waitForSelector('text=/^\\s*50\\s*km\\s*$/i', { timeout: 1500 }).catch(() => null);
          if (opt) { await opt.click(); radiusSet = true; }
        }
      } catch {}
    }
    // Click search
    const searchBtn = await page.$('form button[type="submit"], button:has-text("Suchen"), [aria-label*="Suchen"]');
    if (searchBtn) {
      await Promise.all([
        page.waitForLoadState('networkidle', { timeout: 45000 }).catch(() => {}),
        searchBtn.click()
      ]);
    } else {
      // Hit Enter in the field
      await zipField.press('Enter');
      await page.waitForLoadState('networkidle', { timeout: 45000 }).catch(() => {});
    }
    return { via: 'ui', radiusSet };
  }

  // Fallback: URL with query params (may not always return full set but better than nothing)
  const url = `https://www.bioladen.de/bio-haendler-suche?tx_stores_locator%5Bzip%5D=${encodeURIComponent(zip)}&tx_stores_locator%5Bdistance%5D=50`;
  await page.goto(url, { waitUntil: 'networkidle', timeout: 45000 });
  return { via: 'url', radiusSet: true };
}

async function getDetailLinks(page) {
  // Try to find "Details" buttons or explicit card links
  const detailLinkSelectors = [
    'a:has-text("Details")',
    'button:has-text("Details")',
    'a[href*="/bio-haendler-suche/"]:has-text("Details")',
  ];
  let links = [];
  for (const sel of detailLinkSelectors) {
    const found = await page.$$eval(sel, els => els.map(e => e.href).filter(Boolean)).catch(() => []);
    if (found.length) links = links.concat(found);
  }
  // If no "Details" links: try cards that link to dealer pages
  if (links.length === 0) {
    const cardAnchors = await page.$$eval('a', els => els.map(e => e.href).filter(h => h && /bio-haendler-suche/.test(h))).catch(() => []);
    links = links.concat(cardAnchors);
  }
  // De-dup & keep only plausible detail pages
  const uniq = Array.from(new Set(links)).filter(h => /^https?:\/\//.test(h));
  return uniq;
}

function textOrNull(s) {
  if (!s) return null;
  const t = s.toString().trim();
  return t.length ? t : null;
}

function extractAddressBlock(text) {
  if (!text) return { street: null, zip: null, city: null };
  const t = text.replace(/\s+/g, ' ').trim();
  // naive split: look for 5-digit zip
  const m = t.match(/\b(\d{5})\b/);
  let street = null, zip = null, city = null;
  if (m) {
    zip = m[1];
    const [left, right] = [t.slice(0, m.index).trim(), t.slice(m.index + m[0].length).trim()];
    street = left.replace(/^\W+|\W+$/g, '') || null;
    city = right.replace(/^\W+|\W+$/g, '') || null;
  }
  return { street, zip, city };
}

async function scrapeDetail(context, url) {
  const page = await context.newPage();
  try {
    await page.goto(url, { waitUntil: 'domcontentloaded', timeout: 45000 });
    // Name
    const name = await page.locator('h1, h2, .store-name, [class*="name"]').first().textContent().catch(() => null);
    // Address block
    let addrText = await page.locator('address').first().textContent().catch(() => null);
    if (!addrText) addrText = await page.locator('[itemprop="address"]').first().textContent().catch(() => null);
    // Fallback: grab a block that looks like address
    if (!addrText) {
      addrText = await page.locator('section, .content, .tx-stores').first().textContent().catch(() => null);
    }
    const { street, zip, city } = extractAddressBlock(addrText || '');
    // Phone
    const phone = await page.getAttribute('a[href^="tel:"]', 'href').catch(() => null);
    const phoneClean = phone ? phone.replace(/^tel:/, '') : null;
    // Website
    const links = await page.$$eval('a[href^="http"]', els => els.map(e => e.href).filter(Boolean)).catch(() => []);
    // Prefer non-bioladen external sites
    let website = null;
    for (const h of links) {
      if (!/bioladen\.de/.test(h)) { website = h; break; }
    }
    // Category (Bioladen / Marktstand / Lieferservice) – look for badges or text
    const pageTxt = (await page.content()).replace(/<[^>]+>/g, ' ');
    let category = null;
    if (/Marktstand/i.test(pageTxt)) category = 'Marktstand';
    else if (/Lieferservice/i.test(pageTxt)) category = 'Lieferservice';
    else category = 'Bioladen';

    return {
      name: textOrNull(name),
      street,
      zip: textOrNull(zip),
      city: textOrNull(city),
      phone: textOrNull(phoneClean),
      website: textOrNull(website),
      category: textOrNull(category),
      sourceUrl: url
    };
  } catch (e) {
    return {
      name: null, street: null, zip: null, city: null,
      phone: null, website: null, category: null, sourceUrl: url, error: String(e && e.message || e)
    };
  } finally {
    await page.close().catch(() => {});
  }
}

Apify.main(async () => {
  // Read PLZ list
  let raw = [];
  try {
    const pth = path.join(__dirname, 'plz_full.json');
    raw = JSON.parse(fs.readFileSync(pth, 'utf-8'));
  } catch (e) {
    console.log('WARN: plz_full.json konnte nicht gelesen werden, benutze Fallback.');
    raw = ["20095","80331","50667","60311","70173"];
  }
  const zips = normalizePlzList(raw);
  console.log(`INFO  PLZ geladen: ${zips.length}`);

  const browser = await chromium.launch({ headless: true, args: ['--no-sandbox','--disable-dev-shm-usage'] });
  const context = await browser.newContext();

  let total = 0;
  for (let idx = 0; idx < zips.length; idx++) {
    const zip = zips[idx];
    const page = await gotoSearch(context);
    console.log(`INFO  === ${idx+1}/${zips.length} | PLZ ${zip} ===`);
    const mode = await setZipAndRadius(page, zip);
    console.log(`INFO  Suche via: ${mode.via}, Radius gesetzt: ${mode.radiusSet}`);

    // Wait for results to render and gather detail links
    await page.waitForTimeout(1000);
    let links = await getDetailLinks(page);
    console.log(`INFO  Details-Links: ${links.length}`);

    // If nothing found, try a gentle reload (UI can be flaky)
    if (links.length === 0) {
      await page.waitForTimeout(1500);
      links = await getDetailLinks(page);
      console.log(`INFO  Details-Links (2. Versuch): ${links.length}`);
    }

    await page.close().catch(() => {});

    for (const href of links) {
      const item = await scrapeDetail(context, href);
      await Apify.pushData({
        zip,
        ...item
      });
      total++;
    }
  }

  await context.close();
  await browser.close();
  console.log(`INFO  Fertig. Insgesamt gespeichert: ${total}`);
});
