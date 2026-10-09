# Advisor protocol

Harness-orchestrated advisor: the orchestrator runs below the top tier
(opus/high) and consults a fable subagent at three fixed checkpoints.
Shared by loop-system, meta-trainer and idea-court. Independent of the
native `advisorModel` setting — this works through any gateway.

## When it is on

`Advisor: fable-subagent` when the orchestrator's session model is below
fable and the `fable` alias spawns; `none` when the session model is fable
(asking yourself is no second opinion) or the alias fails at spawn (probe
once; on `[1m]`/variant sessions see the alias caveat in the user's
CLAUDE.md). This is the ONE sanctioned exception to "fable never a
subagent": read-only, at most 3 calls per session, never maker or
verifier work.

## Checkpoints (fixed — the model never decides whether to ask)

1. **Plan gate** — after the hard gate is filled (GOAL.md written / court
   claim list fixed), before the first maker or Workflow runs.
2. **Repeat failure** — the same failure (same criterion failing for the
   same reason, same error signature, or the 2× no-progress trigger) seen
   a second time, before the next attempt.
3. **Done gate** — before writing `complete`/`escalated` to STATE, or
   before staging a ruling.

Budget: one call per checkpoint per session; a second repeat-failure
in the same session goes straight to the escalation rule.

## Packet (not the transcript)

Spawn: `model: 'fable'`, `effort: 'high'`, read-only tools (Read, Grep,
Glob; no Edit/Write/Bash writes). Prompt contains:

- checkpoint name + the one question being asked
- file paths to read itself: GOAL.md, STATE.md, and the evidence (plan,
  the two failing verdicts/error logs, or the final verifier results)
- ≤ 30 lines of orchestrator summary: what was tried, what it believes,
  what it is about to do

Paths, not pasted content — the advisor reads what it needs, the
orchestrator's framing stays short and is not the only evidence.

## Output (exact)

```
VERDICT: PROCEED | REVISE | STOP
REASONS: <≤5 bullets, each tied to a file/line or verdict>
CHANGES: <≤3 concrete changes; empty on PROCEED>
```

## Acting on it

- **PROCEED** → continue.
- **REVISE** → apply the changes, or log why not (one line each). Never
  silently ignored; no re-consult on the same checkpoint.
- **STOP** → treat as a stop-and-notify trigger: HALT, PushNotification,
  write the reasons to STATE Open failures; the user decides.

Log every call, one line:
`<session>.<iter> · <checkpoint> · <VERDICT> · <one-line gist> · <action taken>`

- loop-system → STATE.md `## Advisor log`
- meta-trainer → `ADVISOR-LOG.md` beside STATE.md (STATE.md is a render
  of LoopState; hand-added sections are clobbered on persist)
- idea-court → an `Advisor:` line in the `decision-*` node body, plus a
  live-view `note` when live-view is running

## Per-skill checkpoint mapping

| Checkpoint | loop-system | meta-trainer | idea-court |
|---|---|---|---|
| Plan gate | INIT, GOAL.md written, before session 1 | INIT, GOAL.md + frozen split written, before iteration 1 | claim list fixed, before stage 2 Workflow |
| Repeat failure | same §2 criterion failing for the same reason twice / 2× no-progress | same diagnosis differential or failed hypothesis twice | same Workflow stage failing twice (null agents, schema, gate) |
| Done gate | before `complete`/`escalated` | before `complete`/`escalated` | judge ruling written, before stage 5 staging |
