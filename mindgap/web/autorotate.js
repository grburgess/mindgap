/* mindgap 3D auto-orbit — cinematic camera orbit with smart pause/resume. Exposes
   window.AutoRotate. Dependency-free of app internals: app.js passes a ctx of getters and the
   header button drives the autoRotate setting. THREE is read lazily from window.THREE (the ESM
   shim in index.html), same as glow3d/starfield. 3D-only. User interaction (drag/wheel) pauses
   the orbit; it resumes after IDLE_MS of no interaction. */
'use strict';
(function () {
  let graph = null, ctx = null, raf = 0, idleAt = 0, paused = false, warned = false;
  let dom = null, onDown = null, onWheel = null;
  const SPEED = (2 * Math.PI) / 40;   // rad/sec → ~40s per turn
  const IDLE_MS = 3000;

  function on() { return !!(ctx && ctx.getSettings().autoRotate); }

  function step(dtPrev) {
    if (!graph) { raf = 0; return; }
    raf = requestAnimationFrame(step);
    const now = performance.now();
    const dt = dtPrev ? (now - dtPrev) / 1000 : 0;
    if (paused && now >= idleAt) paused = false;     // idle elapsed → resume
    if (!paused && dt > 0) {
      const cam = graph.camera(), c = graph.controls();
      const t = c && c.target ? c.target : { x: 0, y: 0, z: 0 };
      const dx = cam.position.x - t.x, dz = cam.position.z - t.z;
      const ang = Math.atan2(dz, dx) + SPEED * dt;   // advance azimuth around target
      const rad = Math.hypot(dx, dz);
      cam.position.x = t.x + Math.cos(ang) * rad;
      cam.position.z = t.z + Math.sin(ang) * rad;
      cam.lookAt(t.x, t.y, t.z);
      if (c && c.update) c.update();
    }
    lastNow = now;
  }
  let lastNow = 0;
  function tick() { step(lastNow); }

  function bump() { paused = true; idleAt = performance.now() + IDLE_MS; }   // user interaction

  function start() {
    if (raf || !graph) return;
    dom = graph.renderer().domElement;
    onDown = bump; onWheel = bump;
    dom.addEventListener('pointerdown', onDown);
    dom.addEventListener('wheel', onWheel, { passive: true });
    lastNow = performance.now(); paused = false; tick();
  }
  function stop() {
    if (raf) { cancelAnimationFrame(raf); raf = 0; }
    if (dom && onDown) { dom.removeEventListener('pointerdown', onDown); dom.removeEventListener('wheel', onWheel); }
    dom = null; onDown = null; onWheel = null;
  }

  function install(g, context) {
    teardown(); graph = g; ctx = context;
    if (!window.THREE) { if (!warned) { console.warn('[AutoRotate] THREE unavailable'); warned = true; } return; }
    if (on()) start();
  }
  function teardown() { stop(); graph = null; ctx = null; }
  function refresh() { if (!graph) return; if (on()) start(); else stop(); }

  window.AutoRotate = { install, teardown, refresh };
})();
