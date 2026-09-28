"""Tests for mindgap/runs.py — the live-view run log (events, inbox,
workflow tailing, frozen report)."""
import json
import os
import tempfile
import threading
import time
import unittest
from pathlib import Path

from mindgap import config, runs


class _Env(unittest.TestCase):
    def setUp(self):
        self.tmp = tempfile.TemporaryDirectory()
        self._home = os.environ.get("MINDGAP_HOME")
        os.environ["MINDGAP_HOME"] = self.tmp.name

    def tearDown(self):
        if self._home is None:
            os.environ.pop("MINDGAP_HOME", None)
        else:
            os.environ["MINDGAP_HOME"] = self._home
        self.tmp.cleanup()


class RunsTest(_Env):
    def test_start_creates_run_and_start_event(self):
        rid = runs.start("idea-court", "Shunt court", run_id="r1")
        self.assertEqual(rid, "r1")
        self.assertTrue((config.runs_dir() / "r1" / "view.json").is_file())
        view = runs.view("r1")
        self.assertEqual(view["skill"], "idea-court")
        self.assertEqual(view["title"], "Shunt court")
        evts = runs.events("r1")
        self.assertEqual([e["kind"] for e in evts], ["run.start"])
        self.assertEqual(evts[0]["seq"], 1)

    def test_generated_id_is_valid(self):
        rid = runs.start("loop-system", "x")
        self.assertRegex(rid, runs.ID_RE.pattern)
        self.assertIn("loop-system", rid)

    def test_emit_seq_and_since(self):
        runs.start("idea-court", "t", run_id="r1")
        runs.emit("r1", "phase.start", {"title": "Verify"}, phase="Verify")
        runs.emit("r1", "verdict", {"overall": "WEAKENED"}, subject="C1", phase="Verify")
        evts = runs.events("r1")
        self.assertEqual([e["seq"] for e in evts], [1, 2, 3])
        self.assertEqual(evts[2]["subject"], "C1")
        self.assertEqual(evts[2]["data"]["overall"], "WEAKENED")
        self.assertEqual([e["seq"] for e in runs.events("r1", since=2)], [3])

    def test_emit_rejects_bad_kind_and_unknown_run(self):
        runs.start("idea-court", "t", run_id="r1")
        with self.assertRaises(ValueError):
            runs.emit("r1", "nonsense", {})
        with self.assertRaises(ValueError):
            runs.emit("nope", "note", {})
        with self.assertRaises(ValueError):
            runs.emit("r1", "note", "not-a-dict")

    def test_bad_run_ids_rejected(self):
        for bad in ["../etc", "a/b", "", "x" * 200, ".hidden"]:
            with self.assertRaises(ValueError):
                runs.start("s", "t", run_id=bad)

    def test_concurrent_emits_keep_unique_seq(self):
        runs.start("idea-court", "t", run_id="r1")
        threads = [threading.Thread(target=runs.emit, args=("r1", "note", {"i": i})) for i in range(20)]
        for t in threads:
            t.start()
        for t in threads:
            t.join()
        seqs = [e["seq"] for e in runs.events("r1")]
        self.assertEqual(sorted(seqs), list(range(1, 22)))

    def test_inbox_post_appends_and_emits(self):
        runs.start("idea-court", "t", run_id="r1")
        msg = runs.post_inbox("r1", "user.ask", "why WEAKENED?", ref=3)
        self.assertEqual(msg["kind"], "user.ask")
        self.assertEqual(runs.events("r1")[-1]["kind"], "user.ask")
        self.assertEqual(runs.events("r1")[-1]["actor"], "user")
        self.assertEqual(runs.events("r1")[-1]["data"]["ref"], 3)
        with self.assertRaises(ValueError):
            runs.post_inbox("r1", "verdict", "users cannot emit verdicts")
        with self.assertRaises(ValueError):
            runs.post_inbox("r1", "user.ask", "   ")

    def _drain(self, rid, secs=0.6):
        """Follow like the CLI does — keep iterating until the Monitor-style deadline —
        so the cursor advances after each hand-off exactly as in production."""
        got = []

        def reader():
            for line in runs.follow_inbox(rid, poll=0.02, max_seconds=secs):
                got.append(json.loads(line))

        t = threading.Thread(target=reader)
        t.start()
        return t, got

    def test_follow_inbox_delivers_backlog_then_tails(self):
        runs.start("idea-court", "t", run_id="r1")
        runs.post_inbox("r1", "user.ask", "before any follower")   # nothing may be lost
        t, got = self._drain("r1", secs=1)
        time.sleep(0.1)
        runs.post_inbox("r1", "user.ask", "first")
        runs.post_inbox("r1", "flag.contest", "second", ref=2)
        t.join(3)
        self.assertEqual([m["text"] for m in got], ["before any follower", "first", "second"])

    def test_follow_inbox_resumes_across_rearm_exactly_once(self):
        # court ruling 2026-09-28: a Monitor expires every <=30 min; messages posted
        # between expiry and re-arm must arrive on re-arm, and nothing twice
        runs.start("idea-court", "t", run_id="r1")
        runs.post_inbox("r1", "user.ask", "one")
        t, got = self._drain("r1")
        t.join(3)
        self.assertEqual([m["text"] for m in got], ["one"])
        runs.post_inbox("r1", "user.ask", "posted while nobody follows")   # the expiry window
        t, got = self._drain("r1")
        t.join(3)
        self.assertEqual([m["text"] for m in got], ["posted while nobody follows"])
        t, got = self._drain("r1")                           # third arm: nothing new
        t.join(3)
        self.assertEqual(got, [])

    def test_start_records_session_id(self):
        os.environ["CLAUDE_CODE_SESSION_ID"] = "sess-abc"
        try:
            runs.start("idea-court", "t", run_id="r1")
        finally:
            del os.environ["CLAUDE_CODE_SESSION_ID"]
        self.assertEqual(runs.view("r1")["session"], "sess-abc")

    def test_list_runs_newest_first(self):
        runs.start("a", "one", run_id="r1")
        time.sleep(0.01)
        runs.start("b", "two", run_id="r2")
        self.assertEqual([r["id"] for r in runs.list_runs()], ["r2", "r1"])


