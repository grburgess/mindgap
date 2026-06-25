"""Mindgap CLI."""
import argparse
import json
import sys
from datetime import datetime, timezone
from pathlib import Path
from urllib.parse import urlparse

from . import config, db, mine


def _url_entry(spec):
    # KIND=URL; label defaults to URL host + path tail.
    kind, _, url = spec.partition("=")
    p = urlparse(url)
    tail = p.path.rstrip("/").split("/")[-1]
    label = f"{p.netloc}/{tail}" if tail else p.netloc
    return {"label": label, "url": url, "kind": kind}


def _link_ends(link):
    # neighbors()/graph() links use source/target keys
    return link.get("source", link.get("src")), link.get("target", link.get("dst"))


def cmd_add(args):
    conn = db.connect()
    node = {"title": args.title, "created_by": args.by}
    if args.id:
        node["id"] = args.id
    if args.type:
        node["type"] = args.type
    if args.body_file:
        node["body"] = open(args.body_file).read()
    elif args.body is not None:
        node["body"] = args.body
    if args.tags:
        node["tags"] = [t.strip() for t in args.tags.split(",") if t.strip()]
    if args.url:
        node["urls"] = [_url_entry(u) for u in args.url]
    row = db.upsert_node(conn, node)
    conn.commit()
    print(row["id"])


def cmd_link(args):
    conn = db.connect()
    db.add_edge(conn, args.src, args.dst, rel=args.rel, weight=args.weight,
                created_by=args.by)
    conn.commit()
    print(f"{args.src} -{args.rel}-> {args.dst}")


def cmd_ingest(args):
    raw = sys.stdin.read() if args.file == "-" else open(args.file).read()
    payload = json.loads(raw)
    created_by = args.by or payload.get("created_by") or "manual"
    conn = db.connect()
    result = db.ingest(conn, payload, created_by)
    conn.commit()
    print(f"ingested {result['nodes']} nodes, {result['edges']} edges")


def cmd_find(args):
    conn = db.connect()
    rows = db.search(conn, q=args.query, type=args.type, tag=args.tag)
    if args.json:
        print(json.dumps(rows, indent=2))
    else:
        for r in rows:
            print(f"{r['id']}\t{r['title']} [{r['type']}]")


def _node_or_die(conn, node_id):
    node = db.get_node(conn, node_id)
    if node is None:
        print(f"no such node: {node_id}", file=sys.stderr)
        sys.exit(1)
    return node


def cmd_show(args):
    conn = db.connect()
    node = _node_or_die(conn, args.id)
    nb = db.neighbors(conn, args.id)
    if args.json:
        print(json.dumps({"node": node, "neighbors": nb}, indent=2))
        return
    print(f"{node['title']} ({node['id']}) [{node['type']}]")
    if node["tags"]:
        print("tags: " + ", ".join(node["tags"]))
    if node["body"]:
        print(node["body"])
    for u in node["urls"]:
        print(f"url: [{u['label']}]({u['url']}) ({u['kind']})")
    titles = {n["id"]: n["title"] for n in nb["nodes"]}
    for link in nb["links"]:
        src, dst = _link_ends(link)
        if src == args.id:
            print(f"- {link['rel']} -> {dst} ({titles.get(dst, dst)})")
        elif dst == args.id:
            print(f"- {link['rel']} <- {src} ({titles.get(src, src)})")


def cmd_context(args):
    conn = db.connect()
    for node in db.search(conn, q=args.query):
        print(f"## {node['title']} ({node['id']}) [{node['type']}]")
        if node["tags"]:
            print("tags: " + ", ".join(node["tags"]))
        if node["body"]:
            print()
            print(node["body"])
        if node["urls"]:
            print()
            for u in node["urls"]:
                print(f"- [{u['label']}]({u['url']})")
        nb = db.neighbors(conn, node["id"], depth=args.depth)
        titles = {n["id"]: n["title"] for n in nb["nodes"]}
        if nb["links"]:
            print()
            for link in nb["links"]:
                src, dst = _link_ends(link)
                if src == node["id"]:
                    print(f"- {link['rel']} -> {dst} ({titles.get(dst, dst)})")
                elif dst == node["id"]:
                    print(f"- {link['rel']} <- {src} ({titles.get(src, src)})")
        print()


