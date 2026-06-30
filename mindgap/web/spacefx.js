/* mindgap ambient space life (Task 6) — a faint galactic dust band far behind the stars
   plus an occasional comet streaking across the far field. Exposes window.SpaceFx. THREE is read
   lazily from window.THREE (the ESM shim in index.html), same as starfield/glow3d. 3D-only. */
'use strict';
(function () {
  let graph = null, ctx = null, band = null, comet = null, raf = 0, warned = false;
  let next = 0, flight = null;                       // comet scheduling/state
  function on() { return !!(ctx && ctx.getSettings().ambient); }

  function bandTexture(T) {                          // soft dusty smear
    const s = 256, cv = document.createElement('canvas'); cv.width = cv.height = s;
    const g = cv.getContext('2d');
    const grad = g.createLinearGradient(0, s * 0.5, s, s * 0.5);
    grad.addColorStop(0.0, 'rgba(90,120,160,0)');
    grad.addColorStop(0.5, 'rgba(150,170,210,0.10)');
    grad.addColorStop(1.0, 'rgba(90,120,160,0)');
    g.fillStyle = grad; g.fillRect(0, s * 0.30, s, s * 0.40);
    const tex = new T.CanvasTexture(cv); tex.needsUpdate = true; return tex;
  }
  function build() {
    const T = window.THREE; if (!T || !graph) return;
    band = new T.Mesh(new T.PlaneGeometry(9000, 9000),
      new T.MeshBasicMaterial({ map: bandTexture(T), transparent: true, opacity: 0.5, depthWrite: false, blending: T.AdditiveBlending }));
    band.rotation.x = -Math.PI / 2.4; band.renderOrder = -20; band.frustumCulled = false;
    graph.scene().add(band);
    const cg = new T.BufferGeometry(); cg.setAttribute('position', new T.BufferAttribute(new Float32Array(3), 3));
    comet = new T.Points(cg, new T.PointsMaterial({ color: 0xffffff, size: 9, transparent: true, opacity: 0, depthWrite: false, blending: T.AdditiveBlending }));
    comet.frustumCulled = false; comet.renderOrder = -5; graph.scene().add(comet);
    next = performance.now() + 2000;
  }
  function clear() {
    if (graph && band) { graph.scene().remove(band); band.geometry.dispose(); band.material.map.dispose(); band.material.dispose(); }
    if (graph && comet) { graph.scene().remove(comet); comet.geometry.dispose(); comet.material.dispose(); }
    band = null; comet = null; flight = null;
  }
  function spawn(now) {                               // random straight path across the far field
    const R = 2600, a = Math.random() * Math.PI * 2;
    const from = { x: Math.cos(a) * R, y: (Math.random() - 0.5) * 1200, z: Math.sin(a) * R };
    const to   = { x: -from.x, y: (Math.random() - 0.5) * 1200, z: -from.z };
    flight = { from, to, t0: now, dur: 1600 + Math.random() * 1400 };
  }
  function loop() {
    if (!comet) { raf = 0; return; }
    raf = requestAnimationFrame(loop);
    const now = performance.now();
    if (!flight && now >= next) spawn(now);
    if (flight) {
      const e = (now - flight.t0) / flight.dur;
      if (e >= 1) { flight = null; comet.material.opacity = 0; next = now + 6000 + Math.random() * 9000; }
      else {
        const p = comet.geometry.attributes.position.array;
        p[0] = flight.from.x + (flight.to.x - flight.from.x) * e;
        p[1] = flight.from.y + (flight.to.y - flight.from.y) * e;
        p[2] = flight.from.z + (flight.to.z - flight.from.z) * e;
        comet.geometry.attributes.position.needsUpdate = true;
        comet.material.opacity = Math.sin(e * Math.PI) * 0.9;   // fade in/out
      }
    }
  }
  function install(g, context) {
    teardown(); graph = g; ctx = context;
    if (!window.THREE) { if (!warned) { console.warn('[SpaceFx] THREE unavailable'); warned = true; } return; }
    if (on()) { build(); if (!raf) raf = requestAnimationFrame(loop); }
  }
  function teardown() { if (raf) { cancelAnimationFrame(raf); raf = 0; } clear(); graph = null; ctx = null; }
  function refresh() { if (!graph) return; if (on()) { if (!band) { build(); if (!raf) raf = requestAnimationFrame(loop); } } else { if (raf) { cancelAnimationFrame(raf); raf = 0; } clear(); } }
  window.SpaceFx = { install, teardown, refresh };
})();
