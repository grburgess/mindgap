/* mindgap UI — vanilla JS against the /api contract. CDN globals: ForceGraph, ForceGraph3D, marked, DOMPurify. */
'use strict';

const TYPES = ['concept', 'definition', 'software', 'repo', 'page', 'paper', 'person', 'team', 'design', 'feature', 'learning', 'jira-ticket', 'stub'];
const RELS = ['relates_to', 'defines', 'implements', 'depends_on', 'cites', 'part_of', 'mentions', 'assigned_to', 'reported_by'];
const TYPE_COLORS = {
  concept: '#57c7a4',
  definition: '#a78bfa',
  software: '#5aa9e6',
  repo: '#f4a261',
  page: '#e9c46a',
  paper: '#e76f51',
  person: '#f28ab2',
  team: '#9ae65a',
  design: '#d946ef',
  feature: '#f59e0b',
  learning: '#10b981',
  'jira-ticket': '#06b6d4',
  stub: '#5b6663',
};

const SETTINGS_DEFAULTS = Object.freeze({
  charge: -260, linkDist: 55, linkStrength: 0.3, velocityDecay: 0.32, collide: true, gravity: 0.1, // physics
  labelMode: 'hubs', linkOpacity: 0.30, arrows: true, starfield: true, autoRotate: false, edgeFlow: true, bloom: true, warp: true, ambient: true, // visual
  colorBy: 'type', showHulls: true, showClusterLabels: true, clusterForce: false,    // clusters
  theme: 'editorial',                                                                // appearance
});
function loadSettings() {
  try { return { ...SETTINGS_DEFAULTS, ...JSON.parse(localStorage.getItem('mm.settings') || '{}') }; }
  catch { return { ...SETTINGS_DEFAULTS }; }
}
function saveSettings() { localStorage.setItem('mm.settings', JSON.stringify(state.settings)); }
const nodeVal = (n) => 1.5 + (n._deg || 0) * 1.4;   // shared by .nodeVal and collide radius

// timeline color override (state.timeline.colorMode): 'recency' fades older nodes toward
// the dim token; 'provenance' buckets by created_by. Reads CSS tokens so it survives themes.
const PROV_COLORS = {
  loop: '#57c7a4', skill: '#a78bfa', seed: '#e9c46a', claude: '#5aa9e6',
  ui: '#f4a261', manual: '#9ae65a',
};
function provBucket(by) {
  const s = String(by || '').toLowerCase();
  const head = s.split(':')[0];
  return PROV_COLORS[head] || '#8b9692';
}
// recency span (lo/hi created_at across state.raw) cached on loadGraph so the per-node
// nodeColor callback never recomputes an O(N) scan every render frame.
function recomputeRecency() {
  const ts = state.raw.nodes.map((x) => Date.parse(x.created_at)).filter(Number.isFinite);
  state.timeline.recencyLo = ts.length ? Math.min(...ts) : null;
  state.timeline.recencyHi = ts.length ? Math.max(...ts) : null;
}
function timelineNodeColor(n) {
  if (state.timeline.colorMode === 'provenance') return provBucket(n.created_by);
  // recency: newest = full green token, oldest = dim, by created_at across cached span
  const css = getComputedStyle(document.documentElement);
  const green = (css.getPropertyValue('--green') || '#57c7a4').trim();
  const dim = (css.getPropertyValue('--dim') || '#76847f').trim();
  const lo = state.timeline.recencyLo, hi = state.timeline.recencyHi, t = Date.parse(n.created_at);
  if (lo == null || hi == null) return green;
  if (!Number.isFinite(t) || hi === lo) return green;
  return mixHex(dim, green, (t - lo) / (hi - lo));
}
function mixHex(a, b, f) {
  const p = (h) => { h = h.replace('#', ''); return [0, 2, 4].map((i) => parseInt(h.slice(i, i + 2), 16)); };
  const [r1, g1, b1] = p(a), [r2, g2, b2] = p(b);
  const c = (x, y) => Math.round(x + (y - x) * Math.min(Math.max(f, 0), 1)).toString(16).padStart(2, '0');
  return '#' + c(r1, r2) + c(g1, g2) + c(b1, b2);
}

// dark themes — each maps CSS custom properties (+ graph bg via --bg). Node type/community
// colors stay fixed (they read on any dark base); themes swap chrome surfaces + accents.
const THEMES = {
  editorial: { '--bg': '#0b1210', '--bg-raised': '#101a17', '--bg-panel': '#0e1714', '--line': '#1d2925', '--text': '#d7e0dc', '--dim': '#76847f', '--green': '#57c7a4', '--purple': '#a78bfa', '--danger': '#e76f51' },
  midnight:  { '--bg': '#0a0f1a', '--bg-raised': '#0e1626', '--bg-panel': '#0c1320', '--line': '#1b2740', '--text': '#d6e0f0', '--dim': '#7385a3', '--green': '#5aa9e6', '--purple': '#8a7dff', '--danger': '#e76f7a' },
  graphite:  { '--bg': '#0e0e10', '--bg-raised': '#16161a', '--bg-panel': '#131316', '--line': '#2a2a30', '--text': '#e0ddd6', '--dim': '#8a857c', '--green': '#e0a458', '--purple': '#5ec8b8', '--danger': '#e8765a' },
  aubergine: { '--bg': '#120c16', '--bg-raised': '#1a1020', '--bg-panel': '#160d1b', '--line': '#2e2138', '--text': '#e6dcea', '--dim': '#988aa0', '--green': '#c77dff', '--purple': '#ff6ac1', '--danger': '#ff7a7a' },
  carbon:    { '--bg': '#050505', '--bg-raised': '#0d0d0f', '--bg-panel': '#0a0a0c', '--line': '#232327', '--text': '#ececf0', '--dim': '#80808a', '--green': '#57c7a4', '--purple': '#7aa2ff', '--danger': '#e76f51' },
  // Cape — Cape Analytics (a Moody's company) brand: deep navy #002B49 base, signature mint
  // #85FFB3 + indigo #5A4FFF accents. Geospatial/aerial feel; pairs with the 3D glow + stars.
  cape:      { '--bg': '#02192a', '--bg-raised': '#082842', '--bg-panel': '#061f34', '--line': '#14395a', '--text': '#dceaf3', '--dim': '#6f8ea6', '--green': '#85ffb3', '--purple': '#5a4fff', '--danger': '#ff6b5e' },
};
const THEME_NAMES = { editorial: 'Editorial', midnight: 'Midnight', graphite: 'Graphite', aubergine: 'Aubergine', carbon: 'Carbon', cape: 'Cape' };
function themeBg() { return (THEMES[state.settings.theme] || THEMES.editorial)['--bg']; }
function applyTheme(name) {
  const t = THEMES[name] || THEMES.editorial;
  for (const k in t) document.documentElement.style.setProperty(k, t[k]);
  if (graph) graph.backgroundColor(t['--bg']);
}

