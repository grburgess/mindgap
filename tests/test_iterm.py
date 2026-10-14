"""Tests for mindgap/iterm.py — MINDGAP_BROWSER=iterm opens pages in iTerm2's
built-in browser (UI: new window; live view: split pane next to the calling session)."""
import json
import os
import tempfile
import unittest
from pathlib import Path
from unittest import mock

from mindgap import iterm

SID = "w0t5p0:DAABDCA8-E00A-4585-9A6C-6BB9619D471A"


class ItermTest(unittest.TestCase):
    def setUp(self):
        self.tmp = tempfile.TemporaryDirectory()
        self.patches = [mock.patch.object(iterm, "PROFILE_DIR", Path(self.tmp.name)),
                        mock.patch.object(iterm.time, "sleep"),
                        mock.patch.object(iterm.subprocess, "run")]
        for p in self.patches:
            p.start()
        self.run_ = iterm.subprocess.run
        self.run_.return_value = mock.Mock(returncode=0, stdout="ok\n")

    def tearDown(self):
        for p in self.patches:
            p.stop()
        self.tmp.cleanup()

    def script(self):
        return self.run_.call_args.kwargs["input"]

    def test_enabled_only_for_iterm(self):
        with mock.patch.dict(os.environ, {"MINDGAP_BROWSER": "iterm"}):
            self.assertTrue(iterm.enabled())
        with mock.patch.dict(os.environ, {"MINDGAP_BROWSER": "chrome"}):
            self.assertFalse(iterm.enabled())
        with mock.patch.dict(os.environ, {}, clear=True):
            self.assertFalse(iterm.enabled())

    def test_profile_is_browser_type_with_url(self):
        iterm.open_url("http://localhost:8765/")
        prof = json.loads((Path(self.tmp.name) / "mindgap.json").read_text())["Profiles"][0]
        self.assertEqual(prof["Custom Command"], "Browser")
        self.assertEqual(prof["Initial URL"], "http://localhost:8765/")
        self.assertIn(prof["Name"], self.script())

    def test_window_without_split(self):
        iterm.open_url("http://localhost:8765/")
        self.assertIn("create window with profile", self.script())
        self.assertNotIn("split", self.script())

    def test_split_targets_calling_session_and_keeps_focus(self):
        with mock.patch.dict(os.environ, {"ITERM_SESSION_ID": SID}):
            os.environ.pop("MINDGAP_ITERM_SPLIT", None)  # default = vertical
            iterm.open_url("http://localhost:8765/runs/r1", split=True)
        s = self.script()
        self.assertIn('"DAABDCA8-E00A-4585-9A6C-6BB9619D471A"', s)
        self.assertIn("split vertically with profile", s)
        self.assertIn("select", s)  # focus goes back to the Claude session

    def test_split_direction_configurable(self):
        with mock.patch.dict(os.environ, {"ITERM_SESSION_ID": SID, "MINDGAP_ITERM_SPLIT": "horizontal"}):
            iterm.open_url("http://localhost:8765/runs/r1", split=True)
        self.assertIn("split horizontally with profile", self.script())

    def test_split_outside_iterm_falls_back_to_window(self):
        with mock.patch.dict(os.environ, {}, clear=True):
            iterm.open_url("http://localhost:8765/runs/r1", split=True)
        self.assertIn("create window with profile", self.script())

    def test_retries_until_profile_loaded(self):
        self.run_.side_effect = [mock.Mock(returncode=1, stdout=""), mock.Mock(returncode=0, stdout="ok\n")]
        self.assertTrue(iterm.open_url("http://localhost:8765/"))
        self.assertEqual(self.run_.call_count, 2)

    def test_gives_up_returns_false(self):
        self.run_.return_value = mock.Mock(returncode=1, stdout="")
        self.assertFalse(iterm.open_url("http://localhost:8765/"))


if __name__ == "__main__":
    unittest.main()
