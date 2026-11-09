/* mindgap view mode "genesis" — replays the graph growing by created_at. Nodes (and every link
   whose endpoints both exist) appear in creation order with a birth flash; forces and drag stay ON,
   so the layout keeps settling as nodes arrive. HUD: play/pause, restart, speed, loop, date readout.
   Stops at "now" (the newest node) unless loop is on.

   Unlike the fixed-layout modes it pins nothing: layout() returns an empty map and enter() turns the
   sim back on (the framework zeroed cooldownTicks; Infinity is the 3d-force-graph default the app
   never changes, and the framework restores its own snapshot on leave). Growth is a graphData swap to
   a prefix of the creation order — the SAME node objects each time, so born nodes keep their
   positions — batched to one swap per BATCH_MS (never per frame). The instancing is built ONCE per
   order (MOD.capacity pre-sizes every buffer for the full set); each batch Instanced3d.grow writes only
   the newborn tail and advances the draw counts — a per-batch rebuild recompiled the shader programs
   (~10 ms) on every arrival. While playing, the many-body force is loosened (THETA_PLAY) and sliced
   over ticks (sliced: one slice of targets per tick) so a budgeted tick stays short at 5-10k, and a
   speed cap (calm) makes newborns glide in instead of being blasted out. Newborns seed beside an
   already-born neighbour, on its outward side. Leaving swaps the full set back and lets the framework
   restore every snapshotted position exactly (the swap's alpha-1 restart is stopped on its first
   frame via cooldownTime -1). App data swaps (filters/search/focus) mid-replay re-derive the order and
   resume at the same replay time; a theme rebuild (no swap) just re-decorates. The replay clock
   (st.t over [st.lo, st.hi]) is global: a filter only hides nodes, it never moves the clock back or
   ends the replay early, and the window only widens until a restart. After the replay is done, a data
   swap jumps to the (possibly newer) end, so every matching node shows.

   timeline.js's cutoff is not reused: it goes through app.applyData(viewData()) (fresh clones of
   every node per step + a full mode re-enter), which genesis can't reach and doesn't need.

   Look (so the frontier of growth reads, not a flat tangle):
   - spheres are Graph-sized: no radius override, instanced3d's own nodeVal radius is the one scale
     source (the replay's layout is what must match Graph's spread — see budget());
   - newborns flash: a small, short (FLASH_MS) glow in the node's type colour, no white core; at most
     FLASH_CAP at once (ring buffer, newest win) so a same-day cohort can't sum to a white blob;
   - hierarchy: the top HUBS live-degree nodes (>= HUB_MIN links) carry a faint type-tinted halo that
     grows modestly as they accumulate links;
   - edges: old links sink to OLD x their base alpha, recent ones (by replay time) sit at up to NEW x,
     and every link brightens in its own colour for LG_MS (wall clock) when it is born;
   - time-wave: a type-tinted ring expands from the newest birth (at most one per RING_EVERY).

   Cost: flashes + hub halos + rings are ONE bloom-tagged additive Points with a tiny ShaderMaterial
   (per-point colour/size/kind; preallocated typed arrays, ranged uploads). Edge tint = one O(E) pass
   per batch inside Instanced3d's colour write (tintLinks hook) + a per-frame pass over only the
   still-glowing tail of links (contiguous: links are born in order). Live degree / hub ranking are
   per batch. No per-node objects, no per-frame allocation. Registered via Modes.register. */
