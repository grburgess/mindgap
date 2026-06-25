# tests/test_mine.py
import tempfile
import unittest
from pathlib import Path

from mindgap import db, mine


class MineEnrichTest(unittest.TestCase):
    def setUp(self):
        self.tmp = tempfile.TemporaryDirectory()
        self.conn = db.connect(Path(self.tmp.name) / "t.db")
        payload = {"nodes": [{"id": i, "title": i, "type": "concept"}
                             for i in ("seed", "near", "far")],
                   "edges": [{"src": "seed", "dst": "near", "rel": "relates_to"},
                             {"src": "near", "dst": "far", "rel": "relates_to"}]}
        db.ingest(self.conn, payload, "test")
        self.conn.commit()

    def tearDown(self):
        self.conn.close()
        self.tmp.cleanup()

    def test_enrich_ranks_near_above_far(self):
        res = mine.enrich(self.conn, "seed")
        ids = [r["id"] for r in res["results"]]
        self.assertLess(ids.index("near"), ids.index("far"))
        self.assertNotIn("seed", ids)

    def test_enrich_resolves_seed_by_search(self):
        res = mine.enrich(self.conn, "nea")     # substring -> resolves to 'near'
        self.assertIn("near", res["seed"])


class MineLearnTest(unittest.TestCase):
    def setUp(self):
        self.tmp = tempfile.TemporaryDirectory()
        import os
        os.environ["MINDGAP_HOME"] = self.tmp.name
        self.conn = db.connect(Path(self.tmp.name) / "t.db")
        db.ingest(self.conn, {"nodes": [
            {"id": "s", "title": "S", "type": "stub", "body": ""},
            {"id": "ref1", "title": "R1", "type": "concept", "body": "x" * 400},
            {"id": "ref2", "title": "R2", "type": "concept", "body": "x" * 400},
        ], "edges": [{"src": "ref1", "dst": "s", "rel": "mentions"},
                     {"src": "ref2", "dst": "s", "rel": "mentions"}]}, "test")
        self.conn.commit()

    def tearDown(self):
        import os
        self.conn.close(); self.tmp.cleanup(); os.environ.pop("MINDGAP_HOME", None)

    def test_learn_emits_file_and_ranks_stub(self):
        from mindgap import config
        out = mine.learn(self.conn, top=10)
        self.assertEqual(out["queue"][0]["id"], "s")
        self.assertTrue(config.frontier_path().exists())
        import json
        data = json.loads(config.frontier_path().read_text())
        self.assertEqual(data[0]["id"], "s")


class MineConnectApplyTest(unittest.TestCase):
    def setUp(self):
        self.tmp = tempfile.TemporaryDirectory()
        self.conn = db.connect(Path(self.tmp.name) / "t.db")
        db.ingest(self.conn, {"nodes": [
            {"id": "a", "title": "A", "type": "concept", "body": "a"},
            {"id": "b", "title": "B", "type": "concept", "body": "b"}], "edges": []}, "test")
        self.conn.commit()

    def tearDown(self):
        self.conn.close(); self.tmp.cleanup()

    def _edges(self):
        return list(self.conn.execute("SELECT src,dst,rel,created_by FROM edges"))

    def test_apply_writes_edge_and_insight_then_is_idempotent(self):
        decisions = [{"a": "a", "b": "b", "accept": True, "rel": "relates_to",
                      "rationale": "both about X", "confidence": 0.6, "distant": True}]
        out1 = mine.connect_apply(self.conn, decisions)
        self.assertEqual(out1["edges_written"], 1)
        self.assertEqual(out1["insights_written"], 1)
        self.assertIsNotNone(db.get_node(self.conn, "insight-a-b"))
        # provenance + the relates_to edge present
        rels = {(r["src"], r["dst"], r["rel"]): r["created_by"] for r in self._edges()}
        self.assertEqual(rels[("a", "b", "relates_to")], "mine:connect")
        # re-apply -> nothing new
        out2 = mine.connect_apply(self.conn, decisions)
        self.assertEqual(out2["edges_written"], 0)
        self.assertEqual(out2["skipped"], 1)

    def test_rejected_decisions_are_ignored(self):
        out = mine.connect_apply(self.conn, [{"a": "a", "b": "b", "accept": False}])
        self.assertEqual(out, {"edges_written": 0, "insights_written": 0, "skipped": 0})


class MineConnectCandidatesTest(unittest.TestCase):
    def setUp(self):
        self.tmp = tempfile.TemporaryDirectory()
        self.conn = db.connect(Path(self.tmp.name) / "t.db")
        nodes = [{"id": i, "title": i, "type": "concept", "body": f"body {i}"}
                 for i in ("a", "b", "z1", "z2", "z3")]
        edges = []
        for z in ("z1", "z2", "z3"):
            edges += [{"src": "a", "dst": z, "rel": "relates_to"},
                      {"src": "b", "dst": z, "rel": "relates_to"}]
        db.ingest(self.conn, {"nodes": nodes, "edges": edges}, "test")
        self.conn.commit()

    def tearDown(self):
        self.conn.close(); self.tmp.cleanup()

    def test_surfaces_guarded_pair_with_bodies_and_template(self):
        out = mine.connect_candidates(self.conn, k=5)
        c = out["candidates"][0]
        self.assertEqual({c["a"], c["b"]}, {"a", "b"})
        self.assertIn("body", c["a_body"])
        self.assertTrue(c["support"])
        self.assertEqual(out["template"][0]["confidence"], 0.6)
