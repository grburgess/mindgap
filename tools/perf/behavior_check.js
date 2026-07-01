/* mindgap 3D fidelity behavioral test suite.
 *
 * Injected into a running page (3D mode). Installs window.__mmBehave with checks that probe the
 * instanced renderer + state and return objective { pass, ... } results, comparing current 3D
 * behavior to the pre-instancing reference (linkOpacity honored, highlight dim/green, type color +
 * degree size, direction arrows, edges follow a moved node). Tooltip + full real-mouse drag are
 * checked by the driver (Playwright) since they need real pointer events; this suite covers the rest.
 *
 * Reaches state via window.__mm (app.js instrumentation) + window.Instanced3d (syncColors). Requires
 * 3D mode active. Every method returns a plain JSON-serializable object. */
'use strict';
(function () {
  const g = () => window.__mm && window.__mm.graph;
  const st = () => window.__mm && window.__mm.state;
  const T = () => window.THREE;

  function scene() { return g() && g().scene(); }
  function instMesh() { let m = null; scene().traverse((o) => { if (o.isInstancedMesh && !(o.userData && o.userData.arrows)) m = o; }); return m; }  // NODES mesh, not the arrows mesh
  function edgeSeg() { let e = null; scene().traverse((o) => { if (o.isLineSegments && o.geometry.attributes.position.count > 1000) e = o; }); return e; }
  const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
  const raf = () => new Promise((r) => requestAnimationFrame(() => r()));

  // C1 — link opacity: changing state.settings.linkOpacity must change the rendered edge alpha.
  async function linkOpacity() {
    const s = st(), e = edgeSeg();
    if (!e) return { pass: false, note: 'no edge LineSegments found' };
    const probe = () => {
      const mat = e.material;
      const col = e.geometry.attributes.color;
      // effective alpha ≈ material.opacity (global) * (per-vertex alpha if a 4-component color attr exists)
      const itemSize = col ? col.itemSize : 0;
      const vAlpha = (itemSize === 4) ? col.array[3] : null;         // per-vertex alpha only if RGBA
      return { matOpacity: +mat.opacity.toFixed(3), transparent: mat.transparent, colorItemSize: itemSize, vertexAlpha: vAlpha };
    };
    const orig = s.settings.linkOpacity;
    s.settings.linkOpacity = 0.05; if (window.Instanced3d) window.Instanced3d.syncColors(); await raf();
    const low = probe();
    s.settings.linkOpacity = 0.6; if (window.Instanced3d) window.Instanced3d.syncColors(); await raf();
    const high = probe();
    s.settings.linkOpacity = orig; if (window.Instanced3d) window.Instanced3d.syncColors();
    // effective alpha at low vs high must differ (via material.opacity or per-vertex alpha)
    const eff = (p) => (p.vertexAlpha != null ? p.vertexAlpha : p.matOpacity);
    const changed = Math.abs(eff(low) - eff(high)) > 0.05 && eff(low) < eff(high);
    return { pass: changed, low, high, note: changed ? 'edge alpha tracks linkOpacity' : 'edge alpha does NOT change with linkOpacity (hardcoded)' };
  }

  // C3 — highlight: setting a hover highlight must dim non-neighbours + green the node/neighbours.
  async function highlight() {
    const s = st(), inst = instMesh();
    if (!inst || !inst.instanceColor) return { pass: false, note: 'no instanced colors' };
    const nodes = g().graphData().nodes;
    const hub = nodes.slice().sort((a, b) => (b._deg || 0) - (a._deg || 0))[0];
    const nbs = new Set(); for (const l of s.raw.links) { const so = l.source.id ?? l.source, ta = l.target.id ?? l.target; if (so === hub.id) nbs.add(ta); if (ta === hub.id) nbs.add(so); }
    const idxOf = (id) => nodes.findIndex((n) => n.id === id);
    const nonNbr = nodes.find((n) => n.id !== hub.id && !nbs.has(n.id));
    const C = new (T().Color)();
    const colOf = (id) => { inst.getColorAt(idxOf(id), C); return C.getHex(); };
    const before = colOf(nonNbr.id);
    s.hoverHl = { id: hub.id, nbs };
    if (window.Instanced3d) window.Instanced3d.syncColors(); await raf();
    const afterNon = colOf(nonNbr.id);
    const afterHub = colOf(hub.id);
    s.hoverHl = null; if (window.Instanced3d) window.Instanced3d.syncColors();
    const dimmed = afterNon !== before;                              // non-neighbour changed (dimmed) under highlight
    return { pass: dimmed, note: dimmed ? 'non-neighbour dims on highlight' : 'highlight does NOT dim non-neighbours', hub: hub.id, before: '#' + before.toString(16), afterNonNbr: '#' + afterNon.toString(16), afterHub: '#' + afterHub.toString(16) };
  }

  // C5 — color + size: type color correct + degree drives sphere size.
  async function colorSize() {
    const inst = instMesh();
    if (!inst || !inst.instanceColor) return { pass: false, note: 'no instanced colors' };
    const nodes = g().graphData().nodes, C = new (T().Color)(), M = new (T().Matrix4)(), V = new (T().Vector3)();
    const idx = (n) => nodes.indexOf(n);
    const colorHexOf = (n) => { inst.getColorAt(idx(n), C); return '#' + C.getHexString(); };
    const scaleOf = (n) => { inst.getMatrixAt(idx(n), M); V.setFromMatrixScale(M); return +V.x.toFixed(2); };
    const concept = nodes.find((n) => n.type === 'concept'), paper = nodes.find((n) => n.type === 'paper');
    const sorted = nodes.slice().sort((a, b) => (b._deg || 0) - (a._deg || 0));
    const hub = sorted[0], leaf = sorted[sorted.length - 1];
    const conceptOK = concept ? colorHexOf(concept) === '#57c7a4' : true;
    const paperOK = paper ? colorHexOf(paper) === '#e76f51' : true;
    const sizeOK = scaleOf(hub) > scaleOf(leaf);
    return { pass: conceptOK && paperOK && sizeOK, conceptColor: concept && colorHexOf(concept), paperColor: paper && colorHexOf(paper), hubScale: scaleOf(hub), leafScale: scaleOf(leaf), note: (conceptOK && paperOK) ? 'type colors ok' : 'type colors WRONG' };
  }

  // C6 — arrows: direction arrows present on links when the arrows setting is on. FORCE the setting on
  // first (else it false-passes when arrows are off) and require a VISIBLE arrows InstancedMesh w/ count>0.
  async function arrows() {
    const s = st();
    const orig = s.settings.arrows;
    s.settings.arrows = true; await raf();                          // loop() reads the setting for .visible
    let arrowMesh = null, arrowInst = 0;
    scene().traverse((o) => {
      if (o.isInstancedMesh && o.userData && o.userData.arrows) { arrowMesh = o; arrowInst += o.count; }
    });
    const present = !!arrowMesh && arrowInst > 0 && arrowMesh.visible;
    s.settings.arrows = orig;                                       // restore
    return { pass: present, arrowInstances: arrowInst, visible: !!arrowMesh && arrowMesh.visible, note: present ? 'visible arrows InstancedMesh present' : 'NO visible arrows InstancedMesh in 3D' };
  }

  // Tooltip element: the 3D install creates #__mm_tip on document.body. Its existence is the automated
  // signal; real hover-shows-text is verified by a human/real-mouse driver.
  async function tooltip() {
    const el = document.querySelector('#__mm_tip');
    return { pass: !!el, note: el ? 'tooltip element present' : 'NO #__mm_tip tooltip element' };
  }

  // C2 (mechanism) — moving a node updates its incident edge endpoints in the LineSegments buffer.
  async function dragEdges() {
    const inst = instMesh(), e = edgeSeg();
    if (!inst || !e) return { pass: false, note: 'missing inst/edges' };
    const links = g().graphData().links;
    let li = -1; const nodes = g().graphData().nodes;
    const hub = nodes.slice().sort((a, b) => (b._deg || 0) - (a._deg || 0))[0];
    for (let i = 0; i < links.length; i++) { const so = links[i].source, ta = links[i].target; if ((so.id ?? so) === hub.id || (ta.id ?? ta) === hub.id) { li = i; break; } }
    if (li < 0) return { pass: false, note: 'hub has no incident link' };
    const pos = e.geometry.attributes.position.array, o = li * 6;
    const before = [pos[o], pos[o + 1], pos[o + 2], pos[o + 3], pos[o + 4], pos[o + 5]].map((x) => x | 0);
    const ox = hub.x; hub.fx = hub.x = hub.x + 300;                  // move the hub node
    await raf(); await raf();                                        // let the sync loop rewrite endpoints
    const after = [pos[o], pos[o + 1], pos[o + 2], pos[o + 3], pos[o + 4], pos[o + 5]].map((x) => x | 0);
    hub.fx = null; hub.x = ox;                                       // restore
    const moved = before.some((v, i) => Math.abs(v - after[i]) > 50);
    return { pass: moved, note: moved ? 'incident edge endpoints follow the moved node' : 'edges do NOT follow a moved node', before, after };
  }

  async function all() {
    const out = {};
    for (const k of ['linkOpacity', 'highlight', 'colorSize', 'arrows', 'tooltip', 'dragEdges']) {
      try { out[k] = await window.__mmBehave[k](); } catch (err) { out[k] = { pass: false, error: String(err) }; }
    }
    out.summary = Object.keys(out).filter((k) => k !== 'summary').map((k) => `${k}:${out[k].pass ? 'PASS' : 'FAIL'}`).join('  ');
    out.allPass = Object.keys(out).every((k) => k === 'summary' || out[k].pass);
    return out;
  }

  window.__mmBehave = { linkOpacity, highlight, colorSize, arrows, tooltip, dragEdges, all };
  return { installed: true, mode: st() && st().mode };
})();