'use strict';
(function () {
  const DUR_MS = 30000;        // full replay length at 1×
  const BATCH_MS = 200;        // arrivals are applied (graphData swap + instanced grow) at most this often
  const FLASH_MS = 650, FLASH_CAP = 24, FLASH_K = 5.5, FLASH_I = 0.55;   // newborn glow: ≤ FLASH_CAP live, FLASH_K × sphere radius, peak intensity
  const HUBS = 12, HUB_MIN = 8;          // live-degree halos: top HUBS nodes with >= HUB_MIN links
  const RINGS = 8, RING_MS = 2200, RING_EVERY = 700;   // time-wave rings from the newest birth
  const LG_MS = 1500;                    // newborn link glow (wall clock)
  const IDLE_MS = 250;                   // stopped: hand the charge back once the settle has gone this long without a tick
  const FIT_DEFER = 150;                 // done: the closing zoomToFit starts this long after the done frame
  const OLD = 0.32, NEW = 1.35, REC = 0.07;   // edge alpha x [OLD..NEW] by recency; REC = decay, fraction of the replay window
  const ADD = { old: 0.3, nu: 1.0, hot: 0.3 };   // additive-edge themes (galaxy): overlaps already sum toward white
  let eOld = OLD, eNew = NEW, eHot = 0.8;   // eHot: newborn link brightness boost (own colour, ×(1+eHot) at birth)
  const HOLD_MS = 2500;        // loop: pause at "now" before restarting
  const FIT_MS = 2500;         // camera follows the growing graph (zoomToFit) at this cadence while playing
  const SPEEDS = [0.25, 0.5, 1, 2, 4, 8];
  const TICKS_MIN = 0.25, TICKS_MAX = 60;   // physics budget: sim ticks allowed per batch while playing (< 1: a tick every few batches)
  const THETA_PLAY = 1.5;      // many-body Barnes-Hut theta while playing (d3 default 0.9): one tick at
                               // 4.4k nodes 33 → ≤17 ms; restored when the replay stops or the mode leaves
  const CALM = 'genesisCalm', VMAX_K = 0.15;   // playing: per-tick node speed cap = VMAX_K × linkDist (see calm)
  const SEED_K = 0.5;          // newborn seeds SEED_K × linkDist from its born neighbour, on the outward side
  const TETHER_K = 3.5, TETHER_S = 0.1;   // calm: pull back past TETHER_K × linkDist × cbrt(N) from the origin (see calm)

  let g = null, ctx = null;
  // replay data, re-derived when the app swaps graphData
  let full = null, shown = null, order = [], birth = null, lorder = [], lbirth = null, adj = null;
  let minT = 0, maxT = 0, nb = 0, nl = 0, origIds = null, byId = null;
  // live degree (n.__gdeg) + hub ranking + edge age tint (see header)
  let maxDeg = 0, hubCount = 0, hubsDirty = true, fresh = true;   // fresh: next swap rebuilds the instancing (new order / capacity)
  const hubN = new Array(HUBS);
  let lWall = null, lBase = null, lAttr = null, lgFrom = 0, lastT = -Infinity;
  // replay state: survives data swaps / theme rebuilds / remounts, reset on a real leave
  let st = null;               // { t, lo, hi, playing, speed, loop, done, seeded:Set }
  let ticks = 12, tAcc = 0, vsync = Infinity;   // adaptive physics budget (see budget()); tAcc carries fractional ticks
  const DTS = new Float32Array(256); let dtN = 0;   // frame times since the last budget() (preallocated)
  let raf = 0, lastFrame = 0, lastBatch = -Infinity, lastFit = 0, lastHud = 0, holdUntil = 0, batches = 0, lifted = false;
  let lastTick = -Infinity, fitAt = 0, settleAt = 0;   // lastTick: wall time of the last sim tick (stamped by calm); settleAt: stop → settle start
  // FX Points: birth-flash ring buffer + hub halos + time-wave rings
  let pts = null, ptsAttrs = null, fNode = null, fT = null, fCol = null, fHead = 0, fLive = 0, _c = null;
  let hubCol = null, rNode = null, rT = null, rCol = null, rHead = 0, rLive = 0, lastRing = -Infinity, lastSig = NaN, lastW = 0;
  let hud = null, hudEl = null, theta0 = null;

  const endId = (e) => (e && typeof e === 'object' ? e.id : e);
  const fin = Number.isFinite;
  function hash(s) {                                   // FNV-1a → [0,1)
    let h = 0x811c9dc5; s = String(s);
    for (let i = 0; i < s.length; i++) { h ^= s.charCodeAt(i); h = Math.imul(h, 0x01000193); }
    return (h >>> 0) / 4294967296;
  }
  function span() { return st ? Math.max(st.hi - st.lo, 1) : Math.max(maxT - minT, 1); }   // replay clock window
  function fmt(t) {
    if (!fin(t)) return '—';
    const iso = new Date(t).toISOString();
    return span() < 2 * 86400000 ? iso.slice(0, 16).replace('T', ' ') : iso.slice(0, 10);
  }

  // creation order over the current app data: nodes by created_at (unparseable → first), links by
  // the later of their endpoints' births so a link never shows before both ends exist
  function prepare(d) {
    full = d;
    const nodes = d.nodes, N = nodes.length, tOf = new Map();
    byId = new Map();
    let lo = Infinity, hi = -Infinity;
    for (const n of nodes) {
      const t = Date.parse(n.created_at);
      if (fin(t)) { if (t < lo) lo = t; if (t > hi) hi = t; }
      tOf.set(n.id, t); byId.set(n.id, n); n.__gdeg = 0;
    }
    if (!fin(lo)) lo = hi = 0;
    minT = lo; maxT = hi;
    const tt = (n) => { const t = tOf.get(n.id); return fin(t) ? t : minT; };
    order = nodes.map((n, i) => [tt(n), i, n]).sort((a, b) => (a[0] - b[0]) || (a[1] - b[1])).map((e) => e[2]);
    birth = Float64Array.from(order, tt);
    adj = new Map();
    const ls = [];
    d.links.forEach((l, i) => {
      const a = byId.get(endId(l.source)), b = byId.get(endId(l.target));
      if (!a || !b) return;
      ls.push([Math.max(tt(a), tt(b)), i, l]);
      if (a !== b) { (adj.get(a.id) || adj.set(a.id, []).get(a.id)).push(b); (adj.get(b.id) || adj.set(b.id, []).get(b.id)).push(a); }
    });
    ls.sort((a, b) => (a[0] - b[0]) || (a[1] - b[1]));
    lorder = ls.map((e) => e[2]); lbirth = Float64Array.from(ls, (e) => e[0]);
    lWall = new Float64Array(ls.length).fill(-Infinity); lBase = new Float32Array(ls.length * 4); lAttr = null;
    nb = 0; nl = 0; lgFrom = 0; maxDeg = 0; hubCount = 0; hubsDirty = true; fresh = true;
  }

  function linkDist() { const v = ctx && ctx.getSettings ? +ctx.getSettings().linkDist : NaN; return v > 0 ? v : 55; }
  // newborn beside an already-born neighbour, on its outward side (away from the origin the centre
  // forces hold the graph around), SEED_K link lengths out: a same-day cohort used to pile up 8 units
  // from one neighbour and the alpha-1 charge blew it ~1500 units away in a tick (the long streaks).
  // No born neighbour → a small shell that widens as the graph grows.
  function seed(n) {
    const z = 2 * hash(n.id + ':z') - 1, a = 2 * Math.PI * hash(n.id + ':a'), q = Math.sqrt(1 - z * z);
    let dx = q * Math.cos(a), dy = q * Math.sin(a), dz = z;
    let p = null;
    for (const m of adj.get(n.id) || []) if (st.seeded.has(m.id) && fin(m.x)) { p = m; break; }
    if (p && dx * p.x + dy * p.y + dz * (p.z || 0) < 0) { dx = -dx; dy = -dy; dz = -dz; }
    const r = p ? SEED_K * linkDist() : 30 + 3 * Math.sqrt(nb);
    n.x = (p ? p.x : 0) + r * dx; n.y = (p ? p.y : 0) + r * dy; n.z = (p ? p.z || 0 : 0) + r * dz;
    n.vx = 0; n.vy = 0; n.vz = 0;
  }

  // apply every arrival up to st.t: ONE graphData swap + ONE instanced rebuild for the whole batch
  function advance(now, force) {
    const N = order.length, L = lorder.length, t = st.t, nb0 = nb, nl0 = nl;
    while (nb < N && birth[nb] <= t) nb++;
    while (nl < L && lbirth[nl] <= t) nl++;
    if (!force && nb === nb0 && nl === nl0) return;
    let newest = null;
    for (let i = nb0; i < nb; i++) {
      const n = order[i];
      if (st.seeded.has(n.id) && fin(n.x)) continue;   // resumed after a data swap: keeps its place
      seed(n); st.seeded.add(n.id); flashAdd(n, now); newest = n;
    }
    for (let i = nl0; i < nl; i++) {                   // live degree + newborn-link glow (not on a resume)
      const l = lorder[i], a = byId.get(endId(l.source)), b = byId.get(endId(l.target));
      if (++a.__gdeg > maxDeg) maxDeg = a.__gdeg;
      if (++b.__gdeg > maxDeg) maxDeg = b.__gdeg;
      lWall[i] = lbirth[i] > lastT ? now : -Infinity;
    }
    if (nl > nl0) { rankHubs(); hubsDirty = true; }
    if (newest && now - lastRing >= RING_EVERY) { lastRing = now; ringAdd(newest, now); }
    lastT = t;
    shown = { nodes: order.slice(0, nb), links: lorder.slice(0, nl) };
    const active = st.playing && !st.done;
    looseCharge(active);
    g.cooldownTicks(active ? budget() : Infinity);     // a swap restarts the sim; cap its burst while playing
    lifted = !active; settleAt = 0;
    g.graphData(shown);
    batches++;
    // arrivals only extend the prefix → Instanced3d.grow writes just the tail into buffers pre-sized
    // for the full set (MOD.capacity); a full rebuild only after prepare (new order / objects)
    if (window.Instanced3d) { if (Instanced3d.grow && !fresh) Instanced3d.grow(); else Instanced3d.rebuild(); }
    fresh = false;
    if (window.Bloom) Bloom.refresh();                 // hub set + glow follow the new node set
  }

  // calm (playing only): caps every node's per-tick speed at vmax. Each swap restarts the sim at alpha
  // 1, so newborns landing in a dense region (or a whole cohort born together) would otherwise be
  // kicked hundreds of units per tick; capped, they glide into place. A d3 force run last (re-appended
  // on every swap, since the app re-adds its own forces on settings changes): sees the summed velocity
  // just before d3 integrates it. O(N) per tick, no allocation. Also stamps lastTick: the hand-back
  // waits for the engine to go idle (see frame).
  // Tether: a component that is still DISCONNECTED in the born prefix (it joins the core later) has
  // no link holding it and is outside the app's satellite gravity (computed over the full graph), so
  // the charge exiled it ever further (a 12-node island at 8.7k units, 4.7x R95: a bundle of long
  // edges across the frame once it linked up). Past tR = TETHER_K × linkDist × cbrt(N) (~Graph's
  // R95) every node is pulled back like the app's gravity (alpha × TETHER_S × overshoot), so it
  // parks just off the rim; nodes inside tR are untouched.
  let calmNodes = null, vmax = 8, tR = Infinity;
  function calm(alpha) {
    lastTick = performance.now();
    const ns = calmNodes; if (!ns) return;
    const v2 = vmax * vmax, r2T = tR * tR, kT = (alpha || 0) * TETHER_S;
    for (let i = 0; i < ns.length; i++) {
      const n = ns[i], z = n.z || 0, d2 = n.x * n.x + n.y * n.y + z * z;
      if (d2 > r2T) {
        const d = Math.sqrt(d2), k = kT * (d - tR) / d;
        n.vx -= n.x * k; n.vy -= n.y * k; if (n.vz !== undefined) n.vz -= z * k;
      }
      const vz = n.vz || 0, s = n.vx * n.vx + n.vy * n.vy + vz * vz;
      if (s > v2) { const k = vmax / Math.sqrt(s); n.vx *= k; n.vy *= k; if (n.vz !== undefined) n.vz *= k; }
    }
  }
  calm.initialize = (nodes) => { calmNodes = nodes; tR = TETHER_K * linkDist() * Math.cbrt(Math.max(nodes.length, 1)); };

  // sliced (playing, > SLICE_N born nodes): stands in for the app's d3 charge force. The per-batch tick
  // was the replay's long frame, and ~95% of a many-body tick is the per-node tree walk (3.8k nodes:
  // 8.7 ms walk vs 0.6 ms octree build). So each tick builds the octree over every born node (same
  // Barnes-Hut as d3's forceManyBody: strength-weighted centroids, opening test w²/θ² < l, distanceMin
  // 1) but walks it for ONE slice of ≤ SLICE_N targets, the impulse scaled by the slice count K: every
  // node still gets its full repulsion on average over K ticks, at ~1/K of the cost per tick (the calm
  // cap smooths the K× kicks). It stays on through the done / pause settle until the hand-back (slOn),
  // so the settle never runs a full-accuracy tick. Otherwise (small graph / handed back) it calls the
  // original force, whose accessors (strength / theta / distance*) it forwards, so the app's
  // applyForces keeps working.
  // Typed arrays grow only with capacity; no per-tick allocation.
  const SLICE_N = 1200, LEAF = 4, DEPTH = 24;
  let slNodes = null, slFrom = 0, nCells = 0, nKids = 0, slOn = false;
  let pIx = null, pTmp = null, pX = null, pY = null, pZ = null, pS = null;                      // per point
  let cM = null, cX = null, cY = null, cZ = null, cW = null, cA = null, cB = null, cK = null, kids = null;   // per cell
  const oCnt = new Int32Array((DEPTH + 1) * 9), stk = new Int32Array(8 * DEPTH + 16);
  function slAlloc(n) {
    if (pIx && pIx.length >= n) return;
    pIx = new Int32Array(n); pTmp = new Int32Array(n);
    pX = new Float64Array(n); pY = new Float64Array(n); pZ = new Float64Array(n); pS = new Float64Array(n);
    cellAlloc(2 * n + 64);
  }
  function cellAlloc(c) {                              // grow (copying) the cell arrays to c cells
    const g2 = (A, k, T) => { const B = new T(c * k); if (A) B.set(A.subarray(0, Math.min(A.length, c * k))); return B; };
    cM = g2(cM, 1, Float64Array); cX = g2(cX, 1, Float64Array); cY = g2(cY, 1, Float64Array); cZ = g2(cZ, 1, Float64Array);
    cW = g2(cW, 1, Float64Array); cA = g2(cA, 1, Int32Array); cB = g2(cB, 1, Int32Array); cK = g2(cK, 1, Int32Array);
    kids = g2(kids, 8, Int32Array);
  }
  // cell over points pIx[lo, hi) in the cube (x0, y0, z0) + w: leaf (cK -1, exact) or 8 child slots
  function build(lo, hi, x0, y0, z0, w, dep) {
    if (nCells >= cM.length) cellAlloc(2 * cM.length);
    const c = nCells++;
    cW[c] = w;
    let m = 0, aw = 0, x = 0, y = 0, z = 0;
    if (hi - lo <= LEAF || dep >= DEPTH) {
      cK[c] = -1; cA[c] = lo; cB[c] = hi;
      for (let k = lo; k < hi; k++) { const p = pIx[k], s = pS[p], a = s < 0 ? -s : s; m += s; aw += a; x += a * pX[p]; y += a * pY[p]; z += a * pZ[p]; }
    } else {
      const h = w / 2, mx = x0 + h, my = y0 + h, mz = z0 + h, o = dep * 9;
      for (let j = 0; j < 9; j++) oCnt[o + j] = 0;
      for (let k = lo; k < hi; k++) { const p = pIx[k]; oCnt[o + 1 + ((pX[p] >= mx) | ((pY[p] >= my) << 1) | ((pZ[p] >= mz) << 2))]++; }
      for (let j = 1; j < 9; j++) oCnt[o + j] += oCnt[o + j - 1];                 // octant start offsets
      for (let k = lo; k < hi; k++) { const p = pIx[k]; pTmp[lo + oCnt[o + ((pX[p] >= mx) | ((pY[p] >= my) << 1) | ((pZ[p] >= mz) << 2))]++] = p; }
      for (let k = lo; k < hi; k++) pIx[k] = pTmp[k];
      if (nKids + 8 > kids.length) { const K2 = new Int32Array(kids.length * 2); K2.set(kids); kids = K2; }
      const base = nKids; nKids += 8; cK[c] = base;
      let s0 = lo;                                     // octant j now spans [s0, lo + oCnt[o + j])
      for (let j = 0; j < 8; j++) {
        const s1 = lo + oCnt[o + j];
        if (s1 === s0) { kids[base + j] = -1; continue; }
        const k = build(s0, s1, j & 1 ? mx : x0, j & 2 ? my : y0, j & 4 ? mz : z0, h, dep + 1);
        kids[base + j] = k; s0 = s1;
        const a = cM[k] < 0 ? -cM[k] : cM[k];
        m += cM[k]; aw += a; x += a * cX[k]; y += a * cY[k]; z += a * cZ[k];
      }
    }
    cM[c] = m;
    if (aw > 0) { cX[c] = x / aw; cY[c] = y / aw; cZ[c] = z / aw; } else { cX[c] = x0 + w / 2; cY[c] = y0 + w / 2; cZ[c] = z0 + w / 2; }
    return c;
  }
  function sliced(alpha) {
    const f = sliced.orig, ns = slNodes;
    if (!f) return;
    const N = ns ? ns.length : 0;
    if (!slOn || N <= SLICE_N) { f(alpha); return; }
    slAlloc(N);
    const sf = f.strength(), th = f.theta ? f.theta() : 0.9, th2 = th * th;
    let x0 = Infinity, y0 = Infinity, z0 = Infinity, x1 = -Infinity, y1 = -Infinity, z1 = -Infinity;
    for (let i = 0; i < N; i++) {
      const n = ns[i], x = n.x, y = n.y, z = n.z || 0;
      pIx[i] = i; pX[i] = x; pY[i] = y; pZ[i] = z; pS[i] = typeof sf === 'function' ? +sf(n, i, ns) : +sf;
      if (x < x0) x0 = x; if (x > x1) x1 = x; if (y < y0) y0 = y; if (y > y1) y1 = y; if (z < z0) z0 = z; if (z > z1) z1 = z;
    }
    nCells = 0; nKids = 0;
    build(0, N, x0, y0, z0, Math.max(x1 - x0, y1 - y0, z1 - z0) * (1 + 1e-9) + 1e-6, 0);
    const K = Math.ceil(N / SLICE_N), S = Math.ceil(N / K), aK = alpha * N / S;
    for (let t = 0; t < S; t++) {
      const i = (slFrom + t) % N, n = ns[i], xi = pX[i], yi = pY[i], zi = pZ[i];
      let vx = 0, vy = 0, vz = 0, sp = 0;
      stk[sp++] = 0;
      while (sp) {
        const c = stk[--sp];
        if (cM[c] === 0) continue;
        if (cK[c] < 0) {                               // leaf: exact, self skipped
          for (let k = cA[c]; k < cB[c]; k++) {
            const p = pIx[k]; if (p === i) continue;
            const dx = pX[p] - xi, dy = pY[p] - yi, dz = pZ[p] - zi; let l = dx * dx + dy * dy + dz * dz;
            if (l === 0) continue; if (l < 1) l = Math.sqrt(l);
            const q = pS[p] / l; vx += dx * q; vy += dy * q; vz += dz * q;
          }
          continue;
        }
        const dx = cX[c] - xi, dy = cY[c] - yi, dz = cZ[c] - zi; let l = dx * dx + dy * dy + dz * dz;
        if (cW[c] * cW[c] / th2 < l) { if (l < 1) l = Math.sqrt(l); const q = cM[c] / l; vx += dx * q; vy += dy * q; vz += dz * q; continue; }
        const b = cK[c];
        for (let j = 0; j < 8; j++) { const k = kids[b + j]; if (k >= 0) stk[sp++] = k; }
      }
      n.vx += vx * aK; n.vy += vy * aK; if (n.vz !== undefined) n.vz += vz * aK;
    }
    slFrom = (slFrom + S) % N;
  }
  sliced.orig = null;
  sliced.initialize = function (nodes) { slNodes = nodes; if (sliced.orig && sliced.orig.initialize) sliced.orig.initialize.apply(sliced.orig, arguments); };
  for (const k of ['strength', 'theta', 'distanceMin', 'distanceMax']) {
    sliced[k] = function () { const f = sliced.orig, r = f[k].apply(f, arguments); return arguments.length ? sliced : r; };
  }

  // playing / settling: coarser many-body approximation, sliced over ticks + the calm speed cap;
  // handed back / leaving: the original charge force, its saved theta and no cap, so a later
  // reheat/drag and Graph keep d3's accuracy and dynamics. Handed back only once the stop settle has
  // cooled the sim (frame): the done frame used to run a full theta-0.9 tick + zoomToFit together.
  // Charge frozen by a 3D drag (app freezeForces nulls it; the proxy sits in its stash): theta is
  // still restored and the proxy stays a passthrough (slOn false) until the drop puts it back.
  function looseCharge(on) {
    slOn = !!on;
    if (!g || !g.d3Force) return;
    if (g.d3Force(CALM)) g.d3Force(CALM, null);
    if (on) { vmax = VMAX_K * linkDist(); g.d3Force(CALM, calm); } else calmNodes = null;
    const cur = g.d3Force('charge'), f = cur === sliced || !cur ? sliced.orig : cur;
    if (!f || !f.theta) return;
    if (on && theta0 == null) { theta0 = f.theta(); f.theta(THETA_PLAY); }
    else if (!on && theta0 != null) { f.theta(theta0); theta0 = null; }
    if (on && cur && cur !== sliced) { sliced.orig = cur; g.d3Force('charge', sliced); }
    else if (!on && cur === sliced) { g.d3Force('charge', f); slNodes = null; }
  }

  // the HUBS highest live-degree born nodes (>= HUB_MIN links), descending; insertion into a fixed array
  function rankHubs() {
    hubCount = 0;
    for (let i = 0; i < nb; i++) {
      const n = order[i], d = n.__gdeg;
      if (d < HUB_MIN || (hubCount === HUBS && d <= hubN[HUBS - 1].__gdeg)) continue;
      let j = hubCount < HUBS ? hubCount++ : HUBS - 1;
      while (j > 0 && hubN[j - 1].__gdeg < d) { hubN[j] = hubN[j - 1]; j--; }
      hubN[j] = n;
    }
    for (let i = hubCount; i < HUBS; i++) hubN[i] = null;
    if (hubCol) for (let i = 0; i < hubCount; i++) rgbInto(hubN[i], hubCol, i * 3);
  }

  // Instanced3d.setMod hooks: edges age-faded + newborn glow. No radius hook: spheres keep Graph's size.
  // FX sizes follow that sphere (instanced3d radiusOf's default: 4 × cbrt(nodeVal)).
  const sphereR = (n) => Math.cbrt(Math.max(ctx && ctx.nodeVal ? +ctx.nodeVal(n) || 0 : 1.5, 0.01)) * 4;
  function tintLinks(attr, links, from = 0) {          // links < from keep their cached base (grow)
    if (!st || !shown || links !== shown.links || !lBase) return;
    lAttr = attr;
    const ln = window.Instanced3d && Instanced3d.debug ? Instanced3d.debug().lines : null;   // read-only: edge blend mode
    const add = !!(ln && window.THREE && ln.material.blending === THREE.AdditiveBlending);
    eOld = add ? ADD.old : OLD; eNew = add ? ADD.nu : NEW; eHot = add ? ADD.hot : 0.6;
    const c = attr.array, L = links.length, now = performance.now();
    for (let i = from; i < L; i++) { const o = i * 8, b = i * 4; lBase[b] = c[o]; lBase[b + 1] = c[o + 1]; lBase[b + 2] = c[o + 2]; lBase[b + 3] = c[o + 3]; }
    for (let i = 0; i < L; i++) writeLink(c, i, now);
    if (attr.clearUpdateRanges) attr.clearUpdateRanges();   // full upload
  }
  const capacity = () => ({ nodes: order.length, links: lorder.length });   // pre-allocate the full set once
  const MOD = { tintLinks, capacity };
  function writeLink(c, i, now) {
    const b = i * 4, o = i * 8, age = (st.t - lbirth[i]) / span();
    let r = lBase[b], gg = lBase[b + 1], bb = lBase[b + 2];
    let a = lBase[b + 3] * (eOld + (eNew - eOld) * Math.exp(-(age > 0 ? age : 0) / REC));
    const u = (now - lWall[i]) / LG_MS;
    if (u >= 0 && u < 1) {                             // newborn: brighter in its OWN colour (never toward white)
      const k = (1 - u) * (1 - u), m = 1 + k * eHot;
      r = Math.min(1, r * m); gg = Math.min(1, gg * m); bb = Math.min(1, bb * m); a += (1 - a) * k * 0.6;
    }
    if (a > 1) a = 1;
    c[o] = c[o + 4] = r; c[o + 1] = c[o + 5] = gg; c[o + 2] = c[o + 6] = bb; c[o + 3] = c[o + 7] = a;
  }
  // per frame: only the still-glowing tail [lgFrom, nl) -- contiguous, since links are born in order
  function stepLinks(now) {
    if (!lAttr || !shown || lAttr.count < 2 * shown.links.length) { lgFrom = nl; return; }
    const from = lgFrom;
    while (lgFrom < nl && now - lWall[lgFrom] >= LG_MS) lgFrom++;
    if (from >= nl) return;
    const c = lAttr.array;
    for (let i = from; i < nl; i++) writeLink(c, i, now);
    if (lAttr.addUpdateRange) { lAttr.clearUpdateRanges(); lAttr.addUpdateRange(from * 8, (nl - from) * 8); }
    lAttr.needsUpdate = true;
  }

  // Physics budget. Every swap restarts the sim (alpha 1) and a hot sim ticks once per frame; at 5k
  // nodes one many-body tick alone can cost several frames. So while playing, each swap may run at
  // most `ticks` ticks (cooldownTicks), then the engine idles until the next batch. A frame-time
  // controller sets `ticks` from MISSED frames (dt > 1.5 vsync): none in the last batch → +2 (up to
  // a full batch window of ticks = continuous physics); any → ×0.6. vsync = the
  // lowest per-batch lower-quartile dt seen (jitter-proof: the old "fastest frame seen" picked up a
  // 4-5 ms rAF jitter, judged every 120 Hz frame slow and pinned ticks at 1 — 5 ticks/s, so the
  // replay grew ~2-4x denser than Graph's layout and its spheres crowded the frame). Below one tick
  // per batch (10k late in the replay, where a single tick overruns the frame) the fraction carries
  // over: a tick every 1/ticks batches instead of a missed frame on every batch. Paused / done /
  // not playing → Infinity, i.e. the stop settle (frame).
  function budget() {
    if (dtN >= 4) {
      const a = DTS.subarray(0, dtN).sort(), q = a[dtN >> 2];
      if (q < vsync) vsync = q;
      let miss = 0;
      for (let i = 0; i < dtN; i++) if (a[i] > 1.5 * vsync) miss++;
      ticks = miss ? Math.max(TICKS_MIN, ticks >= 2 ? Math.floor(ticks * 0.6) : ticks * 0.6) : Math.min(TICKS_MAX, ticks < 1 ? ticks * 2 : ticks + 2);
    }
    dtN = 0;
    tAcc += ticks;
    const n = Math.floor(tAcc);
    tAcc -= n;
    return n;
  }

  function restart(now) {
    st.lo = st.t = minT; st.hi = maxT; st.done = false; st.seeded.clear(); nb = 0; nl = 0; lastFit = 0; fitAt = 0;
    for (const n of order) n.__gdeg = 0;
    maxDeg = 0; hubCount = 0; lgFrom = 0; lastT = -Infinity; if (lWall) lWall.fill(-Infinity);
    advance(now, true);
  }

  function frame(now) {
    raf = 0;
    if (!g || !st) return;
    const dt = lastFrame ? Math.min(now - lastFrame, 100) : 0;
    lastFrame = now;
    if (dt > 0 && dtN < DTS.length) DTS[dtN++] = dt;
    if (st.playing && !document.hidden) {
      if (st.done) { if (st.loop && now >= holdUntil) restart(now); }
      else {
        st.t = Math.min(st.hi, st.t + dt * st.speed * span() / DUR_MS);
        if (st.t >= st.hi || now - lastBatch >= BATCH_MS) { lastBatch = now; advance(now, false); }
        if (st.t >= st.hi && nb >= order.length && nl >= lorder.length) {
          // done: the last budgeted burst keeps the sliced charge + calm (handed back at the lift, once
          // the engine is idle), and the closing fit starts a few frames later, not on this frame
          st.done = true; holdUntil = now + HOLD_MS; fitAt = now + FIT_DEFER;
          if (!st.loop) st.playing = false;
          lastHud = 0;
        } else if (now - lastFit >= FIT_MS && g.zoomToFit) { lastFit = now; g.zoomToFit(FIT_MS * 0.8, 60); }
      }
    }
    if (fitAt && now >= fitAt) { fitAt = 0; if (g.zoomToFit) g.zoomToFit(1200, 60); }
    // stopped (done / paused): the budgeted bursts left the sim paused HOT (each swap restarts it at
    // alpha 1; a burst only cools it to ~0.8), and the next engine resume (a hover restyle, a drag)
    // ran the whole pending settle at full accuracy — the first post-replay drag at 12 FPS (5k,
    // ~90 ms ticks for ~15 s), later drags fine. So: lift the budget and settle to the early-stop
    // NOW, still on the sliced charge + calm (cheap ticks), then hand the original charge back once
    // the engine has gone IDLE_MS without a tick. Cooled below alphaMin, any later resume stops at
    // once, exactly like a settled Graph; a drag's drop reheat is the normal Graph one.
    if (!(st.playing && !st.done) && !lifted) {
      // not before the lib has digested the swapped-in graphData: a reheat flips engineRunning on and,
      // on a fresh mount (no layout built yet), the next tickFrame throws reading layout.tick
      if (!settleAt) { if (digested()) { settleAt = now; g.cooldownTicks(Infinity); if (g.d3ReheatSimulation) g.d3ReheatSimulation(); } }
      else if (now - settleAt >= IDLE_MS && now - lastTick >= IDLE_MS) { lifted = true; settleAt = 0; looseCharge(false); }
    }
    stepLinks(now);
    stepFx(now);
    if (now - lastHud >= 100) { lastHud = now; paintHud(); }
    // FX Points live → keep the (cheap) loop so hub halos track drags / settling; no THREE → stops as before
    if (st.playing || !lifted || fLive || rLive || lgFrom < nl || pts) raf = requestAnimationFrame(frame);
  }
  // the link force holds the graphData's links array once the lib's (deferred) digest has run
  function digested() { const lf = g.d3Force && g.d3Force('link'); return !lf || lf.links() === g.graphData().links; }
  function start() { if (!raf && g) { lastFrame = 0; raf = requestAnimationFrame(frame); } }
  function stop() { if (raf) { cancelAnimationFrame(raf); raf = 0; } }

  /* ---------- FX: one bloom-tagged additive Points (flashes + hub halos + rings) ---------- */
  // aKind: 0..1 = glow blob with a white-hot core of that strength (genesis passes 0: tinted only); 2 = ring.
  // Colour is premultiplied.
  const VS = 'attribute vec3 aColor; attribute float aSize; attribute float aKind; uniform float uScale;' +
    'varying vec3 vC; varying float vK; void main(){ vec4 mv = modelViewMatrix * vec4(position, 1.0);' +
    'gl_PointSize = aSize * uScale / max(-mv.z, 1.0); gl_Position = projectionMatrix * mv; vC = aColor; vK = aKind; }';
  const FS = 'varying vec3 vC; varying float vK; void main(){ vec2 p = gl_PointCoord * 2.0 - 1.0; float r2 = dot(p, p);' +
    'if (r2 > 1.0) discard; vec3 c;' +
    'if (vK > 1.5) { float r = sqrt(r2), d = abs(r - 0.86); c = vC * (smoothstep(0.07, 0.0, d) + 0.3 * smoothstep(0.35, 0.0, d) * step(r, 0.86)); }' +
    'else { c = vC * (0.75 * exp(-r2 * 5.0) + 0.5 * exp(-r2 * 26.0)) + vec3(vK * exp(-r2 * 70.0)); }' +
    'gl_FragColor = vec4(c, 1.0); }';
  const CAP = FLASH_CAP + HUBS + RINGS;
  function buildFlash() {
    const THREE = window.THREE; if (!THREE || !g) return;
    fNode = new Array(FLASH_CAP); fT = new Float64Array(FLASH_CAP); fCol = new Float32Array(FLASH_CAP * 3);
    fHead = 0; fLive = 0; _c = new THREE.Color();
    hubCol = new Float32Array(HUBS * 3); for (let i = 0; i < hubCount; i++) rgbInto(hubN[i], hubCol, i * 3);
    rNode = new Array(RINGS); rT = new Float64Array(RINGS).fill(-Infinity); rCol = new Float32Array(RINGS * 3); rHead = 0; rLive = 0;
    lastSig = NaN; lastW = 0; hubsDirty = true;
    const geo = new THREE.BufferGeometry();
    geo.setAttribute('position', new THREE.BufferAttribute(new Float32Array(CAP * 3), 3));
    geo.setAttribute('aColor', new THREE.BufferAttribute(new Float32Array(CAP * 3), 3));
    geo.setAttribute('aSize', new THREE.BufferAttribute(new Float32Array(CAP), 1));
    geo.setAttribute('aKind', new THREE.BufferAttribute(new Float32Array(CAP), 1));
    geo.setDrawRange(0, 0);
    ptsAttrs = [geo.attributes.position, geo.attributes.aColor, geo.attributes.aSize, geo.attributes.aKind];
    pts = new THREE.Points(geo, new THREE.ShaderMaterial({ vertexShader: VS, fragmentShader: FS, uniforms: { uScale: { value: 450 } },
      transparent: true, blending: THREE.AdditiveBlending, depthWrite: false, depthTest: false }));
    pts.frustumCulled = false; pts.userData.bloom = true;   // bloom.js renders only userData.bloom objects
    g.scene().add(pts);
  }
  function rgbInto(n, arr, o) {                        // node type colour → arr[o..o+2]
    if (!_c) return;
    const css = String(ctx.nodeColorFor(n)), m = css.indexOf('rgb') === 0 ? css.match(/[\d.]+/g) : null;
    if (m && m.length >= 3) _c.setRGB(+m[0] / 255, +m[1] / 255, +m[2] / 255); else _c.set(css);
    arr[o] = _c.r; arr[o + 1] = _c.g; arr[o + 2] = _c.b;
  }
  function flashAdd(n, now) {
    if (!pts) return;
    const k = fHead; fHead = (fHead + 1) % FLASH_CAP; if (fLive < FLASH_CAP) fLive++;
    fNode[k] = n; fT[k] = now; rgbInto(n, fCol, k * 3);
  }
  function ringAdd(n, now) {
    if (!pts) return;
    const k = rHead; rHead = (rHead + 1) % RINGS;
    rNode[k] = n; rT[k] = now; rgbInto(n, rCol, k * 3);
    for (let j = 0; j < 3; j++) rCol[k * 3 + j] = 0.15 + 0.85 * rCol[k * 3 + j];   // the newest type's hue (not pale)
  }
  function stepFx(now) {
    if (!pts) return;
    const geo = pts.geometry, A = geo.attributes;
    const pa = A.position.array, ca = A.aColor.array, sa = A.aSize.array, ka = A.aKind.array;
    if (g.renderer) pts.material.uniforms.uScale.value = g.renderer().domElement.height * 0.5;   // = PointsMaterial's size scale
    let w = 0, sig = 0;
    for (let j = fLive; j > 0; j--) {                  // newborn flashes, oldest → newest; birth times ascend
      const k = (fHead - j + FLASH_CAP) % FLASH_CAP, u = (now - fT[k]) / FLASH_MS;
      if (u >= 1) { if (j === fLive) { fLive--; fNode[k] = null; } continue; }
      const n = fNode[k];
      if (!fin(n.x)) continue;
      const a = u < 0.12 ? u / 0.12 : (1 - (u - 0.12) / 0.88) ** 1.6;   // quick rise, short fade (additive: dark = invisible)
      pa[w * 3] = n.x; pa[w * 3 + 1] = n.y; pa[w * 3 + 2] = n.z || 0;
      const I = FLASH_I * a;                             // type colour only: no white core (kind 0)
      ca[w * 3] = fCol[k * 3] * I; ca[w * 3 + 1] = fCol[k * 3 + 1] * I; ca[w * 3 + 2] = fCol[k * 3 + 2] * I;
      sa[w] = FLASH_K * sphereR(n) * (0.75 + 0.25 * a); ka[w] = 0;
      w++;
    }
    const top = hubCount ? Math.max(hubN[0].__gdeg, 1) : 1;
    for (let i = 0; i < hubCount; i++) {               // live hubs: faint tinted halo, grows modestly with degree
      const n = hubN[i];
      if (!fin(n.x)) continue;
      const q = Math.sqrt(n.__gdeg / top), I = 0.06 + 0.16 * q;
      pa[w * 3] = n.x; pa[w * 3 + 1] = n.y; pa[w * 3 + 2] = n.z || 0;
      ca[w * 3] = hubCol[i * 3] * I; ca[w * 3 + 1] = hubCol[i * 3 + 1] * I; ca[w * 3 + 2] = hubCol[i * 3 + 2] * I;
      sa[w] = sphereR(n) * (2 + 1.4 * q); ka[w] = 0;
      sig += n.x + 1.31 * n.y + 1.77 * (n.z || 0);
      w++;
    }
    rLive = 0;
    for (let k = 0; k < RINGS; k++) {                  // time-wave rings riding the newest births
      const u = (now - rT[k]) / RING_MS, n = rNode[k];
      if (!(u < 1) || !n || !fin(n.x)) continue;
      rLive++;
      const e = 1 - (1 - u) ** 3, a = 0.35 * (1 - u) ** 1.5;
      pa[w * 3] = n.x; pa[w * 3 + 1] = n.y; pa[w * 3 + 2] = n.z || 0;
      ca[w * 3] = rCol[k * 3] * a; ca[w * 3 + 1] = rCol[k * 3 + 1] * a; ca[w * 3 + 2] = rCol[k * 3 + 2] * a;
      sa[w] = 30 + 420 * e; ka[w] = 2;
      w++;
    }
    if (!fLive && !rLive && !hubsDirty && sig === lastSig && w === lastW) return;   // idle: nothing to upload
    hubsDirty = false; lastSig = sig; lastW = w;
    geo.setDrawRange(0, w);
    for (let i = 0; i < 4; i++) {
      const at = ptsAttrs[i];
      if (at.addUpdateRange) { at.clearUpdateRanges(); at.addUpdateRange(0, Math.max(w, 1) * at.itemSize); }
      at.needsUpdate = true;
    }
    if (window.Bloom && Bloom.poke) Bloom.poke();      // idle-gated bloom must re-render the changed glow
  }
  function removeFlash() {
    if (!pts) return;
    if (g) g.scene().remove(pts);
    pts.geometry.dispose(); pts.material.dispose();
    pts = null; ptsAttrs = null; fNode = null; fLive = 0; rNode = null; rLive = 0;
  }

  /* ---------- HUD: play/pause, restart, speed, loop, date + count ---------- */
  function buildHud() {
    if (!document.createElement || !document.body) return;
    hud = document.createElement('div'); hud.id = 'genesis-hud';
    hud.style.cssText = 'position:fixed;top:calc(var(--hdr-h,73px) + 12px);left:50%;transform:translateX(-50%);z-index:9;display:flex;' +
      'align-items:center;gap:8px;padding:6px 10px;background:var(--bg-panel);border:1px solid var(--line-strong);border-radius:8px;' +
      'color:var(--text);font:11px var(--font-mono,monospace);white-space:nowrap';
    const btn = 'background:transparent;border:1px solid var(--line);color:inherit;font:inherit;padding:2px 8px;border-radius:5px;cursor:pointer';
    hud.innerHTML = `<b style="color:var(--accent-ink,var(--green));letter-spacing:.08em">GENESIS</b>
      <button data-g="play" style="${btn}" title="play / pause the replay"></button>
      <button data-g="restart" style="${btn}" title="restart from the first node" aria-label="restart from the first node">⏮</button>
      <button data-g="speed" style="${btn}" title="replay speed"></button>
      <button data-g="loop" style="${btn}" title="loop at now"></button>
      <span data-g="date" style="min-width:86px;text-align:center"></span>
      <span data-g="count" style="color:var(--dim)"></span>
      <span style="width:110px;height:3px;background:var(--line);border-radius:2px;overflow:hidden"><i data-g="bar" style="display:block;height:100%;width:0;background:var(--green)"></i></span>`;
    hudEl = {};
    hud.querySelectorAll('[data-g]').forEach((e) => { hudEl[e.dataset.g] = e; });
    hudEl.play.onclick = () => {
      if (st.done && !st.playing) { restart(performance.now()); st.playing = true; }
      else st.playing = !st.playing;
      lastFit = 0; paintHud(); if (st.playing) start();
    };
    hudEl.restart.onclick = () => { st.playing = true; restart(performance.now()); paintHud(); start(); };
    hudEl.speed.onclick = () => { st.speed = SPEEDS[(SPEEDS.indexOf(st.speed) + 1) % SPEEDS.length]; paintHud(); };
    hudEl.loop.onclick = () => {
      st.loop = !st.loop;
      // loop switched on after the replay ended: start the next pass now (the HOLD_MS pause is only
      // between automatic passes) so the click visibly does something
      if (st.loop && st.done) { st.playing = true; restart(performance.now()); lastFit = 0; start(); }
      paintHud();
    };
    document.body.appendChild(hud);
    paintHud();
  }
  function paintHud() {
    if (!hud || !st) return;
    hudEl.play.textContent = st.playing ? '⏸' : '▶';
    hudEl.speed.textContent = st.speed + '×';
    // loop reads as a real toggle: filled pill + icon when on (a text-colour change alone was invisible)
    const on = !!st.loop, L = hudEl.loop;
    L.textContent = on ? '↻ loop on' : '↻ loop';
    L.setAttribute('aria-pressed', on ? 'true' : 'false');
    L.style.background = on ? 'var(--green)' : 'transparent';
    L.style.borderColor = on ? 'var(--green)' : 'var(--line)';
    L.style.color = on ? 'var(--bg)' : 'var(--dim)';
    L.style.fontWeight = on ? '600' : '';
    hudEl.date.textContent = fmt(st.t) + (st.done ? (on && st.playing ? ' · looping…' : ' · now') : '');
    hudEl.count.textContent = nb + ' / ' + order.length + ' nodes';
    hudEl.bar.style.width = (100 * (st.t - st.lo) / span()).toFixed(1) + '%';
  }
  function removeHud() { if (hud) { hud.remove(); hud = null; hudEl = null; } }

  /* ---------- mode contract ---------- */
  function layout() { return new Map(); }              // nothing pinned: the force layout runs

  function enter(graph, data, c) {
    g = graph; ctx = c;
    graph.cooldownTicks(Infinity);                     // forces back on (framework zeroed them for fixed layouts)
    const now = performance.now();
    if (!st) {
      const still = !!(window.matchMedia && matchMedia('(prefers-reduced-motion: reduce)').matches);
      st = { t: 0, lo: 0, hi: 0, playing: !still, speed: 1, loop: false, done: false, seeded: new Set() };
      origIds = new Set(data.nodes.map((n) => n.id));
      full = shown = null;
    }
    buildFlash();
    if (window.Instanced3d && Instanced3d.setMod) Instanced3d.setMod(MOD);   // live-degree radii + edge tint
    if (data !== shown || !full) {                     // fresh start, or the app swapped graphData: re-derive + resume
      const fresh = !full;
      prepare(data);
      if (fresh && !st.seeded.size) { st.lo = st.t = minT; st.hi = maxT; lastT = -Infinity; }
      else {                                           // clock is global: never rewound / cut short by a filter
        st.lo = Math.min(st.lo, minT); st.hi = Math.max(st.hi, maxT);
        if (st.done) st.t = st.hi;                     // replay over: show every matching node, newer ones too
        lastT = st.t;                                  // resumed links are not newborn: no glow burst
      }
      advance(now, true);
    }
    buildHud();
    if (st.playing || fLive) start();
  }

  function exit() {
    stop(); removeHud(); removeFlash(); looseCharge(false);
    // a data swap / theme rebuild re-enters right after (viewMode still genesis): keep the replay state
    const leaving = !ctx || ctx.getSettings().viewMode !== 'genesis';
    if (leaving && st) {
      if (window.Instanced3d && Instanced3d.setMod) Instanced3d.setMod(null);   // Graph radii + edge colours (restoreFull rebuilds)
      if (g && full && shown && g.graphData() === shown) restoreFull();
      st = null; full = shown = null; order = []; lorder = []; birth = lbirth = null; adj = null; nb = nl = 0; origIds = null;
      byId = null; lWall = lBase = lAttr = null; hubCount = 0; hubN.fill(null); maxDeg = 0;
    }
    g = null;
  }

  // leaving: swap the full node set back. The framework then restores every snapshotted position; the
  // swap restarts the sim at alpha 1, so stop it on its first frame (cooldownTime -1) unless nodes the
  // snapshot never saw arrived mid-mode — those need the framework's reheat to be placed.
  function restoreFull() {
    const gg = g, known = full.nodes.every((n) => origIds && origIds.has(n.id));
    const prev = known && gg.cooldownTime ? gg.cooldownTime() : null;
    if (prev != null) gg.cooldownTime(-1);            // -1, not 0: elapsed can be 0 ms on the first frame
    gg.graphData(full);
    if (prev != null) setTimeout(() => requestAnimationFrame(() => requestAnimationFrame(() => {
      if (gg.cooldownTime() === -1) gg.cooldownTime(prev);
    })), 50);
    if (window.Instanced3d) Instanced3d.rebuild();
  }

  function debug() {
    return {
      visible: shown ? shown.nodes.length : 0, visibleLinks: shown ? shown.links.length : 0,
      total: full ? full.nodes.length : 0, totalLinks: lorder.length,
      replayTime: st ? st.t : null, replayDate: st && fin(st.t) && full ? new Date(st.t).toISOString() : null,
      playing: !!(st && st.playing), done: !!(st && st.done), speed: st ? st.speed : null, loop: !!(st && st.loop),
      progress: st && full ? (st.t - st.lo) / span() : 0, startTime: minT, endTime: maxT, batches, flashes: fLive, physicsTicksPerBatch: ticks,
      maxDegree: maxDeg, hubs: hubCount, topHub: hubCount ? hubN[0].id : null, rings: rLive, glowingLinks: Math.max(nl - lgFrom, 0),
      fxPoints: pts ? pts.geometry.drawRange.count : 0,
    };
  }

  window.Modes.register('genesis', { allowsDrag: true, layout, enter, exit, debug });
})();
