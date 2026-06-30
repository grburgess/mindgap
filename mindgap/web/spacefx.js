/* mindgap ambient space life — a faint flattened "galactic" dust band that is re-centred on
   the camera every frame (so it always sits far behind the graph and can never wash the foreground)
   plus an occasional comet that streaks across with a fading tail. Exposes window.SpaceFx. THREE is
   read lazily from window.THREE (the ESM shim in index.html), same as starfield/glow3d. 3D-only. */
'use strict';
(function () {
  let graph = null, ctx = null, band = null, comet = null, raf = 0, warned = false;
  let next = 0, flight = null, dir = null;
  const TAIL = 16;
  function on() { return !!(ctx && ctx.getSettings().ambient); }

  // soft round sprite so band points read as overlapping dust, not hard pixels
  let softTex = null;
  function softDot(T) {
    if (softTex) return softTex;
    const s = 64, cv = document.createElement('canvas'); cv.width = cv.height = s;
    const g = cv.getContext('2d');
    const grad = g.createRadialGradient(s / 2, s / 2, 0, s / 2, s / 2, s / 2);
    grad.addColorStop(0.0, 'rgba(255,255,255,1)');
    grad.addColorStop(1.0, 'rgba(255,255,255,0)');
    g.fillStyle = grad; g.fillRect(0, 0, s, s);
    softTex = new T.CanvasTexture(cv); softTex.needsUpdate = true;
    return softTex;
  }

  // ---- faint flattened band of soft dust, far out, recentred on the camera each frame so it reads
  //      as a distant celestial band and can never cover the foreground graph ----
  function buildBand(T) {
    const N = 620, rMin = 1700, rMax = 3600;
    const pos = new Float32Array(N * 3);
    for (let i = 0; i < N; i++) {
      const a = Math.random() * Math.PI * 2;
      const r = rMin + Math.random() * (rMax - rMin);
      pos[i * 3]     = Math.cos(a) * r;
      pos[i * 3 + 1] = (Math.random() - 0.5) * 340;        // thin in y => a band, not a full sphere
      pos[i * 3 + 2] = Math.sin(a) * r;
    }
    const geo = new T.BufferGeometry();
    geo.setAttribute('position', new T.BufferAttribute(pos, 3));
    const mat = new T.PointsMaterial({
      map: softDot(T), color: 0x9fb6e0, size: 22, sizeAttenuation: false,
      transparent: true, opacity: 0.055, depthWrite: false, blending: T.AdditiveBlending,
    });
    band = new T.Points(geo, mat);
    band.frustumCulled = false; band.renderOrder = -20; band.rotation.z = 0.5;   // tilt off-horizontal
    graph.scene().add(band);
  }

  // ---- comet: a short bright dotted streak (bright head -> dim tail), screen-constant size so it
  //      stays visible at any distance; crosses the field occasionally ----
  function buildComet(T) {
    const pos = new Float32Array(TAIL * 3), col = new Float32Array(TAIL * 3);
    for (let i = 0; i < TAIL; i++) { const f = (1 - i / TAIL); col[i * 3] = col[i * 3 + 1] = col[i * 3 + 2] = f; }
    const geo = new T.BufferGeometry();
    geo.setAttribute('position', new T.BufferAttribute(pos, 3));
    geo.setAttribute('color', new T.BufferAttribute(col, 3));
    const mat = new T.PointsMaterial({
      map: softDot(T), size: 7, sizeAttenuation: false, vertexColors: true,
      transparent: true, opacity: 0, depthWrite: false, blending: T.AdditiveBlending,
    });
    comet = new T.Points(geo, mat);
    comet.frustumCulled = false; comet.renderOrder = -5;
    graph.scene().add(comet);
  }

  function build() {
    const T = window.THREE; if (!T || !graph) return;
    buildBand(T); buildComet(T);
    next = performance.now() + 1500;        // first comet shortly after mount
  }
  function clear() {
    if (graph && band) { graph.scene().remove(band); band.geometry.dispose(); band.material.dispose(); }
    if (graph && comet) { graph.scene().remove(comet); comet.geometry.dispose(); comet.material.dispose(); }
    band = null; comet = null; flight = null;
  }

  function spawn(now) {                       // straight path across the near field through the origin
    const R = 1600, a = Math.random() * Math.PI * 2;
    const from = { x: Math.cos(a) * R, y: (Math.random() - 0.5) * 900, z: Math.sin(a) * R };
    const to   = { x: -from.x, y: (Math.random() - 0.5) * 900, z: -from.z };
    const dx = to.x - from.x, dy = to.y - from.y, dz = to.z - from.z, L = Math.hypot(dx, dy, dz) || 1;
    dir = { x: dx / L, y: dy / L, z: dz / L };
    flight = { from, to, t0: now, dur: 1500 + Math.random() * 1200 };
  }

  function loop() {
    if (!comet) { raf = 0; return; }
    raf = requestAnimationFrame(loop);
    const now = performance.now();
    if (band && graph) { const c = graph.camera().position; band.position.set(c.x, c.y, c.z); }  // keep band a distant backdrop
    if (!flight && now >= next) spawn(now);
    if (flight) {
      const e = (now - flight.t0) / flight.dur;
      if (e >= 1) { flight = null; comet.material.opacity = 0; next = now + 7000 + Math.random() * 9000; }
      else {
        const hx = flight.from.x + (flight.to.x - flight.from.x) * e;
        const hy = flight.from.y + (flight.to.y - flight.from.y) * e;
        const hz = flight.from.z + (flight.to.z - flight.from.z) * e;
        const p = comet.geometry.attributes.position.array, S = 26;   // world-space tail spacing
        for (let i = 0; i < TAIL; i++) {
          p[i * 3]     = hx - dir.x * i * S;
          p[i * 3 + 1] = hy - dir.y * i * S;
          p[i * 3 + 2] = hz - dir.z * i * S;
        }
        comet.geometry.attributes.position.needsUpdate = true;
        comet.material.opacity = Math.sin(e * Math.PI) * 0.95;        // ease in/out
      }
    }
  }

  function install(g, context) {
    teardown(); graph = g; ctx = context;
    if (!window.THREE) { if (!warned) { console.warn('[SpaceFx] THREE unavailable'); warned = true; } return; }
    if (on()) { build(); if (!raf) raf = requestAnimationFrame(loop); }
  }
  function teardown() { if (raf) { cancelAnimationFrame(raf); raf = 0; } clear(); graph = null; ctx = null; }
  function refresh() {
    if (!graph) return;
    if (on()) { if (!band) { build(); if (!raf) raf = requestAnimationFrame(loop); } }
    else { if (raf) { cancelAnimationFrame(raf); raf = 0; } clear(); }
  }
  window.SpaceFx = { install, teardown, refresh };
})();
