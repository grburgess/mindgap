"""Tests for mindgap/mcp.py — the stdlib MCP server.

ASSUMED MINIMAL INTERFACE:

  from mindgap import mcp

  - mcp.dispatch(msg, conn) -> dict | None
        Pure handler for ONE parsed JSON-RPC message dict.
        * Returns a JSON-RPC response dict for requests (has "id").
        * Returns None for notifications (e.g. notifications/initialized).
        * `conn` is an open sqlite3 connection (db.connect(...)); injecting it
          lets unit tests run against a temp DB without env/subprocess.
        * Protocol-level failures (unknown method/tool, bad params) come back
          as a JSON-RPC `error` object. Tool-level failures come back as a
          normal result whose `content[0].text` carries the message and with
          isError:true.

  E2E: `python3 -m mindgap.mcp` speaks newline-delimited JSON-RPC 2.0 over
  stdin/stdout (one object per line, "\n"-terminated, flushed each write),
  honoring MINDGAP_DB for DB isolation.

Helpers:
  - rpc(method, params, id=None)            build a request/notification dict
  - tool_payload(result)                    json.loads(result['content'][0]['text'])
  - send_rpc(*messages) -> [responses]      E2E: pipe messages, parse stdout lines
  - seed state directly via db.upsert_node / db.add_edge
"""
import json
import os
import subprocess
import sys
import tempfile
import unittest
from pathlib import Path

from mindgap import db, mcp

REPO = str(Path(__file__).resolve().parents[1])

# protocol versions the server accepts/echoes
PROTOCOL_VERSION = "2025-06-18"

# the full tool name set
TOOL_NAMES = {
    "mindgap_ingest",
    "mindgap_add_node",
    "mindgap_link",
    "mindgap_unlink",
    "mindgap_get_node",
    "mindgap_find",
    "mindgap_context",
    "mindgap_stats",
    "mindgap_export",
    "mindgap_remove_node",
}


def rpc(method, params=None, id=None):
    """Build a JSON-RPC 2.0 message. Omit id -> notification."""
    msg = {"jsonrpc": "2.0", "method": method}
    if params is not None:
        msg["params"] = params
    if id is not None:
        msg["id"] = id
    return msg


def tool_payload(result):
    """Extract the JSON value a tool handler put in content[0].text."""
    return json.loads(result["content"][0]["text"])


