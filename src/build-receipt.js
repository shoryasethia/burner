import { parseTranscript, timeRange, mergeParsed } from './parse.js';
import { resolveSubagentType } from './discover.js';
import { hasCostState, priceFromCostState } from './billing.js';
import { lookupPricing, costFor, loadPricingTable } from './pricing.js';

// Shown on the receipt and in --json. The dollars below are a slice of the
// session total, not a second charge.
export const ATTRIBUTION_NOTE =
  'Call output is that API request\'s output tokens. Context added is the next request\'s fresh input and cache write — an upper bound, since it also includes the call message. These amounts are already inside the session total. MCP tool schemas cached in the prompt are not in the transcript.';

function summarizeTurns(turns, table) {
  const byModel = new Map();

  for (const t of turns) {
    const key = t.model;
    if (!byModel.has(key)) {
      const priced = lookupPricing(t.model, table);
      byModel.set(key, {
        rawModel: t.model,
        fidelity: priced.fidelity,
        rates: priced.rates,
        tokens: { input: 0, output: 0, cacheWrite5m: 0, cacheWrite1h: 0, cacheRead: 0 },
        turnCount: 0,
      });
    }
    const bucket = byModel.get(key);
    bucket.turnCount += 1;
    bucket.tokens.input += t.input;
    bucket.tokens.output += t.output;
    bucket.tokens.cacheWrite5m += t.cacheWrite5m;
    bucket.tokens.cacheWrite1h += t.cacheWrite1h;
    bucket.tokens.cacheRead += t.cacheRead;
  }

  const models = [];
  for (const bucket of byModel.values()) {
    const cost = costFor(bucket.tokens, bucket.rates);
    models.push({
      rawModel: bucket.rawModel,
      fidelity: bucket.fidelity,
      turnCount: bucket.turnCount,
      tokens: bucket.tokens,
      cost, // null if unpriced
    });
  }
  return models;
}

function sumCost(models) {
  return models.reduce((acc, m) => {
    if (!m.cost) return acc;
    acc.input += m.cost.input;
    acc.output += m.cost.output;
    acc.cacheWrite += m.cost.cacheWrite;
    acc.cacheRead += m.cost.cacheRead;
    acc.total += m.cost.total;
    return acc;
  }, { input: 0, output: 0, cacheWrite: 0, cacheRead: 0, total: 0 });
}

function sumTokens(models) {
  return models.reduce((acc, m) => {
    acc.input += m.tokens.input;
    acc.output += m.tokens.output;
    acc.cacheWrite5m += m.tokens.cacheWrite5m;
    acc.cacheWrite1h += m.tokens.cacheWrite1h;
    acc.cacheRead += m.tokens.cacheRead;
    return acc;
  }, { input: 0, output: 0, cacheWrite5m: 0, cacheWrite1h: 0, cacheRead: 0 });
}

// Groups subagent runs by their agentType (from the sidecar .meta.json),
// each with its own real, measured cost — instead of lumping every
// subagent run into one "SUBAGENTS" blob.
export function summarizeSubagentsByType(subagentFiles, table) {
  const byType = new Map();

  for (const { file, meta } of subagentFiles) {
    const type = resolveSubagentType(meta);
    const { turns } = parseTranscript(file);
    if (!byType.has(type)) byType.set(type, { agentType: type, runCount: 0, turns: [] });
    const bucket = byType.get(type);
    bucket.runCount += 1;
    bucket.turns.push(...turns);
  }

  return [...byType.values()].map((bucket) => ({
    agentType: bucket.agentType,
    runCount: bucket.runCount,
    models: summarizeTurns(bucket.turns, table),
  }));
}

export function activityFrom(parsed) {
  const mcp = {};
  for (const server of Object.values(parsed.mcp)) {
    const calls = Object.values(server.tools).reduce((sum, bucket) => sum + bucket.calls, 0);
    if (calls) mcp[server.displayName] = (mcp[server.displayName] ?? 0) + calls;
  }
  const skills = {};
  for (const [name, bucket] of Object.entries(parsed.skills)) skills[name] = bucket.calls;
  return { mcp, skills, web: parsed.web };
}

function priceBucket(bucket, table) {
  let outputCost = 0;
  let contextCost = 0;
  let pricedOutput = 0;
  let pricedContext = 0;
  let unpriced = false;

  for (const [model, tokens] of Object.entries(bucket.outputByModel)) {
    const { rates } = lookupPricing(model, table);
    if (!rates) {
      unpriced = true;
      continue;
    }
    outputCost += (tokens / 1_000_000) * rates.output;
    pricedOutput += tokens;
  }

  for (const [model, usage] of Object.entries(bucket.contextByModel)) {
    const { rates } = lookupPricing(model, table);
    if (!rates) {
      unpriced = true;
      continue;
    }
    const cost = costFor({ ...usage, output: 0, cacheRead: 0 }, rates);
    contextCost += cost.input + cost.cacheWrite;
    pricedContext += usage.input + usage.cacheWrite5m + usage.cacheWrite1h;
  }

  return {
    outputCost: pricedOutput === 0 && bucket.outputTokens > 0 ? null : outputCost,
    contextCost: pricedContext === 0 && bucket.contextTokens > 0 ? null : contextCost,
    unpriced,
  };
}

