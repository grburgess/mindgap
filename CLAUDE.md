# mindgap

Local org-roam-style knowledge graph (SQLite + stdlib Python 3.10 + web UI). No pip deps.

- Knowledge-adding sessions (loops) MUST read `AGENTS.md` first — it defines the ingest protocol.
- CLI: `mindgap` (installed shim) or `python3 -m mindgap` from repo root.
- DB: default `~/.mindgap/mindgap.db`; env `MINDGAP_DB` (DB file) / `MINDGAP_HOME` (data dir) override.
- Tests: `python3 -m unittest discover tests`.

## Skills

- `mindgap-plugin/skills/` is GENERATED from the upstream private repo by
  `tools/export-mindgap.sh`. Do not edit these files here — changes are
  overwritten on the next export. Fix upstream and re-export.
- If an edit lands here anyway, backport it before the next export: on the
  machine with the upstream checkout, `git pull` here, then run
  `tools/backport-skills.sh <upstream-skills-dir>` (no arg prints the patch).
- Learning ledgers live in `$MINDGAP_HOME/learning/` (default
  `~/.mindgap/learning/`), never in this repo.
