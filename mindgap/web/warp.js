/* mindgap 3D warp-on-focus — hyperspace streaks that flash when the camera dives to a node.
   Exposes window.Warp. Dependency-free of app internals: app.js passes a ctx of getters and calls
   Warp.trigger(node) at the centerOn() fly-to. THREE is read lazily from window.THREE (the ESM shim
   in index.html), same as glow3d/starfield. 3D-only. */
'use strict';
(function () {
  let graph = null, ctx = null, mesh = null, mat = null, raf = 0, t0 = 0, warned = false;
  const DUR = 800, N = 140;
  function on() { return !!(ctx && ctx.getSettings().warp); }

  function build() {
    const T = window.THREE; if (!T || !graph) return;
    const pos = new Float32Array(N * 6);            // N line segments (start,end) in clip-ish space
    for (let i = 0; i < N; i++) {
      const a = Math.random() * Math.PI * 2, r = 0.15 + Math.random() * 0.85;
      const x = Math.cos(a) * r, y = Math.sin(a) * r, len = 0.10 + Math.random() * 0.20;
      pos[i*6]   = x;            pos[i*6+1] = y;            pos[i*6+2] = 0;
      pos[i*6+3] = x * (1+len);  pos[i*6+4] = y * (1+len);  pos[i*6+5] = 0;
    }
    const geo = new T.BufferGeometry();
    geo.setAttribute('position', new T.BufferAttribute(pos, 3));
    mat = new T.LineBasicMaterial({ color: 0xcfe0ff, transparent: true, opacity: 0, blending: T.AdditiveBlending, depthTest: false, depthWrite: false });
    mesh = new T.LineSegments(geo, mat);
    mesh.frustumCulled = false; mesh.renderOrder = 50; mesh.visible = false;
    graph.scene().add(mesh);
  }
  function clear() { if (graph && mesh) { graph.scene().remove(mesh); mesh.geometry.dispose(); mat.dispose(); } mesh = null; mat = null; }

  function place() {                                 // pin the streak quad in front of the camera
    const cam = graph.camera();
    mesh.position.copy(cam.position);
    mesh.quaternion.copy(cam.quaternion);
    mesh.translateZ(-200);                           // just ahead of the near plane
    mesh.scale.setScalar(220);
  }
  function loop() {
    if (!mesh) { raf = 0; return; }
    const e = (performance.now() - t0) / DUR;
    if (e >= 1) { mesh.visible = false; mat.opacity = 0; raf = 0; return; }
    raf = requestAnimationFrame(loop);
    place();
    const env = Math.sin(Math.min(e, 1) * Math.PI);  // 0→1→0 envelope
    mat.opacity = 0.7 * env;
  }
  function trigger() {
    if (!on() || !mesh) return;
    t0 = performance.now(); mesh.visible = true;
    if (!raf) raf = requestAnimationFrame(loop);
  }

  function install(g, context) {
    teardown(); graph = g; ctx = context;
    if (!window.THREE) { if (!warned) { console.warn('[Warp] THREE unavailable'); warned = true; } return; }
    if (on()) build();
  }
  function teardown() { if (raf) { cancelAnimationFrame(raf); raf = 0; } clear(); graph = null; ctx = null; }
  function refresh() { if (!graph) return; if (on()) { if (!mesh) build(); } else { clear(); } }
  window.Warp = { install, teardown, refresh, trigger };
})();
