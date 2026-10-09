#!/usr/bin/env python3
"""Re-enact a deep-research planning session from its Claude Code transcript.

Reads the session JSONL and emits what a live-view-wired deep-research run would have:
`claim` per gap line ("G<n> · <gap> — evidence: ..."), `phase.start` for GROUND / GAP /
DIVERGE / CONVERGE / PAY BACK at the moments they happened, `question.ask` +
`question.answer` for every AskUserQuestion (the real questions, options and answers),
the gap outcomes read from the plan doc it wrote (an `RQn (Gx)` line -> ADDRESSED; a
`(Gx)` mention under "Evidence so far" -> COVERED), and `decision` go at PAY BACK.
Real timestamps, scaled into --duration. Events carry actor="orchestrator (replay)".

    python3 tools/live_view_replay_session.py ~/.claude/projects/<proj>/<session>.jsonl --run-id dr-replay
"""
import argparse
import json
import re
import sys
import time
from datetime import datetime
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parents[1]))
from mindgap import runs  # noqa: E402

ACTOR = "orchestrator (replay)"
GAP = re.compile(r"^G(\d+) · (.+)$", re.M)


def ms(ts):
    return datetime.fromisoformat(ts.replace("Z", "+00:00")).timestamp() * 1000


def scan(path):
    """Timeline of (ms, kind, payload) pulled from the transcript."""
    out, asks = [], {}
    for line in Path(path).expanduser().read_text().splitlines():
        try:
            rec = json.loads(line)
        except ValueError:
            continue
        ts = rec.get("timestamp")
        if not ts:
            continue
        content = (rec.get("message") or {}).get("content")
        blocks = content if isinstance(content, list) else []
        for b in blocks:
            if not isinstance(b, dict):
                continue
            if b.get("type") == "text" and GAP.search(b.get("text", "")):
                out.append((ms(ts), "gaps", GAP.findall(b["text"])))
            if b.get("type") != "tool_use":
                continue
            name, inp = b.get("name", ""), b.get("input") or {}
            if name == "Skill" and inp.get("skill") == "deep-research":
                out.append((ms(ts), "phase", "GROUND"))
            elif name == "AskUserQuestion":
                asks[b.get("id")] = inp.get("questions") or []
                out.append((ms(ts), "ask", (b.get("id"), asks[b.get("id")])))
            elif name == "Write" and "/docs/research/" in inp.get("file_path", ""):
                out.append((ms(ts), "plan", inp["file_path"]))
            elif name.endswith("mindgap_ingest") and any(
                    str(n.get("id", "")).startswith("research-plan-") for n in inp.get("nodes") or []):
                out.append((ms(ts), "payback", [n["id"] for n in inp["nodes"]]))
        res = rec.get("toolUseResult")
        if isinstance(res, dict) and "answers" in res:
            tid = next((b.get("tool_use_id") for b in blocks if isinstance(b, dict) and b.get("type") == "tool_result"), None)
            out.append((ms(ts), "answer", (tid, res.get("answers") or {})))
    out.sort(key=lambda x: x[0])
    return out


def outcomes(plan_md):
    got = {}
    for rq, gaps in re.findall(r"^(RQ\d+) \(([^)]*)\)", plan_md, re.M):
        for g in re.findall(r"G\d+", gaps):
            got.setdefault(g, ("ADDRESSED", rq))
    ev = re.search(r"^## Evidence so far\n(.*?)(?=^## )", plan_md, re.S | re.M)
    for g in re.findall(r"\((G\d+)\)", ev.group(1) if ev else ""):
        got.setdefault(g, ("COVERED", "evidence so far"))
    return got


def main(argv=None):
    ap = argparse.ArgumentParser()
    ap.add_argument("transcript")
    ap.add_argument("--run-id", default=None)
    ap.add_argument("--duration", type=float, default=45.0)
    a = ap.parse_args(argv)
    tl = scan(a.transcript)
    start = next((t for t, k, _ in tl if k == "phase"), None)
    end = next((t for t, k, _ in tl if k == "payback"), None)
    if start is None or end is None:
        sys.exit("no deep-research session (Skill call .. research-plan ingest) found in transcript")
    tl = [x for x in tl if start <= x[0] <= end]
    scale = a.duration * 1000 / max(1, end - start)
    rid = runs.start("deep-research", "Replay: deep-research planning session", run_id=a.run_id)
    print(f"{rid}\nlive view: /runs/{rid}", flush=True)
    runs.emit(rid, "note", {"text": f"Replay of a real deep-research session from its transcript: "
                                    f"{(end - start) / 60000:.0f} min of planning compressed to {a.duration:g}s."}, actor=ACTOR)
    clock0, seen_gaps, diverge, plan, pending = time.monotonic(), False, False, None, {}
    for t, kind, p in tl:
        time.sleep(max(0.0, (t - start) * scale / 1000 - (time.monotonic() - clock0)))
        if kind == "phase":
            runs.emit(rid, "phase.start", {"title": p}, phase=p, actor=ACTOR)
        elif kind == "gaps" and not seen_gaps:
            seen_gaps = True
            runs.emit(rid, "phase.start", {"title": "GAP"}, phase="GAP", actor=ACTOR)
            for n, gap in p:
                runs.emit(rid, "claim", {"text": gap}, subject=f"G{n}", actor=ACTOR)
        elif kind == "ask":        # emitted when asked, answered later: the gap is the user's think time
            if not diverge:
                diverge = True
                runs.emit(rid, "phase.start", {"title": "DIVERGE"}, phase="DIVERGE", actor=ACTOR)
            tid, qs = p
            pending[tid] = [(q.get("question"), runs.emit(rid, "question.ask", {
                "text": q.get("question", ""), "options": [o.get("label") for o in q.get("options", [])]},
                phase="DIVERGE", actor=ACTOR)["seq"]) for q in qs]
        elif kind == "answer":
            tid, answers = p
            for q, seq in pending.pop(tid, []):
                if answers.get(q):
                    runs.emit(rid, "question.answer", {"ref": seq, "text": answers[q]}, phase="DIVERGE", actor="user (replay)")
        elif kind == "plan" and plan is None:
            plan = p
            runs.emit(rid, "phase.start", {"title": "CONVERGE"}, phase="CONVERGE", actor=ACTOR)
            runs.emit(rid, "artifact", {"kind": "research-plan", "path": p}, phase="CONVERGE", actor=ACTOR)
            md = Path(p).read_text() if Path(p).exists() else ""
            for g, (v, why) in sorted(outcomes(md).items(), key=lambda x: int(x[0][1:])):
                runs.emit(rid, "verdict", {"overall": v, "text": f"{v.lower()} by {why}", "iteration": "CONVERGE"},
                          subject=g, phase="CONVERGE", actor=ACTOR)
        elif kind == "payback":
            runs.emit(rid, "phase.start", {"title": "PAY BACK"}, phase="PAY BACK", actor=ACTOR)
            runs.emit(rid, "decision", {"value": "go", "rationale": f"plan approved; registered as {', '.join(p)}"},
                      phase="PAY BACK", actor=ACTOR)
    runs.emit(rid, "run.end", {}, actor=ACTOR)
    print("replay complete", flush=True)


if __name__ == "__main__":
    main()
