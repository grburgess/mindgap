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
        fake.write_text("#!/bin/sh\nprintf '%s\\n' \"$@\" > " + f"'{self.marker}'\n")
        fake.chmod(0o755)
        # capture.json enabled, with a keyword.
        (self.home / "capture.json").write_text(json.dumps({
            "enabled": True, "domain": {"keywords": ["roof"]},
            "min_transcript_bytes": 5,
            "capture": {"model": "claude-haiku-4-5", "timeout_s": 60,
                        "default_confidence": 0.6}}))
        self.tx = Path(self.tmp.name) / "t.jsonl"
        self.tx.write_text("talking about roof segmentation\n" * 5)
        self.env = dict(os.environ, PYTHONPATH=REPO,
                        MINDGAP_HOME=str(self.home),
                        PATH=str(self.bin) + os.pathsep + os.environ["PATH"])
        self.env.pop("MINDGAP_CAPTURE", None)

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

    def test_off_domain_does_not_spawn(self):
        self.tx.write_text("nothing relevant here\n" * 5)
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
