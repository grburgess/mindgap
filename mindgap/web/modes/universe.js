/* mindgap view mode "universe" — every project is a sun (at most the 12 biggest systems; smaller
   projects orbit as planets); each other node orbits the sun it is fewest hops from (multi-source BFS;
   ties go to the higher-degree sun). < 3 'project' nodes (e.g. the dense perf map) → the top-12 nodes by
   degree are the suns. Nodes no sun reaches sit on a thin flat belt around all systems. Suns spread on a
   Fibonacci sphere sized so no two systems overlap; members ride gently tilted circular lanes (inner
   lanes first, closer hops inside), Kepler-like ω ∝ r^-1.5 so inner lanes run faster.

   Look (deep space, not a wireframe): cross-system links hidden and intra-system links faint (linkAlpha;
   a hovered/selected node's links still show), graph FX off (photons/arrows/hub glow), node spheres
   shrunk to planets with an additive glow dot each, compact bloom-tagged sun cores + modest corona,
   darkened theme bg and dimmed starfield (both restored on exit).

   Cost: decorations are 4 objects total — ONE LineSegments (all orbit rings), ONE bloom-tagged
   InstancedMesh (compact sun cores), ONE Points (sun coronas), ONE Points (planet glow). Motion is one
   tight typed-array pass per step: each member stores its (r·cosφ, r·sinφ) once and its lane's
   (cos ωt, sin ωt) is computed once per lane, so a member costs a 2D rotation + 2 axpys — no trig, no
   allocation (the planet-glow positions are written in the same pass). Steps run at ~30 Hz;
   instanced3d's dirty-checked loop mirrors them and idles on the frames between. Registered via Modes.register. */
