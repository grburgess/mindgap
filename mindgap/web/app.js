/* mindgap UI — vanilla JS against the /api contract. CDN globals: ForceGraph, ForceGraph3D, marked, DOMPurify. */
'use strict';

const TYPES = ['concept', 'definition', 'software', 'repo', 'page', 'paper', 'person', 'team', 'stub'];
const RELS = ['relates_to', 'defines', 'implements', 'depends_on', 'cites', 'part_of', 'mentions'];
const TYPE_COLORS = {
  concept: '#57c7a4',
  definition: '#a78bfa',
  software: '#5aa9e6',
  repo: '#f4a261',
  page: '#e9c46a',
  paper: '#e76f51',
  person: '#f28ab2',
  team: '#9ae65a',
  stub: '#5b6663',
};

const SETTINGS_DEFAULTS = Object.freeze({
  charge: -260, linkDist: 55, linkStrength: 0.3, velocityDecay: 0.32, collide: true, // physics
  labelMode: 'hubs', linkOpacity: 0.30, arrows: true,                                // visual
  colorBy: 'type', showHulls: true, showClusterLabels: true,                         // clusters
  theme: 'editorial',                                                                // appearance
});
function loadSettings() {
  try { return { ...SETTINGS_DEFAULTS, ...JSON.parse(localStorage.getItem('mm.settings') || '{}') }; }
  catch { return { ...SETTINGS_DEFAULTS }; }
}
function saveSettings() { localStorage.setItem('mm.settings', JSON.stringify(state.settings)); }
const nodeVal = (n) => 1.5 + (n._deg || 0) * 1.4;   // shared by .nodeVal and collide radius

// dark themes — each maps CSS custom properties (+ graph bg via --bg). Node type/community
// colors stay fixed (they read on any dark base); themes swap chrome surfaces + accents.
const THEMES = {
  editorial: { '--bg': '#0b1210', '--bg-raised': '#101a17', '--bg-panel': '#0e1714', '--line': '#1d2925', '--text': '#d7e0dc', '--dim': '#76847f', '--green': '#57c7a4', '--purple': '#a78bfa', '--danger': '#e76f51' },
  midnight:  { '--bg': '#0a0f1a', '--bg-raised': '#0e1626', '--bg-panel': '#0c1320', '--line': '#1b2740', '--text': '#d6e0f0', '--dim': '#7385a3', '--green': '#5aa9e6', '--purple': '#8a7dff', '--danger': '#e76f7a' },
  graphite:  { '--bg': '#0e0e10', '--bg-raised': '#16161a', '--bg-panel': '#131316', '--line': '#2a2a30', '--text': '#e0ddd6', '--dim': '#8a857c', '--green': '#e0a458', '--purple': '#5ec8b8', '--danger': '#e8765a' },
  aubergine: { '--bg': '#120c16', '--bg-raised': '#1a1020', '--bg-panel': '#160d1b', '--line': '#2e2138', '--text': '#e6dcea', '--dim': '#988aa0', '--green': '#c77dff', '--purple': '#ff6ac1', '--danger': '#ff7a7a' },
  carbon:    { '--bg': '#050505', '--bg-raised': '#0d0d0f', '--bg-panel': '#0a0a0c', '--line': '#232327', '--text': '#ececf0', '--dim': '#80808a', '--green': '#57c7a4', '--purple': '#7aa2ff', '--danger': '#e76f51' },
};
const THEME_NAMES = { editorial: 'Editorial', midnight: 'Midnight', graphite: 'Graphite', aubergine: 'Aubergine', carbon: 'Carbon' };
function themeBg() { return (THEMES[state.settings.theme] || THEMES.editorial)['--bg']; }
function applyTheme(name) {
  const t = THEMES[name] || THEMES.editorial;
  for (const k in t) document.documentElement.style.setProperty(k, t[k]);
  if (graph) graph.backgroundColor(t['--bg']);
}

const state = {
  q: '', type: null, tag: '', mode: '2d',
  raw: { nodes: [], links: [] },   // server data; links keep string source/target
  focusRoots: new Set(),           // org-roam local graph: union of roots' 1-hop rings
  selected: null,
  hl: null,                        // { id, nbs:Set } — persistent highlight (selection)
  hoverHl: null,                   // transient hover highlight; overlays hl
  settings: loadSettings(),
  clusters: null,                  // Cluster.detect() result, computed in loadGraph()
  activeCluster: null,             // legend isolate (community idx or null)
  hubs: null,                      // Set of top-degree node ids (label 'hubs' mode)
  _needFit: false,                 // request a zoomToFit on next engine stop
};
let graph = null;
let mountedMode = null;