function finishBucket(bucket, table) {
  const priced = priceBucket(bucket, table);
  const via = Object.entries(bucket.via)
    .map(([skill, calls]) => ({ skill, calls }))
    .sort((a, b) => b.calls - a.calls);
  return {
    calls: bucket.calls,
    outputTokens: bucket.outputTokens,
    contextTokens: bucket.contextTokens,
    contextMissing: bucket.contextMissing,
    outputCost: priced.outputCost,
    contextCost: priced.contextCost,
    unpriced: priced.unpriced,
    ...(via.length ? { via } : {}),
  };
}

function sumField(rows, field) {
  if (rows.every((row) => row[field] == null)) return null;
  return rows.reduce((sum, row) => sum + (row[field] ?? 0), 0);
}

function byWeight(a, b) {
  const cost = (row) => (row.contextCost ?? 0) + (row.outputCost ?? 0);
  return cost(b) - cost(a) || (b.contextTokens + b.outputTokens) - (a.contextTokens + a.outputTokens);
}

export function priceAttribution(parsed, table) {
  const mcp = Object.entries(parsed.mcp).map(([slug, server]) => {
    const tools = Object.entries(server.tools)
      .map(([name, bucket]) => ({ name, ...finishBucket(bucket, table) }))
      .sort(byWeight);
    return {
      server: slug,
      displayName: server.displayName,
      calls: tools.reduce((sum, tool) => sum + tool.calls, 0),
      outputTokens: tools.reduce((sum, tool) => sum + tool.outputTokens, 0),
      contextTokens: tools.reduce((sum, tool) => sum + tool.contextTokens, 0),
      contextMissing: tools.reduce((sum, tool) => sum + tool.contextMissing, 0),
      outputCost: sumField(tools, 'outputCost'),
      contextCost: sumField(tools, 'contextCost'),
      unpriced: tools.some((tool) => tool.unpriced),
      tools,
    };
  }).sort(byWeight);

  const skills = Object.entries(parsed.skills)
    .map(([name, bucket]) => ({ name, ...finishBucket(bucket, table) }))
    .sort(byWeight);

  return { note: ATTRIBUTION_NOTE, mcp, skills };
}

// Builds one receipt object for a discovered session (main transcript +
// any subagent transcripts spawned within it). `table` is the pricing
// table already resolved once via loadPricingTable() by the caller.
// Attribution dollars are not added into totals — they are a slice of them.
export function buildReceipt(session, table) {
  const main = parseTranscript(session.mainFile);
  const subagentParsed = session.subagentFiles.map(({ file }) => parseTranscript(file));
  const mainTurns = main.turns;
  const subagentTurns = subagentParsed.flatMap((p) => p.turns);
  const merged = mergeParsed([main, ...subagentParsed]);

  const fromState = priceFromCostState(main.reported, table);
  let mainModels;
  let subagentGroups;
  let totals;

  if (fromState) {
    mainModels = fromState.models.map((m) => ({
      rawModel: m.rawModel,
      fidelity: m.fidelity,
      turnCount: m.turnCount,
      tokens: m.tokens,
      cost: m.cost,
    }));
    subagentGroups = [];
    totals = { tokens: fromState.tokens, cost: fromState.cost };
  } else {
    mainModels = summarizeTurns(mainTurns, table);
    subagentGroups = summarizeSubagentsByType(session.subagentFiles, table);
    const allSubagentModels = subagentGroups.flatMap((g) => g.models);
    totals = {
      tokens: sumTokens([...mainModels, ...allSubagentModels]),
      cost: sumCost([...mainModels, ...allSubagentModels]),
    };
  }

  const activity = activityFrom(merged);
  const attribution = priceAttribution(merged, table);

  const { startedAt, endedAt } = timeRange([...mainTurns, ...subagentTurns]);
  const hasUnpriced = !fromState && [...mainModels, ...(subagentGroups.flatMap((g) => g.models))].some((m) => m.fidelity === 'unpriced');

  return {
    sessionId: session.sessionId,
    title: session.title,
    project: session.project,
    startedAt,
    endedAt,
    turnCount: mainTurns.length,
    subagentCount: session.subagentFiles.length,
    models: mainModels,
    subagentGroups,
    activity,
    attribution,
    totals,
    hasUnpriced,
    pricingSource: table.source,
  };
}

export async function buildAllReceipts(sessions) {
  const table = await loadPricingTable();
  return sessions.map((s) => buildReceipt(s, table));
}

export { loadPricingTable };
