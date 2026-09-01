# RETRIEVE — the layered pull

Mirrors loop-system RESUME step 1, decoupled from loops. Run at task start,
top-down. **Context diet:** inline what informs THIS task, never whole files —
a retrieve phase that dumps every layer into context is worse than none.

## 1 · Global

`mindgap_find` the task's keywords, plus tag `global-learning`
(`mindgap_find(query=<term>, tag="global-learning")`). Skim the matching
rows in `$MINDGAP_HOME/learning/loop-system/global-learnings.md`. One-word
queries — multi-word strings degrade into noise; an empty result usually means
the query was too specific, not that nothing exists.

## 2 · Project

Read `<project>/.claude/PROJECT-LEARNINGS.md` when present — the ledger
`loop-distill` maintains: cross-loop facts, rules, project quirks. Absent →
note it and move on (only loop-bearing projects have one).

## 3 · Task-adjacent loop state

Scan `self-learning-loop/*/GOAL.md` §1 under the project root for goals that
overlap the task's topic; read the matching loops' `STATE.md` (Verified facts,
General rules, Open failures). **Read-only, always.** Live-loop guard: STATE
showing `session-in-progress: yes` with mtime under 6h is a running session —
read nothing beyond what's already on disk, write nothing, never reset flags.

## 4 · Graph

`mindgap_mine_enrich(seed=<task topic>)` — the RWR-ranked 2–3-hop
subgraph, not a 1-hop keyword hit. Then `find`/`context` for specifics. On a
mature graph, survey via CLI projection to protect context
(`mindgap find "<term>" --json | jq '.[] | {id, title, type}'`), opening
full nodes only for the handful you'll actually use.

## 5 · ctx/

`~/second_brain/ctx/` holds reusable prompts, templates, rules. Find them via
their graph index nodes (tag `ctx`), not by listing the folder — the graph
knows what each is for. Pull only what this task calls for.

## Usage bookkeeping

Any global-learnings row that actually informs a decision this task gets its
`used:<n> last:<YYYY-MM-DD>` suffix bumped (increment `used`, set `last` to
today) — usage, not recency, is what the structure pass prunes on. Same for a
PROJECT-LEARNINGS row. A row merely read is not "used"; a row that changed
what you did is.
