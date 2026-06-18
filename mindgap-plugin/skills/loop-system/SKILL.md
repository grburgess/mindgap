---
name: loop-system
description: Orchestrate a self-improving maker/verifier loop system for any project. Use when the user says "build a loop system to do X", "set up a self-improving system", "create a maker/verifier loop", "continue the loop", "resume the loop", "keep iterating on <goal>", or describes a goal they want worked toward autonomously across multiple manually-restarted sessions with persistent markdown memory. Handles init (interview → hard-gated GOAL.md → scaffold self-learning-loop/<name>/ → run session 1) and resume (read STATE.md, run next session, no re-interview). Builds and maintains the memory system (GOAL.md, STATE.md, artifacts/) and compounds lessons back into skills. Triggers even if the user doesn't say "loop" but wants iterative autonomous work with a measurable end state. Also use whenever the project contains a self-learning-loop/ directory (any */STATE.md) and the user asks to continue, keep going, or pick up prior work — even with no mention of loops.
---

# Loop System

Goal-driven loops: an independent verifier grades a maker's work against
hard criteria, memory persists across manually-restarted sessions in
markdown, lessons compound into skills. The model is stateless; this
system isn't.

## Dispatch — do this first

Scan `self-learning-loop/*/STATE.md` under the project root:

- **None found → INIT.**
- **Exactly one →** resume it — unless the user's prompt states a goal
  that does not match that loop's GOAL.md section 1; then INIT a new
  loop alongside it.
- **Several →** resume the one named in the user's prompt. Ambiguous →
  list each loop (name + its `Last session` line) and ask which.

## INIT

1. **Interview for the hard gate.** Skim references/lessons.md for
   recorded misfires first. GOAL.md (templates/GOAL.md) has 7
   required fields. Derive everything you can from the user's prompt
   first; ask one question at a time only for what's missing. The loop
   MUST NOT start until all 7 fields are filled — an unmeasurable
   gate means the verifier can never return PASS and the loop burns
   budget without converging.
   - Done-criteria must be measurable and checkable by a verifier that
     sees only the artifact. "Make it better" is not a criterion.
   - If the user can't supply a measurable criterion, propose a proxy:
     a verifier checklist of N observable properties. If they decline
     proxies too, refuse to loop — do the task one-shot and say why.
2. **Pick the engine** per the decision rule in
   references/loop-patterns.md. Record choice + one-line reason in
   GOAL.md. Non-git project → note "no worktrees, sequential makers"
   in GOAL.md §7.
3. **Scaffold** `self-learning-loop/<loop-name>/` in the project root:
   - `<loop-name>` = short kebab-case slug from the goal; offer the
     user the chance to rename.
   - Copy templates/GOAL.md and templates/STATE.md, fill every
     `{{field}}`. Zero `{{...}}` may survive scaffolding.
   - **Resolve §6 routing:** ceiling = the current session model
     (auto-detected from the in-context "powered by …" line, never
     asked); classifier-block sibling = opus when the ceiling is fable,
     else none; seed the task-class list with kebab labels derived from
     §2 done-criteria. The only absolute model names written are the
     alias-ladder constant and the resolved sibling.
   - Create empty `artifacts/` dir.
4. **Optional project skill:** if lessons will be procedural and
   project-scoped, offer to create
   `<project>/.claude/skills/<loop-name>-lessons/SKILL.md` from
   templates/project-skill.md. Only with user approval.
5. **Permissions (with user approval):** unattended sessions stall on
   permission prompts, so offer to write
   `<project>/.claude/settings.local.json` allowing exactly what the
   loop needs — Edit/Write plus the specific Bash commands derived
   from GOAL.md's done-criteria checks and the project's build/test
   commands, e.g.:

   ```json
   {
     "permissions": {
       "allow": ["Edit", "Write", "Bash(python3:*)", "Bash(pytest:*)", "Bash(diff:*)"]
     }
   }
   ```

   List specific commands only — never `Bash(*)`; a scoped allow-list
   keeps autonomy without handing the loop the whole shell. If the
   file already exists, merge into its `allow` array, don't overwrite.
6. **Run session 1** (below).

## RESUME

1. Skim references/lessons.md for recorded misfires first. Read
   GOAL.md and STATE.md fully. Read everything STATE.md lists
   under `## Consult`. If the session count (STATE.md `Last session`)
   ≥ GOAL.md `Max sessions before forced escalation`, do not iterate —
   apply the escalation rule instead.
2. Do NOT re-interview — GOAL.md is the gated source of truth;
   re-asking invites criteria drift between sessions.
3. Missing/corrupt loop files → reconstruct from `artifacts/` + git
   log, show the reconstruction to the user, get confirmation before
   iterating.
   - **Legacy §6 migration:** if GOAL.md §6 is still the old
     absolute-name table (rows like `Bulk workers | sonnet`), migrate
     it to the policy block — ceiling = the old "Maker (hard work)"
     value or the detected session model; old rows → difficulty tiers;
     resolve the classifier-sibling; seed task classes from §2. Show the
     user the migrated §6 and wait for confirmation before iterating.
