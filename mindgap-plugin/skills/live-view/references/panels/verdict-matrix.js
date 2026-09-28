// live-view bespoke panel: claims × lenses verdict matrix (idea-court verify fan-outs).
// Written by the page-builder agent 2026-09-28 against references/panel-api.md; reuse as-is
// for any run whose agent labels are "<lens>:<claimId>" and whose claims are `claim` events.
(function () {
  if (!document.getElementById('vm-style')) {
    const s = document.createElement('style');
    s.id = 'vm-style';
    s.textContent = [
      '.vm-sum{margin:0 0 10px;color:#a1a1a6;font-size:13px}',
      '.vm-sum b{color:#f5f5f7}',
      '.vm-wrap{overflow-x:auto;-webkit-overflow-scrolling:touch;border:1px solid rgba(255,255,255,.14);border-radius:12px;background:#161617}',
      '.vm-table{border-collapse:collapse;width:100%;min-width:100%}',
      '.vm-table th,.vm-table td{border-bottom:1px solid rgba(255,255,255,.14);padding:8px 10px;vertical-align:top;text-align:left}',
      '.vm-table tr:last-child th,.vm-table tr:last-child td{border-bottom:0}',
      '.vm-table thead th{color:#a1a1a6;font-weight:600;font-size:11px;text-transform:uppercase;letter-spacing:.05em;white-space:nowrap;background:#101012}',
      '.vm-rowh{min-width:150px;max-width:260px;font-weight:400}',
      '.vm-rowh .caption{display:block;margin-top:3px;color:#a1a1a6}',
      '.vm-cid{color:#f5f5f7;font-weight:600}',
      '.vm-cell{min-width:140px;max-width:220px;cursor:pointer;transition:background .15s}',
      '.vm-cell:hover,.vm-cell:focus{background:#101012;outline:none}',
      '.vm-cell .caption{display:block;margin-top:4px;color:#a1a1a6}',
      '.vm-rec{border-left:1px solid rgba(255,255,255,.14)}',
      '.vm-muted{opacity:.55}',
      '.vm-empty{color:#6e6e73}',
      '.vm-split{display:inline-block;margin-left:6px;padding:0 7px;border-radius:999px;font-size:10px;font-weight:700;color:#000;background:#ff9f0a;letter-spacing:.04em;vertical-align:middle}',
      '.vm-row-split .vm-rowh{box-shadow:inset 3px 0 0 #ff9f0a}',
    ].join('\n');
    document.head.appendChild(s);
  }

  const trunc = (t, n) => (t && t.length > n ? t.slice(0, n - 1).trimEnd() + '…' : t || '');
  const shortId = (id) => { const m = /^[A-Za-z]+\d+/.exec(id); return m ? m[0] : trunc(id, 24); };
  const rank = (a) => (a.result ? 3 : a.state === 'done' ? 2 : a.state === 'running' ? 1 : 0);

  LiveView.panel('verdict-matrix', {
    title: 'Claims × lenses',
    render(el, state, api) {
      const h = api.h;
      const events = (state && state.events) || [];
      const agents = (state && state.agents) || [];
      const claims = [], claimSet = new Set(), claimText = {};
      const lenses = [], lensSet = new Set();
      const cells = {}, recon = {};
      const addClaim = (c) => { if (c && !claimSet.has(c)) { claimSet.add(c); claims.push(c); } };

      for (const e of events) {
        if (!e || !e.subject) continue;
        if (e.kind === 'claim') { addClaim(e.subject); if (e.data && e.data.text) claimText[e.subject] = e.data.text; }
        if (e.kind === 'verdict') {
          const prev = recon[e.subject];
          if (!prev || (e.seq || 0) >= (prev.seq || 0)) recon[e.subject] = e;
        }
      }
      for (const a of agents) {
        const label = (a && a.label) || '';
        const i = label.indexOf(':');
        if (i <= 0) continue;
        const lens = label.slice(0, i), claim = label.slice(i + 1);
        if (!claim) continue;
        if (!lensSet.has(lens)) { lensSet.add(lens); lenses.push(lens); }
        addClaim(claim);
        const key = claim + '\u0000' + lens;
        if (!cells[key] || rank(a) >= rank(cells[key])) cells[key] = a;
      }

      let verdictsIn = 0, splits = 0;
      const rows = claims.map((c) => {
        const classes = new Set();
        const tds = lenses.map((lens) => {
          const a = cells[c + '\u0000' + lens];
          if (!a) return h('td', { class: 'vm-empty' }, '—');
          const v = api.verdictOf(a);
          if (v) { verdictsIn++; classes.add(api.verdictClass(v)); }
          const headline = a.result && a.result.headline;
          const open = () => api.open({ agent: a.agentId });
          return h('td', {
            class: 'vm-cell', tabindex: '0', title: a.label,
            onclick: open, onkeydown: (ev) => { if (ev.key === 'Enter') open(); },
          },
            v ? h('span', { class: 'chip c-' + api.verdictClass(v), text: v })
              : h('span', { class: 'chip c-na vm-muted', text: a.state === 'running' ? 'running…' : a.state === 'done' ? 'no verdict' : 'queued' }),
            headline ? h('span', { class: 'caption' }, api.rich(trunc(headline, 90))) : null);
        });
        const r = recon[c];
        const rv = r && r.data && r.data.overall;
        const openR = () => api.open({ seq: r.seq });
        tds.push(r
          ? h('td', { class: 'vm-cell vm-rec', tabindex: '0', onclick: openR, onkeydown: (ev) => { if (ev.key === 'Enter') openR(); } },
              h('span', { class: 'chip c-' + api.verdictClass(rv), text: rv || 'verdict' }),
              r.data && r.data.text ? h('span', { class: 'caption' }, api.rich(trunc(r.data.text, 90))) : null)
          : h('td', { class: 'vm-rec vm-empty' }, h('span', { class: 'chip c-na vm-muted', text: 'pending' })));
        const split = classes.size > 1;
        if (split) splits++;
        return h('tr', { class: split ? 'vm-row-split' : '' },
          h('th', { class: 'vm-rowh', scope: 'row', title: c },
            h('span', { class: 'vm-cid mono', text: shortId(c) }),
            split ? h('span', { class: 'vm-split', text: 'split', title: 'Lens verdicts disagree' }) : null,
            h('span', { class: 'caption' }, api.rich(trunc(claimText[c] || c, 140)))),
          tds);
      });

      el.appendChild(h('p', { class: 'vm-sum' },
        h('b', { text: String(claims.length) }), ' claims · ',
        h('b', { text: String(verdictsIn) }), ' lens verdicts in · ',
        h('b', { class: splits ? 'v-warn' : '', text: String(splits) }), ' split'));

      if (!claims.length) {
        el.appendChild(h('p', { class: 'caption', text: 'No claims yet — waiting for the court to file them.' }));
        return;
      }
      el.appendChild(h('div', { class: 'vm-wrap' },
        h('table', { class: 'vm-table' },
          h('thead', null, h('tr', null,
            h('th', { scope: 'col', text: 'Claim' }),
            lenses.map((l) => h('th', { scope: 'col', text: l })),
            h('th', { scope: 'col', class: 'vm-rec', text: 'Reconciled' }))),
          h('tbody', null, rows))));
    },
  });
})();
