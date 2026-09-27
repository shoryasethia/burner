import { readFileSync, writeFileSync, mkdirSync, existsSync, statSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import path from 'node:path';
import os from 'node:os';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const cacheDir = path.join(os.homedir(), '.burner-cc-cache');
const cacheFile = path.join(cacheDir, 'litellm-pricing.json');
const fallbackFile = path.join(__dirname, 'pricing-fallback.json');

const SOURCE_URL = 'https://raw.githubusercontent.com/BerriAI/litellm/main/model_prices_and_context_window.json';
const TTL_MS = 6 * 60 * 60 * 1000; // 6h — pricing changes rarely, this just avoids hammering GitHub.

// Anthropic bare-alias shorthands Claude Code sometimes writes instead of a
// dated/versioned model id (e.g. subagent transcripts saying "sonnet").
const ALIAS_FAMILIES = ['opus', 'sonnet', 'haiku', 'fable', 'mythos'];

function toRates(entry, displayName) {
  const mtok = 1_000_000;
  return {
    displayName,
    input: entry.input_cost_per_token * mtok,
    output: entry.output_cost_per_token * mtok,
    cacheWrite5m: (entry.cache_creation_input_token_cost ?? 0) * mtok,
    cacheWrite1h: (entry.cache_creation_input_token_cost_above_1hr ?? entry.cache_creation_input_token_cost ?? 0) * mtok,
    cacheRead: (entry.cache_read_input_token_cost ?? 0) * mtok,
  };
}

function buildTableFromLiteLLM(raw) {
  const models = {};
  for (const [key, entry] of Object.entries(raw)) {
    if (entry.litellm_provider !== 'anthropic' || entry.mode !== 'chat') continue;
    if (typeof entry.input_cost_per_token !== 'number' || typeof entry.output_cost_per_token !== 'number') continue;
    models[key] = toRates(entry, prettyName(key));
  }
  return models;
}

function prettyName(modelId) {
  const parts = modelId.split('-').filter((p) => p !== 'claude');
  if (!parts.length) return modelId;
  const family = parts[0][0].toUpperCase() + parts[0].slice(1);
  const rest = parts.slice(1).join('.');
  return rest ? `Claude ${family} ${rest}` : `Claude ${family}`;
}

async function fetchLiteLLMTable() {
  const res = await fetch(SOURCE_URL, { signal: AbortSignal.timeout(8000) });
  if (!res.ok) throw new Error(`pricing source returned ${res.status}`);
  const raw = await res.json();
  return buildTableFromLiteLLM(raw);
}

function readCache() {
  if (!existsSync(cacheFile)) return null;
  try {
    return JSON.parse(readFileSync(cacheFile, 'utf-8'));
  } catch {
    return null;
  }
}

function writeCache(models) {
  mkdirSync(cacheDir, { recursive: true });
  writeFileSync(cacheFile, JSON.stringify({ fetchedAt: Date.now(), models }, null, 2), 'utf-8');
}

function cacheIsFresh(cache) {
  return cache && Date.now() - cache.fetchedAt < TTL_MS;
}

// Resolves the full pricing table once per CLI invocation: fresh cache wins,
// otherwise re-fetch from LiteLLM's community-maintained (Anthropic-sourced)
// pricing JSON, falling back to a stale cache or the bundled snapshot if
// offline. This is the whole point: nobody has to hand-edit prices.
export async function loadPricingTable() {
  const cache = readCache();
  if (cacheIsFresh(cache)) {
    return { models: cache.models, source: 'cache', fetchedAt: cache.fetchedAt };
  }

  try {
    const models = await fetchLiteLLMTable();
    writeCache(models);
    return { models, source: 'live', fetchedAt: Date.now() };
  } catch (err) {
    if (cache) {
      return { models: cache.models, source: 'stale-cache', fetchedAt: cache.fetchedAt, error: err.message };
    }
    const fallback = JSON.parse(readFileSync(fallbackFile, 'utf-8'));
    return { models: fallback.models, source: 'bundled-fallback', fetchedAt: null, error: err.message };
  }
}

function resolveAlias(rawModel, models) {
  const family = ALIAS_FAMILIES.find((f) => rawModel === f || rawModel.startsWith(f + '-'));
  if (!family) return null;
  // Pick the newest-looking concrete model in that family: prefer bare
  // "claude-<family>-<N>" ids (no date suffix) and take the highest one.
  const candidates = Object.keys(models).filter((k) => k.startsWith(`claude-${family}-`) && /^claude-[a-z]+-[\d.]+$/.test(k));
  candidates.sort((a, b) => b.localeCompare(a, undefined, { numeric: true }));
  return candidates[0] ?? null;
}

export function lookupPricing(rawModel, table) {
  if (!rawModel) return { fidelity: 'unknown', rates: null, displayName: 'unknown model' };
  const models = table.models;

  if (models[rawModel]) {
    return { fidelity: 'measured', rates: models[rawModel], displayName: models[rawModel].displayName };
  }

  const aliasTarget = resolveAlias(rawModel, models);
  if (aliasTarget) {
    const rates = models[aliasTarget];
    return { fidelity: 'approximate-alias', rates, displayName: `${rates.displayName} (via alias "${rawModel}")` };
  }

  // Longest-prefix match as a last resort (handles dated variants Claude
  // Code might report that aren't in the pricing source verbatim).
  const prefixMatch = Object.keys(models)
    .filter((k) => rawModel.startsWith(k) || k.startsWith(rawModel))
    .sort((a, b) => b.length - a.length)[0];
  if (prefixMatch) {
    const rates = models[prefixMatch];
    return { fidelity: 'approximate-alias', rates, displayName: `${rates.displayName} (matched from "${rawModel}")` };
  }

  return { fidelity: 'unpriced', rates: null, displayName: rawModel };
}

export function costFor(usage, rates) {
  if (!rates) return null;
  const mtok = 1_000_000;
  const cacheWrite5m = usage.cacheWrite5m ?? 0;
  const cacheWrite1h = usage.cacheWrite1h ?? 0;
  const input = (usage.input / mtok) * rates.input;
  const output = (usage.output / mtok) * rates.output;
  const cacheWrite = (cacheWrite5m / mtok) * rates.cacheWrite5m + (cacheWrite1h / mtok) * rates.cacheWrite1h;
  const cacheRead = (usage.cacheRead / mtok) * rates.cacheRead;
  return { input, output, cacheWrite, cacheRead, total: input + output + cacheWrite + cacheRead };
}
