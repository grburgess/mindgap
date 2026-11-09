"""Two-way Obsidian vault sync (manual, `mindgap sync`).

One <id>.md per node: YAML frontmatter (id,title,type,tags,confidence,urls,links)
+ the node body. `links` = every NON-mentions out-edge; body [[...]] links stay
mentions edges via db.sync_wiki_edges. State (.mindgap_sync.json in the vault) holds
per-file content hash + per-node DB fingerprint (hash of its rendered file) at last
sync, so each side's changes are detectable.

Rules: both sides changed -> graph wins, vault copy kept as <id>.conflict.md.
File deleted in vault -> node kept, reported, re-exported next sync. Unparseable
frontmatter -> file skipped whole. Node deleted in graph -> vault file removed.
The DB is backed up (sqlite backup API) next to itself before every sync.
"""
import hashlib
import json
import re
import sqlite3
from datetime import datetime, timezone
from pathlib import Path

from . import db

STATE_FILE = ".mindgap_sync.json"
CONFLICT_SUFFIX = ".conflict.md"
_KEY = re.compile(r"^([A-Za-z_][\w-]*):(?:\s+(.*))?$")
_KEY_ORDER = ("rel", "dst", "label", "url", "kind")  # emit order for list-item mappings


# ---------- minimal YAML (the subset this module emits, plus common hand edits) ----------

def _q(v):
    return json.dumps(v, ensure_ascii=False)  # JSON scalars are valid YAML flow scalars


def _emit_item(d):
    keys = [k for k in _KEY_ORDER if k in d] + sorted(k for k in d if k not in _KEY_ORDER)
    if not keys or not all(_KEY.match(f"{k}:") for k in keys):
        return [f"  - {_q(d)}"]
    out = [f"  - {keys[0]}: {_q(d[keys[0]])}"]
    out += [f"    {k}: {_q(d[k])}" for k in keys[1:]]
    return out


def _emit_list(key, items):
    if not items:
        return [f"{key}: []"]
    out = [f"{key}:"]
    for it in items:
        out += _emit_item(it) if isinstance(it, dict) else [f"  - {_q(it)}"]
    return out


def _scalar(s):
    s = s.strip()
    if s == "" or s == "~":
        return None
    try:
        return json.loads(s)  # "..", numbers, true/false/null, JSON flow [..] / {..}
    except ValueError:
        pass
    if len(s) >= 2 and s[0] == s[-1] == "'":
        return s[1:-1].replace("''", "'")
    if s[0] in "\"'{":
        raise ValueError(f"bad scalar: {s}")
    if s[0] == "[":
        if s[-1] != "]":
            raise ValueError(f"bad flow list: {s}")
        inner = s[1:-1].strip()
        return [_scalar(p) for p in inner.split(",")] if inner else []
    return s


def parse_yaml(lines):
    out, i = {}, 0
    while i < len(lines):
        line = lines[i]
        if not line.strip() or line.lstrip().startswith("#"):
            i += 1
            continue
        if line[0].isspace():
            raise ValueError(f"unexpected indent: {line.strip()}")
        m = _KEY.match(line)
        if not m:
            raise ValueError(f"bad line: {line}")
        key, val = m.group(1), m.group(2)
        i += 1
        if val is not None and val.strip():
            out[key] = _scalar(val)
            continue
        items = []  # block list (or nothing -> None)
        while i < len(lines) and (not lines[i].strip() or lines[i][0].isspace()):
            ln = lines[i]
            i += 1
            if not ln.strip():
                continue
            dash = re.match(r"^(\s*)-(?:\s+(.*))?$", ln)
            if dash:
                content = (dash.group(2) or "").strip()
                km = _KEY.match(content) if content[:1] not in "\"'[{" else None
                if km:
                    item = {km.group(1): _scalar(km.group(2) or "")}
                    ind = len(dash.group(1))
                    while i < len(lines) and lines[i].strip() and \
                            len(lines[i]) - len(lines[i].lstrip()) > ind and \
                            not lines[i].lstrip().startswith("-"):
                        cm = _KEY.match(lines[i].strip())
                        if not cm:
                            raise ValueError(f"bad mapping line: {lines[i].strip()}")
                        item[cm.group(1)] = _scalar(cm.group(2) or "")
                        i += 1
                    items.append(item)
                else:
                    items.append(_scalar(content))
            else:
                raise ValueError(f"bad block line under {key}: {ln.strip()}")
        out[key] = items if items else None
    return out


