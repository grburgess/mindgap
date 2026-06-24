# ReadCube → mindgap Import + Repo Linking — Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Import the curated core of the user's 3,024-paper ReadCube library (~2,073 papers + 149 topic lists) into the `mindgap` graph and link it to the user's `grburgess` GitHub repos.

**Architecture:** Two stdlib scripts beside the repo's existing `papers-library` skill. `readcube_db.py` reads the ReadCube SQLite store (read-only/immutable) and emits a mindgap ingest payload of paper nodes + topic concept nodes + a `grburgess` person hub + structural edges. `github_repos.py` emits repo nodes + hub-anchor edges + auto exact paper↔repo links. Payloads are ingested via `mindgap ingest`. A final subagent-driven pass adds aggressive-semantic repo↔topic/paper edges, densest across 5 domains. Everything is idempotent (deterministic ids → upsert) and reversible (`created_by="skill:papers-library"`).

**Tech Stack:** Python 3.10 stdlib only (sqlite3, json, re, argparse, subprocess). mindgap CLI/`mindgap.db`. `gh` CLI for repos. `unittest`.

## Global Constraints

- **Strictly `mindgap`** (MCP/CLI/`mindgap.db`) + the ReadCube file + `gh`. **ZERO cape access** (no `cape_mindmap` tools, no `~/projects/mindmap`).
- Source DB opened **read-only + immutable**: `sqlite3.connect("file:<path>?mode=ro&immutable=1", uri=True)`. Never write the ReadCube file.
- Stdlib only — no pip deps (matches mindgap + `parse_refs.py`).
- `created_by = "skill:papers-library"` on every node and edge. Tag every imported node `papers-library`.
- `slugify(s) = re.sub(r"[^a-z0-9]+","-", s.lower()).strip("-")` — identical to `mindgap.db.slugify`.
- Node `type` ∈ `{concept,definition,software,repo,page,paper,person,team,stub}`; edge `rel` ∈ `{relates_to,defines,implements,depends_on,cites,part_of,mentions}`.
- Free text placed in any node `body`/`title` is passed through `safe(t)=t.replace("[[","[").replace("]]","]")` so mindgap's wiki-link sync never auto-stubs from imported prose.
- Paper id priority: `arxiv-<slug(id sans vN)>` ▶ `doi-<slug(doi)>` ▶ `cite-<slug(citekey)>` ▶ `rc-<raw uuid[:8]>`. (Same arXiv id → same node → intentional dedup.)
- Skip rows with `deleted == true`.
- Scripts live in `mindgap-plugin/skills/papers-library/scripts/`; tests `import <module>` bare and run via `python3 <path>/test_*.py` (mirrors `test_parse_refs.py`).
- ReadCube store path (this machine): `~/Library/Application Support/Papers/b5d46421-b31e-4887-a12a-da48d25591a9.db`. mindgap DB: `~/.mindgap/mindgap.db` (8 `seed` nodes pre-exist; leave them).

---

### Task 1: `readcube_db.py` — pure record + node builders

**Files:**
- Create: `mindgap-plugin/skills/papers-library/scripts/readcube_db.py`
- Test: `mindgap-plugin/skills/papers-library/scripts/test_readcube_db.py`

**Interfaces:**
- Produces: `slugify(s)->str`; `safe(s)->str`; `paper_id(item:dict)->str`; `_authors(item)->list[str]`; `assign_topic_ids(lists:list[dict])->dict[list_id,str]`; `paper_node(item)->dict`; `topic_node(lst, tid)->dict`. (`item`/`lst` = decoded ReadCube `json` dicts.)

- [ ] **Step 1: Write the failing test**

