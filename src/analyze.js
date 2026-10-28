// Reads every session, prices it, resolves its project and category, and
// returns the data behind the report, receipts and settings pages.

import { discoverSessions, resolveSubagentType } from './discover.js';
import { parseTranscript, timeRange, mergeParsed } from './parse.js';
import { priceAttribution, summarizeSubagentsByType, activityFrom } from './build-receipt.js';
import { loadPricingTable, lookupPricing, costFor, pricingInfo } from './pricing.js';
import { loadConfig, resolveProject, UNTAGGED } from './config.js';
import { loadTags, segmentTurns, loadAssignments, resolveSessionProject } from './tags.js';
import { resolveCategory, buildDigest, loadLearned } from './classifier.js';
import { ccReportedCost, hasCostState, priceFromCostState } from './billing.js';

const zeroTokens = () => ({ input: 0, output: 0, cacheWrite5m: 0, cacheWrite1h: 0, cacheRead: 0 });
const zeroCost = () => ({ input: 0, output: 0, cacheWrite: 0, cacheRead: 0, total: 0 });

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

export function tokenTotal(t) {
  return t.input + t.output + (t.cacheWrite ?? t.cacheWrite5m + t.cacheWrite1h) + t.cacheRead;
}

function priceTurns(turns, table) {
  const byModel = new Map();
  for (const t of turns) {
    if (!byModel.has(t.model)) byModel.set(t.model, { rawModel: t.model, tokens: zeroTokens(), turnCount: 0, unreported: 0 });
    const b = byModel.get(t.model);
    b.turnCount += 1;
    if (t.unreported) b.unreported += 1;
    addTokens(b.tokens, t);
  }
  const models = [];
  const tokens = zeroTokens();
  const cost = zeroCost();
  for (const b of byModel.values()) {
    const priced = lookupPricing(b.rawModel, table);
    const c = costFor(b.tokens, priced.rates);
    models.push({ rawModel: b.rawModel, fidelity: priced.fidelity, turnCount: b.turnCount, unreported: b.unreported, tokens: b.tokens, cost: c, unpriced: priced.fidelity === 'unpriced' });
    addTokens(tokens, b.tokens);
    addCost(cost, c);
  }
  models.sort((a, b) => b.cost.total - a.cost.total || tokenTotal(b.tokens) - tokenTotal(a.tokens));
  return { models, tokens, cost };
}

// Spend per calendar day (UTC, like the session date): a session that ran for
// weeks should not show up as one lump on the day it started.
function dailySpend(turns, table) {
  const byDay = new Map();
  for (const t of turns) {
    if (!t.timestamp) continue;
    const day = new Date(t.timestamp).toISOString().slice(0, 10);
    if (!byDay.has(day)) byDay.set(day, []);
    byDay.get(day).push(t);
  }
  return [...byDay.entries()].sort((x, y) => (x[0] < y[0] ? -1 : 1)).map(([date, ts]) => {
    const p = priceTurns(ts, table);
    return { date, turns: ts.length, cost: p.cost.total, tokens: tokenTotal(p.tokens) };
  });
}

function agentInvocations(parsedList) {
  const counts = {};
  for (const p of parsedList) {
    for (const step of p.digest?.tools ?? []) {
      if (step.startsWith('Task(') || step.startsWith('Agent(')) counts[step] = (counts[step] ?? 0) + 1;
    }
  }
  return counts;
}

function within(s, opts) {
  if (opts.from && s.mtime < new Date(opts.from).getTime()) return false;
  if (opts.to && s.mtime > new Date(opts.to + 'T23:59:59').getTime()) return false;
  return true;
}

