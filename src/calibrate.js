// "What I was actually charged": the user enters the real amount billed for a
// period; every dollar figure in that period is scaled by one factor
// (billed / calculated) so the totals match the invoice while every
// percentage and ratio stays exactly the same. Tokens are never scaled.

const DAY_MS = 86_400_000;
const DAY_RE = /^\d{4}-\d{2}-\d{2}$/;

// Same boundaries as the report's custom range (see inRange in report.js):
// a session belongs to a period by its last-activity time (mtime).
export function periodBounds(p) {
  const start = Date.parse(p.from);
  return { start, end: Date.parse(p.to) + DAY_MS };
}

export function cleanActuals(list) {
  if (!Array.isArray(list)) return [];
  return list
    .map((p) => ({ from: String(p?.from ?? ''), to: String(p?.to ?? ''), amount: Number(p?.amount) }))
    .filter((p) => DAY_RE.test(p.from) && DAY_RE.test(p.to) && Number.isFinite(p.amount) && p.amount > 0)
    .map((p) => ({ ...p, amount: Math.round(p.amount * 100) / 100 }))
    .sort((a, b) => (a.from < b.from ? -1 : a.from > b.from ? 1 : 0));
}

// Returns an error message, or null when the list is fine to save.
export function validateActuals(list) {
  if (list == null) return null;
  if (!Array.isArray(list)) return 'billing periods must be a list';
  for (const p of list) {
    if (!DAY_RE.test(String(p?.from ?? '')) || !DAY_RE.test(String(p?.to ?? ''))) return 'every period needs a start and end date';
    if (Number.isNaN(Date.parse(p.from)) || Number.isNaN(Date.parse(p.to))) return `invalid date in period ${p.from} – ${p.to}`;
    if (p.from > p.to) return `period ${p.from} – ${p.to} ends before it starts`;
    const n = Number(p.amount);
    if (!Number.isFinite(n) || n <= 0) return `amount for ${p.from} – ${p.to} must be greater than 0`;
  }
  const sorted = [...list].sort((a, b) => (a.from < b.from ? -1 : 1));
  for (let i = 1; i < sorted.length; i++) {
    if (sorted[i].from <= sorted[i - 1].to) return `periods ${sorted[i - 1].from} – ${sorted[i - 1].to} and ${sorted[i].from} – ${sorted[i].to} overlap`;
  }
  return null;
}

const scaleNum = (n, f) => (typeof n === 'number' ? n * f : n);

function scaleCost(c, f) {
  if (!c) return c;
  const out = { ...c };
  for (const k of ['input', 'output', 'cacheWrite', 'cacheRead', 'total']) if (k in out) out[k] = scaleNum(out[k], f);
  return out;
}

const scaleModels = (models, f) => (models ?? []).map((m) => ({ ...m, cost: scaleCost(m.cost, f) }));

function scaleBucket(b, f) {
  return { ...b, outputCost: scaleNum(b.outputCost, f), contextCost: scaleNum(b.contextCost, f) };
}

function scaleAttribution(a, f) {
  if (!a) return a;
  return {
    ...a,
    mcp: (a.mcp ?? []).map((s) => ({ ...scaleBucket(s, f), tools: (s.tools ?? []).map((t) => scaleBucket(t, f)) })),
    skills: (a.skills ?? []).map((s) => scaleBucket(s, f)),
  };
}

// A scaled copy of one session row. Nothing is mutated: `models` and
// `mainModels` can be the same array, and must not be scaled twice.
export function scaleSession(row, f, info) {
  return {
    ...row,
    rawCost: row.totalCost.total,
    billing: info,
    totalCost: scaleCost(row.totalCost, f),
    models: scaleModels(row.models, f),
    mainModels: scaleModels(row.mainModels, f),
    daily: (row.daily ?? []).map((d) => ({ ...d, cost: scaleNum(d.cost, f) })),
    categorySplit: row.categorySplit ? row.categorySplit.map((x) => ({ ...x, cost: scaleNum(x.cost, f) })) : row.categorySplit,
    attribution: scaleAttribution(row.attribution, f),
    subagentGroups: (row.subagentGroups ?? []).map((g) => ({ ...g, models: scaleModels(g.models, f) })),
  };
}

// rows: every session (before any project/date filter), each with mtime and
// totalCost.total. Returns { rows, applied } — rows scaled where a period
// covers them, applied = one summary per period for the Settings page.
export function applyActuals(rows, actuals) {
  const periods = cleanActuals(actuals);
  if (!periods.length) return { rows, applied: [] };
  const applied = [];
  const factors = new Map();
  for (const p of periods) {
    const { start, end } = periodBounds(p);
    const inside = rows.filter((r) => r.mtime >= start && r.mtime <= end);
    const raw = inside.reduce((s, r) => s + r.totalCost.total, 0);
    const info = { from: p.from, to: p.to, amount: p.amount, calculated: raw, sessions: inside.length };
    if (raw > 0) {
      info.factor = p.amount / raw;
      for (const r of inside) factors.set(r, info);
    } else {
      info.factor = null;
    }
    applied.push(info);
  }
  const out = rows.map((r) => {
    const info = factors.get(r);
    return info ? scaleSession(r, info.factor, { from: info.from, to: info.to, amount: info.amount, factor: info.factor }) : r;
  });
  return { rows: out, applied };
}
