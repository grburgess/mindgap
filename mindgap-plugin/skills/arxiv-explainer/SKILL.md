---
name: arxiv-explainer
description: Use when the user wants to turn an ML/CV/AI research paper (arXiv id/URL or a local PDF) into a richly animated, narrated HTML explainer — embedding figures from the paper, surfacing connected ideas from the mindgap knowledge graph, ingesting the paper into the graph, and self-improving across runs. Triggers on "explain this paper", "make an explainer for <arXiv link>", "turn this paper into slides/an HTML page", "walk me through <paper>", or a bare arXiv URL/PDF with intent to understand it deeply. Each explainer is built in its own folder in the working directory.
---

# arxiv-explainer

Turn a paper into an animated HTML explainer, link it into your mindgap graph, and learn from
each run. Maker/verifier loop per paper; durable lessons compound across runs.

**Self-contained:** the dark explainer theme and every figure recipe ship with this skill — no
external style or voice skills required.

## When to use
The user hands you an ML/CV/AI paper (arXiv id/URL or local PDF) and wants to understand or
present it. For pure capture without building an explainer, use the bundled `paper-to-mindmap`
skill instead.

## What it builds on (all in-repo)
- `references/template.html` — the self-contained dark HTML theme (`<style>` + scroll engine). Copy it; keep its `<style>` + `<script>` verbatim.
- `references/patterns.md` — figure/animation recipes + the chrome-devtools verify checklist (self-contained).
- the bundled `paper-to-mindmap` skill — the mindgap ingest protocol, reused verbatim in P3.

## Procedure
Follow `references/pipeline.md` phases **P0–P7** in order:
P0 preflight + read memory → P1 acquire & distill → P2 extract figures → P3 graph
(mindgap read + ingest) → P4 build explainer (maker) → P5 verify loop (independent verifier,
budget 3) → P6 capture user feedback → P7 learn (auto-tune memory).

Read at P0, every run: `LESSONS.md`, `references/rubric.md`, `references/patterns.md`.

## Voice
Clear, neutral, explanatory prose. Open a slide with a concrete fact or tension, not a generic
field statement; concede limitations explicitly; lead callouts with the problem, then the fix.
One takeaway per slide, one diagram per idea.

## Media toolkit (compose per figure; see references/patterns.md)
Animated SVG/CSS · annotated paper figures · generated video (manim / matplotlib→ffmpeg) ·
interactive JS widgets. Target ≥3 animated figures spanning ≥2 techniques (rubric §8).

## Degradation (never hard-fail on a missing OPTIONAL tool; see scripts/preflight.sh)
| Missing | Fallback |
|---|---|
| manim AND ffmpeg | drop generated video → SVG/CSS + widgets; warn in loop.md |
| pymupdf AND pdftoppm | no paper screenshots → SVG-only figures; warn |
| mindgap CLI AND MCP | skip ingest + read; note the blocker in graph.md (no silent fail) |
Cannot read the PDF at all → abort with a clear message.

## Output (in the invocation CWD)
`<arxiv-id>-<slug>/`: `index.html`, `paper.pdf`, `notes.md`, `graph.md`, `loop.md`,
`feedback.md`, `assets/figures/`, `assets/media/`.

## Self-modification boundary
Auto (no asking), when running from a writable checkout: append `LESSONS.md`; tune
`references/rubric.md`; grow `references/patterns.md` — the learning audit trail. **Gated on
user approval:** any edit to THIS `SKILL.md` procedure.
