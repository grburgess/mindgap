import unittest
import readcube_db as R

ITEM_ARXIV = {"id": "AAAA1111-...", "deleted": False,
    "article": {"title": "popsynth: A generic population synthesis", "year": 2021,
                "journal": "JOSS", "authors": ["J Michael Burgess", "Other A"]},
    "ext_ids": {"doi": "10.21105/joss.03257", "arxiv": "2107.12404v2"},
    "user_data": {"citekey": "Burgess:2021po", "tags": ["populations"],
                  "notes": "see [[somenode]] great tool"}}
ITEM_DOI = {"id": "BBBB2222", "article": {"title": "A DOI-only paper", "authors": ["X Y"]},
            "ext_ids": {"doi": "10.1086/588136"}, "user_data": {"citekey": "X:2008"}}
ITEM_BARE = {"id": "CCCC3333-zzzz", "article": {"title": "No ids here", "authors": ["Z"]},
             "ext_ids": {}, "user_data": {}}

class TestIds(unittest.TestCase):
    def test_slugify(self):
        self.assertEqual(R.slugify("Hello, World!"), "hello-world")
    def test_safe_neutralizes_wikilinks(self):
        self.assertEqual(R.safe("a [[x]] b"), "a [x] b")
    def test_paper_id_priority(self):
        self.assertEqual(R.paper_id(ITEM_ARXIV), "arxiv-2107-12404")  # vN stripped
        self.assertEqual(R.paper_id(ITEM_DOI), "doi-10-1086-588136")
        self.assertEqual(R.paper_id(ITEM_BARE), "rc-cccc3333")
    def test_authors(self):
        self.assertEqual(R._authors(ITEM_DOI), ["X Y"])

class TestTopicIds(unittest.TestCase):
    def test_disambiguates_duplicate_names_by_parent(self):
        lists = [
            {"id": "L1", "name": "Cosmic Rays", "parent_id": "ROOTA"},
            {"id": "L2", "name": "Cosmic Rays", "parent_id": "ROOTB"},
            {"id": "ROOTA", "name": "astrophysics", "parent_id": None},
            {"id": "ROOTB", "name": "X-Ray Group", "parent_id": None},
        ]
        tid = R.assign_topic_ids(lists)
        self.assertEqual(len(set(tid.values())), 4)          # no collisions
        self.assertIn("topic-cosmic-rays", tid.values())     # first keeps base
        self.assertTrue(any(v.startswith("topic-cosmic-rays-") for v in tid.values()))

class TestNodes(unittest.TestCase):
    def test_paper_node(self):
        n = R.paper_node(ITEM_ARXIV)
        self.assertEqual(n["id"], "arxiv-2107-12404")
        self.assertEqual(n["type"], "paper")
        self.assertIn("papers-library", n["tags"])
        self.assertIn("populations", n["tags"])
        self.assertTrue(n["body"].startswith("**Authors:** J Michael Burgess"))
        self.assertNotIn("[[", n["body"])                    # wiki-links neutralized
        kinds = {u["kind"] for u in n["urls"]}
        self.assertEqual(kinds, {"arxiv", "web"})
        self.assertEqual(n["confidence"], 0.9)
        self.assertEqual(n["created_by"], "skill:papers-library")
    def test_topic_node(self):
        n = R.topic_node({"id": "L1", "name": "Gamma-ray Burst", "item_ids": [1, 2, 3]}, "topic-gamma-ray-burst")
        self.assertEqual((n["id"], n["type"]), ("topic-gamma-ray-burst", "concept"))
        self.assertIn("topic", n["tags"])

def json_dumps(d):
    import json
    return json.dumps(d)


