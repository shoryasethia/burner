// Single-session receipt — thermal-receipt view of one session.

import { readFileSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { ATTRIBUTION_NOTE } from './build-receipt.js';
import { themeCss, categoryOverrideCss } from './themes.js';

const __dirname  = path.dirname(fileURLToPath(import.meta.url));
const ASSETS_DIR = path.join(__dirname, '..', 'assets');
const VENDOR_DIR = path.join(__dirname, '..', 'vendor');

function readVendor(name) {
  try { return readFileSync(path.join(VENDOR_DIR, name), 'utf-8'); } catch {}
  return null;
}

function fmtTok(n) {
  if (!n) return '0 tok';
  if (n >= 1_000_000) return (n / 1_000_000).toFixed(2) + 'M tok';
  if (n >= 1_000)     return (n / 1_000).toFixed(1) + 'K tok';
  return n + ' tok';
}
function fmtUsd(n) {
  if (n == null) return '—';
  return '$' + n.toFixed(3);
}
function shortDate(iso) {
  if (!iso) return 'unknown';
  return new Date(iso).toLocaleDateString('en-US', { day: '2-digit', month: 'short', year: 'numeric' }).toUpperCase();
}
function readLogoBase64(name) {
  try { return readFileSync(path.join(ASSETS_DIR, name)).toString('base64'); } catch {}
  return null;
}
function hashSeed(str) {
  let h = 0;
  for (let i = 0; i < str.length; i++) h = (h * 31 + str.charCodeAt(i)) >>> 0;
  return h;
}
function barcode(totalCost, seed) {
  const cents = Math.max(0, Math.round(totalCost * 100));
  const bits = cents.toString(2).padStart(16, '0').slice(-16);
  const bars = [];
  for (const bit of bits) {
    const w = bit === '1' ? 4 : 1;
    bars.push(`<span style="width:${w}px;height:32px"></span>`);
    bars.push(`<span style="width:1px;height:32px;background:transparent"></span>`);
  }
  let x = seed || 1;
  for (let i = 0; i < 10; i++) {
    x = (x * 9301 + 49297) % 233280;
    bars.push(`<span style="width:${1 + (x % 2)}px;height:${18 + (x % 14)}px"></span>`);
  }
  return { html: bars.join(''), title: `encodes total cost: ${cents}¢ as binary (${bits})` };
}
const TAGLINES = [
  'context in, cash out',
  'tokens are not free, apparently',
  'thoughts, itemized',
  'you paid for every "let me check"',
  'burned so you don\'t have to guess',
  'classified and costed',
];
const SOURCE_LABEL = { skill: 'TAGGED BY CLAUDE', manual: 'TAGGED BY YOU', 'end-model': 'SESSION-END (legacy)', 'session-end': 'SESSION-END AUTO', learned: 'LEARNED GUESS', project: 'PROJECT DEFAULT', none: 'NOT TAGGED' };

function money(n, unpriced) {
  if (unpriced) return '—';
  if (n == null) return '—';
  return '$' + n.toFixed(3);
}

function attrRow(label, tok, amt, level = 0) {
  const pad = level ? ' indent' : '';
  return `<div class="line"><span class="label${pad}">${label}</span><span class="tok">${tok}</span><span class="amt">${amt}</span></div>`;
}

function contextCells(row) {
  if (row.contextMissing === row.calls) return { tok: '—', amt: '', title: 'no follow-up request in transcript' };
  return { tok: fmtTok(row.contextTokens), amt: money(row.contextCost, row.unpriced), title: '' };
}

function bucketLines(row, label, unit, level, esc) {
  const context = contextCells(row);
  let html = attrRow(esc(label), `${row.calls} ${unit}`, '', level);
  html += attrRow('call output', fmtTok(row.outputTokens), money(row.outputCost, row.unpriced), level + 1);
  html += attrRow('context added', context.tok, context.amt, level + 1);
  for (const via of row.via ?? []) html += attrRow(`via ${esc(via.skill)}`, `${via.calls} ${unit}`, '', level + 1);
  return html;
}

function attributedSection(session, esc) {
  const attr = session.attribution;
  const mcp = attr?.mcp ?? [];
  const skills = attr?.skills ?? [];
  const webEntries = Object.entries(session.activity?.web ?? {});
  if (!mcp.length && !skills.length && !webEntries.length) return '';

  const servers = mcp.map((server) => {
    const tools = server.tools.map((tool) => bucketLines(tool, tool.name, tool.calls === 1 ? 'call' : 'calls', 1, esc)).join('');
    const totalCost = server.outputCost == null && server.contextCost == null ? null : (server.outputCost ?? 0) + (server.contextCost ?? 0);
    const total = server.tools.length > 1 ? attrRow('total', '', money(totalCost, server.unpriced), 1) : '';
    return `<div class="model-heading">MCP: ${esc(server.displayName)}</div>${tools}${total}`;
  }).join('');

  const skillLines = skills.map((skill) => bucketLines(skill, skill.name, skill.calls === 1 ? 'turn' : 'turns', 1, esc)).join('');
  const skillBlock = skills.length ? `<div class="model-heading">SKILLS</div>${skillLines}` : '';
  const webBlock = webEntries.length
    ? `<div class="model-heading">WEB</div>${webEntries.map(([tool, count]) => attrRow(esc(tool), `${count}×`, '', 1)).join('')}`
    : '';
  const note = mcp.length || skills.length ? `<div class="reason">${esc(attr?.note ?? ATTRIBUTION_NOTE)}</div>` : '';

  return `
    <hr class="rule" />
    <div class="model-heading">MCP · SKILLS</div>
    ${servers}${skillBlock}${webBlock}${note}
  `;
}

function subagentModelSections(session, esc, modelBlock) {
  const groups = session.subagentGroups ?? [];
  if (!groups.length) return '';
  return groups.map((g) => `
    <div class="model-heading">SUBAGENT: ${esc(g.agentType)} (${g.runCount} run${g.runCount > 1 ? 's' : ''})</div>
    ${g.models.map(modelBlock).join('')}
  `).join('');
}

export function renderReceipt(session, categories, { served = false, theme = null, projects = [] } = {}) {
  const esc = (s) => String(s ?? '').replace(/[&<>"']/g, (ch) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[ch]));
  const catById = Object.fromEntries(categories.map((c) => [c.id, c]));
  const cat = catById[session.category] ?? { id: session.category, label: session.category, color: '#888' };
  const catVar = (id) => `var(--cat-${esc(id)})`;
  const catOverrideCss = categoryOverrideCss(categories);

  const logoUri = (name) => {
    if (served) return `/assets/${name}`;
    const b64 = readLogoBase64(name);
    return b64 ? `data:image/png;base64,${b64}` : '';
  };
  const logoMarkUri = logoUri('logo-mark.png');
  const logoTextUri = logoUri('logo-with-text.png');

  const seed = hashSeed(session.sessionId);
  const tagline = TAGLINES[seed % TAGLINES.length];
  const authCode = session.sessionId.slice(0, 4).toUpperCase() + '-' + (seed % 9999);
  const bc = barcode(session.totalCost.total, seed);
  const totalTok = session.totalTokens.total;

  function modelBlock(m) {
    const t = m.tokens, c = m.cost;
    const billed =
      (t.input || 0) + (t.output || 0) + (t.cacheWrite5m || 0) + (t.cacheWrite1h || 0) + (t.cacheRead || 0);
    if (!billed) return '';
    const badge = m.unpriced ? ' <span class="unpriced-flag" title="no price set — counted as $0">[$0 · unpriced]</span>' : '';
    const rows = [`<div class="model-heading">${esc(m.rawModel)}${badge}</div>`];
    const line = (lbl, tok, amt) =>
      `<div class="line"><span class="label indent">${lbl}</span><span class="tok">${fmtTok(tok)}</span><span class="amt">${fmtUsd(amt)}</span></div>`;
    if (t.input)                        rows.push(line('FRESH INPUT (uncached)',    t.input,                         c?.input));
    if (t.cacheWrite5m || t.cacheWrite1h) rows.push(line('CACHE WRITE (new context)', t.cacheWrite5m + t.cacheWrite1h, c?.cacheWrite));
    if (t.cacheRead)                    rows.push(line('CACHE READ (reused)',       t.cacheRead,                     c?.cacheRead));
    if (t.output)                       rows.push(line('OUTPUT TOKENS',             t.output,                        c?.output));
    return rows.join('');
  }

  const detailSection = attributedSection(session, esc);
  const ccLine =
    session.billingSource !== 'cost-state'
    && session.ccReportedCost != null
    && Math.abs(session.ccReportedCost - session.totalCost.total) > 0.0005
      ? `<div class="line"><span class="label indent">Claude Code reported</span><span class="tok"></span><span class="amt">${fmtUsd(session.ccReportedCost)}</span></div>`
      : '';

  const splitSection = session.categorySplit?.length > 1 ? session.categorySplit.map((x) =>
    `<div class="line"><span class="label indent"><span class="dot" style="background:${catVar(x.category)}"></span>${esc(catById[x.category]?.label ?? x.category)}</span><span class="tok">${fmtTok(x.tokens)}</span><span class="amt">${fmtUsd(x.cost)}</span></div>`).join('') : '';

  const sourceLabel = SOURCE_LABEL[session.categorySource] ?? 'AUTO';
  const picker = served
    ? `<select id="catPick" title="change category">${categories.map((c) => `<option value="${esc(c.id)}"${c.id === session.category ? ' selected' : ''}>${esc(c.label)}</option>`).join('')}</select>`
    : `<span class="cat-badge" style="background:${catVar(cat.id)}">${esc(cat.label)}</span>`;

  const mainModels = session.mainModels ?? session.models;
  const copyLines = [
    'CLAUDE CODE — AGENTIC SESSION RECEIPT',
    `SESSION: ${session.title}  DATE: ${shortDate(session.date)}  PROJECT: ${session.project}`,
    `INTENT: ${cat.label} (${sourceLabel})`,
    '-'.repeat(40),
    ...mainModels.map((m) => `${m.rawModel}: ${fmtTok(m.tokens.input + m.tokens.output + m.tokens.cacheWrite5m + m.tokens.cacheWrite1h + m.tokens.cacheRead)} ${m.unpriced ? '$0 (unpriced)' : fmtUsd(m.cost.total)}`),
    '-'.repeat(40),
    `TOTAL: ${fmtUsd(session.totalCost.total)}`,
    '~ BURNER ~',
  ];

  return `<!doctype html>
<html lang="en" data-theme="paper">
<head>
<meta charset="utf-8" />
<title>Burner · ${esc(session.title)}</title>
<script>(function(){var t=${served ? JSON.stringify(theme) : 'null'};try{t=t||localStorage.getItem('burner-theme');}catch(e){}if(['paper','thermal','matrix','dark'].indexOf(t)<0)t='paper';document.documentElement.setAttribute('data-theme',t);})();</script>
<link rel="icon" type="image/png" href="${logoMarkUri}" />
<style>
${themeCss()}
${catOverrideCss}
*{box-sizing:border-box;}
body{margin:0;font-family:'IBM Plex Mono','Courier New',monospace;background:var(--page-bg);color:var(--ink);padding:28px 16px 60px;transition:background .15s,color .15s;}
.page-brand{position:fixed;top:20px;left:24px;height:56px;width:auto;z-index:6;}
.toolbar{max-width:520px;margin:0 auto 16px;display:flex;justify-content:space-between;gap:12px;flex-wrap:wrap;padding-left:90px;}
.toolbar-group{display:flex;gap:8px;flex-wrap:wrap;}
button{font-family:inherit;font-size:12px;letter-spacing:.05em;border:1px solid var(--rule);background:transparent;color:var(--ink);padding:6px 12px;cursor:pointer;border-radius:3px;text-transform:uppercase;}
button.active,button:hover{background:var(--ink);color:var(--page-bg);}
select{font-family:inherit;font-size:11px;background:var(--bg);border:1px solid var(--rule);color:var(--ink);padding:3px 6px;border-radius:3px;}
.receipt{width:100%;max-width:460px;background:var(--bg);color:var(--ink);padding:28px 26px 30px;box-shadow:0 6px 18px var(--shadow-lg);margin:0 auto;}
.receipt h1{text-align:center;font-size:22px;letter-spacing:.15em;margin:0 0 4px;}
.subtitle{text-align:center;font-size:12px;letter-spacing:.1em;font-weight:bold;margin:0 0 4px;}
.tagline{text-align:center;font-size:11px;color:var(--dim);margin:0 0 14px;font-style:italic;}
.rule{border:none;border-top:1px dashed var(--rule);margin:12px 0;}
.meta-row{display:flex;justify-content:space-between;font-size:11px;line-height:1.6;gap:10px;}
.line{display:flex;justify-content:space-between;align-items:baseline;font-size:12.5px;line-height:1.7;gap:8px;}
.line .label{flex:1;}.line .label.indent{padding-left:14px;color:var(--dim);font-size:11px;}
.line .tok{color:var(--dim);font-size:11px;min-width:72px;text-align:right;}
.line .amt{font-weight:bold;min-width:60px;text-align:right;}
.line.bold .label,.line.bold .amt{font-weight:bold;}
.line.total .amt{font-size:15px;}
.model-heading{font-weight:bold;font-size:12px;letter-spacing:.05em;margin-top:10px;}
a.back-link{color:var(--ink);text-decoration:none;font-size:11px;letter-spacing:.05em;border:1px solid var(--rule);padding:6px 12px;border-radius:3px;text-transform:uppercase;display:inline-block;}
a.back-link:hover{background:var(--ink);color:var(--page-bg);}
.cat-badge{display:inline-block;padding:2px 8px;border-radius:3px;font-size:10px;font-weight:bold;color:var(--page-bg);letter-spacing:.05em;}
.dot{display:inline-block;width:7px;height:7px;border-radius:50%;margin-right:5px;}
.footer{text-align:center;font-size:11px;color:var(--dim);margin-top:4px;}
.receipt-logo{display:block;height:64px;width:auto;margin:14px auto 4px;}
.footer .brand{margin-top:2px;font-size:10px;letter-spacing:.15em;color:var(--dim);}
.unpriced-flag{color:var(--warn);font-weight:bold;font-size:10px;}
.reason{font-size:10px;color:var(--dim);font-style:italic;padding-left:14px;}
.barcode{display:flex;justify-content:center;align-items:flex-end;gap:2px;margin:18px 0 4px;cursor:help;}
.barcode span{background:var(--ink);}
.barcode-label{text-align:center;font-size:10px;color:var(--dim);letter-spacing:.1em;}
.disclaimer{max-width:460px;margin:14px auto 0;font-size:10px;color:var(--dim);text-align:center;}
.toast{position:fixed;bottom:24px;left:50%;transform:translateX(-50%);background:var(--ink);color:var(--page-bg);padding:8px 16px;border-radius:4px;font-size:12px;letter-spacing:.05em;opacity:0;transition:opacity .2s;pointer-events:none;}
.toast.show{opacity:1;}
</style>
</head>
<body>
${logoTextUri ? `<img class="page-brand" src="${logoTextUri}" alt="Burner" />` : ''}
<div class="toolbar">
  <div class="toolbar-group">
    ${served ? '<a class="back-link" href="/">← Report</a>' : ''}
    <button data-theme="paper">Paper</button>
    <button data-theme="thermal">Thermal</button>
    <button data-theme="matrix">Matrix</button>
    <button data-theme="dark">Dark</button>
  </div>
  <div class="toolbar-group">
    <button id="copyBtn">Copy</button>
    <button id="downloadBtn">PNG</button>
  </div>
</div>

<div class="receipt" id="receipt">
  <h1>CLAUDE CODE</h1>
  <div class="subtitle">AGENTIC SESSION RECEIPT</div>
  <div class="tagline">-- ${tagline} --</div>
  <hr class="rule" />
  <div class="meta-row">
    <div class="left">
      SESSION: ${esc(session.title)}<br/>
      DATE: ${shortDate(session.date)}<br/>
      PROJECT: ${served && projects.length ? `<select id="projPick" title="move this session to a project"><option value="">${esc(session.projectSource === 'session' ? '(directory default)' : session.project)}</option>${projects.map((n) => `<option value="${esc(n)}"${session.projectSource === 'session' && session.project === n ? ' selected' : ''}>${esc(n)}</option>`).join('')}</select>` : `<span title="${esc(session.cwd)}">${esc(session.project)}</span>`}<br/>
      BRANCH: ${esc(session.gitBranch ?? '—')}
    </div>
    <div class="right" style="text-align:right">
      MAIN: ${session.turnCount} req · SUB: ${session.subagentTurnCount ?? 0} req (${session.subagentCount ?? 0} runs)<br/>
      DURATION: ${session.durationMin != null ? session.durationMin + 'm' : '—'}<br/>
      CACHE HIT: ${session.cacheHitRate}% · PROMPTS: ${session.promptCount ?? '—'}
    </div>
  </div>
  <hr class="rule" />
  <div class="line"><span class="label">INTENT</span><span class="amt" style="display:flex;align-items:center;gap:8px">${picker}<span style="font-size:10px;color:var(--dim);font-weight:normal">${sourceLabel}</span></span></div>
  ${session.tagReason ? `<div class="reason">"${esc(session.tagReason)}"</div>` : ''}
  ${splitSection}
  <hr class="rule" />
  ${mainModels.map(modelBlock).join('')}
  ${session.billingSource === 'cost-state' ? '' : subagentModelSections(session, esc, modelBlock)}
  ${detailSection}
  ${ccLine}
  <hr class="rule" />
  <div class="line bold"><span class="label">SUBTOTAL</span><span class="tok">${fmtTok(totalTok)}</span><span class="amt"></span></div>
  <div class="line total bold"><span class="label">TOTAL</span><span class="tok"></span><span class="amt">${fmtUsd(session.totalCost.total)}</span></div>
  <hr class="rule" />
  <div class="footer">
    PAID WITH: TOKEN BUDGET<br/>
    AUTH CODE: ${authCode}
  </div>
  <hr class="rule" />
  <div class="footer">
    * THANK YOU FOR YOUR CONTEXT *<br/>
    ITEMS NON-REFUNDABLE ONCE SENT
  </div>
  <div class="barcode" title="${bc.title}">${bc.html}</div>
  <div class="barcode-label">CC-SESSION-${session.sessionId.slice(0, 8).toUpperCase()}</div>
  ${logoMarkUri ? `<img class="receipt-logo" src="${logoMarkUri}" alt="Burner" />` : ''}
  <div class="footer brand">~ B U R N E R ~</div>
</div>

<div class="disclaimer">not official billing${session.billingSource === 'cost-state' ? ' · totals from Claude Code cost-state (matches /usage-style session accounting)' : ''}${session.hasUnpriced ? ' · unpriced models counted as $0' : ''}</div>
<div class="toast" id="toast"></div>

<script>${readVendor('html2canvas.min.js') ?? ''}</script>
<script>
const SESSION_ID = ${JSON.stringify(session.sessionId)};
const COPY_TEXT = ${JSON.stringify(copyLines.join('\n')).replace(/</g, '\\u003c')};
function setTheme(t,persist=true){
  document.documentElement.setAttribute('data-theme',t);
  try{localStorage.setItem('burner-theme',t);}catch(e){}
  if(persist&&${served})fetch('/api/theme',{method:'PUT',headers:{'Content-Type':'application/json'},body:JSON.stringify({theme:t})}).catch(()=>{});
  document.querySelectorAll('button[data-theme]').forEach(b=>b.classList.toggle('active',b.dataset.theme===t));
}
document.querySelectorAll('button[data-theme]').forEach(b=>b.addEventListener('click',()=>setTheme(b.dataset.theme)));
setTheme(document.documentElement.getAttribute('data-theme'),false);

function showToast(m){const t=document.getElementById('toast');t.textContent=m;t.classList.add('show');setTimeout(()=>t.classList.remove('show'),1600);}

const pp=document.getElementById('projPick');
if(pp) pp.addEventListener('change',async()=>{
  const res=await fetch('/api/session-project',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({sessionId:SESSION_ID,project:pp.value||null})});
  if(res.ok){showToast('project updated');setTimeout(()=>location.reload(),500);} else showToast((await res.json()).error||'failed');
});
const pick=document.getElementById('catPick');
if(pick) pick.addEventListener('change',async()=>{
  const res=await fetch('/api/tag',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({sessionId:SESSION_ID,category:pick.value})});
  if(res.ok){showToast('tagged');setTimeout(()=>location.reload(),500);} else showToast((await res.json()).error||'failed');
});

document.getElementById('copyBtn').addEventListener('click',async()=>{
  await navigator.clipboard.writeText(COPY_TEXT);
  showToast('copied');
});

document.getElementById('downloadBtn').addEventListener('click',()=>{
  const node=document.getElementById('receipt');
  html2canvas(node,{backgroundColor:null,scale:2}).then(canvas=>{
    const a=document.createElement('a');
    a.download='burner-'+SESSION_ID.slice(0,8)+'.png';
    a.href=canvas.toDataURL('image/png');
    a.click();showToast('downloaded');
  });
});
</script>
</body>
</html>`;
}
