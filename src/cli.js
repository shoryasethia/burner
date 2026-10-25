import { writeFileSync, mkdirSync } from 'node:fs';
import path from 'node:path';
import { spawn } from 'node:child_process';
import { analyzeSessions } from './analyze.js';
import { renderReport } from './report.js';
import { renderReceipt } from './receipt.js';
import { loadConfig, HOME, UNTAGGED } from './config.js';
import { loadPricingTable } from './pricing.js';
import { clearTag } from './tags.js';
import { applyTagging, installStatus, uninstall, SKILL_NAME } from './install.js';
import { tagFromCli, trainFromTags, fetchSweChat, readJsonl, resolveCurrentSession } from './tagging.js';
import { readHookPayload, tagSessionAtEnd } from './tag-end.js';

const HELP = `
  burner - what your Claude Code sessions cost, and what they were for

  Usage
    burner                          open the web app (report + settings) on 127.0.0.1:4777
    burner serve [--port N] [--no-open]
    burner report [--no-open]       write a static report to ~/.burner/report.html
    burner list                     terminal table
    burner receipt [id|title]       one session's receipt (default: latest)

  Tagging
    burner tag <category> [--session ID] [--reason TEXT] [--task]
    burner tag --clear [--session ID]
    burner install                  install /${SKILL_NAME} globally + apply the tagging level
    burner uninstall                remove the skill and SessionEnd hook
    burner status

  Pricing & model
    burner pricing refresh          fetch fresh public prices now
    burner model train [--swe-chat] [--data FILE.jsonl] [--prior]   learn from your tags (+ optional public labels)

  Filters: --project <name>  --from YYYY-MM-DD  --to YYYY-MM-DD  --json  --offline
  Files:   ${HOME}
`;

function parseArgs(argv) {
  const opts = { _: [], open: true };
  for (let i = 0; i < argv.length; i++) {
    const a = argv[i];
    if (a === '--help' || a === '-h') opts.help = true;
    else if (a === '--json') opts.json = true;
    else if (a === '--no-open') opts.open = false;
    else if (a === '--offline') opts.offline = true;
    else if (a === '--all') opts.all = true;
    else if (a === '--task') opts.task = true;
    else if (a === '--clear') opts.clear = true;
    else if (a === '--swe-chat') opts.sweChat = true;
    else if (a === '--prior') opts.prior = true;
    else if (['--project', '--from', '--to', '--session', '--reason', '--port'].includes(a)) opts[a.slice(2)] = argv[++i];
    else if (a === '--data') opts.file = argv[++i];
    else opts._.push(a);
  }
  return opts;
}

const fmtTok = (n) => (n >= 1e6 ? (n / 1e6).toFixed(2) + 'M' : n >= 1e3 ? (n / 1e3).toFixed(1) + 'K' : String(n));
const fmtCost = (n) => '$' + n.toFixed(n > 0 && n < 0.01 ? 4 : 2);
const pad = (s, n) => String(s ?? '').slice(0, n).padEnd(n);

function openUrl(target) {
  const cmd = process.platform === 'win32' ? 'cmd' : process.platform === 'darwin' ? 'open' : 'xdg-open';
  const args = process.platform === 'win32' ? ['/c', 'start', '""', target] : [target];
  spawn(cmd, args, { detached: true, stdio: 'ignore' }).unref();
}

function printList(data) {
  const label = Object.fromEntries(data.categories.map((c) => [c.id, c.label]));
  const header = [pad('DATE', 10), pad('TITLE', 30), pad('PROJECT', 16), pad('CATEGORY', 15), pad('MODEL', 20), pad('TOKENS', 8), pad('COST', 9)].join('  ');
  console.log('\n  ' + header + '\n  ' + '─'.repeat(header.length));
  for (const s of data.sessions) {
    const model = s.models.map((m) => m.rawModel).join('+') || '-';
    const cat = (label[s.category] ?? s.category) + (s.categorySource === 'learned' ? '?' : '');
    console.log('  ' + [pad(s.date, 10), pad(s.title, 30), pad(s.project, 16), pad(cat, 15), pad(model, 20), pad(fmtTok(s.totalTokens.total), 8), pad(fmtCost(s.totalCost.total) + (s.hasUnpriced ? '*' : ''), 9)].join('  '));
  }
  const tok = data.sessions.reduce((a, s) => a + s.totalTokens.total, 0);
  const cost = data.sessions.reduce((a, s) => a + s.totalCost.total, 0);
  console.log(`\n  ${data.sessions.length} sessions | ${fmtTok(tok)} tokens | ${fmtCost(cost)} | pricing ${data.pricing.source}`);
  if (data.unpricedModels.length) console.log(`  * $0 until priced: ${data.unpricedModels.join(', ')} - set rates on Settings -> Pricing`);
  console.log('');
}

