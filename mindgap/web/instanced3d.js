/* mindgap 3D draw-call collapse — the 3d-force-graph default renders each node as its own
   Mesh and each link as its own Line (~27.7k draw calls on 5k nodes / 10k edges → ~1.5 FPS). This
   module replaces that with ONE InstancedMesh (all node spheres) + ONE LineSegments (all edges) →
   ~100 draw calls. app.js sets .nodeThreeObject(()=>empty Object3D).linkVisibility(false) so the lib
   still runs the sim (binding link.source/target to node objects, positioning nodes) but paints
   nothing; we read those positions each frame and rewrite the instance matrices + line endpoints.

   The lib's built-in hover/click is dead (nodes are empty objects), so we raycast the InstancedMesh
   ourselves. Bloom (bloom.js) hides every object whose userData.bloom !== true during its offscreen
   pass; the big InstancedMesh stays untagged (no glow, else the whole cloud haze-bombs), and hubs get
   a small MeshBasicMaterial sphere with userData.bloom=true layered on top so only they glow.

   ctx (from app.js): { nodes(), links(), nodeColorFor(n), linkColorFor(l), nodeVal(n), hubIds()→Set,
   onHover(node|null), onClick(node) }. THREE from window.THREE (ESM shim in index.html). 3D-only. */
