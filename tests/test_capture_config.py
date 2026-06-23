import json
import os
import tempfile
import unittest
from pathlib import Path

from mindgap import capture


class CaptureConfigTest(unittest.TestCase):
    def setUp(self):
        self.tmp = tempfile.TemporaryDirectory()
        self.cfgfile = Path(self.tmp.name) / "capture.json"

    def tearDown(self):
        self.tmp.cleanup()

    def test_defaults_when_missing(self):
        cfg = capture.load_config(path=self.cfgfile)
        self.assertFalse(cfg["enabled"])
        self.assertEqual(cfg["min_transcript_bytes"], 2000)
        self.assertEqual(cfg["capture"]["default_confidence"], 0.6)

    def test_user_file_deep_merges_over_defaults(self):
        self.cfgfile.write_text(json.dumps(
            {"enabled": True, "domain": {"keywords": ["roof"]},
             "capture": {"model": "claude-haiku-4-5"}}))
        cfg = capture.load_config(path=self.cfgfile)
        self.assertTrue(cfg["enabled"])
        self.assertEqual(cfg["domain"]["keywords"], ["roof"])
        # untouched nested defaults survive the merge:
        self.assertEqual(cfg["capture"]["timeout_s"], 180)
        self.assertEqual(cfg["capture"]["model"], "claude-haiku-4-5")

    def test_invalid_json_falls_back_to_defaults(self):
        self.cfgfile.write_text("{not json")
        cfg = capture.load_config(path=self.cfgfile)
        self.assertFalse(cfg["enabled"])

    def test_env_enabled_override(self):
        self.cfgfile.write_text(json.dumps({"enabled": False}))
        os.environ["MINDGAP_CAPTURE_ENABLED"] = "1"
        try:
            cfg = capture.load_config(path=self.cfgfile)
            self.assertTrue(cfg["enabled"])
        finally:
            del os.environ["MINDGAP_CAPTURE_ENABLED"]


class PresetInstallTest(unittest.TestCase):
    def setUp(self):
        self.tmp = tempfile.TemporaryDirectory()
        self.home = Path(self.tmp.name)
        self._old = os.environ.get("MINDGAP_HOME")
        os.environ["MINDGAP_HOME"] = str(self.home)

    def tearDown(self):
        if self._old is None:
            os.environ.pop("MINDGAP_HOME", None)
        else:
            os.environ["MINDGAP_HOME"] = self._old
        self.tmp.cleanup()

    def test_preset_is_valid_json_disabled_by_default(self):
        from mindgap import capture
        data = json.loads(capture.preset_path().read_text())
        self.assertFalse(data["enabled"])
        self.assertIn("keywords", data["domain"])
        self.assertEqual(data["domain"]["keywords"], [])

    def test_install_copies_once_idempotent(self):
        from mindgap import cli, capture
        self.assertTrue(cli.install_capture_preset())        # copied
        self.assertTrue(capture.config_path().exists())
        self.assertFalse(cli.install_capture_preset())       # already there


if __name__ == "__main__":
    unittest.main()
