/* mindgap view mode "matrix" — digital code rain. Hubs (top ~10% by degree) hang on the top row;
   every other node drips below its nearest hub (multi-source BFS; ties go to the higher-degree hub)
   in horizontal strata: stratum k = k hops from that hub, so y is strictly ordered by stratum. Nodes
   no hub reaches sink to a bottom "basement": dealt round-robin onto the hub blocks, a small tidy grid
   under each block, so the floor mirrors the hub row's lattice. Each hub owns a square block in a shallow x-z grid; its nodes of stratum k fill that
   block's footprint one stratum down, so a hub reads as a falling column.

   Drawing (drawsNodes: instanced3d hides its spheres/edges; its hidden mesh still does the picking,
   and the glow core is sized to that sphere radius): 3 objects total —
     ONE Points of glowing node particles (soft additive core + halo, type colour remapped into a
       green→cyan band; colours follow instanced3d's live instanceColor, so hover/firing dims carry over),
     ONE LineSegments of faint node→BFS-parent links (each node to the node one stratum up that found it),
     ONE Points of code rain: a fixed glyph grid on 3 cylinder shells around the strata, full height;
       each column lights 2 falling trails (varied speed/length/brightness, bright flickering heads) over
       a faint always-on glyph field. Columns between camera and strata fade out (backdrop from any orbit
       angle). Fall, flicker and fade all run in the vertex shader off a uTime uniform.
   Per frame: a few uniform writes, no allocation, no node motion (instanced3d's dirty gates stay idle);
   node colours re-copied only when instanceColor's version changes. Registered via Modes.register. */
