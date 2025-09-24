
const { URL } = require('node:url');

function sleep(ms) { return new Promise(res => setTimeout(res, ms)); }

function normText(t) {
  if (!t) return null;
  return t.replace(/\s+/g, ' ').trim() || null;
}

function parseAddress(blockText) {
  if (!blockText) return { strasse: null, plz: null, ort: null };
  const t = blockText.replace(/\s+/g, ' ').trim();
  // find PLZ + Ort
  const m = t.match(/(\d{5})\s+([A-Za-zÄÖÜäöüß\-\.\s]+)/);
  let plz = null, ort = null;
  if (m) { plz = m[1]; ort = normText(m[2]); }
  // try street (before PLZ if possible)
  let strasse = null;
  const idx = t.indexOf(plz || '');
  if (idx > 0) {
    strasse = normText(t.slice(0, idx));
    // trim trailing commas / separators
    if (strasse) strasse = strasse.replace(/[,\-–|]+$/,'').trim() || null;
  }
  return { strasse, plz, ort };
}

function unique(arr) {
  return Array.from(new Set(arr.filter(Boolean)));
}

module.exports = { sleep, normText, parseAddress, unique };
