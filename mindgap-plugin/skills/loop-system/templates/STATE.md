# Project memory · {{loop-name}}

Created {{YYYY-MM-DD}}. Read this file fully at session start. Update
after every verifier verdict and at session end — write before walking
away.

<!-- memory ladder: 1 open failure -> 2 investigated -> 3 verified fact -> 4 general rule -> 5 consulted next session -->

Loop status: running
<!-- running | complete <YYYY-MM-DD> | escalated <YYYY-MM-DD>
     rewritten by SESSION END step 1. `loop-distill`'s `unclosed` check
     keys on the absence of `complete`, so a finished loop that never gets
     this line is flagged forever. -->

## Verified facts
<!-- stage 3 — stop guessing about these.
     Format: fact. Verified via <method>, <YYYY-MM-DD>. -->

## General rules
<!-- stage 4 — consult before re-deriving.
     Promoted when a pattern is verified ≥2×. -->

## Routing overrides (learned)
<!-- task class | tier | reason | YYYY-MM-DD
     consulted by the router BEFORE GOAL.md §6 default routing.
     never above the ceiling; a class still failing at the ceiling is an
     Open failure, not a routing problem. -->

## Open failures
<!-- stages 1–2 — investigate next session.
     Format: <YYYY-MM-DD> · symptom · hypothesis. -->

## Iteration log
<!-- one line per iteration:
     <session>.<iter> · class:<label> · tier:<used> · maker: <action> · verdict: PASS | gaps(<n>): <short> -->

## Consult
<!-- skills/files to read at session start, one per line -->
- ../../.claude/PROJECT-LEARNINGS.md   <!-- project layer: cross-loop facts, rules, loop-system notes -->

## Auto mode
<!-- read by an auto session to decide continue-vs-halt against the ceiling BEFORE designing the session. -->
- status: {{on | off}}
- budget spent: {{<iterations so far>}} / {{<GOAL §4 total ceiling>}}
- session-in-progress: no   <!-- set `yes` at session start, back to `no` at SESSION END; a wakeup that finds `yes` must not double-run. This is the ONLY double-run guard. Sole exception: `loop-distill` may clear a long-abandoned flag — and only when this STATE's mtime is >24h AND `Last session` is not today; a merely slow session (long build, wide test matrix) is flagged, never cleared. -->
- last wakeup: {{none | <ScheduleWakeup id @ time>}}
- halt reason: {{none | <trigger that stopped auto-continuation>}}

## Last session
<!-- Session <k> of <max sessions> · <YYYY-MM-DD> · what happened · criteria <n>/<m> passing
     Next: <exact next action> -->
