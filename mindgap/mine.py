"""Orchestration layer for the second-brain mining modes. Resolves seeds,
writes the frontier file, and performs gated write-back via db.ingest. The
graph math lives in analyze.py (pure); all IO lives here. See
docs/superpowers/specs/second-brain-mining.md.
"""
import json

from . import analyze, config, db


def _build(conn):
    return analyze.build_graph(db.graph(conn))


def enrich(conn, seed, k=12):
    g = _build(conn)
    if db.get_node(conn, seed) is not None:
        seeds = [seed]
    else:
        seeds = [r["id"] for r in db.search(conn, seed)[:5]]
    if not seeds:
        return {"seed": [], "results": [], "note": "no seed match"}
    ranked = analyze.rwr(g, seeds, exclude=g["hub_stoplist"])
    note = None
    if not ranked:                       # isolated seed — nothing to walk
        note = "nothing to walk"
        nbr_ids = [n for s in seeds for n in g["adj"].get(s, {})]
        ranked = [(n, 0.0) for n in dict.fromkeys(nbr_ids)]
    meta = g["meta"]
    results = [{"id": n, "title": meta[n]["title"], "type": meta[n]["type"],
                "score": round(s, 6)} for n, s in ranked[:k]]
    return {"seed": seeds, "results": results, "note": note}


def learn(conn, top=20, emit=True):
    g = _build(conn)
    scored = analyze.frontier_scores(g)[:top]
    meta = g["meta"]
    queue = [{"id": nid, "title": meta[nid]["title"], "type": meta[nid]["type"],
              "score": sc, "reasons": rs} for nid, sc, rs in scored]
    emitted = None
    if emit:
        path = config.frontier_path()
        path.write_text(json.dumps(
            [{"id": q["id"], "score": q["score"], "reason": ", ".join(q["reasons"])}
             for q in queue], indent=2))
        md = ["# Learning frontier", ""]
        md += [f"- **{q['id']}** ({q['type']}, {q['score']}) — {', '.join(q['reasons'])}"
               for q in queue]
        path.with_suffix(".md").write_text("\n".join(md) + "\n")
        emitted = str(path)
    return {"queue": queue, "emitted": emitted}


def _existing_pairs(conn):
    pairs = set()
    for r in conn.execute("SELECT src, dst, rel FROM edges"):
        pairs.add((r["src"], r["dst"], r["rel"]))
        pairs.add((r["dst"], r["src"], r["rel"]))   # treat as undirected for dedup
    return pairs


def connect_apply(conn, decisions):
    existing = _existing_pairs(conn)
    nodes, edges = [], []
    edges_written = insights_written = skipped = 0
    seen = set()
    for d in decisions:
        if not d.get("accept"):
            continue
        a, b = d["a"], d["b"]
        rel = d.get("rel", "relates_to")
        if (a, b, rel) in existing or (a, b, rel) in seen:
            skipped += 1
            continue
        seen.add((a, b, rel))
        conf = d.get("confidence", 0.6)
        edges.append({"src": a, "dst": b, "rel": rel, "created_by": "mine:connect"})
        edges_written += 1
        if d.get("distant"):
            iid = f"insight-{db.slugify(a)}-{db.slugify(b)}"
            if db.get_node(conn, iid) is None:
                body = f"{d.get('rationale', '').strip()} [[{a}]] [[{b}]]".strip()
                nodes.append({"id": iid, "title": f"{a} ↔ {b}", "type": "concept",
                              "body": body, "confidence": conf, "created_by": "mine:connect"})
                insights_written += 1
    if nodes or edges:
        db.ingest(conn, {"nodes": nodes, "edges": edges}, "mine:connect")
        conn.commit()
    return {"edges_written": edges_written, "insights_written": insights_written,
            "skipped": skipped}


def connect_candidates(conn, k=15):
    g = _build(conn)
    guarded = analyze.guard_candidates(g, analyze.adamic_adar(g))[:k]
    meta, adj = g["meta"], g["adj"]
    candidates, template = [], []
    for a, b, score, common, jac, support in guarded:
        shared = set(adj[a]) & set(adj[b])
        # distant = linked only through weak/mention co-occurrence (no STRUCTURAL common
        # neighbor) -> cross-region pair worth a synthesized bridging insight node.
        structural_common = [z for z in shared if adj[a][z] == 1.0 and adj[b][z] == 1.0]
        distant = len(structural_common) == 0
        candidates.append({
            "a": a, "b": b, "score": round(score, 4), "common": common,
            "jaccard": round(jac, 4), "support": support,
            "a_body": meta[a]["body"], "b_body": meta[b]["body"], "distant": distant,
        })
        template.append({"a": a, "b": b, "accept": False, "rel": "relates_to",
                         "rationale": "", "confidence": 0.6})
    return {"candidates": candidates, "template": template}
