// Goes through an essay sentence by sentence and says, for each one, which
// source it leans on and whether it handles that source honestly.
import { sentences, norm, quotesIn, numbersIn, words, terms } from './text.js';
import { passagesOf, buildIndex, longestRun, trigramContainment } from './match.js';

export const LIMITS = {
  backed: 0.25, // TF-IDF cosine for "this sentence leans on that passage"
  run: 7, // identical words in a row, outside quotation marks
  containment: 0.45, // share of the sentence's 3-word sequences found in the passage
  minWords: 8,
  meaning: 0.62, // on-device model cosine, when the model is turned on
};

const CITE = /\(([^()]{2,80}?)\)|\[(\d{1,2})\]/g;

const NOT_NAME = /^(fig|figure|table|chapter|section|grade|page|appendix|step|part|level|class|period|room|unit|year|day|week)\b/i;

export function citationsIn(text) {
  const out = [];
  let m;
  CITE.lastIndex = 0;
  while ((m = CITE.exec(text))) {
    if (m[2]) { out.push({ raw: m[0], number: Number(m[2]) }); continue; }
    const inner = m[1].trim().replace(/^(qtd\.?|quoted|cited) in\s+/i, '');
    // "Okafor (2023) found" or "As Okafor puts it ... (4)": the name is in the
    // sentence before the year or page.
    if (!/\p{L}{3,}/u.test(inner)) {
      if (/^(?:(?:pp?|par)\.\s*)?\d/.test(inner)) out.push({ raw: m[0], name: null, before: text.slice(0, m.index) });
      continue;
    }
    if (/^(e\.g\.|i\.e\.|see|or|and|which|who)\b/i.test(inner)) continue;
    if (inner.split(/\s+/).length > 9) continue; // an aside, not a citation
    const name = inner.replace(/\b(p|pp|par)\.\s*/g, '').replace(/,?\s*\d[\d\s,–-]*$/, '').replace(/\bet al\.?/, '').trim();
    // Only something shaped like a citation: "(Okafor 4)", "(Rivera and Chen)".
    // "(often before 7 a.m.)" and "(Table 2)" are asides.
    const big = name.split(/\s+/).filter((w) => w.length > 3);
    if (!/^\p{Lu}/u.test(name) || NOT_NAME.test(name) || !(/\d\s*$/.test(inner) || big.every((w) => /^\p{Lu}/u.test(w)))) continue;
    out.push({ raw: m[0], name, acronym: /^\p{Lu}{2,6}$/u.test(name) });
  }
  return out;
}

// How a source's author can appear in a sentence: the full name, or the first
// surname of "Rivera and Chen" or "Okafor et al.".
function nameKeys(src) {
  const a = words(src.author || '').join(' ');
  if (!a) return [];
  const first = a.split(' ')[0];
  return a === first || /\b(and|et)\b/.test(a) || /&/.test(src.author) ? [a, first] : [a];
}

// Where in the text a source's author is last named, or -1.
function namedAt(text, src) {
  const hay = ` ${words(String(text).replace(/['’]s\b/g, '')).join(' ')} `;
  return Math.max(-1, ...nameKeys(src).map((k) => hay.lastIndexOf(` ${k} `)));
}

function citedSource(cite, sources) {
  if (cite.number) return sources[cite.number - 1] ? cite.number - 1 : -1;
  if (cite.name === null) {
    let best = -1;
    let at = -1;
    sources.forEach((s, i) => { const p = namedAt(cite.before, s); if (p > at) { at = p; best = i; } });
    return best;
  }
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

// Where a quotation appears in the sources. Words are compared, so case and
// punctuation don't count ("lazy." matches "lazy;"). An ellipsis stands for
// left-out words, a [bracket] for up to five changed words, and "[T]eenagers"
// is read as "Teenagers". Returns the source index, or -1.
export function findQuote(quote, sourceWords) {
  const pieces = quote.replace(/\[(\p{L}{1,3})\](?=\p{L})/gu, '$1').split(/(\.\s?\.\s?\.|…|\[[^\]]*\])/);
  const parts = [];
  let gap = Infinity;
  for (const piece of pieces) {
    if (/^(?:\.\s?\.\s?\.|…)$/.test(piece)) gap = Infinity;
    else if (/^\[[^\]]*\]$/.test(piece)) gap = Math.max(gap, 5);
    else { const w = words(piece); if (w.length) { parts.push({ w, gap }); gap = 0; } }
  }
  const count = parts.reduce((n, p) => n + p.w.length, 0);
  return { words: count, source: count ? sourceWords.findIndex((hay) => inOrder(hay, parts)) : -1 };
}

