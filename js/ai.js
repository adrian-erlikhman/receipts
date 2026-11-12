// Optional, with your own Anthropic API key: Claude reads a claim and the
// passage it was matched to and says whether the passage supports it. Its
// answer has to quote the passage word for word, or the verdict is thrown out.
// The key stays in this tab and goes only to api.anthropic.com.
import { norm } from './text.js';

export const MODELS = ['claude-sonnet-5-5', 'claude-opus-5-5', 'claude-haiku-5-5'];

const SYSTEM = `You check whether a source passage supports a sentence from a student's essay. Reply with JSON only:
{"verdict": "supports" | "partly" | "does_not_support", "evidence": an exact quote of the passage's words that matter (copy them character for character), "why": one short plain sentence a high school student would understand}
Judge only what the passage says. "partly" means the passage supports part of the sentence but not all of it, or the sentence overstates it.`;

export async function supportCheck({ key, model, sentence, passage }) {
  const res = await fetch('https://api.anthropic.com/v1/messages', {
    method: 'POST',
    headers: { 'x-api-key': key, 'anthropic-version': '2023-06-01', 'content-type': 'application/json', 'anthropic-dangerous-direct-browser-access': 'true' },
    // These models think before answering, and thinking counts toward
    // max_tokens, so leave room for it; low effort keeps the answer quick.
    body: JSON.stringify({ model, max_tokens: 4000, output_config: { effort: 'low' }, system: SYSTEM, messages: [{ role: 'user', content: `Essay sentence:\n${sentence}\n\nSource passage:\n${passage}` }] }),
  });
  if (!res.ok) {
    let msg = String(res.status);
    try { msg = (await res.json()).error?.message || msg; } catch {}
    if (res.status === 401) msg = 'That API key was rejected.';
    throw new Error(msg);
  }
  const data = await res.json();
  if (data.stop_reason === 'refusal') throw new Error('Claude declined to answer this one.');
  const text = data.content.filter((b) => b.type === 'text').map((b) => b.text).join('');
  if (!text.includes('{') && data.stop_reason === 'max_tokens') throw new Error("Claude's answer was cut off. Try again.");
  return verify(text, passage);
}

export function verify(text, passage) {
  const s = text.indexOf('{');
  const e = text.lastIndexOf('}');
  if (s < 0 || e < s) throw new Error('The model did not return JSON.');
  const out = JSON.parse(text.slice(s, e + 1));
  if (!['supports', 'partly', 'does_not_support'].includes(out.verdict)) throw new Error('Unexpected verdict.');
  const evidence = String(out.evidence || '').trim();
  if (evidence && !norm(passage).includes(norm(evidence))) throw new Error('The quoted evidence is not in the passage, so the verdict was discarded.');
  return { verdict: out.verdict, evidence, why: String(out.why || '').slice(0, 300) };
}
