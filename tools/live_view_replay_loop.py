#!/usr/bin/env python3
"""Re-enact a loop-system loop's history as a live-view run, clock compressed.

Reads <loop>/GOAL.md §2 (criteria table) and <loop>/STATE.md `Iteration log`, then
emits what a live-view-wired orchestrator would have: `claim` per criterion, per
iteration a maker and a verifier (agent.start/agent.done), and per-criterion
`verdict`s parsed from the log line's verdict text. The parse is heuristic ("C2 PASS",
"gaps(2) — C2 ... C3 ...", "ALL 6 CRITERIA PASS"), so every event is marked
actor="orchestrator (replay)" — a reconstruction, not the original session's emits.

    python3 tools/live_view_replay_loop.py self-learning-loop/web-perf --run-id web-perf-replay --duration 60
"""
import argparse
import re
import sys
import time
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parents[1]))
from mindgap import runs  # noqa: E402

ACTOR = "orchestrator (replay)"
LINE = re.compile(r"^-?\s*(\d+)\.(\d+)\s*·\s*class:([^·]+)·\s*tier:([^·]+)·\s*maker:\s*(.*?)\s*·?\s*verdict:\s*(.*)$")


def criteria(goal_md):
    sec = re.search(r"^## 2 ·.*?$(.*?)^## ", goal_md, re.S | re.M)
    rows = re.findall(r"^\|\s*(\d+)\s*\|\s*([^|]+)\|", sec.group(1) if sec else "", re.M)
    return [(f"C{n}", t.strip()) for n, t in rows]


def iterations(state_md):
    sec = re.search(r"^## Iteration log.*?$(.*?)^## ", state_md, re.S | re.M)
    return [m.groups() for line in (sec.group(1) if sec else "").splitlines() if (m := LINE.match(line.strip()))]


def grade(verdict, ids):
    """Per-criterion PASS/FAIL named in one iteration's verdict text."""
    out = {}
    m = re.search(r"ALL (\d+) CRITERIA PASS", verdict, re.I)
    if m:
        out.update({f"C{i}": "PASS" for i in range(1, int(m.group(1)) + 1)})
    for group, v in re.findall(r"((?:C\d+)(?:/C\d+)*)(?:-\w+)?\s+(PASS|FAIL)", verdict):
        out.update({c: v for c in group.split("/")})
    for c in re.findall(r"PASS \((C\d+)", verdict):
        out[c] = "PASS"
    g = re.search(r"gaps\(\d+\)\s*[—-]+\s*(.*?)(?:\.\s|$)", verdict)
    if g:
        for c in re.findall(r"\b(C\d+)\b", g.group(1)):
            out.setdefault(c, "FAIL")
    return {c: v for c, v in out.items() if c in ids}


def main(argv=None):
    ap = argparse.ArgumentParser()
    ap.add_argument("loop_dir")
    ap.add_argument("--run-id", default=None)
    ap.add_argument("--duration", type=float, default=60.0)
    a = ap.parse_args(argv)
    loop = Path(a.loop_dir)
    crit = criteria((loop / "GOAL.md").read_text())
    state = (loop / "STATE.md").read_text()
    its = iterations(state)
    if not crit or not its:
        sys.exit("no criteria table or iteration log found")
    ids = {c for c, _ in crit}
    sessions = sorted({int(s) for s, *_ in its})
    rid = runs.start("loop-system", f"Replay: {loop.name} loop (sessions {sessions[0]}–{sessions[-1]})", run_id=a.run_id)
    print(f"{rid}\nlive view: /runs/{rid}", flush=True)
    runs.emit(rid, "note", {"text": f"Replay of {loop.name}: {len(its)} iterations over {len(sessions)} sessions, "
                                    f"reconstructed from STATE.md's iteration log (criteria verdicts parsed from its "
                                    f"verdict text). Compressed to {a.duration:g}s."}, actor=ACTOR)
    for c, text in crit:
        runs.emit(rid, "claim", {"text": text}, subject=c, actor=ACTOR)
    slot = a.duration / len(its)
    status = {}
    for s, i, cls, tier, maker, verdict in its:
        it = f"{s}.{i}"
        model = re.split(r"[(\s→]", tier.strip())[0]
        runs.emit(rid, "phase.start", {"title": f"{it} make"}, phase=f"{it} make", actor=ACTOR)
        runs.emit(rid, "agent.start", {"id": f"m{it}", "label": f"maker:{cls.strip()}", "model": model},
                  phase=f"{it} make", actor=ACTOR)
        time.sleep(slot * 0.55)
        runs.emit(rid, "agent.done", {"id": f"m{it}", "headline": maker[:400]}, actor=ACTOR)
        runs.emit(rid, "phase.start", {"title": f"{it} verify"}, phase=f"{it} verify", actor=ACTOR)
        runs.emit(rid, "agent.start", {"id": f"v{it}", "label": "verifier", "model": model},
                  phase=f"{it} verify", actor=ACTOR)
        time.sleep(slot * 0.45)
        graded = grade(verdict, ids)
        overall = "FAIL" if "FAIL" in graded.values() or re.search(r"gaps\(\d", verdict) else \
            "PASS" if re.match(r"\**(PASS|LOOP COMPLETE)", verdict.strip()) or graded else "DONE"
        runs.emit(rid, "agent.done", {"id": f"v{it}", "verdict": overall, "headline": verdict[:400]}, actor=ACTOR)
        for c, v in graded.items():
            status[c] = v
            runs.emit(rid, "verdict", {"overall": v, "iteration": it, "text": verdict[:240]},
                      subject=c, phase=f"{it} verify", actor=ACTOR)
        n_pass = sum(v == "PASS" for v in status.values())
        runs.emit(rid, "status", {"text": f"after {it}: {n_pass} of {len(crit)} criteria passing"}, actor=ACTOR)
    # loop-system completes exactly when every GOAL §2 criterion passes; STATE's status line is the fallback
    all_pass = all(status.get(c) == "PASS" for c in ids)
    m = re.search(r"Loop status:\**\s*([^\n]+)", state)
    ls = (m.group(1) if m else "").lower()
    value = "go" if all_pass or "complete" in ls else "no-go" if "escalat" in ls else "hold"
    why = f"all {len(ids)} criteria pass — loop complete" if all_pass else \
        f"{sum(v == 'PASS' for v in status.values())} of {len(ids)} criteria pass; Loop status: {m.group(1).strip() if m else 'unrecorded'}"
    runs.emit(rid, "decision", {"value": value, "rationale": why}, actor=ACTOR)
    runs.emit(rid, "run.end", {}, actor=ACTOR)           # SESSION END, as the protocol ends every session
    print("replay complete", flush=True)


if __name__ == "__main__":
    main()
