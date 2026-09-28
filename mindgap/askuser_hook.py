"""PreToolUse + PostToolUse hook (matcher AskUserQuestion): mirror the questions
Claude asks, and the answers, into the session's live-view run — so no skill has to
emit question.ask / question.answer by hand.

Measured 2026-09-28 (fact-askuserquestion-hook-payloads): PreToolUse fires when the
question is asked, PostToolUse when it is answered (tool_response.answers is keyed by
question text); both carry the same tool_use_id, and session_id equals the
CLAUDE_CODE_SESSION_ID that runs.start() stamps into view.json. So:

- Pre  -> one question.ask per question (tool_use_id + index), unless already mirrored
- Post -> one question.answer per answered question, unless the page answered first;
          if Pre never fired, the asks are emitted retroactively first
- the run is the newest OPEN run (no run.end) of THIS session; none -> write nothing,
  so a concurrent session's run is never touched. Subagent calls (agent_id) are skipped.

Registered async by `mindgap install`; reads stdin, never prints, always exits 0.
"""
import json
import sys

from . import runs


def _run_for(session_id):
    if not session_id:
        return None
    for v in runs.list_runs():                     # newest first
        if v.get("session") != session_id:
            continue
        if not any(e["kind"] == "run.end" for e in runs.events(v["id"])):
            return v["id"]
    return None


def _asks(rid, tool_use_id):
    return {e["data"].get("qi"): e for e in runs.events(rid)
            if e["kind"] == "question.ask" and e["data"].get("tool_use_id") == tool_use_id}


def _emit_asks(rid, tid, questions, retroactive=False):
    have = _asks(rid, tid)
    for i, q in enumerate(questions):
        if i in have:
            continue
        data = {"text": q.get("question", ""), "options": [o.get("label") for o in q.get("options", [])],
                "multiSelect": bool(q.get("multiSelect")), "tool_use_id": tid, "qi": i}
        if retroactive:
            data["retroactive"] = True
        have[i] = runs.emit(rid, "question.ask", data, actor="hook")
    return have


def handle(payload):
    if payload.get("tool_name") != "AskUserQuestion" or payload.get("agent_id"):
        return
    rid = _run_for(payload.get("session_id"))
    if rid is None:
        return
    tid = payload.get("tool_use_id")
    questions = (payload.get("tool_input") or {}).get("questions") or []
    event = payload.get("hook_event_name")
    if event == "PreToolUse":
        _emit_asks(rid, tid, questions)
    elif event == "PostToolUse":
        answers = ((payload.get("tool_response") or {}).get("answers")) or {}
        asks = _emit_asks(rid, tid, questions, retroactive=True)
        answered = {e["data"].get("ref") for e in runs.events(rid)
                    if e["kind"] in ("question.answer", "user.answer")}
        for i, q in enumerate(questions):
            ask, text = asks.get(i), answers.get(q.get("question"))
            if ask and text and ask["seq"] not in answered:
                runs.emit(rid, "question.answer", {"ref": ask["seq"], "text": text, "tool_use_id": tid},
                          actor="user")


def main():
    try:
        handle(json.loads(sys.stdin.read() or "{}"))
    except Exception:   # a hook must never break the question it mirrors
        pass
    return 0


if __name__ == "__main__":
    sys.exit(main())
