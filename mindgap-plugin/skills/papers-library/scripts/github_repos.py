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


def auto_links(repos, papers, authored_ids):
    edges = []
    for r in repos:
        name = r["name"].lower()
        if len(name) < 4:
            continue
        for p in papers:
            if p["id"] not in authored_ids:
                continue
            toks = set(re.findall(r"[a-z][a-z0-9_]+", (p.get("title") or "").lower()))
            if name in toks:
                edges.append({"src": "repo-" + slugify(r["name"]), "dst": p["id"],
                              "rel": "implements", "weight": 1.0, "created_by": CREATED_BY})
    return edges


def build(repos, papers, authored_ids):
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
    edges += auto_links(uniq, papers, authored_ids)
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
    data = json.load(open(args.papers))
    papers = [n for n in data["nodes"] if n.get("type") == "paper"]
    authored_ids = {e["src"] for e in data.get("edges", [])
                    if e.get("dst") == "grburgess" and e.get("rel") == "relates_to"}
    repos = json.load(open(args.repos_json)) if args.repos_json else fetch_repos()
    payload = build(repos, papers, authored_ids)
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
