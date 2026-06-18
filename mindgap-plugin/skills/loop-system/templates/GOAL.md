# Goal · {{loop-name}}

Created {{YYYY-MM-DD}}. All 7 sections below are required before the
loop may start (hard gate).

## 1 · Goal
{{prose goal, from the user's prompt}}

## 2 · Done-criteria (grader-checkable)
| # | Criterion | How the verifier checks it |
|---|-----------|----------------------------|
| 1 | {{measurable criterion}} | {{exact check: command, comparison, vision check}} |

## 3 · Verifier rubric
The verifier receives ONLY: the artifact + sections 2–3 of this file.
{{scoring guidance: what counts as pass per criterion, what evidence is required}}

## 4 · Budgets
- Max iterations per session: {{5}}
- Max sessions before forced escalation: {{n}}

## 5 · Escalation rule
{{default: write blocker to STATE.md Open failures; end session with summary and a concrete question for the user}}

## 6 · Model routing
Ceiling (auto-detected at INIT, not asked): {{session model}}
Alias ladder: haiku < sonnet < opus < fable
Classifier-block sibling: {{opus if ceiling is fable, else none — surface to user}}

Router — orchestrator tags each work item (difficulty + task class):
| Tag    | Tier |
|--------|------|
| hard   | ceiling (omit model → inherit session model) |
| normal | one tier below ceiling (clamp at haiku) |
| bulk   | cheapest fast tier (haiku; sonnet if the class needs it) |
| check  | cheapest-that-can-judge (haiku); ceiling for hard rubrics |

Seeded task classes: {{kebab labels derived from §2 done-criteria}}
Learned promotions override the table above — see STATE.md § Routing overrides.

Note: the em-dash characters (—, →) and the §, · symbols must be preserved exactly.

## 7 · Engine
{{subagent-loop | workflow}} — {{one-line reason per references/loop-patterns.md decision rule}}
Isolation: {{worktree | none — non-git, sequential makers only}}
