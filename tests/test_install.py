import json
import os
import sys
import tempfile
import unittest
from pathlib import Path
from unittest import mock

from mindgap import cli, config

REPO = Path(__file__).resolve().parents[1]


class LedgerLocationTest(unittest.TestCase):
    """Ledgers live in $MINDGAP_HOME/learning/<skill>/ (README § Where data lives)."""

    def setUp(self):
        self.tmp = tempfile.TemporaryDirectory()
        self.home = Path(self.tmp.name) / "mg"
        self.env = mock.patch.dict(os.environ, {"MINDGAP_HOME": str(self.home)})
        self.env.start()
        os.environ.pop("MINDGAP_LEDGER", None)

    def tearDown(self):
        self.env.stop()
        self.tmp.cleanup()

    def test_ledger_path_under_mindgap_home(self):
        self.assertEqual(config.ledger_path(),
                         self.home / "learning" / "loop-system" / "global-learnings.md")

    def test_legacy_ledgers_migrate_into_mindgap_home(self):
        skills = Path(self.tmp.name) / "skills"
        src = skills / "loop-system" / "references" / "lessons.md"
        src.parent.mkdir(parents=True)
        src.write_text("x\n")
        res = cli.migrate_skill_ledgers(skills_dir=skills)
        self.assertEqual(len(res["moved"]), 1, res)
        self.assertEqual((self.home / "learning" / "loop-system" / "lessons.md").read_text(), "x\n")


class LaunchersTest(unittest.TestCase):
    """Every default hook resolves to a launcher in both install modes."""

    def test_every_default_hook_has_a_source_launcher(self):
        for _, script, _, _ in cli.DEFAULT_HOOKS + [cli.CAPTURE_HOOK]:
            launcher = REPO / "bin" / script
            self.assertTrue(launcher.exists() and os.access(launcher, os.X_OK), script)

    def test_every_default_hook_is_a_package_script(self):
        scripts = (REPO / "pyproject.toml").read_text().split("[project.scripts]")[1].split("\n[")[0]
        for _, script, _, _ in cli.DEFAULT_HOOKS + [cli.CAPTURE_HOOK]:
            self.assertIn(f"\n{script} = ", scripts)

    def test_symlinks_skip_cleanly_without_source_bin(self):
        # a package install (uv tool / pipx) has no repo bin/ next to the package
        with tempfile.TemporaryDirectory() as t:
            with mock.patch.object(config, "PKG_DIR", Path(t) / "site-packages" / "mindgap"):
                self.assertEqual(cli.install_symlinks(Path(t) / "bin"), [])


class InstallHooksTest(unittest.TestCase):
    def setUp(self):
        self.tmp = tempfile.TemporaryDirectory()
        self.settings = Path(self.tmp.name) / "settings.json"
        self.bin = Path(self.tmp.name) / "bin"

    def tearDown(self):
        self.tmp.cleanup()

    def session_start_cmds(self):
        groups = json.loads(self.settings.read_text())["hooks"]["SessionStart"]
        return [h["command"] for g in groups for h in g["hooks"]]

    def write_session_start(self, command):
        self.settings.write_text(json.dumps(
            {"hooks": {"SessionStart": [{"hooks": [{"type": "command", "command": command}]}]}}))

    def test_live_module_form_is_not_duplicated(self):
        self.write_session_start(f"{sys.executable} -m mindgap.recall_hook")
        cli.install_hooks(settings_path=self.settings, bin_dir=self.bin)
        self.assertEqual(self.session_start_cmds(), [f"{sys.executable} -m mindgap.recall_hook"])

    def test_dangling_entry_is_repointed(self):
        # e.g. a pipx venv python left behind after moving the install to uv
        self.write_session_start("/gone/venv/bin/python -m mindgap.recall_hook")
        added = cli.install_hooks(settings_path=self.settings, bin_dir=self.bin)
        self.assertEqual(self.session_start_cmds(), [str(self.bin / "mindgap-recall-hook")])
        self.assertIn("SessionStart", added)

    def test_unrelated_hooks_are_kept(self):
        self.write_session_start("/usr/bin/true")
        cli.install_hooks(settings_path=self.settings, bin_dir=self.bin)
        self.assertEqual(self.session_start_cmds(),
                         ["/usr/bin/true", str(self.bin / "mindgap-recall-hook")])


if __name__ == "__main__":
    unittest.main()
