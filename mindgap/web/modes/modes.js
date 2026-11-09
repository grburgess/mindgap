/* mindgap 3D view modes — a registry of alternative layouts for the 3D view (settings.viewMode).
   'graph' is the default force layout and is NOT a registered mode: it is "no mode active". Every other
   mode lives in its own file (web/modes/<name>.js) and calls Modes.register(name, spec) at load; add a
   mode = add a file + a <script> tag, no edits to other modes.

   spec: { allowsDrag: boolean,
           drawsNodes?: boolean                    true → instanced3d hides its node mesh/hubs/edges (still picks)
           layout(data, ctx) → Map id → {x,y,z}   fixed position for every node (framework pins them),
           enter(graph, data, ctx)                 add scene decorations (one Mesh/Points/LineSegments each),
           exit()                                  remove them,
           tick(now)?                              optional per-frame motion (must move n.x/y/z itself, cheaply),
           linkAlpha(link)?                        → edge alpha multiplier (hovered/selected node's links stay full),
           graphFx?: false                         hide graph-mode edge photons/arrows/hub glow,
           nodeScale?: number                      node sphere size multiplier (default 1),
           debug()?                                → plain object merged into Modes.debug() }

   Framework contract (fixed-layout modes): on enter it snapshots every node's graph position, stops the
   force sim (cooldownTicks(0) — the engine halts before its first tick, so no O(N+E) charge ticks) and
   pins nodes to the layout (fx/fy/fz); node drag is gated via allowsDrag (instanced3d asks ctx.allowDrag).
   On exit it unpins, restores the snapshot exactly and the cooldown, so Graph comes back with its
   forces, drag and positions; nodes with no snapshot (added mid-mode, or the mode was entered before
   the first layout) get a seed spiral and a reheat recomputes the layout around them. Data swaps (filters,
   search, focus, timeline) call dataChanged() → re-layout + re-decorate; instanced3d rebuilds after.
   ctx (from app.js): { getSettings(), nodeColorFor(n), nodeVal(n) }. 3D-only. */
