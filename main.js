
const Apify = require('apify');
const { chromium } = require('playwright');
const { sleep, normText, parseAddress, unique } = require('./utils');

const BASE_URL = 'https://www.bioladen.de/bio-haendler-suche';

// Robust selector helpers
const SEL = {
  cookieAccept: 'button:has-text("Akzeptieren"), button:has-text("Alle akzeptieren"), button[aria-label*="akzept"], #uc-btn-accept-all',
  zipInput: 'input[placeholder*="Postleitzahl"], input[placeholder*="Postleitzahl/Ort"], input[name*="zip"]',
  radiusSelect: 'select:has(+ *:text("km")), select',
  searchBtn: 'button:has-text("BIO-HÄNDLER FINDEN"), button[type="submit"]:has-text("HÄNDLER FINDEN")',
  resultCard: '.splashshopfinder__entry, .dealerlist__item, .tx-splashshopfinder .entry, .teaser--result',
  detailsBtn: 'a:has-text("DETAILS")',
  loadMore: 'button:has-text("mehr"), a:has-text("mehr")',
};

function ensureNulls(obj, keys) {
  const out = {};
  for (const k of keys) out[k] = (obj && (obj[k] !== undefined)) ? (obj[k] ?? null) : null;
  return out;
}

async function clickCookie(page, log) {
  try {
    await page.waitForTimeout(1500);
    const btn = await page.$(SEL.cookieAccept);
    if (btn) { await btn.click({ timeout: 0 }); log.info('Cookie-Banner akzeptiert.'); }
  } catch { /* ignore */ }
}

async function setZipAndRadius(page, zip, radiusKm, log) {
  // Set ZIP in UI when possible
  let zipSet = false;
  try {
    await page.waitForSelector(SEL.zipInput, { timeout: 10000 });
    await page.fill(SEL.zipInput, '');
    await page.fill(SEL.zipInput, String(zip));
    zipSet = true;
  } catch {
    log.warning('PLZ-Feld nicht gefunden – UI-Setzen übersprungen.');
  }

  // Set radius via UI (best effort)
  try {
    const sel = await page.$(SEL.radiusSelect);
    if (sel) {
      await sel.selectOption({ label: /50\s*km/i });
    }
  } catch { /* ignore */ }

  // Click search to force list refresh
  try {
    const btn = await page.$(SEL.searchBtn);
    if (btn) await Promise.all([page.waitForLoadState('domcontentloaded'), btn.click()]);
  } catch { /* ignore */ }

  // As a safety, navigate with params (server will honor them)
  if (!zipSet) {
    const url = new URL(BASE_URL);
    url.searchParams.set('tx_splashshopfinder_shopfinder[search][location]', String(zip));
    url.searchParams.set('tx_splashshopfinder_shopfinder[search][radius]', String(radiusKm));
    await page.goto(url.toString(), { waitUntil: 'domcontentloaded' });
  }

  // Give results time to render
  await page.waitForLoadState('networkidle').catch(()=>{});
  await page.waitForTimeout(1500);
}

async function loadAllResults(page, log) {
  // Repeatedly scroll and click "mehr" until count stabilizes
  let prev = 0;
  let stable = 0;
  for (let i = 0; i < 25; i++) {
    const count = await page.$$eval(SEL.detailsBtn, els => els.length).catch(()=>0);
    if (count === prev) stable++; else stable = 0;
    prev = count;
    if (stable >= 3) break;
    // click load more if present
    const more = await page.$(SEL.loadMore);
    if (more) {
      await more.click().catch(()=>{});
      await page.waitForTimeout(1200);
    }
    await page.evaluate(async () => {
      await new Promise(res => {
        let total = 0;
        const id = setInterval(() => {
          window.scrollBy(0, 1200);
          total += 1200;
          if (total > document.body.scrollHeight * 1.2) { clearInterval(id); res(); }
        }, 80);
      });
    }).catch(()=>{});
    await page.waitForTimeout(900);
  }
  const finalCount = await page.$$eval(SEL.detailsBtn, els => els.length).catch(()=>0);
  return finalCount;
}

