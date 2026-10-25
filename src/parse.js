import { readFileSync } from 'node:fs';

// Gateways and local servers are not always tidy: counts can arrive as
// strings or null, and some use OpenAI-style names. Anything that is not a
// finite non-negative number counts as 0 so one odd value can never turn a
// total into NaN or a concatenated string.
function tok(v) {
  const n = Number(v);
  return Number.isFinite(n) && n > 0 ? Math.floor(n) : 0;
}

function normalizeUsage(u) {
  const cc = u.cache_creation ?? {};
  const hasSplit = cc.ephemeral_5m_input_tokens != null || cc.ephemeral_1h_input_tokens != null;
  const createdTotal = tok(u.cache_creation_input_tokens);
  return {
    input: tok(u.input_tokens ?? u.prompt_tokens),
    output: tok(u.output_tokens ?? u.completion_tokens),
    cacheWrite5m: hasSplit ? tok(cc.ephemeral_5m_input_tokens) : createdTotal,
    cacheWrite1h: hasSplit ? tok(cc.ephemeral_1h_input_tokens) : 0,
    cacheRead: tok(u.cache_read_input_tokens ?? u.prompt_tokens_details?.cached_tokens),
  };
}

const EMPTY_ACTIVITY = () => ({ mcp: {}, skills: {}, web: {} });

function serverDisplayName(slug) {
  return slug.replace(/_/g, ' ').trim();
}

function newBucket() {
  return {
    calls: 0,
    outputTokens: 0,
    contextTokens: 0,
    contextMissing: 0,
    outputByModel: {},
    contextByModel: {},
    via: {},
  };
}

function userText(message) {
  if (typeof message?.content === 'string') return message.content;
  if (!Array.isArray(message?.content)) return '';
  return message.content
    .filter((b) => b.type === 'text' && typeof b.text === 'string')
    .map((b) => b.text)
    .join('\n');
}

// Prompts the human actually typed — not tool results, slash-command
// scaffolding, or the "session continued" summaries Claude Code injects.
function isHumanPrompt(entry, text) {
  if (entry.isMeta || entry.isCompactSummary || entry.isSidechain) return false;
  if (!text.trim()) return false;
  if (/^<(command-|local-command|system-reminder|bash-|user-memory)/.test(text.trim())) return false;
  if (text.startsWith('This session is being continued')) return false;
  return true;
}

function toolStep(block) {
  const name = block.name ?? 'unknown';
  const input = block.input ?? {};
  if (name === 'Bash' && typeof input.command === 'string') {
    return `Bash(${input.command.trim().split(/\s+/).slice(0, 2).join(' ')})`;
  }
  const file = input.file_path ?? input.notebook_path ?? input.path;
  if (typeof file === 'string') {
    const ext = file.match(/\.([a-z0-9]+)$/i)?.[1];
    return ext ? `${name}(.${ext.toLowerCase()})` : name;
  }
  if (name === 'Skill' && input.skill) return `Skill(${input.skill})`;
  if (name === 'Task' || name === 'Agent') return `${name}(${input.subagent_type ?? 'agent'})`;
  return name.startsWith('mcp__') ? `mcp:${name.split('__')[1]}` : name;
}