'use strict';
(function () {
  const ALL = ['graph', 'universe', 'matrix', 'orb', 'brain', 'genesis'];   // picker order; unregistered = "soon"
  const reg = new Map();
  let graph = null, ctx = null, cur = 'graph', spec = null;
  let saved = null, savedCooldown = Infinity, raf = 0, still = false;

  function register(name, s) { if (name !== 'graph') reg.set(name, s); }
  function want() { const v = ctx && ctx.getSettings().viewMode; return reg.has(v) ? v : 'graph'; }

  function pinLayout() {
    const d = graph.graphData(), pos = spec.layout(d, ctx);
    for (const n of d.nodes) {
      const p = pos.get(n.id); if (!p) continue;
      n.x = n.fx = p.x; n.y = n.fy = p.y; n.z = n.fz = p.z;
      n.vx = 0; n.vy = 0; n.vz = 0;
    }
    spec.enter(graph, d, ctx);
  }
  function fit() { setTimeout(() => { if (graph) graph.zoomToFit(600, 60); }, 30); }
  function refreshBloom() { if (window.Bloom) Bloom.refresh(); }   // idle-gated bloom must re-render the new glow set
  // motion.js aliveDrift: vetoed in fixed-layout modes (every node pinned), allowed in graph + genesis;
  // the refresh re-arms drift after a suspendDrift() around the snapshot/restore
  function syncMotion() {
    if (!window.Motion) return;
    Motion.setDriftAllowed(allowsDrag(), 'paused in fixed layouts');
    Motion.refresh();
  }
  function restyle() { if (window.Instanced3d && Instanced3d.syncColors) Instanced3d.syncColors(); }   // edge alphas follow linkK()
  function refreshVis() { if (window.Instanced3d && Instanced3d.applyModeVis) Instanced3d.applyModeVis(); }

  function loop() {
    if (!spec || !spec.tick) { raf = 0; return; }
    raf = requestAnimationFrame(loop);
    if (!document.hidden) spec.tick(performance.now());
  }
  function stopLoop() { if (raf) { cancelAnimationFrame(raf); raf = 0; } }

  function enter(name) {
    spec = reg.get(name); cur = name;
    if (window.Motion) Motion.suspendDrift();     // drift-free snapshot (motion.js aliveDrift)
    const d = graph.graphData();
    saved = new Map();
    for (const n of d.nodes) if (Number.isFinite(n.x)) saved.set(n.id, { x: n.x, y: n.y, z: n.z || 0 });
    savedCooldown = graph.cooldownTicks();
    graph.cooldownTicks(0);                       // sim halts before its next tick (no force cost while pinned)
    pinLayout();
    still = !!(window.matchMedia && matchMedia('(prefers-reduced-motion: reduce)').matches);
    if (spec.tick && !still) loop();
    restyle(); refreshVis(); refreshBloom(); fit();
    syncMotion();
  }
  function leave(restore) {
    if (!spec) return;
    stopLoop();
    spec.exit();
    spec = null; refreshVis();                     // instanced3d takes node drawing back (before the bloom refresh)
    if (restore && graph && window.Motion) Motion.suspendDrift();   // restore the drift-free snapshot exactly
    if (restore && graph) {
      const d = graph.graphData();
      let k = 0;                                   // nodes with no snapshot (arrived mid-mode / entered pre-layout)
      for (const n of d.nodes) {
        n.fx = n.fy = n.fz = undefined; n.vx = 0; n.vy = 0; n.vz = 0;
        const p = saved && saved.get(n.id);
        if (p) { n.x = p.x; n.y = p.y; n.z = p.z; continue; }
        const r = 10 * Math.cbrt(0.5 + k), a = k * 2.399963, b = k * 1.3; k++;   // seed spiral (d3-force-3d style)
        n.x = r * Math.cos(a) * Math.sin(b + 1); n.y = r * Math.sin(a) * Math.sin(b + 1); n.z = r * Math.cos(b + 1);
      }
      graph.cooldownTicks(savedCooldown);         // forces back on for the next reheat/drag
      // exact snapshot restore needs no reheat (a reheat of a big settled map re-flows it by
      // hundreds of units); only unsnapshotted nodes need the forces to place them
      if (k) graph.d3ReheatSimulation();
      refreshBloom(); fit();
    }
    cur = 'graph'; saved = null;
    if (restore && graph) syncMotion();
    if (restore) restyle();
  }

  // switch to settings.viewMode (no-op when already there or not installed)
  function sync() {
    if (!graph) return;
    const w = want();
    if (w === cur) return;
    leave(true);
    if (w !== 'graph') enter(w);
  }
  function install(g, c) { teardown(); graph = g; ctx = c; cur = 'graph'; sync(); syncMotion(); }   // veto may be stale (viewMode changed while unmounted)
  // graph is being destroyed (remount): drop decorations, nothing to restore
  function teardown() { leave(false); graph = null; ctx = null; }
  // graphData swapped (filters/search/focus/timeline) or theme changed: re-layout + re-decorate
  function dataChanged() {
    if (!graph || !spec) return;
    const d = graph.graphData();
    for (const n of d.nodes) if (!saved.has(n.id)) saved.set(n.id, null);   // mid-mode arrivals: seed spiral on exit
    spec.exit(); pinLayout(); refreshBloom();
  }
  function allowsDrag() { return !spec || !!spec.allowsDrag; }
  // edge alpha multiplier for link l (spec.linkAlpha; 1 = untouched) — app.js linkColorFor applies it
  function linkK(l) { return spec && spec.linkAlpha ? spec.linkAlpha(l) : 1; }
  // false → instanced3d hides graph-mode FX (edge photons, arrows, hub bloom spheres) for this mode
  function graphFx() { return !spec || spec.graphFx !== false; }
  function nodeScale() { return spec && spec.nodeScale ? spec.nodeScale : 1; }   // node sphere size multiplier
  function drawsNodes() { return !!(spec && spec.drawsNodes); }

  // Look-section "view" picker. Unregistered modes render disabled "soon".
  function pickerHtml(active) {
    const a = reg.has(active) ? active : 'graph';
    return `<label>view <span class="dim">3D</span></label>
      <div class="seg view-seg">${ALL.map((m) => (m === 'graph' || reg.has(m))
        ? `<button data-view="${m}" class="${m === a ? 'active' : ''}">${m}</button>`
        : `<button data-view="${m}" disabled title="coming soon">${m} <i>soon</i></button>`).join('')}</div>`;
  }
  function bindPicker(root, onPick) {
    root.querySelectorAll('.view-seg button[data-view]:not([disabled])').forEach((b) => { b.onclick = () => onPick(b.dataset.view); });
  }

  function debug() {
    return Object.assign({ current: cur, available: ['graph', ...reg.keys()], allowsDrag: allowsDrag(), drawsNodes: drawsNodes(),
      cooldownTicks: graph ? graph.cooldownTicks() : null, moving: !!raf }, spec && spec.debug ? spec.debug() : {});
  }

  window.Modes = { register, install, teardown, sync, dataChanged, allowsDrag, linkK, graphFx, nodeScale, drawsNodes, pickerHtml, bindPicker, debug,
    current: () => cur };
})();
