import matrix from "../docs/tools/agent_matrix/bundle.json";
import schema from "../docs/tools/agent_matrix/schema.json";

const columns = Object.entries(schema.properties)
  .filter(([key]) => !["links", "notes"].includes(key))
  .map(([key, value]) => {
    const parts = (value.$comment || "").split("|").map((part) => part.trim());
    return {
      key,
      group: parts[0] || "Other",
      label: parts[1] || key,
      description: parts[2] || "",
    };
  });

const groups = [...new Set(columns.map((column) => column.group))];

function htmlEscape(value) {
  return String(value ?? "")
    .replaceAll("&", "&amp;")
    .replaceAll("<", "&lt;")
    .replaceAll(">", "&gt;")
    .replaceAll('"', "&quot;");
}

function render() {
  const payload = JSON.stringify({ matrix, columns, groups }).replaceAll("</", "<\\/");
  return `<!doctype html>
<html lang="en">
<head>
  <meta charset="utf-8">
  <meta name="viewport" content="width=device-width, initial-scale=1">
  <title>Coding Agent Feature Matrix</title>
  <style>
    :root {
      color-scheme: light;
      --bg: #f6f4ee;
      --panel: #fffdf8;
      --ink: #17130d;
      --muted: #766f63;
      --line: #ded7c9;
      --line-strong: #bdb3a2;
      --accent: #176b5b;
      --accent-2: #2d4f9e;
      --warn: #a35f00;
      --none: #9a3c32;
      --unknown: #8a8173;
      font-family: Inter, ui-sans-serif, system-ui, -apple-system, BlinkMacSystemFont, "Segoe UI", sans-serif;
    }
    * { box-sizing: border-box; }
    body { margin: 0; background: var(--bg); color: var(--ink); }
    a { color: inherit; text-decoration: none; }
    .topbar {
      height: 58px; display: flex; align-items: center; justify-content: space-between;
      padding: 0 22px; border-bottom: 1px solid var(--line); background: rgba(255,253,248,.92);
      position: sticky; top: 0; z-index: 30; backdrop-filter: blur(10px);
    }
    .brand { display: flex; gap: 10px; align-items: center; font-weight: 700; letter-spacing: .01em; }
    .mark { width: 28px; height: 28px; border: 1px solid var(--ink); display: grid; place-items: center; font-size: 13px; }
    .topnav { display: flex; gap: 18px; color: var(--muted); font-size: 14px; }
    .hero { padding: 30px 22px 18px; border-bottom: 1px solid var(--line); background: var(--panel); }
    .hero h1 { font-size: 34px; line-height: 1.05; margin: 0 0 10px; letter-spacing: 0; max-width: 900px; }
    .hero p { margin: 0; color: var(--muted); max-width: 920px; font-size: 15px; line-height: 1.55; }
    .meta-row { margin-top: 18px; display: flex; gap: 12px; flex-wrap: wrap; align-items: center; color: var(--muted); font-size: 13px; }
    .pill { border: 1px solid var(--line); padding: 6px 9px; background: #fff; }
    .layout { display: grid; grid-template-columns: 260px 1fr; min-height: calc(100vh - 58px); }
    aside { border-right: 1px solid var(--line); background: #fbf8ef; padding: 16px 14px; position: sticky; top: 58px; height: calc(100vh - 58px); overflow: auto; }
    .filter-title { display: flex; align-items: center; justify-content: space-between; margin-bottom: 14px; font-weight: 700; }
    .filter-block { border-top: 1px solid var(--line); padding: 13px 0; }
    .filter-block h2 { font-size: 13px; margin: 0 0 9px; color: var(--ink); }
    label { display: flex; align-items: center; gap: 8px; min-height: 26px; color: var(--muted); font-size: 13px; cursor: pointer; }
    input[type="search"] { width: 100%; height: 36px; border: 1px solid var(--line-strong); background: #fff; padding: 0 10px; font: inherit; }
    input[type="checkbox"] { accent-color: var(--accent); }
    main { overflow: hidden; }
    .toolbar { display: flex; align-items: center; justify-content: space-between; gap: 12px; padding: 13px 16px; border-bottom: 1px solid var(--line); background: var(--bg); position: sticky; top: 58px; z-index: 20; }
    .tabs { display: flex; gap: 6px; overflow: auto; }
    .tab { border: 1px solid var(--line); background: #fff; padding: 7px 10px; font-size: 13px; cursor: pointer; white-space: nowrap; }
    .tab.active { background: var(--ink); color: #fff; border-color: var(--ink); }
    .count { color: var(--muted); font-size: 13px; white-space: nowrap; }
    .table-wrap { overflow: auto; height: calc(100vh - 207px); position: relative; }
    table { border-collapse: separate; border-spacing: 0; min-width: 2200px; width: max-content; background: var(--panel); }
    th, td { border-right: 1px solid var(--line); border-bottom: 1px solid var(--line); padding: 9px 10px; font-size: 13px; vertical-align: top; max-width: 190px; }
    thead { z-index: 12; }
    th {
      position: sticky; top: 0; z-index: 12; background: #eee7d8; text-align: left;
      font-weight: 700; color: #2a241b; box-shadow: inset 0 -1px 0 var(--line-strong);
    }
    th:first-child, td:first-child { position: sticky; left: 0; z-index: 6; background: var(--panel); min-width: 210px; max-width: 210px; }
    th:first-child { z-index: 18; background: #e8decc; }
    .agent-name { font-weight: 700; margin-bottom: 5px; }
    .agent-links { display: flex; gap: 8px; color: var(--muted); font-size: 12px; }
    .group-label { display: block; font-size: 10px; text-transform: uppercase; color: var(--muted); font-weight: 700; margin-bottom: 2px; }
    .support { display: inline-flex; align-items: center; gap: 6px; font-weight: 700; }
    .dot { width: 18px; height: 18px; display: inline-grid; place-items: center; border-radius: 50%; color: #fff; font-size: 11px; }
    .full .dot { background: var(--accent); }
    .partial .dot { background: var(--warn); }
    .none .dot { background: var(--none); }
    .unknown .dot { background: var(--unknown); }
    .blank { color: var(--muted); }
    .source {
      display: inline-grid; place-items: center; width: 14px; height: 14px; margin-left: 5px;
      color: var(--accent-2); font-size: 11px; line-height: 1; vertical-align: text-top;
    }
    .source:hover { color: var(--accent); }
    .cell-note { color: var(--muted); font-size: 12px; line-height: 1.35; margin-top: 4px; }
    .value-cell { line-height: 1.35; }
    .empty { padding: 30px; color: var(--muted); }
    @media (max-width: 850px) {
      .topnav { display: none; }
      .layout { grid-template-columns: 1fr; }
      aside { position: static; height: auto; border-right: 0; border-bottom: 1px solid var(--line); }
      .toolbar { top: 58px; }
      .table-wrap { height: 70vh; }
      .hero h1 { font-size: 28px; }
    }
  </style>
</head>
<body>
  <header class="topbar">
    <a class="brand" href="/"><span class="mark">AL</span><span>agent-launch</span></a>
    <nav class="topnav">
      <a href="https://github.com/dhruv-anand-aintech/agent-launch">GitHub</a>
      <a href="#matrix">Matrix</a>
      <a href="#sources">Sources</a>
    </nav>
  </header>
  <section class="hero">
    <h1>Coding agent feature matrix</h1>
    <p>Compare coding agents, CLIs, and IDEs across rules, skills, hooks, MCP, model configuration, session controls, and automation surfaces. Each sourced cell links to highlighted source text where available.</p>
    <div class="meta-row" id="sources">
      <span class="pill">Data from this repo</span>
      <span class="pill">${htmlEscape(matrix.length)} agents</span>
      <span class="pill">Updated ${new Date().toISOString().slice(0, 10)}</span>
    </div>
  </section>
  <div class="layout" id="matrix">
    <aside>
      <div class="filter-title"><span>Filters</span><button class="tab" id="reset">Reset</button></div>
      <input id="search" type="search" placeholder="Search agents or notes">
      <div class="filter-block">
        <h2>Form factor</h2>
        <div id="formFilters"></div>
      </div>
      <div class="filter-block">
        <h2>Support</h2>
        <label><input type="checkbox" data-support="rules"> Rules</label>
        <label><input type="checkbox" data-support="skills"> Skills</label>
        <label><input type="checkbox" data-support="hooks"> Hooks</label>
        <label><input type="checkbox" data-support="mcp_servers"> MCP</label>
        <label><input type="checkbox" data-support="custom_model_provider"> Arbitrary models</label>
      </div>
    </aside>
    <main>
      <div class="toolbar">
        <div class="tabs" id="tabs"></div>
        <div class="count" id="count"></div>
      </div>
      <div class="table-wrap">
        <table id="table"></table>
      </div>
    </main>
  </div>
  <script type="application/json" id="payload">${payload}</script>
  <script>
    const { matrix, columns, groups } = JSON.parse(document.getElementById('payload').textContent);
    const state = { group: 'All', search: '', forms: new Set(), support: new Set() };
    const featureKeys = new Set(['rules','skills','hooks','mcp_servers','custom_commands','subagents','model_selection','approval_mode','sandbox_mode','resume','non_interactive','output_format','statusline','telemetry','custom_model_provider']);
    const formFactors = [...new Set(matrix.map(row => row.form_factor.value))].sort();
    const glyph = { full: '✔', partial: '◐', none: '✕', unknown: '?', '': '—' };

    function cell(row, column) {
      const value = row[column.key];
      if (column.key === 'name') {
        return '<td><div class="agent-name">' + esc(row.name) + '</div><div class="agent-links">' +
          link(row.links.docs, 'docs') + link(row.links.github, 'github') + link(row.links.website, 'site') + '</div></td>';
      }
      if (!value) return '<td class="blank">—</td>';
      if (featureKeys.has(column.key)) {
        const support = value.support || '';
        return '<td><span class="support ' + support + '"><span class="dot">' + glyph[support] + '</span>' + label(support) + '</span>' +
          source(value.source_url) + note(value.comment) + '</td>';
      }
      if (value.value !== undefined) {
        return '<td class="value-cell">' + esc(value.value) + source(value.source_url) + note(value.comment) + '</td>';
      }
      return '<td>' + esc(value) + '</td>';
    }

    function esc(value) { return String(value || '').replace(/[&<>"']/g, c => ({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c])); }
    function label(value) { return value ? value[0].toUpperCase() + value.slice(1) : 'Blank'; }
    function note(value) { return value ? '<div class="cell-note">' + esc(value) + '</div>' : ''; }
    function source(url) { return url ? '<a class="source" href="' + esc(url) + '" target="_blank" rel="noreferrer" aria-label="Open source" title="Open source">↗</a>' : ''; }
    function link(url, text) { return url ? '<a href="' + esc(url) + '" target="_blank" rel="noreferrer">' + text + '</a>' : ''; }

    function visibleColumns() {
      return state.group === 'All' ? columns : columns.filter(column => column.group === 'About' || column.group === state.group);
    }
    function visibleRows() {
      return matrix.filter(row => {
        const haystack = JSON.stringify(row).toLowerCase();
        if (state.search && !haystack.includes(state.search.toLowerCase())) return false;
        if (state.forms.size && !state.forms.has(row.form_factor.value)) return false;
        for (const key of state.support) {
          if (!['full','partial'].includes(row[key]?.support)) return false;
        }
        return true;
      });
    }
    function renderTabs() {
      document.getElementById('tabs').innerHTML = ['All', ...groups].map(group =>
        '<button class="tab ' + (state.group === group ? 'active' : '') + '" data-group="' + esc(group) + '">' + esc(group) + '</button>'
      ).join('');
    }
    function renderFilters() {
      document.getElementById('formFilters').innerHTML = formFactors.map(form =>
        '<label><input type="checkbox" data-form="' + esc(form) + '"> ' + esc(form) + '</label>'
      ).join('');
    }
    function renderTable() {
      const rows = visibleRows();
      const cols = visibleColumns();
      document.getElementById('count').textContent = rows.length + ' agents';
      if (!rows.length) {
        document.getElementById('table').innerHTML = '<tbody><tr><td class="empty">No agents match these filters.</td></tr></tbody>';
        return;
      }
      document.getElementById('table').innerHTML =
        '<thead><tr>' + cols.map(col => '<th><span class="group-label">' + esc(col.group) + '</span>' + esc(col.label) + '</th>').join('') + '</tr></thead>' +
        '<tbody>' + rows.map(row => '<tr>' + cols.map(col => cell(row, col)).join('') + '</tr>').join('') + '</tbody>';
    }
    function renderAll() { renderTabs(); renderTable(); }
    renderFilters(); renderAll();
    document.getElementById('search').addEventListener('input', event => { state.search = event.target.value; renderTable(); });
    document.getElementById('tabs').addEventListener('click', event => {
      if (event.target.dataset.group) { state.group = event.target.dataset.group; renderAll(); }
    });
    document.getElementById('formFilters').addEventListener('change', event => {
      const form = event.target.dataset.form;
      if (!form) return;
      event.target.checked ? state.forms.add(form) : state.forms.delete(form);
      renderTable();
    });
    document.querySelector('aside').addEventListener('change', event => {
      const key = event.target.dataset.support;
      if (!key) return;
      event.target.checked ? state.support.add(key) : state.support.delete(key);
      renderTable();
    });
    document.getElementById('reset').addEventListener('click', () => {
      state.search = ''; state.forms.clear(); state.support.clear();
      document.getElementById('search').value = '';
      document.querySelectorAll('input[type="checkbox"]').forEach(input => input.checked = false);
      renderTable();
    });
  </script>
</body>
</html>`;
}

export default {
  fetch() {
    return new Response(render(), {
      headers: {
        "content-type": "text/html; charset=utf-8",
        "cache-control": "public, max-age=300",
      },
    });
  },
};
