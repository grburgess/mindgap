# Stage-5 graph write-back conventions (mindgap)

Node id patterns and the exact shapes used by the reference run (2026-08).

## Verdict write-back (after stage 2)
Upsert each idea node (same id) with:
- body += `\n\nVERIFICATION (<date>, <method>, <wf_id>): **<VERDICT>**, revised confidence <c>. SURVIVING CORE: ... KEY CORRECTIONS: (1)...(3) NEXT TEST: ... Full verdicts: <doc path>.`
- `confidence` = judge's revised value; tags += `verified-<verdict-slug>`.
Appendices STACK across runs — never rewrite prior verification blocks.

## Measurement facts (stage 3)
`fact-<slug>`, type `verified-fact`, confidence 0.85–0.9. Body carries: source table, the
stratified result numbers, caveats (unfilterable metadata), consequence line naming which
ideas the gate opens/closes. Edges: `supports`/`refutes` → each gated idea; `relates_to` →
the parent finding. Exemplars: `fact-lexical-dense-overlap-rate`, `fact-baseline-ranker-disagreement`.

## Ruling (stage 4)
`decision-<slug>`, type `decision`, confidence ~0.8. Body: first build, Monday's concrete
action, full sequence with gates, decisive arguments, RECORDED DISSENT verbatim. Edges:
`refines` → the findings it sequences; `supports` → ideas it funds; `relates_to` → gating facts.

## Work queue (stage 5)
`proj-<slug>`, type `project`. Body MUST contain: STATUS (planned | blocked-on-X |
deferred-conditional), GOAL, pass/kill bar with numbers, ENTRY STATE (what already exists,
file paths), FIRST ACTION for a fresh session, budget. Edges: `part_of` → the program node;
`depends_on` → prerequisite proj/fact nodes (encodes the sequence); `refines` → the idea it
realizes. Exemplar: `proj-m1-gate0-click-derived-labels`.
Also register the queue in `.claude/PROJECT-LEARNINGS.md` §8 so loop RESUME sees it.

## Papers found during verification (prior art)
Follow paper-to-mindmap (Authors line mandatory; dedup by arXiv id against an export before
minting). Bulk pattern: haiku fan-out for author lists → generate payload JSON with a script
→ `mindgap ingest - < payload.json`. Edge the prior art `refutes`/`relates_to` the
specific idea whose novelty claim it touches, and record its inheritable number in the body.
