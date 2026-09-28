#!/usr/bin/env python3
"""Re-enact a finished idea-court Workflow as a live-view run, clock compressed.

Copies the real agents' results into a fake transcript dir one at a time (in
their real completion order), so the page exercises the same live-tailing path
a running Workflow would, then emits the orchestrator-level events (claims,
reconciled verdicts, ruling, decision, kill fork, dissent) parsed from the
judge's ruling markdown. Orchestrator events are marked actor="orchestrator
(replay)" — they are reconstructions, not the original session's emits.

    python3 tools/live_view_replay.py <session-dir> <wf-runId> --run-id replay-shunt --step 3
"""
import argparse
import json
import re
import sys
import time
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parents[1]))
from mindgap import config, runs  # noqa: E402

ACTOR = "orchestrator (replay)"


def _jsonl(path):
    return [json.loads(l) for l in path.read_text().splitlines() if l.strip()]


def _write_atomic(path, text):
    tmp = path.with_suffix(path.suffix + ".tmp")
    tmp.write_text(text)
    tmp.replace(path)


def _section(md, title):
    m = re.search(r"^## " + re.escape(title) + r"[^\n]*\n(.*?)(?=^## |\Z)", md, re.S | re.M)
    return m.group(1).strip().strip("-").strip() if m else ""


def main(argv=None):
    ap = argparse.ArgumentParser()
    ap.add_argument("session_dir")
    ap.add_argument("wf_run_id")
    ap.add_argument("--run-id", default=None)
    ap.add_argument("--step", type=float, default=3.0, help="seconds between agent completions")
    a = ap.parse_args(argv)

    sess = Path(a.session_dir).expanduser()
    src_tdir = sess / "subagents" / "workflows" / a.wf_run_id
    wf = json.loads((sess / "workflows" / f"{a.wf_run_id}.json").read_text())
    script = Path(wf["scriptPath"]).read_text() if Path(wf["scriptPath"]).exists() else wf.get("script", "")
    progress = [p for p in wf["workflowProgress"] if p.get("type") == "workflow_agent"]
    journal = {j["agentId"]: j for j in _jsonl(src_tdir / "journal.jsonl") if j["type"] == "result"}

    def finished_at(aid):          # real completion = last transcript line
        lines = (src_tdir / f"agent-{aid}.jsonl").read_text().splitlines()
        return json.loads(lines[-1]).get("timestamp", "")
    order = sorted(progress, key=lambda p: (p.get("phaseIndex", 0), finished_at(p["agentId"])))

    rid = runs.start("idea-court", f"Replay: {wf.get('workflowName', a.wf_run_id)}", run_id=a.run_id)
    rdir = config.runs_dir() / rid / "replay" / "sess"
    tdir = rdir / "subagents" / "workflows" / a.wf_run_id
    tdir.mkdir(parents=True, exist_ok=True)
    (rdir / "workflows").mkdir(exist_ok=True)
    state_path = rdir / "workflows" / f"{a.wf_run_id}.json"
    runs.emit(rid, "note", {"text": f"Replay of {a.wf_run_id} ({wf.get('timestamp', '')[:10]}): {wf.get('summary', '')}. "
                                    f"Real run took {wf.get('durationMs', 0) // 60000} min over {wf.get('agentCount')} agents; "
                                    f"compressed to {a.step:g}s per completion."}, actor=ACTOR)

    for cid, title in re.findall(r"id: '([^']+)',\s*\n\s*title: '((?:[^'\\]|\\.)*)'", script):
        runs.emit(rid, "claim", {"text": title.replace("\\'", "'")}, subject=cid, actor=ACTOR)

    live = {p["agentId"]: dict(p, state="queued", lastToolSummary=None) for p in progress}

    def flush():
        _write_atomic(state_path, json.dumps({"status": "running", "workflowProgress": list(live.values())}))

    def begin(phase):
        runs.emit(rid, "phase.start", {"title": phase}, phase=phase, actor=ACTOR)
        for p in progress:
            if p.get("phaseTitle") == phase:
                live[p["agentId"]]["state"] = "running"
                with open(tdir / "journal.jsonl", "a") as f:   # append: earlier phases' results stay
                    f.write(json.dumps({"type": "started", "key": "replay", "agentId": p["agentId"]}) + "\n")
        flush()

    flush()
    runs.bind_workflow(rid, str(tdir))
    print(f"{rid}\nlive view: /runs/{rid}", flush=True)
    phase = None
    for p in order:
        if p.get("phaseTitle") != phase:
            phase = p.get("phaseTitle")
            begin(phase)
        time.sleep(a.step)
        aid = p["agentId"]
        live[aid].update(state="done", lastToolSummary=p.get("lastToolSummary"))
        with open(tdir / "journal.jsonl", "a") as f:
            f.write(json.dumps(journal.get(aid, {"type": "result", "agentId": aid, "result": None})) + "\n")
        flush()

    ruling = (wf.get("result") or {}).get("ruling", "")
    ruling = re.sub(r"^```markdown\n|```\s*$", "", ruling.strip())
    head = ruling.split("\n---", 1)[0]
    head = re.sub(r"^# [^\n]*\n", "", head).strip()
    runs.emit(rid, "ruling", {"text": head}, phase="Adjudicate", actor=ACTOR)
    for row in re.findall(r"^\| (C\d[^|]*)\| ([^|]+)\| ([^|]+)\|", _section(ruling, "Claim table"), re.M):
        cid, verdict, why = (c.strip() for c in row)
        runs.emit(rid, "verdict", {"overall": re.sub(r"\*.*?\*", "", verdict).strip(), "text": why},
                  subject=cid.replace(" ", "-"), phase="Adjudicate", actor=ACTOR)
    runs.emit(rid, "decision", {"value": "no-go",
                                "rationale": "Do not build the gate; ship the outline opt-in plus a log-only hook."},
              phase="Adjudicate", actor=ACTOR)
    kill = _section(ruling, "Kill fork")
    if kill:
        runs.emit(rid, "note", {"text": "Kill fork\n" + kill}, subject="kill-fork", actor=ACTOR)
    dissent = _section(ruling, "Dissent")
    if dissent:
        runs.emit(rid, "note", {"text": "Dissent\n" + dissent}, subject="dissent", actor=ACTOR)
    runs.emit(rid, "question.ask", {"text": "Stage this ruling into the graph as decision-shunt-plugin-not-built?",
                                    "options": ["Yes, stage it", "Hold, I want to contest a verdict first"]},
              phase="Stage", actor=ACTOR)
    wf_done = json.loads(state_path.read_text())
    wf_done["status"] = "completed"
    _write_atomic(state_path, json.dumps(wf_done))
    print("replay complete", flush=True)


if __name__ == "__main__":
    main()
