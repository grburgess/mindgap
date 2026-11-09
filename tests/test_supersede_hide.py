"""M2 hide + mark: a node that is the dst of a 'supersedes' edge (src = newer) never
reaches a session through either recall hook, and every read surface (db.search,
db.graph, CLI find, MCP find/context, /api/search, /api/graph) still returns it but
marks it with superseded_by: [newer ids] ([] for normal nodes)."""
import http.client
import json
import os
import subprocess
import sys
import tempfile
import threading
import unittest
from http.server import ThreadingHTTPServer
from pathlib import Path

REPO = str(Path(__file__).resolve().parents[1])
sys.path.insert(0, REPO)

from mindgap import db, mcp  # noqa: E402


def _plant(conn):
    """old (superseded) vs new (newer) vs sibling (unmarked), all matching the same
    cwd token + prompt words + global-learning tag."""
    common = {"type": "learning", "tags": ["global-learning", "widget"]}
    db.upsert_node(conn, {**common, "id": "widget-cache-old",
                          "title": "WIDGET cache rule old", "body": "stale"})
    db.upsert_node(conn, {**common, "id": "widget-cache-new",
                          "title": "WIDGET cache rule new", "body": "current"})
    db.upsert_node(conn, {**common, "id": "widget-cache-sibling",
                          "title": "WIDGET cache rule sibling", "body": "unrelated"})
    db.add_edge(conn, "widget-cache-new", "widget-cache-old", rel="supersedes")


class _Home(unittest.TestCase):
    def setUp(self):
        self.tmp = tempfile.TemporaryDirectory()
        self.home = Path(self.tmp.name) / "home"
        self.home.mkdir()
        (self.home / "capture.json").write_text(json.dumps({"enabled": True}))
        self.conn = db.connect(self.home / "mindgap.db")
        _plant(self.conn)
        self.env = dict(os.environ, PYTHONPATH=REPO, MINDGAP_HOME=str(self.home))
        self.env.pop("MINDGAP_DB", None)
        self.env.pop("MINDGAP_BROWSER", None)

    def tearDown(self):
        self.conn.close()
        self.tmp.cleanup()

    def _run(self, *args, stdin=""):
        proc = subprocess.run([sys.executable, "-m", *args], input=stdin,
                              capture_output=True, text=True, env=self.env, timeout=15)
        self.assertEqual(proc.returncode, 0, proc.stderr)
        return proc.stdout


class HooksOmitSupersededTest(_Home):
    def test_session_start_recall_omits_superseded(self):
        out = self._run("mindgap.recall_hook",
                        stdin=json.dumps({"cwd": "/tmp/widget", "session_id": "S1"}))
        self.assertIn("widget-cache-new", out)
        self.assertIn("widget-cache-sibling", out)
        self.assertNotIn("widget-cache-old", out)

    def test_prompt_recall_omits_superseded(self):
        out = self._run("mindgap.prompt_recall_hook", stdin=json.dumps(
            {"cwd": "/tmp/x", "session_id": "S2", "prompt": "what is the WIDGET cache rule?"}))
        self.assertIn("widget-cache-new", out)
        self.assertIn("widget-cache-sibling", out)
        self.assertNotIn("widget-cache-old", out)

    def test_superseded_does_not_eat_the_prompt_limit(self):
        (self.home / "capture.json").write_text(
            json.dumps({"enabled": True, "recall": {"max_prompt": 2}}))
        out = self._run("mindgap.prompt_recall_hook", stdin=json.dumps(
            {"cwd": "/tmp/x", "session_id": "S3", "prompt": "WIDGET cache rule"}))
        hits = [l for l in out.splitlines() if l.startswith("- ")]
        self.assertEqual(len(hits), 2, out)
        self.assertNotIn("widget-cache-old", out)


class MarkerTest(_Home):
    def _by_id(self, nodes):
        return {n["id"]: n["superseded_by"] for n in nodes}

    def test_db_search_fts_and_like_carry_marker(self):
        for mode in ("fts", "like"):
            m = self._by_id(db.search(self.conn, q="cache", mode=mode))
            self.assertEqual(m["widget-cache-old"], ["widget-cache-new"], mode)
            self.assertEqual(m["widget-cache-new"], [], mode)
            self.assertEqual(m["widget-cache-sibling"], [], mode)

    def test_db_graph_carries_marker(self):
        for g in (db.graph(self.conn), db.graph(self.conn, q="widget")):
            m = self._by_id(g["nodes"])
            self.assertEqual(m["widget-cache-old"], ["widget-cache-new"])
            self.assertEqual(m["widget-cache-sibling"], [])

    def test_superseded_ids(self):
        self.assertEqual(db.superseded_ids(self.conn), {"widget-cache-old"})

    def test_mcp_find_and_context(self):
        m = self._by_id(mcp.tool_find(self.conn, {"query": "cache"})["results"])
        self.assertEqual(m["widget-cache-old"], ["widget-cache-new"])
        self.assertEqual(m["widget-cache-sibling"], [])
        md = mcp.tool_context(self.conn, {"query": "cache"})["markdown"]
        self.assertIn("SUPERSEDED by: widget-cache-new", md)
        self.assertEqual(md.count("SUPERSEDED by:"), 1)

    def test_cli_find_shows_marker(self):
        out = self._run("mindgap", "find", "cache")
        lines = {l.split("\t")[0]: l for l in out.splitlines()}
        self.assertIn("[superseded by widget-cache-new]", lines["widget-cache-old"])
        self.assertNotIn("superseded", lines["widget-cache-sibling"])
        rows = json.loads(self._run("mindgap", "find", "cache", "--json"))
        self.assertEqual(self._by_id(rows)["widget-cache-old"], ["widget-cache-new"])


class ApiMarkerTest(unittest.TestCase):
    @classmethod
    def setUpClass(cls):
        cls.tmp = tempfile.TemporaryDirectory()
        cls._env = {k: os.environ.get(k) for k in ("MINDGAP_DB", "MINDGAP_HOME")}
        os.environ["MINDGAP_DB"] = str(Path(cls.tmp.name) / "api.db")
        os.environ["MINDGAP_HOME"] = cls.tmp.name
        conn = db.connect()
        _plant(conn)
        conn.close()
        from mindgap import server
        cls.httpd = ThreadingHTTPServer(("127.0.0.1", 0), server.Handler)
        threading.Thread(target=cls.httpd.serve_forever, daemon=True).start()

    @classmethod
    def tearDownClass(cls):
        cls.httpd.shutdown()
        cls.httpd.server_close()
        for k, v in cls._env.items():
            if v is None:
                os.environ.pop(k, None)
            else:
                os.environ[k] = v
        cls.tmp.cleanup()

    def _get(self, path):
        c = http.client.HTTPConnection("127.0.0.1", self.httpd.server_address[1])
        c.request("GET", path)
        r = c.getresponse()
        data = json.loads(r.read())
        c.close()
        self.assertEqual(r.status, 200)
        return data

    def test_api_search_and_graph_carry_marker(self):
        for nodes in (self._get("/api/search?q=cache"),
                      self._get("/api/graph")["nodes"],
                      self._get("/api/graph?q=widget")["nodes"]):
            m = {n["id"]: n["superseded_by"] for n in nodes}
            self.assertEqual(m["widget-cache-old"], ["widget-cache-new"])
            self.assertEqual(m["widget-cache-sibling"], [])


if __name__ == "__main__":
    unittest.main()
