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
   onHover(node|null), onClick(node), nodeLabel(n)→tooltip HTML, getSettings()→state.settings,
   bg()→theme background css (recall-firing dims toward it) }.
   THREE from window.THREE (ESM shim in index.html). 3D-only. */
'use strict';
(function () {
  let graph = null, ctx = null, warned = false;
  let inst = null, lines = null;          // the one node mesh + the one edge geometry
  let hubMeshes = [];                      // small per-hub bloom spheres (≤~28), synced in the loop
  let hubMap = [];                         // parallel: hubMeshes[i] tracks node hubMap[i]
  let raf = 0, frame = 0;
  let photons = null, photonPhase = null;   // edge-flow: ONE Points cloud, a flowing point per edge
  const PHOTON_SPEED = 0.006;               // fraction of an edge advanced per frame
  let arrows = null;                         // direction cones: ONE InstancedMesh, one cone per link
  let _up = null, _dir = null, _q = null;    // orientation scratch (init in install with THREE)
  let tip = null;                            // hover tooltip div (created on install, removed on teardown)
  let onMove = null, onClick = null, onDownH = null, onUpH = null;
  let raycaster = null, ndc = null, dummy = null;
  let lastHover = -1, moveT = 0;
  // node-drag (the lib's drag is dead on empty node objects, so we do it on the InstancedMesh):
  let ctrls = null, down = null, dragging = false, justDragged = false, dragNbrs = null, dragPrev = null, liveGesture = false, dragReheatT = 0, dragDecay = 0.0228;
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
      inst.setColorAt(i, colorOf(n));
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

    // D0. DIRECTION ARROWS → one InstancedMesh of cones (one per link), gated by the arrows setting.
    // The lib's linkDirectionalArrowLength is dead under linkVisibility(false); we reimplement it. Fixed
    // grey (no per-instance color) keeps it simple; cone apex points +Y by default, oriented in loop().
    arrows = new T.InstancedMesh(new T.ConeGeometry(1.6, 4.5, 6),
      new T.MeshBasicMaterial({ vertexColors: false, color: 0x8ca098, transparent: true, opacity: 0.85 }),
      links.length || 1);
    arrows.userData.arrows = true; arrows.frustumCulled = false;
    graph.scene().add(arrows);

    // E. HUB BLOOM: small individual spheres for the hub nodes so only they glow (the big instanced
    // mesh stays untagged). Positions synced in the loop; colors are static (hub hue on build).
    buildHubs();
    buildFiring();
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
      if (fired.size) { if (litLinks.has(links[i])) { col.setRGB(0.47, 1.0, 0.84); a = 1; } else a = Math.min(a, 0.05); }
      const o = i * 8;                                            // 2 verts × RGBA(4)
      c[o] = c[o + 4] = col.r; c[o + 1] = c[o + 5] = col.g; c[o + 2] = c[o + 6] = col.b; c[o + 3] = c[o + 7] = a;
    }
    lines.geometry.attributes.color.needsUpdate = true;
  }

  function clear() {
    const rm = (o) => { if (graph && o) { graph.scene().remove(o); if (o.geometry) o.geometry.dispose(); if (o.material) o.material.dispose(); } };
    rm(inst); rm(lines); rm(photons); rm(arrows); rm(pulsePts); rm(haloPts);
    for (const m of hubMeshes) rm(m);
    inst = null; lines = null; photons = null; photonPhase = null; arrows = null; hubMeshes = []; hubMap = [];
    pulsePts = null; haloPts = null;
  }

  // C. POSITION SYNC — copy node x/y/z into instance matrices + line endpoints ONLY on frames where
  // some node actually moved (physics ticking, drag). A float checksum over all node coords is the
  // dirty signal — O(N) adds, ~free vs the 10k quaternion/matrix writes + GPU uploads it gates. Photons
  // are the exception: they animate along static edges, so they update every frame. Bounding spheres
  // recompute once per ~30 frames and only while dirty.
  let lastPosSum = NaN, arrowsStale = true, needSphere = true;
  function posChecksum(nodes) {
    // component weights break the Δx = -Δz cancellation of an axis-diagonal drag; the running
    // ×1.0000001 makes the sum order/index-sensitive so centroid-preserving redistribution
    // (center-force layouts) can't hold it constant either
    let s = 0;
    for (let i = 0; i < nodes.length; i++) { const n = nodes[i]; s = s * 1.0000001 + (n.x || 0) + 1.31 * (n.y || 0) + 1.77 * (n.z || 0); }
    return s;
  }
  function markDirty() { lastPosSum = NaN; }   // rebuild/syncColors/data swaps force a full resync
  function loop() {
    if (!inst) { raf = 0; return; }
    raf = requestAnimationFrame(loop);
    if (document.hidden) return;
    const nodes = ctx.nodes();
    const posSum = posChecksum(nodes);
    const dirty = !(posSum === lastPosSum);   // NaN sum (pre-layout) stays dirty every frame
    lastPosSum = posSum;
    if (dirty) {
      needSphere = true;
      for (let i = 0; i < nodes.length; i++) {
        const n = nodes[i];
        if (hasPos(n)) { dummy.position.set(n.x, n.y, n.z || 0); dummy.scale.setScalar(radiusOf(n)); }
        else { dummy.scale.setScalar(0); }
        dummy.updateMatrix(); inst.setMatrixAt(i, dummy.matrix);
      }
      inst.instanceMatrix.needsUpdate = true;
      writeLinePositions();
    }
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
    if (arrows) {                           // orient + place a cone at the target end of each bound link
      arrows.visible = !!(ctx.getSettings && ctx.getSettings().arrows);
      if (!arrows.visible && dirty) arrowsStale = true;  // moved while hidden → recompute on next show
      if (arrows.visible && (dirty || arrowsStale)) {
        arrowsStale = false;
        const links = ctx.links();
        for (let i = 0; i < links.length; i++) {
          const l = links[i], s = l.source, t = l.target;
          if (s && typeof s === 'object' && t && typeof t === 'object' && hasPos(s) && hasPos(t)) {
            _dir.set(t.x - s.x, t.y - s.y, (t.z || 0) - (s.z || 0));
            if (_dir.length() > 1) _dir.normalize(); else { dummy.scale.setScalar(0); dummy.updateMatrix(); arrows.setMatrixAt(i, dummy.matrix); continue; }
            _q.setFromUnitVectors(_up, _dir);            // cone +Y apex → link direction
            const back = radiusOf(t) + 3;                // sit the cone just short of the target sphere
            dummy.position.set(t.x - _dir.x * back, t.y - _dir.y * back, (t.z || 0) - _dir.z * back);
            dummy.quaternion.copy(_q); dummy.scale.setScalar(1);
          } else { dummy.position.set(0, 0, 0); dummy.quaternion.copy(_q); dummy.scale.setScalar(0); }
          dummy.updateMatrix(); arrows.setMatrixAt(i, dummy.matrix);
        }
        arrows.instanceMatrix.needsUpdate = true;
      }
    }
    if (dirty) {
      for (let i = 0; i < hubMeshes.length; i++) {
        const n = hubMap[i], m = hubMeshes[i];
        if (hasPos(n)) { m.visible = hubVisible(n); m.position.set(n.x, n.y, n.z || 0); m.scale.setScalar(radiusOf(n) * (HUB_R * 1.05)); }
        else m.visible = false;
      }
    }
    stepFiring(performance.now(), dirty);
    if ((frame++ % 30) === 0 && needSphere) {
      needSphere = false;                    // recompute once per dirty burst (and once after it ends)
      inst.computeBoundingSphere();          // InstancedMesh (not geometry) sphere — hover raycast hit-test uses this
      lines.geometry.computeBoundingSphere();
      if (arrows) arrows.computeBoundingSphere();
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
    liveGesture = !ctx.liveDrag || ctx.liveDrag();
    if (liveGesture) {
      // org-roam-ui-style drag: sim runs live for the gesture so forces pull the neighbourhood
      // along and the drop lands in a new equilibrium (no snap-back). The 3D lib's own drag is
      // dead (muted node objects) and it exposes no d3AlphaTarget to hold heat, so we reheat at
      // grab with a LOWERED alphaDecay (alpha coasts near 1 instead of sawtoothing — a visible
      // whole-graph pulse) and top up every ~2s from dragTo (NOT every frame — the old ghost
      // churn). alphaMin 0 un-bricks the settled engine (alpha sits below the 0.02 early-stop).
      graph.d3AlphaMin(0);
      dragDecay = graph.d3AlphaDecay();
      graph.d3AlphaDecay(0.005);
      graph.d3ReheatSimulation();
      dragReheatT = performance.now();
      dragNbrs = null;                                             // live forces move neighbours; ripple would double-move them
    } else {
      // kinematic fallback for huge graphs (force ticks are 100-400ms): null forces so a hot
      // post-drop sim can't fight the gesture, and pull the multi-hop ripple set (ctx.dragRipple
      // from app.js: weight 0.6^hop, ≤3 hops, ≤500 nodes) along instead
      if (ctx.freezeForces) ctx.freezeForces();
      dragNbrs = ctx.dragRipple(n, ctx.links());
    }
    graph.camera().getWorldDirection(_v3a);                        // plane normal = view direction
    dragPlane.setFromNormalAndCoplanarPoint(_v3a, _v3b.set(n.x, n.y, n.z || 0));
    n.fx = n.x; n.fy = n.y; n.fz = (n.z || 0);                     // pin at grab
    dragPrev = { x: n.x, y: n.y, z: n.z || 0 };
  }
  function dragTo(ev) {
    setNDC(ev);
    raycaster.setFromCamera(ndc, graph.camera());
    if (raycaster.ray.intersectPlane(dragPlane, _v3a)) {           // move node to cursor on the drag plane
      const n = down.node;
      if (liveGesture && performance.now() - dragReheatT > 2000) {  // keep the gesture's sim hot (alpha fully decays in ~3.5s)
        graph.d3ReheatSimulation();
        dragReheatT = performance.now();
      }
      const dx = _v3a.x - dragPrev.x, dy = _v3a.y - dragPrev.y, dz = _v3a.z - dragPrev.z;
      n.fx = n.x = _v3a.x; n.fy = n.y = _v3a.y; n.fz = n.z = _v3a.z;   // move the dragged node + pin
      // pull the ripple set along at per-hop stiffness so it trails elastically (edges flex) — this
      // is KINEMATIC, NOT d3ReheatSimulation: alpha=1 every frame churned the whole graph (the old
      // "ghost nodes on move"), and the sim exposes no gentle alphaTarget, so we move nodes directly.
      if (dragNbrs) for (const [m, kw] of dragNbrs) { if (m.x == null) continue; m.x += dx * kw; m.y += dy * kw; m.z = (m.z || 0) + dz * kw; }
      dragPrev.x = _v3a.x; dragPrev.y = _v3a.y; dragPrev.z = _v3a.z;
    }
  }
  function handleDown(ev) {
    if (down) return;                                              // second pointer mid-gesture must not steal down.node (drop would unpin the wrong node)
    if (ev.shiftKey) return;                                       // Shift+press falls through to orbit-controls, even over a node
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
      if (dragging) { dragTo(ev); if (tip) tip.style.display = 'none'; }   // hide tooltip while dragging
      return;
    }
    const now = performance.now();
    if (now - moveT < 40) return;                                  // throttle hover ~40ms
    moveT = now;
    const n = nodeAt(ev), idx = n ? ctx.nodes().indexOf(n) : -1;
    if (idx !== lastHover) { lastHover = idx; ctx.onHover(n || null); }
    if (tip) {                                                     // follow-cursor tooltip via ctx.nodeLabel
      if (n && ctx.nodeLabel) {
        tip.innerHTML = ctx.nodeLabel(n);
        tip.style.left = (ev.clientX + 14) + 'px'; tip.style.top = (ev.clientY + 14) + 'px';
        tip.style.display = 'block';
      } else tip.style.display = 'none';
    }
  }
  function handleUp(ev) {
    if (!down) return;
    if (ctrls) ctrls.enabled = true;
    try { graph.renderer().domElement.releasePointerCapture(ev.pointerId); } catch (e) {}
    if (dragging) {
      justDragged = true;                                          // swallow the click that ends a drag
      // unpin so physics settles the drop (gravity tether, links, charge) — leaving the node
      // pinned with the engine cold made every drag stick permanently and killed gravity
      const n = down.node; n.fx = n.fy = n.fz = undefined;
      if (liveGesture) {
        graph.d3AlphaMin(0.02);                                    // restore the early-stop floor
        graph.d3AlphaDecay(dragDecay);                             // ...and the normal cooling rate
      } else if (ctx.unfreezeForces) ctx.unfreezeForces();         // restore forces BEFORE the reheat ticks
      graph.d3ReheatSimulation();                                  // settle the drop (tail runs to the early-stop)
    }
    down = null; dragging = false; dragNbrs = null; dragPrev = null;
  }
  function handleClick(ev) {
    if (justDragged) { justDragged = false; return; }              // ignore the click that ends a drag
    const n = nodeAt(ev); if (n) ctx.onClick(n); else if (fired.size) clearFiring();   // empty-space click ends a recall view
  }

  function bindEvents() {
    const dom = graph.renderer().domElement;
    onMove = handleMove; onClick = handleClick; onDownH = handleDown; onUpH = handleUp;
    dom.addEventListener('pointerdown', onDownH);
    dom.addEventListener('pointermove', onMove);
    dom.addEventListener('pointerup', onUpH);
    // a lost release (pen cancel, screen lock, failed pointer capture) must still end the
    // gesture — the down-guard in handleDown otherwise wedges ALL node interaction until remount
    dom.addEventListener('pointercancel', onUpH);
    dom.addEventListener('lostpointercapture', onUpH);
    dom.addEventListener('click', onClick);
  }
  function unbindEvents() {
    if (graph && (onMove || onClick || onDownH || onUpH)) {
      const dom = graph.renderer().domElement;
      if (onDownH) dom.removeEventListener('pointerdown', onDownH);
      if (onMove) dom.removeEventListener('pointermove', onMove);
      if (onUpH) { dom.removeEventListener('pointerup', onUpH); dom.removeEventListener('pointercancel', onUpH); dom.removeEventListener('lostpointercapture', onUpH); }
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
    for (let i = 0; i < nodes.length; i++) inst.setColorAt(i, colorOf(nodes[i]));
    if (inst.instanceColor) inst.instanceColor.needsUpdate = true;
    writeLineColors();
  }


  // G. RECALL FIRING — ported from the fly-through talk (flythrough.js fire/pathTo/stepPulses/stepHalos).
  // fire(ids): a session's recall digest lights up live. The first id is the subject; pulses walk the
  // shortest path (≤5 hops) from it to every other recalled node, which flashes, swells to 1.45× and
  // keeps a breathing halo; the paths stay lit as moving bead chains; everything else sinks toward the
  // background. Persists until clearFiring() (empty-space click, Esc, or the next recall). flash(ids):
  // the light version for ordinary MCP touches — swell + whiten, no dimming. Per-frame cost is
  // O(fired + beads) and zero while nothing is firing. Hue-keeping dim needs ~0.93 toward bg, not 0.7:
  // the Lambert ambient lifts dimmed colours back up. Halos need depthTest:false or spheres hide them.
  const F = { HOP_MS: 170, STAGGER_MS: 110, PULSE_MS: 480, FLASH_MS: 900, BEADS: 16, PULSES: 2400, HALOS: 64, DIM: 0.93, BURST: 8 };
  const fired = new Map();                  // node id -> fire time (ms): the recalled set
  const flashes = new Map();                // node id -> t0: light flashes (no dimming), dropped when done
  const settled = new Set();                // fired ids whose flash finished and whose final colour is written
  const litLinks = new Set();               // link OBJECTS on a firing path (survive rebuilds)
  let pulses = [];                          // {a, b, t0}: node objects + start time
  let pulsePts = null, haloPts = null, idNode = null, idIx = null, _white = null, _bg = null;

  function colorOf(n) {
    const c = parseColor(ctx.nodeColorFor(n));
    if (fired.size && !fired.has(n.id)) c.lerp(_bg || (_bg = parseColor(ctx.bg ? ctx.bg() : '#000')), F.DIM);
    return c;
  }
  function hubVisible(n) { return hasPos(n) && (!fired.size || fired.has(n.id)); }   // a glowing hub would punch through the dim
  function applyHubVis() { for (let i = 0; i < hubMeshes.length; i++) hubMeshes[i].visible = hubVisible(hubMap[i]); }

  function buildFiring() {
    const T = THREE();
    idNode = new Map(ctx.nodes().map((n) => [n.id, n]));
    idIx = new Map(ctx.nodes().map((n, i) => [n.id, i]));   // instance index; fixed until the next rebuild
    const pg = new T.BufferGeometry();
    pg.setAttribute('position', new T.BufferAttribute(new Float32Array(F.PULSES * 3), 3));
    pg.setDrawRange(0, 0);
    pulsePts = new T.Points(pg, new T.PointsMaterial({ color: 0xc8fff0, size: 9, sizeAttenuation: true,
      transparent: true, opacity: 0.95, blending: T.AdditiveBlending, depthWrite: false }));
    pulsePts.frustumCulled = false;
    graph.scene().add(pulsePts);
    const c = document.createElement('canvas'); c.width = c.height = 64;
    const x = c.getContext('2d'), g = x.createRadialGradient(32, 32, 0, 32, 32, 32);
    g.addColorStop(0, 'rgba(255,255,255,.95)'); g.addColorStop(0.2, 'rgba(125,255,214,.55)'); g.addColorStop(1, 'rgba(125,255,214,0)');
    x.fillStyle = g; x.fillRect(0, 0, 64, 64);
    const hg = new T.BufferGeometry();
    hg.setAttribute('position', new T.BufferAttribute(new Float32Array(F.HALOS * 3), 3));
    hg.setDrawRange(0, 0);
    haloPts = new T.Points(hg, new T.PointsMaterial({ map: new T.CanvasTexture(c), size: 80, sizeAttenuation: true,
      transparent: true, opacity: 0.9, blending: T.AdditiveBlending, depthWrite: false, depthTest: false }));
    haloPts.frustumCulled = false;
    graph.scene().add(haloPts);
    _white = new T.Color(0xffffff);
    settled.clear();                        // rebuilt mesh has plain colours; flashes re-assert via markDirty
  }

  const endId = (e) => (e && typeof e === 'object' ? e.id : e);
  function adjacency() {                    // id -> [[neighbour id, link]], built per fire (rare; O(E))
    const adj = new Map();
    for (const l of ctx.links()) {
      const s = endId(l.source), t = endId(l.target);
      if (!adj.has(s)) adj.set(s, []); if (!adj.has(t)) adj.set(t, []);
      adj.get(s).push([t, l]); adj.get(t).push([s, l]);
    }
    return adj;
  }
  function pathTo(adj, from, to, maxHops = 5) {   // BFS -> [[id, link-into-id]...]; unreachable -> just [to]
    if (from === to) return [[to, null]];
    const prev = new Map([[from, null]]);
    let ring = [from];
    for (let d = 0; d < maxHops && ring.length && !prev.has(to); d++) {
      const next = [];
      for (const u of ring) for (const [v, l] of adj.get(u) || []) if (!prev.has(v)) { prev.set(v, [u, l]); next.push(v); }
      ring = next;
    }
    if (!prev.has(to)) return [[to, null]];
    const p = [];
    for (let v = to; v != null; v = prev.get(v) ? prev.get(v)[0] : null) p.unshift([v, prev.get(v) ? prev.get(v)[1] : null]);
    return p;
  }
  function spawn(aId, bId, t0) {
    const a = idNode.get(aId), b = idNode.get(bId);
    if (!a || !b) return;
    if (pulses.length >= F.PULSES) pulses.shift();
    pulses.push({ a, b, t0 });
  }

  function fire(ids) {
    if (!inst || !idNode) return;
    const live = [...new Set(ids)].filter((id) => idNode.has(id));   // filtered-out ids are silently skipped
    if (!live.length) return;
    resetFiring();
    const adj = adjacency(), now = performance.now(), from = live[0];
    const hit = (id, t) => { if (!fired.has(id)) fired.set(id, t); };
    const burst = (id, t) => (adj.get(id) || []).slice(0, F.BURST).forEach(([nb], j) => spawn(id, nb, t + 60 + j * 25));
    hit(from, now); burst(from, now);
    live.slice(1).forEach((id, j) => {
      const path = pathTo(adj, from, id), t0 = now + (j + 1) * F.STAGGER_MS;
      for (let k = 1; k < path.length; k++) {
        litLinks.add(path[k][1]);
        spawn(path[k - 1][0], path[k][0], t0 + (k - 1) * F.HOP_MS);
        if (k < path.length - 1) hit(path[k][0], t0 + k * F.HOP_MS);   // relay nodes light as the pulse passes
      }
      const tHit = t0 + (path.length - 1) * F.HOP_MS;
      hit(id, tHit); burst(id, tHit);
    });
    syncColors(); applyHubVis();
  }
  function flash(ids) {
    if (!inst || !idNode) return;
    const now = performance.now();
    for (const id of ids) if (idNode.has(id) && !fired.has(id)) flashes.set(id, now);
  }
  function resetFiring() {                  // drop state + force every scale back to base on the next frame
    fired.clear(); litLinks.clear(); settled.clear(); pulses = [];
    markDirty();
  }
  function clearFiring() {
    if (!fired.size) return;
    resetFiring();
    if (inst) { syncColors(); applyHubVis(); }
  }

  function stepFiring(now, dirty) {
    if (!fired.size && !flashes.size) {
      if (pulses.length) pulses = [];
      if (pulsePts && pulsePts.geometry.drawRange.count) { pulsePts.geometry.setDrawRange(0, 0); haloPts.geometry.setDrawRange(0, 0); }
      return;
    }
    // pulses in flight, then the lit paths' bead chains
    const pp = pulsePts.geometry.attributes.position.array;
    let w = 0;
    for (const p of pulses) {
      const u = (now - p.t0) / F.PULSE_MS;
      if (u < 0 || u > 1 || !hasPos(p.a) || !hasPos(p.b)) continue;
      pp[w * 3] = p.a.x + (p.b.x - p.a.x) * u; pp[w * 3 + 1] = p.a.y + (p.b.y - p.a.y) * u;
      pp[w * 3 + 2] = (p.a.z || 0) + ((p.b.z || 0) - (p.a.z || 0)) * u; w++;
    }
    for (const l of litLinks) {
      const s = l.source, t = l.target;
      if (!hasPos(s) || !hasPos(t)) continue;
      for (let k = 0; k < F.BEADS && w < F.PULSES; k++, w++) {
        const u = ((now / 900) + k / F.BEADS) % 1;
        pp[w * 3] = s.x + (t.x - s.x) * u; pp[w * 3 + 1] = s.y + (t.y - s.y) * u;
        pp[w * 3 + 2] = (s.z || 0) + ((t.z || 0) - (s.z || 0)) * u;
      }
    }
    pulsePts.geometry.setDrawRange(0, w);
    pulsePts.geometry.attributes.position.needsUpdate = true;
    while (pulses.length && now - pulses[0].t0 > F.PULSE_MS + 4000) pulses.shift();
    // swell + whiten: fired nodes settle at 1.45×, light flashes return to 1×. Matrices are rewritten
    // only while a flash runs or the dirty loop just reset every scale to base.
    let mat = false, col = false;
    const swell = (id, t0, rest, keep) => {
      const n = idNode.get(id), u = (now - t0) / F.FLASH_MS;
      if (!n || u < 0 || !hasPos(n)) return;
      const live = u <= 1;
      if (!live && !dirty && settled.has(id)) return;
      const i = idIx.get(id);
      dummy.position.set(n.x, n.y, n.z || 0);
      dummy.scale.setScalar(radiusOf(n) * (live ? rest + 1.6 * (1 - u) ** 2 : rest));
      dummy.updateMatrix(); inst.setMatrixAt(i, dummy.matrix); mat = true;
      if (live) { inst.setColorAt(i, colorOf(n).lerp(_white, (1 - u) * 0.85)); col = true; }
      else if (!settled.has(id)) { inst.setColorAt(i, colorOf(n)); col = true; if (keep) settled.add(id); }
    };
    for (const [id, t0] of fired) swell(id, t0, 1.45, true);
    for (const [id, t0] of flashes) { swell(id, t0, 1, false); if (now - t0 > F.FLASH_MS) flashes.delete(id); }
    if (mat) inst.instanceMatrix.needsUpdate = true;
    if (col && inst.instanceColor) inst.instanceColor.needsUpdate = true;
    // halos on every fired node that has lit
    const hp = haloPts.geometry.attributes.position.array;
    let h = 0;
    for (const [id, t0] of fired) {
      const n = idNode.get(id);
      if (now < t0 || h >= F.HALOS || !hasPos(n)) continue;
      hp[h * 3] = n.x; hp[h * 3 + 1] = n.y; hp[h * 3 + 2] = n.z || 0; h++;
    }
    haloPts.geometry.setDrawRange(0, h);
    haloPts.geometry.attributes.position.needsUpdate = true;
    haloPts.material.opacity = 0.65 + 0.25 * Math.sin(now / 260);   // slow breathing
  }

  function install(g, context) {
    teardown();
    graph = g; ctx = context;
    const T = THREE();
    if (!T) { if (!warned) { console.warn('[Instanced3d] window.THREE unavailable — 3D instancing disabled'); warned = true; } return; }
    raycaster = new T.Raycaster(); ndc = new T.Vector2(); dummy = new T.Object3D();
    dragPlane = new T.Plane(); _v3a = new T.Vector3(); _v3b = new T.Vector3();
    _up = new T.Vector3(0, 1, 0); _dir = new T.Vector3(); _q = new T.Quaternion();
    // hover tooltip (the lib's nodeLabel is dead under empty node objects — we drive it via raycast)
    tip = document.createElement('div'); tip.id = '__mm_tip';
    tip.style.cssText = 'position:fixed;pointer-events:none;z-index:40;display:none;background:rgba(10,16,14,.92);border:1px solid rgba(120,132,127,.25);color:#d7e0dc;padding:4px 8px;border-radius:6px;font:12px "Hanken Grotesk",sans-serif;max-width:260px';
    document.body.appendChild(tip);
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
    if (tip) { tip.remove(); tip = null; }                   // drop the hover tooltip div
    if (ctrls) { ctrls.enabled = true; ctrls = null; }       // never leave orbit disabled
    fired.clear(); flashes.clear(); settled.clear(); litLinks.clear(); pulses = []; idNode = null; idIx = null; _bg = null;
    graph = null; ctx = null; raycaster = null; ndc = null; dummy = null;
    _up = null; _dir = null; _q = null;
  }
  // rebuild the instanced geometry from CURRENT graph data — MUST be called after graphData() changes
  // (filter / search / focus / timeline). The InstancedMesh count + node→instance mapping are fixed at
  // build time; without a rebuild, filtered-out nodes linger as ghosts and colors/hover desync.
  // build() clears the old meshes first; the running rAF loop is synchronous-safe and picks up the new refs.
  function rebuild() { if (graph && ctx) { build(); markDirty(); arrowsStale = true; } }
  // theme change: the dim target moved
  function refreshBg() { _bg = null; if (fired.size) syncColors(); }

  window.Instanced3d = { install, teardown, syncColors, rebuild, fire, flash, clearFiring, refreshBg,
    firing: () => fired.size > 0 };
})();
