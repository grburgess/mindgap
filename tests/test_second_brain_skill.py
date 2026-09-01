# tests/test_second_brain_skill.py
import unittest
from pathlib import Path

SKILL = (Path(__file__).resolve().parents[1]
         / "mindgap-plugin/skills/second-brain/SKILL.md")
MINING = SKILL.parent / "references/mining.md"


class SecondBrainSkillTest(unittest.TestCase):
    def test_frontmatter_and_protocol(self):
        text = SKILL.read_text()
        self.assertTrue(text.startswith("---"))
        self.assertIn("name: second-brain", text)
        self.assertIn("description:", text)
        for needed in ("enrich", "learn", "connect", "AGENTS.md"):
            self.assertIn(needed, text)

    def test_mining_reference_carries_writeback_protocol(self):
        # SKILL.md delegates mining detail to references/mining.md; the
        # write-back provenance and gating live there, not in the skill body.
        text = MINING.read_text()
        for needed in ("mine:connect", "mindgap_ingest", "nameable"):
            self.assertIn(needed, text)