export async function analyzeSessions(opts = {}) {
  const cfg = opts.config ?? loadConfig();
  const table = opts.table ?? (await loadPricingTable({ offline: opts.offline }));
  const tags = loadTags();
  const assignments = loadAssignments();
  const learned = loadLearned();
  const discovered = discoverSessions(opts.claudeHome);

  // Oldest first: a continued session re-logs requests from its parent;
  // they're billed to the session that made them.
  const seenRequests = new Set();
  const results = [];
  const digests = new Map();
  const modelIndex = new Map();
  const cwdIndex = new Map();
  const projectTotals = new Map();

  for (const session of [...discovered].reverse()) {
    const main = parseTranscript(session.mainFile);
    const subs = session.subagentFiles.map(({ file, meta }) => ({ file, meta, parsed: parseTranscript(file) }));
    const fresh = (turns) => turns.filter((t) => {
      if (seenRequests.has(t.requestId)) return false;
      seenRequests.add(t.requestId);
      return true;
    });
    const mainTurns = fresh(main.turns);
    const billSubTranscripts = !hasCostState(main.reported);
    const subTurns = billSubTranscripts ? subs.flatMap((s) => fresh(s.parsed.turns)) : [];
    const turns = [...mainTurns, ...subTurns];
    if (!turns.length && !main.digest.prompts.length && !hasCostState(main.reported)) continue;

    const cwd = main.digest.cwd;
    const project = resolveSessionProject(session.sessionId, cwd, cfg, assignments);
    const dirProject = resolveProject(cwd, cfg);
    const digest = buildDigest(main, { title: session.title, projectName: project.name });
    const fromState = priceFromCostState(main.reported, table);
    const billingSource = fromState ? 'cost-state' : 'calculated';
    const priced = fromState ?? priceTurns(turns, table);
    const { models, tokens, cost } = priced;
    const mainModels = fromState ? models : priceTurns(mainTurns, table).models;
    const tag = tags[session.sessionId];

    let { category, source, confidence } = resolveCategory({ tag, project, cfg, digest, learned });
    let split = null;
    const groups = segmentTurns(turns, tag?.segments);
    if (groups && groups.length > 1) {
      const byCat = new Map();
      for (const g of groups) {
        const p = priceTurns(g.turns, table);
        const row = byCat.get(g.category) ?? { category: g.category, tokens: 0, cost: 0, turns: 0 };
        row.tokens += tokenTotal(p.tokens);
        row.cost += p.cost.total;
        row.turns += g.turns.length;
        byCat.set(g.category, row);
      }
      split = [...byCat.values()].sort((a, b) => b.cost - a.cost || b.tokens - a.tokens);
      if (split[0].cost > 0 || split[0].tokens > 0) category = split[0].category;
    }

    const range = timeRange(billSubTranscripts ? turns : mainTurns.length ? mainTurns : turns);
    const totalTokens = { input: tokens.input, output: tokens.output, cacheWrite: tokens.cacheWrite5m + tokens.cacheWrite1h, cacheRead: tokens.cacheRead };
    totalTokens.total = tokenTotal(totalTokens);
    const promptSide = totalTokens.input + totalTokens.cacheWrite + totalTokens.cacheRead;

    const row = {
      sessionId: session.sessionId,
      title: session.customTitle ?? main.digest.aiTitle ?? session.slug ?? session.sessionId.slice(0, 8),
      project: project.name,
      projectImplicit: project.implicit,
      projectSource: project.bySession ? 'session' : project.implicit ? 'none' : 'directory',
      cwd,
      gitBranch: main.digest.gitBranch,
      date: new Date(range.startedAt ?? session.mtime).toISOString().slice(0, 10),
      mtime: session.mtime,
      startedAt: range.startedAt,
      endedAt: range.endedAt,
      durationMin: range.startedAt && range.endedAt ? Math.round((new Date(range.endedAt) - new Date(range.startedAt)) / 60000) : null,
      turnCount: mainTurns.length,
      subagentTurnCount: subTurns.length,
      subagentCount: session.subagentFiles.length,
      promptCount: main.digest.prompts.length,
      models,
      mainModels,
      daily: fromState ? dailySpend(mainTurns, table) : dailySpend(turns, table),
      totalTokens,
      totalCost: cost,
      billingSource,
      hasUnpriced: billingSource === 'calculated' && models.some((m) => m.unpriced),
      cacheHitRate: promptSide ? Math.round((totalTokens.cacheRead / promptSide) * 100) : 0,
      category,
      categorySource: source,
      confidence: confidence ?? null,
      categorySplit: split,
      tagReason: tag?.reason ?? null,
      activity: activityFrom(mergeParsed([main, ...subs.map((s) => s.parsed)])),
      attribution: priceAttribution(mergeParsed([main, ...subs.map((s) => s.parsed)]), table),
      subagentGroups: fromState ? [] : summarizeSubagentsByType(session.subagentFiles, table),
      subagentRuns: subs.map(({ meta }) => ({
        type: resolveSubagentType(meta),
        description: meta?.description ?? null,
        spawnDepth: meta?.spawnDepth ?? null,
      })),
      agents: agentInvocations([main, ...subs.map((s) => s.parsed)]),
      ccReportedCost: ccReportedCost(main.reported),
    };
    if (opts.project && !row.project.toLowerCase().includes(opts.project.toLowerCase())) continue;
    if (!within(session, opts)) continue;
    results.push(row);
    digests.set(session.sessionId, digest);

    for (const m of models) {
      const e = modelIndex.get(m.rawModel) ?? { rawModel: m.rawModel, sessions: 0, unreported: 0, tokens: zeroTokens(), cost: 0 };
      e.sessions += 1;
      e.unreported += m.unreported ?? 0;
      addTokens(e.tokens, m.tokens);
      e.cost += m.cost.total;
      modelIndex.set(m.rawModel, e);
    }
    if (cwd) {
      const e = cwdIndex.get(cwd) ?? { cwd, project: dirProject.name, implicit: dirProject.implicit, sessions: 0, moved: 0, cost: 0, lastUsed: 0 };
      if (project.bySession) e.moved += 1;
      else { e.sessions += 1; e.cost += cost.total; }
      e.lastUsed = Math.max(e.lastUsed, session.mtime);
      cwdIndex.set(cwd, e);
    }
    const pt = projectTotals.get(project.name) ?? { name: project.name, sessions: 0, cost: 0, implicit: project.implicit };
    pt.sessions += 1;
    pt.cost += cost.total;
    projectTotals.set(project.name, pt);
  }

  results.sort((a, b) => b.mtime - a.mtime);

  const models = [...modelIndex.values()].map((e) => {
    const p = lookupPricing(e.rawModel, table);
    return { ...e, fidelity: p.fidelity, rates: p.rates, suggested: p.suggested };
  }).sort((a, b) => b.sessions - a.sessions);

  return {
    sessions: results,
    models,
    directories: [...cwdIndex.values()].filter((d) => d.sessions || d.moved).sort((a, b) => b.lastUsed - a.lastUsed),
    projectTotals: [...projectTotals.values()],
    categories: [...cfg.categories, UNTAGGED],
    config: cfg,
    pricing: pricingInfo(table),
    pricingSource: table.source,
    generatedAt: new Date().toISOString(),
    unpricedModels: models.filter((m) => m.fidelity === 'unpriced').map((m) => m.rawModel),
    digests,
  };
}
