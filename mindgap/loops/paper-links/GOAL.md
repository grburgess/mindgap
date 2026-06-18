# Goal · {{NAME}}

Created 2026-06-12. All 7 sections below are required before the
loop may start (hard gate).

## 1 · Goal
Ingest a curated list of external sources relevant to {{TOPICS}} into the mindgap graph (via the `mindgap` CLI / MCP; protocol: `AGENTS.md`) and, if a Confluence/Jira MCP is configured, use your team's docs (best-effort, optional) to research each source's relation to existing ideas already in the graph — to form links (edges / wiki-links) connecting them. Replace the numbered list below with your own sources (arXiv ids, GitHub repos, web URLs):

1. <arXiv id or URL>
2. <arXiv id or URL>
3. <github.com/org/repo>
4. <arXiv id or URL>
5. <arXiv id or URL>
6. <arXiv id or URL>
7. <arXiv id or URL>

Each source becomes a node (`paper` for arXiv, `repo` for GitHub) with a distilled body, a source URL, and researched links into the existing graph. Link quality > link count: every formed link must be backed by evidence (the graph node, repo, or page it relates to).

## 2 · Done-criteria (grader-checkable)
Artifact set = `artifacts/session-N/`: `pre.json` (graph export taken before any ingest this session), `payload*.json` (every ingested payload), `research/<source-slug>.md` (one research note per source).

| # | Criterion | How the verifier checks it |
|---|-----------|----------------------------|
| 1 | All sources ingested: each arXiv id from §1 has a node type `paper` carrying a `urls` entry kind `arxiv` whose URL contains the matching arXiv id; each GitHub repo from §1 has a node type `repo` with a `urls` entry kind `github` containing the matching org/repo path | grep each id/URL across session payloads |
| 2 | Each source node body ≥40 words and states (a) what the work is/does and (b) why it relates to this graph's domain | word-count + read each body |
| 3 | Each source node links to ≥2 distinct pre-existing nodes — ids present in `pre.json`, not minted this session — via `edges[]` entries or exact-id `[[wiki-links]]` in its body | cross-reference payload edges/bodies against `pre.json` ids |
| 4 | Every link counted in C3 is justified in that source's `research/<slug>.md`: ≥1 sentence naming the Confluence page, your team's repo/file, or graph evidence backing the relation | match each C3 link to a justification sentence |
| 5 | Every node and edge has `created_by: "loop:{{NAME}}"` | inspect payloads |
| 6 | 0 near-duplicates: no payload node whose normalized title (lowercase, strip punctuation) equals a `pre.json` node's title under a different id | compare payload vs `pre.json` |
| 7 | 0 orphans: every payload node reachable via ≥1 edge or wiki-link | cross-check payload edges + bodies |

**Loop-complete:** all 7 criteria pass covering all 7 sources in one session's artifact set (cumulative across payloads).

## 3 · Verifier rubric
The verifier receives ONLY: the artifact set + sections 2–3 of this file.
Pass = all 7 criteria hold with cited evidence (counts, offending node ids / source slugs for failures). C3: a wiki-link counts only if its target id exists in `pre.json` — dangling stubs minted this session do not count. C3 fallback: if a research note documents ≥3 distinct failed searches for domain relations (`mindgap context`/`find` queries plus a Confluence or GitHub search, queries quoted in the note), links to shared-method concept nodes (e.g. self-supervised learning) count. C4: a justification must name a concrete source (page title/URL, repo, or file) — "seems related" is a gap. Any single violation → that criterion fails; list every offending source, not just the first.

## 4 · Budgets
- Max iterations per session: 5
- Max sessions before forced escalation: 3

## 5 · Escalation rule
Write blocker to STATE.md Open failures; end session with summary and a concrete question for the user.

## 6 · Model routing
| Role | Model |
|------|-------|
| Maker (hard work) | session model (fable) |
| Bulk workers | sonnet |
| Verifier | sonnet — rubric needs semantic judgment (link plausibility, body substance) |
| Classifier-block fallback | opus |

## 7 · Engine
subagent-loop — 7 items but NOT independent: all makers write the same live SQLite DB and later papers cross-link to earlier ones, so sequential refinement beats fan-out.
Isolation: none — `data/` is gitignored (absent in worktrees, which would break `mindgap ingest`); sequential makers only.
