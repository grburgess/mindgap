/* mindgap 3D selective bloom — only the starfield and the biggest hub nodes glow, so the
   effect reads as bright objects bleeding light WITHOUT washing the whole frame in haze (which a
   plain full-screen UnrealBloomPass does on a scene of hundreds of mid-bright nodes). Exposes
   window.Bloom. THREE from window.THREE; post-processing classes from window.__bloomAddons (both
   set by ESM shims in index.html). 3D-only.

   Technique (the standard three.js "selective unreal bloom"): a second, offscreen composer renders
   the scene with every NON-bloom object hidden, then UnrealBloomPass blooms what's left. A combine
   pass appended to 3d-force-graph's on-screen composer adds that bloom texture over the normal
   render. Objects opt in with userData.bloom === true (stars set it in starfield.js; hub node
   meshes are tagged here each frame).

   Perf (web-perf loop): the offscreen bloom is HALF-RESOLUTION (a blur — the downscale is invisible,
   ~4x cheaper) and IDLE-GATED — the expensive per-frame work (tagHubs + full scene.traverse to hide
   non-bloom objects + the second render) only runs when the camera or a hub node has actually moved
   since the last bloom render; otherwise the bloomTexture uniform still holds the last glow and the
   combine reuses it. On a settled, still 5k-node scene this drops bloom's per-frame cost to ~0. */
