#!/usr/bin/env python3
"""Read a ReadCube/Papers desktop SQLite library → a mindgap ingest payload.

Stdlib only. Read-only/immutable source connection (never writes the library).
Emits paper nodes (curated core), topic concept nodes (from lists, with hierarchy),
a `grburgess` person hub, and structural edges. See the papers-library SKILL.md.

Usage:
  readcube_db.py [--db PATH] [--out FILE] [--dry-run] [--limit N]
"""
import argparse, json, os, re, sqlite3, sys

CREATED_BY = "skill:papers-library"
AUTHOR_SURNAME = "Burgess"
HUB_ID = "grburgess"
HUB_TITLE = "J. Michael Burgess"
DEFAULT_STORE = os.path.expanduser("~/Library/Application Support/Papers")


def slugify(text):
    return re.sub(r"[^a-z0-9]+", "-", (text or "").lower()).strip("-")


def safe(text):
    return (text or "").replace("[[", "[").replace("]]", "]")


def _authors(item):
    a = (item.get("article") or {}).get("authors") or []
    return [x for x in a if isinstance(x, str)]


def paper_id(item):
    ext = item.get("ext_ids") or {}
    ud = item.get("user_data") or {}
    if ext.get("arxiv"):
        return "arxiv-" + slugify(re.sub(r"v\d+$", "", ext["arxiv"]))
    if ext.get("doi"):
        return "doi-" + slugify(ext["doi"])
    if ud.get("citekey"):
        return "cite-" + slugify(ud["citekey"])
    return "rc-" + (item.get("id") or "").lower()[:8]


def assign_topic_ids(lists):
    by_id = {l["id"]: l for l in lists}
    used, out = {}, {}
    for l in sorted(lists, key=lambda x: (slugify(x.get("name", "")), x.get("id", ""))):
        base = "topic-" + (slugify(l.get("name", "")) or "x")
        cand = base
        if cand in used:
            parent = by_id.get(l.get("parent_id"))
            if parent:
                cand = base + "-" + (slugify(parent.get("name", "")) or "p")
            k = 2
            while cand in used:
                cand, k = f"{base}-{k}", k + 1
        used[cand] = l["id"]
        out[l["id"]] = cand
    return out


def paper_node(item):
    a = item.get("article") or {}
    ud = item.get("user_data") or {}
    ext = item.get("ext_ids") or {}
    authors = _authors(item)
    title = (a.get("title") or "").strip() or ud.get("citekey") or item.get("id")
    lines = []
    if authors:
        lines.append("**Authors:** " + ", ".join(authors[:8]) + (" et al." if len(authors) > 8 else ""))
    meta = [str(a["year"])] if a.get("year") else []
    if a.get("journal"):
        meta.append(a["journal"])
    if meta:
        lines.append(" · ".join(meta))
    if isinstance(ud.get("notes"), str) and ud["notes"].strip():
        lines.append(ud["notes"].strip())
    urls = []
    if ext.get("arxiv"):
        aid = re.sub(r"v\d+$", "", ext["arxiv"])
        urls.append({"label": f"arXiv:{aid}", "url": f"https://arxiv.org/abs/{aid}", "kind": "arxiv"})
    if ext.get("doi"):
        urls.append({"label": "doi", "url": f"https://doi.org/{ext['doi']}", "kind": "web"})
    tags = ["papers-library"] + [t.strip() for t in (ud.get("tags") or []) if isinstance(t, str) and t.strip()]
    return {"id": paper_id(item), "title": safe(title), "type": "paper",
            "body": safe("\n\n".join(lines)), "tags": tags, "urls": urls,
            "confidence": 0.9, "created_by": CREATED_BY}


def topic_node(lst, tid):
    n = len(lst.get("item_ids") or [])
    return {"id": tid, "title": safe(lst.get("name") or tid), "type": "concept",
            "body": safe(f"Topic from the Papers library ({n} papers)."),
            "tags": ["papers-library", "topic"], "confidence": 0.9, "created_by": CREATED_BY}


