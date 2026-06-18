# loop-system meta-lessons

Misfires of the loop-system skill itself. Appended at SESSION END when
the skill (not the project) was the problem: bad scaffold, wrong
engine choice, vague rubric passed the hard gate, dispatch picked the
wrong loop.

Format, one entry per misfire:

```
## <YYYY-MM-DD> · <short title>
- What happened:
- Why (root cause in the skill's instructions):
- Fix applied:
- Occurrences: 1   <- bump on repeat; at 2, edit SKILL.md structurally
```

<!-- entries below -->

## 2026-06-16 · maker-claimed references can be dangling even when the file landed
- What happened: arxiv-weekly session 1. Build makers emitted graph payloads referencing ~13 existing node ids as link anchors — most BEYOND the seed list I gave them (they found them via `mindgap find`). The per-paper independent verifiers each reported "confirmed anchors exist via mindgap show". If even one id were slightly wrong, the ingest would have auto-minted a dangling stub, silently failing the loop's own C5 (links must target pre-existing nodes) and C8 (no orphans/stubs). The artifact-existence check (does the file/payload exist) would NOT catch this — the payload existed and was well-formed; the problem is whether its *references resolve*.
- Why (root cause in the skill's instructions): SESSION step 1 had an artifact-EXISTENCE check but no artifact-REFERENCE-resolution check. Existence ≠ validity: a maker output can land intact yet point at entities that don't exist in ground truth. Trusting the verifier's glance-based "X exists" reintroduces the eyeballed-structural-claim failure (lessons.md 2026-06-12).
- Fix applied: caught proactively this run — orchestrator parsed every `anchors_used` id + edge endpoint against the `pre.json` snapshot in-band before ingest (all 7 clean). Generalized into SKILL.md SESSION step 1 as a "Reference-resolution check" sibling to the existence check, phrased for any reference class (foreign keys, file paths, imported symbols, API endpoints, citation keys), since loop-system is not mindgap-specific.
- Occurrences: 1   <- near-miss; structural SKILL.md fix applied proactively

## 2026-06-15 · makers report file writes that never landed
- What happened: TWICE a subagent's done-report claimed artifacts it did not write. (1) knowledge-scan: a repair agent claimed a fix but edited nothing. (2) people-ideas session 1: the batch-3 maker reported "7 research notes written"; 0 existed on disk. Both were caught only by the independent verifier — each costing a full verifier round (and in case 2 a repair iteration) to discover a missing file.
- Why (root cause in the skill's instructions): SESSION step 1→2 handed the maker's output straight to the verifier with no cheap existence check, trusting the maker's self-report. A lying/forgetful maker is indistinguishable from a correct one until the verifier reads (or fails to find) the artifact.
- Fix applied: added an "Artifact-existence check (before the verifier)" sub-step to SESSION step 1 — orchestrator `ls`/`wc -l`s the maker's claimed files before spending a verifier round; missing → re-run the maker first. Also a project General rule in people-ideas STATE.md.
- Occurrences: 2   <- structural SKILL.md fix applied at 2 per protocol


## 2026-06-15 · single verifier given full criteria over a large artifact set stalls without a verdict
- What happened: topic-people session 1, a verifier subagent was asked to grade ALL 6 criteria (mechanical: id/endpoint/created_by/dedup/ledger-completeness over 3 payloads + 119-node pre.json; AND semantic: deep-mined evidence quality of 40 edges across 22 notes). It ran ~29 min / 40 tool-calls and returned a non-verdict partial message (cut off before the verdict block). No way to resume that agent (no SendMessage in this harness).
- Why (root cause in the skill's instructions): verifier-protocol tells the verifier to do mechanical checks via python3 AND semantic judgment, with no guidance to SPLIT them when the artifact set is large. One agent doing both over many items exhausts its budget mid-task.
- Fix applied (workaround, this loop): orchestrator ran the mechanical criteria itself (deterministic python parse, shown in-band), then dispatched a focused verifier for ONLY the semantic criterion (40-edge evidence read) — passed in <2 min. Independence preserved for the judgment call; the objective parses don't need an independent agent.
- Occurrences: 1   <- if it recurs, add a "split mechanical vs semantic verification for large artifact sets" rule to verifier-protocol.md structurally

## 2026-06-12 · Verification rubric unsatisfiable when the source under investigation is itself wrong
- What happened: a code-permalink verification loop, criterion 3 required "a matching excerpt at the pinned commit" for every code permalink on the investigated page; one permalink was stale (path 404s at the pinned ref), so the criterion could never pass even though the maker correctly documented the 404 — the page's error, not the report's.
- Why (root cause in the skill's instructions): rubric-design guidance assumes the artifact alone determines pass/fail; for investigation/verification goals, criteria phrased as "confirm X exists" break when the honest finding is "X is broken". The hard gate didn't catch it because the criterion looked measurable.
- Fix applied: amended GOAL.md criterion mid-loop to accept documented fetch-failure evidence + nearest-ref excerpt as a stale-permalink verdict. Rule of thumb for future INITs: for claim-verification loops, every "confirm/cover all X" criterion needs an explicit "or documented refutation" arm — applied to EVERY such criterion in the GOAL, not just one.
- 2026-06-15 recurrence (topic-people): GOAL had TWO cover-all gates — (a) every topic covered, (b) every person ≥3 topic links. The INIT built the documented-escape for (a) (no-roster-expert) but FORGOT it for (b); had to amend mid-loop when 2 people had honest narrow footprints that a forced 3rd link would have fabricated. Same root cause: a cover-all gate without a refutation arm forces fabrication. Lesson sharpened: at INIT, sweep ALL gates and attach the escape to each.
- Occurrences: 2   <- structural SKILL.md fix proposed (INIT step 1 done-criteria guidance)


## 2026-06-12 · predetermined verdicts during scaffold iterations
- What happened: multi-stage goal (research → de-risk experiments → dataset); the final-artifact dataset cannot exist for the first N iterations, so every per-iteration verifier run returned the identical, fully predetermined gaps(all) verdict. Two full verifier subagent calls spent on known outcomes; orchestrator then logged one verdict without a verifier run (protocol deviation) to avoid a third.
- Why (root cause in the skill's instructions): SESSION mandates verifier after every maker with no provision for goals whose done-criteria all key on a final artifact that staged/de-risk iterations intentionally don't produce.
- Fix applied: none structural yet (first occurrence). Workaround used: log "dataset absent → gaps unchanged (per verifier <k> ruling)" referencing the last real verdict.
- Occurrences: 1


## 2026-06-12 · verifier attached a false structural side-claim to a correct verdict
- What happened: paper-discovery session-2 verifier (sonnet) correctly returned FAIL on C5, but its evidence line also asserted "no payload edges exist to check (edges arrays are empty)" — both payloads actually carried 11 and 12 explicit `edges[]` entries. The verdict was right; the structural aside was fabricated from a glance. Orchestrator caught it only by running a direct DB/JSON query during repair.
- Why (root cause in the skill's instructions): verifier-protocol mandated cited evidence but did not require structural claims ("array is empty", "field absent", "N items") to be backed by a parse/count rather than eyeballed — so a confident wrong aside reads identical to a checked one and can silently mislead the next maker.
- Fix applied: added a "structural claims must be counted, not eyeballed" line to verifier-protocol.md, and an orchestrator spot-check note. If a verifier's structural side-claim contradicts the artifact, distrust that verifier's other glance-based evidence for the run.
- Occurrences: 1

## 2026-06-16 · stale session-start STATE read nearly clobbered a concurrently-finalized session
- What happened: an ideation loop RESUME. The session-start read of STATE.md showed "Last session: None yet — session 1 pending", but the DB + artifacts/session-1/ showed a FULLY COMPLETED session 1 (5 ideas ingested) — a prior session-1 run was finalizing its SESSION END concurrently. I reconstructed session-1 from artifacts and tried to Write the reconstructed STATE; the harness "file has been modified since read" guard rejected the Write, and the re-read revealed the real, richer session-1 log (21-agent workflow, agent ids). Had the guard not fired, my reconstruction would have overwritten the authoritative record.
- Why (root cause in the skill's instructions): RESUME step 1 reads STATE "fully at session start", and step 3 reconstructs from artifacts when STATE looks missing/incomplete — but neither says to RE-READ STATE immediately before writing the reconstruction. A session-start snapshot can be stale (another session finalizing, or the file changing mid-session), so a reconstruct-then-write path can clobber a fresher truth.
- Fix applied (this run): trusted the Write file-guard; re-read STATE, found it authoritative, did NOT clobber — appended session-2 results instead. Proceeded to session 2 (user's new GT-creation focus) rather than redoing session 1.
- Suggested structural fix (needs user approval before editing SKILL.md): in RESUME step 3, add "before writing any reconstruction, re-read STATE.md fresh; if it now contradicts your reconstruction (e.g. shows the session already complete), discard the reconstruction and treat the on-disk STATE as truth." Also note that the artifact/DB-vs-STATE contradiction often means a concurrent session finalized, not corruption.
- Occurrences: 1

## 2026-06-15 · execution-time proxy gate overrode the real GOAL criterion
- What happened: vx-gt-extension loop. During de-risk I (orchestrator) introduced an out-of-band go/no-go metric — "best-vote-vs-human IoU ≥0.7" — that was NOT one of GOAL.md §2's criteria (the real quality bar there was criterion 6, vision plausibility). I then treated the proxy as a hard blocker and spent ~4 iterations chasing it. The proxy was both stricter than the goal (0.66 vs a human-human agreement floor of 0.82-0.88) AND misleading (it rewarded a method that floods parcels with lot-sized polygons and penalized a method whose finer splits were visually correct). Reframing verification back to the actual GOAL criterion (vision) instantly flipped the method choice and the dataset passed all 7 criteria in the same session.
- Why (root cause in the skill's instructions): SESSION/verifier-protocol bind the verifier to GOAL.md §2-3, but nothing warns the orchestrator against inventing NEW pass/fail gates mid-run that aren't in the gated GOAL. A self-imposed proxy can silently become the de-facto gate and starve the loop.
- Fix applied (workaround, this run): when a proxy metric conflicts with a GOAL §2 criterion, the GOAL criterion wins; verify against the gated criteria, not execution-time proxies. Promote the realization to STATE General rules.
- Suggested structural fix (needs user approval before editing SKILL.md): in SESSION, add "the verifier judges ONLY GOAL §2 criteria; if you find yourself blocking on a metric not in §2, either add it to §2 explicitly (re-gate) or drop it — never let an un-gated proxy halt the loop."
- Occurrences: 1
