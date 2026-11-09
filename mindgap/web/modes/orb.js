/* mindgap view mode "orb" — the whole graph as a dotted particle sphere, a glowing planet of
   memories. Every node sits on ONE shell (Fibonacci sphere, radius from node count so dots keep a
   steady spacing); points are dealt to groups by recursive bisection (split the ordered group list at
   its size median, split the points at the median of their widest axis), so each group — node type, or
   community when colorBy = community — gets one compact patch, with the other key as sub-patches and
   the highest-degree members at each patch's centre. The top 3 groups each get a tilted orbit ring
   that passes over their patch; the group's hub node leaves the shell and rides that ring, labelled
   (short label: group + clipped title). Edges would be a hairball of chords through the planet, so
   instanced3d's edges/photons/arrows are hidden (material.visible) while orb is on; the hovered or
   selected node's links are drawn instead as raised great-circle arcs.

   Look: nodes are NOT drawn as instanced3d's opaque spheres — those (and the bloom hub spheres) are
   hidden via material.visible. Their full (hub-sized) radius would still be the pick target, so a click
   on a small dot could select a neighbouring big hub: while orb is on, the InstancedMesh's raycast is
   swapped for a screen-space pick against the VISIBLE dots (pickIx: nearest dot within its drawn
   radius, ≥ PICK_MIN_PX; restored on exit). instanced3d keeps raycasting the same object, so
   hover/select/click hit exactly the dot under the cursor. Instead ONE THREE.Points with a soft-sprite
   additive shader draws every node as a small glowing dot (tiny white-hot core, soft per-type-hue
   falloff, size capped so hubs never become suns), plus faint dust on the shell in the patch colours,
   dotted orbit rings with small rider dots, and a soft bright core cluster at the centre. Ring-bound
   points (ring riders, ring dots) are positioned in the vertex shader from per-ring uniforms + uTime,
   so motion costs one uniform write per frame and no buffer uploads.

   Framing: zoomToFit is a no-op here (instanced3d's empty per-node Object3Ds give no bbox), so on mode
   entry orb places the camera itself: distance from the shell radius + fov so the shell's on-screen
   radius is FRAME_FRAC of the viewport (keeps the view direction, looks at the centre). A camera still
   on the library's z axis (page loaded straight into orb) frames instantly — the camera then no longer sits at the library's
   (0,0,lastSetCameraZ), so its auto-placement skips — and a one-shot re-check after the first
   update digest re-frames if the library still got there first. Data swaps (dataChanged re-enter)
   don't move the camera.

   Cost: decorations are 4 objects — ONE Points (nodes + dust + ring dots + core), ONE LineSegments
   (thin rings), ONE LineSegments (highlight arcs, preallocated, drawRange-limited), ≤3 label Sprites.
   Per frame: uTime uniform; ~30 Hz: ≤3 rider scalars (pick targets) + highlight arcs while one is up.
   No per-frame allocation. Registered via Modes.register. */
