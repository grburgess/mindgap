---
name: paper-to-mindmap
description: Use when a research paper (arXiv abstract/PDF, or a local paper PDF) is read during a session to learn about a technical topic — ML, computer vision, remote sensing, property analytics, MLOps, knowledge graphs, etc. — to distill the paper into the mindgap knowledge graph and link it, with evidence, to related existing nodes/projects. Also invocable directly to capture a specific paper by URL or arXiv id. Skips papers that are off-domain or were not read for learning.
---

# paper-to-mindmap

Capture a research paper just read into the mindgap knowledge graph: one `paper`
node, linked with evidence to related existing nodes. Distilled from the
paper-links / paper-discovery loops. The full ingest protocol travels with this bundle as `AGENTS.md` (binding); the essentials are inlined below.

## When this fires

A PostToolUse hook nudges you after a paper read (arXiv / paper host / `.pdf`).
You may also be invoked directly with a URL or arXiv id. Either way, run the
relevance gate first — do not ingest reflexively.

## Procedure

1. **Relevance gate.** Identify the paper (arXiv id / title / URL). Does it teach
   something relevant to the mindgap's domain or an existing project (ML, CV,
   remote sensing, property/insurance analytics, MLOps, knowledge graphs, …)? If
   clearly NOT, stop and report "off-domain, nothing added." Do not pollute the
   graph.

2. **Read context first.** Find existing related nodes before minting:
   - `mindgap context "<topic>"` and `mindgap find "<single salient term>"`
     (single terms are reliable; multi-word `context` strings often return empty).
   - **Dedup:** if a node already carries this arXiv id, enrich/upsert that node —
     never create a duplicate.

3. **Distill the node:**
   - `type`: `paper`; `id`: stable kebab-case slug (e.g. `softcon-eo-pretraining`).
   - **Authors (required):** lead the `body` with an `**Authors:** <full list>.` line —
     every author, full name as given on the source, comma-separated (e.g.
     `**Authors:** Kaiming He, Georgia Gkioxari, Piotr Dollár, Ross Girshick.`) — then a
     blank line, then the prose. The schema has no `authors` column; this body line IS
     the author record.
   - `body` ≥40 words (after the authors line): (a) what the work is/does, (b) why it
     relates to this graph's domain. Use exact-id `[[wiki-links]]` to anchors.
     **Do not repeat author names in the prose** — the `**Authors:**` line is the sole
     author record. Venue/year (e.g. `CVPR 2021`) may lead the prose; the arXiv id goes
     in `urls`, not the prose.
   - `urls`: `[{"label":"arXiv","url":"https://arxiv.org/abs/<id>","kind":"arxiv"}]`
     (use `"kind":"web"` for non-arXiv sources).
   - `confidence`: ~0.7. `created_by`: `skill:paper-to-mindmap`.

4. **Link with evidence.** Add ≥1 edge OR exact-id `[[wiki-link]]` to a
   PRE-EXISTING node (`relates_to` / `cites` / `implements`), each backed by a
   concrete reason (which concept/repo/paper it connects to, and why):
   - **Exact ids only** — `[[repo-maestro]]`, not `[[maestro]]`. Verify with
     `mindgap find` before linking.
   - **No fabricated links.** If there is no honest direct connection, link to the
     closest genuine shared concept and state why. Never invent a relationship.

5. **Ingest:**
   - If the **mindgap MCP** is connected this session, use `mindgap_ingest`
     (validated: rejects dangling endpoints whole-payload, requires `created_by`,
     returns the persisted rows). Prefer it.
   - Else use the **CLI** (on PATH; always targets the central `~/.mindgap/mindgap.db`):
     ```
     mindgap ingest - <<'EOF'
     {"nodes": [ ... ], "edges": [ ... ]}
     EOF
     ```
   - Every node and edge carries `"created_by": "skill:paper-to-mindmap"`.

6. **Report** one line: node id + the links added (and the anchor each connects
   to), or "skipped (off-domain)".

## Notes

- No per-paper `mindgap export` — the central DB is source of truth; snapshots
  are handled by loops / manual export.
- If neither the MCP nor the `mindgap` CLI can reach the DB, report the blocker;
  do not fail silently.
