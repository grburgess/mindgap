/* mindgap 3D star field — a twinkling, parallax backdrop for the 3D view. Exposes
   window.Starfield. Dependency-free of app internals: app.js passes a ctx of getters. THREE is
   read lazily from window.THREE (the ESM shim in index.html), same as glow3d. 3D-only.
   Stars live in a toroidal box that wraps around the camera each frame, so the field never
   empties at any zoom/position; wrapping is done in the vertex shader off uCenter (the camera
   world pos). Per-star colour temperature gives a faint blue/white/amber mix. */
'use strict';
(function () {
  let graph = null, ctx = null;
  let stars = null;        // THREE.Points
  let raf = 0;             // animation-loop handle
  let t0 = 0;              // loop start (ms)
  let warned = false;

  function THREE() { return window.THREE || null; }
  function on() { return !!(ctx && ctx.getSettings().starfield); }

  // ~2200 stars uniformly filling a cube of side L; the box wraps around the camera so the
  // field is effectively infinite (toroidal). Density tuned to match the old spherical feel.
  function build() {
    const T = THREE(); if (!T || !graph) return;
    clear();
    const N = 2200, L = 3000;                  // box side; density tuned to match old feel
    const pos = new Float32Array(N * 3);
    const phase = new Float32Array(N);   // per-star twinkle offset
    const base = new Float32Array(N);    // per-star base size (px)
    const temp = new Float32Array(N);          // 0..1 colour temperature
    for (let i = 0; i < N; i++) {
      pos[i * 3]     = (Math.random() - 0.5) * L;   // uniform in the box
      pos[i * 3 + 1] = (Math.random() - 0.5) * L;
      pos[i * 3 + 2] = (Math.random() - 0.5) * L;
      phase[i] = Math.random() * Math.PI * 2;
      base[i]  = 1.3 + Math.random() * 2.2;
      // skew toward white: most stars ~0.5, a few cool (→0) / warm (→1)
      const r = Math.random(); temp[i] = 0.5 + (r * r - 0.25) * 0.9;
    }
    const geo = new T.BufferGeometry();
    geo.setAttribute('position', new T.BufferAttribute(pos, 3));
    geo.setAttribute('aPhase', new T.BufferAttribute(phase, 1));
    geo.setAttribute('aBase', new T.BufferAttribute(base, 1));
    geo.setAttribute('aTemp', new T.BufferAttribute(temp, 1));
    const mat = new T.ShaderMaterial({
      transparent: true, depthWrite: false, blending: T.AdditiveBlending,
      uniforms: {
        uTime:   { value: 0 },
        uCenter: { value: new T.Vector3() },      // camera world pos, updated each frame
        uL:      { value: L },
        uPx:     { value: Math.min(window.devicePixelRatio || 1, 2) },
        uCool:   { value: new T.Color('#8fb4ff') },   // blue
        uWarm:   { value: new T.Color('#ffd9a8') },   // amber
        uMid:    { value: new T.Color('#eaf2ff') },   // near-white
      },
      vertexShader: [
        'attribute float aPhase; attribute float aBase; attribute float aTemp;',
        'uniform float uTime; uniform float uPx; uniform float uL; uniform vec3 uCenter;',
        'varying float vTw; varying float vTemp; varying float vNear;',
        'void main() {',
        '  vec3 d = position - uCenter;',
        '  d = mod(d + 0.5 * uL, uL) - 0.5 * uL;          // wrap into box around the camera',
        '  vec4 mv = modelViewMatrix * vec4(uCenter + d, 1.0);',
        '  float tw = 0.45 + 0.55 * sin(uTime * 1.3 + aPhase);',
        '  vTw = tw; vTemp = aTemp;',
        '  vNear = smoothstep(0.0, 220.0, -mv.z);          // fade stars that wrap in front of us',
        '  gl_PointSize = aBase * uPx * (0.85 + 0.6 * tw) * (1.0 + 520.0 / -mv.z);',
        '  gl_Position = projectionMatrix * mv;',
        '}',
      ].join('\n'),
      fragmentShader: [
        'uniform vec3 uCool; uniform vec3 uMid; uniform vec3 uWarm;',
        'varying float vTw; varying float vTemp; varying float vNear;',
        'void main() {',
        '  float r = length(gl_PointCoord - vec2(0.5));',
        '  if (r > 0.5) discard;',
        '  vec3 col = vTemp < 0.5 ? mix(uCool, uMid, vTemp * 2.0)',
        '                         : mix(uMid, uWarm, (vTemp - 0.5) * 2.0);',
        '  float a = smoothstep(0.5, 0.0, r) * (0.18 + 0.62 * vTw) * vNear;',
        '  gl_FragColor = vec4(col, a);',
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
    const u = stars.material.uniforms;
    u.uTime.value = (performance.now() - t0) / 1000;
    const cam = graph.camera();
    u.uCenter.value.set(cam.position.x, cam.position.y, cam.position.z);
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
