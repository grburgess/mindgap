import contextlib
import importlib.util
import io
import json
import tempfile
import unittest
from pathlib import Path

from mindgap import db, prompt_recall_hook as prh

ROOT = Path(__file__).resolve().parents[1]
SCRIPT = ROOT / "tools" / "recall_compare.py"
_spec = importlib.util.spec_from_file_location("recall_compare", SCRIPT)
rc = importlib.util.module_from_spec(_spec)
_spec.loader.exec_module(rc)

ANIMALS = [("pangolin", "armadillo"), ("wombat", "quokka"), ("okapi", "giraffe"),
           ("narwhal", "walrus"), ("axolotl", "salamander"), ("tapir", "capybara")]


class RecallCompareTest(unittest.TestCase):
    def setUp(self):
        self.tmp = tempfile.TemporaryDirectory()
        self.path = Path(self.tmp.name) / "fixture.db"
        self.conn = db.connect(self.path)
        for i, (x, y) in enumerate(ANIMALS):
            db.upsert_node(self.conn, {"id": f"t{i}", "title": f"{x.title()} {y} survey"})
        for i in range(60):
            db.upsert_node(self.conn, {"id": f"d{i}", "title": f"Distractor note {i}"})
        self.queries = [{"q": f"what about the {x} and {y}", "expected": [f"t{i}"]}
                        for i, (x, y) in enumerate(ANIMALS)]
        self.qpath = Path(self.tmp.name) / "q.json"
        self.qpath.write_text(json.dumps(self.queries))

    def tearDown(self):
        self.conn.close()
        self.tmp.cleanup()

    def run_main(self, argv):
        with contextlib.redirect_stdout(io.StringIO()) as out:
            res = rc.main(argv)
        return res, out.getvalue()

    def test_null_plant_delta_is_exactly_zero(self):
        res, out = self.run_main(["--queries", str(self.qpath), "--db", str(self.path), "--arm-a-as-b"])
        self.assertEqual(res["mean_a"] - res["mean_b"], 0.0)
        self.assertEqual([r["a"] for r in res["rows"]], [r["b"] for r in res["rows"]])
        self.assertTrue(res["use_bm25"])
        self.assertIn("use_bm25 = mean_b >= mean_a -> True", out)

    def _synthetic(self, table):
        p = Path(self.tmp.name) / "table.json"
        p.write_text(json.dumps(table))
        return self.run_main(["--synthetic", str(p)])[0]

    def test_synthetic_b_better_by_two_queries_uses_bm25(self):
        a = [1, 0, 0, 1, 0, 1]
        b = [1, 1, 1, 1, 0, 1]
        res = self._synthetic([{"q": str(i), "a": x, "b": y} for i, (x, y) in enumerate(zip(a, b))])
        self.assertEqual(res["n"], 6)
        self.assertTrue(res["use_bm25"])

    def test_synthetic_b_worse_by_one_query_keeps_current(self):
        a = [1, 1, 0, 1, 0, 1]
        b = [1, 0, 0, 1, 0, 1]
        res = self._synthetic([{"q": str(i), "a": x, "b": y} for i, (x, y) in enumerate(zip(a, b))])
        self.assertFalse(res["use_bm25"])

    def test_broken_arm_scores_below_known_good_a(self):
        res, _ = self.run_main(["--queries", str(self.qpath), "--db", str(self.path), "--broken-b"])
        self.assertEqual(res["mean_a"], 1.0)  # fixture: a is known-good
        self.assertLess(res["mean_b"], res["mean_a"])
        self.assertFalse(res["use_bm25"])

    def test_bm25_arm_runs_and_keeps_two_word_filter(self):
        res, _ = self.run_main(["--queries", str(self.qpath), "--db", str(self.path)])
        self.assertEqual(res["n"], len(self.queries))
        self.assertEqual(res["mean_b"], 1.0)
        # one content word only -> nothing (the hook's >=2-word bar is kept)
        self.assertEqual(prh.rank_bm25(self.conn, "pangolin", "", 6), [])
        self.assertEqual(prh.rank_bm25(self.conn, "pangolin distractor", "", 6), [])


if __name__ == "__main__":
    unittest.main()
