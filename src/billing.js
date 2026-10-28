import { lookupPricing, costFor } from './pricing.js';

const zeroTokens = () => ({ input: 0, output: 0, cacheWrite5m: 0, cacheWrite1h: 0, cacheRead: 0 });
const zeroCost = () => ({ input: 0, output: 0, cacheWrite: 0, cacheRead: 0, total: 0 });

function usageTok(v) {
  const n = Number(v);
  return Number.isFinite(n) && n > 0 ? Math.floor(n) : 0;
}

function tokensFromUsage(u) {
  const cc = u.cacheCreation ?? {};
  const hasSplit = cc.ephemeral_5m_input_tokens != null || cc.ephemeral_1h_input_tokens != null;
  const created = usageTok(u.cacheCreationInputTokens ?? u.cache_creation_input_tokens);
  return {
    input: usageTok(u.inputTokens ?? u.input_tokens),
    output: usageTok(u.outputTokens ?? u.output_tokens),
    cacheWrite5m: hasSplit ? usageTok(cc.ephemeral_5m_input_tokens) : created,
    cacheWrite1h: hasSplit ? usageTok(cc.ephemeral_1h_input_tokens) : 0,
    cacheRead: usageTok(u.cacheReadInputTokens ?? u.cache_read_input_tokens),
  };
}

function addTokens(into, t) {
  into.input += t.input;
  into.output += t.output;
  into.cacheWrite5m += t.cacheWrite5m;
  into.cacheWrite1h += t.cacheWrite1h;
  into.cacheRead += t.cacheRead;
}

function addCost(into, c) {
  if (!c) return;
  for (const k of Object.keys(into)) into[k] += c[k];
}

function scaleCost(calc, billed) {
  if (!calc || calc.total <= 0) {
    return { input: 0, output: 0, cacheWrite: 0, cacheRead: 0, total: billed };
  }
  if (Math.abs(calc.total - billed) < 1e-6) return { ...calc, total: billed };
  const f = billed / calc.total;
  return {
    input: calc.input * f,
    output: calc.output * f,
    cacheWrite: calc.cacheWrite * f,
    cacheRead: calc.cacheRead * f,
    total: billed,
  };
}

/** Claude Code's cumulative session total from the last cost-state line (if any). */
export function ccReportedCost(reported) {
  if (!reported?.modelUsage) return null;
  if (typeof reported.totalCostUSD === 'number') return reported.totalCostUSD;
  let total = 0;
  for (const u of Object.values(reported.modelUsage)) {
    const n = u?.costUSD ?? u?.totalCost ?? u?.cost;
    if (typeof n === 'number') total += n;
  }
  return total > 0 ? total : null;
}

export function hasCostState(reported) {
  return !!(reported?.modelUsage && Object.keys(reported.modelUsage).length);
}

/**
 * Bill from Claude Code's cost-state when present. That line is the only
 * on-disk total that includes subagents, title generation, compaction, etc.
 * Transcript token sums alone routinely disagree (often lower, sometimes
 * higher when subagent jsonl is summed on top of an already-rollup cost-state).
 */
export function priceFromCostState(reported, table) {
  if (!hasCostState(reported)) return null;

  const models = [];
  const tokens = zeroTokens();
  const cost = zeroCost();

  for (const [rawModel, u] of Object.entries(reported.modelUsage)) {
    const t = tokensFromUsage(u);
    const billed = typeof u.costUSD === 'number' ? u.costUSD : typeof u.totalCost === 'number' ? u.totalCost : typeof u.cost === 'number' ? u.cost : 0;
    const { rates } = lookupPricing(rawModel, table);
    const calc = costFor({ ...t, output: t.output }, rates);
    const modelCost = scaleCost(calc, billed);

    models.push({
      rawModel,
      fidelity: 'reported',
      turnCount: 0,
      unreported: 0,
      tokens: t,
      cost: modelCost,
      unpriced: false,
    });
    addTokens(tokens, t);
    addCost(cost, modelCost);
  }

  models.sort((a, b) => b.cost.total - a.cost.total || (b.tokens.input + b.tokens.output) - (a.tokens.input + a.tokens.output));

  if (typeof reported.totalCostUSD === 'number') {
    cost.total = reported.totalCostUSD;
  }

  return { models, tokens, cost };
}
