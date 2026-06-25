"""Stdlib-only MCP server over the mindgap db.

Sibling of server.py (HTTP API) — same db layer, agent-native front-end via
newline-delimited JSON-RPC 2.0 on stdin/stdout. NO pip deps (json + sys only).
Launched as `python3 -m mindgap.mcp`.
"""
import json
import sys
from datetime import datetime, timezone

from . import config, db

PROTOCOL_VERSION = "2025-06-18"
SUPPORTED_VERSIONS = {"2025-06-18", "2025-03-26", "2024-11-05"}
SERVER_INFO = {"name": "mindgap", "version": "0.1.0"}
INSTRUCTIONS = (
    "Local org-roam-style knowledge graph. Prefer mindgap_ingest for batch writes "
    "(it validates edge endpoints whole-payload, no partial commit) and returns the "
    "persisted rows so you can't claim a write that didn't land. mindgap_link hard-fails "
    "on a nonexistent endpoint instead of auto-stubbing. created_by is required on writes."
)

# AGENTS vocabularies (convention, not enforced — soft warn only).
TYPES = {"concept", "definition", "software", "repo", "page", "paper", "person",
         "team", "stub"}
RELS = {"relates_to", "defines", "implements", "depends_on", "cites", "part_of",
        "mentions"}
PROVENANCE_HINT = "created_by should be 'loop:<name>', 'manual', or 'mcp' (AGENTS rule 2)"


class ToolError(Exception):
    """Raised by a handler to produce an isError tool result (not a JSON-RPC error)."""


# --------------------------------------------------------------------------- #
# JSON-RPC plumbing                                                            #
# --------------------------------------------------------------------------- #
def _result(id, value):
    return {"jsonrpc": "2.0", "id": id, "result": value}


def _error(id, code, message, data=None):
    err = {"code": code, "message": message}
    if data is not None:
        err["data"] = data
    return {"jsonrpc": "2.0", "id": id, "error": err}


def _tool_result(text, is_error):
    return {"content": [{"type": "text", "text": text}], "isError": is_error}


# --------------------------------------------------------------------------- #
# Validation helpers (the point of this server)                               #
# --------------------------------------------------------------------------- #
def _require_created_by(args):
    cb = args.get("created_by")
    if not isinstance(cb, str) or not cb.strip():
        raise ToolError("created_by is required (non-empty string)")
    return cb


def _provenance_warnings(created_by, warnings):
    if created_by != "manual" and created_by != "mcp" and not created_by.startswith("loop:"):
        warnings.append(PROVENANCE_HINT)


def _type_rel_warnings(node_or_edge, warnings):
    t = node_or_edge.get("type")
    if t is not None and t not in TYPES:
        warnings.append(f"out-of-vocab type: {t!r}")
    r = node_or_edge.get("rel")
    if r is not None and r not in RELS:
        warnings.append(f"out-of-vocab rel: {r!r}")


def _existing_ids(conn):
    return {r["id"] for r in conn.execute("SELECT id FROM nodes")}


def _reject_unknown_keys(tool, arguments):
    # Enforce the advertised additionalProperties:false at the top level so a
    # typo'd key (e.g. 'titel', or a dropped 'replace') is a visible isError
    # rather than silently discarded.
    allowed = set(tool["inputSchema"].get("properties", {}))
    extra = sorted(k for k in arguments if k not in allowed)
    if extra:
        raise ToolError(f"unknown argument(s): {', '.join(extra)}")


