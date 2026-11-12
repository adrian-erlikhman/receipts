// Finding which source passage each sentence leans on. Two measures:
//  - meaning overlap: TF-IDF cosine over word stems and stem pairs
//  - wording overlap: the longest run of identical words, and shared 3-word
//    sequences, which is what "too close to the source" looks like.
import { sentences, terms, words } from './text.js';

export function passagesOf(sources) {
  const out = [];
  sources.forEach((src, si) => {
    const ss = sentences(src.text);
    ss.forEach((s, i) => {
      // A passage is a sentence plus its neighbor, so a claim that spans two
      // source sentences still finds them.
      const next = ss[i + 1];
      out.push({ source: si, index: i, text: s.text, context: next ? `${s.text} ${next.text}` : s.text });
    });
  });
  return out;
}

function features(text) {
  const t = terms(text);
  const f = new Map();
  const add = (k, w) => f.set(k, (f.get(k) || 0) + w);
  for (const x of t) add(x, 1);
  for (let i = 0; i + 1 < t.length; i++) add(`${t[i]}_${t[i + 1]}`, 1);
  return f;
}

export function buildIndex(passages, extraDocs = []) {
  const docs = [...passages.map((p) => features(p.context)), ...extraDocs.map(features)];
  const df = new Map();
  for (const d of docs) for (const k of d.keys()) df.set(k, (df.get(k) || 0) + 1);
  const N = docs.length;
  const idf = (k) => Math.log(1 + N / (1 + (df.get(k) || 0)));
  const vec = (f) => {
    const v = new Map();
    let n = 0;
    for (const [k, c] of f) {
      const w = (1 + Math.log(c)) * idf(k);
      v.set(k, w);
      n += w * w;
    }
    return { v, n: Math.sqrt(n) || 1 };
  };
  const pv = passages.map((p) => vec(features(p.context)));
  return {
    query(text) {
      const q = vec(features(text));
      return pv.map((p, i) => {
        let dot = 0;
        for (const [k, w] of q.v) { const o = p.v.get(k); if (o) dot += w * o; }
        return { i, score: dot / (q.n * p.n) };
      }).sort((a, b) => b.score - a.score);
    },
  };
}

// Longest run of identical consecutive words, ignoring case and punctuation.
export function longestRun(a, b) {
  const x = words(a);
  const y = words(b);
  let best = 0;
  let at = -1;
  const prev = new Array(y.length + 1).fill(0);
  for (let i = 1; i <= x.length; i++) {
    let diag = 0;
    for (let j = 1; j <= y.length; j++) {
      const tmp = prev[j];
      prev[j] = x[i - 1] === y[j - 1] ? diag + 1 : 0;
      if (prev[j] > best) { best = prev[j]; at = i; }
      diag = tmp;
    }
  }
  return { length: best, words: best ? x.slice(at - best, at).join(' ') : '' };
}

// Share of the sentence's 3-word sequences that also appear in the passage.
export function trigramContainment(sentence, passage) {
  const tri = (ws) => { const s = new Set(); for (let i = 0; i + 2 < ws.length; i++) s.add(ws.slice(i, i + 3).join(' ')); return s; };
  const a = tri(words(sentence));
  if (!a.size) return 0;
  const b = tri(words(passage));
  let hit = 0;
  for (const t of a) if (b.has(t)) hit++;
  return hit / a.size;
}
