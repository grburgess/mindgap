# AGENTS.md — knowledge protocol for loop sessions

You are a loop session adding knowledge to the mindgap graph. CLI: `mindgap` (on PATH) or `python3 -m mindgap` from this repo. DB: default `~/.mindgap/mindgap.db` (env `MINDGAP_DB`/`MINDGAP_HOME` override).

Two interfaces, same db: the **CLI** (above) and the **MCP server** (`python3 -m mindgap.mcp`, registered in `.mcp.json` — tools `mindgap_ingest`/`mindgap_find`/`mindgap_context`/`mindgap_link`/etc.). Prefer the MCP tools when available: `mindgap_ingest` enforces the rules below (rejects dangling-endpoint payloads whole, requires `created_by`, returns the persisted rows) so you can't silently desync. The rules in this file apply identically whichever interface you use.

## MUST rules

1. Run `mindgap context "<topic>"` BEFORE researching a topic — read what exists, avoid duplicates, build on existing nodes.
2. Write via `mindgap ingest -` with `created_by` = your loop name (e.g. `loop:confluence-scan`) on every node and edge.
3. Every node sourced from Confluence/GitHub/arXiv MUST carry a `urls` entry (`{"label","url","kind"}`; kind: `confluence|github|arxiv|web`).
4. Use `[[wiki-links]]` in bodies to densify the graph — each `[[node-id]]` auto-creates a `mentions` edge (stub node if target missing). Wiki-links MUST use the exact node id (check with `mindgap find`), not the title or a guessed slug — `[[maestro]]` is a dangling stub if the node is `repo-maestro`.
5. Prefer upserting existing ids over creating near-duplicate new nodes — run `mindgap find` first (see below).
6. Run `mindgap export` at session end (snapshot to `~/.mindgap/snapshots/`).

## Vocabularies

- Node `type`: `concept | definition | software | repo | page | paper | person | team | stub`
- Edge `rel`: `relates_to | defines | implements | depends_on | cites | part_of | mentions`

## Near-duplicate check

Before creating a node, search by likely slug fragments and title words:

```
mindgap find "vector db" --json
mindgap find "vector-database" --type concept
```

If a close match exists, ingest with that existing `id` — upsert merges: your scalar fields replace, `tags`/`urls` union. Do NOT mint a new id for the same thing.

## Confidence & linking

- New unverified finding: `confidence` 0.5–0.8. If you re-verify an existing node from an independent source, re-ingest it with raised `confidence` (e.g. 1.0).
- Never create islands: every new node should have at least one edge or wiki-link to an existing node. Find anchors via `mindgap context`/`mindgap find` and add explicit `edges` entries.
- Promote stubs: if `mindgap show <id>` reveals `type=stub`, fill it in (title, type, body, urls) via ingest.

## Worked example

Topic: "embedding pipelines".

```
mindgap context "embedding" --depth 1
```

Output (digest of existing knowledge — anchor on these ids):

```
## Embedding Service (embedding-service) [software]
tags: ml, infra
Internal service producing text embeddings. Uses [[sentence-transformers]].
- [repo](https://github.com/acme/embedding-service)

- implements -> sentence-transformers (Sentence Transformers)
- part_of -> ml-platform (ML Platform)
```

Research finds a new arXiv paper and a Confluence design page. Compose payload and ingest:

```
mindgap ingest - <<'EOF'
{
  "nodes": [
    {
      "id": "matryoshka-embeddings",
      "title": "Matryoshka Representation Learning",
      "type": "paper",
      "body": "Nested embeddings allowing truncation to smaller dims with minimal loss. Candidate for [[embedding-service]] to cut index size.",
      "tags": ["ml", "embeddings"],
      "urls": [{"label": "arXiv", "url": "https://arxiv.org/abs/2205.13147", "kind": "arxiv"}],
      "confidence": 0.8,
      "created_by": "loop:arxiv-scan"
    },
    {
      "id": "embedding-pipeline-v2",
      "title": "Embedding Pipeline v2",
      "type": "page",
      "body": "Design for batch re-embedding. Depends on [[embedding-service]] and [[ml-platform]].",
      "tags": ["infra", "design"],
      "urls": [{"label": "Design doc", "url": "https://acme.atlassian.net/wiki/spaces/ML/pages/12345", "kind": "confluence"}],
      "confidence": 0.7,
      "created_by": "loop:confluence-scan"
    }
  ],
  "edges": [
    {"src": "embedding-pipeline-v2", "dst": "matryoshka-embeddings", "rel": "cites"},
    {"src": "embedding-pipeline-v2", "dst": "embedding-service", "rel": "depends_on"}
  ]
}
EOF
```

End of session:

```
mindgap export
```