# --------------------------------------------------------------------------- #
# Tool handlers — each returns a (json/markdown text, is_error=False) value;   #
# raises ToolError for tool-level failures.                                    #
# --------------------------------------------------------------------------- #
def tool_ingest(conn, args):
    created_by = _require_created_by(args)
    nodes = args.get("nodes") or []
    edges = args.get("edges") or []
    warnings = []
    _provenance_warnings(created_by, warnings)

    # node id must be a slug so [[wiki-links]] resolve.
    for node in nodes:
        nid = node.get("id")
        title = node.get("title")
        if not isinstance(nid, str) or not nid:
            raise ToolError("each node needs an 'id'")
        if not isinstance(title, str) or not title:
            raise ToolError(f"node {nid!r} needs a 'title'")
        if nid != db.slugify(nid):
            raise ToolError(f"node id {nid!r} is not a slug (must equal slugify(id))")
        _type_rel_warnings(node, warnings)

    # Whole-payload endpoint check BEFORE any write: valid = DB ids ∪ payload ids.
    valid = _existing_ids(conn) | {n["id"] for n in nodes}
    for e in edges:
        src, dst = e.get("src"), e.get("dst")
        if not isinstance(src, str) or not isinstance(dst, str) or not src or not dst:
            raise ToolError("each edge needs 'src' and 'dst'")
        if src not in valid or dst not in valid:
            missing = [x for x in (src, dst) if x not in valid]
            raise ToolError(
                f"edge endpoint(s) not in DB or payload: {', '.join(missing)} "
                "(whole payload rejected, nothing written)"
            )
        _type_rel_warnings(e, warnings)

    before = _existing_ids(conn)
    # Real all-or-nothing transaction: the db helpers defer their commit
    # (commit=False), so a failure mid-loop rolls back every prior write —
    # no partial commit, no orphan stub. We commit exactly once on success.
    try:
        for node in nodes:
            node = dict(node)
            node.setdefault("created_by", created_by)
            node.setdefault("confidence", 0.7)
            db.upsert_node(conn, node, commit=False)
        for e in edges:
            db.add_edge(conn, e["src"], e["dst"], e.get("rel", "relates_to"),
                        e.get("weight", 1.0), e.get("created_by", created_by),
                        commit=False)
        conn.commit()
    except Exception:
        conn.rollback()
        raise

    after = _existing_ids(conn)
    payload_ids = {n["id"] for n in nodes}
    stubs_created = sorted(after - before - payload_ids)
    for s in stubs_created:
        warnings.append(f"new stub minted by wiki-link: {s}")
    for nid in sorted(payload_ids):
        if _edgeless(conn, nid):
            warnings.append(f"island: {nid} has no edge or wiki-link")

    persisted_nodes = [db.get_node(conn, nid) for nid in [n["id"] for n in nodes]]
    persisted_edges = [
        {"src": e["src"], "dst": e["dst"], "rel": e.get("rel", "relates_to"),
         "weight": e.get("weight", 1.0)}
        for e in edges
    ]
    return {
        "counts": {"nodes": len(nodes), "edges": len(edges)},
        "nodes": persisted_nodes,
        "edges": persisted_edges,
        "stubs_created": stubs_created,
        "warnings": warnings,
    }


def tool_add_node(conn, args):
    created_by = _require_created_by(args)
    title = args.get("title")
    if not isinstance(title, str) or not title:
        raise ToolError("title is required")
    nid = args.get("id")
    if nid is not None and nid != db.slugify(nid):
        raise ToolError(f"node id {nid!r} is not a slug (must equal slugify(id))")
    warnings = []
    _provenance_warnings(created_by, warnings)
    _type_rel_warnings(args, warnings)

    node = {"title": title, "created_by": created_by, "confidence": 0.7}
    for k in ("id", "type", "body", "tags", "urls", "confidence"):
        if k in args:
            node[k] = args[k]

    before = _existing_ids(conn)
    row = db.upsert_node(conn, node, replace=bool(args.get("replace", False)))
    conn.commit()
    after = _existing_ids(conn)
    stubs_created = sorted(after - before - {row["id"]})
    for s in stubs_created:
        warnings.append(f"new stub minted by wiki-link: {s}")
    if _edgeless(conn, row["id"]):
        warnings.append(f"island: {row['id']} has no edge or wiki-link")

    out = dict(row)
    out["stubs_created"] = stubs_created
    out["warnings"] = warnings
    return out


def tool_link(conn, args):
    created_by = _require_created_by(args)
    src, dst = args.get("src"), args.get("dst")
    if not isinstance(src, str) or not src or not isinstance(dst, str) or not dst:
        raise ToolError("src and dst are required")
    rel = args.get("rel", "relates_to")
    weight = args.get("weight", 1.0)
    warnings = []
    _provenance_warnings(created_by, warnings)
    _type_rel_warnings(args, warnings)

    # HARD-FAIL on a nonexistent endpoint — do NOT auto-stub (diverges from CLI).
    existing = _existing_ids(conn)
    missing = [x for x in (src, dst) if x not in existing]
    if missing:
        raise ToolError(
            f"link endpoint(s) not in DB: {', '.join(missing)} "
            "(refusing to auto-stub; create the node first)"
        )

    existed = conn.execute(
        "SELECT 1 FROM edges WHERE src=? AND dst=? AND rel=?", (src, dst, rel)
    ).fetchone() is not None
    db.add_edge(conn, src, dst, rel, weight, created_by)
    return {
        "edge": {"src": src, "dst": dst, "rel": rel, "weight": weight,
                 "created_by": created_by},
        "existed": existed,
        "warnings": warnings,
    }


def _edgeless(conn, node_id):
    return conn.execute(
        "SELECT 1 FROM edges WHERE src=? OR dst=?", (node_id, node_id)
    ).fetchone() is None


