/* mindgap 3D bloom glow — UnrealBloomPass post-processing for the 3D view. Exposes
   window.Bloom. Dependency-free of app internals: app.js passes a small ctx of getters. THREE is
   read lazily from window.THREE and the post-processing classes from window.__bloomAddons (both
   set by ESM module shims in index.html) so classic-script load order is irrelevant. 3D-only. */
'use strict';
(function () {
  let graph = null, ctx = null, pass = null, warned = false, retry = 0;
  function on() { return !!(ctx && ctx.getSettings().bloom); }
  function addons() { return window.__bloomAddons || null; }

  function add() {
    const A = addons(), T = window.THREE;
    if (!A || !T) {                                  // shim not ready yet — retry briefly
      if (retry++ < 20) return void setTimeout(() => { if (graph && on()) add(); }, 100);
      if (!warned) { console.warn('[Bloom] post-processing addons unavailable'); warned = true; }
      return;
    }
    if (pass) return;
    const comp = graph.postProcessingComposer(); if (!comp) return;
    const dom = graph.renderer().domElement;
    const res = new T.Vector2(dom.clientWidth || 1, dom.clientHeight || 1);
    pass = new A.UnrealBloomPass(res, 0.6, 0.4, 0.2);   // strength, radius, threshold
    comp.addPass(pass);
  }
  function remove() {
    if (graph && pass) { const comp = graph.postProcessingComposer(); if (comp && comp.removePass) comp.removePass(pass); }
    if (pass && pass.dispose) pass.dispose();
    pass = null;
  }
  function install(g, context) {
    teardown(); graph = g; ctx = context; retry = 0;
    if (!window.THREE) { if (!warned) { console.warn('[Bloom] THREE unavailable'); warned = true; } return; }
    if (on()) add();
  }
  function teardown() { remove(); graph = null; ctx = null; }
  function refresh() { if (!graph) return; if (on()) add(); else remove(); }
  window.Bloom = { install, teardown, refresh };
})();
