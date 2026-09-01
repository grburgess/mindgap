# Project learnings · mindgap

Seeded by the skills-system migration 2026-09-01 — not yet distilled. Sections 1 and 3-9 are empty on purpose: run `loop-distill` to fill them. Authoritative project layer:
global learnings sit above this file, per-loop STATE.md below it. Rows
carry `used:<n> last:<YYYY-MM-DD>`; usage — not recency — drives
prune/promote. Nothing here is ever a pass/fail gate on a loop.

## 1 Project state as-is
<!-- what this project is, what exists, where it stands. Regenerated each
     run from loop STATEs + git log. Keep it short. -->

## 2 Loop registry + health

| loop | sessions | criteria | status | last touched | flags |
|---|---|---|---|---|---|
| org-roam-import | 1 of 3 | 6/8 | running | 2026-07-20 | blocked on C8 (15/32 dedup judges killed by an API session limit); nothing ingested, graph untouched |
| migrate-db-obsidian | 0 of 2 | 0/? | orphan | 2026-07-21 | GOAL.md scaffolded, no session ever run; STATE.md was a 3-line stub |
<!-- one row per self-learning-loop/*/ and meta-training/*/ run — status:
     running | complete | escalated | orphan | live -->

## 3 Cross-loop verified facts
<!-- <fact> · verified via <method> · <YYYY-MM-DD> · source:<loop> ·
     used:<n> last:<YYYY-MM-DD> -->

## 4 Cross-loop rules
<!-- pattern verified in ≥2 loops, or ≥2× in one loop and project-scoped.
     Same usage suffix. -->

## 5 Loop-system project notes
<!-- meta: running loops IN THIS PROJECT — engine choice, worktree
     viability, permission set, model tiers that work here. -->

## 6 Stale / dangling / open
<!-- <YYYY-MM-DD> · flag:<orphan|stuck|unclosed|halted|dead-ref|dead-map|
     stale|contradiction|dangling-promotion> · <item> · evidence:<proof> -->

## 7 Promotion ledger
<!-- <YYYY-MM-DD> · <item> · → CLAUDE.md | global-learnings |
     mindmap:<node-id> · verdict:HOLDS · status:<proposed|applied|withheld>
     proposed = gated write awaiting a human; the run recorded it and
       returned rather than blocking.
     applied  = the write landed.
     withheld = verified but deliberately NOT promoted (e.g. UNPROVABLE
       for want of a verifier subagent). A real third state — without it a
       run invents a value.
     MACHINE-AUDITABLE: `status:` appears EXACTLY ONCE per row, as that
     row's FINAL field, and the token never appears in prose narration
     anywhere in this ledger. Phase 7 enumerates open proposals by
     counting rows whose status field is the proposed value, so a status
     token in prose over-reports them. Narrate with words ("proposed,
     awaiting approval"), not the token. -->

## 8 Ideation
<!-- mindmap frontier, cross-loop convergence, candidate next loops -->

## 9 Run log
<!-- <YYYY-MM-DD> · loops:<n> · flags:<n> · promoted:<n> · gated:<n> ·
     fixes:<what was auto-fixed, or none> -->
