"""SessionEnd hook: cheap pre-gate, then a detached headless capture subagent.

Registered globally in ~/.claude/settings.json (SessionEnd). Reads the hook JSON
on stdin ({session_id, transcript_path, cwd, reason}) and NEVER blocks session
exit: it spawns a detached supervisor and returns 0 immediately. The supervisor
runs `claude -p` with only the tools capture needs pre-approved (a headless run
denies everything else), kills it after capture.timeout_s, and releases the lock.
One line per session end goes to <data_dir>/capture.log; child output to
<data_dir>/capture-child.log.
"""
import json
import os
import shutil
import subprocess
import sys
import time
from pathlib import Path

from . import capture, config

PROMPT = (
    "Invoke the knowledge-capture skill. Read the session transcript at {transcript} "
    "(cwd was {cwd}, session {session}). The domain is: {domain} FIRST judge on-domain "
    "relevance against it; if off-domain, "
    "write nothing and stop. If on-domain, distill durable learnings and ingest them via "
    "the mindgap MCP, following AGENTS.md: run mindgap_context first to dedup, "
    "upsert with created_by='capture:{repo}', confidence={conf}, and a urls entry "
    "{{label:'session {session}', url:'file://{transcript}', kind:'web'}}. Cap at "
    "{maxn} nodes."
)

# Both server names: plugin install, and the repo checkout's .mcp.json.
MCP_PREFIXES = ("mcp__plugin_mindgap_mindgap__", "mcp__mindgap__")
MCP_TOOLS = ("mindgap_context", "mindgap_find", "mindgap_ingest")


def build_prompt(hook_input, cfg) -> str:
    cwd = hook_input.get("cwd", "") or ""
    repo = Path(cwd).name or "unknown"
    return PROMPT.format(
        transcript=hook_input.get("transcript_path", ""),
        cwd=cwd, session=hook_input.get("session_id", ""), repo=repo,
        domain=cfg["domain"]["description"] or "(none configured)",
        conf=cfg["capture"]["default_confidence"],
        maxn=cfg["capture"]["max_nodes_per_session"],
    )


def allowed_tools(transcript) -> list:
    # `//` prefix = absolute path in a permission rule.
    return [f"Read(/{transcript})"] + [p + t for p in MCP_PREFIXES for t in MCP_TOOLS]


def log(line) -> None:
    try:
        with open(config.data_dir() / "capture.log", "a") as f:
            f.write(time.strftime("%Y-%m-%dT%H:%M:%S ") + line + "\n")
    except OSError:
        pass


def spawn(claude, hook_input, cfg):
    """Detached supervisor (this module, --supervise) so the hook returns at once."""
    job = {"cmd": [claude, "-p", build_prompt(hook_input, cfg),
                   "--allowedTools", *allowed_tools(hook_input.get("transcript_path", "")),
                   "--model", cfg["capture"]["model"]],
           "timeout_s": cfg["capture"]["timeout_s"],
           "session": hook_input.get("session_id", "")}
    pkg_parent = str(Path(__file__).resolve().parents[1])
    env = dict(os.environ, MINDGAP_CAPTURE="1",
               PYTHONPATH=pkg_parent + os.pathsep + os.environ.get("PYTHONPATH", ""))
    return subprocess.Popen(
        [sys.executable, "-m", "mindgap.capture_hook", "--supervise", json.dumps(job)],
        stdin=subprocess.DEVNULL, stdout=subprocess.DEVNULL,
        stderr=subprocess.DEVNULL, start_new_session=True, env=env,
    )


def supervise(job) -> int:
    """Run the capture child, kill it after timeout_s, always release the lock."""
    try:
        with open(config.data_dir() / "capture-child.log", "a") as out:
            child = subprocess.Popen(job["cmd"], stdin=subprocess.DEVNULL,
                                     stdout=out, stderr=subprocess.STDOUT)
            try:
                status = child.wait(timeout=job["timeout_s"])
            except subprocess.TimeoutExpired:
                child.kill()
                child.wait()
                status = "timeout"
        log(f"session={job['session']} exit={status}")
    finally:
        capture.release_lock()
    return 0


def main(stdin_text=None) -> int:
    raw = stdin_text if stdin_text is not None else sys.stdin.read()
    if not raw.strip():
        return 0
    try:
        hook_input = json.loads(raw)
    except json.JSONDecodeError:
        return 0
    cfg = capture.load_config()
    ok, reason = capture.pregate(
        hook_input.get("transcript_path"), hook_input.get("cwd", ""), cfg)
    tag = f"session={hook_input.get('session_id', '')} cwd={hook_input.get('cwd', '')}"
    if not ok:
        log(f"{tag} gate={reason}")
        return 0
    claude = shutil.which("claude")
    if not claude:
        log(f"{tag} gate=ok skip=no-claude")
        return 0
    # TTL outlives the supervisor's kill, so it is only a crash backstop.
    if not capture.acquire_lock(ttl_s=cfg["capture"]["timeout_s"] + 30):
        log(f"{tag} gate=ok skip=locked")
        return 0
    proc = spawn(claude, hook_input, cfg)
    log(f"{tag} gate=ok pid={proc.pid}")
    return 0


if __name__ == "__main__":
    if len(sys.argv) == 3 and sys.argv[1] == "--supervise":
        sys.exit(supervise(json.loads(sys.argv[2])))
    sys.exit(main())
