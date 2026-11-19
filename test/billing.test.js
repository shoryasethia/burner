import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, mkdirSync, writeFileSync, rmSync, utimesSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';

const root = mkdtempSync(path.join(tmpdir(), 'burner-bill-'));
const claudeHome = path.join(root, 'claude');
const burnerHome = path.join(root, 'burner');
process.env.CLAUDE_CONFIG_DIR = claudeHome;
process.env.BURNER_HOME = burnerHome;

const work = path.join(root, 'work', 'app');
mkdirSync(work, { recursive: true });

function transcript(id, tsIso, out) {
  const dir = path.join(claudeHome, 'projects', work.replace(/[\\/:]/g, '-'));
  mkdirSync(dir, { recursive: true });
  const lines = [
    { type: 'user', cwd: work, sessionId: id, timestamp: tsIso, message: { role: 'user', content: 'do the thing' } },
    { type: 'assistant', cwd: work, requestId: `${id}-r1`, timestamp: tsIso, message: { id: `${id}-m1`, role: 'assistant', type: 'message', model: 'claude-sonnet-5', content: [{ type: 'text', text: 'ok' }], usage: { input_tokens: 100, output_tokens: out, cache_read_input_tokens: 0, cache_creation_input_tokens: 0 } } },
  ];
  const file = path.join(dir, `${id}.jsonl`);
  writeFileSync(file, lines.map((l) => JSON.stringify(l)).join('\n'));
  const t = new Date(tsIso);
  utimesSync(file, t, t); // session date = file mtime, as the report uses
}

mkdirSync(path.join(burnerHome, 'cache'), { recursive: true });
writeFileSync(path.join(burnerHome, 'cache', 'litellm-pricing.json'), JSON.stringify({
  fetchedAt: Date.now(),
  models: { 'claude-sonnet-5': { input: 2, output: 10, cacheWrite5m: 2.5, cacheWrite1h: 4, cacheRead: 0.2 } },
}));
// $0.01 + $0.03 inside October, $0.05 in November.
transcript('aaaaaaaa-0000-4000-8000-000000000001', '2026-10-05T10:00:00.000Z', 1000);
transcript('aaaaaaaa-0000-4000-8000-000000000002', '2026-10-20T10:00:00.000Z', 3000);
transcript('aaaaaaaa-0000-4000-8000-000000000003', '2026-11-03T10:00:00.000Z', 5000);

test.after(() => rmSync(root, { recursive: true, force: true, maxRetries: 20, retryDelay: 250 }));

const sum = (rows, f) => rows.reduce((a, r) => a + f(r), 0);

test('a billed amount scales the period to the cent and leaves percentages and tokens alone', async () => {
  const { analyzeSessions } = await import('../src/analyze.js');
  const { loadConfig, saveConfig } = await import('../src/config.js');

  const before = await analyzeSessions();
  const rawOct = before.sessions.filter((s) => s.date.startsWith('2026-10'));
  assert.equal(rawOct.length, 2);

  const cfg = loadConfig();
  saveConfig({ ...cfg, billing: { actuals: [{ from: '2026-10-01', to: '2026-10-31', amount: 1.23 }] } });
  const after = await analyzeSessions();

  const oct = after.sessions.filter((s) => s.date.startsWith('2026-10'));
  const nov = after.sessions.filter((s) => s.date.startsWith('2026-11'));
  assert.equal(Math.round(sum(oct, (s) => s.totalCost.total) * 100), 123);
  // the other period is untouched
  assert.equal(sum(nov, (s) => s.totalCost.total), sum(before.sessions.filter((s) => s.date.startsWith('2026-11')), (s) => s.totalCost.total));

  // same shares before and after
  for (const s of oct) {
    const b = rawOct.find((x) => x.sessionId === s.sessionId);
    const shareBefore = b.totalCost.total / sum(rawOct, (x) => x.totalCost.total);
    const shareAfter = s.totalCost.total / sum(oct, (x) => x.totalCost.total);
    assert.ok(Math.abs(shareBefore - shareAfter) < 1e-9);
    assert.deepEqual(s.totalTokens, b.totalTokens);
    assert.equal(s.rawCost, b.totalCost.total);
    // every dollar field moved by the same factor
    const f = s.totalCost.total / b.totalCost.total;
    assert.ok(Math.abs(s.models[0].cost.total - b.models[0].cost.total * f) < 1e-12);
    assert.ok(Math.abs(s.daily.reduce((a, d) => a + d.cost, 0) - b.daily.reduce((a, d) => a + d.cost, 0) * f) < 1e-12);
  }
  assert.equal(after.billingApplied.length, 1);
  assert.equal(after.billingApplied[0].sessions, 2);
  // project/model aggregates follow the scaled numbers
  assert.ok(Math.abs(sum(after.projectTotals, (p) => p.cost) - sum(after.sessions, (s) => s.totalCost.total)) < 1e-12);
});

test('a project filter does not change the period factor', async () => {
  const { analyzeSessions } = await import('../src/analyze.js');
  const all = await analyzeSessions();
  const filtered = await analyzeSessions({ project: 'app' });
  assert.equal(filtered.billingApplied[0].factor, all.billingApplied[0].factor);
});

test('overlapping periods and bad amounts are rejected', async () => {
  const { validateActuals, cleanActuals } = await import('../src/calibrate.js');
  assert.match(validateActuals([{ from: '2026-10-01', to: '2026-10-31', amount: 5 }, { from: '2026-10-31', to: '2026-11-05', amount: 5 }]), /overlap/);
  assert.match(validateActuals([{ from: '2026-10-01', to: '2026-10-31', amount: 0 }]), /greater than 0/);
  assert.match(validateActuals([{ from: '2026-11-01', to: '2026-10-01', amount: 3 }]), /before it starts/);
  assert.equal(validateActuals([{ from: '2026-10-01', to: '2026-10-31', amount: 5 }, { from: '2026-11-01', to: '2026-11-30', amount: 5 }]), null);
  assert.deepEqual(cleanActuals([{ from: 'bad', to: '2026-10-01', amount: 1 }, { from: '2026-10-01', to: '2026-10-02', amount: -4 }]), []);
});

test('the report and the receipt say when costs were scaled to a billed amount', async () => {
  const { analyzeSessions } = await import('../src/analyze.js');
  const { renderReport } = await import('../src/report.js');
  const { renderReceipt } = await import('../src/receipt.js');
  const a = await analyzeSessions();
  const html = renderReport(a, { served: false });
  assert.match(html, /COSTS: SCALED TO BILLED AMOUNT/);
  const oct = a.sessions.find((s) => s.billing);
  const receipt = renderReceipt(oct, a.categories, { served: false });
  assert.match(receipt, /scaled ×[\d.]+ to your billed 2026-10-01 – 2026-10-31/);
  assert.ok(receipt.includes('$' + oct.totalCost.total.toFixed(3)));
  const nov = a.sessions.find((s) => !s.billing);
  assert.doesNotMatch(renderReceipt(nov, a.categories, { served: false }), /scaled ×/);
});