async function extractFromDetails(context, url, zip) {
  const page = await context.newPage();
  const keys = ['email','kategorie','name','ort','plz','quelle_plz','strasse','telefon','webseite'];
  const base = ensureNulls({}, keys);
  base.quelle_plz = String(zip);
  try {
    await page.goto(url, { waitUntil: 'domcontentloaded', timeout: 45000 });
    await page.waitForLoadState('networkidle').catch(()=>{});
    // Name
    const name = normText(await page.textContent('h1, h2').catch(()=>null));
    base.name = name;

    // Email / Telefon / Webseite
    const hrefs = await page.$$eval('a[href]', as => as.map(a => a.getAttribute('href'))).catch(()=>[]);
    const mail = hrefs.find(h => h && h.startsWith('mailto:'));
    base.email = mail ? mail.replace(/^mailto:/,'').split('?')[0] : null;
    const tel = hrefs.find(h => h && h.startsWith('tel:'));
    base.telefon = tel ? tel.replace(/^tel:/,'') : null;
    const site = hrefs.find(h => h && /^https?:\/\//i.test(h) && !/bioladen\.de/.test(h));
    base.webseite = site || null;

    // Address: try a few common blocks
    let addrText = await page.textContent('[class*="address"], .address, .dealer__address, .shop__address, .contact, .kontakt, .adresse').catch(()=>null);
    if (!addrText) {
      // sometimes in meta / structured data
      const raw = await page.content();
      const m = raw && raw.match(/(\d{5})\s+[A-Za-zÄÖÜäöüß\-\.\s]+/);
      if (m) addrText = m[0];
    }
    const parsed = parseAddress(addrText || '');
    base.strasse = parsed.strasse;
    base.plz = parsed.plz;
    base.ort = parsed.ort;

    // Kategorie heuristics
    let cat = await page.textContent('[class*="category"], .category, .kategorie, .type').catch(()=>null);
    if (!cat) {
      const html = await page.content();
      if (/marktstand/i.test(html)) cat = 'Marktstand';
      else if (/liefer/i.test(html)) cat = 'Lieferservice';
      else cat = 'Bioladen';
    }
    base.kategorie = normText(cat);

  } catch (e) {
    base.error = String(e && e.message || e);
  } finally {
    await page.close().catch(()=>{});
  }
  return base;
}

Apify.main(async () => {
  const input = await Apify.getInput() || {};
  const radiusKm = Number(input.radiusKm || 50);
  const startAt = Number(input.startIndex || 0);
  const limit = input.limit ? Number(input.limit) : null;

  // Load PLZ list
  let plzList = input.plzList || null;
  if (!plzList) {
    try {
      const fs = require('fs');
      plzList = JSON.parse(fs.readFileSync('plz_full.json', 'utf-8'));
    } catch (e) {
      throw new Error('Konnte plz_full.json nicht lesen. Lege die Datei ins Projekt oder übergebe plzList im Input.');
    }
  }
  if (!Array.isArray(plzList)) throw new Error('plzList muss ein Array sein.');

  // Browser
  const browser = await chromium.launch({
    headless: true,
    args: ['--no-sandbox', '--disable-dev-shm-usage'],
  });
  const context = await browser.newContext({
    userAgent: 'Mozilla/5.0 (X11; Linux x86_64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/119 Safari/537.36 ApifyBot',
    viewport: { width: 1280, height: 900 },
  });
  const page = await context.newPage();

  // Iterate ZIPs
  let processed = 0;
  for (let idx = startAt; idx < plzList.length; idx++) {
    const zip = String(plzList[idx]).padStart(5, '0');
    if (limit && processed >= limit) break;

    Apify.utils.log.info(`=== ${idx+1}/${plzList.length} | PLZ ${zip} ===`);
    await page.goto(BASE_URL, { waitUntil: 'domcontentloaded', timeout: 45000 });
    await page.waitForLoadState('networkidle').catch(()=>{});
    await clickCookie(page, Apify.utils.log);

    await setZipAndRadius(page, zip, radiusKm, Apify.utils.log);
    const count = await loadAllResults(page, Apify.utils.log);
    Apify.utils.log.info(`DETAILS buttons: ${count}`);

    const detailUrls = await page.$$eval(SEL.detailsBtn, as => as.map(a => a.href)).catch(()=>[]);
    const urls = unique(detailUrls);
    let saved = 0;
    for (let i = 0; i < urls.length; i++) {
      const data = await extractFromDetails(context, urls[i], zip);
      // Ensure all fields exist
      const out = {
        email: data.email ?? null,
        kategorie: data.kategorie ?? null,
        name: data.name ?? null,
        ort: data.ort ?? null,
        plz: data.plz ?? null,
        quelle_plz: data.quelle_plz ?? String(zip),
        strasse: data.strasse ?? null,
        telefon: data.telefon ?? null,
        webseite: data.webseite ?? null,
        source_url: urls[i]
      };
      await Apify.pushData(out);
      saved++;
    }
    Apify.utils.log.info(`PLZ ${zip}: ${saved} neue Datensätze gespeichert`);
    processed++;
  }

  await browser.close().catch(()=>{});
  Apify.utils.log.info('Fertig.');
});
