"""Live-view run logs: one dir per monitored skill run (idea-court, loop-system,
...), rendered live by the web shell at /runs/<id> and frozen into report.html.

<runs_dir>/<run-id>/
    view.json     {id, skill, title, created, workflows: [transcriptDir...]}
    events.jsonl  append-only, seq-numbered; writers: the orchestrator (CLI
                  `mindgap run emit`) and the page (via post_inbox)
    inbox.jsonl   page -> orchestrator messages; the orchestrator watches it
                  with `mindgap run inbox <id>` under Monitor
    panels/*.js   bespoke per-run panels written by the page-builder agent
    report.html   self-contained snapshot (no network) written by report()

Event: {"seq", "ts" (epoch ms), "run", "kind", "actor", "phase", "subject", "data"}

Workflow scripts cannot write files, so per-agent progress inside a running
Workflow is read passively from its transcript dir (fact-workflow-tool-disk-
schema): <session>/workflows/wf_<id>.json carries labels/phase/state, and
journal.jsonl carries each agent's actual return value.
"""
import fcntl
import json
import re
import time
from pathlib import Path

from . import config

ID_RE = re.compile(r"^[A-Za-z0-9][A-Za-z0-9._-]{0,119}$")

KINDS = {
    "run.start", "run.end", "phase.start", "phase.end", "workflow.bind",
    "claim", "verdict", "ruling", "decision", "status", "artifact", "note",
    "question.ask", "question.answer",            # agent -> user
    "user.ask", "user.answer", "flag.contest",   # user -> agent (page inbox)
    "reply",                                     # agent's answer to a user.ask
}
USER_KINDS = {"user.ask", "user.answer", "flag.contest"}


def _dir(run_id, must_exist=True) -> Path:
    if not isinstance(run_id, str) or not ID_RE.match(run_id):
        raise ValueError(f"invalid run id: {run_id!r}")
    d = config.runs_dir() / run_id
    if must_exist and not (d / "view.json").is_file():
        raise ValueError(f"unknown run: {run_id}")
    return d


def _now_ms():
    return int(time.time() * 1000)


def start(skill, title, run_id=None) -> str:
    run_id = run_id if run_id is not None else f"{time.strftime('%Y%m%d-%H%M%S')}-{skill}"
    d = _dir(run_id, must_exist=False)
    d.mkdir(parents=True, exist_ok=True)
    view = {"id": run_id, "skill": skill, "title": title, "created": _now_ms(), "workflows": []}
    (d / "view.json").write_text(json.dumps(view, indent=2), encoding="utf-8")
    emit(run_id, "run.start", {"skill": skill, "title": title})
    return run_id


def view(run_id) -> dict:
    return json.loads((_dir(run_id) / "view.json").read_text(encoding="utf-8"))


def emit(run_id, kind, data=None, actor="orchestrator", phase=None, subject=None) -> dict:
    """Append one event under an exclusive lock so concurrent writers (CLI +
    server thread) never share a seq."""
    d = _dir(run_id)
    if kind not in KINDS:
        raise ValueError(f"unknown event kind: {kind!r}")
    data = {} if data is None else data
    if not isinstance(data, dict):
        raise ValueError("event data must be a JSON object")
    with open(d / "events.jsonl", "a+", encoding="utf-8") as f:
        fcntl.flock(f, fcntl.LOCK_EX)
        f.seek(0)
        seq = sum(1 for _ in f) + 1
        evt = {"seq": seq, "ts": _now_ms(), "run": run_id, "kind": kind, "actor": str(actor),
               "phase": phase, "subject": subject, "data": data}
        f.write(json.dumps(evt) + "\n")
        f.flush()
    return evt


def events(run_id, since=0) -> list:
    path = _dir(run_id) / "events.jsonl"
    if not path.exists():
        return []
    out = []
    for line in path.read_text(encoding="utf-8").splitlines():
        try:
            evt = json.loads(line)
        except ValueError:
            continue
        if evt.get("seq", 0) > since:
            out.append(evt)
    return out


def panels_dir(run_id) -> Path:
    return _dir(run_id) / "panels"


def list_runs() -> list:
    out = []
    for d in config.runs_dir().iterdir():
        try:
            out.append(json.loads((d / "view.json").read_text(encoding="utf-8")))
        except (OSError, ValueError):
            continue
    return sorted(out, key=lambda v: v.get("created", 0), reverse=True)


# ---- page -> orchestrator inbox ------------------------------------------

def post_inbox(run_id, kind, text, ref=None) -> dict:
    d = _dir(run_id)
    if kind not in USER_KINDS:
        raise ValueError(f"inbox kind must be one of {sorted(USER_KINDS)}")
    if not isinstance(text, str) or not text.strip():
        raise ValueError("empty message")
    evt = emit(run_id, kind, {"text": text.strip(), "ref": ref}, actor="user")
    msg = {"seq": evt["seq"], "ts": evt["ts"], "kind": kind, "text": text.strip(), "ref": ref}
    with open(d / "inbox.jsonl", "a", encoding="utf-8") as f:
        f.write(json.dumps(msg) + "\n")
    return msg


