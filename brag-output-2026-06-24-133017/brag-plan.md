# Brag Plan: mindgap

## What is this app?
A local, offline, **zero-dependency** knowledge graph (stdlib Python 3.10 + SQLite + a vanilla-JS web UI) that an autonomous agent loop reads before it works and writes after — turning research (concepts, papers, repos, people) into a force-directed constellation of linked ideas that clusters by topic, grows itself across sessions, and can be flown through in 3D as a star field galaxy.

## The angle
The name *is* the pitch: **mind​gap** closes the gaps between scattered ideas. Open on the loneliest version of your notes — disconnected dots in the dark — let them snap into a living constellation that colors itself by topic, then show the real engine: **you give an agent a goal and the graph grows itself.** Land on the flex no SaaS tool can match — tilt the whole thing into 3D and let a **star field** bloom behind it: the knowledge graph becomes a galaxy you drift through, and it **runs on nothing** (no pip installs, one SQLite file). Specific to mindgap: the green-black editorial theme, the type-color node palette, the `mind`(green)`gap`(purple) wordmark, a real `mindgap ingest` payload, and the new 3D star-field backdrop.

## Hook (first 2-3 seconds)
A near-black green-black field. A scatter of **dim, disconnected dots** — your notes as islands. One line, big Bricolage Grotesque: **"Your knowledge lives in scattered notes."** The stillness is the hook: nothing is connected. (Earns the next 18s because the viewer wants the dots to connect.)

## Key moments (the middle)
- **The bloom** — edges shoot between the dots and a force layout flings them apart into a type-colored constellation. The centerpiece motion.
- **Topics find themselves** — nodes recolor by community, translucent hulls swell around clusters, centroid labels fade in. Client-side Louvain, no extra anything.
- **The loop** — a real `mindgap ingest` JSON payload streams in mono and fresh nodes pop into the graph on the beat. "Give an agent a goal. The graph grows itself." This is the agentic engine, made literal.

## Outro / punchline
The constellation tilts into **3D** and a **twinkling star field blooms behind it** — the graph becomes a galaxy adrift in space. The wordmark **mind​gap** (green + purple) settles center over the galaxy. Tagline: **"A second brain that runs on nothing."** Mono subline, the flex: **`stdlib Python · SQLite · zero pip deps`**. Hold, fade to green-black.

## User flow worth showing
entry → key action → result, from the working web UI (the product *is* the UI, there is no landing page):
1. **Entry:** open the graph — a sparse set of nodes in the dark.
2. **Key action:** an agent loop ingests a JSON payload of new nodes + edges (`[[wiki-links]]` auto-create edges) — the graph feeds itself.
3. **Result:** it blooms into a force-directed constellation, detects topic communities (color + hulls), and can be flown through in **3D against a star field**.
The centerpiece scenes (2–5) show exactly this: sparse → connect → cluster → agent-grown → 3D galaxy.

## Tone
- Preset: **polished**
- Creative direction: *a quiet premium dev-tool film — a knowledge graph that assembles itself, then opens into a galaxy.*
- Interpretation: restraint and confidence. Few words per scene, generous holds, slow soft crossfades, cinematic reveals (the bloom, the 3D galaxy) over quick cuts. Motion and the star field do the talking; no hype, no exclamation, no bullet dumps.

## Format: landscape — 1920x1080
## Duration: ~20s

## Visual identity (from the project)
- Background: `#0b1210` (green-black) — also `--bg-raised #101a17`, `--line #1d2925`
- Accent (primary): `#57c7a4` (sea green) ; Secondary accent: `#a78bfa` (purple)
- Text: `#d7e0dc` ; Dim: `#76847f`
- **Node type palette** (the constellation): concept `#57c7a4` · definition `#a78bfa` · software `#5aa9e6` · repo `#f4a261` · page `#e9c46a` · paper `#e76f51` · person `#f28ab2` · team `#9ae65a`
- Star field color: `#cfe0ff` (soft cool white — matches `web/starfield.js`)
- Display font: **Bricolage Grotesque** (700/500) ; Body: **Hanken Grotesk** ; Mono: **Spline Sans Mono**
- Wordmark: `mind` green + `gap` purple, lowercase, tight tracking
- Strongest visual: the constellation blooming into type-colored clusters, then tilting into a **3D star-field galaxy** (the README hero `demo.gif` / `ui-3d.gif`)