def _fake_workflow(root: Path, with_state=True):
    """Lay out a session dir the way Claude Code does (see
    fact-workflow-tool-disk-schema): <session>/subagents/workflows/wf_x/ holds
    journal.jsonl + agent meta; <session>/workflows/wf_x.json holds progress."""
    session = root / "sess"
    tdir = session / "subagents" / "workflows" / "wf_x"
    tdir.mkdir(parents=True)
    (tdir / "agent-a1.meta.json").write_text(json.dumps({"agentType": "workflow-subagent", "model": "opus"}))
    (tdir / "agent-a2.meta.json").write_text(json.dumps({"agentType": "workflow-subagent", "model": "opus"}))
    journal = [
        {"type": "started", "key": "k1", "agentId": "a1"},
        {"type": "started", "key": "k2", "agentId": "a2"},
        {"type": "result", "key": "k1", "agentId": "a1", "result": {"verdict": "WEAKENED", "headline": "h"}},
    ]
    (tdir / "journal.jsonl").write_text("".join(json.dumps(j) + "\n" for j in journal))
    if with_state:
        (session / "workflows").mkdir()
        (session / "workflows" / "wf_x.json").write_text(json.dumps({"status": "running", "workflowProgress": [
            {"type": "workflow_phase", "index": 1, "title": "Verify"},
            {"type": "workflow_agent", "label": "evidence:C1", "phaseTitle": "Verify", "agentId": "a1",
             "state": "done", "model": "opus", "startedAt": 1, "lastToolSummary": "WEAKENED"},
            {"type": "workflow_agent", "label": "substrate:C1", "phaseTitle": "Verify", "agentId": "a2",
             "state": "running", "model": "opus", "startedAt": 2},
        ]}))
    return tdir


