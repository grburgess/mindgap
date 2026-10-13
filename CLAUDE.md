# mindgap

Local org-roam-style knowledge graph (SQLite + stdlib Python 3.10 + web UI). No pip deps.

- Knowledge-adding sessions (loops) MUST read `AGENTS.md` first — it defines the ingest protocol.
- CLI: `mindgap` (installed shim) or `python3 -m mindgap` from repo root.
- DB: default `~/.mindgap/mindgap.db`; env `MINDGAP_DB` (DB file) / `MINDGAP_HOME` (data dir) override.
- Tests: `python3 -m unittest discover tests`.

## Skills

- `mindgap-plugin/skills/` is the source of truth — edit the skills here.
- They ship only through the plugin. Nothing is linked or copied into
  `~/.claude/` (no `~/.claude/skills/` symlinks); skills reference their own
  files by paths relative to the skill dir.
- Learning ledgers live in `$MINDGAP_HOME/learning/` (default
  `~/.mindgap/learning/`), never in this repo.

## Branching

- `development` = integration branch (GitHub default). All PRs target `development`.
- `main` = stable releases only; protected, no direct push.
- Release: PR `development`→`main` that bumps version in `pyproject.toml`,
  `mindgap-plugin/.claude-plugin/plugin.json`, `mindgap/mcp.py` (+ `tests/test_mcp.py`); after merge tag `vX.Y.Z` on main.