```python
# test_readcube_db.py
import unittest
import readcube_db as R

ITEM_ARXIV = {"id": "AAAA1111-...", "deleted": False,
    "article": {"title": "popsynth: A generic population synthesis", "year": 2021,
                "journal": "JOSS", "authors": ["J Michael Burgess", "Other A"]},
    "ext_ids": {"doi": "10.21105/joss.03257", "arxiv": "2107.12404v2"},
    "user_data": {"citekey": "Burgess:2021po", "tags": ["populations"],
                  "notes": "see [[somenode]] great tool"}}
ITEM_DOI = {"id": "BBBB2222", "article": {"title": "A DOI-only paper", "authors": ["X Y"]},
            "ext_ids": {"doi": "10.1086/588136"}, "user_data": {"citekey": "X:2008"}}
ITEM_BARE = {"id": "CCCC3333-zzzz", "article": {"title": "No ids here", "authors": ["Z"]},
             "ext_ids": {}, "user_data": {}}

class TestIds(unittest.TestCase):
    def test_slugify(self):
        self.assertEqual(R.slugify("Hello, World!"), "hello-world")
    def test_safe_neutralizes_wikilinks(self):
        self.assertEqual(R.safe("a [[x]] b"), "a [x] b")
    def test_paper_id_priority(self):
        self.assertEqual(R.paper_id(ITEM_ARXIV), "arxiv-2107-12404")  # vN stripped
        self.assertEqual(R.paper_id(ITEM_DOI), "doi-10-1086-588136")
        self.assertEqual(R.paper_id(ITEM_BARE), "rc-cccc3333")
    def test_authors(self):
        self.assertEqual(R._authors(ITEM_DOI), ["X Y"])

class TestTopicIds(unittest.TestCase):
    def test_disambiguates_duplicate_names_by_parent(self):
        lists = [
            {"id": "L1", "name": "Cosmic Rays", "parent_id": "ROOTA"},
            {"id": "L2", "name": "Cosmic Rays", "parent_id": "ROOTB"},
            {"id": "ROOTA", "name": "astrophysics", "parent_id": None},
            {"id": "ROOTB", "name": "X-Ray Group", "parent_id": None},
        ]
        tid = R.assign_topic_ids(lists)
        self.assertEqual(len(set(tid.values())), 4)          # no collisions
        self.assertIn("topic-cosmic-rays", tid.values())     # first keeps base
        self.assertTrue(any(v.startswith("topic-cosmic-rays-") for v in tid.values()))

class TestNodes(unittest.TestCase):
    def test_paper_node(self):
        n = R.paper_node(ITEM_ARXIV)
        self.assertEqual(n["id"], "arxiv-2107-12404")
        self.assertEqual(n["type"], "paper")
        self.assertIn("papers-library", n["tags"])
        self.assertIn("populations", n["tags"])
        self.assertTrue(n["body"].startswith("**Authors:** J Michael Burgess"))
        self.assertNotIn("[[", n["body"])                    # wiki-links neutralized
        kinds = {u["kind"] for u in n["urls"]}
        self.assertEqual(kinds, {"arxiv", "web"})
        self.assertEqual(n["confidence"], 0.9)
        self.assertEqual(n["created_by"], "skill:papers-library")
    def test_topic_node(self):
        n = R.topic_node({"id": "L1", "name": "Gamma-ray Burst", "item_ids": [1, 2, 3]}, "topic-gamma-ray-burst")
        self.assertEqual((n["id"], n["type"]), ("topic-gamma-ray-burst", "concept"))
        self.assertIn("topic", n["tags"])

if __name__ == "__main__":
    unittest.main()
```

- [ ] **Step 2: Run test to verify it fails**

Run: `python3 mindgap-plugin/skills/papers-library/scripts/test_readcube_db.py`
Expected: FAIL — `ModuleNotFoundError: No module named 'readcube_db'`.

- [ ] **Step 3: Write minimal implementation**

```python
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
```

- [ ] **Step 4: Run test to verify it passes**

Run: `python3 mindgap-plugin/skills/papers-library/scripts/test_readcube_db.py`
Expected: PASS (6 tests OK).

- [ ] **Step 5: Commit**

```bash
git add mindgap-plugin/skills/papers-library/scripts/readcube_db.py \
        mindgap-plugin/skills/papers-library/scripts/test_readcube_db.py
git commit -m "feat(papers-library): readcube_db builders (ids, nodes, topic-id disambiguation)"
```

