// Goes through an essay sentence by sentence and says, for each one, which
// source it leans on and whether it handles that source honestly.
import { sentences, norm, quotesIn, numbersIn, words } from './text.js';
import { passagesOf, buildIndex, longestRun, trigramContainment } from './match.js';

export const LIMITS = {
  backed: 0.25, // TF-IDF cosine for "this sentence leans on that passage"
  run: 7, // identical words in a row, outside quotation marks
  containment: 0.45, // share of the sentence's 3-word sequences found in the passage
  minWords: 8,
  meaning: 0.62, // on-device model cosine, when the model is turned on
};

const CITE = /\(([^()]{2,80}?)\)|\[(\d{1,2})\]/g;

export function citationsIn(text) {
  const out = [];
  let m;
  CITE.lastIndex = 0;
  while ((m = CITE.exec(text))) {
    if (m[2]) { out.push({ raw: m[0], number: Number(m[2]) }); continue; }
    const inner = m[1].trim();
    if (!/[A-Za-z]{3,}/.test(inner)) continue;
    if (/^(e\.g\.|i\.e\.|see|or|and|which|who)\b/i.test(inner)) continue;
    if (inner.split(/\s+/).length > 9) continue; // an aside, not a citation
    const name = inner.replace(/\b(p|pp)\.\s*/g, '').replace(/,?\s*\d[\d\s,–-]*$/, '').replace(/\bet al\.?/, '').trim();
    out.push({ raw: m[0], name });
  }
  return out;
}

function citedSource(cite, sources) {
  if (cite.number) return sources[cite.number - 1] ? cite.number - 1 : -1;
  const n = norm(cite.name);
  let best = -1;
  sources.forEach((s, i) => {
    const a = norm(s.author || s.label);
    const first = a.split(' ')[0];
    if (n && (n === a || n.startsWith(first) || a.startsWith(n))) best = i;
  });
  return best;
}

const stripCites = (s) => s.replace(CITE, ' ');
const stripQuotes = (s) => s.replace(/[“"][^”"]{3,400}[”"]/g, ' ');

export function check(essay, sources, opts = {}) {
  const { matrix, ...limits } = opts;
  const L = { ...LIMITS, ...limits };
  const passages = passagesOf(sources);
  const sents = sentences(essay);
  const index = buildIndex(passages, sents.map((s) => s.text));
  const sourceText = sources.map((s) => norm(s.text));

  // First pass: which source each sentence leans on.
  const meaning = opts.matrix || null; // matrix[k][p] from embed.js
  const firstPass = sents.map((s, k) => {
    const plain = stripCites(s.text);
    const quotes = quotesIn(plain).map((q) => {
      const n = norm(q);
      const at = sourceText.findIndex((t) => t.includes(n));
      return { text: q, source: at, ok: at >= 0 };
    });
    const ranked = index.query(stripQuotes(plain).trim() ? plain : s.text);
    const top = ranked[0];
    let best = top && top.score >= L.backed ? passages[top.i] : null;
    let matchedBy = best ? 'words' : null;
    let sem = null;
    if (meaning) {
      const row = meaning[k];
      let bi = 0;
      for (let p = 1; p < row.length; p++) if (row[p] > row[bi]) bi = p;
      sem = { i: bi, score: row[bi] };
      if (!best && sem.score >= L.meaning) { best = passages[bi]; matchedBy = 'meaning'; }
    }
    const quoteSource = quotes.find((q) => q.ok)?.source;
    return { plain, quotes, ranked, top, best, sem, matchedBy, usesSource: best ? best.source : quoteSource ?? -1 };
  });

  const rows = sents.map((s, k) => {
    const { plain, quotes, ranked, top, best, sem, matchedBy, usesSource } = firstPass[k];
    const issues = [];
    const add = (kind, text) => issues.push({ kind, text });
    const cites = citationsIn(s.text);
    // A citation that closes the next sentence in the same paragraph covers
    // this one too, but only if both sentences lean on the same source.
    const next = sents[k + 1];
    const nextCites = next && next.para === s.para && firstPass[k + 1].usesSource === usesSource ? citationsIn(next.text) : [];

    // 1. Quotations have to appear word for word in a source.
    for (const q of quotes) if (!q.ok) add('misquote', `"${q.text}" doesn't appear word for word in any source.`);

    // 3. Wording copied without quotation marks.
    let close = null;
    if (best) {
      const bare = stripQuotes(plain);
      if (words(bare).length >= L.minWords) {
        const run = longestRun(bare, best.context);
        const contain = trigramContainment(bare, best.context);
        if (run.length >= L.run || contain >= L.containment) {
          close = { run: run.length, words: run.words, containment: contain };
          add('close', `${run.length} words in a row match the source without quotation marks ("${run.words}"). Quote it or put it in your own words.`);
        }
      }
    }

    // 4. Figures that don't match the source they came from: same unit,
    // different number ("43 minutes" where the source says "34 minutes").
    if (usesSource >= 0) {
      const theirs = numbersIn(sources[usesSource].text);
      for (const n of numbersIn(plain)) {
        if (!n.unit) continue;
        const same = theirs.filter((t) => t.unit === n.unit);
        if (same.length && !same.some((t) => Math.abs(t.value - n.value) < 1e-9)) {
          add('number', `You wrote ${n.raw}; ${sources[usesSource].label} says ${[...new Set(same.map((t) => t.raw))].join(' / ')}.`);
        }
      }
    }

    // 5. Citations: missing, pointing at the wrong source, or pointing at nothing.
    const cited = [...cites, ...(cites.length ? [] : nextCites)].map((c) => ({ ...c, source: citedSource(c, sources) }));
    if (usesSource >= 0 && !cited.length) add('uncited', `This uses ${sources[usesSource].label} but has no citation.`);
    for (const c of cites) {
      const cs = citedSource(c, sources);
      if (cs < 0) { add('unknown', `${c.raw} doesn't match any source in your list.`); continue; }
      if (usesSource >= 0 && cs !== usesSource) {
        const citedBest = ranked.filter((r) => passages[r.i].source === cs)[0];
        if (!citedBest || citedBest.score < top.score * 0.6) add('wrongcite', `You cite ${sources[cs].label}, but this matches ${sources[usesSource].label}.`);
      }
      if (usesSource < 0) {
        const near = meaning ? Math.max(...passages.map((p, i) => (p.source === cs ? meaning[k][i] : -1))) : -1;
        if (near < L.meaning - 0.07) add('nothing', `You cite ${sources[cs].label}, but nothing in it matches this sentence.`);
      }
    }

    let status = 'own';
    if (issues.some((i) => ['misquote', 'number', 'wrongcite', 'nothing'].includes(i.kind))) status = 'wrong';
    else if (close) status = 'close';
    else if (issues.some((i) => i.kind === 'uncited')) status = 'uncited';
    else if (usesSource >= 0) status = 'backed';

    return {
      ...s,
      status,
      issues,
      source: usesSource,
      passage: best ? best.context : null,
      score: top ? top.score : 0,
      meaningScore: sem ? sem.score : null,
      matchedBy,
      quotes,
      cites: cites.map((c) => ({ ...c, source: citedSource(c, sources) })),
    };
  });

  const used = new Set(rows.filter((r) => r.source >= 0).map((r) => r.source));
  const counts = rows.reduce((m, r) => ((m[r.status] = (m[r.status] || 0) + 1), m), {});
  return {
    rows,
    counts,
    unusedSources: sources.map((s, i) => i).filter((i) => !used.has(i)),
    issueCount: rows.reduce((n, r) => n + r.issues.length, 0),
  };
}
