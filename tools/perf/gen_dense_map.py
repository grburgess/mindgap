#!/usr/bin/env python3
"""Dense synthetic graph generator for the web-perf loop.

Writes N nodes / M edges into an ISOLATED sqlite db matching the real
mindgap schema, so the web UI can be stress-tested without touching
the user's real graph. Stdlib only (repo forbids pip deps).

    python3 tools/perf/gen_dense_map.py --db /tmp/perf-5k.db --nodes 5000 --edges 10000

Serve it with:  MINDGAP_DB=/tmp/perf-5k.db mindgap serve
"""
import argparse
import json
import os
import random
import sqlite3
import sys
from datetime import datetime, timedelta, timezone
from pathlib import Path

# Schema is read from the package's single source of truth.
SCHEMA = (Path(__file__).resolve().parents[2] / "mindgap" / "schema.sql").read_text()

TYPES = ['concept', 'definition', 'software', 'repo', 'page', 'paper',
         'person', 'team', 'design', 'feature', 'learning', 'jira-ticket']
# non-uniform type mix so the graph looks like a real knowledge graph
TYPE_WEIGHTS = [34, 8, 5, 6, 10, 18, 8, 1, 2, 3, 3, 4]
RELS = ['relates_to', 'defines', 'implements', 'depends_on', 'cites',
        'part_of', 'mentions']
REL_WEIGHTS = [40, 6, 8, 10, 18, 8, 10]
TAG_VOCAB = ['ml', 'cv', 'graphics', 'storage', 'networking', 'compilers',
             'databases', 'dataset', 'benchmark', 'knowledge-graph',
             'search', 'scheduling', 'perf', 'infra', 'ideas']

CREATED_BY = 'loop:web-perf'


def _guard(db_path: str) -> Path:
    """Refuse to write the user's real graph. Hard stop, clear message."""
    p = Path(db_path).expanduser().resolve()
    home_data = (Path.home() / '.mindgap').resolve()
    real = home_data / 'mindgap.db'
    if p == real or p.name == 'mindgap.db' or home_data in p.parents:
        sys.exit(f"REFUSING: {p} looks like the real mindgap graph "
                 f"(or lives under {home_data}). Pick a throwaway path, e.g. /tmp/perf-5k.db")
    return p


def _iso(dt: datetime) -> str:
    return dt.isoformat(timespec="seconds")


def gen(db_path: str, n_nodes: int, n_edges: int, seed: int) -> None:
    p = _guard(db_path)
    rng = random.Random(seed)
    p.parent.mkdir(parents=True, exist_ok=True)
    if p.exists():
        p.unlink()  # fresh, deterministic

    conn = sqlite3.connect(str(p))
    conn.execute("PRAGMA journal_mode=WAL")
    conn.executescript(SCHEMA)

    now = datetime.now(timezone.utc)
    span_days = 720  # ~2y spread so timeline/recency coloring has structure

    # --- nodes ---
    ids = [f"n{i:05d}" for i in range(n_nodes)]
    node_rows = []
    for i, nid in enumerate(ids):
        t = rng.choices(TYPES, weights=TYPE_WEIGHTS, k=1)[0]
        created = now - timedelta(days=rng.random() * span_days,
                                  seconds=rng.random() * 86400)
        k = rng.choice([0, 0, 1, 1, 2, 3])
        tags = rng.sample(TAG_VOCAB, k) if k else []
        node_rows.append((
            nid, f"{t} {i}", t, f"Synthetic {t} node #{i} for perf testing.",
            json.dumps(tags), '[]', round(rng.uniform(0.5, 1.0), 2),
            CREATED_BY, _iso(created), _iso(created),
        ))
    conn.executemany(
        "INSERT INTO nodes(id,title,type,body,tags,urls,confidence,created_by,created_at,updated_at)"
        " VALUES(?,?,?,?,?,?,?,?,?,?)", node_rows)

    # --- edges: preferential attachment so a few hubs emerge (power-law-ish) ---
    # base popularity: first ~2% of nodes are seeded heavy so hulls/community
    # detection have real hub structure.
    n_hubs = max(3, n_nodes // 50)
    pop = [1.0] * n_nodes
    for h in range(n_hubs):
        pop[h] = 30.0 + rng.random() * 60.0
    idx = list(range(n_nodes))

    seen = set()
    edge_rows = []
    attempts = 0
    max_attempts = n_edges * 12
    while len(edge_rows) < n_edges and attempts < max_attempts:
        attempts += 1
        a = rng.choices(idx, weights=pop, k=1)[0]
        b = rng.choices(idx, weights=pop, k=1)[0]
        if a == b:
            continue
        rel = rng.choices(RELS, weights=REL_WEIGHTS, k=1)[0]
        key = (ids[a], ids[b], rel)
        if key in seen:
            continue
        seen.add(key)
        pop[b] += 1.0  # rich-get-richer on the target
        created = now - timedelta(days=rng.random() * span_days)
        edge_rows.append((ids[a], ids[b], rel, round(rng.uniform(0.5, 2.0), 2),
                          CREATED_BY, _iso(created)))
    conn.executemany(
        "INSERT INTO edges(src,dst,rel,weight,created_by,created_at) VALUES(?,?,?,?,?,?)",
        edge_rows)

    conn.commit()
    nc = conn.execute("SELECT COUNT(*) FROM nodes").fetchone()[0]
    ec = conn.execute("SELECT COUNT(*) FROM edges").fetchone()[0]
    conn.close()
    print(f"wrote {p}")
    print(f"  nodes: {nc}")
    print(f"  edges: {ec}  (requested {n_edges}, {attempts} attempts, {n_hubs} seeded hubs)")
    if ec < n_edges:
        print(f"  NOTE: only {ec}/{n_edges} unique edges reachable at this node count/seed.")


def main():
    ap = argparse.ArgumentParser(description=__doc__)
    ap.add_argument("--db", required=True, help="target sqlite path (throwaway; NOT the real graph)")
    ap.add_argument("--nodes", type=int, default=5000)
    ap.add_argument("--edges", type=int, default=10000)
    ap.add_argument("--seed", type=int, default=42)
    a = ap.parse_args()
    gen(a.db, a.nodes, a.edges, a.seed)


if __name__ == "__main__":
    main()