function inOrder(hay, parts) {
  const failed = new Set();
  const go = (k, from) => {
    if (k === parts.length) return true;
    const key = k * (hay.length + 1) + from;
    if (failed.has(key)) return false;
    const { w, gap } = parts[k];
    const last = Math.min(hay.length - w.length, from + gap);
    for (let i = from; i <= last; i++) {
      let j = 0;
      while (j < w.length && hay[i + j] === w[j]) j++;
      if (j === w.length && go(k + 1, i + w.length)) return true;
    }
    failed.add(key);
    return false;
  };
  return go(0, 0);
}

// The source sentence that shares the most of a misquote's words, if any
// shares at least 40% of them.
function closestSentence(quote, passages) {
  const want = new Set(terms(quote));
  let best = null;
  let bestShare = 0.4;
  for (const p of passages) {
    const have = new Set(terms(p.text));
    let hit = 0;
    for (const t of want) if (have.has(t)) hit++;
    if (want.size && hit / want.size >= bestShare) { best = p; bestShare = hit / want.size + 1e-9; }
  }
  return best;
}

// Titles ("Bells and Buses") and one- or two-word scare quotes aren't
// quotations from a source, so they aren't flagged when no source has them.
function looseQuote(q, count) {
  const big = (q.match(/\p{L}[\p{L}\p{M}'’-]*/gu) || []).filter((w) => w.length > 3);
  return count < 3 || (big.length >= 2 && big.every((w) => /^\p{Lu}/u.test(w)));
}

export function check(essay, sources, opts = {}) {
  const { matrix, ...limits } = opts;
  const L = { ...LIMITS, ...limits };
  const passages = passagesOf(sources);
  const sents = sentences(essay);
  const index = buildIndex(passages, sents.map((s) => s.text));
  const sourceWords = sources.map((s) => words(s.text));

  // First pass: which source each sentence leans on.
  const meaning = opts.matrix || null; // matrix[k][p] from embed.js
  const firstPass = sents.map((s, k) => {
    const plain = stripCites(s.text);
    const quotes = quotesIn(plain).map((q) => {
      const found = findQuote(q, sourceWords);
      const ok = found.source >= 0;
      return { text: q, source: found.source, ok, checked: ok || (found.words > 0 && !looseQuote(q, found.words)) };
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

  // Citations with the source each one points to. A year or page whose author
  // isn't named before it, or an acronym like "(CDC)" that names no source, is
  // left out rather than flagged.
  const resolve = (text) => citationsIn(text).map((c) => ({ ...c, source: citedSource(c, sources) })).filter((c) => c.source >= 0 || !(c.name === null || c.acronym));

  const rows = sents.map((s, k) => {
    const { plain, quotes, ranked, top, best, sem, matchedBy, usesSource } = firstPass[k];
    const issues = [];
    const add = (kind, text) => issues.push({ kind, text });
    const cites = resolve(s.text);
    // A citation that closes the next sentence in the same paragraph covers
    // this one too, but only if both sentences lean on the same source.
    const next = sents[k + 1];
    const nextCites = next && next.para === s.para && firstPass[k + 1].usesSource === usesSource ? resolve(next.text) : [];

    // 1. Quotations have to appear word for word in a source.
    for (const q of quotes) {
      if (q.ok || !q.checked) continue;
      const near = closestSentence(q.text, passages);
      const hint = near ? ` The closest sentence is in ${sources[near.source].label}: "${near.text}"` : '';
      add('misquote', `"${q.text}" doesn't appear word for word in any source.${hint}`);
    }

    // 3. Wording copied without quotation marks.
    let close = null;
    if (best) {
      const bare = stripQuotes(plain);
      if (words(bare).length >= L.minWords) {
        const run = longestRun(bare, best.context);
        const contain = trigramContainment(bare, best.context);
        if (run.length >= L.run || contain >= L.containment) {
          // Show the copied words as the source prints them.
          const pattern = run.words.split(' ').map((w) => [...w].map((c) => c.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')).join("['’]?")).join('[^\\p{L}\\p{N}%]+');
          const shown = (best.context.match(new RegExp(pattern, 'iu')) || [run.words])[0];
          close = { run: run.length, words: shown, containment: contain };
          add('close', `${run.length} words in a row match the source without quotation marks ("${shown}"). Quote it or put it in your own words.`);
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
    // Naming the author in the sentence ("As Okafor puts it") also counts.
    const cited = cites.length ? cites : nextCites;
    if (usesSource >= 0 && !cited.length && namedAt(s.text, sources[usesSource]) < 0) add('uncited', `This uses ${sources[usesSource].label} but has no citation.`);
    for (const c of cites) {
      const cs = c.source;
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
    if (issues.some((i) => ['misquote', 'number', 'wrongcite', 'nothing', 'unknown'].includes(i.kind))) status = 'wrong';
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
      cites,
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
