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
  let hubComposer = null, hubPass = null, hubValid = false;   // neon high-glow: hubs-only compact bloom
  let onResize = null, hubIds = new Set();
  let hubObjs = [];                     // live THREE objs of the current hub nodes (for the idle-gate)
  let lastCamSig = null, lastHubSig = null;
  const hidden = [];
  const HUBS = 28;                      // how many top-degree nodes glow
  const STRENGTH = 0.95, RADIUS = 0.55; // bloom look at glow 0.5 (threshold 0 — only bloom objects are visible)
  const BS = 0.5;                       // bloom render scale — half-res is invisible on a blur, ~4x cheaper

  // Look → glow (settings.glow, 0..1). The combine pass stays live at EVERY glow: the composer path
  // renders the base frame darker than the plain renderer, so dropping the pass at glow 0 made 0
  // brighter than 0.25. Glow 0 just skips the offscreen bloom render and adds nothing (bk = 0).
  //   0..0.5: strength ramps 0 -> STRENGTH (0.5 = the original look, byte-for-byte).
  //   0.5..1 (u = 0..1): the bloom render stays at the 0.5 look (same strength/radius/threshold, same
  //     star + background lift) and the combine adds an EXTRA term on top:
  //       extra = x * h / (1 + max(h)/EXTRA_CAP) * (1 - luma(base + bloom))^2,   x = EXTRA_MAX·u
  //     h = soft-knee part of the bloom above EXTRA_T (knee EXTRA_K): faint star glow and the uniform
  //     background lift sit below it and gain nothing (no sky haze); the per-pixel cap bounds the add
  //     and the (1 - luma)^2 term fades it to 0 as a pixel nears white (no white-out core). The term
  //     does not depend on x, so extra >= 0 is linear in x: mean luminance only rises with glow and
  //     the base frame is never darkened.
  // comp (neon themes, glow-independent): their pastel/neon hubs sum to white sooner, so bloom rolls
  // off softly above 0.35 at every glow (monotone in the bloom value; unchanged at glow 0.5).
  // hue (themes with bloomHue, i.e. galaxy; glow-independent): dense pastel hubs must saturate toward
  // their colour, not white. The bloom's white component min(r,g,b) is cut by HUE_CUT (linear in the
  // bloom value, so still monotone in strength) and the roll-off knee drops 0.35 -> HUE_KNEE; the extra
  // term is tinted (its white component removed) and fades on the brightest CHANNEL, not luma, so it
  // stops before any channel clips — a clipped channel is what turns a hue core into a white smear.
  // extra stays >= 0 and linear in x. The tinted extra has no white component, so its headroom fade is
  // relaxed toward linear (ld^2 -> ld*mix(ld,1,HUE_LD)): hubs inside the bright filament core still glow
  // in their hue at glow 1. hue = 0 (every other theme): byte-identical to before.
  // hx (every neon theme, glow > 0.5 only): the extra term reads a SECOND, hubs-only bloom render
  // (hubTexture: hub spheres alone, stars hidden) whose mip weights favour the finest levels
  // (HUB_FACTORS), instead of the shared stars+hubs bloom at radius 0.55. So glow 1 adds compact light
  // ON the hubs (no wide smudge) and nothing to the stars (they keep their glow-0.5 look). The extra is
  // hue-preserving: its white component min(r,g,b) is cut in full and it fades on the brightest channel, so hubs
  // brighten toward their own saturated hue rather than toward a pastel haze. Still >= 0, linear in x.
  // Glow <= 0.5 and old themes (hx = 0) never touch this path.
  // Still SELECTIVE: only userData.bloom objects (hub spheres + stars) are in the bloom render.
  const EXTRA_MAX = 9.0, EXTRA_T = 0.15, EXTRA_K = 0.08, EXTRA_CAP = 0.35;
  const HUE_CUT = 0.6, HUE_KNEE = 0.22, HUE_LD = 0.7;
  const HUB_FACTORS = [1.0, 0.45, 0.12, 0.0, 0.0], HX_GAIN = 6.0, HX_LD = 1.0;
  function glow() { const g = ctx ? ctx.getSettings().glow : 0.5; return Number.isFinite(g) ? Math.min(Math.max(g, 0), 1) : 0.5; }
  function params() {
    const g = glow();
    const comp = ctx && ctx.isNeon && ctx.isNeon() ? 0.5 : 0;
    const hue = ctx && ctx.bloomHue ? Math.min(Math.max(+ctx.bloomHue() || 0, 0), 1) : 0;
    const hx = comp > 0 ? 1 : 0;
    if (g <= 0.5) return { strength: STRENGTH * (g / 0.5), comp, hue, hx, extra: 0 };
    return { strength: STRENGTH, comp, hue, hx, extra: EXTRA_MAX * (g - 0.5) / 0.5 };
  }
  function applyParams() {
    if (!bloomPass) return; const p = params();
    bloomPass.strength = p.strength;
    if (combinePass) { const u = combinePass.uniforms; u.bk.value = p.strength > 0 ? 1 : 0; u.comp.value = p.comp; u.hue.value = p.hue; u.hx.value = p.hx; u.extra.value = p.extra; }
  }
  function on() { return !!(ctx && ctx.getSettings().bloom); }
  function addons() { return window.__bloomAddons || null; }

  function bloomable(o) { return o.userData && o.userData.bloom === true; }
  function hideNonBloom(o) {
    if ((o.isMesh || o.isPoints || o.isSprite || o.isLine) && o.visible && !bloomable(o)) {
      hidden.push(o); o.visible = false;
    }
  }
  function hideNonHub(o) {                 // hubs-only render: stars (Points) hidden too
    if ((o.isMesh || o.isPoints || o.isSprite || o.isLine) && o.visible && (!bloomable(o) || o.isPoints)) {
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
    const P = params();
    bloomPass = new A.UnrealBloomPass(new T.Vector2(bw, bh), P.strength, RADIUS, 0.0);
    bloomComposer.addPass(bloomPass);

    const f = (x) => x.toFixed(4);
    combinePass = new A.ShaderPass(new T.ShaderMaterial({
      uniforms: { baseTexture: { value: null }, bloomTexture: { value: bloomComposer.renderTarget2.texture },
        bk: { value: 1 }, comp: { value: 0 }, hue: { value: 0 }, extra: { value: 0 },
        hubTexture: { value: null }, hx: { value: 0 } },
      vertexShader: 'varying vec2 vUv; void main(){ vUv = uv; gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0); }',
      // bk = 0 at glow 0 (no bloom). comp = 0 + extra = 0 (old themes, glow <= 0.5): plain base + bloom,
      // the original combine. comp > 0: neon roll-off. extra > 0 (glow > 0.5): capped add above the knee.
      // hx > 0 (neon, glow > 0.5): the extra comes from the hubs-only compact bloom, white component cut.
      fragmentShader: 'uniform sampler2D baseTexture; uniform sampler2D bloomTexture; uniform sampler2D hubTexture; uniform float bk; uniform float comp; uniform float hue; uniform float extra; uniform float hx; varying vec2 vUv;'
        + 'void main(){ vec4 base = texture2D(baseTexture, vUv); vec4 b0 = texture2D(bloomTexture, vUv) * bk; vec4 b = b0;'
        + ' float lb = clamp(dot(base.rgb, vec3(0.299, 0.587, 0.114)), 0.0, 1.0);'
        + ' if (hue > 0.0) b.rgb -= ' + f(HUE_CUT) + ' * hue * min(b.r, min(b.g, b.b));'
        + ' if (comp > 0.0) { float m = max(b.r, max(b.g, b.b)); float kn = mix(0.35, ' + f(HUE_KNEE) + ', hue);'
        + ' if (m > kn) { float e = m - kn; b *= mix(1.0, (kn + e / (1.0 + e / 0.55)) / m, comp); }'
        + ' b *= 1.0 - 0.6 * comp * lb; }'
        + ' if (extra > 0.0 && hx > 0.0) { vec3 c = texture2D(hubTexture, vUv).rgb; float l = max(c.r, max(c.g, c.b));'
        + ' float q = clamp(l - ' + f(EXTRA_T - EXTRA_K) + ', 0.0, ' + f(2 * EXTRA_K) + ');'
        + ' float w = max(q * q / ' + f(4 * EXTRA_K) + ', l - ' + f(EXTRA_T) + ') / max(l, 1e-4);'
        + ' vec3 h = c * w; h -= min(h.r, min(h.g, h.b)); float hm = max(h.r, max(h.g, h.b));'
        + ' vec3 s = base.rgb + b.rgb; float ld = 1.0 - clamp(max(s.r, max(s.g, s.b)), 0.0, 1.0);'
        + ' b.rgb += extra * ' + f(HX_GAIN) + ' * h / (1.0 + hm / ' + f(EXTRA_CAP) + ') * ld * mix(ld, 1.0, ' + f(HX_LD) + '); }'
        + ' else if (extra > 0.0) { float l = max(b0.r, max(b0.g, b0.b));'
        + ' float q = clamp(l - ' + f(EXTRA_T - EXTRA_K) + ', 0.0, ' + f(2 * EXTRA_K) + ');'
        + ' float w = max(q * q / ' + f(4 * EXTRA_K) + ', l - ' + f(EXTRA_T) + ') / max(l, 1e-4);'
        + ' vec3 h = b0.rgb * w; h -= hue * min(h.r, min(h.g, h.b)); float hm = max(h.r, max(h.g, h.b));'
        + ' vec3 s = base.rgb + b.rgb; float ld = 1.0 - clamp(mix(dot(s, vec3(0.299, 0.587, 0.114)), max(s.r, max(s.g, s.b)), hue), 0.0, 1.0);'
        + ' b.rgb += extra * h / (1.0 + hm / ' + f(EXTRA_CAP) + ') * ld * mix(ld, 1.0, ' + f(HUE_LD) + ' * hue); }'
        + ' gl_FragColor = base + b; }',
    }), 'baseTexture');
    combinePass.needsSwap = true;
    applyParams();                        // bk / comp / extra for the current glow

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
      if (bloomPass.strength > 0 && (cs !== lastCamSig || hs !== lastHubSig)) {   // glow 0: no bloom render
        lastCamSig = cs; lastHubSig = hs;
        tagHubs();
        scene.traverse(hideNonBloom);
        const bg = scene.background; scene.background = null;
        bloomComposer.render();
        scene.background = bg;
        restoreHidden();
        hubValid = false;                 // hub positions/colours may have changed with it
      }
      if (bloomPass.strength > 0 && this.uniforms.hx.value > 0 && this.uniforms.extra.value > 0 && !hubValid) {
        // neon glow > 0.5: hubs-only compact bloom for the extra term. Rendered only when stale (after a
        // main bloom re-render or a resize), so a still scene stays ~free and stars are never re-captured.
        if (!hubComposer) buildHub();
        tagHubs();
        scene.traverse(hideNonHub);
        const bg = scene.background; scene.background = null;
        hubComposer.render();
        scene.background = bg;
        restoreHidden();
        this.uniforms.hubTexture.value = hubComposer.renderTarget2.texture;
        hubValid = true;
      }
      baseRender.call(this, rndr, writeBuffer, readBuffer, dt, mask);
    };
    comp.addPass(combinePass);
    function buildHub() {                 // lazy: only neon themes at glow > 0.5 ever need it
      const w = Math.max(1, Math.round((dom.clientWidth || 1) * BS)), h = Math.max(1, Math.round((dom.clientHeight || 1) * BS));
      hubComposer = new A.EffectComposer(renderer);
      hubComposer.renderToScreen = false;
      hubComposer.setSize(w, h);
      hubComposer.addPass(new A.RenderPass(scene, camera));
      hubPass = new A.UnrealBloomPass(new T.Vector2(w, h), STRENGTH, 0.0, 0.0);
      hubPass.compositeMaterial.uniforms.bloomFactors.value = HUB_FACTORS.slice();   // finest mips only: compact
      hubComposer.addPass(hubPass);
    }

    onResize = () => {
      const w = Math.max(1, Math.round((dom.clientWidth || 1) * BS)), h = Math.max(1, Math.round((dom.clientHeight || 1) * BS));
      bloomComposer.setSize(w, h); bloomPass.setSize(w, h);
      if (hubComposer) { hubComposer.setSize(w, h); hubPass.setSize(w, h); }
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
    if (hubComposer) { try { hubComposer.renderTarget1.dispose(); hubComposer.renderTarget2.dispose(); hubPass.dispose(); } catch (e) {} }
    if (graph) { try { for (const n of graph.graphData().nodes) if (n.__threeObj) n.__threeObj.userData.bloom = false; } catch (e) {} }
    combinePass = null; bloomComposer = null; bloomPass = null; built = false;
    hubComposer = null; hubPass = null; hubValid = false;
    hubObjs.length = 0; lastCamSig = null; lastHubSig = null; lastKey = null; lastNodes = null;
  }

  function install(g, context) {
    teardown(); graph = g; ctx = context; retry = 0;
    if (!window.THREE) { if (!warned) { console.warn('[Bloom] THREE unavailable'); warned = true; } return; }
    if (on()) add();
  }
  function teardown() { remove(); graph = null; ctx = null; }
  // Re-render the offscreen bloom on refresh UNLESS nothing it depends on changed — i.e. only glow
  // moved within 0.5..1 (strength fixed there, extra lives in the combine). Keeps the upper half of
  // the slider free and deterministic: a forced re-render would re-capture the twinkling stars at a
  // new phase on every slider step.
  let lastKey = null, lastNodes = null;
  function renderKey() {
    const s = { ...ctx.getSettings() }; delete s.glow;
    return bloomPass.strength + '|' + JSON.stringify(s) + '|' + [...hubIds].join(',');
  }
  function refresh() {
    if (!graph) return;
    if (!on()) return void remove();
    if (!built) return void add();
    computeHubs(); applyParams();
    const key = renderKey(), nodes = graph.graphData().nodes;
    if (key !== lastKey || nodes !== lastNodes) lastCamSig = null;
    lastKey = key; lastNodes = nodes;
  }
  // read-only debug snapshot for verifiers: is the pass live, and its current params
  function debug() { return { enabled: built, glow: glow(), strength: bloomPass ? bloomPass.strength : 0, radius: bloomPass ? bloomPass.radius : null, threshold: bloomPass ? bloomPass.threshold : null, scale: BS, comp: combinePass ? combinePass.uniforms.comp.value : null, hue: combinePass ? combinePass.uniforms.hue.value : null, extra: combinePass ? combinePass.uniforms.extra.value : null, hx: combinePass ? combinePass.uniforms.hx.value : null, hubValid, bk: combinePass ? combinePass.uniforms.bk.value : null }; }
  // a bloom-tagged object changed without camera/hub motion (e.g. genesis flashes): re-render next frame
  function poke() { lastCamSig = null; }
  window.Bloom = { install, teardown, refresh, debug, poke };
})();
