import { discoverSessions, findSession, latestSession } from './discover.js';
import { buildReceipt, loadPricingTable } from './build-receipt.js';
import { renderReceipts, openInBrowser } from './render.js';

function fmtUsd(n) {
  return '$' + n.toFixed(3);
}

function printList(sessions, table) {
  console.log('SESSION   PROJECT                          DATE                 MODELS   COST');
  for (const s of sessions) {
    const r = buildReceipt(s, table);
    const date = r.startedAt ? new Date(r.startedAt).toISOString().slice(0, 10) : 'unknown';
    const models = r.models.map((m) => m.displayName.replace(/\s*\(.*\)/, '')).join(', ') || 'none';
    console.log(
      `${s.sessionId.slice(0, 8)}  ${s.project.slice(0, 30).padEnd(30)}  ${date.padEnd(19)}  ${models.padEnd(8)}  ${fmtUsd(r.totals.cost.total)}`
    );
  }
}

async function main() {
  const args = process.argv.slice(2);
  const asJson = args.includes('--json');
  const filtered = args.filter((a) => a !== '--json');

  if (filtered[0] === 'list') {
    const sessions = discoverSessions();
    if (!sessions.length) {
      console.log('No Claude Code sessions found under ~/.claude/projects.');
      return;
    }
    const table = await loadPricingTable();
    if (asJson) {
      console.log(JSON.stringify(sessions.map((s) => buildReceipt(s, table)), null, 2));
    } else {
      printList(sessions, table);
    }
    return;
  }

  let sessions;
  if (filtered.includes('--all')) {
    sessions = discoverSessions();
  } else if (filtered[0]) {
    const found = findSession(filtered[0]);
    if (!found) {
      console.error(`No session found matching "${filtered[0]}". Try "burner-cc list".`);
      process.exitCode = 1;
      return;
    }
    sessions = [found];
  } else {
    const latest = latestSession();
    if (!latest) {
      console.log('No Claude Code sessions found under ~/.claude/projects.');
      return;
    }
    sessions = [latest];
  }

  const table = await loadPricingTable();
  const receipts = sessions.map((s) => buildReceipt(s, table));

  if (asJson) {
    console.log(JSON.stringify(receipts, null, 2));
    return;
  }

  const outFile = renderReceipts(receipts);
  console.log(`Receipt written to ${outFile}`);
  openInBrowser(outFile);
}

main().catch((err) => {
  console.error('burner-cc failed:', err.message);
  process.exitCode = 1;
});
