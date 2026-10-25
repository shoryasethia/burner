import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, mkdirSync, writeFileSync, readFileSync, existsSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import http from 'node:http';
import { execFileSync, execFile } from 'node:child_process';
import { fileURLToPath } from 'node:url';

const root = mkdtempSync(path.join(tmpdir(), 'burner-it-'));
const claudeHome = path.join(root, 'claude');
const burnerHome = path.join(root, 'burner');
process.env.CLAUDE_CONFIG_DIR = claudeHome;
process.env.BURNER_HOME = burnerHome;
delete process.env.CLAUDE_SESSION_ID;
const BIN = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..', 'bin', 'burner.js');
const workA = path.join(root, 'work', 'app');
const workB = path.join(root, 'work', 'app-docs');
mkdirSync(workA, { recursive: true });
mkdirSync(workB, { recursive: true });

function transcript(id, cwd, prompt, model, ts) {
  const dir = path.join(claudeHome, 'projects', cwd.replace(/[\\/:]/g, '-'));
  mkdirSync(dir, { recursive: true });
  const lines = [
    { type: 'user', cwd, sessionId: id, timestamp: ts, message: { role: 'user', content: prompt } },
    { type: 'assistant', cwd, requestId: `${id}-r1`, timestamp: ts, message: { id: `${id}-m1`, role: 'assistant', type: 'message', model, content: [{ type: 'tool_use', id: `${id}-t1`, name: 'Edit', input: { file_path: 'x.ts' } }], usage: { input_tokens: 10, output_tokens: 1000, cache_read_input_tokens: 0, cache_creation_input_tokens: 0 } } },
    { type: 'ai-title', aiTitle: prompt.slice(0, 20) },
  ];
  writeFileSync(path.join(dir, `${id}.jsonl`), lines.map((l) => JSON.stringify(l)).join('\n'));
}

mkdirSync(path.join(burnerHome, 'cache'), { recursive: true });
writeFileSync(path.join(burnerHome, 'cache', 'litellm-pricing.json'), JSON.stringify({
  fetchedAt: Date.now(),
  models: { 'claude-sonnet-5': { input: 2, output: 10, cacheWrite5m: 2.5, cacheWrite1h: 4, cacheRead: 0.2 }, 'glm-4.6': { input: 0.6, output: 2.2, cacheWrite5m: 0, cacheWrite1h: 0, cacheRead: 0.11 } },
}));
transcript('11111111-aaaa-4000-8000-000000000001', workA, 'fix the crash when saving', 'claude-sonnet-5', '2026-10-01T10:00:00.000Z');
transcript('22222222-aaaa-4000-8000-000000000002', workB, 'write the README for the API', 'glm-4.6', '2026-10-02T10:00:00.000Z');

function cli(args, opts = {}) {
  return execFileSync(process.execPath, [BIN, ...args], { env: process.env, encoding: 'utf-8', cwd: opts.cwd ?? root, input: opts.input });
}

function cliAsync(args, input) {
  return new Promise((resolve, reject) => {
    const child = execFile(process.execPath, [BIN, ...args], { env: process.env, encoding: 'utf-8', cwd: root }, (err, stdout, stderr) => {
      if (err) reject(new Error(stderr || err.message));
      else resolve(stdout);
    });
    if (input != null) child.stdin.end(input);
  });
}

test.after(() => rmSync(root, { recursive: true, force: true, maxRetries: 20, retryDelay: 250 }));

