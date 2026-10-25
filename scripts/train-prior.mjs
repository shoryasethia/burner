#!/usr/bin/env node
/**
 * Train burner’s out-of-the-box intent prior (multinomial Naive Bayes) from public datasets.
 *
 * Usage:
 *   node scripts/train-prior.mjs           # fetch datasets, train, write src/model/prior.json
 *   node scripts/train-prior.mjs --offline # reuse cached rows under .data/
 *
 * Zero npm dependencies; Node 18+ (needs global fetch). Maintainer-only — not run by end users.
 */

import { mkdirSync, readFileSync, writeFileSync, existsSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { trainLearned, predictLearned, features } from '../src/classifier.js';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const ROOT = path.join(__dirname, '..');
const DATA_DIR = path.join(ROOT, '.data');
const MODEL_PATH = path.join(ROOT, 'src', 'model', 'prior.json');
const META_PATH = path.join(ROOT, 'src', 'model', 'prior.meta.json');

const OFFLINE = process.argv.includes('--offline');
const SEED = 42;
const CAP_PER_CLASS = 1000;
const TEST_FRAC = 0.2;
const MIN_FEATURE_COUNT = 2;
const TOP_N_PER_CLASS = 600;
const CONF_THRESHOLD = 0.6;

// ── Label mapping tables (source label → burner category id) ─────────────────
// Only labels listed here are used; unmapped labels are dropped (not invented).

/** @type {Record<string, string | null>} databricks/databricks-dolly-15k */
const DOLLY_MAP = {
  brainstorming: 'planning',
  summarization: 'writing',
  creative_writing: 'writing',
  classification: 'analysis',
  information_extraction: 'research',
  open_qa: 'learning',
  closed_qa: 'learning',
  general_qa: 'learning',
};

/** @type {Record<string, string | null>} HuggingFaceH4/no_robots */
const NO_ROBOTS_MAP = {
  Coding: 'coding',
  Brainstorm: 'planning',
  Summarize: 'writing',
  Generation: 'writing',
  Rewrite: 'writing',
  'Open QA': 'learning',
  'Closed QA': 'learning',
  Extract: 'research',
  Classify: 'analysis',
  Chat: 'other',
};

const DATASET_SPECS = [
  {
    id: 'dolly',
    name: 'databricks/databricks-dolly-15k',
    license: 'CC-BY-SA-3.0',
    url: 'https://huggingface.co/datasets/databricks/databricks-dolly-15k',
    hf: { dataset: 'databricks/databricks-dolly-15k', config: 'default', split: 'train' },
    maxRows: 20_000,
    mapLabel: (label) => DOLLY_MAP[label] ?? null,
    rowToExample(row) {
      const text = [row.instruction, row.context].filter(Boolean).join('\n').trim();
      if (!text) return null;
      return { text, rawLabel: row.category };
    },
  },
  {
    id: 'no_robots',
    name: 'HuggingFaceH4/no_robots',
    license: 'CC-BY-NC-4.0',
    url: 'https://huggingface.co/datasets/HuggingFaceH4/no_robots',
    hf: { dataset: 'HuggingFaceH4/no_robots', config: 'default', split: 'train' },
    maxRows: 10_000,
    mapLabel: (label) => NO_ROBOTS_MAP[label] ?? null,
    rowToExample(row) {
      const text = (row.prompt ?? '').trim();
      if (!text) return null;
      return { text, rawLabel: row.category };
    },
  },
  {
    id: 'code_instructions',
    name: 'iamtarun/python_code_instructions_18k_alpaca',
    license: 'See dataset card (instruction-tuning; widely redistributed)',
    url: 'https://huggingface.co/datasets/iamtarun/python_code_instructions_18k_alpaca',
    hf: { dataset: 'iamtarun/python_code_instructions_18k_alpaca', config: 'default', split: 'train' },
    maxRows: 12_000,
    mapLabel: () => 'coding',
    rowToExample(row) {
      const text = (row.instruction ?? '').trim();
      if (!text) return null;
      return { text, rawLabel: 'code_instruction' };
    },
  },
  {
    id: 'swe_bench',
    name: 'princeton-nlp/SWE-bench',
    license: 'MIT (per SWE-bench repository)',
    url: 'https://huggingface.co/datasets/princeton-nlp/SWE-bench',
    hf: { dataset: 'princeton-nlp/SWE-bench', config: 'default', split: 'train' },
    maxRows: 4_000,
    mapLabel: () => 'debugging',
    rowToExample(row) {
      const ps = (row.problem_statement ?? '').trim();
      if (!ps) return null;
      const text = ps.slice(0, 1500);
      return { text, rawLabel: 'bug_report' };
    },
  },
  {
    id: 'sql_context',
    name: 'b-mc2/sql-create-context',
    license: 'See dataset card (Spider-derived text-to-SQL context)',
    url: 'https://huggingface.co/datasets/b-mc2/sql-create-context',
    hf: { dataset: 'b-mc2/sql-create-context', config: 'default', split: 'train' },
    maxRows: 8_000,
    mapLabel: () => 'analysis',
    rowToExample(row) {
      const q = (row.question ?? '').trim();
      if (!q) return null;
      const ctx = (row.context ?? '').trim();
      const text = ctx ? `Using this database schema:\n${ctx.slice(0, 400)}\n\n${q}` : q;
      return { text, rawLabel: 'text_to_sql' };
    },
  },
  {
    id: 'github_codereview',
    name: 'ronantakizawa/github-codereview',
    license: 'Permissive (source repos MIT/Apache/BSD per dataset card)',
    url: 'https://huggingface.co/datasets/ronantakizawa/github-codereview',
    hf: { dataset: 'ronantakizawa/github-codereview', config: 'default', split: 'train' },
    maxRows: 6_000,
    mapLabel: () => 'review',
    rowToExample(row) {
      if (row.is_negative) return null; // negatives lack review intent in the prompt
      const code = (row.before_code ?? '').trim().slice(0, 900);
      const title = (row.pr_title ?? 'code change').trim();
      const fp = (row.file_path ?? 'file').trim();
      const lang = (row.language ?? 'code').trim();
      if (!code) return null;
      const text = `Please review this ${lang} change from PR "${title}" (${fp}):\n\n${code}`;
      return { text, rawLabel: 'code_review' };
    },
  },
];

// ── RNG (deterministic) ───────────────────────────────────────────────────────

function mulberry32(a) {
  return function () {
    a |= 0;
    a = (a + 0x6d2b79f5) | 0;
    let t = Math.imul(a ^ (a >>> 15), 1 | a);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

const rng = mulberry32(SEED);

function shuffle(arr) {
  for (let i = arr.length - 1; i > 0; i--) {
    const j = Math.floor(rng() * (i + 1));
    [arr[i], arr[j]] = [arr[j], arr[i]];
  }
  return arr;
}

// ── HuggingFace datasets-server fetch ─────────────────────────────────────────

const HF_ROWS = 'https://datasets-server.huggingface.co/rows';

function sleep(ms) {
  return new Promise((r) => setTimeout(r, ms));
}

async function fetchJson(url, { retries = 8 } = {}) {
  for (let attempt = 0; attempt <= retries; attempt++) {
    const res = await fetch(url);
    if ((res.status === 429 || res.status >= 500) && attempt < retries) {
      const wait = Math.min(30_000, 1000 * 2 ** attempt);
      process.stdout.write(`  HTTP ${res.status}, waiting ${wait}ms...\n`);
      await sleep(wait);
      continue;
    }
    if (!res.ok) throw new Error(`HTTP ${res.status} for ${url}`);
    return res.json();
  }
  throw new Error(`Failed after retries: ${url}`);
}

async function fetchDollyJsonl(offline) {
  const cachePath = path.join(DATA_DIR, 'dolly.json');
  if (offline || existsSync(cachePath)) {
    if (!existsSync(cachePath)) throw new Error(`Missing cache ${cachePath}; run without --offline first`);
    return JSON.parse(readFileSync(cachePath, 'utf-8'));
  }
  const url =
    'https://huggingface.co/datasets/databricks/databricks-dolly-15k/resolve/main/databricks-dolly-15k.jsonl';
  process.stdout.write('  download dolly jsonl...\n');
  const res = await fetch(url);
  if (!res.ok) throw new Error(`HTTP ${res.status} dolly jsonl`);
  const text = await res.text();
  const rows = text
    .split('\n')
    .filter((l) => l.trim())
    .map((l) => JSON.parse(l));
  mkdirSync(DATA_DIR, { recursive: true });
  writeFileSync(cachePath, JSON.stringify(rows), 'utf-8');
  return rows;
}

async function fetchAllRows(spec, offline) {
  const cachePath = path.join(DATA_DIR, `${spec.id}.json`);
  if (offline) {
    if (!existsSync(cachePath)) throw new Error(`Missing cache ${cachePath}; run without --offline first`);
    return JSON.parse(readFileSync(cachePath, 'utf-8'));
  }

  if (spec.id === 'dolly') return fetchDollyJsonl(offline);
  return fetchAllRowsResumable(spec, offline);
}

/** Paginate with incremental cache so a failed run can resume. */
async function fetchAllRowsResumable(spec, offline) {
  const cachePath = path.join(DATA_DIR, `${spec.id}.json`);
  if (offline) {
    if (!existsSync(cachePath)) throw new Error(`Missing cache ${cachePath}; run without --offline first`);
    return JSON.parse(readFileSync(cachePath, 'utf-8'));
  }

  const { dataset, config, split } = spec.hf;
  const pageSize = 100;
  const maxRows = spec.maxRows ?? Infinity;
  let rows = existsSync(cachePath) ? JSON.parse(readFileSync(cachePath, 'utf-8')) : [];
  let offset = rows.length;

  if (rows.length >= maxRows) return rows.slice(0, maxRows);

  let total = Infinity;
  while (offset < total && rows.length < maxRows) {
    const url = `${HF_ROWS}?dataset=${encodeURIComponent(dataset)}&config=${encodeURIComponent(config)}&split=${encodeURIComponent(split)}&offset=${offset}&length=${pageSize}`;
    process.stdout.write(`  fetch ${spec.id} offset ${offset}...\n`);
    const body = await fetchJson(url);
    if (body.error) throw new Error(body.error);
    total = body.num_rows_total ?? total;
    for (const r of body.rows ?? []) {
      if (rows.length >= maxRows) break;
      rows.push(r.row);
    }
    offset += body.rows?.length ?? pageSize;
    mkdirSync(DATA_DIR, { recursive: true });
    writeFileSync(cachePath, JSON.stringify(rows), 'utf-8');
    if (!body.rows?.length) break;
    await sleep(600);
  }
  return rows;
}

function toTrainingExamples(spec, rows) {
  const out = [];
  for (const row of rows) {
    const ex = spec.rowToExample(row);
    if (!ex) continue;
    const category = spec.mapLabel(ex.rawLabel);
    if (!category) continue;
    out.push({
      digest: { prompts: [ex.text], tools: [] },
      category,
      weight: 1,
      source: spec.id,
      dataset: spec.id,
    });
  }
  return out;
}

// ── Balance & split ───────────────────────────────────────────────────────────

function balanceByCategory(examples, cap) {
  const byCat = new Map();
  for (const ex of examples) {
    if (!byCat.has(ex.category)) byCat.set(ex.category, []);
    byCat.get(ex.category).push(ex);
  }
  const out = [];
  for (const [, list] of byCat) {
    shuffle(list);
    out.push(...list.slice(0, cap));
  }
  return shuffle(out);
}

function stratifiedSplit(examples, testFrac) {
  const byCat = new Map();
  for (const ex of examples) {
    if (!byCat.has(ex.category)) byCat.set(ex.category, []);
    byCat.get(ex.category).push(ex);
  }
  const train = [];
  const test = [];
  for (const [, list] of byCat) {
    shuffle(list);
    const nTest = Math.max(1, Math.floor(list.length * testFrac));
    test.push(...list.slice(0, nTest));
    train.push(...list.slice(nTest));
  }
  return { train: shuffle(train), test: shuffle(test) };
}

// ── Metrics ───────────────────────────────────────────────────────────────────

const ALL_CATEGORIES = [
  'coding', 'debugging', 'planning', 'research', 'writing', 'analysis', 'review', 'learning', 'other',
];

function majorityClass(examples) {
  const counts = {};
  for (const ex of examples) counts[ex.category] = (counts[ex.category] ?? 0) + 1;
  return Object.entries(counts).sort((a, b) => b[1] - a[1])[0][0];
}

function evaluate(model, examples, allowed = ALL_CATEGORIES) {
  const yTrue = [];
  const yPred = [];
  const conf = [];
  for (const ex of examples) {
    const p = predictLearned(model, ex.digest, allowed);
    if (!p) continue;
    yTrue.push(ex.category);
    yPred.push(p.category);
    conf.push(p.confidence);
  }
  const n = yTrue.length;
  let correct = 0;
  for (let i = 0; i < n; i++) if (yTrue[i] === yPred[i]) correct++;

  const labels = [...new Set([...yTrue, ...yPred])].sort();
  const perClass = {};
  for (const label of labels) {
    let tp = 0;
    let fp = 0;
    let fn = 0;
    for (let i = 0; i < n; i++) {
      if (yPred[i] === label && yTrue[i] === label) tp++;
      else if (yPred[i] === label) fp++;
      else if (yTrue[i] === label) fn++;
    }
    const prec = tp + fp === 0 ? 0 : tp / (tp + fp);
    const rec = tp + fn === 0 ? 0 : tp / (tp + fn);
    const f1 = prec + rec === 0 ? 0 : (2 * prec * rec) / (prec + rec);
    perClass[label] = {
      precision: round(prec),
      recall: round(rec),
      f1: round(f1),
      support: yTrue.filter((y) => y === label).length,
    };
  }

  const macroF1 =
    labels.length === 0
      ? 0
      : labels.reduce((s, l) => s + (perClass[l]?.f1 ?? 0), 0) / labels.length;

  const maj = majorityClass(examples);
  let majCorrect = 0;
  for (const ex of examples) if (ex.category === maj) majCorrect++;

  let confCorrect = 0;
  let confKept = 0;
  for (let i = 0; i < n; i++) {
    if (conf[i] >= CONF_THRESHOLD) {
      confKept++;
      if (yTrue[i] === yPred[i]) confCorrect++;
    }
  }

  return {
    accuracy: round(n ? correct / n : 0),
    macroF1: round(macroF1),
    perClass,
    majorityBaseline: round(examples.length ? majCorrect / examples.length : 0),
    majorityClass: maj,
    evaluated: n,
    confidentAccuracy: round(confKept ? confCorrect / confKept : 0),
    confidentCoverage: round(n ? confKept / n : 0),
    confidentThreshold: CONF_THRESHOLD,
  };
}

function round(x) {
  return Math.round(x * 10000) / 10000;
}

// ── Vocabulary pruning ────────────────────────────────────────────────────────

function pruneModel(model, { minCount = 2, topNPerClass = 600 } = {}) {
  const keep = new Set();
  for (const [, cls] of Object.entries(model.classes)) {
    const entries = Object.entries(cls.counts)
      .filter(([, c]) => c >= minCount)
      .sort((a, b) => b[1] - a[1])
      .slice(0, topNPerClass);
    for (const [tok] of entries) keep.add(tok);
  }
  const newVocab = {};
  for (const tok of keep) newVocab[tok] = 1;
  for (const [, cls] of Object.entries(model.classes)) {
    let tokens = 0;
    const counts = {};
    for (const [tok, c] of Object.entries(cls.counts)) {
      if (!keep.has(tok)) continue;
      counts[tok] = c;
      tokens += c;
    }
    cls.counts = counts;
    cls.tokens = tokens;
  }
  model.vocab = newVocab;
  return model;
}

// ── Cross-dataset evaluation ──────────────────────────────────────────────────

function crossDatasetEval(allBalanced, specs) {
  const results = {};
  for (const held of specs) {
    const testEx = allBalanced.filter((e) => e.dataset === held.id);
    const trainEx = allBalanced.filter((e) => e.dataset !== held.id);
    if (testEx.length < 5 || trainEx.length < 10) {
      results[held.id] = { skipped: true, reason: 'too few examples' };
      continue;
    }
    const catsInTest = new Set(testEx.map((e) => e.category));
    const catsInTrain = new Set(trainEx.map((e) => e.category));
    const overlap = [...catsInTest].filter((c) => catsInTrain.has(c));
    if (overlap.length < 2) {
      results[held.id] = { skipped: true, reason: 'fewer than 2 overlapping categories' };
      continue;
    }
    let model = trainLearned(trainEx);
    model = pruneModel(model, { minCount: MIN_FEATURE_COUNT, topNPerClass: TOP_N_PER_CLASS });
    const metrics = evaluate(model, testEx, overlap);
    results[held.id] = {
      skipped: false,
      testExamples: testEx.length,
      overlappingCategories: overlap,
      accuracy: metrics.accuracy,
      macroF1: metrics.macroF1,
      majorityBaseline: metrics.majorityBaseline,
    };
  }
  const scored = Object.values(results).filter((r) => !r.skipped);
  const avgMacroF1 =
    scored.length ? round(scored.reduce((s, r) => s + r.macroF1, 0) / scored.length) : 0;
  const avgAccuracy =
    scored.length ? round(scored.reduce((s, r) => s + r.accuracy, 0) / scored.length) : 0;
  return { perDataset: results, avgMacroF1, avgAccuracy, datasetsScored: scored.length };
}

// ── Sanity prompts ────────────────────────────────────────────────────────────

const SANITY_PROMPTS = [
  'the login page crashes when I click submit',
  'write a PRD for onboarding new users',
  'summarize this Q3 sales spreadsheet into bullet points for leadership',
  'what does this function do? explain like I am new to the codebase',
  'review my PR for security issues before I merge',
  'add a dark mode toggle to the settings page using our existing theme tokens',
  'why is my Jest test failing with "cannot read property of undefined"',
  'compare Postgres vs SQLite for our side project and recommend one',
  'draft an email to the customer apologizing for the outage',
  'plot month-over-month revenue from this CSV and call out anomalies',
  'break the epic into user stories with acceptance criteria',
  'find where we authenticate API keys in this repo',
  'help me understand what a binary search tree is',
  'refactor this React component to use hooks instead of a class',
  'check my migration script for data loss risks',
  'write release notes for version 2.4 from these commit messages',
];

function runSanity(model) {
  return SANITY_PROMPTS.map((text) => {
    const digest = { prompts: [text], tools: [] };
    const p = predictLearned(model, digest, ALL_CATEGORIES);
    return { prompt: text, category: p?.category ?? null, confidence: p?.confidence ?? null };
  });
}

// ── Main ──────────────────────────────────────────────────────────────────────

async function main() {
  console.log('Loading public datasets...');
  const loaded = [];
  for (const spec of DATASET_SPECS) {
    console.log(`Dataset: ${spec.name}`);
    const rows = await fetchAllRows(spec, OFFLINE);
    const examples = toTrainingExamples(spec, rows);
    console.log(`  → ${examples.length} mapped examples`);
    loaded.push({ spec, examples });
  }

  const allExamples = loaded.flatMap((x) => x.examples);
  const balanced = balanceByCategory(allExamples, CAP_PER_CLASS);

  const countsByClass = {};
  const countsByDataset = {};
  for (const ex of balanced) {
    countsByClass[ex.category] = (countsByClass[ex.category] ?? 0) + 1;
    countsByDataset[ex.dataset] = (countsByDataset[ex.dataset] ?? 0) + 1;
  }

  const { train, test } = stratifiedSplit(balanced, TEST_FRAC);

  let model = trainLearned(train);
  model = pruneModel(model, { minCount: MIN_FEATURE_COUNT, topNPerClass: TOP_N_PER_CLASS });

  const holdout = evaluate(model, test);
  const cross = crossDatasetEval(balanced, DATASET_SPECS.map((s) => s));

  const crossScored = Object.values(cross.perDataset).filter((r) => !r.skipped);
  const crossBeatsBaseline =
    crossScored.length > 0 &&
    crossScored.every(
      (r) => r.accuracy > r.majorityBaseline + 0.02 && r.macroF1 > r.majorityBaseline + 0.02,
    );
  const beatsBaseline =
    holdout.accuracy > holdout.majorityBaseline + 0.05 &&
    holdout.macroF1 > 0.35 &&
    crossBeatsBaseline;

  const sanity = runSanity(model);

  mkdirSync(path.dirname(MODEL_PATH), { recursive: true });
  writeFileSync(MODEL_PATH, JSON.stringify(model), 'utf-8');

  const meta = {
    trainedAt: new Date().toISOString(),
    recommended: beatsBaseline,
    datasets: DATASET_SPECS.map((s) => ({
      id: s.id,
      name: s.name,
      license: s.license,
      url: s.url,
      examplesUsed: countsByDataset[s.id] ?? 0,
    })),
    rejectedDatasets: [
      {
        name: 'lmsys/lmsys-chat-1m',
        reason: 'Not accessible via public datasets-server (gated/private).',
      },
      {
        name: 'irfanalee/github-code-review-full',
        reason: 'No parquet config on datasets-server; raw JSONL paths not available without LFS pull.',
      },
      {
        name: 'allenai/WildChat',
        reason: 'Ungated download works but has no intent/task labels suitable for honest mapping.',
      },
    ],
    labelMappings: {
      dolly: DOLLY_MAP,
      no_robots: NO_ROBOTS_MAP,
      code_instructions: { code_instruction: 'coding' },
      swe_bench: { bug_report: 'debugging' },
      sql_context: { text_to_sql: 'analysis' },
      github_codereview: { code_review: 'review' },
    },
    training: {
      seed: SEED,
      capPerClass: CAP_PER_CLASS,
      trainExamples: train.length,
      testExamples: test.length,
      minFeatureCount: MIN_FEATURE_COUNT,
      topNPerClass: TOP_N_PER_CLASS,
    },
    examplesPerClass: countsByClass,
    evaluation: {
      holdout,
      crossDataset: cross,
    },
    sanity,
    limitations:
      'Labels come from general instruction-tuning corpora (Q&A, summarization, coding exercises, bug reports, SQL questions, code-review diffs), not from Claude Code session logs. Categories such as planning and debugging are represented by narrower proxies (brainstorming prompts, SWE-bench issue text). Expect confusion between writing vs research, coding vs debugging, and analysis vs research on short prompts. The model should be treated as a weak default prior until a project trains on its own tagged sessions.',
  };

  writeFileSync(META_PATH, JSON.stringify(meta, null, 2), 'utf-8');

  console.log('\nDone.');
  console.log(`  prior.json: ${MODEL_PATH}`);
  console.log(`  holdout accuracy ${holdout.accuracy} macro-F1 ${holdout.macroF1} baseline ${holdout.majorityBaseline}`);
  console.log(`  cross-dataset avg macro-F1 ${cross.avgMacroF1}`);
  console.log(`  recommended: ${beatsBaseline}`);
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
