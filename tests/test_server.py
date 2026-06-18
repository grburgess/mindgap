import http.client
import json
import os
import tempfile
import threading
import unittest
from http.server import ThreadingHTTPServer
from pathlib import Path

_tmp = tempfile.TemporaryDirectory()
os.environ["MINDGAP_DB"] = str(Path(_tmp.name) / "test.db")

from mindgap import server  # noqa: E402


class TestServer(unittest.TestCase):
    @classmethod
    def setUpClass(cls):
        web = Path(_tmp.name) / "web"
        web.mkdir()
        (web / "index.html").write_text("<html>mindmap-test</html>")
        cls._orig_web_dir = server.WEB_DIR
        server.WEB_DIR = web
        cls.httpd = ThreadingHTTPServer(("127.0.0.1", 0), server.Handler)
        cls.port = cls.httpd.server_address[1]
        threading.Thread(target=cls.httpd.serve_forever, daemon=True).start()

    @classmethod
    def tearDownClass(cls):
        cls.httpd.shutdown()
        server.WEB_DIR = cls._orig_web_dir
        _tmp.cleanup()

    @classmethod
    def request(cls, method, path, body=None):
        conn = http.client.HTTPConnection("127.0.0.1", cls.port)
        data = json.dumps(body).encode() if body is not None else None
        conn.request(method, path, data, {"Content-Type": "application/json"} if data else {})
        resp = conn.getresponse()
        raw = resp.read()
        conn.close()
        return resp.status, resp.getheader("Content-Type"), raw

    @classmethod
    def get_json(cls, method, path, body=None):
        status, _, raw = cls.request(method, path, body)
        return status, json.loads(raw)

    def test_01_empty_graph(self):
        status, data = self.get_json("GET", "/api/graph")
        self.assertEqual(status, 200)
        self.assertEqual(data, {"nodes": [], "links": []})

    def test_02_post_nodes_and_edge(self):
        status, node = self.get_json("POST", "/api/node", {"title": "Alpha", "tags": ["x"]})
        self.assertEqual(status, 200)
        self.assertEqual(node["id"], "alpha")
        self.assertEqual(node["created_by"], "ui")
        self.assertEqual(node["tags"], ["x"])
        status, node = self.get_json("POST", "/api/node", {"id": "beta", "title": "Beta", "type": "software"})
        self.assertEqual(status, 200)
        self.assertEqual(node["id"], "beta")
        status, data = self.get_json("POST", "/api/edge", {"src": "alpha", "dst": "beta", "rel": "depends_on"})
        self.assertEqual(status, 200)
        self.assertEqual(data, {"ok": True})

    def test_03_graph_shape(self):
        status, data = self.get_json("GET", "/api/graph")
        self.assertEqual(status, 200)
        self.assertEqual(sorted(n["id"] for n in data["nodes"]), ["alpha", "beta"])
        self.assertEqual(len(data["links"]), 1)
        link = data["links"][0]
        self.assertEqual(link["source"], "alpha")
        self.assertEqual(link["target"], "beta")
        self.assertEqual(link["rel"], "depends_on")
        self.assertEqual(link["weight"], 1.0)

    def test_04_get_node_with_neighbors(self):
        status, data = self.get_json("GET", "/api/node/alpha")
        self.assertEqual(status, 200)
        self.assertEqual(data["node"]["id"], "alpha")
        self.assertIn("beta", [n["id"] for n in data["neighbors"]["nodes"]])

    def test_05_missing_node_404(self):
        status, data = self.get_json("GET", "/api/node/nope")
        self.assertEqual(status, 404)
        self.assertIn("error", data)

    def test_06_search(self):
        status, data = self.get_json("GET", "/api/search?q=alpha")
        self.assertEqual(status, 200)
        self.assertIn("alpha", [n["id"] for n in data])
        status, data = self.get_json("GET", "/api/search?q=&type=software")
        self.assertEqual(status, 200)
        self.assertEqual([n["id"] for n in data], ["beta"])

    def test_065_tag_filter_substring(self):
        # web tag box does case-insensitive substring match: 'idea' finds a node tagged 'ideas'
        status, node = self.get_json("POST", "/api/node", {"id": "idea-x", "title": "Idea X", "tags": ["ideas"]})
        self.assertEqual(status, 200)
        status, data = self.get_json("GET", "/api/graph?tag=idea")
        self.assertEqual(status, 200)
        self.assertIn("idea-x", [n["id"] for n in data["nodes"]])
        status, data = self.get_json("GET", "/api/search?tag=IDEA")
        self.assertEqual(status, 200)
        self.assertIn("idea-x", [n["id"] for n in data])

    def test_07_stats(self):
        status, data = self.get_json("GET", "/api/stats")
        self.assertEqual(status, 200)
        self.assertIsInstance(data, dict)

    def test_08_delete_edge_then_node(self):
        status, _ = self.get_json("DELETE", "/api/edge?src=alpha&dst=beta&rel=depends_on")
        self.assertEqual(status, 200)
        _, data = self.get_json("GET", "/api/graph")
        self.assertEqual(data["links"], [])
        status, _ = self.get_json("DELETE", "/api/node/alpha")
        self.assertEqual(status, 200)
        status, _ = self.get_json("GET", "/api/node/alpha")
        self.assertEqual(status, 404)

    def test_10_post_node_replace_mode(self):
        self.get_json("POST", "/api/node",
                      {"id": "gamma", "title": "Gamma", "tags": ["a", "b"],
                       "urls": [{"label": "1", "url": "https://x/1", "kind": "web"}]})
        status, node = self.get_json("POST", "/api/node",
                                     {"id": "gamma", "tags": ["b"], "urls": [], "replace": True})
        self.assertEqual(status, 200)
        self.assertEqual(node["tags"], ["b"])
        self.assertEqual(node["urls"], [])

    def test_11_bad_payload_gets_400(self):
        status, data = self.get_json("POST", "/api/edge", {"dst": "beta"})  # missing src
        self.assertEqual(status, 400)
        self.assertIn("error", data)
        status, data = self.get_json("POST", "/api/node", {"title": "???"})  # empty slug
        self.assertEqual(status, 400)
        self.assertIn("error", data)
        status, data = self.get_json("POST", "/api/node", ["not", "a", "dict"])
        self.assertEqual(status, 400)

    def test_09_static_index(self):
        status, ctype, raw = self.request("GET", "/")
        self.assertEqual(status, 200)
        self.assertEqual(ctype, "text/html")
        self.assertIn(b"mindmap-test", raw)
        status, _, _ = self.request("GET", "/missing.css")
        self.assertEqual(status, 404)


if __name__ == "__main__":
    unittest.main()
