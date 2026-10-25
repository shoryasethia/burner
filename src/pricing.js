import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import path from 'node:path';
import { execFile } from 'node:child_process';
import { FILES, readJson, writeJson, loadPricingOverrides } from './config.js';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const fallbackFile = path.join(__dirname, 'pricing-fallback.json');

export const SOURCE_URL = 'https://raw.githubusercontent.com/BerriAI/litellm/main/model_prices_and_context_window.json';
const TTL_MS = 24 * 60 * 60 * 1000;
const RATE_KEYS = ['input', 'output', 'cacheWrite5m', 'cacheWrite1h', 'cacheRead'];

async function fetchText(url, timeoutMs = 15000) {
  try {
    const res = await fetch(url, { signal: AbortSignal.timeout(timeoutMs) });
    if (!res.ok) throw new Error(`HTTP ${res.status}`);
    return await res.text();
  } catch (err) {
    // Node's fetch ignores HTTP(S)_PROXY; curl honours it.
    const proxy = process.env.HTTPS_PROXY || process.env.https_proxy || process.env.HTTP_PROXY || process.env.http_proxy;
    const args = ['--silent', '--show-error', '--fail', '--location', '--max-time', String(Math.ceil(timeoutMs / 1000)), '--compressed'];
    if (proxy) args.push('--proxy', proxy);
    args.push(url);
    return new Promise((resolve, reject) => {
      execFile('curl', args, { maxBuffer: 64 * 1024 * 1024 }, (cerr, stdout, stderr) => {
        if (cerr) reject(new Error(`${err.message}; curl: ${(stderr || cerr.message).trim()}`));
        else resolve(stdout);
      });
    });
  }
}

const PROVIDER_PREFIX = /^(anthropic|bedrock|bedrock_converse|vertex_ai|vertex_ai_beta|openrouter|azure|azure_ai|openai|google|gemini|deepseek|mistral|groq|together_ai|fireworks_ai|xai|ollama|ollama_chat|zai|moonshot|dashscope|databricks|litellm_proxy)\//;

// Collapses the many spellings of one model to a lookup key:
// "us.anthropic.claude-sonnet-4-5-20250929-v1:0" → "claude-sonnet-4-5",
// "claude-opus-4-1@20250805" → "claude-opus-4-1", "claude-sonnet-4[1m]" → "claude-sonnet-4".
export function normalizeModelId(raw) {
  let s = String(raw ?? '').trim().toLowerCase();
  for (let i = 0; i < 3 && PROVIDER_PREFIX.test(s); i++) s = s.replace(PROVIDER_PREFIX, '');
  s = s.replace(/\[[^\]]*\]$/, '');
  s = s.replace(/^(us|eu|apac|global|au|jp)\./, '').replace(/^anthropic\./, '');
  s = s.replace(/-v\d+(:\d+)?$/, '').replace(/:\d+$/, '');
  s = s.replace(/@[a-z0-9-]+$/, '').replace(/-\d{8}$/, '').replace(/-latest$/, '');
  return s;
}

export function isClaudeModel(raw) {
  const n = normalizeModelId(raw);
  return n.startsWith('claude-') || /^(opus|sonnet|haiku|fable|mythos)(-|$)/.test(n);
}

function toRates(entry) {
  const perM = (v) => Math.round(v * 1_000_000 * 1e6) / 1e6;
  const inp = entry.input_cost_per_token;
  return {
    input: perM(inp),
    output: perM(entry.output_cost_per_token),
    cacheWrite5m: perM(entry.cache_creation_input_token_cost ?? inp * 1.25),
    cacheWrite1h: perM(entry.cache_creation_input_token_cost_above_1hr ?? inp * 2),
    cacheRead: perM(entry.cache_read_input_token_cost ?? inp * 0.1),
  };
}

const PROVIDER_RANK = { anthropic: 0, openai: 1, gemini: 2, vertex_ai: 3, deepseek: 4, mistral: 5, xai: 6, zai: 7, moonshot: 8, dashscope: 9 };

