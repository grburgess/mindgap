---
name: knowledge-capture
description: Use at the end of a session (or on demand) to distill durable, on-domain learnings from the current session into the mindgap knowledge graph — concepts, definitions, decisions, people, repos. Relevance-gated to the configured domain; defers research papers to paper-to-mindmap. Invoked automatically by the SessionEnd capture hook, and manually when you want to file what a session taught you.
---

# knowledge-capture

Turn what a session just taught you into graph nodes + edges, autonomously and
reversibly. The full ingest protocol is **AGENTS.md** (binding); essentials below.

> Capture is **disabled by default**. It only fires once you enable it and set a
> domain — see `~/.mindgap/capture.json` (`enabled` + `domain`).

## When this fires
- Automatically: the SessionEnd hook (`mindgap-capture-hook`) spawns a headless
  subagent over the session transcript. It runs with `MINDGAP_CAPTURE=1`.
- Manually: invoke to capture the current session's learnings on demand.

## Step 1 — relevance gate (do this FIRST)
Read the transcript / recall the session. Ask: does it contain **durable, on-domain**
learnings (domain = `capture.json` `domain.description`)? Ephemeral chatter, config
edits, and off-domain work → **write nothing and stop.** Papers read for learning →
defer to `paper-to-mindmap` (it owns `paper` nodes); don't double-ingest.

## Step 2 — dedup
For each candidate learning, run `mindgap_context "<topic>"` / `mindgap_find`
first. Upsert existing ids; never mint a near-duplicate (AGENTS.md near-duplicate rule).

## Step 3 — ingest (provenance is mandatory)
Ingest via `mindgap_ingest` with, on every node:
- `created_by = "capture:<repo-basename>"` (the session's cwd basename)
- `confidence = 0.6` (machine-captured; below hand-curated nodes)
- a `urls` entry pointing at the transcript: `{label, url:"file://<transcript>", kind:"web"}`
- `[[wiki-links]]` in bodies to anchor into existing nodes — never create islands.

Cap at `capture.max_nodes_per_session` nodes. Raise confidence only when re-deriving an
existing node from an independent source (AGENTS.md confidence rule).

## Step 4 — finish
Delete the lock file at `~/.mindgap/capture.lock` so the next session can capture.

## Health
`mindgap lint` reports orphans, dangling stubs, near-duplicate candidates, and
stale capture nodes. Run it periodically; it is deterministic and never rewrites the graph.