def build_payload(items, lists, limit=0):
    items = [i for i in items if not i.get("deleted")]
    lists = [l for l in lists if not l.get("deleted")]
    by_iid = {i["id"]: i for i in items}
    by_lid = {l["id"]: l for l in lists}
    tid = assign_topic_ids(lists)

    authored = {iid for iid, it in by_iid.items() if any(AUTHOR_SURNAME in a for a in _authors(it))}
    listed = set()
    for l in lists:
        listed |= {x for x in (l.get("item_ids") or []) if x in by_iid}
    core = listed | authored
    if limit:
        core = set(sorted(core)[:limit])

    core_count = {l["id"]: sum(1 for x in (l.get("item_ids") or []) if x in core) for l in lists}
    # weakly-connected tree = a list and its chain of existing parents; keep a tree iff
    # any topic in it has a core paper (drops fully-empty island trees like auto_import).
    parent_of = {l["id"]: (l["parent_id"] if l.get("parent_id") in by_lid else None) for l in lists}
    def _root(i):
        seen = set()
        while parent_of.get(i) and i not in seen:
            seen.add(i); i = parent_of[i]
        return i
    comp = {l["id"]: _root(l["id"]) for l in lists}
    comp_has_core = {comp[lid] for lid in comp if core_count[lid] > 0}
    kept_lid = {lid for lid in comp if comp[lid] in comp_has_core}

    nodes, edges = [], []
    nodes.append({"id": HUB_ID, "title": HUB_TITLE, "type": "person",
                  "body": "Author/maintainer hub for the imported papers and repos.",
                  "tags": ["papers-library"], "confidence": 1.0, "created_by": CREATED_BY})
    for l in lists:
        if l["id"] in kept_lid:
            nodes.append(topic_node(l, tid[l["id"]]))
    pid = {}
    seen_pid = set()
    for iid in sorted(core):
        n = paper_node(by_iid[iid])
        pid[iid] = n["id"]
        if n["id"] not in seen_pid:        # same-arxiv dups collapse to one node
            nodes.append(n)
            seen_pid.add(n["id"])

    for l in lists:                        # hierarchy
        if l["id"] in kept_lid and l.get("parent_id") in by_lid and l["parent_id"] in kept_lid:
            edges.append({"src": tid[l["id"]], "dst": tid[l["parent_id"]], "rel": "part_of",
                          "created_by": CREATED_BY})
    membership = 0
    for l in lists:                        # paper → topic
        if l["id"] not in kept_lid:
            continue
        for x in (l.get("item_ids") or []):
            if x in core:
                edges.append({"src": pid[x], "dst": tid[l["id"]], "rel": "part_of", "created_by": CREATED_BY})
                membership += 1
    for iid in sorted(authored & core):    # authored → hub
        edges.append({"src": pid[iid], "dst": HUB_ID, "rel": "relates_to", "created_by": CREATED_BY})

    # dedupe edges by (src,dst,rel)
    uniq, key = [], set()
    for e in edges:
        k = (e["src"], e["dst"], e["rel"])
        if k not in key:
            key.add(k); uniq.append(e)
    report = {"papers": len(seen_pid), "topics": len(kept_lid),
              "dropped_topics": len(lists) - len(kept_lid),
              "authored": len(authored & core), "membership_edges": membership}
    return {"nodes": nodes, "edges": uniq, "created_by": CREATED_BY, "_report": report}


def open_ro(path):
    return sqlite3.connect(f"file:{path}?mode=ro&immutable=1", uri=True)


def resolve_db(path):
    if os.path.isfile(path):
        return path
    cands = [f for f in os.listdir(path) if f.endswith(".db") and f not in ("shared.db", "Databases.db")]
    if not cands:
        raise SystemExit(f"no library .db found in {path}")
    return os.path.join(path, max(cands, key=lambda f: os.path.getsize(os.path.join(path, f))))


def load(conn):
    items = [json.loads(r[0]) for r in conn.execute("SELECT json FROM items")]
    lists = [json.loads(r[0]) for r in conn.execute("SELECT json FROM lists")]
    return items, lists


def main(argv=None):
    ap = argparse.ArgumentParser(description=__doc__)
    ap.add_argument("--db", default=DEFAULT_STORE)
    ap.add_argument("--out")
    ap.add_argument("--dry-run", action="store_true")
    ap.add_argument("--limit", type=int, default=0)
    args = ap.parse_args(argv)
    conn = open_ro(resolve_db(args.db))
    items, lists = load(conn)
    payload = build_payload(items, lists, limit=args.limit)
    rep = payload.pop("_report")
    if args.dry_run:
        print(json.dumps(rep, indent=2), file=sys.stderr)
        print(f"nodes={len(payload['nodes'])} edges={len(payload['edges'])}", file=sys.stderr)
        for n in payload["nodes"][:3] + [x for x in payload["nodes"] if x["type"] == "paper"][:2]:
            print("  -", n["type"], n["id"], "|", n["title"][:60], file=sys.stderr)
        return
    out = open(args.out, "w") if args.out else sys.stdout
    json.dump(payload, out, indent=1)
    if args.out:
        out.close()
        print(f"wrote {args.out}: {rep}", file=sys.stderr)


if __name__ == "__main__":
    main()