# --------------------------------------------------------------------------- #
# Unit tests: call dispatch() directly against an injected temp-DB connection. #
# --------------------------------------------------------------------------- #
class McpDispatchTest(unittest.TestCase):
    def setUp(self):
        self.tmp = tempfile.TemporaryDirectory()
        self.dbpath = Path(self.tmp.name) / "test.db"
        self.conn = db.connect(self.dbpath)

    def tearDown(self):
        self.conn.close()
        self.tmp.cleanup()

    # convenience wrappers -------------------------------------------------- #
    def call_tool(self, name, arguments, id=1):
        """Send a tools/call and return the JSON-RPC response dict."""
        return mcp.dispatch(
            rpc("tools/call", {"name": name, "arguments": arguments}, id=id),
            self.conn,
        )

    def tool_result(self, name, arguments, id=1):
        """tools/call -> the result object {content, isError}."""
        resp = self.call_tool(name, arguments, id=id)
        self.assertIn("result", resp, resp)
        return resp["result"]

    # --- lifecycle / protocol --------------------------------------------- #
    def test_initialize_result_shape(self):
        resp = mcp.dispatch(
            rpc("initialize",
                {"protocolVersion": PROTOCOL_VERSION,
                 "capabilities": {}, "clientInfo": {"name": "t", "version": "0"}},
                id=1),
            self.conn,
        )
        self.assertEqual(resp["jsonrpc"], "2.0")
        self.assertEqual(resp["id"], 1)
        res = resp["result"]
        self.assertEqual(res["protocolVersion"], PROTOCOL_VERSION)
        # ONLY the tools capability is declared (no resources/prompts).
        self.assertIn("tools", res["capabilities"])
        self.assertNotIn("resources", res["capabilities"])
        self.assertNotIn("prompts", res["capabilities"])
        self.assertEqual(res["serverInfo"]["name"], "mindgap")
        self.assertEqual(res["serverInfo"]["version"], "0.1.0")

    def test_initialize_unknown_version_falls_back(self):
        resp = mcp.dispatch(
            rpc("initialize",
                {"protocolVersion": "1999-01-01", "capabilities": {}}, id=1),
            self.conn,
        )
        # never error on version; default advertised version returned
        self.assertEqual(resp["result"]["protocolVersion"], PROTOCOL_VERSION)

    def test_initialize_echoes_supported_version(self):
        resp = mcp.dispatch(
            rpc("initialize",
                {"protocolVersion": "2024-11-05", "capabilities": {}}, id=7),
            self.conn,
        )
        self.assertEqual(resp["result"]["protocolVersion"], "2024-11-05")

    def test_initialized_notification_returns_none(self):
        out = mcp.dispatch(rpc("notifications/initialized"), self.conn)
        self.assertIsNone(out)

    def test_ping(self):
        resp = mcp.dispatch(rpc("ping", id=3), self.conn)
        self.assertEqual(resp["result"], {})
        self.assertEqual(resp["id"], 3)

    def test_unknown_method_is_minus_32601(self):
        resp = mcp.dispatch(rpc("nope/whatever", id=5), self.conn)
        self.assertNotIn("result", resp)
        self.assertEqual(resp["error"]["code"], -32601)
        self.assertEqual(resp["id"], 5)

    def test_unknown_tool_is_minus_32602(self):
        resp = mcp.dispatch(
            rpc("tools/call", {"name": "mindgap_nope", "arguments": {}}, id=6),
            self.conn,
        )
        self.assertNotIn("result", resp)
        self.assertEqual(resp["error"]["code"], -32602)

    # --- tools/list ------------------------------------------------------- #
    def test_tools_list_exposes_full_set(self):
        resp = mcp.dispatch(rpc("tools/list", {}, id=2), self.conn)
        tools = resp["result"]["tools"]
        names = {t["name"] for t in tools}
        self.assertEqual(names, TOOL_NAMES)
        # one page, no pagination cursor leaked
        self.assertNotIn("nextCursor", resp["result"])
        for t in tools:
            self.assertIn("description", t)
            schema = t["inputSchema"]
            self.assertEqual(schema["type"], "object")

    def test_tools_list_ignores_incoming_cursor(self):
        resp = mcp.dispatch(rpc("tools/list", {"cursor": "junk"}, id=2), self.conn)
        names = {t["name"] for t in resp["result"]["tools"]}
        self.assertEqual(names, TOOL_NAMES)

    # --- tool happy paths ------------------------------------------------- #
    def test_add_node_happy(self):
        res = self.tool_result(
            "mindgap_add_node",
            {"created_by": "mcp", "title": "Force Graph", "type": "concept"},
        )
        self.assertFalse(res["isError"])
        payload = tool_payload(res)
        # persisted row returned
        self.assertEqual(payload["id"], "force-graph")
        self.assertEqual(payload["type"], "concept")
        # tool-layer confidence default = 0.7
        self.assertEqual(payload["confidence"], 0.7)
        self.assertIn("stubs_created", payload)
        self.assertIn("warnings", payload)
        # actually landed in the DB
        self.assertIsNotNone(db.get_node(self.conn, "force-graph"))

    def test_add_node_requires_created_by(self):
        res = self.tool_result("mindgap_add_node", {"title": "No Provenance"})
        self.assertTrue(res["isError"])
        # nothing written
        self.assertIsNone(db.get_node(self.conn, "no-provenance"))

    def test_find_happy(self):
        db.upsert_node(self.conn, {"id": "qw", "title": "Quantum Widget",
                                   "type": "software"})
        res = self.tool_result("mindgap_find", {"query": "quantum"})
        payload = tool_payload(res)
        self.assertEqual(payload["count"], 1)
        self.assertEqual(payload["results"][0]["id"], "qw")
        # type filter that excludes -> empty
        res2 = self.tool_result("mindgap_find", {"query": "quantum", "type": "paper"})
        self.assertEqual(tool_payload(res2)["count"], 0)

    def test_get_node_happy(self):
        db.upsert_node(self.conn, {"id": "a", "title": "A"})
        db.upsert_node(self.conn, {"id": "b", "title": "B"})
        db.add_edge(self.conn, "a", "b", rel="depends_on")
        res = self.tool_result("mindgap_get_node", {"id": "a"})
        payload = tool_payload(res)
        self.assertEqual(payload["node"]["id"], "a")
        self.assertIn("b", [n["id"] for n in payload["neighbors"]["nodes"]])

    def test_get_node_miss_is_clean_null_not_error(self):
        res = self.tool_result("mindgap_get_node", {"id": "ghost"})
        # clean miss, NOT isError
        self.assertFalse(res["isError"])
        payload = tool_payload(res)
        self.assertIsNone(payload["node"])
        self.assertEqual(payload["neighbors"], {"nodes": [], "links": []})

    def test_link_happy_between_existing(self):
        db.upsert_node(self.conn, {"id": "a", "title": "A"})
        db.upsert_node(self.conn, {"id": "b", "title": "B"})
        res = self.tool_result(
            "mindgap_link",
            {"created_by": "mcp", "src": "a", "dst": "b", "rel": "cites"},
        )
        self.assertFalse(res["isError"])
        payload = tool_payload(res)
        self.assertEqual(payload["edge"]["src"], "a")
        self.assertEqual(payload["edge"]["dst"], "b")
        self.assertEqual(payload["edge"]["rel"], "cites")
        self.assertIn("existed", payload)
        e = self.conn.execute("SELECT * FROM edges").fetchone()
        self.assertEqual((e["src"], e["dst"], e["rel"]), ("a", "b", "cites"))

    def test_unlink_happy(self):
        db.upsert_node(self.conn, {"id": "a", "title": "A"})
        db.upsert_node(self.conn, {"id": "b", "title": "B"})
        db.add_edge(self.conn, "a", "b", rel="cites")
        res = self.tool_result("mindgap_unlink", {"src": "a", "dst": "b", "rel": "cites"})
        payload = tool_payload(res)
        self.assertEqual(payload["removed"], 1)
        self.assertIn("orphaned", payload)
        self.assertEqual(self.conn.execute("SELECT COUNT(*) c FROM edges").fetchone()["c"], 0)

    def test_context_happy_markdown(self):
        db.upsert_node(self.conn, {"id": "alpha", "title": "Alpha",
                                   "body": "links to [[beta]]", "tags": ["t1"]})
        res = self.tool_result("mindgap_context", {"query": "alpha"})
        self.assertFalse(res["isError"])
        payload = tool_payload(res)
        md = payload["markdown"]
        self.assertIn("## Alpha (alpha) [concept]", md)
        self.assertIn("links to [[beta]]", md)
        self.assertIn("mentions", md)
        self.assertEqual(payload["matched"], 1)

    def test_stats_verbatim(self):
        db.upsert_node(self.conn, {"id": "s1", "title": "S1"})
        res = self.tool_result("mindgap_stats", {})
        payload = tool_payload(res)
        self.assertEqual(set(payload), {"nodes", "edges", "by_type", "by_rel"})
        self.assertEqual(payload["nodes"], 1)

    def test_export_happy(self):
        db.upsert_node(self.conn, {"id": "x", "title": "X"})
        db.upsert_node(self.conn, {"id": "y", "title": "Y"})
        db.add_edge(self.conn, "x", "y")
        out_path = os.path.join(self.tmp.name, "snap.json")
        res = self.tool_result("mindgap_export", {"out": out_path})
        payload = tool_payload(res)
        self.assertEqual(payload["path"], out_path)
        self.assertEqual(payload["counts"]["nodes"], 2)
        self.assertEqual(payload["counts"]["edges"], 1)
        snap = json.load(open(out_path))
        self.assertEqual({n["id"] for n in snap["nodes"]}, {"x", "y"})
        # edges rendered with src/dst/rel/weight/created_by
        self.assertEqual(snap["edges"][0]["src"], "x")
        self.assertEqual(snap["edges"][0]["dst"], "y")
        self.assertIn("created_by", snap["edges"][0])

    def test_remove_node_happy(self):
        db.upsert_node(self.conn, {"id": "a", "title": "A"})
        db.add_edge(self.conn, "a", "b")  # creates stub b + edge
        res = self.tool_result("mindgap_remove_node", {"id": "a"})
        payload = tool_payload(res)
        self.assertEqual(payload, {"removed": True, "id": "a"})
        self.assertIsNone(db.get_node(self.conn, "a"))
        # cascade removed the edge
        self.assertEqual(self.conn.execute("SELECT COUNT(*) c FROM edges").fetchone()["c"], 0)

    def test_ingest_happy_returns_persisted_rows(self):
        res = self.tool_result(
            "mindgap_ingest",
            {"created_by": "loop:t",
             "nodes": [{"id": "n1", "title": "N1"}, {"id": "n2", "title": "N2"}],
             "edges": [{"src": "n1", "dst": "n2", "rel": "cites"}]},
        )
        self.assertFalse(res["isError"])
        payload = tool_payload(res)
        self.assertEqual(payload["counts"], {"nodes": 2, "edges": 1})
        # the anti-desync point: persisted full rows are echoed back
        ids = {n["id"] for n in payload["nodes"]}
        self.assertEqual(ids, {"n1", "n2"})
        n1 = next(n for n in payload["nodes"] if n["id"] == "n1")
        self.assertEqual(n1["title"], "N1")
        self.assertIn("tags", n1)  # full get_node row, not a stub echo
        self.assertEqual(payload["edges"][0]["src"], "n1")
        self.assertIn("stubs_created", payload)
        self.assertIn("warnings", payload)

    # --- validation tests (the point of this server) ---------------------- #
    def test_ingest_requires_created_by(self):
        res = self.tool_result(
            "mindgap_ingest", {"nodes": [{"id": "n1", "title": "N1"}]}
        )
        self.assertTrue(res["isError"])
        self.assertIsNone(db.get_node(self.conn, "n1"))

    def test_ingest_dangling_edge_rejected_no_stub_written(self):
        res = self.tool_result(
            "mindgap_ingest",
            {"created_by": "loop:t",
             "nodes": [{"id": "n1", "title": "N1"}],
             # n2 is neither in payload nodes nor in DB -> dangling endpoint
             "edges": [{"src": "n1", "dst": "n2", "rel": "cites"}]},
        )
        self.assertTrue(res["isError"])
        # WHOLE payload rejected: n1 NOT written...
        self.assertIsNone(db.get_node(self.conn, "n1"))
        # ...and crucially NO stub minted for the dangling endpoint n2
        self.assertIsNone(db.get_node(self.conn, "n2"))
        self.assertEqual(self.conn.execute("SELECT COUNT(*) c FROM edges").fetchone()["c"], 0)

    def test_ingest_edge_endpoint_satisfied_by_existing_db_node(self):
        # endpoint already in DB (not in payload nodes) -> valid, accepted
        db.upsert_node(self.conn, {"id": "existing", "title": "Existing"})
        res = self.tool_result(
            "mindgap_ingest",
            {"created_by": "loop:t",
             "nodes": [{"id": "n1", "title": "N1"}],
             "edges": [{"src": "n1", "dst": "existing", "rel": "cites"}]},
        )
        self.assertFalse(res["isError"])
        self.assertIsNotNone(db.get_node(self.conn, "n1"))
        self.assertEqual(self.conn.execute("SELECT COUNT(*) c FROM edges").fetchone()["c"], 1)

    def test_ingest_rejects_non_slug_id(self):
        res = self.tool_result(
            "mindgap_ingest",
            {"created_by": "loop:t",
             "nodes": [{"id": "Not A Slug", "title": "X"}]},
        )
        self.assertTrue(res["isError"])
        self.assertIsNone(db.get_node(self.conn, "Not A Slug"))
        self.assertIsNone(db.get_node(self.conn, "not-a-slug"))

    def test_link_to_nonexistent_endpoint_hard_fails(self):
        db.upsert_node(self.conn, {"id": "a", "title": "A"})
        res = self.tool_result(
            "mindgap_link",
            {"created_by": "mcp", "src": "a", "dst": "ghost"},
        )
        self.assertTrue(res["isError"])
        self.assertIsNone(db.get_node(self.conn, "ghost"))  # no stub minted
        self.assertEqual(self.conn.execute("SELECT COUNT(*) c FROM edges").fetchone()["c"], 0)

    def test_link_requires_created_by(self):
        db.upsert_node(self.conn, {"id": "a", "title": "A"})
        db.upsert_node(self.conn, {"id": "b", "title": "B"})
        res = self.tool_result("mindgap_link", {"src": "a", "dst": "b"})
        self.assertTrue(res["isError"])
        self.assertEqual(self.conn.execute("SELECT COUNT(*) c FROM edges").fetchone()["c"], 0)

    def test_ingest_new_wikilink_stub_surfaced_as_warning(self):
        res = self.tool_result(
            "mindgap_ingest",
            {"created_by": "loop:t",
             "nodes": [{"id": "src", "title": "Src", "body": "see [[brand-new]]"}]},
        )
        self.assertFalse(res["isError"])
        payload = tool_payload(res)
        self.assertIn("brand-new", payload["stubs_created"])
        self.assertTrue(payload["warnings"])