---

### Task 2: `readcube_db.py` — payload assembly + CLI

**Files:**
- Modify: `mindgap-plugin/skills/papers-library/scripts/readcube_db.py` (append)
- Test: `mindgap-plugin/skills/papers-library/scripts/test_readcube_db.py` (append)

**Interfaces:**
- Consumes: all of Task 1.
- Produces: `build_payload(items, lists, limit=0)->dict` with keys `nodes`, `edges`, `created_by`, plus a `_report` dict (`{papers, topics, dropped_topics, authored, membership_edges}`); `open_ro(path)->sqlite3.Connection`; `resolve_db(path)->str`; `load(conn)->(items,lists)`; `main(argv=None)`.
- Curated core = (papers in ≥1 non-deleted list) ∪ (papers with a `Burgess` author). Topic kept iff it has ≥1 core paper OR a parent-in-set OR a child-in-set (drops island junk lists like `auto_import`). Every edge endpoint is guaranteed present in `nodes`.

- [ ] **Step 1: Write the failing test (append)**

```python
class TestPayload(unittest.TestCase):
    def _data(self):
        items = [ITEM_ARXIV, ITEM_DOI, ITEM_BARE,
                 {"id": "DUP", "article": {"title": "dup", "authors": ["A"]},
                  "ext_ids": {"arxiv": "2107.12404"}, "user_data": {}}]  # same arxiv as ITEM_ARXIV
        lists = [
            {"id": "T_GRB", "name": "Gamma-ray Burst", "parent_id": "T_ASTRO",
             "item_ids": [ITEM_ARXIV["id"], ITEM_DOI["id"]]},
            {"id": "T_ASTRO", "name": "astrophysics", "parent_id": None, "item_ids": []},
            {"id": "T_JUNK", "name": "auto_import", "parent_id": None, "item_ids": []},  # island → dropped
        ]
        return items, lists

    def test_core_and_dedup(self):
        items, lists = self._data()
        p = R.build_payload(items, lists)
        ids = {n["id"] for n in p["nodes"] if n["type"] == "paper"}
        # ITEM_ARXIV+DUP share arxiv id → 1 node; ITEM_DOI listed; ITEM_BARE only authored? no → excluded
        self.assertEqual(ids, {"arxiv-2107-12404", "doi-10-1086-588136"})
        self.assertNotIn("rc-cccc3333", ids)          # unlisted, non-authored → excluded

    def test_authored_included_even_if_unlisted(self):
        items, lists = self._data()
        p = R.build_payload(items, lists)
        # ITEM_ARXIV authored (Burgess) & listed; edge to hub present
        self.assertTrue(any(e["dst"] == "grburgess" and e["rel"] == "relates_to" for e in p["edges"]))
        self.assertTrue(any(n["id"] == "grburgess" and n["type"] == "person" for n in p["nodes"]))

    def test_topic_hierarchy_and_drop(self):
        items, lists = self._data()
        p = R.build_payload(items, lists)
        topic_ids = {n["id"] for n in p["nodes"] if n["type"] == "concept"}
        self.assertIn("topic-gamma-ray-burst", topic_ids)
        self.assertIn("topic-astrophysics", topic_ids)        # kept: has child
        self.assertNotIn("topic-auto-import", topic_ids)      # dropped: island
        self.assertTrue(any(e["rel"] == "part_of" and e["dst"] == "topic-astrophysics" for e in p["edges"]))

    def test_no_dangling_endpoints(self):
        items, lists = self._data()
        p = R.build_payload(items, lists)
        node_ids = {n["id"] for n in p["nodes"]}
        for e in p["edges"]:
            self.assertIn(e["src"], node_ids)
            self.assertIn(e["dst"], node_ids)

    def test_roundtrip_through_sqlite(self):
        import sqlite3, tempfile, os
        items, lists = self._data()
        fd, path = tempfile.mkstemp(suffix=".db"); os.close(fd)
        c = sqlite3.connect(path)
        c.execute("CREATE TABLE items(id TEXT, json TEXT)")
        c.execute("CREATE TABLE lists(id TEXT, json TEXT)")
        c.executemany("INSERT INTO items VALUES(?,?)", [(i["id"], json_dumps(i)) for i in items])
        c.executemany("INSERT INTO lists VALUES(?,?)", [(l["id"], json_dumps(l)) for l in lists])
        c.commit(); c.close()
        conn = R.open_ro(path)
        gi, gl = R.load(conn)
        self.assertEqual(len(gi), len(items))
        os.remove(path)

def json_dumps(d):
    import json
    return json.dumps(d)
```

