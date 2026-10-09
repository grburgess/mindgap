/*
 * 04-join-constellations — Two point-cloud constellations linked by re-wiring join lines
 * Accent: #ff9f0a
 * Source: Winning Ways showcase (04-change-of-plans/index.html)
 *
 * Requirements:
 *   - three.js r128 loaded first as a classic script (global THREE) — UMD build,
 *     works over file:// (module builds do not).
 *   - DOM: <canvas class="bg3d" id="bg3d"> inside a .hero container
 *     (CSS: canvas.bg3d absolutely fills the hero, z-index 0, copy above at z-index 1).
 *   - Also contains the shared .reveal IntersectionObserver snippet where present.
 *
 * Conventions baked in (keep them when adapting):
 *   - renderer.setPixelRatio(Math.min(devicePixelRatio, 2))
 *   - pause rendering when document.hidden
 *   - prefers-reduced-motion: render ONE static frame, no rAF loop
 *   - slow, ambient motion; pointer/scroll parallax only — no spinning-cube energy
 */
(function () {
  var io = new IntersectionObserver(function (es) {
    es.forEach(function (e) { if (e.isIntersecting) e.target.classList.add('in'); });
  }, { threshold: 0.15 });
  document.querySelectorAll('.reveal').forEach(function (el) { io.observe(el); });
})();