4. If `<project>/.claude/settings.local.json` has no allow-list for
   the loop's commands, offer to add one (INIT step 5) — prompts stall
   unattended sessions.
5. Run the next session.

## SESSION

Iteration budget: `Max iterations per session` from GOAL.md (default 5).

Each iteration:

1. **Maker** does the next work item. Tag it (difficulty + task class),
   then route: consult STATE.md § Routing overrides first; absent an
   override, apply the GOAL.md §6 router — `hard` omits the model arg
   so the subagent inherits the ceiling, `normal`/`bulk` name the
   cheaper tier. Spawn it via the subagent (Task) tool; if the maker
   writes files in a git repo, isolate it — create/enter a git worktree
   for it first. Non-git project → no worktrees; makers run
   sequentially only.

   **Artifact-existence check (before the verifier):** confirm the
   files the maker reported writing actually exist (`ls`/`wc -l` what
   it claims to have written). Makers and repair agents both misreport
   writes that never landed — an absent artifact silently burns a full
   verifier round. Missing → re-run the maker (or have it write the
   claimed files) before spending the verifier.

   **Reference-resolution check (before the verifier / before commit):**
   when the maker's output references entities that must already exist in
   ground truth — foreign keys / graph-node ids, file paths, imported
   symbols, API endpoints, citation keys, cross-doc links — resolve EACH
   one mechanically against the authoritative state (a pre-state snapshot,
   the DB, a symbol/index lookup, the filesystem) before acting on it. A
   verifier's "I confirmed X exists" is glance-based and unreliable (see
   verifier-protocol.md and lessons.md 2026-06-12); the orchestrator's own
   parse is the trustworthy gate. An unresolved reference committed anyway
   lands as a dangling endpoint / broken import / phantom citation that
   the goal's own criteria then fail on. Unresolved → fix or re-run the
   maker before spending the verifier.
2. **Verifier** — an independent subagent that receives ONLY the
   artifact + GOAL.md sections 2–3 (done-criteria + rubric). Never the maker's
   reasoning, chat, or this conversation. Protocol, verdict schema,
   and the vision-verify variant for visual goals:
   references/verifier-protocol.md.
3. **Log** one `Iteration log` line to STATE.md immediately after
   every verdict — a killed session may lose at most one iteration.
4. **All criteria pass → loop complete → SESSION END.** Otherwise the
   verifier's gaps are the next maker's input.

Stop and escalate (per GOAL.md escalation rule) when: budget hit, OR
no progress for 2 consecutive iterations — orchestrator judges the
gap sets substantively unchanged (same criteria failing for the same
reasons), not string-identical — OR current session number (STATE.md `Last session`) ≥
GOAL.md `Max sessions before forced escalation` → forced escalation.

## SESSION END — never skip, runs even on escalation or failure

1. **Update STATE.md:** rewrite `Last session`; promote memory —
   open failure → investigated → verifier-confirmed → `Verified facts`
   (with method + date); pattern seen ≥2× → `General rules`.
   - **Routing promotion (self-tuning):** any task class that failed
     verification ≥2× at its tier (read from the Iteration log) →
     write/raise a `Routing overrides` row at the next tier up. A class
     already at the ceiling that still fails → do NOT promote; log it to
     `Open failures` and escalate (the ceiling is a hard stop, not a
     routing problem). Apply this inline mid-session too, the moment a
     class hits ≥2 failures.
2. **Distill:**
   - Project-scoped lessons → project skill (if it exists) or
     STATE.md `General rules`.
   - Cross-project lessons → PROPOSE a new/updated
     `~/.claude/skills/` entry; apply only with user approval.
   - Meta-lessons (this skill misfired: bad scaffold, wrong engine
     choice, vague rubric passed the gate) → append
     references/lessons.md. Same lesson recorded twice → edit this
     SKILL.md to prevent it structurally, with user approval.
3. **Summary to user**, one short paragraph: iterations run, criteria
   n/m passing, blockers, exact next action — so the next manual
   restart costs one line: "continue the loop".

## Errors

- **Classifier-blocked subtask:** log to STATE.md `Open failures` as
  `blocked: classifier`, re-route to the classifier-block sibling
  resolved in GOAL.md §6; if the ceiling has no sibling, surface to the
  user. Never let a block fail silently — it looks identical to a
  real error until debugged.
- **Subagent dies / returns null:** retry once with the same input;
  second failure → `Open failures` entry, then continue or escalate
  per GOAL.md.
- **Subagent spawning unavailable** (e.g. this skill invoked inside a
  subagent, where nesting is impossible): do NOT fake verification
  in-context. Write the blocker to STATE.md `Open failures` and tell
  the user to re-run the loop from a top-level session.
