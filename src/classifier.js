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

// A model that has seen fewer than 6 of the user's own tags (or only one
// category) is still warming up: it keeps learning but is not used to guess.
export const MIN_LOCAL_TAGS = 6;
export function usableModel(model) {
  if (!model) return null;
  if (model.builtin) return model;
  const classes = Object.values(model.classes ?? {}).filter((c) => c.docs > 0).length;
  return (model.sources?.local ?? 0) >= MIN_LOCAL_TAGS && classes >= 2 ? model : null;
}

export function resolveCategory({ tag, project, cfg, digest, learned: rawLearned }) {
  const learned = usableModel(rawLearned);
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

// ── Learned model: naive Bayes over a small, personal feature set ───────────
//
// Version 2 features (version 1 models keep working with the old ones):
//   - each word counted once per session, so a long session can't drown the rest
//   - the first prompt weighted separately (intent is usually stated there), plus its word pairs
//   - the session title, project, branch prefix (fix/, feat/ ...)
//   - tool steps by presence and by a coarse count bucket, the edit-vs-read mix, session size
// Counts are additive, so one new tag updates the model in place (learnFromTag).

const STOP = new Set('the a an and or to of in on for is it this that with be as are was at by from can you i me my we our please just so do does not no yes if then there here what how why when which would could should will let lets ok okay'.split(' '));

export const FEATURE_VERSION = 2;

function words(text) {
  const out = [];
  for (const w of String(text ?? '').toLowerCase().match(/[a-z][a-z0-9_+#.-]{1,24}/g) ?? []) {
    const word = w.replace(/[.-]+$/, '');
    if (word.length > 1 && !STOP.has(word)) out.push(word);
  }
  return out;
}

const promptText = (p) => (typeof p === 'string' ? p : String(p?.text ?? ''));
const EDIT_STEPS = /^(edit|write|multiedit|notebookedit)\b/;
const READ_STEPS = /^(read|grep|glob|ls|websearch|webfetch)\b/;

function featuresV1(digest) {
  const out = [];
  const STOP1 = STOP;
  for (const p of digest.prompts ?? []) {
    const text = promptText(p);
    if (!text) continue;
    for (const w of text.toLowerCase().match(/[a-z][a-z0-9_+#.-]{1,24}/g) ?? []) {
      const word = w.replace(/[.-]+$/, '');
      if (!STOP1.has(word)) out.push(word);
    }
  }
  for (const [step, n] of digest.tools ?? []) {
    const tok = 't:' + step.toLowerCase();
    for (let i = 0; i < Math.min(n, 5); i++) out.push(tok);
    out.push('t:' + step.toLowerCase().replace(/\(.*$/, ''));
  }
  return out;
}

function featuresV2(digest) {
  const out = new Set();
  const prompts = (digest.prompts ?? []).map(promptText).filter(Boolean);
  for (const p of prompts) for (const w of words(p)) out.add(w);
  if (prompts[0]) {
    const first = words(prompts[0]);
    for (const w of first) out.add('f:' + w);
    for (let i = 0; i + 1 < first.length && i < 12; i++) out.add(`f2:${first[i]}_${first[i + 1]}`);
  }
  for (const w of words(digest.title)) out.add('ti:' + w);
  if (digest.project) out.add('p:' + String(digest.project).toLowerCase());
  const branch = String(digest.branch ?? '').toLowerCase();
  const prefix = branch.match(/^([a-z]+)[/_-]/)?.[1];
  if (prefix) out.add('br:' + prefix);

  let edits = 0;
  let reads = 0;
  for (const [step, n] of digest.tools ?? []) {
    const low = step.toLowerCase();
    const base = low.replace(/\(.*$/, '');
    out.add('t:' + low);
    out.add('t:' + base);
    out.add(`tc:${base}:${n >= 5 ? '5+' : n >= 2 ? '2-4' : '1'}`);
    if (EDIT_STEPS.test(base)) edits += n;
    else if (READ_STEPS.test(base)) reads += n;
  }
  const total = edits + reads;
  out.add('mix:' + (!total ? 'none' : edits / total >= 0.6 ? 'edit' : edits / total <= 0.15 ? 'read' : 'mixed'));
  const size = digest.toolCount ?? (digest.tools ?? []).reduce((a, [, n]) => a + n, 0);
  out.add('size:' + (size === 0 ? 'chat' : size < 8 ? 'small' : size < 40 ? 'medium' : 'large'));
  return [...out];
}

export function features(digest, version = FEATURE_VERSION) {
  return version >= 2 ? featuresV2(digest) : featuresV1(digest);
}

const newModel = () => ({ version: FEATURE_VERSION, classes: {}, vocab: {}, trainedAt: null, examples: 0, sources: {} });

// Adds (weight > 0) or removes (weight < 0) one example's counts in place.
function addExample(model, { digest, category, weight = 1, source = 'local' }) {
  if (!category) return;
  const cls = (model.classes[category] ??= { docs: 0, tokens: 0, counts: {} });
  cls.docs = Math.max(0, cls.docs + weight);
  for (const f of features(digest, model.version ?? 1)) {
    const before = cls.counts[f] ?? 0;
    const next = Math.max(0, before + weight);
    cls.tokens = Math.max(0, cls.tokens + (next - before));
    if (next) cls.counts[f] = next;
    else delete cls.counts[f];
    if (weight > 0) model.vocab[f] = 1;
  }
  if (weight > 0) {
    model.examples += 1;
    model.sources[source] = (model.sources[source] ?? 0) + 1;
  }
}

export function trainLearned(examples, { prior } = {}) {
  // A built-in prior is a version 1 (words only) model; it keeps its own features.
  const model = prior ? JSON.parse(JSON.stringify(prior)) : newModel();
  for (const ex of examples) addExample(model, ex);
  model.trainedAt = new Date().toISOString();
  return model;
}

// One new or changed tag, learned immediately. `previous` is the category this
// session was tagged with before (if any), taken back out first.
export const LOCAL_WEIGHT = 5;
export function learnFromTag(model, { sessionId, digest, category, previous = null, weight = LOCAL_WEIGHT }) {
  const m = model ?? newModel();
  m.learned ??= {};
  const was = m.learned[sessionId] ?? previous;
  if (was === category) { m.learned[sessionId] = category; return m; }
  if (was && m.classes[was]) addExample(m, { digest, category: was, weight: -weight });
  addExample(m, { digest, category, weight, source: 'local' });
  if (was && m.sources.local > 0) m.sources.local -= 1;
  m.learned[sessionId] = category;
  m.trainedAt = new Date().toISOString();
  return m;
}

export function predictLearned(model, digest, allowed) {
  const classes = Object.entries(model.classes).filter(([id, c]) => c.docs > 0 && (!allowed || allowed.includes(id)));
  if (classes.length < 2) return null;
  const feats = features(digest, model.version ?? 1);
  if (!feats.length) return null;
  const V = Object.keys(model.vocab).length || 1;
  const totalDocs = classes.reduce((s, [, c]) => s + c.docs, 0);
  // Naive Bayes treats correlated features as independent evidence, so on a
  // busy session its confidence saturates near 100%. Version 2 tempers that
  // with the number of features, which keeps the confidence threshold honest.
  const temper = (model.version ?? 1) >= 2 ? Math.max(1, feats.length / 25) : 1;
  const scores = classes.map(([id, c]) => {
    let ll = 0;
    for (const f of feats) ll += Math.log(((c.counts[f] ?? 0) + 1) / (c.tokens + V));
    return [id, Math.log(c.docs / totalDocs) + ll / temper];
  });
  const max = Math.max(...scores.map(([, s]) => s));
  const exp = scores.map(([id, s]) => [id, Math.exp(s - max)]);
  const z = exp.reduce((a, [, v]) => a + v, 0);
  exp.sort((a, b) => b[1] - a[1]);
  return { category: exp[0][0], confidence: Math.round((exp[0][1] / z) * 1000) / 1000 };
}

// Leave-one-out accuracy on the user's own tagged sessions. Counts are
// additive, so each example is taken out, predicted, and put back.
// Returns null when there isn't enough to measure.
export function evaluateLeaveOneOut(examples, { version = FEATURE_VERSION, minConfidence = 0.6 } = {}) {
  const usable = examples.filter((e) => e.category && e.digest);
  const classes = new Set(usable.map((e) => e.category));
  if (usable.length < 10 || classes.size < 2) return null;
  const model = { ...newModel(), version };
  for (const ex of usable) addExample(model, { ...ex, weight: 1 });
  let correct = 0;
  let confident = 0;
  let confidentCorrect = 0;
  for (const ex of usable) {
    addExample(model, { ...ex, weight: -1 });
    const p = predictLearned(model, ex.digest);
    addExample(model, { ...ex, weight: 1 });
    if (!p) continue;
    const ok = p.category === ex.category;
    if (ok) correct += 1;
    if (p.confidence >= minConfidence) {
      confident += 1;
      if (ok) confidentCorrect += 1;
    }
  }
  const counts = {};
  for (const e of usable) counts[e.category] = (counts[e.category] ?? 0) + 1;
  const n = usable.length;
  return {
    n,
    accuracy: Math.round((correct / n) * 1000) / 1000,
    baseline: Math.round((Math.max(...Object.values(counts)) / n) * 1000) / 1000,
    // of the sessions it would label on its own (confidence >= threshold):
    coverage: Math.round((confident / n) * 1000) / 1000,
    precision: confident ? Math.round((confidentCorrect / confident) * 1000) / 1000 : null,
    version,
  };
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

// Only the user's own saved model (never the built-in prior): what a new tag is added to.
export function loadUserModel() {
  const own = readJson(FILES.model, null);
  return own?.classes ? own : null;
}

export function saveLearned(model) {
  writeJson(FILES.model, model);
}