// Wires burner into Claude Code globally (~/.claude), never per-repo:
//   skills/<SKILL_NAME>/SKILL.md  — the tag skill, available in every project
//   SessionEnd hook               — session level: local auto-tag (no API, no CLAUDE.md)

import { readFileSync, writeFileSync, mkdirSync, existsSync, rmSync } from 'node:fs';
import path from 'node:path';
import process from 'node:process';
import { fileURLToPath } from 'node:url';
import { CLAUDE_HOME } from './config.js';

export const SKILL_NAME = 'burner-tag';
const __dirname = path.dirname(fileURLToPath(import.meta.url));
const BIN = path.resolve(__dirname, '..', 'bin', 'burner.js');
const START = '<!-- burner:start -->';
const END = '<!-- burner:end -->';

const paths = () => ({
  skillDir: path.join(CLAUDE_HOME, 'skills', SKILL_NAME),
  skillFile: path.join(CLAUDE_HOME, 'skills', SKILL_NAME, 'SKILL.md'),
  claudeMd: path.join(CLAUDE_HOME, 'CLAUDE.md'),
  settings: path.join(CLAUDE_HOME, 'settings.json'),
  legacyCommand: path.join(CLAUDE_HOME, 'commands', 'tag-my-session.md'),
});

export const NPM_CLI = 'burner';

function nodeCmd() {
  return `node "${BIN}"`;
}

function pathNorm(p) {
  return path.resolve(p).replace(/\\/g, '/').toLowerCase();
}

/** True when the running entrypoint is this repo's bin/burner.js (not npm global link). */
export function isDevCheckout() {
  const entry = process.argv[1] ? path.resolve(process.argv[1]) : '';
  return entry && pathNorm(entry) === pathNorm(BIN);
}

/** Shell command users should run (global npm: `burner …`; dev checkout: `node …/burner.js …`). */
export function burnerShell(sub = '') {
  const tail = sub ? ` ${sub}` : '';
  return isDevCheckout() ? `${nodeCmd()}${tail}` : `${NPM_CLI}${tail}`;
}

/** Paste into Claude Code / Cursor chat if /burner-tag is missing after you changed categories. */
export function skillSetupPrompt() {
  const cmd = burnerShell('install');
  const home = CLAUDE_HOME;
  const dev = isDevCheckout() ? `\n(While developing this repo, that resolves to: ${nodeCmd()} install)` : '';
  return `Set up burner session tagging on this machine (global, not per-repo):
1. Run in a terminal: ${cmd}${dev}
   (After npm i -g burner-cc, the same command is just: burner install)
2. That writes ${path.join(home, 'skills', SKILL_NAME, 'SKILL.md')} and applies the tagging level from ~/.burner/config.yaml (SessionEnd hook when level is session).
3. Re-run install after you change categories or tagging level on the Settings page.
Do not edit project repos for this — only files under ${home}.`;
}

export function skillMarkdown(cfg) {
  const cats = cfg.categories.map((c) => `- \`${c.id}\` — ${c.description || c.label}`).join('\n');
  return `---
name: ${SKILL_NAME}
description: Tag the current Claude Code session with what it was used for (coding, debugging, planning, research, writing, …) for burner usage analytics. Use when the user runs /${SKILL_NAME} or asks to tag/categorize this session.
---

# ${SKILL_NAME}

Pick the one category that best describes the **user's intent** for the work being tagged — what they wanted done, not which tools you happened to use. Works for any kind of work, technical or not. Reading files to fix a bug is \`debugging\`, not \`research\`.

${cats}

Then run exactly one command (no extra exploration first):

\`\`\`bash
${burnerShell('tag')} <category> --session "\${CLAUDE_SESSION_ID}" --reason "<under 12 words>"
\`\`\`

- When asked to tag a single finished task inside a longer session, add \`--task\` so the session can be split across categories.
- If the command says the category isn't allowed for this project, pick the closest allowed one it lists and run it again.
- Don't tell the user about it unless they ran /${SKILL_NAME} themselves or the command failed. Then reply with one line: \`tagged <category>\`.
`;
}

function readJsonFile(file) {
  if (!existsSync(file)) return {};
  try {
    return JSON.parse(readFileSync(file, 'utf-8'));
  } catch (err) {
    throw new Error(`${file} is not valid JSON (${err.message}); fix it before burner can add its hook`);
  }
}

/** Claude Code command hook (exec form): node + burner.js, no shell/PATH/.cmd shims. */
export function sessionEndHookEntry() {
  return {
    type: 'command',
    command: process.execPath,
    args: [BIN, 'hook', 'session-end'],
    timeout: 60,
  };
}

