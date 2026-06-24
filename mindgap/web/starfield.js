/* mindgap 3D star field — a twinkling, parallax backdrop for the 3D view. Exposes
   window.Starfield. Dependency-free of app internals: app.js passes a ctx of getters. THREE is
   read lazily from window.THREE (the ESM shim in index.html), same as glow3d. 3D-only.
   Stars live in world space (NOT camera-locked) so orbiting/zooming the graph gives real depth
   parallax — it reads as drifting through space rather than a flat backdrop. */
'use strict';
(function () {
  let graph = null, ctx = null;
  let stars = null;        // THREE.Points
  let raf = 0;             // animation-loop handle
  let t0 = 0;              // loop start (ms)
  let warned = false;

  function THREE() { return window.THREE || null; }
  function on() { return !!(ctx && ctx.getSettings().starfield); }

  // ~1800 stars on a thick spherical shell around the origin (the graph's center).
  function build() {
    const T = THREE(); if (!T || !graph) return;
    clear();
    const N = 1800, rMin = 700, rMax = 4200;
    const pos = new Float32Array(N * 3);
    const phase = new Float32Array(N);   // per-star twinkle offset
    const base = new Float32Array(N);    // per-star base size (px)
    for (let i = 0; i < N; i++) {
      const z = Math.random() * 2 - 1;             // uniform direction on the sphere
      const a = Math.random() * Math.PI * 2;
      const s = Math.sqrt(1 - z * z);
      const r = rMin + Math.random() * (rMax - rMin);
      pos[i * 3] = Math.cos(a) * s * r;
      pos[i * 3 + 1] = Math.sin(a) * s * r;
      pos[i * 3 + 2] = z * r;
      phase[i] = Math.random() * Math.PI * 2;
      base[i] = 1.3 + Math.random() * 2.2;
    }
    const geo = new T.BufferGeometry();
    geo.setAttribute('position', new T.BufferAttribute(pos, 3));
    geo.setAttribute('aPhase', new T.BufferAttribute(phase, 1));
    geo.setAttribute('aBase', new T.BufferAttribute(base, 1));
    const mat = new T.ShaderMaterial({
      transparent: true, depthWrite: false, blending: T.AdditiveBlending,
      uniforms: {
        uTime: { value: 0 },
        uColor: { value: new T.Color('#cfe0ff') },   // soft cool white
        uPx: { value: Math.min(window.devicePixelRatio || 1, 2) },
      },
      vertexShader: [
        'attribute float aPhase;', 'attribute float aBase;',
        'uniform float uTime; uniform float uPx;',
        'varying float vTw;',
        'void main() {',
        '  vec4 mv = modelViewMatrix * vec4(position, 1.0);',
        '  float tw = 0.45 + 0.55 * sin(uTime * 1.3 + aPhase);',   // gentle 0..1 pulse
        '  vTw = tw;',
        '  gl_PointSize = aBase * uPx * (0.85 + 0.6 * tw) * (1.0 + 520.0 / -mv.z);',
        '  gl_Position = projectionMatrix * mv;',
        '}',
      ].join('\n'),
      fragmentShader: [
        'uniform vec3 uColor; varying float vTw;',
        'void main() {',
        '  float r = length(gl_PointCoord - vec2(0.5));',
        '  if (r > 0.5) discard;',
        '  float a = smoothstep(0.5, 0.0, r) * (0.18 + 0.62 * vTw);',   // soft round, dim
        '  gl_FragColor = vec4(uColor, a);',
        '}',
      ].join('\n'),
    });
    stars = new T.Points(geo, mat);
    stars.frustumCulled = false;
    stars.renderOrder = -10;          // draw behind nodes/edges/glow
    graph.scene().add(stars);
  }

  function clear() {
    if (graph && stars) { graph.scene().remove(stars); stars.geometry.dispose(); stars.material.dispose(); }
    stars = null;
  }

  function loop() {
    if (!stars) { raf = 0; return; }
    raf = requestAnimationFrame(loop);
    stars.material.uniforms.uTime.value = (performance.now() - t0) / 1000;
  }
  function startLoop() { if (!raf && stars) { t0 = performance.now(); loop(); } }
  function stopLoop() { if (raf) { cancelAnimationFrame(raf); raf = 0; } }

  function install(g, context) {
    teardown();
    graph = g; ctx = context;
    const T = THREE();
    if (!T) { if (!warned) { console.warn('[Starfield] window.THREE unavailable — star field disabled'); warned = true; } return; }
    if (on()) { build(); startLoop(); }
  }
  function teardown() {
    stopLoop();
    clear();
    graph = null; ctx = null;
  }
  function refresh() {       // toggle on/off without a remount
    if (!graph || !ctx || !THREE()) return;
    if (on()) { if (!stars) { build(); startLoop(); } }
    else { stopLoop(); clear(); }
  }

  window.Starfield = { install, teardown, refresh };
})();
