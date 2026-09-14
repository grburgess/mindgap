"""SessionStart hook: inject a compact mindmap digest into any new session.

Registered globally in ~/.claude/settings.json (SessionStart). Reads the hook
JSON on stdin ({session_id, cwd, source}) and prints a markdown digest of
relevant nodes to stdout (Claude Code adds SessionStart stdout as context).
No LLM, direct DB read, always exits 0; empty output when nothing matches.
"""
import json
import re
import sys
from pathlib import Path

from . import activity, capture, config, db

GENERIC_TOKENS = {"src", "repo", "repos", "project", "projects", "code",
                  "work", "home", "users", "tmp", "dev", "app", "lib"}
BODY_CHARS = 140

QUERY_HINT = (
    "Query more: `mindgap find \"<terms>\"` / `mindgap context <id>` "
    "(CLI), or MCP tools mindgap_find / mindgap_context. "
    "Cross-project loop learnings carry tag `global-learning`."
)


def tokens_from_cwd(cwd: str) -> list:
    """Full dir basename first (best LIKE query), then its long-enough parts."""
    name = Path(cwd or "").name.lower()
    if not name:
        return []
    parts = [t for t in re.split(r"[-_.\s]+", name)
             if len(t) >= 3 and t not in GENERIC_TOKENS]
    return ([name] if len(name) >= 3 and name not in GENERIC_TOKENS else []) + \
        [t for t in parts if t != name]


def _token_matches(node: dict, tok: str) -> bool:
    """Body LIKE hits on short common words are noise; require the token in
    id/tags (substring) or title (whole word)."""
    if tok in node["id"].lower():
        return True
    if any(tok in t.lower() for t in node.get("tags") or []):
        return True
    return re.search(rf"\b{re.escape(tok)}\b", (node.get("title") or "").lower()) is not None


def _snippet(body: str) -> str:
    s = " ".join((body or "").split())
    return s[:BODY_CHARS] + ("…" if len(s) > BODY_CHARS else "")


def _line(n: dict) -> str:
    return f"- {n['id']} [{n.get('type', '?')}] {n.get('title', '')} — {_snippet(n.get('body', ''))}"


# Promote-eligible surfacing was REMOVED 2026-09-14 on its own kill criterion:
# three sessions of surfacing, 26 candidates shown at every session start, zero
# ever promoted, rejected or proposed. Surfacing a candidate does not cause
# anyone to decide it — the decision was still a prose step in loop-distill
# (phase 4 verify -> phase 5 gate), the same unenforced-link failure the usage
# counter escaped by moving into a hook. Deleted rather than tuned a third time.
# The ledger rows and their `used:` counters are untouched; they are simply no
# longer advertised. Revive only alongside a mechanical decision step.


def build_digest(hook_input, cfg) -> str:
    conn = db.connect()
    try:
        rcfg = cfg["recall"]
        seen, matched, learnings = set(), [], []
        for tok in tokens_from_cwd(hook_input.get("cwd", "")):
            for n in db.search(conn, q=tok, limit=rcfg["max_nodes"] * 4):
                if n["id"] not in seen and _token_matches(n, tok):
                    seen.add(n["id"])
                    matched.append(n)
        matched = matched[: rcfg["max_nodes"]]
        for n in db.search(conn, tag="global-learning", limit=rcfg["max_global"]):
            if n["id"] not in seen:
                seen.add(n["id"])
                learnings.append(n)
    finally:
        conn.close()
    if not matched and not learnings:
        return ""
    try:   # fire the recalled nodes on the live activity feed (web 'neurons firing')
        # The session id rides in the actor (house convention: `capture:<repo>`,
        # `loop:<name>`) so usage_hook can tell OUR digest from one belonging to a
        # different session, without comparing clocks across two processes.
        # Unstamped when the id is missing: a bare `recall` never matches there,
        # which costs that session its usage bump but never mis-credits another.
        sid = hook_input.get("session_id") or ""
        activity.record("read", [n["id"] for n in matched + learnings],
                        actor=f"recall:{sid}" if sid else "recall")
    except Exception:
        pass   # feed is eye-candy; never break recall
    out = ["## mindgap recall (auto, SessionStart)"]
    if matched:
        out.append(f"Nodes matching this directory ({Path(hook_input.get('cwd', '')).name}):")
        out += [_line(n) for n in matched]
    if learnings:
        out.append("Recent cross-project loop learnings (tag global-learning):")
        out += [_line(n) for n in learnings]
    out.append(QUERY_HINT)
    return "\n".join(out)


def main(stdin_text=None) -> int:
    raw = stdin_text if stdin_text is not None else sys.stdin.read()
    if not raw.strip():
        return 0
    try:
        hook_input = json.loads(raw)
    except json.JSONDecodeError:
        return 0
    cfg = capture.load_config()
    if not cfg["recall"].get("enabled"):
        return 0
    if capture._dir_listed(hook_input.get("cwd", ""), cfg.get("denylist_dirs", [])):
        return 0
    if not config.db_path().exists():
        return 0
    try:
        digest = build_digest(hook_input, cfg)
    except Exception:
        return 0  # recall is best-effort; never break session start
    if digest:
        print(digest)
    return 0


if __name__ == "__main__":
    sys.exit(main())
