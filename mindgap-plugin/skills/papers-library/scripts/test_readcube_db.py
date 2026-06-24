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

if __name__ == "__main__":
    unittest.main()
