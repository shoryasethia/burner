import { parseTranscript, timeRange, mergeActivity } from './parse.js';
import { lookupPricing, costFor, loadPricingTable } from './pricing.js';

function summarizeTurns(turns, table) {
  // Group by the *priced* model identity (post lookup), not the raw string,
  // so aliases like "sonnet" fold into the concrete model they resolved to.
  const byModel = new Map();

  for (const t of turns) {
    const priced = lookupPricing(t.model, table);
    const key = priced.displayName;
    if (!byModel.has(key)) {
      byModel.set(key, {
        displayName: priced.displayName,
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
      displayName: bucket.displayName,
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
function summarizeSubagentsByType(subagentFiles, table) {
  const byType = new Map();

  for (const { file, meta } of subagentFiles) {
    const type = meta?.agentType ?? 'unknown';
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

// Builds one receipt object for a discovered session (main transcript +
// any subagent transcripts spawned within it). `table` is the pricing
// table already resolved once via loadPricingTable() by the caller.
export function buildReceipt(session, table) {
  const { turns: mainTurns, activity: mainActivity } = parseTranscript(session.mainFile);
  const subagentParsed = session.subagentFiles.map(({ file }) => parseTranscript(file));
  const subagentTurns = subagentParsed.flatMap((p) => p.turns);

  const mainModels = summarizeTurns(mainTurns, table);
  const subagentGroups = summarizeSubagentsByType(session.subagentFiles, table);
  const allSubagentModels = subagentGroups.flatMap((g) => g.models);

  const activity = mergeActivity([mainActivity, ...subagentParsed.map((p) => p.activity)]);

  const { startedAt, endedAt } = timeRange([...mainTurns, ...subagentTurns]);
  const hasUnpriced = [...mainModels, ...allSubagentModels].some((m) => !m.cost);

  const totals = {
    tokens: sumTokens([...mainModels, ...allSubagentModels]),
    cost: sumCost([...mainModels, ...allSubagentModels]),
  };

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