'use strict';
(function () {
  const HUB_FRAC = 0.1, SX = 16, SZ = 16, BLOCK_GAP = 14, MIN_GY = 45, MAX_GY = 400;
  const RAIN_ROWS = 96, RAIN_SHELLS = 3, RAIN_POINTS = 64000, GLYPH_GRID = 8, T0 = performance.now();
  const NODE_K = 5, LINK_A = [0.07, 0.26];             // sprite diameter / sphere radius; link alpha child→parent
  const GLYPHS = 'ｦｱｳｴｵｶｷｹｺｻｼｽｾｿﾀﾂﾃﾅﾆﾇﾈﾊﾋﾎﾏﾐﾑﾒﾓﾔﾕﾗﾘﾜ0123456789Z:.=*+-<>¦|ｸﾁﾄﾉﾌﾍﾖﾙﾚﾛﾝ';
  let g = null, rain = null, nodesPts = null, links = null, atlas = null, rainInfo = null;
  let srcColors = null, srcVer = -1;
  let box = { cx: 0, cz: 0, w: 200, d: 200, top: 100, bottom: -100 }, radius = [], gain = [], pairs = new Int32Array(0);
  let dbg = { hubs: [], hubOf: {}, parentOf: {}, stratum: {}, y: {}, strataY: [], unreachable: [], strata: 0 };

  function T() { return window.THREE; }
  const endId = (e) => (e && typeof e === 'object' ? e.id : e);
  function hash(s) {                                   // FNV-1a → [0,1), deterministic layout
    let h = 0x811c9dc5; s = String(s);
    for (let i = 0; i < s.length; i++) { h ^= s.charCodeAt(i); h = Math.imul(h, 0x01000193); }
    return (h >>> 0) / 4294967296;
  }
  function radiusOf(ctx, n) { return Math.cbrt(Math.max(ctx.nodeVal(n), 0.01)) * 4; }   // instanced3d sphere radius

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
    const H = N ? Math.max(1, Math.round(N * HUB_FRAC)) : 0;
    const hubs = [...Array(N).keys()].sort(byDeg).slice(0, H);

    // multi-source BFS seeded in degree order: owner = hub slot, hop = stratum, par = discovering node
    const owner = new Int32Array(N).fill(-1), hop = new Int32Array(N), par = new Int32Array(N).fill(-1), q = new Int32Array(N);
    let qh = 0, qt = 0, maxHop = 0;
    hubs.forEach((s, k) => { owner[s] = k; q[qt++] = s; });
    while (qh < qt) {
      const u = q[qh++];
      for (const v of adj[u]) if (owner[v] < 0) {
        owner[v] = owner[u]; hop[v] = hop[u] + 1; par[v] = u; q[qt++] = v; if (hop[v] > maxHop) maxHop = hop[v];
      }
    }
    const lost = [];
    for (let i = 0; i < N; i++) if (owner[i] < 0) lost.push(i);
    const K = lost.length ? maxHop + 1 : maxHop;      // bottom stratum index
    for (const i of lost) hop[i] = K;

    // cells[hub][k-1] = members of hub at stratum k (k ≥ 1), degree-ordered
    const cells = hubs.map(() => []);
    for (let i = 0; i < N; i++) {
      const o = owner[i]; if (o < 0 || hop[i] === 0) continue;
      (cells[o][hop[i] - 1] || (cells[o][hop[i] - 1] = [])).push(i);
    }
    // square block per hub, sized to its biggest stratum (and wide enough for the hub sphere)
    const blk = hubs.map((s, k) => {
      const M = cells[k].reduce((m, c) => Math.max(m, c ? c.length : 0), 0), c = Math.max(1, Math.ceil(Math.sqrt(M)));
      const r = Math.ceil(Math.max(M, 1) / c), hr = 2 * radiusOf(ctx, nodes[s]);
      return { c, w: Math.max(c * SX, hr), d: Math.max(r * SZ, hr), x: 0, z: 0 };
    });
    // pack blocks into a shallow x-z grid: rows along z, ~6x more blocks per row than rows
    const rows = Math.max(1, Math.round(Math.sqrt(H / 6))), total = blk.reduce((s, b) => s + b.w + BLOCK_GAP, 0);
    const target = total / rows;
    let x = 0, z = 0, rowD = 0, W = 0;
    for (const b of blk) {
      if (x > 0 && x + b.w > target) { z += rowD + BLOCK_GAP; x = 0; rowD = 0; }
      b.x = x + b.w / 2; b.z = z + b.d / 2; x += b.w + BLOCK_GAP; rowD = Math.max(rowD, b.d); W = Math.max(W, x - BLOCK_GAP);
    }
    const D = z + rowD;
    for (const b of blk) { b.x -= W / 2; b.z -= D / 2; }

    const GY = Math.min(MAX_GY, Math.max(MIN_GY, 0.6 * Math.max(W, 1) / Math.max(K, 1)));
    const yOf = (k) => (K * GY) / 2 - (lost.length && k === K ? k - 0.45 : k) * GY;   // basement tucked up (gap 0.55)
    const pos = new Map();
    const grid = (list, cols, cx, cz, y) => {          // centred cols×rows grid in the x-z plane
      const R = Math.ceil(list.length / cols);
      list.forEach((i, j) => {
        const r = Math.floor(j / cols), inRow = r < R - 1 ? cols : list.length - r * cols, c = j % cols;
        pos.set(nodes[i].id, { x: cx + (c - (inRow - 1) / 2) * SX, y, z: cz + (r - (R - 1) / 2) * SZ });
      });
    };
    hubs.forEach((s, k) => {
      const b = blk[k];
      pos.set(nodes[s].id, { x: b.x, y: yOf(0), z: b.z });
      cells[k].forEach((c, j) => { if (c) grid(c.sort(byDeg), b.c, b.x, b.z, yOf(j + 1)); });
    });
    // basement: unreachable nodes dealt round-robin onto the hub blocks (degree order), each block's
    // share in a small centred grid under its footprint — the floor mirrors the hub ceiling's lattice
    if (lost.length) {
      const per = Math.ceil(lost.length / H), c = Math.max(1, Math.ceil(Math.sqrt(per))), R = Math.ceil(per / c);
      lost.sort(byDeg).forEach((i, j) => {
        const b = blk[j % H], slot = Math.floor(j / H), r = Math.floor(slot / c), cc = slot % c;
        const sx = Math.min(SX, b.w / c), sz = Math.min(SZ, b.d / R);
        pos.set(nodes[i].id, { x: b.x + (cc - (c - 1) / 2) * sx, y: yOf(K), z: b.z + (r - (R - 1) / 2) * sz });
      });
    }

    radius = nodes.map((n) => radiusOf(ctx, n));
    // particle brightness: hubs blaze, each stratum down dims a little, the basement is a quiet floor
    gain = nodes.map((n, i) => (owner[i] < 0 ? 0.5 : hop[i] === 0 ? 1.25 : Math.max(0.6, 1 - 0.07 * (hop[i] - 1))));
    box = { cx: 0, cz: 0, w: Math.max(W, 120), d: Math.max(D, 120), top: yOf(0), bottom: yOf(K) };
    const pp = [];
    const stratum = {}, yy = {}, hubOf = {}, parentOf = {};
    for (let i = 0; i < N; i++) {
      const id = nodes[i].id; stratum[id] = hop[i]; yy[id] = pos.get(id).y;
      if (owner[i] >= 0) hubOf[id] = nodes[hubs[owner[i]]].id;
      if (par[i] >= 0) { parentOf[id] = nodes[par[i]].id; pp.push(i, par[i]); }
    }
    pairs = Int32Array.from(pp);
    dbg = { hubs: hubs.map((s) => nodes[s].id), hubOf, parentOf, stratum, y: yy, strata: N ? K + 1 : 0,
      strataY: Array.from({ length: N ? K + 1 : 0 }, (_, k) => yOf(k)), unreachable: lost.map((i) => nodes[i].id), stratumGap: GY,
      footprint: { w: W, d: D } };
    return pos;
  }

  // theme accent pulled 55% toward matrix green (pure green on the 'matrix' theme)
  function rainColor() {
    const THREE = T(), c = new THREE.Color('#00ff41');
    let acc = '';
    try { acc = getComputedStyle(document.documentElement).getPropertyValue('--green').trim(); } catch (e) { /* no DOM */ }
    if (acc) { try { c.lerp(new THREE.Color(acc), 0.45); } catch (e) { /* unparsable var */ } }
    return c;
  }

  function glyphAtlas() {                               // GLYPH_GRID² glyphs, white on transparent, mirrored like the film
    const S = 64, cv = document.createElement('canvas'); cv.width = cv.height = S * GLYPH_GRID;
    const x = cv.getContext('2d');
    x.fillStyle = '#fff'; x.textAlign = 'center'; x.textBaseline = 'middle';
    x.font = `bold ${S * 0.78}px "MS Gothic","Hiragino Kaku Gothic Pro","Noto Sans Mono CJK JP",monospace`;
    const chars = [...GLYPHS];
    for (let k = 0; k < GLYPH_GRID * GLYPH_GRID; k++) {
      const cx = (k % GLYPH_GRID) * S + S / 2, cy = Math.floor(k / GLYPH_GRID) * S + S / 2;
      x.save(); x.translate(cx, cy); x.scale(-1, 1); x.fillText(chars[k % chars.length], 0, 0); x.restore();
    }
    const tex = new (T().CanvasTexture)(cv);
    tex.minFilter = T().LinearFilter; tex.generateMipmaps = false;
    return tex;
  }

  function pxHalf() {                                    // drawing-buffer half height (point size → world units)
    const el = g && g.renderer && g.renderer().domElement;
    return el ? el.height / 2 : 400;
  }

  // node colour → matrix band: hue 60°..150° (the matrix palette's spread) maps onto 110°..185°
  // (green → cyan), saturation floored so every type reads as a hue; greys (hover-dimmed) go dark
  function tint(r, gg, b, out, o) {
    const mx = Math.max(r, gg, b), mn = Math.min(r, gg, b), d = mx - mn, sat = mx ? d / mx : 0;
    let h = 0;
    if (d > 1e-6) h = 60 * (mx === r ? ((gg - b) / d + 6) % 6 : mx === gg ? (b - r) / d + 2 : (r - gg) / d + 4);
    const H = (110 + 75 * Math.min(1, ((((h - 60) % 360) + 360) % 360) / 90)) / 60;   // sextants
    const S = 0.55 + 0.4 * Math.min(1, sat * 1.5), V = mx * (0.35 + 0.65 * Math.min(1, sat * 2.5));
    for (let c = 0; c < 3; c++) {                        // hsv → rgb, channels r,g,b ← n = 5,3,1
      const k = (5 - 2 * c + H) % 6;
      out[o + c] = V - V * S * Math.max(0, Math.min(k, 4 - k, 1));
    }
  }
  function cssRgb(css) {                                 // rgba()/rgb()/hex/named → [r,g,b] in 0..1
    const s = String(css);
    if (s.indexOf('rgb') === 0) { const m = s.match(/[\d.]+/g); if (m && m.length >= 3) return [m[0] / 255, m[1] / 255, m[2] / 255]; }
    const c = new (T().Color)(s); return [c.r, c.g, c.b];
  }

  function buildRain(THREE, scene, col, head) {
    // fixed glyph grid: columns on 3 concentric shells (equal angular spacing, shells offset) around
    // the strata; rows span well past the strata so the field reaches the top/bottom of the view
    const diag = Math.hypot(box.w, box.d), cy = (box.top + box.bottom) / 2;
    const halfH = Math.max((box.top - box.bottom) / 2 + diag * 0.45, diag * 0.75);
    const rows = Math.max(24, Math.min(RAIN_ROWS, Math.ceil(2 * halfH / Math.max(9, Math.min(40, diag / 75)))));
    const step = 2 * halfH / rows, R0 = diag / 2 + 3 * step + 60;
    const perShell = Math.max(24, Math.min(Math.round(2 * Math.PI * R0 / (step * 1.2)), Math.floor(RAIN_POINTS / rows / RAIN_SHELLS)));
    const C = perShell * RAIN_SHELLS, P = C * rows;
    const rp = new Float32Array(P * 3), row = new Float32Array(P), seed = new Float32Array(P);
    const spd = new Float32Array(P), bri = new Float32Array(P), len = new Float32Array(P);
    for (let sh = 0, c = 0; sh < RAIN_SHELLS; sh++) {
      const R = R0 * (1 + 0.38 * sh), shellB = 1 - 0.18 * sh;
      for (let k = 0; k < perShell; k++, c++) {
        const a = 2 * Math.PI * (k + sh / RAIN_SHELLS + 0.3 * (hash('j' + c) - 0.5)) / perShell;
        const px = box.cx + R * Math.cos(a), pz = box.cz + R * Math.sin(a), sd = hash('s' + c);
        const v = 4 + 12 * hash('v' + c), b = shellB * (0.45 + 0.55 * hash('b' + c)), L = 8 + 26 * hash('l' + c);
        for (let j = 0; j < rows; j++) {
          const p = c * rows + j;
          rp[p * 3] = px; rp[p * 3 + 2] = pz; row[p] = j; seed[p] = sd; spd[p] = v; bri[p] = b; len[p] = L;
        }
      }
    }
    const rg = new THREE.BufferGeometry();
    rg.setAttribute('position', new THREE.BufferAttribute(rp, 3));
    rg.setAttribute('aRow', new THREE.BufferAttribute(row, 1));
    rg.setAttribute('aSeed', new THREE.BufferAttribute(seed, 1));
    rg.setAttribute('aSpeed', new THREE.BufferAttribute(spd, 1));
    rg.setAttribute('aBright', new THREE.BufferAttribute(bri, 1));
    rg.setAttribute('aLen', new THREE.BufferAttribute(len, 1));
    rain = new THREE.Points(rg, new THREE.ShaderMaterial({
      transparent: true, depthWrite: false, blending: THREE.AdditiveBlending,
      uniforms: {
        uTime: { value: 0 }, uTop: { value: cy + halfH }, uStep: { value: step }, uRows: { value: rows },
        uSize: { value: step * 0.95 }, uPxH: { value: pxHalf() }, uGrid: { value: GLYPH_GRID }, uAtlas: { value: atlas },
        uColor: { value: col }, uHead: { value: head }, uCenter: { value: new THREE.Vector3(box.cx, cy, box.cz) }, uFront: { value: R0 * 0.35 },
      },
      vertexShader: [
        'attribute float aRow; attribute float aSeed; attribute float aSpeed; attribute float aBright; attribute float aLen;',
        'uniform float uTime, uTop, uStep, uRows, uSize, uPxH, uGrid, uFront; uniform vec3 uCenter;',
        'varying float vB; varying float vHead; varying float vGlyph;',
        'float trail(float hd, float L) { float d = hd - aRow; return (d >= 0.0 && d < L) ? 1.0 - d / L : 0.0; }',
        'float isHead(float hd) { float d = hd - aRow; return (d >= 0.0 && d < 1.0) ? 1.0 : 0.0; }',
        'void main() {',
        '  vec4 mv = modelViewMatrix * vec4(position.x, uTop - aRow * uStep, position.z, 1.0);',
        '  float cz = (modelViewMatrix * vec4(uCenter, 1.0)).z;',
        '  float back = 1.0 - smoothstep(-uFront, uFront, mv.z - cz);   // columns in front of the strata fade out',
        '  float cyc = uRows + 2.0 * aLen;',
        '  float h1 = mod(uTime * aSpeed + aSeed * cyc, cyc), h2 = mod(h1 + cyc * (0.42 + 0.2 * aSeed), cyc);',
        '  float t = max(trail(h1, aLen), 0.7 * trail(h2, aLen * 0.6));',
        '  float hd = max(isHead(h1), isHead(h2));',
        '  float flick = 0.7 + 0.3 * sin(uTime * (9.0 + 7.0 * aSeed) + aRow);',
        '  float base = 0.05 + 0.06 * fract(aSeed * 91.7 + aRow * 0.618);   // faint always-on glyph field',
        '  float edge = smoothstep(0.0, 8.0, aRow) * smoothstep(0.0, 8.0, uRows - 1.0 - aRow);',
        '  vB = (max(base, 1.6 * t * sqrt(t)) + hd * flick) * aBright * back * edge; vHead = hd * flick;',
        '  if (vB < 0.012) { gl_Position = vec4(2.0, 2.0, 2.0, 1.0); gl_PointSize = 0.0; vGlyph = 0.0; return; }',
        '  float tick = floor(uTime * (0.6 + 4.0 * aSeed * t + 2.0 * hd) + aRow * 0.37);',
        '  vGlyph = floor(fract(sin(dot(vec3(aSeed * 917.0, aRow, tick), vec3(12.9898, 78.233, 37.719))) * 43758.5453) * uGrid * uGrid);',
        '  gl_PointSize = clamp(uSize * projectionMatrix[1][1] * uPxH / max(-mv.z, 1.0), 1.0, 72.0);',
        '  gl_Position = projectionMatrix * mv;',
        '}',
      ].join('\n'),
      fragmentShader: [
        'uniform sampler2D uAtlas; uniform float uGrid; uniform vec3 uColor; uniform vec3 uHead;',
        'varying float vB; varying float vHead; varying float vGlyph;',
        'void main() {',
        '  vec2 cell = vec2(mod(vGlyph, uGrid), floor(vGlyph / uGrid));',
        '  vec2 uv = vec2((gl_PointCoord.x + cell.x) / uGrid, 1.0 - (gl_PointCoord.y + cell.y) / uGrid);',
        '  float a = texture2D(uAtlas, uv).a * min(vB, 1.0);',
        '  if (a < 0.006) discard;',
        '  gl_FragColor = vec4(mix(uColor, uHead, vHead), a);',
        '}',
      ].join('\n'),
    }));
    rain.name = 'matrix-rain'; rain.frustumCulled = false; rain.renderOrder = -5;
    rainInfo = { columns: C, rows, shells: RAIN_SHELLS, step: Math.round(step * 10) / 10, innerRadius: Math.round(R0) };
    scene.add(rain);
  }

  function buildNodes(THREE, scene, data, ctx) {
    // ONE additive Points: soft glow sprite per node; the bright core spans ~the picking sphere radius
    const N = data.nodes.length, p = new Float32Array(N * 3), sz = new Float32Array(N), gn = new Float32Array(N), cl = new Float32Array(N * 3);
    data.nodes.forEach((n, i) => {
      p[i * 3] = n.x; p[i * 3 + 1] = n.y; p[i * 3 + 2] = n.z; sz[i] = (radius[i] || 4) * NODE_K; gn[i] = gain[i] || 1;
      const c = cssRgb(ctx.nodeColorFor(n)); tint(c[0], c[1], c[2], cl, i * 3);
    });
    const ng = new THREE.BufferGeometry();
    ng.setAttribute('position', new THREE.BufferAttribute(p, 3));
    ng.setAttribute('aSize', new THREE.BufferAttribute(sz, 1));
    ng.setAttribute('aGain', new THREE.BufferAttribute(gn, 1));
    ng.setAttribute('aColor', new THREE.BufferAttribute(cl, 3));
    const r0 = (2 * 0.2 / NODE_K).toFixed(3), r1 = (2 * 1.05 / NODE_K).toFixed(3);   // soft core fading 0.2 → 1.05 × radius
    nodesPts = new THREE.Points(ng, new THREE.ShaderMaterial({
      transparent: true, depthWrite: false, blending: THREE.AdditiveBlending,
      uniforms: { uPxH: { value: pxHalf() } },
      vertexShader: [
        'attribute float aSize; attribute float aGain; attribute vec3 aColor; uniform float uPxH; varying vec3 vColor;',
        'void main() {',
        '  vColor = aColor * aGain;',
        '  vec4 mv = modelViewMatrix * vec4(position, 1.0);',
        '  gl_PointSize = clamp(aSize * projectionMatrix[1][1] * uPxH / max(-mv.z, 1.0), 2.0, 320.0);',
        '  gl_Position = projectionMatrix * mv;',
        '}',
      ].join('\n'),
      fragmentShader: [
        'varying vec3 vColor;',
        'void main() {',
        '  float r = length(gl_PointCoord - vec2(0.5)) * 2.0;           // 0 centre .. 1 sprite edge',
        '  if (r > 1.0) discard;',
        `  float core = smoothstep(${r1}, ${r0}, r);`,
        '  float glow = exp(-r * r * 9.0) * (1.0 - r);',
        '  vec3 c = vColor * (0.95 * core + 0.75 * glow) + vec3(0.55) * core * core * dot(vColor, vec3(0.33));',
        '  gl_FragColor = vec4(c, 1.0);',
        '}',
      ].join('\n'),
    }));
    nodesPts.name = 'matrix-nodes'; nodesPts.frustumCulled = false;
    scene.add(nodesPts);
  }

  function buildLinks(THREE, scene, data, col) {
    // ONE LineSegments: node → its BFS parent one stratum up; brighter at the parent end
    const M = pairs.length / 2, lp = new Float32Array(M * 6), lc = new Float32Array(M * 8), ns = data.nodes;
    for (let k = 0; k < M; k++) {
      const a = ns[pairs[2 * k]], b = ns[pairs[2 * k + 1]], o = k * 6, q = k * 8;
      lp[o] = a.x; lp[o + 1] = a.y; lp[o + 2] = a.z; lp[o + 3] = b.x; lp[o + 4] = b.y; lp[o + 5] = b.z;
      lc[q] = lc[q + 4] = col.r; lc[q + 1] = lc[q + 5] = col.g; lc[q + 2] = lc[q + 6] = col.b;
      lc[q + 3] = LINK_A[0]; lc[q + 7] = LINK_A[1];
    }
    const lg = new THREE.BufferGeometry();
    lg.setAttribute('position', new THREE.BufferAttribute(lp, 3));
    lg.setAttribute('color', new THREE.BufferAttribute(lc, 4));
    links = new THREE.LineSegments(lg, new THREE.LineBasicMaterial({ vertexColors: true, transparent: true,
      depthWrite: false, blending: THREE.AdditiveBlending }));
    links.name = 'matrix-links'; links.frustumCulled = false; links.renderOrder = -2;
    scene.add(links);
  }

  function enter(graph, data, ctx) {
    const THREE = T(); if (!THREE) return;
    g = graph; srcColors = null; srcVer = -1;
    const scene = graph.scene(), col = rainColor(), head = col.clone().lerp(new THREE.Color(1, 1, 1), 0.75);
    atlas = glyphAtlas();
    buildRain(THREE, scene, col, head);
    buildNodes(THREE, scene, data, ctx);
    buildLinks(THREE, scene, data, col);
  }

  // follow instanced3d's live node colours (hover dim, recall firing) — copy only on a version bump
  function syncColors() {
    const ic = window.Instanced3d && Instanced3d.nodeColors ? Instanced3d.nodeColors() : null;
    if (!ic || (ic === srcColors && ic.version === srcVer)) return;
    const dst = nodesPts.geometry.attributes.aColor;
    if (ic.count !== dst.count) return;                  // stale mesh (rebuild lands right after dataChanged)
    srcColors = ic; srcVer = ic.version;
    const s = ic.array, d = dst.array;
    for (let i = 0; i < d.length; i += 3) tint(s[i], s[i + 1], s[i + 2], d, i);
    dst.needsUpdate = true;
  }

  // per frame: advance the rain clock, track canvas size for point scaling, follow node colours
  function tick(now) {
    if (!rain) return;
    const h = pxHalf();
    rain.material.uniforms.uTime.value = (now - T0) / 1000;
    rain.material.uniforms.uPxH.value = h; nodesPts.material.uniforms.uPxH.value = h;
    syncColors();
  }

  function exit() {
    for (const o of [rain, nodesPts, links]) {
      if (!o) continue;
      if (g) g.scene().remove(o);
      o.geometry.dispose(); o.material.dispose();
    }
    if (atlas) atlas.dispose();
    rain = nodesPts = links = atlas = null; g = null; srcColors = null;
  }

  function debug() {
    const obj = (o, k) => (o ? { present: !!o.parent, name: o.name, type: o.type, [k]: o.geometry.attributes.position.count } : null);
    return Object.assign({}, dbg, {
      rain: rain ? Object.assign(obj(rain, 'points'), rainInfo, { time: rain.material.uniforms.uTime.value }) : null,
      nodes: obj(nodesPts, 'points'), links: links ? Object.assign(obj(links, 'vertices'), { segments: pairs.length / 2 }) : null });
  }

  window.Modes.register('matrix', { allowsDrag: false, drawsNodes: true, layout, enter, exit, tick, debug });
})();
