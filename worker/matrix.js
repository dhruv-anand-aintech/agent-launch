import matrix from "../docs/tools/agent_matrix/bundle.json";
import llmsTxt from "../docs/tools/agent_matrix/llms.txt";
import schema from "../docs/tools/agent_matrix/schema.json";

const columns = Object.entries(schema.properties)
  .filter(([key]) => !["links", "notes"].includes(key))
  .map(([key, value]) => {
    const parts = (value.$comment || "").split("|").map(p => p.trim());
    return { key, group: parts[0] || "Other", label: parts[1] || key, description: parts[2] || "" };
  });

const groups = [...new Set(columns.map(c => c.group))];

function htmlEscape(v) { return String(v ?? "").replaceAll("&","&amp;").replaceAll("<","&lt;").replaceAll(">","&gt;").replaceAll('"',"&quot;"); }

function agentDomain(agent) {
  const u = agent.links.website || agent.links.docs || "";
  try { return new URL(u).hostname.replace(/^www\./, ""); } catch { return ""; }
}

function faviconUrl(agent) {
  const d = agentDomain(agent);
  return d ? `https://www.google.com/s2/favicons?domain=${encodeURIComponent(d)}&sz=16` : "";
}

function metaTags() {
  const desc = "Compare 17 coding agents, AI coding CLIs, and IDEs across 17 features. Each cell sourced from official docs.";
  return `
    <meta name="description" content="${htmlEscape(desc)}">
    <meta name="robots" content="index, follow">
    <link rel="canonical" href="https://compare.ainorthstar.tech">
    <meta property="og:title" content="Coding Agent Feature Matrix">
    <meta name="twitter:card" content="summary_large_image">
    <meta name="twitter:title" content="Coding Agent Feature Matrix">`;
}

