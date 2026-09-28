/* live-view animated diagrams, owned by the shell (every run gets them):
 *   pulse    — progress ring + verdict-mix bar + running/elapsed counters
 *   map      — the court as a flow graph: claims -> lens agents -> ruling -> decision;
 *              particles flow into running agents, nodes pop into their verdict colour
 *   timeline — one swimlane bar per agent (spawn -> return), grows live; event markers
 * Persistent SVG, diffed on each LiveViz.update(state, helpers); one rAF loop animates.
 * Loaded before run.js so report mode (synchronous render) finds it. Plain SVG, no
 * libraries: report.html must open offline. */
(function () {
  'use strict';
  var NS = 'http://www.w3.org/2000/svg';
  var REDUCED = !!(window.matchMedia && matchMedia('(prefers-reduced-motion: reduce)').matches);
  // status palette — validated (dataviz validate_palette.js, dark, #161617): CVD/normal/contrast pass
  var C = { ok: '#30d158', warn: '#ffe14d', weak: '#ff8c1a', bad: '#ff375f', done: '#a1a1a6', na: '#48484a', run: '#64d2ff' };
  var L = { ok: 'verified', warn: 'caveats', weak: 'weakened', bad: 'refuted', done: 'done', na: 'pending', run: 'running' };
  // per-skill vocabulary: what the first column is, what its states are called
  var MODES = {
    'idea-court': { rows: 'Claims', done: 'reconciled', cap: 'Verdict mix — reconciled, per claim',
                    keys: ['ok', 'warn', 'weak', 'bad'], labels: {} },
    'loop-system': { rows: 'Criteria', done: 'passing', cap: 'Criteria — latest verifier verdict',
                     keys: ['ok', 'bad'], labels: { ok: 'pass', bad: 'fail' }, lanes: true },
    'deep-research': { rows: 'Gaps', done: 'addressed', cap: 'Gaps — addressed by a research question',
                       keys: ['ok', 'warn'], labels: { ok: 'addressed', warn: 'deferred', na: 'open' } }
  };
  var H = null, ST = null, live = false;
  function mode() { return MODES[ST && ST.view && ST.view.skill] || MODES['idea-court']; }
  function isLoop() { return !!mode().lanes; }
  function lab(k) { return mode().labels[k] || L[k]; }

  function svg(tag, attrs, parent) {
    var el = document.createElementNS(NS, tag);
    for (var k in attrs) el.setAttribute(k, attrs[k]);
    if (parent) parent.appendChild(el);
    return el;
  }
  function div(cls, text, parent) {
    var el = document.createElement('div');
    if (cls) el.className = cls;
    if (text != null) el.textContent = text;
    if (parent) parent.appendChild(el);
    return el;
  }
  function trunc(t, n) { t = String(t || ''); return t.length > n ? t.slice(0, n - 1) + '…' : t; }
  function alpha(hex, a) {
    var n = parseInt(hex.slice(1), 16);
    return 'rgba(' + (n >> 16) + ',' + ((n >> 8) & 255) + ',' + (n & 255) + ',' + a + ')';
  }
  function shortId(id) { var m = /^[A-Za-z]+\d+/.exec(id || ''); return m ? m[0] : trunc(id, 10); }
  function fmtDur(ms) {
    var s = Math.max(0, Math.round(ms / 1000));
    return s < 60 ? s + 's' : Math.floor(s / 60) + 'm ' + String(s % 60).padStart(2, '0') + 's';
  }
  function legend(host, keys) {
    host.textContent = '';
    keys.forEach(function (k) {
      var item = div('lg-item', null, host);
      var sw = div('lg-sw', null, item);
      sw.style.background = C[k];
      if (k === 'na') sw.style.background = 'transparent', sw.style.borderColor = '#6e6e73';
      item.appendChild(document.createTextNode(lab(k)));
    });
  }

  // ---- tooltip ------------------------------------------------------------
  var tip = div('viz-tip', null, document.body);
  tip.hidden = true;
  function showTip(ev, title, lines) {
    tip.textContent = '';
    var b = document.createElement('b'); b.textContent = title; tip.appendChild(b);
    (lines || []).forEach(function (l) { if (l) div(null, l, tip); });
    tip.hidden = false;
    var r = tip.getBoundingClientRect(), x = ev.clientX + 14, y = ev.clientY + 14;
    if (x + r.width > innerWidth - 8) x = ev.clientX - r.width - 14;
    if (y + r.height > innerHeight - 8) y = ev.clientY - r.height - 14;
    tip.style.left = x + 'px'; tip.style.top = y + 'px';
  }
  function hideTip() { tip.hidden = true; }

  function agentCls(a) {
    if (a.result == null && a.state !== 'done') return a.state === 'running' ? 'run' : 'na';
    var c = H.verdictClass(H.verdictOf(a));
    return c === 'na' ? 'done' : c;
  }

  // ---- pulse: ring + verdict mix ------------------------------------------
  var pulse = null;
  function tweenNum(el, to) {
    var from = +el.dataset.v || 0;
    el.dataset.v = to;
    if (REDUCED || from === to) { el.textContent = to; return; }
    var t0 = performance.now();
    (function step(t) {
      var k = Math.min(1, (t - t0) / 600);
      el.textContent = Math.round(from + (to - from) * (1 - Math.pow(1 - k, 3)));
      if (k < 1) requestAnimationFrame(step);
    })(t0);
  }
  function renderPulse(host, st) {
    if (!pulse) {
      host.textContent = '';
      var ringBox = div('pl-ring', null, host);
      var s = svg('svg', { viewBox: '0 0 88 88', width: 88, height: 88, 'aria-hidden': 'true' }, ringBox);
      svg('circle', { cx: 44, cy: 44, r: 36, class: 'ring-bg' }, s);
      var arc = svg('circle', { cx: 44, cy: 44, r: 36, class: 'ring-fg', transform: 'rotate(-90 44 44)' }, s);
      var circ = 2 * Math.PI * 36;
      arc.setAttribute('stroke-dasharray', circ); arc.setAttribute('stroke-dashoffset', circ);
      var mid = div('pl-mid', null, ringBox);
      var done = div('pl-done', '0', mid); mid.appendChild(document.createTextNode('/'));
      var total = div('pl-total', '0', mid);
      div('pl-cap', 'agents returned', ringBox);
      var right = div('pl-right', null, host);
      var head = div('pl-head', null, right);
      var runEl = div('pl-stat', null, head);
      var dot = div('pl-dot', null, runEl);
      var runN = document.createElement('b'); runN.textContent = '0'; runEl.appendChild(runN);
      runEl.appendChild(document.createTextNode(' working'));
      var el2 = div('pl-stat', null, head);
      var clock = document.createElement('b'); el2.appendChild(clock);
      el2.appendChild(document.createTextNode(' elapsed'));
      var mixCap = div('pl-cap', 'Verdict mix', right);
      var bar = div('pl-bar', null, right);
      var segs = {};
      ['ok', 'warn', 'weak', 'bad', 'na'].forEach(function (k) {
        var sg = div('pl-seg', null, bar);
        sg.style.background = k === 'na' ? '#2c2c2e' : C[k];
        sg.style.flexGrow = 0;
        segs[k] = sg;
      });
      var lg = div('pl-legend', null, right);
      var counts = {};
      ['ok', 'warn', 'weak', 'bad', 'na'].forEach(function (k) {
        var item = div('lg-item', null, lg);
        var sw = div('lg-sw', null, item);
        sw.style.background = k === 'na' ? '#2c2c2e' : C[k];
        item.appendChild(document.createTextNode(lab(k) + ' '));
        var n = document.createElement('b'); n.textContent = '0'; item.appendChild(n);
        counts[k] = n;
      });
      pulse = { arc: arc, circ: circ, done: done, total: total, runN: runN, dot: dot, clock: clock, segs: segs, counts: counts, cap: mixCap };
    }
    var agents = st.agents, nDone = agents.filter(function (a) { return a.result != null || a.state === 'done'; }).length;
    var nRun = agents.filter(function (a) { return a.state === 'running' && a.result == null; }).length;
    pulse.arc.setAttribute('stroke-dashoffset', pulse.circ * (1 - (agents.length ? nDone / agents.length : 0)));
    tweenNum(pulse.done, nDone); tweenNum(pulse.total, agents.length); tweenNum(pulse.runN, nRun);
    pulse.dot.classList.toggle('on', nRun > 0 && live);
    // reconciled verdict events win over raw lens verdicts (same rule as the stat tiles)
    var cnt = { ok: 0, warn: 0, weak: 0, bad: 0, na: 0 };
    var recon = {};
    st.events.forEach(function (e) { if (e.kind === 'verdict') recon[e.subject || e.seq] = e; });
    var rk = Object.keys(recon);
    if (rk.length) {
      rk.forEach(function (k) { var c = H.verdictClass(recon[k].data.overall || recon[k].data.verdict); cnt[c in cnt ? c : 'na']++; });
      var claims = st.events.filter(function (e) { return e.kind === 'claim' && !recon[e.subject]; }).length;
      cnt.na += claims;
      pulse.cap.textContent = mode().cap;
    } else {
      agents.forEach(function (a) { var c = agentCls(a); cnt[c in cnt ? c : 'na']++; });
      pulse.cap.textContent = 'Verdict mix — per lens agent, until reconciled';
    }
    Object.keys(cnt).forEach(function (k) {
      pulse.counts[k].parentNode.hidden = k !== 'na' && mode().keys.indexOf(k) < 0 && !cnt[k];
      pulse.segs[k].style.flexGrow = cnt[k];
      pulse.segs[k].hidden = !cnt[k];
      tweenNum(pulse.counts[k], cnt[k]);
    });
  }
  function tickClock(now) {
    if (!pulse || !ST) return;
    var start = ST.events.length ? ST.events[0].ts : now;
    var end = ST.events.filter(function (e) { return e.kind === 'run.end'; }).pop();
    var last = ST.events.length ? ST.events[ST.events.length - 1].ts : now;
    pulse.clock.textContent = fmtDur((end ? end.ts : live ? now : last) - start);
  }

  // ---- map: the court as a flow graph ---------------------------------------
  var map = null;
  function buildGraph(st) {
    var nodes = {}, order = [], edges = [];
    function add(n) { if (!nodes[n.id]) { nodes[n.id] = n; order.push(n); } return nodes[n.id]; }
    var claims = [], cIdx = {}, cText = {}, recon = {}, phases = [], ruling = null, decision = null;
    function addClaim(s) { if (s && !(s in cIdx)) { cIdx[s] = claims.length; claims.push(s); } }
    function addPhase(p) { if (p && phases.indexOf(p) < 0) phases.push(p); }
    st.events.forEach(function (e) {
      if (e.kind === 'claim' && e.subject) { addClaim(e.subject); cText[e.subject] = (e.data || {}).text; }
      if (e.kind === 'verdict' && e.subject) recon[e.subject] = e;
      if (e.kind === 'phase.start') addPhase((e.data || {}).title || e.phase);
      if (e.kind === 'ruling') ruling = e;
      if (e.kind === 'decision') decision = e;
    });
    // "<lens>:<subject>" labels attach to a claim row. Once the run declares claims, only a
    // suffix naming a declared claim counts — "maker:perf-research" must not invent a row.
    var declared = claims.length > 0;
    var parsed = st.agents.map(function (a) {
      var i = (a.label || '').indexOf(':');
      addPhase(a.phase || 'Agents');
      var subj = i > 0 ? a.label.slice(i + 1) : null;
      if (subj && declared && !(subj in cIdx)) subj = null;
      var p = { a: a, subj: subj, lens: subj ? a.label.slice(0, i) : null };
      if (p.subj) addClaim(p.subj);
      return p;
    });
    var cols = [];
    if (claims.length) cols.push({ key: '__claims', title: mode().rows });
    phases.forEach(function (p) {
      if (parsed.some(function (x) { return (x.a.phase || 'Agents') === p; })) cols.push({ key: p, title: p });
    });
    if (ruling || decision) cols.push({ key: '__out', title: 'Outcome' });
    function colOf(key) { for (var i = 0; i < cols.length; i++) if (cols[i].key === key) return i; return 0; }

    claims.forEach(function (c) {
      var r = recon[c];
      add({ id: 'c:' + c, kind: 'claim', col: 0, subj: c, label: shortId(c), title: c, text: cText[c],
            cls: r ? H.verdictClass(r.data.overall || r.data.verdict) : 'na', seq: r ? r.seq : null,
            verdict: r ? (r.data.overall || r.data.verdict) : null });
    });
    parsed.forEach(function (p) {
      add({ id: 'a:' + p.a.agentId, kind: 'agent', col: colOf(p.a.phase || 'Agents'), subj: p.subj, lens: p.lens,
            label: p.a.label, cls: agentCls(p.a), agent: p.a });
    });
    var oc = cols.length - 1;
    if (ruling) add({ id: 'o:ruling', kind: 'out', col: oc, label: 'RULING', cls: 'done', seq: ruling.seq, text: H.textOf(ruling) });
    if (decision) {
      var v = decision.data.value || decision.data.decision || '?';
      add({ id: 'o:decision', kind: 'out', col: oc, label: String(v).toUpperCase(), cls: H.verdictClass(v),
            seq: decision.seq, text: decision.data.rationale || decision.data.text });
    }
    var byCol = cols.map(function () { return []; });
    order.forEach(function (n) { byCol[n.col].push(n); });
    var hasOut = {};
    function edge(a, b) { edges.push({ id: a.id + '>' + b.id, from: a, to: b }); hasOut[a.id] = 1; }
    order.forEach(function (n) {
      if (n.kind !== 'agent' || n.col === 0) return;
      var src = [], c;
      if (n.subj) for (c = n.col - 1; c >= 0 && !src.length; c--) src = byCol[c].filter(function (m) { return m.subj === n.subj; });
      for (c = n.col - 1; c >= 0 && !src.length; c--) src = byCol[c].slice();   // fan-in: synthesis / judge
      src.slice(0, 48).forEach(function (m) { edge(m, n); });
    });
    if (ruling || decision) {
      var first = nodes[ruling ? 'o:ruling' : 'o:decision'];
      var feeders = order.filter(function (n) { return n.col < oc && n.kind === 'agent' && !hasOut[n.id]; });
      if (!feeders.length) feeders = byCol[oc - 1] || [];
      feeders.slice(0, 48).forEach(function (m) { edge(m, first); });
      if (ruling && decision) edge(nodes['o:ruling'], nodes['o:decision']);
    }
    return { nodes: nodes, order: order, edges: edges, cols: cols, byCol: byCol, claims: claims, cIdx: cIdx };
  }

  function layout(g, W) {
    var top = 44, padX = 64, n = g.cols.length;
    var stack = 1;
    g.order.forEach(function (x) {
      if (!x.subj) return;
      var k = g.byCol[x.col].filter(function (m) { return m.subj === x.subj; });
      x.k = k.indexOf(x); x.kn = k.length;
      stack = Math.max(stack, k.length);
    });
    var rowH = Math.max(44, stack * 20 + 14);
    var free = g.byCol.map(function (col) { return col.filter(function (x) { return !x.subj; }); });
    var maxFree = Math.max.apply(null, free.map(function (f) { return f.length; }).concat([1]));
    var plotH = Math.max(g.claims.length * rowH, maxFree * 30, 120);
    g.order.forEach(function (x) {
      x.x = n > 1 ? padX + x.col * (W - 2 * padX) / (n - 1) : W / 2;
      if (x.subj) x.y = top + (g.cIdx[x.subj] + 0.5) * rowH + ((x.k || 0) - ((x.kn || 1) - 1) / 2) * 20;
    });
    free.forEach(function (f) {
      var gap = Math.min(plotH / f.length, 44);
      f.forEach(function (x, i) { x.y = top + plotH / 2 + (i - (f.length - 1) / 2) * gap; });
    });
    return { H: top + plotH + 18, padX: padX };
  }

  function nodeTip(ev, n) {
    if (n.kind === 'agent') {
      var a = n.agent, r = a.result && typeof a.result === 'object' ? a.result : null;
      var dur = a.startedAt ? fmtDur((a.finishedAt || Date.now()) - a.startedAt) : null;
      showTip(ev, a.label, [lab(n.cls) + (H.verdictOf(a) ? ' · ' + H.verdictOf(a) : ''), dur && ((a.finishedAt ? 'took ' : 'running ') + dur),
        r && r.headline ? trunc(r.headline, 200) : null, 'click for the full result']);
    } else if (n.kind === 'claim') {
      showTip(ev, n.title, [n.verdict ? 'reconciled: ' + n.verdict : 'not reconciled yet', trunc(n.text, 200)]);
    } else showTip(ev, n.label, [trunc(n.text, 240)]);
  }

  function renderMap(host, st) {
    var g = buildGraph(st);
    document.getElementById('sec-map').hidden = !g.order.length;
    if (!g.order.length) return;
    if (!map) {
      host.textContent = '';
      var s = svg('svg', { class: 'mapsvg', role: 'img', 'aria-label': 'Flow of the run: claims, agents, ruling, decision' }, host);
      map = { svg: s, head: svg('g', {}, s), edges: svg('g', {}, s), parts: svg('g', {}, s), nodes: svg('g', {}, s),
              n: {}, e: {}, bursts: [] };
      legend(document.getElementById('map-legend'), ['run'].concat(mode().keys, ['done', 'na']));
    }
    var W = Math.max(680, host.clientWidth || 680, g.cols.length * 112), lay = layout(g, W);
    map.svg.setAttribute('viewBox', '0 0 ' + W + ' ' + lay.H);
    map.svg.setAttribute('width', W); map.svg.setAttribute('height', lay.H);
    // column headers
    map.head.textContent = '';
    g.cols.forEach(function (c, i) {
      var col = g.byCol[i], x = g.cols.length > 1 ? lay.padX + i * (W - 2 * lay.padX) / (g.cols.length - 1) : W / 2;
      var fin = col.filter(function (m) { return m.kind !== 'agent' || m.cls !== 'run' && m.cls !== 'na'; }).length;
      var t = svg('text', { x: x, y: 16, class: 'mhead', 'text-anchor': 'middle' }, map.head);
      t.textContent = c.title;
      var t2 = svg('text', { x: x, y: 31, class: 'msub', 'text-anchor': 'middle' }, map.head);
      t2.textContent = c.key === '__claims'
        ? (mode().labels.ok ? col.filter(function (m) { return m.cls === 'ok'; }).length : col.filter(function (m) { return m.verdict; }).length)
          + ' of ' + col.length + ' ' + mode().done
        : c.key === '__out' ? '' : fin + ' of ' + col.length + ' done';
    });
    // nodes (diffed: keep elements so colour/position transitions animate)
    var seen = {}, popped = [];
    g.order.forEach(function (n) {
      seen[n.id] = 1;
      var rec = map.n[n.id];
      if (!rec) {
        rec = map.n[n.id] = { g: svg('g', { class: 'mnode mnode-' + n.kind + ' enter', tabindex: '0' }, map.nodes), cls: null };
        if (n.kind === 'agent') {
          svg('circle', { r: 12, class: 'halo' }, rec.g);
          svg('circle', { r: 7, class: 'core' }, rec.g);
        } else {
          var w = n.kind === 'out' ? 96 : 56, hh = n.kind === 'out' ? 26 : 20;
          svg('rect', { x: -w / 2, y: -hh / 2, width: w, height: hh, rx: hh / 2, class: 'core' }, rec.g);
          rec.text = svg('text', { class: 'mlabel', 'text-anchor': 'middle', dy: '0.35em' }, rec.g);
        }
        rec.g.addEventListener('mousemove', function (ev) { nodeTip(ev, rec.n); });
        rec.g.addEventListener('mouseleave', hideTip);
        rec.g.addEventListener('click', function () {
          hideTip();
          if (rec.n.kind === 'agent') H.open({ agent: rec.n.agent.agentId });
          else if (rec.n.seq != null) H.open({ seq: rec.n.seq });
        });
        rec.g.addEventListener('keydown', function (ev) { if (ev.key === 'Enter') rec.g.dispatchEvent(new MouseEvent('click')); });
        rec.g.style.transform = 'translate(' + n.x + 'px,' + n.y + 'px)';
      }
      rec.n = n;
      rec.g.style.transform = 'translate(' + n.x + 'px,' + n.y + 'px)';
      if (rec.text) rec.text.textContent = n.label;
      if (rec.cls !== n.cls) {
        if (rec.cls && n.cls !== 'run' && n.cls !== 'na') { popped.push(n.id); pop(rec.g); }
        rec.g.style.setProperty('--vc', C[n.cls]);
        rec.g.style.setProperty('--vca', alpha(C[n.cls], n.kind === 'agent' ? 0.35 : 0.18));
        rec.g.classList.toggle('is-run', n.cls === 'run');
        rec.g.classList.toggle('is-na', n.cls === 'na');
        rec.cls = n.cls;
      }
    });
    Object.keys(map.n).forEach(function (id) { if (!seen[id]) { map.n[id].g.remove(); delete map.n[id]; } });
    // edges
    var eSeen = {};
    g.edges.forEach(function (e) {
      eSeen[e.id] = 1;
      var x1 = e.from.x + (e.from.kind === 'agent' ? 8 : e.from.kind === 'out' ? 48 : 28), y1 = e.from.y;
      var x2 = e.to.x - (e.to.kind === 'agent' ? 8 : e.to.kind === 'out' ? 48 : 28), y2 = e.to.y, mx = (x1 + x2) / 2;
      var d = e.from.col === e.to.col   // ruling -> decision stack in one column: a short vertical drop
        ? 'M' + e.from.x + ',' + (e.from.y + 13) + ' L' + e.to.x + ',' + (e.to.y - 13)
        : 'M' + x1 + ',' + y1 + ' C' + mx + ',' + y1 + ' ' + mx + ',' + y2 + ' ' + x2 + ',' + y2;
      var rec = map.e[e.id], fresh = !rec;
      if (fresh) rec = map.e[e.id] = { p: svg('path', { class: 'medge' }, map.edges), parts: [] };
      rec.p.setAttribute('d', d);
      rec.e = e;
      var liveEdge = e.to.cls === 'run';
      rec.p.classList.toggle('live', liveEdge && !REDUCED);
      rec.p.style.stroke = liveEdge ? '' : e.to.cls === 'na' ? '' : alpha(C[e.to.cls], 0.32);
      if (fresh && !REDUCED && !liveEdge) {   // draw the edge in
        var len = rec.p.getTotalLength();
        rec.p.style.strokeDasharray = len; rec.p.style.strokeDashoffset = len;
        rec.p.getBoundingClientRect();
        rec.p.style.transition = 'stroke-dashoffset .9s cubic-bezier(.28,.11,.32,1)';
        rec.p.style.strokeDashoffset = 0;
        rec.p.addEventListener('transitionend', function once() {
          rec.p.style.strokeDasharray = ''; rec.p.style.strokeDashoffset = ''; rec.p.style.transition = '';
          rec.p.removeEventListener('transitionend', once);
        });
      }
      var want = liveEdge && !REDUCED ? 2 : 0;
      while (rec.parts.length < want) rec.parts.push(svg('circle', { r: 2.4, class: 'mpart' }, map.parts));
      while (rec.parts.length > want) rec.parts.pop().remove();
    });
    Object.keys(map.e).forEach(function (id) {
      if (!eSeen[id]) { map.e[id].p.remove(); map.e[id].parts.forEach(function (p) { p.remove(); }); delete map.e[id]; }
    });
    // a result landing sends a burst downstream along its outgoing edges
    if (!REDUCED) popped.forEach(function (id) {
      Object.keys(map.e).forEach(function (eid) {
        var r = map.e[eid];
        if (r.e.from.id === id) map.bursts.push({ p: r.p, t0: performance.now(), c: C[r.e.from.cls] || C.done,
          el: svg('circle', { r: 3.4, class: 'mburst' }, map.parts) });
      });
    });
  }
  function pop(g) {
    if (REDUCED) return;
    g.classList.remove('pop');
    void g.getBoundingClientRect();
    g.classList.add('pop');
  }
  function mapFrame(now) {
    if (!map) return;
    Object.keys(map.e).forEach(function (id) {
      var r = map.e[id];
      if (!r.parts.length) return;
      var len = r.p.getTotalLength(), off = (id.length * 0.137) % 1;
      r.parts.forEach(function (c, k) {
        var pt = r.p.getPointAtLength(len * ((now / 1500 + off + k / r.parts.length) % 1));
        c.setAttribute('cx', pt.x); c.setAttribute('cy', pt.y);
      });
    });
    map.bursts = map.bursts.filter(function (b) {
      var k = (now - b.t0) / 900;
      if (k >= 1) { b.el.remove(); return false; }
      var pt = b.p.getPointAtLength(b.p.getTotalLength() * (1 - Math.pow(1 - k, 2)));
      b.el.setAttribute('cx', pt.x); b.el.setAttribute('cy', pt.y);
      b.el.setAttribute('fill', b.c); b.el.setAttribute('opacity', 1 - k * 0.6);
      return true;
    });
  }

  // ---- timeline: swimlanes --------------------------------------------------
  var tl = null;
  var MARKS = { 'phase.start': 'phase', ruling: 'ruling', decision: 'decision', 'question.ask': 'agent asks',
                'user.ask': 'you asked', 'user.answer': 'you answered', 'flag.contest': 'you contested', reply: 'agent replied' };
  function renderTimeline(host, st) {
    var agents = st.agents.filter(function (a) { return a.startedAt; });
    var nMarks = st.events.filter(function (e) { return MARKS[e.kind]; }).length;
    // dialogue-shaped runs (deep-research) have few or no agents: the rail of phases + questions is the story
    document.getElementById('sec-timeline').hidden = !agents.length && nMarks < 2;
    if (!agents.length && nMarks < 2) return;
    if (!tl) {
      host.textContent = '';
      var s = svg('svg', { class: 'tlsvg' }, host);
      tl = { svg: s, grid: svg('g', {}, s), lanes: svg('g', {}, s), marks: svg('g', {}, s),
             cross: svg('line', { class: 'tl-cross', y1: 0 }, s), bars: {}, sig: '' };
      tl.cross.style.display = 'none';
      s.addEventListener('mousemove', function (ev) {
        var r = s.getBoundingClientRect(), x = ev.clientX - r.left;
        if (x < tl.gut) { tl.cross.style.display = 'none'; return; }
        tl.cross.style.display = ''; tl.cross.setAttribute('x1', x); tl.cross.setAttribute('x2', x);
        var t = tl.t0 + (x - tl.gut) / (tl.W - tl.gut - 16) * (tl.t1 - tl.t0);
        var nRun = ST.agents.filter(function (a) { return a.startedAt && a.startedAt <= t && (!a.finishedAt || a.finishedAt > t); }).length;
        var nDone = ST.agents.filter(function (a) { return a.finishedAt && a.finishedAt <= t; }).length;
        showTip(ev, '+' + fmtDur(t - tl.t0), [nRun + ' working · ' + nDone + ' returned']);
      });
      s.addEventListener('mouseleave', function () { tl.cross.style.display = 'none'; hideTip(); });
      legend(document.getElementById('tl-legend'), ['run'].concat(mode().keys, ['done']));
    }
    // rows: a phase header, then one lane per agent. Loop runs instead get one lane per
    // iteration ("2.1 make" + "2.1 verify" share lane "2.1"), maker and verifier side by side.
    var rows = [], lanes = {};
    if (isLoop()) {
      agents.slice().sort(function (a, b) { return a.startedAt - b.startedAt; }).forEach(function (a) {
        var key = String(a.phase || 'Agents').replace(/\s+(make|verify)$/, '');
        if (!lanes[key]) rows.push(lanes[key] = { lane: key, agents: [] });
        lanes[key].agents.push(a);
      });
    } else {
      var phases = [];
      agents.forEach(function (a) { var p = a.phase || 'Agents'; if (phases.indexOf(p) < 0) phases.push(p); });
      phases.forEach(function (p) {
        rows.push({ head: p });
        agents.filter(function (a) { return (a.phase || 'Agents') === p; })
          .sort(function (a, b) { return a.startedAt - b.startedAt; })
          .forEach(function (a) { rows.push({ lane: a.label, agents: [a] }); });
      });
    }
    var answered = {};
    st.events.forEach(function (e) { if ((e.kind === 'question.answer' || e.kind === 'user.answer') && e.data && e.data.ref != null) answered[e.data.ref] = answered[e.data.ref] || e; });
    var qs = st.events.filter(function (e) { return e.kind === 'question.ask'; });
    if (qs.length) {
      rows.push({ head: 'Waiting on you' });
      qs.forEach(function (e) {
        var ans = answered[e.seq];
        rows.push({ lane: trunc(e.data.text, 60), agents: [{ agentId: 'q' + e.seq, label: e.data.text, question: true,
          startedAt: e.ts, finishedAt: ans ? ans.ts : null, state: ans ? 'done' : 'running', answer: ans ? ans.data.text : null, seq: e.seq }] });
      });
    }
    var W = Math.max(680, host.clientWidth || 680), gut = Math.min(220, W * 0.3), rail = 26, rowH = 16;
    var Hh = rail + rows.reduce(function (s2, r) { return s2 + (r.head ? 22 : rowH); }, 0) + 26;
    tl.W = W; tl.gut = gut; tl.H = Hh; tl.rail = rail;
    tl.svg.setAttribute('viewBox', '0 0 ' + W + ' ' + Hh);
    tl.svg.setAttribute('width', W); tl.svg.setAttribute('height', Hh);
    tl.cross.setAttribute('y2', Hh - 20);
    // lanes: rebuild labels; keep bar elements so colour transitions animate
    tl.lanes.textContent = '';
    var y = rail, seen = {};
    rows.forEach(function (r) {
      if (r.head) {
        var t = svg('text', { x: 0, y: y + 15, class: 'tl-phase' }, tl.lanes); t.textContent = r.head;
        svg('line', { x1: gut, x2: W - 16, y1: y + 11, y2: y + 11, class: 'tl-sep' }, tl.lanes);
        y += 22; return;
      }
      var laneText = isLoop() ? r.lane + ' · ' + String(r.agents[0].label).replace(/^maker:/, '') : r.lane;
      var lab = svg('text', { x: 8, y: y + 11, class: 'tl-label' }, tl.lanes); lab.textContent = trunc(laneText, Math.floor(gut / 6.6));
      r.agents.forEach(function (a) { laneBar(a, y); });
      y += rowH;
    });
    function laneBar(a, y) {
      var cls = a.question ? (a.finishedAt ? 'done' : 'run') : agentCls(a);
      var rec = tl.bars[a.agentId];
      if (!rec) {
        rec = tl.bars[a.agentId] = { el: svg('rect', { height: 8, rx: 4, class: 'tl-bar' }, tl.marks) };
        rec.el.addEventListener('mousemove', function (ev) {
          ev.stopPropagation();
          var aa = rec.a;
          if (aa.question) return showTip(ev, trunc(aa.label, 120), [aa.finishedAt
            ? 'answered after ' + fmtDur(aa.finishedAt - aa.startedAt) + ': ' + trunc(aa.answer, 80)
            : 'waiting on you for ' + fmtDur(Date.now() - aa.startedAt)]);
          showTip(ev, aa.label, [lab(agentCls(aa)) + (H.verdictOf(aa) ? ' · ' + H.verdictOf(aa) : ''),
            (aa.finishedAt ? 'took ' : 'running ') + fmtDur((aa.finishedAt || Date.now()) - aa.startedAt)]);
        });
        rec.el.addEventListener('mouseleave', hideTip);
        rec.el.addEventListener('click', function () { rec.a.question ? H.open({ seq: rec.a.seq }) : H.open({ agent: rec.a.agentId }); });
      }
      rec.a = a; rec.y = y + 4; seen[a.agentId] = 1;
      rec.el.setAttribute('y', rec.y);
      rec.el.style.fill = C[cls];
      rec.el.classList.toggle('running', cls === 'run');
    }
    Object.keys(tl.bars).forEach(function (id) { if (!seen[id]) { tl.bars[id].el.remove(); delete tl.bars[id]; } });
    // event markers on the rail (+ a faint rule through the lanes for phase/ruling/decision)
    tl.evs = st.events.filter(function (e) { return MARKS[e.kind]; });
    tl.evEls = tl.evEls || {};
    tl.evs.forEach(function (e) {
      if (tl.evEls[e.seq]) return;
      var g = svg('g', { class: 'tl-mark tl-' + e.kind.replace('.', '-') }, tl.marks);
      if (e.kind === 'phase.start' || e.kind === 'ruling' || e.kind === 'decision') svg('line', { y1: rail - 4, y2: Hh - 22, class: 'tl-rule' }, g);
      if (e.kind === 'ruling' || e.kind === 'decision') svg('rect', { x: -5, y: 6, width: 10, height: 10, transform: 'rotate(45 0 11)', class: 'tl-sym' }, g);
      else if (e.kind === 'flag.contest') svg('path', { d: 'M0,5 L6,16 L-6,16 Z', class: 'tl-sym' }, g);
      else if (e.kind === 'phase.start') svg('rect', { x: -1.5, y: 5, width: 3, height: 12, class: 'tl-sym' }, g);
      else svg('circle', { cy: 11, r: 4.5, class: 'tl-sym' }, g);
      if (e.kind === 'decision') g.style.setProperty('--mc', C[H.verdictClass(e.data.value || e.data.decision)]);
      g.addEventListener('mousemove', function (ev) {
        ev.stopPropagation();
        showTip(ev, MARKS[e.kind] + ' · #' + e.seq, [trunc(H.textOf(e) || (e.data && (e.data.title || e.data.value)), 220)]);
      });
      g.addEventListener('mouseleave', hideTip);
      g.addEventListener('click', function () { H.open({ seq: e.seq }); });
      if (!REDUCED) g.classList.add('enter');
      tl.evEls[e.seq] = { g: g, e: e };
    });
    Object.keys(tl.evEls).forEach(function (k) {   // re-extend rules when the lane count grows
      var line = tl.evEls[k].g.querySelector('.tl-rule');
      if (line) line.setAttribute('y2', Hh - 22);
    });
    tlFrame(Date.now());
  }
  function niceStep(ms) {
    var steps = [1e3, 2e3, 5e3, 1e4, 15e3, 3e4, 6e4, 12e4, 3e5, 6e5, 9e5, 18e5, 36e5, 72e5, 216e5, 864e5];
    for (var i = 0; i < steps.length; i++) if (ms / steps[i] <= 7) return steps[i];
    return Math.ceil(ms / 7);   // never more than ~8 ticks, whatever the span
  }
  function tlFrame(now) {
    if (!tl || !ST || !tl.W) return;
    var starts = ST.agents.filter(function (a) { return a.startedAt; }).map(function (a) { return a.startedAt; });
    var t0 = Math.min.apply(null, starts.concat(ST.events.length ? [ST.events[0].ts] : [now]));
    // span = agent activity + marked events only; a later bookkeeping event (report export) must not stretch it
    var ends = Object.keys(tl.bars).map(function (id) { var a = tl.bars[id].a; return a.finishedAt || a.startedAt || 0; })
      .concat(ST.events.filter(function (e) { return MARKS[e.kind]; }).map(function (e) { return e.ts; }));
    // follow the clock only while agents work; an idle open run shouldn't squash the bars leftward
    var working = ST.agents.some(function (a) { return a.state === 'running' && a.result == null; }) ||
      Object.keys(tl.bars).some(function (id) { return tl.bars[id].a.question && !tl.bars[id].a.finishedAt; });
    var t1 = live && working ? now : Math.max.apply(null, ends);
    t1 += (t1 - t0) * 0.03;
    if (t1 - t0 < 5000) t1 = t0 + 5000;
    tl.t0 = t0; tl.t1 = t1;
    var gut = tl.gut, x1 = tl.W - 16;
    function xs(t) { return gut + (t - t0) / (t1 - t0) * (x1 - gut); }
    Object.keys(tl.bars).forEach(function (id) {
      var r = tl.bars[id], a = r.a, s = xs(a.startedAt), e = xs(a.finishedAt || Math.min(now, t1));
      r.el.setAttribute('x', s); r.el.setAttribute('width', Math.max(3, e - s));
    });
    Object.keys(tl.evEls).forEach(function (k) {
      var m = tl.evEls[k];
      m.g.setAttribute('transform', 'translate(' + xs(m.e.ts) + ',0)');
    });
    // axis: rebuild only when the tick set changes
    var step = niceStep(t1 - t0), sig = step + ':' + Math.floor((t1 - t0) / step);
    if (sig !== tl.sig || !live) {
      tl.sig = sig;
      tl.grid.textContent = '';
      for (var t = 0; t <= t1 - t0; t += step) {
        var x = xs(t0 + t);
        svg('line', { x1: x, x2: x, y1: tl.rail - 4, y2: tl.H - 22, class: 'tl-grid' }, tl.grid);
        var lb = svg('text', { x: x, y: tl.H - 6, class: 'tl-tick', 'text-anchor': 'middle' }, tl.grid);
        lb.textContent = '+' + fmtDur(t);
      }
    } else {
      var i = 0;
      [].forEach.call(tl.grid.querySelectorAll('line'), function (ln) { var x = xs(t0 + i * step); ln.setAttribute('x1', x); ln.setAttribute('x2', x); i++; });
      i = 0;
      [].forEach.call(tl.grid.querySelectorAll('text'), function (tx) { tx.setAttribute('x', xs(t0 + i * step)); i++; });
    }
  }

  // ---- loop -------------------------------------------------------------------
  var looping = false;
  function loop(now) {
    if (!live || document.hidden) { looping = false; return; }
    mapFrame(now); tlFrame(Date.now()); tickClock(Date.now());
    requestAnimationFrame(loop);
  }
  function kick() { if (!looping && live && !REDUCED) { looping = true; requestAnimationFrame(loop); } }
  document.addEventListener('visibilitychange', kick);
  var resizeT = 0;
  window.addEventListener('resize', function () {
    clearTimeout(resizeT);
    resizeT = setTimeout(function () { if (ST) window.LiveViz.update(ST, H, live); }, 150);
  });

  window.LiveViz = {
    update: function (state, helpers, isLive) {
      ST = state; H = helpers; live = !!isLive;
      renderPulse(document.getElementById('pulse'), state);
      renderMap(document.getElementById('map'), state);
      renderTimeline(document.getElementById('timeline'), state);
      tickClock(Date.now());
      if (REDUCED || !live) { mapFrame(performance.now()); tlFrame(Date.now()); }
      kick();
    }
  };
})();
