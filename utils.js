'use strict';

/**
 * Small helpers to keep main.js clean.
 */
const wait = (ms) => new Promise(res => setTimeout(res, ms));

/** Try to click any cookie accept button. */
async function acceptCookies(page) {
  const candidates = [
    'button:has-text("Alle akzeptieren")',
    'button:has-text("Akzeptieren")',
    'button:has-text("Zustimmen")',
    'button:has-text("OK")',
    'text=/Alle akzeptieren/i',
  ];
  for (const sel of candidates) {
    const el = page.locator(sel);
    if (await el.first().count()) {
      try {
        await el.first().click({ timeout: 2000 });
        return true;
      } catch {}
    }
  }
  return false;
}

/** Scroll down to load lazy content. */
async function autoScroll(page, step = 600, total = 4000) {
  let scrolled = 0;
  while (scrolled < total) {
    await page.evaluate(s => window.scrollBy(0, s), step);
    scrolled += step;
    await wait(150);
  }
}

/** Try to set the ZIP and radius using UI; falls back to URL params. */
async function setZipAndRadius({ page, baseUrl, plz, radiusKm }) {
  // 1) Try UI way
  try {
    // Focus ZIP input
    const zipInput = page.getByPlaceholder('Postleitzahl/Ort');
    if (await zipInput.count()) {
      await zipInput.fill('');
      await zipInput.type(String(plz), { delay: 40 });
    } else {
      // Old selector fallback
      const inputs = page.locator('input');
      const count = await inputs.count();
      for (let i = 0; i < count; i++) {
        const ph = await inputs.nth(i).getAttribute('placeholder');
        if (ph && ph.toLowerCase().includes('postleitzahl')) {
          await inputs.nth(i).fill('');
          await inputs.nth(i).type(String(plz), { delay: 40 });
          break;
        }
      }
    }

    // Open radius dropdown and select
    let radiusSet = false;
    // Try a native <select>
    const selectElm = page.locator('select').filter({ hasText: /km/i }).first();
    if (await selectElm.count()) {
      try {
        await selectElm.selectOption({ label: `${radiusKm} km` });
        radiusSet = true;
      } catch {}
    }
    if (!radiusSet) {
      // Try "combobox" pattern
      const box = page.getByRole('button', { name: /Im Umkreis von/i }).first();
      if (await box.count()) {
        try {
          await box.click();
          const option = page.getByRole('option', { name: new RegExp(`^${radiusKm}\\s*km$`, 'i') });
          await option.first().click();
          radiusSet = true;
        } catch {}
      }
    }

    // Click search button
    const searchBtn = page.getByRole('button', { name: /BIO-HÄNDLER FINDEN/i }).first();
    if (await searchBtn.count()) {
      await searchBtn.click();
      await page.waitForLoadState('networkidle', { timeout: 10000 });
      return { via: 'ui', radiusSet: radiusSet || null };
    }
  } catch {}

  // 2) Fallback: add query params to baseUrl
  const url = new URL(baseUrl);
  url.searchParams.set('zip', String(plz));
  url.searchParams.set('distance', String(radiusKm));
  await page.goto(url.toString(), { waitUntil: 'domcontentloaded' });
  await page.waitForLoadState('networkidle', { timeout: 10000 });
  return { via: 'url', radiusSet: radiusKm };
}

/** Return all visible "DETAILS" buttons on the list page. */
async function getDetailsButtons(page) {
  const buttons = page.locator('a, button').filter({ hasText: /^DETAILS$/i });
  const count = await buttons.count();
  return { buttons, count };
}

module.exports = {
  wait,
  acceptCookies,
  autoScroll,
  setZipAndRadius,
  getDetailsButtons,
};