def cmd_rm(args):
    conn = db.connect()
    db.delete_node(conn, args.id)
    conn.commit()
    print(f"removed {args.id}")


def cmd_unlink(args):
    conn = db.connect()
    db.delete_edge(conn, args.src, args.dst, rel=args.rel)
    conn.commit()
    print(f"unlinked {args.src} {args.dst}")


def cmd_export(args):
    conn = db.connect()
    g = db.graph(conn)
    payload = {
        "nodes": g["nodes"],
        "edges": [
            {"src": l["source"], "dst": l["target"], "rel": l["rel"],
             "weight": l["weight"], "created_by": l["created_by"]}
            for l in g["links"]
        ],
    }
    if args.out:
        out = args.out
    else:
        stamp = datetime.now(timezone.utc).strftime("%Y%m%dT%H%M%SZ")
        out = str(config.snapshots_dir() / f"{stamp}.json")
    with open(out, "w") as f:
        json.dump(payload, f, indent=2)
    print(out)


def cmd_stats(args):
    conn = db.connect()
    print(json.dumps(db.stats(conn), indent=2))


def cmd_lint(args):
    from . import lint, capture
    conn = db.connect()
    cfg = capture.load_config().get("lint", {})
    rep = lint.report(conn,
                      stale_days=cfg.get("stale_days", 60),
                      below_confidence=cfg.get("stale_below_confidence", 0.7))
    if args.json:
        print(json.dumps(rep, indent=2))
        return
    print(f"orphans: {len(rep['orphans'])}")
    for r in rep["orphans"]:
        print(f"  {r['id']} [{r['type']}] {r['title']}")
    print(f"dangling stubs: {len(rep['dangling_stubs'])}")
    for r in rep["dangling_stubs"]:
        print(f"  {r['id']} {r['title']}")
    print(f"near-duplicate candidates: {len(rep['duplicate_candidates'])}")
    for r in rep["duplicate_candidates"]:
        print(f"  {r['a']} ~ {r['b']} ({r['ratio']})")
    print(f"stale capture nodes: {len(rep['stale_capture'])}")
    for r in rep["stale_capture"]:
        print(f"  {r['id']} (conf {r['confidence']}) {r['title']}")


def cmd_mine(args):
    conn = db.connect()
    if args.mine_cmd == "enrich":
        out = mine.enrich(conn, args.seed, k=args.k)
        if args.json:
            print(json.dumps(out, indent=2)); return
        if out["note"]:
            print(f"# {out['note']}")
        for r in out["results"]:
            print(f"{r['score']:.4f}\t{r['id']}\t{r['title']} [{r['type']}]")
    elif args.mine_cmd == "learn":
        out = mine.learn(conn, top=args.top, emit=not args.no_emit)
        if args.json:
            print(json.dumps(out, indent=2)); return
        for q in out["queue"]:
            print(f"{q['score']:.4f}\t{q['id']}\t{q['title']} [{q['type']}] — {', '.join(q['reasons'])}")
        if out["emitted"]:
            print(f"# wrote {out['emitted']}")
    elif args.mine_cmd == "connect":
        if args.apply:
            out = mine.connect_apply(conn, json.load(open(args.apply)))
        else:
            out = mine.connect_candidates(conn, k=args.k)
        print(json.dumps(out, indent=2))


def cmd_serve(args):
    from .server import run
    run(args.port, not args.no_open)


def init_db(force=False) -> int:
    """Create the schema (db.connect) and seed from the packaged seed.json if empty.
    Returns the number of nodes seeded (0 if the db already had nodes and not force)."""
    conn = db.connect()
    n = conn.execute("SELECT COUNT(*) FROM nodes").fetchone()[0]
    if n and not force:
        return 0
    payload = json.loads(config.seed_path().read_text())
    res = db.ingest(conn, payload, payload.get("created_by", "seed"))
    conn.commit()
    if isinstance(res, dict) and "nodes" in res:
        return res["nodes"]
    return conn.execute("SELECT COUNT(*) FROM nodes").fetchone()[0]


