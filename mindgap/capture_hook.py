"""SessionEnd hook: cheap pre-gate, then a detached headless capture subagent.

Registered globally in ~/.claude/settings.json (SessionEnd). Reads the hook JSON
on stdin ({session_id, transcript_path, cwd, reason}) and NEVER blocks session
exit: it spawns the subagent fully detached and returns 0 immediately.
"""
import json
import os
import shutil
import subprocess
import sys
from pathlib import Path

from . import capture

PROMPT = (
    "Invoke the knowledge-capture skill. Read the session transcript at {transcript} "
    "(cwd was {cwd}, session {session}). FIRST judge on-domain relevance; if off-domain, "
    "write nothing and stop. If on-domain, distill durable learnings and ingest them via "
    "the mindgap MCP, following AGENTS.md: run mindgap_context first to dedup, "
    "upsert with created_by='capture:{repo}', confidence={conf}, and a urls entry "
    "{{label:'session {session}', url:'file://{transcript}', kind:'web'}}. Cap at "
    "{maxn} nodes. When done, delete the lock file at {lock}."
)


def build_prompt(hook_input, cfg) -> str:
    cwd = hook_input.get("cwd", "") or ""
    repo = Path(cwd).name or "unknown"
    return PROMPT.format(
        transcript=hook_input.get("transcript_path", ""),
        cwd=cwd, session=hook_input.get("session_id", ""), repo=repo,
        conf=cfg["capture"]["default_confidence"],
        maxn=cfg["capture"]["max_nodes_per_session"],
        lock=str(capture._lock_default()),
    )


def spawn(prompt, cfg):
    claude = shutil.which("claude")
    if not claude:
        return None
    env = dict(os.environ, MINDGAP_CAPTURE="1")
    return subprocess.Popen(
        [claude, "-p", prompt, "--model", cfg["capture"]["model"]],
        stdin=subprocess.DEVNULL, stdout=subprocess.DEVNULL,
        stderr=subprocess.DEVNULL, start_new_session=True, env=env,
    )


def main(stdin_text=None) -> int:
    raw = stdin_text if stdin_text is not None else sys.stdin.read()
    if not raw.strip():
        return 0
    try:
        hook_input = json.loads(raw)
    except json.JSONDecodeError:
        return 0
    cfg = capture.load_config()
    ok, _reason = capture.pregate(
        hook_input.get("transcript_path"), hook_input.get("cwd", ""), cfg)
    if not ok:
        return 0
    if not capture.acquire_lock(ttl_s=cfg["capture"]["timeout_s"]):
        return 0
    spawn(build_prompt(hook_input, cfg), cfg)  # detached; subagent removes the lock
    return 0


if __name__ == "__main__":
    sys.exit(main())
