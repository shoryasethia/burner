import { readFileSync, writeFileSync, mkdirSync, existsSync, renameSync } from 'node:fs';
import path from 'node:path';
import os from 'node:os';
import { parseYaml, stringifyYaml } from './yaml.js';

export const HOME = process.env.BURNER_HOME ?? path.join(os.homedir(), '.burner');
export const CLAUDE_HOME = process.env.CLAUDE_CONFIG_DIR ?? path.join(os.homedir(), '.claude');
export const FILES = {
  config: path.join(HOME, 'config.yaml'),
  pricing: path.join(HOME, 'pricing.yaml'),
  tags: path.join(HOME, 'tags.json'),
  assignments: path.join(HOME, 'assignments.json'),
  pricingCache: path.join(HOME, 'cache', 'litellm-pricing.json'),
  model: path.join(HOME, 'model', 'intent-nb.json'),
};

// What people use Claude Code for, by intent rather than by tool mechanics.
// Order matters only for display.
export const DEFAULT_CATEGORIES = [
  { id: 'coding', label: 'Coding', color: '#2563eb', description: 'Building or changing something: code, scripts, apps, automations, files' },
  { id: 'debugging', label: 'Debugging', color: '#dc2626', description: 'Figuring out why something is broken and fixing it' },
  { id: 'planning', label: 'Planning', color: '#059669', description: 'Deciding what to build or do: strategy, specs, designs, roadmaps, breakdowns' },
  { id: 'research', label: 'Research', color: '#475569', description: 'Finding out how something works: exploring files, docs, the web, options' },
  { id: 'writing', label: 'Writing', color: '#b45309', description: 'Docs, emails, reports, slides, copy, summaries' },
  { id: 'analysis', label: 'Analysis', color: '#0d9488', description: 'Working with data, numbers, metrics, spreadsheets, charts' },
  { id: 'review', label: 'Review', color: '#c2410c', description: 'Checking someone\'s work: code, documents, plans, feedback' },
  { id: 'learning', label: 'Learning', color: '#64748b', description: 'Questions and explanations, no real work product' },
  { id: 'other', label: 'Other', color: '#94a3b8', description: 'Anything that does not fit above' },
];

// Ids from earlier versions, mapped to the current set.
export const LEGACY_CATEGORY_IDS = { feature: 'coding', refactor: 'coding', testing: 'coding', devops: 'coding', bugfix: 'debugging', docs: 'writing', data: 'analysis' };
export const mapLegacyCategory = (id) => LEGACY_CATEGORY_IDS[id] ?? id;

export const THEMES = ['paper', 'thermal', 'matrix', 'dark'];
export const RANGES = ['all', '7', '30', '90', 'custom'];
const DAY_RE = /^\d{4}-\d{2}-\d{2}$/;
export const UNTAGGED = { id: 'untagged', label: 'Untagged', color: '#a8a29e', description: 'No tag yet' };

// Tagging levels, lowest to highest — mirrors Claude Code's effort slider.
export const TAGGING_LEVELS = [
  { id: 'off', label: 'Off', description: 'Never tag. Sessions stay untagged unless the project has a default. Burner removes the global /burner-tag skill and hooks from ~/.claude.' },
  { id: 'manual', label: 'Manual', description: 'Only when you run /burner-tag. Burner keeps the skill installed globally; no CLAUDE.md reminder.' },
  { id: 'session', label: 'Session end', description: 'Tag when a session ends: SessionEnd hook + your Anthropic model id (below), or /burner-tag via CLAUDE.md if no model id. Burner updates ~/.claude when you move the slider.' },
  { id: 'task', label: 'Every task', description: 'Claude tags after each distinct task (/burner-tag with --task). Burner adds a CLAUDE.md block and keeps the skill installed.' },
];

export function defaultConfig() {
  return {
    version: 1,
    categories: DEFAULT_CATEGORIES.map((c) => ({ ...c })),
    projects: [],
    tagging: {
      level: 'manual',
      learned: true,
      endModel: '',
    },
    ui: { theme: 'paper', range: 'all', customFrom: '', customTo: '' },
  };
}

function readText(file) {
  try {
    return readFileSync(file, 'utf-8');
  } catch {
    return null;
  }
}

function writeAtomic(file, text) {
  mkdirSync(path.dirname(file), { recursive: true });
  const tmp = `${file}.tmp`;
  writeFileSync(tmp, text, 'utf-8');
  renameSync(tmp, file);
}

const CONFIG_HEADER = '# burner config — edited from the Settings page (burner serve). Safe to hand-edit.\n';

