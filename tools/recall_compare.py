"""A/B: prompt-recall ranking, current (a) vs frozen BM25 arm (b), by mean hit@6.

  python3 recall_compare.py --queries Q.json --db PATH [--arm-a-as-b | --broken-b]
  python3 recall_compare.py --synthetic TABLE.json

Q.json: [{"q": "<prompt>", "expected": ["node-id", ...]}, ...]
TABLE.json (synthetic: per-query hit tables, decision rule only):
        [{"q": "<label>", "a": 0|1, "b": 0|1}, ...]

hit@6 per query = 1 if any expected id is in the arm's top 6, else 0; the mean is
over ALL queries (an empty result counts as a miss).
  arm (a) = prompt_recall_hook.rank(conn, prompt, cwd="", limit=6)
  arm (b) = prompt_recall_hook.rank_bm25(conn, prompt, cwd="", limit=6)
Decision: use_bm25 = mean_b >= mean_a.
--arm-a-as-b: null plant, both arms are (a) -> delta must be exactly 0.
--broken-b:   arm (b) replaced by 6 random node ids (seeded per query) -> must lose.
The --db file is copied to a temp dir first; the source is never opened.
"""
import argparse
import json
import random
import shutil
import sys
import tempfile
from pathlib import Path

ROOT = Path(__file__).resolve().parents[1]
sys.path.insert(0, str(ROOT))

from mindgap import db, prompt_recall_hook as prh  # noqa: E402

K = 6


def hit_at(ranked_ids, expected, k=K):
    return int(any(i in set(expected) for i in ranked_ids[:k]))


def arm_a(conn, q):
    return [n["id"] for n in prh.rank(conn, q, cwd="", limit=K)]


def arm_b(conn, q):
    return [n["id"] for n in prh.rank_bm25(conn, q, cwd="", limit=K)]


def arm_broken(conn, q, seed=0):
    all_ids = [r[0] for r in conn.execute("SELECT id FROM nodes ORDER BY id")]
    return random.Random(f"{seed}:{q}").sample(all_ids, min(K, len(all_ids)))


def decide(hits_a, hits_b):
    n = len(hits_a)
    mean_a = sum(hits_a) / n if n else 0.0
    mean_b = sum(hits_b) / n if n else 0.0
    return {"n": n, "mean_a": mean_a, "mean_b": mean_b, "use_bm25": mean_b >= mean_a}


def evaluate(conn, queries, fa=arm_a, fb=arm_b):
    rows = []
    for item in queries:
        q, exp = item["q"], item["expected"]
        rows.append({"q": q, "a": hit_at(fa(conn, q), exp), "b": hit_at(fb(conn, q), exp)})
    res = decide([r["a"] for r in rows], [r["b"] for r in rows])
    res["rows"] = rows
    return res


def report(res):
    print(f"N={res['n']}")
    print(f"mean hit@{K} (a)={res['mean_a']:.4f}")
    print(f"mean hit@{K} (b)={res['mean_b']:.4f}")
    for r in res["rows"]:
        print(f"  a={r['a']} b={r['b']}  {r['q']}")
    print(f"use_bm25 = mean_b >= mean_a -> {res['use_bm25']}")


def main(argv=None):
    ap = argparse.ArgumentParser()
    ap.add_argument("--queries")
    ap.add_argument("--db")
    ap.add_argument("--synthetic")
    g = ap.add_mutually_exclusive_group()
    g.add_argument("--arm-a-as-b", action="store_true")
    g.add_argument("--broken-b", action="store_true")
    args = ap.parse_args(argv)
    if args.synthetic:
        table = json.loads(Path(args.synthetic).read_text())
        res = decide([int(r["a"]) for r in table], [int(r["b"]) for r in table])
        res["rows"] = [{"q": r.get("q", str(i)), "a": int(r["a"]), "b": int(r["b"])}
                       for i, r in enumerate(table)]
        report(res)
        return res
    if not (args.queries and args.db):
        ap.error("--queries and --db are required (or --synthetic)")
    queries = json.loads(Path(args.queries).read_text())
    fb = arm_a if args.arm_a_as_b else arm_broken if args.broken_b else arm_b
    src = Path(args.db)
    with tempfile.TemporaryDirectory() as tmp:
        copy = Path(tmp) / "copy.db"
        shutil.copyfile(src, copy)
        wal = Path(str(src) + "-wal")
        if wal.exists():
            shutil.copyfile(wal, Path(str(copy) + "-wal"))
        conn = db.connect(copy)
        try:
            res = evaluate(conn, queries, arm_a, fb)
        finally:
            conn.close()
    report(res)
    return res


if __name__ == "__main__":
    main()