- [ ] **Step 2: Run to verify it fails**

Run: `python3 mindgap-plugin/skills/papers-library/scripts/test_readcube_db.py`
Expected: FAIL — `AttributeError: module 'readcube_db' has no attribute 'build_payload'`.

- [ ] **Step 3: Implement (append to readcube_db.py)**

```python
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

    has_child = {l.get("parent_id") for l in lists if l.get("parent_id") in by_lid}
    core_count = {}
    for l in lists:
        core_count[l["id"]] = sum(1 for x in (l.get("item_ids") or []) if x in core)
    kept_lid = {l["id"] for l in lists
                if core_count[l["id"]] > 0 or l.get("parent_id") in by_lid or l["id"] in has_child}

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
```

- [ ] **Step 4: Run to verify it passes**

Run: `python3 mindgap-plugin/skills/papers-library/scripts/test_readcube_db.py`
Expected: PASS (all tests OK).

- [ ] **Step 5: Commit**

```bash
git add mindgap-plugin/skills/papers-library/scripts/readcube_db.py \
        mindgap-plugin/skills/papers-library/scripts/test_readcube_db.py
git commit -m "feat(papers-library): readcube_db payload assembly + CLI"
```

---

### Task 3: `github_repos.py` — repo nodes + hub anchor + auto links

**Files:**
- Create: `mindgap-plugin/skills/papers-library/scripts/github_repos.py`
- Test: `mindgap-plugin/skills/papers-library/scripts/test_github_repos.py`

**Interfaces:**
- Consumes: a papers payload JSON (Task 2 output) for its `nodes` (paper id+title).
- Produces: `repo_node(r)->dict`; `auto_links(repos, papers)->list[edge]`; `build(repos, papers)->dict(nodes,edges,created_by)`; `fetch_repos()->list[dict]` (subprocess `gh`); `main(argv=None)`.
- `r` = `{"name","owner","description"}`. Org flagships `threeML/threeML`, `threeML/astromodels` always included. Repo id `repo-<slug(name)>`. Auto-link: repo name (≥4 chars) appears as a whole token in a paper title → `repo implements paper`.

- [ ] **Step 1: Write the failing test**

```python
# test_github_repos.py
import unittest
import github_repos as G

REPOS = [
    {"name": "popsynth", "owner": "grburgess", "description": "population synthesis"},
    {"name": "cv", "owner": "grburgess", "description": "my cv"},  # too short → no auto-link
    {"name": "dotfiles", "owner": "grburgess", "description": "configs"},
]
PAPERS = [
    {"id": "arxiv-2107-12404", "title": "popsynth: A generic population synthesis", "type": "paper"},
    {"id": "doi-x", "title": "Unrelated study of cv stars", "type": "paper"},
]

class TestRepos(unittest.TestCase):
    def test_repo_node(self):
        n = G.repo_node(REPOS[0])
        self.assertEqual((n["id"], n["type"]), ("repo-popsynth", "repo"))
        self.assertEqual(n["urls"][0]["url"], "https://github.com/grburgess/popsynth")
        self.assertIn("papers-library", n["tags"])
    def test_auto_links_exact_token_only(self):
        edges = G.auto_links(REPOS, PAPERS)
        self.assertIn(("repo-popsynth", "arxiv-2107-12404", "implements"),
                      {(e["src"], e["dst"], e["rel"]) for e in edges})
        # 'cv' is < 4 chars → must NOT link despite appearing in a title
        self.assertFalse(any(e["src"] == "repo-cv" for e in edges))
    def test_build_anchors_every_repo_to_hub(self):
        p = G.build(REPOS, PAPERS)
        hub_edges = {e["src"] for e in p["edges"] if e["dst"] == "grburgess" and e["rel"] == "relates_to"}
        self.assertEqual(hub_edges, {"repo-popsynth", "repo-cv", "repo-dotfiles"})
        self.assertEqual(p["created_by"], "skill:papers-library")

if __name__ == "__main__":
    unittest.main()
```

