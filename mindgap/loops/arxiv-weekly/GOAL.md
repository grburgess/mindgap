# Goal · {{NAME}}

Created 2026-06-16. All 7 sections below are required before the
loop may start (hard gate).

## 1 · Goal
Every pass, sweep the **past 7 days** of arXiv (`cs.CV`, `cs.LG`, `eess.IV`, `stat.ML`, `cs.AI`, `eess.SP`) for new research/methods relevant to {{TOPICS}}. Relevance is judged against the existing mindgap graph (via the `mindgap` CLI / MCP; protocol: `AGENTS.md`) and, if a Confluence/Jira MCP is configured, your team's docs (best-effort, optional). Each accepted paper enters the graph as a `paper` node — **always carrying the `{{NAME}}` tag** to differentiate the weekly harvest from other papers — with descriptive tags (`ideas` for surfaced opportunities, plus theme/method tags), a distilled body, the arXiv URL, and evidence-backed links to existing nodes. After accepting a paper, pull in its official code repo and/or a key directly-cited foundational paper. The loop **self-improves**: a persistent `STRATEGY.md` tracks which queries/themes yield accepts, and each pass after the first makes ≥1 concrete, justified change to the search+connection strategy derived from prior outcomes. Discovery quality > volume: documented rejects are as valuable as accepts.

## 2 · Done-criteria (grader-checkable)
Artifact set = `artifacts/session-N/`: `pre.json` (graph export before any ingest this pass), `harvest.md` (the sweep log), `payload*.json` (every ingested payload), `research/<paper-slug>.md` (one note per accepted paper), `strategy-delta.md` (this pass's change to `STRATEGY.md`, quoting before+after). `STRATEGY.md` lives at the loop root and is updated each pass.

| # | Criterion | How the verifier checks it |
|---|-----------|----------------------------|
| 1 | **Harvest documented & time-bounded:** `harvest.md` states the pass's explicit 7-day arXiv `submittedDate` window, quotes ≥6 distinct arXiv queries spanning ≥3 of the scope categories, and lists ≥15 candidate papers — each with arXiv id, accept/reject, and a 1-sentence rationale naming a theme from {{TOPICS}} (a reject's rationale says why it does NOT serve a goal in {{TOPICS}}) | read `harvest.md`; count window, queries, candidates; check each candidate has id + verdict + rationale |
| 2 | **Yield:** ≥5 papers accepted and ingested this pass as nodes type `paper`, each with a `urls` entry kind `arxiv` whose URL contains the matching arXiv id. **Escape (thin week):** <5 accepts passes C2 iff `harvest.md` documents ≥15 triaged candidates with reject rationales AND ≥6 distinct queries across ≥3 scope categories (quoted) — i.e. genuinely thin, not under-searched | grep payloads for node type + arxiv urls; if <5, verify the escape conditions hold in `harvest.md` |
| 3 | **Differentiator tag:** EVERY paper/repo node ingested this pass carries the `{{NAME}}` tag, AND ≥1 additional descriptive tag (`ideas`, a theme tag, or a method tag) | parse `tags` of every payload node (count, not eyeball) |
| 4 | **Body quality (paper-to-mindmap convention):** each ingested paper body LEADS with an `**Authors:** <full names>.` line (every author, full names as given — this line is the sole author record), then ≥40 words of prose stating (a) what the work is/does and (b) why it relates to your domain ({{TOPICS}}); author names NOT repeated in prose; arXiv id lives in `urls`, not prose | check the `**Authors:**` lead line; word-count the prose; read each body |
| 5 | **Connections w/ evidence:** each accepted paper links to ≥2 distinct pre-existing nodes — ids present in `pre.json`, not minted this pass — via `edges[]` or exact-id `[[wiki-links]]`; AND every such link is justified in that paper's `research/<slug>.md` by ≥1 sentence naming the Confluence page, your team's repo/file, or graph node backing the relation. **Escape:** if a note documents ≥3 distinct failed relation searches (`mindgap context`/`find` queries quoted + a Confluence or GitHub search), links to shared-method concept nodes count | cross-reference payload edges/bodies against `pre.json` ids; match each link to a justification sentence |
| 6 | **Companion artifacts:** for ≥3 accepted papers (or all, if <3 accepted), `research/<slug>.md` records a search for an official code repo and/or a directly-cited foundational paper; any found is ingested as a `repo`/`paper` node, tagged `{{NAME}}`, linked to its parent via `implements`/`cites`. **Escape:** a documented "no public code / no key associated paper found" search (query quoted) satisfies this for that paper | read research notes; grep payload for companion `repo`/`paper` nodes + their edges |
| 7 | **Provenance:** every node and edge ingested this pass has `created_by: "loop:{{NAME}}"` | inspect every payload node + edge (count) |
| 8 | **Graph hygiene:** 0 near-duplicates (no payload node whose normalized title — lowercase, strip punctuation — equals a `pre.json` node's title under a different id; no re-ingest of a paper already in `pre.json` matched by arXiv id) AND 0 orphans (every payload node reachable via ≥1 edge or wiki-link) | compare payload titles + arXiv ids vs `pre.json`; cross-check payload edges + bodies |
| 9 | **Self-learning delta:** `STRATEGY.md` updated this pass; `strategy-delta.md` quotes the prior strategy state and states ≥1 concrete, justified change derived from this/prior passes' accept-reject outcomes (drop a query with 0 accepts over ≥2 passes; add a query mined from an accepted paper's keywords/authors/category; reweight or retire a theme). **Pass-1 escape:** with no prior outcomes, C9 is satisfied by establishing the baseline `STRATEGY.md` (seed query set + theme list + the metrics it will track) | read `strategy-delta.md` + `STRATEGY.md` |

