import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, mkdirSync, writeFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { parseYaml, stringifyYaml } from '../src/yaml.js';
import { normalizeModelId, lookupPricing, lookupPublic, buildTable, costFor } from '../src/pricing.js';
import { parseTranscript } from '../src/parse.js';
import { resolveProject, defaultConfig } from '../src/config.js';
import { resolveCategory, trainLearned, predictLearned, buildDigest } from '../src/classifier.js';
import { segmentTurns } from '../src/tags.js';

test('yaml round-trips config with Windows paths, quotes and nested lists', () => {
  const cfg = {
    version: 1,
    categories: [{ id: 'coding', label: 'Feature work', color: '#2980b9', description: "Building new stuff: APIs, UI & 'scripts'" }],
    projects: [
      { name: 'Burner', paths: ['C:\\Users\\me\\Desktop\\burner', '/home/me/burner-cc'], categories: ['coding', 'debugging'], defaultCategory: null },
      { name: 'true', paths: [], categories: [], defaultCategory: 'coding' },
    ],
    tagging: { level: 'auto', auto: { baseUrl: 'http://localhost:11434/v1', model: 'qwen2.5:1.5b', apiKey: '' }, learned: true },
  };
  const text = stringifyYaml(cfg);
  assert.deepEqual(parseYaml(text), cfg);
  assert.deepEqual(parseYaml('a: 1 # comment\nb:\n  - x\n  - "y # not comment"\nc: [1, two, "3"]\n'), { a: 1, b: ['x', 'y # not comment'], c: [1, 'two', '3'] });
});

test('model ids from Bedrock, Vertex and dated variants normalize to one key', () => {
  assert.equal(normalizeModelId('us.anthropic.claude-sonnet-4-5-20250929-v1:0'), 'claude-sonnet-4-5');
  assert.equal(normalizeModelId('claude-opus-4-1@20250805'), 'claude-opus-4-1');
  assert.equal(normalizeModelId('anthropic/claude-haiku-4-5-20251001'), 'claude-haiku-4-5');
  assert.equal(normalizeModelId('claude-sonnet-4[1m]'), 'claude-sonnet-4');
  assert.equal(normalizeModelId('claude-opus-5@default'), 'claude-opus-5');
});

test('Claude is priced publicly; non-Claude models are $0 unless the user sets a price', () => {
  const table = {
    models: buildTable({
      'claude-sonnet-5': { litellm_provider: 'anthropic', mode: 'chat', input_cost_per_token: 2e-6, output_cost_per_token: 1e-5, cache_read_input_token_cost: 2e-7, cache_creation_input_token_cost: 2.5e-6 },
      'openrouter/anthropic/claude-sonnet-5': { litellm_provider: 'openrouter', mode: 'chat', input_cost_per_token: 9e-6, output_cost_per_token: 9e-5 },
      'glm-4.6': { litellm_provider: 'zai', mode: 'chat', input_cost_per_token: 6e-7, output_cost_per_token: 2.2e-6 },
    }),
    overrides: { 'my-gateway-model': { input: 1, output: 2, cacheWrite5m: 0, cacheWrite1h: 0, cacheRead: 0 } },
  };
  const sonnet = lookupPricing('claude-sonnet-5-20260101', table);
  assert.equal(sonnet.fidelity, 'measured');
  assert.equal(sonnet.rates.input, 2);
  assert.equal(lookupPricing('sonnet', table).fidelity, 'approximate-alias');

  const glm = lookupPricing('glm-4.6', table);
  assert.equal(glm.fidelity, 'unpriced');
  assert.equal(glm.rates.output, 0);
  assert.equal(glm.suggested.output, 2.2);

  const local = lookupPricing('qwen3-coder:30b', table);
  assert.equal(local.fidelity, 'unpriced');
  assert.equal(costFor({ input: 1e6, output: 1e6 }, local.rates).total, 0);

  const gw = lookupPricing('my-gateway-model', table);
  assert.equal(gw.fidelity, 'override');
  assert.equal(costFor({ input: 1e6, output: 1e6 }, gw.rates).total, 3);
});