def install_capture_preset() -> bool:
    """Copy the packaged capture.json preset to the user capture config if absent."""
    from . import capture
    dst = capture.config_path()
    if dst.exists():
        return False
    src = capture.preset_path()
    if not src.exists():
        return False
    dst.write_text(src.read_text())
    return True


def cmd_init(args):
    n = init_db(force=args.force)
    if install_capture_preset():
        print(f"installed capture preset -> {__import__('mindgap.capture', fromlist=['x']).config_path()}")
    print(f"seeded {config.db_path()} ({n} nodes)" if n
          else f"db at {config.db_path()} already initialized")


def _loops_local():
    return Path.cwd() / "self-learning-loop"


def loop_new(template, name=None, topics=None, src=None):
    src = Path(src) if src else config.loops_dir() / template
    if not (src / "GOAL.md").exists():
        raise SystemExit(f"no GOAL.md in template: {src}")
    name = name or template
    dst = _loops_local() / name
    if dst.exists():
        raise SystemExit(f"already exists: {dst}")
    dst.mkdir(parents=True)
    topics = topics or "<EDIT: the topics / domain this loop should track>"
    for f in sorted(src.glob("*.md")):
        text = f.read_text().replace("{{TOPICS}}", topics).replace("{{NAME}}", name)
        (dst / f.name).write_text(text)
    state = dst / "STATE.md"
    if not state.exists():
        state.write_text(f"# State · {name}\n\n(empty — loop-system fills this on the first pass)\n")
    return dst


def loop_export(name, out=None):
    src = _loops_local() / name
    if not (src / "GOAL.md").exists():
        raise SystemExit(f"no GOAL.md in {src}")
    out = Path(out) if out else Path.cwd() / f"{name}-template"
    out.mkdir(parents=True, exist_ok=True)
    for f in sorted(src.glob("*.md")):
        if f.name == "STATE.md":
            continue
        (out / f.name).write_text(f.read_text())
    return out


def cmd_loop(args):
    if args.loop_cmd == "list":
        ld = config.loops_dir()
        print("bundled templates:")
        for d in (sorted(ld.glob("*/")) if ld.is_dir() else []):
            print(f"  {d.name}")
        local = _loops_local()
        if local.is_dir():
            print("local loops:")
            for d in sorted(local.glob("*/")):
                if (d / "GOAL.md").exists():
                    print(f"  {d.name}")
    elif args.loop_cmd == "new":
        dst = loop_new(args.template, name=args.name, topics=args.topics)
        print(f"created {dst}\nnext: tell Claude  \"continue the {dst.name} loop\"")
    elif args.loop_cmd == "export":
        out = loop_export(args.name, out=args.out)
        print(f"exported template -> {out}")
    elif args.loop_cmd == "import":
        nm = args.name or Path(args.path).name.replace("-template", "")
        dst = loop_new(nm, name=nm, topics=args.topics, src=args.path)
        print(f"imported -> {dst}\nnext: tell Claude  \"continue the {dst.name} loop\"")


