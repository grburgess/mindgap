import unittest
from pathlib import Path


class SupersedesVocabTest(unittest.TestCase):
    """`supersedes` must be a recognised rel everywhere the vocabulary lives."""

    def test_supersedes_everywhere(self):
        root = Path(__file__).resolve().parent.parent
        for agents in (root / "AGENTS.md", root / "mindgap-plugin" / "AGENTS.md"):
            rel_line = next(l for l in agents.read_text().splitlines()
                            if l.startswith("- Edge `rel`:"))
            self.assertIn("supersedes", rel_line, agents)
        from mindgap import mcp
        self.assertIn("supersedes", mcp.RELS)
        app = (root / "mindgap" / "web" / "app.js").read_text()
        rels = next(l for l in app.splitlines() if l.startswith("const RELS"))
        self.assertIn("'supersedes'", rels)


if __name__ == "__main__":
    unittest.main()
