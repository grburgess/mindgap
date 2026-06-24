# Design System — mindgap brag

Dark editorial / technical-cartographic. Lifted verbatim from the mindgap web UI (`mindgap/web/style.css`, `app.js`).

## Palette
- Background: `#0b1210` (green-black)
- Background raised: `#101a17`
- Panel: `#0e1714`
- Hairline / lines: `#1d2925`
- Text: `#d7e0dc`
- Dim text: `#76847f`
- Accent — green (primary): `#57c7a4`
- Accent — purple (secondary): `#a78bfa`
- Danger / warm: `#e76f51`

### Node-type palette (the constellation)
- concept `#57c7a4` · definition `#a78bfa` · software `#5aa9e6` · repo `#f4a261` · page `#e9c46a` · paper `#e76f51` · person `#f28ab2` · team `#9ae65a` · stub `#5b6663`

## Typography
- Display / headlines / wordmark: **Bricolage Grotesque** (700, 500), letter-spacing -0.02em
- Body / taglines: **Hanken Grotesk** (400, 500, 600)
- Mono / code / metadata: **Spline Sans Mono** (400, 500)
- Google Fonts: `https://fonts.googleapis.com/css2?family=Bricolage+Grotesque:wght@500;700&family=Hanken+Grotesk:wght@400;500;600&family=Spline+Sans+Mono:wght@400;500&display=swap`

## Wordmark
`mind` in green `#57c7a4` + `gap` in purple `#a78bfa`, lowercase, tight tracking, Bricolage 700.

## Motion personality
Polished / cinematic-restrained. Slow soft crossfades (0.5–0.8s), generous holds, one swell (the bloom). No hype, no quick choppy cuts. Motion + the constellation carry the beauty.

## Do
- Use the exact hexes above. Tint neutrals toward the green hue.
- Let the green-black background breathe; localized radial glow, never flat.
- Constellation nodes glow softly; halos breathe subtly with the music.

## Don't
- No `#333`, `#3b82f6`, Roboto, or any off-palette color.
- No waveform/equalizer/music-note graphics, no strobing.
- No generic SaaS phrasing.
- No full-screen linear gradients (H.264 banding) — radial or solid + glow.
