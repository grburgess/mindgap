#!/usr/bin/env python3
"""Scan the inbox folder and diff it against the ingest ledger.

Two modes:

  scan_inbox.py [DIR] [--json]        list files with status new|changed|done|...
  scan_inbox.py --mark -              read {"marks":[...]} on stdin, write the ledger

The ledger (default ~/.mindgap/inbox-ledger.json) maps sha256 -> what was
ingested from that content, so a re-run over an unchanged folder is a no-op and
an edited file (new hash) comes back as `changed`.

Stdlib only.
"""

from __future__ import annotations

import argparse
import hashlib
import json
import os
import sys
import time
from pathlib import Path

# Extensions the skill knows how to get information out of. Anything else is
# reported as `unsupported` rather than silently dropped, so the user finds out.
SUPPORTED = {
    ".pdf", ".md", ".markdown", ".txt", ".rst",
    ".docx", ".pptx", ".xlsx",
    ".png", ".jpg", ".jpeg", ".gif", ".webp",
    ".html", ".htm", ".eml", ".csv", ".tsv",
}

DEFAULT_INBOX = "~/second_brain/inbox"
MAX_MB = 25.0

# A file the user wrote to explain what a folder holds. Read these first — they
# frame every other file beside them.
CONTEXT_NAMES = {
    "readme.md", "readme.txt", "_context.md", "context.md",
    "notes.md", "about.md", "index.md", "_about.md",
}


def inbox_dir(arg: str | None) -> Path:
    return Path(arg or os.environ.get("MINDGAP_INBOX") or DEFAULT_INBOX).expanduser()


def ledger_path(arg: str | None) -> Path:
    if arg:
        return Path(arg).expanduser()
    home = os.environ.get("MINDGAP_HOME") or "~/.mindgap"
    return Path(home).expanduser() / "inbox-ledger.json"


def load_ledger(path: Path) -> dict:
    if not path.exists():
        return {"entries": {}}
    try:
        data = json.loads(path.read_text())
    except (json.JSONDecodeError, OSError) as exc:
        raise SystemExit(f"ledger unreadable ({path}): {exc}")
    data.setdefault("entries", {})
    return data


def save_ledger(path: Path, data: dict) -> None:
    path.parent.mkdir(parents=True, exist_ok=True)
    tmp = path.with_suffix(path.suffix + ".tmp")
    tmp.write_text(json.dumps(data, indent=2, sort_keys=True))
    tmp.replace(path)


def sha256(path: Path) -> str:
    h = hashlib.sha256()
    with path.open("rb") as fh:
        for chunk in iter(lambda: fh.read(1 << 20), b""):
            h.update(chunk)
    return h.hexdigest()


def walk(root: Path, max_mb: float) -> list[dict]:
    """Every regular file under root, hidden paths and symlinks excluded."""
    out = []
    for dirpath, dirnames, filenames in os.walk(root):
        dirnames[:] = sorted(d for d in dirnames if not d.startswith("."))
        for name in sorted(filenames):
            if name.startswith("."):
                continue
            p = Path(dirpath) / name
            if p.is_symlink() or not p.is_file():
                continue
            ext = p.suffix.lower()
            size = p.stat().st_size
            rel = p.relative_to(root)
            folder = str(rel.parent) if str(rel.parent) != "." else ""
            rec = {
                "path": str(p),
                "rel": str(rel),
                "folder": folder,
                "segments": list(rel.parent.parts),
                "context_file": name.lower() in CONTEXT_NAMES,
                "ext": ext,
                "size": size,
                "sha256": None,
                "status": None,
            }
            if size > max_mb * 1024 * 1024:
                rec["status"] = "skipped-large"
            elif ext not in SUPPORTED:
                rec["status"] = "unsupported"
            else:
                rec["sha256"] = sha256(p)
            out.append(rec)
    return out


def classify(records: list[dict], entries: dict) -> None:
    """Fill in status for hashed files by consulting the ledger."""
    by_path = {}
    for sha, entry in entries.items():
        by_path.setdefault(entry.get("path"), []).append(sha)
    for rec in records:
        if rec["status"]:
            continue
        entry = entries.get(rec["sha256"])
        if entry:
            rec["status"] = "done"
            rec["outcome"] = entry.get("outcome", "ingested")
            rec["node_ids"] = entry.get("node_ids", [])
            rec["ingested_at"] = entry.get("ingested_at")
            if entry.get("note"):
                rec["note"] = entry["note"]
        elif by_path.get(rec["path"]):
            rec["status"] = "changed"
        else:
            rec["status"] = "new"


