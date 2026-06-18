# arxiv-explainer pipeline (P0–P7)

Run top to bottom. The main agent is the MAKER. Spawn a fresh independent VERIFIER subagent
for each P5 iteration. Output folder = `<arxiv-id>-<slug>/` in the invocation CWD
(local PDF with no id → `local-<slug>`).

## P0 — Preflight
- `bash <skill>/scripts/preflight.sh` → note which tools are `ok`/`missing`.
- Read `<skill>/LESSONS.md`, `references/rubric.md`, `references/patterns.md` in full — these
  prime every later decision.
- Apply the degradation table (SKILL.md §Degradation) to any `missing` tool. A missing
  optional tool degrades the run; inability to read the PDF at all aborts with a clear note.

## P1 — Acquire & distill
- Input: arXiv id/URL OR local PDF path.
- arXiv: fetch the abstract page and the PDF (`https://arxiv.org/pdf/<id>`); save `paper.pdf`.
- Extract title, FULL author list, abstract, section headings, and the paper's stated
  contributions/key claims. Write `notes.md` (lead with `**Authors:** …` line, then the
  distilled contributions + section map). `notes.md` is the verifier's faithfulness oracle.

## P2 — Figures
- `extract_figures.py render paper.pdf assets/figures --dpi 150` → page PNGs.
- View the page PNGs (Read the images); pick figure regions; `extract_figures.py crop` each.
- Also try `extract_figures.py images paper.pdf assets/figures` for embedded raster figures.
- Keep only figures that will be embedded or annotated.

## P3 — Graph
- mindgap READ: `mindgap context "<topic>"` and `mindgap find "<salient term>"` (single terms
  are most reliable). Collect related nodes with the reason each connects.
- Write `graph.md`: each connection = a real mindgap node id/URL + one-line evidence. No
  fabricated links.
- mindgap INGEST: follow the bundled `paper-to-mindmap` skill protocol verbatim (relevance gate
  → dedup → one `paper` node with a `**Authors:**` body line → ≥1 evidence-backed edge to a
  PRE-EXISTING node → ingest via the mindgap MCP or CLI; `created_by: skill:arxiv-explainer`).

## P4 — Build (maker)
- Copy `<skill>/references/template.html` → `index.html`. Keep its `<style>` + `<script>`
  verbatim (the theme). Swap `<title>`; replace the example slides.
- Write the prose in the skill's voice (SKILL.md §Voice): open with a fact/tension, concede
  limits, lead callouts problem-then-fix. Number slides `00`,`01`,…; add `reveal` classes.
- Compose figures per `patterns.md` + lessons, spanning ≥2 of the four techniques
  (rubric check 8). Embed extracted figures from `assets/figures/`; put generated video in
  `assets/media/`.
- Add a **"Connected ideas"** section built from `graph.md` (links to the related mindgap nodes).

## P5 — Verify loop (budget: 3 iterations)
- Render `index.html` in chrome-devtools; `list_console_messages` (must be zero errors);
  `take_screenshot` each slide; for animated figures, pin states via `evaluate_script` and
  screenshot both states.
- **Verify tooling note:** chrome-devtools MCP can hold a stale profile lock ("browser already
  running"); Playwright blocks `file://`. Reliable fallback — `python3 -m http.server <port>`
  in the paper folder, then drive Playwright over `http://localhost:<port>/index.html`
  (`browser_navigate` → `browser_console_messages` → scroll each `.slide` into view +
  `browser_take_screenshot`). Stop the server when done. Note the http favicon 404 trips the
  zero-error gate → the template must declare `<link rel="icon" href="data:,">`.
- Spawn an independent VERIFIER subagent with ONLY: the screenshots, the console log,
  `notes.md`, and `rubric.md`. It returns the verdict JSON (rubric schema).
- ORCHESTRATOR (not the verifier) mechanically resolves every `graph.md` link and every
  `assets/` path referenced in `index.html` against ground truth before accepting PASS.
- Append one line per verdict to `loop.md` immediately. FAIL → feed gaps to the maker and
  iterate. PASS or budget hit → continue.

## P6 — Feedback
- Open `index.html` in the browser. Ask the user for their reaction (what landed, what to
  emphasize or change). Capture verbatim to `feedback.md`. If the user is absent, note
  "no feedback this run" and proceed.

## P7 — Learn (SESSION END — never skip)
- Append to `<skill>/LESSONS.md`: wins + gaps, with USER FEEDBACK WEIGHTED ABOVE verifier
  findings. Date each entry; name the paper folder.
- Auto-tune `rubric.md` when a gap `check` has recurred ≥2× across papers (add a dated
  sub-check; never delete seeds).
- Auto-grow `patterns.md` with any figure recipe that passed (dated, cite the folder).
- These auto-edits are the learning audit trail; they are committed as part of the mindgap repo
  (no separate skill git). Run only from a writable checkout.
- Meta-lessons or SKILL.md PROCEDURE changes → PROPOSE to the user; apply only on approval.