- [ ] **Step 2: Run to verify it fails**

Run: `python3 mindgap-plugin/skills/papers-library/scripts/test_github_repos.py`
Expected: FAIL — `ModuleNotFoundError: No module named 'github_repos'`.

- [ ] **Step 3: Implement**

```python
#!/usr/bin/env python3
"""Emit a mindgap payload of grburgess repo nodes + hub anchor + auto paper links.

Repos via `gh repo list grburgess --source` plus the threeML org flagships (3ML,
astromodels). Auto-links a repo to a paper when the repo name (>=4 chars) is a whole
token in the paper title. Stdlib only.

Usage:
  github_repos.py --papers PAYLOAD.json [--repos-json REPOS.json] [--out FILE] [--dry-run]
  --repos-json injects repo data (skips the gh call; used by tests).
"""
import argparse, json, re, subprocess, sys

CREATED_BY = "skill:papers-library"
HUB_ID = "grburgess"
ORG_FLAGSHIPS = [
    {"name": "threeML", "owner": "threeML", "description": "The Multi-Mission Maximum Likelihood framework (3ML)"},
    {"name": "astromodels", "owner": "threeML", "description": "Spatial and spectral models for astrophysics"},
]


def slugify(text):
    return re.sub(r"[^a-z0-9]+", "-", (text or "").lower()).strip("-")


def safe(text):
    return (text or "").replace("[[", "[").replace("]]", "]")


def repo_node(r):
    full = f"{r.get('owner', 'grburgess')}/{r['name']}"
    return {"id": "repo-" + slugify(r["name"]), "title": r["name"], "type": "repo",
            "body": safe(r.get("description") or ""),
            "urls": [{"label": full, "url": f"https://github.com/{full}", "kind": "github"}],
            "tags": ["papers-library", "github"], "confidence": 0.95, "created_by": CREATED_BY}


def auto_links(repos, papers):
    edges = []
    for r in repos:
        name = r["name"].lower()
        if len(name) < 4:
            continue
        for p in papers:
            toks = set(re.findall(r"[a-z][a-z0-9_]+", (p.get("title") or "").lower()))
            if name in toks:
                edges.append({"src": "repo-" + slugify(r["name"]), "dst": p["id"],
                              "rel": "implements", "weight": 1.0, "created_by": CREATED_BY})
    return edges


def build(repos, papers):
    seen, uniq = set(), []
    for r in repos + ORG_FLAGSHIPS:                 # dedupe by repo id, org flagships win ties last
        rid = "repo-" + slugify(r["name"])
        if rid not in seen:
            seen.add(rid); uniq.append(r)
    nodes = [{"id": HUB_ID, "title": "J. Michael Burgess", "type": "person",
              "body": "Author/maintainer hub.", "tags": ["papers-library"],
              "confidence": 1.0, "created_by": CREATED_BY}]
    nodes += [repo_node(r) for r in uniq]
    edges = [{"src": "repo-" + slugify(r["name"]), "dst": HUB_ID, "rel": "relates_to",
              "created_by": CREATED_BY} for r in uniq]
    edges += auto_links(uniq, papers)
    return {"nodes": nodes, "edges": edges, "created_by": CREATED_BY}


def fetch_repos():
    out = subprocess.check_output(
        ["gh", "repo", "list", "grburgess", "--source", "--limit", "300",
         "--json", "name,description"], text=True)
    data = json.loads(out)
    return [{"name": r["name"], "owner": "grburgess", "description": r.get("description") or ""} for r in data]


def main(argv=None):
    ap = argparse.ArgumentParser(description=__doc__)
    ap.add_argument("--papers", required=True)
    ap.add_argument("--repos-json")
    ap.add_argument("--out")
    ap.add_argument("--dry-run", action="store_true")
    args = ap.parse_args(argv)
    papers = [n for n in json.load(open(args.papers))["nodes"] if n.get("type") == "paper"]
    repos = json.load(open(args.repos_json)) if args.repos_json else fetch_repos()
    payload = build(repos, papers)
    if args.dry_run:
        nl = sum(1 for e in payload["edges"] if e["rel"] == "implements")
        print(f"repos={len(repos)} nodes={len(payload['nodes'])} edges={len(payload['edges'])} auto_links={nl}",
              file=sys.stderr)
        return
    out = open(args.out, "w") if args.out else sys.stdout
    json.dump(payload, out, indent=1)
    if args.out:
        out.close()
        print(f"wrote {args.out}", file=sys.stderr)


if __name__ == "__main__":
    main()
```