class TestPayload(unittest.TestCase):
    def _data(self):
        items = [ITEM_ARXIV, ITEM_DOI, ITEM_BARE,
                 {"id": "DUP", "article": {"title": "dup", "authors": ["A"]},
                  "ext_ids": {"arxiv": "2107.12404"}, "user_data": {}}]  # same arxiv as ITEM_ARXIV
        lists = [
            {"id": "T_GRB", "name": "Gamma-ray Burst", "parent_id": "T_ASTRO",
             "item_ids": [ITEM_ARXIV["id"], ITEM_DOI["id"]]},
            {"id": "T_ASTRO", "name": "astrophysics", "parent_id": None, "item_ids": []},
            {"id": "T_JUNK", "name": "auto_import", "parent_id": None, "item_ids": []},  # island → dropped
        ]
        return items, lists

    def test_core_and_dedup(self):
        items, lists = self._data()
        p = R.build_payload(items, lists)
        ids = {n["id"] for n in p["nodes"] if n["type"] == "paper"}
        # ITEM_ARXIV+DUP share arxiv id → 1 node; ITEM_DOI listed; ITEM_BARE only authored? no → excluded
        self.assertEqual(ids, {"arxiv-2107-12404", "doi-10-1086-588136"})
        self.assertNotIn("rc-cccc3333", ids)          # unlisted, non-authored → excluded

    def test_authored_included_even_if_unlisted(self):
        items, lists = self._data()
        p = R.build_payload(items, lists)
        # ITEM_ARXIV authored (Burgess) & listed; edge to hub present
        self.assertTrue(any(e["dst"] == "grburgess" and e["rel"] == "relates_to" for e in p["edges"]))
        self.assertTrue(any(n["id"] == "grburgess" and n["type"] == "person" for n in p["nodes"]))

    def test_topic_hierarchy_and_drop(self):
        items, lists = self._data()
        p = R.build_payload(items, lists)
        topic_ids = {n["id"] for n in p["nodes"] if n["type"] == "concept"}
        self.assertIn("topic-gamma-ray-burst", topic_ids)
        self.assertIn("topic-astrophysics", topic_ids)        # kept: has child
        self.assertNotIn("topic-auto-import", topic_ids)      # dropped: island
        self.assertTrue(any(e["rel"] == "part_of" and e["dst"] == "topic-astrophysics" for e in p["edges"]))

    def test_no_dangling_endpoints(self):
        items, lists = self._data()
        p = R.build_payload(items, lists)
        node_ids = {n["id"] for n in p["nodes"]}
        for e in p["edges"]:
            self.assertIn(e["src"], node_ids)
            self.assertIn(e["dst"], node_ids)

    def test_roundtrip_through_sqlite(self):
        import sqlite3, tempfile, os
        items, lists = self._data()
        fd, path = tempfile.mkstemp(suffix=".db"); os.close(fd)
        c = sqlite3.connect(path)
        c.execute("CREATE TABLE items(id TEXT, json TEXT)")
        c.execute("CREATE TABLE lists(id TEXT, json TEXT)")
        c.executemany("INSERT INTO items VALUES(?,?)", [(i["id"], json_dumps(i)) for i in items])
        c.executemany("INSERT INTO lists VALUES(?,?)", [(l["id"], json_dumps(l)) for l in lists])
        c.commit(); c.close()
        conn = R.open_ro(path)
        gi, gl = R.load(conn)
        self.assertEqual(len(gi), len(items))
        self.assertEqual(len(gl), len(lists))
        p = R.build_payload(gi, gl)
        self.assertIn("nodes", p)
        self.assertIn("edges", p)
        os.remove(path)

    def test_empty_parent_kept_when_child_has_core(self):
        items = [ITEM_DOI]  # listed below under the CHILD
        lists = [
            {"id": "P", "name": "Surveys", "parent_id": None, "item_ids": []},       # 0 papers
            {"id": "C", "name": "Selection Effects", "parent_id": "P", "item_ids": [ITEM_DOI["id"]]},
            {"id": "J1", "name": "junkroot", "parent_id": None, "item_ids": []},      # empty tree...
            {"id": "J2", "name": "junkchild", "parent_id": "J1", "item_ids": []},     # ...both dropped
        ]
        p = R.build_payload(items, lists)
        tids = {n["id"] for n in p["nodes"] if n["type"] == "concept"}
        self.assertIn("topic-surveys", tids)            # empty parent kept: its tree has a core paper
        self.assertIn("topic-selection-effects", tids)
        self.assertNotIn("topic-junkroot", tids)        # fully-empty tree dropped
        self.assertNotIn("topic-junkchild", tids)
        # no dangling: every edge endpoint is a node
        node_ids = {n["id"] for n in p["nodes"]}
        for e in p["edges"]:
            self.assertIn(e["src"], node_ids); self.assertIn(e["dst"], node_ids)


if __name__ == "__main__":
    unittest.main()
