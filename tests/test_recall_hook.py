import json
import os
import subprocess
import sys
import tempfile
import time
import unittest
from pathlib import Path

REPO = str(Path(__file__).resolve().parents[1])
sys.path.insert(0, REPO)

from mindgap import db  # noqa: E402
from mindgap.recall_hook import tokens_from_cwd  # noqa: E402


class RecallHookTest(unittest.TestCase):
    def setUp(self):
        self.tmp = tempfile.TemporaryDirectory()
        self.home = Path(self.tmp.name) / "home"
        self.home.mkdir()
        (self.home / "capture.json").write_text(json.dumps({"enabled": True}))
        conn = db.connect(self.home / "mindgap.db")
        db.upsert_node(conn, {"id": "loop-system", "title": "Loop System",
                              "type": "concept", "body": "maker/verifier loops"})
        db.upsert_node(conn, {"id": "gl-2026-07-01-tail-metric",
                              "title": "Perf gates need a tail metric",
                              "type": "learning", "tags": ["global-learning"],
                              "body": "medians hide bimodal stutter"})
        # body-only token hit: must NOT surface (body LIKE noise filter).
        db.upsert_node(conn, {"id": "tree-geometry", "title": "Tree geometry",
                              "type": "concept",
                              "body": "the loop over segments runs per branch"})
        conn.close()
        self.env = dict(os.environ, PYTHONPATH=REPO,
                        MINDGAP_HOME=str(self.home))
        self.env.pop("MINDGAP_DB", None)

    def tearDown(self):
        self.tmp.cleanup()

    def _run(self, hook_input, timeout=15):
        t0 = time.time()
        proc = subprocess.run(
            [sys.executable, "-m", "mindgap.recall_hook"],
            input=json.dumps(hook_input), capture_output=True, text=True,
            env=self.env, timeout=timeout)
        return proc, time.time() - t0

    def test_cwd_match_and_global_learnings_in_digest(self):
        proc, dt = self._run({"cwd": "/tmp/loop-system", "session_id": "S1"})
        self.assertEqual(proc.returncode, 0, proc.stderr)
        self.assertIn("loop-system [concept]", proc.stdout)
        self.assertIn("gl-2026-07-01-tail-metric", proc.stdout)
        self.assertIn("mindgap find", proc.stdout)
        self.assertNotIn("tree-geometry", proc.stdout)
        self.assertLess(dt, 10)

    def test_recall_fires_activity_feed(self):
        proc, _ = self._run({"cwd": "/tmp/loop-system", "session_id": "S8"})
        self.assertEqual(proc.returncode, 0, proc.stderr)
        events = [json.loads(l) for l in
                  (self.home / "activity.jsonl").read_text().splitlines()]
        self.assertEqual(len(events), 1)
        self.assertEqual(events[0]["kind"], "read")
        # Session-stamped so usage_hook can tell this digest from another
        # session's; a bare "recall" actor is what the staleness bug fed on.
        self.assertEqual(events[0]["actor"], "recall:S8")
        self.assertIn("loop-system", events[0]["ids"])
        self.assertIn("gl-2026-07-01-tail-metric", events[0]["ids"])

    def test_no_cwd_match_still_surfaces_global_learnings(self):
        proc, _ = self._run({"cwd": "/tmp/zzz-unrelated", "session_id": "S2"})
        self.assertEqual(proc.returncode, 0, proc.stderr)
        self.assertNotIn("loop-system [concept]", proc.stdout)
        self.assertIn("gl-2026-07-01-tail-metric", proc.stdout)

    def test_disabled_prints_nothing(self):
        (self.home / "capture.json").write_text(
            json.dumps({"enabled": True, "recall": {"enabled": False}}))
        proc, _ = self._run({"cwd": "/tmp/loop-system", "session_id": "S3"})
        self.assertEqual(proc.returncode, 0, proc.stderr)
        self.assertEqual(proc.stdout, "")

    def test_denylisted_dir_prints_nothing(self):
        (self.home / "capture.json").write_text(json.dumps(
            {"enabled": True, "denylist_dirs": ["/tmp/secrets"]}))
        proc, _ = self._run({"cwd": "/tmp/secrets/loop-system", "session_id": "S4"})
        self.assertEqual(proc.returncode, 0, proc.stderr)
        self.assertEqual(proc.stdout, "")

    def test_missing_db_prints_nothing(self):
        (self.home / "mindgap.db").unlink()
        for suffix in ("-wal", "-shm"):
            p = Path(str(self.home / "mindgap.db") + suffix)
            if p.exists():
                p.unlink()
        proc, _ = self._run({"cwd": "/tmp/loop-system", "session_id": "S5"})
        self.assertEqual(proc.returncode, 0, proc.stderr)
        self.assertEqual(proc.stdout, "")

    def test_missing_session_id_records_an_unstamped_actor(self):
        # No id to stamp -> stay bare rather than write "recall:". usage_hook
        # matches neither, so the session loses its bump but mis-credits no one.
        proc, _ = self._run({"cwd": "/tmp/loop-system"})
        self.assertEqual(proc.returncode, 0, proc.stderr)
        events = [json.loads(l) for l in
                  (self.home / "activity.jsonl").read_text().splitlines()]
        self.assertEqual(events[0]["actor"], "recall")

    def test_garbage_stdin_exits_zero(self):
        proc = subprocess.run(
            [sys.executable, "-m", "mindgap.recall_hook"],
            input="not json", capture_output=True, text=True,
            env=self.env, timeout=15)
        self.assertEqual(proc.returncode, 0, proc.stderr)
        self.assertEqual(proc.stdout, "")

    def test_tokens_from_cwd(self):
        self.assertEqual(tokens_from_cwd("/a/b/loop-system"),
                         ["loop-system", "loop", "system"])
        self.assertEqual(tokens_from_cwd("/a/b/src"), [])
        self.assertEqual(tokens_from_cwd(""), [])


if __name__ == "__main__":
    unittest.main()
