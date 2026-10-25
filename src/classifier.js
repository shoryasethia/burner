// Session intent: who decided, in order of trust —
//   1. a tag (from /burner-tag, the report UI, or the CLI)
//   2. the project's default category (or its only allowed one)
//   3. the learned model, when it has been trained and is confident
//   4. otherwise "untagged" - no guessing from tool counts.

import { readFileSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { FILES, readJson, writeJson, UNTAGGED, mapLegacyCategory } from './config.js';

const MODEL_DIR = path.join(path.dirname(fileURLToPath(import.meta.url)), 'model');

export function allowedCategories(project, cfg) {
  const all = cfg.categories;
  if (!project?.categories?.length) return all;
  const allowed = all.filter((c) => project.categories.includes(c.id));
  return allowed.length ? allowed : all;
}

export function resolveCategory({ tag, project, cfg, digest, learned }) {
  const ids = new Set(cfg.categories.map((c) => c.id));
  const tagCat = tag?.category ? mapLegacyCategory(tag.category) : null;
  if (tagCat && ids.has(tagCat)) return { category: tagCat, source: tag.source ?? 'manual', confidence: tag.confidence ?? null };
  if (project?.defaultCategory && ids.has(mapLegacyCategory(project.defaultCategory))) return { category: mapLegacyCategory(project.defaultCategory), source: 'project' };
  if (project?.categories?.length === 1 && ids.has(project.categories[0])) return { category: project.categories[0], source: 'project' };
  if (learned && cfg.tagging?.learned !== false && digest) {
    const allowed = allowedCategories(project, cfg).map((c) => c.id);
    const p = predictLearned(learned, digest, allowed);
    if (p && p.confidence >= 0.6) return { category: p.category, source: 'learned', confidence: p.confidence };
  }
  return { category: UNTAGGED.id, source: 'none' };
}

// ── Digest: a compact summary of what a session was about ────────────────────

export function buildDigest(parsed, { title, projectName } = {}) {
  const d = parsed.digest ?? parsed;
  const counts = {};
  for (const step of d.tools ?? []) counts[step] = (counts[step] ?? 0) + 1;
  const topTools = Object.entries(counts).sort((a, b) => b[1] - a[1]).slice(0, 15);
  const prompts = (d.prompts ?? []).slice(0, 8).map((p) => p.text.replace(/\s+/g, ' ').slice(0, 400));
  return {
    project: projectName ?? null,
    title: d.aiTitle ?? title ?? null,
    branch: d.gitBranch ?? null,
    prompts,
    tools: topTools,
    toolCount: (d.tools ?? []).length,
  };
}

// ── Learned model: multinomial naive Bayes over prompt words + tool steps ────

const STOP = new Set('the a an and or to of in on for is it this that with be as are was at by from can you i me my we our please just so do does not no yes if then there here what how why when which would could should will let lets ok okay'.split(' '));

export function features(digest) {
  const out = [];
  for (const p of digest.prompts ?? []) {
    const text = typeof p === 'string' ? p : String(p?.text ?? '');
    if (!text) continue;
    for (const w of text.toLowerCase().match(/[a-z][a-z0-9_+#.-]{1,24}/g) ?? []) {
      const word = w.replace(/[.-]+$/, '');
      if (!STOP.has(word)) out.push(word);
    }
  }
  for (const [step, n] of digest.tools ?? []) {
    const tok = 't:' + step.toLowerCase();
    for (let i = 0; i < Math.min(n, 5); i++) out.push(tok);
    out.push('t:' + step.toLowerCase().replace(/\(.*$/, ''));
  }
  return out;
}

export function trainLearned(examples, { prior } = {}) {
  const model = prior ? JSON.parse(JSON.stringify(prior)) : { version: 1, classes: {}, vocab: {}, trainedAt: null, examples: 0, sources: {} };
  for (const { digest, category, weight = 1, source = 'local' } of examples) {
    if (!category) continue;
    const cls = (model.classes[category] ??= { docs: 0, tokens: 0, counts: {} });
    cls.docs += weight;
    for (const f of features(digest)) {
      cls.counts[f] = (cls.counts[f] ?? 0) + weight;
      cls.tokens += weight;
      model.vocab[f] = 1;
    }
    model.examples += 1;
    model.sources[source] = (model.sources[source] ?? 0) + 1;
  }
  model.trainedAt = new Date().toISOString();
  return model;
}

export function predictLearned(model, digest, allowed) {
  const classes = Object.entries(model.classes).filter(([id, c]) => c.docs > 0 && (!allowed || allowed.includes(id)));
  if (classes.length < 2) return null;
  const feats = features(digest);
  if (!feats.length) return null;
  const V = Object.keys(model.vocab).length || 1;
  const totalDocs = classes.reduce((s, [, c]) => s + c.docs, 0);
  const scores = classes.map(([id, c]) => {
    let s = Math.log(c.docs / totalDocs);
    for (const f of feats) s += Math.log(((c.counts[f] ?? 0) + 1) / (c.tokens + V));
    return [id, s];
  });
  const max = Math.max(...scores.map(([, s]) => s));
  const exp = scores.map(([id, s]) => [id, Math.exp(s - max)]);
  const z = exp.reduce((a, [, v]) => a + v, 0);
  exp.sort((a, b) => b[1] - a[1]);
  return { category: exp[0][0], confidence: Math.round((exp[0][1] / z) * 1000) / 1000 };
}

function readBundled(name) {
  try { return JSON.parse(readFileSync(path.join(MODEL_DIR, name), 'utf-8')); } catch { return null; }
}

// The built-in model, trained on public datasets (see src/model/prior.meta.json).
// Not used when its own evaluation said it isn't better than guessing.
export function loadPrior() {
  const meta = readBundled('prior.meta.json');
  if (meta && meta.recommended === false) return null;
  const model = readBundled('prior.json');
  return model?.classes ? model : null;
}

export function priorMeta() {
  return readBundled('prior.meta.json');
}

// The user's own trained model if there is one (it starts from the built-in
// one), otherwise the built-in model.
export function loadLearned() {
  const own = readJson(FILES.model, null);
  if (own) return own;
  const prior = loadPrior();
  return prior ? { ...prior, builtin: true } : null;
}

export function saveLearned(model) {
  writeJson(FILES.model, model);
}