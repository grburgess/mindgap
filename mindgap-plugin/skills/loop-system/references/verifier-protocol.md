# Verifier protocol

A model evaluating its own output prefers conclusions consistent with
what it already wrote. The verifier exists to not have skin in the
maker's game. These rules are structural, not advisory.

## Isolation (non-negotiable)

The verifier receives ONLY:
1. The artifact (file contents, diff, screenshot, query results).
2. GOAL.md sections 2–3 (done-criteria + rubric).

Vision-verify only, additionally: the goal description (GOAL.md
section 1), the previous iteration's screenshot, and any design-token
block explicitly copied into GOAL.md section 3 at init.

The verifier never receives: the maker's reasoning, the chat history,
prior verdicts (except the previous screenshot for vision-verify), or
any hint of what answer is hoped for.

## Verdict schema

```json
{ "pass": false,
  "gaps": ["criterion 2: header overlaps nav at 768px — screenshot px 0-64"],
  "evidence": "checked criteria 1-4 via <method>; 1,3,4 pass" }
```

- `gaps` must be actionable and cited (file:line, screenshot region,
  failing command output). "Could be better" is not a gap.
- `evidence` must name the check method per criterion — this line is
  what STATE.md `Verified facts` entries are built from.
- Structural claims ("array is empty", "field absent", "N nodes",
  "no edges") must be backed by a parse/count (grep, `python3 -c`,
  `jq`), never eyeballed — a confident wrong aside reads identical to
  a checked one and misleads the next maker. Orchestrator: spot-check
  any structural side-claim before folding it into the next prompt;
  if it contradicts the artifact, distrust that verifier's other
  glance-based evidence for the run (see lessons.md 2026-06-12).

## Verifier prompt skeleton

> You are an independent verifier. Judge ONLY the artifact below
> against ONLY these criteria. You did not write it; you have no
> stake in it passing. Default skeptical: a criterion without
> positive evidence is a gap.
> ARTIFACT: <...>  CRITERIA: <...>  RUBRIC: <...>
> Return the verdict JSON only.

## Vision-verify (visual goals)

1. Maker renders output → screenshot in the loop's `artifacts/`,
   named `<session>.<iter>-<slug>.png`.
2. Verifier reads the screenshot with vision and compares against:
   the goal description (GOAL.md section 1), any design-token block
   copied into GOAL.md section 3 at init, and the previous
   iteration's screenshot from `artifacts/`. No previous screenshot →
   compare against the goal description and design tokens only.
3. Mismatch → gaps as a structured visual diff: region, expected,
   actual.

## Rubric design (written into GOAL.md at init)

- One row per criterion; the check must be runnable by someone with
  no project context.
- Prefer commands and comparisons over judgment ("`pytest -q` exits
  0", "p95 < 200ms on bench.sh") — judgment criteria get a checklist
  of observable properties instead.

## Routing

Verifier tier: cheapest-that-can-judge — haiku by default (cheap,
independent context); bump toward the ceiling when the rubric needs
deep domain judgment. Never make the verifier weaker than the rubric
requires — a verifier that can't evaluate the criteria returns false
PASSes, which poison `Verified facts`.
