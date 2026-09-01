# STRATEGY · {{loop-name}}

Persistent **memory/retrieval policy** — HOW this loop selects, retrieves,
and connects work, kept separate from WHAT counts as done (that is GOAL §2).
This is the loop's structure-loop substrate (AutoMem, arXiv:2607.01224):
the policy is tuned across sessions independently of the task, because
optimizing retrieval/selection alone is high-leverage.

**Read at the start of every session; update at the end of every session.**
Each session appends a dated entry to § Change log and adjusts the tables
below. If GOAL §2 has a self-learning criterion, it is graded against the
delta recorded here.

**Optional artifact.** Only loops whose selection/retrieval policy is tuned
across sessions (which sources/queries/filters/heuristics to use) need this
file. A loop with a fixed one-shot policy skips it.

Baseline established {{YYYY-MM-DD}} (session 1). Metrics start empty and
fill as sessions run.

## 1 · Selection policy (relevance lexicon / filters)
A work item is in-scope only if it serves one of these. Triage rationale
must name which.

| Theme / filter | Keywords / rule | Anchor targets (what good output links to) |
|----------------|-----------------|---------------------------------------------|
| {{theme}} | {{keywords or rule}} | {{anchor node ids / files / concepts}} |

## 2 · Retrieval plan (per session)
Ranked list of the queries / sources / probes the loop runs each session.
Tune by yield (§3): drop 0-yield entries after ≥2 sessions; add entries
mined from accepted items' keywords.

1. {{query / source / probe}}

## 3 · Metrics (filled each session)
Per-entry accept/reject tallies drive prune + expand.

| Query / source | candidates | accepts | rejects | accept-rate | sessions-seen |
|----------------|-----------|---------|---------|-------------|---------------|
| {{entry}} | — | — | — | — | — |

0-yield watch: {{entries at 0 accepts and for how many sessions → retire/reframe}}

## 4 · Connection / quality heuristics (what makes good output)
- {{heuristic}}
- Tune here: record which output types the verifier accepted vs flagged as weak.

## 5 · Change log
<!-- one dated block per session: prior state quoted, the >=1 concrete justified
     change, the metric that motivated it. GOAL's self-learning criterion (if any)
     is graded against these deltas. -->

### {{YYYY-MM-DD}} · session 1 — baseline
- No prior outcomes. Established selection policy (§1), seed retrieval plan
  (§2), empty metrics (§3), connection heuristics (§4).
- Session-1 escape (if GOAL has a self-learning criterion): baseline
  establishment satisfies it.
- Hypothesis to test next session: {{which entries are expected highest-yield}}
