import unittest
from pathlib import Path

SKILL = (Path(__file__).resolve().parents[1]
         / "mindgap-plugin/skills/knowledge-capture/SKILL.md")


class SkillTest(unittest.TestCase):
    def test_frontmatter_and_sections(self):
        text = SKILL.read_text()
        self.assertTrue(text.startswith("---"))
        self.assertIn("name: knowledge-capture", text)
        self.assertIn("description:", text)
        for needed in ("relevance", "created_by", "confidence", "AGENTS.md"):
            self.assertIn(needed, text)


if __name__ == "__main__":
    unittest.main()
