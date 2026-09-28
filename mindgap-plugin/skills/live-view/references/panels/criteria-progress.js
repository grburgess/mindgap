// live-view bespoke panel: loop-system criteria × iterations (convergence at a glance).
// Rows = GOAL §2 criteria (`claim` events, subject C<n>); columns = iterations, taken from
// `verdict` events' data.iteration in order of appearance; cell = that iteration's verdict.
// Blank cell = not re-checked that iteration. Reuse for any loop run.
(function () {
  if (!document.getElementById('cp-style')) {
    const s = document.createElement('style');
    s.id = 'cp-style';
    s.textContent = [
      '.cp-sum{margin:0 0 10px;color:#a1a1a6;font-size:13px}.cp-sum b{color:#f5f5f7}',
      '.cp-wrap{overflow-x:auto;border:1px solid rgba(255,255,255,.14);border-radius:12px;background:#161617}',
      '.cp-t{border-collapse:collapse;width:100%}',
      '.cp-t th,.cp-t td{border-bottom:1px solid rgba(255,255,255,.08);padding:7px 8px;text-align:center;vertical-align:middle}',
      '.cp-t tr:last-child th,.cp-t tr:last-child td{border-bottom:0}',
      '.cp-t thead th{color:#a1a1a6;font-size:11px;font-weight:600;letter-spacing:.04em;background:#101012;white-space:nowrap}',
      '.cp-t th.cp-row{text-align:left;min-width:180px;max-width:320px;font-weight:400}',
      '.cp-row .caption{display:block;color:#a1a1a6;margin-top:2px}',
      '.cp-cell{cursor:pointer;min-width:52px}.cp-cell:hover{background:#101012}',
      '.cp-dot{display:inline-block;width:12px;height:12px;border-radius:50%;background:var(--c);box-shadow:0 0 0 3px rgba(0,0,0,.4)}',
      '.cp-first .cp-dot{box-shadow:0 0 0 2px #161617,0 0 0 4px var(--c)}',
      '.cp-empty{color:#48484a}',
    ].join('\n');
    document.head.appendChild(s);
  }
  const COL = { ok: '#30d158', warn: '#ffe14d', weak: '#ff8c1a', bad: '#ff375f', na: '#6e6e73' };

  LiveView.panel('criteria-progress', {
    title: 'Criteria × iterations',
    render(el, state, api) {
      const h = api.h, events = (state && state.events) || [];
      const crit = [], text = {}, iters = [], cell = {};
      for (const e of events) {
        if (e.kind === 'claim' && e.subject && !(e.subject in text)) { crit.push(e.subject); text[e.subject] = (e.data || {}).text || ''; }
        if (e.kind === 'verdict' && e.subject) {
          const it = String((e.data || {}).iteration || e.phase || '?');
          if (!iters.includes(it)) iters.push(it);
          if (!(e.subject in text)) { crit.push(e.subject); text[e.subject] = ''; }
          cell[e.subject + '|' + it] = e;
        }
      }
      if (!crit.length) { el.appendChild(h('p', { class: 'caption', text: 'No criteria yet.' })); return; }
      let passing = 0;
      const rows = crit.map((c) => {
        let last = null, first = null;
        const tds = iters.map((it) => {
          const e = cell[c + '|' + it];
          if (!e) return h('td', { class: 'cp-empty' }, '·');
          const v = e.data.overall || e.data.verdict, k = api.verdictClass(v);
          last = k;
          const isFirst = k === 'ok' && first === null;
          if (isFirst) first = it;
          const td = h('td', { class: 'cp-cell' + (isFirst ? ' cp-first' : ''), title: c + ' @ ' + it + ': ' + v + (e.data.text ? ' — ' + e.data.text : ''),
            onclick: () => api.open({ seq: e.seq }) }, h('span', { class: 'cp-dot' }));
          td.firstChild.style.setProperty('--c', COL[k] || COL.na);
          return td;
        });
        if (last === 'ok') passing++;
        return h('tr', null,
          h('th', { class: 'cp-row', scope: 'row' }, h('span', { class: 'mono', text: c }), ' ',
            last ? h('span', { class: 'chip c-' + last, text: last === 'ok' ? 'pass' : last === 'bad' ? 'fail' : last }) : null,
            h('span', { class: 'caption' }, api.rich(text[c].length > 110 ? text[c].slice(0, 109) + '…' : text[c])),
            first ? h('span', { class: 'caption', text: 'first passed at ' + first }) : null),
          tds);
      });
      el.appendChild(h('p', { class: 'cp-sum' }, h('b', { text: passing + ' of ' + crit.length }), ' criteria passing now · ',
        h('b', { text: String(iters.length) }), ' iterations graded · ringed dot = first pass'));
      el.appendChild(h('div', { class: 'cp-wrap' }, h('table', { class: 'cp-t' },
        h('thead', null, h('tr', null, h('th', { class: 'cp-row', scope: 'col', text: 'Criterion' }),
          iters.map((it) => h('th', { scope: 'col', text: it })))),
        h('tbody', null, rows))));
    },
  });
})();
