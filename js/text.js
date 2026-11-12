// Splitting and normalizing text. No model, no network.

const ABBREV = ['a.m.', 'p.m.', 'A.M.', 'P.M.', 'e.g.', 'i.e.', 'et al.', 'etc.', 'vs.', 'Dr.', 'Mr.', 'Mrs.', 'Ms.', 'Prof.', 'St.', 'U.S.', 'U.K.', 'No.', 'p.', 'pp.', 'Fig.', 'approx.', 'Jan.', 'Feb.', 'Mar.', 'Apr.', 'Aug.', 'Sept.', 'Oct.', 'Nov.', 'Dec.'];

export const STOP = new Set('a an and are as at be been but by can could did do does for from had has have he her his how i if in into is it its may might more most no not of on or our she should so some such than that the their them then there these they this those to too was we were what when where which while who why will with would you your also about after all any because before between both during each few further here just over same only own very'.split(' '));

// Split prose into sentences, keeping the character offsets so the page can
// highlight them in place.
export function sentences(text) {
  const src = String(text || '');
  let masked = src;
  for (const a of ABBREV) masked = masked.split(a).join(a.replace(/\./g, '․'));
  masked = masked.replace(/\b([A-Z])\.(?=\s?[A-Z]\.)/g, '$1․'); // initials like J. R.
  masked = masked.replace(/(\d)\.(?=\d)/g, '$1\u2024'); // decimals like 1.2
  const out = [];
  const re = /[^.!?\n]+(?:[.!?]+["”’)\]]*|\n|$)/g;
  let m;
  while ((m = re.exec(masked))) {
    const raw = src.slice(m.index, m.index + m[0].length);
    const textTrim = raw.trim();
    if (!textTrim) { if (m[0] === '') re.lastIndex++; continue; }
    const start = m.index + raw.indexOf(textTrim);
    out.push({ text: textTrim, start, end: start + textTrim.length, para: paragraphIndex(src, start) });
    if (m[0] === '') re.lastIndex++;
  }
  return mergeShort(out);
}

function paragraphIndex(src, pos) {
  return (src.slice(0, pos).match(/\n\s*\n/g) || []).length;
}

// A citation like "(Lee 4)." sometimes splits off as its own sentence; join it back.
function mergeShort(list) {
  const out = [];
  for (const s of list) {
    const prev = out[out.length - 1];
    if (prev && prev.para === s.para && /^[(\[][^)\]]{0,40}[)\]][.,;]?$/.test(s.text)) {
      prev.text = prev.text + ' ' + s.text;
      prev.end = s.end;
    } else out.push({ ...s });
  }
  return out;
}

export function words(text) {
  return String(text).toLowerCase().replace(/[’']/g, '').match(/[a-z0-9]+(?:\.\d+)?%?/g) || [];
}

export function stem(w) {
  if (w.length <= 4 || /\d/.test(w)) return w;
  return w.replace(/(ies)$/, 'y').replace(/(ing|edly|ed|ly|es|s)$/, '');
}

export function terms(text) {
  return words(text).filter((w) => !STOP.has(w)).map(stem);
}

// Normalize for verbatim comparison: case, curly quotes, dashes, spacing.
export function norm(text) {
  return String(text)
    .toLowerCase()
    .replace(/[“”«»„]/g, '"')
    .replace(/[‘’]/g, "'")
    .replace(/[–—]/g, '-')
    .replace(/[^a-z0-9%$.'\- ]+/g, ' ')
    .replace(/\s+/g, ' ')
    .trim();
}

export function quotesIn(text) {
  const out = [];
  const re = /[“"]([^”"]{3,400})[”"]/g;
  let m;
  while ((m = re.exec(text))) out.push(m[1]);
  return out;
}

const WORDNUM = { one: 1, two: 2, three: 3, four: 4, five: 5, six: 6, seven: 7, eight: 8, nine: 9, ten: 10, twelve: 12, twenty: 20, thirty: 30, hundred: 100 };

// Numbers with the unit that follows them ("34 minutes", "18 percent",
// "$1.2 million"), so a figure is only compared with figures of the same kind.
export function numbersIn(text) {
  const out = [];
  const t = String(text).replace(/\b\d{1,2}:\d{2}\b/g, ' '); // clock times aren't figures
  const re = /(\$\s?(?:\d{1,3}(?:,\d{3})+|\d+)(?:\.\d+)?(?:\s?(?:million|billion|thousand))?|(?:\d{1,3}(?:,\d{3})+|\d+)(?:\.\d+)?)\s?(?:(?:more|fewer|less|additional|extra|full|whole|of|an|a)\s)?(%|percent(?:age points?)?|[a-z]+)?/gi;
  let m;
  while ((m = re.exec(t))) {
    const raw = m[1];
    let value = Number(raw.replace(/[$,\s]|million|billion|thousand/gi, ''));
    if (!Number.isFinite(value)) continue;
    if (/million/i.test(raw)) value *= 1e6;
    if (/billion/i.test(raw)) value *= 1e9;
    if (/thousand/i.test(raw)) value *= 1e3;
    let unit = (m[2] || '').toLowerCase();
    if (unit === '%' || unit === 'percent') unit = 'percent';
    else if (/^percentage/.test(unit)) unit = 'points';
    else if (raw.includes('$')) unit = 'money';
    else unit = unit.replace(/s$/, '');
    if (!raw.includes('$') && !raw.includes(',') && value >= 1900 && value <= 2100) continue; // a year
    out.push({ raw: (raw + (m[2] && unit !== 'money' ? ' ' + m[2] : '')).trim(), value, unit });
  }
  return out;
}
