# deep-research — phase protocol

## 1 · GROUND

Run second-brain's layered pull
(`~/.claude/skills/second-brain/references/retrieval.md`) on the research
topic. The centerpiece is `mindgap_mine_enrich(seed=<topic node or
term>)` — the 2–3-hop subgraph is the map of what's already known. Keep the
context diet: carry forward the nodes that bear on the question, not the
whole pull.

## 2 · GAP

Three sources, merged into one written list:

1. `mindgap_mine_learn()` filtered to frontier items whose title/tags hit
   the topic keywords — thin spots and stubs the graph itself flags.
2. Adjacent loop STATEs (found in GROUND layer 3): their `Open failures` and
   any `escalated` status are unresolved questions someone already hit.
3. Contradictions you noticed while reading GROUND's nodes (two nodes
   asserting incompatible things, a `confidence` mismatch, a REFUTED marker).

Format — each gap is one line with its evidence:

```
G1 · <what we don't know> — evidence: <node-id / loop open-failure / contradiction pair>
G2 · ...
```

**Show the list to the user before any dialogue.** It is the agenda; the user
may strike or add items. An empty gap list is a finding, not a failure — say
"the graph already covers this; what's left is a judgment call" and go
straight to DIVERGE.

## 3 · DIVERGE

Invoke superpowers:brainstorming and follow its rules (classification,
one-question-at-a-time, approval gates — they stay in force). The one change
this skill imposes: **every question cites evidence.** Not "what matters most
to you?" but:

> "[[finding-taxonomy-semantics-discarded-single-class]] says the taxonomy is
> flattened at training; gap G2 is whether anything downstream needs it kept.
> Does this plan need to resolve G2, or is single-class an accepted
> constraint?"

Questions the graph can already answer are never asked — answer them from
GROUND and move on.

## 4 · DEEP THINK — offer only, never auto-fired

Offer ONLY when, after DIVERGE, candidate directions are genuinely contested
or the evidence for choosing is thin. The offer names its cost:

> "Directions A/B/C are contested and the graph is thin here. I can run a
> deep-think pass — 3 read-only scout agents (one per direction) + a judge
> panel scoring against the gap list, roughly N agents total. Want it?"

Run only on an explicit yes or standing ultracode. Shape (Workflow tool):

- one **scout** per candidate direction — read-only (repo, graph, web when
  relevant), returns evidence for/against with sources; `model:'haiku'`
  low-effort for mechanical sweeps, `model:'opus'` for read/search scouts;
- **judge panel** scores each direction against the gap list — omit model
  (ceiling), higher effort;
- results feed CONVERGE as the "evidence so far" section.

Scouts never write anywhere — not the graph, not files. A scout that wants to
record a finding routes it through PAY BACK's distill like everything else.

## 5 · CONVERGE

Write `<project>/docs/research/YYYY-MM-DD-<topic-slug>.md`. Required
sections — all six, none empty:

```markdown
# <topic> — research plan

## Research questions
RQ1 · ...            # each traceable to a gap item or dialogue decision

## Hypotheses
H1 (for RQ1) · ...   # falsifiable statements, not hopes

## Method
# per RQ: what to do, on what data/system, what would count as an answer

## Evidence so far
# from GROUND/GAP/DEEP THINK, with node ids — what's already known

## Done-criteria
# measurable, verifier-checkable; "understand X better" is not a criterion

## Loop-shaped?
# yes/no + one line why: multi-session + measurable gate → yes
```

Present it like any brainstorming design and get approval before PAY BACK.

## 6 · PAY BACK

Second-brain UPDATE (`~/.claude/skills/second-brain/references/update.md`),
plus the plan registration — always, regardless of doc location:

```json
{"id": "research-plan-<topic-slug>",
 "title": "Research plan: <topic>",
 "type": "page",
 "tags": ["artifact", "research-plan", "<topic tags>"],
 "body": ">=40 words: the questions it poses, the hypotheses, what evidence motivated it — [[wiki-links]] to the gap/concept nodes it rests on.",
 "urls": [{"label": "docs/research/YYYY-MM-DD-<topic-slug>.md",
           "url": "file://<percent-encoded absolute path>", "kind": "file"}],
 "confidence": 0.9,
 "created_by": "manual"}
```

Edges: `relates_to` each motivating gap/concept node. Then distill any
learnings the planning itself produced (tiered gates as usual).

**Loop handoff** (only when Loop-shaped? = yes): offer loop-system INIT and
paste into that conversation:

> Proposed GOAL §1 (goal): <one paragraph from the plan>
> Proposed GOAL §2 (done-criteria): <the plan's done-criteria, verbatim>

Never write GOAL.md/STATE.md yourself — loop-system's interview confirms
these candidates and fills the remaining five fields.
