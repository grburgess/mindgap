import json
import subprocess
import sys
import unittest
from pathlib import Path

SCRIPT = str(Path(__file__).resolve().parent / "detect-paper.py")


def run(payload):
    """Run the hook with `payload` (a dict) on stdin; return (stdout, returncode)."""
    p = subprocess.run([sys.executable, SCRIPT], input=json.dumps(payload),
                       capture_output=True, text=True)
    return p.stdout.strip(), p.returncode


class DetectPaperTest(unittest.TestCase):
    def ctx(self, out):
        return json.loads(out)["hookSpecificOutput"]["additionalContext"]

    def test_webfetch_arxiv_matches(self):
        out, rc = run({"tool_name": "WebFetch",
                       "tool_input": {"url": "https://arxiv.org/abs/2306.12345"}})
        self.assertEqual(rc, 0)
        self.assertIn("paper-to-mindmap", self.ctx(out))

    def test_webfetch_pdf_matches(self):
        out, rc = run({"tool_name": "WebFetch",
                       "tool_input": {"url": "https://example.com/foo.pdf"}})
        self.assertEqual(rc, 0)
        self.assertIn("paper-to-mindmap", self.ctx(out))

    def test_openreview_matches(self):
        out, rc = run({"tool_name": "WebFetch",
                       "tool_input": {"url": "https://openreview.net/forum?id=abc"}})
        self.assertEqual(rc, 0)
        self.assertIn("paper-to-mindmap", self.ctx(out))

    def test_read_pdf_matches(self):
        out, rc = run({"tool_name": "Read",
                       "tool_input": {"file_path": "/papers/transformer.pdf"}})
        self.assertEqual(rc, 0)
        self.assertIn("paper-to-mindmap", self.ctx(out))

    def test_webfetch_nonpaper_no_output(self):
        out, rc = run({"tool_name": "WebFetch",
                       "tool_input": {"url": "https://news.example.com/article"}})
        self.assertEqual(rc, 0)
        self.assertEqual(out, "")

    def test_read_nonpdf_no_output(self):
        out, rc = run({"tool_name": "Read",
                       "tool_input": {"file_path": "/src/main.py"}})
        self.assertEqual(rc, 0)
        self.assertEqual(out, "")

    def test_malformed_stdin_exits_zero_no_output(self):
        p = subprocess.run([sys.executable, SCRIPT], input="not json{{{",
                           capture_output=True, text=True)
        self.assertEqual(p.returncode, 0)
        self.assertEqual(p.stdout.strip(), "")


if __name__ == "__main__":
    unittest.main()
