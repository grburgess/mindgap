/* mindgap view mode "brain" — a fixed anatomical layout: node types live in brain lobes, and the
   node positions themselves draw a two-hemisphere brain (x = left/right, y = up, z = front/back).

     lobe        types (TYPE_LOBE)                                         region
     frontal     decision project idea todo design feature jira-ticket …   front, both hemispheres
     parietal    concept definition software repo process tool method …    top-back, both hemispheres
     temporal    person org team company group …                           low side, both hemispheres
     occipital   paper source page reference article book doc …           back, both hemispheres
     cerebellum  finding learning fact verified-fact gotcha lesson …       under the occipital, both
     stem        stub index hub tag …                                      midline, below

   Unknown types → closest lobe by: exact TYPE_LOBE entry, then its singular ("papers" → paper), then
   the first KEYWORDS substring hit ("ml-paper" → occipital, "team-lead" → temporal), else parietal
   (general knowledge); untyped → stem. Each lobe is an ellipsoid per hemisphere (stem: one, midline),
   filled by an R3 low-discrepancy point cloud alternating left/right (both hemispheres fill evenly).
   A k-d partition carves that cloud into ONE compact cell per type (count-proportional; a type bigger
   than half its lobe spans the midline), then each cell shrinks to CELL× about its centroid, leaving
   sulci between types. So EVERY pair of type centroids — same lobe included, even after hemisphere
   mirroring — sits farther apart than the median intra-type spread (Modes.debug().signature reports it).
   Mirrored lobes then sit FISSURE apart from the midline (applied after the shrink, so a type that spans
   both hemispheres splits instead of bridging) → a dark longitudinal fissure between the hemispheres.
   Id-sorted members → deterministic. Brain size ∝ cbrt(N) keeps density flat.

   Look: a luminous particle cloud. Cost: decorations are 3 static objects — ONE LineSegments (every link
   as a soft additive quadratic arc bowed away from the brain centre), ONE Points with a soft-sprite
   additive shader holding every node (small glowing dot, its type colour) AND the faint lobe dust that
   makes the silhouette read, ONE Group of 6 label sprites. While in brain the opaque instanced spheres +
   hub bloom spheres are made invisible via material.visible (the InstancedMesh still raycasts → hover/
   click/pick keep working), and so are the straight edges, photons and arrows; all restored on exit. No tick;
   the only per-frame work is one uniform write (canvas height) in the Points' onBeforeRender. */
