import { parseTranscript, timeRange } from './parse.js';
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

// Builds one receipt object for a discovered session (main transcript +
// any subagent transcripts spawned within it). `table` is the pricing
// table already resolved once via loadPricingTable() by the caller.
export function buildReceipt(session, table) {
  const mainTurns = parseTranscript(session.mainFile);
  const subagentTurns = session.subagentFiles.flatMap((f) => parseTranscript(f));

  const mainModels = summarizeTurns(mainTurns, table);
  const subagentModels = summarizeTurns(subagentTurns, table);

  const { startedAt, endedAt } = timeRange([...mainTurns, ...subagentTurns]);
  const hasUnpriced = [...mainModels, ...subagentModels].some((m) => !m.cost);

  return {
    sessionId: session.sessionId,
    project: session.project,
    startedAt,
    endedAt,
    turnCount: mainTurns.length,
    subagentCount: session.subagentFiles.length,
    models: mainModels,
    subagentModels,
    totals: {
      tokens: sumTokens([...mainModels, ...subagentModels]),
      cost: sumCost([...mainModels, ...subagentModels]),
    },
    hasUnpriced,
    pricingSource: table.source,
  };
}

export async function buildAllReceipts(sessions) {
  const table = await loadPricingTable();
  return sessions.map((s) => buildReceipt(s, table));
}

export { loadPricingTable };
