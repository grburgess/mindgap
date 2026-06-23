"""Deterministic graph health report (no LLM): orphans, dangling stubs,
near-duplicate candidates, stale capture nodes. Drives the optional LLM lint pass.
"""
import difflib
from datetime import datetime, timezone


def orphans(conn):
    rows = conn.execute(
        "SELECT id, title, type FROM nodes WHERE id NOT IN "
        "(SELECT src FROM edges UNION SELECT dst FROM edges) ORDER BY id")
    return [dict(r) for r in rows]


def dangling_stubs(conn):
    rows = conn.execute("SELECT id, title FROM nodes WHERE type='stub' ORDER BY id")
    return [dict(r) for r in rows]


def duplicate_candidates(conn, threshold=0.86):
    rows = [dict(r) for r in conn.execute("SELECT id, title FROM nodes ORDER BY id")]
    out = []
    for i in range(len(rows)):
        for j in range(i + 1, len(rows)):
            a, b = rows[i], rows[j]
            ratio = difflib.SequenceMatcher(
                None, a["title"].lower(), b["title"].lower()).ratio()
            if ratio >= threshold:
                out.append({"a": a["id"], "b": b["id"], "ratio": round(ratio, 3)})
    return out


def stale_capture(conn, stale_days=60, below_confidence=0.7):
    cutoff = datetime.now(timezone.utc).timestamp() - stale_days * 86400
    out = []
    for r in conn.execute(
        "SELECT id, title, confidence, created_by, updated_at FROM nodes "
        "WHERE created_by LIKE 'capture:%' AND confidence < ? ORDER BY updated_at",
        (below_confidence,),
    ):
        try:
            ts = datetime.fromisoformat(r["updated_at"]).timestamp()
        except (ValueError, TypeError):
            continue
        if ts < cutoff:
            out.append(dict(r))
    return out


def report(conn, stale_days=60, below_confidence=0.7, dup_threshold=0.86):
    return {
        "orphans": orphans(conn),
        "dangling_stubs": dangling_stubs(conn),
        "duplicate_candidates": duplicate_candidates(conn, dup_threshold),
        "stale_capture": stale_capture(conn, stale_days, below_confidence),
    }
