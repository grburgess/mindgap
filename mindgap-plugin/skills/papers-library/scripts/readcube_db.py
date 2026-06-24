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