const state = {
  q: '', type: null, tag: '', mode: '2d',
  raw: { nodes: [], links: [] },   // server data (q/type/tag-filtered); links keep string source/target
  allNodes: [],                    // full unfiltered node set — timeline histogram bins this
  focusRoots: new Set(),           // org-roam local graph: union of roots' 1-hop rings
  timeline: { cutoff: null, dir: 'before', playing: false, colorMode: 'off', recencyLo: null, recencyHi: null }, // time cutoff (before/after) + node-color override
  orphansOnly: false,              // header chip: keep only degree-0 nodes
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
let panTimer = null;                    // 2D link-LOD: hide edges while panning, restore ~300ms after
// perf instrumentation: expose the live graph instance + state to injected harnesses
// (tools/perf/fps_harness.js). getter is required — `graph` is reassigned on 2D↔3D remount.
window.__mm = { get graph() { return graph; }, state };

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
  const filtered = !!(state.q || state.type || state.tag);
  state.raw = await api('/api/graph?' + p);
  // timeline bins the FULL set (stable across server q/type/tag filters): when no filter
  // is active state.raw IS the full set; otherwise fetch it once so the histogram persists
  if (!filtered) state.allNodes = state.raw.nodes;
  else if (!state.allNodes.length) state.allNodes = (await api('/api/graph')).nodes;
  state.clusters = Cluster.detect(state.raw.nodes, state.raw.links);
  state.satellites = findSatellites(state.raw.nodes, state.raw.links);
  if (state.activeCluster != null && state.activeCluster >= state.clusters.k) state.activeCluster = null;
  // top-degree hub set for label 'hubs' mode (robust to graph density)
  const deg = new Map();
  for (const l of state.raw.links) {
    deg.set(l.source, (deg.get(l.source) || 0) + 1);
    deg.set(l.target, (deg.get(l.target) || 0) + 1);
  }
  state.hubs = new Set([...deg.entries()].sort((a, b) => b[1] - a[1]).slice(0, HUB_COUNT).map((e) => e[0]));
  recomputeRecency();
  const ids = new Set(state.raw.nodes.map((n) => n.id));
  state.focusRoots = new Set([...state.focusRoots].filter((id) => ids.has(id)));
  if (!state.focusRoots.size) clearFocus();
  renderGraph();
  if (state.mode === '3d' && window.Glow3d) Glow3d.refresh();
  updateEmptyHint();
  loadStats();
  renderLegend();
  if (timelineMounted) Timeline.update(state.allNodes); // re-bin from the full unfiltered set
  updateOrphanChip();
  updateChipShares(); // busbar histogram: re-scale the per-type bars to the live census
}

async function loadStats() {
  const s = await api('/api/stats');
  const n = s.nodes ?? s.node_count ?? s.totals?.nodes ?? state.raw.nodes.length;
  const e = s.edges ?? s.edge_count ?? s.totals?.edges ?? state.raw.links.length;
  $('#stats').innerHTML = `<b>${n}</b> nodes<span class="vsep">&#9615;</span><b>${e}</b> edges`;
}

// global degree over the full server graph (orphan = degree 0 anywhere, not just in view)
function rawDegree() {
  const deg = new Map();
  for (const l of state.raw.links) {
    deg.set(l.source, (deg.get(l.source) || 0) + 1);
    deg.set(l.target, (deg.get(l.target) || 0) + 1);
  }
  return deg;
}
function orphanCount() {
  const deg = rawDegree();
  return state.raw.nodes.reduce((c, n) => c + ((deg.get(n.id) || 0) === 0 ? 1 : 0), 0);
}

