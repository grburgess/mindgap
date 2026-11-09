/* mindgap 3D motion toggles (Look section) — four INDEPENDENT effects, all default OFF:
     linkPulses  synapse-like glowing pulses travelling along links; a pulse arriving at a node
                 often cascades onto another of that node's links. ONE THREE.Points (PULSES heads ×
                 TAIL points), one small typed-array rewrite per frame.
     aliveDrift  the graph keeps breathing: every unpinned node gets a bounded sinusoidal offset
                 (amplitude 0.2 × link distance, ≤40 Hz). Applied as a DELTA (new offset − last offset), so
                 it composes with the sim and drags, can never accumulate/explode, and OFF subtracts
                 the last offset (exact restore). The d3 sim/alpha floor is never touched.
     orbitRings  particle rings orbiting the top-RING_HUBS hubs by degree. ONE THREE.Points.
     autoTour    the camera tours on its own: overview → top hubs, smooth eased flights + slow
                 orbit dwell. Any user input (pointer/wheel/key) pauses it; it resumes after
                 IDLE_MS by flying on from wherever the user left the camera.
   View modes (modes/modes.js): pulses, rings and tour follow live node positions in every mode;
   aliveDrift is vetoed (setDriftAllowed(false), called by modes.js) while a fixed-layout mode
   (universe/matrix/orb/brain: nodes pinned) is active and runs in graph + genesis. Graph-data swaps carry drift offsets, pulses and rings by id (exact,
   no reset on genesis growth). Mode switches suspend drift around the position snapshot/restore.
   Each OFF disposes its objects (or removes its offsets / releases the camera); with all four OFF
   the rAF loop is stopped → zero cost (default look unchanged). Graph-data swaps are detected by
   array identity each frame and rebuild the per-node/per-link tables (no ghosts).
   setDriftAllowed(ok, reason): an external veto on aliveDrift (fixed-layout view modes pin every
   node, so drift is meaningless there). Not allowed → drift is removed as if toggled OFF, but the
   saved aliveDrift preference is never touched, so it resumes when allowed again. Survives
   install/teardown (it's view-mode state, not graph state). Changes fire window 'motion:drift'
   ({ allowed, reason }) so the Look toggle can render disabled + the reason note.
   ctx (from app.js): { nodes(), links(), nodeVal(n), nodeColorFor(n), getSettings() }.
   THREE from window.THREE (ESM shim). 3D-only. Motion.debug() = read-only verifier snapshot. */
