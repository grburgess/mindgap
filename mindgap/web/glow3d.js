/* mindgap 3D topic glow — nebula orbs (Task 2). Exposes window.Glow3d.
   Dependency-free of app internals: app.js passes a small ctx of getters. THREE is read
   lazily from window.THREE (set by an ESM module shim in index.html) so classic-script load
   order is irrelevant — orbs are only built once the user is in 3D mode. */
'use strict';
(function () {
  let graph = null, ctx = null;
  let orbs = [];            // [{ sprite, idx, color, title, members }] one per drawn community
  let centroids = [];       // [{ idx, x, y, z, r, color, title, sprite }] refreshed each tick
  const texCache = new Map(); // color -> CanvasTexture (orb glow), reused across rebuilds
  let warned = false;
  let label = null;        // shared hover label sprite
  let onMove = null;       // bound pointermove handler
  let raf = 0;             // rAF throttle handle

  function THREE() { return window.THREE || null; }

  // ---- color helpers ----
  let _probe = null;
  function toRGB(color) {                          // any css color (hsl/hex/name) -> [r,g,b]
    _probe = _probe || document.createElement('canvas').getContext('2d');
    _probe.fillStyle = '#000'; _probe.fillStyle = color;          // canvas normalizes
    const c = _probe.fillStyle;
    if (c[0] === '#') return [parseInt(c.slice(1, 3), 16), parseInt(c.slice(3, 5), 16), parseInt(c.slice(5, 7), 16)];
    return c.match(/\d+/g).map(Number).slice(0, 3);
  }
  function orbTexture(color) {
    if (texCache.has(color)) return texCache.get(color);
    const [r, g, b] = toRGB(color);
    const s = 128, cv = document.createElement('canvas'); cv.width = cv.height = s;
    const cx = cv.getContext('2d');
    const grad = cx.createRadialGradient(s / 2, s / 2, 0, s / 2, s / 2, s / 2);
    grad.addColorStop(0.0, `rgba(${r},${g},${b},0.55)`);
    grad.addColorStop(0.4, `rgba(${r},${g},${b},0.16)`);
    grad.addColorStop(1.0, `rgba(${r},${g},${b},0.0)`);
    cx.fillStyle = grad; cx.fillRect(0, 0, s, s);
    const tex = new (THREE().CanvasTexture)(cv); tex.needsUpdate = true;
    texCache.set(color, tex);
    return tex;
  }

  // ---- geometry: centroid + enclosing radius of finite members, outliers dropped ----
  // returns null if < 2 members or spatially incoherent (median radius > linkDist*6), matching 2D drawHulls.
  function trimmedSphere(members, byId, linkDist) {
    const pts = [];
    for (const id of members) { const n = byId.get(id); if (n && Number.isFinite(n.x) && Number.isFinite(n.y)) pts.push(n); }
    if (pts.length < 2) return null;
    let cx = 0, cy = 0, cz = 0;
    for (const p of pts) { cx += p.x; cy += p.y; cz += (p.z || 0); }
    cx /= pts.length; cy /= pts.length; cz /= pts.length;
    const dist = (p) => Math.hypot(p.x - cx, p.y - cy, (p.z || 0) - cz);
    const rs = pts.map(dist).sort((a, b) => a - b);
    const med = rs[Math.floor(rs.length / 2)] || 1;
    if (pts.length >= 3 && med > linkDist * 6) return null;
    let kept = pts;
    if (pts.length >= 5) { kept = pts.filter((p) => dist(p) <= med * 2.5); if (kept.length < 3) kept = pts; }
    let kx = 0, ky = 0, kz = 0;
    for (const p of kept) { kx += p.x; ky += p.y; kz += (p.z || 0); }
    kx /= kept.length; ky /= kept.length; kz /= kept.length;
    let r = 0;
    for (const p of kept) r = Math.max(r, Math.hypot(p.x - kx, p.y - ky, (p.z || 0) - kz));
    return { x: kx, y: ky, z: kz, r: r + 12 };
  }

  // ---- gating ----
  function orbsGated() {
    if (!ctx) return false;
    const s = ctx.getSettings(), C = ctx.getClusters();
    return !!(C && s.colorBy === 'community' && s.showHulls);
  }

  // ---- build / clear ----
  function nodeMap() { const m = new Map(); for (const n of graph.graphData().nodes) m.set(n.id, n); return m; }
  function clearOrbs() {
    if (graph) for (const o of orbs) { graph.scene().remove(o.sprite); o.sprite.material.dispose(); }
    orbs = []; centroids = [];
  }
  function buildOrbs() {
    const T = THREE(); if (!T || !graph || !ctx) return;
    clearOrbs();
    const C = ctx.getClusters(); if (!C) return;
    for (const c of C.communities) {
      if (c.size < 2) continue;
      const mat = new T.SpriteMaterial({ map: orbTexture(c.color), blending: T.AdditiveBlending, depthWrite: false, transparent: true, opacity: 0.4 });
      const sp = new T.Sprite(mat);
      sp.visible = false;                      // until first valid tick
      sp.userData.idx = c.idx;
      graph.scene().add(sp);
      orbs.push({ sprite: sp, idx: c.idx, color: c.color, title: c.hubTitle, members: c.members });
    }
  }

  // ---- position-dirty rAF sync ----
  // Orbs used to reposition on graph.onEngineTick only, but kinematic node drags
  // (instanced3d / the 2D frozen-forces drag) move nodes WITHOUT ticking the engine, so the
  // nebula hung behind as a ghost until the next tick/refresh. Mirror instanced3d's dirty
  // pattern instead: a cheap O(N) position checksum each frame gates the real tick() work.
  let posRaf = 0, lastPosSum = NaN;
  function posChecksum() {
    const ns = graph.graphData().nodes;
    let s = 0;
    for (let i = 0; i < ns.length; i++) { const n = ns[i]; s = s * 1.0000001 + (n.x || 0) + 1.31 * (n.y || 0) + 1.77 * (n.z || 0); }
    return s;
  }
  function posLoop() {
    if (!graph) { posRaf = 0; return; }
    posRaf = requestAnimationFrame(posLoop);
    if (document.hidden || !orbs.length) return;
    const s = posChecksum();
    if (s !== lastPosSum) { lastPosSum = s; tick(); }
  }

  // ---- per-tick update ----
  function tick() {
    if (!graph || !ctx || !orbs.length) { centroids = []; return; }
    const on = orbsGated();
    const s = ctx.getSettings();
    const byId = nodeMap();
    centroids = [];
    for (const o of orbs) {
      if (!on) { o.sprite.visible = false; continue; }
      const sph = trimmedSphere(o.members, byId, s.linkDist);
      if (!sph) { o.sprite.visible = false; continue; }
      o.sprite.position.set(sph.x, sph.y, sph.z);
      const d = sph.r * 1.5;
      o.sprite.scale.set(d, d, 1);
      o.sprite.visible = true;
      centroids.push({ idx: o.idx, x: sph.x, y: sph.y, z: sph.z, r: sph.r, color: o.color, title: o.title, sprite: o.sprite });
    }
  }

  // ---- hover label ----
  function roundRect(g, x, y, w, h, r) {
    g.beginPath();
    g.moveTo(x + r, y); g.arcTo(x + w, y, x + w, y + h, r); g.arcTo(x + w, y + h, x, y + h, r);
    g.arcTo(x, y + h, x, y, r); g.arcTo(x, y, x + w, y, r); g.closePath();
  }
  function labelTexture(text, color) {
    text = text.length > 34 ? text.slice(0, 33) + '…' : text;   // glanceable chip, not a banner
    const font = 30, pad = 10;
    const meas = document.createElement('canvas').getContext('2d');
    meas.font = `700 ${font}px 'Bricolage Grotesque', sans-serif`;
    const w = Math.ceil(meas.measureText(text).width) + pad * 2, h = font + pad * 2;
    const cv = document.createElement('canvas'); cv.width = w; cv.height = h;
    const g = cv.getContext('2d');
    g.font = `700 ${font}px 'Bricolage Grotesque', sans-serif`;
    g.textAlign = 'center'; g.textBaseline = 'middle';
    g.fillStyle = 'rgba(8,12,10,0.6)'; roundRect(g, 0, 0, w, h, 10); g.fill();   // dark plate for legibility
    g.fillStyle = color; g.fillText(text, w / 2, h / 2);
    const tex = new (THREE().CanvasTexture)(cv); tex.needsUpdate = true;
    return { tex, w, h };
  }
  function showLabelFor(cen) {
    const T = THREE();
    const { tex, w, h } = labelTexture(cen.title || '', cen.color);
    if (!label) {
      label = new T.Sprite(new T.SpriteMaterial({ map: tex, depthWrite: false, transparent: true }));
      graph.scene().add(label);
    } else {
      if (label.material.map) label.material.map.dispose();
      label.material.map = tex; label.material.needsUpdate = true;
    }
    // size by camera distance so the label keeps a consistent, readable on-screen size
    // regardless of cluster radius or zoom; width follows the (truncated) text aspect.
    const cam = graph.camera();
    const D = Math.hypot(cam.position.x - cen.x, cam.position.y - cen.y, cam.position.z - cen.z);
    const hWorld = Math.max(D * 0.075, 8);
    label.scale.set(hWorld * (w / h), hWorld, 1);
    label.position.set(cen.x, cen.y + cen.r * 0.3 + hWorld, cen.z);
    label.visible = true;
  }
  function hideLabel() { if (label) label.visible = false; }
  function onPointerMove(ev) {
    if (raf) return;
    raf = requestAnimationFrame(() => {
      raf = 0;
      const T = THREE(); if (!T || !graph || !ctx) return;
      const s = ctx.getSettings();
      if (!orbsGated() || !s.showClusterLabels || !centroids.length) { hideLabel(); return; }
      const dom = graph.renderer().domElement, rect = dom.getBoundingClientRect();
      const m = new T.Vector2(
        ((ev.clientX - rect.left) / rect.width) * 2 - 1,
        -((ev.clientY - rect.top) / rect.height) * 2 + 1);
      const rc = new T.Raycaster();
      rc.setFromCamera(m, graph.camera());
      const sprites = centroids.map((c) => c.sprite);
      const hits = rc.intersectObjects(sprites, false);
      if (!hits.length) { hideLabel(); return; }
      let best = null;                          // nearest hit; tie-break smallest orb (most specific)
      for (const hit of hits) {
        const cen = centroids.find((c) => c.sprite === hit.object);
        if (!cen) continue;
        if (!best || hit.distance < best.dist - 1e-3 ||
            (Math.abs(hit.distance - best.dist) <= 1e-3 && cen.r < best.cen.r)) best = { dist: hit.distance, cen };
      }
      if (best) showLabelFor(best.cen); else hideLabel();
    });
  }

  // ---- lifecycle ----
  function install(g, context) {
    teardown();
    graph = g; ctx = context;
    const T = THREE();
    if (!T) { if (!warned) { console.warn('[Glow3d] window.THREE unavailable — 3D topic glow disabled'); warned = true; } return; }
    buildOrbs();
    onMove = onPointerMove;
    graph.renderer().domElement.addEventListener('pointermove', onMove);
    tick();                                    // initial placement attempt
    lastPosSum = NaN;                          // force first posLoop pass to re-tick
    if (!posRaf) posLoop();                    // dirty-gated sync (covers engine ticks AND kinematic drags)
  }
  function teardown() {
    if (graph && onMove) { try { graph.renderer().domElement.removeEventListener('pointermove', onMove); } catch (e) {} }
    onMove = null; if (raf) { cancelAnimationFrame(raf); raf = 0; }
    if (posRaf) { cancelAnimationFrame(posRaf); posRaf = 0; }
    if (graph) {
      clearOrbs();
      if (label) { graph.scene().remove(label); if (label.material.map) label.material.map.dispose(); label.material.dispose(); label = null; }
    }
    // posLoop is cancelled above (and self-exits on graph=null); tick() guards on orbs.length.
    graph = null; ctx = null;
  }
  function refresh() {
    if (!graph || !ctx || !THREE()) return;
    if (!orbsGated()) { clearOrbs(); return; }
    buildOrbs();
    tick();
  }

  window.Glow3d = { install, teardown, refresh };
})();
