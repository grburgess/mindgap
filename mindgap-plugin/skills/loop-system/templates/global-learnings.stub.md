# loop-system global learnings

Cross-project learnings, appended at SESSION END. Empty on a fresh install —
rows accumulate as loops run. This file is personal state: it is never
committed, pushed, or synced to a hosted service.

One row per learning, format:

    <YYYY-MM-DD> · <loop-name> · <learning> · evidence:<proof> · status:candidate · used:0 last:<YYYY-MM-DD> · map:<node-id>

`status:` is one of `candidate` · `proposed-skill` · `promoted→<skill-path>` ·
`rejected:<YYYY-MM-DD>:<reason>`. A promoted rule is later re-qualified by the
structure pass and marked `requalified:<date>` or `retired:<date>:<trigger>` on
its map node — promotion is not permanent, or the skill set only ever grows.

Promotion and pruning are usage-based: bump `used:` and `last:` each time a row
actually changes a decision. Rows never applied get pruned.

A declined promotion is recorded, not erased: the row keeps full standing at
`status:rejected:…` and keeps accruing usage — only the skill side ever rolls
back, never the knowledge. That record is what stops the next structure pass
re-proposing what the user already declined.
