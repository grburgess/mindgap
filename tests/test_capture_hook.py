import json
import os
import subprocess
import sys
import tempfile
import time
import unittest
from pathlib import Path

REPO = str(Path(__file__).resolve().parents[1])


class CaptureHookTest(unittest.TestCase):
    def setUp(self):
        self.tmp = tempfile.TemporaryDirectory()
        self.home = Path(self.tmp.name) / "home"
        self.home.mkdir()
        self.bin = Path(self.tmp.name) / "bin"
        self.bin.mkdir()
        # fake `claude` that records its argv to marker file, then exits.
        self.marker = Path(self.tmp.name) / "claude_called.txt"
        fake = self.bin / "claude"
        fake.write_text("#!/bin/sh\nprintf '%s\\n' \"$@\" > " + f"'{self.marker}'\n"
                        "echo fake-claude-out\nexec sleep ${FAKE_SLEEP:-0}\n")
        fake.chmod(0o755)
        # capture.json enabled, with a keyword.
        (self.home / "capture.json").write_text(json.dumps({
            "enabled": True, "domain": {"description": "roof models.", "keywords": ["roof"]},
            "min_transcript_bytes": 5,
            "capture": {"model": "claude-haiku-4-5", "timeout_s": 60,
                        "default_confidence": 0.6}}))
        self.tx = Path(self.tmp.name) / "t.jsonl"
        self.tx.write_text(self._jsonl("talking about roof segmentation") * 5)
        self.env = dict(os.environ, PYTHONPATH=REPO,
                        MINDGAP_HOME=str(self.home),
                        PATH=str(self.bin) + os.pathsep + os.environ["PATH"])
        self.env.pop("MINDGAP_CAPTURE", None)

    @staticmethod
    def _jsonl(text):
        return json.dumps({"type": "user", "message": {"role": "user", "content": text}}) + "\n"

    def _wait(self, cond, timeout=5.0):
        end = time.time() + timeout
        while time.time() < end:
            if cond():
                return True
            time.sleep(0.05)
        return cond()

    def _log(self):
        p = self.home / "capture.log"
        return p.read_text() if p.exists() else ""

    def tearDown(self):
        self.tmp.cleanup()

    def _run(self, hook_input):
        t0 = time.time()
        proc = subprocess.run(
            [sys.executable, "-m", "mindgap.capture_hook"],
            input=json.dumps(hook_input), capture_output=True, text=True,
            env=self.env, timeout=15)
        return proc, time.time() - t0

    def _wait_marker(self, want=True, timeout=5.0):
        end = time.time() + timeout
        while time.time() < end:
            if self.marker.exists() == want:
                return self.marker.exists()
            time.sleep(0.05)
        return self.marker.exists()

    def test_on_domain_spawns_claude_and_returns_fast(self):
        proc, dt = self._run({"transcript_path": str(self.tx),
                              "cwd": "/tmp/myrepo", "session_id": "S1"})
        self.assertEqual(proc.returncode, 0, proc.stderr)
        self.assertLess(dt, 10)  # never blocks
        self.assertTrue(self._wait_marker(True))
        argv = self.marker.read_text()
        self.assertIn("-p", argv)
        self.assertIn(str(self.tx), argv)
        self.assertIn("capture:myrepo", argv)
        self.assertIn("The domain is: roof models.", argv)

    def test_child_gets_scoped_allowed_tools(self):
        self._run({"transcript_path": str(self.tx), "cwd": "/tmp/r", "session_id": "S"})
        self.assertTrue(self._wait_marker(True))
        argv = self.marker.read_text().splitlines()
        self.assertIn("--allowedTools", argv)
        self.assertIn(f"Read(/{self.tx})", argv)  # //abs path = absolute rule
        for srv in ("mcp__plugin_mindgap_mindgap__", "mcp__mindgap__"):
            for tool in ("mindgap_context", "mindgap_find", "mindgap_ingest"):
                self.assertIn(srv + tool, argv)
        self.assertNotIn("delete the lock", " ".join(argv))

    def test_lock_released_when_child_exits(self):
        self._run({"transcript_path": str(self.tx), "cwd": "/tmp/r", "session_id": "S2"})
        self.assertTrue(self._wait_marker(True))
        self.assertTrue(self._wait(lambda: not (self.home / "capture.lock").exists()))
        self.assertTrue(self._wait(lambda: "session=S2 exit=0" in self._log()), self._log())
        self.assertIn("fake-claude-out", (self.home / "capture-child.log").read_text())

    def test_child_killed_after_timeout_and_lock_released(self):
        cfg = json.loads((self.home / "capture.json").read_text())
        cfg["capture"]["timeout_s"] = 1
        (self.home / "capture.json").write_text(json.dumps(cfg))
        self.env["FAKE_SLEEP"] = "30"
        self._run({"transcript_path": str(self.tx), "cwd": "/tmp/r", "session_id": "S3"})
        self.assertTrue(self._wait(lambda: "session=S3 exit=timeout" in self._log(), 8),
                        self._log())
        self.assertFalse((self.home / "capture.lock").exists())

    def test_skip_reason_is_logged(self):
        self.tx.write_text(self._jsonl("nothing relevant here") * 5)
        self._run({"transcript_path": str(self.tx), "cwd": "/tmp/x", "session_id": "S4"})
        self.assertIn("session=S4", self._log())
        self.assertIn("gate=no-domain-keywords", self._log())

    def test_missing_claude_releases_lock(self):
        self.env["PATH"] = "/nonexistent"
        self._run({"transcript_path": str(self.tx), "cwd": "/tmp/r", "session_id": "S5"})
        self.assertFalse((self.home / "capture.lock").exists())
        self.assertIn("no-claude", self._log())

    def test_off_domain_does_not_spawn(self):
        self.tx.write_text(self._jsonl("nothing relevant here") * 5)
        proc, _ = self._run({"transcript_path": str(self.tx), "cwd": "/tmp/x"})
        self.assertEqual(proc.returncode, 0)
        self.assertFalse(self._wait_marker(True, timeout=1.5))

    def test_self_capture_env_skips(self):
        env = dict(self.env, MINDGAP_CAPTURE="1")
        proc = subprocess.run(
            [sys.executable, "-m", "mindgap.capture_hook"],
            input=json.dumps({"transcript_path": str(self.tx), "cwd": "/tmp/x"}),
            capture_output=True, text=True, env=env, timeout=15)
        self.assertEqual(proc.returncode, 0)
        self.assertFalse(self._wait_marker(True, timeout=1.5))

    def test_empty_stdin_is_noop(self):
        proc = subprocess.run(
            [sys.executable, "-m", "mindgap.capture_hook"],
            input="", capture_output=True, text=True, env=self.env, timeout=15)
        self.assertEqual(proc.returncode, 0)


if __name__ == "__main__":
    unittest.main()
