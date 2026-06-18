# arxiv-explainer figure & animation patterns (self-contained, auto-grown)

Read alongside `references/template.html` (the theme defines the `--green/--purple/--warn/--ink/
--muted` tokens, the `.slide` scroll engine that fires an `enter` CustomEvent, the `.reveal`
classes, and the `ref()` glossary popover). Each recipe below: when to use, technique, skeleton.

## Technique selection (the four)
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

## 1. Inline SVG over base64 raster (always)
Build figures as inline `<svg>`, not embedded PNGs. Reasons: ~10× smaller, infinitely scalable,
diffable in git, and it inherits the theme through `var(--green)`, `var(--purple)`,
`var(--warn)`, `var(--ink)`, `var(--muted)`. A static base64 PNG can't recolor with the theme
and bloats the file. (Real swap: a 150 KB base64 matplotlib panel → a 51 KB animated inline SVG
carrying the same data.)

## 2. Data-driven figure = generator script → inject
When a figure must reflect REAL data (not a toy mock), don't hand-place coordinates. Write a
small Python generator:
1. Load the real data (parquet, geometry, metrics …).
2. Normalize to an SVG `viewBox` (compute the bbox, scale to e.g. 0..W; flip y for screen coords).
3. Emit SVG layers as strings — fills/strokes use `var(--…)` so they track the theme.
4. Inject into the page by replacing a placeholder (a regex over an `<img …>` or a marker comment), then write the file back.
5. Print a one-line summary (counts, viewBox) so the result is auditable.
Keep the generator alongside the doc; reference it in a comment near the injected SVG.

## 3. Animated figures (CSS keyframes + reduced-motion)
For "state A ⇄ state B" reveals (raw → merged, before → after), draw both layers in one `<svg>`
and crossfade with CSS `@keyframes` on `opacity`, scoped to the svg's class so it can't leak:
```css
.fig .layerA { animation: figA 7s ease-in-out infinite; }
.fig .layerB { animation: figB 7s ease-in-out infinite; }
@keyframes figA { 0%,40%{opacity:1} 50%,92%{opacity:0} 100%{opacity:1} }
@keyframes figB { 0%,40%{opacity:0} 50%,92%{opacity:1} 100%{opacity:0} }
@media (prefers-reduced-motion:reduce){
  .fig .layerA{opacity:0;animation:none} .fig .layerB{opacity:1;animation:none}
}
```
Rules: scope keyframes/classes to the figure; persistent context (axes, frame) sits in a
non-animated layer behind both states; the reduced-motion fallback pins to the MORE INFORMATIVE
state (usually B / "after").

## 4. Flow diagrams (`.flow-svg`)
A pipeline = themed boxes + arrows that draw on when the slide enters:
```html
<svg class="flow-svg reveal" viewBox="0 0 1180 150" role="img" aria-label="A to B to C">
  <defs><marker id="ah" markerWidth="9" markerHeight="9" refX="7" refY="4.5" orient="auto">
    <path d="M0,0 L9,4.5 L0,9 z" fill="var(--green)"/></marker></defs>
  <g font-family="Spline Sans Mono" font-size="13" fill="var(--ink)" text-anchor="middle">
    <rect x="40" y="50" width="220" height="64" rx="12" fill="var(--panel)" stroke="var(--green-deep)"/>
    <text x="150" y="78">stage</text><text x="150" y="96" fill="var(--muted)" font-size="11">note</text>
    <!-- violet box: fill var(--panel-violet) stroke var(--purple-deep) -->
  </g>
  <path class="draw" d="M260,82 L480,82" stroke="var(--green)" stroke-width="2.5" fill="none" marker-end="url(#ah)"/>
</svg>
```
`.draw` paths start hidden (`stroke-dasharray:1; stroke-dashoffset:1`) and animate via the
`drawLine` keyframe once `.in` is added. The theme's scroll engine fires an `enter` CustomEvent
on each `.slide`; the per-page script adds `.in` to that slide's `.draw` paths on `enter`. Solid
(non-`.draw`) arrows are always visible — use them if you don't want the draw-on effect.

## 5. Figure color discipline
- Themed structure: guides dashed in `var(--purple-deep)`; foreground fills `var(--green)`; seams/highlights bright `var(--ink)` (white) or `var(--green-bright)`.
- The ONE highlighted case → `var(--warn)` (gold). Don't spend gold on anything else.
- Categorical (many instances): a soft theme-harmonized palette (greens/teals/purples/rose/lime), reduced saturation so it reads on the dark bg — never clashy primaries (no raw `#ff0000`/`#0000ff`). Gold stays reserved for the flagged category.

## 6. chrome-devtools verification checklist (mandatory before "done")
1. Open the file: `new_page` `file:///…/index.html` (or `navigate_page` reload after edits).
2. `list_console_messages` → must be **zero** errors.
3. Scroll the target slide into view (`evaluate_script` `el.scrollIntoView`), `take_screenshot`, and read it back.
4. Animated figure: pin each state via `evaluate_script` (set `layerA.style.opacity=…`, `layerB.style.opacity=…`), screenshot BOTH; then clear the inline styles so the live animation resumes.
5. If a figure is too small to read, temporarily widen it (`svg.style.width='1500px'`) for the screenshot, then reset.
6. Confirm geometry counts / labels match the data the generator reported.

## 7. Slide rhythm
Open (slide 00) with a fact or a tension, not a generic field statement; build to the unsolved
question. Use `.callout--issue` then `.callout--fix` to pair a problem with its resolution. One
takeaway per slide; one diagram per idea. Keep section labels (`.slide-tag .mono`) short and
lowercase.

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

### 2026-06-16 · seed recipes (building change-detection explainer)
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
  JS-built pixel grid with two `<g>` layers (state A ⇄ state B) crossfaded on a CSS keyframe,
  PLUS a JS-injected sweeping scan `<rect>` (SMIL `x` animation) for continuous motion.
  Reduced-motion pins to state B and drops the scan.
- **Signal-pulse pipeline (Animated SVG/CSS).** A `.flow-svg` of boxes + draw-on arrows, then
  JS-inject 2 glowing `<circle>` "signal" dots animating `cx` across the pipeline (SMIL,
  staggered `begin`, reduced-motion-gated) + a CSS `rect:hover` brighten. Reads as data flowing
  through the stages.
- **Staggered hover-tooltip bar chart (Animated SVG/CSS).** SVG bars with
  `transform:scaleY(0)→1` on slide enter, `transition-delay` per bar for a staggered build, a
  `<title>` per bar (exact value + Δ vs previous step), and a `:hover` brighten.
