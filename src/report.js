// Self-contained HTML report — no external deps, pure canvas charts.

import { readFileSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { themeCss, categoryOverrideCss, categoryColorsForTheme } from './themes.js';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const ASSETS_DIR = path.join(__dirname, '..', 'assets');

// Embedded in a <script>; keeps "</script>" in session titles from closing it.
const safeJson = (v) => JSON.stringify(v).replace(/</g, '\\u003c');

function fmtTok(n) {
  if (!n) return '—';
  if (n >= 1_000_000) return (n / 1_000_000).toFixed(2) + 'M tok';
  if (n >= 1_000)     return (n / 1_000).toFixed(1) + 'K tok';
  return n + ' tok';
}
function fmtCost(n) { return (!n) ? '—' : '$' + n.toFixed(4); }
function shortDate(iso) {
  if (!iso) return 'unknown';
  return new Date(iso).toLocaleDateString('en-US', { day: '2-digit', month: 'short', year: 'numeric' }).toUpperCase();
}
function pricingLabel(src) {
  return { 'bundled-fallback': 'OFFLINE SNAPSHOT', 'cache': 'CACHED', 'live': 'LIVE', 'stale-cache': 'CACHED (STALE)' }[src] ?? src.toUpperCase();
}

function readLogoBase64(name) {
  try { return readFileSync(path.join(ASSETS_DIR, name)).toString('base64'); } catch {}
  return null;
}

export function renderReport(data, { served = false, theme = null, range = null } = {}) {
  const { sessions, pricingSource, generatedAt, categories } = data;
  const uiTheme = theme ?? 'paper';
  const reportSessions = sessions.map(({ activity, attribution, subagentGroups, subagentRuns, agents, ...s }) => s);

  const logoUri = (name) => {
    if (served) return `/assets/${name}`;
    const b64 = readLogoBase64(name);
    return b64 ? `data:image/png;base64,${b64}` : '';
  };
  const logoMarkUri = logoUri('logo-mark.png');
  const logoTextUri = logoUri('logo-with-text.png');

  const totalSessions  = sessions.length;
  const totalTokens    = sessions.reduce((s, r) => s + r.totalTokens.total, 0);
  const totalCost      = sessions.reduce((s, r) => s + r.totalCost.total, 0);
  const uniqueModels   = [...new Set(sessions.flatMap(s => s.models.map(m => m.rawModel)))];
  const uniqueProjects = [...new Set(sessions.map(s => s.project))];
  const promptSide     = sessions.reduce((a, r) => a + r.totalTokens.input + r.totalTokens.cacheWrite + r.totalTokens.cacheRead, 0);
  const avgCacheHit    = promptSide ? Math.round(sessions.reduce((a, r) => a + r.totalTokens.cacheRead, 0) / promptSide * 100) : 0;
  const outputTokens   = sessions.reduce((a, r) => a + r.totalTokens.output, 0);
  const untaggedCount  = sessions.filter(s => s.category === 'untagged').length;
  const unpricedModels = data.unpricedModels ?? [];
  const pricingLbl     = pricingLabel(pricingSource);
  const esc = (s) => String(s ?? '').replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));

  const CAT_COLORS = categoryColorsForTheme(uiTheme, categories);
  const catOverrideCss = categoryOverrideCss(categories);
  const CAT_LABELS = Object.fromEntries(categories.map(c => [c.id, c.label]));

  // ── Inline micro chart library ────────────────────────────────────────────
  const MICRO_CHARTS = String.raw`
(function(G){
function px(n){return Math.round(n);}
function cssVar(name){return getComputedStyle(document.documentElement).getPropertyValue(name).trim();}
function ink(){return cssVar('--ink')||'#2b2b26';}
function dim(){return cssVar('--dim')||'#8a8478';}
function bg(){return cssVar('--bg')||'#f4f1e8';}
function rule(){return cssVar('--rule')||'#b8b2a2';}
function hexAlpha(hex,a){
  const h=hex.replace('#','');
  const r=parseInt(h.slice(0,2),16),g=parseInt(h.slice(2,4),16),b=parseInt(h.slice(4,6),16);
  return 'rgba('+r+','+g+','+b+','+a+')';
}
function inkAlpha(a){
  // parse ink color (could be rgb or hex)
  const c=ink();
  if(c.startsWith('#')) return hexAlpha(c,a);
  return c.replace('rgb(','rgba(').replace(')',','+a+')');
}

// kind: 'usd' -> $1.23, otherwise compact counts / tokens
function fmtV(v,kind,dp){
  if(kind==='usd') return '$'+(v>=1000?Math.round(v).toLocaleString():v.toFixed(2));
  if(v>=1e6) return (v/1e6).toFixed(dp||1)+'M';
  if(v>=1e3) return (v/1e3).toFixed(dp||1)+'K';
  return String(Math.round(v*10)/10);
}

// Returns hit areas for tooltips
function doughnut(canvas,labels,values,colors,title){
  const ctx=canvas.getContext('2d');
  const W=canvas.width=canvas.offsetWidth*devicePixelRatio||400;
  const H=canvas.height=canvas.offsetHeight*devicePixelRatio||220;
  ctx.clearRect(0,0,W,H);
  const total=values.reduce((a,b)=>a+b,0);
  const hits=[];
  if(!total) return hits;
  const cx=W*0.38,cy=H/2,r=Math.min(cx,cy)*0.82,ir=r*0.55;
  const gap=values.length>1?Math.min(0.045,0.012*values.length):0;
  let angle=-Math.PI/2;
  values.forEach((v,i)=>{
    const slice=2*Math.PI*v/total;
    const a0=angle+gap/2,a1=angle+slice-gap/2;
    if(a1>a0){
      ctx.beginPath();
      ctx.arc(cx,cy,r,a0,a1);
      ctx.arc(cx,cy,ir,a1,a0,true);
      ctx.closePath();
      ctx.fillStyle=colors[i]||'#888';ctx.fill();
    }
    hits.push({label:labels[i],value:v,pct:Math.round(v/total*100),startAngle:a0,endAngle:a1,cx,cy,r,ir,color:colors[i]});
    angle+=slice;
  });
  ctx.beginPath();ctx.arc(cx,cy,ir,0,2*Math.PI);ctx.fillStyle=bg();ctx.fill();
  ctx.fillStyle=ink();ctx.font='bold '+px(H*0.09)+'px "IBM Plex Mono",monospace';
  ctx.textAlign='center';ctx.textBaseline='middle';ctx.fillText(total,cx,cy);
  const lx=W*0.7,lw=W*0.28,lh=Math.max(H*0.11,H/(labels.length+0.35));
  labels.forEach((lbl,i)=>{
    const ly=lh*(i+0.85);
    ctx.fillStyle=colors[i]||'#888';ctx.fillRect(px(lx),px(ly-H*0.025),px(H*0.04),px(H*0.04));
    ctx.fillStyle=dim();ctx.font=px(H*0.065)+'px "IBM Plex Mono",monospace';
    ctx.textAlign='left';ctx.textBaseline='middle';
    ctx.fillText(lbl.length>12?lbl.slice(0,11)+'\u2026':lbl,px(lx+H*0.055),ly);
    ctx.fillStyle=ink();ctx.textAlign='right';
    ctx.fillText(Math.round(values[i]/total*100)+'%',px(lx+lw),ly);
  });
  return hits;
}

function hbar(canvas,labels,values,color,title,kind){
  const ctx=canvas.getContext('2d');
  const W=canvas.width=canvas.offsetWidth*devicePixelRatio||400;
  const H=canvas.height=canvas.offsetHeight*devicePixelRatio||220;
  ctx.clearRect(0,0,W,H);
  const hits=[];
  if(!values.length) return hits;
  const max=Math.max(...values)||1;
  // Measure longest label to set labelW dynamically
  const fontSize=Math.max(10,px(H*0.065));
  ctx.font=fontSize+'px "IBM Plex Mono",monospace';
  const maxLabelPx=Math.max(...labels.map(l=>ctx.measureText(l).width));
  const labelW=Math.min(maxLabelPx+W*0.02, W*0.55); // cap at 55% of width
  const maxValPx=Math.max(...values.map(v=>ctx.measureText(fmtV(v,kind)).width));
  const barArea=Math.max(W*0.1,W-labelW-W*0.05-maxValPx),barH=H/(values.length+1)*0.55,gap=H/(values.length+1);
  values.forEach((v,i)=>{
    const y=gap*(i+0.8);
    ctx.fillStyle=dim();ctx.font=fontSize+'px "IBM Plex Mono",monospace';
    ctx.textAlign='right';ctx.textBaseline='middle';
    const lbl=labels[i]||'';
    ctx.fillText(lbl,px(labelW),px(y));
    const bw=barArea*(v/max);
    ctx.fillStyle=color||ink();
    ctx.fillRect(px(labelW+W*0.02),px(y-barH/2),px(bw),px(barH));
    ctx.fillStyle=ink();ctx.textAlign='left';
    const vStr=fmtV(v,kind);
    ctx.fillText(vStr,px(labelW+W*0.02+bw+W*0.01),px(y));
    hits.push({label:labels[i],value:v,x:px(labelW+W*0.02),y:px(y-barH/2),w:px(bw),h:px(barH)});
  });
  return hits;
}

function line(canvas,labels,values,title,kind){
  const ctx=canvas.getContext('2d');
  const W=canvas.width=canvas.offsetWidth*devicePixelRatio||400;
  const H=canvas.height=canvas.offsetHeight*devicePixelRatio||220;
  ctx.clearRect(0,0,W,H);
  const hits=[];
  if(values.length<1) return hits;
  const max=Math.max(...values)||1;
  const padL=W*(kind==='usd'?0.14:0.1),padR=W*0.04,padT=H*0.1,padB=H*0.2;
  const w=W-padL-padR,h=H-padT-padB;
  [0,0.25,0.5,0.75,1].forEach(f=>{
    const y=padT+h*(1-f);
    ctx.strokeStyle=rule();ctx.lineWidth=1;ctx.setLineDash([4,4]);
    ctx.beginPath();ctx.moveTo(padL,y);ctx.lineTo(padL+w,y);ctx.stroke();
    ctx.fillStyle=dim();ctx.font=px(H*0.06)+'px "IBM Plex Mono",monospace';
    ctx.textAlign='right';ctx.textBaseline='middle';
    ctx.fillText(kind==='usd'?fmtV(max*f,'usd'):Math.round(max*f),px(padL-W*0.01),px(y));
  });
  ctx.setLineDash([]);
  const pts=values.map((v,i)=>({x:padL+(values.length>1?w*i/(values.length-1):w/2),y:padT+h*(1-v/max),label:labels[i],value:v}));
  ctx.beginPath();ctx.moveTo(pts[0].x,H-padB);
  pts.forEach(p=>ctx.lineTo(p.x,p.y));
  ctx.lineTo(pts[pts.length-1].x,H-padB);ctx.closePath();
  ctx.fillStyle=inkAlpha(0.1);ctx.fill();
  ctx.beginPath();ctx.moveTo(pts[0].x,pts[0].y);
  pts.forEach(p=>ctx.lineTo(p.x,p.y));
  ctx.strokeStyle=ink();ctx.lineWidth=2;ctx.stroke();
  pts.forEach(p=>{
    ctx.beginPath();ctx.arc(p.x,p.y,3,0,2*Math.PI);ctx.fillStyle=ink();ctx.fill();
    hits.push({label:p.label,value:p.value,x:p.x,y:p.y,r:8});
  });
  const step=Math.max(1,Math.ceil(labels.length/6));
  ctx.fillStyle=dim();ctx.font=px(H*0.06)+'px "IBM Plex Mono",monospace';ctx.textAlign='center';
  labels.forEach((l,i)=>{if(i%step===0)ctx.fillText(l.slice(5),pts[i].x,H-padB+H*0.09);});
  return hits;
}

// Tooltip engine
const tip=document.createElement('div');
tip.style.cssText='position:fixed;pointer-events:none;background:var(--ink);color:var(--page-bg);font:11px "IBM Plex Mono",monospace;padding:5px 10px;border-radius:3px;display:none;z-index:200;white-space:nowrap;letter-spacing:.04em;';
document.body.appendChild(tip);

function attachTooltip(canvas,getHits,type,kind){
  canvas.addEventListener('mousemove',e=>{
    const rect=canvas.getBoundingClientRect();
    const mx=(e.clientX-rect.left)*devicePixelRatio;
    const my=(e.clientY-rect.top)*devicePixelRatio;
    const hits=getHits();
    let found=null;
    if(type==='doughnut'){
      for(const h of hits){
        const dx=mx-h.cx,dy=my-h.cy;
        const dist=Math.sqrt(dx*dx+dy*dy);
        if(dist<h.r&&dist>h.ir){
          let a=Math.atan2(dy,dx);
          if(a<-Math.PI/2) a+=2*Math.PI;
          // normalize to start from -PI/2
          let sa=h.startAngle<-Math.PI/2?h.startAngle+2*Math.PI:h.startAngle;
          let ea=h.endAngle<-Math.PI/2?h.endAngle+2*Math.PI:h.endAngle;
          let na=a<-Math.PI/2?a+2*Math.PI:a;
          if(na>=sa&&na<=ea) found=h;
        }
      }
    } else if(type==='hbar'){
      for(const h of hits){
        if(mx>=h.x&&mx<=h.x+h.w+W*0.12&&my>=h.y-4&&my<=h.y+h.h+4) found=h;
      }
    } else if(type==='line'){
      let minD=Infinity;
      for(const h of hits){
        const d=Math.sqrt((mx-h.x)**2+(my-h.y)**2);
        if(d<h.r*3&&d<minD){minD=d;found=h;}
      }
    }
    if(found){
      const vStr=type==='hbar'?fmtV(found.value,kind,2):
                 type==='doughnut'?found.value+' ('+found.pct+'%)':
                 fmtV(found.value,kind);
      tip.textContent=found.label+': '+vStr+(found.note?'  |  '+found.note:'');
      tip.style.display='block';
      tip.style.left=(e.clientX+12)+'px';
      tip.style.top=(e.clientY-28)+'px';
      canvas.style.cursor='crosshair';
    } else {
      tip.style.display='none';
      canvas.style.cursor='default';
    }
  });
  canvas.addEventListener('mouseleave',()=>{tip.style.display='none';});
}

// Store chart data for expand
const CHART_DATA={};
// opts: { name: column heading, kind: 'usd' | undefined, extra: [{name, values, kind}] }
function store(id,type,labels,values,colors,color,opts){
  CHART_DATA[id]={type,labels,values,colors,color,opts:opts||{}};
}
function notesFor(d){
  const ex=(d.opts&&d.opts.extra)||[];
  return d.labels.map((l,i)=>ex.map(e=>fmtV(e.values[i]||0,e.kind)+' '+e.name.toLowerCase()).join(', '));
}
function withNotes(hits,d){const n=notesFor(d);hits.forEach((h,i)=>{h.note=n[i];});return hits;}

// Line pagination state
let _linePage=0, _linePageSize=92, _lineId=null;

function renderExpandLine(canvas,d,page){
  const labels=d.labels,values=d.values;
  const total=labels.length;
  const pages=Math.ceil(total/_linePageSize);
  const start=page*_linePageSize, end=Math.min(start+_linePageSize,total);
  const sliceL=labels.slice(start,end), sliceV=values.slice(start,end);
  const hits=line(canvas,sliceL,sliceV,null,d.opts.kind);
  const notes=notesFor(d).slice(start,end);hits.forEach((h,i)=>{h.note=notes[i];});
  attachTooltip(canvas,()=>hits,'line',d.opts.kind);

  // Pagination controls
  const pg=document.getElementById('expandPager');
  if(pages<=1){pg.innerHTML='';return;}
  let h='<span style="color:var(--dim);font-size:10px">'+
    sliceL[0].slice(0,10)+' → '+sliceL[sliceL.length-1].slice(0,10)+
    ' &nbsp;('+start+'–'+(end-1)+' of '+total+' days)</span> ';
  if(page>0) h+='<button onclick="MicroCharts.linePageGo('+(_linePage-1)+')">‹ PREV</button> ';
  h+='<span style="font-size:10px;color:var(--dim)">'+( page+1)+'/'+pages+'</span> ';
  if(page<pages-1) h+='<button onclick="MicroCharts.linePageGo('+(_linePage+1)+')">NEXT ›</button>';
  pg.innerHTML=h;
}

function renderExpandTable(d,page,pageSize){
  const tbody=document.getElementById('expandTable');
  const o=d.opts||{}, ex=o.extra||[];
  const total=d.values.reduce((a,b)=>a+b,0)||1;
  const isLine=d.type==='line';
  const from=isLine?page*pageSize:0, to=isLine?Math.min((page+1)*pageSize,d.labels.length):d.labels.length;
  const r='style="text-align:right"';
  document.getElementById('expandHead').innerHTML='<tr><th>'+(o.labelName||'LABEL')+'</th><th '+r+'>'+(o.name||'COUNT')+'</th>'+ex.map(e=>'<th '+r+'>'+e.name+'</th>').join('')+'<th '+r+'>%</th></tr>';
  let rows='';
  for(let i=from;i<to;i++){
    const v=d.values[i];
    const dot=d.colors?'<span style="display:inline-block;width:8px;height:8px;border-radius:50%;background:'+(d.colors[i]||'#888')+';margin-right:6px"></span>':'';
    rows+='<tr><td>'+dot+d.labels[i]+'</td><td '+r+'>'+fmtV(v,o.kind,2)+'</td>'+ex.map(e=>'<td '+r+'>'+fmtV(e.values[i]||0,e.kind,2)+'</td>').join('')+'<td style="text-align:right;color:var(--dim)">'+Math.round(v/total*100)+'%</td></tr>';
  }
  tbody.innerHTML=rows;
}

function emptyChart(canvas,msg){
  const ctx=canvas.getContext('2d');
  const W=canvas.width=canvas.offsetWidth*devicePixelRatio||400;
  const H=canvas.height=canvas.offsetHeight*devicePixelRatio||220;
  ctx.clearRect(0,0,W,H);
  ctx.fillStyle=dim();ctx.font=px(Math.max(11,H*0.06))+'px "IBM Plex Mono",monospace';
  ctx.textAlign='center';ctx.textBaseline='middle';
  ctx.fillText(msg,W/2,H/2);
}

G.MicroCharts={
  empty(canvas,msg){
    store(canvas.id,'hbar',[],[],null,null,{});
    emptyChart(canvas,msg);
  },
  doughnut(canvas,labels,values,colors,opts){
    store(canvas.id,'doughnut',labels,values,colors,null,opts);
    const hits=withNotes(doughnut(canvas,labels,values,colors),CHART_DATA[canvas.id]);
    attachTooltip(canvas,()=>hits,'doughnut');
    return hits;
  },
  hbar(canvas,labels,values,color,opts){
    store(canvas.id,'hbar',labels,values,null,color,opts);
    const d=CHART_DATA[canvas.id];
    const hits=withNotes(hbar(canvas,labels,values,color,null,d.opts.kind),d);
    attachTooltip(canvas,()=>hits,'hbar',d.opts.kind);
    return hits;
  },
  line(canvas,labels,values,opts){
    store(canvas.id,'line',labels,values,null,null,opts);
    const hits=withNotes(line(canvas,labels,values,null,CHART_DATA[canvas.id].opts.kind),CHART_DATA[canvas.id]);
    attachTooltip(canvas,()=>hits,'line',CHART_DATA[canvas.id].opts.kind);
    return hits;
  },
  linePageGo(page){
    _linePage=page;
    const canvas=document.getElementById('expandCanvas');
    const d=CHART_DATA[_lineId];
    renderExpandLine(canvas,d,page);
    renderExpandTable(d,page,_linePageSize);
  },
  expandModal(id,title){
    const d=CHART_DATA[id];if(!d)return;
    const canvas=document.getElementById('expandCanvas');
    document.getElementById('expandTitle').textContent=title.toUpperCase();
    document.getElementById('expandPager').innerHTML='';

    if(d.type==='line'){
      _lineId=id; _linePage=Math.max(0,Math.ceil(d.labels.length/_linePageSize)-1); // start at most recent
      requestAnimationFrame(()=>{
        renderExpandLine(canvas,d,_linePage);
        renderExpandTable(d,_linePage,_linePageSize);
      });
    } else {
      _lineId=null;
      requestAnimationFrame(()=>{
        let hits=[];
        if(d.type==='doughnut'){hits=withNotes(doughnut(canvas,d.labels,d.values,d.colors),d);attachTooltip(canvas,()=>hits,'doughnut');}
        else if(d.type==='hbar'){hits=withNotes(hbar(canvas,d.labels,d.values,d.color||ink(),null,d.opts.kind),d);attachTooltip(canvas,()=>hits,'hbar',d.opts.kind);}
        renderExpandTable(d,0,d.labels.length);
      });
    }
    document.getElementById('expandOverlay').classList.add('show');
  }
};
})(window);
`;

  const html = `<!doctype html>
<html lang="en" data-theme="paper">
<head>
<meta charset="utf-8" />
<title>Burner</title>
<script>(function(){var t=${served ? safeJson(theme) : 'null'};try{t=t||localStorage.getItem('burner-theme');}catch(e){}if(['paper','thermal','matrix','dark'].indexOf(t)<0)t='paper';document.documentElement.setAttribute('data-theme',t);})();</script>
${logoMarkUri ? `<link rel="icon" type="image/png" href="${logoMarkUri}" />` : ''}
<style>
${themeCss()}
${catOverrideCss}
*{box-sizing:border-box;}
body{margin:0;font-family:'IBM Plex Mono','Courier New',monospace;background:var(--page-bg);color:var(--ink);padding:24px 16px 60px;transition:background .15s,color .15s;}
.page-brand{position:fixed;top:20px;left:24px;height:56px;width:auto;z-index:6;}
.toolbar{max-width:860px;margin:0 auto 20px;display:flex;justify-content:flex-end;align-items:center;flex-wrap:wrap;padding-left:120px;gap:0;}
.toolbar-group{display:flex;flex-wrap:wrap;align-items:center;gap:12px;}
.toolbar-group+.toolbar-group{margin-left:22px;padding-left:22px;border-left:1px dashed var(--rule);}
.toolbar a.toolbar-link{display:inline-flex;text-decoration:none;}
button{font-family:inherit;font-size:11px;letter-spacing:.05em;border:1px solid var(--rule);background:transparent;color:var(--ink);padding:5px 11px;cursor:pointer;border-radius:3px;text-transform:uppercase;}
.toolbar button{padding:6px 14px;}
button.active,button:hover{background:var(--ink);color:var(--page-bg);}
input,select{font-family:inherit;font-size:11px;background:var(--bg);border:1px solid var(--rule);color:var(--ink);padding:5px 10px;border-radius:3px;}
.page{max-width:860px;margin:0 auto;}
.rule{border:none;border-top:1px dashed var(--rule);margin:12px 0;}
.solid{border:none;border-top:1px solid var(--rule);margin:12px 0;}
.card{background:var(--bg);padding:22px 26px 24px;box-shadow:0 6px 18px var(--shadow-lg);margin-bottom:18px;}
.card h2{text-align:center;font-size:17px;letter-spacing:.18em;margin-bottom:2px;}
.subtitle{text-align:center;font-size:11px;letter-spacing:.1em;font-weight:bold;}
.tagline{text-align:center;font-size:10px;color:var(--dim);font-style:italic;margin-bottom:10px;}
.meta-row{display:flex;justify-content:space-between;font-size:11px;line-height:1.7;}
.line{display:flex;justify-content:space-between;align-items:baseline;font-size:12px;line-height:1.8;gap:8px;}
.line .lbl{flex:1;}.line .lbl.i{padding-left:14px;color:var(--dim);font-size:11px;}
.line .val{font-weight:bold;text-align:right;}.line .dv{color:var(--dim);font-size:11px;text-align:right;}
.line.total .val{font-size:14px;}
.time-bar{background:var(--bg);padding:12px 18px;box-shadow:0 3px 10px var(--shadow);margin-bottom:18px;display:flex;gap:8px;flex-wrap:wrap;align-items:center;}
.time-bar span{font-size:10px;color:var(--dim);letter-spacing:.06em;}
.custom-range{display:none;gap:8px;align-items:center;font-size:11px;}
.custom-range.show{display:flex;}
.charts-grid{display:grid;grid-template-columns:1fr 1fr;gap:16px;margin-bottom:18px;}
@media(max-width:700px){.charts-grid{grid-template-columns:1fr;}}
.chart-card{background:var(--bg);padding:16px 18px 18px;box-shadow:0 3px 10px var(--shadow);position:relative;}
.chart-card-hdr{display:flex;justify-content:space-between;align-items:center;margin-bottom:10px;}
.chart-card-hdr h3{font-size:10px;letter-spacing:.12em;text-transform:uppercase;color:var(--dim);font-weight:bold;margin:0;}
.expand-btn{background:none;border:1px solid var(--rule);color:var(--dim);padding:2px 7px;font-size:10px;cursor:pointer;border-radius:2px;letter-spacing:.04em;}
.expand-btn:hover{background:var(--ink);color:var(--page-bg);border-color:var(--ink);}
.chart-wrap{position:relative;height:180px;}
.chart-wrap canvas{width:100%!important;height:100%!important;}
.sessions-card{background:var(--bg);padding:18px 22px 22px;box-shadow:0 3px 10px var(--shadow);margin-bottom:18px;}
.sessions-card h3{font-size:10px;letter-spacing:.12em;text-transform:uppercase;color:var(--dim);font-weight:bold;margin-bottom:4px;}
.filter-row{display:flex;gap:8px;flex-wrap:wrap;align-items:center;margin:10px 0 12px;}
.filter-row label{font-size:10px;color:var(--dim);}
.srow{display:flex;justify-content:space-between;align-items:center;font-size:11px;line-height:1;padding:9px 0;border-bottom:1px dashed var(--rule);cursor:pointer;gap:6px;text-decoration:none;color:inherit;}
.srow:hover{opacity:.7;background:rgba(0,0,0,.03);}
.srow .sd{color:var(--dim);min-width:76px;font-size:10px;flex-shrink:0;}
.srow .st{flex:2;white-space:nowrap;overflow:hidden;text-overflow:ellipsis;}
.srow .sp{color:var(--dim);font-size:10px;flex:1;white-space:nowrap;overflow:hidden;text-overflow:ellipsis;}
.srow .sc{min-width:88px;text-align:right;flex-shrink:0;}
.srow .stok{min-width:64px;text-align:right;color:var(--dim);font-size:10px;flex-shrink:0;}
.srow .scost{min-width:58px;text-align:right;font-weight:bold;flex-shrink:0;}
.dot{display:inline-block;width:7px;height:7px;border-radius:50%;margin-right:4px;}
.pager{display:flex;justify-content:center;gap:8px;margin-top:12px;font-size:11px;align-items:center;}
.pg-info{color:var(--dim);}
/* (session modal removed — row click opens receipt directly) */
/* Expand chart modal */
.expand-overlay{display:none;position:fixed;inset:0;background:rgba(0,0,0,.7);z-index:150;justify-content:center;align-items:center;padding:24px;}
.expand-overlay.show{display:flex;}
.expand-modal{background:var(--bg);width:min(860px,95vw);padding:22px 24px 24px;box-shadow:0 10px 40px rgba(0,0,0,.5);position:relative;max-height:90vh;overflow-y:auto;}
.expand-modal-x{position:absolute;top:12px;right:14px;background:none;border:none;font-size:18px;cursor:pointer;color:var(--dim);padding:0;}
#expandCanvas{width:100%!important;height:320px;}
.exp-table{width:100%;border-collapse:collapse;font-size:11px;margin-top:14px;}
.exp-table th{text-align:left;padding:6px 8px;border-bottom:1px solid var(--rule);color:var(--dim);font-weight:bold;letter-spacing:.05em;}
.exp-table td{padding:6px 8px;border-bottom:1px dashed var(--rule);}
/* Docs modal */
.docs-overlay{display:none;position:fixed;inset:0;background:rgba(0,0,0,.6);z-index:160;justify-content:center;align-items:center;padding:24px;}
.docs-overlay.show{display:flex;}
.docs-modal{background:var(--bg);width:min(700px,95vw);padding:26px 28px;box-shadow:0 10px 40px rgba(0,0,0,.5);position:relative;max-height:90vh;overflow-y:auto;}
.docs-modal-x{position:absolute;top:12px;right:14px;background:none;border:none;font-size:18px;cursor:pointer;color:var(--dim);padding:0;}
.docs-modal h2{font-size:15px;letter-spacing:.15em;margin-bottom:4px;text-align:center;}
.docs-modal h3{font-size:11px;letter-spacing:.1em;margin:14px 0 6px;text-transform:uppercase;color:var(--dim);}
.docs-modal p,.docs-modal li{font-size:11px;line-height:1.7;color:var(--ink);}
.docs-modal code{background:var(--page-bg);padding:1px 5px;border-radius:2px;font-size:10px;}
.docs-modal ul{padding-left:18px;}
/* Footer */
.footer-bar{max-width:860px;margin:18px auto 0;display:flex;justify-content:center;align-items:center;gap:14px;font-size:10px;color:var(--dim);flex-wrap:wrap;}
.footer-bar a{color:var(--dim);text-decoration:none;border-bottom:1px dashed var(--rule);}
.footer-bar a:hover{color:var(--ink);}
.footer-sep{color:var(--rule);}
/* Misc */
.toast{position:fixed;bottom:22px;left:50%;transform:translateX(-50%);background:var(--ink);color:var(--page-bg);padding:7px 14px;border-radius:3px;font-size:11px;letter-spacing:.05em;opacity:0;transition:opacity .2s;pointer-events:none;z-index:300;}
.toast.show{opacity:1;}
</style>
</head>
<body>
${logoTextUri ? `<img class="page-brand" src="${logoTextUri}" alt="Burner" />` : ''}
<div class="toolbar">
  <div class="toolbar-group">
    <button data-theme="paper">Paper</button>
    <button data-theme="thermal">Thermal</button>
    <button data-theme="matrix">Matrix</button>
    <button data-theme="dark">Dark</button>
  </div>
  <div class="toolbar-group">
    <button id="exportBtn">Export .txt</button>
    ${served ? '<a class="toolbar-link" href="/settings"><button type="button">Settings</button></a>' : ''}
  </div>
</div>
<div class="page">

<!-- Summary receipt -->
<div class="card">
  <h2>CLAUDE CODE</h2>
  <div class="subtitle">USAGE ANALYTICS REPORT</div>
  <div class="tagline">-- every token, every session, itemized --</div>
  <hr class="rule" />
  <div class="meta-row">
    <div>GENERATED: ${shortDate(generatedAt)}<br/>PRICING: ${pricingLbl}<br/>UNTAGGED: ${untaggedCount}</div>
    <div style="text-align:right">SESSIONS: ${totalSessions}<br/>PROJECTS: ${uniqueProjects.length}<br/>MODELS: ${uniqueModels.length}</div>
  </div>
  <hr class="rule" />
  <div id="sumBreakdown"></div>
  <div class="line"><span class="lbl i">PRICING${unpricedModels.length ? ' (' + unpricedModels.length + ' MODEL(S) AT $0)' : ''}</span><span class="val">${pricingLbl}</span></div>
  <hr class="rule" />
  <div class="line total"><span class="lbl">TOTAL SESSIONS</span><span class="val">${totalSessions}</span></div>
  <hr class="rule" />
  ${logoMarkUri ? `<img style="display:block;height:52px;width:auto;margin:14px auto 4px" src="${logoMarkUri}" alt="Burner" />` : ''}
  <div class="fn" style="letter-spacing:.15em;text-align:center;width:100%">~ B U R N E R ~</div>
</div>

<!-- Time filter -->
<div class="time-bar">
  <span>RANGE:</span>
  <button class="tbtn active" data-r="all">ALL TIME</button>
  <button class="tbtn" data-r="7">7 DAYS</button>
  <button class="tbtn" data-r="30">30 DAYS</button>
  <button class="tbtn" data-r="90">3 MONTHS</button>
  <button class="tbtn" data-r="custom">CUSTOM</button>
  <div class="custom-range" id="customRange">
    FROM <input type="date" id="fromDate" /> TO <input type="date" id="toDate" />
    <button id="applyCustom">APPLY</button>
  </div>
</div>

<!-- Charts -->
<div class="charts-grid">
  <div class="chart-card">
    <div class="chart-card-hdr"><h3>Sessions by Category</h3><button class="expand-btn" data-id="catChart" data-title="Sessions by Category">⤢ EXPAND</button></div>
    <div class="chart-wrap"><canvas id="catChart"></canvas></div>
  </div>
  <div class="chart-card">
    <div class="chart-card-hdr"><h3>Tokens by Model</h3><button class="expand-btn" data-id="modelChart" data-title="Tokens by Model">⤢ EXPAND</button></div>
    <div class="chart-wrap"><canvas id="modelChart"></canvas></div>
  </div>
  <div class="chart-card">
    <div class="chart-card-hdr"><h3>Cost by Project</h3><button class="expand-btn" data-id="projChart" data-title="Cost by Project">⤢ EXPAND</button></div>
    <div class="chart-wrap"><canvas id="projChart"></canvas></div>
  </div>
  <div class="chart-card">
    <div class="chart-card-hdr"><h3>Cost Over Time</h3><button class="expand-btn" data-id="timeChart" data-title="Cost Over Time">⤢ EXPAND</button></div>
    <div class="chart-wrap"><canvas id="timeChart"></canvas></div>
  </div>
</div>

<!-- Sessions -->
<div class="sessions-card">
  <h3>ALL SESSIONS</h3>
  <div class="filter-row">
    <label>SEARCH <input type="text" id="search" placeholder="title / project…" style="width:170px" /></label>
    <label>CATEGORY <select id="catFilter"><option value="">ALL</option>${categories.map(c => `<option value="${esc(c.id)}">${esc(c.label)}</option>`).join('')}</select></label>
    <label>SORT <select id="sortBy"><option value="date">DATE</option><option value="tokens">TOKENS</option><option value="cost">COST</option><option value="duration">DURATION</option></select></label>
  </div>
  <hr class="solid" />
  <div id="sessionList"></div>
  <div class="pager" id="pager"></div>
</div>

</div><!-- .page -->

<!-- Footer -->
<div class="footer-bar">
  <span>not official billing</span><span class="footer-sep">·</span>
  <span>unpriced models count as $0</span><span class="footer-sep">·</span>
  ${served ? '<a href="/settings#pricing">set prices</a><span class="footer-sep">·</span><a href="/settings#tagging">tagging</a><span class="footer-sep">·</span>' : ''}
  <a href="#" id="docsLink">how to use ↗</a>
</div>

<div class="toast" id="toast"></div>

<!-- Chart expand modal -->
<div class="expand-overlay" id="expandOverlay">
  <div class="expand-modal">
    <button class="expand-modal-x" id="expandClose">✕</button>
    <div style="font-size:11px;letter-spacing:.12em;text-transform:uppercase;color:var(--dim);font-weight:bold;margin-bottom:12px" id="expandTitle"></div>
    <canvas id="expandCanvas" style="height:300px"></canvas>
    <div id="expandPager" style="display:flex;justify-content:center;gap:8px;align-items:center;margin:10px 0;font-size:11px;flex-wrap:wrap;"></div>
    <table class="exp-table">
      <thead id="expandHead"></thead>
      <tbody id="expandTable"></tbody>
    </table>
  </div>
</div>

<!-- Docs modal -->
<div class="docs-overlay" id="docsOverlay">
  <div class="docs-modal">
    <button class="docs-modal-x" id="docsClose">✕</button>
    <h2>HOW TO USE</h2>
    <hr class="rule" />
    <h3>Commands</h3>
    <ul>
      <li><code>burner</code> — open the web app (report + Settings) on 127.0.0.1:4777</li>
      <li><code>burner report</code> — write this report as a static file</li>
      <li><code>burner list</code> — terminal table</li>
      <li><code>burner tag &lt;category&gt;</code> — tag the current session (what <code>/burner-tag</code> runs)</li>
      <li><code>burner install</code> — install <code>/burner-tag</code> globally and apply the tagging level</li>
      <li><code>burner pricing refresh</code> — fetch fresh public prices</li>
      <li><code>--project</code>, <code>--from</code>, <code>--to</code>, <code>--json</code> filters</li>
    </ul>
    <hr class="rule" />
    <h3>Tokens</h3>
    <p>Claude Code logs one API response as several transcript lines (one per streamed content block) with growing <code>output_tokens</code>. Burner keeps only the final line per request ID, and drops requests a continued session re-logs from its parent. Totals include all four billed buckets: fresh input, cache write, cache read, output. Subagent transcripts are billed to their parent session.</p>
    <h3>Categories</h3>
    <p>A session's category comes from, in order: a tag (<code>/burner-tag</code>, the report UI, session-end model hook, or CLI), its project's default category, then the <strong>learned model</strong> if trained and confident (≥60%). Otherwise it stays <em>untagged</em>.</p>
    <p><strong>Learned model</strong> — optional on-device classifier (multinomial naive Bayes) trained on your tagged sessions; guesses only when nothing else applied. <strong>/burner-tag skill</strong> — global skill under <code>~/.claude/skills/burner-tag</code>; run <code>burner install</code> (Settings → Tagging has copy blocks). <strong>Session end</strong> — with a model id on Settings, a SessionEnd hook asks that Anthropic model what the session was for; without a model id, the main agent tags via the skill before wrapping up.</p>
    <p>Token totals follow the same idea as <a href="https://ccusage.com/guide/cost-modes" target="_blank" rel="noopener">ccusage</a>: one row per <code>requestId</code> (last streamed chunk), 5m/1h cache write split when present, global dedup for continued sessions. Burner always calculates from tokens (like ccusage <code>--mode calculate</code>); Claude Code's <code>cost-state</code> line is shown on the receipt for comparison when available.</p>
    <h3>Projects</h3>
    <p>A project groups one or more directories. Every session is matched by the directory Claude Code ran in (longest match wins). Directories not in any project show up under their folder name.</p>
    <h3>Pricing</h3>
    <p>Claude models are priced from LiteLLM's public price list (refreshed daily, bundled snapshot when offline). Any other model — gateways, on-prem, local — is $0 until you set a price on Settings → Pricing.</p>
    <hr class="rule" />
    <div class="fn">files live in ~/.burner · not official billing</div>
  </div>
</div>


<script>${MICRO_CHARTS}</script>
<script>
let ALL  = ${safeJson(reportSessions)};
const CC   = ${safeJson(CAT_COLORS)};
const CL   = ${safeJson(CAT_LABELS)};
const SERVED = ${served};
const RANGE0 = ${served ? safeJson(range) : 'null'};
const PS   = 20;

let filtered=[], curPage=1, activeRange='all', customFrom=null, customTo=null;

function fT(n){if(!n)return'0';if(n>=1e6)return(n/1e6).toFixed(2)+'M';if(n>=1e3)return(n/1e3).toFixed(1)+'K';return String(n);}
function fC(n){return(!n)?'$0':'$'+n.toFixed(n<0.01?4:2);}
function toast(m){const t=document.getElementById('toast');t.textContent=m;t.classList.add('show');setTimeout(()=>t.classList.remove('show'),1800);}
function esc(s){return String(s??'').replace(/[&<>"']/g,c=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]));}
function catOf(s){return s.category;}
function catLabel(id){return CL[id]||id;}
function receiptUrl(id){return SERVED?'/receipt/'+id:'receipt-'+id.slice(0,8)+'.html';}

function inRange(s){
  if(activeRange==='all') return true;
  if(activeRange==='custom') return (!customFrom||s.mtime>=customFrom)&&(!customTo||s.mtime<=customTo+86400000);
  return s.mtime>=Date.now()-Number(activeRange)*86400000;
}

document.querySelectorAll('.tbtn').forEach(b=>b.addEventListener('click',()=>{
  document.querySelectorAll('.tbtn').forEach(x=>x.classList.remove('active'));
  b.classList.add('active'); activeRange=b.dataset.r; saveRange();
  document.getElementById('customRange').classList.toggle('show',activeRange==='custom');
  rebuild();
}));
document.getElementById('applyCustom').addEventListener('click',()=>{
  const f=document.getElementById('fromDate').value,t=document.getElementById('toDate').value;
  customFrom=f?new Date(f).getTime():null; customTo=t?new Date(t).getTime():null; saveRange(); rebuild();
});

// The chosen range is remembered (server config when served, else this browser).
function saveRange(){
  const body={range:activeRange,from:document.getElementById('fromDate').value||'',to:document.getElementById('toDate').value||''};
  try{localStorage.setItem('burner-range',JSON.stringify(body));}catch(e){}
  if(SERVED)fetch('/api/range',{method:'PUT',headers:{'Content-Type':'application/json'},body:JSON.stringify(body)}).catch(()=>{});
}
function restoreRange(){
  let r=RANGE0;
  if(!r){try{r=JSON.parse(localStorage.getItem('burner-range')||'null');}catch(e){}}
  if(!r||!['all','7','30','90','custom'].includes(String(r.range)))return;
  activeRange=String(r.range);
  document.querySelectorAll('.tbtn').forEach(x=>x.classList.toggle('active',x.dataset.r===activeRange));
  if(r.from)document.getElementById('fromDate').value=r.from;
  if(r.to)document.getElementById('toDate').value=r.to;
  if(activeRange==='custom'){
    customFrom=r.from?new Date(r.from).getTime():null; customTo=r.to?new Date(r.to).getTime():null;
    document.getElementById('customRange').classList.add('show');
  }
}

function getInk(){return getComputedStyle(document.documentElement).getPropertyValue('--ink').trim()||'#2b2b26';}
function cssVar(n){return getComputedStyle(document.documentElement).getPropertyValue(n).trim();}
function catCol(id){return cssVar('--cat-'+id)||CC[id]||'#888';}

function drawCharts(sessions){
  cancelAnimationFrame(window._rafId);
  window._rafId=requestAnimationFrame(()=>{
    const inkColor=getInk();
    if(!sessions.length){
      ['catChart','modelChart','projChart','timeChart'].forEach(id=>MicroCharts.empty(document.getElementById(id),'no sessions in this range'));
      return;
    }

    const cost=s=>(s.totalCost&&s.totalCost.total)||0;

    // Split sessions contribute to each category by their share of cost.
    const byCat={}, byCatCost={};
    sessions.forEach(s=>{
      if(s.categorySplit&&s.categorySplit.length>1){
        const tot=s.categorySplit.reduce((a,x)=>a+(x.cost||x.tokens),0)||1;
        s.categorySplit.forEach(x=>{byCat[x.category]=(byCat[x.category]||0)+(x.cost||x.tokens)/tot;byCatCost[x.category]=(byCatCost[x.category]||0)+(x.cost||0);});
      } else {const c=catOf(s);byCat[c]=(byCat[c]||0)+1;byCatCost[c]=(byCatCost[c]||0)+cost(s);}
    });
    const catE=Object.entries(byCat).map(([k,v])=>[k,Math.round(v*10)/10]).sort((a,b)=>b[1]-a[1]);
    MicroCharts.doughnut(document.getElementById('catChart'),catE.map(([k])=>catLabel(k)),catE.map(([,v])=>v),catE.map(([k])=>catCol(k)),
      {name:'SESSIONS',extra:[{name:'COST',kind:'usd',values:catE.map(([k])=>byCatCost[k]||0)}]});

    const byM={}, byMCost={};
    sessions.forEach(s=>s.models.forEach(m=>{const t=m.tokens;byM[m.rawModel]=(byM[m.rawModel]||0)+t.input+t.output+t.cacheWrite5m+t.cacheWrite1h+t.cacheRead;byMCost[m.rawModel]=(byMCost[m.rawModel]||0)+((m.cost&&m.cost.total)||0);}));
    const mE=Object.entries(byM).sort((a,b)=>b[1]-a[1]).slice(0,7);
    MicroCharts.hbar(document.getElementById('modelChart'),mE.map(([k])=>k),mE.map(([,v])=>v),cssVar('--chart-bar-alt')||inkColor,
      {name:'TOKENS',extra:[{name:'COST',kind:'usd',values:mE.map(([k])=>byMCost[k]||0)}]});

    // Projects are ranked by what they cost, not by how many sessions they had.
    const byP={}, byPN={};
    sessions.forEach(s=>{byP[s.project]=(byP[s.project]||0)+cost(s);byPN[s.project]=(byPN[s.project]||0)+1;});
    const pE=Object.entries(byP).sort((a,b)=>b[1]-a[1]);
    MicroCharts.hbar(document.getElementById('projChart'),pE.map(([k])=>k),pE.map(([,v])=>v),cssVar('--chart-bar')||inkColor,
      {name:'COST',kind:'usd',extra:[{name:'SESSIONS',values:pE.map(([k])=>byPN[k])}]});

    // Spend per day from each session's own turns, so a long session lands
    // on the days it actually ran, and only days inside the chosen range count.
    const DAY=86400000;
    const dayStr=t=>new Date(t).toISOString().slice(0,10);
    let lo=null, hi=Date.now();
    if(activeRange==='custom'){ lo=customFrom; if(customTo) hi=customTo; }
    else if(activeRange!=='all'){ lo=Date.now()-Number(activeRange)*DAY; }
    const loS=lo==null?null:dayStr(lo), hiS=dayStr(hi);
    const byD={}, byDCost={}, byDS={};
    sessions.forEach(s=>(s.daily||[]).forEach(d=>{
      if((loS&&d.date<loS)||d.date>hiS) return;
      byDCost[d.date]=(byDCost[d.date]||0)+d.cost;
      byDS[d.date]=(byDS[d.date]||0)+1;
    }));
    let dates=Object.keys(byDCost).sort();
    // Bounded ranges get every day (zeros included) so the shape is honest.
    if(loS&&(hi-lo)/DAY<=120){
      dates=[];
      for(let t=Date.parse(loS+'T00:00:00Z');dayStr(t)<=hiS;t+=DAY) dates.push(dayStr(t));
    }
    MicroCharts.line(document.getElementById('timeChart'),dates,dates.map(d=>byDCost[d]||0),
      {name:'COST',kind:'usd',labelName:'DATE',extra:[{name:'SESSIONS',values:dates.map(d=>byDS[d]||0)}]});
  });
}

document.querySelectorAll('.expand-btn').forEach(b=>{
  b.addEventListener('click',()=>MicroCharts.expandModal(b.dataset.id, b.dataset.title));
});
document.getElementById('expandClose').addEventListener('click',()=>document.getElementById('expandOverlay').classList.remove('show'));
document.getElementById('expandOverlay').addEventListener('click',e=>{if(e.target.id==='expandOverlay')document.getElementById('expandOverlay').classList.remove('show');});

function applyFilters(sessions){
  const q=document.getElementById('search').value.toLowerCase();
  const cat=document.getElementById('catFilter').value;
  const sort=document.getElementById('sortBy').value;
  let rows=sessions.map(s=>({...s,_cat:catOf(s)}));
  if(q) rows=rows.filter(s=>(s.title+' '+s.project+' '+catLabel(s._cat)).toLowerCase().includes(q));
  if(cat) rows=rows.filter(s=>s._cat===cat||(s.categorySplit||[]).some(x=>x.category===cat));
  rows.sort((a,b)=>{
    if(sort==='tokens') return b.totalTokens.total-a.totalTokens.total;
    if(sort==='cost')   return b.totalCost.total-a.totalCost.total;
    if(sort==='duration') return (b.durationMin||0)-(a.durationMin||0);
    return b.mtime-a.mtime;
  });
  return rows;
}

function renderList(sessions){filtered=applyFilters(sessions);curPage=1;renderPage();}

function renderPage(){
  const total=filtered.length,pages=Math.ceil(total/PS);
  const sl=filtered.slice((curPage-1)*PS,curPage*PS);
  document.getElementById('sessionList').innerHTML=sl.map(s=>{
    const cat=catOf(s),col=catCol(cat);
    const hint=s.categorySource==='learned'?'?':(s.categorySplit&&s.categorySplit.length>1?'+':'');
    return '<div class="srow" data-id="'+esc(s.sessionId)+'">'
      +'<span class="sd">'+esc(s.date)+'</span>'
      +'<span class="st" title="'+esc(s.title)+'">'+esc(s.title)+'</span>'
      +'<span class="sp" title="'+esc(s.cwd||s.project)+'">'+esc(s.project)+'</span>'
      +'<span class="sc" title="'+esc(s.categorySource)+'"><span class="dot" style="background:'+col+'"></span>'+esc(catLabel(cat))+hint+'</span>'
      +'<span class="stok">'+fT(s.totalTokens.total)+'</span>'
      +'<span class="scost">'+fC(s.totalCost.total)+(s.hasUnpriced?'*':'')+'</span>'
      +'</div>';
  }).join('')||'<div style="font-size:11px;color:var(--dim);padding:10px 0">no sessions match</div>';

  const pg=document.getElementById('pager');
  document.querySelectorAll('.srow').forEach(r=>r.addEventListener('click',()=>{const u=receiptUrl(r.dataset.id);if(SERVED)location.href=u;else window.open(u,'_blank');}));
  if(pages<=1){pg.innerHTML='';return;}
  let h='<span class="pg-info">'+curPage+' / '+pages+' ('+total+')</span> ';
  if(curPage>1) h+='<button onclick="gp('+(curPage-1)+')">&lt;</button> ';
  const s2=Math.max(1,curPage-2),e=Math.min(pages,curPage+2);
  for(let i=s2;i<=e;i++) h+='<button onclick="gp('+i+')" class="'+(i===curPage?'active':'')+'">'+i+'</button> ';
  if(curPage<pages) h+='<button onclick="gp('+(curPage+1)+')">&gt;</button>';
  pg.innerHTML=h;
}
window.gp=function(n){curPage=n;renderPage();document.querySelector('.sessions-card').scrollIntoView({behavior:'smooth',block:'start'});};

document.getElementById('docsLink').addEventListener('click',e=>{e.preventDefault();document.getElementById('docsOverlay').classList.add('show');});
document.getElementById('docsClose').addEventListener('click',()=>document.getElementById('docsOverlay').classList.remove('show'));
document.getElementById('docsOverlay').addEventListener('click',e=>{if(e.target.id==='docsOverlay')document.getElementById('docsOverlay').classList.remove('show');});

document.getElementById('exportBtn').addEventListener('click',()=>{
  const sess=ALL.filter(inRange);
  const lines=['CLAUDE CODE USAGE REPORT','Generated: '+new Date('${generatedAt}').toLocaleString(),'='.repeat(80),''];
  lines.push('SUMMARY');
  lines.push('  Sessions : '+sess.length);
  lines.push('  Tokens   : '+sess.reduce((s,r)=>s+r.totalTokens.total,0).toLocaleString());
  lines.push('  Cost     : $'+sess.reduce((s,r)=>s+r.totalCost.total,0).toFixed(4)+' (unpriced models at $0)');
  lines.push('');
  lines.push('SESSIONS');
  lines.push(['DATE','TITLE','PROJECT','CATEGORY','TOKENS','COST','DUR'].map(h=>h.padEnd(16)).join('  '));
  lines.push('-'.repeat(120));
  sess.forEach(s=>{
    lines.push([
      s.date.padEnd(16),
      s.title.slice(0,16).padEnd(16),
      s.project.slice(0,16).padEnd(16),
      catLabel(catOf(s)).slice(0,16).padEnd(16),
      fT(s.totalTokens.total).padEnd(16),
      fC(s.totalCost.total).padEnd(16),
      (s.durationMin!=null?s.durationMin+'m':'-').padEnd(16),
    ].join('  '));
  });
  lines.push('');lines.push('~ burner ~');
  const blob=new Blob([lines.join('\\n')],{type:'text/plain'});
  const a=document.createElement('a');
  a.href=URL.createObjectURL(blob);
  a.download='burner-'+new Date().toISOString().slice(0,10)+'.txt';
  a.click();toast('exported .txt');
});

function setTheme(t,persist=true){
  document.documentElement.setAttribute('data-theme',t);
  try{localStorage.setItem('burner-theme',t);}catch(e){}
  if(persist&&SERVED)fetch('/api/theme',{method:'PUT',headers:{'Content-Type':'application/json'},body:JSON.stringify({theme:t})}).catch(()=>{});
  document.querySelectorAll('button[data-theme]').forEach(b=>b.classList.toggle('active',b.dataset.theme===t));
  rebuild();
}
document.querySelectorAll('button[data-theme]').forEach(b=>b.addEventListener('click',()=>setTheme(b.dataset.theme)));

document.getElementById('search').addEventListener('input',()=>rebuild());
document.getElementById('catFilter').addEventListener('change',()=>rebuild());
document.getElementById('sortBy').addEventListener('change',()=>rebuild());

function renderSummary(sess){
  const z=()=>({input:0,cacheWrite:0,cacheRead:0,output:0,total:0});
  const t=z(),c=z();
  sess.forEach(s=>{for(const k of ['input','cacheWrite','cacheRead','output','total']){t[k]+=s.totalTokens[k]||0;c[k]+=s.totalCost[k]||0;}});
  const pct=k=>c.total>0?Math.round(c[k]/c.total*100)+'%':'';
  const row=(lbl,k,cls)=>'<div class="line'+(cls||'')+'"><span class="lbl'+(cls?'':' i')+'">'+lbl+'</span><span class="dv">'+(pct(k)?pct(k)+' of cost':'')+'</span><span class="val" style="min-width:84px">'+fT(t[k])+' tok</span><span class="val" style="min-width:72px">'+fC(c[k])+'</span></div>';
  const prompt=t.input+t.cacheWrite+t.cacheRead;
  document.getElementById('sumBreakdown').innerHTML=
    row('INPUT (fresh, uncached)','input')+row('CACHE WRITE','cacheWrite')+row('CACHE READ (reused)','cacheRead')+row('OUTPUT','output')
    +'<hr class="rule" />'+row('TOTAL','total',' total')
    +'<div class="line"><span class="lbl i">CACHE HIT RATE</span><span class="val">'+(prompt?Math.round(t.cacheRead/prompt*100):0)+'%</span></div>';
}
function rebuild(){const sess=ALL.filter(inRange);renderSummary(sess);drawCharts(sess);renderList(sess);}

window.addEventListener('resize',()=>drawCharts(ALL.filter(inRange)));

// Coming back to this tab (browser Back, switching windows) must show tags and
// project moves made elsewhere, without a manual refresh.
let _lastSync=Date.now();
async function syncData(force){
  if(!SERVED||(!force&&Date.now()-_lastSync<1500))return;
  _lastSync=Date.now();
  try{
    const res=await fetch('/api/sessions',{cache:'no-store'});
    if(!res.ok)return;
    ALL=(await res.json()).map(({activity,attribution,subagentGroups,subagentRuns,agents,...s})=>s);
    rebuild();
  }catch(e){}
}
window.addEventListener('pageshow',e=>{if(e.persisted)syncData(true);});
document.addEventListener('visibilitychange',()=>{if(document.visibilityState==='visible')syncData(false);});
window.addEventListener('focus',()=>syncData(false));

restoreRange();
setTheme(document.documentElement.getAttribute('data-theme'),false);
rebuild();
</script>
</body>
</html>`;

  return html;
}
