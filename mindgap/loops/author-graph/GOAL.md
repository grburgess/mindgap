# Goal · {{NAME}}

Created 2026-06-18. All 7 sections below are required before the
loop may start (hard gate).

## 1 · Goal
Build a graph of the **people** doing work relevant to {{TOPICS}} — as evidenced by the papers and repos already in the mindgap graph (via the `mindgap` CLI / MCP; protocol: `AGENTS.md`) plus light discovery — and connect them to what they work on and to each other. Each relevant author becomes a `person` node carrying their **resolved** links (GitHub profile, personal/lab homepage, Google Scholar), linked to the paper(s)/method(s) of theirs already in the graph and to co-authors. A URL is recorded only when a concrete source (the paper's author block, a repo's owner page, a quoted search hit) shows it — never a guessed handle. The result is a navigable "who's who" of the field, grounded in the existing graph.

## 2 · Done-criteria (grader-checkable)
Artifact set = `artifacts/session-N/`: `pre.json` (graph export before any ingest this session), `authors.md` (the roster: each author, their source paper(s)/repo(s), and the source each URL was read from), `payload*.json` (ingested payloads), `research/<author-slug>.md` (one note per ingested author).

| # | Criterion | How the verifier checks it |
|---|-----------|----------------------------|
| 1 | ≥6 authors ingested as nodes type `person` (tags include `{{NAME}}`), each tied to ≥1 paper/repo node that exists in `pre.json` or is ingested this session — the relevance evidence | grep payloads for type/tags; resolve each author's source node |
| 2 | Each author body ≥30 words: who they are, the relevant line of work ({{TOPICS}}), and affiliation/lab if known | word-count + read each body |
| 3 | Each author carries ≥1 **resolved** `urls` entry — a GitHub profile (kind `github`) and/or a homepage or Scholar page (kind `web`) — and `authors.md` names the source each URL was read from. No constructed or guessed handles | inspect `urls`; match each to a cited source in `authors.md` |
| 4 | Each author links via `edges[]` (rel `relates_to`) or exact-id `[[wiki-links]]` to ≥2 distinct pre-existing nodes — the paper(s)/concept(s) of theirs in the graph (ids in `pre.json`, not minted this session) | cross-reference payload edges/bodies vs `pre.json` |
| 5 | ≥3 author↔author links (co-authorship of a graph paper, or a shared method/topic), each a `relates_to` edge justified in a `research/` note naming the shared paper or method | count person↔person edges; match each to a justification |
| 6 | Every node and edge has `created_by: "loop:{{NAME}}"` | inspect payloads |
| 7 | 0 near-duplicate people (same person under two ids — match on normalized name); 0 orphans (every author reachable via ≥1 edge/wiki-link); 0 fabricated URLs (every `urls` entry traces to a cited source per C3) | compare payloads vs `pre.json`; audit each URL's source |

**Session-pass:** all 7 criteria hold for this session's artifact set.
**Loop-complete:** cumulative ≥12 authors across sessions each under a session-pass, OR a session's `authors.md` documents roster-saturation — the in-graph {{TOPICS}} papers yield no new relevant un-ingested author (the contributing authors of every such paper are covered).

## 3 · Verifier rubric
The verifier receives ONLY: the artifact set + sections 2–3 of this file. The hardest check is C3/C7 (URL provenance): for a sample of ≥3 URLs, confirm `authors.md` cites a concrete source for each; a plausible-looking `github.com/<name>` with no cited source is a fabrication and fails C3 — a wrong profile link is worse than no link. C4: a wiki-link counts only if its target id exists in `pre.json`. C4 fallback: if a note documents ≥3 failed searches for an author's graph relations (queries quoted), a link to a shared-topic concept node counts. C1: "relevance" needs a named source node, not "works in the area". List every offending author slug, not just the first.

## 4 · Budgets
- Max iterations per session: 5
- Max sessions before forced escalation: 3

## 5 · Escalation rule
Write blocker to STATE.md Open failures; end session with a summary and a concrete question for the user (e.g. an author whose identity is ambiguous across namesakes).

## 6 · Model routing
| Role | Model |
|------|-------|
| Maker (hard work) | session model (fable) |
| Bulk workers | sonnet |
| Verifier | sonnet — needs judgment on URL provenance + name disambiguation |
| Classifier-block fallback | opus |

## 7 · Engine
subagent-loop — authors cross-link to each other and to shared papers, so makers write the same live SQLite DB sequentially (later authors reference earlier ones).
Isolation: none — `data/` is gitignored (absent in worktrees, which would break `mindgap ingest`); sequential makers only.
