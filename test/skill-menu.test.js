import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, existsSync, readFileSync, rmSync, readdirSync, mkdirSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';

const root = mkdtempSync(path.join(tmpdir(), 'burner-skill-'));
const claudeHome = path.join(root, 'claude');
process.env.CLAUDE_CONFIG_DIR = claudeHome;
process.env.BURNER_HOME = path.join(root, 'burner');
test.after(() => rmSync(root, { recursive: true, force: true, maxRetries: 20, retryDelay: 250 }));

const skills = () => readdirSync(path.join(claudeHome, 'skills')).sort();

test('every category gets a model-free menu skill; removed categories and level off clean up', async () => {
  const { defaultConfig } = await import('../src/config.js');
  const { applyTagging } = await import('../src/install.js');
  const cfg = defaultConfig();

  // a user's own skill that merely shares the prefix must survive
  const mine = path.join(claudeHome, 'skills', 'burner-tag-notes');
  mkdirSync(mine, { recursive: true });
  writeFileSync(path.join(mine, 'SKILL.md'), '---\nname: burner-tag-notes\n---\nmine\n');

  applyTagging(cfg);
  for (const c of cfg.categories) assert.ok(skills().includes(`burner-tag-${c.id}`));
  const coding = readFileSync(path.join(claudeHome, 'skills', 'burner-tag-coding', 'SKILL.md'), 'utf-8');
  assert.match(coding, /disable-model-invocation: true/);
  assert.match(coding, /!`.* tag coding --session "\$\{CLAUDE_SESSION_ID\}"/);
  const main = readFileSync(path.join(claudeHome, 'skills', 'burner-tag', 'SKILL.md'), 'utf-8');
  assert.match(main, /argument-hint: "\[coding\|debugging\|/);

  applyTagging({ ...cfg, categories: cfg.categories.filter((c) => c.id !== 'other') });
  assert.ok(!skills().includes('burner-tag-other'));
  assert.ok(skills().includes('burner-tag-coding'));

  applyTagging({ ...cfg, tagging: { ...cfg.tagging, level: 'off' } });
  assert.deepEqual(skills(), ['burner-tag-notes']);
  assert.ok(existsSync(path.join(mine, 'SKILL.md')));
});
