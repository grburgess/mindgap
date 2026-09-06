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

6. **NOMINATE skill-rule changes — never decide them.** This pass does not
   create, edit, or remove a skill. It emits a nomination and stops;
   `loop-distill` decides and writes, under its phase-5 skills gate. Two
   reasons, both structural: this pass reads only THIS loop's rows, while a
   skill is loaded by every project, and this pass has no verifier of any kind
   (`loop-system/references/verifier-protocol.md` is never invoked from here).
   A nomination is a row in the proposal block — never a diff, and never a
   "wait". The Output section already routes it: unresolved proposals here are
   consumed cross-loop by `loop-distill`.

   **Promote-nomination** — a row at `used: ≥1` (or `Occurrences: ≥2`) whose
   rule changed a decision more than once. Countable, so it is the trigger to
   lean on.

   **Retire-nomination.** Promoted rows are PRUNED from the ledger, so read
   them from the map: `mindgap_find(tag="global-learning")` → nodes whose
   body carries `status:promoted→<skill-path>`. Only one trigger is executable
   today; say which fired.
   - **Motivating learning falsified** — a later verified fact retracted or
     reversed the learning the pointer names. Near-mechanical to detect, and
     the only trigger with a real observation channel. Use this one.
   - **Reads as a narrow workaround** rather than a transferable rule —
     advisory only, and never sufficient alone. It is a judgement about
     wording with nothing to check it against, so it selects for vague rules
     over specific true ones — and this ledger's most-used rows are precisely
     the specific ones (naming an alias, a flag, a path). Flag it for a human;
     never act on it unaided, and never use it to BLOCK a promotion.

   <!-- BLOCKED, do not pretend otherwise: "never fires" and "misfires ≥2×"
        have no observation channel. Promotion PRUNES the row, so used:/last:
        stops at the moment of promotion and nothing counts a rule's firings
        afterwards. "Over-fit to a weaker tier" has no tier signal recorded
        anywhere in a row or STATE.md. Re-enable these only once a promoted
        row leaves a stub carrying used:/last:. Until then this pass can
        nominate a promotion far more reliably than a retirement — which
        makes the skill layer a ratchet, and that is a known open defect,
        not a solved problem. -->

   **Retiring a rule never destroys the learning.** When `loop-distill`
   approves one, the row returns to the ledger at `status:candidate` with its
   original evidence and a note of the retirement, and the map node is marked
   `retired:<date>:<trigger>`. Same asymmetry as the rejection path, running
   the other way: the skill layer shrinks, the knowledge layer never does.
   A rule that still qualifies gets `requalified:<date>` so the next pass can
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
- skill-rule nominations (item 6) → recorded in this block as nominations and
  handed to `loop-distill`. This pass writes NOTHING under any `skills/` path
  and authors no diff. `loop-distill` performs the write under its phase-5
  gate and marks the map node `retired:<date>:<trigger>` or
  `requalified:<date>` — the latter so a later pass can tell "checked and
  kept" from "never checked", without which the removal half degrades into
  never re-examining anything.

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
- **Did any ledger row inform a decision this session, and did its
  `used:`/`last:` actually get bumped?** RESUME step 1 already requires this,
  and it is the single most-skipped instruction in the system: 41 of 60 rows
  sit at `used:0`. The counter is the ONLY non-judgement input the promote
  path has — item 4 and item 6's promote-nomination both key on it — so an
  unbumped counter silently disarms the whole promotion mechanism while every
  file looks correctly maintained. Bump it now if it was missed. Name the rows
  in the `## Memory check` line so a skipped bump is visible rather than
  invisible.

Record one line under a `## Memory check` heading in STATE.md
(`session <k> · <ok | flags: …>`). Flags accumulate there for the next
structure pass to act on. This check adds no gate and cannot fail a loop.
