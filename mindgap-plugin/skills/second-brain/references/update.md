# UPDATE — distill, register, sweep

Run at task end. Three moves; none skipped, none turned into a session-blocking
gate.

## 1 · Distill learnings — one destination each, tiered gates

Route each candidate learning to **exactly one** destination. Dedup against
EVERY destination before writing — an equivalent row already present anywhere
gets its `used:/last:` bumped instead of a near-duplicate appended.

| candidate | destination | gate |
|---|---|---|
| project-scoped fact/rule | graph node + `<project>/.claude/PROJECT-LEARNINGS.md` row | direct — deduped, marked `unverified since <YYYY-MM-DD>` |
| cross-project rule | `global-learnings.md` row + graph mirror (tag `global-learning`) | **verifier subagent + user gate** |
| changes what every session in this project does | `CLAUDE.md` distilled block | **verifier subagent + user gate** (loop-distill owns the block; propose, never write outside its markers) |
| procedural, project-scoped, recurring | offer a project skill | user approval |

Rationale: a stale ledger row costs one project; a stale global row costs every
project — verification cost scales with reach.

**The verifier** (for global-reach candidates only): one independent subagent
per candidate, receiving the fact AND its check procedure inlined — never chat,
never a file path to go read. Verdict `HOLDS | STALE | UNPROVABLE` + one
evidence line. Only `HOLDS` may be promoted, and the write itself is still
shown to the user first. **Subagents unavailable → never self-verify:** mark
the candidate `UNPROVABLE`, withhold the promotion, and say so.

**Row format** is byte-identical to loop-distill's:
`<rule> · used:<n> last:<YYYY-MM-DD>` — so loop-distill audits loop and
non-loop learnings alike. Graph writes obey AGENTS.md (near-duplicate check,
no islands, `created_by` preserved on upsert, confidence 0.5–0.8 unverified).

**No PROJECT-LEARNINGS.md in this project?** Only create one if the project
already runs loops (loop-system seeds it at INIT). For a loop-less project,
project-scoped learnings go to the graph only — an empty ledger nobody
maintains is a false claim about the project.

## 2 · Register deliverables

Every artifact this task produced — deck, report, doc, explainer, page — becomes
a graph node:

```json
{"id": "<kebab-slug-of-the-deliverable>",
 "title": "<what a human would call it>",
 "type": "page",
 "tags": ["artifact", "<subject tags>"],
 "body": ">=40 words: what it is, who it's for, what it claims/decides, and what it embodies — with [[wiki-links]] to the concepts it rests on.",
 "urls": [{"label": "<repo-relative or ~ path>", "url": "file://<percent-encoded absolute path>", "kind": "file"}],
 "confidence": 0.9,
 "created_by": "manual"}
```

Edges to the concept nodes it embodies (`relates_to`; `implements` when it
realizes a design). Registered artifacts are what make past work retrievable
by `enrich` — an unregistered deck is a file nobody finds again. Re-issuing a
deliverable → upsert the same id (fetch full body first; upsert replaces
scalars).

## 3 · Sweep the inbox

`ls ~/second_brain/inbox/` — files present → tell the user and offer
`inbox-to-mindmap` (which ingests, archives to `raw/`, and stamps provenance).
Never ingest silently as a side effect of an unrelated task; the offer is the
gate.

## New ctx/ material

If this task produced a reusable prompt/template/rule worth keeping, write it
to `~/second_brain/ctx/<slug>.md` AND index it: a lightweight graph node
(`type=page`, tag `ctx`, url → the file) so RETRIEVE layer 5 can find it.
Unindexed ctx files are invisible to the cycle.
