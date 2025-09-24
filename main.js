import { Actor, log } from 'apify';
import { chromium } from 'playwright';
import fs from 'node:fs/promises';
import path from 'node:path';

const BASE_URL = 'https://www.bioladen.de/bio-haendler-suche';

async function acceptCookies(page) {
  const selectors = [
    '#onetrust-accept-btn-handler',
    'button:has-text("Alle akzeptieren")',
    'button:has-text("Akzeptieren")',
    'button[aria-label*="kzept"]',
    '.cm-button--save',
    '.cookie-accept',
  ];
  for (const sel of selectors) {
    try {
      const el = page.locator(sel).first();
      if (await el.count()) {
        await el.click({ timeout: 2000 });
        log.info('Cookie-Banner akzeptiert.');
        return;
      }
    } catch {}
  }
}

async function setZipUI(page, zip) {
  // Versuche mehrere mögliche Felder
  const candidates = [
    'input[placeholder*="PLZ"]',
    'input[name*="zip"]',
    'input[type="search"]',
    'input[placeholder*="Ort"]',
  ];
  for (const sel of candidates) {
    const inp = page.locator(sel).first();
    if (await inp.count()) {
      await inp.fill('');
      await inp.type(String(zip), { delay: 50 });
      await inp.press('Enter').catch(() => {});
      await page.waitForTimeout(1200);
      return true;
    }
  }
  return false;
}

async function getDetailButtons(page) {
  // Suche nach Links/Buttons, die zu Detailseiten führen
  const sel = 'a:has-text("Details"), button:has-text("Details"), a:has-text("Mehr"), button:has-text("Mehr")';
  const items = page.locator(sel);
  return items;
}

function cleanupText(s) {
  if (!s) return null;
  const t = s.replace(/\s+/g, ' ').trim();
  return t || null;
}

function parseAddress(raw) {
  if (!raw) return { street: null, postalCode: null, city: null };
  const lines = raw.split(/\n|<br\s*\/?>/i).map(x => x.trim()).filter(Boolean);
  let street = null, postalCode = null, city = null;

  // Heuristik: letzte oder vorletzte Zeile enthält "12345 Stadt"
  for (const line of [...lines].reverse()) {
    const m = line.match(/(\d{5})\s+(.+)/);
    if (m) {
      postalCode = m[1];
      city = m[2].replace(/[,;]+\s*$/, '').trim();
      break;
    }
  }
  // Straße = erste Zeile, die keine PLZ enthält
  for (const line of lines) {
    if (!/(\d{5})\s+/.test(line) && !/\bDeutschland\b/i.test(line)) {
      street = line;
      break;
    }
  }
  return { street: cleanupText(street), postalCode: cleanupText(postalCode), city: cleanupText(city) };
}

async function extractDetail(page, zip) {
  // Name
  let name = await page.locator('h1').first().textContent().catch(() => null);
  if (!name) name = await page.locator('h2').first().textContent().catch(() => null);
  name = cleanupText(name);

  // Typ (Chips / Badges)
  let type = null;
  const typeSel = page.locator('text=Bioladen, text=Marktstand, text=Lieferservice');
  if (await typeSel.count()) {
    type = cleanupText(await typeSel.first().textContent().catch(() => null));
  } else {
    // Fallback: suche im gesamten Text nach bekannten Schlagworten
    const bodyText = await page.locator('body').innerText().catch(() => '');
    if (/Marktstand/i.test(bodyText)) type = 'Marktstand';
    else if (/Lieferservice/i.test(bodyText)) type = 'Lieferservice';
    else if (/Bioladen/i.test(bodyText)) type = 'Bioladen';
  }

  // Adresse
  let addrHtml = await page.locator('address').first().innerHTML().catch(() => null);
  if (!addrHtml) {
    // Fallback: ein Container mit "Adresse"
    const addrBox = page.locator(':text("Adresse")').first();
    if (await addrBox.count()) {
      addrHtml = await addrBox.locator('..').innerHTML().catch(() => null);
    }
  }
  const { street, postalCode, city } = parseAddress(addrHtml?.replace(/<[^>]+>/g, '\n') ?? null);

  // Telefon
  let phone = await page.locator('a[href^="tel:"]').first().getAttribute('href').catch(() => null);
  if (phone) phone = phone.replace(/^tel:/, '').trim();
  else phone = null;

  // Website (erste externe URL)
  let website = null;
  const links = await page.locator('a[href^="http"]').all();
  for (const a of links) {
    const href = await a.getAttribute('href').catch(() => null);
    if (href && !/bioladen\.de/i.test(href)) { website = href; break; }
  }

  // Öffnungszeiten - block mit "Öffnungszeiten" aufsammeln
  let openingHours = null;
  const ohBlock = page.locator(':text("Öffnungszeiten")').first();
  if (await ohBlock.count()) {
    const parent = ohBlock.locator('..');
    const txt = await parent.innerText().catch(() => null);
    if (txt) {
      // entferne label
      openingHours = cleanupText(txt.replace(/Öffnungszeiten\s*/i, ''));
    }
  } else {
    // Fallback: suche pattern von Wochentagen
    const txt = await page.locator('body').innerText().catch(() => '');
    const match = txt.match(/(Mo|Montag)[\s\S]{0,200}?(So|Sonntag)[\s\S]{0,200}/i);
    if (match) openingHours = cleanupText(match[0]);
  }

  const result = {
    zip: String(zip),
    name: name ?? null,
    type: type ?? null,
    street,
    postalCode,
    city,
    phone,
    website,
    openingHours,
    sourceUrl: page.url(),
    scrapedAt: new Date().toISOString()
  };
  return result;
}

