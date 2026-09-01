# Structure pass — trajectory-level memory maintenance

The per-session ladder (open failure → verified → rule → skill) grows the
memory one entry at a time, reactively. Nothing ever re-reads the WHOLE
trajectory to merge duplicates, retire dead weight, or clear the backlog of
structural fixes that pile up "not yet applied". The structure pass is that
missing read — the loop-system's version of AutoMem's structure loop
(arXiv:2607.01224): a strong model inspects the full trajectory and refines
the memory *structure*, separately from the task.

It is **read-only + proposal-only**. It NEVER auto-edits SKILL.md, a skill,
or deletes a memory entry, and it is NEVER a pass/fail gate (a structure-pass
finding must not halt a loop — that would resurrect the un-gated-proxy
failure, lessons.md 2026-06-15). Every output is a proposal the user
approves before anything changes.

## When it fires

At SESSION END, after Distill, when BOTH hold:
- the loop has completed **≥3 sessions** (skip for young loops — nothing to
  restructure yet), AND
- **session count % 3 == 0**, OR this session hit **forced escalation**.

Skip otherwise. A loop that never reaches 3 sessions never runs one.

## What it reads (full trajectory — context diet applies)

The orchestrator INLINES these into the pass (do not point a subagent at the
files to read — read-heavy panels autocompact-thrash, global-learnings.md
2026-07-02):
- every `## Iteration log` line in STATE.md (all sessions),
- STATE `Verified facts`, `General rules`, `Open failures`, `Routing overrides`,
- this loop's rows in $MINDGAP_HOME/learning/loop-system/lessons.md and $MINDGAP_HOME/learning/loop-system/global-learnings.md,
- the accumulated **metamemory-check flags** from § Memory check (see below).

## What it proposes (all approval-gated)

1. **Merge / dedup.** Redundant or overlapping Verified-facts / General-rules
   / global-learnings rows → one merged entry. Cite the entries merged.
2. **Structural-fix backlog.** Surface every lessons.md entry carrying a
   "Suggested structural fix … not yet applied" (or `Occurrences: ≥2`) that
   is NOT yet reflected in SKILL.md → present as a batch for one approval,
   rather than waiting for the next per-session recurrence.
3. **Re-taxonomy.** If STATE sections have drifted (facts filed as rules,
   stale Open failures already resolved), propose the re-filing.
4. **Usage-based prune / promote (proficiency-loop analog).** Using the
   `used:`/`last:` usage signal (global-learnings.md protocol):
   - a row **unused for ≥3 sessions since creation** → retire-candidate;
   - a row **used repeatedly** (or a pattern at `Occurrences: ≥2` not yet
     promoted) → promote-candidate (propose the skill edit, approval-gated).
   Usage — not recency — decides. Legacy rows with no usage suffix are
   "unknown": never auto-retire them; only flag once they have been given a
   fair window of usage tracking.

## Output

A single `## Structure pass — session <k>` block appended to STATE.md:
the proposals above as a checklist, each with its evidence (entries cited,
counts). Then PushNotification/summary the user for approval. Apply only the
approved items; leave the block as the record of what was proposed.

Unresolved proposals in this block are consumed cross-loop by the
`loop-distill` skill (the project layer) when a loop completes or hits
forced escalation — so a proposal nobody approved stops accumulating
unread here.

## Metamemory self-check (per session — feeds the structure pass)

Distinct from the task verifier (which grades only GOAL §2). At SESSION END,
after the STATE update, the orchestrator runs a quick **advisory** check on
its own memory writes this session — never a gate:

- Did every fact the iteration log implies as verified get promoted to
  `Verified facts`? (a finding investigated + confirmed this session that is
  still sitting in Open failures is a miss.)
- Did every pattern seen ≥2× get promoted to `General rules` / a
  `Routing overrides` row, per SESSION-END step 1?
- Did any recalled `Consult` item / Verified-fact prove **stale or unused**
  this session? Bump its usage; flag a persistently-unused one.

Record one line under a `## Memory check` heading in STATE.md
(`session <k> · <ok | flags: …>`). Flags accumulate there for the next
structure pass to act on. This check adds no gate and cannot fail a loop.