function render() {
  const payload = JSON.stringify({ matrix, columns, groups }).replaceAll("</", "<\\/");
  return `<!doctype html>
<html lang="en">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<title>Coding Agent Feature Matrix</title>
${metaTags()}
<style>
:root {
  color-scheme: light; --bg: #f6f4ee; --panel: #fffdf8; --ink: #17130d; --muted: #766f63;
  --line: #ded7c9; --line-strong: #bdb3a2; --accent: #176b5b; --warn: #a35f00; --none: #9a3c32; --unknown: #8a8173;
  font-family: Inter, ui-sans-serif, system-ui, -apple-system, BlinkMacSystemFont, "Segoe UI", sans-serif;
}
* { box-sizing: border-box; }
body { margin: 0; background: var(--bg); color: var(--ink); }
a { color: inherit; text-decoration: none; }
.topbar {
  height: 44px; display: flex; align-items: center; justify-content: space-between;
  padding: 0 14px; border-bottom: 1px solid var(--line); background: rgba(255,253,248,.92);
  position: sticky; top: 0; z-index: 30; backdrop-filter: blur(10px);
}
.brand { display: flex; gap: 6px; align-items: center; font-weight: 700; font-size: 13px; }
.mark { width: 20px; height: 20px; border: 1px solid var(--ink); display: grid; place-items: center; font-size: 10px; }
.topnav { display: flex; gap: 8px; align-items: center; }
.gh-btn {
  display: inline-flex; align-items: center; gap: 4px; border: 1px solid var(--line);
  background: #fff; padding: 3px 8px; font-size: 12px; color: var(--ink); white-space: nowrap;
}
.gh-btn:hover { background: #f0eeeb; }
.hero { padding: 10px 14px 8px; border-bottom: 1px solid var(--line); background: var(--panel); }
.hero p { margin: 0; color: var(--muted); font-size: 12px; }
.meta-row { margin-top: 6px; display: flex; gap: 6px; flex-wrap: wrap; }
.pill { border: 1px solid var(--line); padding: 3px 7px; background: #fff; font-size: 11px; color: var(--muted); }
.table-wrap { overflow: auto; height: calc(100vh - 44px); position: relative; }
table { border-collapse: separate; border-spacing: 0; background: var(--panel); }
thead { position: sticky; top: 0; z-index: 20; }
th {
  background: #eee7d8; color: #2a241b; font-weight: 700; font-size: 10px;
  border-right: 1px solid var(--line); border-bottom: 1px solid var(--line-strong);
  padding: 0; vertical-align: middle; text-align: center; position: relative;
  user-select: none;
}
th.corner { position: sticky; left: 0; z-index: 25; background: #e8decc; min-width: 100px; }
th.agent-col {
  min-width: 44px; max-width: 44px; height: 44px; cursor: pointer;
  transition: opacity .15s;
}
th.agent-col.dragging { opacity: .4; }
th.agent-col.drag-over { background: #d5cdbb; }
th.agent-col.hidden-col { opacity: .25; }
.row-label.dragging { opacity: .4; }
.row-label.drag-over { outline: 2px dashed var(--accent); outline-offset: -2px; }
th.agent-col .fav { width: 32px; height: 32px; vertical-align: middle; border-radius: 6px; }
th.agent-col .agent-full { display: none; position: absolute; left: 50%; transform: translateX(-50%);
  top: calc(100% + 2px); background: #2a241b; color: #f6f4ee; font-size: 10px; padding: 2px 6px;
  border-radius: 3px; white-space: nowrap; z-index: 30; pointer-events: none; }
th.agent-col:hover .agent-full { display: block; }
th.agent-col .eye {
  position: absolute; top: 1px; right: 2px; font-size: 9px; color: var(--muted); opacity: .5; pointer-events: none;
}
th.agent-col.hidden-col .eye { opacity: 1; color: var(--none); }
tbody td { padding: 3px 4px; font-size: 11px; text-align: center; vertical-align: middle;
  border-right: 1px solid var(--line); border-bottom: 1px solid var(--line); }
td.cell-wrap { position: relative; cursor: default; }
td.cell-wrap:hover { outline: 1.5px solid var(--line-strong); outline-offset: -1px; }
td.cell-wrap a { display: block; color: inherit; }
td.cell-wrap .dot {
  display: inline-flex; align-items: center; justify-content: center;
  width: 16px; height: 16px; border-radius: 50%; color: #fff; font-size: 9px; line-height: 1;
}
.full .dot { background: var(--accent); }
.partial .dot { background: var(--warn); }
.none .dot { background: var(--none); }
.unknown .dot { background: var(--unknown); }
.row-label {
  position: sticky; left: 0; z-index: 5; background: var(--panel);
  text-align: left; font-size: 11px; font-weight: 600; padding: 3px 6px !important;
  min-width: 100px; max-width: 100px; white-space: nowrap; overflow: hidden; text-overflow: ellipsis;
  cursor: pointer; user-select: none;
}
.row-label .arrow { font-size: 8px; margin-right: 3px; color: var(--muted); }
.row-label.filter-active { color: var(--accent); }
.row-label.filter-active .arrow { color: var(--accent); }
.group-head td {
  background: #e2d8c5; font-size: 9px; text-transform: uppercase; letter-spacing: .03em;
  color: var(--muted); padding: 2px 4px !important; font-weight: 600;
}
.group-head td:first-child { position: sticky; left: 0; z-index: 6; background: #e2d8c5; }
.cell-tip {
  display: none; position: absolute; bottom: calc(100% + 4px); left: 50%; transform: translateX(-50%);
  background: #2a241b; color: #f6f4ee; font-size: 10px; line-height: 1.3; padding: 3px 6px;
  border-radius: 3px; z-index: 50; pointer-events: none; max-width: 260px; white-space: normal;
  outline: 1px solid #555; text-align: left; font-weight: 400;
}
.cell-wrap:hover .cell-tip { display: block; }
td.value { font-size: 10px; color: var(--muted); }
.form-tags { display: flex; flex-wrap: wrap; gap: 1px; justify-content: center; }
.form-tag { border: 1px solid var(--line); background: #fff; padding: 1px 2px; font-size: 8px; }
.tri {
  position: absolute; top: 0; right: 0; width: 14px; height: 14px;
  cursor: pointer; z-index: 2;
}
.tri::after {
  content: ""; position: absolute; top: 0; right: 0; width: 0; height: 0;
  border-style: solid; border-width: 0 6px 6px 0;
  border-color: transparent var(--line-strong) transparent transparent;
  opacity: .35; pointer-events: none;
}
.cell-wrap:hover .tri::after { opacity: 1; }
.hidden { display: none; }
</style>
</head>
<body>
<header class="topbar">
  <a class="brand" href="/"><span class="mark">AL</span><span>Coding Agent Feature Matrix</span></a>
  <nav class="topnav">
    <a href="https://github.com/dhruv-anand-aintech/agent-launch" class="gh-btn" target="_blank" rel="noreferrer">
      <svg width="13" height="13" viewBox="0 0 16 16" fill="currentColor"><path fill-rule="evenodd" d="M8 0C3.58 0 0 3.58 0 8c0 3.54 2.29 6.53 5.47 7.59.4.07.55-.17.55-.38 0-.19-.01-.82-.01-1.49-2.01.37-2.53-.49-2.69-.94-.09-.23-.48-.94-.82-1.13-.28-.15-.68-.52-.01-.53.63-.01 1.08.58 1.23.82.72 1.21 1.87.87 2.33.66.07-.52.28-.87.51-1.07-1.78-.2-3.64-.89-3.64-3.95 0-.87.31-1.59.82-2.15-.08-.2-.36-1.02.08-2.12 0 0 .67-.21 2.2.82.64-.18 1.32-.27 2-.27.68 0 1.36.09 2 .27 1.53-1.04 2.2-.82 2.2-.82.44 1.1.16 1.92.08 2.12.51.56.82 1.27.82 2.15 0 3.07-1.87 3.75-3.65 3.95.29.25.54.73.54 1.48 0 1.07-.01 1.93-.01 2.2 0 .21.15.46.55.38A8.013 8.013 0 0016 8c0-4.42-3.58-8-8-8z"/></svg>
      Star
    </a>
  </nav>
</header>
<section class="hero">
  <p>Compare ${htmlEscape(matrix.length)} AI coding agents across 17 features. Hover a column for agent name, drag to reorder, click to toggle visibility.</p>
  <div class="meta-row">
    <span class="pill">${htmlEscape(matrix.length)} agents</span>
    <span class="pill">Updated ${new Date().toISOString().slice(0, 10)}</span>
  </div>
</section>
<div class="table-wrap">
<table>
<thead><tr id="headerRow"></tr></thead>
<tbody id="tbody"></tbody>
</table>
</div>
<script type="application/json" id="payload">${payload}</script>
<script>
function agentDomain(agent) {
  var u = agent.links.website || agent.links.docs || "";
  try { return new URL(u).hostname.replace(/^www\\./, ""); } catch(e) { return ""; }
}
const { matrix, columns, groups } = JSON.parse(document.getElementById('payload').textContent);
const metaCols = new Set(['name','form_factor','released_in','latest_major_update','pricing','notes']);
const featureCols = columns.filter(c => !metaCols.has(c.key));
const aboutCols = columns.filter(c => metaCols.has(c.key) && c.key !== 'name' && c.key !== 'notes');

const COOKIE = 'agmat_state';
let colOrder = [];
let rowOrder = [];
let hidden = new Set();
let rowSort = null;
const SORT_ORDER = { full:0, partial:1, none:2, unknown:3, "":4 };

// Pinned agents (always at top), then rest sorted by full-feature count
const PINNED = ['Claude Code','OpenAI Codex CLI','Cursor','OpenCode','Antigravity CLI','Antigravity IDE'];
const ALL_FEATS = featureCols.map(function(c){return c.key});
function rankAgent(i) {
  var agent = matrix[i], p = PINNED.indexOf(agent.name);
  if (p !== -1) return -1000 + p;
  var cnt = 0;
  ALL_FEATS.forEach(function(k){if((agent[k]||{}).support==='full')cnt++});
  return -cnt;
}

function loadState() {
  var def = { cols: matrix.map(function(_,i){return i}).sort(function(a,b){return rankAgent(a)-rankAgent(b)}), rows: featureCols.map(function(c){return c.key}) };
  try {
    var c = document.cookie.split('; ').find(r => r.startsWith(COOKIE+'='));
    if (c) { var p = JSON.parse(decodeURIComponent(c.split('=')[1]));
      if (Array.isArray(p.cols) && p.cols.length===matrix.length) def.cols = p.cols;
      if (Array.isArray(p.rows) && p.rows.length===featureCols.length) def.rows = p.rows;
    }
  } catch(e) {}
  return def;
}
function saveState() {
  document.cookie = COOKIE + '=' + encodeURIComponent(JSON.stringify({cols:colOrder, rows:rowOrder})) + ';path=/;max-age=31536000';
}
function esc(v) { return String(v??'').replace(/[&<>"']/g,c=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c])); }
var COLORS = ['#176b5b','#2d4f9e','#9a3c32','#a35f00','#4a6fa5','#7b4f9e','#27ae60','#8e44ad','#d35400','#16a085','#2c3e50','#f39c12','#1abc9c','#34495e','#e74c3c','#2980b9','#c0392b'];
function agentInitials(name) {
  var p = name.split(/\s+/);
  return p.length===1 ? name.slice(0,2).toUpperCase() : (p[0][0]+p[1][0]).toUpperCase();
}
function avatarSvg(ini, c, size) {
  var s = size||32, r = Math.round(s/5), fs = Math.round(s*0.44);
  return '<svg width="'+s+'" height="'+s+'" viewBox="0 0 '+s+' '+s+'" xmlns="http://www.w3.org/2000/svg"><rect width="'+s+'" height="'+s+'" rx="'+r+'" fill="'+c+'"/><text x="'+s/2+'" y="'+s/2+'" text-anchor="middle" dominant-baseline="central" fill="white" font-size="'+fs+'" font-weight="700" font-family="Inter,sans-serif">'+ini+'</text></svg>';
}
function favimg(agent, idx) {
  var d = agentDomain(agent), ini = agentInitials(agent.name), c = COLORS[idx%COLORS.length];
  var fallback = avatarSvg(ini, c, 32);
  var src = d ? 'https://www.google.com/s2/favicons?domain='+esc(encodeURIComponent(d))+'&sz=64' : '';
  if (!src) return fallback;
  return '<span style="display:inline-block;position:relative;line-height:0"><img class="fav" src="'+src+'" alt="" width="32" height="32" loading="lazy" onerror="var p=this.parentElement;this.style.display=\\x27none\\x27;var s=p.querySelector(\\x27.fav-av\\x27);if(s)s.style.display=\\x27inline\\x27"><span class="fav-av" style="display:none">'+fallback+'</span></span>';
}
function cell(agent, col) {
  var v = agent[col.key];
  if (!v) return '<td>&mdash;</td>';
  if (col.key==='form_factor') return '<td class="cell-wrap"><div class="form-tags">'+(v.values||[v.value]).map(function(x){return '<span class="form-tag">'+esc(x)+'</span>'}).join('')+'</div></td>';
  var tip = v.comment ? '<span class="cell-tip">'+esc(v.comment)+'</span>' : '';
  var src = v.source_url ? '<a class="tri" href="'+esc(v.source_url)+'" target="_blank" rel="noreferrer" title="Open source" aria-label="Open source"></a>' : '';
  if (featureCols.includes(col)) {
    var g = {full:'&#10003;',partial:'&#9678;',none:'&#10005;',unknown:'?','':'—'};
    return '<td class="cell-wrap"><span class="support '+(v.support||'')+'"><span class="dot">'+(g[v.support||'']||'?')+'</span></span>'+src+tip+'</td>';
  }
  if (v.value!==undefined) return '<td class="cell-wrap value">'+esc(v.value)+src+tip+'</td>';
  return '<td>'+esc(v)+'</td>';
}
function renderHeader() {
  document.getElementById('headerRow').innerHTML = '<th class="corner"></th>'+colOrder.map(function(i){
    var agent = matrix[i], hc = hidden.has(i)?' hidden-col':'';
    return '<th class="agent-col'+hc+'" data-idx="'+i+'" draggable="true" onclick="toggleCol('+i+')" title="Click to toggle visibility">'+
      favimg(agent, i)+'<span class="eye">'+(hidden.has(i)?'&#8855;':'&#9679;')+'</span><div class="agent-full">'+esc(agent.name)+'</div></th>';
  }).join(''); setupColDrag();
}
function visibleCols() { return colOrder.filter(function(i){return !hidden.has(i)}); }
function renderBody() {
  var vc = visibleCols();
  if (rowSort) {
    var key = rowSort.key;
    vc = vc.slice().sort(function(a,b){var va=SORT_ORDER[(matrix[a][key]||{}).support||'']||4,vb=SORT_ORDER[(matrix[b][key]||{}).support||'']||4;return rowSort.asc?va-vb:vb-va});
  }
  var rows = [];
  rows.push('<tr class="group-head"><td colspan="'+(vc.length+1)+'">About</td></tr>');
  aboutCols.forEach(function(col){rows.push('<tr><td class="row-label">'+esc(col.label)+'</td>'+vc.map(function(i){return cell(matrix[i],col)}).join('')+'</tr>')});
  // Feature rows in saved order, grouped
  var used = {};
  rowOrder.forEach(function(key){
    var col = featureCols.find(function(c){return c.key===key});
    if (!col||used[key]) return; used[key]=true;
    var isSort = rowSort && rowSort.key===key;
    var active = isSort?' filter-active':'';
    var arrow = isSort?(rowSort.asc?'&#9650;':'&#9660;'):'&#9654;';
    var labelHtml = '<td class="row-label'+active+'" draggable="true" data-rowkey="'+key+'" onclick="cycleSort('+"'"+key+"'"+')" title="Sort columns by this feature"><span class="arrow">'+arrow+'</span>'+esc(col.label)+'</td>';
    var cells = vc.map(function(i){
      if (!isSort) return cell(matrix[i],col);
      var s = (matrix[i][col.key]||{}).support||'';
      return cell(matrix[i],col);
    }).join('');
    rows.push('<tr>'+labelHtml+cells+'</tr>');
  });
  document.getElementById('tbody').innerHTML = rows.join('');
  setupRowDrag();
}
function toggleCol(i) { hidden.has(i)?hidden.delete(i):hidden.add(i); renderHeader(); renderBody(); }
function cycleSort(key) {
  if (rowSort && rowSort.key===key) { if (rowSort.asc) rowSort.asc=false; else rowSort=null; }
  else rowSort = {key:key, asc:true};
  renderBody();
}
function setupColDrag() {
  document.querySelectorAll('th.agent-col').forEach(function(th){
    th.addEventListener('dragstart',function(e){this.classList.add('dragging');e.dataTransfer.setData('text/col',this.dataset.idx)});
    th.addEventListener('dragend',function(){this.classList.remove('dragging')});
    th.addEventListener('dragover',function(e){e.preventDefault();this.classList.add('drag-over')});
    th.addEventListener('dragleave',function(){this.classList.remove('drag-over')});
    th.addEventListener('drop',function(e){e.preventDefault();this.classList.remove('drag-over');
      var from=parseInt(e.dataTransfer.getData('text/col')),to=parseInt(this.dataset.idx);
      if (isNaN(from)||isNaN(to)||from===to) return;
      var fp=colOrder.indexOf(from),tp=colOrder.indexOf(to);
      if (fp===-1||tp===-1) return;
      colOrder.splice(fp,1);colOrder.splice(tp,0,from);saveState();renderHeader();renderBody();
    });
  });
}
function setupRowDrag() {
  document.querySelectorAll('.row-label[draggable]').forEach(function(td){
    td.addEventListener('dragstart',function(e){this.classList.add('dragging');e.dataTransfer.setData('text/row',this.dataset.rowkey)});
    td.addEventListener('dragend',function(){this.classList.remove('dragging')});
    td.addEventListener('dragover',function(e){e.preventDefault();this.classList.add('drag-over')});
    td.addEventListener('dragleave',function(){this.classList.remove('drag-over')});
    td.addEventListener('drop',function(e){e.preventDefault();this.classList.remove('drag-over');
      var from=e.dataTransfer.getData('text/row'),to=this.dataset.rowkey;
      if (!from||!to||from===to) return;
      var fp=rowOrder.indexOf(from),tp=rowOrder.indexOf(to);
      if (fp===-1||tp===-1) return;
      rowOrder.splice(fp,1);rowOrder.splice(tp,0,from);saveState();renderBody();
    });
  });
}
var state = loadState(); colOrder = state.cols; rowOrder = state.rows;
renderHeader(); renderBody();
</script>
</body>
</html>`;
}

