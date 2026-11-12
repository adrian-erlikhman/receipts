// Optional: a small sentence-embedding model (all-MiniLM-L6-v2, about 23 MB,
// quantized) that runs in the browser with Transformers.js. It catches
// paraphrases that share few words with the source. Nothing is uploaded: the
// model is downloaded once and runs on your device.

const CDN = 'https://cdn.jsdelivr.net/npm/@huggingface/transformers@3.0.2';
const MODEL = 'Xenova/all-MiniLM-L6-v2';
let extractor = null;

export async function loadModel(onProgress = () => {}) {
  if (extractor) return extractor;
  const { pipeline, env } = await import(/* @vite-ignore */ CDN);
  env.allowLocalModels = false;
  extractor = await pipeline('feature-extraction', MODEL, { dtype: 'q8', progress_callback: onProgress });
  return extractor;
}

export async function embed(texts, batch = 16) {
  const out = [];
  for (let i = 0; i < texts.length; i += batch) {
    const t = await extractor(texts.slice(i, i + batch), { pooling: 'mean', normalize: true });
    out.push(...t.tolist());
  }
  return out;
}

export function cosine(a, b) {
  let s = 0;
  for (let i = 0; i < a.length; i++) s += a[i] * b[i];
  return s;
}

// similarity[k][p] for essay sentence k and source passage p.
export async function meaningMatrix(sentenceTexts, passageTexts) {
  const [se, pe] = [await embed(sentenceTexts), await embed(passageTexts)];
  return se.map((v) => pe.map((w) => cosine(v, w)));
}
