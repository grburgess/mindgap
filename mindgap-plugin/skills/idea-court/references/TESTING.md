# idea-court — TDD test record (2026-08-31)

## RED — baselines (design-level scenario: "design the verify fan-out + build debate, implemented as-is")

- **In-repo baseline** (opus, repo readable): reconstructed the full pattern by reading this
  program's artifacts — 181k tokens, 10 tool calls. Finding: skill value = portability + cheap
  dispatch, not concept teaching.
- **Fresh-context baseline** (opus, file reads forbidden): strong unaided design that failed on
  six counts: (1) weakest-link roll-up kills without surviving-core extraction; (2) no dedicated
  prior-art lens / inheritable numbers; (3) measurements deferred to tickets, never run in-flow;
  (4) 2–3× over-engineered vs the calibrated shape (canaries, dual-family verifiers, double-run
  judges); (5) blind to runtime gotchas (synth write-block, alias hazards, stale MCP auth,
  whole-payload ingest); (6) no dependency-edged project staging.

## GREEN — with-skill design run (opus, fresh context, skill + references readable)

All six gaps closed; added compliant improvements (deterministic post-checks re-running an
empty-surviving-core synthesis; judge's dissent becomes next round's stage-2 check).

## GREEN — grading-rules micro-test (5 skill reps vs 5 control reps, session-tier model)

Fixture: Idea X (novelty claim contradicted w/ inheritable threshold 0.4, mechanism holds →
correct: VERIFIED-WITH-CAVEATS + repitch) and Idea Y (load-bearing mechanism contradicted,
second mechanism survives → REFUTED-as-pitched WITH mandatory surviving_core + next_test).

| Behavior | Skill arm (5 reps) | Control arm (5 reps) |
|---|---|---|
| X verdict = VWC (novelty cap) | 5/5 | 5/5 |
| X structured repitch + inherited 0.4 threshold | 5/5 | ~2/5 informal |
| Y verdict correct (REFUTED-as-pitched) | 5/5 | 5/5 |
| Y surviving_core ATTACHED to the idea as a field | 5/5 | 0/5 — all controls "re-file as a NEW idea, do not credit Y" |
| Stratify-never-pool caveat carried | 5/5 | 1/5 |
| UNTESTABLE-INTERNAL routed w/o penalty | 5/5 | 3/5 (prose) |
| Rep-to-rep variance | near-zero (same shape) | verdicts stable, structure varies |

Reading: on this model tier the verdict LABELS are not the failure surface — the structural
contract is. Controls consistently detach the surviving core ("spin it off, don't credit the
idea"), which would starve the debate roster and stage-5 write-back that key on the verdict's
surviving_core field. The skill wording binds that contract 5/5 with near-zero variance.

## REFACTOR

No new rationalizations surfaced in any arm; no counters added. Known limitations: design-level
GREEN was single-rep; micro-test model = session ceiling (fable) — weaker synthesis tiers are
untested (the skill routes synthesis to ceiling, so this matches production).