function isOurHook(h) {
  if (h?.type !== 'command') return false;
  const args = h.args;
  if (Array.isArray(args) && args.includes('hook') && args[args.length - 1] === 'session-end') return true;
  return typeof h.command === 'string' && h.command.includes('hook session-end');
}

function ensureSessionEndHook() {
  const { settings: file } = paths();
  let settings;
  try { settings = readJsonFile(file); } catch { settings = {}; }
  const entry = sessionEndHookEntry();
  const hooks = settings.hooks ?? {};
  const before = JSON.stringify(settings);
  let groups = (hooks.SessionEnd ?? [])
    .map((g) => ({ ...g, hooks: (g.hooks ?? []).filter((h) => !isOurHook(h)) }))
    .filter((g) => g.hooks.length);
  groups.push({ hooks: [entry] });
  settings.hooks = { ...hooks, SessionEnd: groups };
  if (JSON.stringify(settings) === before) return;
  mkdirSync(path.dirname(file), { recursive: true });
  writeFileSync(file, JSON.stringify(settings, null, 2) + '\n', 'utf-8');
}

// Remove burner's SessionEnd hook (legacy "auto" mode used the same command).
function removeSessionEndHook() {
  const { settings: file } = paths();
  let settings;
  try { settings = readJsonFile(file); } catch { return; }
  const before = JSON.stringify(settings);
  const hooks = settings.hooks ?? {};
  const groups = (hooks.SessionEnd ?? [])
    .map((g) => ({ ...g, hooks: (g.hooks ?? []).filter((h) => !isOurHook(h)) }))
    .filter((g) => g.hooks.length);
  if (groups.length) hooks.SessionEnd = groups;
  else delete hooks.SessionEnd;
  if (Object.keys(hooks).length) settings.hooks = hooks;
  else delete settings.hooks;
  if (JSON.stringify(settings) === before) return;
  mkdirSync(path.dirname(file), { recursive: true });
  writeFileSync(file, JSON.stringify(settings, null, 2) + '\n', 'utf-8');
}

/** Remove legacy burner blocks from ~/.claude/CLAUDE.md (we no longer install them). */
export function stripBurnerClaudeMd() {
  const { claudeMd } = paths();
  if (!existsSync(claudeMd)) return;
  const current = readFileSync(claudeMd, 'utf-8');
  const re = new RegExp(`\\n?${START}[\\s\\S]*?${END}\\n?`, 'g');
  const next = current.replace(re, '\n').replace(/\s+$/, '');
  if (next.trim() === current.trim()) return;
  writeFileSync(claudeMd, next ? next + '\n' : '', 'utf-8');
}

export function installSkill(cfg) {
  const p = paths();
  mkdirSync(p.skillDir, { recursive: true });
  writeFileSync(p.skillFile, skillMarkdown(cfg), 'utf-8');
  if (existsSync(p.legacyCommand)) rmSync(p.legacyCommand);
}

// Applies the tagging level from config to ~/.claude. Idempotent.
export function applyTagging(cfg) {
  const level = cfg.tagging?.level ?? 'manual';
  if (level === 'off') {
    const p = paths();
    if (existsSync(p.skillDir)) rmSync(p.skillDir, { recursive: true, force: true });
  } else {
    installSkill(cfg);
  }
  stripBurnerClaudeMd();
  removeSessionEndHook();
  if (level === 'session') ensureSessionEndHook();
  return installStatus(cfg);
}

export function uninstall() {
  const p = paths();
  if (existsSync(p.skillDir)) rmSync(p.skillDir, { recursive: true, force: true });
  stripBurnerClaudeMd();
  removeSessionEndHook();
}

export function installStatus(cfg = null) {
  const p = paths();
  let hookInstalled = false;
  try {
    const settings = readJsonFile(p.settings);
    hookInstalled = (settings.hooks?.SessionEnd ?? []).some((g) => (g.hooks ?? []).some(isOurHook));
  } catch { /* no settings */ }
  const md = existsSync(p.claudeMd) ? readFileSync(p.claudeMd, 'utf-8') : '';
  const legacyClaudeMd = !!md.match(new RegExp(`${START}[\\s\\S]*?${END}`));
  return {
    skillName: SKILL_NAME,
    skillInstalled: existsSync(p.skillFile),
    skillPath: p.skillFile,
    skillInstallCmd: burnerShell('install'),
    skillInstallCmdNpm: `${NPM_CLI} install`,
    devCheckout: isDevCheckout(),
    legacyClaudeMd,
    sessionEndHook: hookInstalled,
    claudeHome: CLAUDE_HOME,
  };
}