def tool_unlink(conn, args):
    src, dst = args.get("src"), args.get("dst")
    if not isinstance(src, str) or not src or not isinstance(dst, str) or not dst:
        raise ToolError("src and dst are required")
    rel = args.get("rel")
    if rel:
        removed = conn.execute(
            "SELECT COUNT(*) c FROM edges WHERE src=? AND dst=? AND rel=?",
            (src, dst, rel)).fetchone()["c"]
    else:
        removed = conn.execute(
            "SELECT COUNT(*) c FROM edges WHERE src=? AND dst=?",
            (src, dst)).fetchone()["c"]
    db.delete_edge(conn, src, dst, rel)
    orphaned = [n for n in (src, dst)
                if db.get_node(conn, n) is not None and _edgeless(conn, n)]
    return {"removed": removed, "orphaned": orphaned}


def tool_get_node(conn, args):
    nid = args.get("id")
    if not isinstance(nid, str) or not nid:
        raise ToolError("id is required")
    depth = int(args.get("depth", 1))
    depth = max(1, min(depth, 3))
    node = db.get_node(conn, nid)
    if node is None:
        return {"node": None, "neighbors": {"nodes": [], "links": []}}
    return {"node": node, "neighbors": db.neighbors(conn, nid, depth=depth)}


def tool_find(conn, args):
    limit = int(args.get("limit", 50))
    limit = max(1, min(limit, 200))
    results = db.search(conn, q=args.get("query", "") or "", type=args.get("type"),
                        tag=args.get("tag"), limit=limit)
    return {"results": results, "count": len(results)}


def tool_context(conn, args):
    query = args.get("query")
    if not isinstance(query, str) or not query:
        raise ToolError("query is required")
    depth = int(args.get("depth", 1))
    depth = max(1, min(depth, 3))
    nodes = db.search(conn, q=query)
    lines = []
    for node in nodes:
        lines.append(f"## {node['title']} ({node['id']}) [{node['type']}]")
        if node["tags"]:
            lines.append("tags: " + ", ".join(node["tags"]))
        if node["body"]:
            lines.append("")
            lines.append(node["body"])
        if node["urls"]:
            lines.append("")
            for u in node["urls"]:
                lines.append(f"- [{u['label']}]({u['url']})")
        nb = db.neighbors(conn, node["id"], depth=depth)
        titles = {n["id"]: n["title"] for n in nb["nodes"]}
        if nb["links"]:
            lines.append("")
            for link in nb["links"]:
                src, dst = link["source"], link["target"]
                if src == node["id"]:
                    lines.append(f"- {link['rel']} -> {dst} ({titles.get(dst, dst)})")
                elif dst == node["id"]:
                    lines.append(f"- {link['rel']} <- {src} ({titles.get(src, src)})")
        lines.append("")
    return {"markdown": "\n".join(lines), "matched": len(nodes)}


def tool_mine_enrich(conn, args):
    from . import mine
    seed = args.get("seed")
    if not isinstance(seed, str) or not seed:
        raise ToolError("seed is required")
    return mine.enrich(conn, seed, k=args.get("k", 12))


def tool_mine_learn(conn, args):
    from . import mine
    return mine.learn(conn, top=args.get("top", 20), emit=args.get("emit", True))


def tool_mine_connect(conn, args):
    from . import mine
    return mine.connect_candidates(conn, k=args.get("k", 15))


def tool_stats(conn, args):
    return db.stats(conn)


def tool_export(conn, args):
    g = db.graph(conn)
    payload = {
        "nodes": g["nodes"],
        "edges": [
            {"src": l["source"], "dst": l["target"], "rel": l["rel"],
             "weight": l["weight"], "created_by": l["created_by"]}
            for l in g["links"]
        ],
    }
    out = args.get("out")
    if out:
        out = str(out)
    else:
        stamp = datetime.now(timezone.utc).strftime("%Y%m%dT%H%M%SZ")
        out = str(config.snapshots_dir() / f"{stamp}.json")
    with open(out, "w") as f:
        json.dump(payload, f, indent=2)
    return {"path": out,
            "counts": {"nodes": len(payload["nodes"]), "edges": len(payload["edges"])}}


def tool_remove_node(conn, args):
    nid = args.get("id")
    if not isinstance(nid, str) or not nid:
        raise ToolError("id is required")
    db.delete_node(conn, nid)
    return {"removed": True, "id": nid}


# --------------------------------------------------------------------------- #
# Tool registry + schemas                                                      #
# --------------------------------------------------------------------------- #
_STR = {"type": "string"}
_NUM = {"type": "number"}
_INT = {"type": "integer"}
_STRARR = {"type": "array", "items": {"type": "string"}}
_URLARR = {"type": "array", "items": {"type": "object"}}


