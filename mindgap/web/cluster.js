/* mindgap cluster detection — pure, dependency-free. Exposes window.Cluster. */
'use strict';
(function () {
  // Multi-level Louvain on an undirected weighted graph: local-moving + aggregate, repeated.
  // Deterministic: nodes in id-sorted order, no Math.random — communities are stable across reloads.
  function detect(nodes, links) {
    const ids = nodes.map((n) => n.id).slice().sort();
    const idx = new Map(ids.map((id, i) => [id, i]));
    const N = ids.length;
    const adj0 = Array.from({ length: N }, () => new Map());  // original (unweighted) adjacency for hub degree
    let g = Array.from({ length: N }, () => new Map());       // working graph; self-loops stored doubled after aggregation
    let m2 = 0; // 2 * total edge weight (invariant across levels)
    for (const l of links) {
      const s = idx.get(l.source && l.source.id !== undefined ? l.source.id : l.source);
      const t = idx.get(l.target && l.target.id !== undefined ? l.target.id : l.target);
      if (s === undefined || t === undefined || s === t) continue;
      const w = (+l.weight) || 1;
      g[s].set(t, (g[s].get(t) || 0) + w);
      g[t].set(s, (g[t].get(s) || 0) + w);
      adj0[s].set(t, 1); adj0[t].set(s, 1);
      m2 += 2 * w;
    }
    let map = ids.map((_, i) => i); // original node -> current super-node
    if (m2 > 0) {
      for (let level = 0; level < 20; level++) {
        const comm = oneLevel(g, m2);          // super-node -> local community (renumbered 0..k-1)
        map = map.map((sn) => comm[sn]);        // compose original->community
        const k = comm.reduce((a, c) => Math.max(a, c), 0) + 1;
        if (k === g.length) break;              // converged: no merges this level
        const ng = Array.from({ length: k }, () => new Map()); // induced community graph
        for (let u = 0; u < g.length; u++) {
          const cu = comm[u];
          for (const [v, w] of g[u]) ng[cu].set(comm[v], (ng[cu].get(comm[v]) || 0) + w);
        }
        g = ng;
      }
    }
    return pack(nodes, ids, map, adj0);
  }

  // One Louvain level: greedy modularity local-moving until stable. Returns community per node, renumbered.
  function oneLevel(g, m2) {
    const n = g.length;
    const deg = g.map((m) => { let s = 0; for (const w of m.values()) s += w; return s; });
    const com = Array.from({ length: n }, (_, i) => i);
    const tot = deg.slice();
    let improved = true, guard = 0;
    while (improved && guard++ < 100) {
      improved = false;
      for (let i = 0; i < n; i++) {
        const ci = com[i];
        tot[ci] -= deg[i];
        const wTo = new Map([[ci, 0]]);
        for (const [j, w] of g[i]) { if (j !== i) wTo.set(com[j], (wTo.get(com[j]) || 0) + w); }
        let best = ci, bestGain = -Infinity;
        for (const c of [...wTo.keys()].sort((a, b) => a - b)) {
          const gain = wTo.get(c) - (tot[c] * deg[i]) / m2;
          if (gain > bestGain + 1e-12) { bestGain = gain; best = c; }
        }
        com[i] = best; tot[best] += deg[i];
        if (best !== ci) improved = true;
      }
    }
    const remap = new Map(); let k = 0; // renumber to 0..k-1 by first appearance (deterministic)
    return com.map((c) => { if (!remap.has(c)) remap.set(c, k++); return remap.get(c); });
  }

  function pack(nodes, ids, comm, adj) {
    const titleById = new Map(nodes.map((n) => [n.id, n.title || n.id]));
    const groups = new Map();
    comm.forEach((c, i) => { if (!groups.has(c)) groups.set(c, []); groups.get(c).push(i); });
    const ordered = [...groups.values()].sort((a, b) => b.length - a.length);
    const colors = palette(ordered.length);
    const byId = new Map();
    const communities = ordered.map((members, ci) => {
      let hub = members[0], hubDeg = -1;
      for (const i of members) {
        if (adj[i].size > hubDeg) { hubDeg = adj[i].size; hub = i; }
        byId.set(ids[i], ci);
      }
      return {
        idx: ci, size: members.length, color: colors[ci],
        members: members.map((i) => ids[i]),
        hubId: ids[hub], hubTitle: titleById.get(ids[hub]),
      };
    });
    return { byId, communities, k: communities.length };
  }

  // Andrew monotone-chain convex hull of [{x,y}], expanded outward by `pad`.
  function hull(points, pad) {
    const p = points.slice().sort((a, b) => a.x - b.x || a.y - b.y);
    if (p.length < 3) return p;
    const cross = (o, a, b) => (a.x - o.x) * (b.y - o.y) - (a.y - o.y) * (b.x - o.x);
    const lower = [];
    for (const pt of p) { while (lower.length >= 2 && cross(lower[lower.length - 2], lower[lower.length - 1], pt) <= 0) lower.pop(); lower.push(pt); }
    const upper = [];
    for (let i = p.length - 1; i >= 0; i--) { const pt = p[i]; while (upper.length >= 2 && cross(upper[upper.length - 2], upper[upper.length - 1], pt) <= 0) upper.pop(); upper.push(pt); }
    const h = lower.slice(0, -1).concat(upper.slice(0, -1));
    if (!pad) return h;
    const cx = h.reduce((s, q) => s + q.x, 0) / h.length, cy = h.reduce((s, q) => s + q.y, 0) / h.length;
    return h.map((q) => { const dx = q.x - cx, dy = q.y - cy, d = Math.hypot(dx, dy) || 1; return { x: q.x + dx / d * pad, y: q.y + dy / d * pad }; });
  }

  // n distinct colors via golden-angle HSL, tuned for the dark bg.
  function palette(n) {
    const out = [];
    for (let i = 0; i < n; i++) out.push(`hsl(${((i * 137.508) % 360).toFixed(0)},62%,62%)`);
    return out;
  }

  window.Cluster = { detect, hull, palette };
})();