'use strict';
(function () {
  const FALLBACK_SUNS = 12, MAX_SUNS = 12, LANE_GAP = 22, LANE_DR = 14, SPACING = 12, W0 = 0.25, TILT = 0.2;
  const SYS_GAP = 60, SHELL_GAP = 90, BELT_W = 0.16, BELT_H = 0.05, RING_SEG = 64, T0 = performance.now();
  const STEP_MS = 33;   // orbit updates at ~30 Hz: inner lanes move <0.5 units/step (sub-pixel), and the
                        // frames between steps stay clean for instanced3d/bloom's dirty gates (~4x less work at 120 Hz)
  const CORE_K = 0.7, CORONA = 130, BG_DARK = 0.72, STAR_GAIN = 0.45, PLANET_K = 0.32, PLANET_GLOW = 12;   // look: compact cores, modest corona, deep bg
  const INTRA_LINK = 0.12;   // link alpha × this inside one system; cross-system links hidden (hover/selection reveals)
  let lastStep = -Infinity;
  let g = null, rings = null, glow = null, corona = null, planets = null, planetPos = null, bgPrev = null, bgOurs = null;
  let dbg = { suns: [], memberSun: {}, orbitRadius: {}, outerShell: [], sunSource: 'none' };
  // motion state (typed arrays, rebuilt per layout)
  let memNodes = [], memLane = null, memC = null, memS = null;
  let laneW = null, laneO = null, laneU = null, laneV = null, laneR = null, laneCos = null, laneSin = null, laneSun = [];
  let sunNodes = [], sunPos = [], sunR = [], sysOf = new Map();   // sysOf: node id → system index (suns + members)

  function T() { return window.THREE; }
  const endId = (e) => (e && typeof e === 'object' ? e.id : e);
  function hash(s) {                                   // FNV-1a → [0,1), deterministic layout
    let h = 0x811c9dc5; s = String(s);
    for (let i = 0; i < s.length; i++) { h ^= s.charCodeAt(i); h = Math.imul(h, 0x01000193); }
    return (h >>> 0) / 4294967296;
  }
  function unitFrom(seed) {                            // deterministic unit vector
    const z = 2 * hash(seed + ':z') - 1, a = 2 * Math.PI * hash(seed + ':a'), r = Math.sqrt(1 - z * z);
    return [r * Math.cos(a), r * Math.sin(a), z];
  }
  function norm(v) { const l = Math.hypot(v[0], v[1], v[2]) || 1; return [v[0] / l, v[1] / l, v[2] / l]; }
  function cross(a, b) { return [a[1] * b[2] - a[2] * b[1], a[2] * b[0] - a[0] * b[2], a[0] * b[1] - a[1] * b[0]]; }
  function fib(n) {                                    // n points evenly on the unit sphere
    const out = [];
    for (let i = 0; i < n; i++) {
      const y = 1 - 2 * (i + 0.5) / n, r = Math.sqrt(1 - y * y), a = i * 2.399963229728653;
      out.push([r * Math.cos(a), y, r * Math.sin(a)]);
    }
    return out;
  }
  function glowRadius(ctx, n) { return Math.max(9, Math.cbrt(Math.max(ctx.nodeVal(n), 0.01)) * 4 * 1.7); }

  function layout(data, ctx) {
    const nodes = data.nodes, N = nodes.length, ix = new Map();
    nodes.forEach((n, i) => ix.set(n.id, i));
    const adj = Array.from({ length: N }, () => []);
    for (const l of data.links) {
      const a = ix.get(endId(l.source)), b = ix.get(endId(l.target));
      if (a == null || b == null || a === b) continue;
      adj[a].push(b); adj[b].push(a);
    }
    const byDeg = (a, b) => (adj[b].length - adj[a].length) || (nodes[a].id < nodes[b].id ? -1 : 1);
    let suns = [];
    for (let i = 0; i < N; i++) if (nodes[i].type === 'project') suns.push(i);
    let source = 'project';
    if (suns.length < 3) { suns = [...Array(N).keys()].sort(byDeg).slice(0, FALLBACK_SUNS); source = 'degree'; }
    else suns.sort(byDeg);

    // multi-source BFS: owner = index into suns, hop = distance
    const owner = new Int32Array(N), hop = new Int32Array(N), q = new Int32Array(N);
    function bfs() {
      owner.fill(-1); hop.fill(0);
      let qh = 0, qt = 0;
      suns.forEach((s, k) => { owner[s] = k; q[qt++] = s; });
      while (qh < qt) {
        const u = q[qh++];
        for (const v of adj[u]) if (owner[v] < 0) { owner[v] = owner[u]; hop[v] = hop[u] + 1; q[qt++] = v; }
      }
    }
    bfs();
    // too many projects → a cluttered sky: keep the MAX_SUNS biggest systems (by member count) as
    // suns; the other projects re-BFS in as planets of their nearest big sun
    if (suns.length > MAX_SUNS) {
      const size = new Int32Array(suns.length);
      for (let i = 0; i < N; i++) if (owner[i] >= 0) size[owner[i]]++;
      suns = suns.map((s, k) => [s, size[k]]).sort((a, b) => (b[1] - a[1]) || byDeg(a[0], b[0])).slice(0, MAX_SUNS)
        .map((x) => x[0]).sort(byDeg);
      bfs();
    }
    const members = suns.map(() => []), shell = [];
    for (let i = 0; i < N; i++) {
      if (owner[i] < 0) shell.push(i);
      else if (suns[owner[i]] !== i) members[owner[i]].push(i);
    }

    // lanes per sun: closer hops inner, then higher degree; fill inner → outer by circumference
    const lanes = [];                                  // {sun:k, r, normal, u, v, w, off, idx:[]}
    const sysR = suns.map((s, k) => {
      const list = members[k].sort((a, b) => (hop[a] - hop[b]) || byDeg(a, b));
      const g0 = glowRadius(ctx, nodes[s]);
      const base = norm(unitFrom(nodes[s].id));
      let r = g0 + LANE_GAP, j = 0, p = 0;
      while (p < list.length) {
        const cap = Math.max(6, Math.floor(2 * Math.PI * r / SPACING));
        const seed = nodes[s].id + '#' + j, jit = unitFrom(seed);
        const normal = norm([base[0] + TILT * jit[0], base[1] + TILT * jit[1], base[2] + TILT * jit[2]]);
        const ref = Math.abs(normal[1]) < 0.9 ? [0, 1, 0] : [1, 0, 0];
        const u = norm(cross(normal, ref)), v = cross(normal, u);
        lanes.push({ sun: k, r, u, v, w: W0 * Math.pow((g0 + LANE_GAP) / r, 1.5), off: 2 * Math.PI * hash(seed), idx: list.slice(p, p + cap) });
        p += cap; j++;
        if (p < list.length) r += LANE_DR;
      }
      return j ? r : g0 + 6;                           // outermost lane radius (or just the glow)
    });

    // suns on a Fibonacci sphere, radius so the closest pair of systems can't overlap
    const S = suns.length, unit = fib(S), maxSys = Math.max(0, ...sysR);
    let minChord = 2;
    for (let a = 0; a < S; a++) for (let b = a + 1; b < S; b++) {
      minChord = Math.min(minChord, Math.hypot(unit[a][0] - unit[b][0], unit[a][1] - unit[b][1], unit[a][2] - unit[b][2]));
    }
    const R = S > 1 ? (2 * maxSys + SYS_GAP) / minChord : 0;
    sunPos = unit.map((p) => [p[0] * R, p[1] * R, p[2] * R]);
    sunNodes = suns.map((s) => nodes[s]); sunR = suns.map((s) => glowRadius(ctx, nodes[s]));

    // flatten into typed arrays for the per-frame pass
    const L = lanes.length, M = lanes.reduce((c, ln) => c + ln.idx.length, 0);
    laneW = new Float64Array(L); laneO = new Float64Array(L * 3); laneU = new Float64Array(L * 3); laneV = new Float64Array(L * 3);
    laneR = new Float64Array(L); laneCos = new Float64Array(L); laneSin = new Float64Array(L); laneSun = new Array(L);
    memNodes = new Array(M); memLane = new Int32Array(M); memC = new Float64Array(M); memS = new Float64Array(M);
    let m = 0;
    lanes.forEach((ln, j) => {
      const o = sunPos[ln.sun];
      laneW[j] = ln.w; laneR[j] = ln.r; laneSun[j] = ln.sun;
      for (let c = 0; c < 3; c++) { laneO[j * 3 + c] = o[c]; laneU[j * 3 + c] = ln.u[c]; laneV[j * 3 + c] = ln.v[c]; }
      const cnt = ln.idx.length;
      ln.idx.forEach((i, k) => {
        const phi = ln.off + 2 * Math.PI * k / cnt;
        memNodes[m] = nodes[i]; memLane[m] = j; memC[m] = ln.r * Math.cos(phi); memS[m] = ln.r * Math.sin(phi); m++;
      });
    });

    const pos = new Map();
    suns.forEach((s, k) => pos.set(nodes[s].id, { x: sunPos[k][0], y: sunPos[k][1], z: sunPos[k][2] }));
    const Rsh = R + maxSys + SHELL_GAP;
    shell.forEach((i, k) => {                          // unreached nodes: a thin flat belt around all systems
      const id = nodes[i].id, a = 2 * Math.PI * (k + 0.5 * hash(id + ':b')) / shell.length;
      const r = Rsh * (1 + BELT_W * (hash(id + ':r') - 0.5)), y = Rsh * BELT_H * (hash(id + ':y') - 0.5);
      pos.set(id, { x: r * Math.cos(a), y, z: r * Math.sin(a) });
    });
    place(performance.now());                          // writes member x/y/z (+fx) at the current orbital phase
    for (let k = 0; k < M; k++) { const n = memNodes[k]; pos.set(n.id, { x: n.x, y: n.y, z: n.z }); }

    const memberSun = {}, orbitRadius = {};
    sysOf = new Map();
    suns.forEach((s, k) => {
      orbitRadius[nodes[s].id] = sysR[k] + 0.5; sysOf.set(nodes[s].id, k);
      for (const i of members[k]) { memberSun[nodes[i].id] = nodes[s].id; sysOf.set(nodes[i].id, k); }
    });
    dbg = { suns: suns.map((s) => nodes[s].id), memberSun, orbitRadius, outerShell: shell.map((i) => nodes[i].id),
      sunSource: source, shellRadius: Rsh, lanes: L };
    return pos;
  }

  // rotate each lane by ω·t — one pass over typed arrays, no trig per member
  function tick(now) { if (now - lastStep >= STEP_MS) place(now); }
  function place(now) {
    if (!memLane) return;
    lastStep = now;
    const t = (now - T0) / 1000, L = laneW.length;
    for (let j = 0; j < L; j++) { const a = laneW[j] * t; laneCos[j] = Math.cos(a); laneSin[j] = Math.sin(a); }
    for (let k = 0, M = memLane.length; k < M; k++) {
      const j = memLane[k], c = memC[k], s = memS[k], lc = laneCos[j], ls = laneSin[j];
      const a = c * lc - s * ls, b = c * ls + s * lc, o = j * 3;
      const n = memNodes[k];
      n.x = n.fx = laneO[o] + a * laneU[o] + b * laneV[o];
      n.y = n.fy = laneO[o + 1] + a * laneU[o + 1] + b * laneV[o + 1];
      n.z = n.fz = laneO[o + 2] + a * laneU[o + 2] + b * laneV[o + 2];
      if (planetPos) { planetPos[k * 3] = n.x; planetPos[k * 3 + 1] = n.y; planetPos[k * 3 + 2] = n.z; }
    }
    if (planetPos) planets.geometry.attributes.position.needsUpdate = true;
  }

  function colorOf(ctx, n) {
    const css = String(ctx.nodeColorFor(n)), c = new (T().Color)();
    const m = css.indexOf('rgb') === 0 ? css.match(/[\d.]+/g) : null;
    if (m && m.length >= 3) c.setRGB(+m[0] / 255, +m[1] / 255, +m[2] / 255); else c.set(css);
    return c;
  }

  function enter(graph, data, ctx) {
    const THREE = T(); if (!THREE) return;
    g = graph;
    const scene = graph.scene(), S = sunNodes.length, L = laneW.length;
    const sunCol = sunNodes.map((n) => colorOf(ctx, n));

    // faint orbit rings: every lane of every sun in ONE LineSegments
    const rp = new Float32Array(L * RING_SEG * 6), rc = new Float32Array(L * RING_SEG * 6);
    for (let j = 0; j < L; j++) {
      const o = j * 3, r = laneR[j], col = sunCol[laneSun[j]];
      for (let s = 0; s < RING_SEG; s++) {
        for (let e = 0; e < 2; e++) {
          const a = 2 * Math.PI * (s + e) / RING_SEG, ca = r * Math.cos(a), sa = r * Math.sin(a);
          const w = ((j * RING_SEG + s) * 2 + e) * 3;
          for (let c = 0; c < 3; c++) rp[w + c] = laneO[o + c] + ca * laneU[o + c] + sa * laneV[o + c];
          rc[w] = col.r; rc[w + 1] = col.g; rc[w + 2] = col.b;
        }
      }
    }
    const rg = new THREE.BufferGeometry();
    rg.setAttribute('position', new THREE.BufferAttribute(rp, 3));
    rg.setAttribute('color', new THREE.BufferAttribute(rc, 3));
    rings = new THREE.LineSegments(rg, new THREE.LineBasicMaterial({ vertexColors: true, transparent: true, opacity: 0.3, depthWrite: false }));
    rings.frustumCulled = false;
    scene.add(rings);

    // sun cores: ONE InstancedMesh just enclosing the sun node, NOT bloom-tagged — a compact bright
    // core; the corona sprite is the only halo, so suns can't smear into the bloom pass
    const dummy = new THREE.Object3D(), white = new THREE.Color(1, 1, 1);
    glow = new THREE.InstancedMesh(new THREE.SphereGeometry(1, 16, 12), new THREE.MeshBasicMaterial({}), Math.max(S, 1));
    for (let k = 0; k < S; k++) {
      dummy.position.set(sunPos[k][0], sunPos[k][1], sunPos[k][2]); dummy.scale.setScalar(sunR[k] * CORE_K); dummy.updateMatrix();
      glow.setMatrixAt(k, dummy.matrix); glow.setColorAt(k, sunCol[k].clone().lerp(white, 0.55));
    }
    glow.count = S; glow.userData.bloom = true; glow.frustumCulled = false;
    scene.add(glow);

    // corona: ONE additive Points cloud, a soft radial sprite per sun
    const cv = document.createElement('canvas'); cv.width = cv.height = 64;
    const x = cv.getContext('2d'), gr = x.createRadialGradient(32, 32, 0, 32, 32, 32);
    gr.addColorStop(0, 'rgba(255,255,255,1)'); gr.addColorStop(0.15, 'rgba(255,255,255,.6)'); gr.addColorStop(0.4, 'rgba(255,255,255,.18)'); gr.addColorStop(1, 'rgba(255,255,255,0)');
    x.fillStyle = gr; x.fillRect(0, 0, 64, 64);
    const cp = new Float32Array(S * 3), cc = new Float32Array(S * 3);
    for (let k = 0; k < S; k++) { const c = sunCol[k].clone().lerp(white, 0.3); cp.set(sunPos[k], k * 3); cc[k * 3] = c.r; cc[k * 3 + 1] = c.g; cc[k * 3 + 2] = c.b; }
    const cg = new THREE.BufferGeometry();
    cg.setAttribute('position', new THREE.BufferAttribute(cp, 3));
    cg.setAttribute('color', new THREE.BufferAttribute(cc, 3));
    corona = new THREE.Points(cg, new THREE.PointsMaterial({ map: new THREE.CanvasTexture(cv), size: CORONA, sizeAttenuation: true, vertexColors: true,
      transparent: true, opacity: 0.85, blending: THREE.AdditiveBlending, depthWrite: false }));
    corona.frustumCulled = false;
    scene.add(corona);

    // planet glow: ONE additive Points cloud (a soft dot per member, its type colour) riding with the
    // members — place() writes into its position array in the same typed-array pass
    const M = memNodes.length, pc = new Float32Array(M * 3);
    for (let k = 0; k < M; k++) { const c = colorOf(ctx, memNodes[k]); pc[k * 3] = c.r; pc[k * 3 + 1] = c.g; pc[k * 3 + 2] = c.b; }
    const pg = new THREE.BufferGeometry();
    planetPos = new Float32Array(M * 3);
    pg.setAttribute('position', new THREE.BufferAttribute(planetPos, 3));
    pg.setAttribute('color', new THREE.BufferAttribute(pc, 3));
    planets = new THREE.Points(pg, new THREE.PointsMaterial({ map: corona.material.map, size: PLANET_GLOW, sizeAttenuation: true, vertexColors: true,
      transparent: true, opacity: 0.9, blending: THREE.AdditiveBlending, depthWrite: false }));
    planets.frustumCulled = false;
    scene.add(planets);
    place(performance.now());

    // deep-space backdrop: darken the theme bg (bloom's clear-colour lift follows it) + dim the starfield
    const bg = graph.backgroundColor && graph.backgroundColor();
    if (bg) { bgPrev = bg; bgOurs = '#' + new THREE.Color(bg).lerp(new THREE.Color(0, 0, 0), BG_DARK).getHexString(); graph.backgroundColor(bgOurs); }
    if (window.Starfield && Starfield.gain) Starfield.gain(STAR_GAIN);
  }

  function exit() {
    for (const o of [rings, glow, corona, planets]) {
      if (!o) continue;
      if (g) g.scene().remove(o);
      o.geometry.dispose();
      if (o.material.map && o !== planets) o.material.map.dispose();   // planets share corona's sprite
      o.material.dispose();
    }
    planets = planetPos = null;
    // restore the bg only if it is still ours (a theme switch sets its own bg before re-entering)
    if (g && bgOurs && g.backgroundColor() === bgOurs) g.backgroundColor(bgPrev);
    bgPrev = bgOurs = null;
    if (window.Starfield && Starfield.gain) Starfield.gain(1);
    rings = glow = corona = null; g = null;
  }

  // link alpha multiplier: intra-system links faint, cross-system (and belt) links hidden — they fan
  // across the whole sky; app.js still shows a hovered/selected node's own links at full strength
  function linkAlpha(l) {
    const a = sysOf.get(endId(l.source));
    return a != null && a === sysOf.get(endId(l.target)) ? INTRA_LINK : 0;
  }

  window.Modes.register('universe', { allowsDrag: false, graphFx: false, nodeScale: PLANET_K, layout, enter, exit, tick, linkAlpha, debug: () => dbg });
})();
