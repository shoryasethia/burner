import { readFileSync } from 'node:fs';
import path from 'node:path';
import { analyzeSessions } from './analyze.js';
import { discoverSessions } from './discover.js';
import { parseTranscript } from './parse.js';
import { loadConfig, mapLegacyCategory } from './config.js';
import { loadTags, setTag, resolveSessionProject } from './tags.js';
import { allowedCategories, buildDigest, trainLearned, saveLearned, loadPrior, loadUserModel, learnFromTag, evaluateLeaveOneOut, LOCAL_WEIGHT } from './classifier.js';

function samePath(a, b) {
  const n = (p) => path.resolve(p).replace(/[\\/]+$/, '').toLowerCase();
  return n(a) === n(b);
}

// The session a /burner-tag call came from. Claude Code substitutes
// ${CLAUDE_SESSION_ID} in skills; when it doesn't, fall back to the newest
// transcript whose working directory is this one.
export function resolveCurrentSession(explicit, cwd = process.cwd()) {
  const id = [explicit, process.env.CLAUDE_SESSION_ID].find((v) => v && !v.includes('${') && v.trim());
  const sessions = discoverSessions();
  if (id) {
    const s = sessions.find((x) => x.sessionId === id || x.sessionId.startsWith(id));
    if (s) return s;
  }
  for (const s of sessions.slice(0, 40)) {
    const { digest } = parseTranscript(s.mainFile);
    if (digest.cwd && samePath(digest.cwd, cwd)) return s;
  }
  return sessions[0] ?? null;
}

// A tag you set yourself is learned on the spot (counts are additive), so the
// model improves without waiting for "Train from my tags". Never throws: a
// tag must not fail because the model file couldn't be written.
export function rememberTag(sessionId, digest, category, previous = null) {
  try {
    if (!digest?.prompts?.length) return;
    const prev = previous && ['skill', 'manual'].includes(previous.source) ? previous.category : null;
    saveLearned(learnFromTag(loadUserModel(), { sessionId, digest, category, previous: prev }));
  } catch { /* the tag itself is already saved */ }
}

export function tagFromCli({ category, session, reason, task, source = 'skill' }) {
  const cfg = loadConfig();
  const s = resolveCurrentSession(session);
  if (!s) throw new Error('no Claude Code sessions found');
  const { digest } = parseTranscript(s.mainFile);
  const project = resolveSessionProject(s.sessionId, digest.cwd, cfg);
  const allowed = allowedCategories(project, cfg).map((c) => c.id);
  if (!allowed.includes(category)) {
    throw new Error(`"${category}" is not a category for project ${project.name}. Use one of: ${allowed.join(', ')}`);
  }
  const previous = loadTags()[s.sessionId];
  const entry = setTag(s.sessionId, { category, source, reason, segment: !!task });
  if (!task) rememberTag(s.sessionId, buildDigest(parseTranscript(s.mainFile), { title: s.customTitle, projectName: project.name }), category, previous);
  return { sessionId: s.sessionId, project: project.name, ...entry };
}

// SWE-chat (SALT-NLP) prompt_intent -> burner categories.
export const SWE_CHAT_LABELS = {
  'create new code': 'coding',
  refactor: 'coding',
  debug: 'debugging',
  understand: 'research',
  test: 'coding',
  git: 'coding',
  connect: 'coding',
  other: 'other',
};

export async function fetchSweChat({ token, limit = 5000, onProgress } = {}) {
  if (!token) throw new Error('SWE-chat is gated: accept its terms at https://huggingface.co/datasets/SALT-NLP/SWE-chat and set HF_TOKEN');
  const where = encodeURIComponent('"prompt_intent" IS NOT NULL');
  const rows = [];
  for (let offset = 0; offset < limit; offset += 100) {
    const url = `https://datasets-server.huggingface.co/filter?dataset=SALT-NLP/SWE-chat&config=default&split=train&where=${where}&offset=${offset}&length=100`;
    const res = await fetch(url, { headers: { Authorization: `Bearer ${token}` }, signal: AbortSignal.timeout(60000) });
    if (!res.ok) throw new Error(`SWE-chat fetch failed: HTTP ${res.status} ${(await res.text()).slice(0, 200)}`);
    const data = await res.json();
    for (const { row } of data.rows ?? []) {
      const category = SWE_CHAT_LABELS[String(row.prompt_intent).toLowerCase()];
      if (category && row.content) rows.push({ text: String(row.content).slice(0, 2000), category });
    }
    onProgress?.(rows.length);
    if (!data.rows?.length || offset + 100 >= (data.num_rows_total ?? Infinity)) break;
  }
  return rows;
}

// Trains the learned model: user tags (weighted up - they're this user's
// own work) plus any public prior examples ({ text, category }).
export async function trainFromTags({ prior = [], localWeight = LOCAL_WEIGHT, bootstrapPrior = false } = {}) {
  try {
    const a = await analyzeSessions();
    const tags = loadTags();
    const examples = [];
    for (const s of a.sessions) {
      const t = tags[s.sessionId];
      if (!t || !['skill', 'manual'].includes(t.source)) continue;
      const digest = a.digests.get(s.sessionId);
      if (!digest?.prompts?.length) continue;
      examples.push({ digest, category: mapLegacyCategory(t.category), weight: localWeight, source: 'local', sessionId: s.sessionId });
    }
    for (const p of prior) {
      const text = String(p.text ?? '').trim();
      if (!text) continue;
      examples.push({ digest: { prompts: [text], tools: [] }, category: p.category, weight: 1, source: p.source ?? 'public' });
    }
    const classes = new Set(examples.map((e) => e.category));
    if (examples.length < 6 || classes.size < 2) {
      return { ok: false, examples: examples.length, message: `need at least 6 tagged sessions across 2+ categories to learn from (have ${examples.length})` };
    }
    const model = trainLearned(examples, { prior: bootstrapPrior ? loadPrior() : null });
    model.learned = Object.fromEntries(examples.filter((e) => e.sessionId).map((e) => [e.sessionId, e.category]));
    const own = examples.filter((e) => e.source === 'local');
    const cv = evaluateLeaveOneOut(own, { version: model.version ?? 2 });
    const cvOld = evaluateLeaveOneOut(own, { version: 1 });
    if (cv) model.eval = { ...cv, previousAccuracy: cvOld?.accuracy ?? null, at: new Date().toISOString() };
    saveLearned(model);
    const localCount = examples.filter((e) => e.source === 'local').length;
    return {
      ok: true,
      examples: localCount,
      totalRows: model.examples,
      sources: model.sources,
      classes: Object.fromEntries(Object.entries(model.classes).map(([k, v]) => [k, v.docs])),
      eval: model.eval ?? null,
    };
  } catch (err) {
    const code = err?.code;
    if (code === 'EACCES' || code === 'EPERM') {
      return { ok: false, message: `could not write model under ~/.burner (${code})` };
    }
    if (code === 'ENOSPC') return { ok: false, message: 'disk full — could not save model' };
    return { ok: false, message: err?.message ?? String(err) };
  }
}

export function readJsonl(file) {
  return readFileSync(file, 'utf-8').split('\n').filter((l) => l.trim()).map((l) => JSON.parse(l));
}
