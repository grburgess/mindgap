import tempfile
import unittest
from pathlib import Path

from mindgap import db


class DbTest(unittest.TestCase):
    def setUp(self):
        self.tmp = tempfile.TemporaryDirectory()
        self.conn = db.connect(Path(self.tmp.name) / "test.db")

    def tearDown(self):
        self.conn.close()
        self.tmp.cleanup()

    def test_slugify(self):
        self.assertEqual(db.slugify("Hello, World!"), "hello-world")
        self.assertEqual(db.slugify("  PyTorch 2.0  "), "pytorch-2-0")

    def test_upsert_insert_and_slug_generation(self):
        n = db.upsert_node(self.conn, {"title": "Force Graph"})
        self.assertEqual(n["id"], "force-graph")
        self.assertEqual(n["type"], "concept")
        self.assertEqual(n["tags"], [])
        self.assertEqual(n["urls"], [])
        self.assertTrue(n["created_at"])
        self.assertEqual(n["created_at"], n["updated_at"])

    def test_upsert_merge(self):
        u1 = {"label": "repo", "url": "https://x/1", "kind": "github"}
        n1 = db.upsert_node(
            self.conn,
            {"id": "a", "title": "A", "body": "old", "tags": ["x"], "urls": [u1]},
        )
        u_dup = {"label": "other label", "url": "https://x/1", "kind": "web"}
        u2 = {"label": "page", "url": "https://x/2", "kind": "confluence"}
        n2 = db.upsert_node(
            self.conn,
            {"id": "a", "title": "A2", "body": "new", "tags": ["x", "y"], "urls": [u_dup, u2]},
        )
        self.assertEqual(n2["title"], "A2")  # scalar replaced
        self.assertEqual(n2["body"], "new")
        self.assertEqual(n2["tags"], ["x", "y"])  # union
        self.assertEqual(n2["urls"], [u1, u2])  # deduped by url string
        self.assertEqual(n2["created_at"], n1["created_at"])  # preserved on merge

    def test_upsert_replace_mode(self):
        db.upsert_node(self.conn, {"id": "a", "title": "A", "tags": ["x", "y"],
                                   "urls": [{"label": "1", "url": "https://x/1", "kind": "web"}]})
        n = db.upsert_node(self.conn, {"id": "a", "tags": ["y"], "urls": []}, replace=True)
        self.assertEqual(n["tags"], ["y"])
        self.assertEqual(n["urls"], [])

    def test_upsert_normalizes_string_urls(self):
        db.upsert_node(self.conn, {"id": "a", "title": "A", "urls": ["https://x/1"]})
        n = db.upsert_node(self.conn, {"id": "a", "urls": ["https://x/1", "https://x/2"]})
        self.assertEqual([u["url"] for u in n["urls"]], ["https://x/1", "https://x/2"])
        self.assertTrue(all(isinstance(u, dict) for u in n["urls"]))

    def test_upsert_empty_slug_rejected(self):
        with self.assertRaises(ValueError):
            db.upsert_node(self.conn, {"title": "???"})

    def test_extract_wiki_links(self):
        self.assertEqual(
            db.extract_wiki_links("see [[Foo Bar]] and [[baz]] and [[Foo Bar]]"),
            ["foo-bar", "baz"],
        )

    def test_wiki_edge_sync_stub_and_stale_removal(self):
        db.upsert_node(self.conn, {"id": "src", "title": "S", "body": "[[Foo Bar]]"})
        stub = db.get_node(self.conn, "foo-bar")
        self.assertEqual(stub["type"], "stub")
        self.assertEqual(stub["title"], "Foo Bar")
        edges = self.conn.execute("SELECT * FROM edges WHERE src='src'").fetchall()
        self.assertEqual([(e["dst"], e["rel"]) for e in edges], [("foo-bar", "mentions")])
        # rewrite body: foo-bar mention removed, baz added
        db.upsert_node(self.conn, {"id": "src", "body": "[[baz]]"})
        edges = self.conn.execute("SELECT * FROM edges WHERE src='src'").fetchall()
        self.assertEqual([(e["dst"], e["rel"]) for e in edges], [("baz", "mentions")])
        self.assertIsNotNone(db.get_node(self.conn, "foo-bar"))  # stub stays

    def test_wiki_sync_preserves_manual_mentions(self):
        db.add_edge(self.conn, "a", "b", rel="mentions")
        db.upsert_node(self.conn, {"id": "a", "title": "A", "body": "no wikilinks"})
        edges = self.conn.execute("SELECT * FROM edges WHERE src='a'").fetchall()
        self.assertEqual([(e["dst"], e["rel"]) for e in edges], [("b", "mentions")])

    def test_wiki_links_skip_code_spans(self):
        self.assertEqual(db.extract_wiki_links("a `[[code]]` and [[real]]"), ["real"])
        db.upsert_node(self.conn, {"id": "s", "title": "S", "body": "syntax: `[[node-id]]`"})
        self.assertIsNone(db.get_node(self.conn, "node-id"))

    def test_add_edge_stub_endpoints(self):
        db.add_edge(self.conn, "p", "q", rel="depends_on", weight=2.0, created_by="agent")
        self.assertEqual(db.get_node(self.conn, "p")["type"], "stub")
        self.assertEqual(db.get_node(self.conn, "q")["type"], "stub")
        e = self.conn.execute("SELECT * FROM edges").fetchone()
        self.assertEqual((e["src"], e["dst"], e["rel"], e["weight"], e["created_by"]),
                         ("p", "q", "depends_on", 2.0, "agent"))

    def test_neighbors_depth(self):
        db.add_edge(self.conn, "a", "b")
        db.add_edge(self.conn, "c", "b")  # reverse direction from b
        d1 = db.neighbors(self.conn, "a", depth=1)
        self.assertEqual({n["id"] for n in d1["nodes"]}, {"a", "b"})
        d2 = db.neighbors(self.conn, "a", depth=2)
        self.assertEqual({n["id"] for n in d2["nodes"]}, {"a", "b", "c"})
        self.assertEqual(
            {(l["source"], l["target"]) for l in d2["links"]}, {("a", "b"), ("c", "b")}
        )

    def test_graph_filtered_subgraph(self):
        db.upsert_node(self.conn, {"id": "r1", "title": "R1", "type": "repo"})
        db.upsert_node(self.conn, {"id": "r2", "title": "R2", "type": "repo"})
        db.upsert_node(self.conn, {"id": "c1", "title": "C1", "type": "concept"})
        db.add_edge(self.conn, "r1", "r2")
        db.add_edge(self.conn, "r1", "c1")
        g = db.graph(self.conn, type="repo")
        self.assertEqual({n["id"] for n in g["nodes"]}, {"r1", "r2"})
        self.assertEqual(
            [(l["source"], l["target"]) for l in g["links"]], [("r1", "r2")]
        )
        full = db.graph(self.conn)
        self.assertEqual(len(full["nodes"]), 3)
        self.assertEqual(len(full["links"]), 2)

    def test_search_tag_exact_vs_contains(self):
        db.upsert_node(self.conn, {"id": "i1", "title": "I1", "tags": ["ideas", "vision-segmentation"]})
        db.upsert_node(self.conn, {"id": "i2", "title": "I2", "tags": ["vision"]})
        # default (exact): 'idea' must NOT match the 'ideas' tag — CLI/MCP behavior unchanged
        self.assertEqual([n["id"] for n in db.search(self.conn, tag="idea")], [])
        self.assertEqual([n["id"] for n in db.search(self.conn, tag="ideas")], ["i1"])
        # contains: case-insensitive substring within tags — 'idea'/'IDEA' match 'ideas'
        self.assertEqual([n["id"] for n in db.search(self.conn, tag="idea", tag_mode="contains")], ["i1"])
        self.assertEqual([n["id"] for n in db.search(self.conn, tag="IDEA", tag_mode="contains")], ["i1"])
        # contains stays scoped to tags
        self.assertEqual({n["id"] for n in db.search(self.conn, tag="vision", tag_mode="contains")}, {"i1", "i2"})

    def test_ingest_counts(self):
        res = db.ingest(
            self.conn,
            {
                "nodes": [{"id": "a", "title": "A"}, {"id": "b", "title": "B"}],
                "edges": [{"src": "a", "dst": "b", "rel": "cites"}],
            },
            created_by="loop-1",
        )
        self.assertEqual(res, {"nodes": 2, "edges": 1})
        self.assertEqual(db.get_node(self.conn, "a")["created_by"], "loop-1")
        e = self.conn.execute("SELECT * FROM edges").fetchone()
        self.assertEqual((e["rel"], e["created_by"]), ("cites", "loop-1"))

    def test_ingest_preserves_per_record_created_by(self):
        db.ingest(
            self.conn,
            {
                "nodes": [{"id": "a", "title": "A", "created_by": "loop:arxiv-scan"}],
                "edges": [{"src": "a", "dst": "b", "created_by": "loop:arxiv-scan"}],
            },
            created_by="manual",
        )
        self.assertEqual(db.get_node(self.conn, "a")["created_by"], "loop:arxiv-scan")
        e = self.conn.execute("SELECT * FROM edges").fetchone()
        self.assertEqual(e["created_by"], "loop:arxiv-scan")

    def test_delete_cascade(self):
        db.add_edge(self.conn, "a", "b")
        db.add_edge(self.conn, "b", "c")
        db.delete_node(self.conn, "b")
        self.assertIsNone(db.get_node(self.conn, "b"))
        self.assertEqual(self.conn.execute("SELECT COUNT(*) c FROM edges").fetchone()["c"], 0)


if __name__ == "__main__":
    unittest.main()
