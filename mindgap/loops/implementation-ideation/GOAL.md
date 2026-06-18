# Goal · {{NAME}}

Created 2026-06-18. All 7 sections below are required before the
loop may start (hard gate).

## 1 · Goal
Mine the **growing connections** in the mindgap graph around {{TOPICS}} (via the `mindgap` CLI / MCP; protocol: `AGENTS.md`) for concrete, buildable **implementation ideas** — then adversarially **refute** the ones that are not feasible, so only vetted ideas enter the graph. Each idea is born from a *named connection* between ≥2 existing nodes (e.g. a paper's method + an available dataset + a repo that implements a building block), proposed as an implementation sketch, and attacked by an independent refuter on concrete feasibility grounds. Survivors become `idea` nodes linked to the work they build on; refuted candidates are recorded with the blocking reason. Documented refutations are as valuable as accepted ideas — the loop's product is a *defensible* shortlist, not a brainstorm dump.

## 2 · Done-criteria (grader-checkable)
Artifact set = `artifacts/session-N/`: `pre.json` (graph export before any ingest this session), `ideas.md` (the candidate log: every idea, its source connection, verdict, and one-line reason), `payload*.json` (ingested payloads), `research/<idea-slug>.md` (one feasibility dossier per FEASIBLE idea).

| # | Criterion | How the verifier checks it |
|---|-----------|----------------------------|
| 1 | ≥6 candidate implementation ideas in `ideas.md`, each naming the **connection** it exploits: ≥2 distinct pre-existing node ids (present in `pre.json`) it builds on + the relation between them | read `ideas.md`; resolve each cited id against `pre.json` |
| 2 | Each candidate has an **independent adversarial refutation** (written by a different agent than the proposer) attacking feasibility on ≥3 concrete axes — data availability, compute/scale, method maturity, dependency/tooling, evidence of prior success or failure — written to REFUTE by default, not to sell | read each refutation; a one-line "seems doable" is a gap |
| 3 | A binary verdict per candidate — `FEASIBLE` or `REFUTED` — and every `REFUTED` names the specific blocking axis + evidence (a missing dataset, an unproven assumption, a 404'd dependency, a cited failed attempt) | inspect verdicts; a REFUTED with no concrete blocker fails this criterion |
| 4 | ≥3 ideas reach `FEASIBLE` and are ingested as nodes type `idea` (tags include `ideas` + `{{NAME}}`), each linked via `edges[]` or exact-id `[[wiki-links]]` to ≥2 distinct pre-existing nodes from its source connection (ids in `pre.json`, not minted this session) | grep payloads for type/tags; cross-reference links vs `pre.json` |
| 5 | Each FEASIBLE idea body ≥50 words giving (a) the implementation sketch — what to build, the key components — and (b) the **first concrete experiment / MVP** that would validate it cheaply | word-count + read each body |
| 6 | Each FEASIBLE idea's `research/<slug>.md` records the surviving feasibility argument: why each refutation axis from C2 is cleared, citing a concrete enabler (the dataset, the repo, the prior result) | match each idea to its dossier; unbacked "it's fine" is a gap |
| 7 | Every node and edge has `created_by: "loop:{{NAME}}"`; 0 orphans (every ingested idea reachable via ≥1 edge/wiki-link); 0 near-duplicate ideas (normalized title not equal to a `pre.json` node under a new id) | inspect payloads + compare vs `pre.json` |

**Session-pass:** all 7 criteria hold for this session's artifact set.
**Loop-complete:** cumulative ≥8 `FEASIBLE` ideas ingested across sessions each under a session-pass, OR a session's `ideas.md` documents idea-saturation — ≥6 fresh candidates proposed and ALL refuted with concrete blockers (the connections are mapped but not yet ripe).

## 3 · Verifier rubric
The verifier receives ONLY: the artifact set + sections 2–3 of this file. It is also the **refutation auditor**: for a sample of ≥2 `FEASIBLE` verdicts it re-runs the adversarial lens and flags any idea whose refutation was a straw-man (soft axis, no real attack) — an idea passed by a weak refutation fails C2. Pass = all 7 criteria hold with cited evidence (idea slugs for failures). C1: a "connection" needs ≥2 real `pre.json` ids AND a stated relation, not a single seed node. C4: a wiki-link counts only if its target id exists in `pre.json`. Default to skepticism: a plausible-but-unbacked feasibility argument fails its criterion. List every offending idea slug, not just the first.

## 4 · Budgets
- Max iterations per session: 5
- Max sessions before forced escalation: 3

## 5 · Escalation rule
Write blocker to STATE.md Open failures; end session with a summary and a concrete question for the user (e.g. which refuted idea to override, or a missing capability that blocks a whole class of ideas).

## 6 · Model routing
| Role | Model |
|------|-------|
| Maker / proposer (hard work) | session model (fable) |
| Bulk workers | sonnet |
| Refuter + verifier | sonnet — needs adversarial, skeptical judgment; escalate a contested verdict to opus |
| Classifier-block fallback | opus |

## 7 · Engine
subagent-loop — the proposer and the refuter are SEPARATE agents (the proposer must not grade its own ideas); ideas cross-reference earlier ones, so makers write the same live SQLite DB sequentially.
Isolation: none — `data/` is gitignored (absent in worktrees, which would break `mindgap ingest`); sequential makers only.