class WorkflowTailTest(_Env):
    def test_agents_from_state_file_plus_journal(self):
        runs.start("idea-court", "t", run_id="r1")
        tdir = _fake_workflow(Path(self.tmp.name))
        runs.bind_workflow("r1", str(tdir))
        agents = runs.agents("r1")
        self.assertEqual([a["label"] for a in agents], ["evidence:C1", "substrate:C1"])
        self.assertEqual(agents[0]["result"]["verdict"], "WEAKENED")
        self.assertEqual(agents[0]["phase"], "Verify")
        self.assertIsNone(agents[1]["result"])
        self.assertEqual(agents[1]["state"], "running")
        self.assertEqual(runs.events("r1")[-1]["kind"], "workflow.bind")

    def test_live_labels_from_journal_started_lines(self):
        # current Claude Code: label + phase ride on journal `started` lines (and meta.json
        # description/workflowPhase) from spawn; the session state file only lands at the end
        runs.start("idea-court", "t", run_id="r1")
        tdir = _fake_workflow(Path(self.tmp.name), with_state=False)
        (tdir / "journal.jsonl").write_text("".join(json.dumps(j) + "\n" for j in [
            {"type": "launched"},
            {"type": "started", "key": "k1", "agentId": "a1", "label": "evidence:C1", "phase": "Verify"},
            {"type": "started", "key": "k2", "agentId": "a2"},
            {"type": "result", "key": "k1", "agentId": "a1", "result": {"verdict": "WEAKENED"}}]))
        (tdir / "agent-a2.meta.json").write_text(json.dumps(
            {"agentType": "workflow-subagent", "description": "substrate:C1", "workflowPhase": "Verify", "model": "opus"}))
        runs.bind_workflow("r1", str(tdir))
        by = {a["agentId"]: a for a in runs.agents("r1")}
        self.assertEqual((by["a1"]["label"], by["a1"]["phase"], by["a1"]["state"]), ("evidence:C1", "Verify", "done"))
        self.assertEqual((by["a2"]["label"], by["a2"]["phase"], by["a2"]["model"]), ("substrate:C1", "Verify", "opus"))

    def test_finished_at_from_agent_transcript_mtime(self):
        runs.start("idea-court", "t", run_id="r1")
        tdir = _fake_workflow(Path(self.tmp.name))
        (tdir / "agent-a1.jsonl").write_text("{}\n")
        os.utime(tdir / "agent-a1.jsonl", (1700000000, 1700000000))
        (tdir / "agent-a2.jsonl").write_text("{}\n")       # still running: no finishedAt
        runs.bind_workflow("r1", str(tdir))
        by = {a["agentId"]: a for a in runs.agents("r1")}
        self.assertEqual(by["a1"]["finishedAt"], 1700000000000)
        self.assertIsNone(by["a2"]["finishedAt"])

    def test_agents_journal_only_fallback(self):
        runs.start("idea-court", "t", run_id="r1")
        tdir = _fake_workflow(Path(self.tmp.name), with_state=False)
        runs.bind_workflow("r1", str(tdir))
        agents = runs.agents("r1")
        self.assertEqual({a["agentId"] for a in agents}, {"a1", "a2"})
        done = [a for a in agents if a["agentId"] == "a1"][0]
        self.assertEqual(done["state"], "done")
        self.assertEqual(done["label"], "a1")      # no label on disk without the state file

    def test_emitted_agents_for_task_tool_subagents(self):
        # loop-system makers/verifiers run as Task subagents, not Workflows: the
        # orchestrator emits agent.start/agent.done and they join the agent list
        runs.start("loop-system", "t", run_id="r1")
        s = runs.emit("r1", "agent.start", {"id": "m1", "label": "maker:harness", "model": "opus"}, phase="1.1 make")
        runs.emit("r1", "agent.start", {"id": "v1", "label": "verifier", "model": "opus"}, phase="1.1 verify")
        d = runs.emit("r1", "agent.done", {"id": "m1", "headline": "harness written"})
        by = {a["agentId"]: a for a in runs.agents("r1")}
        self.assertEqual(by["m1"]["label"], "maker:harness")
        self.assertEqual(by["m1"]["phase"], "1.1 make")
        self.assertEqual(by["m1"]["state"], "done")
        self.assertEqual((by["m1"]["startedAt"], by["m1"]["finishedAt"]), (s["ts"], d["ts"]))
        self.assertEqual(by["m1"]["result"]["headline"], "harness written")
        self.assertEqual(by["v1"]["state"], "running")
        self.assertIsNone(by["v1"]["result"])
        with self.assertRaises(ValueError):
            runs.emit("r1", "agent.start", {"label": "no id"})

    def test_bind_rejects_missing_dir(self):
        runs.start("idea-court", "t", run_id="r1")
        with self.assertRaises(ValueError):
            runs.bind_workflow("r1", str(Path(self.tmp.name) / "nope"))


class ReportTest(_Env):
    def test_report_is_self_contained(self):
        runs.start("idea-court", "Shunt court", run_id="r1")
        runs.emit("r1", "ruling", {"text": "null position wins </script><b>x</b>"})
        panels = config.runs_dir() / "r1" / "panels"
        panels.mkdir()
        (panels / "matrix.js").write_text("LiveView.panel('matrix', {render(){}});")
        path = runs.report("r1")
        html = path.read_text()
        self.assertEqual(path.name, "report.html")
        self.assertIn("Shunt court", html)
        self.assertIn("LiveView.panel('matrix'", html)
        self.assertNotIn("<script src=", html)           # nothing fetched: opens offline
        self.assertNotIn('<link rel="stylesheet"', html)
        self.assertNotRegex(html, r'(src|href)="https?://')    # data may cite URLs; nothing may fetch them
        self.assertNotIn("</script><b>", html)           # embedded data cannot close the script tag
        self.assertEqual(runs.events("r1")[-1]["kind"], "artifact")


if __name__ == "__main__":
    unittest.main()