const $ = (sel) => document.querySelector(sel);
const graphEl = $('#graph');
const sidebar = $('#sidebar');

function slugify(text) {
  return text.toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-+|-+$/g, '');
}

function esc(s) {
  return String(s).replace(/[&<>"']/g, (c) =>
    ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
}

async function api(path, opts) {
  const r = await fetch(path, opts);
  if (!r.ok) throw new Error(`${path}: ${r.status}`);
  return r.json();
}

/* ---------- data ---------- */

async function loadGraph() {
  const p = new URLSearchParams();
  if (state.q) p.set('q', state.q);
  if (state.type) p.set('type', state.type);
  if (state.tag) p.set('tag', state.tag);
  state.raw = await api('/api/graph?' + p);
  state.clusters = Cluster.detect(state.raw.nodes, state.raw.links);
  if (state.activeCluster != null && state.activeCluster >= state.clusters.k) state.activeCluster = null;
  // top-degree hub set for label 'hubs' mode (robust to graph density)
  const deg = new Map();
  for (const l of state.raw.links) {
    deg.set(l.source, (deg.get(l.source) || 0) + 1);
    deg.set(l.target, (deg.get(l.target) || 0) + 1);
  }
  state.hubs = new Set([...deg.entries()].sort((a, b) => b[1] - a[1]).slice(0, HUB_COUNT).map((e) => e[0]));
  const ids = new Set(state.raw.nodes.map((n) => n.id));
  state.focusRoots = new Set([...state.focusRoots].filter((id) => ids.has(id)));
  if (!state.focusRoots.size) clearFocus();
  renderGraph();
  updateEmptyHint();
  loadStats();
  renderLegend();
}

async function loadStats() {
  const s = await api('/api/stats');
  const n = s.nodes ?? s.node_count ?? s.totals?.nodes ?? state.raw.nodes.length;
  const e = s.edges ?? s.edge_count ?? s.totals?.edges ?? state.raw.links.length;
  $('#stats').textContent = `${n} nodes · ${e} edges`;
}

function viewData() {
  let nodes = state.raw.nodes;
  let links = state.raw.links;
  // local graph: each focus root contributes its 1-hop ring; clicks spread it.
  // roots that don't resolve to a real node (e.g. unresolved wiki-link slugs)
  // are ignored so a bad id can never blank the view
  const present = new Set(nodes.map((n) => n.id));
  const roots = new Set([...state.focusRoots].filter((id) => present.has(id)));
  if (roots.size) {
    const keep = new Set(roots);
    for (const l of links) {
      if (roots.has(l.source)) keep.add(l.target);
      if (roots.has(l.target)) keep.add(l.source);
    }
    nodes = nodes.filter((n) => keep.has(n.id));
    links = links.filter((l) => keep.has(l.source) && keep.has(l.target));
  }
  const deg = new Map();
  for (const l of links) {
    deg.set(l.source, (deg.get(l.source) || 0) + 1);
    deg.set(l.target, (deg.get(l.target) || 0) + 1);
  }
  // clone so the force libs can mutate source/target into node objects
  return {
    nodes: nodes.map((n) => ({ ...n, _deg: deg.get(n.id) || 0 })),
    links: links.map((l) => ({ ...l })),
  };
}

/* ---------- graph ---------- */

function nodeTooltip(n) {
  return `<div class="gtip"><b>${esc(n.title)}</b> <span>${esc(n.type)}</span></div>`;
}

const LABEL_ZOOM = 4, HUB_COUNT = 18;
function labelVisible(n, scale) {
  const m = state.settings.labelMode;
  if (m === 'off') return false;
  const hl = state.hoverHl || state.hl;
  const hov = hl && (n.id === hl.id || hl.nbs.has(n.id));
  if (m === 'hover') return !!hov;
  if (m === 'always') return true;
  return (state.hubs && state.hubs.has(n.id)) || scale > LABEL_ZOOM || hov; // 'hubs'
}
function drawLabel2d(n, ctx, scale) {
  if (!labelVisible(n, scale)) return;
  const fs = Math.max(10 / scale, 2);
  ctx.font = `${fs}px 'Hanken Grotesk', sans-serif`;
  ctx.textAlign = 'center'; ctx.textBaseline = 'top';
  ctx.fillStyle = 'rgba(215,224,220,0.92)';
  ctx.fillText(n.title || n.id, n.x, n.y + Math.sqrt(nodeVal(n)) * graph.nodeRelSize() + 1);
}
// drop far-flung members so a hull hugs its dense core instead of sprawling
function trimOutliers(pts) {
  if (pts.length < 5) return pts;
  const cx = pts.reduce((a, p) => a + p.x, 0) / pts.length, cy = pts.reduce((a, p) => a + p.y, 0) / pts.length;
  const rs = pts.map((p) => Math.hypot(p.x - cx, p.y - cy)).sort((a, b) => a - b);
  const med = rs[Math.floor(rs.length / 2)] || 1;
  const kept = pts.filter((p) => Math.hypot(p.x - cx, p.y - cy) <= med * 2.5);
  return kept.length >= 3 ? kept : pts;
}

function drawHulls(ctx, scale) {
  const C = state.clusters, s = state.settings;
  if (!C || !s.showHulls || s.colorBy !== 'community') return;
  const byId = new Map(graph.graphData().nodes.map((n) => [n.id, n]));
  for (const c of C.communities) {
    const pts = c.members.map((id) => byId.get(id)).filter((n) => n && Number.isFinite(n.x));
    if (pts.length < 2) continue;
    if (pts.length >= 3) { // skip spatially incoherent clusters — color + legend carry them
      const ccx = pts.reduce((a, p) => a + p.x, 0) / pts.length, ccy = pts.reduce((a, p) => a + p.y, 0) / pts.length;
      const rs = pts.map((p) => Math.hypot(p.x - ccx, p.y - ccy)).sort((a, b) => a - b);
      if (rs[Math.floor(rs.length / 2)] > state.settings.linkDist * 6) continue;
    }
    ctx.beginPath();
    if (pts.length < 3) {
      const cx = (pts[0].x + pts[pts.length - 1].x) / 2, cy = (pts[0].y + pts[pts.length - 1].y) / 2;
      ctx.arc(cx, cy, Math.hypot(pts[0].x - cx, pts[0].y - cy) + 16, 0, 2 * Math.PI);
    } else {
      const h = Cluster.hull(trimOutliers(pts.map((n) => ({ x: n.x, y: n.y }))), 16);
      ctx.moveTo(h[0].x, h[0].y);
      for (let i = 1; i < h.length; i++) ctx.lineTo(h[i].x, h[i].y);
      ctx.closePath();
    }
    ctx.globalAlpha = 0.08; ctx.fillStyle = c.color; ctx.fill();
    ctx.globalAlpha = 0.5; ctx.lineWidth = 1.5 / scale; ctx.strokeStyle = c.color; ctx.stroke();
    ctx.globalAlpha = 1;
  }
}
function drawClusterLabels(ctx, scale) {
  const C = state.clusters, s = state.settings;
  if (!C || !s.showClusterLabels || s.colorBy !== 'community') return;
  const byId = new Map(graph.graphData().nodes.map((n) => [n.id, n]));
  for (const c of C.communities) {
    if (c.size < 3) continue;
    const pts = c.members.map((id) => byId.get(id)).filter((n) => n && Number.isFinite(n.x));
    if (!pts.length) continue;
    const cx = pts.reduce((a, n) => a + n.x, 0) / pts.length, cy = pts.reduce((a, n) => a + n.y, 0) / pts.length;
    ctx.font = `700 ${Math.max(13 / scale, 3)}px 'Bricolage Grotesque', sans-serif`;
    ctx.textAlign = 'center'; ctx.textBaseline = 'middle';
    ctx.globalAlpha = 0.9; ctx.fillStyle = c.color; ctx.fillText(c.hubTitle, cx, cy);
    ctx.globalAlpha = 1;
  }
}

function applyForces(g) {
  const s = state.settings, is3d = state.mode === '3d';
  g.d3Force('charge').strength(s.charge);
  g.d3Force('link').distance(s.linkDist).strength(s.linkStrength);
  g.d3VelocityDecay(s.velocityDecay);
  // collision is 2D-only: full d3 ships forceCollide+quadtree (the 3D variant's
  // octree dep chain is fragile via CDN); 3D declutter relies on charge+link+depth.
  const d3f = window.__d3f;
  g.d3Force('collide', !is3d && s.collide && d3f && d3f.forceCollide
    ? d3f.forceCollide((n) => Math.sqrt(nodeVal(n)) * g.nodeRelSize() + 4).iterations(2)
    : null);
}

function renderGraph() {
  if (graph && mountedMode === state.mode) {
    graph.graphData(viewData());
    return;
  }
  if (graph && graph._destructor) graph._destructor();
  graphEl.innerHTML = '';
  const make = state.mode === '3d' ? ForceGraph3D : ForceGraph;
  graph = make()(graphEl)
    .width(graphEl.clientWidth)
    .height(graphEl.clientHeight)
    .backgroundColor(themeBg())
    .nodeColor((n) => {
      const C = state.clusters, byC = state.settings.colorBy === 'community' && C;
      const base = byC
        ? (C.byId.has(n.id) ? C.communities[C.byId.get(n.id)].color : '#5b6663')
        : (TYPE_COLORS[n.type] || '#8b9692');
      if (state.activeCluster != null && (!C || C.byId.get(n.id) !== state.activeCluster))
        return 'rgba(91,102,99,0.18)';
      const hl = state.hoverHl || state.hl;
      if (!hl) return base;
      return n.id === hl.id || hl.nbs.has(n.id) ? base : 'rgba(91,102,99,0.25)';
    })
    .nodeVal(nodeVal)
    .nodeLabel(nodeTooltip)
    .linkLabel((l) => l.rel)
    .linkColor((l) => {
      const o = state.settings.linkOpacity;
      const hl = state.hoverHl || state.hl;
      if (!hl) return `rgba(140,160,152,${o})`;
      const s = l.source.id ?? l.source, t = l.target.id ?? l.target;
      return s === hl.id || t === hl.id
        ? 'rgba(87,199,164,0.75)' : `rgba(140,160,152,${o * 0.33})`;
    })
    .linkWidth((l) => Math.min(l.weight || 1, 3))
    .linkDirectionalArrowLength((l) => state.settings.arrows ? 3.5 : 0)
    .linkDirectionalArrowRelPos(1)
    .onNodeClick(handleNodeClick)
    .onNodeHover(handleNodeHover)
    .onBackgroundClick(closeSidebar)
    .graphData(viewData());
  applyForces(graph);
  if (state.mode === '2d' && graph.autoPauseRedraw) graph.autoPauseRedraw(false); // keep painting after cooldown
  if (state.mode === '2d') {
    graph.onRenderFramePre(drawHulls);
    graph.onRenderFramePost(drawClusterLabels);
    graph.nodeCanvasObjectMode(() => 'after').nodeCanvasObject(drawLabel2d);
  }
  graph.onEngineStop(() => { if (state._needFit) { graph.zoomToFit(500, 60); state._needFit = false; } });
  state._needFit = true;
  mountedMode = state.mode;
}

let lastClick = { id: null, t: 0 };
function handleNodeClick(n) {
  const now = Date.now();
  if (lastClick.id === n.id && now - lastClick.t < 350) {
    setFocus(n.id);
  } else {
    if (state.focusRoots.size) spreadFocus(n.id);
    selectNode(n.id, { center: false });
  }
  lastClick = { id: n.id, t: now };
}

function setFocus(id) {
  state.focusRoots = new Set([id]);
  $('#focus-reset').classList.remove('hidden');
  graph.graphData(viewData());
}

// add a root: its 1-hop ring joins the local graph (org-roam spreading)
function spreadFocus(id) {
  if (state.focusRoots.has(id)) return;
  state.focusRoots.add(id);
  graph.graphData(viewData());
}

function clearFocus() {
  state.focusRoots = new Set();
  $('#focus-reset').classList.add('hidden');
  if (graph) graph.graphData(viewData());
}

function refreshStyles() {
  if (!graph) return;
  // re-setting an accessor to itself forces both libs to re-evaluate it
  ['nodeColor', 'linkColor', 'linkDirectionalArrowLength', 'nodeCanvasObject', 'nodeThreeObject'].forEach((m) => {
    if (graph[m]) { const cur = graph[m](); if (cur) graph[m](cur); }
  });
}

function hlFor(id) {
  const nbs = new Set();
  for (const l of state.raw.links) {
    if (l.source === id) nbs.add(l.target);
    if (l.target === id) nbs.add(l.source);
  }
  return { id, nbs };
}

function setHover(id) {
  const cur = state.hoverHl?.id ?? null;
  if (cur === id) return; // hover fires per-frame in 3D; refresh only on change
  state.hoverHl = id ? hlFor(id) : null;
  refreshStyles();
}

function handleNodeHover(n) {
  setHover(n ? n.id : null);
}

function centerOn(id, attempt = 0) {
  if (!graph) return;
  const n = graph.graphData().nodes.find((x) => x.id === id);
  if (!n || n.x === undefined || n.x === null) {
    if (attempt < 5) setTimeout(() => centerOn(id, attempt + 1), 250); // wait for layout
    return;
  }
  if (state.mode === '3d') {
    const d = Math.hypot(n.x, n.y, n.z || 0) || 1;
    const k = 1 + 140 / d;
    graph.cameraPosition({ x: n.x * k, y: n.y * k, z: (n.z || 0) * k }, n, 800);
  } else {
    graph.centerAt(n.x, n.y, 600);
    if (graph.zoom() < 2.2) graph.zoom(2.2, 600);
  }
}

function updateEmptyHint() {
  const empty = state.raw.nodes.length === 0 && !state.q && !state.type && !state.tag;
  $('#empty-hint').classList.toggle('hidden', !empty);
}

/* ---------- sidebar ---------- */

function renderBody(md) {
  // skip wiki-link substitution inside `code spans`; sanitize — bodies are untrusted markdown
  const withLinks = md.replace(/(`[^`]*`)|\[\[([^\]]+)\]\]/g, (m, code, inner) =>
    code !== undefined ? code :
    `<span class="wikilink" data-node="${esc(slugify(inner))}">${esc(inner)}</span>`);
  return DOMPurify.sanitize(marked.parse(withLinks));
}

async function selectNode(id, { center = true } = {}) {
  let d;
  try {
    d = await api('/api/node/' + encodeURIComponent(id));
  } catch {
    return false; // unresolved id (stale wiki-link slug); caller must not focus on it
  }
  state.selected = id;
  state.hl = hlFor(id);
  refreshStyles();
  // graph clicks pass center:false — moving the camera mid-doubleclick
  // shifts the node from under the cursor and the second click misses
  if (center) centerOn(id);
  renderSidebar(d.node, d.neighbors);
  return true;
}

function renderSidebar(node, nb) {
  const color = TYPE_COLORS[node.type] || '#8b9692';
  const others = nb.nodes.filter((n) => n.id !== node.id);
  const relOf = (id) => {
    const l = nb.links.find((l) => (l.source === id && l.target === node.id) ||
                                   (l.source === node.id && l.target === id));
    if (!l) return '';
    return l.source === node.id ? `${l.rel} →` : `← ${l.rel}`;
  };
  sidebar.innerHTML = `
    <button class="close" id="sb-close">&times;</button>
    <h2>${esc(node.title)}</h2>
    <div class="meta">
      <span class="type-badge" style="--c:${color}">${esc(node.type)}</span>
      <span class="mono dim">${esc(node.id)}</span>
    </div>
    ${node.tags.length ? `<div class="tags">${node.tags.map((t) =>
      `<span class="tag">${esc(t)}</span>`).join('')}</div>` : ''}
    <div class="body md">${renderBody(node.body)}</div>
    ${node.urls.length ? `<h3>links</h3><ul class="urls">${node.urls.map((u) =>
      `<li><a href="${esc(u.url)}" target="_blank" rel="noopener">${esc(u.label || u.url)}</a>
       <span class="kind">${esc(u.kind || 'web')}</span></li>`).join('')}</ul>` : ''}
    ${others.length ? `<h3>neighbors</h3><ul class="neighbors">${others.map((n) =>
      `<li class="neighbor" data-node="${esc(n.id)}">
         <i style="background:${TYPE_COLORS[n.type] || '#8b9692'}"></i>
         ${esc(n.title)} <span class="mono dim">${esc(relOf(n.id))}</span></li>`).join('')}</ul>` : ''}
    <div class="actions">
      <button id="sb-focus">${state.focusRoots.size ? 'Spread here' : 'Focus'}</button>
      <button id="sb-edit">Edit</button>
      <button id="sb-link">Link to…</button>
      <button id="sb-delete" class="danger">Delete</button>
    </div>
    <div id="edit-form" class="panel hidden">
      <label>body (markdown)</label>
      <textarea id="ed-body" rows="8">${esc(node.body)}</textarea>
      <label>tags (comma-separated)</label>
      <input id="ed-tags" value="${esc(node.tags.join(', '))}">
      <label>urls (one per line: url | label | kind)</label>
      <textarea id="ed-urls" rows="3">${esc(node.urls.map((u) =>
        [u.url, u.label || '', u.kind || 'web'].join(' | ')).join('\n'))}</textarea>
      <button id="ed-save">Save</button>
    </div>
    <div id="link-form" class="panel hidden">
      <label>relation</label>
      <select id="lk-rel">${RELS.map((r) => `<option>${r}</option>`).join('')}</select>
      <label>target node</label>
      <input id="lk-search" placeholder="search…" autocomplete="off">
      <ul id="lk-results"></ul>
    </div>`;
  sidebar.classList.remove('hidden');

  $('#sb-close').onclick = closeSidebar;
  $('#sb-focus').onclick = () => {
    if (state.focusRoots.size) spreadFocus(node.id);
    else setFocus(node.id);
    $('#sb-focus').textContent = 'Spread here';
  };
  $('#sb-edit').onclick = () => {
    $('#edit-form').classList.toggle('hidden');
    $('#link-form').classList.add('hidden');
  };
  $('#sb-link').onclick = () => {
    $('#link-form').classList.toggle('hidden');
    $('#edit-form').classList.add('hidden');
    $('#lk-search').focus();
  };
  $('#sb-delete').onclick = async () => {
    if (!confirm(`Delete "${node.title}" and its edges?`)) return;
    await api('/api/node/' + encodeURIComponent(node.id), { method: 'DELETE' });
    closeSidebar();
    state.focusRoots.delete(node.id);
    loadGraph();
  };
  $('#ed-save').onclick = async () => {
    const urls = $('#ed-urls').value.split('\n').map((s) => s.trim()).filter(Boolean)
      .map((line) => {
        const [url, label, kind] = line.split('|').map((s) => s.trim());
        return { url, label: label || url, kind: kind || 'web' };
      });
    const tags = $('#ed-tags').value.split(',').map((s) => s.trim()).filter(Boolean);
    await api('/api/node', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ id: node.id, body: $('#ed-body').value, tags, urls, replace: true }),
    });
    await loadGraph();
    selectNode(node.id);
  };
  $('#lk-search').oninput = debounce(async () => {
    const q = $('#lk-search').value.trim();
    const results = q ? await api('/api/search?q=' + encodeURIComponent(q)) : [];
    $('#lk-results').innerHTML = results
      .filter((r) => r.id !== node.id)
      .map((r) => `<li data-node="${esc(r.id)}">
        <i style="background:${TYPE_COLORS[r.type] || '#8b9692'}"></i>${esc(r.title)}</li>`)
      .join('');
  }, 200);
  $('#lk-results').onclick = async (e) => {
    const li = e.target.closest('li[data-node]');
    if (!li) return;
    await api('/api/edge', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ src: node.id, dst: li.dataset.node, rel: $('#lk-rel').value }),
    });
    await loadGraph();
    selectNode(node.id);
  };
}

function closeSidebar() {
  state.selected = null;
  state.hl = null;
  refreshStyles();
  sidebar.classList.add('hidden');
  sidebar.innerHTML = '';
}

// wiki-links + neighbor clicks (delegated; sidebar re-renders often):
// org-roam behavior — following a link focuses that node and spreads the local graph
sidebar.addEventListener('click', async (e) => {
  const t = e.target.closest('.wikilink, .neighbor');
  if (!t || !t.dataset.node) return;
  const id = t.dataset.node;
  if (!(await selectNode(id))) return; // unresolved wiki-link slug — don't focus
  if (state.focusRoots.size) spreadFocus(id);
  else setFocus(id);
});

// hovering a wiki-link/neighbor previews its neighborhood in the graph
sidebar.addEventListener('mouseover', (e) => {
  const t = e.target.closest('.wikilink, .neighbor');
  if (t && t.dataset.node) setHover(t.dataset.node);
});
sidebar.addEventListener('mouseout', (e) => {
  const t = e.target.closest('.wikilink, .neighbor');
  if (t) setHover(null);
});

/* ---------- header controls ---------- */

function debounce(fn, ms) {
  let t;
  return (...a) => { clearTimeout(t); t = setTimeout(() => fn(...a), ms); };
}

$('#search').addEventListener('input', debounce(() => {
  state.q = $('#search').value.trim();
  loadGraph();
}, 250));

$('#tag-filter').addEventListener('input', debounce(() => {
  state.tag = $('#tag-filter').value.trim();
  loadGraph();
}, 250));

const chipsEl = $('#type-chips');
chipsEl.innerHTML = TYPES.map((t) =>
  `<button class="chip" data-type="${t}"><i style="background:${TYPE_COLORS[t]}"></i>${t}</button>`).join('');
chipsEl.addEventListener('click', (e) => {
  const btn = e.target.closest('.chip');
  if (!btn) return;
  state.type = state.type === btn.dataset.type ? null : btn.dataset.type;
  chipsEl.querySelectorAll('.chip').forEach((c) =>
    c.classList.toggle('active', c.dataset.type === state.type));
  loadGraph();
});

function setMode(mode) {
  if (state.mode === mode) return;
  state.mode = mode;
  $('#mode-2d').classList.toggle('active', mode === '2d');
  $('#mode-3d').classList.toggle('active', mode === '3d');
  renderGraph(); // re-mount, same data + focus state
}
$('#mode-2d').onclick = () => setMode('2d');
$('#mode-3d').onclick = () => setMode('3d');

$('#focus-reset').onclick = clearFocus;

/* ---------- settings drawer ---------- */

function onSettingChange(kind) {
  saveSettings();
  if (kind === 'physics') {
    applyForces(graph);
    state._needFit = true;
    graph.d3ReheatSimulation();
    if (graph.resumeAnimation) graph.resumeAnimation();
  } else {
    refreshStyles();
    renderLegend();
  }
}

const RANGES = [
  ['Repulsion', 'charge', -800, -30, 10, 'physics'],
  ['Link distance', 'linkDist', 10, 120, 1, 'physics'],
  ['Link strength', 'linkStrength', 0, 1, 0.05, 'physics'],
  ['Link opacity', 'linkOpacity', 0, 1, 0.05, 'visual'],
];
const TOGGLES = [
  ['Collision', 'collide', 'physics'],
  ['Arrows', 'arrows', 'visual'],
];

function renderSettings() {
  const s = state.settings;
  const rangeRow = ([label, key, min, max, step, kind]) => `
    <label>${label}</label>
    <input type="range" data-key="${key}" data-kind="${kind}" min="${min}" max="${max}" step="${step}" value="${s[key]}">`;
  const toggleRow = ([label, key, kind]) => `
    <button class="seg-toggle ${s[key] ? 'on' : ''}" data-key="${key}" data-kind="${kind}">${label}: <b>${s[key] ? 'on' : 'off'}</b></button>`;
  $('#settings').innerHTML = `
    <button class="close" id="set-close">&times;</button>
    <h2>settings</h2>
    <h3>theme</h3>
    <div class="panel theme-list">
      ${Object.keys(THEMES).map((k) => `
        <button class="theme-opt ${s.theme === k ? 'on' : ''}" data-theme="${k}">
          <span class="sw" style="background:${THEMES[k]['--bg']};border-color:${THEMES[k]['--line']}"><i style="background:${THEMES[k]['--green']}"></i><i style="background:${THEMES[k]['--purple']}"></i></span>${THEME_NAMES[k]}
        </button>`).join('')}
    </div>
    <h3>physics</h3>
    <div class="panel">
      ${RANGES.filter((r) => r[5] === 'physics').map(rangeRow).join('')}
      ${TOGGLES.filter((t) => t[2] === 'physics').map(toggleRow).join('')}
    </div>
    <h3>visual</h3>
    <div class="panel">
      ${RANGES.filter((r) => r[5] === 'visual').map(rangeRow).join('')}
      ${TOGGLES.filter((t) => t[2] === 'visual').map(toggleRow).join('')}
      <label>labels</label>
      <div class="seg labels-seg">
        ${['off', 'hover', 'hubs', 'always'].map((m) =>
          `<button data-mode="${m}" class="${s.labelMode === m ? 'active' : ''}">${m}</button>`).join('')}
      </div>
    </div>
    <h3>clusters</h3>
    <div class="panel">
      <button class="seg-toggle ${s.colorBy === 'community' ? 'on' : ''}" id="set-colorby">Color by: <b>${s.colorBy}</b></button>
      <button class="seg-toggle ${s.showHulls ? 'on' : ''}" data-key="showHulls" data-kind="cluster">Hull blobs: <b>${s.showHulls ? 'on' : 'off'}</b></button>
      <button class="seg-toggle ${s.showClusterLabels ? 'on' : ''}" data-key="showClusterLabels" data-kind="cluster">Cluster labels: <b>${s.showClusterLabels ? 'on' : 'off'}</b></button>
    </div>
    <div class="actions"><button id="set-reset">Reset to defaults</button></div>`;
  $('#settings').classList.remove('hidden');
  $('#set-close').onclick = () => $('#settings').classList.add('hidden');
  $('#set-reset').onclick = () => {
    state.settings = { ...SETTINGS_DEFAULTS };
    saveSettings(); renderSettings(); applyTheme(state.settings.theme); applyForces(graph);
    state._needFit = true; graph.d3ReheatSimulation(); refreshStyles();
  };
  $('#settings').querySelectorAll('input[type=range]').forEach((el) => {
    el.oninput = () => {
      state.settings[el.dataset.key] = parseFloat(el.value);
      onSettingChange(el.dataset.kind);
    };
  });
  $('#settings').querySelectorAll('.seg-toggle[data-key]').forEach((el) => {
    el.onclick = () => {
      const k = el.dataset.key;
      state.settings[k] = !state.settings[k];
      el.classList.toggle('on', state.settings[k]);
      el.querySelector('b').textContent = state.settings[k] ? 'on' : 'off';
      onSettingChange(el.dataset.kind);
    };
  });
  const cb = $('#set-colorby');
  if (cb) cb.onclick = () => {
    state.settings.colorBy = state.settings.colorBy === 'community' ? 'type' : 'community';
    saveSettings(); renderSettings(); renderLegend(); refreshStyles();
  };
  $('#settings').querySelectorAll('.labels-seg button').forEach((b) => {
    b.onclick = () => {
      state.settings.labelMode = b.dataset.mode;
      saveSettings(); renderSettings(); refreshStyles();
    };
  });
  $('#settings').querySelectorAll('.theme-opt').forEach((b) => {
    b.onclick = () => {
      state.settings.theme = b.dataset.theme;
      saveSettings(); applyTheme(state.settings.theme); renderSettings();
    };
  });
}

function renderLegend() {
  const C = state.clusters, el = $('#legend');
  if (!C || state.settings.colorBy !== 'community') { el.classList.add('hidden'); el.innerHTML = ''; return; }
  el.innerHTML = `<h3>clusters (${C.k})</h3><ul>` + C.communities.map((c) =>
    `<li class="leg ${state.activeCluster === c.idx ? 'active' : ''}" data-c="${c.idx}">
       <i style="background:${c.color}"></i>${esc(c.hubTitle)} <span class="mono dim">${c.size}</span></li>`).join('') + '</ul>';
  el.classList.remove('hidden');
  el.querySelectorAll('.leg').forEach((li) => {
    li.onclick = () => {
      const idx = +li.dataset.c;
      state.activeCluster = state.activeCluster === idx ? null : idx;
      renderLegend(); refreshStyles();
    };
  });
}
$('#settings-toggle').onclick = () => {
  if ($('#settings').classList.contains('hidden')) renderSettings();
  else $('#settings').classList.add('hidden');
};

document.addEventListener('keydown', (e) => {
  if (e.key === 'Escape') {
    if (!$('#settings').classList.contains('hidden')) $('#settings').classList.add('hidden');
    else if (state.focusRoots.size) clearFocus();
    else closeSidebar();
  }
});

window.addEventListener('resize', () => {
  if (graph) graph.width(graphEl.clientWidth).height(graphEl.clientHeight);
});

applyTheme(state.settings.theme);
loadGraph();
