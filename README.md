# Receipts

Paste your essay and the sources you used. Receipts matches every sentence to the source it leans on and flags what a teacher would catch: copied wording without quotation marks, misquotes, figures that don't match the source, citations that are missing, and citations that point at the wrong source.

**Live: https://adrian-erlikhman.github.io/receipts/** · [sample essay](https://adrian-erlikhman.github.io/receipts/?demo=1) · [1-minute demo](https://youtu.be/AjXb5bhWY_8)

Everything runs in the browser. There is no server and no account.

## What it checks

| Flag | What it means |
|---|---|
| **Too close** | Seven or more words in a row from a source, or most of a sentence's three-word sequences, with no quotation marks. |
| **Misquote** | Text inside quotation marks that doesn't appear word for word in any source. Case and punctuation don't count, "..." can stand for left-out words and [brackets] for changed ones. Titles and one- or two-word scare quotes are skipped. The flag names the closest source sentence. |
| **Wrong figure** | A number with the same unit as one in the source, but a different value: "43 minutes" where the source says "34 minutes." |
| **No citation** | The sentence leans on a source but neither it nor the next sentence (if that one uses the same source) cites it. Naming the author counts: "As Okafor puts it," "Okafor (2023) found." |
| **Wrong citation** | The sentence cites one source but matches another much better. |
| **Cites nothing** | The sentence cites a source, but nothing in that source matches it. |
| **Unknown source** | A citation like "(Smith 4)" that names no source in your list. Asides in parentheses aren't read as citations. |
| **Backed** | Matches a source and cites it. |
| **Your own** | Matches no source. That's fine for your own argument. |

Click any sentence to see the passage it matched, with the shared words marked.

## How it works

1. **Sentences.** The essay and each source are split into sentences, with care for "p.m.", "et al.", "p. 4", initials and decimals. A quotation that runs over two sentences stays one. Source passages are a sentence plus its neighbor, so a claim that spans two source sentences still finds them.
2. **Match by words.** TF-IDF over word stems and stem pairs, cosine similarity. A sentence leans on a passage at 0.25 or above.
3. **Match by meaning (optional).** Turn on the on-device model and Receipts also embeds every sentence and passage with all-MiniLM-L6-v2 (23 MB, quantized, run by Transformers.js in your browser). A paraphrase that shares few words with its source is matched at a cosine of 0.62 or above. Nothing is uploaded.
4. **Checks.** Longest run of identical words and 3-word-sequence containment (quotations removed first), word-for-word quotation lookup, unit-aware figure comparison, and citation parsing for MLA, APA and numbered styles.
5. **Ask Claude (optional, your own key).** For any matched sentence, Claude says whether the passage supports it, partly supports it, or doesn't. Its answer must quote the passage word for word or it is discarded (`verify` in `js/ai.js`, tested).

## Run it

No build step.

```
npx http-server . -p 4173 -c-1
npm test
```

## Layout

```
js/text.js      sentences, words, quotations, figures with units
js/match.js     passages, TF-IDF index, longest shared run, trigram containment
js/check.js     the checks, sentence by sentence
js/embed.js     optional on-device embedding model (Transformers.js)
js/ai.js        optional Claude support check, with evidence verification
js/samples.js   a made-up essay and three made-up sources with planted problems
js/app.js       interface
vendor/pdfjs    Mozilla pdf.js (Apache 2.0), for loading PDF sources
test/test.mjs   every planted problem, plus the splitter, quotations, figures, citations and the Claude check
```

## Limits

- Receipts checks your essay against the sources you give it. It can't see sources you didn't paste, and it isn't a plagiarism detector for other people's work.
- The thresholds were tuned on the sample essay and a few others. Treat every flag as something to look at, not a verdict.
- Citation parsing covers the common in-text forms. Footnotes and full bibliographies aren't read.
- The on-device model loads from the jsDelivr and Hugging Face CDNs the first time (about 27 MB with its runtime, a few seconds on a fast connection) and from the browser's cache after that. If it can't load, the page says why and checks by words only.
- It is built for English. Other languages that put spaces between words get the wording, quotation and figure checks, but the word stemming and the on-device model are English-only.

## Credits

Built by Adrian Erlikhman and Michael Tarekegn in November 2026, with Claude Code as a coding assistant. Transformers.js and all-MiniLM-L6-v2 by Hugging Face and the sentence-transformers authors. PDF reading by pdf.js. The sample essay and sources are made up. MIT licensed.
