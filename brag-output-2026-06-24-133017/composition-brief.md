# Hyperframes Composition Brief: mindgap

## Objective
Create a short, polished launch-style brag video for mindgap — a local, zero-dependency knowledge graph grown by autonomous agent loops, now flyable in 3D against a star field.

## Output
- Composition directory: `brag-output-2026-06-24-133017/composition/`
- Rendered video: `brag-output-2026-06-24-133017/brag.mp4`
- Format: landscape — 1920x1080
- Duration: 20s

## Source Material
- Project root: `/Users/burgessj/projects/mindgap`
- Primary files read: `mindgap/web/index.html`, `style.css`, `app.js`, `starfield.js`, `glow3d.js`, `README.md`
- Product name: mindgap
- Tagline / strongest claim: "A second brain that runs on nothing." / "Give an agent a goal and a place to remember."
- Key UI/visual moments to recreate: force-directed constellation blooming + clustering; a real `mindgap ingest` payload; the **3D star-field galaxy** (`web/starfield.js` — world-space twinkling stars, real parallax).
- Copy that must appear verbatim:
  - "Your knowledge lives in scattered notes."
  - "mindgap connects them."
  - "Topics find themselves."
  - "Give an agent a goal. The graph grows itself."
  - "A second brain that runs on nothing."
  - "stdlib Python · SQLite · zero pip deps"

## Creative Direction
- Tone preset: polished
- Creative direction: a quiet premium dev-tool film — a knowledge graph that assembles itself, then opens into a galaxy.
- Interpretation: restraint and confidence; few words, generous holds, soft crossfades; motion + the star field carry it.
- Angle: scattered notes → bloom → topic clusters → the agent loop grows it → tilt into a 3D star-field galaxy that runs on nothing.
- Hook: dim disconnected dots + "Your knowledge lives in scattered notes."
- Outro / punchline: the constellation becomes a star-field galaxy behind the wordmark; "A second brain that runs on nothing."
- Avoid: generic SaaS language, abstract filler, unrelated redesign.

## Visual Identity
- Background: `#0b1210` ; Accent: `#57c7a4` ; Secondary: `#a78bfa` ; Text: `#d7e0dc`
- Star field color: `#cfe0ff`
- Display: Bricolage Grotesque ; Body: Hanken Grotesk ; Mono: Spline Sans Mono (local woff2)
- References: green-black editorial theme, type-color node palette, mind(green)gap(purple) wordmark, `mindgap ingest` payload, world-space star field.

## Storyboard
Use `brag-plan.md` as the creative contract. Scene summary:
1. Scattered notes — 3.2s — dim disconnected dots + hook line.
2. The bloom — 4.4s — edges connect, force layout spreads into a type-colored constellation.
3. Topics find themselves — 3.4s — community recolor + hulls + labels.
4. The loop — 3.8s — `mindgap ingest` payload + agent node pop-ins on the beat.
5. Outro galaxy — 5.2s — tilt into 3D, star field blooms, wordmark + tagline + flex subline.

## Audio
- Role: cinematic support; low clean bed (`mindgap-bed.mp3`, vol 0.30, fade in/out).
- Audio-reactive: subtle — constellation glow + halos breathe with RMS/bass; star-field bloom rides the same envelope; soft treble lift on the wordmark.
- Beat: bloom near strong cue ~8.74s; wordmark settle near ~17.47s; agent pop-ins on the beat grid ~13.0–14.8s.
- SFX: sparse (≤4) — soft reveal on bloom, two light drops on agent pops, one soft bell on wordmark.
- Audio files already present under `composition/assets/`.

## Hyperframes Instructions
- This composition is an extension of the prior validated mindgap composition (same green-black constellation engine). New work: a deterministic world-space **star-field canvas** that blooms during the existing Scene-5 3D tilt, and a refreshed Scene-4 line foregrounding the agent loop.
- Star field must be deterministic (seeded LCG, no runtime `Math.random`), seek-safe (drawn purely from frame index in the per-frame `render(f)`), and sit behind the constellation (inside the background layer).
- Keep all text readable; only the last scene may exit; total 20s / 600 frames @ 30fps.
- Validate with `npx hyperframes lint && npx hyperframes validate` before render.
