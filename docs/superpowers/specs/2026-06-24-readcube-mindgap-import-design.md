# ReadCube → mindgap import + GitHub repo linking

Date: 2026-06-24
Status: design (awaiting user review)

## Goal

Import the user's ReadCube Papers library into the **`mindgap`** knowledge graph
(separate from cape — zero cape access) and link it to the user's `grburgess`
GitHub repos, producing a densely-connected, idempotent, reversible graph.

Success criteria:
- Curated-core papers, the topic taxonomy, and the repos are present as typed nodes.
- No islands: every paper reaches a topic; every repo reaches the `grburgess` hub.
- Re-running the importer is a no-op-or-upsert (no duplicates).
- The whole import is filterable/removable by `created_by`.
- `mindgap_stats` matches expected counts; `mindgap context` spot-checks read well.

## Source (read-only)

ReadCube Papers desktop store: `~/Library/Application Support/Papers/<uuid>.db`
(SQLite, 224 MB). Open with an **immutable, read-only** connection
(`file:...?mode=ro&immutable=1`) so a running Papers app cannot block reads and
the file is never written.

Relevant tables (JSON-per-row):
- `items` (3,024): `id`, `collection_id`, `json` with `article{title,year,authors[],journal}`,
  `ext_ids{doi,arxiv}`, `user_data{citekey,notes,tags,star,rating}`, `item_type`, `files`.
- `lists` (149): `json` with `name`, `parent_id`, `item_ids[]` → topic taxonomy + membership + hierarchy.
- (ignored: `smartlists`, `fts*`, `groups`, caches.)

## Scope — "Curated core"

Papers imported = (papers in ≥1 list) ∪ (papers authored by Burgess) = **2,073**.
- Papers in ≥1 list: 2,059. Authored: 76 (14 not in any list, included anyway).
- **Excluded:** ~965 unlisted/unread long-tail papers; full PDFs/text; collaborator
  author nodes; smartlists. (All addable later; out of scope now.)

## Target — mindgap vocabulary (from AGENTS.md)

- Node `type`: `concept | definition | software | repo | page | paper | person | team | stub`
- Edge `rel`: `relates_to | defines | implements | depends_on | cites | part_of | mentions`
- Every write carries `created_by`. Papers carry a `urls` entry where one exists.
- Bulk edges use **explicit `edges` entries with exact validated ids** (NOT body
  wiki-links) so nothing dangles. `mindgap_ingest` validates endpoints whole-payload.

## Node model (~2,409 nodes)

| type | count | id scheme | content |
|---|---|---|---|
| `paper` | 2,073 | `arxiv-<slug>` ▶ `doi-<slug>` ▶ `cite-<slug(citekey)>` ▶ `rc-<uuid8>` | title; body = authors + year + journal + user notes (276); `urls`: arXiv (`https://arxiv.org/abs/<id>`) and/or `https://doi.org/<doi>` (416 with neither → no url); `tags` = user tags + `readcube`; confidence 0.9 |
| `concept` | 149 | `topic-<slug(name)>`; on collision append `-<slug(parent)>` then `-<n>` | title = list name; body notes domain; confidence 0.9 |
| `repo` | ~186 | `repo-<name>` | body = gh description; `urls`: github; confidence 0.95 |
| `person` | 1 | `grburgess` | "J. Michael Burgess" — hub for the user's work |

**ID stability / idempotency:** ids are deterministic functions of source data, so
re-running upserts. `slug()` = lowercase, `[^a-z0-9]→-`, collapse repeats, strip ends.
Duplicate list names exist (e.g. "Cosmic Rays", "Reviews", "Gamma-ray Spectra" appear
under two parents) → disambiguate by parent slug, then numeric suffix.

**Repo set:** all **184** non-fork source repos under `grburgess`
(`gh repo list grburgess --source`), **plus** `threeML/threeML` (3ML) and
`threeML/astromodels` (the canonical org repos; the user's `grburgess/astromodels`
is a fork and is skipped in favor of the org one). Non-research repos (dotfiles,
bots, configs) are intentionally kept but only anchor to the `grburgess` hub.

## Edge model (~3,900 edges)

- `paper → topic` **part_of** — list membership (~2,790). The dense backbone.
- `topic → parent topic` **part_of** — hierarchy (139).
- `paper → grburgess` **relates_to** — 76 authored papers anchor to the hub.
- `repo → grburgess` **relates_to** — every repo (≈186) anchors → no repo islands.
- `repo → paper` **implements** / **cites** — linking pass (below).
- `repo → topic` **relates_to** / **implements** — linking pass (below).