def _schema(properties, required=()):
    return {
        "type": "object",
        "properties": properties,
        "required": list(required),
        "additionalProperties": False,
    }


_NODE_ITEM = {
    "type": "object",
    "properties": {
        "id": _STR, "title": _STR, "type": _STR, "body": _STR,
        "tags": _STRARR, "urls": _URLARR, "confidence": _NUM, "created_by": _STR,
    },
    "required": ["id", "title"],
    "additionalProperties": False,
}
_EDGE_ITEM = {
    "type": "object",
    "properties": {
        "src": _STR, "dst": _STR, "rel": _STR, "weight": _NUM, "created_by": _STR,
    },
    "required": ["src", "dst"],
    "additionalProperties": False,
}

TOOLS = [
    {
        "name": "mindgap_ingest",
        "description": "Validated batch write (workhorse). Upserts nodes + adds edges in "
                       "one transaction; rejects the WHOLE payload (no partial commit) if any "
                       "edge endpoint is neither in the DB nor in the payload. Returns the "
                       "persisted rows so a caller can't claim a write that didn't land.",
        "handler": tool_ingest,
        "inputSchema": _schema(
            {
                "created_by": _STR,
                "nodes": {"type": "array", "items": _NODE_ITEM},
                "edges": {"type": "array", "items": _EDGE_ITEM},
            },
            required=["created_by"],
        ),
    },
    {
        "name": "mindgap_add_node",
        "description": "Single node upsert. Returns the persisted row plus stubs_created and "
                       "warnings. confidence defaults to 0.7.",
        "handler": tool_add_node,
        "inputSchema": _schema(
            {
                "created_by": _STR, "title": _STR, "id": _STR, "type": _STR,
                "body": _STR, "tags": _STRARR, "urls": _URLARR,
                "confidence": _NUM, "replace": {"type": "boolean"},
            },
            required=["created_by", "title"],
        ),
    },
    {
        "name": "mindgap_link",
        "description": "Add one edge between two EXISTING nodes. Hard-fails (isError) if "
                       "either endpoint is missing — does not auto-stub.",
        "handler": tool_link,
        "inputSchema": _schema(
            {"created_by": _STR, "src": _STR, "dst": _STR, "rel": _STR, "weight": _NUM},
            required=["created_by", "src", "dst"],
        ),
    },
    {
        "name": "mindgap_unlink",
        "description": "Delete edge(s) between src and dst (optionally a specific rel). "
                       "Returns removed count and any nodes left edgeless.",
        "handler": tool_unlink,
        "inputSchema": _schema(
            {"src": _STR, "dst": _STR, "rel": _STR},
            required=["src", "dst"],
        ),
    },
    {
        "name": "mindgap_get_node",
        "description": "Fetch a node and its neighborhood (depth 1..3, default 1). Missing "
                       "id returns node:null (clean miss, not an error).",
        "handler": tool_get_node,
        "inputSchema": _schema(
            {"id": _STR, "depth": {"type": "integer", "minimum": 1, "maximum": 3}},
            required=["id"],
        ),
    },
    {
        "name": "mindgap_find",
        "description": "Search nodes by query/type/tag. Returns results + count "
                       "(limit 1..200, default 50).",
        "handler": tool_find,
        "inputSchema": _schema(
            {"query": _STR, "type": _STR, "tag": _STR,
             "limit": {"type": "integer", "minimum": 1, "maximum": 200}},
        ),
    },
    {
        "name": "mindgap_context",
        "description": "Render a markdown digest (matched nodes + neighbor links) for a "
                       "query, mirroring `mindgap context`. Read-only.",
        "handler": tool_context,
        "inputSchema": _schema(
            {"query": _STR, "depth": {"type": "integer", "minimum": 1, "maximum": 3}},
            required=["query"],
        ),
    },
    {
        "name": "mindgap_stats",
        "description": "Graph counts: {nodes, edges, by_type, by_rel}.",
        "handler": tool_stats,
        "inputSchema": _schema({}),
    },
    {
        "name": "mindgap_export",
        "description": "Write a JSON snapshot of the whole graph. Default path "
                       "data/snapshots/<UTC stamp>.json; absolute out path allowed.",
        "handler": tool_export,
        "inputSchema": _schema({"out": _STR}),
    },
    {
        "name": "mindgap_remove_node",
        "description": "Delete a node (cascades its edges). Destructive; for stub cleanup.",
        "handler": tool_remove_node,
        "inputSchema": _schema({"id": _STR}, required=["id"]),
    },
    {
        "name": "mindgap_mine_enrich",
        "description": "Enrich: random-walk-with-restart ranked relevant subgraph for a seed "
                       "node/topic — reaches 2-3 hops, unlike 1-hop context. Read-only.",
        "handler": tool_mine_enrich,
        "inputSchema": _schema(
            {"seed": _STR, "k": {"type": "integer", "minimum": 1, "maximum": 50}},
            required=["seed"]),
    },
    {
        "name": "mindgap_mine_learn",
        "description": "Learn: ranked learning frontier (thin spots / stubs / fresh-thin papers / "
                       "in-demand-thin concepts) with reasons; writes frontier.json for the loops. "
                       "Read-only except the frontier file.",
        "handler": tool_mine_learn,
        "inputSchema": _schema(
            {"top": {"type": "integer", "minimum": 1, "maximum": 100},
             "emit": {"type": "boolean"}}),
    },
    {
        "name": "mindgap_mine_connect",
        "description": "Connect: guarded Adamic-Adar latent-link suggestions (non-adjacent pairs "
                       "that should plausibly be linked) with both node bodies + shared support, "
                       "for you to adjudicate. Read-only — write confirmed links via mindgap_ingest "
                       "(created_by 'mine:connect').",
        "handler": tool_mine_connect,
        "inputSchema": _schema({"k": {"type": "integer", "minimum": 1, "maximum": 50}}),
    },
]