## Share copy (draft)
Pointed an agent at a goal and let it grow a knowledge graph — concepts, papers, repos & people that connect themselves, cluster by topic, and drift in a 3D star field. Local, offline, **zero pip deps**. 🌌 mindgap

## Audio direction
- Role: cinematic support — a low, clean bed under a near-silent film; sound reinforces two or three reveals only.
- Music: `mindgap-bed.mp3` (derived from happy-beats vol-12, ~110 BPM), volume **0.30**, gentle fade-in, fade out over the last ~1.2s.
- Music cue guidance: preset (`vol-12`, ~109.96 BPM). Lock the **bloom** near the strong cue **8.74s** (±0.15s); lock the **wordmark settle** near **17.47s**; agent node pop-ins ride the beat grid (~0.55s) between ~13.0–14.8s, each still meeting its readable hold.
- Audio-reactive treatment: **subtle** — RMS/bass lets the constellation glow and node halos *breathe*; soft treble lift on the wordmark; the star field bloom rides the same envelope. No bars, no strobing.
- SFX posture: **sparse, polished** (≤4 cues) — soft reveal on the bloom, light drop ticks on two agent pop-ins, one soft bell on the wordmark.
- Restraint rule: audio must never get busy or "fun corporate." The film should survive on mute.

## Storyboard

### Scene 1 — Scattered notes (the gap) — 3.2s
Green-black field. ~12 dim, disconnected dots in node-type colors, drifting, no edges. Big Bricolage line center: **"Your knowledge lives in scattered notes."** (settle ~1.6s). Mono subline: `concepts · papers · repos · people` (~0.9s).
Sequential/interaction: none (dots drift only).
Audio intent: low bed enters, quiet and patient.
Transition mood: soft crossfade → Scene 2

### Scene 2 — The bloom (centerpiece) — 4.4s
Edges shoot out; a force layout flings the dots into a **type-colored constellation** that spreads and settles. Nodes brighten; halos breathe with the bed. Quiet line lower-left: **"mindgap connects them."** Lock the spread peak near the strong cue ~8.74s.
Sequential/interaction: the connect-and-spread motion event.
Audio-coupled idea: soft reveal cue on connect.
Transition mood: soft crossfade → Scene 3

### Scene 3 — Topics find themselves — 3.4s
The constellation **recolors by community**; 2–3 translucent hulls swell with centroid labels. Line lower-left: **"Topics find themselves."** Note: `Louvain communities · client-side · no deps`.
Sequential/interaction: hulls + labels arrive one by one (each held ≥0.8s).
Transition mood: soft crossfade → Scene 4

### Scene 4 — The loop (grown by agents) — 3.8s
A **real `mindgap ingest` JSON payload** streams in Spline Sans Mono; on the graph side **3–4 fresh nodes pop in one by one** with their edges, on the beat. Line: **"Give an agent a goal. The graph grows itself."** (settle ~1.4s). Payload shows `"created_by": "loop:arxiv-weekly"`, a nodes/edges shape, a `[[wiki-link]]`.
Sequential/interaction: **yes** — 3–4 node pop-ins, one per beat; hold the full set ~0.8s after the last.
Audio-coupled idea: light drop tick on the first + last pop only.
Transition mood: soft crossfade → Scene 5

### Scene 5 — Outro: a galaxy that runs on nothing — 5.2s
The full constellation **tilts into 3D** and dims back as a **twinkling star field blooms behind it** — the graph becomes a galaxy drifting through space (mirrors `web/starfield.js`: world-space stars, real parallax). The wordmark **mind**(green)**gap**(purple) eases to center over the galaxy. Tagline (Hanken): **"A second brain that runs on nothing."** Then mono subline: **`stdlib Python · SQLite · zero pip deps`**. Hold ~1.2s, stars + visuals + music fade together. Lock the wordmark settle near ~17.47s.
Sequential/interaction: star field fade-in → wordmark → tagline → subline, staggered to each read floor.
Audio intent: the quiet landing; a single soft bell on the wordmark, then fade.
Transition mood: slow fade to green-black (end)

**Music mood for this video:** cinematic (restrained, steady, clean — bed at 0.30).
**Audio summary:** A low, patient bed enters over scattered dots, swells once as the graph blooms, stays steady through the topic clusters and the agent-fed loop, then a soft bell marks the wordmark as the star field opens into a galaxy and everything fades to green-black — a film that would survive on mute.
