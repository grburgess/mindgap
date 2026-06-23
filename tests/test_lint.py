import os
import tempfile
import unittest
from pathlib import Path

from mindgap import db, lint


class LintTest(unittest.TestCase):
    def setUp(self):
        self.tmp = tempfile.TemporaryDirectory()
        self.conn = db.connect(Path(self.tmp.name) / "t.db")

    def tearDown(self):
        self.conn.close()
        self.tmp.cleanup()

    def test_orphans(self):
        db.upsert_node(self.conn, {"id": "a", "title": "A"})
        db.upsert_node(self.conn, {"id": "b", "title": "B"})
        db.upsert_node(self.conn, {"id": "lonely", "title": "Lonely"})
        db.add_edge(self.conn, "a", "b", rel="relates_to")
        ids = {o["id"] for o in lint.orphans(self.conn)}
        self.assertIn("lonely", ids)
        self.assertNotIn("a", ids)

    def test_dangling_stubs(self):
        db.upsert_node(self.conn, {"id": "real", "title": "Real", "type": "concept"})
        db.upsert_node(self.conn, {"id": "s", "title": "Stub", "type": "stub"})
        ids = {s["id"] for s in lint.dangling_stubs(self.conn)}
        self.assertEqual(ids, {"s"})

    def test_duplicate_candidates(self):
        db.upsert_node(self.conn, {"id": "vector-database", "title": "Vector Database"})
        db.upsert_node(self.conn, {"id": "vector-databases", "title": "Vector Databases"})
        db.upsert_node(self.conn, {"id": "roof-seg", "title": "Roof Segmentation"})
        pairs = lint.duplicate_candidates(self.conn, threshold=0.86)
        flat = {tuple(sorted((p["a"], p["b"]))) for p in pairs}
        self.assertIn(("vector-database", "vector-databases"), flat)

    def test_stale_capture(self):
        db.upsert_node(self.conn, {"id": "old", "title": "Old", "confidence": 0.6,
                                   "created_by": "capture:repo"})
        db.upsert_node(self.conn, {"id": "fresh", "title": "Fresh", "confidence": 0.6,
                                   "created_by": "capture:repo"})
        db.upsert_node(self.conn, {"id": "curated", "title": "Curated", "confidence": 1.0,
                                   "created_by": "manual"})
        # backdate "old" 100 days
        self.conn.execute("UPDATE nodes SET updated_at='2020-01-01T00:00:00+00:00' WHERE id='old'")
        self.conn.commit()
        ids = {s["id"] for s in lint.stale_capture(self.conn, stale_days=60, below_confidence=0.7)}
        self.assertEqual(ids, {"old"})

    def test_report_shape(self):
        rep = lint.report(self.conn)
        self.assertEqual(set(rep), {"orphans", "dangling_stubs",
                                    "duplicate_candidates", "stale_capture"})


if __name__ == "__main__":
    unittest.main()
