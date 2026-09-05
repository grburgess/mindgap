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
   - **Contradiction sweep (trajectory backstop).** SESSION END step 1 retracts
     a superseded fact at the moment it is superseded; this pass catches the
     ones it missed. Read `Verified facts` as a set and flag every pair that
     cannot both be true now — a bug and its fix, a capability declared dead
     and later used, a rule and its documented reversal — and propose retiring
     the dead half per SESSION END step 1's rules (delete only if recoverable,
     else move to `## Superseded`).
     **Do NOT propose** on: a baseline and the result measured against it
     (especially when the survivor quotes the baseline as its own before-value),
     a scope-split, a version-split, a general rule beside its special case, or
     a still-true causal diagnosis beside the fix it drove. A measurement and
     its later re-measurement is usually THIS case, not a contradiction. When
     the pair is arguable, propose keeping both with a scope note, never
     deletion. This is the highest-value item in the pass: the
     section is read whole at every RESUME, so one stale line costs every
     remaining session, and the cost grows with the loop's length.
4. **Usage-based prune / promote (proficiency-loop analog).** Using the
   `used:`/`last:` usage signal (global-learnings.md protocol):
   - a row **unused for ≥3 sessions since creation** → retire-candidate;
   - a row **used repeatedly** (or a pattern at `Occurrences: ≥2` not yet
     promoted) → promote-candidate (propose the skill edit, approval-gated).
   Usage — not recency — decides. Legacy rows with no usage suffix are
   "unknown": never auto-retire them; only flag once they have been given a
   fair window of usage tracking.
   - **Never re-propose a decided row.** Skip any row already marked
     `status:rejected:<date>:<reason>` unless new evidence has landed since
     that date — say so explicitly when re-raising one. A proposal the user
     already declined, re-surfaced every third session, trains them to skim
     the whole block.

5. **Decisions are recorded, and only the SKILL side rolls back.** Whatever the
   user decides on items 1–4, write it back to the row (below). The asymmetry
   is deliberate and is WikiSkill's central result (arXiv:2608.27454): the
   knowledge layer is never rolled back, only the *skill* layer is. A rejected
   promotion means "this rule does not belong in a skill yet" — never "this
   observation was wrong". The learning stays in the ledger at **full
   standing**, marked `status:rejected:<date>:<reason>`, and keeps accruing
   usage; it may well be proposed again on stronger evidence. (Write the
   `rejected:` form, not `candidate` — item 4's suppressor keys on it, so a row
   left at `candidate` silently restores the re-proposal loop while looking
   correctly handled.) An increased `used:` count is NOT new evidence.
   Preserving the rejection verbatim is what makes the next pass smarter
   instead of merely repetitive.
   - **Only a human-approved decline may write `rejected:`.** Auto mode is on
     by default, so this pass can fire with no approver present; an unattended
     pass leaves the row untouched and queues the proposal. It never
     self-declines.

6. **Re-qualify promoted skill rules (the removal half).** Promotion is
   otherwise a one-way ratchet: rows retire on usage, the `loop-distill`
   CLAUDE.md block is re-qualified every distill, but a rule that reached a
   SKILL is never looked at again. Both source papers close this loop —
   WikiSkill rolls a skill back when it stops earning its place; the gate is
   its removal trigger, and this system declined that gate
   (arXiv:2608.27454, and see the decision record) without substituting one.
   These are the triggers this substrate actually has, none needing a score.

   Promoted rows are PRUNED from the ledger, so read them from the map:
   `mindgap_find(tag="global-learning")` → nodes whose body carries
   `status:promoted→<skill-path>`. For each, ask:
   - **Motivating learning falsified?** The pointer exists for exactly this.
     If a later verified fact retracted or reversed the learning that
     motivated the rule, the rule outlived its evidence. Highest-priority
     retire — and the only one that is near-mechanical to detect.
   - **Never fires?** No session has invoked it since promotion, or its
     preconditions no longer occur (the tool, path, or workflow it governs is
     gone). Same usage logic item 4 applies to rows, applied one layer up.
   - **Misfires repeatedly?** ≥2 `lessons.md` entries attributable to the rule
     — it is causing the failure it was meant to prevent.
   - **Over-fit to a weaker tier?** A rule promoted from a low-tier session can
     encode a workaround that CONSTRAINS a stronger model rather than helping
     it. WikiSkill measured this: small-model skills dropped a strong model
     from 50.5% to 18.1%. Suspect any rule that reads as a narrow workaround
     rather than a principle.

   **Retiring a rule never destroys the learning.** Restore the row to the
   ledger at `status:candidate` with its original evidence and a note of the
   retirement, and mark the map node `retired:<date>:<reason>`. This is the
   same asymmetry the rejection path uses, in the other direction: the skill
   layer shrinks, the knowledge layer never does. A retired rule may be
   re-promoted later on better evidence.

   Approval-gated like everything here: propose the exact diff (the rule to
   remove, its motivating learning, which trigger fired), show it, wait. Never
   remove a whole skill on this path — only rules within one. A rule that
   still qualifies gets `requalified:<date>` on its node so the next pass can
   tell "checked and kept" from "never checked".

## Output

A single `## Structure pass — session <k>` block appended to STATE.md:
the proposals above as a checklist, each with its evidence (entries cited,
counts). Then PushNotification/summary the user for approval. Apply only the
approved items; leave the block as the record of what was proposed.

Then **write each decision back to the row it was about** — the block records
what was *proposed*, the row records what was *decided*, and it is the row the
next pass reads:

- approved promotion → `status:promoted→<skill-path>` on the global-learnings
  row (the reverse pointer: which learning motivated which skill edit, so a
  skill rule can be traced back and retired if its motivating learning falls).
  The row is then pruned per the ledger protocol, so write the same pointer
  into its **mirrored map node** (`gl-<date>-<slug>`) — that node is what
  survives the prune and is therefore the durable provenance record.
- declined promotion → `status:rejected:<YYYY-MM-DD>:<one-line reason>`.
- approved retire → prune the row; declined retire → bump `last:` to today so
  the ≥3-session retire clock restarts rather than firing again next pass.
- approved rule-retirement (item 6) → `retired:<YYYY-MM-DD>:<trigger>` on the
  map node, AND restore the learning to the ledger at `status:candidate` with
  its original evidence. The rule leaves the skill; the knowledge does not
  leave the system.
- rule re-qualified (item 6, still earning its place) → `requalified:<date>`
  on the node, so the next pass distinguishes "checked and kept" from "never
  checked". Without this the removal half silently degrades into never
  re-examining anything, which is the state it was added to fix.

A pass that proposes without recording the verdict re-proposes the same items
every third session forever.

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
- Did any fact written this session **supersede** one already in `Verified
  facts`, and was the old line deleted (SESSION END step 1)? A surviving
  contradicted line is a miss — retract it now rather than waiting for the
  next pass; it is read at every RESUME in between.

Record one line under a `## Memory check` heading in STATE.md
(`session <k> · <ok | flags: …>`). Flags accumulate there for the next
structure pass to act on. This check adds no gate and cannot fail a loop.