// Keyed by normalized id. For each id, the first-party provider's price wins
// over resellers (OpenRouter, Bedrock regional markups, …).
export function buildTable(raw) {
  const models = {};
  const rank = {};
  for (const [key, entry] of Object.entries(raw)) {
    if (!entry || typeof entry !== 'object') continue;
    if (entry.mode && entry.mode !== 'chat' && entry.mode !== 'responses') continue;
    if (typeof entry.input_cost_per_token !== 'number' || typeof entry.output_cost_per_token !== 'number') continue;
    const id = normalizeModelId(key);
    if (!id) continue;
    const r = PROVIDER_RANK[entry.litellm_provider] ?? 50;
    const hasPrefix = PROVIDER_PREFIX.test(key.toLowerCase()) || /^(us|eu|apac|global)\./.test(key);
    const score = r * 2 + (hasPrefix ? 1 : 0);
    if (rank[id] != null && rank[id] <= score) continue;
    rank[id] = score;
    models[id] = { ...toRates(entry), provider: entry.litellm_provider ?? null, sourceKey: key };
  }
  return models;
}

export async function refreshPricing() {
  const text = await fetchText(SOURCE_URL);
  const models = buildTable(JSON.parse(text));
  if (Object.keys(models).length < 50) throw new Error('pricing source looked truncated');
  const fetchedAt = Date.now();
  writeJson(FILES.pricingCache, { fetchedAt, url: SOURCE_URL, models });
  return { models, source: 'live', fetchedAt };
}

// Resolved once per run: fresh cache, else live fetch, else stale cache,
// else the bundled snapshot. User overrides from pricing.yaml are layered
// on top by lookupPricing.
export async function loadPricingTable({ force = false, offline = false } = {}) {
  const overrides = loadPricingOverrides();
  const cache = readJson(FILES.pricingCache, null);
  const fresh = cache?.models && Date.now() - cache.fetchedAt < TTL_MS;
  if (fresh && !force) return { models: cache.models, overrides, source: 'cache', fetchedAt: cache.fetchedAt };
  if (!offline) {
    try {
      return { ...(await refreshPricing()), overrides };
    } catch (err) {
      if (cache?.models) return { models: cache.models, overrides, source: 'stale-cache', fetchedAt: cache.fetchedAt, error: err.message };
      const fb = JSON.parse(readFileSync(fallbackFile, 'utf-8'));
      return { models: fb.models, overrides, source: 'bundled-fallback', fetchedAt: fb.capturedAt ?? null, error: err.message };
    }
  }
  if (cache?.models) return { models: cache.models, overrides, source: 'cache', fetchedAt: cache.fetchedAt };
  const fb = JSON.parse(readFileSync(fallbackFile, 'utf-8'));
  return { models: fb.models, overrides, source: 'bundled-fallback', fetchedAt: fb.capturedAt ?? null };
}

const ALIAS_FAMILIES = ['opus', 'sonnet', 'haiku', 'fable', 'mythos'];

function versionOf(id) {
  return id.replace(/^claude-[a-z]+-?/, '').split(/[-.]/).map(Number);
}

function newestInFamily(family, models) {
  const ids = Object.keys(models).filter((k) => new RegExp(`^claude-${family}(-[\\d.]+)*(-\\d)?$`).test(k));
  ids.sort((a, b) => {
    const va = versionOf(a);
    const vb = versionOf(b);
    for (let i = 0; i < Math.max(va.length, vb.length); i++) {
      const d = (vb[i] ?? 0) - (va[i] ?? 0);
      if (d) return d;
    }
    return 0;
  });
  return ids[0] ?? null;
}

function cleanRates(r) {
  const out = {};
  for (const k of RATE_KEYS) out[k] = Number(r?.[k]) || 0;
  return out;
}

