import json
import re
import sqlite3
from datetime import datetime, timezone

from . import config

SCHEMA = (config.PKG_DIR / "schema.sql").read_text()

_SCALARS = ("title", "type", "body", "confidence", "created_by")


def connect(path=None):
    conn = sqlite3.connect(str(path or config.db_path()))
    conn.row_factory = sqlite3.Row
    conn.execute("PRAGMA foreign_keys=ON")
    conn.execute("PRAGMA journal_mode=WAL")
    conn.executescript(SCHEMA)
    _sync_fts(conn)
    return conn


def _sync_fts(conn):
    """Rebuild the full-text index when its row count is out of step with nodes --
    first open of a DB created before the index existed, or rows written by code
    that bypassed the triggers. Triggers keep it in step otherwise."""
    n = conn.execute("SELECT (SELECT count(*) FROM nodes), (SELECT count(*) FROM nodes_fts)").fetchone()
    if n[0] != n[1]:
        conn.execute("DELETE FROM nodes_fts")
        conn.execute("INSERT INTO nodes_fts(id,title,body,tags) SELECT id,title,body,tags FROM nodes")
        conn.commit()


def _now():
    return datetime.now(timezone.utc).isoformat(timespec="seconds")


def slugify(text):
    return re.sub(r"[^a-z0-9]+", "-", text.lower()).strip("-")


def _decode(row):
    d = dict(row)
    d["tags"] = json.loads(d["tags"])
    d["urls"] = _norm_urls(json.loads(d["urls"]))
    return d


def _norm_urls(urls):
    # tolerate bare-string entries ({"urls": ["https://x"]}) and dict entries
    # missing label/url/kind, so renderers can assume all three keys are present.
    out = []
    for u in urls:
        if isinstance(u, str):
            out.append({"label": u, "url": u, "kind": "web"})
        elif isinstance(u, dict):
            url = u.get("url") or u.get("label") or ""
            out.append({**u, "label": u.get("label") or url, "url": url, "kind": u.get("kind", "web")})
        # else: drop malformed non-str/non-dict entries
    return out


def _ensure_stub(conn, node_id, title=None):
    if conn.execute("SELECT 1 FROM nodes WHERE id=?", (node_id,)).fetchone() is None:
        now = _now()
        conn.execute(
            "INSERT INTO nodes(id,title,type,created_at,updated_at) VALUES(?,?,?,?,?)",
            (node_id, title or node_id, "stub", now, now),
        )


def upsert_node(conn, node, replace=False, commit=True):
    nid = node.get("id") or slugify(node.get("title", ""))
    if not nid:
        raise ValueError("node needs an id or a title with alphanumerics")
    now = _now()
    cur = conn.execute("SELECT * FROM nodes WHERE id=?", (nid,)).fetchone()
    if cur is None:
        conn.execute(
            "INSERT INTO nodes(id,title,type,body,tags,urls,confidence,created_by,created_at,updated_at)"
            " VALUES(?,?,?,?,?,?,?,?,?,?)",
            (
                nid,
                node.get("title", nid),
                node.get("type", "concept"),
                node.get("body", ""),
                json.dumps(node.get("tags", [])),
                json.dumps(_norm_urls(node.get("urls", []))),
                node.get("confidence", 1.0),
                node.get("created_by", "manual"),
                now,
                now,
            ),
        )
    else:
        d = _decode(cur)
        for k in _SCALARS:
            if k in node:
                d[k] = node[k]
        d["urls"] = _norm_urls(d["urls"])
        if replace:
            if "tags" in node:
                d["tags"] = list(node["tags"])
            if "urls" in node:
                d["urls"] = _norm_urls(node["urls"])
        else:
            for t in node.get("tags", []):
                if t not in d["tags"]:
                    d["tags"].append(t)
            seen = {u["url"] for u in d["urls"]}
            for u in _norm_urls(node.get("urls", [])):
                if u["url"] not in seen:
                    d["urls"].append(u)
                    seen.add(u["url"])
        conn.execute(
            "UPDATE nodes SET title=?,type=?,body=?,tags=?,urls=?,confidence=?,created_by=?,updated_at=?"
            " WHERE id=?",
            (
                d["title"],
                d["type"],
                d["body"],
                json.dumps(d["tags"]),
                json.dumps(d["urls"]),
                d["confidence"],
                d["created_by"],
                now,
                nid,
            ),
        )
    sync_wiki_edges(conn, nid, commit=commit)
    if commit:
        conn.commit()
    return get_node(conn, nid)


_CODE_RE = re.compile(r"```.*?```|`[^`]*`", re.S)  # fenced blocks + inline code spans