function renderRobots() {
  return `User-agent: *\nAllow: /\nSitemap: https://compare.ainorthstar.tech/sitemap.xml\n`;
}
function renderSitemap() {
  return `<?xml version="1.0" encoding="UTF-8"?>
<urlset xmlns="http://www.sitemaps.org/schemas/sitemap/0.9">
  <url><loc>https://compare.ainorthstar.tech/</loc><lastmod>${new Date().toISOString().slice(0,10)}</lastmod><changefreq>weekly</changefreq><priority>1.0</priority></url>
</urlset>`;
}

const bundleJson = JSON.stringify(matrix, null, 2);

export default {
  fetch(request) {
    const url = new URL(request.url);
    if (url.pathname === "/llms.txt") return new Response(llmsTxt, {headers: {"content-type":"text/plain; charset=utf-8","cache-control":"public, max-age=300"}});
    if (url.pathname === "/robots.txt") return new Response(renderRobots(), {headers: {"content-type":"text/plain; charset=utf-8","cache-control":"public, max-age=86400"}});
    if (url.pathname === "/sitemap.xml") return new Response(renderSitemap(), {headers: {"content-type":"application/xml; charset=utf-8","cache-control":"public, max-age=3600"}});
    if (url.pathname === "/bundle.json") return new Response(bundleJson, {headers: {"content-type":"application/json; charset=utf-8","cache-control":"public, max-age=300","access-control-allow-origin":"*"}});
    return new Response(render(), {headers: {"content-type":"text/html; charset=utf-8","cache-control":"public, max-age=300"}});
  },
};