'use strict';
(function () {
  let graph = null, ctx = null, warned = false, retry = 0, built = false;
  let bloomComposer = null, bloomPass = null, combinePass = null;
  let onResize = null, hubIds = new Set();
  let hubObjs = [];                     // live THREE objs of the current hub nodes (for the idle-gate)
  let lastCamSig = null, lastHubSig = null;
  const hidden = [];
  const HUBS = 28;                      // how many top-degree nodes glow
  const STRENGTH = 0.95, RADIUS = 0.55; // bloom look (threshold 0 — only bloom objects are visible)
  const BS = 0.5;                       // bloom render scale — half-res is invisible on a blur, ~4x cheaper

  function on() { return !!(ctx && ctx.getSettings().bloom); }
  function addons() { return window.__bloomAddons || null; }

  function bloomable(o) { return o.userData && o.userData.bloom === true; }
  function hideNonBloom(o) {
    if ((o.isMesh || o.isPoints || o.isSprite || o.isLine) && o.visible && !bloomable(o)) {
      hidden.push(o); o.visible = false;
    }
  }
  function restoreHidden() { for (let i = 0; i < hidden.length; i++) hidden[i].visible = true; hidden.length = 0; }

  function computeHubs() {                // the HUBS highest-degree nodes are the ones that glow
    const nodes = graph.graphData().nodes.slice();
    nodes.sort((a, b) => (b._deg || 0) - (a._deg || 0));
    hubIds = new Set(nodes.slice(0, HUBS).map((n) => n.id));
  }
  function tagHubs() {                     // node THREE objects are created lazily by the lib; tag each frame
    hubObjs.length = 0;
    for (const n of graph.graphData().nodes) {
      const o = n.__threeObj; if (!o) continue;
      const b = hubIds.has(n.id);
      o.userData.bloom = b;
      if (b) hubObjs.push(o);
    }
  }

  function add() {
    const A = addons(), T = window.THREE;
    if (!A || !T) {                       // ESM shim not ready yet — retry briefly
      if (retry++ < 20) return void setTimeout(() => { if (graph && on()) add(); }, 100);
      if (!warned) { console.warn('[Bloom] post-processing addons unavailable'); warned = true; }
      return;
    }
    if (built) return;
    const comp = graph.postProcessingComposer(); if (!comp) return;
    const renderer = graph.renderer(), scene = graph.scene(), camera = graph.camera();
    const dom = renderer.domElement;
    const W = dom.clientWidth || 1, H = dom.clientHeight || 1;
    const bw = Math.max(1, Math.round(W * BS)), bh = Math.max(1, Math.round(H * BS));

    bloomComposer = new A.EffectComposer(renderer);
    bloomComposer.renderToScreen = false;
    bloomComposer.setSize(bw, bh);        // half-res offscreen bloom target
    bloomComposer.addPass(new A.RenderPass(scene, camera));
    bloomPass = new A.UnrealBloomPass(new T.Vector2(bw, bh), STRENGTH, RADIUS, 0.0);
    bloomComposer.addPass(bloomPass);

    combinePass = new A.ShaderPass(new T.ShaderMaterial({
      uniforms: { baseTexture: { value: null }, bloomTexture: { value: bloomComposer.renderTarget2.texture } },
      vertexShader: 'varying vec2 vUv; void main(){ vUv = uv; gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0); }',
      fragmentShader: 'uniform sampler2D baseTexture; uniform sampler2D bloomTexture; varying vec2 vUv;'
        + 'void main(){ gl_FragColor = texture2D(baseTexture, vUv) + texture2D(bloomTexture, vUv); }',
    }), 'baseTexture');
    combinePass.needsSwap = true;

    // Before the additive combine runs, render the selective bloom offscreen: hide every non-bloom
    // object, render bloomComposer (so only stars + hub meshes are present), then restore. IDLE-GATED:
    // the tagHubs + traverse + second render only fire when the camera or a hub node moved since the
    // last bloom render — otherwise the bloomTexture uniform still holds the last glow, so the combine
    // (baseRender) reuses it unchanged and a still scene costs ~nothing.
    const baseRender = A.ShaderPass.prototype.render;
    const camSig = () => { const p = camera.position, q = camera.quaternion; return p.x + ',' + p.y + ',' + p.z + '|' + q.x + ',' + q.y + ',' + q.z + ',' + q.w; };
    // hub signature reads node DATA (x/y/z), not __threeObj.position: the lib only copies data into
    // its (empty, instanced-mode) node objects on engine ticks, and kinematic drags move data WITHOUT
    // ticking — an object-position sig stays constant through a drag, the gate skips the re-render,
    // and the stale bloomTexture leaves a glow ghost at the hub's old position until the camera moves.
    const hubSig = () => {
      let s = '';
      const ns = graph.graphData().nodes;
      for (let i = 0; i < ns.length; i++) { const n = ns[i]; if (hubIds.has(n.id)) s += (n.x | 0) + ',' + (n.y | 0) + ',' + ((n.z || 0) | 0) + ';'; }
      return s;
    };
    combinePass.render = function (rndr, writeBuffer, readBuffer, dt, mask) {
      const cs = camSig(), hs = hubSig();
      if (cs !== lastCamSig || hs !== lastHubSig) {
        lastCamSig = cs; lastHubSig = hs;
        tagHubs();
        scene.traverse(hideNonBloom);
        const bg = scene.background; scene.background = null;
        bloomComposer.render();
        scene.background = bg;
        restoreHidden();
      }
      baseRender.call(this, rndr, writeBuffer, readBuffer, dt, mask);
    };
    comp.addPass(combinePass);

    onResize = () => {
      const w = Math.max(1, Math.round((dom.clientWidth || 1) * BS)), h = Math.max(1, Math.round((dom.clientHeight || 1) * BS));
      bloomComposer.setSize(w, h); bloomPass.setSize(w, h);
      lastCamSig = null;                  // force a re-render at the new size
    };
    window.addEventListener('resize', onResize);
    built = true;
    computeHubs();
  }

  function remove() {
    if (graph && combinePass) { const comp = graph.postProcessingComposer(); if (comp && comp.removePass) comp.removePass(combinePass); }
    if (onResize) { window.removeEventListener('resize', onResize); onResize = null; }
    if (combinePass && combinePass.material) combinePass.material.dispose();
    if (bloomComposer) { try { bloomComposer.renderTarget1.dispose(); bloomComposer.renderTarget2.dispose(); } catch (e) {} }
    if (graph) { try { for (const n of graph.graphData().nodes) if (n.__threeObj) n.__threeObj.userData.bloom = false; } catch (e) {} }
    combinePass = null; bloomComposer = null; bloomPass = null; built = false;
    hubObjs.length = 0; lastCamSig = null; lastHubSig = null;
  }

  function install(g, context) {
    teardown(); graph = g; ctx = context; retry = 0;
    if (!window.THREE) { if (!warned) { console.warn('[Bloom] THREE unavailable'); warned = true; } return; }
    if (on()) add();
  }
  function teardown() { remove(); graph = null; ctx = null; }
  function refresh() { if (!graph) return; if (on()) { if (!built) add(); else { computeHubs(); lastCamSig = null; } } else remove(); }
  window.Bloom = { install, teardown, refresh };
})();
