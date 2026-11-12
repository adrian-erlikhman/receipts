import { check } from './check.js';
import { passagesOf } from './match.js';
import { terms, stem } from './text.js';
import { SAMPLE } from './samples.js';
import { MODELS, supportCheck } from './ai.js';

const $ = (s, el = document) => el.querySelector(s);
const esc = (s) => String(s).replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[c]);

const LABEL = {
  wrong: ['Check this', 'misquote, wrong figure or wrong citation'],
  close: ['Too close', 'copied wording without quotation marks'],
  uncited: ['No citation', 'uses a source but doesn\'t cite it'],
  backed: ['Backed', 'matches a source and cites it'],
  own: ['Your own', 'no source match'],
};
const ORDER = ['wrong', 'close', 'uncited', 'backed', 'own'];

const state = { essay: '', sources: [], result: null, selected: null, filter: null, key: '', model: MODELS[0], claude: {} };

// ---------- sources form ----------
function addSourceRow(src = {}) {
  const li = $('#tplSource').content.firstElementChild.cloneNode(true);
  $('.s-author', li).value = src.author || '';
  $('.s-year', li).value = src.year || '';
  $('.s-text', li).value = src.text || '';
  $('.s-remove', li).addEventListener('click', () => li.remove());
  $('.s-file', li).addEventListener('change', async (e) => {
    const f = e.target.files[0];
    if (!f) return;
    try { $('.s-text', li).value = /\.pdf$/i.test(f.name) || f.type === 'application/pdf' ? await pdfText(f) : await f.text(); if (!$('.s-author', li).value) $('.s-author', li).value = f.name.replace(/\.[^.]+$/, ''); }
    catch (err) { status(`Couldn't read ${f.name}: ${err.message}`, true); }
  });
  $('#sourceList').append(li);
}

function readForm() {
  const sources = [...document.querySelectorAll('#sourceList > li')].map((li) => {
    const author = $('.s-author', li).value.trim();
    const year = $('.s-year', li).value.trim();
    return { author, label: [author, year].filter(Boolean).join(' ') || 'Untitled source', text: $('.s-text', li).value.trim() };
  }).filter((s) => s.text);
  return { essay: $('#essay').value.trim(), sources };
}

async function pdfText(file) {
  const pdfjs = await import('../vendor/pdfjs/pdf.min.mjs');
  pdfjs.GlobalWorkerOptions.workerSrc = new URL('../vendor/pdfjs/pdf.worker.min.mjs', import.meta.url).href;
  const doc = await pdfjs.getDocument({ data: await file.arrayBuffer() }).promise;
  const pages = [];
  for (let p = 1; p <= doc.numPages; p++) pages.push((await (await doc.getPage(p)).getTextContent()).items.map((i) => i.str).join(' '));
  return pages.join('\n\n').replace(/-\s+(?=[a-z])/g, '').replace(/\s{2,}/g, ' ');
}

function status(msg, err = false) { const s = $('#status'); s.textContent = msg; s.className = err ? 'status err' : 'status'; }

// ---------- running ----------
async function run() {
  const { essay, sources } = readForm();
  if (!essay) return status('Paste your essay first.', true);
  if (!sources.length) return status('Add at least one source.', true);
  state.essay = essay; state.sources = sources; state.claude = {};
  let matrix = null;
  if ($('#useModel').checked) {
    try {
      status('Loading the on-device model (first time only)…');
      const { loadModel, meaningMatrix } = await import('./embed.js');
      await loadModel((p) => { if (p.status === 'progress' && p.file?.endsWith('.onnx')) status(`Downloading the model… ${Math.round(p.progress)}%`); });
      status('Comparing meaning…');
      const { sentences } = await import('./text.js');
      matrix = await meaningMatrix(sentences(essay).map((s) => s.text), passagesOf(sources).map((p) => p.context));
    } catch (err) {
      status(`The on-device model didn't load (${err.message}). Matching by words only.`, true);
    }
  }
  state.result = check(essay, sources, matrix ? { matrix } : {});
  state.selected = state.result.rows.findIndex((r) => r.status !== 'own' && r.status !== 'backed');
  if (state.selected < 0) state.selected = 0;
  state.filter = null;
  if (!matrix || !$('#status').classList.contains('err')) status(`Checked ${state.result.rows.length} sentences against ${sources.length} source${sources.length > 1 ? 's' : ''}${matrix ? ', by words and by meaning' : ''}.`);
  render();
  $('#report').scrollIntoView({ behavior: 'smooth' });
}

