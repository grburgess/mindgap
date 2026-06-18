# Loop patterns — engine choice + shapes

## Decision rule

**≥3 independent work items OR parallel experiments, AND the project
is a git repo → Dynamic Workflow. Else → subagent loop.** When unsure,
subagent loop — it's debuggable and cheap to upgrade later.

Capability check (at INIT engine choice): if the runtime exposes no
workflow engine and no isolation option on the subagent tool, choose
subagent loop and achieve isolation manually — `git worktree add` per
maker in a git repo, or sequential makers otherwise.

## Shape 1 · Subagent loop (default)

Main agent is the orchestrator. Per iteration:

1. Spawn the maker via the subagent (Task) tool; in a git repo,
   create/enter a worktree for it first (`git worktree add`) —
   worktree only when the maker writes files.
2. Spawn the verifier via the subagent (Task) tool (model per
   GOAL.md) — input is ONLY artifact + criteria + rubric (see
   verifier-protocol.md).
3. Verdict gaps → folded into next maker prompt.
4. Update STATE.md Iteration log after each verdict.

Best for: one artifact refined sequentially — a file, a fix, a doc, a
single UI.

## Shape 2 · Dynamic Workflow — fan-out with per-item verification

Use when N items can be made and verified independently.

Fan-out makers route as "Bulk workers" from the GOAL.md routing table
(the Shape 1 maker routes as "Maker (hard work)").

```javascript
export const meta = {
  name: 'loop-fanout',
  description: 'Make + adversarially verify N items per GOAL.md',
  phases: [{ title: 'Make' }, { title: 'Verify' }],
}
// args: { items: [{spec, outPath}, ...], criteria: '<done-criteria text>', makerModel, verifierModel }
// makerModel is left undefined for `hard` items → agent() inherits the session model (the ceiling);
// set it to a named cheaper alias only for normal/bulk items. verifierModel = the §6 check tier.
const results = await pipeline(
  args.items,
  item => agent(`Produce: ${item.spec}. Write output to ${item.outPath}.`,
    { phase: 'Make', model: args.makerModel, isolation: 'worktree' }),
  (_makerReturn, item) => agent(
    // artifact = contents of ${item.outPath}, NOT the maker's return value
    `You are an independent verifier. You see ONLY this artifact and these criteria.
     Artifact: ${read(item.outPath)}
     Criteria: ${args.criteria}
     Return verdict.`,
    { phase: 'Verify', model: args.verifierModel,
      schema: { type: 'object',
        properties: { pass: {type:'boolean'},
                      gaps: {type:'array', items:{type:'string'}},
                      evidence: {type:'string'} },
        required: ['pass','gaps','evidence'] } })
    .then(v => ({ item, verdict: v }))
)
return results.filter(Boolean)
```

Failed items (`pass: false`) get a second maker pass with the gaps;
still failing → STATE.md Open failures.

## Shape 3 · Dynamic Workflow — loop until dry (discovery goals)

For "find all X" goals where the count is unknown: keep spawning
finder agents until 2 consecutive rounds return nothing new; verify
every fresh finding with an independent verifier before counting it.
Dedup against everything seen, not just confirmed items, or the loop
never converges.

## Cross-shape rules

- The maker is never the verifier. No exceptions (a model grading its
  own output favors conclusions consistent with what it wrote — see
  verifier-protocol.md).
- Every verdict logs one STATE.md line before the next iteration starts.
- Non-git project: no worktrees → no parallel makers → Shape 1 only.

## Maker tooling notes

- Web-discovery makers: `WebSearch` was reported to error from inside
  subagents across two paper-discovery sessions (cause unconfirmed —
  could be transient or sandbox). The verified-reliable fallback for
  academic-paper discovery is the arXiv export API via WebFetch:
  `http://export.arxiv.org/api/query?search_query=all:<terms>&max_results=N`
  returned usable results every time. Give discovery makers both the
  WebSearch and the export-API path in their prompt so a WebSearch
  failure doesn't stall the maker.
