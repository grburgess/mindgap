"""Tests for mindgap/askuser_hook.py — mirrors AskUserQuestion into the
session's live-view run (PreToolUse -> question.ask, PostToolUse -> question.answer).
Payload shapes are the ones measured live on 2026-09-28 (fact-askuserquestion-hook-payloads)."""
import io
import json
import os
import tempfile
import unittest
from unittest import mock

from mindgap import askuser_hook, runs

QS = [{"question": "Pick a colour?", "header": "C", "multiSelect": False,
       "options": [{"label": "Green", "description": ""}, {"label": "Orange", "description": ""}]},
      {"question": "Which fruits?", "header": "F", "multiSelect": True,
       "options": [{"label": "Apple", "description": ""}, {"label": "Pear", "description": ""}]}]


def pre(session="S1", tid="toolu_1", **kw):
    return dict({"hook_event_name": "PreToolUse", "tool_name": "AskUserQuestion", "session_id": session,
                 "tool_use_id": tid, "tool_input": {"questions": QS}}, **kw)


def post(session="S1", tid="toolu_1", answers=None, **kw):
    answers = {"Pick a colour?": "Green", "Which fruits?": "Apple, Pear"} if answers is None else answers
    return dict({"hook_event_name": "PostToolUse", "tool_name": "AskUserQuestion", "session_id": session,
                 "tool_use_id": tid, "tool_input": {"questions": QS},
                 "tool_response": {"questions": QS, "answers": answers, "annotations": {}}}, **kw)


class AskUserHookTest(unittest.TestCase):
    def setUp(self):
        self.tmp = tempfile.TemporaryDirectory()
        self._env = mock.patch.dict(os.environ, {"MINDGAP_HOME": self.tmp.name})
        self._env.start()

    def tearDown(self):
        self._env.stop()
        self.tmp.cleanup()

    def start(self, rid, session):
        with mock.patch.dict(os.environ, {"CLAUDE_CODE_SESSION_ID": session}):
            return runs.start("idea-court", "t", run_id=rid)

    def kinds(self, rid):
        return [e["kind"] for e in runs.events(rid)]

    def test_pre_then_post_mirrors_ask_and_answer(self):
        self.start("r1", "S1")
        askuser_hook.handle(pre())
        asks = [e for e in runs.events("r1") if e["kind"] == "question.ask"]
        self.assertEqual([a["data"]["text"] for a in asks], ["Pick a colour?", "Which fruits?"])
        self.assertEqual(asks[0]["data"]["options"], ["Green", "Orange"])
        self.assertEqual(asks[0]["data"]["tool_use_id"], "toolu_1")
        self.assertEqual(asks[0]["actor"], "hook")
        askuser_hook.handle(post())
        ans = [e for e in runs.events("r1") if e["kind"] == "question.answer"]
        self.assertEqual([(a["data"]["ref"], a["data"]["text"]) for a in ans],
                         [(asks[0]["seq"], "Green"), (asks[1]["seq"], "Apple, Pear")])

    def test_routes_only_to_this_sessions_newest_open_run(self):
        self.start("other", "S2")
        self.start("old", "S1")
        runs.emit("old", "run.end")
        self.start("mine", "S1")
        askuser_hook.handle(pre())
        self.assertIn("question.ask", self.kinds("mine"))
        self.assertNotIn("question.ask", self.kinds("other"))
        self.assertNotIn("question.ask", self.kinds("old"))

    def test_no_matching_run_writes_nothing(self):
        self.start("r1", "S2")
        askuser_hook.handle(pre(session="S1"))
        askuser_hook.handle(post(session="S1"))
        self.assertEqual(self.kinds("r1"), ["run.start"])

    def test_subagent_calls_ignored(self):
        self.start("r1", "S1")
        askuser_hook.handle(pre(agent_id="a123"))
        self.assertEqual(self.kinds("r1"), ["run.start"])

    def test_duplicate_pre_does_not_double_ask(self):
        self.start("r1", "S1")
        askuser_hook.handle(pre())
        askuser_hook.handle(pre())
        self.assertEqual(self.kinds("r1").count("question.ask"), 2)

    def test_post_without_pre_asks_retroactively(self):
        self.start("r1", "S1")
        askuser_hook.handle(post())
        evts = runs.events("r1")
        asks = [e for e in evts if e["kind"] == "question.ask"]
        self.assertEqual(len(asks), 2)
        self.assertTrue(asks[0]["data"]["retroactive"])
        self.assertEqual(self.kinds("r1").count("question.answer"), 2)

    def test_page_answer_first_wins(self):
        self.start("r1", "S1")
        askuser_hook.handle(pre())
        first = [e for e in runs.events("r1") if e["kind"] == "question.ask"][0]
        runs.post_inbox("r1", "user.answer", "Orange", ref=first["seq"])
        askuser_hook.handle(post())
        ans = [e for e in runs.events("r1") if e["kind"] == "question.answer"]
        self.assertEqual([a["data"]["text"] for a in ans], ["Apple, Pear"])   # colour already answered on the page

    def test_main_never_fails(self):
        for stdin in ["", "not json", json.dumps({"tool_name": "Bash"}), json.dumps(pre())]:
            with mock.patch("sys.stdin", io.StringIO(stdin)):
                self.assertEqual(askuser_hook.main(), 0)


if __name__ == "__main__":
    unittest.main()
