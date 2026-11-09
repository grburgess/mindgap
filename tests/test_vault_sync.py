import tempfile
import unittest
from pathlib import Path

from mindgap import db, vault


def _dump(conn):
    return "\n".join(conn.iterdump())


class VaultSyncTest(unittest.TestCase):
    def setUp(self):
        self.tmp = tempfile.TemporaryDirectory()
        self.dbp = Path(self.tmp.name) / "test.db"
        self.conn = db.connect(self.dbp)
        self.vault = Path(self.tmp.name) / "vault"
        db.upsert_node(self.conn, {
            "id": "a", "title": "Node A", "type": "concept", "body": "see [[b]]\n",
            "tags": ["x", "y"], "confidence": 0.7,
            "urls": [{"label": "repo", "url": "https://x/1", "kind": "github"}]})
        db.upsert_node(self.conn, {"id": "b", "title": "Node B: \"quoted\"", "body": "plain"})
        db.add_edge(self.conn, "a", "b", "depends_on")

    def tearDown(self):
        self.conn.close()
        self.tmp.cleanup()

    def sync(self):
        return vault.sync(self.conn, self.vault)

    def file(self, nid):
        return self.vault / f"{nid}.md"

    def edit(self, nid, old, new):
        p = self.file(nid)
        text = p.read_text()
        self.assertIn(old, text)
        p.write_text(text.replace(old, new))

    def test_export_one_file_per_node_with_all_frontmatter_fields(self):
        rep = self.sync()
        self.assertEqual(sorted(rep["exported"]), ["a", "b"])
        self.assertEqual(sorted(p.name for p in self.vault.glob("*.md")), ["a.md", "b.md"])
        fm, body = vault.parse_file(self.file("a").read_text())
        self.assertEqual(fm["id"], "a")
        self.assertEqual(fm["title"], "Node A")
        self.assertEqual(fm["type"], "concept")
        self.assertEqual(fm["tags"], ["x", "y"])
        self.assertEqual(fm["confidence"], 0.7)
        self.assertEqual(fm["urls"], [{"label": "repo", "url": "https://x/1", "kind": "github"}])
        self.assertEqual(fm["links"], [{"rel": "depends_on", "dst": "b"}])  # mentions excluded
        self.assertEqual(body, "see [[b]]\n")
        fm_b, _ = vault.parse_file(self.file("b").read_text())
        self.assertEqual(fm_b["title"], 'Node B: "quoted"')
        self.assertEqual(fm_b["links"], [])

    def test_non_mentions_rel_round_trip(self):
        self.sync()
        self.edit("a", '  - rel: "depends_on"\n    dst: "b"',
                  '  - rel: "depends_on"\n    dst: "b"\n  - rel: refines\n    dst: b')
        rep = self.sync()
        self.assertEqual(rep["applied"], ["a"])
        self.assertIn(("a", "b", "refines"), rep["edges_added"])
        rels = {r["rel"] for r in self.conn.execute("SELECT rel FROM edges WHERE src='a'")}
        self.assertEqual(rels, {"depends_on", "refines", "mentions"})
        # fresh export of the edited graph carries both rels back out
        vault2 = Path(self.tmp.name) / "vault2"
        vault.sync(self.conn, vault2)
        fm, _ = vault.parse_file((vault2 / "a.md").read_text())
        self.assertEqual(fm["links"], [{"rel": "depends_on", "dst": "b"}, {"rel": "refines", "dst": "b"}])

    def test_supersedes_round_trips_superseded_by_not_imported(self):
        db.add_edge(self.conn, "a", "b", db.SUPERSEDES)  # a newer, b superseded
        self.sync()
        fm_a, _ = vault.parse_file(self.file("a").read_text())
        self.assertIn({"rel": "supersedes", "dst": "b"}, fm_a["links"])
        fm_b, _ = vault.parse_file(self.file("b").read_text())
        self.assertNotIn("superseded_by", fm_b)  # derived field, never exported
        # drop the supersedes link in the vault -> edge removed
        self.edit("a", '  - rel: "supersedes"\n    dst: "b"\n', "")
        rep = self.sync()
        self.assertIn(("a", "b", "supersedes"), rep["edges_removed"])
        self.assertEqual(db.superseded_ids(self.conn), set())
        # re-add it -> edge back
        self.edit("a", '  - rel: "depends_on"\n    dst: "b"',
                  '  - rel: "depends_on"\n    dst: "b"\n  - rel: supersedes\n    dst: b')
        rep = self.sync()
        self.assertIn(("a", "b", "supersedes"), rep["edges_added"])
        self.assertEqual(db.superseded_ids(self.conn), {"b"})
        # hand-written superseded_by in frontmatter is ignored, not re-imported
        db.upsert_node(self.conn, {"id": "c", "title": "C"})
        self.sync()
        self.edit("b", 'type: ', 'superseded_by: ["c"]\ntype: ')
        before = _dump(self.conn)
        rep = self.sync()
        self.assertEqual(rep["applied"], ["b"])
        self.assertEqual(rep["edges_added"], [])
        self.assertEqual(_dump(self.conn).count("supersedes"), before.count("supersedes"))
        self.assertEqual(db.mark_superseded(self.conn, [db.get_node(self.conn, "b")])[0]
                         ["superseded_by"], ["a"])
        self.assertEqual(self.sync()["changes"], 0)

    def test_idempotent_second_sync(self):
        self.sync()
        before = _dump(self.conn)
        files = {p.name: p.read_text() for p in self.vault.iterdir()}
        rep = self.sync()
        self.assertEqual(rep["changes"], 0)
        self.assertEqual(_dump(self.conn), before)
        self.assertEqual({p.name: p.read_text() for p in self.vault.iterdir()}, files)

    def test_edit_title_body_tags_applied(self):
        self.sync()
        self.edit("a", 'title: "Node A"', "title: Renamed A")
        self.edit("a", "see [[b]]\n", "new body [[b]]\n")
        self.edit("a", 'tags:\n  - "x"\n  - "y"', "tags: [y, z]")
        rep = self.sync()
        self.assertEqual(rep["applied"], ["a"])
        n = db.get_node(self.conn, "a")
        self.assertEqual(n["title"], "Renamed A")
        self.assertEqual(n["body"], "new body [[b]]\n")
        self.assertEqual(n["tags"], ["y", "z"])
        self.assertEqual(self.sync()["changes"], 0)

    def test_new_file_becomes_node(self):
        self.sync()
        self.vault.mkdir(exist_ok=True)
        (self.vault / "c.md").write_text("---\ntitle: Node C\ntype: idea\ntags: [t]\n---\nhello\n")
        (self.vault / "My Note.md").write_text("no frontmatter here\n")
        rep = self.sync()
        self.assertEqual(sorted(rep["created"]), ["c", "my-note"])
        c = db.get_node(self.conn, "c")
        self.assertEqual((c["title"], c["type"], c["tags"], c["body"]), ("Node C", "idea", ["t"], "hello\n"))
        self.assertEqual(db.get_node(self.conn, "my-note")["body"], "no frontmatter here\n")
        self.assertTrue(self.file("my-note").exists())
        self.assertFalse((self.vault / "My Note.md").exists())
        self.assertEqual(self.sync()["changes"], 0)

    def test_add_wiki_link_creates_mentions_edge(self):
        self.sync()
        self.edit("b", "plain", "plain [[a]] and [[New Thing]]")
        rep = self.sync()
        self.assertEqual(rep["applied"], ["b"])
        self.assertIn(("b", "a", "mentions"), rep["edges_added"])
        self.assertIn(("b", "new-thing", "mentions"), rep["edges_added"])
        self.assertIn("new-thing", rep["exported"])  # stub gets its own file
        self.assertTrue(self.file("new-thing").exists())
        self.assertEqual(self.sync()["changes"], 0)

    def test_remove_links_entry_deletes_edge(self):
        self.sync()
        self.edit("a", 'links:\n  - rel: "depends_on"\n    dst: "b"', "links: []")
        rep = self.sync()
        self.assertEqual(rep["edges_removed"], [("a", "b", "depends_on")])
        self.assertIsNone(self.conn.execute(
            "SELECT 1 FROM edges WHERE src='a' AND rel='depends_on'").fetchone())
        # body [[b]] mentions edge untouched
        self.assertIsNotNone(self.conn.execute(
            "SELECT 1 FROM edges WHERE src='a' AND dst='b' AND rel='mentions'").fetchone())

    def test_both_changed_graph_wins_and_conflict_file(self):
        self.sync()
        self.edit("a", 'title: "Node A"', 'title: "Vault A"')
        db.upsert_node(self.conn, {"id": "a", "title": "Graph A"})
        rep = self.sync()
        self.assertEqual(rep["conflicts"], ["a"])
        self.assertEqual(db.get_node(self.conn, "a")["title"], "Graph A")
        self.assertIn('title: "Graph A"', self.file("a").read_text())
        self.assertIn('title: "Vault A"', (self.vault / "a.conflict.md").read_text())
        self.assertEqual(self.sync()["changes"], 0)

    def test_deleted_file_keeps_node_reported_and_reexported(self):
        self.sync()
        self.file("b").unlink()
        rep = self.sync()
        self.assertEqual(rep["deleted_in_vault"], ["b"])
        self.assertIsNotNone(db.get_node(self.conn, "b"))
        rep = self.sync()
        self.assertEqual(rep["exported"], ["b"])
        self.assertTrue(self.file("b").exists())
        self.assertEqual(self.sync()["changes"], 0)

    def test_unparseable_file_skipped_no_db_change(self):
        self.sync()
        before = _dump(self.conn)
        self.edit("a", 'title: "Node A"', 'title: "Bad A"\n  : : nonsense')
        (self.vault / "broken.md").write_text("---\ntitle: never closed\n")
        rep = self.sync()
        self.assertEqual(sorted(s.split(":")[0] for s in rep["skipped"]), ["a.md", "broken.md"])
        self.assertEqual(rep["applied"] + rep["created"], [])
        self.assertEqual(_dump(self.conn), before)
        self.assertIn("nonsense", self.file("a").read_text())  # user's file left alone

    def test_graph_deleted_node_removes_vault_file(self):
        self.sync()
        db.delete_node(self.conn, "b")
        rep = self.sync()
        self.assertEqual(rep["removed_files"], ["b.md"])
        self.assertFalse(self.file("b").exists())
        self.assertIn("a", rep["exported"])  # a's depends_on edge cascaded away
        self.assertEqual(self.sync()["changes"], 0)

    def test_backup_created_each_sync(self):
        r1 = self.sync()
        r2 = self.sync()
        baks = sorted(self.dbp.parent.glob("test.db.*.bak"))
        self.assertEqual(len(baks), 2)
        self.assertEqual({p.name for p in baks}, {Path(r1["backup"]).name, Path(r2["backup"]).name})
        import sqlite3
        b = sqlite3.connect(r1["backup"])
        self.assertEqual(b.execute("SELECT COUNT(*) FROM nodes").fetchone()[0], 2)
        b.close()


if __name__ == "__main__":
    unittest.main()