_BY_NAME = {t["name"]: t for t in TOOLS}


def _tools_listing():
    return [{"name": t["name"], "description": t["description"],
             "inputSchema": t["inputSchema"]} for t in TOOLS]


# --------------------------------------------------------------------------- #
# Dispatch                                                                     #
# --------------------------------------------------------------------------- #
def dispatch(msg, conn):
    """Handle one parsed JSON-RPC message dict. Returns a response dict, or None
    for notifications. Protocol failures → JSON-RPC error; tool failures → a
    normal result with isError:true."""
    if not isinstance(msg, dict) or msg.get("jsonrpc") != "2.0" or "method" not in msg:
        return _error(msg.get("id") if isinstance(msg, dict) else None,
                      -32600, "invalid request")
    method = msg["method"]
    mid = msg.get("id")
    is_notification = "id" not in msg

    if method == "notifications/initialized":
        return None
    if is_notification:
        # Unknown notifications: do nothing, write nothing.
        return None

    if method == "initialize":
        params = msg.get("params") or {}
        requested = params.get("protocolVersion")
        version = requested if requested in SUPPORTED_VERSIONS else PROTOCOL_VERSION
        return _result(mid, {
            "protocolVersion": version,
            "capabilities": {"tools": {"listChanged": False}},
            "serverInfo": SERVER_INFO,
            "instructions": INSTRUCTIONS,
        })
    if method == "ping":
        return _result(mid, {})
    if method == "tools/list":
        return _result(mid, {"tools": _tools_listing()})
    if method == "tools/call":
        params = msg.get("params") or {}
        name = params.get("name")
        tool = _BY_NAME.get(name)
        if tool is None:
            return _error(mid, -32602, f"unknown tool: {name}")
        arguments = params.get("arguments") or {}
        try:
            _reject_unknown_keys(tool, arguments)
            value = tool["handler"](conn, arguments)
        except ToolError as e:
            return _result(mid, _tool_result(str(e), True))
        except Exception as e:
            # Any handler failure (bad args, sqlite bind error, etc.) is a TOOL
            # error (isError result), never a JSON-RPC protocol error. -32603 is
            # reserved for framework faults outside handler execution (main loop).
            return _result(mid, _tool_result(f"{type(e).__name__}: {e}", True))
        return _result(mid, _tool_result(json.dumps(value), False))

    return _error(mid, -32601, f"method not found: {method}")


# --------------------------------------------------------------------------- #
# stdio read loop                                                              #
# --------------------------------------------------------------------------- #
def _write(msg):
    sys.stdout.write(json.dumps(msg) + "\n")
    sys.stdout.flush()


def main():
    conn = db.connect()
    try:
        for line in sys.stdin:
            line = line.strip()
            if not line:
                continue
            try:
                msg = json.loads(line)
            except ValueError:
                _write(_error(None, -32700, "parse error"))
                continue
            try:
                resp = dispatch(msg, conn)
            except Exception as e:  # never let one bad message kill the server
                _write(_error(msg.get("id") if isinstance(msg, dict) else None,
                              -32603, f"internal error: {e}"))
                continue
            if resp is not None:
                _write(resp)
    finally:
        conn.close()


if __name__ == "__main__":
    main()
