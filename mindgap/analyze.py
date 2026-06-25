"""Pure stdlib graph-mining engine for mindgap. Takes the dict from
db.graph(conn); imports nothing from db; performs no IO. See
docs/superpowers/specs/second-brain-mining.md.

mentions=0.25 is cheap hygiene, not the precision lever — mentions edges often
double-encode a structural edge, so down-weighting them rarely moves a ranking.
The real per-mode levers are: connect=the person/hub support guard,
enrich=restart + hub suppression, learn=the exclusion filters.
"""
import math
from datetime import datetime, timezone


def build_graph(graph, mention_weight=0.25):
    meta, adj = {}, {}
    for n in graph["nodes"]:
        nid = n["id"]
        body = n.get("body", "") or ""
        meta[nid] = {
            "type": n.get("type", "concept"),
            "blen": len(body),
            "confidence": n.get("confidence", 1.0),
            "created_by": n.get("created_by", "manual"),
            "created_at": n.get("created_at", "") or "",
            "title": n.get("title", nid),
            "body": body,
        }
        adj[nid] = {}
    sd = {nid: set() for nid in adj}
    sin = {nid: set() for nid in adj}
    partof_in = {nid: 0 for nid in adj}
    for l in graph["links"]:
        a, b, rel = l["source"], l["target"], l["rel"]
        if a == b or a not in adj or b not in adj:
            continue
        w = mention_weight if rel == "mentions" else 1.0
        adj[a][b] = max(adj[a].get(b, 0.0), w)
        adj[b][a] = max(adj[b].get(a, 0.0), w)
        if rel != "mentions":
            sd[a].add(b)
            sd[b].add(a)
            sin[b].add(a)
        if rel == "part_of":
            partof_in[b] += 1
    hub = set()
    mx = max(partof_in.values(), default=0)
    if mx > 0:
        hub = {k for k, v in partof_in.items() if v == mx}
    return {
        "adj": adj,
        "meta": meta,
        "sd": {k: len(v) for k, v in sd.items()},
        "sin": {k: len(v) for k, v in sin.items()},
        "hub_stoplist": hub,
        "ids": list(adj.keys()),
    }


def weighted_degree(g):
    return {n: sum(nbrs.values()) for n, nbrs in g["adj"].items()}


def adamic_adar(g, min_common=3):
    adj = g["adj"]
    wdeg = weighted_degree(g)
    contrib = {n: (1.0 / math.log(1.0 + wdeg[n])) if wdeg[n] > 1e-12 else 0.0 for n in adj}
    score, common = {}, {}
    for z, nbrs in adj.items():
        c = contrib[z]
        if c <= 0 or len(nbrs) < 2:
            continue
        items = sorted(nbrs.items())
        for i in range(len(items)):
            a, wa = items[i]
            for j in range(i + 1, len(items)):
                b, wb = items[j]
                if b in adj[a]:          # already adjacent
                    continue
                key = (a, b)
                score[key] = score.get(key, 0.0) + wa * wb * c
                common[key] = common.get(key, 0) + 1
    out = []
    for key, s in score.items():
        if common[key] < min_common:
            continue
        a, b = key
        na, nb = set(adj[a]), set(adj[b])
        union = na | nb
        jac = len(na & nb) / len(union) if union else 0.0
        out.append((a, b, s, common[key], jac))
    out.sort(key=lambda t: (-t[2], -t[4]))
    return out


def guard_candidates(g, candidates):
    adj, meta, hub = g["adj"], g["meta"], g["hub_stoplist"]
    out = []
    for a, b, score, common, jac in candidates:
        shared = set(adj[a]) & set(adj[b])
        support = sorted(z for z in shared
                         if meta[z]["type"] != "person" and z not in hub)
        if not support:                  # the load-bearing default guard
            continue
        pen = 0.5 if meta[a]["type"] == meta[b]["type"] == "repo" else 1.0
        out.append((a, b, score * pen, common, jac, support))
    out.sort(key=lambda t: (-t[2], -t[4]))
    return out


def rwr(g, seeds, restart=0.25, iters=150, tol=1e-10, exclude=None):
    adj = g["adj"]
    exclude = set(exclude or ())
    seeds = [s for s in seeds if s in adj]
    if not seeds:
        return []
    deg = weighted_degree(g)
    p0 = {s: 1.0 / len(seeds) for s in seeds}
    p = {n: p0.get(n, 0.0) for n in adj}
    for _ in range(iters):
        nxt = {n: 0.0 for n in adj}
        for u, pu in p.items():
            if pu == 0.0 or deg[u] == 0:
                continue
            share = pu / deg[u]
            for v, w in adj[u].items():
                nxt[v] += share * w
        diff = 0.0
        for n in adj:
            val = (1.0 - restart) * nxt[n] + restart * p0.get(n, 0.0)
            diff += abs(val - p[n])
            nxt[n] = val
        p = nxt
        if diff < tol:
            break
    ranked = [(n, s) for n, s in p.items()
              if n not in seeds and n not in exclude and s > 0]
    ranked.sort(key=lambda t: -t[1])
    return ranked


PLACEHOLDER_IDS = {"node-id"}
SCAFFOLD_IDS = {"research-team", "research-wiki-home"}
CONTENT_TYPES = {"concept", "paper", "page", "definition", "software", "repo", "learning"}


def _age_days(created_at, now):
    if not created_at:
        return 9999.0
    try:
        dt = datetime.fromisoformat(created_at)
    except ValueError:
        return 9999.0
    if dt.tzinfo is None:
        dt = dt.replace(tzinfo=timezone.utc)
    return max(0.0, (now - dt).total_seconds() / 86400.0)


def _is_excluded(nid, m, total_deg):
    body = (m["body"] or "").strip().upper()
    if body.startswith("REFUTED") or body.startswith("REJECTED"):
        return True
    if m["created_by"].startswith("capture:") and m["type"] in ("design", "feature", "learning"):
        return True
    if nid in PLACEHOLDER_IDS:
        return True
    if m["type"] == "stub" and m["blen"] == 0 and total_deg <= 1:   # orphan junk stub
        return True
    return False


def frontier_scores(g, now=None):
    now = now or datetime.now(timezone.utc)
    meta, sd, sin, adj = g["meta"], g["sd"], g["sin"], g["adj"]
    out = []
    for nid, m in meta.items():
        if _is_excluded(nid, m, len(adj[nid])):
            continue
        t, blen, conf = m["type"], m["blen"], m["confidence"]
        score, reasons = 0.0, []
        if t == "stub":
            score += 2.5; reasons.append("stub")
        if nid not in SCAFFOLD_IDS:
            if blen < 60:
                score += 1.6; reasons.append("empty-body")
            elif blen < 300:
                score += 1.6 * 0.4; reasons.append("short-body")
        if t in CONTENT_TYPES and sd[nid] == 0:
            score += 2.2; reasons.append("isolated")
        if t == "paper" or nid.startswith("idea-"):
            fresh = max(0.0, (3 - sd[nid]) / 3.0) * (0.4 + 0.6 * math.exp(-_age_days(m["created_at"], now) / 6.0))
            if fresh > 0:
                score += 1.6 * fresh; reasons.append("fresh-thin")
        if t == "concept" and sin[nid] >= 3 and blen < 340:        # undev: demand GATES, thinness scores
            score += max(0.0, (340 - blen) / 340.0); reasons.append("in-demand-thin")
        if conf <= 0.6:
            score += 0.6; reasons.append("low-confidence")
        if score > 0:
            out.append((nid, round(score, 4), reasons))
    out.sort(key=lambda t: -t[1])
    return out