'use strict';
(function () {
  let graph = null, ctx = null, raf = 0, lastT = 0, warned = false;
  let nodesRef = null, linksRef = null;          // data identity → rebuild tables on swap
  let prevNodes = null, prevLSrc = null, prevLTgt = null;   // tables before the last swap (carry state by id)
  let idIx = null;                               // node id → index (per data swap)
  let lSrc = null, lTgt = null;                  // link endpoint node indices (Int32Array)
  let adjOff = null, adjLnk = null;              // CSR node → incident link indices

  const PULSES = 240, TAIL = 3, TAIL_STEP = 0.035, PULSE_SPEED = 90, CASCADE = 0.7;
  let pulsePts = null, pLink = null, pPhase = null, pDir = null;
  const DRIFT_K = 0.2, DRIFT_HZ = 40;            // amplitude = DRIFT_K × linkDist (bounded offset); offsets re-applied at ≤40 Hz
  let dPrev = null, dPhase = null, dFreq = null, dLast = 0;   // per-node last applied offset / phases / freqs; last apply time
  const RING_HUBS = 24, RINGS = 2, RING_PTS = 16;
  let ringPts = null, ringHub = [], ringBasis = null, ringRad = null, ringSpin = null, ringT = 0;
  const IDLE_MS = 6000, FLY_S = 4, DWELL_S = 7, TOUR_HUBS = 6, ORBIT_W = 0.22;
  let tour = null;                               // { leg:'fly'|'dwell', w, t, from, theta, pausedUntil, ... }
  let dom = null, onInput = null;
  let driftOk = true, driftWhy = '';             // external veto (setDriftAllowed); NOT a setting

  function THREE() { return window.THREE || null; }
  function S() { return ctx ? ctx.getSettings() : {}; }
  function driftOn() { return !!(S().aliveDrift && driftOk); }   // saved preference AND not vetoed
  function anyOn() { const s = S(); return !!(s.linkPulses || driftOn() || s.orbitRings || s.autoTour); }
  function hasPos(n) { return n && n.x != null && Number.isFinite(n.x); }
  function radiusOf(n) { return Math.cbrt(Math.max(ctx.nodeVal(n), 0.01)) * 4; }   // matches instanced3d
  let seed = 1;
  function rnd() { seed = (seed * 16807) % 2147483647; return (seed - 1) / 2147483646; }   // deterministic
  function setColor(c, css) {                    // THREE.Color warns on rgba(); strip to the rgb triple
    const s = String(css);
    if (s.indexOf('rgb') === 0) { const m = s.match(/[\d.]+/g); if (m && m.length >= 3) return c.setRGB(+m[0] / 255, +m[1] / 255, +m[2] / 255); }
    return c.set(s);
  }
  function accent() {
    const c = getComputedStyle(document.documentElement).getPropertyValue('--green').trim();
    return c || '#57c7a4';
  }

  // shared soft-glow point shader: per-point colour + size, round falloff, additive
  function pointMaterial(T) {
    return new T.ShaderMaterial({
      transparent: true, depthWrite: false, blending: T.AdditiveBlending,
      uniforms: { uPx: { value: Math.min(window.devicePixelRatio || 1, 1.5) } },
      vertexShader: [
        'attribute float aSize; attribute vec3 aColor; uniform float uPx; varying vec3 vC; varying float vA;',
        'void main() {',
        '  vec4 mv = modelViewMatrix * vec4(position, 1.0);',
        '  gl_Position = projectionMatrix * mv;',
        '  vC = aColor; vA = aSize > 0.0 ? 1.0 : 0.0;',
        '  gl_PointSize = aSize * uPx * (300.0 / max(-mv.z, 1.0));',
        '}'].join('\n'),
      fragmentShader: [
        'varying vec3 vC; varying float vA;',
        'void main() {',
        '  float d = length(gl_PointCoord - 0.5);',
        '  float a = smoothstep(0.5, 0.0, d); a *= a;',
        '  if (vA < 0.5 || a < 0.01) discard;',
        '  gl_FragColor = vec4(vC * (0.6 + 1.4 * a), a);',
        '}'].join('\n'),
    });
  }
  function pointsObject(T, count) {
    const geo = new T.BufferGeometry();
    geo.setAttribute('position', new T.BufferAttribute(new Float32Array(count * 3), 3));
    geo.setAttribute('aSize', new T.BufferAttribute(new Float32Array(count), 1));
    geo.setAttribute('aColor', new T.BufferAttribute(new Float32Array(count * 3), 3));
    const p = new T.Points(geo, pointMaterial(T));
    p.frustumCulled = false; p.renderOrder = 2;
    graph.scene().add(p);
    return p;
  }
  function dispose(o) { if (o && graph) { graph.scene().remove(o); o.geometry.dispose(); o.material.dispose(); } }

  // ---- data tables (rebuilt on every graphData swap) ----
  function syncData() {
    const nodes = ctx.nodes(), links = ctx.links();
    if (nodes === nodesRef && links === linksRef) return false;
    prevNodes = nodesRef; prevLSrc = lSrc; prevLTgt = lTgt;
    nodesRef = nodes; linksRef = links;
    idIx = new Map(); for (let i = 0; i < nodes.length; i++) idIx.set(nodes[i].id, i);
    const E = links.length;
    lSrc = new Int32Array(E); lTgt = new Int32Array(E);
    const deg = new Int32Array(nodes.length + 1);
    for (let i = 0; i < E; i++) {
      const s = links[i].source, t = links[i].target;
      const si = idIx.get(s && typeof s === 'object' ? s.id : s), ti = idIx.get(t && typeof t === 'object' ? t.id : t);
      lSrc[i] = si == null ? -1 : si; lTgt[i] = ti == null ? -1 : ti;
      if (si != null) deg[si + 1]++; if (ti != null) deg[ti + 1]++;
    }
    for (let i = 0; i < nodes.length; i++) deg[i + 1] += deg[i];
    adjOff = deg; adjLnk = new Int32Array(deg[nodes.length]);
    const fill = adjOff.slice(0, nodes.length);
    for (let i = 0; i < E; i++) { if (lSrc[i] >= 0) adjLnk[fill[lSrc[i]]++] = i; if (lTgt[i] >= 0) adjLnk[fill[lTgt[i]]++] = i; }
    return true;
  }

  // ---- linkPulses ----
  function spawnPulse(k, fromNode) {
    const E = lSrc.length;
    let li = -1, dir = 1;
    if (fromNode >= 0 && rnd() < CASCADE) {      // synapse cascade: continue onto another incident link
      const a = adjOff[fromNode], b = adjOff[fromNode + 1];
      if (b - a > 1) {
        let j = a + Math.floor(rnd() * (b - a));
        if (adjLnk[j] === pLink[k]) j = a + ((j - a + 1) % (b - a));   // don't bounce straight back
        li = adjLnk[j];
        dir = lSrc[li] === fromNode ? 1 : -1;
      }
    }
    if (li < 0) { li = Math.floor(rnd() * E); dir = rnd() < 0.5 ? 1 : -1; }
    pLink[k] = li; pDir[k] = dir;
  }
  function buildPulses() {
    const T = THREE(); dispose(pulsePts); pulsePts = null;
    if (!lSrc.length) return;
    pulsePts = pointsObject(T, PULSES * TAIL);
    pLink = new Int32Array(PULSES); pPhase = new Float32Array(PULSES); pDir = new Int8Array(PULSES);
    for (let k = 0; k < PULSES; k++) { spawnPulse(k, -1); pPhase[k] = -rnd() * 1.5; }   // staggered starts
    const c = new T.Color(accent()), col = pulsePts.geometry.attributes.aColor.array;
    for (let i = 0; i < PULSES * TAIL; i++) { const w = 1 - (i % TAIL) * 0.3; col[i * 3] = c.r * w + 0.25; col[i * 3 + 1] = c.g * w + 0.25; col[i * 3 + 2] = c.b * w + 0.25; }
  }
  function carryPulses() {                       // data swap: keep each pulse on its link (by endpoint ids), so
    if (!lSrc.length) { dispose(pulsePts); pulsePts = null; pLink = pPhase = pDir = null; return; }   // growth swaps (genesis) don't reset the field
    const key = new Map();
    for (let i = 0; i < lSrc.length; i++) if (lSrc[i] >= 0 && lTgt[i] >= 0) key.set(nodesRef[lSrc[i]].id + '\n' + nodesRef[lTgt[i]].id, i);
    for (let k = 0; k < PULSES; k++) {
      const li = pLink[k], a = prevLSrc && li < prevLSrc.length ? prevLSrc[li] : -1, b = a >= 0 ? prevLTgt[li] : -1;
      const j = a >= 0 && b >= 0 ? key.get(prevNodes[a].id + '\n' + prevNodes[b].id) : undefined;
      if (j != null) pLink[k] = j; else { spawnPulse(k, -1); pPhase[k] = 0; }
    }
  }
  function stepPulses(dt) {
    const nodes = nodesRef, pos = pulsePts.geometry.attributes.position.array, sz = pulsePts.geometry.attributes.aSize.array;
    for (let k = 0; k < PULSES; k++) {
      const li = pLink[k], a = nodes[lSrc[li]], b = nodes[lTgt[li]];
      const o = k * TAIL;
      if (!hasPos(a) || !hasPos(b)) { pPhase[k] += dt; if (pPhase[k] > 1) { spawnPulse(k, -1); pPhase[k] = 0; } for (let j = 0; j < TAIL; j++) sz[o + j] = 0; continue; }
      const dx = b.x - a.x, dy = b.y - a.y, dz = (b.z || 0) - (a.z || 0);
      const len = Math.sqrt(dx * dx + dy * dy + dz * dz) || 1;
      let ph = pPhase[k] + dt * Math.min(Math.max(PULSE_SPEED / len, 0.4), 3);
      if (ph >= 1) {                             // arrived: fire onward from the arrival node
        spawnPulse(k, pDir[k] > 0 ? lTgt[li] : lSrc[li]);
        ph = 0;
      }
      pPhase[k] = ph;
      const L = pLink[k], A = nodes[lSrc[L]], B = nodes[lTgt[L]];
      if (!hasPos(A) || !hasPos(B)) { for (let j = 0; j < TAIL; j++) sz[o + j] = 0; continue; }
      const env = ph < 0 ? 0 : Math.sin(Math.PI * Math.min(ph, 1));   // fade in/out along the link
      for (let j = 0; j < TAIL; j++) {
        const q = ph - j * TAIL_STEP, i3 = (o + j) * 3;
        if (q < 0) { sz[o + j] = 0; continue; }
        const f = pDir[k] > 0 ? q : 1 - q;
        pos[i3] = A.x + (B.x - A.x) * f; pos[i3 + 1] = A.y + (B.y - A.y) * f; pos[i3 + 2] = (A.z || 0) + ((B.z || 0) - (A.z || 0)) * f;
        sz[o + j] = (14 - j * 4) * (0.35 + 0.65 * env);
      }
    }
    pulsePts.geometry.attributes.position.needsUpdate = true;
    pulsePts.geometry.attributes.aSize.needsUpdate = true;
  }

  // ---- aliveDrift ----
  function driftAmp() { const d = +S().linkDist; return DRIFT_K * (Number.isFinite(d) ? d : 55); }
  function buildDrift() {
    const N = nodesRef.length;
    dPrev = new Float32Array(N * 3); dPhase = new Float32Array(N * 3); dFreq = new Float32Array(N * 3);
    for (let i = 0; i < N * 3; i++) { dPhase[i] = rnd() * Math.PI * 2; dFreq[i] = (0.06 + rnd() * 0.12) * Math.PI * 2; }
  }
  function carryDrift() {                        // data swap: surviving nodes keep offset + phases by id (their carried
    const oP = dPrev, oPh = dPhase, oF = dFreq, oIx = new Map();   // position already includes the offset) → still exact
    for (let i = 0; i < prevNodes.length; i++) oIx.set(prevNodes[i].id, i);
    buildDrift();
    for (let i = 0; i < nodesRef.length; i++) {
      const j = oIx.get(nodesRef[i].id); if (j == null) continue;
      for (let c = 0; c < 3; c++) { dPrev[i * 3 + c] = oP[j * 3 + c]; dPhase[i * 3 + c] = oPh[j * 3 + c]; dFreq[i * 3 + c] = oF[j * 3 + c]; }
    }
  }
  function stepDrift(t) {
    const nodes = nodesRef, A = driftAmp();
    for (let i = 0; i < nodes.length; i++) {
      const n = nodes[i], o = i * 3;
      if (!hasPos(n) || n.fx != null) continue;  // pinned / being dragged: leave alone
      const ox = A * Math.sin(dFreq[o] * t + dPhase[o]), oy = A * Math.sin(dFreq[o + 1] * t + dPhase[o + 1]), oz = A * Math.sin(dFreq[o + 2] * t + dPhase[o + 2]);
      n.x += ox - dPrev[o]; n.y += oy - dPrev[o + 1]; n.z = (n.z || 0) + oz - dPrev[o + 2];
      dPrev[o] = ox; dPrev[o + 1] = oy; dPrev[o + 2] = oz;
    }
  }
  function removeDrift() {                       // OFF: subtract the last applied offset (exact restore)
    if (dPrev && nodesRef) {
      for (let i = 0; i < nodesRef.length; i++) {
        const n = nodesRef[i], o = i * 3; if (!hasPos(n)) continue;
        n.x -= dPrev[o]; n.y -= dPrev[o + 1]; n.z = (n.z || 0) - dPrev[o + 2];
      }
    }
    dPrev = null; dPhase = null; dFreq = null;
  }

  // ---- orbitRings ----
  function topHubs(k) {
    return nodesRef.filter((n) => (n._deg || 0) > 0).sort((a, b) => (b._deg || 0) - (a._deg || 0)).slice(0, k);
  }
  function carryRings() {                        // data swap: same hubs (by id) → keep the rings, re-point at the new objects
    const hubs = topHubs(RING_HUBS);
    if (ringPts && hubs.length === ringHub.length && hubs.every((n, i) => n.id === ringHub[i].id)) ringHub = hubs; else buildRings();
  }
  function buildRings() {
    const T = THREE(); dispose(ringPts); ringPts = null;
    ringHub = topHubs(RING_HUBS);
    if (!ringHub.length) return;
    const R = ringHub.length * RINGS, count = R * RING_PTS;
    ringPts = pointsObject(T, count);
    ringBasis = new Float32Array(R * 6); ringRad = new Float32Array(R); ringSpin = new Float32Array(R);
    const u = new T.Vector3(), v = new T.Vector3(), nrm = new T.Vector3(), c = new T.Color(), white = new T.Color(1, 1, 1);
    const col = ringPts.geometry.attributes.aColor.array, sz = ringPts.geometry.attributes.aSize.array;
    for (let r = 0; r < R; r++) {
      const hub = ringHub[Math.floor(r / RINGS)];
      nrm.set(rnd() - 0.5, rnd() - 0.5, rnd() - 0.5).normalize();   // random tilt
      u.set(1, 0, 0); if (Math.abs(nrm.x) > 0.9) u.set(0, 1, 0);
      u.cross(nrm).normalize(); v.crossVectors(nrm, u);
      ringBasis.set([u.x, u.y, u.z, v.x, v.y, v.z], r * 6);
      ringRad[r] = radiusOf(hub) * (3.2 + 1.2 * (r % RINGS)) + 12;   // clear of the hub's bloom halo
      ringSpin[r] = (0.6 + rnd() * 0.6) * (r % RINGS ? -1 : 1);
      setColor(c, ctx.nodeColorFor(hub)).lerp(white, 0.35);
      for (let k = 0; k < RING_PTS; k++) {
        const i = r * RING_PTS + k;
        col[i * 3] = c.r; col[i * 3 + 1] = c.g; col[i * 3 + 2] = c.b;
        sz[i] = 3 + 9 * (k / (RING_PTS - 1));   // comet: trailing particles shrink
      }
    }
    ringPts.geometry.attributes.aColor.needsUpdate = true;
    ringPts.geometry.attributes.aSize.needsUpdate = true;
  }
  function stepRings(dt) {
    ringT += dt;
    const pos = ringPts.geometry.attributes.position.array, R = ringHub.length * RINGS, arc = 1.6 / RING_PTS;
    for (let r = 0; r < R; r++) {
      const n = ringHub[Math.floor(r / RINGS)], b = r * 6, rad = ringRad[r];
      const cx = hasPos(n) ? n.x : 0, cy = hasPos(n) ? n.y : 0, cz = hasPos(n) ? (n.z || 0) : 0;
      const a0 = ringSpin[r] * ringT + r;
      for (let k = 0; k < RING_PTS; k++) {
        const a = a0 + Math.sign(ringSpin[r]) * k * arc, ca = Math.cos(a) * rad, sa = Math.sin(a) * rad, i3 = (r * RING_PTS + k) * 3;
        pos[i3] = cx + ca * ringBasis[b] + sa * ringBasis[b + 3];
        pos[i3 + 1] = cy + ca * ringBasis[b + 1] + sa * ringBasis[b + 4];
        pos[i3 + 2] = cz + ca * ringBasis[b + 2] + sa * ringBasis[b + 5];
      }
    }
    ringPts.geometry.attributes.position.needsUpdate = true;
  }

  // ---- autoTour ----
  function bump() { if (tour) { tour.pausedUntil = performance.now() + IDLE_MS; tour.resume = true; } }
  function bindInput() {
    if (onInput) return;
    dom = graph.renderer().domElement; onInput = bump;
    dom.addEventListener('pointerdown', onInput); dom.addEventListener('wheel', onInput, { passive: true });
    window.addEventListener('keydown', onInput);
  }
  function unbindInput() {
    if (dom && onInput) { dom.removeEventListener('pointerdown', onInput); dom.removeEventListener('wheel', onInput); }
    if (onInput) window.removeEventListener('keydown', onInput);
    dom = null; onInput = null;
  }
  function overview() {                          // centroid + bounding radius of the positioned nodes
    let cx = 0, cy = 0, cz = 0, m = 0;
    for (const n of nodesRef) if (hasPos(n)) { cx += n.x; cy += n.y; cz += n.z || 0; m++; }
    if (!m) return { c: { x: 0, y: 0, z: 0 }, d: 400 };
    cx /= m; cy /= m; cz /= m;
    let r2 = 0; for (const n of nodesRef) if (hasPos(n)) { const dx = n.x - cx, dy = n.y - cy, dz = (n.z || 0) - cz; r2 += dx * dx + dy * dy + dz * dz; }
    return { c: { x: cx, y: cy, z: cz }, d: Math.max(200, Math.sqrt(r2 / m) * 2.6) };
  }
  function waypoint(w) {                         // 0 = overview, 1.. = top hubs (live positions)
    if (w === 0) { if (!tour.ov) tour.ov = overview(); return tour.ov; }
    const n = tour.hubs[w - 1];
    return hasPos(n) ? { c: { x: n.x, y: n.y, z: n.z || 0 }, d: 250 + radiusOf(n) * 14 } : overview();
  }
  function desired(w) {
    const p = waypoint(w), th = tour.theta;
    return { tx: p.c.x, ty: p.c.y, tz: p.c.z, px: p.c.x + Math.cos(th) * p.d, py: p.c.y + p.d * 0.35, pz: p.c.z + Math.sin(th) * p.d };
  }
  function startLeg(w) {
    const cam = graph.camera(), c = graph.controls(), t = c && c.target ? c.target : { x: 0, y: 0, z: 0 };
    tour.from = { px: cam.position.x, py: cam.position.y, pz: cam.position.z, tx: t.x, ty: t.y, tz: t.z };
    tour.theta = Math.atan2(cam.position.z - t.z, cam.position.x - t.x);   // keep the current bearing
    tour.w = w; tour.leg = 'fly'; tour.t = 0; tour.ov = null;
  }
  function startTour() {
    tour = { hubs: topHubs(TOUR_HUBS), w: 0, leg: 'fly', t: 0, theta: 0, from: null, pausedUntil: 0, resume: false, ov: null };
    bindInput();
    startLeg(tour.hubs.length ? 1 : 0);
  }
  function stopTour() { unbindInput(); tour = null; }
  function stepTour(dt) {
    const now = performance.now();
    if (now < tour.pausedUntil) return;          // user is driving
    const nWp = tour.hubs.length + 1;
    if (tour.resume) { tour.resume = false; startLeg((tour.w + 1) % nWp); }   // fly on from where the user left it
    tour.t += dt; tour.theta += ORBIT_W * dt;
    const d = desired(tour.w);
    let px, py, pz, tx, ty, tz;
    if (tour.leg === 'fly') {
      const u = Math.min(tour.t / FLY_S, 1), e = u * u * (3 - 2 * u), f = tour.from;   // smoothstep
      px = f.px + (d.px - f.px) * e; py = f.py + (d.py - f.py) * e; pz = f.pz + (d.pz - f.pz) * e;
      tx = f.tx + (d.tx - f.tx) * e; ty = f.ty + (d.ty - f.ty) * e; tz = f.tz + (d.tz - f.tz) * e;
      if (u >= 1) { tour.leg = 'dwell'; tour.t = 0; }
    } else {
      px = d.px; py = d.py; pz = d.pz; tx = d.tx; ty = d.ty; tz = d.tz;
      if (tour.t >= DWELL_S) startLeg((tour.w + 1) % nWp);
    }
    const cam = graph.camera(), c = graph.controls();
    cam.position.set(px, py, pz);
    if (c && c.target) c.target.set(tx, ty, tz);
    cam.lookAt(tx, ty, tz);
  }

  // ---- loop / lifecycle ----
  function rebuildAll() {                        // data swap: per-node/per-link tables changed
    seed = 1;
    if (dPrev) carryDrift(); else if (driftOn()) buildDrift();
    if (S().linkPulses) { if (pulsePts) carryPulses(); else buildPulses(); } else { dispose(pulsePts); pulsePts = null; }
    if (S().orbitRings) carryRings(); else { dispose(ringPts); ringPts = null; }
    if (tour) tour.hubs = topHubs(TOUR_HUBS);
  }
  function loop() {
    if (!graph) { raf = 0; return; }
    raf = requestAnimationFrame(loop);
    const now = performance.now(), dt = Math.min((now - lastT) / 1000, 0.05);
    lastT = now;
    if (document.hidden || dt <= 0) return;
    if (syncData()) rebuildAll();
    const t = now / 1000;
    // drift first: pulses/rings ride the drifted positions. Throttled to DRIFT_HZ: a drift frame
    // dirties instanced3d's full 5k-matrix/10k-edge/arrow rewrite, and the motion is ~0.3 units
    // per 25 ms step — visually continuous, ~3x cheaper than every frame at 120 Hz
    if (dPrev && t - dLast >= 1 / DRIFT_HZ) { dLast = t; stepDrift(t); }
    if (pulsePts) stepPulses(dt);
    if (ringPts) stepRings(dt);
    if (tour) stepTour(dt);
  }
  function refresh() {
    if (!graph || !THREE()) return;
    const s = S();
    if (syncData()) rebuildAll();
    if (driftOn() && !dPrev) buildDrift(); else if (!driftOn() && dPrev) removeDrift();
    if (s.linkPulses) { if (!pulsePts) buildPulses(); else buildPulseColors(); } else { dispose(pulsePts); pulsePts = null; pLink = pPhase = pDir = null; }
    if (s.orbitRings) { buildRings(); } else { dispose(ringPts); ringPts = null; ringHub = []; }
    if (s.autoTour && !tour) startTour(); else if (!s.autoTour && tour) stopTour();
    if (anyOn() && !raf) { lastT = performance.now(); loop(); }
    else if (!anyOn() && raf) { cancelAnimationFrame(raf); raf = 0; }
  }
  function buildPulseColors() {                  // theme change: recolour without resetting pulses
    const c = new (THREE().Color)(accent()), col = pulsePts.geometry.attributes.aColor.array;
    for (let i = 0; i < PULSES * TAIL; i++) { const w = 1 - (i % TAIL) * 0.3; col[i * 3] = c.r * w + 0.25; col[i * 3 + 1] = c.g * w + 0.25; col[i * 3 + 2] = c.b * w + 0.25; }
    pulsePts.geometry.attributes.aColor.needsUpdate = true;
  }
  function setDriftAllowed(ok, reason) {
    ok = !!ok; const why = ok ? '' : String(reason || '');
    if (ok === driftOk && why === driftWhy) return;
    driftOk = ok; driftWhy = why;
    refresh();                                   // no-op when not installed (e.g. 2D)
    window.dispatchEvent(new CustomEvent('motion:drift', { detail: driftState() }));
  }
  function driftState() { return { allowed: driftOk, reason: driftWhy }; }
  // modes.js calls this before it snapshots/restores node positions on a mode switch, so the snapshot
  // and the restore are drift-free; Motion.refresh() after the switch re-arms drift where allowed
  function suspendDrift() { if (!graph) return; if (syncData()) rebuildAll(); removeDrift(); }
  function install(g, context) {
    teardown(); graph = g; ctx = context;
    if (!THREE()) { if (!warned) { console.warn('[Motion] THREE unavailable'); warned = true; } return; }
    seed = 1; refresh();
  }
  function teardown() {
    if (raf) { cancelAnimationFrame(raf); raf = 0; }
    removeDrift(); stopTour();
    dispose(pulsePts); dispose(ringPts);
    pulsePts = null; ringPts = null; ringHub = []; pLink = pPhase = pDir = null;
    nodesRef = linksRef = idIx = lSrc = lTgt = adjOff = adjLnk = null;
    prevNodes = prevLSrc = prevLTgt = null;
    graph = null; ctx = null;
  }

  // read-only verifier snapshot: per-toggle state + handles + COPIED position samples
  function debug() {
    const s = S(), cam = graph ? graph.camera().position : null;
    const nodes = nodesRef || (ctx ? ctx.nodes() : []);
    const nodeSample = [];
    for (let i = 0; i < Math.min(20, nodes.length); i++) { const n = nodes[i]; nodeSample.push({ id: n.id, x: n.x, y: n.y, z: n.z || 0 }); }
    const heads = [];
    if (pulsePts) { const p = pulsePts.geometry.attributes.position.array, z = pulsePts.geometry.attributes.aSize.array; for (let k = 0; k < PULSES; k++) { const i = k * TAIL; if (z[i] > 0) heads.push([p[i * 3], p[i * 3 + 1], p[i * 3 + 2]]); } }
    return {
      installed: !!graph, running: !!raf,
      linkPulses: { on: !!s.linkPulses, object: pulsePts, max: PULSES, points: pulsePts ? PULSES * TAIL : 0, visible: heads.length, positions: heads },
      aliveDrift: { on: !!s.aliveDrift, allowed: driftOk, reason: driftWhy, active: !!dPrev, amplitude: dPrev ? driftAmp() : 0, nodes: nodes.length, sample: nodeSample },
      orbitRings: { on: !!s.orbitRings, object: ringPts, hubs: ringHub.length, particles: ringPts ? ringHub.length * RINGS * RING_PTS : 0,
        positions: ringPts ? Array.from(ringPts.geometry.attributes.position.array.slice(0, 48)) : [] },
      autoTour: { on: !!s.autoTour, active: !!tour, paused: !!(tour && performance.now() < tour.pausedUntil), leg: tour ? tour.leg : null, waypoint: tour ? tour.w : null,
        camera: cam ? { x: cam.x, y: cam.y, z: cam.z } : null },
    };
  }

  window.Motion = { install, teardown, refresh, suspendDrift, debug, setDriftAllowed, driftState };
})();
