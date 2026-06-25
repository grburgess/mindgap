---
name: second-brain
description: Use to mine the mindgap graph for ideas and connections as a self-learning second brain — when researching/answering and you want the whole graph (not a keyword hit), when asked to "find connections / what should I learn next / enrich this from my notes", or to grow the graph with vetted latent links. Three modes over the analytic engine: enrich (relevance), learn (frontier), connect (gated latent-link write-back). Protocol: AGENTS.md.
---

# second-brain

The graph has an analytic layer (`mindgap mine` / `mindgap_mine_*`) on top of plain
retrieval. Math proposes cheap candidates; you adjudicate. Read `AGENTS.md` first for the ingest
rules. `mentions=0.25` is hygiene, not the precision lever.

## Pick the mode by intent

- **enrich** — grounding a topic you're working on. `mindgap_mine_enrich(seed)` returns the
  RWR-ranked relevant subgraph (reaches 2-3 hops, unlike 1-hop context). Read-only.
- **learn** — deciding what to study/ingest next. `mindgap_mine_learn()` ranks the thin spots
  (stubs, isolated/fresh-thin papers, in-demand-thin concepts) and writes `frontier.json` for the
  `{{TOPICS}}` loops. Read-only.
- **connect** — growing the graph with latent links. `mindgap_mine_connect(k)` returns guarded
  candidate pairs + both bodies + shared support. Gated write-back (below).

## connect adjudication rubric (math proposes, you dispose)

For each candidate, read **both** bodies. **Accept only if you can state the specific relationship in
one sentence from the bodies** — a *nameable* relationship, not mere co-occurrence. Otherwise reject.
Per accepted pair choose `rel` (`relates_to` default; `depends_on`/`implements`/`cites`/`part_of`/
`defines` when the bodies justify it) and set `confidence` (0.5–0.8 for a new unverified link).

## Gated write-back

Never raw-insert. Write confirmed links via **`mindgap_ingest`** with `created_by="mine:connect"`.
For a genuinely distant accepted pair (the candidate's `distant` flag), also synthesize a bridging
insight node (`type=concept`, `created_by=mine:connect`, body = the one-line rationale with
`[[a]] [[b]]` wiki-links). Show the batch before committing. Re-running is idempotent — already-linked
pairs are skipped. (CLI equivalent: `mindgap mine connect --apply decisions.json`.)
