import sqlite3
import tempfile
import unittest
from pathlib import Path

from mindgap import db


def ids(nodes):
    return [n["id"] for n in nodes]


class SearchFtsTest(unittest.TestCase):
    def setUp(self):
        self.tmp = tempfile.TemporaryDirectory()
        self.conn = db.connect(Path(self.tmp.name) / "test.db")

    def tearDown(self):
        self.conn.close()
        self.tmp.cleanup()

    def add(self, **node):
        return db.upsert_node(self.conn, node)

    def test_multi_word_and_non_adjacent(self):
        self.add(id="both", title="Widget oversplit policy", body="applies to enterprise tiers")
        self.add(id="one", title="Widget geometry", body="nothing else")
        # both terms present, not adjacent (title + body) -> hit
        self.assertEqual(ids(db.search(self.conn, "widget enterprise")), ["both"])
        # only one of the terms present -> miss
        self.assertNotIn("one", ids(db.search(self.conn, "widget enterprise")))

    def test_prefix_match_on_every_term(self):
        self.add(id="n", title="Oversplit canonical merge")
        self.assertEqual(ids(db.search(self.conn, "overspl")), ["n"])
        self.assertEqual(ids(db.search(self.conn, "canon overs")), ["n"])
        self.assertEqual(ids(db.search(self.conn, "canon overs zzz")), [])

    def test_title_hit_ranks_above_body_hit(self):
        self.add(id="body-only", title="Something", body="a long note that mentions tokenization once")
        self.add(id="in-title", title="Tokenization", body="short")
        self.assertEqual(ids(db.search(self.conn, "tokenization")), ["in-title", "body-only"])

    def test_type_and_tag_filters(self):
        self.add(id="a", title="Widget model", type="decision", tags=["widget-ui"])
        self.add(id="b", title="Widget model two", type="concept", tags=["widget-ui"])
        self.add(id="c", title="Widget model three", type="decision", tags=["other"])
        self.assertEqual(set(ids(db.search(self.conn, "widget", type="decision"))), {"a", "c"})
        self.assertEqual(set(ids(db.search(self.conn, "widget", tag="widget-ui"))), {"a", "b"})
        self.assertEqual(ids(db.search(self.conn, "widget", type="decision", tag="widget-ui")), ["a"])
        self.assertEqual(ids(db.search(self.conn, "widget", tag="WIDGET", tag_mode="contains",
                                       type="concept")), ["b"])
        self.assertEqual(ids(db.search(self.conn, "widget", tag="widget", type="concept")), [])

    def test_id_substring_fallback(self):
        self.add(id="idea-canonical-oversplit", title="Merge policy")
        # mid-word substring: FTS prefix finds nothing, LIKE fallback does
        self.assertEqual(ids(db.search(self.conn, "nonical-overs")), ["idea-canonical-oversplit"])
        self.assertEqual(ids(db.search(self.conn, "anonic")), ["idea-canonical-oversplit"])

    def test_fts_syntax_in_user_text_never_raises(self):
        self.add(id="n", title="Alpha beta")
        for q in ['"alpha', "alpha*", "alpha AND", "NOT beta", "(alpha", "a:b", "^beta", "-alpha",
                  "NEAR(alpha beta)", "'", "***", "alpha OR"]:
            db.search(self.conn, q)  # must not raise sqlite3.OperationalError
        self.assertEqual(ids(db.search(self.conn, '"alpha* (beta')), ["n"])

    def test_like_mode_keeps_substring_semantics(self):
        self.add(id="n1", title="Oversplit")
        self.add(id="n2", title="Unoversplitted")
        self.assertEqual(set(ids(db.search(self.conn, "oversplit", mode="like"))), {"n1", "n2"})

    def test_sync_after_add(self):
        self.assertEqual(db.search(self.conn, "zebra"), [])
        self.add(id="z", title="Zebra crossing")
        self.assertEqual(ids(db.search(self.conn, "zebra")), ["z"])

    def test_sync_after_body_update(self):
        self.add(id="n", title="Note", body="old words giraffe")
        self.add(id="n", body="new words okapi")
        self.assertEqual(ids(db.search(self.conn, "okapi")), ["n"])
        self.assertEqual(db.fts_search(self.conn, ["giraffe"]), [])
        count = self.conn.execute("SELECT count(*) FROM nodes_fts WHERE id='n'").fetchone()[0]
        self.assertEqual(count, 1)

    def test_sync_after_rm(self):
        self.add(id="n", title="Ephemeral marmot")
        db.delete_node(self.conn, "n")
        self.assertEqual(db.fts_search(self.conn, ["marmot"]), [])
        self.assertEqual(db.search(self.conn, "marmot"), [])

    def test_sync_after_ingest_and_stub(self):
        db.ingest(self.conn, {
            "nodes": [{"id": "p", "title": "Pangolin paper", "body": "see [[Armadillo Survey]]"}],
            "edges": [{"src": "p", "dst": "quokka-stub"}],
        }, created_by="test")
        self.assertEqual(ids(db.search(self.conn, "pangolin")), ["p"])
        self.assertEqual(ids(db.search(self.conn, "armadillo survey")), ["armadillo-survey", "p"])
        self.assertEqual(ids(n for n, _ in db.fts_search(self.conn, ["quokka"])), ["quokka-stub"])

    def test_pre_fts_db_auto_builds_index(self):
        path = Path(self.tmp.name) / "old.db"
        old_schema = db.SCHEMA.split("-- Full-text index")[0]
        self.assertNotIn("nodes_fts", old_schema)
        raw = sqlite3.connect(str(path))
        raw.executescript(old_schema)
        raw.execute("INSERT INTO nodes(id,title,body,created_at,updated_at)"
                    " VALUES('legacy','Legacy wombat','old body','t','t')")
        raw.commit()
        raw.close()
        conn = db.connect(path)
        try:
            self.assertEqual(ids(db.search(conn, "wombat")), ["legacy"])
            self.assertEqual(conn.execute("SELECT count(*) FROM nodes_fts").fetchone()[0], 1)
        finally:
            conn.close()


if __name__ == "__main__":
    unittest.main()