function normalizeConfig(raw) {
  const base = defaultConfig();
  const cfg = { ...base, ...(raw ?? {}) };
  if (Array.isArray(cfg.categories) && cfg.categories.some((x) => LEGACY_CATEGORY_IDS[x?.id]) && !cfg.categories.some((x) => x?.id === 'coding')) cfg.categories = null;
  cfg.categories = Array.isArray(cfg.categories) && cfg.categories.length
    ? cfg.categories.filter((c) => c?.id).map((c) => ({ id: String(c.id), label: c.label ?? c.id, color: c.color ?? '#888888', description: c.description ?? '' }))
    : base.categories;
  cfg.projects = Array.isArray(cfg.projects)
    ? cfg.projects.filter((p) => p?.name).map((p) => ({
        name: String(p.name),
        paths: (p.paths ?? []).map(String),
        categories: [...new Set((p.categories ?? []).map(String).map(mapLegacyCategory))],
        defaultCategory: p.defaultCategory ? mapLegacyCategory(p.defaultCategory) : null,
      }))
    : [];
  cfg.tagging = { ...base.tagging, ...(cfg.tagging ?? {}) };
  delete cfg.tagging.auto;
  if (cfg.tagging.level === 'auto') cfg.tagging.level = 'manual';
  cfg.tagging.endModel = String(cfg.tagging.endModel ?? '').trim();
  const ui = cfg.ui ?? {};
  cfg.ui = {
    theme: THEMES.includes(ui.theme) ? ui.theme : 'paper',
    range: RANGES.includes(String(ui.range)) ? String(ui.range) : 'all',
    customFrom: DAY_RE.test(String(ui.customFrom ?? '')) ? String(ui.customFrom) : '',
    customTo: DAY_RE.test(String(ui.customTo ?? '')) ? String(ui.customTo) : '',
  };
  if (!TAGGING_LEVELS.some((l) => l.id === cfg.tagging.level)) cfg.tagging.level = base.tagging.level;
  return cfg;
}

export function loadConfig() {
  migrateLegacy();
  const text = readText(FILES.config);
  if (text == null) return defaultConfig();
  return normalizeConfig(parseYaml(text));
}

export function saveConfig(cfg) {
  const clean = normalizeConfig(cfg);
  writeAtomic(FILES.config, CONFIG_HEADER + stringifyYaml(clean) + '\n');
  return clean;
}

// pricing.yaml: { models: { "<raw model id>": { input, output, cacheWrite5m, cacheWrite1h, cacheRead } } }
// Rates are USD per million tokens. A model listed here always wins over the fetched table.
export function loadPricingOverrides() {
  migrateLegacy();
  const text = readText(FILES.pricing);
  if (text == null) return {};
  const parsed = parseYaml(text);
  return parsed?.models ?? {};
}

export function savePricingOverrides(models) {
  const clean = {};
  for (const [id, r] of Object.entries(models ?? {})) {
    if (!r) continue;
    clean[id] = {};
    for (const k of ['input', 'output', 'cacheWrite5m', 'cacheWrite1h', 'cacheRead']) clean[id][k] = Number(r[k]) || 0;
  }
  writeAtomic(FILES.pricing, '# USD per million tokens. Edited from the Pricing page; models not listed use fetched public rates (Claude) or $0.\n' + stringifyYaml({ models: clean }) + '\n');
  return clean;
}

export function readJson(file, fallback) {
  const text = readText(file);
  if (text == null) return fallback;
  try {
    return JSON.parse(text);
  } catch {
    return fallback;
  }
}

export function writeJson(file, value) {
  writeAtomic(file, JSON.stringify(value, null, 2));
}

let migrated = false;
// One-time import from the old ~/.ti-burner layout.
function migrateLegacy() {
  if (migrated) return;
  migrated = true;
  const legacy = path.join(os.homedir(), '.ti-burner');
  if (!existsSync(legacy) || HOME === legacy) return;
  const overrides = readJson(path.join(legacy, 'overrides.json'), null);
  if (overrides && !existsSync(FILES.tags)) {
    const map = { 'Feature Work': 'coding', 'Bug Fix': 'debugging', Research: 'research', Planning: 'planning', Meetings: 'other', Documentation: 'writing', 'Data Analysis': 'analysis', 'Q&A': 'learning', Other: 'other' };
    const tags = {};
    for (const [id, cat] of Object.entries(overrides)) {
      tags[id] = { category: map[cat] ?? 'other', source: 'manual', at: new Date().toISOString(), segments: [] };
    }
    writeJson(FILES.tags, tags);
  }
  const custom = readJson(path.join(legacy, 'custom-pricing.json'), null);
  if (custom && !existsSync(FILES.pricing)) {
    const models = {};
    for (const [id, r] of Object.entries(custom)) {
      const rid = id.replace(/ \(billed-unpriced\)$/, '');
      const rates = ['input', 'output', 'cacheWrite5m', 'cacheWrite1h', 'cacheRead'].map((k) => Number(r?.[k]) || 0);
      if (rates.some((v) => v > 0)) models[rid] = r;
    }
    if (Object.keys(models).length) savePricingOverrides(models);
  }
}

function normPath(p) {
  let s = path.resolve(p).replace(/[\\/]+$/, '');
  if (process.platform === 'win32' || /^[a-z]:/i.test(s)) s = s.toLowerCase().replace(/\//g, '\\');
  return s;
}

function isUnder(child, parent) {
  if (child === parent) return true;
  const sep = parent.includes('\\') ? '\\' : '/';
  return child.startsWith(parent.endsWith(sep) ? parent : parent + sep);
}

// The project a working directory belongs to: the configured project whose
// path is the longest prefix of cwd, else an implicit project named after
// the directory.
export function resolveProject(cwd, cfg) {
  if (!cwd) return { name: 'unknown', implicit: true, categories: [], defaultCategory: null };
  const target = normPath(cwd);
  let best = null;
  let bestLen = -1;
  for (const p of cfg.projects) {
    for (const dir of p.paths) {
      const n = normPath(dir);
      if (isUnder(target, n) && n.length > bestLen) {
        best = p;
        bestLen = n.length;
      }
    }
  }
  if (best) return { ...best, implicit: false };
  const home = normPath(os.homedir());
  const name = target === home ? '~' : path.basename(cwd) || cwd;
  return { name, implicit: true, categories: [], defaultCategory: null };
}

export function categoryIds(cfg) {
  return cfg.categories.map((c) => c.id);
}
