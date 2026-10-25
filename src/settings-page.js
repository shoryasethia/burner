import { themeCss, categoryOverrideCss, PAPER_CATEGORY_COLORS } from './themes.js';
import { loadConfig } from './config.js';
import { skillSetupPrompt } from './install.js';

export function renderSettingsPage(theme = null) {
  const cfg = loadConfig();
  const catOverrideCss = categoryOverrideCss(cfg.categories);
  const paperCatJson = JSON.stringify(PAPER_CATEGORY_COLORS);
  const skillPromptJson = JSON.stringify(skillSetupPrompt(cfg));
  return `<!doctype html>
<html lang="en" data-theme="paper">
<head>
<meta charset="utf-8" />
<meta name="viewport" content="width=device-width,initial-scale=1" />
<title>Burner · Settings</title>
<script>(function(){var t=${JSON.stringify(theme)};try{t=t||localStorage.getItem('burner-theme');}catch(e){}if(['paper','thermal','matrix','dark'].indexOf(t)<0)t='paper';document.documentElement.setAttribute('data-theme',t);})();</script>
<style>
${themeCss()}
${catOverrideCss}
*{box-sizing:border-box;}
body{margin:0;font-family:'IBM Plex Mono','Courier New',monospace;background:var(--page-bg);color:var(--ink);padding:24px 16px 80px;transition:background .15s,color .15s;font-size:12px;}
.page{max-width:860px;margin:0 auto;}
.nav{display:flex;gap:8px;flex-wrap:wrap;align-items:center;margin-bottom:18px;}
.nav .sp{flex:1;}
a.back{color:var(--ink);text-decoration:none;font-size:11px;letter-spacing:.05em;border:1px solid var(--rule);padding:5px 11px;border-radius:3px;text-transform:uppercase;}
a.back:hover{background:var(--ink);color:var(--page-bg);}
button{font-family:inherit;font-size:11px;letter-spacing:.05em;border:1px solid var(--rule);background:transparent;color:var(--ink);padding:5px 11px;cursor:pointer;border-radius:3px;text-transform:uppercase;}
button.active,button:hover:not(:disabled){background:var(--ink);color:var(--page-bg);}
button:disabled{opacity:.45;cursor:default;}
button.sm{padding:2px 7px;font-size:10px;}
input,select,textarea{font-family:inherit;font-size:11px;background:var(--bg);border:1px solid var(--rule);color:var(--ink);padding:5px 8px;border-radius:3px;}
input[type=color]{padding:0;width:32px;height:24px;}
input[type=checkbox]{padding:0;accent-color:var(--accent);}
.card{background:var(--bg);padding:18px 22px 20px;box-shadow:0 3px 10px var(--shadow);margin-bottom:16px;}
.card.hl{outline:1px solid var(--ink);}
h3{font-size:10px;letter-spacing:.12em;text-transform:uppercase;color:var(--dim);font-weight:bold;margin:0 0 8px;}
.dim{color:var(--dim);}
.small{font-size:10px;}
.note{color:var(--dim);font-size:11px;line-height:1.6;margin:0 0 14px;}
.rule{border:none;border-top:1px dashed var(--rule);margin:12px 0;}
.row{display:flex;gap:8px;align-items:center;flex-wrap:wrap;margin:6px 0;}
.row.sb{justify-content:space-between;}
.grow{flex:1;min-width:120px;}
.chip{display:inline-block;border:1px solid var(--rule);padding:2px 8px;border-radius:10px;font-size:10px;cursor:pointer;user-select:none;}
.chip.on{background:var(--accent);color:var(--accent-fg);border-color:var(--accent);}
.chip.static{cursor:default;}
.dot{display:inline-block;width:8px;height:8px;border-radius:50%;margin-right:4px;}
table{width:100%;border-collapse:collapse;font-size:11px;}
th{text-align:left;padding:6px 6px;border-bottom:1px solid var(--rule);color:var(--dim);font-weight:bold;letter-spacing:.05em;font-size:10px;text-transform:uppercase;}
td{padding:6px 6px;border-bottom:1px dashed var(--rule);vertical-align:middle;}
td.num,th.num{text-align:right;}
.tblwrap{overflow-x:auto;}
.pin{width:72px;}
.savebar{position:sticky;bottom:12px;background:var(--bg);box-shadow:0 3px 10px rgba(0,0,0,.25);padding:10px 16px;display:flex;justify-content:space-between;align-items:center;gap:8px;border:1px solid var(--ink);}
.badge{font-size:9px;letter-spacing:.08em;border:1px solid var(--rule);padding:1px 6px;border-radius:2px;white-space:nowrap;}
.badge.o{background:var(--ink);color:var(--page-bg);}
.mark{color:var(--ink);font-weight:bold;}
.slider-wrap{padding:6px 10px 0;}
input[type=range]{width:100%;padding:0;accent-color:var(--accent);}
.ticks{display:flex;justify-content:space-between;font-size:10px;color:var(--dim);margin-top:4px;gap:4px;}
.ticks span{flex:1;text-align:center;cursor:pointer;}
.ticks span.sel{color:var(--ink);font-weight:bold;}
.ticks span:first-child{text-align:left;}.ticks span:last-child{text-align:right;}
.lvdesc{margin-top:12px;font-size:11px;line-height:1.6;}
.field{display:flex;flex-direction:column;gap:3px;margin:8px 0;}
.field label{font-size:10px;color:var(--dim);letter-spacing:.08em;text-transform:uppercase;}
.field input{width:100%;}
.result{font-size:11px;margin-top:8px;line-height:1.6;white-space:pre-wrap;word-break:break-word;}
.err{color:var(--warn);}
.pathrow{display:flex;gap:8px;align-items:center;font-size:11px;padding:3px 0;border-bottom:1px dashed var(--rule);}
.pathrow span{flex:1;word-break:break-all;}
.toast{position:fixed;bottom:22px;left:50%;transform:translateX(-50%);background:var(--ink);color:var(--page-bg);padding:7px 14px;border-radius:3px;font-size:11px;letter-spacing:.05em;opacity:0;transition:opacity .2s;pointer-events:none;z-index:300;max-width:90vw;}
.toast.show{opacity:1;}
.toast.error{background:var(--warn);color:var(--accent-fg);}
.pricing-foot{margin-top:14px;padding-top:12px;border-top:1px dashed var(--rule);font-size:10px;color:var(--dim);text-align:center;line-height:1.7;}
.pricing-foot a{color:var(--dim);text-decoration:none;border-bottom:1px dashed var(--rule);}
.pricing-foot a:hover{color:var(--ink);}
.add-model{margin-top:14px;padding-top:12px;border-top:1px dashed var(--rule);}
.copyblock{width:100%;font-size:10px;line-height:1.5;resize:vertical;min-height:52px;}
.card-section{margin-top:14px;padding-top:14px;border-top:1px dashed var(--rule);}
.card-section h4{font-size:10px;letter-spacing:.1em;text-transform:uppercase;color:var(--dim);font-weight:bold;margin:0 0 8px;}
.setup-pills{display:flex;flex-wrap:wrap;gap:8px;margin-top:14px;align-items:center;}
.setup-pills .badge{padding:4px 10px;font-size:10px;}
.setup-pills .badge.ok{outline:1px solid var(--accent);}
.setup-pills .badge.dimmed{opacity:.5;}
.setup-pills label.row{margin:0;gap:6px;}
</style>
</head>
<body>
<div class="page">
  <div class="nav">
    <a class="back" href="/">&larr; Report</a>
    <button data-tab="projects">Projects</button>
    <button data-tab="categories">Categories</button>
    <button data-tab="pricing">Pricing</button>
    <button data-tab="tagging">Tagging</button>
    <span class="sp"></span>
    <button data-theme="paper">Paper</button>
    <button data-theme="thermal">Thermal</button>
    <button data-theme="matrix">Matrix</button>
    <button data-theme="dark">Dark</button>
  </div>
  <div id="view"></div>
</div>
<div class="toast" id="toast"></div>
<script>
(function(){
var PAPER_CAT = ${paperCatJson};
function applyCatOverrides(){
  var el = document.getElementById('catOverrides');
  if (!el) { el = document.createElement('style'); el.id = 'catOverrides'; document.head.appendChild(el); }
  if (!S || !S.config) { el.textContent = ''; return; }
  var lines = [];
  (S.config.categories || []).forEach(function(c){
    if (PAPER_CAT[c.id] && String(c.color).toLowerCase() === PAPER_CAT[c.id]) return;
    lines.push('--cat-' + c.id + ':' + c.color);
  });
  el.textContent = lines.length ? ':root{' + lines.join(';') + '}' : '';
}
var S = null;            // server state
var tab = 'projects';
var draftProjects = null, projDirty = false;
var draftCats = null, catDirty = false;
var priceEdits = {}, priceResets = {};
var addDraft = '', addMsg = '', addCands = [];
var openProj = [];
var dirOpen = {}, allSessions = null;   // draft project objects currently expanded
var trainText = '', trainErr = false;
var busy = {};
var view = document.getElementById('view');
var toastEl = document.getElementById('toast');
var toastT = null;
var SKILL_SETUP_PROMPT = ${skillPromptJson};

function copyField(label, text){
  var ta = h('textarea', {class:'copyblock', readOnly:true, rows: String(Math.min(10, text.split('\\n').length + 1)), value: text});
  var wrap = h('div', {class:'field'});
  if (label) wrap.appendChild(h('label', {text: label}));
  var row = h('div', {class:'row'});
  row.appendChild(ta);
  row.appendChild(h('button', {class:'sm', text:'Copy', onclick:function(){ navigator.clipboard.writeText(text).then(function(){ toast('copied'); }).catch(function(){ toast('copy failed', true); }); }}));
  wrap.appendChild(row);
  return wrap;
}

function escapeHtml(s){ return String(s == null ? '' : s).replace(/[&<>"']/g, function(c){ return {'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]; }); }
function money(n){ n = Number(n) || 0; return '$' + (n > 0 && n < 0.01 ? n.toFixed(4) : n.toFixed(2)); }
function fmtTok(n){ n = Number(n) || 0; if (n >= 1e6) return (n/1e6).toFixed(2) + 'M'; if (n >= 1e3) return (n/1e3).toFixed(1) + 'K'; return String(Math.round(n)); }
function rel(t){
  if (t == null || t === '') return 'never';
  var ms = typeof t === 'number' ? t : Date.parse(String(t));
  if (!ms || isNaN(ms)) return 'unknown';
  var d = Date.now() - ms;
  if (d < 0) return 'just now';
  if (d < 60000) return 'just now';
  if (d < 3600000) return Math.floor(d / 60000) + 'm ago';
  if (d < 86400000) return Math.floor(d / 3600000) + 'h ago';
  return Math.floor(d / 86400000) + 'd ago';
}
function h(tag, attrs, kids){
  var e = document.createElement(tag);
  if (attrs) for (var k in attrs){
    var v = attrs[k];
    if (v == null || v === false) continue;
    if (k === 'class') e.className = v;
    else if (k === 'text') e.textContent = v;
    else if (k.slice(0,2) === 'on') e.addEventListener(k.slice(2), v);
    else if (k === 'value') e.value = v;
    else if (k === 'checked' || k === 'disabled') e[k] = !!v;
    else if (k === 'style') e.setAttribute('style', v);
    else e.setAttribute(k, v === true ? '' : v);
  }
  if (kids != null) (Array.isArray(kids) ? kids : [kids]).forEach(function(c){
    if (c == null || c === false) return;
    e.appendChild(typeof c === 'string' ? document.createTextNode(c) : c);
  });
  return e;
}
function toast(msg, isErr){
  toastEl.textContent = msg;
  toastEl.className = 'toast show' + (isErr ? ' error' : '');
  clearTimeout(toastT);
  toastT = setTimeout(function(){ toastEl.className = 'toast' + (isErr ? ' error' : ''); }, isErr ? 5000 : 1800);
}
function api(method, url, body){
  var opt = { method: method, headers: {} };
  if (method !== 'GET'){ opt.headers['Content-Type'] = 'application/json'; opt.body = JSON.stringify(body || {}); }
  return fetch(url, opt).then(function(r){
    return r.text().then(function(t){
      var j = null; try { j = t ? JSON.parse(t) : {}; } catch(e){}
      if (!r.ok) throw new Error((j && j.error) || ('HTTP ' + r.status));
      return j || {};
    });
  });
}
function clone(o){ return JSON.parse(JSON.stringify(o)); }

/* theme */
function setTheme(t, persist){
  document.documentElement.setAttribute('data-theme', t);
  try { localStorage.setItem('burner-theme', t); } catch(e){}
  if (persist !== false) fetch('/api/theme', {method:'PUT', headers:{'Content-Type':'application/json'}, body:JSON.stringify({theme:t})}).catch(function(){});
  document.querySelectorAll('[data-theme]').forEach(function(b){ if (b.tagName === 'BUTTON') b.classList.toggle('active', b.getAttribute('data-theme') === t); });
  if (S) rerenderKeep();
}
document.querySelectorAll('button[data-theme]').forEach(function(b){ b.addEventListener('click', function(){ setTheme(b.getAttribute('data-theme'), true); }); });
setTheme(document.documentElement.getAttribute('data-theme'), false);

/* tabs */
var TABS = ['projects','categories','pricing','tagging'];
function readHash(){ var t = location.hash.replace('#',''); tab = TABS.indexOf(t) >= 0 ? t : 'projects'; }
document.querySelectorAll('button[data-tab]').forEach(function(b){ b.addEventListener('click', function(){ location.hash = b.getAttribute('data-tab'); }); });
window.addEventListener('hashchange', function(){ readHash(); render(); });

function projectStats(name){
  var s = {dirs:0, sessions:0, cost:0};
  (S.projectTotals || []).forEach(function(t){ if (t.name === name && !t.implicit){ s.sessions = t.sessions; s.cost = t.cost; } });
  return s;
}
function loadSessions(){ return api('GET', '/api/sessions').then(function(l){ allSessions = l; }); }
function assignSession(id, project){
  return api('POST', '/api/session-project', {sessionId:id, project:project || null})
    .then(function(){ return Promise.all([api('GET', '/api/state'), loadSessions()]); })
    .then(function(res){ S.directories = res[0].directories; S.projectTotals = res[0].projectTotals; toast(project ? 'moved to ' + project : 'back to its directory'); rerenderKeep(); })
    .catch(function(e){ toast(e.message, true); });
}
function sessionList(d){
  var box = h('div', {style:'padding:6px 0 10px 14px;border-bottom:1px dashed var(--rule)'});
  if (!allSessions){ box.appendChild(h('div', {class:'dim small', text:'loading sessions...'})); loadSessions().then(rerenderKeep); return box; }
  var mine = allSessions.filter(function(s){ return s.cwd === d.cwd; });
  box.appendChild(h('div', {class:'dim small', style:'margin-bottom:4px', text:'Move individual sessions into a saved project (create and save the project first).'}));
  mine.forEach(function(s){
    var sel = h('select', {onchange:function(e){ assignSession(s.sessionId, e.target.value); }});
    sel.appendChild(h('option', {value:'', text:'stays in directory'}));
    (S.config.projects || []).forEach(function(p){ var o = h('option', {value:p.name, text:p.name}); if (s.projectSource === 'session' && s.project === p.name) o.selected = true; sel.appendChild(o); });
    box.appendChild(h('div', {class:'row sb', style:'margin:2px 0'}, [
      h('span', {class:'dim small', text:s.date}),
      h('span', {class:'grow', style:'overflow:hidden;text-overflow:ellipsis;white-space:nowrap', text:s.title}),
      h('span', {class:'small', text:money(s.totalCost.total)}), sel]));
  });
  return box;
}
// Sessions that were moved into this project from other directories. Shown on
// the project card so a move can be undone after its directory row is gone.
function movedList(name){
  var box = h('div');
  if (!allSessions){ box.appendChild(h('div', {class:'dim small', text:'loading sessions...'})); loadSessions().then(rerenderKeep); return box; }
  var mine = allSessions.filter(function(s){ return s.projectSource === 'session' && s.project === name; });
  if (!mine.length) return null;
  box.appendChild(h('h3', {text:'Sessions moved here', style:'margin-top:10px'}));
  mine.forEach(function(s){
    var sel = h('select', {onchange:function(e){ assignSession(s.sessionId, e.target.value); }});
    sel.appendChild(h('option', {value:'', text:'back to its directory'}));
    (S.config.projects || []).forEach(function(p){ var o = h('option', {value:p.name, text:p.name}); if (p.name === name) o.selected = true; sel.appendChild(o); });
    box.appendChild(h('div', {class:'row sb', style:'margin:2px 0'}, [
      h('span', {class:'dim small', text:s.date}),
      h('span', {class:'grow', style:'overflow:hidden;text-overflow:ellipsis;white-space:nowrap', title:s.cwd, text:s.title}),
      h('span', {class:'small', text:money(s.totalCost.total)}), sel]));
  });
  return box;
}
function sortedProjects(list){
  return list.map(function(p, i){ return {p:p, i:i, cost:projectStats(p.name).cost}; })
    .sort(function(a, b){ return b.cost - a.cost || a.p.name.toLowerCase().localeCompare(b.p.name.toLowerCase()); })
    .map(function(x){ return x.p; });
}
function applyState(st){
  S = st;
  draftProjects = sortedProjects(clone(S.config.projects || [])); projDirty = false; openProj = [];
  draftCats = clone(S.config.categories || []).map(function(c){ c._existing = true; return c; }); catDirty = false;
  priceEdits = {}; priceResets = {};
  applyCatOverrides();
}
function render(){
  document.querySelectorAll('button[data-tab]').forEach(function(b){ b.classList.toggle('active', b.getAttribute('data-tab') === tab); });
  view.textContent = '';
  if (!S){ view.appendChild(h('div', {class:'card dim', text:'loading…'})); return; }
  var fn = { projects: rProjects, categories: rCategories, pricing: rPricing, tagging: rTagging }[tab];
  view.appendChild(fn());
}
function rerenderKeep(){ var y = window.scrollY; render(); window.scrollTo(0, y); }

function save(promise, okMsg, after){
  return promise.then(function(st){ applyState(st); toast(okMsg || 'saved'); rerenderKeep(); if (after) after(); }).catch(function(e){ toast(e.message, true); });
}

/* ---------- PROJECTS ---------- */
function catById(id){ var c = (S.config.categories || []).filter(function(x){ return x.id === id; })[0]; return c; }
function rProjects(){
  var wrap = h('div');
  wrap.appendChild(h('p', {class:'note', text:'A project groups one or more directories. Sessions started anywhere under a directory belong to its project.'}));
  draftProjects.forEach(function(p, i){
    var card = h('div', {class:'card'});
    var isOpen = openProj.indexOf(p) >= 0;
    var st = projectStats(p.name);
    var toggle = function(){ var k = openProj.indexOf(p); if (k >= 0) openProj.splice(k, 1); else openProj.push(p); rerenderKeep(); };
    if (!isOpen){
      card.appendChild(h('div', {class:'row sb', style:'margin:0;cursor:pointer', onclick:toggle}, [
        h('span', null, [h('b', {text:p.name || '(unnamed)'}), h('span', {class:'dim small', text:'   ' + p.paths.length + ' dir' + (p.paths.length === 1 ? '' : 's') + ' | ' + st.sessions + ' sessions | ' + money(st.cost) + (p.categories.length ? ' | ' + p.categories.length + ' categories' : '') + (p.defaultCategory ? ' | default ' + p.defaultCategory : '')})]),
        h('button', {class:'sm', text:'Edit', onclick:function(e){ e.stopPropagation(); toggle(); }})]));
      wrap.appendChild(card);
      return;
    }
    var nameIn = h('input', {class:'grow', value:p.name, placeholder:'project name', oninput:function(e){ p.name = e.target.value; setProjDirty(); }});
    card.appendChild(h('div', {class:'row'}, [nameIn,
      h('button', {class:'sm', text:'Collapse', onclick:toggle}),
      h('button', {class:'sm', text:'Delete project', onclick:function(){ draftProjects.splice(i,1); var k = openProj.indexOf(p); if (k >= 0) openProj.splice(k,1); setProjDirty(); rerenderKeep(); }})]));
    card.appendChild(h('h3', {text:'Directories', style:'margin-top:10px'}));
    if (!p.paths.length) card.appendChild(h('div', {class:'dim small', text:'no paths yet'}));
    p.paths.forEach(function(pa, j){
      card.appendChild(h('div', {class:'pathrow'}, [h('span', {text:pa}),
        h('button', {class:'sm', text:'remove', onclick:function(){ p.paths.splice(j,1); setProjDirty(); rerenderKeep(); }})]));
    });
    var addIn = h('input', {class:'grow', placeholder:'add path, e.g. C:\\Users\\you\\code\\app'});
    var doAdd = function(){ var v = addIn.value.trim(); if (!v) return; if (p.paths.indexOf(v) < 0) p.paths.push(v); setProjDirty(); rerenderKeep(); };
    addIn.addEventListener('keydown', function(e){ if (e.key === 'Enter') doAdd(); });
    card.appendChild(h('div', {class:'row'}, [addIn, h('button', {class:'sm', text:'add path', onclick:doAdd})]));
    var moved = (S.projectTotals || []).some(function(t){ return t.name === p.name; }) ? movedList(p.name) : null;
    if (moved) card.appendChild(moved);
    card.appendChild(h('hr', {class:'rule'}));
    card.appendChild(h('h3', {text:'Categories (none selected = all allowed)'}));
    var chips = h('div', {class:'row'});
    (S.config.categories || []).forEach(function(c){
      var on = p.categories.indexOf(c.id) >= 0;
      chips.appendChild(h('span', {class:'chip' + (on ? ' on' : ''), onclick:function(){
        var k = p.categories.indexOf(c.id);
        if (k >= 0) p.categories.splice(k,1); else p.categories.push(c.id);
        if (p.defaultCategory && p.categories.length && p.categories.indexOf(p.defaultCategory) < 0) p.defaultCategory = null;
        setProjDirty(); rerenderKeep();
      }}, [h('span', {class:'dot', style:'background:var(--cat-' + escapeHtml(c.id) + ')'}), c.label]));
    });
    card.appendChild(chips);
    var allowed = (S.config.categories || []).filter(function(c){ return !p.categories.length || p.categories.indexOf(c.id) >= 0; });
    var sel = h('select', {onchange:function(e){ p.defaultCategory = e.target.value || null; setProjDirty(); }});
    sel.appendChild(h('option', {value:'', text:'— none —'}));
    allowed.forEach(function(c){ var o = h('option', {value:c.id, text:c.label}); if (p.defaultCategory === c.id) o.selected = true; sel.appendChild(o); });
    card.appendChild(h('div', {class:'row'}, [h('span', {class:'dim small', text:'DEFAULT CATEGORY'}), sel, h('span', {class:'dim small', text:'used for untagged sessions'})]));
    wrap.appendChild(card);
  });
  wrap.appendChild(h('div', {class:'row', style:'margin-bottom:16px'}, [h('button', {text:'New project', onclick:function(){
    var np = {name:'', paths:[], categories:[], defaultCategory:null};
    draftProjects.push(np); openProj.push(np); setProjDirty(); rerenderKeep();
    setTimeout(function(){ var ins = view.querySelectorAll('input[placeholder="project name"]'); var last = ins[ins.length - 1]; if (last){ last.focus(); last.scrollIntoView({block:'center'}); } }, 0);
  }})]));

  var un = (S.directories || []).filter(function(d){ return d.implicit; });
  var ucard = h('div', {class:'card'}, [h('h3', {text:'Unassigned directories'})]);
  var assigned = {}; draftProjects.forEach(function(p){ p.paths.forEach(function(x){ assigned[x] = 1; }); });
  var shown = un.filter(function(d){ return !assigned[d.cwd] && d.sessions > 0; });
  if (!shown.length) ucard.appendChild(h('div', {class:'dim', text:'none'}));
  shown.forEach(function(d){
    var sel = h('select', {onchange:function(e){
      var v = e.target.value; if (v === '') return;
      var target;
      if (v === 'new'){
        var base = d.cwd.replace(/[\\\/]+$/, '').split(/[\\\/]/).pop() || d.cwd;
        target = {name:base, paths:[], categories:[], defaultCategory:null};
        draftProjects.push(target);
      } else target = draftProjects[Number(v)];
      if (target.paths.indexOf(d.cwd) < 0) target.paths.push(d.cwd);
      if (openProj.indexOf(target) < 0) openProj.push(target);
      setProjDirty(); rerenderKeep();
    }});
    sel.appendChild(h('option', {value:'', text:'add to project…'}));
    draftProjects.forEach(function(p, i){ sel.appendChild(h('option', {value:String(i), text:p.name || '(unnamed)'})); });
    sel.appendChild(h('option', {value:'new', text:'new project named after folder'}));
    var isOpenDir = !!dirOpen[d.cwd];
    ucard.appendChild(h('div', {class:'row sb', style:'border-bottom:' + (isOpenDir ? 'none' : '1px dashed var(--rule)') + ';padding:4px 0'}, [
      h('span', {class:'grow', style:'word-break:break-all', text:d.cwd}),
      h('span', {class:'dim small', text:d.sessions + ' sessions' + (d.moved ? ' (+' + d.moved + ' moved)' : '')}),
      h('span', {text:money(d.cost)}),
      h('button', {class:'sm', text:isOpenDir ? 'Hide sessions' : 'Sessions', onclick:function(){ dirOpen[d.cwd] = !dirOpen[d.cwd]; rerenderKeep(); }}), sel]));
    if (isOpenDir) ucard.appendChild(sessionList(d));
  });
  wrap.appendChild(ucard);
  if (projDirty) wrap.appendChild(projBar());
  return wrap;
}
function projBar(){ return h('div', {class:'savebar', id:'projbar'}, [h('span', {class:'dim', text:'unsaved changes'}), h('span', {class:'row', style:'margin:0'}, [h('button', {text:'Cancel', onclick:cancelProjects}), h('button', {text:'Save', onclick:saveProjects})])]); }
function cancelProjects(){ draftProjects = sortedProjects(clone(S.config.projects || [])); projDirty = false; openProj = []; rerenderKeep(); toast('changes discarded'); }
function setProjDirty(){
  if (projDirty) return; projDirty = true;
  if (tab === 'projects' && !document.getElementById('projbar')) view.firstChild.appendChild(projBar());
}
function saveProjects(){
  var names = {};
  for (var i = 0; i < draftProjects.length; i++){
    var n = draftProjects[i].name.trim();
    if (!n) return toast('project names must not be empty', true);
    if (names[n.toLowerCase()]) return toast('duplicate project name: ' + n, true);
    names[n.toLowerCase()] = 1;
    draftProjects[i].name = n;
  }
  save(api('PUT', '/api/config', {projects: draftProjects}));
}

/* ---------- CATEGORIES ---------- */
function rCategories(){
  var wrap = h('div');
  var card = h('div', {class:'card'}, [h('h3', {text:'Categories'}),
    h('p', {class:'note', text:'These are the choices for tagging a session. Up / down changes the order they appear in (menus, charts, and the list /burner-tag shows Claude). Delete removes a category; sessions already tagged with it become untagged. A category used by a project must be removed from that project first.'})]);
  var tb = h('tbody');
  draftCats.forEach(function(c, i){
    var idCell = c._existing ? h('span', {text:c.id}) : h('input', {class:'pin', style:'width:110px', value:c.id, placeholder:'my-id', oninput:function(e){ c.id = e.target.value.trim().toLowerCase(); setCatDirty(); }});
    tb.appendChild(h('tr', null, [
      h('td', null, h('input', {type:'color', value:/^#[0-9a-fA-F]{6}$/.test(c.color) ? c.color : '#888888', oninput:function(e){ c.color = e.target.value; setCatDirty(); }})),
      h('td', null, idCell),
      h('td', null, h('input', {style:'width:120px', value:c.label, oninput:function(e){ c.label = e.target.value; setCatDirty(); }})),
      h('td', null, h('input', {style:'width:100%;min-width:140px', value:c.description || '', oninput:function(e){ c.description = e.target.value; setCatDirty(); }})),
      h('td', {style:'white-space:nowrap'}, [
        h('button', {class:'sm', text:'up', title:'move up in the list', disabled:i === 0, onclick:function(){ var t = draftCats[i]; draftCats[i] = draftCats[i-1]; draftCats[i-1] = t; setCatDirty(); rerenderKeep(); }}), ' ',
        h('button', {class:'sm', text:'down', title:'move down in the list', disabled:i === draftCats.length - 1, onclick:function(){ var t = draftCats[i]; draftCats[i] = draftCats[i+1]; draftCats[i+1] = t; setCatDirty(); rerenderKeep(); }}), ' ',
        h('button', {class:'sm', text:'delete', title:'remove this category', onclick:function(){
          var users = draftProjects.filter(function(p){ return p.categories.indexOf(c.id) >= 0 || p.defaultCategory === c.id; });
          if (users.length) return toast('category "' + c.id + '" is used by project: ' + users.map(function(p){ return p.name; }).join(', '), true);
          draftCats.splice(i,1); setCatDirty(); rerenderKeep();
        }})])
    ]));
  });
  card.appendChild(h('div', {class:'tblwrap'}, h('table', null, [
    h('thead', null, h('tr', null, [h('th', {text:'Color'}), h('th', {text:'Id'}), h('th', {text:'Label'}), h('th', {text:'Description'}), h('th', {text:''})])), tb])));
  card.appendChild(h('div', {class:'row'}, [h('button', {text:'Add category', onclick:function(){
    draftCats.push({id:'', label:'', color:'#8a8478', description:'', _existing:false}); setCatDirty(); rerenderKeep();
  }})]));
  wrap.appendChild(card);
  if (catDirty) wrap.appendChild(catBar());
  return wrap;
}
function catBar(){ return h('div', {class:'savebar', id:'catbar'}, [h('span', {class:'dim', text:'unsaved changes'}), h('span', {class:'row', style:'margin:0'}, [h('button', {text:'Cancel', onclick:cancelCats}), h('button', {text:'Save', onclick:saveCats})])]); }
function cancelCats(){ draftCats = clone(S.config.categories || []).map(function(c){ c._existing = true; return c; }); catDirty = false; rerenderKeep(); toast('changes discarded'); }
function setCatDirty(){ if (catDirty) return; catDirty = true; if (tab === 'categories' && !document.getElementById('catbar')) view.firstChild.appendChild(catBar()); }
function saveCats(){
  var seen = {};
  for (var i = 0; i < draftCats.length; i++){
    var c = draftCats[i];
    if (!/^[a-z][a-z0-9-]*$/.test(c.id)) return toast('invalid id "' + c.id + '" (lowercase letters, digits, dashes)', true);
    if (c.id === 'untagged') return toast('"untagged" is reserved', true);
    if (seen[c.id]) return toast('duplicate id: ' + c.id, true);
    seen[c.id] = 1;
    if (!c.label.trim()) return toast('label required for ' + c.id, true);
  }
  var out = draftCats.map(function(c){ return {id:c.id, label:c.label.trim(), color:c.color, description:c.description || ''}; });
  save(api('PUT', '/api/config', {categories: out}));
}

/* ---------- PRICING ---------- */
var FIELDS = [['input','input'],['output','output'],['cacheWrite5m','cw 5m'],['cacheWrite1h','cw 1h'],['cacheRead','cache read']];
var SRC = {live:'LIVE', cache:'CACHED', 'stale-cache':'CACHED (STALE)', 'bundled-fallback':'OFFLINE SNAPSHOT'};
function ratesEqual(a, b){ return FIELDS.every(function(f){ return Number(a[f[0]]) === Number(b[f[0]]); }); }
function pricingModelRows(){
  var rows = (S.models || []).map(function(m){ return Object.assign({customOnly:false}, m); });
  var ovs = S.pricingOverrides || {};
  Object.keys(ovs).forEach(function(id){
    if (rows.some(function(m){ return m.rawModel === id; })) return;
    rows.push({ rawModel: id, sessions: 0, tokens: {}, cost: 0, fidelity: 'override', rates: ovs[id], suggested: null, customOnly: true });
  });
  return rows;
}
function rPricing(){
  var wrap = h('div');
  var p = S.pricing || {};
  var head = h('div', {class:'card'});
  var refBtn = h('button', {text: busy.refresh ? 'refreshing…' : 'Refresh prices', disabled:!!busy.refresh, onclick:function(){
    busy.refresh = true; rerenderKeep();
    api('POST', '/api/pricing/refresh', {}).then(function(st){ busy.refresh = false; applyState(st); toast('prices refreshed'); rerenderKeep(); })
      .catch(function(e){ busy.refresh = false; toast(e.message, true); rerenderKeep(); });
  }});
  head.appendChild(h('div', {class:'row sb'}, [
    h('span', null, [h('b', {text:SRC[p.source] || String(p.source || '').toUpperCase()}), h('span', {class:'dim', text:'  fetched ' + rel(p.fetchedAt) + (p.modelCount != null ? '  ·  ' + p.modelCount + ' public models' : '')})]), refBtn]));
  if (p.error) head.appendChild(h('div', {class:'err small', text:p.error}));
  head.appendChild(h('p', {class:'note', style:'margin:8px 0 0', text:'Only models found in your sessions are listed. AUTO models follow the public price list; Pin price keeps a price for that model forever. Anything that is not a Claude model costs $0 until you set one.'}));
  wrap.appendChild(head);

  var card = h('div', {class:'card'}, [h('h3', {text:'Models'})]);
  var tb = h('tbody');
  pricingModelRows().forEach(function(m){
    var raw = m.rawModel;
    var inputs = {};
    var tr = h('tr');
    var markCell = h('span', {class:'mark'});
    function cur(){ var o = {}; FIELDS.forEach(function(f){ o[f[0]] = Number(inputs[f[0]].value) || 0; }); return o; }
    function refresh(){
      var c = cur();
      if (priceResets[raw]) { markCell.textContent = '* reset'; return; }
      if (!ratesEqual(c, m.rates)) { priceEdits[raw] = c; markCell.textContent = '* changed'; }
      else { delete priceEdits[raw]; markCell.textContent = ''; }
      setPriceBar();
    }
    function fill(r){ FIELDS.forEach(function(f){ inputs[f[0]].value = r[f[0]]; }); delete priceResets[raw]; refresh(); }
    FIELDS.forEach(function(f){
      var cur0 = (priceEdits[raw] || m.rates)[f[0]];
      inputs[f[0]] = h('input', {type:'number', step:'any', min:'0', class:'pin', value:cur0, title:f[1], oninput:function(){ delete priceResets[raw]; refresh(); }});
    });
    var badge = {override:['PINNED', 1], measured:['AUTO: PUBLIC LIST'], 'approximate-alias':['AUTO: ALIAS'], unpriced:['$0 UNPRICED']}[m.fidelity] || [String(m.fidelity).toUpperCase()];
    var total = 0; for (var k in (m.tokens || {})) total += Number(m.tokens[k]) || 0;
    var hasOverride = S.pricingOverrides && S.pricingOverrides[raw];
    var acts = h('div', {style:'display:flex;gap:4px;flex-wrap:wrap'});
    if (!hasOverride) acts.appendChild(h('button', {class:'sm', title:'keep exactly these rates for this model from now on, even if the public list changes', text:'Pin price', onclick:function(){
      var o = clone(S.pricingOverrides || {}); o[raw] = cur(); delete priceEdits[raw]; delete priceResets[raw];
      save(api('PUT', '/api/pricing', {models: o}), 'pinned ' + raw);
    }}));
    var rfBtn = h('button', {class:'sm', title:'re-fetch the public price list and fill in this model\\'s current price', text:'Refresh', onclick:function(){
      rfBtn.disabled = true; rfBtn.textContent = '...';
      api('POST', '/api/pricing/lookup', {model:raw, refresh:true}).then(function(r){
        rfBtn.disabled = false; rfBtn.textContent = 'Refresh';
        if (r.listError) toast('could not reach the price list, used ' + r.listSource + ' copy', true);
        if (!r.found) return toast('"' + raw + '" is not in the public price list', true);
        if (ratesEqual(cur(), r.rates)) return toast('already matches the public price');
        fill(r.rates); toast('public price filled in - ' + (hasOverride ? 'Save to keep it' : 'Pin it to keep it'));
      }).catch(function(e){ rfBtn.disabled = false; rfBtn.textContent = 'Refresh'; toast(e.message, true); });
    }});
    acts.appendChild(rfBtn);
    if (m.suggested) acts.appendChild(h('button', {class:'sm', text:'Use public $', onclick:function(){ fill(m.suggested); }}));
    acts.appendChild(h('button', {class:'sm', text:'Set $0', onclick:function(){ fill({input:0,output:0,cacheWrite5m:0,cacheWrite1h:0,cacheRead:0}); }}));
    var dropOverride = function(msg){
      var o = clone(S.pricingOverrides || {}); delete o[raw]; delete priceEdits[raw]; delete priceResets[raw];
      save(api('PUT', '/api/pricing', {models: o}), msg);
    };
    if (hasOverride && !m.customOnly) acts.appendChild(h('button', {class:'sm', title:'stop pinning; follow the public list again', text:'Unpin', onclick:function(){ dropOverride('unpinned ' + raw); }}));
    if (m.customOnly) acts.appendChild(h('button', {class:'sm', text:'Remove', onclick:function(){ dropOverride('removed ' + raw); }}));
    tb.appendChild(h('tr', null, [h('td', {colspan:'7', style:'border-bottom:none;padding-bottom:0'}, [
      h('b', {text:raw}),
      '  ', h('span', {class:'badge' + (badge[1] ? ' o' : ''), text:badge[0]}), '  ', markCell,
      h('span', {class:'dim small', text:'   ' + m.sessions + ' sessions · ' + fmtTok(total) + ' tokens · ' + money(m.cost) + (m.unreported ? ' · ' + m.unreported + ' requests reported no token usage' : '')})])]));
    var cells = [];
    FIELDS.forEach(function(f){ cells.push(h('td', null, [h('div', {class:'dim small', text:f[1]}), inputs[f[0]]])); });
    cells.push(h('td', {colspan:'2'}, acts));
    tb.appendChild(h('tr', null, cells));
  });
  if (!pricingModelRows().length) tb.appendChild(h('tr', null, h('td', {class:'dim', text:'no models yet — add one below or run a session first'})));
  card.appendChild(h('div', {class:'tblwrap'}, h('table', null, [tb])));
  card.appendChild(h('div', {class:'dim small', style:'margin-top:8px', text:'USD per million tokens'}));
  var addId = h('input', {class:'grow', placeholder:'model id (e.g. claude-sonnet-5-5, qwen3-coder:30b)', value:addDraft, oninput:function(e){ addDraft = e.target.value; }});
  function putModel(id, rates, msg){
    var o = clone(S.pricingOverrides || {});
    if (o[id]) return toast('already listed: ' + id, true);
    o[id] = rates;
    addDraft = ''; addMsg = msg || ''; addCands = [];
    save(api('PUT', '/api/pricing', {models: o}), msg || 'added');
  }
  function doAdd(){
    var id = (addDraft || '').trim().toLowerCase();
    if (!id) return toast('enter a model id', true);
    busy.add = true; addMsg = 'checking the public price list...'; addCands = []; rerenderKeep();
    api('POST', '/api/pricing/lookup', {model:id}).then(function(r){
      busy.add = false;
      if (r.found){
        putModel(id, r.rates, 'found "' + r.id + '" in the public price list' + (r.provider ? ' (' + r.provider + ')' : '') + ' - rates filled in, edit if needed');
      } else if (r.candidates && r.candidates.length){
        addMsg = 'no exact match for "' + id + '". Similar public models:'; addCands = r.candidates; rerenderKeep();
      } else {
        putModel(id, {input:0,output:0,cacheWrite5m:0,cacheWrite1h:0,cacheRead:0}, 'not in the public price list - added at $0, set the rates below');
      }
    }).catch(function(e){ busy.add = false; addMsg = ''; toast(e.message, true); rerenderKeep(); });
  }
  addId.addEventListener('keydown', function(e){ if (e.key === 'Enter') doAdd(); });
  var addBox = h('div', {class:'add-model'}, [
    h('h3', {text:'Add model'}),
    h('p', {class:'note', style:'margin:0 0 8px', text:'Looks the id up in the public price list and fills in the rates when it exists. Otherwise it starts at $0 so you can set your own (gateway, on-prem, local).'}),
    h('div', {class:'row'}, [addId, h('button', {text: busy.add ? 'checking...' : 'Add', disabled:!!busy.add, onclick:doAdd})])]);
  if (addMsg) addBox.appendChild(h('div', {class:'result', text:addMsg}));
  if (addCands.length){
    var cl = h('div', {class:'row'});
    addCands.forEach(function(c){
      cl.appendChild(h('span', {class:'chip', title:'in $' + c.rates.input + ' / out $' + c.rates.output + ' per 1M tokens', text:c.id, onclick:function(){
        putModel(addDraft.trim().toLowerCase() || c.id, c.rates, 'used rates from "' + c.id + '" for "' + (addDraft.trim().toLowerCase() || c.id) + '" - edit if needed');
      }}));
    });
    cl.appendChild(h('button', {class:'sm', text:'add at $0 instead', onclick:function(){ putModel(addDraft.trim().toLowerCase(), {input:0,output:0,cacheWrite5m:0,cacheWrite1h:0,cacheRead:0}, 'added at $0 - set the rates below'); }}));
    addBox.appendChild(cl);
  }
  card.appendChild(addBox);
  wrap.appendChild(card);
  if (Object.keys(priceEdits).length || Object.keys(priceResets).length) wrap.appendChild(priceBar());
  var srcUrl = S.pricingSourceUrl || '';
  if (srcUrl) wrap.appendChild(h('div', {class:'pricing-foot'}, [h('span', {text:'Public price list: '}), h('a', {href:srcUrl, target:'_blank', rel:'noopener', text:srcUrl})]));
  return wrap;
}
function priceBar(){ return h('div', {class:'savebar', id:'pricebar'}, [h('span', {class:'dim', text:'unsaved price changes'}), h('span', {class:'row', style:'margin:0'}, [h('button', {text:'Cancel', onclick:function(){ priceEdits = {}; priceResets = {}; rerenderKeep(); toast('changes discarded'); }}), h('button', {text:'Save', onclick:savePricing})])]); }
function setPriceBar(){
  if (tab !== 'pricing') return;
  var dirty = Object.keys(priceEdits).length || Object.keys(priceResets).length;
  var bar = document.getElementById('pricebar');
  if (dirty && !bar) view.firstChild.appendChild(priceBar());
  else if (!dirty && bar) bar.remove();
}
function savePricing(){
  var o = clone(S.pricingOverrides || {});
  Object.keys(priceEdits).forEach(function(k){ o[k] = priceEdits[k]; });
  Object.keys(priceResets).forEach(function(k){ delete o[k]; });
  save(api('PUT', '/api/pricing', {models: o}));
}

function taggingSetupPills(level, ins, tagging, learned){
  var pills = h('div', {class:'setup-pills'});
  pills.appendChild(h('span', {class:'dim small', text:'Claude setup (auto):'}));
  if (level === 'off') {
    pills.appendChild(h('span', {class:'badge dimmed', text:'skill removed'}));
  } else {
    pills.appendChild(h('span', {class:'badge' + (ins.skillInstalled ? ' ok' : ''), text:'/' + (ins.skillName || 'burner-tag') + (ins.skillInstalled ? ' \u2713' : ' \u2717')}));
    var hookLbl = level === 'session' ? (ins.sessionEndHook ? 'SessionEnd hook \u2713' : 'SessionEnd hook \u2717') : 'SessionEnd off';
    pills.appendChild(h('span', {class:'badge' + (level === 'session' && ins.sessionEndHook ? ' ok' : (level === 'session' ? '' : ' dimmed')), text: hookLbl}));
  }
  pills.appendChild(h('span', {class:'dim small', style:'margin-left:4px', text:'|'}));
  var L = learned;
  var localN = L && (L.sources && L.sources.local != null ? L.sources.local : L.examples);
  var trainedLbl = 'My trained model';
  if (L && L.hasUserModel) trainedLbl += ' \u2713 · ' + localN + ' tag' + (localN === 1 ? '' : 's');
  else if (L && !L.hasUserModel) trainedLbl += ' (not saved yet)';
  else trainedLbl += ' (not trained)';
  if (L && L.trainedAt && L.hasUserModel) trainedLbl += ' · ' + rel(L.trainedAt);
  pills.appendChild(h('label', {class:'row'}, [
    h('input', {type:'checkbox', checked:!!tagging.learned, onchange:function(e){ save(api('PUT', '/api/config', {tagging:{learned:e.target.checked}}), e.target.checked ? 'learned model on' : 'learned model off'); }}),
    h('span', {class:'badge' + (tagging.learned && L && L.hasUserModel ? ' ok' : ''), text: trainedLbl})]));
  return pills;
}

/* ---------- TAGGING ---------- */
function rTagging(){
  var wrap = h('div');
  var t = S.config.tagging || {};
  var levels = S.levels || [];
  var ins = S.install || {};
  var L = S.learned;
  var idx = Math.max(0, levels.map(function(l){ return l.id; }).indexOf(t.level));
  var desc = h('div', {class:'lvdesc', text:levels[idx] ? levels[idx].description : ''});
  var setupPills = taggingSetupPills(t.level, ins, t, L);
  var ticks = h('div', {class:'ticks'});
  var slider = h('input', {type:'range', min:'0', max:String(Math.max(0, levels.length - 1)), step:'1', value:String(idx)});
  levels.forEach(function(l, i){ ticks.appendChild(h('span', {class:i === idx ? 'sel' : '', text:l.label, onclick:function(){ slider.value = i; slider.dispatchEvent(new Event('change')); }})); });
  function syncLevelUi(i){
    var lv = levels[i].id;
    desc.textContent = levels[i].description;
    Array.prototype.forEach.call(ticks.children, function(s, j){ s.className = j === i ? 'sel' : ''; });
  }
  slider.addEventListener('input', function(){ syncLevelUi(Number(slider.value)); });
  slider.addEventListener('change', function(){
    var lv = levels[Number(slider.value)].id;
    save(api('PUT', '/api/config', {tagging:{level:lv}}), 'Claude setup updated');
  });
  var levelCard = h('div', {class:'card'});
  levelCard.appendChild(h('h3', {text:'Tagging level'}));
  levelCard.appendChild(h('div', {class:'slider-wrap'}, [slider, ticks]));
  levelCard.appendChild(desc);
  levelCard.appendChild(setupPills);
  wrap.appendChild(levelCard);

  var sessionNote = h('div', {class:'card'});
  sessionNote.appendChild(h('h3', {text:'Session end auto-tag'}));
  sessionNote.appendChild(h('p', {class:'note', text:'Uses your trained local model (train below) and project defaults. Runs in the SessionEnd hook — no Anthropic API, no edits to CLAUDE.md.'}));
  sessionNote.appendChild(h('p', {class:'dim small', text: ins.sessionEndHook ? 'Hook installed in ~/.claude/settings.json' : 'Move the slider to Session end to install the hook.'}));
  wrap.appendChild(sessionNote);

  var skillCard = h('div', {class:'card'});
  skillCard.appendChild(h('h3', {text:'Troubleshooting / manual install'}));
  skillCard.appendChild(h('p', {class:'note', text:'Moving the tagging slider updates ~/.claude for you. Use this only if /burner-tag is missing or hooks look wrong.'}));
  skillCard.appendChild(h('div', {class:'card-section', style:'margin-top:0;padding-top:0;border:none'}, [
    h('h4', {text:'Status'}),
    h('div', {text:'/' + ins.skillName + ' ' + (ins.skillInstalled ? '\u2713' : '\u2717')}),
    ins.skillPath ? h('div', {class:'dim small', text:ins.skillPath}) : null,
    ins.legacyClaudeMd ? h('div', {class:'dim small', text:'Legacy CLAUDE.md burner block still present — run Sync to remove'}) : null]));
  var installCmd = ins.skillInstallCmdNpm || 'burner install';
  if (ins.devCheckout && ins.skillInstallCmd && ins.skillInstallCmd !== installCmd) {
    installCmd = installCmd + '\\n' + ins.skillInstallCmd;
  }
  var secInstall = h('div', {class:'card-section'});
  secInstall.appendChild(h('h4', {text:'Install'}));
  secInstall.appendChild(copyField('', installCmd));
  secInstall.appendChild(h('button', {class:'sm', text:'Sync Claude setup now', onclick:function(){ save(api('POST', '/api/install/sync', {}), 'synced'); }}));
  secInstall.appendChild(h('p', {class:'note dim small', style:'margin:6px 0 0', text:'npm i -g burner-cc → burner install on PATH'}));
  skillCard.appendChild(secInstall);
  var secPaste = h('div', {class:'card-section'});
  secPaste.appendChild(h('h4', {text:'Paste into Claude / Cursor'}));
  secPaste.appendChild(copyField('', SKILL_SETUP_PROMPT));
  skillCard.appendChild(secPaste);
  wrap.appendChild(skillCard);

  var c3 = h('div', {class:'card'}, [h('h3', {text:'Train my model'}), h('p', {class:'note', text:'Runs entirely in Node on your machine (no GPU, Python, or extra packages). Reads your tagged sessions and writes ~/.burner/model/intent-nb.json. Works the same on Windows, macOS, and Linux. Enable with the checkbox under the slider; guesses only when there is no tag and no project default, confidence \u2265 60%.'})]);
  var st = h('div', {class:'row'});
  var catIds = (S.config.categories || []).map(function(c){ return c.id; });
  if (L){
    var localN = L.sources && L.sources.local != null ? L.sources.local : L.examples;
    var status = localN + ' tagged session' + (localN === 1 ? '' : 's');
    if (L.trainedAt) status += ' · trained ' + rel(L.trainedAt);
    if (L.builtin) status += ' · built-in prior (weak)';
    else if (L.totalRows && L.totalRows > localN) status += ' · includes older merged data (' + L.totalRows + ' rows) — Reset then Train to use only your tags';
    st.appendChild(h('span', {class:'dim', text:status}));
    var src = L.sources || {};
    var srcBits = Object.keys(src).filter(function(k){ return src[k]; }).map(function(k){ return k + ' ' + src[k]; });
    if (srcBits.length) st.appendChild(h('span', {class:'dim small', text:srcBits.join(' · ')}));
    var chips = h('div', {class:'row', style:'margin-top:6px'});
    Object.keys(L.classes || {}).filter(function(k){ return catIds.indexOf(k) >= 0; }).sort(function(a,b){ return (L.classes[b]||0) - (L.classes[a]||0); }).forEach(function(k){
      var w = L.classes[k];
      var sess = Math.max(1, Math.round(w / 5));
      chips.appendChild(h('span', {class:'chip static', title:'training weight ' + w + ' (each of your tags counts as 5)', text:k + ' \u00b7 ' + sess + ' session' + (sess === 1 ? '' : 's')}));
    });
    c3.appendChild(st);
    if (chips.childNodes.length) {
      c3.appendChild(chips);
      c3.appendChild(h('p', {class:'dim small', style:'margin:4px 0 0', text:'Counts are how many of your tagged sessions trained each category (your tags weigh more than any public bootstrap data).'}));
    }
  } else {
    st.appendChild(h('span', {class:'dim', text:'not trained yet — need 6+ tagged sessions across 2+ categories'}));
    c3.appendChild(st);
  }
  var rowBtns = h('div', {class:'row'});
  rowBtns.appendChild(h('button', {text: busy.train ? 'training…' : 'Train from my tags', disabled:!!busy.train, onclick:function(){
    busy.train = true; rerenderKeep();
    api('POST', '/api/learned/train', {}).then(function(r){
      busy.train = false;
      trainText = r.message || (r.ok ? 'trained on ' + r.examples + ' tagged session' + (r.examples === 1 ? '' : 's') : 'not trained'); trainErr = !r.ok;
      return api('GET', '/api/state').then(function(s2){ applyState(s2); rerenderKeep(); });
    }).catch(function(e){ busy.train = false; toast(e.message, true); rerenderKeep(); });
  }}));
  if (L && L.hasUserModel) rowBtns.appendChild(h('button', {class:'sm', text:'Reset model', onclick:function(){
    if (!confirm('Delete your saved learned model? Untagged sessions will stay untagged until you train again.')) return;
    api('POST', '/api/learned/reset', {}).then(function(){ trainText = 'model cleared'; trainErr = false; return api('GET', '/api/state').then(function(s2){ applyState(s2); rerenderKeep(); }); }).catch(function(e){ toast(e.message, true); });
  }}));
  var secTrain = h('div', {class:'card-section'});
  secTrain.appendChild(h('h4', {text:'Train'}));
  secTrain.appendChild(rowBtns);
  secTrain.appendChild(h('div', {class:'result' + (trainErr ? ' err' : ''), text:trainText}));
  c3.appendChild(secTrain);
  wrap.appendChild(c3);

  var s = S.stats || {};
  var bs = Object.keys(s.bySource || {}).map(function(k){ return k + ' ' + s.bySource[k]; }).join(' · ');
  wrap.appendChild(h('div', {class:'dim small', style:'text-align:center', text:s.sessions + ' sessions · tagged ' + s.tagged + ' · untagged ' + s.untagged + (bs ? '   [' + bs + ']' : '')}));
  return wrap;
}

window.addEventListener('pageshow', function(e){
  // Back/forward restores a frozen copy: reload fresh state unless there are unsaved edits.
  if (e.persisted && !projDirty && !catDirty && !Object.keys(priceEdits).length && !Object.keys(priceResets).length) api('GET', '/api/state').then(function(st){ applyState(st); allSessions = null; rerenderKeep(); });
});
readHash(); render();
api('GET', '/api/state').then(function(st){ applyState(st); render(); }).catch(function(e){ view.textContent = ''; view.appendChild(h('div', {class:'card err', text:'Failed to load state: ' + e.message})); });
})();
</script>
</body>
</html>`;
}
