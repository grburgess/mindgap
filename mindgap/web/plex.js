/* mindgap — Focus (Plex): TheBrain-style single-focus tiered navigation.
   Static "cross" layout (no force sim, no physics settle): active node centered,
   parents above, children below, everything non-hierarchical ("jumps") to the
   sides. Click a neighbor to recenter (replace, not accumulate — distinct from
   the org-roam local-graph focus in 2D/3D). Plain DOM; no deps. */
'use strict';
(function () {
  // rel -> which endpoint (src/dst) plays which role. Any rel not listed here
  // is a lateral "jump" — deliberately a small allowlist, not a full taxonomy.
  const HIERARCHICAL = {
    'part_of':    { src: 'child',  dst: 'parent' },
    'part-of':    { src: 'child',  dst: 'parent' },
    'contains':   { src: 'parent', dst: 'child'  },
    'implements': { src: 'child',  dst: 'parent' },
    'defines':    { src: 'child',  dst: 'parent' },
  };

  // pure: rel + "is the active node the src of this edge?" -> tier of the OTHER endpoint.
  function classify(rel, activeIsSrc) {
    const roles = HIERARCHICAL[rel];
    if (!roles) return 'jump';
    const activeRole = activeIsSrc ? roles.src : roles.dst;
    if (activeRole === 'child') return 'parent';
    if (activeRole === 'parent') return 'child';
    return 'jump';
  }

  let el, nodes = [], links = [], byId = new Map(), onRecenter = null, onSelect = null, activeId = null;

  function idOf(x) { return typeof x === 'object' && x ? x.id : x; }

  // neighbors of activeId, bucketed into parents/children/jumps with a rel label
  function neighborsOf(id) {
    const parents = [], children = [], jumps = [];
    for (const l of links) {
      const srcId = idOf(l.source), dstId = idOf(l.target);
      let otherId = null, activeIsSrc = null;
      if (srcId === id) { otherId = dstId; activeIsSrc = true; }
      else if (dstId === id) { otherId = srcId; activeIsSrc = false; }
      else continue;
      const other = byId.get(otherId);
      if (!other) continue;
      const tier = classify(l.rel, activeIsSrc);
      const relLabel = activeIsSrc ? `${l.rel} →` : `← ${l.rel}`;
      const row = { node: other, rel: relLabel };
      (tier === 'parent' ? parents : tier === 'child' ? children : jumps).push(row);
    }
    return { parents, children, jumps };
  }

  function esc(s) { return String(s == null ? '' : s).replace(/[&<>"']/g, (c) =>
    ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c])); }

  function card(row, extraClass) {
    return `<div class="plex-node ${extraClass || ''}" data-id="${esc(row.node.id)}">
      <span class="plex-rel mono dim">${esc(row.rel)}</span>
      <span class="plex-title">${esc(row.node.title || row.node.id)}</span>
    </div>`;
  }

  function render() {
    if (!el) return;
    const active = byId.get(activeId);
    if (!active) { el.innerHTML = '<div class="plex-empty dim">node not found</div>'; return; }
    const { parents, children, jumps } = neighborsOf(activeId);
    const left = jumps.filter((_, i) => i % 2 === 0);
    const right = jumps.filter((_, i) => i % 2 === 1);
    el.innerHTML = `
      <div class="plex-cross">
        <div class="plex-tier plex-parents">${parents.map((r) => card(r)).join('')}</div>
        <div class="plex-mid">
          <div class="plex-jumps plex-jumps-left">${left.map((r) => card(r)).join('')}</div>
          <div class="plex-node plex-active" data-id="${esc(active.id)}">
            <span class="plex-title">${esc(active.title || active.id)}</span>
          </div>
          <div class="plex-jumps plex-jumps-right">${right.map((r) => card(r)).join('')}</div>
        </div>
        <div class="plex-tier plex-children">${children.map((r) => card(r)).join('')}</div>
      </div>`;
    el.querySelectorAll('.plex-node:not(.plex-active)').forEach((n) => {
      n.onclick = () => { if (onRecenter) onRecenter(n.dataset.id); };
    });
    const activeCard = el.querySelector('.plex-active');
    if (activeCard) activeCard.onclick = () => { if (onSelect) onSelect(active.id); };
  }

  function setData(newNodes, newLinks) {
    nodes = newNodes || []; links = newLinks || [];
    byId = new Map(nodes.map((n) => [n.id, n]));
  }

  function setActive(id) {
    activeId = id;
    render();
  }

  function mount(container, { nodes: n, links: l, activeId: a, onRecenter: r, onSelect: s }) {
    el = container;
    setData(n, l);
    onRecenter = r || null;
    onSelect = s || null;
    activeId = a && byId.has(a) ? a : (nodes[0] && nodes[0].id) || null;
    render();
  }

  function unmount() {
    if (el) el.innerHTML = '';
    el = null; onRecenter = null; onSelect = null;
  }

  window.Plex = { mount, unmount, setData, setActive, render, classify };
})();
