function fmtUsd(n) {
  if (n === null || n === undefined) return '???';
  return '$' + n.toFixed(3);
}

function fmtTok(n) {
  return n.toLocaleString('en-US') + ' tok';
}

function shortDate(iso) {
  if (!iso) return 'unknown';
  const d = new Date(iso);
  return d.toLocaleDateString('en-US', { day: '2-digit', month: 'short', year: 'numeric' }).toUpperCase();
}

function barcode(seed) {
  const bars = [];
  let x = seed || 1;
  for (let i = 0; i < 46; i++) {
    x = (x * 9301 + 49297) % 233280;
    const w = 1 + (x % 3);
    const h = 24 + (x % 20);
    bars.push(`<span style="width:${w}px;height:${h}px"></span>`);
  }
  return bars.join('');
}

function hashSeed(str) {
  let h = 0;
  for (let i = 0; i < str.length; i++) h = (h * 31 + str.charCodeAt(i)) >>> 0;
  return h;
}

function modelBlock(m) {
  const rows = [];
  rows.push(`<div class="model-heading">${m.displayName}${m.fidelity !== 'measured' ? ` <span class="unpriced-flag" title="${m.fidelity}">*</span>` : ''}</div>`);

  const t = m.tokens;
  const c = m.cost;
  const line = (label, tok, amt, indent) =>
    `<div class="line"><span class="label${indent ? ' indent' : ''}">${label}</span><span class="tok">${fmtTok(tok)}</span><span class="amt">${fmtUsd(amt)}</span></div>`;

  if (t.input) rows.push(line('FRESH INPUT (uncached)', t.input, c ? c.input : null, true));
  if (t.cacheWrite5m || t.cacheWrite1h) rows.push(line('CACHE WRITE (new context)', t.cacheWrite5m + t.cacheWrite1h, c ? c.cacheWrite : null, true));
  if (t.cacheRead) rows.push(line('CACHE READ (reused)', t.cacheRead, c ? c.cacheRead : null, true));
  if (t.output) rows.push(line('OUTPUT TOKENS', t.output, c ? c.output : null, true));

  return rows.join('');
}

function receiptHtml(session) {
  const totalTok = Object.values(session.totals.tokens).reduce((a, b) => a + b, 0);
  const allModels = [...session.models, ...session.subagentModels];

  const modelLines = session.models.map(modelBlock).join('');
  const subagentSection = session.subagentModels.length
    ? `<hr class="rule" /><div class="model-heading">SUBAGENTS (${session.subagentCount})</div>` +
      session.subagentModels.map(modelBlock).join('')
    : '';

  const seed = hashSeed(session.sessionId);
  const authCode = session.sessionId.slice(0, 4).toUpperCase() + '-' + (seed % 9999);

  return `
    <div class="receipt">
      <h1>CLAUDE CODE</h1>
      <div class="subtitle">AGENTIC SESSION RECEIPT</div>
      <div class="tagline">-- context economy division --</div>
      <hr class="rule" />
      <div class="meta-row">
        <div class="left">
          SESSION #${session.sessionId.slice(0, 8)}<br/>
          DATE: ${shortDate(session.startedAt)}<br/>
          PROJECT: ${session.project}
        </div>
        <div class="right">
          TURNS: ~${session.turnCount}<br/>
          MODELS: ${session.models.length}<br/>
          &nbsp;
        </div>
      </div>
      <hr class="rule" />
      ${modelLines}
      ${subagentSection}
      <hr class="rule" />
      <div class="line bold"><span class="label">SUBTOTAL</span><span class="tok">${fmtTok(totalTok)}</span><span class="amt"></span></div>
      <div class="line total bold"><span class="label">TOTAL</span><span class="tok"></span><span class="amt">${fmtUsd(session.totals.cost.total)}</span></div>
      <hr class="rule" />
      <div class="footer">
        PAID WITH: TOKEN BUDGET<br/>
        AUTH CODE: ${authCode}
        ${session.hasUnpriced ? '<br/><span class="unpriced-flag">* one or more models had no pricing entry — cost is a floor, not the true total</span>' : ''}
      </div>
      <hr class="rule" />
      <div class="footer">
        * THANK YOU FOR YOUR CONTEXT *<br/>
        ITEMS NON-REFUNDABLE ONCE SENT
        <div class="tip">SUGGESTED TIP: ${tipFor(session)}</div>
      </div>
      <div class="barcode">${barcode(seed)}</div>
      <div class="barcode-label">CC-SESSION-${session.sessionId.slice(0, 8).toUpperCase()}</div>
    </div>
  `;
}

function tipFor(session) {
  const t = session.totals.tokens;
  const cacheEff = t.cacheRead / (t.cacheRead + t.input + t.cacheWrite5m + t.cacheWrite1h || 1);
  if (cacheEff < 0.3 && (t.cacheWrite5m + t.cacheWrite1h) > 20000) {
    return 'LOW CACHE REUSE — AVOID LONG GAPS BETWEEN TURNS';
  }
  if (session.subagentCount > 3) {
    return 'HEAVY SUBAGENT USE — CHECK IF TASKS CAN BE MERGED';
  }
  if (t.output > t.input) {
    return 'OUTPUT-HEAVY SESSION — CONSIDER SHORTER RESPONSES';
  }
  return 'DISABLE UNUSED MCP SERVERS BEFORE CHECKOUT';
}

function render() {
  const data = window.__BURNER_DATA__ || [];
  const root = document.getElementById('root');
  if (!data.length) {
    root.innerHTML = '<div class="disclaimer">No session data found.</div>';
    return;
  }

  const grandTotal = data.reduce((a, s) => a + s.totals.cost.total, 0);
  const header = data.length > 1
    ? `<div class="grand-total">GRAND TOTAL ACROSS ${data.length} SESSIONS: <strong>${fmtUsd(grandTotal)}</strong></div>`
    : '';

  const pricingNote = {
    live: 'pricing fetched live from Anthropic-sourced rates',
    cache: 'pricing from local cache (<6h old)',
    'stale-cache': 'pricing from local cache (stale — offline)',
    'bundled-fallback': 'pricing from bundled offline fallback — may be outdated',
  }[data[0]?.pricingSource] ?? 'pricing source unknown';

  root.innerHTML = header + data.map(receiptHtml).join('') +
    `<div class="disclaimer">Estimated from local transcripts (${pricingNote}). Not official billing — check your Anthropic Console for ground truth. System-prompt / skill / MCP-schema composition breakdown is not available without request interception, so this receipt itemizes by token type (fresh / cache write / cache read / output) rather than by source.</div>`;
}

function setTheme(theme) {
  document.documentElement.setAttribute('data-theme', theme);
  localStorage.setItem('burner-theme', theme);
  document.querySelectorAll('.toolbar button').forEach((b) => {
    b.classList.toggle('active', b.dataset.theme === theme);
  });
}

document.addEventListener('DOMContentLoaded', () => {
  const saved = localStorage.getItem('burner-theme') || 'paper';
  setTheme(saved);
  document.querySelectorAll('.toolbar button').forEach((b) => {
    b.addEventListener('click', () => setTheme(b.dataset.theme));
  });
  render();
});
