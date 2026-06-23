import json
import os
import subprocess
import sys
import tempfile
import unittest
from pathlib import Path

REPO = str(Path(__file__).resolve().parents[1])


class CliTest(unittest.TestCase):
    def setUp(self):
        self.tmpdir = tempfile.TemporaryDirectory()
        self.db = os.path.join(self.tmpdir.name, "test.db")
        self.env = dict(os.environ, MINDGAP_DB=self.db, PYTHONPATH=REPO)

    def tearDown(self):
        self.tmpdir.cleanup()

    def run_cli(self, *args, stdin=None):
        proc = subprocess.run(
            [sys.executable, "-m", "mindgap", *args],
            input=stdin, capture_output=True, text=True, env=self.env)
        self.assertEqual(proc.returncode, 0, proc.stderr)
        return proc.stdout

    def test_add_prints_id(self):
        out = self.run_cli("add", "--title", "Graph Theory", "--type", "concept",
                           "--tags", "math,graphs")
        self.assertEqual(out.strip(), "graph-theory")

    def test_add_url_default_label(self):
        self.run_cli("add", "--title", "Paper X",
                     "--url", "arxiv=https://arxiv.org/abs/1706.03762")
        node = json.loads(self.run_cli("show", "paper-x", "--json"))["node"]
        self.assertEqual(node["urls"], [{
            "label": "arxiv.org/1706.03762",
            "url": "https://arxiv.org/abs/1706.03762",
            "kind": "arxiv"}])

    def test_link_and_show_json(self):
        self.run_cli("add", "--title", "A")
        self.run_cli("add", "--title", "B")
        self.run_cli("link", "a", "b", "--rel", "depends_on")
        data = json.loads(self.run_cli("show", "a", "--json"))
        self.assertEqual(data["node"]["id"], "a")
        ids = {n["id"] for n in data["neighbors"]["nodes"]}
        self.assertIn("b", ids)

    def test_find_json(self):
        self.run_cli("add", "--title", "Quantum Widget", "--type", "software")
        rows = json.loads(self.run_cli("find", "quantum", "--json"))
        self.assertEqual(len(rows), 1)
        self.assertEqual(rows[0]["id"], "quantum-widget")
        self.assertEqual(json.loads(
            self.run_cli("find", "quantum", "--type", "paper", "--json")), [])

    def test_context(self):
        self.run_cli("add", "--title", "Alpha", "--body", "links to [[beta]]",
                     "--tags", "t1")
        out = self.run_cli("context", "alpha")
        self.assertIn("## Alpha (alpha) [concept]", out)
        self.assertIn("links to [[beta]]", out)
        self.assertIn("mentions", out)
        self.assertIn("beta", out)

    def test_ingest_stdin(self):
        payload = json.dumps({
            "nodes": [{"id": "n1", "title": "N1"}, {"id": "n2", "title": "N2"}],
            "edges": [{"src": "n1", "dst": "n2", "rel": "cites"}]})
        out = self.run_cli("ingest", "-", stdin=payload)
        self.assertIn("2 nodes", out)
        self.assertIn("1 edges", out)
        rows = json.loads(self.run_cli("find", "n1", "--json"))
        self.assertTrue(any(r["id"] == "n1" for r in rows))

    def test_export_roundtrip(self):
        self.run_cli("add", "--title", "X")
        self.run_cli("add", "--title", "Y")
        self.run_cli("link", "x", "y")
        out_path = os.path.join(self.tmpdir.name, "snap.json")
        printed = self.run_cli("export", "--out", out_path)
        self.assertEqual(printed.strip(), out_path)
        snap = json.load(open(out_path))
        self.assertEqual({n["id"] for n in snap["nodes"]}, {"x", "y"})
        self.assertEqual(snap["edges"][0]["src"], "x")
        # round-trip into a fresh db
        db2 = os.path.join(self.tmpdir.name, "test2.db")
        env2 = dict(self.env, MINDGAP_DB=db2)
        proc = subprocess.run(
            [sys.executable, "-m", "mindgap", "ingest", out_path],
            capture_output=True, text=True, env=env2)
        self.assertEqual(proc.returncode, 0, proc.stderr)
        proc = subprocess.run(
            [sys.executable, "-m", "mindgap", "show", "x", "--json"],
            capture_output=True, text=True, env=env2)
        self.assertEqual(proc.returncode, 0, proc.stderr)
        self.assertEqual(json.loads(proc.stdout)["node"]["id"], "x")

    def test_stats(self):
        self.run_cli("add", "--title", "S1")
        out = self.run_cli("stats")
        json.loads(out)  # valid JSON

    def test_lint_json_reports_orphan(self):
        self.run_cli("add", "--title", "Lonely Node")
        out = self.run_cli("lint", "--json")
        rep = json.loads(out)
        self.assertIn("orphans", rep)
        self.assertIn("lonely-node", {o["id"] for o in rep["orphans"]})

    def test_lint_text_runs(self):
        self.run_cli("add", "--title", "Lonely Node")
        out = self.run_cli("lint")
        self.assertIn("orphans:", out)


if __name__ == "__main__":
    unittest.main()
