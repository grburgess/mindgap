"""HTTP server: JSON API over db + static files from web/."""
import json
import mimetypes
import webbrowser
from http.server import BaseHTTPRequestHandler, ThreadingHTTPServer
from pathlib import Path
from urllib.parse import parse_qs, unquote, urlparse

from . import config, db

WEB_DIR = config.web_dir()


class Handler(BaseHTTPRequestHandler):
    def log_message(self, format, *args):  # suppress per-request noise
        pass

    def _json(self, obj, status=200):
        body = json.dumps(obj).encode()
        self.send_response(status)
        self.send_header("Content-Type", "application/json")
        self.send_header("Content-Length", str(len(body)))
        self.end_headers()
        self.wfile.write(body)

    def _qs(self):
        qs = parse_qs(urlparse(self.path).query)
        return lambda k, default=None: qs.get(k, [default])[0]

    def _handle(self, fn):
        # map db/payload errors to JSON responses instead of dropped connections
        try:
            fn()
        except (KeyError, TypeError, ValueError) as e:
            self._json({"error": f"{type(e).__name__}: {e}"}, 400)
        except Exception as e:
            self._json({"error": f"{type(e).__name__}: {e}"}, 500)

    def do_GET(self):
        path = urlparse(self.path).path
        if not path.startswith("/api/"):
            return self._static(path)
        q = self._qs()
        conn = db.connect()
        try:
            def handle():
                if path == "/api/graph":
                    self._json(db.graph(conn, q=q("q"), type=q("type"), tag=q("tag"), tag_mode="contains"))
                elif path.startswith("/api/node/"):
                    node_id = unquote(path[len("/api/node/"):])
                    node = db.get_node(conn, node_id)
                    if node is None:
                        self._json({"error": f"node not found: {node_id}"}, 404)
                    else:
                        self._json({"node": node, "neighbors": db.neighbors(conn, node_id)})
                elif path == "/api/search":
                    self._json(db.search(conn, q=q("q", ""), type=q("type"), tag=q("tag"), tag_mode="contains"))
                elif path == "/api/stats":
                    self._json(db.stats(conn))
                else:
                    self._json({"error": "not found"}, 404)
            self._handle(handle)
        finally:
            conn.close()

    def do_POST(self):
        path = urlparse(self.path).path
        try:
            payload = json.loads(self.rfile.read(int(self.headers.get("Content-Length", 0))))
        except ValueError:
            return self._json({"error": "invalid JSON"}, 400)
        if not isinstance(payload, dict):
            return self._json({"error": "payload must be a JSON object"}, 400)
        conn = db.connect()
        try:
            def handle():
                if path == "/api/node":
                    payload["created_by"] = "ui"
                    replace = bool(payload.pop("replace", False))
                    node = db.upsert_node(conn, payload, replace=replace)
                    conn.commit()
                    self._json(node)
                elif path == "/api/edge":
                    db.add_edge(conn, payload["src"], payload["dst"],
                                rel=payload.get("rel", "relates_to"),
                                weight=payload.get("weight", 1.0), created_by="ui")
                    conn.commit()
                    self._json({"ok": True})
                else:
                    self._json({"error": "not found"}, 404)
            self._handle(handle)
        finally:
            conn.close()

    def do_DELETE(self):
        path = urlparse(self.path).path
        q = self._qs()
        conn = db.connect()
        try:
            def handle():
                if path.startswith("/api/node/"):
                    db.delete_node(conn, unquote(path[len("/api/node/"):]))
                    conn.commit()
                    self._json({"ok": True})
                elif path == "/api/edge":
                    db.delete_edge(conn, q("src"), q("dst"), q("rel"))
                    conn.commit()
                    self._json({"ok": True})
                else:
                    self._json({"error": "not found"}, 404)
            self._handle(handle)
        finally:
            conn.close()

    def _static(self, path):
        rel = "index.html" if path == "/" else unquote(path).lstrip("/")
        file = (WEB_DIR / rel).resolve()
        if not file.is_relative_to(WEB_DIR.resolve()) or not file.is_file():
            return self._json({"error": "not found"}, 404)
        ctype = mimetypes.guess_type(file.name)[0] or "application/octet-stream"
        data = file.read_bytes()
        self.send_response(200)
        self.send_header("Content-Type", ctype)
        self.send_header("Content-Length", str(len(data)))
        self.end_headers()
        self.wfile.write(data)


def run(port=8765, open_browser=True):
    server = ThreadingHTTPServer(("127.0.0.1", port), Handler)
    url = f"http://localhost:{port}"
    print(f"mindgap serving at {url}")
    if open_browser:
        webbrowser.open(url)
    server.serve_forever()