// ---------- rendering ----------
function render() {
  const r = state.result;
  $('#report').hidden = !r;
  if (!r) return;
  $('#tally').innerHTML = ORDER.filter((k) => r.counts[k]).map((k) => `<button class="t-${k}" data-filter="${k}" aria-pressed="${state.filter === k}"><span class="n">${r.counts[k]}</span>${LABEL[k][0]}</button>`).join('');

  // Essay, sentence by sentence, keeping paragraphs.
  const paras = [];
  for (const [k, row] of r.rows.entries()) {
    (paras[row.para] ||= []).push(`<span class="s ${row.status}${state.filter && state.filter !== row.status ? ' dim' : ''}${k === state.selected ? ' sel' : ''}" data-k="${k}" tabindex="0" role="button" aria-label="${esc(LABEL[row.status][0])}: ${esc(row.text.slice(0, 80))}">${esc(row.text)}</span>`);
  }
  $('#essayView').innerHTML = paras.filter(Boolean).map((p) => `<p>${p.join(' ')}</p>`).join('');
  renderDetail();

  const uses = state.sources.map((s, i) => r.rows.filter((x) => x.source === i).length);
  $('#sourcesUsed').innerHTML = `<h3>Your sources</h3><ul>${state.sources.map((s, i) => `<li><b>${esc(s.label)}</b>: ${uses[i] ? `${uses[i]} sentence${uses[i] > 1 ? 's' : ''} lean on it` : '<span style="color:var(--wrong)">nothing in the essay matches it. Did you use it?</span>'}</li>`).join('')}</ul>`;
}

function highlight(passage, sentence) {
  const want = new Set(terms(sentence));
  return esc(passage).replace(/[A-Za-z][A-Za-z']+/g, (w) => (want.has(stem(w.toLowerCase().replace(/'/g, ''))) ? `<mark>${w}</mark>` : w));
}

function renderDetail() {
  const r = state.result;
  const row = r.rows[state.selected];
  if (!row) { $('#detail').innerHTML = ''; return; }
  const [name, desc] = LABEL[row.status];
  const src = row.source >= 0 ? state.sources[row.source] : null;
  const claude = state.claude[state.selected];
  $('#detail').innerHTML = `
    <span class="tag t-${row.status}">${name}</span> <span class="meta">${esc(desc)}</span>
    <p style="font-family:var(--serif)">${esc(row.text)}</p>
    ${row.issues.length ? `<ul>${row.issues.map((i) => `<li>${esc(i.text)}</li>`).join('')}</ul>` : row.status === 'own' ? '<p class="meta">No source passage matches this sentence. That\'s fine for your own argument. If it states a fact, add a source.</p>' : ''}
    ${src && row.passage ? `<p class="meta">Matched ${esc(src.label)} ${row.matchedBy === 'meaning' ? `by meaning (${row.meaningScore.toFixed(2)})` : `by shared words (${row.score.toFixed(2)})`}. Shared words are marked.</p><blockquote>${highlight(row.passage, row.text)}</blockquote>` : ''}
    ${src && row.passage ? `<button class="btn small" data-act="claude" ${state.key ? '' : 'disabled title="Add an API key below first"'}>Ask Claude: does this passage support it?</button>` : ''}
    ${claude ? `<div class="claude-out">${claude.error ? esc(claude.error) : `<b>${{ supports: 'Supports it', partly: 'Partly supports it', does_not_support: "Doesn't support it" }[claude.verdict]}.</b> ${esc(claude.why)}${claude.evidence ? `<blockquote>${esc(claude.evidence)}</blockquote>` : ''}`}</div>` : ''}
    <div class="row" style="margin-top:12px"><button class="btn small ghost" data-act="prev">‹ Previous flag</button><button class="btn small ghost" data-act="next">Next flag ›</button></div>`;
}

function step(dir) {
  const rows = state.result.rows;
  for (let k = state.selected + dir; k >= 0 && k < rows.length; k += dir) {
    if (rows[k].issues.length) { state.selected = k; render(); return; }
  }
}

// ---------- events ----------
document.addEventListener('click', async (e) => {
  const s = e.target.closest('.s');
  if (s) { state.selected = +s.dataset.k; render(); return; }
  const b = e.target.closest('button');
  if (!b) return;
  if (b.dataset.filter) { state.filter = state.filter === b.dataset.filter ? null : b.dataset.filter; render(); }
  if (b.id === 'tryDemo') loadDemo();
  if (b.id === 'addSource') addSourceRow();
  if (b.id === 'run') run();
  if (b.dataset.act === 'next') step(1);
  if (b.dataset.act === 'prev') step(-1);
  if (b.dataset.act === 'claude') {
    const k = state.selected;
    const row = state.result.rows[k];
    b.disabled = true; b.textContent = 'Asking Claude…';
    try { state.claude[k] = await supportCheck({ key: state.key, model: state.model, sentence: row.text, passage: row.passage }); }
    catch (err) { state.claude[k] = { error: err.message }; }
    renderDetail();
  }
});
document.addEventListener('keydown', (e) => {
  const s = e.target.closest && e.target.closest('.s');
  if (s && (e.key === 'Enter' || e.key === ' ')) { e.preventDefault(); state.selected = +s.dataset.k; render(); $(`.s[data-k="${state.selected}"]`)?.focus(); }
});
$('#apiKey').addEventListener('input', (e) => { state.key = e.target.value.trim(); if (state.result) renderDetail(); });
$('#model').innerHTML = MODELS.map((m) => `<option>${m}</option>`).join('');
$('#model').addEventListener('change', (e) => { state.model = e.target.value; });

function loadDemo() {
  $('#essay').value = SAMPLE.essay;
  $('#sourceList').innerHTML = '';
  for (const s of SAMPLE.sources) addSourceRow({ author: s.author, year: s.label.replace(s.author, '').trim(), text: s.text });
  run();
}

addSourceRow();
if (new URLSearchParams(location.search).get('demo') === '1') loadDemo();