// Reads one transcript and returns:
//  turns    — one entry per billed API request:
//             { requestId, model, timestamp, input, output, cacheWrite5m, cacheWrite1h, cacheRead }
//  activity — call counts { mcp: {server: n}, skills: {name: n}, web: {tool: n} }
//  mcp/skills/web — per-request cost attribution buckets (see build-receipt.js)
//  digest   — what the session was about: cwd, prompts, tool sequence
//  reported — Claude Code's own "cost-state" totals when the transcript has one
//
// Claude Code writes one API response as several lines (one per content
// block, streamed). They share a requestId/message.id; output_tokens grows
// until the last one, so the final line is the billed usage.
export function parseTranscript(path) {
  const file = String(path);
  let text;
  try {
    text = readFileSync(path, 'utf-8');
  } catch {
    return { turns: [], activity: EMPTY_ACTIVITY(), mcp: {}, skills: {}, web: {}, digest: emptyDigest(), reported: null };
  }

  const requests = new Map();
  const latest = new Map(); // base id -> newest request carrying it
  const order = [];
  let userCount = 0;
  let splitN = 0;
  const digest = emptyDigest();
  let reported = null;
  let anon = 0;

  for (const line of text.split('\n')) {
    if (!line.trim()) continue;
    let entry;
    try {
      entry = JSON.parse(line);
    } catch {
      continue;
    }

    if (!digest.cwd && typeof entry.cwd === 'string') digest.cwd = entry.cwd;
    if (!digest.gitBranch && entry.gitBranch) digest.gitBranch = entry.gitBranch;
    if (entry.type === 'ai-title' && entry.aiTitle) digest.aiTitle = entry.aiTitle;
    if (entry.type === 'cost-state' && entry.modelUsage) reported = entry;

    if (entry.type === 'user') userCount += 1;
    if (entry.type === 'user' && entry.message?.role === 'user') {
      const t = userText(entry.message);
      if (isHumanPrompt(entry, t)) {
        digest.prompts.push({ text: t.slice(0, 2000), timestamp: entry.timestamp ?? null });
      }
      continue;
    }

    const msg = entry.message;
    if (!msg || msg.role !== 'assistant') continue;
    if (msg.model === '<synthetic>') continue;

    // One API response is streamed as several lines sharing an id. Claude
    // always supplies a unique requestId. A gateway may not: then message.id is
    // all we have, and some servers reuse one constant id for every response,
    // so a tool result in between means the id belongs to a new request.
    const rid = entry.requestId || null;
    const base = rid ?? (msg.id || null);
    let req = base ? latest.get(base) : null;
    if (req && !rid && req.lastUser !== userCount) req = null;
    if (!req) {
      const key = !base ? `${file}#anon${anon++}` : latest.has(base) ? `${file}#${base}#${++splitN}` : base;
      req = { key, model: msg.model ?? 'unknown', timestamp: entry.timestamp ?? null, usage: null, tools: new Map(), skill: null, lastUser: userCount };
      requests.set(key, req);
      order.push(req);
      if (base) latest.set(base, req);
    }
    req.lastUser = userCount;
    if (entry.attributionSkill) req.skill = entry.attributionSkill;
    if (msg.usage && typeof msg.usage === 'object' && (!req.usage || tok(msg.usage.output_tokens ?? msg.usage.completion_tokens) >= tok(req.usage.output_tokens ?? req.usage.completion_tokens))) {
      req.usage = msg.usage;
      req.model = msg.model ?? req.model;
      if (entry.timestamp) req.timestamp = entry.timestamp;
    }
    if (Array.isArray(msg.content)) {
      for (const block of msg.content) {
        if (block.type !== 'tool_use') continue;
        const id = block.id ?? `${req.key}-${req.tools.size}`;
        if (!req.tools.has(id)) req.tools.set(id, block);
      }
    }
  }

  const turns = [];
  const billed = [];
  for (const req of order) {
    // Some local servers report no usage at all. Keep the request (so the
    // model shows up and can be priced) but mark that its tokens are unknown.
    const n = req.usage ? normalizeUsage(req.usage) : { input: 0, output: 0, cacheWrite5m: 0, cacheWrite1h: 0, cacheRead: 0 };
    const unreported = !(n.input || n.output || n.cacheWrite5m || n.cacheWrite1h || n.cacheRead);
    if (unreported && !req.model) continue;
    const turn = { requestId: req.key, model: req.model, timestamp: req.timestamp, ...n, unreported };
    turns.push(turn);
    billed.push({ req, turn });
  }

  const activity = EMPTY_ACTIVITY();
  const mcp = {};
  const skills = {};
  const web = {};

  billed.forEach(({ req, turn }, i) => {
    const next = billed[i + 1]?.turn ?? null;
    const charge = (bucket) => {
      bucket.calls += 1;
      bucket.outputTokens += turn.output;
      bucket.outputByModel[turn.model] = (bucket.outputByModel[turn.model] ?? 0) + turn.output;
      if (!next) {
        bucket.contextMissing += 1;
        return;
      }
      bucket.contextTokens += next.input + next.cacheWrite5m + next.cacheWrite1h;
      const ctx = (bucket.contextByModel[next.model] ??= { input: 0, cacheWrite5m: 0, cacheWrite1h: 0 });
      ctx.input += next.input;
      ctx.cacheWrite5m += next.cacheWrite5m;
      ctx.cacheWrite1h += next.cacheWrite1h;
    };

    const blocks = [...req.tools.values()];
    let mcpCharged = false;
    for (const block of blocks) {
      const name = block.name ?? '';
      digest.tools.push(toolStep(block));
      if (name.startsWith('mcp__')) {
        const [, slug = 'unknown', ...rest] = name.split('__');
        const tool = rest.join('__') || 'unknown';
        activity.mcp[slug] = (activity.mcp[slug] ?? 0) + 1;
        const server = (mcp[slug] ??= { displayName: serverDisplayName(slug), tools: {} });
        const bucket = (server.tools[tool] ??= newBucket());
        charge(bucket);
        if (req.skill) bucket.via[req.skill] = (bucket.via[req.skill] ?? 0) + 1;
        mcpCharged = true;
      } else if (name === 'Skill' && block.input?.skill) {
        activity.skills[block.input.skill] = (activity.skills[block.input.skill] ?? 0) + 1;
      } else if (name === 'WebFetch' || name === 'WebSearch') {
        activity.web[name] = (activity.web[name] ?? 0) + 1;
        web[name] = (web[name] ?? 0) + 1;
      }
    }
    if (req.skill && !mcpCharged) charge((skills[req.skill] ??= newBucket()));
  });

  return { turns, activity, mcp, skills, web, digest, reported };
}