## Linking pass — aggressive semantic, anchored to 5 domains

Emphasis domains (per user) map to real topic nodes:
Statistics (122), Machine Learning (41), Gamma-ray Burst (580), Active Galactic
Nuclei (40), Particle Acceleration (78).

1. **Auto, high-confidence (0.95):** exact repo-name / citekey matches →
   `repo implements paper` (astromodels, nazgul, popsynth, 3ML, …).
2. **Semantic curation** over the **research-software subset** (~25–40 repos, not all
   184). Mechanism: parallel subagents, one per repo (or small cluster). Each subagent
   receives: repo name + gh description + README head + language/topics; the full topic
   taxonomy (id+name); the list of authored papers (id+title); domain counts. It returns
   validated JSON `edges`:
   - `repo → topic` (`relates_to`/`implements`) — connects the repo to its domain
     topic node(s), so it is reachable from the whole paper neighborhood in 2 hops
     (avoids hundreds of noisy direct edges, e.g. to all 580 GRB papers).
   - `repo → paper` (`implements`/`cites`) — direct edges to the repo's flagship papers.
   - Each edge: `confidence` 0.6–0.8 + one-line rationale in the edge note.
   - **Densest** across the 5 emphasis domains.
   Parent process validates every id against the ingested graph before ingest;
   `created_by: "skill:papers-library"`.
3. Non-research repos: hub anchor only.

## Build order & verification

This implements the repo's existing **`papers-library` skill** (P1–P2 import,
extended; P3 discovery / P4 ideation are out of scope), reading the ReadCube SQLite
store directly rather than a BibTeX export (the export drops the list hierarchy that
is this design's backbone, and the user has no export). Two stdlib scripts sit beside
the skill's `parse_refs.py`:
- `mindgap-plugin/skills/papers-library/scripts/readcube_db.py` — papers + topics, `--dry-run`.
- `mindgap-plugin/skills/papers-library/scripts/github_repos.py` — repos + hub + auto links.

All writes carry `created_by: "skill:papers-library"`.

1. **Dry-run:** print node/edge counts, a sample of each node type, and an
   unmatched-id / collision report. Stop and eyeball.
2. **Ingest in dependency order** (each batch's edge endpoints already in DB or payload):
   1. hub `grburgess` + 149 topics + topic→parent `part_of`.
   2. papers (batches of ~300) + their `part_of`→topic + authored→hub `relates_to`.
   3. repos + repo→hub `relates_to` + auto exact `repo implements paper`.
   4. semantic linking edges (from subagents).
3. **Verify:** `mindgap_stats` ≈ {paper 2073, concept 149, repo 186, person 1};
   `by_rel.part_of ≈ 2929`, `relates_to ≥ 260`, `implements`/`cites` > 0; no leftover
   `type=stub`. Spot-check `mindgap context "Gamma-ray Burst"`, `"morgoth"`, `"Bayesian"`.
4. **Snapshot:** `mindgap export` → `~/.mindgap/snapshots/`.

## Confidence

papers 0.9 · topics 0.9 · repos 0.95 · auto repo↔paper 0.95 · semantic links 0.6–0.8.

## Risks / constraints

- **Strictly `mindgap`** MCP/CLI + the ReadCube file. **No cape access of any kind.**
- 184 repo nodes is broad (per user's choice); trivially reducible to research-only
  by filtering the repo set if it reads as noisy.
- Graph size (~2,400 nodes / ~3,900 edges): fine for SQLite; the force-graph web UI
  will be heavier but functional.
- ReadCube app may be running → immutable read-only connection mandated.
- Reversible: graph held only 8 `seed` nodes beforehand, so the entire import is
  exactly the `created_by = 'skill:papers-library'` content; delete by that provenance.

## Out of scope

Full mirror (3,024) · flat/no-taxonomy import · PDFs & full text · collaborator
author nodes · smartlists · unlisted long-tail papers · anything in cape /
`~/projects/mindmap`.

## Open questions

- 184 repos kept (assumed from "a"); trim to research-only instead? 
- Duplicate topic-name disambiguation by parent-slug acceptable?
- threeML org: only `threeML` + `astromodels`, or also `cthreeML` / `gammapy-plugin`?
- Direction of authored-paper↔person edge: `paper relates_to grburgess` (assumed) ok?