test('adding a model looks it up in the public list: exact, similar, or none', () => {
  const table = { models: buildTable({
    'claude-sonnet-5-5': { litellm_provider: 'anthropic', mode: 'chat', input_cost_per_token: 3e-6, output_cost_per_token: 1.5e-5 },
    'glm-4.6': { litellm_provider: 'zai', mode: 'chat', input_cost_per_token: 6e-7, output_cost_per_token: 2.2e-6 },
    'glm-4.6-air': { litellm_provider: 'zai', mode: 'chat', input_cost_per_token: 2e-7, output_cost_per_token: 1e-6 },
  }) };
  const a = lookupPublic('claude-sonnet-5-5', table);
  assert.equal(a.found, true);
  assert.equal(a.rates.input, 3);
  assert.equal(lookupPublic('anthropic/claude-sonnet-5-5-20260101', table).found, true);
  const b = lookupPublic('glm4.6-pro', table);
  assert.equal(b.found, false);
  assert.deepEqual(b.candidates.map((x) => x.id).sort(), ['glm-4.6', 'glm-4.6-air']);
  const none = lookupPublic('my-gateway-model', table);
  assert.equal(none.found, false);
  assert.equal(none.candidates.length, 0);
});

function writeJsonl(entries) {
  const dir = mkdtempSync(path.join(tmpdir(), 'burner-'));
  const file = path.join(dir, 's.jsonl');
  writeFileSync(file, entries.map((e) => JSON.stringify(e)).join('\n'));
  return { dir, file };
}

