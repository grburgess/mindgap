import json
import os
import subprocess
import sys
import tempfile
import unittest
from pathlib import Path

REPO = str(Path(__file__).resolve().parents[1])
sys.path.insert(0, REPO)

from mindgap import db  # noqa: E402
from mindgap.prompt_recall_hook import prompt_tokens  # noqa: E402


class PromptRecallHookTest(unittest.TestCase):
    """SessionStart recall only knows the folder, and ranks by recency: a closed
    decision with 49 newer folder matches never reaches the session (bench,
    2026-09-24). This hook ranks by the words of the PROMPT instead."""

    def setUp(self):
        self.tmp = tempfile.TemporaryDirectory()
        self.home = Path(self.tmp.name) / "home"
        self.home.mkdir()
        (self.home / "capture.json").write_text(json.dumps({"enabled": True}))
        conn = db.connect(self.home / "mindgap.db")
        db.upsert_node(conn, {"id": "decision-widget-cache-program-closed",
                              "title": "DECISION: the WIDGET cache program is closed by measurement",
                              "type": "decision", "tags": ["widget", "cache-layer"],
                              "body": "a perfect cache buys only 1%"})
        # newer, matches only ONE prompt word: must rank below the two-word hit
        for i in range(8):
            db.upsert_node(conn, {"id": f"widget-note-{i}", "title": f"WIDGET note {i}",
                                  "type": "finding", "tags": ["widget"], "body": "x"})
        db.upsert_node(conn, {"id": "learning-oow-gt-inflates-deficit",
                              "title": "Out-of-window GT inflates the FN deficit",
                              "type": "learning", "tags": ["global-learning"],
                              "body": "uncropped GT"})
        conn.close()
        self.env = dict(os.environ, PYTHONPATH=REPO, MINDGAP_HOME=str(self.home))
        self.env.pop("MINDGAP_DB", None)

    def tearDown(self):
        self.tmp.cleanup()

    def _run(self, hook_input):
        return subprocess.run(
            [sys.executable, "-m", "mindgap.prompt_recall_hook"],
            input=json.dumps(hook_input), capture_output=True, text=True,
            env=self.env, timeout=15)

    def test_prompt_words_outrank_recency(self):
        proc = self._run({"cwd": "/tmp/widget_app", "session_id": "S1",
                          "prompt": "Should we add a cache layer to WIDGET?"})
        self.assertEqual(proc.returncode, 0, proc.stderr)
        lines = [l for l in proc.stdout.splitlines() if l.startswith("- ")]
        self.assertTrue(lines, proc.stdout)
        self.assertIn("decision-widget-cache-program-closed", lines[0])

    def test_stems_match_across_inflections(self):
        proc = self._run({"cwd": "/tmp/other_app", "session_id": "S2",
                          "prompt": "Why is the deficit inflated here?"})
        self.assertIn("learning-oow-gt-inflates-deficit", proc.stdout)

    def test_single_word_hits_do_not_flood(self):
        # one shared word with a two-content-word prompt is not enough
        proc = self._run({"cwd": "/tmp/x", "session_id": "S3",
                          "prompt": "widget deployment schedule"})
        self.assertNotIn("widget-note-", proc.stdout)

    def test_fires_activity_with_its_own_actor(self):
        self._run({"cwd": "/tmp/widget_app", "session_id": "S4",
                   "prompt": "cache layer for widget"})
        evt = json.loads((self.home / "activity.jsonl").read_text().splitlines()[-1])
        # distinct from "recall:<sid>" so usage_hook never double-credits it
        self.assertEqual(evt["actor"], "prompt-recall:S4")

    def test_no_match_prints_nothing(self):
        proc = self._run({"cwd": "/tmp/x", "session_id": "S5", "prompt": "hello there"})
        self.assertEqual(proc.stdout, "")

    def test_disabled_prints_nothing(self):
        (self.home / "capture.json").write_text(json.dumps(
            {"enabled": True, "recall": {"enabled": True, "prompt": False}}))
        proc = self._run({"cwd": "/tmp/widget_app", "session_id": "S6",
                          "prompt": "cache layer for widget"})
        self.assertEqual(proc.stdout, "")

    def test_garbage_stdin_exits_zero(self):
        proc = subprocess.run([sys.executable, "-m", "mindgap.prompt_recall_hook"],
                              input="nope", capture_output=True, text=True,
                              env=self.env, timeout=15)
        self.assertEqual((proc.returncode, proc.stdout), (0, ""))

    def test_prompt_tokens(self):
        self.assertEqual(prompt_tokens("Should we add a cache layer to WIDGET?"),
                         ["cache", "layer", "widget"])


if __name__ == "__main__":
    unittest.main()