# --------------------------------------------------------------------------- #
# E2E tests: launch `python3 -m mindgap.mcp` and exchange newline JSON-RPC.   #
# --------------------------------------------------------------------------- #
class McpRegressionTest(unittest.TestCase):
    """Regressions for the post-review fixes."""

    def setUp(self):
        self.tmp = tempfile.TemporaryDirectory()
        self.conn = db.connect(Path(self.tmp.name) / "test.db")

    def tearDown(self):
        self.conn.close()
        self.tmp.cleanup()

    def result(self, name, arguments):
        resp = mcp.dispatch(
            rpc("tools/call", {"name": name, "arguments": arguments}, id=1), self.conn)
        self.assertIn("result", resp, resp)
        return resp["result"]

    # --- critical: ingest is truly all-or-nothing -------------------------- #
    def test_ingest_atomic_no_partial_commit_on_bad_bind(self):
        res = self.result("mindgap_ingest", {
            "created_by": "loop:t",
            "nodes": [{"id": "n1", "title": "N1"}, {"id": "n2", "title": "N2"}],
            "edges": [{"src": "n1", "dst": "n2", "weight": {}}],
        })
        self.assertTrue(res["isError"], res)
        self.assertEqual(db.search(self.conn, ""), [],
                         "partial commit: nodes survived a failed ingest")

    # --- major: tool execution failures are isError, not -32603 ------------- #
    def test_bad_arg_is_tool_error_not_protocol_error(self):
        resp = mcp.dispatch(
            rpc("tools/call",
                {"name": "mindgap_add_node",
                 "arguments": {"created_by": "mcp", "title": "X",
                               "confidence": {"bad": 1}}}, id=1),
            self.conn)
        self.assertNotIn("error", resp, "bad args must not be a JSON-RPC error")
        self.assertTrue(resp["result"]["isError"], resp)

    def test_unknown_argument_key_rejected(self):
        res = self.result("mindgap_add_node", {"created_by": "mcp", "titel": "typo"})
        self.assertTrue(res["isError"])
        self.assertIn("titel", res["content"][0]["text"])

    # --- decision 1: out-of-vocab type/rel warn but still write ------------- #
    def test_out_of_vocab_type_warns_still_writes(self):
        res = self.result("mindgap_add_node",
                          {"created_by": "mcp", "title": "Gizmo", "type": "gizmo"})
        self.assertFalse(res["isError"], res)
        payload = tool_payload(res)
        self.assertEqual(db.get_node(self.conn, "gizmo")["type"], "gizmo")
        self.assertTrue(any("out-of-vocab type" in w for w in payload["warnings"]))

    def test_out_of_vocab_rel_warns_still_writes(self):
        db.upsert_node(self.conn, {"id": "a", "title": "A"})
        db.upsert_node(self.conn, {"id": "b", "title": "B"})
        res = self.result("mindgap_ingest", {
            "created_by": "loop:t", "nodes": [],
            "edges": [{"src": "a", "dst": "b", "rel": "frobnicates"}],
        })
        self.assertFalse(res["isError"], res)
        payload = tool_payload(res)
        self.assertTrue(any("out-of-vocab rel" in w for w in payload["warnings"]))

    # --- decision 3: non-canonical created_by warns but is accepted -------- #
    def test_noncanonical_created_by_warns_still_accepts(self):
        res = self.result("mindgap_add_node", {"created_by": "bob", "title": "Y"})
        self.assertFalse(res["isError"], res)
        payload = tool_payload(res)
        self.assertEqual(payload["created_by"], "bob")
        self.assertIn(mcp.PROVENANCE_HINT, payload["warnings"])

    # --- mindgap_link existed flag VALUE (not just key) -------------------- #
    def test_link_existed_flag_value(self):
        db.upsert_node(self.conn, {"id": "a", "title": "A"})
        db.upsert_node(self.conn, {"id": "b", "title": "B"})
        first = tool_payload(self.result(
            "mindgap_link", {"created_by": "mcp", "src": "a", "dst": "b", "rel": "cites"}))
        self.assertFalse(first["existed"])
        again = tool_payload(self.result(
            "mindgap_link", {"created_by": "mcp", "src": "a", "dst": "b", "rel": "cites"}))
        self.assertTrue(again["existed"])

    # --- decision 5: an edgeless node warns (island) ----------------------- #
    def test_island_node_warns(self):
        payload = tool_payload(self.result(
            "mindgap_add_node", {"created_by": "mcp", "title": "Lonely"}))
        self.assertTrue(any("island" in w for w in payload["warnings"]), payload)

    def test_wikilink_node_is_not_island(self):
        payload = tool_payload(self.result(
            "mindgap_add_node",
            {"created_by": "mcp", "title": "Linked", "body": "see [[other-node]]"}))
        self.assertFalse(any("island" in w for w in payload["warnings"]), payload)


