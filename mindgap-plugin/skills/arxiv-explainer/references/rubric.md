# arxiv-explainer rubric (auto-tuned)

The verifier is an independent subagent. It receives ONLY: the rendered explainer
(screenshots of every slide + the console log), the paper's `notes.md`, and this file.
It never sees the maker's reasoning or the chat. It returns:

`{ "verdict": "PASS" | "FAIL", "gaps": [ { "check": "<id>", "detail": "<what/where>" } ] }`

PASS requires ALL checks below to hold.

## Checks
1. **renders-clean** — chrome-devtools `list_console_messages` returns zero errors.
2. **faithful** — every contribution listed in `notes.md` appears in the explainer; no
   statement contradicts the paper.
3. **coverage** — the paper's central method/result is explained in words AND in ≥1 figure.
4. **figures-legible** — figure text is readable at slide scale; the gold `--warn` accent is
   used for at most one highlighted element per figure.
5. **motion-meaningful** — each animation conveys a step or relationship (not decoration) and
   has a `prefers-reduced-motion` fallback pinned to a legible final state.
6. **graph-grounded** — every "Connected ideas" link points at a real mindgap node (resolved by
   id/URL). The orchestrator resolves these mechanically before accepting PASS; the verifier
   flags any that look fabricated.
7. **voice** — clear explanatory prose: opens with a fact/tension, concedes limits, leads
   callouts with the problem then the fix. No marketing tone; no unsupported superlatives.
8. **toolkit-breadth** — ≥3 animated figures spanning ≥2 of the four techniques
   (animated SVG/CSS · annotated paper figure · generated video · interactive widget).

## Auto-tuning
When a SESSION-END distill sees the same gap `check` recur across ≥2 papers, append a
sharper sub-check here (dated). Never delete a seed check. Record the edit in LESSONS.md.
Direct user feedback outranks the ≥2× heuristic — promote it on first occurrence.

### Sub-checks (dated)
- **5a · continuous/interactive motion** (2026-06-16, user feedback) — at least one
  figure-heavy slide carries motion BEYOND on-enter reveal: a continuous loop (flowing pulse,
  sweeping scan) or reader-driven interaction. On-enter-only decks are too static.
- **5b · render-clean includes favicon** (2026-06-16) — a `favicon.ico` 404 trips check 1 when
  served over http; the page must declare `<link rel="icon" href="data:,">`.
- **8a · hover affordances** (2026-06-16, user feedback) — beyond animation breadth, the deck
  must offer hover interactivity on more than plain text: ≥4 glossary `ref()` popovers AND
  hover responses on figures / diagram parts / data marks (highlight or value tooltip).
- **6a · links from ground truth** (2026-06-16) — every external URL must come from a resolved
  source (a mindgap node's `urls`, or the paper's own references). Reconstructed arXiv ids are a
  faithfulness failure even when the link happens to resolve.
