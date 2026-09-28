/* live-view run shell. Live mode polls /api/runs/<id>/{events,agents}; report
 * mode (window.__RUN__ embedded by runs.report) renders the frozen state once.
 * Bespoke per-run panels register through LiveView.panel(name, {title, render}).
 * All agent/user text goes through textContent — never innerHTML. */
(function () {
  'use strict';
  var REPORT = !!window.__RUN__;
  var RUN_ID = REPORT ? window.__RUN__.view.id : decodeURIComponent((location.pathname.split('/')[2] || ''));
  var state = REPORT ? window.__RUN__ : { view: null, events: [], agents: [] };
  var lastSeq = 0, panels = [], dirty = true, drawerFor = null;

  // ---- helpers ----------------------------------------------------------
  function h(tag, attrs) {
    var el = document.createElement(tag);
    for (var k in (attrs || {})) {
      var v = attrs[k];
      if (v == null || v === false) continue;
      if (k === 'class') el.className = v;
      else if (k === 'text') el.textContent = v;
      else if (k.slice(0, 2) === 'on') el.addEventListener(k.slice(2), v);
      else el.setAttribute(k, v === true ? '' : v);
    }
    for (var i = 2; i < arguments.length; i++) {
      var c = arguments[i];
      if (c == null || c === false) continue;
      [].concat(c).forEach(function (x) { el.appendChild(typeof x === 'string' ? document.createTextNode(x) : x); });
    }
    return el;
  }
  function rich(text) {
    var out = [];
    String(text || '').split(/(\*\*[^*]+\*\*|`[^`]+`)/).forEach(function (part) {
      if (/^\*\*[^*]+\*\*$/.test(part)) out.push(h('b', null, part.slice(2, -2)));
      else if (/^`[^`]+`$/.test(part)) out.push(h('code', { class: 'mono' }, part.slice(1, -1)));
      else if (part) out.push(part.replace(/\*([^*\n]+)\*/g, '$1'));
    });
    return out;
  }
  function clamped(text) {
    var el = h('div', { class: 'text' }, rich(text));
    if (String(text).length > 420) {
      el.classList.add('clamp');
      el.title = 'Click to expand';
      el.addEventListener('click', function () { el.classList.toggle('clamp'); });
    }
    return el;
  }
  function $(id) { return document.getElementById(id); }
  function clear(el) { while (el.firstChild) el.removeChild(el.firstChild); return el; }
  function ago(ts) {
    var s = Math.max(0, Math.round((Date.now() - ts) / 1000));
    return s < 60 ? s + 's ago' : s < 3600 ? Math.round(s / 60) + 'm ago' : new Date(ts).toLocaleString();
  }
  function clock(ts) { return new Date(ts).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit', second: '2-digit' }); }

  // verdict vocabulary across idea-court + loop-system → five classes
  function verdictClass(v) {
    v = String(v || '').toUpperCase();
    if (!v) return 'na';
    if (/REFUTED|CONTRADICTED|NO-GO|NOGO|FAIL|KILL|FABRICATED/.test(v)) return 'bad';
    if (/WEAKENED|UNSUPPORTED|OVERSTATED|MISCITED/.test(v)) return 'weak';
    if (/CAVEAT|HOLD\b|PARTIAL|UNTESTABLE|UNPROVABLE|PENDING|DEFERRED/.test(v)) return 'warn';
    if (/VERIFIED|HOLDS|SUPPORTED|PASS|GO\b|^GO$|OK|ADDRESSED|COVERED|ANSWERED/.test(v)) return 'ok';
    return 'na';
  }
  function verdictOf(a) {
    var r = a.result;
    if (r && typeof r === 'object') return r.overall || r.verdict || r.decision || a.summary || null;
    return a.summary || null;
  }
  function textOf(e) {
    var d = e.data || {};
    return d.text || d.headline || d.rationale || d.summary || d.claim || d.title || '';
  }

  // ---- derived views ------------------------------------------------------
  function bySeq() {
    var m = {};
    state.events.forEach(function (e) { m[e.seq] = e; });
    return m;
  }
  function repliesTo(ref) {
    return state.events.filter(function (e) {
      return e.data && e.data.ref != null && String(e.data.ref) === String(ref) && e.seq !== ref;
    });
  }
  function ended() { return state.events.some(function (e) { return e.kind === 'run.end'; }); }

  // ---- inbox (page -> orchestrator) ----------------------------------------
  function post(kind, text, ref) {
    if (REPORT || !text || !text.trim()) return Promise.resolve();
    return fetch('/api/runs/' + encodeURIComponent(RUN_ID) + '/inbox', {
      method: 'POST', headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ kind: kind, text: text, ref: ref == null ? null : ref })
    }).then(function (r) { return r.json(); }).then(function () { poll(); });
  }
  function askForm(ref, placeholder) {
    var input = h('input', { type: 'text', placeholder: placeholder || 'Ask why, or contest it', 'aria-label': 'Message' });
    return h('form', { class: 'inline-form', onsubmit: function (ev) { ev.preventDefault(); post('user.ask', input.value, ref); input.value = ''; } },
      input,
      h('button', { class: 'btn btn-sm', type: 'submit' }, 'Ask'),
      h('button', { class: 'nav-btn', type: 'button', onclick: function () { post('flag.contest', input.value || 'contested', ref); input.value = ''; } }, 'Contest'));
  }

  // ---- render ---------------------------------------------------------------
  function renderHeader() {
    var v = state.view || {};
    document.title = (v.title || 'live-view') + (REPORT ? ' — report' : ' — live');
    $('nav-run').textContent = v.id || '';
    $('skill').textContent = v.skill || '';
    $('title').textContent = v.title || RUN_ID;
    var running = state.agents.filter(function (a) { return a.state === 'running'; }).length;
    var phaseEv = state.events.filter(function (e) { return e.kind === 'phase.start'; }).pop();
    var phase = phaseEv ? (phaseEv.data.title || phaseEv.phase) : null;
    var bits = [];
    if (ended()) bits.push('Run complete');
    else if (phase) bits.push('Phase: ' + phase);
    if (running) bits.push(running + ' agent' + (running > 1 ? 's' : '') + ' working');
    var last = state.events[state.events.length - 1];
    if (last) bits.push('last event ' + (REPORT ? clock(last.ts) : ago(last.ts)));
    $('lede').textContent = bits.join(' · ');
    var dec = state.events.filter(function (e) { return e.kind === 'decision'; }).pop();
    var box = $('decision');
    if (dec) {
      var val = dec.data.value || dec.data.decision || '?';
      clear(box).appendChild(h('b', { class: 'v-' + verdictClass(val) }, String(val).toUpperCase()));
      box.appendChild(h('span', { class: 'body-copy' }, dec.data.rationale || dec.data.text || ''));
      box.hidden = false;
    } else box.hidden = true;
    var pill = $('conn');
    if (REPORT) { pill.className = 'pill pill-done'; pill.textContent = 'report'; }
    else if (ended()) { pill.className = 'pill pill-done'; pill.textContent = 'complete'; }
  }

  function renderStats() {
    var openQ = state.events.filter(function (e) { return e.kind === 'question.ask' && !repliesTo(e.seq).length; }).length;
    var yours = state.events.filter(function (e) { return e.kind === 'user.ask' && !repliesTo(e.seq).length; }).length;
    var contests = state.events.filter(function (e) { return e.kind === 'flag.contest'; }).length;
    var tiles = [
      [String(openQ), 'questions waiting on you'],
      [String(yours), 'your questions awaiting reply'],
      [String(contests), 'contested decisions']
    ];
    var el = clear($('stats'));
    tiles.forEach(function (t) { el.appendChild(h('div', { class: 'stat' }, h('div', { class: 'stat-value' }, t[0]), h('div', { class: 'stat-label' }, t[1]))); });
  }

  function renderCourt() {
    var order = [], groups = {};
    state.events.forEach(function (e) {
      var t = e.kind === 'phase.start' ? (e.data.title || e.phase) : null;
      if (t && !groups[t]) { groups[t] = []; order.push(t); }
    });
    state.agents.forEach(function (a) {
      var p = a.phase || 'Unphased';
      if (!groups[p]) { groups[p] = []; order.push(p); }
      groups[p].push(a);
    });
    $('sec-court').hidden = !order.length;
    var court = clear($('court'));
    order.forEach(function (p) {
      var list = groups[p];
      var done = list.filter(function (a) { return a.result != null || a.state === 'done'; }).length;
      var grid = h('div', { class: 'agents' });
      var col = h('div', { class: 'phase' }, h('h3', null, p), h('span', { class: 'caption' }, done + ' of ' + list.length + ' done'), grid);
      list.forEach(function (a) {
        var v = verdictOf(a), c = verdictClass(v);
        grid.appendChild(h('button', {
          type: 'button', class: 'agent b-' + c + (a.state === 'running' && a.result == null ? ' running' : ''),
          onclick: function () { openDrawer({ agent: a.agentId }); }
        },
          h('div', { class: 'lbl' }, a.label),
          h('div', { class: 'meta' }, v ? h('span', { class: 'chip c-' + c }, String(v).slice(0, 28)) : (a.state || 'queued'), a.model ? ' · ' + a.model : '')));
      });
      court.appendChild(col);
    });
  }

  var FEED_KINDS = { claim: 1, verdict: 1, ruling: 1, decision: 1, status: 1, note: 1, artifact: 1, 'phase.start': 1, 'workflow.bind': 1, 'run.start': 1, 'run.end': 1 };
  function renderDecisions() {
    var el = clear($('decisions'));
    state.events.filter(function (e) { return FEED_KINDS[e.kind]; }).slice().reverse().forEach(function (e) {
      var v = e.data.overall || e.data.verdict || e.data.value || null;
      var li = h('li', null,
        h('div', { class: 'head' },
          h('span', { class: 'chip c-' + verdictClass(v || (e.kind === 'ruling' ? 'x' : '')) }, e.kind),
          e.subject ? h('span', { class: 'mono' }, e.subject) : null,
          v ? h('b', { class: 'v-' + verdictClass(v) }, String(v)) : null,
          h('span', null, '#' + e.seq + ' · ' + clock(e.ts) + (e.phase ? ' · ' + e.phase : ''))),
        textOf(e) ? clamped(textOf(e)) : null);
      var thread = repliesTo(e.seq);
      if (thread.length) li.appendChild(h('div', { class: 'thread' }, thread.map(function (r) {
        return h('div', null, h('div', { class: 'head' }, h('span', { class: 'chip c-' + (r.kind === 'flag.contest' ? 'bad' : 'na') }, r.kind), h('span', null, r.actor)), h('div', { class: 'text' }, r.data.text || ''));
      })));
      li.appendChild(h('div', { class: 'acts' }, h('button', { type: 'button', class: 'act', onclick: function () { openDrawer({ seq: e.seq }); } }, 'Details, ask or contest')));
      el.appendChild(li);
    });
  }

  function renderQuestions() {
    var el = clear($('questions'));
    var seqs = bySeq();
    var items = state.events.filter(function (e) {
      return e.kind === 'question.ask' || ((e.kind === 'user.ask' || e.kind === 'flag.contest') &&
        (e.data.ref == null || !seqs[e.data.ref] || !FEED_KINDS[seqs[e.data.ref].kind]));
    });
    items.slice().reverse().forEach(function (e) {
      var fromAgent = e.kind === 'question.ask';
      var thread = repliesTo(e.seq);
      var li = h('li', { class: fromAgent && !thread.length ? 'pending' : null },
        h('div', { class: 'head' },
          h('span', { class: 'chip ' + (fromAgent ? 'c-weak' : e.kind === 'flag.contest' ? 'c-bad' : 'c-na') },
            fromAgent ? 'agent asks' : e.kind === 'flag.contest' ? 'you contested' : 'you asked'),
          e.data.ref != null ? h('span', { class: 'mono' }, 're ' + e.data.ref) : null,
          h('span', null, '#' + e.seq + ' · ' + clock(e.ts))),
        h('div', { class: 'text' }, e.data.text || ''));
      if (thread.length) li.appendChild(h('div', { class: 'thread' }, thread.map(function (r) {
        return h('div', null, h('div', { class: 'head' }, h('span', null, r.actor + ' · ' + r.kind)), h('div', { class: 'text' }, r.data.text || ''));
      })));
      if (fromAgent && !thread.length && !REPORT) {
        var opts = e.data.options || [];
        if (opts.length) li.appendChild(h('div', { class: 'opts' }, opts.map(function (o) {
          var label = typeof o === 'string' ? o : o.label;
          return h('button', { type: 'button', class: 'opt', onclick: function () { post('user.answer', label, e.seq); } }, label);
        })));
        var inp = h('input', { type: 'text', placeholder: 'Answer', 'aria-label': 'Answer' });
        li.appendChild(h('form', { class: 'inline-form', onsubmit: function (ev) { ev.preventDefault(); post('user.answer', inp.value, e.seq); } },
          inp, h('button', { class: 'btn btn-sm', type: 'submit' }, 'Answer')));
      }
      el.appendChild(li);
    });
    if (!items.length) el.appendChild(h('li', null, h('div', { class: 'text' }, 'No questions yet.')));
  }

  function renderPanels() {
    var host = $('panels');
    $('sec-panels').hidden = !panels.length;
    panels.forEach(function (p) {
      if (!p.el) { p.el = h('div', { class: 'panel' }); host.appendChild(p.el); }
      try {
        clear(p.el);
        if (p.spec.title) p.el.appendChild(h('h3', null, p.spec.title));
        var body = h('div');
        p.el.appendChild(body);
        p.spec.render(body, state, LiveView);
      } catch (err) {
        p.el.appendChild(h('div', { class: 'panel-err' }, 'panel ' + p.name + ' failed: ' + err.message));
      }
    });
  }

  function openDrawer(target) {
    drawerFor = target;
    var body = clear($('drawer-body'));
    if (target.agent) {
      var a = state.agents.filter(function (x) { return x.agentId === target.agent; })[0];
      if (!a) return;
      var v = verdictOf(a);
      body.appendChild(h('p', { class: 'eyebrow' }, a.phase || 'agent'));
      body.appendChild(h('h3', null, a.label));
      body.appendChild(h('div', { class: 'kv' }, h('b', null, 'State '), a.state || '?', a.model ? '  ·  ' + a.model : ''));
      if (v) body.appendChild(h('div', { class: 'kv' }, h('b', null, 'Verdict '), h('span', { class: 'v-' + verdictClass(v) }, String(v))));
      var r = a.result;
      if (r && typeof r === 'object') {
        ['headline', 'reasoning', 'rationale', 'surviving_core', 'next_test', 'design_change', 'steelman', 'weakest_assumption'].forEach(function (k) {
          if (r[k]) body.appendChild(h('div', { class: 'kv' }, h('b', null, k.replace(/_/g, ' ') + ' '), rich(r[k])));
        });
      }
      if (!REPORT) body.appendChild(askForm('agent:' + a.agentId));
      body.appendChild(h('pre', { class: 'code' }, r == null ? 'no result yet' : (typeof r === 'string' ? r : JSON.stringify(r, null, 2))));
    } else {
      var e = bySeq()[target.seq];
      if (!e) return;
      body.appendChild(h('p', { class: 'eyebrow' }, e.kind + ' · #' + e.seq));
      body.appendChild(h('h3', null, e.subject || textOf(e).slice(0, 80) || e.kind));
      if (!REPORT) body.appendChild(askForm(e.seq));
      body.appendChild(h('pre', { class: 'code' }, JSON.stringify(e.data, null, 2)));
    }
    $('drawer').hidden = false;
  }

  function render() {
    if (!dirty) return;
    var f = document.activeElement;
    if (f && f.tagName === 'INPUT' && f.value && f.id !== 'ask-text') return; // don't wipe a half-typed answer
    dirty = false;
    renderHeader(); renderStats(); renderCourt(); renderPanels(); renderDecisions(); renderQuestions();
    if (window.LiveViz) window.LiveViz.update(state, window.LiveView, !REPORT && !ended());
  }

  // ---- data -----------------------------------------------------------------
  function getJSON(u) { return fetch(u, { cache: 'no-store' }).then(function (r) { if (!r.ok) throw new Error(r.status); return r.json(); }); }
  var base = '/api/runs/' + encodeURIComponent(RUN_ID);
  function poll() {
    return getJSON(base + '/events?since=' + lastSeq).then(function (d) {
      state.view = d.view;
      if (d.events.length) { state.events = state.events.concat(d.events); lastSeq = d.events[d.events.length - 1].seq; dirty = true; }
      if (!ended()) { $('conn').className = 'pill pill-live'; $('conn').textContent = 'live'; }
    }).catch(function () { $('conn').className = 'pill pill-err'; $('conn').textContent = 'offline'; });
  }
  function pollAgents() {
    return getJSON(base + '/agents').then(function (d) {
      if (JSON.stringify(d.agents) !== JSON.stringify(state.agents)) { state.agents = d.agents; dirty = true; }
    }).catch(function () {});
  }
  function loadPanels() {
    return getJSON(base + '/panels').then(function (d) {
      return Promise.all(d.panels.map(function (name) {
        return new Promise(function (res) {
          var s = h('script', { src: base + '/panels/' + encodeURIComponent(name) });
          s.onload = s.onerror = res;
          document.body.appendChild(s);
        });
      }));
    }).catch(function () {});
  }

  function listRuns() {
    $('title').textContent = 'Runs';
    $('lede').textContent = 'Every monitored skill run on this machine.';
    $('runs-list').hidden = false;
    getJSON('/api/runs').then(function (d) {
      var ul = clear($('runs'));
      d.runs.forEach(function (v) {
        ul.appendChild(h('li', null, h('a', { href: '/runs/' + encodeURIComponent(v.id) }, v.title), h('div', { class: 'caption' }, v.skill + ' · ' + v.id + ' · ' + ago(v.created))));
      });
      if (!d.runs.length) ul.appendChild(h('li', { class: 'caption' }, 'No runs yet.'));
      $('conn').className = 'pill pill-idle'; $('conn').textContent = d.runs.length + ' runs';
    });
  }

  // ---- public API for bespoke panels ------------------------------------------
  window.LiveView = {
    panel: function (name, spec) {
      panels = panels.filter(function (p) { if (p.name === name && p.el) p.el.remove(); return p.name !== name; });
      panels.push({ name: name, spec: spec, el: null });
      dirty = true; render();
    },
    h: h, rich: rich, verdictClass: verdictClass, verdictOf: verdictOf, textOf: textOf,
    ask: function (text, ref) { return post('user.ask', text, ref); },
    contest: function (text, ref) { return post('flag.contest', text, ref); },
    open: openDrawer,
    get state() { return state; }
  };

  // ---- boot -------------------------------------------------------------------
  $('drawer-close').addEventListener('click', function () { $('drawer').hidden = true; drawerFor = null; });
  document.addEventListener('keydown', function (e) { if (e.key === 'Escape') { $('drawer').hidden = true; drawerFor = null; } });
  $('ask').addEventListener('submit', function (ev) { ev.preventDefault(); post('user.ask', $('ask-text').value, null); $('ask-text').value = ''; });

  if (REPORT) {
    document.body.classList.add('readonly');
    $('export').hidden = true;
    $('run-body').hidden = false;
    $('foot').textContent = 'Frozen report of run ' + RUN_ID + ' · ' + state.events.length + ' events · generated by mindgap live-view';
    render();
    return;
  }
  if (!RUN_ID) { $('export').hidden = true; return listRuns(); }
  $('run-body').hidden = false;
  $('export').addEventListener('click', function () {
    $('export').disabled = true;
    fetch(base + '/report', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: '{}' })
      .then(function (r) { return r.json(); })
      .then(function (d) { $('foot').textContent = 'Report written: ' + (d.path || d.error); poll(); })
      .finally(function () { $('export').disabled = false; });
  });
  Promise.all([poll(), pollAgents()]).then(loadPanels).then(render);
  setInterval(function () { if (!document.hidden) poll().then(render); }, 1000);
  setInterval(function () { if (!document.hidden) pollAgents().then(render); }, 2000);
  setInterval(function () { dirty = true; if (!drawerFor) render(); }, 15000); // refresh relative times
})();