def main(argv=None):
    ap = argparse.ArgumentParser(prog="mindgap",
                                 description="Local knowledge graph")
    sub = ap.add_subparsers(dest="cmd", required=True)

    p = sub.add_parser("add", help="add/upsert a node")
    p.add_argument("--title", required=True)
    p.add_argument("--id")
    p.add_argument("--type")
    p.add_argument("--body")
    p.add_argument("--body-file")
    p.add_argument("--tags", help="comma-separated")
    p.add_argument("--url", action="append", metavar="KIND=URL")
    p.add_argument("--by", default="manual")
    p.set_defaults(func=cmd_add)

    p = sub.add_parser("link", help="add an edge")
    p.add_argument("src")
    p.add_argument("dst")
    p.add_argument("--rel", default="relates_to")
    p.add_argument("--weight", type=float, default=1.0)
    p.add_argument("--by", default="manual")
    p.set_defaults(func=cmd_link)

    p = sub.add_parser("ingest", help="ingest JSON payload")
    p.add_argument("file", help="path or - for stdin")
    p.add_argument("--by")
    p.set_defaults(func=cmd_ingest)

    p = sub.add_parser("find", help="search nodes")
    p.add_argument("query")
    p.add_argument("--type")
    p.add_argument("--tag")
    p.add_argument("--json", action="store_true")
    p.set_defaults(func=cmd_find)

    p = sub.add_parser("show", help="show node + neighbors")
    p.add_argument("id")
    p.add_argument("--json", action="store_true")
    p.set_defaults(func=cmd_show)

    p = sub.add_parser("context", help="markdown digest for agents")
    p.add_argument("query")
    p.add_argument("--depth", type=int, default=1)
    p.set_defaults(func=cmd_context)

    p = sub.add_parser("rm", help="delete node")
    p.add_argument("id")
    p.set_defaults(func=cmd_rm)

    p = sub.add_parser("unlink", help="delete edge")
    p.add_argument("src")
    p.add_argument("dst")
    p.add_argument("--rel")
    p.set_defaults(func=cmd_unlink)

    p = sub.add_parser("export", help="JSON snapshot")
    p.add_argument("--out")
    p.set_defaults(func=cmd_export)

    p = sub.add_parser("stats", help="counts")
    p.set_defaults(func=cmd_stats)

    p = sub.add_parser("lint", help="graph health report (orphans/stubs/dups/stale)")
    p.add_argument("--json", action="store_true")
    p.set_defaults(func=cmd_lint)

    p = sub.add_parser("mine", help="analytic mining: enrich / learn / connect")
    msub = p.add_subparsers(dest="mine_cmd", required=True)
    me = msub.add_parser("enrich", help="RWR-ranked relevant subgraph for a seed")
    me.add_argument("seed"); me.add_argument("--k", type=int, default=12)
    me.add_argument("--json", action="store_true")
    ml = msub.add_parser("learn", help="ranked learning frontier + frontier.json for loops")
    ml.add_argument("--top", type=int, default=20)
    ml.add_argument("--no-emit", action="store_true")
    ml.add_argument("--json", action="store_true")
    mc = msub.add_parser("connect", help="latent-link suggestions (read-only) or --apply decisions")
    mc.add_argument("--k", type=int, default=15)
    mc.add_argument("--apply", help="path to a pre-adjudicated decisions.json to commit")
    p.set_defaults(func=cmd_mine)

    p = sub.add_parser("serve", help="web UI")
    p.add_argument("--port", type=int, default=8765)
    p.add_argument("--no-open", action="store_true")
    p.set_defaults(func=cmd_serve)

    p = sub.add_parser("init", help="create ~/.mindgap DB and seed it from the bundled seed.json")
    p.add_argument("--force", action="store_true", help="re-seed even if the db already has nodes")
    p.set_defaults(func=cmd_init)

    p = sub.add_parser("loop", help="scaffold / share knowledge loops from bundled templates")
    lsub = p.add_subparsers(dest="loop_cmd", required=True)
    lsub.add_parser("list", help="list bundled templates + local loops")
    n = lsub.add_parser("new", help="scaffold a loop from a bundled template")
    n.add_argument("template"); n.add_argument("--name"); n.add_argument("--topics")
    e = lsub.add_parser("export", help="export a local loop as a shareable template (strips STATE)")
    e.add_argument("name"); e.add_argument("--out")
    i = lsub.add_parser("import", help="scaffold a loop from an exported template dir")
    i.add_argument("path"); i.add_argument("--name"); i.add_argument("--topics")
    p.set_defaults(func=cmd_loop)

    args = ap.parse_args(argv)
    args.func(args)


if __name__ == "__main__":
    main()
