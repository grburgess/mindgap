# arxiv-explainer figure & animation patterns (auto-grown)

Extends `explainer-slides/references/patterns.md` (read that first for the inline-SVG
generator recipe, the chrome-devtools verify checklist, and figure-color guidance). This
file adds paper-explainer–specific recipes. Each recipe: when to use, technique, skeleton.

## Technique selection (which of the four)
- **Animated SVG/CSS** — default for architecture/data-flow diagrams, equations built up
  term-by-term, schematic pipelines. Theme-aware via `var(--green/--purple/--warn)`.
- **Annotated paper figure** — when the paper's own figure IS the clearest artifact. Render
  the page (`extract_figures.py render`), crop the figure (`crop`), then overlay callouts /
  Ken-Burns zoom / progressive reveal in HTML/CSS over the `<img>`.
- **Generated video** — only for genuinely dynamic phenomena SVG can't hold: sampling
  trajectories, attention over time, training curves evolving. manim (math) or
  matplotlib.animation→ffmpeg (data). Embed as `<video muted loop playsinline>`.
- **Interactive widget** — when reader exploration teaches more than a fixed view: a slider
  over a hyperparameter, hover-to-inspect. Pure JS; recompute + redraw inline.

## Recipe: equation build-up (Animated SVG/CSS)
Reveal an equation one term at a time, each term tinted to the diagram element it maps to.
Skeleton: `<span class="reveal" style="--d:Nms">` per term; map color to the figure legend.

## Recipe: annotated paper figure with callouts (Annotated paper figure)
`<figure class="paper-fig">` → `<img src="assets/figures/figN.png">` + absolutely-positioned
`.callout` spans revealed on scroll, each pointing (CSS leader line) at a region the narration
names. Always include alt text from the paper caption.

## Recipe: process steps as a drawn sequence (Animated SVG/CSS)
For an N-step method (e.g. diffusion denoising), draw each step's SVG layer and crossfade /
draw-on in sequence with `@keyframes`; reduced-motion pins to the final composited state.

## Default: motion + hover richness (2026-06-16, user feedback)
Reveal-on-enter is the FLOOR, not the ceiling. Every figure-heavy slide should also carry
either continuous motion or reader interaction, and the deck should be hover-rich:
- ≥4 glossary `ref()` popovers on technical terms (graceful: keep the word inside the
  placeholder span so it survives if JS is off).
- Hover responses on non-text: diagram-stage highlight, data-mark value tooltips (`<title>`),
  hover-lift on panels/pills/pins.
- Always `prefers-reduced-motion`-gate continuous motion (JS-gate SMIL/JS-injected motion via
  `matchMedia('(prefers-reduced-motion: reduce)')`; CSS keyframes are covered by the theme's
  reduce block).
- ALWAYS add `<link rel="icon" href="data:,">` (a favicon 404 trips the zero-console-error gate).

## Growth log
SESSION-END appends new recipes here that passed verification (dated, one per block). Cite
the paper folder that produced the recipe.

### 2026-06-16 · 2606.10775-sst-cd
- **Interactive sensitivity slider (Interactive widget).** Map a paper's own
  ablation/sensitivity TABLE to a `<input type=range>` over its discrete settings; on input,
  update value readouts + proportional bars and a contextual note that fires at the notable
  rows (best/worst). Highest signal-per-effort figure of the run — the reader discovers the
  paper's point. Scale bar fills across a tight [min,max] so small deltas are visible.
- **Numbered-pin annotated paper figure (Annotated paper figure).** `figure.paper-fig` with an
  `<img>` + absolutely-% -positioned `.pin` badges (1,2,3… recoloured green/violet/warn) that
  fade in when the figure's `.paper-fig` gets `.in` on slide enter, paired with a matching
  numbered legend list beside it. Forgiving of exact pin placement.
- **Mechanism crossfade + sweep (Animated SVG/CSS).** Redraw the paper's core mechanism as a
  JS-built pixel grid with two `<g>` layers (noisy state A ⇄ selected state B) crossfaded on a
  CSS keyframe, PLUS a JS-injected sweeping scan `<rect>` (SMIL `x` animation) for continuous
  motion. Reduced-motion pins to state B and drops the scan.
- **Signal-pulse pipeline (Animated SVG/CSS).** A `.flow-svg` of boxes + draw-on arrows, then
  JS-inject 2 glowing `<circle>` "signal" dots animating `cx` across the pipeline (SMIL,
  staggered `begin`, reduced-motion-gated) + a CSS `rect:hover` brighten. Reads as data flowing
  through the stages.
- **Staggered hover-tooltip bar chart (Animated SVG/CSS).** SVG bars with
  `transform:scaleY(0)→1` on slide enter, `transition-delay` per bar for a staggered build, a
  `<title>` per bar (exact value + Δ vs previous step), and a `:hover` brighten.