def extract_wiki_links(body):
    out = []
    for inner in re.findall(r"\[\[([^\]]+)\]\]", _CODE_RE.sub("", body)):
        slug = slugify(inner)
        if slug and slug not in out:
            out.append(slug)
    return out


def sync_wiki_edges(conn, node_id, commit=True):
    row = conn.execute("SELECT body, created_by FROM nodes WHERE id=?", (node_id,)).fetchone()
    targets = {}  # slug -> inner text (first occurrence)
    for inner in re.findall(r"\[\[([^\]]+)\]\]", _CODE_RE.sub("", row["body"])):
        slug = slugify(inner)
        if slug:
            targets.setdefault(slug, inner.strip())
    for slug, title in targets.items():
        _ensure_stub(conn, slug, title)
        conn.execute(
            "INSERT OR IGNORE INTO edges(src,dst,rel,weight,created_by,created_at)"
            " VALUES(?,?,'mentions',1.0,?,?)",
            (node_id, slug, f"wiki:{row['created_by']}", _now()),
        )
    # only prune edges this sync created (created_by 'wiki:*'); manual mentions stay
    ph = ",".join("?" * len(targets))
    conn.execute(
        "DELETE FROM edges WHERE src=? AND rel='mentions' AND created_by LIKE 'wiki:%'"
        + (f" AND dst NOT IN ({ph})" if targets else ""),
        [node_id, *targets],
    )
    if commit:
        conn.commit()


def add_edge(conn, src, dst, rel="relates_to", weight=1.0, created_by="manual", commit=True):
    _ensure_stub(conn, src)
    _ensure_stub(conn, dst)
    conn.execute(
        "INSERT OR REPLACE INTO edges(src,dst,rel,weight,created_by,created_at) VALUES(?,?,?,?,?,?)",
        (src, dst, rel, weight, created_by, _now()),
    )
    if commit:
        conn.commit()


def get_node(conn, id):
    row = conn.execute("SELECT * FROM nodes WHERE id=?", (id,)).fetchone()
    return _decode(row) if row else None


def delete_node(conn, id):
    conn.execute("DELETE FROM nodes WHERE id=?", (id,))
    conn.commit()


def delete_edge(conn, src, dst, rel=None):
    if rel:
        conn.execute("DELETE FROM edges WHERE src=? AND dst=? AND rel=?", (src, dst, rel))
    else:
        conn.execute("DELETE FROM edges WHERE src=? AND dst=?", (src, dst))
    conn.commit()


# bm25 column weights, in nodes_fts column order: id, title, body, tags.
# Title outweighs body: a word in the title says what the node is about.
_BM25_WEIGHTS = (2.0, 10.0, 1.0, 3.0)


def fts_terms(q):
    """User text -> plain lowercase word tokens. Everything that is not a letter or
    digit is dropped, so FTS syntax (quotes, *, :, ^, parens, -) never reaches MATCH."""
    return re.findall(r"[^\W_]+", (q or "").lower())


def _fts_expr(terms, op="AND"):
    # every term quoted (so AND/OR/NOT/NEAR are plain words) and prefix-matched
    return f" {op} ".join(f'"{t}"*' for t in terms)


def _filters(type, tag, tag_mode, col=""):
    where, params = [], []
    if type:
        where.append(f"{col}type=?")
        params.append(type)
    if tag:
        if tag_mode == "contains":  # case-insensitive substring (web tag box)
            where.append(f"lower({col}tags) LIKE ?")
            params.append(f"%{tag.lower()}%")
        else:  # exact tag token (CLI/MCP --tag)
            where.append(f"{col}tags LIKE ?")
            params.append(f'%"{tag}"%')
    return where, params


def fts_search(conn, terms, op="AND", type=None, tag=None, limit=50, tag_mode="exact"):
    """BM25-ranked full-text search. terms: tokens (see fts_terms), each prefix-matched,
    joined by op ("AND"/"OR"). Returns [(node, bm25)] best first (bm25: lower = better)."""
    if not terms:
        return []
    where, params = _filters(type, tag, tag_mode, col="n.")
    sql = (f"SELECT n.*, bm25(nodes_fts, {', '.join(map(str, _BM25_WEIGHTS))}) AS _bm25"
           " FROM nodes_fts JOIN nodes n ON n.id = nodes_fts.id WHERE nodes_fts MATCH ?")
    sql += "".join(f" AND {w}" for w in where)
    sql += " ORDER BY _bm25, n.updated_at DESC, n.id LIMIT ?"
    out = []
    for r in conn.execute(sql, [_fts_expr(terms, op), *params, limit]):
        d = _decode(r)
        out.append((d, d.pop("_bm25")))
    return out


