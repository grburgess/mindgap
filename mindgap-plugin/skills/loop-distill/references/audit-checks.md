# Audit checks — mechanical staleness pass

Phase 2 spends no verification budget. Every check below is decidable from
the filesystem, the STATE files, and mindgap id lookups. Judgment
calls belong in phase 3/4, not here.

## Live-loop guard (runs first)

A loop whose STATE shows `session-in-progress: yes` **and** whose STATE
mtime is under 6h is LIVE: audit it read-only, never rewrite its STATE,
mark it `live` in ledger §2. Racing a running session corrupts its memory.

## Checks

| flag | mechanical test | evidence to record |
|---|---|---|
| `orphan` | loop incomplete AND `Last session` date >14d old | the date + today |
| `stuck` | `session-in-progress: yes` AND STATE mtime >6h | mtime + threshold |
| `unclosed` | every GOAL §2 criterion passing per the last verdict AND the STATE carries no `Loop status: complete <YYYY-MM-DD>` line | verdict line cited + the `Loop status` value found (or its absence) |
| `halted` | `## Auto mode` `halt reason` is not `none` | the halt reason text |
| `dead-ref` | a fact/rule cites a path, symbol, or file absent from the repo | the failed `ls`/`grep` |
| `dead-map` | a `map:<node-id>` that `mindgap_get_node` returns `node:null` for | the id |
| `stale` | verified fact >90d old with `used:0` | age + usage |
| `contradiction` | two loops assert facts/rules that cannot both hold | both rows, both loops |
| `dangling-promotion` | §7 claims a target that does not contain the item | target + grep |

`Loop status` must exist for `unclosed` to be resolvable: `loop-system`
SESSION END step 1 writes it (`running | complete <date> | escalated
<date>`) and `loop-system/templates/STATE.md` carries the field. Without
that line the flag fires on every successful loop forever and approving the
proposal writes nothing.

## Auto-fix boundary

Mechanically provable, fix silently and log to §9:
- repair a `dead-map` id (re-resolve by date + loop-name tag, or re-ingest).
  Neither path available — MCP down, or the node hard-deleted — → leave the
  dead id in place, flag it in §6, and **NEVER synthesise an id**. A
  fabricated node id is written into a loop's memory and every later session
  trusts it; a flagged dead id is merely a broken link someone can fix;
- reset a `stuck` flag to `no` — but ONLY when the STATE mtime is **>24h**
  AND the loop's `Last session` date is **not today**. Both conditions, or
  no reset. `session-in-progress` is `loop-system`'s sole double-run guard
  (`loop-system/SKILL.md` RESUME step 5), so clearing it while a session is
  merely slow — a long build, a wide test matrix — lets two sessions write
  one STATE. Detection still flags at >6h; the automatic *reset* needs the
  wider margin, and anything short of both conditions is flagged, never
  fixed;
- seed `## Consult` in every NON-LIVE loop whose STATE lacks the ledger
  path, as `- ../../.claude/PROJECT-LEARNINGS.md   <!-- project layer -->`
  (idempotent, one line — INIT template seeding reaches new loops only, so
  without this the hierarchy stays decorative for the loops that actually
  hold learnings).

Everything else is **semantic** and is proposed, never applied — closing an
`unclosed` loop, retiring a `stale` fact, resolving a `contradiction`.

## Meta-training runs (`meta-training/*/`)

`meta-trainer` runs are audited with the same checks; fields map as:

- STATE mtime = **STATE.json** mtime (written every persist); STATE.md is
  its render, read for the human-readable fields below.
- `session-in-progress`, `halt reason`, budget → STATE.md `## Auto mode`
  block (same names).
- `complete` = last Iteration-log entry `[PASS]` or halt reason
  `done-criteria PASS`; `escalated`/`halted` = any other halt reason. There
  is no `Loop status:` line — `unclosed` fires only when a `[PASS]`
  iteration exists AND halt reason is `none`.
- `orphan`: STATE.md carries no `Last session` date — use STATE.json mtime
  >14d with the run incomplete.
- Facts/rules live in `references/` of the meta-trainer SKILL (global) and
  the run's `## Open failures` — the contradiction hunt inlines the run's
  Open failures + Memory check lines beside loop STATEs.

**Auto-fix boundary: NONE.** Never write STATE.json or STATE.md (the
render clobbers hand edits; hand-editing the JSON is forbidden by
`meta-trainer`). No `## Consult` seeding either — meta-trainer RESUME
reads the ledger by protocol. Every fix, including a `stuck` reset
(`session_in_progress` flip via `meta_loop.LoopState`), is a §7 proposal.

## Contradiction hunt

Cross-loop only, and the one phase-2 check needing judgment: inline every
loop's `Verified facts` + `General rules` into a single pass (orchestrator,
or one subagent at the session ceiling — never a file-reading panel, see
`gl-2026-07-02-panel-context-diet`). Output pairs, each with both rows
quoted. A contradiction is never auto-resolved; both rows stay, flagged,
until a human or a promotion verifier settles it.