def split_frontmatter(text):
    """-> (frontmatter dict, body). No frontmatter -> ({}, text). Raises ValueError."""
    if not (text.startswith("---\n") or text.startswith("---\r\n")):
        return {}, text
    rest = text.split("\n", 1)[1]
    pos, lines = 0, []
    while True:
        nl = rest.find("\n", pos)
        line = rest[pos:] if nl < 0 else rest[pos:nl]
        if line.rstrip("\r") == "---":
            body = "" if nl < 0 else rest[nl + 1:]
            return parse_yaml(lines), body
        if nl < 0:
            raise ValueError("frontmatter not closed")
        lines.append(line.rstrip("\r"))
        pos = nl + 1


def _validate(fm):
    for k in ("id", "title", "type"):
        if k in fm:
            if isinstance(fm[k], bool) or not isinstance(fm[k], (str, int, float)) or fm[k] == "":
                raise ValueError(f"{k} must be a non-empty string")
            fm[k] = str(fm[k])
    if "confidence" in fm and (isinstance(fm["confidence"], bool)
                               or not isinstance(fm["confidence"], (int, float))):
        raise ValueError("confidence must be a number")
    for k in ("tags", "urls", "links"):
        if k in fm:
            fm[k] = fm[k] if fm[k] is not None else []
            if not isinstance(fm[k], list):
                raise ValueError(f"{k} must be a list")
    if "tags" in fm and not all(isinstance(t, str) for t in fm["tags"]):
        raise ValueError("tags must be strings")
    if "urls" in fm and not all(isinstance(u, (str, dict)) for u in fm["urls"]):
        raise ValueError("urls must be strings or mappings")
    for l in fm.get("links", []):
        if not (isinstance(l, dict) and isinstance(l.get("rel"), str) and l["rel"]
                and isinstance(l.get("dst"), str) and l["dst"]):
            raise ValueError("links entries need rel and dst")
    return fm


def parse_file(text):
    fm, body = split_frontmatter(text)
    return _validate(fm), body


# ---------- render / fingerprint ----------

def _sha(text):
    return hashlib.sha256(text.encode("utf-8")).hexdigest()


def _out_links(conn, nid):
    return [(r["rel"], r["dst"]) for r in conn.execute(
        "SELECT rel,dst FROM edges WHERE src=? AND rel!='mentions' ORDER BY rel,dst", (nid,))]


def render(conn, nid):
    n = db.get_node(conn, nid)
    lines = ["---", f"id: {_q(n['id'])}", f"title: {_q(n['title'])}", f"type: {_q(n['type'])}"]
    lines += _emit_list("tags", n["tags"])
    lines.append(f"confidence: {_q(n['confidence'])}")
    lines += _emit_list("urls", n["urls"])
    lines += _emit_list("links", [{"rel": r, "dst": d} for r, d in _out_links(conn, nid)])
    lines.append("---")
    return "\n".join(lines) + "\n" + n["body"]


def _apply(conn, nid, fm, body, new):
    node = {"id": nid, "body": body}
    for k in ("title", "type", "confidence", "tags", "urls"):
        if k in fm:
            node[k] = fm[k]
    if new:
        node.setdefault("title", nid)
        node["created_by"] = "vault"
    db.upsert_node(conn, node, replace=True, commit=False)
    if "links" in fm:
        want = {(l["rel"], l["dst"]) for l in fm["links"] if l["rel"] != "mentions"}
        have = set(_out_links(conn, nid))
        for rel, dst in sorted(want - have):
            db.add_edge(conn, nid, dst, rel, created_by="vault", commit=False)
        for rel, dst in sorted(have - want):
            conn.execute("DELETE FROM edges WHERE src=? AND dst=? AND rel=?", (nid, dst, rel))


# ---------- sync ----------

def backup_db(conn):
    """Copy the open DB to <db>.<UTC stamp>.bak beside it (sqlite backup API)."""
    src = Path(conn.execute("PRAGMA database_list").fetchone()["file"])
    stamp = datetime.now(timezone.utc).strftime("%Y%m%dT%H%M%S%fZ")
    dst_path = src.with_name(f"{src.name}.{stamp}.bak")
    dst = sqlite3.connect(str(dst_path))
    try:
        conn.backup(dst)
    finally:
        dst.close()
    return dst_path


def _edge_set(conn):
    return {(r["src"], r["dst"], r["rel"]) for r in conn.execute("SELECT src,dst,rel FROM edges")}


def _safe_id(nid):
    return "/" not in nid and "\\" not in nid and not nid.startswith(".")


