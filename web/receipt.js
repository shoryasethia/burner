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

const TAGLINES = [
  'context in, cash out',
  'tokens are not free, apparently',
  'thoughts, itemized',
  'you paid for every "let me check"',
  'burned so you don’t have to guess',
];

function taglineFor(seed) {
  return TAGLINES[seed % TAGLINES.length];
}

// The barcode isn't decorative noise: it's a real (if silly) binary
// encoding of the session's total cost in cents, so two receipts only
// look alike if they cost the same. Widest bar = most significant bit.
function barcode(totalCost, seed) {
  const cents = Math.max(0, Math.round(totalCost * 100));
  const bits = cents.toString(2).padStart(16, '0').slice(-16);
  const bars = [];
  for (const bit of bits) {
    const w = bit === '1' ? 4 : 1;
    bars.push(`<span style="width:${w}px;height:32px"></span>`);
    bars.push(`<span style="width:1px;height:32px;background:transparent"></span>`);
  }
  // A few seeded filler bars purely so short/cheap sessions don't render
  // a suspiciously tiny barcode.
  let x = seed || 1;
  for (let i = 0; i < 10; i++) {
    x = (x * 9301 + 49297) % 233280;
    bars.push(`<span style="width:${1 + (x % 2)}px;height:${18 + (x % 14)}px"></span>`);
  }
  return { html: bars.join(''), title: `encodes total cost: ${cents}¢ as binary (${bits})` };
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

function receiptHtml(session, index) {
  const totalTok = Object.values(session.totals.tokens).reduce((a, b) => a + b, 0);
  const seed = hashSeed(session.sessionId);

  const modelLines = session.models.map(modelBlock).join('');
  const subagentSection = (session.subagentGroups ?? []).length
    ? `<hr class="rule" />` + session.subagentGroups.map((g) =>
        `<div class="model-heading">SUBAGENT: ${g.agentType.toUpperCase()} (${g.runCount} run${g.runCount > 1 ? 's' : ''})</div>` +
        g.models.map(modelBlock).join('')
      ).join('')
    : '';

  const activitySection = attributedHtml(session);

  const authCode = session.sessionId.slice(0, 4).toUpperCase() + '-' + (seed % 9999);
  const bc = barcode(session.totals.cost.total, seed);
  const notSubscription = session.billingMode !== 'subscription-likely';
  const totalLabel = notSubscription ? 'TOTAL' : 'API-EQUIVALENT VALUE';
  const paidWith = notSubscription ? 'TOKEN BUDGET' : 'FLAT-FEE PLAN (est. value shown, not what you paid)';

  return `
    <div class="receipt" data-session="${session.sessionId}">
      <h1>CLAUDE CODE</h1>
      <div class="subtitle">AGENTIC SESSION RECEIPT</div>
      <div class="tagline">-- ${taglineFor(seed)} --</div>
      <hr class="rule" />
      <div class="meta-row">
        <div class="left">
          SESSION: ${session.title ?? session.sessionId.slice(0, 8)}<br/>
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
      <div class="line total bold"><span class="label">${totalLabel}</span><span class="tok"></span><span class="amt">${fmtUsd(session.totals.cost.total)}</span></div>
      ${activitySection}
      <hr class="rule" />
      <div class="footer">
        PAID WITH: ${paidWith}<br/>
        AUTH CODE: ${authCode}
        ${session.hasUnpriced ? '<br/><span class="unpriced-flag">* one model unpriced — total is a floor</span>' : ''}
      </div>
      <hr class="rule" />
      <div class="footer">
        * THANK YOU FOR YOUR CONTEXT *<br/>
        ITEMS NON-REFUNDABLE ONCE SENT
        <div class="tip">SUGGESTED TIP: ${tipFor(session)}</div>
      </div>
      <div class="barcode" title="${bc.title}">${bc.html}</div>
      <div class="barcode-label">CC-SESSION-${session.sessionId.slice(0, 8).toUpperCase()}</div>
      <img class="receipt-logo" src="${window.__BURNER_LOGO_MARK__ ?? 'logo-mark.png'}" alt="Burner" />
      <div class="footer brand">~ B U R N E R ~</div>
    </div>
  `;
}

function esc(value) {
  return String(value).replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');
}

function money(cost, unpriced) {
  const text = fmtUsd(cost);
  return unpriced ? `${text}<span class="unpriced-flag">*</span>` : text;
}

function attrRow(label, tok, amt, level, title) {
  const indent = level === 2 ? ' indent2' : level === 1 ? ' indent' : '';
  const tip = title ? ` title="${esc(title)}"` : '';
  return `<div class="line"${tip}><span class="label${indent}">${esc(label)}</span><span class="tok">${tok}</span><span class="amt">${amt}</span></div>`;
}

function contextCells(row) {
  const unseen = row.calls > 0 && row.contextMissing === row.calls;
  if (unseen) return { tok: '—', amt: '', title: 'no following request, so the result is not in a later turn' };
  const partial = row.contextMissing > 0 ? `${row.contextMissing} call${row.contextMissing === 1 ? '' : 's'} had no following request` : '';
  return { tok: fmtTok(row.contextTokens), amt: money(row.contextCost, row.unpriced), title: partial };
}

function bucketLines(row, label, unit, level) {
  const context = contextCells(row);
  const lines = [
    attrRow(label, `${row.calls} ${unit}`, '', level),
    attrRow('call output', fmtTok(row.outputTokens), money(row.outputCost, row.unpriced), level + 1),
    attrRow('context added', context.tok, context.amt, level + 1, context.title),
  ];
  for (const via of row.via ?? []) {
    lines.push(attrRow(`via ${via.skill}`, `${via.calls} ${unit}`, '', level + 1));
  }
  return lines.join('');
}

function attributedHtml(session) {
  const attr = session.attribution;
  const mcp = attr?.mcp ?? [];
  const skills = attr?.skills ?? [];
  const webEntries = Object.entries(session.activity?.web ?? {});
  if (!mcp.length && !skills.length && !webEntries.length) return '';

  const servers = mcp.map((server) => {
    const tools = server.tools.map((tool) => bucketLines(tool, tool.name, tool.calls === 1 ? 'call' : 'calls', 1)).join('');
    const totalCost = server.outputCost == null && server.contextCost == null
      ? null
      : (server.outputCost ?? 0) + (server.contextCost ?? 0);
    const total = server.tools.length > 1
      ? attrRow('total', '', money(totalCost, server.unpriced), 1)
      : '';
    return `<div class="group-heading">MCP: ${esc(server.displayName)}</div>${tools}${total}`;
  }).join('');

  const skillLines = skills.map((skill) => bucketLines(skill, skill.name, skill.calls === 1 ? 'turn' : 'turns', 1)).join('');
  const skillBlock = skills.length ? `<div class="group-heading">SKILLS</div>${skillLines}` : '';
  const webBlock = webEntries.length
    ? `<div class="group-heading">WEB</div>` + webEntries.map(([tool, count]) => attrRow(tool, `${count} ${count === 1 ? 'call' : 'calls'}`, '', 1)).join('')
    : '';
  const note = mcp.length || skills.length ? `<div class="note">${esc(attr.note)}</div>` : '';

  return `
    <hr class="rule" />
    <div class="model-heading">ATTRIBUTED</div>
    ${servers}
    ${skillBlock}
    ${webBlock}
    ${note}
  `;
}

function tipFor(session) {
  const servers = [...(session.attribution?.mcp ?? [])].sort((a, b) => b.contextTokens - a.contextTokens);
  const top = servers[0];
  if (top && top.contextTokens > 20000) {
    return `MCP ${top.displayName.toUpperCase()} ADDED ${fmtTok(top.contextTokens)} OF CONTEXT`;
  }
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
  if (servers.length) return 'DISABLE UNUSED MCP SERVERS BEFORE CHECKOUT';
  return 'KEEP TURNS SHORT SO THE CACHE STAYS WARM';
}

function textReceipt(session) {
  const lines = [];
  lines.push('CLAUDE CODE - AGENTIC SESSION RECEIPT');
  lines.push(`SESSION: ${session.title ?? session.sessionId.slice(0, 8)}  |  ${shortDate(session.startedAt)}  |  ${session.project}`);
  lines.push('-'.repeat(40));
  const modelLine = (m) => {
    lines.push(m.displayName + ':');
    const t = m.tokens, c = m.cost;
    if (t.input) lines.push(`  fresh input      ${fmtTok(t.input)}   ${fmtUsd(c?.input)}`);
    if (t.cacheWrite5m || t.cacheWrite1h) lines.push(`  cache write      ${fmtTok(t.cacheWrite5m + t.cacheWrite1h)}   ${fmtUsd(c?.cacheWrite)}`);
    if (t.cacheRead) lines.push(`  cache read       ${fmtTok(t.cacheRead)}   ${fmtUsd(c?.cacheRead)}`);
    if (t.output) lines.push(`  output           ${fmtTok(t.output)}   ${fmtUsd(c?.output)}`);
  };
  session.models.forEach(modelLine);
  for (const g of session.subagentGroups ?? []) {
    lines.push(`SUBAGENT: ${g.agentType} (${g.runCount} runs)`);
    g.models.forEach(modelLine);
  }
  lines.push('-'.repeat(40));
  const totalLabel = session.billingMode === 'subscription-likely' ? 'API-EQUIVALENT VALUE' : 'TOTAL';
  lines.push(`${totalLabel}: ${fmtUsd(session.totals.cost.total)}`);
  const mcp = session.attribution?.mcp ?? [];
  const skills = session.attribution?.skills ?? [];
  const webEntries = Object.entries(session.activity?.web ?? {});
  if (mcp.length || skills.length || webEntries.length) {
    lines.push('ATTRIBUTED (already inside the total):');
    for (const server of mcp) {
      lines.push(`  MCP ${server.displayName}`);
      for (const tool of server.tools) {
        lines.push(`    ${tool.name}  ${tool.calls} ${tool.calls === 1 ? 'call' : 'calls'}`);
        lines.push(`      call output     ${fmtTok(tool.outputTokens)}   ${fmtUsd(tool.outputCost)}`);
        lines.push(`      context added   ${tool.contextMissing === tool.calls ? '—' : fmtTok(tool.contextTokens)}   ${tool.contextMissing === tool.calls ? '' : fmtUsd(tool.contextCost)}`);
      }
    }
    for (const skill of skills) {
      lines.push(`  SKILL ${skill.name}  ${skill.calls} ${skill.calls === 1 ? 'turn' : 'turns'}`);
      lines.push(`    call output     ${fmtTok(skill.outputTokens)}   ${fmtUsd(skill.outputCost)}`);
      lines.push(`    context added   ${skill.contextMissing === skill.calls ? '—' : fmtTok(skill.contextTokens)}   ${skill.contextMissing === skill.calls ? '' : fmtUsd(skill.contextCost)}`);
    }
    webEntries.forEach(([name, count]) => lines.push(`  ${name}  ${count} ${count === 1 ? 'call' : 'calls'}`));
    if (mcp.length || skills.length) lines.push(session.attribution.note);
  }
  lines.push('~ burner ~');
  return lines.join('\n');
}

let currentData = [];

function showToast(msg) {
  const toast = document.getElementById('toast');
  toast.textContent = msg;
  toast.classList.add('show');
  setTimeout(() => toast.classList.remove('show'), 1600);
}

function currentSlideIndex(track) {
  const slideWidth = track.children[0]?.offsetWidth ?? 1;
  return Math.round(track.scrollLeft / (slideWidth + 24));
}

function render() {
  currentData = window.__BURNER_DATA__ || [];
  const root = document.getElementById('root');
  if (!currentData.length) {
    root.innerHTML = '<div class="disclaimer">No session data found.</div>';
    return;
  }

  const slides = currentData.map((s, i) => `<div class="slide">${receiptHtml(s, i)}</div>`).join('');
  const arrows = currentData.length > 1
    ? `<button class="nav-arrow prev" aria-label="previous">‹</button><button class="nav-arrow next" aria-label="next">›</button>`
    : '';
  const dots = currentData.length > 1
    ? `<div class="slide-dots">${currentData.map((_, i) => `<span data-i="${i}" class="${i === 0 ? 'active' : ''}"></span>`).join('')}</div>`
    : '';

  const onSubscription = currentData[0]?.billingMode === 'subscription-likely';
  const once = 'Each API request is counted once — the transcript repeats its usage on every content block.';
  const disclaimer = onSubscription
    ? `Estimates, not official billing. Looks like a Pro/Max/Team plan, not pay-per-token — shown as API-equivalent value, not an actual charge. ${once}`
    : `Estimates, not official billing. ${once}`;

  root.innerHTML =
    `<div class="carousel">${arrows}<div class="carousel-track" id="track">${slides}</div></div>${dots}` +
    `<div class="disclaimer">${disclaimer}</div>` +
    `<div class="toast" id="toast"></div>`;

  const track = document.getElementById('track');
  const dotEls = () => [...document.querySelectorAll('.slide-dots span')];

  const goPrev = () => track.scrollBy({ left: -(track.children[0].offsetWidth + 24), behavior: 'smooth' });
  const goNext = () => track.scrollBy({ left: track.children[0].offsetWidth + 24, behavior: 'smooth' });

  document.querySelector('.nav-arrow.prev')?.addEventListener('click', goPrev);
  document.querySelector('.nav-arrow.next')?.addEventListener('click', goNext);
  track?.addEventListener('scroll', () => {
    const i = currentSlideIndex(track);
    dotEls().forEach((d) => d.classList.toggle('active', Number(d.dataset.i) === i));
  }, { passive: true });

  if (track && currentData.length > 1) {
    document.addEventListener('keydown', (e) => {
      if (e.key === 'ArrowLeft') goPrev();
      else if (e.key === 'ArrowRight') goNext();
    });
  }
}

function activeReceiptNode() {
  const track = document.getElementById('track');
  if (!track) return document.querySelector('.receipt');
  const i = currentSlideIndex(track);
  return track.children[i]?.querySelector('.receipt') ?? document.querySelector('.receipt');
}

function activeSession() {
  const node = activeReceiptNode();
  const id = node?.dataset.session;
  return currentData.find((s) => s.sessionId === id) ?? currentData[0];
}

function setTheme(theme) {
  document.documentElement.setAttribute('data-theme', theme);
  localStorage.setItem('burner-theme', theme);
  document.querySelectorAll('.toolbar-group button[data-theme]').forEach((b) => {
    b.classList.toggle('active', b.dataset.theme === theme);
  });
}

document.addEventListener('DOMContentLoaded', () => {
  const saved = localStorage.getItem('burner-theme') || 'paper';
  setTheme(saved);
  document.querySelectorAll('.toolbar-group button[data-theme]').forEach((b) => {
    b.addEventListener('click', () => setTheme(b.dataset.theme));
  });
  render();

  document.getElementById('copyBtn').addEventListener('click', async () => {
    const session = activeSession();
    if (!session) return;
    await navigator.clipboard.writeText(textReceipt(session));
    showToast('Copied to clipboard');
  });

  document.getElementById('downloadBtn').addEventListener('click', () => {
    const node = activeReceiptNode();
    if (!node || !window.html2canvas) return;
    html2canvas(node, { backgroundColor: null, scale: 2 }).then((canvas) => {
      const link = document.createElement('a');
      const session = activeSession();
      link.download = `burner-receipt-${session?.sessionId?.slice(0, 8) ?? 'session'}.png`;
      link.href = canvas.toDataURL('image/png');
      link.click();
      showToast('Downloaded');
    });
  });
});
