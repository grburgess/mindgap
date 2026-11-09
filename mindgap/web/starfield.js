/* mindgap 3D star field — a twinkling, parallax backdrop for the 3D view. Exposes
   window.Starfield. Dependency-free of app internals: app.js passes a ctx of getters. THREE is
   read lazily from window.THREE (the ESM shim in index.html), same as glow3d. 3D-only.
   Stars live in a toroidal box that wraps around the camera each frame, so the field never
   empties at any zoom/position; wrapping is done in the vertex shader off uCenter (the camera
   world pos). Per-star colour temperature gives a faint blue/white/amber mix. Under the matrix
   theme the same Points draw faint mirrored code glyphs (one 4x4 atlas texture) in phosphor green
   instead of round stars — a uniform switch, so no rebuild and no extra per-frame CPU. Themes with a
   nebula (ctx.nebula(), e.g. filament) also get one soft additive haze sprite behind the graph: a
   static canvas texture, re-centred/re-sized on the node cloud only every NEB_EVERY frames. */
'use strict';
(function () {
  let graph = null, ctx = null;
  let stars = null;        // THREE.Points
  let raf = 0;             // animation-loop handle
  let t0 = 0;              // loop start (ms)
  let warned = false;
  let glyphTex = null;     // 4x4 glyph atlas (matrix theme), built with the Points
  let gain = 1;            // brightness multiplier (setGain)
  let neb = null, nebTex = null, nebTick = 0;   // nebula haze sprite (themes with ctx.nebula())
  const NEB_EVERY = 60, NEB_K = 3.2;            // re-fit cadence (frames); sprite size / RMS node radius
  const NEB_G0 = 0.55, NEB_GK = 0.9;            // haze opacity factor = NEB_G0 + NEB_GK * glow (1 at glow 0.5)

  function THREE() { return window.THREE || null; }
  function on() { return !!(ctx && ctx.getSettings().starfield); }
  const NEON_GAIN = 0.5, NEON_SIZE = 0.75;   // neon-theme sky: half brightness, smaller points
  const GLYPH_GAIN = 0.3, GLYPH_SIZE = 2.4;  // matrix glyph sky: very faint, big enough to read as glyphs
  const GLYPHS = 'ﾊﾐﾋｰｳｼﾅﾓﾆｻﾜﾂｵﾘ01';         // 16 cells; sampled mirrored, film-style

  function buildAtlas(T) {
    const c = document.createElement('canvas'); c.width = c.height = 256;
    const g = c.getContext('2d');
    g.fillStyle = '#fff'; g.textAlign = 'center'; g.textBaseline = 'middle';
    g.font = '600 48px "Hiragino Kaku Gothic ProN", "MS Gothic", monospace';
    for (let i = 0; i < 16; i++) g.fillText(GLYPHS[i], (i % 4) * 64 + 32, Math.floor(i / 4) * 64 + 34);
    const t = new T.CanvasTexture(c);
    t.minFilter = T.LinearFilter; t.generateMipmaps = false;
    return t;
  }

  // nebula texture: a soft radial core plus a few seeded off-centre puffs (cloudy, not a perfect disc),
  // drawn once in near-white blues; the theme colour tints it via the sprite material
  function buildNebula(T) {
    const c = document.createElement('canvas'); c.width = c.height = 512;
    const g = c.getContext('2d');
    let seed = 7; const rnd = () => (seed = (seed * 16807) % 2147483647) / 2147483647;
    const puff = (x, y, r, a) => {
      const gr = g.createRadialGradient(x, y, 0, x, y, r);
      gr.addColorStop(0, `rgba(255,255,255,${a})`); gr.addColorStop(0.5, `rgba(255,255,255,${a * 0.35})`); gr.addColorStop(1, 'rgba(255,255,255,0)');
      g.fillStyle = gr; g.fillRect(0, 0, 512, 512);
    };
    puff(256, 256, 250, 0.55);
    for (let i = 0; i < 9; i++) {   // d + r < 250: a puff clipped by the canvas edge shows as a hard seam
      const a = rnd() * 6.283, d = 30 + rnd() * 100, r = 50 + rnd() * (190 - d);
      puff(256 + Math.cos(a) * d, 256 + Math.sin(a) * d, r, 0.12 + rnd() * 0.18);
    }
    const t = new T.CanvasTexture(c); t.minFilter = T.LinearFilter; t.generateMipmaps = false;
    return t;
  }
  // centre + size the haze on the node cloud (centroid, RMS radius). Every NEB_EVERY frames only.
  function fitNebula() {
    const ns = graph.graphData().nodes; let n = 0, sx = 0, sy = 0, sz = 0;
    for (let i = 0; i < ns.length; i++) { const p = ns[i]; if (Number.isFinite(p.x)) { sx += p.x; sy += p.y; sz += p.z || 0; n++; } }
    if (!n) return;
    sx /= n; sy /= n; sz /= n; let r2 = 0;
    for (let i = 0; i < ns.length; i++) { const p = ns[i]; if (Number.isFinite(p.x)) { const dx = p.x - sx, dy = p.y - sy, dz = (p.z || 0) - sz; r2 += dx * dx + dy * dy + dz * dz; } }
    neb.position.set(sx, sy, sz); neb.scale.setScalar(Math.max(50, Math.sqrt(r2 / n) * NEB_K));
  }

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
    glyphTex = buildAtlas(T);
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
        uGain:   { value: gain },                     // theme dim × setGain (view modes); set in loop()
        uSize:   { value: 1 },                        // neon themes shrink the stars (1 = stock)
        uBloom:  { value: 1 },                        // bloom.js damps stars in its offscreen render at high glow
        uGlyph:  { value: 0 },                        // 1 = matrix glyph sky (set in loop())
        uGlyphs: { value: glyphTex },
        uG1:     { value: new T.Color('#00ff41') },   // code green
        uG2:     { value: new T.Color('#b8ffc8') },   // pale phosphor
      },
      vertexShader: [
        'attribute float aPhase; attribute float aBase; attribute float aTemp;',
        'uniform float uTime; uniform float uPx; uniform float uL; uniform vec3 uCenter; uniform float uSize; uniform float uGlyph;',
        'varying float vTw; varying float vTemp; varying float vNear; varying float vIdx;',
        'void main() {',
        '  vec3 d = position - uCenter;',
        '  d = mod(d + 0.5 * uL, uL) - 0.5 * uL;          // wrap into box around the camera',
        '  vec4 mv = modelViewMatrix * vec4(uCenter + d, 1.0);',
        '  float tw = 0.45 + 0.55 * sin(uTime * 1.3 + aPhase);',
        '  vTw = tw; vTemp = aTemp; vIdx = floor(fract(aPhase * 0.1591549) * 16.0);',
        '  vNear = smoothstep(0.0, 220.0, -mv.z);          // fade stars that wrap in front of us',
        '  gl_PointSize = uSize * aBase * uPx * mix(0.85 + 0.6 * tw, 1.0, uGlyph) * (1.0 + 520.0 / -mv.z);',
        '  gl_Position = projectionMatrix * mv;',
        '}',
      ].join('\n'),
      fragmentShader: [
        'uniform vec3 uCool; uniform vec3 uMid; uniform vec3 uWarm; uniform float uGain; uniform float uBloom;',
        'uniform float uGlyph; uniform sampler2D uGlyphs; uniform vec3 uG1; uniform vec3 uG2;',
        'varying float vTw; varying float vTemp; varying float vNear; varying float vIdx;',
        'void main() {',
        '  if (uGlyph > 0.5) {                               // matrix: mirrored glyph from the atlas',
        '    vec2 cell = vec2(mod(vIdx, 4.0), floor(vIdx / 4.0));',
        '    vec2 uv = vec2((cell.x + 1.0 - gl_PointCoord.x) / 4.0, 1.0 - (cell.y + gl_PointCoord.y) / 4.0);',
        '    float g = texture2D(uGlyphs, uv).a;',
        '    if (g < 0.02) discard;',
        '    gl_FragColor = vec4(mix(uG1, uG2, vTemp * vTemp), g * (0.3 + 0.7 * vTw) * vNear * uGain * uBloom);',
        '    return;',
        '  }',
        '  float r = length(gl_PointCoord - vec2(0.5));',
        '  if (r > 0.5) discard;',
        '  vec3 col = vTemp < 0.5 ? mix(uCool, uMid, vTemp * 2.0)',
        '                         : mix(uMid, uWarm, (vTemp - 0.5) * 2.0);',
        '  float a = smoothstep(0.5, 0.0, r) * (0.18 + 0.62 * vTw) * vNear * uGain * uBloom;',
        '  gl_FragColor = vec4(col, a);',
        '}',
      ].join('\n'),
    });
    stars = new T.Points(geo, mat);
    stars.frustumCulled = false;
    stars.userData.bloom = true;      // opt into selective bloom (bloom.js); harmless when bloom is off
    stars.renderOrder = -10;          // draw behind nodes/edges/glow
    // wrap centre = the camera of THIS render. Set per render (not only in loop()): the lib renders
    // before our rAF runs, and bloom.js's idle-gated offscreen render after a camera jump would
    // otherwise freeze a glow texture of stars wrapped around the OLD camera — a dense, bright,
    // lopsided bloomed haze that never clears while the camera rests.
    stars.onBeforeRender = (r, s, cam) => { mat.uniforms.uCenter.value.copy(cam.position); };
    graph.scene().add(stars);
    nebTex = buildNebula(T);
    neb = new T.Sprite(new T.SpriteMaterial({ map: nebTex, transparent: true, depthWrite: false, depthTest: false, blending: T.AdditiveBlending, opacity: 0 }));
    neb.renderOrder = -11; neb.frustumCulled = false; neb.visible = false; nebTick = 0;   // behind the stars
    graph.scene().add(neb);
  }

  function clear() {
    if (graph && stars) { graph.scene().remove(stars); stars.geometry.dispose(); stars.material.dispose(); }
    if (glyphTex) glyphTex.dispose();
    if (graph && neb) { graph.scene().remove(neb); neb.material.dispose(); }
    if (nebTex) nebTex.dispose();
    stars = null; glyphTex = null; neb = null; nebTex = null;
  }

  function loop() {
    if (!stars) { raf = 0; return; }
    raf = requestAnimationFrame(loop);
    const u = stars.material.uniforms;
    u.uTime.value = (performance.now() - t0) / 1000;
    const cam = graph.camera();
    u.uCenter.value.set(cam.position.x, cam.position.y, cam.position.z);
    const neon = !!(ctx && ctx.isNeon && ctx.isNeon());   // neon themes: a subtler sky behind the graph
    const glyph = neon && ctx.getSettings().theme === 'matrix';
    u.uGlyph.value = glyph ? 1 : 0;
    const nb = neon && ctx.nebula ? ctx.nebula() : null;
    u.uGain.value = (glyph ? GLYPH_GAIN : neon ? NEON_GAIN * (nb && nb.stars != null ? nb.stars : 1) : 1) * gain; u.uSize.value = glyph ? GLYPH_SIZE : neon ? NEON_SIZE : 1;
    if (neb) {
      neb.visible = !!nb;
      if (nb) {
        if (neb.material.userData.c !== nb.color) { neb.material.color.set(nb.color); neb.material.userData.c = nb.color; }
        // Look → glow also lifts the haze (0.55x at glow 0, 1x at 0.5, 1.45x at 1): the selective bloom
        // only touches the few hub spheres, which already sit at the clip on this theme, so without this
        // the upper half of the slider changed nothing visible. Linear in glow → mean luminance monotone.
        const gl = +ctx.getSettings().glow, gk = Number.isFinite(gl) ? NEB_G0 + NEB_GK * Math.min(Math.max(gl, 0), 1) : 1;
        neb.material.opacity = nb.opacity * gain * gk;
        if (nebTick-- <= 0) { nebTick = NEB_EVERY; fitNebula(); }
      }
    }
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

  // brightness multiplier (1 = stock); survives rebuilds. universe mode dims the sky with it
  function setGain(k) { gain = k; }   // loop() folds it into uGain next frame

  window.Starfield = { install, teardown, refresh, gain: setGain };
})();
