---
name: papers-library
description: Use when the user wants to mine their Papers (papersapp.com / ReadCube) reference library into the mindgap knowledge graph — parse a BibTeX/RIS export, ingest each paper as a node (deduped, evidence-linked), discover related NEW papers not yet in the library, and generate research/implementation ideas from the resulting connections. Triggers on "mine/import my Papers library", "add my papersapp library to the graph", "import this .bib/.ris from Papers", or a Papers export file handed over with intent to build the graph.
---

# papers-library

Turn a Papers (papersapp.com / ReadCube) library into living graph structure: import →
link → discover → ideate. Self-contained: a stdlib BibTeX/RIS parser ships with this skill;
the only graph dependency is the bundled `paper-to-mindmap` ingest protocol.

## 1 · Get the library out of Papers
There is no public Papers API, so work from an **export** (BibTeX or RIS — both supported):
- **In Papers:** Settings → Export → BibTeX/RIS for the whole library, OR the gear next to
  *All Papers* → *Export as → BibTeX (.bib)*; a collection can be exported the same way.
- **Or the auto-generated `.bib`:** the Papers **desktop** app keeps a `.bib` per library inside
  the Papers Library folder (default `~/Documents/Papers Library/`). Point the skill at it.
- **Legacy Papers 3 (macOS):** export to `.bib`/`.ris` first (File → Export), or script it via
  AppleScript. The local SQLite DB (`Database.papersdb`) is a brittle last resort — prefer an export.

Ask the user for the path to the `.bib`/`.ris` file if they did not provide one. Exports carry
references only, not PDFs — that is fine; this skill works from metadata.

## 2 · Pipeline (P1–P4)

### P1 — Parse
`python3 <skill>/scripts/parse_refs.py <export.bib|.ris>` → a JSON array of normalized records
(`title, authors[], year, doi, arxiv, url, abstract, keywords[], type`). Auto-detects format.
Report the count (and any dropped-no-id count). For a large library, `--limit` to sample first.

### P2 — Ingest (dedup-first)
Snapshot the graph once at the start (`mindgap export --out artifacts/pre.json`). Then, per record:
- **Dedup BEFORE writing** — `mindgap find "<arxiv id|doi>"` then `mindgap find "<title>"`
  (single salient terms are most reliable). Skip any paper already present (match on arXiv id,
  DOI, or normalized title); never double-ingest.
- **Ingest new papers** via the bundled `paper-to-mindmap` protocol: one node `type: paper`,
  stable kebab-case `id` (prefer the arXiv id or a title slug), body leading with
  `**Authors:** …` then a 2–4 sentence distillation of the abstract (what it does + why it
  matters); `tags` from the record's keywords plus a `papers-library` tag; `urls` = the arXiv,
  DOI, and/or source URL from the record (kinds `arxiv`/`web`). `created_by: "skill:papers-library"`.
- **Link within the import + to the graph:** wiki-link / `edges` (rel `relates_to`, `cites`)
  between library papers that share a method or cite each other, and to ≥1 pre-existing node
  where a real relation holds. Only use URLs/relations grounded in the record or a resolved
  source — never a fabricated link.
- **Batch large libraries:** ingest in chunks (e.g. 25), deduping each chunk against the live
  graph, so later chunks link to earlier ones.

### P3 — Discover links to NEW papers
For the imported set, find directly-related papers **not** in the library — key references the
library papers cite, and same-method follow-ups — via the arXiv export API, Semantic Scholar, or
OpenAlex (search by title/DOI/arXiv id). Ingest the most relevant as `paper` nodes and link them.
For a thorough, criteria-graded sweep, the import has set up the graph for the bundled
**`paper-links`** / **`paper-discovery`** loop templates — run one of those for depth.

### P4 — Generate ideas
From the new connection clusters (library papers + their discovered links), propose concrete
research/implementation ideas, each grounded in ≥2 connected graph nodes. Apply a feasibility
check — drop ideas with no plausible data / compute / method-maturity path, and say why. Ingest
the survivors as `idea` nodes (tags `ideas`), linked with evidence to the papers they build on.
For the rigorous adversarial-refutation version, run the bundled **`implementation-ideation`**
loop template, which this import primes.

## 3 · Rules
- Dedup is mandatory and comes first — the graph is the source of truth, the library is an input.
- Ground truth only: every `urls` entry and every link traces to the export record or a resolved
  source. No invented arXiv ids / DOIs / handles.
- `created_by: "skill:papers-library"` on every node and edge.
- No PDFs are required; if the user wants explainers for specific imported papers, hand off to the
  `arxiv-explainer` skill per paper.

## 4 · Degradation
| Situation | Action |
|---|---|
| No `.bib`/`.ris` given | ask the user to export from Papers (Settings → Export) and provide the path |
| Parser keeps 0 records | check the file is a real BibTeX/RIS export; show the parser's stderr summary |
| mindgap CLI/MCP unreachable | cannot ingest — report the blocker, do not fabricate a "done" |
| Discovery source (arXiv/S2/OpenAlex) unreachable | finish P1–P2 (import) and note P3/P4 deferred |