- [ ] **Step 4: Run to verify it passes**

Run: `python3 mindgap-plugin/skills/papers-library/scripts/test_github_repos.py`
Expected: PASS (3 tests OK).

- [ ] **Step 5: Commit**

```bash
git add mindgap-plugin/skills/papers-library/scripts/github_repos.py \
        mindgap-plugin/skills/papers-library/scripts/test_github_repos.py
git commit -m "feat(papers-library): github_repos nodes + hub anchor + auto paper links"
```

---

### Task 4: Real dry-run + ingest of papers & topics

**Files:** none (execution against real data). Artifacts written to `/tmp`.

- [ ] **Step 1: Snapshot the graph (rollback point)**

Run: `mindgap export --out /tmp/mindgap-pre-import.json && mindgap stats`
Expected: stats show ~8 nodes (seed). Keep the snapshot.

- [ ] **Step 2: Dry-run the importer and eyeball the report**

Run:
```bash
python3 mindgap-plugin/skills/papers-library/scripts/readcube_db.py --dry-run
```
Expected (stderr, approximately): `{"papers": ~2073, "topics": ~14x, "dropped_topics": <small>, "authored": ~76, "membership_edges": ~2790}` then `nodes=~22xx edges=~29xx` and a few sample lines. **Sanity gate:** papers 1900–2100, topics 130–149, authored 70–80. If wildly off, stop and inspect before writing.

- [ ] **Step 3: Write the payload**

Run: `python3 mindgap-plugin/skills/papers-library/scripts/readcube_db.py --out /tmp/payload-papers.json`
Expected: stderr `wrote /tmp/payload-papers.json: {...report...}`.

- [ ] **Step 4: Ingest**

Run: `mindgap ingest /tmp/payload-papers.json`
Expected: `ingested ~22xx nodes, ~29xx edges`.

- [ ] **Step 5: Verify counts + no dangling stubs from this step**

Run: `mindgap stats`
Expected: `by_type` shows `paper ~2073`, `concept ~14x (+1 seed)`, `person ~1 (+1 seed)`; `by_rel.part_of ~2929`, `relates_to` up by ~76. Then:
Run: `mindgap lint`
Expected: no NEW `stub` nodes attributable to this import (seed stubs, if any, unchanged). If lint reports unexpected stubs, a body slipped a `[[...]]` — fix `safe()` coverage and re-run.

- [ ] **Step 6: Spot-check context**

Run: `mindgap context "Gamma-ray Burst" --depth 1`
Expected: the GRB topic node with many paper neighbors. Reads coherently.

(No commit — this task mutates `~/.mindgap`, not the repo.)

---

### Task 5: Real ingest of repos + hub anchor + auto links

**Files:** none (execution). Uses `/tmp/payload-papers.json` from Task 4.

- [ ] **Step 1: Dry-run repos**

Run:
```bash
python3 mindgap-plugin/skills/papers-library/scripts/github_repos.py \
  --papers /tmp/payload-papers.json --dry-run
```
Expected: `repos=~184 nodes=~187 edges=~190+ auto_links=>=3` (popsynth, nazgul, astromodels at least). Confirms `gh` auth works and threeML flagships included.