test('install puts the skill in the global Claude dir and applies levels', async () => {
  const { saveConfig, loadConfig } = await import('../src/config.js');
  const { applyTagging } = await import('../src/install.js');
  const cfg = loadConfig();
  writeFileSync(path.join(claudeHome, 'settings.json'), JSON.stringify({ model: 'opus', hooks: { SessionEnd: [{ hooks: [{ type: 'command', command: 'echo bye' }] }] } }));
  writeFileSync(path.join(claudeHome, 'CLAUDE.md'), '# my rules\nbe nice\n');

  let st = applyTagging(saveConfig({ ...cfg, tagging: { ...cfg.tagging, level: 'session' } }));
  assert.ok(st.skillInstalled);
  const skill = readFileSync(path.join(claudeHome, 'skills', 'burner-tag', 'SKILL.md'), 'utf-8');
  assert.match(skill, /^---\nname: burner-tag\n/);
  assert.match(skill, /`debugging`/);
  assert.equal(st.claudeMdLevel, 'session');
  assert.match(readFileSync(path.join(claudeHome, 'CLAUDE.md'), 'utf-8'), /^# my rules\nbe nice\n\n<!-- burner:start -->/);

  st = applyTagging(saveConfig({ ...loadConfig(), tagging: { ...cfg.tagging, level: 'session', endModel: 'claude-haiku-test' } }));
  assert.ok(st.sessionEndHook);
  assert.equal(st.claudeMdLevel, null);
  assert.equal(st.endModel, 'claude-haiku-test');
  assert.equal(readFileSync(path.join(claudeHome, 'CLAUDE.md'), 'utf-8'), '# my rules\nbe nice\n');

  writeFileSync(path.join(claudeHome, 'settings.json'), JSON.stringify({ model: 'opus', hooks: { SessionEnd: [{ hooks: [{ type: 'command', command: 'echo bye' }] }, { hooks: [{ type: 'command', command: 'node "C:/x/burner/bin/burner.js" hook session-end' }] }] } }));
  st = applyTagging(saveConfig({ ...loadConfig(), tagging: { ...cfg.tagging, level: 'off' } }));
  assert.equal(st.claudeMdLevel, null);
  const settings = JSON.parse(readFileSync(path.join(claudeHome, 'settings.json'), 'utf-8'));
  assert.equal(settings.model, 'opus');
  assert.equal(settings.hooks.SessionEnd.length, 1, 'legacy burner hook is removed, the user\'s own stays');

  st = applyTagging(saveConfig({ ...loadConfig(), tagging: { ...cfg.tagging, level: 'manual' } }));
  assert.equal(readFileSync(path.join(claudeHome, 'CLAUDE.md'), 'utf-8'), '# my rules\nbe nice\n');
});

test('burner tag from inside a session resolves it by cwd and enforces project categories', async () => {
  const out = cli(['tag', 'debugging', '--session', '${CLAUDE_SESSION_ID}', '--reason', 'crash on save'], { cwd: workA });
  assert.match(out, /tagged debugging/);
  const tags = JSON.parse(readFileSync(path.join(burnerHome, 'tags.json'), 'utf-8'));
  assert.equal(tags['11111111-aaaa-4000-8000-000000000001'].category, 'debugging');
  assert.equal(tags['11111111-aaaa-4000-8000-000000000001'].source, 'skill');

  const { saveConfig, loadConfig } = await import('../src/config.js');
  saveConfig({ ...loadConfig(), projects: [{ name: 'App', paths: [workA, workB], categories: ['writing', 'coding'], defaultCategory: 'coding' }] });
  assert.throws(() => cli(['tag', 'debugging', '--session', '22222222'], { cwd: workB }), /Use one of: coding, writing/);
});

async function api(base, method, url, body) {
  const res = await fetch(base + url, { method, headers: body ? { 'Content-Type': 'application/json' } : {}, body: body ? JSON.stringify(body) : undefined });
  return { status: res.status, body: res.headers.get('content-type')?.includes('json') ? await res.json() : await res.text() };
}

test('server: state, projects, pricing overrides, theme', async () => {
  const { startServer } = await import('../src/server.js');
  const { server, url } = await startServer({ port: 0 });
  try {
    let r = await api(url, 'GET', '/api/state');
    assert.equal(r.status, 200);
    assert.equal(r.body.stats.sessions, 2);
    assert.deepEqual(r.body.directories.map((d) => d.project).sort(), ['App', 'App']);
    const glm = r.body.models.find((m) => m.rawModel === 'glm-4.6');
    assert.equal(glm.fidelity, 'unpriced');
    assert.equal(glm.suggested.output, 2.2);

    r = await api(url, 'POST', '/api/pricing/lookup', { model: 'glm-4.6' });
    assert.equal(r.body.found, true);
    assert.equal(r.body.rates.output, 2.2);
    r = await api(url, 'POST', '/api/pricing/lookup', { model: '' });
    assert.equal(r.status, 400);

    r = await api(url, 'PUT', '/api/pricing', { models: { 'glm-4.6': glm.suggested } });
    assert.equal(r.body.models.find((m) => m.rawModel === 'glm-4.6').fidelity, 'override');
    assert.match(readFileSync(path.join(burnerHome, 'pricing.yaml'), 'utf-8'), /glm-4\.6/);

    r = await api(url, 'PUT', '/api/config', { projects: [{ name: 'App', paths: [workA], categories: [], defaultCategory: 'nope' }] });
    assert.equal(r.status, 400);
    r = await api(url, 'PUT', '/api/config', { projects: [{ name: 'App', paths: [workA], categories: [], defaultCategory: null }] });
    assert.equal(r.status, 200);
    assert.equal(r.body.directories.find((d) => d.cwd === workB).implicit, true);

    const sidB = '22222222-aaaa-4000-8000-000000000002';
    r = await api(url, 'POST', '/api/session-project', { sessionId: sidB, project: 'Ghost' });
    assert.equal(r.status, 400);
    r = await api(url, 'POST', '/api/session-project', { sessionId: sidB, project: 'App' });
    assert.equal(r.status, 200);
    r = await api(url, 'GET', '/api/state');
    const dirB = r.body.directories.find((d) => d.cwd === workB);
    assert.equal(dirB.sessions, 0);
    assert.equal(dirB.moved, 1);
    assert.equal(r.body.projectTotals.find((p) => p.name === 'App').sessions, 2);
    r = await api(url, 'GET', '/api/sessions');
    assert.equal(r.body.find((s) => s.sessionId === sidB).projectSource, 'session');
    for (const s of r.body) {
      const days = s.daily.reduce((a, d) => a + d.cost, 0);
      assert.ok(Math.abs(days - s.totalCost.total) < 1e-9, 'daily spend adds up to the session cost');
    }
    // A tag written outside the server (CLI / skill) shows up without a restart or ?refresh
    {
      const { setTag, clearTag } = await import('../src/tags.js');
      const sidA = '11111111-aaaa-4000-8000-000000000001';
      await api(url, 'GET', '/api/sessions');
      await new Promise((res) => setTimeout(res, 30));
      setTag(sidA, { category: 'learning', source: 'manual' });
      r = await api(url, 'GET', '/api/sessions');
      assert.equal(r.body.find((s) => s.sessionId === sidA).category, 'learning');
      clearTag(sidA);
      await new Promise((res) => setTimeout(res, 30));
      r = await api(url, 'GET', '/api/sessions');
      assert.notEqual(r.body.find((s) => s.sessionId === sidA).category, 'learning');
    }
    r = await api(url, 'POST', '/api/session-project', { sessionId: sidB, project: null });
    r = await api(url, 'GET', '/api/state');
    assert.equal(r.body.directories.find((d) => d.cwd === workB).moved, 0);

    r = await api(url, 'GET', '/');
    assert.match(r.body, /USAGE ANALYTICS REPORT/);
    assert.doesNotMatch(r.body, /TEXAS|TI USAGE|a1266068/);
    r = await api(url, 'GET', '/receipt/22222222');
    assert.match(r.body, /\[\$0 · unpriced\]|README/);

    const badStatus = await new Promise((resolve, reject) => {
      http.get({ host: '127.0.0.1', port: server.address().port, path: '/api/state', headers: { Host: 'evil.example' } }, (res) => {
        res.resume();
        resolve(res.statusCode);
      }).on('error', reject);
    });
    assert.equal(badStatus, 403);
    const form = await fetch(url + '/api/tag', { method: 'POST', body: 'sessionId=x', headers: { 'Content-Type': 'application/x-www-form-urlencoded' } });
    assert.equal(form.status, 415);

    r = await api(url, 'PUT', '/api/theme', { theme: 'matrix' });
    assert.equal(r.status, 200);
    r = await api(url, 'PUT', '/api/theme', { theme: 'nope' });
    assert.equal(r.status, 400);
    r = await api(url, 'GET', '/');
    assert.match(r.body, /var t="matrix"/);

    // the chosen time range is remembered, and changing the theme keeps it
    r = await api(url, 'PUT', '/api/range', { range: '30' });
    assert.equal(r.status, 200);
    r = await api(url, 'PUT', '/api/range', { range: 'bogus' });
    assert.equal(r.status, 400);
    r = await api(url, 'PUT', '/api/theme', { theme: 'matrix' });
    r = await api(url, 'GET', '/');
    assert.match(r.body, /const RANGE0 = \{"range":"30"/);
    r = await api(url, 'PUT', '/api/range', { range: 'custom', from: '2026-09-01', to: '2026-09-30' });
    r = await api(url, 'GET', '/');
    assert.match(r.body, /"from":"2026-09-01","to":"2026-09-30"/);
    r = await api(url, 'GET', '/settings');
    assert.match(r.body, /var t="matrix"/);
  } finally {
    server.closeAllConnections();
    server.close();
  }
});
