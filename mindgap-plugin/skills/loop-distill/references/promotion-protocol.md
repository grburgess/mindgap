# Promotion protocol — routing, verification, write gates

## Routing — exactly one destination per learning

A learning written to two layers rots in at least one.

| candidate | destination |
|---|---|
| scoped to one loop | stays in that STATE — no action |
| project-scoped, seen in ≥2 loops or ≥2× in one | ledger §3 (fact) / §4 (rule) |
| about running loops in THIS project | ledger §5 |
| cross-project | `global-learnings.md` row + mindmap node (tier-1) |
| `loop-system` skill misfired | `$MINDGAP_HOME/learning/loop-system/lessons.md` |
| must be known by every session here | project `CLAUDE.md` (gated) |

The `CLAUDE.md` block is a **projection of qualifying §4 rules, not a rival
destination** — a rule lives in §4 and is *mirrored* into the block when it
qualifies. That is what keeps "exactly one destination" true when both rows
appear to match.

Dedup against every destination above before writing — with one exception. A
row that `loop-system`'s own SESSION END step 2 appended earlier in THIS
session has never met a verifier (step 2 writes tier-1 rows unverified; step
3 then invokes this skill). Treat such a row as an unverified candidate and
route it through phase 4, rather than seeing it already present and merely
bumping its `used:`. Otherwise the single largest source of new global rows
reaches the global layer unverified, and phase 4's "cost scales with reach"
is defeated by step ordering. Every other equivalent row already present →
bump its `used:`/`last:` instead of appending a near-duplicate.

## Verify on promotion

Verification cost scales with reach. Only candidates bound for `CLAUDE.md`
or `global-learnings.md` are re-verified.

- One independent verifier subagent per candidate, `model:'opus'`.
- The fact AND the check procedure are **inlined**. The verifier never
  receives loop reasoning, chat, or file paths to go read.
- Verdict schema: `HOLDS` | `STALE` | `UNPROVABLE`, plus one evidence line.
- `STALE` → demote to ledger §6 with the evidence. Never promoted.
- `UNPROVABLE` → stays in the ledger marked `unverified since <date>`.
- **Subagents unavailable → never self-verify.** Where a verifier cannot be
  spawned (this skill invoked inside a subagent, nesting impossible), do NOT
  verify inline and call it verified — that is the fake-verification failure
  `loop-system` already forbids (`loop-system/SKILL.md` § Errors). Mark the
  candidate `UNPROVABLE`, withhold the promotion, say so in the report. An
  unattended self-verified promotion is precisely the artifact this layer
  exists to prevent.
- Everything outside the promotion set keeps `unverified since <date>`.
  Nothing is silently trusted.

## CLAUDE.md contract

`loop-distill` owns exactly one block:

```markdown
<!-- loop-distill:begin -->
## Project learnings (distilled <YYYY-MM-DD>)
- <rule> · <source loop> · verified <YYYY-MM-DD>
See .claude/PROJECT-LEARNINGS.md for the full ledger.
<!-- loop-distill:end -->
```

- Regenerated **in place**, idempotently. Never appended twice.
- Hard cap ~25 lines; overflow stays in the ledger.
- Only `HOLDS` rules that change what ANY session does in this project.
- **Never writes outside the markers.** Contradictions found in the
  hand-written parts are reported as proposals, never applied.
- Markers absent → insert the block at end of file, as a gated diff.
- **No qualifying rules → no block.** Never write an empty or header-only
  block. If a block exists and none of its rules still qualify, propose
  removing it (a gated delete) rather than leaving stale guidance in the
  file every session reads. Say which case applied in the phase-7 report —
  "nothing qualified" is a result, not silence.

## Write gates

| surface | gate |
|---|---|
| `.claude/PROJECT-LEARNINGS.md` | auto (full rewrite) |
| `self-learning-loop/*/STATE.md` of a NON-LIVE loop | auto, mechanical fixes only (stuck-flag reset, `## Consult` seeding). Never edits a live loop's STATE, never rewrites its memory sections. |
| `meta-training/*/` (STATE.json or STATE.md) | **never** — audit read-only; every fix is a §7 proposal (STATE.md is a render; `meta-trainer` owns both files). |
| mindgap nodes/edges | auto |
| `global-learnings.md` tier-1 rows | auto (dedup first; a row step 2 wrote this session is a phase-4 candidate, not a dedup hit) |
| mechanical fixes (`dead-map`, `stuck`) | auto — a `stuck` reset only when STATE mtime >24h AND `Last session` is not today; a `dead-map` id is never synthesised (`references/audit-checks.md` § Auto-fix boundary) |
| project `CLAUDE.md` | **gated — show diff, wait** |
| `~/.claude/skills/**` | **gated** |
| `<project>/.claude/skills/**` | **gated** |
| any retire / delete, anywhere | **gated — show list, wait** |

**A gate never blocks a session.** This skill is invoked from `loop-system`
SESSION END, which may run unattended. Human present → show the diff and
wait. No human present → do NOT halt: record the proposal in ledger §7 as
`status:proposed`, surface it in the phase-7 report, return control. A
distill that blocks stalls SESSION END step 4 (auto-continue) and burns the
loop's remaining wakeups. The gate prevents an unreviewed write; it does
not hold a session open.

## Mindmap — mirror then ideate

1. **Mirror.** Project node → loop nodes → learning nodes. Repair dangling
   `map:` ids. Never leave an island; fallback anchor
   `loop-system-global-learnings`. Use the graph's own vocabulary, never an
   invented term: `created_by loop:<project>-distill` (the MCP accepts only
   `loop:<name>`, `manual`, `mcp`), project node type `concept`, loop node
   type `process`, learnings `learning`, edges `relates_to` / `part_of`.
2. **Mine.** `mindgap_mine_connect` (latent links),
   `mindgap_mine_enrich` per loop goal (2–3 hops),
   `mindgap_mine_learn` (thin spots, stubs).
3. **Adjudicate.** The orchestrator judges every suggestion. Confirmed
   links are ingested; rejects and the remaining frontier land in ledger §8
   as candidate next loops and cross-loop convergence notes.