- [ ] **Step 2: Write + ingest**

Run:
```bash
python3 mindgap-plugin/skills/papers-library/scripts/github_repos.py \
  --papers /tmp/payload-papers.json --out /tmp/payload-repos.json
mindgap ingest /tmp/payload-repos.json
```
Expected: `ingested ~187 nodes, ~19x edges`.

- [ ] **Step 3: Verify**

Run: `mindgap stats`
Expected: `by_type.repo ~186`; `relates_to` up by ~186; `implements` ≥ 3.
Run: `mindgap context "popsynth"`
Expected: repo node linked to the popsynth paper and to the `grburgess` hub.

(No repo commit.)

---

### Task 6: Aggressive-semantic repo↔topic/paper linking (subagent-driven)

**Files:** Artifacts only (`/tmp/links/*.json`). Ingest into `~/.mindgap`.

**Interfaces:**
- Consumes: ingested graph; `/tmp/payload-papers.json` (paper id+title), `/tmp/payload-repos.json` (repo id+title+body), the topic node list (`mindgap find --type concept --json`).
- Produces: validated edge payloads `{src,dst,rel,weight,created_by,note}`, `rel ∈ {relates_to,implements,cites,depends_on}`, ingested.

- [ ] **Step 1: Select the research-software subset**

Build the candidate repo list (NOT all 184): repos whose description/topics match the 5 domains (statistics, machine learning, gamma-ray bursts, AGN, particle acceleration) or that are clearly scientific packages. Seed set (verify each still exists in `/tmp/payload-repos.json`):
`morgoth, cosmogrb, gbmgeometry, polarpy, astromodels, threeML, nazgul, popsynth, ronswanson, whimstan, pychangcooper, gbm_drm_gen, grb_shader, netspec, nnapec, responsum, icecube_tools, gbm-transient, threeml_shell, 3ml_utils`.
Write the chosen ids to `/tmp/links/research_repos.json`. `log` any repo dropped from consideration so coverage is explicit.

- [ ] **Step 2: Dispatch one subagent per research repo**

For each repo, dispatch a subagent (parallel; see superpowers:dispatching-parallel-agents) with this prompt skeleton:

```
You are linking ONE GitHub repo into a knowledge graph. STRICT: emit only JSON, no prose.

REPO: <id> "<name>" — <description>
DOMAINS TO EMPHASIZE: statistics, machine learning, gamma-ray bursts, AGN, particle acceleration.

TOPIC NODES (id — name), pick the few this repo genuinely belongs to:
<paste topic id/name list>

CANDIDATE PAPERS (id — title), pick ONLY papers this repo plausibly implements/is-cited-by
(authored papers first; do not guess):
<paste authored paper id/title list + any title-token matches>

Return JSON: {"edges":[{"src":"<repo id>","dst":"<topic or paper id>",
  "rel":"relates_to|implements|cites","weight":0.6-0.8,"note":"<=12 words why"}]}
Rules: src is always this repo id. dst MUST be an id from the lists above (exact). Prefer
linking to 1-4 TOPIC nodes (reaches the whole neighborhood) + 0-5 specific papers. No invented ids.
```

Collect each subagent's `edges`.

- [ ] **Step 3: Validate every edge before ingest**

