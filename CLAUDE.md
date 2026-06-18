# mindgap

Local org-roam-style knowledge graph (SQLite + stdlib Python 3.10 + web UI). No pip deps.

- Knowledge-adding sessions (loops) MUST read `AGENTS.md` first — it defines the ingest protocol.
- CLI: `mindgap` (installed shim) or `python3 -m mindgap` from repo root.
- DB: default `~/.mindgap/mindgap.db`; env `MINDGAP_DB` (DB file) / `MINDGAP_HOME` (data dir) override.
- Tests: `python3 -m unittest discover tests`.
