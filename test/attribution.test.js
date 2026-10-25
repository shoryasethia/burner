import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, writeFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { parseTranscript } from '../src/parse.js';
import { buildReceipt } from '../src/build-receipt.js';

const table = {
  source: 'test',
  models: {
    'claude-sonnet-5': {
      input: 3,
      output: 15,
      cacheWrite5m: 3.75,
      cacheWrite1h: 6,
      cacheRead: 0.3,
    },
  },
};

function assistant({ id, output, input = 0, cacheWrite5m = 0, cacheWrite1h = 0, cacheRead = 0, tool, skill, mcpServer, mcpTool, model = 'claude-sonnet-5' }) {
  const content = [];
  if (tool) content.push({ type: 'tool_use', name: tool, input: tool === 'Skill' ? { skill } : {} });
  return {
    type: 'assistant',
    requestId: id,
    attributionSkill: skill && tool !== 'Skill' ? skill : undefined,
    attributionMcpServer: mcpServer,
    attributionMcpTool: mcpTool,
    timestamp: '2026-10-11T00:00:00.000Z',
    message: {
      role: 'assistant',
      type: 'message',
      model,
      content,
      usage: {
        input_tokens: input,
        output_tokens: output,
        cache_read_input_tokens: cacheRead,
        cache_creation_input_tokens: cacheWrite5m + cacheWrite1h,
        cache_creation: {
          ephemeral_5m_input_tokens: cacheWrite5m,
          ephemeral_1h_input_tokens: cacheWrite1h,
        },
      },
    },
  };
}

function writeTranscript(entries) {
  const dir = mkdtempSync(path.join(tmpdir(), 'burner-'));
  const file = path.join(dir, 'session.jsonl');
  writeFileSync(file, entries.map((entry) => JSON.stringify(entry)).join('\n'));
  return { dir, file };
}

function receiptFor(entries) {
  const { dir, file } = writeTranscript(entries);
  try {
    return buildReceipt({
      sessionId: 'abc',
      title: 'fixture',
      project: 'fixture',
      mainFile: file,
      subagentFiles: [],
    }, table);
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
}

test('one API request logged as several content blocks is billed once', () => {
  const call = assistant({
    id: 'req-a',
    output: 61,
    input: 2,
    cacheWrite5m: 288,
    cacheRead: 9000,
    tool: 'mcp__Claude_Browser__computer',
    skill: 'dataviz',
  });
  const duplicate = assistant({
    id: 'req-a',
    output: 61,
    input: 2,
    cacheWrite5m: 288,
    cacheRead: 9000,
    skill: 'dataviz',
    mcpServer: 'Claude Browser',
    mcpTool: 'computer',
  });
  const { dir, file } = writeTranscript([
    { ...call, message: { ...call.message, content: [{ type: 'thinking' }] } },
    call,
    duplicate,
  ]);
  try {
    const parsed = parseTranscript(file);
    assert.equal(parsed.turns.length, 1);
    assert.equal(parsed.turns[0].output, 61);
    assert.equal(parsed.turns[0].cacheRead, 9000);
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});

test('MCP cost is the call plus the next request, and a sticky attribution does not keep billing the server', () => {
  const receipt = receiptFor([
    assistant({
      id: 'req-a',
      output: 61,
      input: 2,
      cacheWrite5m: 288,
      cacheRead: 9000,
      tool: 'mcp__Claude_Browser__computer',
      skill: 'dataviz',
    }),
    assistant({ id: 'req-a', output: 61, input: 2, cacheWrite5m: 288, cacheRead: 9000 }),
    assistant({
      id: 'req-b',
      output: 1917,
      input: 2,
      cacheWrite5m: 2527,
      cacheRead: 9000,
      tool: 'Bash',
      skill: 'dataviz',
      mcpServer: 'Claude Browser',
      mcpTool: 'computer',
    }),
    assistant({
      id: 'req-c',
      output: 564,
      input: 2,
      cacheWrite5m: 1988,
      cacheRead: 9000,
      tool: 'Bash',
      skill: 'dataviz',
      mcpServer: 'Claude Browser',
      mcpTool: 'computer',
    }),
  ]);

  assert.equal(receipt.totals.tokens.output, 61 + 1917 + 564);
  assert.equal(receipt.totals.tokens.cacheRead, 27000);

  const server = receipt.attribution.mcp[0];
  assert.equal(server.displayName, 'Claude Browser');
  assert.equal(server.calls, 1);
  const computer = server.tools[0];
  assert.equal(computer.name, 'computer');
  assert.equal(computer.outputTokens, 61);
  assert.equal(computer.contextTokens, 2 + 2527);
  assert.equal(computer.contextMissing, 0);
  assert.deepEqual(computer.via, [{ skill: 'dataviz', calls: 1 }]);

  const skill = receipt.attribution.skills[0];
  assert.equal(skill.name, 'dataviz');
  assert.equal(skill.calls, 2);
  assert.equal(skill.outputTokens, 1917 + 564);
  assert.equal(skill.contextTokens, 2 + 1988);
  assert.equal(skill.contextMissing, 1);

  const outputRate = 15 / 1_000_000;
  const cacheRate = 3.75 / 1_000_000;
  const inputRate = 3 / 1_000_000;
  assert.ok(Math.abs(computer.outputCost - 61 * outputRate) < 1e-12);
  assert.ok(Math.abs(computer.contextCost - (2 * inputRate + 2527 * cacheRate)) < 1e-12);

  const attributed =
    computer.outputCost + computer.contextCost + skill.outputCost + skill.contextCost;
  assert.ok(attributed < receipt.totals.cost.total);
});

test('a call with no following request leaves context unknown, and cache read stays out of it', () => {
  const receipt = receiptFor([
    assistant({
      id: 'req-a',
      output: 10,
      input: 1,
      cacheWrite1h: 40,
      cacheRead: 5000,
      tool: 'mcp__Claude_Browser__navigate',
    }),
  ]);
  const tool = receipt.attribution.mcp[0].tools[0];
  assert.equal(tool.name, 'navigate');
  assert.equal(tool.contextTokens, 0);
  assert.equal(tool.contextMissing, 1);
  assert.equal(tool.contextCost, 0);
  assert.equal(receipt.totals.tokens.cacheRead, 5000);
  assert.equal(receipt.activity.web.WebSearch, undefined);
});

test('web calls stay counts, and a 1h cache write is priced on the skill that caused it', () => {
  const receipt = receiptFor([
    assistant({ id: 'req-a', output: 8, input: 1, cacheWrite1h: 20, tool: 'WebSearch', skill: 'dataviz' }),
    assistant({ id: 'req-b', output: 4, input: 3, cacheWrite5m: 5 }),
  ]);
  assert.equal(receipt.activity.web.WebSearch, 1);
  assert.equal(receipt.attribution.mcp.length, 0);
  const skill = receipt.attribution.skills[0];
  assert.equal(skill.contextTokens, 3 + 5);
  const expected = (3 * 3 + 5 * 3.75) / 1_000_000;
  assert.ok(Math.abs(skill.contextCost - expected) < 1e-12);
  assert.equal(skill.contextByModel, undefined);
});