function emptyDigest() {
  return { cwd: null, gitBranch: null, aiTitle: null, prompts: [], tools: [] };
}

export function timeRange(turns) {
  const stamps = turns.map((t) => t.timestamp).filter(Boolean).sort();
  return { startedAt: stamps[0] ?? null, endedAt: stamps[stamps.length - 1] ?? null };
}

export function mergeActivity(activities) {
  const merged = EMPTY_ACTIVITY();
  for (const a of activities) {
    for (const kind of ['mcp', 'skills', 'web']) {
      for (const [k, v] of Object.entries(a[kind] ?? {})) merged[kind][k] = (merged[kind][k] ?? 0) + v;
    }
  }
  return merged;
}

function addBucket(into, from) {
  into.calls += from.calls;
  into.outputTokens += from.outputTokens;
  into.contextTokens += from.contextTokens;
  into.contextMissing += from.contextMissing;
  for (const [m, n] of Object.entries(from.outputByModel)) into.outputByModel[m] = (into.outputByModel[m] ?? 0) + n;
  for (const [m, u] of Object.entries(from.contextByModel)) {
    const c = (into.contextByModel[m] ??= { input: 0, cacheWrite5m: 0, cacheWrite1h: 0 });
    c.input += u.input;
    c.cacheWrite5m += u.cacheWrite5m;
    c.cacheWrite1h += u.cacheWrite1h;
  }
  for (const [s, n] of Object.entries(from.via)) into.via[s] = (into.via[s] ?? 0) + n;
}

export function mergeParsed(parsedList) {
  const out = { mcp: {}, skills: {}, web: {} };
  for (const p of parsedList) {
    for (const [slug, server] of Object.entries(p.mcp ?? {})) {
      const into = (out.mcp[slug] ??= { displayName: server.displayName, tools: {} });
      for (const [tool, bucket] of Object.entries(server.tools)) addBucket((into.tools[tool] ??= newBucket()), bucket);
    }
    for (const [name, bucket] of Object.entries(p.skills ?? {})) addBucket((out.skills[name] ??= newBucket()), bucket);
    for (const [k, v] of Object.entries(p.web ?? {})) out.web[k] = (out.web[k] ?? 0) + v;
  }
  return out;
}