'use strict';
(function () {
  const SPACING = 12, MIN_R = 60, RINGS = 3, RING_R0 = 1.32, RING_DR = 0.17, RING_SEG = 128;
  const W0 = 0.07, STEP_MS = 33, ARC_MAX = 600, ARC_SEG = 20, ARC_LIFT = 0.07;
  const DUST_PER = 4, DUST_MAX = 16000, RING_DOTS = 150, RIDE_DOTS = 7, CORE_N = 320, TITLE_MAX = 18;
  const TILTS = [[0.38, 0], [-0.62, 2.1], [0.95, 4.2]];   // ring tilt (about x, then about y) before aiming at the patch
  const PICK_MIN_PX = 4, FRAME_FRAC = 0.42, FRAME_MS = 600, REFRAME_MS = 120;
  let g = null, ctxRef = null, rings = null, dots = null, arcs = null, labels = [];
  let nodesRef = [], degRef = null, R = 0, lastStep = -Infinity, colorKey = '', t0 = 0, hoverIx = -1, hoverSize = 0;
  // riders: typed arrays per ring
  let riders = [], ringR = null, ringU = null, ringV = null, ringW = null, ringP = null;
  // highlight arcs
  let hlId = undefined, arcLinks = [], edgeObjs = [];
  let dbg = { shellRadius: 0, groupBy: 'type', groups: [], ringRiders: [] };
  let pickInst = null, framedGraph = null, frameTimer = 0;
  const _fwd = [0, 0, 0];

  function T() { return window.THREE; }
  const endId = (e) => (e && typeof e === 'object' ? e.id : e);
  function norm(v) { const l = Math.hypot(v[0], v[1], v[2]) || 1; return [v[0] / l, v[1] / l, v[2] / l]; }
  function cross(a, b) { return [a[1] * b[2] - a[2] * b[1], a[2] * b[0] - a[0] * b[2], a[0] * b[1] - a[1] * b[0]]; }
  function fib(n) {                                    // n points evenly on the unit sphere, flat xyz
    const out = new Float64Array(n * 3);
    for (let i = 0; i < n; i++) {
      const y = 1 - 2 * (i + 0.5) / n, r = Math.sqrt(1 - y * y), a = i * 2.399963229728653;
      out[i * 3] = r * Math.cos(a); out[i * 3 + 1] = y; out[i * 3 + 2] = r * Math.sin(a);
    }
    return out;
  }
  function clusters() { return window.__mm && window.__mm.state ? window.__mm.state.clusters : null; }
  function groupMode(ctx) { return ctx.getSettings().colorBy === 'community' && clusters() ? 'community' : 'type'; }
  function keyFns(mode) {
    const C = clusters();
    const com = (n) => (C && C.byId.has(n.id) ? 'c' + C.byId.get(n.id) : 'c?');
    const typ = (n) => String(n.type || '?');
    return mode === 'community' ? [com, C ? typ : () => ''] : [typ, C ? com : () => ''];
  }
  function groupLabel(mode, key) { return mode === 'community' ? (key === 'c?' ? 'unclustered' : 'cluster ' + (+key.slice(1) + 1)) : key; }

  // deal points (idx into P) to units[lo, hi): halve the unit list at its size median, halve the
  // points at the median of their widest axis → each unit gets one compact patch
  function deal(P, idx, units, lo, hi, out) {
    if (hi - lo === 1) { out.push([units[lo], idx]); return; }
    let total = 0; for (let k = lo; k < hi; k++) total += units[k].members.length;
    let cut = lo + 1, acc = units[lo].members.length, best = Math.abs(2 * acc - total);
    for (let k = lo + 1, a = acc; k < hi - 1; k++) {
      a += units[k].members.length;
      const d = Math.abs(2 * a - total); if (d < best) { best = d; cut = k + 1; acc = a; }
    }
    let ax = 0, span = -1;
    for (let c = 0; c < 3; c++) {
      let mn = Infinity, mx = -Infinity;
      for (const i of idx) { const v = P[i * 3 + c]; if (v < mn) mn = v; if (v > mx) mx = v; }
      if (mx - mn > span) { span = mx - mn; ax = c; }
    }
    idx.sort((a, b) => P[a * 3 + ax] - P[b * 3 + ax]);
    deal(P, idx.slice(0, acc), units, lo, cut, out);
    deal(P, idx.slice(acc), units, cut, hi, out);
  }

  function layout(data, ctx) {
    const nodes = data.nodes, N = nodes.length, ix = new Map();
    nodes.forEach((n, i) => ix.set(n.id, i));
    const deg = new Int32Array(N);
    for (const l of data.links) {
      const a = ix.get(endId(l.source)), b = ix.get(endId(l.target));
      if (a == null || b == null || a === b) continue;
      deg[a]++; deg[b]++;
    }
    const byDeg = (a, b) => (deg[b] - deg[a]) || (nodes[a].id < nodes[b].id ? -1 : 1);
    const mode = groupMode(ctx), [gk, sk] = keyFns(mode);
    colorKey = ctx.getSettings().colorBy;

    const gmap = new Map();
    for (let i = 0; i < N; i++) { const k = gk(nodes[i]); if (!gmap.has(k)) gmap.set(k, []); gmap.get(k).push(i); }
    const groups = [...gmap.entries()].map(([key, idx]) => ({ key, idx }))
      .sort((a, b) => (b.idx.length - a.idx.length) || (a.key < b.key ? -1 : 1));

    // ring riders: the hub of each of the top groups (a group keeps ≥1 node on the shell)
    const riderIx = [], riderGroup = [];
    for (const gr of groups) {
      if (riderIx.length >= RINGS) break;
      if (gr.idx.length < 2) continue;
      riderIx.push(gr.idx.slice().sort(byDeg)[0]); riderGroup.push(gr);
    }
    const isRider = new Uint8Array(N); for (const i of riderIx) isRider[i] = 1;

    // units = (group, sub-group) in group order, biggest sub-groups first
    const units = [];
    for (const gr of groups) {
      const sm = new Map();
      for (const i of gr.idx) if (!isRider[i]) { const k = sk(nodes[i]); if (!sm.has(k)) sm.set(k, []); sm.get(k).push(i); }
      [...sm.entries()].sort((a, b) => (b[1].length - a[1].length) || (a[0] < b[0] ? -1 : 1))
        .forEach(([, members]) => units.push({ group: gr, members }));
    }
    const Ns = N - riderIx.length;
    R = Math.max(MIN_R, SPACING * Math.sqrt(Ns / (4 * Math.PI)));
    const P = fib(Ns), pos = new Map(), leaves = [];
    if (units.length) deal(P, [...Array(Ns).keys()], units, 0, units.length, leaves);
    const gsum = new Map();                            // group → summed unit direction (patch centroid)
    for (const [u, pts] of leaves) {
      let cx = 0, cy = 0, cz = 0;
      for (const p of pts) { cx += P[p * 3]; cy += P[p * 3 + 1]; cz += P[p * 3 + 2]; }
      const s = gsum.get(u.group) || [0, 0, 0]; s[0] += cx; s[1] += cy; s[2] += cz; gsum.set(u.group, s);
      pts.sort((a, b) => (P[b * 3] * cx + P[b * 3 + 1] * cy + P[b * 3 + 2] * cz) - (P[a * 3] * cx + P[a * 3 + 1] * cy + P[a * 3 + 2] * cz));
      u.members.sort(byDeg).forEach((i, k) => {
        const p = pts[k] * 3;
        pos.set(nodes[i].id, { x: P[p] * R, y: P[p + 1] * R, z: P[p + 2] * R });
      });
    }

    // rings: tilted, rotated so each passes over its group's patch; rider starts above the patch
    const K = riderIx.length, now = performance.now() / 1000;
    ringR = new Float64Array(K); ringU = new Float64Array(K * 3); ringV = new Float64Array(K * 3);
    ringW = new Float64Array(K); ringP = new Float64Array(K); riders = new Array(K);
    for (let k = 0; k < K; k++) {
      const s = gsum.get(riderGroup[k]), c = norm(s && Math.hypot(s[0], s[1], s[2]) > 1e-9 ? s : [0, 1, 0]);
      const [t, ph] = TILTS[k], ref = [Math.sin(t) * Math.sin(ph), Math.cos(t), Math.sin(t) * Math.cos(ph)];
      const d = ref[0] * c[0] + ref[1] * c[1] + ref[2] * c[2];
      let nrm = [ref[0] - d * c[0], ref[1] - d * c[1], ref[2] - d * c[2]];
      if (Math.hypot(nrm[0], nrm[1], nrm[2]) < 1e-3) nrm = cross(c, Math.abs(c[0]) < 0.9 ? [1, 0, 0] : [0, 0, 1]);
      nrm = norm(nrm);
      const v = cross(nrm, c);
      ringR[k] = R * (RING_R0 + RING_DR * k); ringW[k] = (k % 2 ? -W0 : W0) / (1 + 0.3 * k);
      ringP[k] = -ringW[k] * now;
      for (let a = 0; a < 3; a++) { ringU[k * 3 + a] = c[a]; ringV[k * 3 + a] = v[a]; }
      riders[k] = nodes[riderIx[k]];
    }
    nodesRef = nodes; degRef = deg;
    place(performance.now());
    for (const n of riders) pos.set(n.id, { x: n.x, y: n.y, z: n.z });

    dbg = { shellRadius: R, groupBy: mode, center: [0, 0, 0],
      groups: groups.map((gr) => ({ key: gr.key, label: groupLabel(mode, gr.key), size: gr.idx.length })),
      ringRiders: riders.map((n, k) => ({ id: n.id, group: riderGroup[k].key, label: groupLabel(mode, riderGroup[k].key), ring: k, ringRadius: ringR[k] })) };
    return pos;
  }

  function place(now) {
    if (!ringR) return;
    lastStep = now;
    const t = now / 1000;
    for (let k = 0; k < riders.length; k++) {
      const a = ringW[k] * t + ringP[k], ca = ringR[k] * Math.cos(a), sa = ringR[k] * Math.sin(a), o = k * 3, n = riders[k];
      n.x = n.fx = ca * ringU[o] + sa * ringV[o];
      n.y = n.fy = ca * ringU[o + 1] + sa * ringV[o + 1];
      n.z = n.fz = ca * ringU[o + 2] + sa * ringV[o + 2];
      const lb = labels[k];
      if (lb) lb.position.set(n.x, n.y + lb.userData.lift, n.z);
    }
  }

  // instanced3d's edge objects (lines, photons, arrows) would draw chords through the planet, and its
  // opaque node spheres + bloom hub spheres would cover the particle dots: hide their materials (bloom
  // toggles obj.visible, so material.visible survives it; Raycaster ignores visibility, so the hidden
  // node spheres stay the pick targets); a rebuild makes fresh objects, re-hidden by the microtask
  // from enter() and the per-step check in tick()
  function edgeHandles() {
    const h = window.Instanced3d && Instanced3d.debug ? Instanced3d.debug() : null;
    return h ? [h.lines, h.photons, h.arrows].filter((o) => o && o.material) : [];
  }
  function sphereHandles() {
    const h = window.Instanced3d && Instanced3d.debug ? Instanced3d.debug() : null;
    return h ? [h.inst, ...(h.hubMeshes || [])].filter((o) => o && o.material) : [];
  }
  function hideEdges() {
    const hs = edgeHandles().concat(sphereHandles());
    if (hs.length === edgeObjs.length && hs.every((o, i) => o === edgeObjs[i])) return;
    for (const o of hs) o.material.visible = false;
    edgeObjs = hs;
    const inst = sphereHandles()[0];                   // h.inst: the object instanced3d raycasts
    if (inst !== pickInst) { unpatchPick(); if (inst && inst.isInstancedMesh) { inst.raycast = pickRaycast; pickInst = inst; } }
  }
  function showEdges() { for (const o of edgeObjs) if (o.material) o.material.visible = true; edgeObjs = []; unpatchPick(); }
  function unpatchPick() { if (pickInst && pickInst.raycast === pickRaycast) delete pickInst.raycast; pickInst = null; }   // back to the prototype's

  // index of the node whose VISIBLE dot is under the ray, or -1. Pure (no THREE): ray origin o, unit
  // dir d, camera forward f (flat [x,y,z]); px = drawing-buffer pixels per world unit at depth 1 (the
  // shader's uPx); a dot's drawn diameter is clamp(size·px/depth, 1, maxPx), as in VERT. Score = pixel
  // distance / max(drawn radius, minPx); lowest wins, ties → nearer the camera.
  function pickIx(nodes, sizes, o, d, f, px, maxPx, minPx) {
    let best = -1, bs = Infinity, bd = Infinity;
    for (let i = 0; i < nodes.length; i++) {
      const n = nodes[i]; if (!Number.isFinite(n.x)) continue;
      const dx = n.x - o[0], dy = n.y - o[1], dz = (n.z || 0) - o[2];
      const depth = dx * f[0] + dy * f[1] + dz * f[2]; if (depth <= 1e-6) continue;
      const t = dx * d[0] + dy * d[1] + dz * d[2];
      const ex = dx - t * d[0], ey = dy - t * d[1], ez = dz - t * d[2];
      const r = Math.max(0.5 * Math.min(Math.max(sizes[i] * px / depth, 1), maxPx), minPx);
      const s = Math.sqrt(ex * ex + ey * ey + ez * ez) * px / depth / r;
      if (s > 1) continue;
      if (s < bs - 1e-6 || (s <= bs + 1e-6 && depth < bd)) { best = i; bs = s; bd = depth; }
    }
    return best;
  }
  // installed as h.inst.raycast while orb is on (this = the InstancedMesh)
  function pickRaycast(raycaster, out) {
    if (!dots || !g) return;
    const cam = g.camera(), el = g.renderer().domElement, u = dots.material.uniforms, ray = raycaster.ray;
    const fw = cam.getWorldDirection(ray.direction.clone()); _fwd[0] = fw.x; _fwd[1] = fw.y; _fwd[2] = fw.z;
    const o = ray.origin, d = ray.direction;
    const i = pickIx(nodesRef, dots.geometry.attributes.aSize.array, [o.x, o.y, o.z], [d.x, d.y, d.z], _fwd,
      u.uPx.value, u.uMaxPx.value, PICK_MIN_PX * (el.height / (el.clientHeight || el.height)));
    if (i < 0) return;
    const n = nodesRef[i], t = (n.x - o.x) * d.x + (n.y - o.y) * d.y + ((n.z || 0) - o.z) * d.z;
    out.push({ distance: t, point: ray.at(t, ray.origin.clone()), object: this, instanceId: i });
  }

  // camera distance that makes a shell of radius r span frac of the viewport's smaller side
  function frameDist(r, fov, aspect, frac) { return r / (2 * frac * Math.tan(fov * Math.PI / 360) * Math.min(1, aspect)); }
  function frame(ms) {
    const cam = g.camera(), el = g.renderer().domElement, h = el.clientHeight || el.height || 1;
    const D = frameDist(R, cam.fov || 50, (el.clientWidth || el.width || h) / h, FRAME_FRAC);
    const p = cam.position, l = Math.hypot(p.x, p.y, p.z), k = l > 1e-6 ? D / l : 0;
    const to = k ? { x: p.x * k, y: p.y * k, z: p.z * k } : { x: 0, y: 0, z: D };
    g.cameraPosition(to, { x: 0, y: 0, z: 0 }, ms);
    return to;
  }
  // mode entry only (not a dataChanged re-enter). Camera still on the library's untouched z axis
  // (fresh mount / never orbited) → instant + one re-check after its update digest; else glide
  function frameOnEntry() {
    if (framedGraph === g) return;
    framedGraph = g;
    const c = g.camera().position, first = c.x === 0 && c.y === 0;
    const to = frame(first ? 0 : FRAME_MS);
    clearTimeout(frameTimer);
    if (first) frameTimer = setTimeout(() => {          // library auto-placed after us: take it back
      if (!g) return;
      const p = g.camera().position;
      if (p.x === 0 && p.y === 0 && Math.abs(p.z - to.z) > 1) frame(0);
    }, REFRAME_MS);
  }

  // hovered/selected node's links as raised great-circle arcs (radius interpolates, so ring riders work)
  function syncHighlight() {
    const st = window.__mm && window.__mm.state, hl = st ? (st.hoverHl || st.hl) : null, id = hl ? hl.id : null;
    if (id !== hlId) {
      hlId = id; arcLinks.length = 0;
      if (id != null && g) {
        for (const l of g.graphData().links) {
          if (endId(l.source) !== id && endId(l.target) !== id) continue;
          if (arcLinks.length >= ARC_MAX) break;
          arcLinks.push(l);
        }
        const n = nodesRef.find((x) => x.id === id);
        if (n && arcs) arcs.material.color.copy(colorOf(ctxRef, n)).lerp(new (T().Color)(1, 1, 1), 0.35);
      }
      bumpDot(id == null ? -1 : nodesRef.findIndex((x) => x.id === id));
      writeArcs();
      return;
    }
    if (arcLinks.length) writeArcs();                  // riders move: keep their arcs attached
  }
  function writeArcs() {
    if (!arcs) return;
    const p = arcs.geometry.attributes.position.array;
    let w = 0;
    for (const l of arcLinks) {
      const a = l.source, b = l.target;
      if (!a || !b || typeof a !== 'object' || typeof b !== 'object' || !Number.isFinite(a.x) || !Number.isFinite(b.x)) continue;
      const ra = Math.hypot(a.x, a.y, a.z) || 1, rb = Math.hypot(b.x, b.y, b.z) || 1;
      const ax = a.x / ra, ay = a.y / ra, az = a.z / ra, bx = b.x / rb, by = b.y / rb, bz = b.z / rb;
      const om = Math.acos(Math.max(-1, Math.min(1, ax * bx + ay * by + az * bz))), so = Math.sin(om);
      const lift = R * ARC_LIFT * om;
      let px = a.x, py = a.y, pz = a.z;
      for (let s = 1; s <= ARC_SEG; s++) {
        const t = s / ARC_SEG;
        let w1 = 1 - t, w2 = t;
        if (so > 1e-4) { w1 = Math.sin((1 - t) * om) / so; w2 = Math.sin(t * om) / so; }
        let dx = w1 * ax + w2 * bx, dy = w1 * ay + w2 * by, dz = w1 * az + w2 * bz;
        const dl = Math.hypot(dx, dy, dz) || 1, r = (ra + (rb - ra) * t + lift * Math.sin(Math.PI * t)) / dl;
        dx *= r; dy *= r; dz *= r;
        p[w++] = px; p[w++] = py; p[w++] = pz; p[w++] = dx; p[w++] = dy; p[w++] = dz;
        px = dx; py = dy; pz = dz;
      }
    }
    arcs.geometry.setDrawRange(0, w / 3);
    arcs.geometry.attributes.position.needsUpdate = true;
  }

  // the highlighted node's dot grows (nodes are the first points of the buffer, same index)
  function bumpDot(ix) {
    if (!dots || ix === hoverIx) return;
    const sz = dots.geometry.attributes.aSize;
    if (hoverIx >= 0 && hoverIx < sz.count) sz.array[hoverIx] = hoverSize;
    hoverIx = ix < nodesRef.length ? ix : -1;
    if (hoverIx >= 0) { hoverSize = sz.array[hoverIx]; sz.array[hoverIx] = Math.max(hoverSize * 2.2, SPACING * 2.2); }
    sz.needsUpdate = true;
  }

  function tick(now) {
    if (dots) dots.material.uniforms.uTime.value = now / 1000 - t0;   // ring-bound dots move in the shader
    if (now - lastStep < STEP_MS) return;
    if (ctxRef && ctxRef.getSettings().colorBy !== colorKey) { window.Modes.dataChanged(); return; }   // regroup patches
    hideEdges();
    place(now);
    syncHighlight();
    syncPx();
  }

  function colorOf(ctx, n) {
    const css = String(ctx.nodeColorFor(n)), c = new (T().Color)();
    const m = css.indexOf('rgb') === 0 ? css.match(/[\d.]+/g) : null;
    if (m && m.length >= 3) c.setRGB(+m[0] / 255, +m[1] / 255, +m[2] / 255, T().SRGBColorSpace); else c.set(css);
    return c;
  }
  function labelSprite(THREE, text, col, below) {
    const cv = document.createElement('canvas'), x = cv.getContext('2d'), fs = 40;
    const font = `600 ${fs}px system-ui, -apple-system, sans-serif`;
    x.font = font; x.letterSpacing = '4px';
    cv.width = Math.ceil(x.measureText(text).width) + 32; cv.height = fs + 20;
    x.font = font; x.letterSpacing = '4px';
    x.textBaseline = 'middle'; x.shadowColor = 'rgba(0,0,0,.85)'; x.shadowBlur = 8;
    x.fillStyle = '#' + col.getHexString(); x.fillText(text, 16, cv.height / 2);
    const s = new THREE.Sprite(new THREE.SpriteMaterial({ map: new THREE.CanvasTexture(cv), transparent: true, depthWrite: false, depthTest: false }));
    const h = R * 0.042; s.scale.set(h * cv.width / cv.height, h, 1); s.userData.lift = below + h * 0.9;   // clear the rider dot
    s.renderOrder = 10; s.frustumCulled = false;
    return s;
  }
  function shortTitle(n) {
    const t = String(n.title || n.id).trim();
    return t.length > TITLE_MAX ? t.slice(0, TITLE_MAX - 1).trimEnd() + '…' : t;
  }

  // soft-sprite additive points: tiny white-hot core + soft hue falloff, back of the shell dimmer,
  // gentle twinkle; ring-bound points (aRing.x = ring, aRing.y = angle) placed from per-ring uniforms
  const VERT = `
    attribute vec3 aColor; attribute float aSize; attribute float aAlpha; attribute vec2 aRing;
    uniform float uTime, uPx, uR, uMaxPx;
    uniform vec3 uRu[3]; uniform vec3 uRv[3]; uniform vec3 uRp[3];   // ring basis u, v; (radius, speed, phase)
    varying vec3 vColor; varying float vAlpha;
    void main() {
      vec3 p = position;
      if (aRing.x > -0.5) {
        int k = int(aRing.x + 0.5);
        vec3 rp = uRp[k];
        float a = aRing.y + rp.y * uTime + rp.z;
        p = rp.x * (cos(a) * uRu[k] + sin(a) * uRv[k]);
      }
      vec4 mv = modelViewMatrix * vec4(p, 1.0);
      float cz = (modelViewMatrix * vec4(0.0, 0.0, 0.0, 1.0)).z;
      float front = 0.5 + 0.5 * clamp((mv.z - cz) / uR, -1.0, 1.0);
      float h = fract(sin(dot(position.xy + aRing, vec2(12.9898, 78.233)) + position.z) * 43758.5453);
      float tw = 0.84 + 0.16 * sin(uTime * (0.7 + 1.6 * h) + 6.2832 * h);
      float px = aSize * uPx / max(-mv.z, 1.0);
      vAlpha = aAlpha * (0.35 + 0.65 * front) * tw * clamp(px / 1.5, 0.15, 1.0);
      vColor = aColor;
      gl_PointSize = clamp(px, 1.0, uMaxPx);
      gl_Position = projectionMatrix * mv;
    }`;
  const FRAG = `
    varying vec3 vColor; varying float vAlpha;
    void main() {
      vec2 q = gl_PointCoord - 0.5; float d2 = dot(q, q) * 4.0;
      if (d2 > 1.0) discard;
      float core = exp(-d2 * 30.0), halo = exp(-d2 * 5.0) * 0.42 * (1.0 - d2);
      gl_FragColor = vec4(mix(vColor, vec3(1.0), core * 0.4), (core + halo) * vAlpha);
      #include <colorspace_fragment>
    }`;

  function syncPx() {
    if (!dots || !g) return;
    const cam = g.camera(), el = g.renderer().domElement, u = dots.material.uniforms;
    u.uPx.value = el.height / (2 * Math.tan((cam.fov || 50) * Math.PI / 360));
    u.uMaxPx.value = Math.max(16, el.height * 0.3);
  }

  function rng(seed) {   // mulberry32: deterministic dust
    let a = seed >>> 0;
    return () => { a = (a + 0x6D2B79F5) >>> 0; let t = a; t = Math.imul(t ^ (t >>> 15), t | 1); t ^= t + Math.imul(t ^ (t >>> 7), t | 61); return ((t ^ (t >>> 14)) >>> 0) / 4294967296; };
  }

  function buildDots(THREE, ctx, rcol, white) {
    const nodes = nodesRef, N = nodes.length, K = riders.length, rix = new Map(riders.map((n, k) => [n.id, k]));
    const shell = [];                                  // indices of positioned shell nodes (dust anchors)
    for (let i = 0; i < N; i++) if (!rix.has(nodes[i].id) && Number.isFinite(nodes[i].x)) shell.push(i);
    const D = Math.min(DUST_MAX, DUST_PER * shell.length), RD = K * (RING_DOTS + RIDE_DOTS), M = N + D + RD + CORE_N + 2;
    const pos = new Float32Array(M * 3), col = new Float32Array(M * 3), size = new Float32Array(M), alpha = new Float32Array(M);
    const ring = new Float32Array(M * 2).fill(-1);
    const cache = new Map(), ncol = new Array(N);
    let maxDeg = 1; for (let i = 0; i < N; i++) if (degRef[i] > maxDeg) maxDeg = degRef[i];
    const lmax = Math.log1p(maxDeg), S = SPACING;
    const put = (j, x, y, z, c, sz, al) => { pos[j * 3] = x; pos[j * 3 + 1] = y; pos[j * 3 + 2] = z;
      col[j * 3] = c.r; col[j * 3 + 1] = c.g; col[j * 3 + 2] = c.b; size[j] = sz; alpha[j] = al; };
    // nodes: point j = node j (bumpDot relies on it); size grows with log degree, capped
    for (let i = 0; i < N; i++) {
      const n = nodes[i], css = String(ctx.nodeColorFor(n));
      if (!cache.has(css)) cache.set(css, colorOf(ctx, n));
      const c = ncol[i] = cache.get(css), k = rix.get(n.id);
      if (k != null) { put(i, 0, 0, 0, c.clone().lerp(white, 0.25), S * 2.1, 1); ring[i * 2] = k; ring[i * 2 + 1] = 0; continue; }
      const t = lmax > 0 ? Math.log1p(degRef[i]) / lmax : 0;
      if (Number.isFinite(n.x)) put(i, n.x, n.y, n.z, c, S * (0.55 + 0.75 * t), 0.95);
    }
    // dust: faint specks scattered around random shell nodes, in their patch colour, on a thin shell
    const rnd = rng(0x0b5eed), tmp = new THREE.Color();
    let j = N;
    for (let d = 0; d < D; d++, j++) {
      const i = shell[(rnd() * shell.length) | 0], n = nodes[i], r0 = Math.hypot(n.x, n.y, n.z) || 1, sp = S * 1.6;
      const x = n.x + (rnd() - 0.5) * 2 * sp, y = n.y + (rnd() - 0.5) * 2 * sp, z = n.z + (rnd() - 0.5) * 2 * sp;
      const k = r0 * (1 + (rnd() - 0.5) * 0.05) / (Math.hypot(x, y, z) || 1);
      tmp.copy(ncol[i]).multiplyScalar(0.75).lerp(white, 0.12);
      put(j, x * k, y * k, z * k, tmp, S * (0.18 + 0.28 * rnd()), 0.3 + 0.4 * rnd());
    }
    // ring dots: a faint dotted ring + a few brighter rider dots, all riding with their ring
    for (let k = 0; k < K; k++) {
      const rc = rcol[k].clone().lerp(white, 0.2);
      for (let s = 0; s < RING_DOTS; s++, j++) {
        put(j, 0, 0, 0, rc, S * (0.2 + 0.1 * rnd()), 0.5); ring[j * 2] = k; ring[j * 2 + 1] = 2 * Math.PI * (s + 0.5 * rnd()) / RING_DOTS;
      }
      for (let s = 0; s < RIDE_DOTS; s++, j++) {
        put(j, 0, 0, 0, rc, S * (0.45 + 0.25 * rnd()), 1); ring[j * 2] = k; ring[j * 2 + 1] = 0.5 + 2 * Math.PI * (s + 0.6 * rnd()) / RIDE_DOTS;
      }
    }
    // core: a tight bright cluster + two soft glows
    const coreCol = (rcol[0] ? rcol[0].clone() : white.clone()).lerp(white, 0.7);
    for (let s = 0; s < CORE_N; s++, j++) {
      const rr = R * 0.05 * Math.sqrt(-2 * Math.log(rnd() + 1e-9)) * (rnd() < 0.85 ? 1 : 2.2);
      const th = 2 * Math.PI * rnd(), ph = Math.acos(2 * rnd() - 1);
      tmp.copy(coreCol).lerp(white, rnd() * 0.6);
      put(j, rr * Math.sin(ph) * Math.cos(th), rr * Math.cos(ph), rr * Math.sin(ph) * Math.sin(th), tmp, S * (0.25 + 0.55 * rnd()), 0.55 + 0.45 * rnd());
    }
    put(j++, 0, 0, 0, coreCol, R * 0.6, 0.6);
    put(j++, 0, 0, 0, coreCol.clone().lerp(white, 0.5), R * 0.16, 0.9);

    const geo = new THREE.BufferGeometry();
    geo.setAttribute('position', new THREE.BufferAttribute(pos, 3));
    geo.setAttribute('aColor', new THREE.BufferAttribute(col, 3));
    geo.setAttribute('aSize', new THREE.BufferAttribute(size, 1));
    geo.setAttribute('aAlpha', new THREE.BufferAttribute(alpha, 1));
    geo.setAttribute('aRing', new THREE.BufferAttribute(ring, 2));
    const ru = [], rv = [], rp = [];
    for (let k = 0; k < 3; k++) {
      const o = k * 3, on = k < K;
      ru.push(new THREE.Vector3(on ? ringU[o] : 1, on ? ringU[o + 1] : 0, on ? ringU[o + 2] : 0));
      rv.push(new THREE.Vector3(on ? ringV[o] : 0, on ? ringV[o + 1] : 1, on ? ringV[o + 2] : 0));
      // shader angle w·(t−t0) + (w·t0 + p) = place()'s w·t + p
      rp.push(new THREE.Vector3(on ? ringR[k] : 0, on ? ringW[k] : 0, on ? ringW[k] * t0 + ringP[k] : 0));
    }
    const mat = new THREE.ShaderMaterial({ vertexShader: VERT, fragmentShader: FRAG, transparent: true, depthWrite: false,
      blending: THREE.AdditiveBlending,
      uniforms: { uTime: { value: performance.now() / 1000 - t0 }, uPx: { value: 1000 }, uR: { value: R }, uMaxPx: { value: 256 },
        uRu: { value: ru }, uRv: { value: rv }, uRp: { value: rp } } });
    const p = new THREE.Points(geo, mat);
    p.frustumCulled = false;
    return p;
  }

  function enter(graph, data, ctx) {
    g = graph; ctxRef = ctx; hlId = undefined; arcLinks.length = 0; hoverIx = -1;
    hideEdges(); queueMicrotask(() => { if (g) hideEdges(); });   // after a same-task Instanced3d.rebuild
    frameOnEntry();
    const THREE = T(); if (!THREE) return;
    const scene = graph.scene(), K = riders.length, white = new THREE.Color(1, 1, 1);
    const rcol = riders.map((n) => colorOf(ctx, n));
    t0 = performance.now() / 1000;

    // orbit rings: all in ONE thin additive LineSegments
    const rp = new Float32Array(K * RING_SEG * 6), rc = new Float32Array(K * RING_SEG * 6);
    for (let k = 0; k < K; k++) {
      const o = k * 3, r = ringR[k], col = rcol[k];
      for (let s = 0; s < RING_SEG; s++) for (let e = 0; e < 2; e++) {
        const a = 2 * Math.PI * (s + e) / RING_SEG, ca = r * Math.cos(a), sa = r * Math.sin(a), w = ((k * RING_SEG + s) * 2 + e) * 3;
        for (let c = 0; c < 3; c++) rp[w + c] = ca * ringU[o + c] + sa * ringV[o + c];
        rc[w] = col.r; rc[w + 1] = col.g; rc[w + 2] = col.b;
      }
    }
    const rg = new THREE.BufferGeometry();
    rg.setAttribute('position', new THREE.BufferAttribute(rp, 3));
    rg.setAttribute('color', new THREE.BufferAttribute(rc, 3));
    rings = new THREE.LineSegments(rg, new THREE.LineBasicMaterial({ vertexColors: true, transparent: true, opacity: 0.22,
      blending: THREE.AdditiveBlending, depthWrite: false }));
    rings.frustumCulled = false; scene.add(rings);

    // nodes + dust + ring dots + core: ONE Points
    dots = buildDots(THREE, ctx, rcol, white);
    scene.add(dots); syncPx();

    // highlight arcs: ONE preallocated LineSegments, drawRange set per highlight
    const ag = new THREE.BufferGeometry();
    ag.setAttribute('position', new THREE.BufferAttribute(new Float32Array(ARC_MAX * ARC_SEG * 6), 3));
    ag.setDrawRange(0, 0);
    arcs = new THREE.LineSegments(ag, new THREE.LineBasicMaterial({ color: 0xffffff, transparent: true, opacity: 0.7,
      blending: THREE.AdditiveBlending, depthWrite: false }));
    arcs.frustumCulled = false; scene.add(arcs);

    // rider labels, short: "GROUP · clipped title"
    labels = riders.map((n, k) => {
      const s = labelSprite(THREE, `${dbg.ringRiders[k].label.toUpperCase()} · ${shortTitle(n)}`, rcol[k].clone().lerp(white, 0.45), SPACING * 0.6);
      scene.add(s); return s;
    });
    place(performance.now());
    syncHighlight();
  }

  function exit() {
    showEdges();
    for (const o of [rings, dots, arcs, ...labels]) {
      if (!o) continue;
      if (g) g.scene().remove(o);
      if (o.geometry && !o.isSprite) o.geometry.dispose();
      if (o.material.map) o.material.map.dispose();
      o.material.dispose();
    }
    rings = dots = arcs = null; labels = []; g = null; hlId = undefined; arcLinks.length = 0; hoverIx = -1;
    // dataChanged re-enters in the same task (g set again) → keep framedGraph so the camera stays put;
    // a real leave/teardown leaves g null → the next entry frames
    queueMicrotask(() => { if (!g) { framedGraph = null; clearTimeout(frameTimer); } });
  }

  // per-node radius from the centre (live positions) + ring riders; radiusCV excludes riders
  function debug() {
    const rid = new Set(riders.map((n) => n.id)), radius = {};
    let s = 0, s2 = 0, m = 0;
    for (const n of nodesRef) {
      if (!Number.isFinite(n.x)) continue;
      const r = Math.hypot(n.x, n.y, n.z || 0); radius[n.id] = r;
      if (!rid.has(n.id)) { s += r; s2 += r * r; m++; }
    }
    const mean = m ? s / m : 0, sd = m ? Math.sqrt(Math.max(0, s2 / m - mean * mean)) : 0;
    const eh = edgeHandles(), sh = sphereHandles();
    return Object.assign({}, dbg, { radius, radiusCV: mean ? sd / mean : 0, shellNodes: m,
      edgesHidden: eh.length > 0 && eh.every((o) => o.material.visible === false),
      spheresHidden: sh.length > 0 && sh.every((o) => o.material.visible === false),
      particles: dots ? dots.geometry.attributes.position.count : 0,
      highlight: hlId == null ? null : hlId, highlightArcs: arcLinks.length, pickPatched: !!pickInst && pickInst.raycast === pickRaycast });
  }

  window.Modes.register('orb', { allowsDrag: false, layout, enter, exit, tick, debug, _pickIx: pickIx, _frameDist: frameDist });   // _* exposed for tests
})();