**Pass-complete (session-pass):** all 9 criteria hold for this pass's artifact set.
**Loop nature:** recurring, not converging — there is no terminal "loop-complete". Each weekly pass that meets the gate is a success; `STATE.md` accumulates strategy + per-pass metrics so each pass searches+connects better than the last.

## 3 · Verifier rubric
The verifier receives ONLY: the artifact set + sections 2–3 of this file.
Pass = all 9 criteria hold with cited evidence (counts; offending paper slugs / node ids for failures). Structural claims ("tag absent", "N candidates", "edges empty") must be backed by a parse/count, never eyeballed. C5: a wiki-link counts only if its target id exists in `pre.json` — dangling stubs minted this pass do not count; a justification must name a concrete source ("seems related" is a gap). C1: a blanket reject without a reason does not count toward the ≥15. C2/C5/C6: honor the documented escape arms exactly as written — an honest documented refutation satisfies the criterion (do not force fabrication). Any single violation → that criterion fails; list every offending paper slug, not just the first.
**Verification split (large artifact set — see loop-system lessons 2026-06-15):** the orchestrator runs the mechanical criteria (C1 counts, C3 tags, C7 provenance, C8 dedup/orphans) deterministically in-band via `python3`/`sqlite3` and shows the parse; an independent subagent verifier judges ONLY the semantic criteria (C2 relevance of accepts, C4 body quality, C5 connection+evidence, C6 companions, C9 strategy delta).

## 4 · Budgets
- Max iterations per session: 5
- Max sessions before forced escalation: 8   <!-- ≈2 months of weekly passes → mandatory strategy review with the user (is the loop still finding value? retire/add themes?). NOT a failure trigger. -->

## 5 · Escalation rule
Write blocker to STATE.md Open failures; end the pass with a summary and a concrete question for the user. **Hard escalations (never fabricate paper content):** arXiv API unreachable, or Atlassian-MCP / `gh` auth failure that blocks relevance grounding. **Maker tooling:** discovery makers use the arXiv export API via `curl`/WebFetch as the PRIMARY path (`https://export.arxiv.org/api/query?search_query=...&start=0&max_results=N`); WebSearch is a fallback only (it has errored inside subagents in prior loops — see loop-patterns.md).

## 6 · Model routing
Ceiling (auto-detected at INIT, not asked): opus
Alias ladder: haiku < sonnet < opus < fable
Classifier-block sibling: none — ceiling is opus, not fable

Router — orchestrator tags each work item (difficulty + task class):
| Tag    | Tier |
|--------|------|
| hard   | ceiling (omit model → inherit session model) |
| normal | one tier below ceiling (clamp at haiku) |
| bulk   | cheapest fast tier (haiku; sonnet if the class needs it) |
| check  | cheapest-that-can-judge (haiku); ceiling for hard rubrics |

Seeded task classes:
- `arxiv-harvest` → bulk (mechanical API fetch + parse of the 7-day window)
- `relevance-triage` → normal (theme-match filter over candidate abstracts)
- `paper-distill` → hard (distill body: what it is + why relevant to {{TOPICS}} — quality-bearing)
- `connection-research` → hard (find + justify ≥2 evidence-backed links — quality-bearing)
- `companion-hunt` → normal (locate official repo / key cited paper)
- `strategy-update` → hard (reason over accept-reject history → justified delta)
- `graph-hygiene-check` → check (mechanical dedup/orphan parse — run in-band by orchestrator)
- `verify-semantic` → check at ceiling (opus — the rubric needs domain judgment)

Learned promotions override the table above — see STATE.md § Routing overrides.

## 7 · Engine
**workflow** (Dynamic Workflow) — ≥3 papers are harvested, distilled, connected and verified independently, the project is a git repo, and the user opted into ultracode/multi-agent. Shape 3 (loop-until-dry) for the harvest+triage fan-out; Shape 2 (per-item make→verify) for distill+connect+companion.
Isolation: **none / no worktrees** — makers write only to `artifacts/session-N/` (payload JSON + research notes), never to source. The shared SQLite DB is single-writer, so makers NEVER call `mindgap_ingest` concurrently; they emit payload files and the **orchestrator ingests serially** after the workflow returns and the artifact-existence check passes.