Run this guard (drops any edge whose endpoints aren't real nodes or whose rel is illegal):
```bash
python3 - <<'PY'
import json, subprocess
edges = json.load(open("/tmp/links/all_edges.json"))   # concatenated subagent output
ids = {n["id"] for n in json.loads(subprocess.check_output(
    ["mindgap","export"], text=True))["nodes"]}
VOCAB = {"relates_to","implements","cites","depends_on"}
good = [dict(e, created_by="skill:papers-library") for e in edges
        if e["src"] in ids and e["dst"] in ids and e.get("rel") in VOCAB]
json.dump({"nodes": [], "edges": good, "created_by": "skill:papers-library"},
          open("/tmp/links/payload-links.json","w"), indent=1)
print(f"kept {len(good)}/{len(edges)} edges")
PY
mindgap ingest /tmp/links/payload-links.json
```
Expected: `kept N/M edges` (N>0) then `ingested 0 nodes, N edges`.

- [ ] **Step 4: Verify density in the 5 domains**

Run: `mindgap context "Particle Acceleration" --depth 1` and `mindgap context "morgoth"`
Expected: repos now reachable from the emphasis-domain topics; `morgoth`/`cosmogrb` link to GRB topics and key papers.

---

### Task 7: Final verification, snapshot, docs, PR

**Files:**
- Modify: `mindgap-plugin/skills/papers-library/SKILL.md` (add the DB-direct path)

- [ ] **Step 1: Full verification against the spec's expected counts**

Run: `mindgap stats`
Expected: `paper ≈ 2073`, `concept ≈ 14x`, `repo ≈ 186`, `person ≈ 1` (+ seed); `part_of ≈ 2929`, `relates_to ≥ 260`, `implements`/`cites` > 0.
Run: `mindgap lint`
Expected: no unexpected stubs / orphans introduced by the import (every paper has ≥1 edge; every repo anchors to the hub).

- [ ] **Step 2: Snapshot**

Run: `mindgap export`
Expected: snapshot written to `~/.mindgap/snapshots/`.

- [ ] **Step 3: Document the new DB path in the skill**

Add to `SKILL.md` §1 a bullet: the desktop SQLite store can be read directly via
`scripts/readcube_db.py` (preferred when the user can't export BibTeX and wants list
topics preserved); `github_repos.py` links the library to the user's repos.

- [ ] **Step 4: Run the full skill test suite once more**

Run:
```bash
for t in readcube_db github_repos; do
  python3 mindgap-plugin/skills/papers-library/scripts/test_$t.py || exit 1
done
python3 -m unittest discover tests
```
Expected: all PASS (skill tests + repo unit tests; the import did not touch `mindgap/`).

- [ ] **Step 5: Commit + open PR**

```bash
git add mindgap-plugin/skills/papers-library/scripts/ mindgap-plugin/skills/papers-library/SKILL.md docs/
git commit -m "feat(papers-library): ReadCube SQLite importer + repo linking"
gh pr create --fill --base main
```

---

## Self-Review

**Spec coverage:**
- Curated core (2,073) → Task 2 `build_payload` core selection; Task 4 ingest. ✓
- Topic taxonomy + hierarchy + membership → Task 2 (`assign_topic_ids`, hierarchy/membership edges). ✓
- No islands → hub node + authored→hub + repo→hub + orphan-topic drop (Task 2/3); verified Task 7 lint. ✓
- Idempotency → deterministic ids, `paper_id`/`assign_topic_ids`/`repo-<slug>`; upsert. ✓
- Reversible / `created_by` → `CREATED_BY` constant everywhere. ✓
- Repos: all 184 source + threeML flagships → Task 3 `fetch_repos` + `ORG_FLAGSHIPS`. ✓
- Aggressive-semantic linking, 5 domains → Task 6 subagents + validation. ✓
- Read-only/immutable source; no cape → `open_ro`; Global Constraints. ✓
- Implements the `papers-library` skill → scripts in skill dir, `created_by="skill:papers-library"`, SKILL.md update (Task 7). ✓

**Placeholder scan:** No TBD/TODO; every code step has full code; expected outputs given. ✓

**Type consistency:** `paper_id`, `slugify`, `safe`, `CREATED_BY`, `HUB_ID="grburgess"`, edge dict shape `{src,dst,rel,...}`, payload shape `{nodes,edges,created_by}` consistent across Tasks 1–6. `repo_node`/`paper_node`/`topic_node` return the same node dict shape mindgap `ingest` consumes. ✓

**Gap note:** `readcube_db.py` and `github_repos.py` each redefine `slugify`/`safe` (stdlib-standalone, matching `parse_refs.py`'s self-contained style — intentional, not a DRY violation across the skill boundary).