async function searchAndExtractForZip(page, zip) {
  await page.goto(BASE_URL, { waitUntil: 'domcontentloaded', timeout: 45000 });
  await acceptCookies(page);
  await setZipUI(page, zip).catch(() => {});

  // Warte kurz auf Ergebnisse
  await page.waitForTimeout(1500);

  const buttons = await getDetailButtons(page);
  const count = await buttons.count();
  log.info(`DETAILS buttons: ${count}`);

  let saved = 0;
  for (let i = 0; i < count; i++) {
    const btn = buttons.nth(i);
    // Versuche neuen Tab abzufangen; sonst Same-Tab
    const [newPage] = await Promise.all([
      page.context().waitForEvent('page', { timeout: 3000 }).catch(() => null),
      btn.click().catch(() => null),
    ]);
    const dPage = newPage || page;
    await dPage.waitForLoadState('domcontentloaded', { timeout: 15000 }).catch(() => {});

    // Wenn nix geladen, überspringen
    if (!dPage.url() || dPage.url() === page.url()) {
      // evtl. Inline-Expand? Dann die nächstbeste Link-Strategie probieren
      // Suche in der Nähe des Buttons einen Anker
      // (vereinfachter Fallback – im Zweifel überspringen wir)
    }

    try {
      const rec = await extractDetail(dPage, zip);
      await Actor.pushData(rec);
      saved += 1;
    } catch (e) {
      log.warning(`Detail-Extraktion fehlgeschlagen: ${e?.message || e}`);
    }

    if (newPage) {
      await newPage.close().catch(() => {});
    } else {
      await page.goBack({ waitUntil: 'domcontentloaded' }).catch(async () => {
        await page.goto(BASE_URL, { waitUntil: 'domcontentloaded' });
        await setZipUI(page, zip).catch(() => {});
      });
    }

    // Mini-Pause, um UI Zeit zu geben
    await page.waitForTimeout(150);
  }
  log.info(`PLZ ${zip}: ${saved} neue Datensätze gespeichert`);
}

await Actor.main(async () => {
  log.setLevel(log.LEVELS.INFO);
  const browser = await chromium.launch({
    headless: true,
    args: ['--no-sandbox', '--disable-dev-shm-usage']
  });
  const context = await browser.newContext();
  const page = await context.newPage();

  // PLZ-Liste laden
  let plzList = [];
  try {
    const raw = await fs.readFile(path.resolve('plz_full.json'), 'utf8');
    const parsed = JSON.parse(raw);
    plzList = parsed.filter(Boolean).map(x => String(x).trim()).filter(Boolean);
  } catch (e) {
    log.error('Konnte plz_full.json nicht lesen – breche ab.');
    throw e;
  }

  log.info(`PLZ in Lauf: ${plzList.length} (aus plz_full.json)`);

  let idx = 0;
  for (const zip of plzList) {
    idx += 1;
    log.info(`=== ${idx}/${plzList.length} | PLZ ${zip} ===`);
    try {
      await searchAndExtractForZip(page, zip);
    } catch (e) {
      log.warning(`PLZ ${zip}: Fehler im Lauf – ${e?.message || e}`);
    }
  }

  await browser.close();
  log.info('Fertig.');
});
