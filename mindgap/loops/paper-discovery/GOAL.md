# Goal · {{NAME}}

Created 2026-06-12. All 7 sections below are required before the
loop may start (hard gate).

## 1 · Goal
Discover additional papers (arXiv or elsewhere) relevant to {{TOPICS}} as evidenced in the mindgap graph (via the `mindgap` CLI / MCP; protocol: `AGENTS.md`) and, if a Confluence/Jira MCP is configured, your team's docs (best-effort, optional) — and ingest them in batches ("steps"), each linked with evidence to existing graph nodes. Relevance filter is mandatory: a paper enters the graph only when its research note ties it to a concrete goal (an existing graph node, or optionally a Confluence page or repo). Discovery quality > volume: documented rejects are as valuable as accepts.

## 2 · Done-criteria (grader-checkable)
Artifact set = `artifacts/session-N/`: `pre.json` (graph export before any ingest this session), `discovery.md` (the sweep log), `payload*.json` (every ingested payload), `research/<paper-slug>.md` (one note per ingested paper).

| # | Criterion | How the verifier checks it |
|---|-----------|----------------------------|
| 1 | Discovery sweep documented: `discovery.md` quotes ≥5 distinct search queries (arXiv/web/Semantic Scholar/etc.) and lists ≥8 candidate papers, each with accept/reject + 1-sentence rationale naming a theme from {{TOPICS}} | read `discovery.md`, count queries and candidates |
| 2 | ≥4 accepted papers ingested this session as nodes type `paper`, each with a `urls` entry kind `arxiv` (or `web` if non-arXiv) whose URL identifies that paper | grep payloads for node type + urls |
| 3 | Each ingested body ≥40 words and states (a) what the work is/does and (b) why it relates to your domain ({{TOPICS}}) | word-count + read each body |
| 4 | Each ingested paper links to ≥2 distinct pre-existing nodes — ids present in `pre.json`, not minted this session — via `edges[]` or exact-id `[[wiki-links]]` in its body | cross-reference payload edges/bodies against `pre.json` ids |
| 5 | Every link counted in C4 is justified in that paper's `research/<slug>.md`: ≥1 sentence naming the Confluence page, your team's repo/file, or graph evidence backing the relation | match each C4 link to a justification sentence |
| 6 | Every node and edge has `created_by: "loop:{{NAME}}"` | inspect payloads |
| 7 | 0 near-duplicates: no payload node whose normalized title (lowercase, strip punctuation) equals a `pre.json` node's title under a different id; no re-ingest of a paper already in `pre.json` (match by arXiv id in urls) | compare payload titles + arXiv ids vs `pre.json` |
| 8 | 0 orphans: every payload node reachable via ≥1 edge or wiki-link | cross-check payload edges + bodies |

**Session-pass:** all 8 criteria hold for this session's artifact set.
**Loop-complete:** cumulative ≥12 papers ingested across sessions each under a session-pass, OR a session's `discovery.md` documents saturation — ≥6 distinct queries across ≥2 sources (queries quoted) yielding no new relevant un-ingested paper.

## 3 · Verifier rubric
The verifier receives ONLY: the artifact set + sections 2–3 of this file.
Pass = all 8 criteria hold with cited evidence (counts, offending node ids / paper slugs for failures). C4: a wiki-link counts only if its target id exists in `pre.json` — dangling stubs minted this session do not count. C4 fallback: if a research note documents ≥3 distinct failed searches for domain relations (`mindgap context`/`find` queries plus a Confluence or GitHub search, queries quoted in the note), links to shared-method concept nodes count. C5: a justification must name a concrete source (page title/URL, repo, or file) — "seems related" is a gap. C1: a rejected candidate's rationale must say why it does NOT serve a goal in {{TOPICS}}; blanket rejects without reasons don't count toward the 8. Any single violation → that criterion fails; list every offending paper slug, not just the first.

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
| Verifier | sonnet — rubric needs semantic judgment (relevance, justification quality) |
| Classifier-block fallback | opus |

## 7 · Engine
subagent-loop — batches are NOT independent: all makers write the same live SQLite DB and later papers cross-link to earlier ones; sequential refinement beats fan-out.
Isolation: none — `data/` is gitignored (absent in worktrees, which would break `mindgap ingest`); sequential makers only.