async function main() {
  const opts = parseArgs(process.argv.slice(2));
  const [cmd = 'serve', sub] = opts._;
  if (opts.help || cmd === 'help') return console.log(HELP);

  if (cmd === 'tag') {
    if (opts.clear) {
      const s = resolveCurrentSession(opts.session);
      if (!s) throw new Error('no session found');
      clearTag(s.sessionId);
      return console.log(`cleared tag on ${s.sessionId}`);
    }
    if (!sub) {
      const cfg = loadConfig();
      return console.log('categories: ' + cfg.categories.map((c) => c.id).join(', '));
    }
    const r = tagFromCli({ category: sub, session: opts.session, reason: opts.reason, task: opts.task });
    return console.log(`tagged ${r.category}${opts.task ? ' (task)' : ''} | ${r.project} | ${r.sessionId.slice(0, 8)}`);
  }

  if (cmd === 'hook' && sub === 'session-end') {
    const payload = await readHookPayload();
    const sid = payload.session_id ?? payload.sessionId ?? process.env.CLAUDE_SESSION_ID;
    const r = await tagSessionAtEnd({ sessionId: sid });
    if (r.skipped) return;
    if (r.error) {
      console.error(`  session-end tag failed: ${r.error}`);
      process.exitCode = 1;
      return;
    }
    if (r.ok) console.log(`  tagged ${r.category} (${r.model})`);
    return;
  }

  if (cmd === 'install') {
    const st = applyTagging(loadConfig());
    console.log(`  /${st.skillName} -> ${st.skillPath}${st.skillInstalled ? '' : ' (not installed: level is off)'}`);
    if (st.legacyClaudeMd) console.log('  legacy CLAUDE.md burner block: still present (run install to strip)');
    if (st.sessionEndHook) console.log('  SessionEnd hook: on (local auto-tag)');
    return;
  }
  if (cmd === 'uninstall') {
    uninstall();
    return console.log('  removed skill, hook, and legacy CLAUDE.md block');
  }
  if (cmd === 'status') {
    const cfg = loadConfig();
    return console.log(JSON.stringify({ home: HOME, tagging: cfg.tagging, install: installStatus(cfg) }, null, 2));
  }

  if (cmd === 'pricing') {
    const t = await loadPricingTable({ force: sub === 'refresh' });
    console.log(`  pricing: ${t.source} | ${Object.keys(t.models).length} models${t.error ? ' | ' + t.error : ''}`);
    if (sub === 'refresh' && t.source !== 'live') process.exitCode = 1;
    return;
  }

  if (cmd === 'model' && sub === 'train') {
    let prior = [];
    if (opts.sweChat) {
      process.stdout.write('  fetching SWE-chat prompt intents…');
      prior = (await fetchSweChat({ token: process.env.HF_TOKEN, onProgress: (n) => process.stdout.write(`\r  fetching SWE-chat prompt intents… ${n}`) })).map((r) => ({ ...r, source: 'swe-chat' }));
      console.log('');
    }
    if (opts.file) prior.push(...readJsonl(opts.file).map((r) => ({ text: r.text, category: r.category ?? r.label, source: path.basename(opts.file) })));
    const r = await trainFromTags({ prior, bootstrapPrior: !!opts.prior });
    return console.log(r.ok ? `  trained on ${r.examples} examples: ${JSON.stringify(r.classes)}` : '  ' + r.message);
  }

  if (cmd === 'serve') {
    const { startServer } = await import('./server.js');
    const want = Number(opts.port ?? 4777);
    let url;
    try {
      ({ url } = await startServer({ port: want }));
      console.log(`  burner -> ${url}   (settings: ${url}/settings) | Ctrl+C to stop`);
    } catch (err) {
      if (err.code !== 'EADDRINUSE') throw err;
      const base = `http://127.0.0.1:${want}`;
      const running = await fetch(base + '/api/state', { signal: AbortSignal.timeout(3000) }).then((r) => r.ok).catch(() => false);
      if (running) {
        console.log(`  burner is already running -> ${base}   (settings: ${base}/settings)`);
        if (opts.open) openUrl(base);
        return;
      }
      if (opts.port) throw new Error(`port ${want} is in use by another program; pick one with --port`);
      ({ url } = await startServer({ port: 0 }));
      console.log(`  port ${want} is busy, using ${url}   (settings: ${url}/settings) | Ctrl+C to stop`);
    }
    if (opts.open) openUrl(url);
    return;
  }

  const data = await analyzeSessions(opts);
  if (cmd === 'list') return opts.json ? console.log(JSON.stringify(data.sessions, null, 2)) : printList(data);
  if (opts.json) {
    const { digests, config, ...rest } = data;
    return console.log(JSON.stringify(rest, null, 2));
  }

  mkdirSync(HOME, { recursive: true });
  if (cmd === 'receipt') {
    const needle = (sub ?? 'latest').toLowerCase();
    const s = needle === 'latest' ? data.sessions[0] : data.sessions.find((x) => x.sessionId.startsWith(needle) || x.title.toLowerCase().includes(needle));
    if (!s) throw new Error(`no session matching "${sub}" - try "burner list"`);
    const file = path.join(HOME, `receipt-${s.sessionId.slice(0, 8)}.html`);
    writeFileSync(file, renderReceipt(s, data.categories), 'utf-8');
    console.log('  receipt -> ' + file);
    if (opts.open) openUrl(file);
    return;
  }

  if (cmd === 'report') {
    for (const s of data.sessions) writeFileSync(path.join(HOME, `receipt-${s.sessionId.slice(0, 8)}.html`), renderReceipt(s, data.categories), 'utf-8');
    const file = path.join(HOME, 'report.html');
    writeFileSync(file, renderReport(data, { served: false }), 'utf-8');
    const untagged = data.sessions.filter((s) => s.category === UNTAGGED.id).length;
    console.log(`  report -> ${file}  (${data.sessions.length} sessions, ${untagged} untagged)`);
    if (opts.open) openUrl(file);
    return;
  }

  console.log(HELP);
  process.exitCode = 1;
}

main().catch((err) => {
  console.error('  x ' + err.message);
  if (process.env.DEBUG) console.error(err.stack);
  process.exitCode = 1;
});
