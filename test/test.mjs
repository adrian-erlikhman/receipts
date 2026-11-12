import assert from 'node:assert/strict';
import { sentences, numbersIn, norm } from '../js/text.js';
import { longestRun, trigramContainment } from '../js/match.js';
import { check, citationsIn } from '../js/check.js';
import { SAMPLE } from '../js/samples.js';

let passed = 0;
const t = (name, fn) => { try { fn(); passed++; } catch (e) { console.error('FAIL', name); throw e; } };

t('sentences survive abbreviations, times and decimals', () => {
  const s = sentences('It costs $1.2 million (Rivera and Chen 4). They sleep at 11 p.m. on school nights. See Dr. Okafor, e.g. her 2023 study.\n\nNew paragraph here.');
  assert.deepEqual(s.map((x) => x.text), ['It costs $1.2 million (Rivera and Chen 4).', 'They sleep at 11 p.m. on school nights.', 'See Dr. Okafor, e.g. her 2023 study.', 'New paragraph here.']);
  assert.equal(s[3].para, 1);
});

t('sentences still end at words like "sleep." and "help."', () => {
  const s = sentences('Teens need more sleep. Schools should help. See p. 4 and No. 3 for more. Then we step up.');
  assert.deepEqual(s.map((x) => x.text), ['Teens need more sleep.', 'Schools should help.', 'See p. 4 and No. 3 for more.', 'Then we step up.']);
});

t('words in other alphabets are compared too', () => {
  const r = check('Подростки должны спать не меньше восьми часов каждую ночь в течение учебной недели (Иванов).', [{ author: 'Иванов', label: 'Иванов', text: 'Подростки должны спать не меньше восьми часов каждую ночь в течение учебной недели, считают врачи.' }]);
  assert.equal(r.rows[0].status, 'close');
  assert.deepEqual(r.rows[0].cites.map((c) => c.source), [0]);
});

t('a quotation that runs over two sentences stays one sentence', () => {
  const s = sentences('As Okafor writes, "Teens need more sleep. Schools should help." That is the point. She says "they are not lazy ... [their] clocks run late" (Okafor).');
  assert.deepEqual(s.map((x) => x.text), ['As Okafor writes, "Teens need more sleep. Schools should help."', 'That is the point.', 'She says "they are not lazy ... [their] clocks run late" (Okafor).']);
});

t('numbers carry their units; years and clock times are skipped', () => {
  const n = numbersIn('From 7:30 to 8:35 in 2024, students slept 43 more minutes and tardiness fell 18 percent, costing $1.2 million.');
  assert.deepEqual(n.map((x) => [x.value, x.unit]), [[43, 'minute'], [18, 'percent'], [1.2e6, 'money']]);
});

t('citations are read; asides are not', () => {
  const c = citationsIn('A claim (Okafor 12). Another (Rivera and Chen, 2024). A third [2]. An aside (which is long and not a citation at all here).');
  assert.deepEqual(c.map((x) => x.name ?? x.number), ['Okafor', 'Rivera and Chen', 2]);
});

t('wording overlap', () => {
  assert.equal(longestRun('the clock shifts later so teens stay up', 'Their internal clock shifts later so teens stay up late').length, 7);
  assert.ok(trigramContainment('a b c d e', 'x a b c d e y') === 1);
  assert.equal(norm('“Teenagers” — are…'), 'teenagers - are');
});

const r = check(SAMPLE.essay, SAMPLE.sources);
const find = (re) => r.rows.find((x) => re.test(x.text));
const kinds = (row) => row.issues.map((i) => i.kind);

t('the thesis and the writer\'s own analysis are left alone', () => {
  assert.equal(find(/^High schools should/).status, 'own');
  assert.equal(find(/^Those costs are real/).status, 'own');
});
t('copied wording without quotation marks is caught', () => {
  assert.equal(find(/^During adolescence/).status, 'close');
});
t('a misquote is caught', () => {
  assert.deepEqual(kinds(find(/As Okafor puts it/)), ['misquote']);
});
t('a wrong figure is caught: 43 minutes vs 34', () => {
  assert.match(find(/43 more minutes/).issues[0].text, /34 minutes/);
});
t('a borrowed fact with no citation is caught', () => {
  assert.deepEqual(kinds(find(/^Tardiness/)), ['uncited']);
});
t('a citation pointing at a source that says nothing like it is caught', () => {
  assert.deepEqual(kinds(find(/SAT scores/)), ['nothing']);
});
t('a citation to the wrong source is caught', () => {
  assert.ok(kinds(find(/^Staggering/)).includes('wrongcite'));
});
t('a correct quotation with a correct citation passes', () => {
  const row = find(/Rivera and Chen note/);
  assert.equal(row.status, 'backed');
  assert.ok(row.quotes[0].ok);
});

t('copied words are shown as the source prints them', () => {
  assert.match(find(/^During adolescence/).issues[0].text, /body's internal clock/);
});
t('a paraphrase with few shared words is left alone by word matching', () => {
  assert.equal(find(/^Only about a third/).status, 'own');
});
t('the on-device model can add a match the words missed', () => {
  const n = r.rows.length;
  const P = SAMPLE.sources.reduce((m, src) => m + sentences(src.text).length, 0);
  const k = r.rows.findIndex((x) => /^Only about a third/.test(x.text));
  const matrix = Array.from({ length: n }, (_, i) => Array.from({ length: P }, (_, p) => (i === k && p === 5 ? 0.64 : 0.1)));
  const r2 = check(SAMPLE.essay, SAMPLE.sources, { matrix });
  assert.equal(r2.rows[k].matchedBy, 'meaning');
  assert.equal(r2.rows[k].status, 'uncited');
  assert.equal(r2.rows[k].source, 0);
});

console.log(`${passed} tests passed`);