(function () {
  var canvas = document.getElementById('bg3d');
  var hero = canvas.parentNode;
  if (!window.THREE) return;

  var reduced = window.matchMedia('(prefers-reduced-motion: reduce)').matches;
  var ACCENT = new THREE.Color(0xff9f0a);
  var PALE = new THREE.Color(0xb9c4dc);

  var renderer = new THREE.WebGLRenderer({ canvas: canvas, antialias: true, alpha: true });
  renderer.setPixelRatio(Math.min(window.devicePixelRatio || 1, 2));
  renderer.setClearColor(0x000000, 0);

  var scene = new THREE.Scene();
  scene.fog = new THREE.FogExp2(0x000000, 0.0125);

  var camera = new THREE.PerspectiveCamera(52, 1, 0.1, 400);
  camera.position.set(0, 0, 64);

  var group = new THREE.Group();
  scene.add(group);

  // ---- sprite texture -------------------------------------------------
  function discTexture() {
    var c = document.createElement('canvas');
    c.width = c.height = 64;
    var g = c.getContext('2d');
    var rg = g.createRadialGradient(32, 32, 0, 32, 32, 32);
    rg.addColorStop(0.0, 'rgba(255,255,255,1)');
    rg.addColorStop(0.28, 'rgba(255,255,255,0.62)');
    rg.addColorStop(0.62, 'rgba(255,255,255,0.14)');
    rg.addColorStop(1.0, 'rgba(255,255,255,0)');
    g.fillStyle = rg;
    g.fillRect(0, 0, 64, 64);
    return new THREE.CanvasTexture(c);
  }
  var sprite = discTexture();

  // ---- cloud builder --------------------------------------------------
  // Real counts: 1,174 planet rows and 972 host stars.
  var N_PLANETS = 1174;
  var N_STARS = 972;
  var SPAN = 19;

  function buildCloud(n, radius, flatten, baseColor, tint) {
    var pos = new Float32Array(n * 3);
    var col = new Float32Array(n * 3);
    var c = new THREE.Color();
    for (var i = 0; i < n; i++) {
      var u = Math.random() * 2 - 1;
      var th = Math.random() * Math.PI * 2;
      var s = Math.sqrt(1 - u * u);
      var r = radius * Math.pow(Math.random(), 0.55);
      pos[i * 3] = r * s * Math.cos(th);
      pos[i * 3 + 1] = r * u * flatten;
      pos[i * 3 + 2] = r * s * Math.sin(th);
      c.copy(baseColor).lerp(tint, Math.random() * 0.5);
      var b = 0.55 + Math.random() * 0.45;
      col[i * 3] = c.r * b;
      col[i * 3 + 1] = c.g * b;
      col[i * 3 + 2] = c.b * b;
    }
    var geo = new THREE.BufferGeometry();
    geo.setAttribute('position', new THREE.BufferAttribute(pos, 3));
    geo.setAttribute('color', new THREE.BufferAttribute(col, 3));
    return { geo: geo, pos: pos };
  }

  function pointsMaterial(size) {
    return new THREE.PointsMaterial({
      size: size, map: sprite, vertexColors: true,
      transparent: true, depthWrite: false,
      blending: THREE.AdditiveBlending, sizeAttenuation: true, fog: true
    });
  }

  var planetCloud = buildCloud(N_PLANETS, 12.5, 0.62, PALE, new THREE.Color(0x6f7ea0));
  var starCloud = buildCloud(N_STARS, 10.5, 0.72, ACCENT, new THREE.Color(0xffd79a));

  var planets = new THREE.Points(planetCloud.geo, pointsMaterial(0.52));
  planets.position.x = -SPAN;
  group.add(planets);

  var stars = new THREE.Points(starCloud.geo, pointsMaterial(0.86));
  stars.position.x = SPAN;
  group.add(stars);

  // ---- join lines: many planets to one star ---------------------------
  var N_LINKS = 88;
  // Weighted star pool so some hosts collect several planets — the
  // many-to-one shape of the real join (1,174 planets onto 972 stars).
  var starPool = [];
  for (var p = 0; p < 240; p++) {
    var si = (Math.random() * N_STARS) | 0;
    var reps = Math.random() < 0.18 ? 4 : 1;
    for (var q = 0; q < reps; q++) starPool.push(si);
  }

  var linkPos = new Float32Array(N_LINKS * 2 * 3);
  var linkCol = new Float32Array(N_LINKS * 2 * 3);
  var links = [];
  for (var i = 0; i < N_LINKS; i++) {
    links.push({
      pi: (Math.random() * N_PLANETS) | 0,
      si: starPool[(Math.random() * starPool.length) | 0],
      t: Math.random(),
      dur: 3.4 + Math.random() * 4.6
    });
  }

  var linkGeo = new THREE.BufferGeometry();
  linkGeo.setAttribute('position', new THREE.BufferAttribute(linkPos, 3));
  linkGeo.setAttribute('color', new THREE.BufferAttribute(linkCol, 3));
  var linkMat = new THREE.LineBasicMaterial({
    vertexColors: true, transparent: true,
    opacity: 0.9, blending: THREE.AdditiveBlending, depthWrite: false, fog: true
  });
  var linkMesh = new THREE.LineSegments(linkGeo, linkMat);
  group.add(linkMesh);

  var tmp = new THREE.Vector3();

  function updateLinks(dt) {
    planets.updateMatrix();
    stars.updateMatrix();
    for (var i = 0; i < N_LINKS; i++) {
      var L = links[i];
      L.t += dt / L.dur;
      if (L.t >= 1) {
        // re-wire: the join re-forms against a different pairing
        L.t = 0;
        L.pi = (Math.random() * N_PLANETS) | 0;
        L.si = starPool[(Math.random() * starPool.length) | 0];
        L.dur = 3.4 + Math.random() * 4.6;
      }
      // fade in, hold, fade out
      var a = Math.sin(Math.PI * L.t);
      a = a * a * 0.62;

      var o = i * 6;
      tmp.fromArray(planetCloud.pos, L.pi * 3).applyMatrix4(planets.matrix);
      linkPos[o] = tmp.x; linkPos[o + 1] = tmp.y; linkPos[o + 2] = tmp.z;
      tmp.fromArray(starCloud.pos, L.si * 3).applyMatrix4(stars.matrix);
      linkPos[o + 3] = tmp.x; linkPos[o + 4] = tmp.y; linkPos[o + 5] = tmp.z;

      linkCol[o] = PALE.r * a; linkCol[o + 1] = PALE.g * a; linkCol[o + 2] = PALE.b * a;
      linkCol[o + 3] = ACCENT.r * a; linkCol[o + 4] = ACCENT.g * a; linkCol[o + 5] = ACCENT.b * a;
    }
    linkGeo.attributes.position.needsUpdate = true;
    linkGeo.attributes.color.needsUpdate = true;
  }

  // ---- interaction ----------------------------------------------------
  var pointer = { x: 0, y: 0 };
  var target = { x: 0, y: 0 };
  window.addEventListener('pointermove', function (e) {
    target.x = (e.clientX / window.innerWidth - 0.5) * 2;
    target.y = (e.clientY / window.innerHeight - 0.5) * 2;
  }, { passive: true });

  var scrollT = 0;
  window.addEventListener('scroll', function () {
    scrollT = Math.min(window.scrollY / (window.innerHeight || 1), 1.4);
  }, { passive: true });

  function resize() {
    var w = hero.clientWidth || window.innerWidth;
    var h = hero.clientHeight || window.innerHeight;
    renderer.setSize(w, h, false);
    camera.aspect = w / h;
    // pull the constellations together on narrow screens
    var fit = Math.min(1, w / 900);
    group.scale.setScalar(0.62 + 0.38 * fit);
    camera.position.z = 64 + (1 - fit) * 26;
    camera.updateProjectionMatrix();
  }
  window.addEventListener('resize', resize);
  resize();

  var clock = new THREE.Clock();

  function frame(dt) {
    planets.rotation.y += dt * 0.045;
    planets.rotation.x = Math.sin(clock.elapsedTime * 0.11) * 0.08;
    stars.rotation.y -= dt * 0.032;
    stars.rotation.x = Math.cos(clock.elapsedTime * 0.09) * 0.07;
    updateLinks(dt);

    pointer.x += (target.x - pointer.x) * 0.04;
    pointer.y += (target.y - pointer.y) * 0.04;
    group.rotation.y = pointer.x * 0.16 + Math.sin(clock.elapsedTime * 0.05) * 0.05;
    group.rotation.x = pointer.y * 0.1 - scrollT * 0.12;
    group.position.y = scrollT * 7;
    renderer.render(scene, camera);
  }

  if (reduced) {
    updateLinks(0);
    renderer.render(scene, camera);
  } else {
    (function loop() {
      requestAnimationFrame(loop);
      if (document.hidden) { clock.getDelta(); return; }
      frame(Math.min(clock.getDelta(), 0.05));
    })();
  }
})();