test('streamed chunks of one request count once, at the final usage', () => {
  const chunk = (output, content, ts) => ({
    type: 'assistant', requestId: 'req_1', timestamp: ts, cwd: 'C:\\work\\app',
    message: { id: 'msg_1', role: 'assistant', type: 'message', model: 'claude-sonnet-5', content, usage: { input_tokens: 2, output_tokens: output, cache_read_input_tokens: 17962, cache_creation_input_tokens: 400 } },
  });
  const { dir, file } = writeJsonl([
    { type: 'user', message: { role: 'user', content: 'fix the login crash on submit' }, timestamp: '2026-01-01T00:00:00Z' },
    { type: 'user', message: { role: 'user', content: [{ type: 'tool_result', content: 'ok' }] } },
    chunk(2, [{ type: 'thinking' }], '2026-01-01T00:00:01Z'),
    chunk(2, [{ type: 'tool_use', id: 't1', name: 'Read', input: { file_path: 'a.ts' } }], '2026-01-01T00:00:02Z'),
    chunk(418, [{ type: 'tool_use', id: 't2', name: 'Bash', input: { command: 'npm test -- login' } }], '2026-01-01T00:00:05Z'),
    chunk(418, [{ type: 'tool_use', id: 't2', name: 'Bash', input: { command: 'npm test -- login' } }], '2026-01-01T00:00:05Z'),
  ]);
  try {
    const p = parseTranscript(file);
    assert.equal(p.turns.length, 1);
    assert.equal(p.turns[0].output, 418);
    assert.equal(p.turns[0].cacheRead, 17962);
    assert.equal(p.digest.cwd, 'C:\\work\\app');
    assert.deepEqual(p.digest.prompts.map((x) => x.text), ['fix the login crash on submit']);
    assert.deepEqual(p.digest.tools, ['Read(.ts)', 'Bash(npm test)']);
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});

test('directories map to projects by longest prefix; others are implicit', () => {
  const cfg = { ...defaultConfig(), projects: [
    { name: 'Mono', paths: ['C:\\code\\mono'], categories: [], defaultCategory: null },
    { name: 'Mono web', paths: ['C:\\code\\mono\\web', 'D:\\other\\web-clone'], categories: ['coding'], defaultCategory: null },
  ] };
  assert.equal(resolveProject('C:\\code\\mono\\api', cfg).name, 'Mono');
  assert.equal(resolveProject('c:\\Code\\Mono\\web\\src', cfg).name, 'Mono web');
  assert.equal(resolveProject('D:\\other\\web-clone', cfg).name, 'Mono web');
  assert.equal(resolveProject('C:\\code\\mono-old', cfg).implicit, true);
  assert.equal(resolveProject('C:\\code\\mono-old', cfg).name, 'mono-old');
});

test('category comes from tag, then project default, else untagged — no tool-count guessing', () => {
  const cfg = defaultConfig();
  const digest = { prompts: ['add dark mode'], tools: [['Edit(.tsx)', 40]] };
  assert.equal(resolveCategory({ tag: { category: 'debugging', source: 'skill' }, project: { categories: [] }, cfg, digest }).category, 'debugging');
  assert.equal(resolveCategory({ project: { categories: [], defaultCategory: 'writing' }, cfg, digest }).category, 'writing');
  assert.equal(resolveCategory({ project: { categories: ['research'] }, cfg, digest }).category, 'research');
  const none = resolveCategory({ project: { categories: [] }, cfg, digest });
  assert.equal(none.category, 'untagged');
  assert.equal(none.source, 'none');
});

test('trainFromTags returns a clear message instead of throwing when data is insufficient', async () => {
  const home = mkdtempSync(path.join(tmpdir(), 'burner-train-'));
  const claude = mkdtempSync(path.join(tmpdir(), 'burner-claude-'));
  const prevB = process.env.BURNER_HOME;
  const prevC = process.env.CLAUDE_CONFIG_DIR;
  process.env.BURNER_HOME = home;
  process.env.CLAUDE_CONFIG_DIR = claude;
  mkdirSync(path.join(home, 'cache'), { recursive: true });
  writeFileSync(path.join(home, 'tags.json'), '{}');
  writeFileSync(path.join(home, 'cache', 'litellm-pricing.json'), JSON.stringify({ fetchedAt: Date.now(), models: {} }));
  try {
    const { trainFromTags } = await import('../src/tagging.js');
    const r = await trainFromTags();
    assert.equal(typeof r.ok, 'boolean');
    assert.ok(r.message || r.ok);
    if (!r.ok) assert.match(r.message, /need at least 6|could not write|disk full/i);
  } finally {
    if (prevB === undefined) delete process.env.BURNER_HOME;
    else process.env.BURNER_HOME = prevB;
    if (prevC === undefined) delete process.env.CLAUDE_CONFIG_DIR;
    else process.env.CLAUDE_CONFIG_DIR = prevC;
    rmSync(home, { recursive: true, force: true });
    rmSync(claude, { recursive: true, force: true });
  }
});

test('learned model picks up the user\'s own labels', () => {
  const ex = (prompt, tools, category) => ({ digest: { prompts: [prompt], tools }, category });
  const model = trainLearned([
    ex('fix crash when saving profile, stack trace attached', [['Bash(npm test)', 3], ['Edit(.ts)', 2]], 'debugging'),
    ex('error 500 on login, debug it', [['Read(.ts)', 5]], 'debugging'),
    ex('tests are failing after merge, broken build', [['Bash(npm test)', 6]], 'debugging'),
    ex('add a settings page with dark mode toggle', [['Write(.tsx)', 3], ['Edit(.tsx)', 9]], 'coding'),
    ex('implement export to csv for reports', [['Edit(.ts)', 7]], 'coding'),
    ex('build a new onboarding flow', [['Write(.tsx)', 4]], 'coding'),
  ]);
  assert.equal(predictLearned(model, { prompts: ['the app crashes with an error on save'], tools: [['Bash(npm test)', 2]] }).category, 'debugging');
  assert.equal(predictLearned(model, { prompts: ['add a new page for billing'], tools: [['Write(.tsx)', 2]] }).category, 'coding');
  assert.equal(predictLearned(model, { prompts: ['x'], tools: [] }, ['coding']), null);
});

test('task segments split a session\'s turns by tag time', () => {
  const turns = [
    { timestamp: '2026-01-01T00:01:00Z' }, { timestamp: '2026-01-01T00:02:00Z' },
    { timestamp: '2026-01-01T00:05:00Z' }, { timestamp: '2026-01-01T00:09:00Z' },
  ];
  const groups = segmentTurns(turns, [
    { category: 'debugging', at: '2026-01-01T00:03:00Z' },
    { category: 'writing', at: '2026-01-01T00:06:00Z' },
  ]);
  assert.deepEqual(groups.map((g) => [g.category, g.turns.length]), [['debugging', 2], ['writing', 2]]);
});

test('digest keeps prompts short and tools ranked', () => {
  const d = buildDigest({ digest: { cwd: 'x', aiTitle: 'T', prompts: [{ text: 'a'.repeat(1000) }], tools: ['Read', 'Edit', 'Read'] } }, { projectName: 'P' });
  assert.equal(d.prompts[0].length, 400);
  assert.deepEqual(d.tools[0], ['Read', 2]);
  assert.equal(d.project, 'P');
});

test('parseTranscript copes with gateway / on-prem usage shapes', async () => {
  const fs = await import('node:fs');
  const os = await import('node:os');
  const path = await import('node:path');
  const { parseTranscript } = await import('../src/parse.js');
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'burner-onprem-'));
  const asst = (id, rid, usage, model = 'qwen3-coder:30b') => ({ type: 'assistant', requestId: rid, timestamp: '2026-10-01T10:00:00Z', message: { id, role: 'assistant', model, content: [{ type: 'text', text: 'x' }], usage } });
  const user = () => ({ type: 'user', timestamp: '2026-10-01T10:00:01Z', message: { role: 'user', content: [{ type: 'tool_result', content: 'ok' }] } });
  const parse = (name, entries) => {
    const f = path.join(dir, name + '.jsonl');
    fs.writeFileSync(f, entries.map((e) => JSON.stringify(e)).join('\n'));
    return parseTranscript(f);
  };
  const sum = (p) => p.turns.reduce((a, t) => a + t.input + t.output + t.cacheWrite5m + t.cacheWrite1h + t.cacheRead, 0);

  // one constant message id, no requestId: still three separate requests
  assert.equal(sum(parse('const-id', [asst('msg_1', undefined, { input_tokens: 100, output_tokens: 50 }), user(), asst('msg_1', undefined, { input_tokens: 300, output_tokens: 70 }), user(), asst('msg_1', undefined, { input_tokens: 500, output_tokens: 20 })])), 1040);
  // streamed chunks of one response (no tool result between) are still one request
  assert.equal(sum(parse('chunks', [asst('msg_9', undefined, { input_tokens: 100, output_tokens: 5 }), asst('msg_9', undefined, { input_tokens: 100, output_tokens: 40 })])), 140);
  // string / null counts never concatenate or NaN
  assert.equal(sum(parse('strings', [asst('m1', 'r1', { input_tokens: '100', output_tokens: '50', cache_read_input_tokens: null })])), 150);
  // OpenAI-style names
  assert.equal(sum(parse('openai', [asst('m1', 'r1', { prompt_tokens: 100, completion_tokens: 50 })])), 150);
  // no usage reported: the request and model are kept, flagged, at 0 tokens
  const none = parse('none', [asst('m1', 'r1', { input_tokens: 0, output_tokens: 0 }), user(), asst('m2', 'r2', undefined)]);
  assert.equal(none.turns.length, 2);
  assert.ok(none.turns.every((x) => x.unreported && x.model === 'qwen3-coder:30b'));
});
