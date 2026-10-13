import os
import shutil
import subprocess
import tempfile
import unittest
from pathlib import Path

SCRIPT = str(Path(__file__).resolve().parents[1] / "tools" / "backport-skills.sh")


def git(cwd, *args):
    return subprocess.run(["git", *args], cwd=cwd, check=True,
                          capture_output=True, text=True).stdout


class BackportSkillsTest(unittest.TestCase):
    """Hand edits to the generated skills since the last export flow back upstream."""

    def setUp(self):
        self.tmp = tempfile.TemporaryDirectory()
        root = Path(self.tmp.name)
        self.repo = root / "mindgap"
        skills = self.repo / "mindgap-plugin" / "skills"
        (skills / "loop").mkdir(parents=True)
        git(self.repo, "init", "-q")
        git(self.repo, "config", "user.email", "t@t")
        git(self.repo, "config", "user.name", "t")
        # export commit: GENERATED marker + a skill
        (skills / "GENERATED").write_text("Generated from upstream@aaa\n")
        (skills / "loop" / "SKILL.md").write_text("line one\nline two\nline three\n")
        git(self.repo, "add", "-A")
        git(self.repo, "commit", "-qm", "export")
        # upstream checkout = the skills as exported (no GENERATED marker there)
        self.upstream = root / "upstream" / "skills"
        shutil.copytree(skills, self.upstream)
        (self.upstream / "GENERATED").unlink()
        # hand edit in the generated copy, plus an unrelated repo change
        (skills / "loop" / "SKILL.md").write_text("line one\nline two EDITED\nline three\n")
        (self.repo / "README.md").write_text("unrelated\n")
        git(self.repo, "add", "-A")
        git(self.repo, "commit", "-qm", "hand edit")

    def tearDown(self):
        self.tmp.cleanup()

    def run_script(self, *args):
        return subprocess.run(["bash", SCRIPT, *args], cwd=self.repo,
                              capture_output=True, text=True)

    def test_prints_patch_of_skill_edits_only(self):
        r = self.run_script()
        self.assertEqual(r.returncode, 0, r.stderr)
        self.assertIn("+line two EDITED", r.stdout)
        self.assertIn("a/loop/SKILL.md", r.stdout)
        self.assertNotIn("README", r.stdout)
        self.assertNotIn("GENERATED", r.stdout)

    def test_applies_to_upstream_dir(self):
        r = self.run_script(str(self.upstream))
        self.assertEqual(r.returncode, 0, r.stderr)
        self.assertEqual((self.upstream / "loop" / "SKILL.md").read_text(),
                         "line one\nline two EDITED\nline three\n")

    def test_conflict_leaves_upstream_untouched(self):
        diverged = "line one\nline two UPSTREAM\nline three\n"
        (self.upstream / "loop" / "SKILL.md").write_text(diverged)
        r = self.run_script(str(self.upstream))
        self.assertNotEqual(r.returncode, 0)
        self.assertEqual((self.upstream / "loop" / "SKILL.md").read_text(), diverged)
        self.assertEqual(sorted(os.listdir(self.upstream / "loop")), ["SKILL.md"])

    def test_nothing_to_backport(self):
        git(self.repo, "reset", "-q", "--hard", "HEAD~1")
        r = self.run_script()
        self.assertEqual(r.returncode, 0, r.stderr)
        self.assertEqual(r.stdout, "")


if __name__ == "__main__":
    unittest.main()
