# live-view panel API — inline this into the page-builder prompt

A bespoke panel is ONE classic JS file (no modules, no imports, no libraries) that calls:

```
LiveView.panel(name, { title: string, render(el, state, api) })
```

`render` is re-called on every state change with a fresh empty `el`; it must tolerate
partial data (no claims yet, agents still running, no reconciled verdicts) without throwing.
A throw is caught and shown as a red "panel failed" line.

## api
```
api.h(tag, attrs, ...children)  // DOM builder. attrs: class, text, on<event> handlers, anything else via setAttribute.
                                // children: strings / nodes / arrays / null. ALWAYS use it — NEVER innerHTML.
api.rich(text)                  // child nodes rendering **bold** and `code`, safely
api.verdictClass(v)             // 'ok' | 'warn' | 'weak' | 'bad' | 'na'
api.verdictOf(agent)            // agent's verdict string or null
api.textOf(event)               // best text field of an event
api.open({agent: agentId})      // open the details drawer (user can ask / contest there)
api.open({seq: eventSeq})
api.ask(text, ref) / api.contest(text, ref)   // post to the inbox directly (no-ops in report mode)
```

## Host CSS you may use
`.chip` + `.c-ok/.c-warn/.c-weak/.c-bad/.c-na` (coloured pill), `.v-*` (coloured text),
`.mono`, `.caption`. Theme: bg `#000`, card `#161617`, elevated `#101012`, text `#f5f5f7`,
text-2 `#a1a1a6`, text-3 `#6e6e73`, hairline `rgba(255,255,255,.14)`, accent `#ff9f0a`.
Inject at most ONE `<style>` (guard with an id), classes prefixed with a panel-specific
prefix. Wrap wide content in `overflow-x:auto` — the page must work at 390px.

## state
```
state = { view: {id, skill, title, created, workflows},
          events: [{seq, ts, run, kind, actor, phase, subject, data}],
          agents: [{workflow, agentId, label, phase, state, model, startedAt, summary, result}] }
```
Event kinds: run.start/end, phase.start/end, workflow.bind, agent.start/done, claim, verdict, ruling,
decision, status, artifact, note, question.ask/answer, user.ask/answer, flag.contest, reply.
Replies/threads link by `data.ref` (an event seq, or `"agent:<agentId>"`).
Agent `label` is whatever the Workflow script passed as `opts.label` — idea-court uses
`<lens>:<claimId>`; `result` is the agent's schema output (null while running).

## Prompt skeleton
> You are the PAGE-BUILDER. Do not read or write files, do not run tools — everything is
> below. Return ONLY the code in one ```js block. <this file> + a trimmed REAL state sample
> + "Task: panel name '<name>', title '<title>'. <one paragraph: rows, columns, cells,
> clicks, the one thing the user should notice>. Under 140 lines."

Existing panels (reuse before generating): `panels/verdict-matrix.js` (claims × lenses,
idea-court), `panels/criteria-progress.js` (criteria × iterations, loop-system).