function findOverride(rawModel, overrides) {
  if (!overrides) return null;
  if (overrides[rawModel]) return overrides[rawModel];
  const n = normalizeModelId(rawModel);
  for (const [k, v] of Object.entries(overrides)) if (normalizeModelId(k) === n) return v;
  return null;
}

// Returns { rates, fidelity, suggested }
//   fidelity: override | measured | approximate-alias | unpriced
//   unpriced → rates are all zero; `suggested` carries the public list price
//   when one exists so the Pricing page can offer it.
export function lookupPricing(rawModel, table) {
  if (!rawModel) return { fidelity: 'unpriced', rates: cleanRates(null), suggested: null };
  const models = table.models ?? {};
  const override = findOverride(rawModel, table.overrides);
  const n = normalizeModelId(rawModel);
  const claude = isClaudeModel(rawModel);

  let publicRates = models[n] ?? models[rawModel] ?? null;
  let fidelity = 'measured';
  if (!publicRates && claude) {
    const family = ALIAS_FAMILIES.find((f) => n === f || n.startsWith(f + '-') || n === `claude-${f}`);
    const target = family ? newestInFamily(family, models) : null;
    if (target) {
      publicRates = models[target];
      fidelity = 'approximate-alias';
    }
  }

  if (override) return { fidelity: 'override', rates: cleanRates(override), suggested: publicRates ? cleanRates(publicRates) : null };
  if (publicRates && claude) {
    return { fidelity, rates: cleanRates(publicRates), suggested: null };
  }
  // Non-Claude model behind the Claude Code harness (gateway, on-prem, local):
  // we can't know what it costs this user, so it's $0 until they say otherwise.
  return { fidelity: 'unpriced', rates: cleanRates(null), suggested: publicRates ? cleanRates(publicRates) : null };
}

// Looks a model id up in the public price list: exact (after normalizing
// provider prefixes / dates), else the newest Claude of the same family,
// else close matches the user can pick from.
export function lookupPublic(rawModel, table) {
  const models = table.models ?? {};
  const n = normalizeModelId(rawModel);
  const exact = models[n] ?? models[String(rawModel).trim().toLowerCase()];
  if (exact) {
    const id = models[n] ? n : String(rawModel).trim().toLowerCase();
    return { found: true, match: 'exact', id, rates: cleanRates(exact), provider: exact.provider ?? null, sourceKey: exact.sourceKey ?? id };
  }
  const q = n.replace(/[^a-z0-9]/g, '');
  const common = (k) => { let i = 0; while (i < q.length && i < k.length && q[i] === k[i]) i++; return i; };
  const scored = [];
  for (const id of Object.keys(models)) {
    const k = id.replace(/[^a-z0-9]/g, '');
    const score = q.length >= 3 && (k.includes(q) || q.includes(k)) ? 100 : common(k);
    if (score >= 5) scored.push([id, score]);
  }
  scored.sort((x, y) => y[1] - x[1] || x[0].length - y[0].length);
  const candidates = scored.slice(0, 8).map(([id]) => ({ id, rates: cleanRates(models[id]), provider: models[id].provider ?? null }));
  return { found: false, match: 'none', id: n, candidates };
}

export function costFor(usage, rates) {
  if (!rates) return null;
  const mtok = 1_000_000;
  const input = ((usage.input ?? 0) / mtok) * rates.input;
  const output = ((usage.output ?? 0) / mtok) * rates.output;
  const cacheWrite = ((usage.cacheWrite5m ?? 0) / mtok) * rates.cacheWrite5m + ((usage.cacheWrite1h ?? 0) / mtok) * rates.cacheWrite1h;
  const cacheRead = ((usage.cacheRead ?? 0) / mtok) * rates.cacheRead;
  return { input, output, cacheWrite, cacheRead, total: input + output + cacheWrite + cacheRead };
}

export function pricingInfo(table) {
  return { source: table.source, fetchedAt: table.fetchedAt ?? null, error: table.error ?? null, url: SOURCE_URL, modelCount: Object.keys(table.models ?? {}).length };
}