'use strict';
(function () {
  const TYPE_LOBE = {
    decision: 'frontal', project: 'frontal', idea: 'frontal', todo: 'frontal', design: 'frontal', feature: 'frontal',
    'jira-ticket': 'frontal', goal: 'frontal', plan: 'frontal', task: 'frontal', question: 'frontal', hypothesis: 'frontal',
    concept: 'parietal', definition: 'parietal', software: 'parietal', repo: 'parietal', process: 'parietal', tool: 'parietal',
    method: 'parietal', technique: 'parietal', model: 'parietal', dataset: 'parietal', library: 'parietal', algorithm: 'parietal',
    person: 'temporal', org: 'temporal', organization: 'temporal', team: 'temporal', company: 'temporal', group: 'temporal',
    paper: 'occipital', source: 'occipital', page: 'occipital', reference: 'occipital', article: 'occipital', book: 'occipital',
    doc: 'occipital', document: 'occipital', blog: 'occipital', video: 'occipital', link: 'occipital', note: 'occipital',
    finding: 'cerebellum', learning: 'cerebellum', fact: 'cerebellum', 'verified-fact': 'cerebellum', gotcha: 'cerebellum',
    lesson: 'cerebellum', result: 'cerebellum', observation: 'cerebellum', insight: 'cerebellum', experiment: 'cerebellum',
    stub: 'stem', index: 'stem', hub: 'stem', tag: 'stem', moc: 'stem',
  };
  const KEYWORDS = [   // substring → lobe, first hit wins (unknown types)
    ['stub', 'stem'], ['index', 'stem'], ['person', 'temporal'], ['people', 'temporal'], ['team', 'temporal'], ['org', 'temporal'],
    ['paper', 'occipital'], ['page', 'occipital'], ['source', 'occipital'], ['ref', 'occipital'], ['doc', 'occipital'],
    ['fact', 'cerebellum'], ['finding', 'cerebellum'], ['learn', 'cerebellum'], ['lesson', 'cerebellum'], ['result', 'cerebellum'],
    ['decision', 'frontal'], ['project', 'frontal'], ['idea', 'frontal'], ['todo', 'frontal'], ['ticket', 'frontal'], ['plan', 'frontal'],
    ['task', 'frontal'], ['goal', 'frontal'],
  ];
  const DEFAULT_LOBE = 'parietal';
  // per-hemisphere ellipsoids in brain units (x>0 side, mirrored; stem: one, midline)
  const LOBES = {
    frontal:    { c: [0.30, 0.20, 0.78], r: [0.27, 0.40, 0.46], label: 'frontal' },
    parietal:   { c: [0.30, 0.52, -0.06], r: [0.27, 0.30, 0.40], label: 'parietal' },
    temporal:   { c: [0.44, -0.30, 0.20], r: [0.18, 0.20, 0.44], label: 'temporal' },
    occipital:  { c: [0.27, 0.16, -0.80], r: [0.25, 0.32, 0.28], label: 'occipital' },
    cerebellum: { c: [0.24, -0.52, -0.66], r: [0.23, 0.16, 0.24], label: 'cerebellum' },
    stem:       { c: [0, -0.92, -0.20], r: [0.10, 0.34, 0.10], label: 'brain stem', mid: true },
  };
  const LOBE_NAMES = Object.keys(LOBES);
  const CORTEX = { c: [0.40, 0.14, 0.05], r: [0.42, 0.66, 1.17] };   // per-hemisphere envelope of the 4 cerebral lobes (dust shell)
  const UNIT = 160, DUST = 7000, SHELL = 9000, ARC_SEG = 6, ARC_BOW = 0.28, CELL = 0.62;   // CELL: type-cell shrink about its centroid
  const FISSURE = 0.1, JITTER = 0.3, XS = 1.3;   // FISSURE: brain units each mirrored lobe moves off the midline; XS: x stretch (hemisphere width)
  const NODE_PT = 0.022, NODE_I = 0.62, DUST_PT = 0.016, DUST_I = 0.16, ARC_OP = 0.05;   // sprite size (brain units) / intensity
  const A1 = 0.8191725133961645, A2 = 0.6710436067037893, A3 = 0.5497004779019703;   // R3 sequence
  const CAM_DIR = [-0.15, 1, 0.55], CAM_DIST = 3.3;   // slightly top-down 3/4 from front-left: both hemispheres + fissure, × scale
  let g = null, arcs = null, glow = null, labels = null, hiddenMat = [];
  let reentry = false, savedCam = null;   // reentry: exit→enter in one task = dataChanged (keep the camera)
  let scale = UNIT, dbg = { typeLobe: {}, table: TYPE_LOBE, centroid: {}, spread: {}, count: {} };

  function T() { return window.THREE; }
  const endId = (e) => (e && typeof e === 'object' ? e.id : e);

  function lobeOf(type) {
    const t = String(type || '').toLowerCase().trim();
    if (!t) return 'stem';                               // untyped = stub-like
    if (TYPE_LOBE[t]) return TYPE_LOBE[t];
    if (t.endsWith('s') && TYPE_LOBE[t.slice(0, -1)]) return TYPE_LOBE[t.slice(0, -1)];
    for (const [k, l] of KEYWORDS) if (t.includes(k)) return l;
    return DEFAULT_LOBE;
  }

  // lobe point cloud: n R3 low-discrepancy points in the lobe's ellipsoid(s) (mirrored lobes alternate
  // left/right → both hemispheres fill evenly), brain units, flat [x,y,z, x,y,z, …]
  // + a deterministic hash jitter of JITTER× the point spacing, so the cloud reads organic, not as a lattice
  function lobePoints(L, n) {
    const P = new Float64Array(n * 3);
    const j = JITTER * Math.cbrt(4.19 * L.r[0] * L.r[1] * L.r[2] * (L.mid ? 1 : 2) / Math.max(n, 1));
    for (let i = 0, k = 0; i < n; k++) {
      const u0 = 2 * ((0.5 + A1 * k) % 1) - 1, u1 = 2 * ((0.5 + A2 * k) % 1) - 1, u2 = 2 * ((0.5 + A3 * k) % 1) - 1;
      if (u0 * u0 + u1 * u1 + u2 * u2 > 1) continue;
      const side = L.mid ? 1 : (i % 2 ? -1 : 1);
      P[i * 3] = (L.c[0] + u0 * L.r[0] + j * hash(3 * i)) * side; P[i * 3 + 1] = L.c[1] + u1 * L.r[1] + j * hash(3 * i + 1);
      P[i * 3 + 2] = L.c[2] + u2 * L.r[2] + j * hash(3 * i + 2);
      i++;
    }
    return P;
  }
  function hash(i) {                                    // integer hash → [-1, 1)
    let h = Math.imul(i ^ 0x9e3779b9, 0x85ebca6b); h ^= h >>> 13; h = Math.imul(h, 0xc2b2ae35); h ^= h >>> 16;
    return (h >>> 0) / 2147483648 - 1;
  }

  // k-d partition of a lobe's points `idx` among `types` ([{t, n}], Σn = idx.length): types → two
  // count-balanced groups (largest first, onto the lighter group), points cut at that count along the
  // axis of widest extent, recurse. Each type gets ONE compact cell (not a slab mirrored over both
  // hemispheres), so type centroids sharing a lobe stay apart; a type bigger than half its lobe spans the midline.
  function kd(P, idx, types, cells) {
    if (types.length === 1) { cells.set(types[0].t, idx); return; }
    const A = [], B = []; let na = 0, nb = 0;
    for (const ty of types) { if (na <= nb) { A.push(ty); na += ty.n; } else { B.push(ty); nb += ty.n; } }
    let ax = 0, best = -1;
    for (let a = 0; a < 3; a++) {
      let lo = Infinity, hi = -Infinity;
      for (const i of idx) { const v = P[i * 3 + a]; if (v < lo) lo = v; if (v > hi) hi = v; }
      if (hi - lo > best) { best = hi - lo; ax = a; }
    }
    const s = idx.slice().sort((i, j) => (P[i * 3 + ax] - P[j * 3 + ax]) || (i - j));
    kd(P, s.slice(0, na), A, cells); kd(P, s.slice(na), B, cells);
  }

  function layout(data, ctx) {
    const nodes = data.nodes, N = nodes.length;
    scale = UNIT * Math.cbrt(Math.max(N, 300) / 1000);
    // group: lobe → type → [node]
    const groups = new Map();
    for (const l of LOBE_NAMES) groups.set(l, new Map());
    for (const n of nodes) {
      const t = String(n.type || ''), lm = groups.get(lobeOf(t));
      if (!lm.has(t)) lm.set(t, []);
      lm.get(t).push(n);
    }
    const pos = new Map(), typeLobe = {}, sum = {}, cnt = {};
    for (const [lobe, tm] of groups) {
      if (!tm.size) continue;
      const types = [...tm.keys()].sort((a, b) => (tm.get(b).length - tm.get(a).length) || (a < b ? -1 : 1));
      const total = types.reduce((c, t) => c + tm.get(t).length, 0);
      const P = lobePoints(LOBES[lobe], total), cells = new Map();
      kd(P, Array.from({ length: total }, (_, i) => i), types.map((t) => ({ t, n: tm.get(t).length })), cells);
      for (const t of types) {
        const list = tm.get(t).sort((a, b) => (a.id < b.id ? -1 : a.id > b.id ? 1 : 0));
        const cell = cells.get(t).sort((i, j) => i - j), m = [0, 0, 0];
        for (const q of cell) { m[0] += P[q * 3]; m[1] += P[q * 3 + 1]; m[2] += P[q * 3 + 2]; }
        for (let a = 0; a < 3; a++) m[a] *= (1 - CELL) / cell.length;   // shrink cell toward its centre → sulci between types
        typeLobe[t] = lobe;
        list.forEach((n, i) => {
          const q = cell[i], xb = m[0] + CELL * P[q * 3], x = (LOBES[lobe].mid ? xb : xb + Math.sign(xb) * FISSURE) * XS * scale, y = (m[1] + CELL * P[q * 3 + 1]) * scale, z = (m[2] + CELL * P[q * 3 + 2]) * scale;
          pos.set(n.id, { x, y, z });
          const s = sum[t] || (sum[t] = [0, 0, 0]); s[0] += x; s[1] += y; s[2] += z; cnt[t] = (cnt[t] || 0) + 1;
        });
      }
    }
    // per-type centroid + spread (RMS distance to centroid) for Modes.debug()
    const centroid = {}, spread = {}, ss = {};
    for (const t in sum) centroid[t] = sum[t].map((v) => v / cnt[t]);
    for (const n of nodes) {
      const t = String(n.type || ''), c = centroid[t], p = pos.get(n.id);
      ss[t] = (ss[t] || 0) + (p.x - c[0]) ** 2 + (p.y - c[1]) ** 2 + (p.z - c[2]) ** 2;
    }
    for (const t in ss) spread[t] = Math.sqrt(ss[t] / cnt[t]);
    // signature: closest pair of type centroids (ALL pairs, same lobe included) vs the median spread
    // (upper median for an even count — the stricter of the two conventions)
    const ts = Object.keys(centroid), sp = ts.map((t) => spread[t]).sort((a, b) => a - b);
    const signature = { types: ts.length, pairs: ts.length * (ts.length - 1) / 2, medianSpread: sp[sp.length >> 1] || 0,
      minDist: Infinity, minPair: null, below: 0 };
    for (let i = 0; i < ts.length; i++) for (let j = i + 1; j < ts.length; j++) {
      const a = centroid[ts[i]], b = centroid[ts[j]], d = Math.hypot(a[0] - b[0], a[1] - b[1], a[2] - b[2]);
      if (d < signature.minDist) { signature.minDist = d; signature.minPair = [ts[i], ts[j]]; }
      if (d <= signature.medianSpread) signature.below++;
    }
    signature.ratio = ts.length > 1 ? signature.minDist / signature.medianSpread : null;
    if (ts.length < 2) signature.minDist = null;
    dbg = { table: TYPE_LOBE, keywords: KEYWORDS, defaultLobe: DEFAULT_LOBE, typeLobe, centroid, spread, count: cnt, signature,
      lobes: Object.fromEntries(LOBE_NAMES.map((l) => [l, { center: LOBES[l].c.map((v, a) => v * scale * (a ? 1 : XS)), radii: LOBES[l].r.map((v, a) => v * scale * (a ? 1 : XS)), mirrored: !LOBES[l].mid }])),
      scale, fissure: FISSURE * XS * scale, arcs: data.links.length, arcSegments: ARC_SEG };
    return pos;
  }

  function cssColor(css, out) {
    css = String(css || '').trim();
    const m = css.indexOf('rgb') === 0 ? css.match(/[\d.]+/g) : null;
    if (m && m.length >= 3) out.setRGB(+m[0] / 255, +m[1] / 255, +m[2] / 255); else out.set(css || '#ffffff');
    return out;
  }
  function textCss() {
    try { return getComputedStyle(document.documentElement).getPropertyValue('--text').trim() || '#d7e0dc'; } catch (_) { return '#d7e0dc'; }
  }

  function labelSprite(THREE, text, css) {
    const cv = document.createElement('canvas'); cv.width = 512; cv.height = 96;
    const x = cv.getContext('2d');
    x.font = '600 52px system-ui, -apple-system, sans-serif'; x.textAlign = 'center'; x.textBaseline = 'middle';
    x.fillStyle = css; x.fillText(text.toUpperCase().split('').join(' '), 256, 48);
    const sp = new THREE.Sprite(new THREE.SpriteMaterial({ map: new THREE.CanvasTexture(cv), transparent: true, opacity: 0.38,
      depthWrite: false, depthTest: false }));
    sp.scale.set(scale * 0.62, scale * 0.116, 1);
    sp.renderOrder = 10;                                   // drawn over the nodes (depthTest off)
    return sp;
  }

  function enter(graph, data, ctx) {
    const THREE = T(); if (!THREE) return;
    g = graph;
    const scene = graph.scene(), nodes = data.nodes, links = data.links, by = new Map();
    for (const n of nodes) by.set(n.id, n);
    const col = new THREE.Color(), cache = new Map();
    const colorOf = (n) => { let c = cache.get(n.id); if (!c) { c = cssColor(ctx.nodeColorFor(n), new THREE.Color()); cache.set(n.id, c); } return c; };

    // soft arcs: quadratic Bézier per link, control point = midpoint pushed away from the brain centre
    // (cross-hemisphere links bow up over the midline, like callosal fibres); ONE LineSegments
    const cy = 0.05 * scale, cz = 0;
    const V = links.length * ARC_SEG * 2, ap = new Float32Array(V * 3), ac = new Float32Array(V * 3);
    let w = 0;
    for (const l of links) {
      const a = by.get(endId(l.source)), b = by.get(endId(l.target));
      if (!a || !b || !Number.isFinite(a.x) || !Number.isFinite(b.x)) continue;
      const mx = (a.x + b.x) / 2, my = (a.y + b.y) / 2, mz = (a.z + b.z) / 2;
      let dx = mx, dy = my - cy, dz = mz - cz; const dl = Math.hypot(dx, dy, dz) || 1;
      const len = Math.hypot(b.x - a.x, b.y - a.y, b.z - a.z), k = ARC_BOW * len / dl;
      dx = mx + dx * k; dy = my + (my - cy) * k + 0.08 * len; dz = mz + dz * k;
      const ca = colorOf(a), cb = colorOf(b), f = a.x * b.x < 0 ? 0.4 : 1;   // callosal (cross-hemisphere) arcs dimmer → fissure stays dark
      for (let s = 0; s < ARC_SEG; s++) {
        for (let e = 0; e < 2; e++) {
          const t = (s + e) / ARC_SEG, u = 1 - t, q0 = u * u, q1 = 2 * u * t, q2 = t * t;
          ap[w] = q0 * a.x + q1 * dx + q2 * b.x; ap[w + 1] = q0 * a.y + q1 * dy + q2 * b.y; ap[w + 2] = q0 * a.z + q1 * dz + q2 * b.z;
          ac[w] = (ca.r * u + cb.r * t) * f; ac[w + 1] = (ca.g * u + cb.g * t) * f; ac[w + 2] = (ca.b * u + cb.b * t) * f;
          w += 3;
        }
      }
    }
    const ag = new THREE.BufferGeometry();
    ag.setAttribute('position', new THREE.BufferAttribute(ap, 3));
    ag.setAttribute('color', new THREE.BufferAttribute(ac, 3));
    ag.setDrawRange(0, w / 3);
    arcs = new THREE.LineSegments(ag, new THREE.LineBasicMaterial({ vertexColors: true, transparent: true, opacity: ARC_OP,
      blending: THREE.AdditiveBlending, depthWrite: false }));
    arcs.frustumCulled = false;
    scene.add(arcs);

    // particle cloud: ONE Points = every node (soft glowing dot in its type colour, size ~ cbrt degree)
    // + faint dust filling every lobe ellipsoid (volume-weighted, tinted by the lobe's mean node colour,
    // fissure gap like the nodes) so the two-hemisphere silhouette reads. Additive → overlap = glow.
    const tint = {}, tc = {}, txt = cssColor(textCss(), new THREE.Color());
    for (const n of nodes) {
      const l = lobeOf(n.type), c = colorOf(n), s = tint[l] || (tint[l] = [0, 0, 0]);
      s[0] += c.r; s[1] += c.g; s[2] += c.b; tc[l] = (tc[l] || 0) + 1;
    }
    const M = nodes.length + DUST + SHELL, gp = new Float32Array(M * 3), gc = new Float32Array(M * 3), gs = new Float32Array(M);
    let d = 0;
    for (const n of nodes) {
      if (!Number.isFinite(n.x)) continue;
      const c = colorOf(n);
      gp[d * 3] = n.x; gp[d * 3 + 1] = n.y; gp[d * 3 + 2] = n.z;
      gc[d * 3] = c.r * NODE_I; gc[d * 3 + 1] = c.g * NODE_I; gc[d * 3 + 2] = c.b * NODE_I;
      gs[d] = NODE_PT * scale * Math.min(2.2, Math.cbrt(Math.max(ctx.nodeVal ? ctx.nodeVal(n) : 1, 1)) / 1.15);
      d++;
    }
    const vol = LOBE_NAMES.map((l) => LOBES[l].r[0] * LOBES[l].r[1] * LOBES[l].r[2] * (LOBES[l].mid ? 1 : 2));
    const vsum = vol.reduce((a, b) => a + b, 0), d0 = d;
    const lc = LOBE_NAMES.map((l) => (tc[l] ? new THREE.Color(tint[l][0] / tc[l], tint[l][1] / tc[l], tint[l][2] / tc[l]).lerp(txt, 0.25) : txt.clone()));
    const put = (x, y, z, c, f) => {
      gp[d * 3] = x * XS * scale; gp[d * 3 + 1] = y * scale; gp[d * 3 + 2] = z * scale;
      gc[d * 3] = c.r * f; gc[d * 3 + 1] = c.g * f; gc[d * 3 + 2] = c.b * f; gs[d] = DUST_PT * scale; d++;
    };
    let k = 1;
    LOBE_NAMES.forEach((l, li) => {                       // lobe volume dust (brighter toward each lobe's surface)
      const L = LOBES[l], want = Math.round(DUST * vol[li] / vsum);
      for (let i = 0; i < want && d < d0 + DUST; k++) {
        const u0 = 2 * ((0.5 + A1 * k) % 1) - 1, u1 = 2 * ((0.5 + A2 * k) % 1) - 1, u2 = 2 * ((0.5 + A3 * k) % 1) - 1;
        const r2 = u0 * u0 + u1 * u1 + u2 * u2;
        if (r2 > 1) continue;
        const side = L.mid ? 1 : (i % 2 ? -1 : 1), xb = L.c[0] + u0 * L.r[0];
        put((L.mid ? xb : xb + FISSURE) * side, L.c[1] + u1 * L.r[1], L.c[2] + u2 * L.r[2], lc[li], DUST_I * (0.55 + 0.9 * r2));
        i++;
      }
    });
    // cortex shell: dust on each hemisphere's envelope (thin radial noise), coloured by the nearest lobe →
    // one continuous two-hemisphere silhouette with the dark fissure between them
    const C = CORTEX;
    for (let i = 0; i < SHELL; k++) {
      const u0 = 2 * ((0.5 + A1 * k) % 1) - 1, u1 = 2 * ((0.5 + A2 * k) % 1) - 1, u2 = 2 * ((0.5 + A3 * k) % 1) - 1;
      const r2 = u0 * u0 + u1 * u1 + u2 * u2;
      if (r2 > 1 || r2 < 0.04) continue;
      const rr = (0.9 + 0.1 * Math.sqrt(r2)) / Math.sqrt(r2);   // push to a thin shell
      const x = C.c[0] + u0 * rr * C.r[0], y = C.c[1] + u1 * rr * C.r[1], z = C.c[2] + u2 * rr * C.r[2];
      let best = 0, bd = Infinity;
      for (let li = 0; li < LOBE_NAMES.length; li++) {
        const L = LOBES[LOBE_NAMES[li]]; if (L.mid) continue;
        const e = ((x - L.c[0]) / L.r[0]) ** 2 + ((y - L.c[1]) / L.r[1]) ** 2 + ((z - L.c[2]) / L.r[2]) ** 2;
        if (e < bd) { bd = e; best = li; }
      }
      const rim = 1 + 1.6 * Math.exp(-(((x - C.c[0] + C.r[0]) / 0.07) ** 2));   // medial wall glows a little → edges the fissure
      put((x + FISSURE) * (i % 2 ? -1 : 1), y, z, lc[best], DUST_I * 0.8 * rim);
      i++;
    }
    const gg = new THREE.BufferGeometry();
    gg.setAttribute('position', new THREE.BufferAttribute(gp, 3));
    gg.setAttribute('aColor', new THREE.BufferAttribute(gc, 3));
    gg.setAttribute('aSize', new THREE.BufferAttribute(gs, 1));
    gg.setDrawRange(0, d);
    glow = new THREE.Points(gg, softSprite(THREE));
    glow.frustumCulled = false;
    const buf = new THREE.Vector2(), uH = glow.material.uniforms.uH;
    glow.onBeforeRender = (renderer) => { uH.value = renderer.getDrawingBufferSize(buf).y; };   // no allocation
    scene.add(glow);

    // faint lobe labels: one Group of 6 sprites, above/beside each lobe on the midline or outer side
    labels = new THREE.Group();
    const css = textCss();
    for (const l of LOBE_NAMES) {
      const L = LOBES[l], sp = labelSprite(THREE, L.label, css);
      const top = l === 'frontal' || l === 'parietal' || l === 'occipital';
      if (top) sp.position.set((L.c[0] + FISSURE) * XS * scale, (L.c[1] + L.r[1] + 0.1) * scale, L.c[2] * scale);   // over the right hemisphere, off the fissure
      else if (l === 'temporal') sp.position.set((L.c[0] + L.r[0] + FISSURE) * XS * scale + 0.25 * scale, L.c[1] * scale, L.c[2] * scale);
      else if (l === 'cerebellum') sp.position.set(0, (L.c[1] - L.r[1] - 0.08) * scale, (L.c[2] - L.r[2]) * scale);
      else sp.position.set(0, (L.c[1] - L.r[1] - 0.1) * scale, L.c[2] * scale);
      labels.add(sp);
    }
    scene.add(labels);

    // straight instanced edges + edge photons would cut across the arcs: hide them now and again after
    // the instanced rebuild that follows a dataChanged() (app.js rebuilds synchronously right after us)
    hideStraight();
    Promise.resolve().then(hideStraight);

    // fresh entry: aim a 3/4 view at the brain (graph.zoomToFit has no bbox under the instanced
    // renderer); the graph camera comes back on the final exit. Data swaps keep the user's camera.
    if (!reentry && graph.cameraPosition) {
      const cam = graph.camera(), ctl = graph.controls && graph.controls();
      savedCam = { p: cam.position.clone(), t: ctl && ctl.target ? ctl.target.clone() : new THREE.Vector3() };
      const D = CAM_DIST * scale, l = Math.hypot(...CAM_DIR);
      graph.cameraPosition({ x: CAM_DIR[0] / l * D, y: CAM_DIR[1] / l * D, z: CAM_DIR[2] / l * D }, { x: 0, y: -0.1 * scale, z: 0 }, 800);
    }
  }

  // soft-sprite additive point shader: world-space size (perspective), gaussian halo + bright core;
  // sub-pixel sprites clamp to 1px and dim by their area so dust stays faint at any zoom
  function softSprite(THREE) {
    return new THREE.ShaderMaterial({
      uniforms: { uH: { value: 1000 } },
      vertexShader: 'uniform float uH; attribute vec3 aColor; attribute float aSize; varying vec3 vC;'
        + 'void main(){ vec4 mv = modelViewMatrix * vec4(position, 1.0); gl_Position = projectionMatrix * mv;'
        + ' float px = aSize * projectionMatrix[1][1] * 0.5 * uH / max(-mv.z, 1e-3);'
        + ' gl_PointSize = clamp(px, 1.0, 96.0); vC = aColor * min(1.0, px * px); }',
      fragmentShader: 'varying vec3 vC;'
        + 'void main(){ vec2 p = gl_PointCoord * 2.0 - 1.0; float d = dot(p, p); if (d > 1.0) discard;'
        + ' float a = exp(-d * 5.0) * (1.0 - d) + 0.9 * exp(-d * 40.0);'
        + ' gl_FragColor = vec4(vC * a, 1.0);\n#include <colorspace_fragment>\n}',
      transparent: true, depthWrite: false, blending: THREE.AdditiveBlending,
    });
  }

  // straight edges, photons, arrows, opaque node spheres + hub bloom spheres made invisible by MATERIAL:
  // instanced3d's loop re-sets photons/arrows obj.visible every frame (and bloom toggles obj.visible), so
  // only material.visible sticks; the InstancedMesh still raycasts for hover/click
  function hideStraight() {
    if (!g || !window.Instanced3d || !Instanced3d.debug) return;
    const h = Instanced3d.debug();
    for (const o of [h.lines, h.photons, h.arrows, h.inst, ...(h.hubMeshes || [])]) {
      const m = o && o.material;
      if (m && m.visible) { m.visible = false; hiddenMat.push(m); }
    }
  }

  function exit() {
    for (const m of hiddenMat) m.visible = true;
    hiddenMat = [];
    for (const o of [arcs, glow]) {
      if (!o) continue;
      if (g) g.scene().remove(o);
      o.geometry.dispose(); o.material.dispose();
    }
    if (labels) {
      if (g) g.scene().remove(labels);
      for (const sp of labels.children) { sp.material.map.dispose(); sp.material.dispose(); }
    }
    const graph = g;
    arcs = glow = labels = null; g = null;
    // re-entered in this task (dataChanged) → keep the camera; otherwise the mode was left → restore it
    reentry = true;
    Promise.resolve().then(() => {
      reentry = false;
      if (g || !savedCam || !graph) return;
      const c = savedCam; savedCam = null;
      try { graph.cameraPosition({ x: c.p.x, y: c.p.y, z: c.p.z }, { x: c.t.x, y: c.t.y, z: c.t.z }, 600); } catch (_) { /* graph torn down */ }
    });
  }

  window.Modes.register('brain', { allowsDrag: false, layout, enter, exit, debug: () => dbg, lobeOf });
})();
