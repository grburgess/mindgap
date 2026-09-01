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
- Auto mode: {{on}} — both-bounded: self-continue across sessions + run non-stop within. Default on; set `off` for a manual loop. See STATE.md § Auto mode.
- Total budget ceiling: {{Max sessions × Max iterations per session}} total iterations — a hard stop across ALL sessions; auto mode never continues past it.
- Stop-and-notify triggers: ceiling hit | session cap | 2× no-progress | irreversible/outward action (publish/delete/submit/send) | classifier-block with no §6 sibling | subagent null-twice | repeated maker thrash | loop complete. On any trigger: HALT + PushNotification, no further wakeup.

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
{{workflow}} — {{one-line reason per references/loop-patterns.md decision rule; default is workflow, Shape 1 only for N=1-in-place or no workflow engine}}
Isolation: {{worktree | none — non-git, sequential makers only}}
