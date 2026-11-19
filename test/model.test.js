import test from 'node:test';
import assert from 'node:assert/strict';
import { trainLearned, predictLearned, learnFromTag, evaluateLeaveOneOut, features } from '../src/classifier.js';

const d = (project, branch, title, prompts, tools) => ({ project, branch, title, prompts, tools, toolCount: tools.reduce((a, [, n]) => a + n, 0) });

// Two recurring patterns: a code repo worked on feature/fix branches, and a docs repo.
const code = (i) => d('api', i % 2 ? 'fix/crash' : 'feat/endpoint', `change ${i}`, [`please fix the handler number ${i} and add a unit test`, 'run the tests again'], [['Edit(.ts)', 6], ['Read(.ts)', 3], ['Bash(npm test)', 2]]);
const docs = (i) => d('notes', 'main', `write ${i}`, [`draft the weekly update number ${i} for the team`, 'shorter please'], [['Write(.md)', 2], ['Read(.md)', 1]]);
const examples = [];
for (let i = 0; i < 12; i++) examples.push({ digest: code(i), category: 'coding', weight: 1 }, { digest: docs(i), category: 'writing', weight: 1 });

test('version 2 features count each word once and add project, branch, mix and size', () => {
  const f = features(d('api', 'fix/x', 'T', ['deploy deploy deploy now'], [['Edit(.ts)', 9]]));
  assert.equal(f.filter((x) => x === 'deploy').length, 1);
  for (const want of ['f:deploy', 'p:api', 'br:fix', 'mix:edit', 'size:medium', 'tc:edit:5+', 't:edit(.ts)']) assert.ok(f.includes(want), want);
  // a version 1 model keeps its own feature space
  assert.ok(features(d(null, null, null, ['deploy deploy'], []), 1).filter((x) => x === 'deploy').length === 2);
});

test('a trained model separates the two patterns, including a session with no prompt words', () => {
  const model = trainLearned(examples);
  assert.equal(model.version, 2);
  assert.equal(predictLearned(model, code(99)).category, 'coding');
  assert.equal(predictLearned(model, docs(99)).category, 'writing');
  // only project + tools known: still recognised
  const bare = predictLearned(model, d('notes', null, null, [], [['Write(.md)', 1]]));
  assert.equal(bare.category, 'writing');
});

test('confidence is tempered so a long session is not always ~100% sure', () => {
  const model = trainLearned(examples);
  const ambiguous = d('api', 'main', 'x', ['draft the update and fix the handler'], [['Edit(.md)', 1]]);
  assert.ok(predictLearned(model, ambiguous).confidence < 0.99);
});

test('one new tag is learned in place; re-tagging moves it between classes', () => {
  let m = trainLearned(examples);
  const before = m.classes.coding.docs;
  const dg = code(50);
  m = learnFromTag(m, { sessionId: 's1', digest: dg, category: 'coding' });
  assert.equal(m.classes.coding.docs, before + 5);
  m = learnFromTag(m, { sessionId: 's1', digest: dg, category: 'coding' }); // same tag again: no double count
  assert.equal(m.classes.coding.docs, before + 5);
  m = learnFromTag(m, { sessionId: 's1', digest: dg, category: 'writing' }); // changed its mind
  assert.equal(m.classes.coding.docs, before);
  assert.ok(Object.values(m.classes.coding.counts).every((n) => n >= 0));
  // starting with no model at all works too
  const fresh = learnFromTag(null, { sessionId: 'a', digest: code(1), category: 'coding' });
  assert.equal(fresh.classes.coding.docs, 5);
});

test('leave-one-out reports accuracy, baseline and coverage; too little data returns null', () => {
  assert.equal(evaluateLeaveOneOut(examples.slice(0, 4)), null);
  const r = evaluateLeaveOneOut(examples);
  assert.equal(r.n, 24);
  assert.equal(r.baseline, 0.5);
  assert.ok(r.accuracy >= 0.95);
  assert.ok(r.coverage > 0 && r.precision >= 0.95);
  const old = evaluateLeaveOneOut(examples, { version: 1 });
  assert.ok(r.accuracy >= old.accuracy);
});

test('a model with only a couple of your tags keeps learning but is not used to guess', async () => {
  const { resolveCategory, usableModel } = await import('../src/classifier.js');
  const { defaultConfig } = await import('../src/config.js');
  let m = learnFromTag(null, { sessionId: 'a', digest: code(1), category: 'coding' });
  m = learnFromTag(m, { sessionId: 'b', digest: docs(1), category: 'writing' });
  assert.equal(usableModel(m), null);
  const r = resolveCategory({ tag: null, project: { name: 'x', implicit: true, categories: [] }, cfg: defaultConfig(), digest: code(2), learned: m });
  assert.equal(r.category, 'untagged');
  for (let i = 2; i < 8; i++) m = learnFromTag(m, { sessionId: 'c' + i, digest: i % 2 ? docs(i) : code(i), category: i % 2 ? 'writing' : 'coding' });
  assert.ok(usableModel(m));
  assert.equal(resolveCategory({ tag: null, project: { name: 'x', implicit: true, categories: [] }, cfg: defaultConfig(), digest: code(2), learned: m }).category, 'coding');
});