'use strict';
(function () {
  let graph = null, ctx = null, warned = false;
  let inst = null, lines = null;          // the one node mesh + the one edge geometry
  let hubMeshes = [];                      // small per-hub bloom spheres (≤~28), synced in the loop
  let hubMap = [];                         // parallel: hubMeshes[i] tracks node hubMap[i]
  let raf = 0, frame = 0;
  let photons = null, photonPhase = null;   // edge-flow: ONE Points cloud, a flowing point per edge
  const PHOTON_SPEED = 0.006;               // fraction of an edge advanced per frame
  let onMove = null, onClick = null, onDownH = null, onUpH = null;
  let raycaster = null, ndc = null, dummy = null;
  let lastHover = -1, moveT = 0;
  // node-drag (the lib's drag is dead on empty node objects, so we do it on the InstancedMesh):
  let ctrls = null, down = null, dragging = false, justDragged = false;
  let dragPlane = null, _v3a = null, _v3b = null;
  const HUB_R = 1;                          // bloom-sphere base radius; scaled per-node in the loop

  function THREE() { return window.THREE || null; }

  // node sphere radius from nodeVal (a volume-ish degree number): cbrt so hubs read bigger without
  // dwarfing the field. tuned to roughly match the lib's default val→radius feel.
  function radiusOf(n) { return Math.cbrt(Math.max(ctx.nodeVal(n), 0.01)) * 4; }

  // THREE.Color rejects rgba() (the alpha); strip to the rgb triple. hex/named pass straight through.
  const _col = { r: 0, g: 0, b: 0 };
  function parseColor(css) {
    const T = THREE();
    const s = String(css);
    if (s.indexOf('rgba') === 0 || (s.indexOf('rgb') === 0)) {
      const m = s.match(/[\d.]+/g);
      if (m && m.length >= 3) return new T.Color(+m[0] / 255, +m[1] / 255, +m[2] / 255);
    }
    return new T.Color(s);
  }

  function hasPos(n) { return n && n.x != null && Number.isFinite(n.x); }

  function build() {
    const T = THREE(); if (!T || !graph) return;
    clear();
    const nodes = ctx.nodes(), links = ctx.links();

    // A. NODES → one InstancedMesh. Lambert (scene has Ambient+Directional). Per-instance color via
    // setColorAt — three's USE_INSTANCING_COLOR path applies instanceColor automatically. Do NOT set
    // vertexColors:true: that makes the shader read a (missing) geometry color attribute → all black.
    const geo = new T.SphereGeometry(1, 8, 6);
    const mat = new T.MeshLambertMaterial({});
    inst = new T.InstancedMesh(geo, mat, nodes.length || 1);
    inst.frustumCulled = false;             // we manage the bounding sphere on the shared geometry
    for (let i = 0; i < nodes.length; i++) {
      const n = nodes[i];
      if (hasPos(n)) { dummy.position.set(n.x, n.y, n.z || 0); dummy.scale.setScalar(radiusOf(n)); }
      else { dummy.position.set(0, 0, 0); dummy.scale.setScalar(0); }   // hidden until positioned
      dummy.updateMatrix(); inst.setMatrixAt(i, dummy.matrix);
      inst.setColorAt(i, parseColor(ctx.nodeColorFor(n)));
    }
    inst.instanceMatrix.needsUpdate = true;
    if (inst.instanceColor) inst.instanceColor.needsUpdate = true;
    inst.computeBoundingSphere();           // InstancedMesh sphere spans all instances — REQUIRED for hover raycast
    graph.scene().add(inst);

    // B. EDGES → one LineSegments. 2 endpoints/link. Color is RGBA (itemSize 4) so per-edge alpha
    // works — three enables USE_COLOR_ALPHA for 4-component vertex colors, letting linkColorFor's
    // rgba() (which bakes in state.settings.linkOpacity + the highlight alphas) drive edge opacity.
    const lgeo = new T.BufferGeometry();
    const lpos = new Float32Array(links.length * 2 * 3);
    const lcol = new Float32Array(links.length * 2 * 4);
    lgeo.setAttribute('position', new T.BufferAttribute(lpos, 3));
    lgeo.setAttribute('color', new T.BufferAttribute(lcol, 4));
    const lmat = new T.LineBasicMaterial({ vertexColors: true, transparent: true, depthWrite: false });
    lines = new T.LineSegments(lgeo, lmat);
    lines.frustumCulled = false;
    graph.scene().add(lines);
    writeLinePositions();
    writeLineColors();

    // C2. EDGE-FLOW PHOTONS → one THREE.Points, one flowing point per edge (10k points = 1 draw call).
    // Restores the "energy along links" FX that linkVisibility(false) removed, at ~0 cost. Additive
    // green; positions = lerp(src,tgt,phase) advanced each frame in the loop.
    const pcount = links.length;
    photonPhase = new Float32Array(pcount);
    for (let i = 0; i < pcount; i++) photonPhase[i] = (i * 0.147) % 1;   // spread starts, no RNG needed
    const pgeo = new T.BufferGeometry();
    pgeo.setAttribute('position', new T.BufferAttribute(new Float32Array(pcount * 3), 3));
    const pmat = new T.PointsMaterial({ color: 0x57c7a4, size: 2.4, sizeAttenuation: true,
      transparent: true, opacity: 0.9, blending: T.AdditiveBlending, depthWrite: false });
    photons = new T.Points(pgeo, pmat);
    photons.frustumCulled = false;
    graph.scene().add(photons);

    // E. HUB BLOOM: small individual spheres for the hub nodes so only they glow (the big instanced
    // mesh stays untagged). Positions synced in the loop; colors are static (hub hue on build).
    buildHubs();
  }

  function buildHubs() {
    const T = THREE();
    hubMeshes = []; hubMap = [];
    const set = ctx.hubIds() || new Set();
    if (!set.size) return;
    const hgeo = new T.SphereGeometry(1, 8, 6);   // shared geometry across hub spheres
    for (const n of ctx.nodes()) {
      if (!set.has(n.id)) continue;
      const m = new T.Mesh(hgeo, new T.MeshBasicMaterial({ color: parseColor(ctx.nodeColorFor(n)) }));
      m.userData.bloom = true;                     // bloom.js: only tagged objects glow
      m.frustumCulled = false; m.visible = hasPos(n);
      graph.scene().add(m);
      hubMeshes.push(m); hubMap.push(n);
    }
  }

  // rewrite every line endpoint from current node positions. src/tgt are node OBJECTS post-bind;
  // pre-bind they may still be string ids — skip those (leave 0,0,0 until the sim binds them).
  function writeLinePositions() {
    if (!lines) return;
    const links = ctx.links(), p = lines.geometry.attributes.position.array;
    for (let i = 0; i < links.length; i++) {
      const l = links[i], s = l.source, t = l.target, o = i * 6;
      if (s && typeof s === 'object' && t && typeof t === 'object' && hasPos(s) && hasPos(t)) {
        p[o] = s.x; p[o + 1] = s.y; p[o + 2] = s.z || 0;
        p[o + 3] = t.x; p[o + 4] = t.y; p[o + 5] = t.z || 0;
      } else { p[o] = p[o + 1] = p[o + 2] = p[o + 3] = p[o + 4] = p[o + 5] = 0; }
    }
    lines.geometry.attributes.position.needsUpdate = true;
  }
  function writeLineColors() {
    if (!lines) return;
    const links = ctx.links(), c = lines.geometry.attributes.color.array;
    for (let i = 0; i < links.length; i++) {
      const css = String(ctx.linkColorFor(links[i]));            // rgba() with per-edge alpha (opacity/highlight)
      const col = parseColor(css);
      let a = 1; if (css.indexOf('rgba') === 0) { const m = css.match(/[\d.]+/g); if (m && m.length >= 4) a = +m[3]; }
      const o = i * 8;                                            // 2 verts × RGBA(4)
      c[o] = c[o + 4] = col.r; c[o + 1] = c[o + 5] = col.g; c[o + 2] = c[o + 6] = col.b; c[o + 3] = c[o + 7] = a;
    }
    lines.geometry.attributes.color.needsUpdate = true;
  }

  function clear() {
    const rm = (o) => { if (graph && o) { graph.scene().remove(o); if (o.geometry) o.geometry.dispose(); if (o.material) o.material.dispose(); } };
    rm(inst); rm(lines); rm(photons);
    for (const m of hubMeshes) rm(m);
    inst = null; lines = null; photons = null; photonPhase = null; hubMeshes = []; hubMap = [];
  }

  // C. POSITION SYNC — each frame copy node x/y/z into instance matrices + line endpoints. This is
  // O(N+E) float writes, cheap vs draw calls; NO recolor here. Bounding sphere recomputed every ~30
  // frames (for the still-frustum-culled line/instance culling), not per frame.
  function loop() {
    if (!inst) { raf = 0; return; }
    raf = requestAnimationFrame(loop);
    if (document.hidden) return;
    const nodes = ctx.nodes();
    for (let i = 0; i < nodes.length; i++) {
      const n = nodes[i];
      if (hasPos(n)) { dummy.position.set(n.x, n.y, n.z || 0); dummy.scale.setScalar(radiusOf(n)); }
      else { dummy.scale.setScalar(0); }
      dummy.updateMatrix(); inst.setMatrixAt(i, dummy.matrix);
    }
    inst.instanceMatrix.needsUpdate = true;
    writeLinePositions();
    if (photons) {                          // advance + reposition edge-flow points along their edges
      const links = ctx.links(), pp = photons.geometry.attributes.position.array;
      for (let i = 0; i < links.length; i++) {
        const l = links[i], s = l.source, t = l.target, o = i * 3;
        if (s && typeof s === 'object' && t && typeof t === 'object' && hasPos(s) && hasPos(t)) {
          let ph = photonPhase[i] + PHOTON_SPEED; if (ph >= 1) ph -= 1; photonPhase[i] = ph;
          pp[o] = s.x + (t.x - s.x) * ph;
          pp[o + 1] = s.y + (t.y - s.y) * ph;
          pp[o + 2] = (s.z || 0) + ((t.z || 0) - (s.z || 0)) * ph;
        } else { pp[o] = pp[o + 1] = pp[o + 2] = 0; }
      }
      photons.geometry.attributes.position.needsUpdate = true;
    }
    for (let i = 0; i < hubMeshes.length; i++) {
      const n = hubMap[i], m = hubMeshes[i];
      if (hasPos(n)) { m.visible = true; m.position.set(n.x, n.y, n.z || 0); m.scale.setScalar(radiusOf(n) * (HUB_R * 1.05)); }
      else m.visible = false;
    }
    if ((frame++ % 30) === 0) {
      inst.computeBoundingSphere();          // InstancedMesh (not geometry) sphere — hover raycast hit-test uses this
      lines.geometry.computeBoundingSphere();
    }
  }
  function startLoop() { if (!raf && inst) loop(); }
  function stopLoop() { if (raf) { cancelAnimationFrame(raf); raf = 0; } }

  // D. HOVER + CLICK + DRAG — the lib's hit-testing AND node-drag are dead on empty node objects, so we
  // raycast the InstancedMesh ourselves. Drag moves the node on a camera-facing plane, pins it (fx/fy/fz),
  // disables orbit-controls for the gesture, and suppresses the trailing click.
  function setNDC(ev) {
    const dom = graph.renderer().domElement, r = dom.getBoundingClientRect();
    ndc.x = ((ev.clientX - r.left) / r.width) * 2 - 1;
    ndc.y = -((ev.clientY - r.top) / r.height) * 2 + 1;
  }
  function nodeAt(ev) {
    if (!inst) return null;
    setNDC(ev);
    raycaster.setFromCamera(ndc, graph.camera());
    const hits = raycaster.intersectObject(inst, false);
    if (!hits.length || hits[0].instanceId == null) return null;
    return ctx.nodes()[hits[0].instanceId] || null;
  }
  function startDrag(n) {
    graph.camera().getWorldDirection(_v3a);                        // plane normal = view direction
    dragPlane.setFromNormalAndCoplanarPoint(_v3a, _v3b.set(n.x, n.y, n.z || 0));
    n.fx = n.x; n.fy = n.y; n.fz = (n.z || 0);                     // pin at grab
  }
  function dragTo(ev) {
    setNDC(ev);
    raycaster.setFromCamera(ndc, graph.camera());
    if (raycaster.ray.intersectPlane(dragPlane, _v3a)) {           // move node to cursor on the drag plane
      const n = down.node;
      // set position directly (the sync loop moves the instance + its edges); pin so it stays.
      // NO d3ReheatSimulation here — reheating alpha=1 every pointermove restarts the whole 5000-node
      // layout continuously, churning the entire graph ("ghost nodes on move") and making orbit feel
      // stuck. Edges follow via writeLinePositions; the dragged node just moves cleanly + pins.
      n.fx = n.x = _v3a.x; n.fy = n.y = _v3a.y; n.fz = n.z = _v3a.z;
    }
  }
  function handleDown(ev) {
    if (ev.button != null && ev.button !== 0) return;              // left button only
    const n = nodeAt(ev);
    if (!n) return;                                                // empty space → let orbit-controls handle it
    down = { node: n, x: ev.clientX, y: ev.clientY };
    if (ctrls) ctrls.enabled = false;                             // hold orbit while a node is pressed
    try { graph.renderer().domElement.setPointerCapture(ev.pointerId); } catch (e) {}
  }
  function handleMove(ev) {
    if (down) {                                                    // pressing a node: maybe drag, never hover
      if (!dragging && Math.hypot(ev.clientX - down.x, ev.clientY - down.y) > 3) { dragging = true; startDrag(down.node); }
      if (dragging) dragTo(ev);
      return;
    }
    const now = performance.now();
    if (now - moveT < 40) return;                                  // throttle hover ~40ms
    moveT = now;
    const n = nodeAt(ev), idx = n ? ctx.nodes().indexOf(n) : -1;
    if (idx !== lastHover) { lastHover = idx; ctx.onHover(n || null); }
  }
  function handleUp(ev) {
    if (!down) return;
    if (ctrls) ctrls.enabled = true;
    try { graph.renderer().domElement.releasePointerCapture(ev.pointerId); } catch (e) {}
    if (dragging) justDragged = true;                              // dropped node stays pinned; swallow the click
    down = null; dragging = false;
  }
  function handleClick(ev) {
    if (justDragged) { justDragged = false; return; }              // ignore the click that ends a drag
    const n = nodeAt(ev); if (n) ctx.onClick(n);
  }

  function bindEvents() {
    const dom = graph.renderer().domElement;
    onMove = handleMove; onClick = handleClick; onDownH = handleDown; onUpH = handleUp;
    dom.addEventListener('pointerdown', onDownH);
    dom.addEventListener('pointermove', onMove);
    dom.addEventListener('pointerup', onUpH);
    dom.addEventListener('click', onClick);
  }
  function unbindEvents() {
    if (graph && (onMove || onClick || onDownH || onUpH)) {
      const dom = graph.renderer().domElement;
      if (onDownH) dom.removeEventListener('pointerdown', onDownH);
      if (onMove) dom.removeEventListener('pointermove', onMove);
      if (onUpH) dom.removeEventListener('pointerup', onUpH);
      if (onClick) dom.removeEventListener('click', onClick);
    }
    onMove = null; onClick = null; onDownH = null; onUpH = null;
    down = null; dragging = false;
  }

  // F. syncColors — recompute ALL instance + line vertex colors (no positions; the loop owns those).
  // Called by app.js when the highlight changes so hover dimming/greening works. Hub bloom spheres
  // keep their build-time hue (they only ever hold hub nodes; not part of the dimming contrast).
  function syncColors() {
    if (!inst || !ctx) return;
    const nodes = ctx.nodes();
    for (let i = 0; i < nodes.length; i++) inst.setColorAt(i, parseColor(ctx.nodeColorFor(nodes[i])));
    if (inst.instanceColor) inst.instanceColor.needsUpdate = true;
    writeLineColors();
  }

  function install(g, context) {
    teardown();
    graph = g; ctx = context;
    const T = THREE();
    if (!T) { if (!warned) { console.warn('[Instanced3d] window.THREE unavailable — 3D instancing disabled'); warned = true; } return; }
    raycaster = new T.Raycaster(); ndc = new T.Vector2(); dummy = new T.Object3D();
    dragPlane = new T.Plane(); _v3a = new T.Vector3(); _v3b = new T.Vector3();
    lastHover = -1; frame = 0; down = null; dragging = false; justDragged = false;
    if (graph.enableNodeDrag) graph.enableNodeDrag(false);   // the lib's node-drag is dead on empty objects — we do it ourselves
    ctrls = graph.controls ? graph.controls() : null;        // orbit-controls: disabled during a node drag
    build();
    bindEvents();
    startLoop();
  }
  function teardown() {
    stopLoop();
    unbindEvents();
    clear();
    if (ctrls) { ctrls.enabled = true; ctrls = null; }       // never leave orbit disabled
    graph = null; ctx = null; raycaster = null; ndc = null; dummy = null;
  }
  // rebuild the instanced geometry from CURRENT graph data — MUST be called after graphData() changes
  // (filter / search / focus / timeline). The InstancedMesh count + node→instance mapping are fixed at
  // build time; without a rebuild, filtered-out nodes linger as ghosts and colors/hover desync.
  // build() clears the old meshes first; the running rAF loop is synchronous-safe and picks up the new refs.
  function rebuild() { if (graph && ctx) build(); }

  window.Instanced3d = { install, teardown, syncColors, rebuild };
})();