function viewData() {
  let nodes = state.raw.nodes;
  let links = state.raw.links;
  // client filters compose on top of the server-side q/type/tag set (state.raw):
  // time cutoff (created_at <= T) and orphans-only (global degree 0).
  const cutoff = state.timeline.cutoff;
  if (cutoff != null) {
    const after = state.timeline.dir === 'after';
    nodes = nodes.filter((n) => { const t = Date.parse(n.created_at); if (!Number.isFinite(t)) return true; return after ? t >= cutoff : t <= cutoff; });
    // links between surviving nodes only, so orphan degree below reflects the current view
    const ids = new Set(nodes.map((n) => n.id));
    links = links.filter((l) => ids.has(l.source) && ids.has(l.target));
  }
  if (state.orphansOnly) {
    // degree over the post-cutoff links (in-view isolation), not the global graph
    const deg = cutoff != null ? new Map() : rawDegree();
    if (cutoff != null) for (const l of links) {
      deg.set(l.source, (deg.get(l.source) || 0) + 1);
      deg.set(l.target, (deg.get(l.target) || 0) + 1);
    }
    nodes = nodes.filter((n) => (deg.get(n.id) || 0) === 0);
  }
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
  // links survive only between nodes still present after the client filters
  if (cutoff != null || state.orphansOnly) {
    const ids = new Set(nodes.map((n) => n.id));
    links = links.filter((l) => ids.has(l.source) && ids.has(l.target));
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

// custom force: pull each node toward its community's centroid so topics group into
// spatially separate clusters (the global charge then pushes the groups apart). Pure
// arithmetic on vx/vy[/vz] — no quadtree/octree dep — so it is safe in both 2D and 3D.
function makeClusterForce(strength) {
  let nodes = [];
  function force(alpha) {
    const C = state.clusters;
    if (!C) return;
    const cen = new Map();                          // community idx -> running centroid
    for (const n of nodes) {
      const c = C.byId.get(n.id);
      if (c == null) continue;
      let e = cen.get(c);
      if (!e) { e = { x: 0, y: 0, z: 0, n: 0 }; cen.set(c, e); }
      e.x += n.x; e.y += n.y; e.z += (n.z || 0); e.n++;
    }
    for (const e of cen.values()) { e.x /= e.n; e.y /= e.n; e.z /= e.n; }
    const k = alpha * strength;
    for (const n of nodes) {
      const e = cen.get(C.byId.get(n.id));
      if (!e) continue;
      n.vx += (e.x - n.x) * k;
      n.vy += (e.y - n.y) * k;
      if (n.z != null) n.vz += (e.z - n.z) * k;
    }
  }
  force.initialize = (n) => { nodes = n; };
  return force;
}

// ids of nodes outside the largest connected component. Links are raw (string endpoints) at
// loadGraph time, before force-graph rebinds them to node objects.
function findSatellites(nodes, links) {
  const adj = new Map();
  const add = (a, b) => { let l = adj.get(a); if (!l) adj.set(a, l = []); l.push(b); };
  for (const l of links) { add(l.source, l.target); add(l.target, l.source); }
  const seen = new Set(), comps = [];
  for (const n of nodes) {
    if (seen.has(n.id)) continue;
    const stack = [n.id], comp = [];
    while (stack.length) {
      const u = stack.pop();
      if (seen.has(u)) continue;
      seen.add(u); comp.push(u);
      for (const v of adj.get(u) || []) if (!seen.has(v)) stack.push(v);
    }
    comps.push(comp);
  }
  if (comps.length < 2) return new Set();
  comps.sort((a, b) => b.length - a.length);
  return new Set(comps.slice(1).flat());
}

// custom force: tether disconnected components to the main web. Satellite nodes have no link
// force holding them, so charge repulsion exiles them far past the main web's rim and
// zoomToFit must zoom way out. Pull each satellite toward the main component's running
// centroid; charge then parks them just off the rim. Same vx/vy[/vz] arithmetic as
// makeClusterForce — safe in both 2D and 3D.
function makeGravityForce(strength) {
  let nodes = [];
  function force(alpha) {
    const S = state.satellites;
    if (!S || !S.size || !strength) return;   // strength 0 = slider off
    let cx = 0, cy = 0, cz = 0, m = 0;
    for (const n of nodes) {
      if (S.has(n.id)) continue;
      cx += n.x; cy += n.y; cz += (n.z || 0); m++;
    }
    if (!m) return;
    cx /= m; cy /= m; cz /= m;
    const k = alpha * strength;
    for (const n of nodes) {
      if (!S.has(n.id)) continue;
      n.vx += (cx - n.x) * k;
      n.vy += (cy - n.y) * k;
      if (n.z != null) n.vz += (cz - n.z) * k;
    }
  }
  force.initialize = (n) => { nodes = n; };
  return force;
}

// 2D drag freeze — while a node is dragged the lib writes its fx/x directly every move, so the
// physics reheat it also hard-codes (d3AlphaTarget(.3).resetCountdown()) exists ONLY to drag
// neighbours along. At 5k nodes one force tick costs 100-400ms (drag ≈ 11 FPS), so we null the
// forces for the gesture (ticks become ~free), pull 1-hop neighbours kinematically instead
// (mirror of the 3D instanced3d.js drag), and restore forces once the engine stops. Instance-
// guarded: a mode remount rebuilds `graph`, and old force objects must never reach the new one.
// multi-hop drag ripple: BFS out from the dragged node over the bound links, weighting each hop
// at 0.6^hop so the local map trails the gesture elastically instead of only 1-hop moving rigidly
// ("map does not follow along"). Capped at 3 hops / 500 nodes so a 5k-graph hub drag stays inside
// the web-perf C7 drag budget (adjacency build is O(E) once per gesture; per-move cost = |set|).
function dragRipple(n, links) {
  const K = 0.6, MAX_HOPS = 3, MAX_NODES = 500;
  const adj = new Map();
  for (const l of links) {
    const s = l.source, t = l.target;
    if (!s || !t || typeof s !== 'object' || typeof t !== 'object') continue;
    let a = adj.get(s); if (!a) adj.set(s, a = []); a.push(t);
    let b = adj.get(t); if (!b) adj.set(t, b = []); b.push(s);
  }
  const w = new Map([[n, 1]]);   // seed excludes n from re-visits; deleted before return
  let frontier = [n];
  for (let hop = 1; hop <= MAX_HOPS && frontier.length && w.size < MAX_NODES; hop++) {
    const kw = Math.pow(K, hop), next = [];
    for (const u of frontier) {
      for (const v of (adj.get(u) || [])) {
        if (w.has(v)) continue;
        w.set(v, kw); next.push(v);
        if (w.size >= MAX_NODES) break;
      }
      if (w.size >= MAX_NODES) break;
    }
    frontier = next;
  }
  w.delete(n);                   // self would double-move the dragged node
  return [...w.entries()];
}

// org-roam-ui/Obsidian drags run the sim live so the neighbourhood adapts under the gesture;
// above this node count a force tick costs 100-400ms (web-perf C7 drag gate) and drags fall
// back to the kinematic freeze+ripple path. Same size-gating precedent as _panLOD.
const LIVE_DRAG_MAX = 1500;
const liveDrag = (g) => g.graphData().nodes.length <= LIVE_DRAG_MAX;

let _frozenForces = null;   // { g, forces: {name: force|null} } while frozen
function freezeForces(g) {
  if (_frozenForces) return;
  const forces = {};
  for (const k of ['charge', 'link', 'center', 'collide', 'cluster', 'gravity']) { forces[k] = g.d3Force(k) || null; g.d3Force(k, null); }
  // zero residual velocities: absent forces d3 still integrates x += vx each tick, so a drag begun
  // mid-settle would leave the whole graph coasting for the frozen window
  for (const n of g.graphData().nodes) { n.vx = 0; n.vy = 0; if (n.vz !== undefined) n.vz = 0; }
  _frozenForces = { g, forces };
}
function unfreezeForces(g) {
  if (!_frozenForces) return;
  if (_frozenForces.g === g) {
    for (const k of Object.keys(_frozenForces.forces)) if (_frozenForces.forces[k]) g.d3Force(k, _frozenForces.forces[k]);
  }
  _frozenForces = null;     // different instance → originals belong to a dead graph, just drop them
}
function applyForces(g) {
  unfreezeForces(g);        // reconfiguring frozen (null) forces would throw; any settings/data change unfreezes first
  const s = state.settings, is3d = state.mode === '3d';
  g.d3Force('charge').strength(s.charge);
  g.d3Force('link').distance(s.linkDist).strength(s.linkStrength);
  g.d3VelocityDecay(s.velocityDecay);
  // collision is 2D-only: full d3 ships forceCollide+quadtree (the 3D variant's
  // octree dep chain is fragile via CDN); 3D declutter relies on charge+link+depth.
  const d3f = window.__d3f;
  g.d3Force('collide', !is3d && s.collide && d3f && d3f.forceCollide
    ? d3f.forceCollide((n) => Math.sqrt(nodeVal(n)) * g.nodeRelSize() + 4).iterations(1)
    : null);
  // topic-cluster cohesion (2D + 3D): groups same-community nodes so topics separate
  g.d3Force('cluster', s.clusterForce && state.clusters ? makeClusterForce(0.45) : null);
  // disconnected-component tether (2D + 3D): reads state.satellites each tick (no-op when
  // empty), so it stays live across applyData() swaps that never re-run applyForces
  g.d3Force('gravity', makeGravityForce(s.gravity));
}

// passed to Glow3d (3D topic orbs) — thin getters, no coupling to app internals
const glowCtx = { getClusters: () => state.clusters, getSettings: () => state.settings };

// directional energy particles along links; a highlighted node's incident links pulse
// brighter/faster in accent green, others stay faint. idempotent re-set of the accessors,
// mirrors the linkColor highlight test (state.hoverHl || state.hl).
function applyEdgeFlow(g) {
  if (!g || !g.linkDirectionalParticles) return;
  const hlId = () => { const hl = state.hoverHl || state.hl; return hl ? hl.id : null; };
  const inc = (l) => { const s = l.source.id ?? l.source, t = l.target.id ?? l.target; const h = hlId(); return h && (s === h || t === h); };
  // 2D: photons ONLY on hovered/incident links. Ambient photons on all 10k links pin force-graph's
  // doRedraw=true forever (canvas never idles) AND add 10k per-frame particle draws — the 2D perf
  // killer. Hover flow keeps edge-flow visibly "on". (3D flow is handled by instanced3d's Points cloud;
  // the lib's links are invisible there so this accessor is moot in 3D.)
  g.linkDirectionalParticles((l) => state.settings.edgeFlow ? (inc(l) ? 4 : 0) : 0)
   .linkDirectionalParticleSpeed((l) => inc(l) ? 0.012 : 0.006)
   .linkDirectionalParticleWidth((l) => inc(l) ? 2.2 : 1.4)
   .linkDirectionalParticleColor((l) => inc(l) ? 'rgba(87,199,164,0.9)' : 'rgba(150,170,160,0.45)');
}

// node/link color logic, extracted so the 3D InstancedMesh (instanced3d.js) can call the SAME
// logic per node/link as the 2D/lib accessors below. No behavior change — .nodeColor/.linkColor
// just reference these named fns now.
function nodeColorFor(n) {
  const C = state.clusters, byC = state.settings.colorBy === 'community' && C;
  // timeline color override: when on, replace the base hue (recency/provenance);
  // when off ('off' default) the community/type base is untouched. While a cluster is
  // isolated the override is skipped for its members so the bright-vs-dim contrast holds.
  const inActiveCluster = state.activeCluster != null && C && C.byId.get(n.id) === state.activeCluster;
  const base = state.timeline.colorMode !== 'off' && !inActiveCluster
    ? timelineNodeColor(n)
    : (byC
        ? (C.byId.has(n.id) ? C.communities[C.byId.get(n.id)].color : '#5b6663')
        : (TYPE_COLORS[n.type] || '#8b9692'));
  if (state.activeCluster != null && (!C || C.byId.get(n.id) !== state.activeCluster))
    return 'rgba(91,102,99,0.18)';
  const hl = state.hoverHl || state.hl;
  if (!hl) return base;
  return n.id === hl.id || hl.nbs.has(n.id) ? base : 'rgba(91,102,99,0.25)';
}
function linkColorFor(l) {
  const o = state.settings.linkOpacity;
  const hl = state.hoverHl || state.hl;
  if (!hl) return `rgba(140,160,152,${o})`;
  const s = l.source.id ?? l.source, t = l.target.id ?? l.target;
  return s === hl.id || t === hl.id
    ? 'rgba(87,199,164,0.75)' : `rgba(140,160,152,${o * 0.33})`;
}

function renderGraph() {
  if (graph && mountedMode === state.mode) {
    applyData(viewData());
    return;
  }
  if (window.Glow3d) Glow3d.teardown();
  if (window.Starfield) Starfield.teardown();
  if (window.AutoRotate) AutoRotate.teardown();
  if (window.Bloom) Bloom.teardown();
  if (window.Warp) Warp.teardown();
  if (window.SpaceFx) SpaceFx.teardown();
  if (window.Instanced3d) Instanced3d.teardown();
  if (graph && graph._destructor) graph._destructor();
  graphEl.innerHTML = '';
  const make = state.mode === '3d' ? ForceGraph3D : ForceGraph;
  const is3d = state.mode === '3d';
  graph = make()(graphEl)
    .width(graphEl.clientWidth)
    .height(graphEl.clientHeight)
    .backgroundColor(themeBg())
    // stop the layout once it has converged (alpha ≤ 0.02, ~tick 170) instead of running
    // force-graph's default 15000ms wall-clock: past convergence every extra frame is a wasted
    // full O(N+E) repaint. cooldownTime(15000) still backstops slow machines; this is sticky on
    // the instance, so applyData/d3ReheatSimulation/drag reheats all inherit the early stop.
    .d3AlphaMin(0.02)
    .nodeColor(nodeColorFor)
    .nodeVal(nodeVal)
    .nodeLabel(nodeTooltip)
    .linkLabel((l) => l.rel)
    .linkColor(linkColorFor)
    .linkWidth((l) => is3d ? 0 : Math.min(l.weight || 1, 3))   // 3D: unlit lines, not cylinder meshes (~10k fewer)
    .linkVisibility(() => !(state.mode === '2d' && state._panning && state._panLOD))   // 2D LOD: drop edge strokes mid-pan on DENSE graphs only, restore on settle (3D overrides this to false via instanced3d)
    .linkDirectionalArrowLength((l) => {
      if (!state.settings.arrows) return 0;
      if (!is3d) return 3.5;
      // 3D: arrows only on hub-incident links — a persistent direction cue on the meaningful edges,
      // without a cone mesh on every one of ~10k faint links.
      const s = l.source.id ?? l.source, t = l.target.id ?? l.target;
      return (state.hubs && (state.hubs.has(s) || state.hubs.has(t))) ? 3.5 : 0;
    })
    .linkDirectionalArrowRelPos(1)
    .onNodeClick(handleNodeClick)
    .onNodeHover(handleNodeHover)
    .onBackgroundClick(closeSidebar)
    .graphData(viewData());
  applyForces(graph);
  applyEdgeFlow(graph);
  if (state.mode === '2d') {
    graph.onRenderFramePre(drawHulls);
    graph.onRenderFramePost(drawClusterLabels);
    graph.nodeCanvasObjectMode(() => 'after').nodeCanvasObject(drawLabel2d);
    graph.onZoom(onPan2d);                       // link-LOD: hide edges while the view is moving
    state._panLOD = graph.graphData().links.length > 1500;   // only LOD dense graphs; small ones keep edges mid-pan
    // node drag, org-roam-ui/Obsidian-style (liveDrag): the sim stays LIVE for the gesture so
    // link/charge/gravity pull the neighbourhood along and the drop lands in a new equilibrium —
    // no snap-back. The lib's own drag reheat (d3AlphaTarget(.3) per move) is bricked on a settled
    // graph because alpha sits below the d3AlphaMin(0.02) early-stop, so the gesture's first move
    // drops alphaMin to 0 (org-roam-ui ships alphaMin:0 permanently); drag end restores 0.02 and
    // the ~0.3 alpha tail settles to convergence. Above LIVE_DRAG_MAX nodes a force tick costs
    // 100-400ms (drag ≈ 11 FPS, the web-perf C7 gate), so huge graphs keep the kinematic fallback:
    // freeze physics, pull the multi-hop ripple along (dragRipple: weight 0.6^hop, ≤3 hops,
    // ≤500 nodes), then unfreeze + one reheat at drag end so forces still settle the drop.
    // delta = the lib's per-move translation in graph coords. Neighbour capture keys on the
    // dragged node (NOT the freeze flag): consecutive drags land inside the previous drop's
    // live settle window and the new gesture still needs its own ripple set.
    let dragNbrs = null, dragNode = null;
    graph.onNodeDrag((n, delta) => {
      if (liveDrag(graph)) {
        // un-brick (settled alpha sits below the 0.02 early-stop) AND kick alpha hot: ramping
        // from ~0.02 toward the lib's 0.3 drag target takes seconds, during which the
        // neighbourhood barely adapts and the drop still snaps back
        if (dragNode !== n) { dragNode = n; graph.d3AlphaMin(0); graph.d3ReheatSimulation(); }
      } else {
        if (!_frozenForces) freezeForces(graph);
        if (dragNode !== n) {
          dragNode = n;
          dragNbrs = dragRipple(n, graph.graphData().links);
        }
        if (dragNbrs) for (const [m, kw] of dragNbrs) { if (m.x == null) continue; m.x += delta.x * kw; m.y += delta.y * kw; }
        onPan2d();                           // dense-graph LOD: hide 10k edge strokes while dragging (same as pan) — full-stroke rasters cause 400ms+ compositor stalls. Kinematic-only: a live drag IS the elastic links, hiding them kills the org-roam feel
      }
    });
    graph.onNodeDragEnd(() => {
      dragNbrs = null; dragNode = null;
      // restore the early-stop floor UNCONDITIONALLY: a mid-gesture data swap can flip
      // liveDrag() between first-move and drag-end, and the live branch's alphaMin(0)
      // must not leak into a 15s full-force cooldown on a big graph
      graph.d3AlphaMin(0.02);                                        // settle tail runs to the early-stop
      if (!liveDrag(graph)) { unfreezeForces(graph); graph.d3ReheatSimulation(); }
    });
  }
  if (state.mode === '3d' && window.Glow3d) Glow3d.install(graph, glowCtx);
  if (state.mode === '3d' && window.Starfield) Starfield.install(graph, glowCtx);
  if (state.mode === '3d' && window.AutoRotate) AutoRotate.install(graph, glowCtx);
  if (state.mode === '3d' && window.Bloom) Bloom.install(graph, glowCtx);
  if (state.mode === '3d' && window.Warp) Warp.install(graph, glowCtx);
  if (state.mode === '3d' && window.SpaceFx) SpaceFx.install(graph, glowCtx);
  if (is3d) {                                   // perf: cheaper node spheres + clamp retina fill (bloom/stars are fill-bound)
    graph.nodeResolution(6);
    const _r = graph.renderer && graph.renderer();
    if (_r && _r.setPixelRatio) _r.setPixelRatio(Math.min(window.devicePixelRatio || 1, 1.5));
  }
  // 3D draw-call collapse: mute the lib's per-node/per-link THREE objects (it still runs the sim +
  // binds link.source/target to node objects) and render everything through instanced3d.js — ONE
  // InstancedMesh + ONE LineSegments instead of ~27.7k meshes. Hover/click are raycast there; the
  // lib's onNodeHover/onNodeClick above stay wired for 2D and as a harmless no-op in 3D.
  if (is3d && window.Instanced3d) {
    graph.nodeThreeObject(() => new THREE.Object3D()).nodeThreeObjectExtend(false).linkVisibility(false);
    Instanced3d.install(graph, {
      nodes: () => graph.graphData().nodes,
      links: () => graph.graphData().links,
      nodeColorFor, linkColorFor, nodeVal,
      hubIds: () => state.hubs || new Set(),
      onHover: handleNodeHover,
      onClick: handleNodeClick,
      nodeLabel: nodeTooltip,
      getSettings: () => state.settings,
      dragRipple,                 // kinematic-fallback multi-hop follow (same weights as the 2D drag)
      // live-vs-kinematic drag contract shared with the 2D path: small graphs drag with the sim
      // live (org-roam-ui style); huge graphs freeze forces for the gesture so a hot post-drop
      // sim can't run 100-400ms ticks per frame or double-move the kinematic ripple set
      liveDrag: () => liveDrag(graph),
      freezeForces: () => freezeForces(graph),
      unfreezeForces: () => unfreezeForces(graph),
    });
  }
  graph.onEngineStop(() => {
    unfreezeForces(graph);   // backstop only (drag end unfreezes): e.g. a remount mid-gesture
    // backstop for the live-drag alphaMin(0) window (e.g. data swap mid-gesture). MUST be
    // guarded: the 3D lib's d3AlphaMin setter schedules a digest that flips engineRunning back
    // on even for a no-op write → unguarded, first settle ignites a 60Hz stop/restart loop
    if (graph.d3AlphaMin() !== 0.02) graph.d3AlphaMin(0.02);
    if (state._needFit) { graph.zoomToFit(500, 60); state._needFit = false; }
    // auto-pause is on (force-graph default): when the engine cools the render loop stops
    // painting, so nudge exactly one repaint at the settled layout — re-runs the 2D custom
    // painters (hulls, cluster + hub labels) at final positions, then the canvas idles at ~0 CPU.
    if (state.mode === '2d') requestAnimationFrame(() => refreshStyles());
  });
  state._needFit = true;
  mountedMode = state.mode;
}

// swap in new graph data while PRESERVING existing nodes' layout positions by id. viewData()
// returns fresh clones with no x/y, and force-graph re-spirals any node whose .x is unset and
// reheats to alpha=1 on every graphData swap — so without this, adding one edge (or filtering/
// focusing) cold-relayouts the whole graph and nodes fly apart for seconds. Carrying positions
// over means only genuinely-new nodes spiral in; the reheat then settles instantly (net force ~0).
function applyData(d) {
  if (!graph) return;
  unfreezeForces(graph);   // data swaps rely on live forces to settle new nodes; a frozen drag window must not starve them
  const prev = new Map(graph.graphData().nodes.map((n) => [n.id, n]));
  for (const n of d.nodes) {
    const p = prev.get(n.id);
    if (p) { n.x = p.x; n.y = p.y; n.vx = p.vx; n.vy = p.vy; if (p.z != null) n.z = p.z; }
  }
  graph.graphData(d);
  // 3D renders through instanced3d.js (fixed instance count); rebuild it from the new data or
  // filtered-out nodes linger as ghosts. Bloom's hub set changes too — refresh so its idle-gate
  // re-renders instead of showing a stale glow.
  if (state.mode === '3d') {
    if (window.Instanced3d) Instanced3d.rebuild();
    if (window.Bloom) Bloom.refresh();
  }
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
  applyData(viewData());
}

// add a root: its 1-hop ring joins the local graph (org-roam spreading)
function spreadFocus(id) {
  if (state.focusRoots.has(id)) return;
  state.focusRoots.add(id);
  applyData(viewData());
}

function clearFocus() {
  state.focusRoots = new Set();
  $('#focus-reset').classList.add('hidden');
  applyData(viewData());
}

function refreshStyles() {
  if (!graph) return;
  // re-setting an accessor to itself forces both libs to re-evaluate it
  ['nodeColor', 'linkColor', 'linkDirectionalArrowLength', 'nodeCanvasObject', 'nodeThreeObject'].forEach((m) => {
    if (graph[m]) { const cur = graph[m](); if (cur) graph[m](cur); }
  });
  // 3D: the lib accessors above paint nothing (nodes are empty objects); push the recomputed
  // highlight colors into the InstancedMesh + edge LineSegments instead.
  if (state.mode === '3d' && window.Instanced3d) Instanced3d.syncColors();
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

// 2D link-LOD: force-graph's onZoom fires on every pan/zoom frame. While the view is moving, edges
// (10k canvas strokes) are an unreadable blur — hide them (linkVisibility reads state._panning) so a
// pan stays smooth; ~300ms after the last move, restore them and nudge one redraw.
function onPan2d() {
  if (state.mode !== '2d') return;
  state._panning = true;
  clearTimeout(panTimer);
  panTimer = setTimeout(() => { state._panning = false; if (graph) refreshStyles(); }, 300);
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
    if (window.Warp) Warp.trigger(n);
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

// scan state.raw for what points at this node and what could. linked = an edge whose
// target is this node, or another node's body has [[this-id]]. unlinked = another node's
// body text contains this title (case-insensitive) with no existing edge either way.
const UNLINKED_CAP = 20;
function mentionLists(node) {
  const id = node.id;
  const incoming = new Set();                    // ids with an edge → this node
  const linkedEither = new Set();                // ids with an edge in either direction
  for (const l of state.raw.links) {
    if (l.target === id) { incoming.add(l.source); linkedEither.add(l.source); }
    if (l.source === id) linkedEither.add(l.target);
  }
  const wikiRe = new RegExp('\\[\\[\\s*' + id.replace(/[.*+?^${}()|[\]\\]/g, '\\$&') + '\\s*\\]\\]', 'i');
  const byId = new Map(state.raw.nodes.map((n) => [n.id, n]));
  const linkedIds = new Set(incoming);
  for (const n of state.raw.nodes) {
    if (n.id !== id && n.body && wikiRe.test(n.body)) linkedIds.add(n.id);
  }
  const linked = [...linkedIds].map((i) => byId.get(i)).filter(Boolean);

  const title = (node.title || '').trim();
  const unlinked = [];
  if (title) {
    const tlc = title.toLowerCase();
    for (const n of state.raw.nodes) {
      if (n.id === id || linkedEither.has(n.id) || linkedIds.has(n.id)) continue;
      if (n.body && n.body.toLowerCase().includes(tlc)) unlinked.push(n);
    }
  }
  return { linked, unlinked: unlinked.slice(0, UNLINKED_CAP), unlinkedMore: Math.max(0, unlinked.length - UNLINKED_CAP) };
}

function renderSidebar(node, nb) {
  const color = TYPE_COLORS[node.type] || '#8b9692';
  const others = nb.nodes.filter((n) => n.id !== node.id);
  const ment = mentionLists(node);
  const mentionRow = (n, withBtn) =>
    `<li class="mention" data-node="${esc(n.id)}">
       <i style="--tc:${TYPE_COLORS[n.type] || 'var(--dim)'}"></i>
       <span class="mention-title">${esc(n.title || n.id)}</span>
       ${withBtn ? `<button class="mention-link" data-link="${esc(n.id)}">Link</button>` : ''}</li>`;
  const relOf = (id) => {
    const l = nb.links.find((l) => (l.source === id && l.target === node.id) ||
                                   (l.source === node.id && l.target === id));
    if (!l) return '';
    return l.source === node.id ? `${l.rel} →` : `← ${l.rel}`;
  };
  sidebar.innerHTML = `
    <div class="side-rail"></div>
    <div class="sb-scroll">
    <button class="close" id="sb-close"><svg width="10" height="10" viewBox="0 0 10 10"><line x1="1" y1="1" x2="9" y2="9"/><line x1="9" y1="1" x2="1" y2="9"/></svg></button>
    <h2>${esc(node.title)}</h2>
    <div class="meta">
      <span class="type-badge" style="--c:${color}">${esc(node.type)}</span>
      <span class="mono dim">${esc(node.id)}</span>
    </div>
    ${node.tags.length ? `<div class="tags">${node.tags.map((t) =>
      `<span class="tag">${esc(t)}</span>`).join('')}</div>` : ''}
    <div class="body md">${renderBody(node.body)}</div>
    ${node.urls.length ? `<h3><span>links</span></h3><ul class="urls">${node.urls.map((u) =>
      `<li><a href="${esc(u.url)}" target="_blank" rel="noopener">${esc(u.label || u.url)}</a>
       <span class="kind">${esc(u.kind || 'web')}</span></li>`).join('')}</ul>` : ''}
    ${others.length ? `<h3><span>neighbors</span><span class="scount">${String(others.length).padStart(2, '0')}</span></h3><ul class="neighbors">${others.map((n, i) =>
      `<li class="neighbor" data-node="${esc(n.id)}" style="--type-c:${TYPE_COLORS[n.type] || 'var(--dim)'};--i:${i}">
         <span class="tree">${i === others.length - 1 ? '└─' : '├─'}</span>
         <span class="ntitle">${esc(n.title)}</span> <span class="mono dim">${esc(relOf(n.id))}</span></li>`).join('')}</ul>` : ''}
    ${ment.linked.length ? `<h3><span>linked mentions</span><span class="scount">${String(ment.linked.length).padStart(2, '0')}</span></h3><ul class="mentions">${ment.linked.map((n) =>
      mentionRow(n, false)).join('')}</ul>` : ''}
    ${ment.unlinked.length ? `<h3><span>unlinked mentions</span><span class="scount">${String(ment.unlinked.length).padStart(2, '0')}</span></h3><ul class="mentions">${ment.unlinked.map((n) =>
      mentionRow(n, true)).join('')}${ment.unlinkedMore ? `<li class="mention-more mono dim">+${ment.unlinkedMore} more</li>` : ''}</ul>` : ''}
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
    </div>
    </div>`;
  sidebar.classList.remove('hidden');
  // one-shot interrogation readout: plug in, sweep the rail, ping the neighbors
  sidebar.classList.remove('scanning');
  void sidebar.offsetWidth; // restart the one-shot when re-selecting
  sidebar.classList.add('scanning');
  const lastAnim = sidebar.querySelector('.neighbor:last-of-type') || sidebar;
  const unscan = () => sidebar.classList.remove('scanning');
  lastAnim.addEventListener('animationend', unscan, { once: true });
  setTimeout(unscan, 2500); // backstop (reduced-motion fires no animationend)

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
        <i style="--tc:${TYPE_COLORS[r.type] || 'var(--dim)'}"></i>${esc(r.title)}</li>`)
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
  // one-click "Link" on an unlinked mention: same /api/edge action, src = the mentioning
  // node → this node so it becomes a linked mention; rel 'mentions'. Then refresh the panel.
  sidebar.querySelectorAll('.mention-link').forEach((b) => {
    b.onclick = async (e) => {
      e.stopPropagation();
      await api('/api/edge', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ src: b.dataset.link, dst: node.id, rel: 'mentions' }),
      });
      await loadGraph();
      await selectNode(node.id);
    };
  });
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
  const t = e.target.closest('.wikilink, .neighbor, .mention');
  if (!t || !t.dataset.node) return;
  const id = t.dataset.node;
  if (!(await selectNode(id))) return; // unresolved wiki-link slug — don't focus
  if (state.focusRoots.size) spreadFocus(id);
  else setFocus(id);
});

// hovering a wiki-link/neighbor previews its neighborhood in the graph
sidebar.addEventListener('mouseover', (e) => {
  const t = e.target.closest('.wikilink, .neighbor, .mention');
  if (t && t.dataset.node) setHover(t.dataset.node);
});
sidebar.addEventListener('mouseout', (e) => {
  const t = e.target.closest('.wikilink, .neighbor, .mention');
  // only clear when the cursor actually left the row — not when moving between its
  // children (e.g. title → Link button), which would flicker the graph highlight
  if (t && !t.contains(e.relatedTarget)) setHover(null);
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
  `<button class="chip" data-type="${t}" aria-pressed="false">
     <span class="tlab"><i class="tport" style="--tc:${TYPE_COLORS[t]}"></i>${t}</span>
     <span class="track"><span class="bar"></span></span>
   </button>`).join('');
// busbar histogram: fixed-width tracks, bar = sqrt(count/max) so types are comparable
function updateChipShares() {
  const counts = {};
  for (const n of state.allNodes) counts[n.type] = (counts[n.type] || 0) + 1;
  const max = Math.max(1, ...Object.values(counts));
  chipsEl.querySelectorAll('.chip').forEach((c) => {
    const share = Math.sqrt((counts[c.dataset.type] || 0) / max);
    c.querySelector('.bar').style.setProperty('--share', share.toFixed(3));
  });
}
chipsEl.addEventListener('click', (e) => {
  const btn = e.target.closest('.chip');
  if (!btn) return;
  state.type = state.type === btn.dataset.type ? null : btn.dataset.type;
  chipsEl.querySelectorAll('.chip').forEach((c) => {
    const on = c.dataset.type === state.type;
    c.classList.toggle('active', on);
    c.setAttribute('aria-pressed', on);
  });
  loadGraph();
});

function setMode(mode) {
  if (state.mode === mode) return;
  state.mode = mode;
  $('#mode-2d').classList.toggle('active', mode === '2d');
  $('#mode-3d').classList.toggle('active', mode === '3d');
  $('#autorotate-toggle').classList.toggle('hidden', mode !== '3d');
  renderGraph(); // re-mount, same data + focus state
}
$('#mode-2d').onclick = () => setMode('2d');
$('#mode-3d').onclick = () => setMode('3d');
$('#autorotate-toggle').onclick = () => {
  state.settings.autoRotate = !state.settings.autoRotate;
  $('#autorotate-toggle').classList.toggle('active', state.settings.autoRotate);
  saveSettings();
  if (state.mode === '3d' && window.AutoRotate) AutoRotate.refresh();
};
$('#autorotate-toggle').classList.toggle('active', state.settings.autoRotate);

$('#focus-reset').onclick = clearFocus;

/* ---------- timeline strip ---------- */

let timelineMounted = false;
function onCutoff(T, dir) {
  state.timeline.cutoff = T;
  if (dir) state.timeline.dir = dir;
  applyData(viewData());
}
function showTimeline(on) {
  $('#timeline-strip').classList.toggle('hidden', !on);
  $('#timeline-toggle').classList.toggle('active', on);
  document.body.classList.toggle('timeline-open', on); // lift the cluster legend clear of the strip
  if (on) {
    if (!timelineMounted) { Timeline.mount($('#timeline'), { nodes: state.allNodes, onCutoff }); timelineMounted = true; }
    else Timeline.update(state.allNodes);
  } else {
    // hidden ⇒ no time filtering
    state.timeline.cutoff = null;
    applyData(viewData());
  }
}
$('#timeline-toggle').onclick = () => showTimeline($('#timeline-strip').classList.contains('hidden'));

// cycle off → recency → provenance; overrides node color without breaking community coloring
const COLOR_MODES = ['off', 'recency', 'provenance'];
$('#timeline-color').onclick = () => {
  const i = COLOR_MODES.indexOf(state.timeline.colorMode);
  state.timeline.colorMode = COLOR_MODES[(i + 1) % COLOR_MODES.length];
  $('#timeline-color').querySelector('b').textContent = state.timeline.colorMode;
  $('#timeline-color').classList.toggle('on', state.timeline.colorMode !== 'off');
  refreshStyles();
};

/* ---------- orphan finder ---------- */

function updateOrphanChip() {
  const btn = $('#orphan-chip');
  const n = orphanCount();
  btn.innerHTML = `<i class="tport"></i>orphans<span class="ocount">&middot;${n}</span>`;
  btn.classList.toggle('anomaly', n > 0);
  btn.classList.toggle('active', state.orphansOnly);
}
$('#orphan-chip').onclick = () => {
  state.orphansOnly = !state.orphansOnly;
  updateOrphanChip();
  applyData(viewData());
};

/* ---------- quick switcher (Cmd/Ctrl-O) ---------- */

const qsState = { items: [], sel: 0 };
function qsOpen() {
  $('#switcher').classList.remove('hidden');
  const inp = $('#sw-input');
  inp.value = ''; qsRender('');
  inp.focus();
}
function qsClose() { $('#switcher').classList.add('hidden'); }
function qsFilter(q) {
  const s = q.toLowerCase().trim();
  const ns = state.raw.nodes;
  if (!s) return ns.slice(0, 50);
  // substring on title then id; rank earlier matches higher
  return ns
    .map((n) => {
      const ti = (n.title || '').toLowerCase().indexOf(s);
      const ii = ti < 0 ? (n.id || '').toLowerCase().indexOf(s) : -1;
      const score = ti >= 0 ? ti : (ii >= 0 ? 1000 + ii : -1);
      return { n, score };
    })
    .filter((x) => x.score >= 0)
    .sort((a, b) => a.score - b.score)
    .slice(0, 50)
    .map((x) => x.n);
}
function qsRender(q) {
  qsState.items = qsFilter(q);
  qsState.sel = 0;
  $('#sw-results').innerHTML = qsState.items.map((n, i) =>
    `<li class="${i === 0 ? 'sel' : ''}" data-node="${esc(n.id)}">
       <i style="--tc:${TYPE_COLORS[n.type] || 'var(--dim)'}"></i>
       <span class="sw-title">${esc(n.title || n.id)}</span>
       <span class="mono dim">${esc(n.id)}</span></li>`).join('');
}
function qsMove(d) {
  const lis = $('#sw-results').querySelectorAll('li');
  if (!lis.length) return;
  lis[qsState.sel]?.classList.remove('sel');
  qsState.sel = (qsState.sel + d + lis.length) % lis.length;
  const cur = lis[qsState.sel];
  cur.classList.add('sel');
  cur.scrollIntoView({ block: 'nearest' });
}
async function qsChoose() {
  const n = qsState.items[qsState.sel];
  if (!n) return;
  qsClose();
  if (await selectNode(n.id)) { if (state.focusRoots.size) spreadFocus(n.id); }
}
$('#sw-input').addEventListener('input', () => qsRender($('#sw-input').value));
$('#sw-input').addEventListener('keydown', (e) => {
  if (e.key === 'ArrowDown') { e.preventDefault(); qsMove(1); }
  else if (e.key === 'ArrowUp') { e.preventDefault(); qsMove(-1); }
  else if (e.key === 'Enter') { e.preventDefault(); qsChoose(); }
  else if (e.key === 'Escape') { e.preventDefault(); qsClose(); }
});
$('#sw-input').addEventListener('blur', () => setTimeout(qsClose, 120)); // allow click on a row first
$('#sw-results').addEventListener('mousedown', (e) => {
  const li = e.target.closest('li[data-node]');
  if (!li) return;
  const i = [...$('#sw-results').children].indexOf(li);
  if (i >= 0) qsState.sel = i;
  qsChoose();
});

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
    applyEdgeFlow(graph);
    if (state.mode === '3d' && window.Glow3d) Glow3d.refresh();
    if (state.mode === '3d' && window.Starfield) Starfield.refresh();
    if (state.mode === '3d' && window.Bloom) Bloom.refresh();
    if (state.mode === '3d' && window.Warp) Warp.refresh();
    if (state.mode === '3d' && window.SpaceFx) SpaceFx.refresh();
  }
}

const RANGES = [
  ['Repulsion', 'charge', -800, -30, 10, 'physics'],
  ['Link distance', 'linkDist', 10, 120, 1, 'physics'],
  ['Link strength', 'linkStrength', 0, 1, 0.05, 'physics'],
  ['Gravity', 'gravity', 0, 0.3, 0.01, 'physics'],
  ['Link opacity', 'linkOpacity', 0, 1, 0.05, 'visual'],
];
const TOGGLES = [
  ['Collision', 'collide', 'physics'],
  ['Arrows', 'arrows', 'visual'],
  ['Starfield', 'starfield', 'visual'],
  ['Edge flow', 'edgeFlow', 'visual'],
  ['Bloom', 'bloom', 'visual'],
  ['Warp', 'warp', 'visual'],
  ['Ambient', 'ambient', 'visual'],
];

function renderSettings() {
  const s = state.settings;
  const rangeRow = ([label, key, min, max, step, kind]) => `
    <div class="ctl-row"><label>${label}</label><output data-ro="${key}">${s[key]}</output></div>
    <input type="range" data-key="${key}" data-kind="${kind}" min="${min}" max="${max}" step="${step}" value="${s[key]}">`;
  const toggleRow = ([label, key, kind]) => `
    <button class="seg-toggle ${s[key] ? 'on' : ''}" data-key="${key}" data-kind="${kind}">${label} <b>${s[key] ? 'on' : 'off'}</b></button>`;
  $('#settings').innerHTML = `
    <button class="close" id="set-close"><svg width="10" height="10" viewBox="0 0 10 10"><line x1="1" y1="1" x2="9" y2="9"/><line x1="9" y1="1" x2="1" y2="9"/></svg></button>
    <h2>settings</h2>
    <h3><span>theme</span></h3>
    <div class="panel theme-list">
      ${Object.keys(THEMES).map((k) => `
        <button class="theme-opt ${s.theme === k ? 'on' : ''}" data-theme="${k}">
          <span class="sw" style="--tbg:${THEMES[k]['--bg']};--tac:${THEMES[k]['--green']}"></span>${THEME_NAMES[k]}
        </button>`).join('')}
    </div>
    <h3><span>physics</span></h3>
    <div class="panel">
      ${RANGES.filter((r) => r[5] === 'physics').map(rangeRow).join('')}
      ${TOGGLES.filter((t) => t[2] === 'physics').map(toggleRow).join('')}
    </div>
    <h3><span>visual</span></h3>
    <div class="panel">
      ${RANGES.filter((r) => r[5] === 'visual').map(rangeRow).join('')}
      ${TOGGLES.filter((t) => t[2] === 'visual').map(toggleRow).join('')}
      <label>labels</label>
      <div class="seg labels-seg">
        ${['off', 'hover', 'hubs', 'always'].map((m) =>
          `<button data-mode="${m}" class="${s.labelMode === m ? 'active' : ''}">${m}</button>`).join('')}
      </div>
    </div>
    <h3><span>clusters</span></h3>
    <div class="panel">
      <button class="seg-toggle ${s.colorBy === 'community' ? 'on' : ''}" id="set-colorby">Color by <b>${s.colorBy}</b></button>
      <button class="seg-toggle ${s.showHulls ? 'on' : ''}" data-key="showHulls" data-kind="cluster">Topic glow <b>${s.showHulls ? 'on' : 'off'}</b></button>
      <button class="seg-toggle ${s.showClusterLabels ? 'on' : ''}" data-key="showClusterLabels" data-kind="cluster">Cluster labels <b>${s.showClusterLabels ? 'on' : 'off'}</b></button>
      <button class="seg-toggle ${s.clusterForce ? 'on' : ''}" data-key="clusterForce" data-kind="physics">Topic repulsion <b>${s.clusterForce ? 'on' : 'off'}</b></button>
    </div>
    <div class="actions"><button id="set-reset">Reset to defaults</button></div>`;
  $('#settings').classList.remove('hidden');
  $('#set-close').onclick = () => $('#settings').classList.add('hidden');
  $('#set-reset').onclick = () => {
    state.settings = { ...SETTINGS_DEFAULTS };
    saveSettings(); renderSettings(); applyTheme(state.settings.theme); applyForces(graph);
    state._needFit = true; graph.d3ReheatSimulation(); refreshStyles();
    applyEdgeFlow(graph);
    if (state.mode === '3d' && window.Glow3d) Glow3d.refresh();
    if (state.mode === '3d' && window.Starfield) Starfield.refresh();
    if (state.mode === '3d' && window.Bloom) Bloom.refresh();
    if (state.mode === '3d' && window.Warp) Warp.refresh();
    if (state.mode === '3d' && window.SpaceFx) SpaceFx.refresh();
  };
  $('#settings').querySelectorAll('input[type=range]').forEach((el) => {
    el.oninput = () => {
      state.settings[el.dataset.key] = parseFloat(el.value);
      const ro = $('#settings').querySelector(`output[data-ro="${el.dataset.key}"]`);
      if (ro) ro.textContent = el.value;
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
    if (state.mode === '3d' && window.Glow3d) Glow3d.refresh();
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
  el.innerHTML = `<h3><span>clusters</span><span class="scount">${C.k}</span></h3><ul>` + C.communities.map((c) =>
    `<li class="leg ${state.activeCluster === c.idx ? 'active' : ''}" data-c="${c.idx}">
       <i style="--tc:${c.color}"></i>${esc(c.hubTitle)} <span class="mono dim">${c.size}</span></li>`).join('') + '</ul>';
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

const toggleHelp = () => $('#help').classList.toggle('hidden');
$('#help-toggle').onclick = toggleHelp;
$('#help-close').onclick = () => $('#help').classList.add('hidden');
$('#help').onclick = (e) => { if (e.target === $('#help')) $('#help').classList.add('hidden'); };  // click backdrop to close

function inField(el) {
  return el && (el.tagName === 'INPUT' || el.tagName === 'TEXTAREA' || el.tagName === 'SELECT' || el.isContentEditable);
}
document.addEventListener('keydown', (e) => {
  // quick switcher — don't hijack typing in a field (its own input handles its keys)
  if ((e.metaKey || e.ctrlKey) && (e.key === 'o' || e.key === 'O') && !inField(e.target)) {
    e.preventDefault();
    qsOpen();
    return;
  }
  // '?' toggles the shortcuts cheat sheet (not while typing in a field)
  if (e.key === '?' && !inField(e.target)) {
    e.preventDefault();
    toggleHelp();
    return;
  }
  // Escape cascade for overlays — but not while typing in a header field, so the
  // input's own Escape (native clear / switcher's own handler) isn't stolen
  if (e.key === 'Escape' && !inField(e.target)) {
    if (!$('#help').classList.contains('hidden')) $('#help').classList.add('hidden');
    else if (!$('#switcher').classList.contains('hidden')) qsClose();
    else if (!$('#settings').classList.contains('hidden')) $('#settings').classList.add('hidden');
    else if (state.focusRoots.size) clearFocus();
    else closeSidebar();
  }
});

window.addEventListener('resize', () => {
  if (graph) graph.width(graphEl.clientWidth).height(graphEl.clientHeight);
});

applyTheme(state.settings.theme);
loadGraph();
