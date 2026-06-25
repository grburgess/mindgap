# Spec · `second-brain` — analytic mining engine for the mindgap graph

A stdlib analytic layer over the knowledge graph that lets an agent **mine the graph for ideas and
connections** — not just look things up. The existing read surface (`find` / `context` /
`get_node` / `neighbors` / `stats` / `lint`) is pure **retrieval** ("what do I know about X"). This
adds the missing **analytic** layer: ranked relevance, latent-link discovery, and a learning
frontier — so the graph works as a second brain the agent self-learns from.

Engine: `mindgap/analyze.py` (pure stdlib functions). Surface: `mindgap mine <mode>` (CLI) +
`mindgap_mine_*` (MCP). Orchestration: a `second-brain` skill ("math proposes, the LLM disposes").

## Decisions

1. **One engine, three modes** (`enrich` / `learn` / `connect`), mode-dependent write policy:
   `enrich` = read-only · `learn` = read-only + emit frontier file · `connect` = gated write-back.
2. **Stdlib only** — all algorithms are ~30-40 LOC over an in-memory adjacency built from `db.graph()`.
3. **Math proposes, LLM disposes.** Deterministic graph math produces cheap candidates; the agent
   adjudicates the top-K by reading node bodies. The LLM is never in the math.
4. **Centrality = weighted degree** (PageRank is redundant at small N). **Themes** (community
   detection) are out of v1 — no mode consumes them; if added later, use deterministic greedy
   modularity, not label propagation (which is unstable across orderings).
5. **`mentions=0.25` is hygiene, not the precision lever** — `mentions` edges frequently
   double-encode a structural edge, so down-weighting them rarely changes a ranking. The real
   per-mode levers are named below.
6. **Reuse `ingest` for all writes** — `connect` never bypasses endpoint validation / provenance.

## Engine — `analyze.py` primitives

- `build_graph(graph, mention_weight=0.25)` → in-memory undirected weighted graph. Parallel edges
  per unordered pair collapse to the **MAX** incident weight (`mentions`→0.25, structural rel→1.0).
  Exposes `adj`, per-node `meta`, **structural degree** `sd` (distinct non-`mentions` neighbors),
  **structural in-degree** `sin` (the "demand"), and an auto-derived **hub stoplist** (the dominant
  `part_of` sink — the org/root super-hub), plus `ids`.
- `weighted_degree(g)` — centrality / hub surfacing.
- `adamic_adar(g, min_common=3)` — latent-link candidates over **non-adjacent** pairs sharing
  `>=3` neighbors: `AA = Σ_z w(a,z)·w(b,z)/log(1+wdeg(z))`, Jaccard tie-break.
- `guard_candidates(g, candidates)` — drops a pair unless it has `>=1` shared neighbor that is
  `type != person` and not in the hub stoplist; penalizes same-type `repo↔repo` pairs.
- `rwr(g, seeds, restart=0.25, iters=150, tol=1e-10, exclude=None)` — random-walk-with-restart,
  degree-normalized transition; the enrich relevance primitive.
- `frontier_scores(g, now=None)` — composite "where is knowledge thin" score: stub, empty/short
  body, structural isolation, fresh-thin (recent papers / `idea-*` with low structural degree),
  in-demand-thin (a concept with `>=3` structural in-edges but a short body — demand **gates**,
  thinness scores), low-confidence. Excludes `REFUTED`/`REJECTED` bodies (anchored), capture-hook
  dev artifacts (`created_by` starting `capture:` with type design/feature/learning), placeholder
  ids, and orphan junk stubs.

## Modes

- **`enrich <seed>`** *(read-only)* — RWR top-K (K=12) ranked relevant subgraph, reaching 2-3 hops.
  Lever: `restart=0.25` + suppress the hub-stoplist node from results. Isolated seed → 1-hop set
  with a "nothing to walk" note.
- **`learn`** *(read + emit)* — `frontier_scores` top-20 with a reason per node, and writes
  `~/.mindgap/frontier.{json,md}` for the `{{TOPICS}}` loops to consume as a growth queue.
- **`connect`** *(gated write-back)* — guarded Adamic-Adar top-K=15 as human-in-the-loop
  suggestions, each with both node bodies + shared support + a `distant` flag. The agent adjudicates
  (accept only if a *nameable* relationship is stateable in one sentence), then confirmed links are
  written via `ingest` (`created_by="mine:connect"`, default `confidence=0.6`, default
  `rel="relates_to"`). Idempotent: dedups against existing and prior-run edges. Distant accepted
  pairs also get a synthesized bridging insight node wiki-linked to both endpoints. CLI is
  suggestions-only; commit via the agent path or `mine connect --apply <decisions.json>`.

## Interfaces

- **CLI:** `mindgap mine enrich <seed> [--k]` · `mindgap mine learn [--top] [--no-emit]` ·
  `mindgap mine connect [--k] [--apply <file>]`. `--json` on enrich/learn.
- **MCP:** `mindgap_mine_enrich(seed,k)` · `mindgap_mine_learn(top,emit)` ·
  `mindgap_mine_connect(k)` (read-only; the agent writes confirmed links via `mindgap_ingest`).
- **Skill:** `second-brain` — the adjudication rubric + the gated write-back protocol.

## Testing

`analyze.py` is pure functions → deterministic unit tests over toy fixture graphs (weighted-degree
order, Adamic-Adar surfacing + guard, RWR proximity ordering + exclusion, frontier ranking +
exclusion filters). `mine.py` tested over a seeded temp DB (enrich seed resolution, learn frontier
emit, connect candidate shape, connect write-back idempotency + provenance). MCP tool registration
asserted in the tool-name set.

## Out of scope

Embedding/semantic similarity (structural-only is sufficient); a precomputed analytics cache
(computes in <100ms); PageRank and community detection (v1.1 if ever); auto-writing in
`enrich`/`learn`.
