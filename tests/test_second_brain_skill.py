# tests/test_second_brain_skill.py
import unittest
from pathlib import Path

SKILL = (Path(__file__).resolve().parents[1]
         / "mindgap-plugin/skills/second-brain/SKILL.md")


class SecondBrainSkillTest(unittest.TestCase):
    def test_frontmatter_and_protocol(self):
        text = SKILL.read_text()
        self.assertTrue(text.startswith("---"))
        self.assertIn("name: second-brain", text)
        self.assertIn("description:", text)
        for needed in ("enrich", "learn", "connect", "mine:connect",
                       "mindgap_ingest", "AGENTS.md", "nameable"):
            self.assertIn(needed, text)