def sync(conn, vault):
    vault = Path(vault)
    vault.mkdir(parents=True, exist_ok=True)
    rep = {k: [] for k in ("exported", "applied", "created", "conflicts", "skipped",
                           "deleted_in_vault", "removed_files", "edges_added", "edges_removed")}
    rep["backup"] = str(backup_db(conn))
    sp = vault / STATE_FILE
    st = json.loads(sp.read_text()) if sp.exists() else {}
    st_files, st_nodes = st.get("files", {}), st.get("nodes", {})
    edges_before = _edge_set(conn)
    db_ids = {r["id"] for r in conn.execute("SELECT id FROM nodes")}

    seen = {}       # id -> on-disk text (file present, consistent)
    fresh = set()   # ids whose file text is authoritative this sync (applied/created/adopted)
    force = set()   # conflicts: graph version must be written
    hold = set()    # skipped stems: leave file + state untouched

    # phase 1: vault -> graph
    for path in sorted(vault.glob("*.md")):
        if path.name.endswith(CONFLICT_SUFFIX) or path.name.startswith("."):
            continue
        stem, text = path.stem, path.read_text(encoding="utf-8")
        tracked = stem in st_files
        if tracked and st_files[stem] == _sha(text):  # vault side unchanged
            if stem in db_ids:
                seen[stem] = text
            else:  # node deleted graph-side
                path.unlink()
                rep["removed_files"].append(path.name)
            continue
        try:
            fm, body = parse_file(text)
        except ValueError as e:
            rep["skipped"].append(f"{path.name}: {e}")
            hold.add(stem)
            continue
        nid = fm.get("id") or (stem if tracked else db.slugify(stem))
        if nid != stem and (tracked or nid in db_ids or (vault / f"{nid}.md").exists()
                            or not _safe_id(nid)):
            rep["skipped"].append(f"{path.name}: id {nid!r} does not match filename")
            hold.add(stem)
            continue
        if nid in db_ids:
            graph_text = render(conn, nid)
            if not tracked and text == graph_text:  # adopt identical untracked file
                seen[nid] = text
                fresh.add(nid)
                continue
            if not tracked or st_nodes.get(nid) != _sha(graph_text):  # both changed
                (vault / f"{nid}{CONFLICT_SUFFIX}").write_text(text, encoding="utf-8")
                rep["conflicts"].append(nid)
                force.add(nid)
                continue
            _apply(conn, nid, fm, body, new=False)
            rep["applied"].append(nid)
        elif tracked:  # graph deleted the node, vault edited it: keep copy, remove file
            (vault / f"{nid}{CONFLICT_SUFFIX}").write_text(text, encoding="utf-8")
            path.unlink()
            rep["conflicts"].append(nid)
            rep["removed_files"].append(path.name)
            continue
        else:
            _apply(conn, nid, fm, body, new=True)
            rep["created"].append(nid)
            if nid != stem:
                path.rename(vault / f"{nid}.md")
        seen[nid] = text
        fresh.add(nid)
    conn.commit()

    # phase 2: graph -> vault
    new_files = {s: st_files[s] for s in hold if s in st_files}
    new_nodes = {s: st_nodes[s] for s in hold if s in st_nodes}
    for nid in sorted(r["id"] for r in conn.execute("SELECT id FROM nodes")):
        if nid in hold:
            continue
        if not _safe_id(nid):
            rep["skipped"].append(f"{nid}: id not usable as a filename")
            continue
        text = render(conn, nid)
        fp = _sha(text)
        if nid in fresh:
            disk = seen[nid]
        elif nid in force or (nid in seen and st_nodes.get(nid) != fp) or \
                (nid not in seen and nid not in st_files):
            (vault / f"{nid}.md").write_text(text, encoding="utf-8")
            rep["exported"].append(nid)
            disk = text
        elif nid in seen:
            disk = seen[nid]
        else:  # was synced, file deleted in vault: report now, re-export next sync
            rep["deleted_in_vault"].append(nid)
            continue
        new_files[nid] = _sha(disk)
        new_nodes[nid] = fp
    sp.write_text(json.dumps({"files": new_files, "nodes": new_nodes}, indent=1, sort_keys=True))

    edges_after = _edge_set(conn)
    rep["edges_added"] = sorted(edges_after - edges_before)
    rep["edges_removed"] = sorted(edges_before - edges_after)
    rep["changes"] = sum(len(v) for k, v in rep.items() if isinstance(v, list))
    return rep


def format_report(rep):
    out = [f"backup: {rep['backup']}", f"changes: {rep['changes']}"]
    for k in ("exported", "applied", "created", "conflicts", "skipped", "deleted_in_vault",
              "removed_files", "edges_added", "edges_removed"):
        items = rep[k]
        out.append(f"{k}: {len(items)}")
        for it in items[:50]:
            out.append(f"  - {it[0]} -[{it[2]}]-> {it[1]}" if isinstance(it, tuple) else f"  - {it}")
        if len(items) > 50:
            out.append(f"  ... +{len(items) - 50} more")
    return "\n".join(out)
