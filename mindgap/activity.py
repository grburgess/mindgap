"""Activity feed: append-only JSONL of node touches, for the live
'neurons firing' web view (Neural Vault-style). Writers: mcp.py tool calls,
POST /api/activity (external hooks). Reader: GET /api/activity.

Event: {"ts": epoch_ms, "kind": "read"|"write", "ids": [node_id...], "actor": str}
"""
import json
import time

from . import config

MAX_IDS = 50           # cap per event — a 200-hit find shouldn't strobe the whole graph
TAIL_BYTES = 65536     # readers only ever look at the recent tail
ROTATE_BYTES = 1 << 20  # rewrite the file down to the tail once it grows past 1 MiB

KINDS = {"read", "write"}


def record(kind, ids, actor="mcp"):
    """Append one event. Invalid/empty input is dropped silently — the feed is
    eye-candy and must never break a caller."""
    if kind not in KINDS:
        return
    ids = [i for i in ids if isinstance(i, str) and i][:MAX_IDS]
    if not ids:
        return
    path = config.activity_path()
    evt = {"ts": int(time.time() * 1000), "kind": kind, "ids": ids, "actor": str(actor)}
    with open(path, "a", encoding="utf-8") as f:
        f.write(json.dumps(evt) + "\n")
    if path.stat().st_size > ROTATE_BYTES:
        path.write_text("\n".join(_tail_lines(path)) + "\n", encoding="utf-8")


def tail(since_ms=0):
    """Events with ts > since_ms from the file tail (bounded read), oldest first."""
    path = config.activity_path()
    if not path.exists():
        return []
    out = []
    for line in _tail_lines(path):
        try:
            evt = json.loads(line)
        except ValueError:
            continue
        if isinstance(evt, dict) and evt.get("ts", 0) > since_ms:
            out.append(evt)
    return out


def _tail_lines(path):
    with open(path, "rb") as f:
        f.seek(0, 2)
        size = f.tell()
        f.seek(max(0, size - TAIL_BYTES))
        data = f.read().decode("utf-8", "replace")
    lines = data.splitlines()
    if size > TAIL_BYTES and lines:
        lines = lines[1:]   # drop the partial first line of a mid-file seek
    return lines