class McpE2ETest(unittest.TestCase):
    def setUp(self):
        self.tmpdir = tempfile.TemporaryDirectory()
        self.db = os.path.join(self.tmpdir.name, "test.db")
        self.env = dict(os.environ, MINDGAP_DB=self.db, PYTHONPATH=REPO)

    def tearDown(self):
        self.tmpdir.cleanup()

    def send_rpc(self, *messages, raw_lines=None):
        """Feed newline-delimited JSON messages to the server over stdin."""
        if raw_lines is not None:
            stdin = "".join(line + "\n" for line in raw_lines)
        else:
            stdin = "".join(json.dumps(m) + "\n" for m in messages)
        proc = subprocess.run(
            [sys.executable, "-m", "mindgap.mcp"],
            input=stdin, capture_output=True, text=True, env=self.env,
        )
        out = []
        for line in proc.stdout.splitlines():
            line = line.strip()
            if line:
                out.append(json.loads(line))
        self._stderr = proc.stderr
        return out

    def _init_seq(self):
        return [
            rpc("initialize",
                {"protocolVersion": PROTOCOL_VERSION, "capabilities": {},
                 "clientInfo": {"name": "t", "version": "0"}}, id=1),
            rpc("notifications/initialized"),
        ]

    def test_initialize_handshake(self):
        out = self.send_rpc(*self._init_seq())
        # initialize answered; initialized notification produced NO line
        self.assertEqual(len(out), 1, out)
        res = out[0]["result"]
        self.assertEqual(res["serverInfo"]["name"], "mindgap")
        self.assertEqual(res["protocolVersion"], PROTOCOL_VERSION)

    def test_initialized_notification_no_response_line(self):
        out = self.send_rpc(rpc("notifications/initialized"))
        self.assertEqual(out, [])

    def test_tools_list_after_init(self):
        out = self.send_rpc(*self._init_seq(), rpc("tools/list", {}, id=2))
        listing = next(m for m in out if m.get("id") == 2)
        names = {t["name"] for t in listing["result"]["tools"]}
        self.assertEqual(names, TOOL_NAMES)

    def test_add_node_then_find_roundtrip(self):
        out = self.send_rpc(
            *self._init_seq(),
            rpc("tools/call",
                {"name": "mindgap_add_node",
                 "arguments": {"created_by": "mcp", "title": "Quantum Widget",
                               "type": "software"}}, id=2),
            rpc("tools/call",
                {"name": "mindgap_find", "arguments": {"query": "quantum"}}, id=3),
        )
        find = next(m for m in out if m.get("id") == 3)
        payload = tool_payload(find["result"])
        self.assertEqual(payload["count"], 1)
        self.assertEqual(payload["results"][0]["id"], "quantum-widget")

    def test_ingest_then_get_node_roundtrip(self):
        out = self.send_rpc(
            *self._init_seq(),
            rpc("tools/call",
                {"name": "mindgap_ingest",
                 "arguments": {"created_by": "loop:t",
                               "nodes": [{"id": "n1", "title": "N1"},
                                         {"id": "n2", "title": "N2"}],
                               "edges": [{"src": "n1", "dst": "n2", "rel": "cites"}]}},
                id=2),
            rpc("tools/call",
                {"name": "mindgap_get_node", "arguments": {"id": "n1"}}, id=3),
        )
        get = next(m for m in out if m.get("id") == 3)
        payload = tool_payload(get["result"])
        self.assertEqual(payload["node"]["id"], "n1")
        self.assertIn("n2", [n["id"] for n in payload["neighbors"]["nodes"]])

    def test_honors_mindgap_db_cli_sees_write(self):
        # write through the MCP, then read the same DB through the CLI
        self.send_rpc(
            *self._init_seq(),
            rpc("tools/call",
                {"name": "mindgap_add_node",
                 "arguments": {"created_by": "mcp", "id": "shared", "title": "Shared"}},
                id=2),
        )
        proc = subprocess.run(
            [sys.executable, "-m", "mindgap", "show", "shared", "--json"],
            capture_output=True, text=True, env=self.env,
        )
        self.assertEqual(proc.returncode, 0, proc.stderr)
        self.assertEqual(json.loads(proc.stdout)["node"]["id"], "shared")

    def test_malformed_line_emits_parse_error_then_continues(self):
        out = self.send_rpc(
            raw_lines=[
                json.dumps(rpc("initialize",
                               {"protocolVersion": PROTOCOL_VERSION,
                                "capabilities": {}}, id=1)),
                json.dumps(rpc("notifications/initialized")),
                "{ this is not valid json",
                "",  # blank line is skipped, not an error
                json.dumps(rpc("ping", id=9)),
            ]
        )
        parse_errors = [m for m in out if m.get("error", {}).get("code") == -32700]
        self.assertTrue(parse_errors, out)
        self.assertIsNone(parse_errors[0]["id"])  # id null on parse error
        # server still answered the request AFTER the bad line
        pong = next((m for m in out if m.get("id") == 9), None)
        self.assertIsNotNone(pong, out)
        self.assertEqual(pong["result"], {})

    def test_dangling_edge_ingest_rejected_no_stub_persisted(self):
        out = self.send_rpc(
            *self._init_seq(),
            rpc("tools/call",
                {"name": "mindgap_ingest",
                 "arguments": {"created_by": "loop:t",
                               "nodes": [{"id": "n1", "title": "N1"}],
                               "edges": [{"src": "n1", "dst": "ghost"}]}}, id=2),
        )
        call = next(m for m in out if m.get("id") == 2)
        self.assertTrue(call["result"]["isError"])
        # confirm via CLI that NOTHING (incl. a stub) was persisted
        proc = subprocess.run(
            [sys.executable, "-m", "mindgap", "stats"],
            capture_output=True, text=True, env=self.env,
        )
        self.assertEqual(proc.returncode, 0, proc.stderr)
        stats = json.loads(proc.stdout)
        self.assertEqual(stats["nodes"], 0)
        self.assertEqual(stats["edges"], 0)


if __name__ == "__main__":
    unittest.main()