SUPERSEDES = "supersedes"  # edge src = newer node, dst = older (superseded) node


def superseded_ids(conn):
    """Ids of superseded nodes: the dst of any 'supersedes' edge."""
    return {r[0] for r in conn.execute("SELECT DISTINCT dst FROM edges WHERE rel=?", (SUPERSEDES,))}


def mark_superseded(conn, nodes):
    """Set n["superseded_by"] = sorted ids of newer nodes ([] when not superseded),
    in place. Returns nodes."""
    by = {}
    for r in conn.execute("SELECT src, dst FROM edges WHERE rel=?", (SUPERSEDES,)):
        by.setdefault(r["dst"], []).append(r["src"])
    for n in nodes:
        n["superseded_by"] = sorted(by.get(n["id"], []))
    return nodes


def search(conn, q="", type=None, tag=None, limit=50, tag_mode="exact", mode="fts"):
    """mode="fts": BM25-ranked, words ANDed, each word prefix-matched; when that finds
    nothing, falls back to the substring match. mode="like": substring match only
    (id/title/body/tags LIKE %q%, newest first) -- what the recall hooks rely on."""
    if q and mode == "fts":
        hits = fts_search(conn, fts_terms(q), "AND", type, tag, limit, tag_mode)
        if hits:
            return mark_superseded(conn, [n for n, _ in hits])
    where, params = _filters(type, tag, tag_mode)
    if q:
        like = f"%{q}%"
        where.insert(0, "(id LIKE ? OR title LIKE ? OR body LIKE ? OR tags LIKE ?)")
        params = [like] * 4 + params
    sql = "SELECT * FROM nodes"
    if where:
        sql += " WHERE " + " AND ".join(where)
    sql += " ORDER BY updated_at DESC, id LIMIT ?"
    params.append(limit)
    return mark_superseded(conn, [_decode(r) for r in conn.execute(sql, params)])


def _links_among(conn, ids):
    if not ids:
        return []
    ph = ",".join("?" * len(ids))
    rows = conn.execute(
        f"SELECT src,dst,rel,weight,created_by FROM edges WHERE src IN ({ph}) AND dst IN ({ph})",
        [*ids, *ids],
    )
    return [
        {"source": r["src"], "target": r["dst"], "rel": r["rel"], "weight": r["weight"],
         "created_by": r["created_by"]}
        for r in rows
    ]


def neighbors(conn, id, depth=1):
    visited = {id}
    frontier = {id}
    for _ in range(depth):
        nxt = set()
        for nid in frontier:
            for r in conn.execute("SELECT src,dst FROM edges WHERE src=? OR dst=?", (nid, nid)):
                for o in (r["src"], r["dst"]):
                    if o not in visited:
                        nxt.add(o)
        visited |= nxt
        frontier = nxt
        if not frontier:
            break
    nodes = [n for n in (get_node(conn, nid) for nid in sorted(visited)) if n]
    return {"nodes": nodes, "links": _links_among(conn, visited)}


def graph(conn, q=None, type=None, tag=None, tag_mode="exact"):
    if q or type or tag:
        nodes = search(conn, q or "", type, tag, limit=-1, tag_mode=tag_mode)  # LIMIT -1 = unbounded
    else:
        nodes = mark_superseded(conn, [_decode(r) for r in conn.execute("SELECT * FROM nodes")])
    return {"nodes": nodes, "links": _links_among(conn, [n["id"] for n in nodes])}


def ingest(conn, payload, created_by):
    n = 0
    for node in payload.get("nodes", []):
        node = dict(node)
        node.setdefault("created_by", created_by)  # per-node provenance wins
        upsert_node(conn, node)
        n += 1
    m = 0
    for e in payload.get("edges", []):
        add_edge(conn, e["src"], e["dst"], e.get("rel", "relates_to"), e.get("weight", 1.0),
                 e.get("created_by", created_by))
        m += 1
    return {"nodes": n, "edges": m}


def stats(conn):
    return {
        "nodes": conn.execute("SELECT COUNT(*) c FROM nodes").fetchone()["c"],
        "edges": conn.execute("SELECT COUNT(*) c FROM edges").fetchone()["c"],
        "by_type": {
            r["type"]: r["c"]
            for r in conn.execute("SELECT type, COUNT(*) c FROM nodes GROUP BY type")
        },
        "by_rel": {
            r["rel"]: r["c"]
            for r in conn.execute("SELECT rel, COUNT(*) c FROM edges GROUP BY rel")
        },
    }