def follow_inbox(run_id, poll=0.5, max_seconds=None):
    """Yield inbox lines appended after the call starts (tail -f semantics), so
    each Monitor notification is one new message from the page."""
    path = _dir(run_id) / "inbox.jsonl"
    path.touch()
    deadline = None if max_seconds is None else time.monotonic() + max_seconds
    with open(path, encoding="utf-8") as f:
        f.seek(0, 2)
        buf = ""
        while deadline is None or time.monotonic() < deadline:
            chunk = f.readline()
            if not chunk:
                time.sleep(poll)
                continue
            buf += chunk
            if buf.endswith("\n"):
                yield buf.rstrip("\n")
                buf = ""


# ---- passive Workflow tailing ---------------------------------------------

def bind_workflow(run_id, transcript_dir) -> None:
    tdir = Path(transcript_dir).expanduser()
    if not tdir.is_dir():
        raise ValueError(f"not a directory: {tdir}")
    d = _dir(run_id)
    v = view(run_id)
    if str(tdir) not in v["workflows"]:
        v["workflows"].append(str(tdir))
        (d / "view.json").write_text(json.dumps(v, indent=2), encoding="utf-8")
    emit(run_id, "workflow.bind", {"transcriptDir": str(tdir), "runId": tdir.name})


def _jsonl(path):
    try:
        lines = path.read_text(encoding="utf-8").splitlines()
    except OSError:
        return []
    out = []
    for line in lines:
        try:
            out.append(json.loads(line))
        except ValueError:
            continue    # a partial last line mid-write
    return out


def _workflow_agents(tdir: Path) -> list:
    results = {j["agentId"]: j.get("result") for j in _jsonl(tdir / "journal.jsonl")
               if j.get("type") == "result" and "agentId" in j}
    started = [j["agentId"] for j in _jsonl(tdir / "journal.jsonl")
               if j.get("type") == "started" and "agentId" in j]
    state_file = tdir.parent.parent.parent / "workflows" / f"{tdir.name}.json"
    progress = []
    try:
        progress = json.loads(state_file.read_text(encoding="utf-8")).get("workflowProgress") or []
    except (OSError, ValueError):
        pass
    agents, seen = [], set()
    for p in progress:
        if p.get("type") != "workflow_agent":
            continue
        aid = p.get("agentId")
        seen.add(aid)
        agents.append({"workflow": tdir.name, "agentId": aid, "label": p.get("label") or aid,
                       "phase": p.get("phaseTitle"), "state": p.get("state"), "model": p.get("model"),
                       "startedAt": p.get("startedAt"), "summary": p.get("lastToolSummary"),
                       "result": results.get(aid)})
    for aid in dict.fromkeys(started):      # agents the state file doesn't know yet
        if aid in seen:
            continue
        agents.append({"workflow": tdir.name, "agentId": aid, "label": aid, "phase": None,
                       "state": "done" if aid in results else "running", "model": None,
                       "startedAt": None, "summary": None, "result": results.get(aid)})
    return agents


def agents(run_id) -> list:
    return [a for t in view(run_id)["workflows"] for a in _workflow_agents(Path(t))]


# ---- frozen report ----------------------------------------------------------

def _script_safe(text):
    # embedded JSON/JS must not be able to close its <script> element
    return text.replace("</", "<\\/")


def report(run_id) -> Path:
    """Freeze the run into one HTML file: local CSS/JS inlined, state embedded as
    window.__RUN__, remote scripts (the three.js hero) dropped — opens offline."""
    d = _dir(run_id)
    web = config.web_dir()
    state = {"view": view(run_id), "events": events(run_id), "agents": agents(run_id)}
    html = (web / "run.html").read_text(encoding="utf-8")
    html = re.sub(r'<link rel="stylesheet" href="/([\w.-]+)">',
                  lambda m: "<style>\n" + (web / m.group(1)).read_text(encoding="utf-8") + "\n</style>", html)
    html = re.sub(r'<script src="https?://[^"]+"></script>\n?', "", html)
    panels = "\n".join(p.read_text(encoding="utf-8") for p in sorted(panels_dir(run_id).glob("*.js")))
    boot = "<script>window.__RUN__ = " + _script_safe(json.dumps(state)) + ";</script>\n"
    html = re.sub(r'<script src="/([\w.-]+)"></script>',
                  lambda m: (boot if m.group(1) == "run.js" else "") + "<script>\n"
                  + _script_safe((web / m.group(1)).read_text(encoding="utf-8")) + "\n</script>", html)
    html = html.replace("</body>", "<script>\n" + _script_safe(panels) + "\n</script>\n</body>")
    html = html.replace("<title>live-view</title>", f"<title>{_esc(state['view']['title'])} — report</title>")
    out = d / "report.html"
    out.write_text(html, encoding="utf-8")
    emit(run_id, "artifact", {"kind": "report", "path": str(out)})
    return out


def _esc(s):
    return str(s).replace("&", "&amp;").replace("<", "&lt;").replace(">", "&gt;")
