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
# Row parsing is defined once, in usage_hook, and imported — restating a shared
# format in a second module is how the two copies drift apart.
from .usage_hook import MAP_RE, ROW_RE, USAGE_RE

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


PROMOTE_MIN = 2        # the countable promote trigger: used: >= 2
PROMOTE_SHOW = 3       # surface only the top few; this rides in EVERY session
_DECIDED = re.compile(r"status:(promoted|rejected|proposed-skill)")


def promote_eligible(path=None) -> list:
    """Ledger rows at used:>=PROMOTE_MIN carrying no decision, strongest first.

    This is link 4 of the promote chain. The counter now moves (the SessionEnd
    usage hook), and 18 rows crossed the threshold without one ever being put to
    a human — because nothing in the system surfaces an outstanding candidate at
    a moment someone could act on it. Prose steps here are followed at roughly
    chance; the recall hook fires every session. So the surfacing rides the
    mechanism with the perfect record instead of a protocol step.

    Returns [(used, node_id), ...]. Cheap: one file read, no DB.
    """
    p = path or config.ledger_path()
    if not p.exists():
        return []
    out = []
    for line in p.read_text(encoding="utf-8", errors="replace").splitlines():
        if not ROW_RE.match(line) or _DECIDED.search(line):
            continue
        m = USAGE_RE.search(line)
        if not m or int(m.group(1)) < PROMOTE_MIN:
            continue
        nid = MAP_RE.search(line)
        out.append((int(m.group(1)), nid.group(1) if nid else "(unmirrored)"))
    out.sort(key=lambda t: -t[0])
    return out


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
        activity.record("read", [n["id"] for n in matched + learnings], actor="recall")
    except Exception:
        pass   # feed is eye-candy; never break recall
    out = ["## mindgap recall (auto, SessionStart)"]
    if matched:
        out.append(f"Nodes matching this directory ({Path(hook_input.get('cwd', '')).name}):")
        out += [_line(n) for n in matched]
    if learnings:
        out.append("Recent cross-project loop learnings (tag global-learning):")
        out += [_line(n) for n in learnings]
    try:
        elig = promote_eligible()
    except Exception:
        elig = []          # surfacing is best-effort; never break recall
    if elig:
        top = ", ".join(f"{nid} (used:{u})" for u, nid in elig[:PROMOTE_SHOW])
        out.append(
            f"Promote-eligible: {len(elig)} ledger row(s) at used:>={PROMOTE_MIN} "
            f"with no decision recorded. Strongest: {top}."
        )
        out.append(
            "These are candidates for a skill rule. Deciding is loop-distill's "
            "(phase 4 verify -> phase 5 gate); until then each stays a candidate."
        )
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
