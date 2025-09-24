'use strict';

const Apify = require('apify');
const { chromium } = require('playwright');
const fs = require('fs');
const path = require('path');
const {
  wait,
  acceptCookies,
  autoScroll,
  setZipAndRadius,
  getDetailsButtons,
} = require('./utils');

/**
 * Fields for dataset, normalize to null when missing.
 */
function normalize(record) {
  const out = {
    email: null,
    kategorie: null,
    name: null,
    ort: null,
    plz: null,
    quelle_plz: null,
    strasse: null,
    telefon: null,
    webseite: null,
    source_url: null,
  };
  for (const k of Object.keys(out)) {
    if (record[k] === undefined) continue;
    const v = record[k];
    out[k] = (v === undefined || v === '') ? null : v;
  }
  return out;
}

/** Extract shop info from a detail page with robust fallbacks. */
async function scrapeDetail(page, sourceUrl, quellePlz) {
  const text = await page.evaluate(() => document.body.innerText || '');

  async function firstText(selectors) {
    for (const sel of selectors) {
      const el = page.locator(sel).first();
      if (await el.count()) {
        const v = (await el.innerText()).trim();
        if (v) return v;
      }
    }
    return null;
  }

  const name = await firstText(['h1', 'article h1', '.entry-title', 'header h1']);
  const street = await firstText(['[itemprop="streetAddress"]', 'address .street', 'address span[class*=street]', 'address']);
  let postalCode = await firstText(['[itemprop="postalCode"]', 'address .postal', 'address span[class*=zip]']);
  let city = await firstText(['[itemprop="addressLocality"]', 'address .city', 'address span[class*=city]']);

  if (!postalCode || !city) {
    // Try to parse a "12345 City" pattern from visible text
    const m = text.match(/(\d{5})\s+([A-Za-zÄÖÜäöüß\-\s]+)/);
    if (m) {
      postalCode = postalCode || m[1];
      city = city || m[2].trim();
    }
  }

  // Contact links
  let telefon = null, email = null, webseite = null;
  try {
    const telLink = page.locator('a[href^="tel:"]').first();
    if (await telLink.count()) telefon = (await telLink.getAttribute('href')).replace('tel:', '').trim();
  } catch {}
  try {
    const mailLink = page.locator('a[href^="mailto:"]').first();
    if (await mailLink.count()) email = (await mailLink.getAttribute('href')).replace('mailto:', '').trim();
  } catch {}
  try {
    // Prefer explicit "Webseite" link; otherwise first external link not to bioladen.de
    const webBtn = page.locator('a:has-text("Webseite"), a:has-text("Website"), a:has-text("Zur Website")').first();
    if (await webBtn.count()) {
      webseite = await webBtn.getAttribute('href');
    } else {
      const links = page.locator('a[href^="http"]');
      const n = await links.count();
      for (let i = 0; i < n; i++) {
        const href = await links.nth(i).getAttribute('href');
        if (href && !/bioladen\.de/i.test(href)) {
          webseite = href;
          break;
        }
      }
    }
  } catch {}

  // Category best-effort
  let kategorie = null;
  try {
    const catBadge = page.locator('text=/Bioläden|Marktstände|Lieferservice/i').first();
    if (await catBadge.count()) {
      kategorie = (await catBadge.innerText()).trim();
    }
  } catch {}

  const record = normalize({
    email,
    kategorie,
    name,
    ort: city || null,
    plz: postalCode || null,
    quelle_plz: String(quellePlz),
    strasse: street || null,
    telefon,
    webseite,
    source_url: sourceUrl,
  });
  return record;
}

Apify.main(async () => {
  const input = (await Apify.getInput()) || {};
  const baseUrl = input.baseUrl || 'https://www.bioladen.de/bio-haendler-suche';
  const radiusKm = Number(input.radiusKm || 25); // rollback used 25 km
  const limit = input.limit ? Number(input.limit) : null;

  const plzPath = path.join(__dirname, 'plz_full.json');
  const raw = fs.readFileSync(plzPath, 'utf-8');
  let plzList = JSON.parse(raw);
  plzList = plzList.map(String);
  if (limit) plzList = plzList.slice(0, limit);

  const browser = await chromium.launch({
    headless: true,
    args: ['--disable-dev-shm-usage', '--no-sandbox'],
  });
  const context = await browser.newContext();
  const page = await context.newPage();

  Apify.utils.log.info(`PLZ in Lauf: ${plzList.length} (aus plz_full.json)`);

  for (let idx = 0; idx < plzList.length; idx++) {
    const plz = plzList[idx];
    Apify.utils.log.info(`=== ${idx + 1}/${plzList.length} | PLZ ${plz} ===`);

    await page.goto(baseUrl, { waitUntil: 'domcontentloaded' });
    const accepted = await acceptCookies(page);
    if (accepted) Apify.utils.log.info('Cookie-Banner akzeptiert.');

    const setRes = await setZipAndRadius({ page, baseUrl, plz, radiusKm });
    if (setRes.via === 'url') {
      Apify.utils.log.info(`Radius auf ${radiusKm} km gesetzt (URL-Fallback).`);
    }

    await autoScroll(page, 800, 3000);

    // Let results load
    await page.waitForTimeout(800);
    const { buttons, count } = await getDetailsButtons(page);
    // Try to also estimate visible result cards
    const resultCards = await page.locator('article, .result, .shop, .teaser, li').filter({ hasText: /DETAILS/i }).count().catch(() => 0);
    Apify.utils.log.info(`DETAILS buttons: ${count} | Result-Cards: ${resultCards}`);

    let saved = 0;
    for (let i = 0; i < count; i++) {
      const btn = page.locator('a, button').filter({ hasText: /^DETAILS$/i }).nth(i);
      try {
        await Promise.all([
          page.waitForNavigation({ waitUntil: 'domcontentloaded', timeout: 15000 }).catch(() => {}),
          btn.click(),
        ]);
      } catch {}
      await page.waitForLoadState('networkidle', { timeout: 10000 }).catch(() => {});
      const record = await scrapeDetail(page, page.url(), plz);
      await Apify.pushData(record);
      saved++;
      // Go back to list
      try {
        await Promise.all([
          page.waitForNavigation({ waitUntil: 'domcontentloaded', timeout: 15000 }).catch(() => {}),
          page.goBack(),
        ]);
      } catch {}
      await page.waitForLoadState('networkidle', { timeout: 10000 }).catch(() => {});
    }

    Apify.utils.log.info(`PLZ ${plz}: ${saved} neue Datensätze gespeichert`);
  }

  await browser.close();
  Apify.utils.log.info('Fertig.');
});