def cmd_scan(args: argparse.Namespace) -> int:
    root = inbox_dir(args.dir)
    lpath = ledger_path(args.ledger)
    if not root.exists():
        payload = {"inbox": str(root), "ledger": str(lpath), "error": "inbox does not exist",
                   "counts": {}, "files": []}
        print(json.dumps(payload, indent=2))
        return 1
    records = walk(root, args.max_mb)
    classify(records, load_ledger(lpath)["entries"])
    if not args.all:
        records = [r for r in records if r["status"] != "done"]
    counts: dict[str, int] = {}
    for r in records:
        counts[r["status"]] = counts.get(r["status"], 0) + 1
    print(json.dumps({
        "inbox": str(root),
        "ledger": str(lpath),
        "counts": counts,
        "pending": sum(counts.get(s, 0) for s in ("new", "changed")),
        "folders": group_by_folder(records),
        "files": records,
    }, indent=2))
    return 0


def group_by_folder(records: list[dict]) -> list[dict]:
    """Folder-shaped view of the same records.

    Documents sitting in one folder are usually about one thing, so the skill
    works a folder at a time rather than a file at a time. Context files come
    first in each group because they frame everything beside them.
    """
    groups: dict[str, dict] = {}
    for r in records:
        g = groups.setdefault(r["folder"], {
            "folder": r["folder"] or "(root)",
            "segments": r["segments"],
            "context_files": [],
            "files": [],
            "pending": 0,
        })
        # `files` is every file in the folder; `context_files` marks which of
        # them are context files. Keeping context files OUT of `files` made a
        # folder holding only a README report `files: []` with `pending: 1`, so
        # anyone iterating folders[].files processed nothing and never noticed.
        g["files"].append(r["rel"])
        if r["context_file"]:
            g["context_files"].append(r["rel"])
        if r["status"] in ("new", "changed"):
            g["pending"] += 1
    return [groups[k] for k in sorted(groups)]


def cmd_mark(args: argparse.Namespace) -> int:
    """Record what each file produced so the next scan skips it.

    stdin: {"marks": [{"path": "...", "node_ids": ["a","b"],
                       "outcome": "ingested"|"skipped", "note": "..."}]}
    """
    raw = sys.stdin.read() if args.mark == "-" else Path(args.mark).read_text()
    try:
        marks = json.loads(raw).get("marks", [])
    except json.JSONDecodeError as exc:
        raise SystemExit(f"--mark expects JSON with a 'marks' array: {exc}")
    lpath = ledger_path(args.ledger)
    data = load_ledger(lpath)
    now = time.strftime("%Y-%m-%dT%H:%M:%SZ", time.gmtime())
    written, missing = [], []
    for m in marks:
        p = Path(m["path"]).expanduser()
        if not p.is_file():
            missing.append(str(p))
            continue
        data["entries"][sha256(p)] = {
            "path": str(p),
            "node_ids": m.get("node_ids", []),
            "outcome": m.get("outcome", "ingested"),
            "note": m.get("note", ""),
            "ingested_at": now,
        }
        written.append(str(p))
    save_ledger(lpath, data)
    out = {
        "ledger": str(lpath),
        "marked": len(written),
        "missing": missing,
        "total_entries": len(data["entries"]),
    }
    # Report what REMAINS, not just what was written: dump folders are live, and
    # a caller who only sees "marked: 9" will report done while files it never
    # saw sit pending. But only for the folder the caller names — silently
    # falling back to the default inbox reports another tree's backlog, which
    # reads as "you have 28 files left" and sends the caller off to ingest an
    # unrelated folder.
    if args.dir is None:
        out["still_pending"] = None
        out["note"] = "pass the inbox DIR to --mark to get the remaining-pending count"
    else:
        root = inbox_dir(args.dir)
        pending = []
        if root.exists():
            records = walk(root, args.max_mb)
            classify(records, data["entries"])
            pending = [r["rel"] for r in records if r["status"] in ("new", "changed")]
        out["scanned"] = str(root)
        out["still_pending"] = len(pending)
        out["pending_files"] = pending[:50]
    print(json.dumps(out, indent=2))
    return 1 if missing else 0


def main(argv: list[str] | None = None) -> int:
    ap = argparse.ArgumentParser(description=__doc__,
                                 formatter_class=argparse.RawDescriptionHelpFormatter)
    ap.add_argument("dir", nargs="?", help=f"inbox folder (default $MINDGAP_INBOX or {DEFAULT_INBOX})")
    ap.add_argument("--ledger", help="ledger path (default ~/.mindgap/inbox-ledger.json)")
    ap.add_argument("--all", action="store_true", help="include already-done files")
    ap.add_argument("--max-mb", type=float, default=MAX_MB, help=f"skip files larger than this (default {MAX_MB})")
    ap.add_argument("--mark", metavar="FILE|-", help="write ledger entries from JSON instead of scanning")
    args = ap.parse_args(argv)
    return cmd_mark(args) if args.mark else cmd_scan(args)


if __name__ == "__main__":
    sys.exit(main())
