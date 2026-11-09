import json
import os
import shlex
import subprocess
import sys
import tempfile
import time
import unittest
from pathlib import Path

from mindgap import db, supersede

REPO = str(Path(__file__).resolve().parents[1])

# (newer, older) — each planted to fire exactly one heuristic.
TRUE_PAIRS = {
    ("eval-results-alpha-new", "eval-results-alpha-old"),  # anchor-title
    ("abc-123-revised", "abc-123-baseline"),               # ticket
    ("dataset-widgets-2026-03-01", "dataset-widgets-2026-01-01"),  # id-stem
    ("merge-head-gate-results", "merge-head-plan"),        # status
    ("churn-report-v21", "churn-report-v2"),                 # anchor-title, version in title
}


def _node(conn, nid, title, ts, body="", type="concept"):
    db.upsert_node(conn, {"id": nid, "title": title, "body": body, "type": type})
    conn.execute("UPDATE nodes SET created_at=?, updated_at=? WHERE id=?", (ts, ts, nid))


def plant(conn):
    """5 true pairs, 5 distractor pairs, unrelated nodes. Older = earlier timestamp."""
    t0, t1 = "2026-01-01T00:00:00+00:00", "2026-02-01T00:00:00+00:00"
    for p in ("proj-alpha", "proj-beta", "proj-gamma", "proj-delta"):
        _node(conn, p, p.replace("-", " ").title(), t0, type="project")
    # true pairs
    _node(conn, "eval-results-alpha-old", "Widget ranker eval results on testset v1", t0)
    _node(conn, "eval-results-alpha-new", "Widget ranker eval results on testset v2", t1)
    _node(conn, "abc-123-baseline", "[ABC-123] Baseline analysis", t0)
    _node(conn, "abc-123-revised", "ABC-123 — Revisited post-processing", t1)
    _node(conn, "dataset-widgets-2026-01-01", "Widget dataset January cut", t0)
    _node(conn, "dataset-widgets-2026-03-01", "Rebuilt widget label table", t1)
    _node(conn, "merge-head-plan", "Merge head plan", t0, body="STATUS 2026-01-05: planned")
    _node(conn, "merge-head-gate-results", "Merge head gate results", t1,
          body="Gate ran.\nSTATUS UPDATE 2026-02-10: gate 0 passed")
    _node(conn, "churn-report-v2", "Churn model report v2", t0)
    _node(conn, "churn-report-v21", "Churn model report v2.1", t1)
    # distractors
    _node(conn, "latency-notes-a", "Widget latency estimator notes", t0)    # D1 same title,
    _node(conn, "latency-notes-b", "Widget latency estimator notes", t1)    #    no shared anchor
    _node(conn, "join-gotcha", "Customer join gotcha", t0)            # D2 shared anchor,
    _node(conn, "vendor-list", "Hardware vendor list", t1)             #    unlike titles
    _node(conn, "abc-124-x", "[ABC-124] Custom capture", t0)          # D3 different keys
    _node(conn, "abc-125-x", "[ABC-125] Custom capture", t1)
    _node(conn, "body-key-a", "Log download", t0, body="see XYZ-77")  # D4 key in body only
    _node(conn, "body-key-b", "Invoice export", t1, body="see XYZ-77")
    _node(conn, "cats", "Cats", t0, body="STATUS 2026-01-01: open")    # D5 status dates,
    _node(conn, "dog-supply", "Dog food supply chain", t1,              #    unlike titles
          body="STATUS 2026-02-01: closed")
    # unrelated
    _node(conn, "lone-a", "BigQuery partition pruning", t0)
    _node(conn, "lone-b", "Lovasz loss", t1)
    links = [
        ("eval-results-alpha-old", "proj-alpha"), ("eval-results-alpha-new", "proj-alpha"),
        ("merge-head-plan", "proj-beta"), ("merge-head-gate-results", "proj-beta"),
        ("churn-report-v2", "proj-gamma"), ("churn-report-v21", "proj-gamma"),
        ("latency-notes-a", "proj-alpha"), ("latency-notes-b", "proj-delta"),
        ("join-gotcha", "proj-alpha"), ("vendor-list", "proj-alpha"),
        ("cats", "proj-beta"), ("dog-supply", "proj-beta"),
        ("lone-a", "proj-delta"),
    ]
    for s, d in links:
        db.add_edge(conn, s, d, "part_of", commit=False)
    conn.commit()


def edge_rows(conn):
    return set(tuple(r) for r in conn.execute(
        "SELECT src,dst,rel,weight,created_by,created_at FROM edges"))


def pairs_of(cands):
    return {(c["newer"], c["older"]) for c in cands}


class GeneratorTest(unittest.TestCase):
    def setUp(self):
        self.tmp = tempfile.TemporaryDirectory()
        self.conn = db.connect(Path(self.tmp.name) / "test.db")
        plant(self.conn)

    def tearDown(self):
        self.conn.close()
        self.tmp.cleanup()

    def test_returns_exactly_the_true_pairs_newer_first(self):
        self.assertEqual(pairs_of(supersede.candidates(self.conn)), TRUE_PAIRS)

    def test_each_pair_carries_reasons(self):
        kinds = {(c["newer"], c["older"]): {r.split(":")[0] for r in c["reasons"]}
                 for c in supersede.candidates(self.conn)}
        self.assertIn("anchor-title", kinds[("eval-results-alpha-new", "eval-results-alpha-old")])
        self.assertIn("ticket", kinds[("abc-123-revised", "abc-123-baseline")])
        self.assertIn("id-stem", kinds[("dataset-widgets-2026-03-01", "dataset-widgets-2026-01-01")])
        self.assertIn("status", kinds[("merge-head-gate-results", "merge-head-plan")])

    def test_second_run_without_new_nodes_is_empty(self):
        self.assertTrue(supersede.candidates(self.conn))
        self.assertEqual(supersede.candidates(self.conn), [])

    def test_watermark_only_pairs_touching_new_nodes(self):
        supersede.candidates(self.conn)
        db.upsert_node(self.conn, {"id": "eval-results-alpha-v3",
                                   "title": "Widget ranker eval results on testset v3"})
        db.add_edge(self.conn, "eval-results-alpha-v3", "proj-alpha", "part_of")
        got = pairs_of(supersede.candidates(self.conn))
        self.assertEqual(got, {("eval-results-alpha-v3", "eval-results-alpha-new"),
                               ("eval-results-alpha-v3", "eval-results-alpha-old")})

    def test_all_ignores_watermark(self):
        supersede.candidates(self.conn)
        self.assertEqual(pairs_of(supersede.candidates(self.conn, all_=True)), TRUE_PAIRS)

    def test_already_superseded_pair_is_skipped(self):
        self.conn.execute("INSERT INTO edges(src,dst,rel,created_by,created_at)"
                          " VALUES('churn-report-v2','churn-report-v21','supersedes','x','t')")
        got = pairs_of(supersede.candidates(self.conn))
        self.assertEqual(got, TRUE_PAIRS - {("churn-report-v21", "churn-report-v2")})


class WriteRevertTest(unittest.TestCase):
    FOREIGN = ("eval-results-alpha-new", "eval-results-alpha-old", "supersedes", 0.5,
               "loop:foreign", "2026-01-09T00:00:00+00:00")

    def setUp(self):
        self.tmp = tempfile.TemporaryDirectory()
        self.conn = db.connect(Path(self.tmp.name) / "test.db")
        plant(self.conn)
        self.conn.execute("INSERT INTO edges(src,dst,rel,weight,created_by,created_at)"
                          " VALUES(?,?,?,?,?,?)", self.FOREIGN)
        self.conn.commit()

    def tearDown(self):
        self.conn.close()
        self.tmp.cleanup()

    def _pairs(self, *ps):
        return [{"newer": n, "older": o, "reason": "test"} for n, o in ps]

    def test_source_never_replaces_edges(self):
        src = Path(supersede.__file__).read_text()
        self.assertIn("INSERT OR IGNORE INTO edges", src)
        self.assertNotIn("INSERT OR REPLACE INTO edges", src)
        self.assertNotIn("add_edge", src)

    def test_write_inserts_with_run_provenance(self):
        out = supersede.write(self.conn, "R1", self._pairs(("abc-123-revised", "abc-123-baseline")))
        self.assertEqual(len(out["written"]), 1)
        row = self.conn.execute("SELECT created_by FROM edges WHERE src='abc-123-revised'"
                                " AND dst='abc-123-baseline' AND rel='supersedes'").fetchone()
        self.assertEqual(row["created_by"], "supersede:R1")
        run = self.conn.execute("SELECT status FROM supersede_runs WHERE run_id='R1'").fetchone()
        self.assertEqual(run["status"], "written")

    def test_foreign_edge_survives_rewrite_and_revert(self):
        before = edge_rows(self.conn)
        pair = ("eval-results-alpha-new", "eval-results-alpha-old")
        out = supersede.write(self.conn, "R1", self._pairs(pair))
        self.assertEqual(out["written"], [])
        self.assertEqual(out["skipped"][0]["why"], "exists")
        self.assertIn(self.FOREIGN, edge_rows(self.conn))  # not replaced
        supersede.revert(self.conn, "R1")
        self.assertIn(self.FOREIGN, edge_rows(self.conn))
        self.assertEqual(edge_rows(self.conn), before)

    def test_rewrite_of_same_pair_is_ignored(self):
        p = self._pairs(("abc-123-revised", "abc-123-baseline"))
        supersede.write(self.conn, "R1", p)
        snap = edge_rows(self.conn)
        out = supersede.write(self.conn, "R2", p)
        self.assertEqual(out["written"], [])
        self.assertEqual(edge_rows(self.conn), snap)  # R1's row untouched

    def test_revert_removes_exactly_that_run(self):
        before = edge_rows(self.conn)
        supersede.write(self.conn, "R1", self._pairs(
            ("abc-123-revised", "abc-123-baseline"),
            ("dataset-widgets-2026-03-01", "dataset-widgets-2026-01-01")))
        after_r1 = edge_rows(self.conn)
        supersede.write(self.conn, "R2", self._pairs(("churn-report-v21", "churn-report-v2")))
        r2_rows = edge_rows(self.conn) - after_r1
        self.assertEqual(len(r2_rows), 1)
        out = supersede.revert(self.conn, "R1")
        self.assertEqual(out["deleted"], 2)
        self.assertEqual(edge_rows(self.conn), before | r2_rows)
        supersede.revert(self.conn, "R2")
        self.assertEqual(edge_rows(self.conn), before)

    def test_write_skips_non_candidates_and_unknown_nodes(self):
        supersede.record_run(self.conn, "R3", [{"newer": "churn-report-v21",
                                                "older": "churn-report-v2"}])
        out = supersede.write(self.conn, "R3", self._pairs(
            ("churn-report-v2", "churn-report-v21"),   # flipped candidate: allowed
            ("lone-b", "lone-a"),                    # not a candidate
        ))
        self.assertEqual([(w["newer"], w["older"]) for w in out["written"]],
                         [("churn-report-v2", "churn-report-v21")])
        self.assertEqual(out["skipped"][0]["why"], "not-a-candidate")
        out = supersede.write(self.conn, "R4", self._pairs(("ghost", "lone-a")))
        self.assertEqual(out["skipped"][0]["why"], "unknown-node")
        self.assertIsNone(db.get_node(self.conn, "ghost"))  # never auto-stubs

    def test_bad_run_id_rejected(self):
        with self.assertRaises(ValueError):
            supersede.write(self.conn, "x; rm -rf /", [])
        with self.assertRaises(ValueError):
            supersede.revert(self.conn, "")


class JudgeSpawnTest(unittest.TestCase):
    def setUp(self):
        self.tmp = tempfile.TemporaryDirectory()
        root = Path(self.tmp.name)
        self.home = root / "home"
        self.home.mkdir()
        self.dbp = root / "test.db"
        conn = db.connect(self.dbp)
        plant(conn)
        conn.close()
        self.bin = root / "bin"
        self.bin.mkdir()
        self.marker = root / "argv.txt"
        fake = self.bin / "claude"  # appends one argv block per call, then sleeps
        fake.write_text("#!/bin/sh\n{ printf '%s\\n' \"$@\"; echo '<<END>>'; } >> "
                        f"'{self.marker}'\necho fake-claude-out\nexec sleep ${{FAKE_SLEEP:-0}}\n")
        fake.chmod(0o755)
        self.write_cfg({"supersede": {"timeout_s": 60}})
        self.env = dict(os.environ, PYTHONPATH=REPO, MINDGAP_HOME=str(self.home),
                        MINDGAP_DB=str(self.dbp),
                        PATH=str(self.bin) + os.pathsep + os.environ["PATH"])
        self.env.pop("MINDGAP_CAPTURE", None)
        self.env.pop("MINDGAP_CAPTURE_CONFIG", None)

    def tearDown(self):
        self._wait(lambda: not (self.home / "supersede.lock").exists(), 10)
        self.tmp.cleanup()

    def write_cfg(self, cfg):
        (self.home / "capture.json").write_text(json.dumps(cfg))

    def _wait(self, cond, timeout=8.0):
        end = time.time() + timeout
        while time.time() < end:
            if cond():
                return True
            time.sleep(0.05)
        return cond()

    def _calls(self):
        if not self.marker.exists():
            return []
        return [b.strip("\n").split("\n") for b in self.marker.read_text().split("<<END>>")
                if b.strip()]

    def _log(self, name="supersede.log"):
        p = self.home / name
        return p.read_text() if p.exists() else ""

    def _cli(self, *args):
        return subprocess.run([sys.executable, "-m", "mindgap", "supersede", *args],
                              capture_output=True, text=True, env=self.env, timeout=30)

    def test_spawn_args_model_tools_and_lock_release(self):
        proc = self._cli("judge", "--run-id", "R9")
        self.assertEqual(proc.returncode, 0, proc.stderr)
        self.assertEqual(json.loads(proc.stdout)["status"], "spawned")
        self.assertTrue(self._wait(lambda: len(self._calls()) == 1))
        argv = self._calls()[0]
        self.assertEqual(argv[0], "-p")
        i, j = argv.index("--allowedTools"), argv.index("--model")
        self.assertEqual(argv[j + 1], "sonnet")
        cands = self.home / "supersede" / "R9" / "candidates-0.json"
        self.assertEqual(argv[i + 1:j], [  # exactly these two, nothing broader
            f"Read(/{cands})",
            f"Bash({sys.executable} -m mindgap supersede write --run-id R9 --pairs:*)"])
        data = json.loads(cands.read_text())
        self.assertEqual({(d["newer"]["id"], d["older"]["id"]) for d in data}, TRUE_PAIRS)
        self.assertTrue(all(d["newer"]["title"] and "body" in d["older"] for d in data))
        self.assertIn(str(cands), argv[1])  # prompt names the file
        self.assertTrue(self._wait(lambda: "run=R9 batch=0 exit=0" in self._log()), self._log())
        # supervisor logs the exit, THEN releases the lock in `finally`: wait, don't race it
        self.assertTrue(self._wait(lambda: not (self.home / "supersede.lock").exists(), 3))

    def test_timeout_kills_child_and_releases_lock(self):
        self.write_cfg({"supersede": {"timeout_s": 1}})
        self.env["FAKE_SLEEP"] = "30"
        self._cli("judge", "--run-id", "RT")
        self.assertTrue(self._wait(lambda: (self.home / "supersede.lock").exists(), 3))
        self.assertTrue(self._wait(lambda: "run=RT batch=0 exit=timeout" in self._log(), 10),
                        self._log())
        self.assertTrue(self._wait(lambda: not (self.home / "supersede.lock").exists(), 3))

    def test_held_lock_skips_without_consuming_watermark(self):
        (self.home / "supersede.lock").write_text(str(int(time.time())))
        out = json.loads(self._cli("judge", "--run-id", "RL").stdout)
        self.assertEqual(out["status"], "skip=locked")
        self.assertEqual(self._calls(), [])
        (self.home / "supersede.lock").unlink()
        out = json.loads(self._cli("candidates", "--json").stdout)
        self.assertEqual(pairs_of(out), TRUE_PAIRS)  # still pending

    def test_no_candidates_no_spawn(self):
        self._cli("candidates")  # consume the watermark
        out = json.loads(self._cli("judge").stdout)
        self.assertEqual(out["status"], "no-candidates")
        self.assertFalse((self.home / "supersede.lock").exists())
        time.sleep(0.5)
        self.assertEqual(self._calls(), [])

    def test_batches_split_by_batch_pairs(self):
        self.write_cfg({"supersede": {"timeout_s": 60, "batch_pairs": 2}})
        out = json.loads(self._cli("judge", "--run-id", "RB").stdout)
        self.assertEqual(out["batches"], 3)
        self.assertTrue(self._wait(lambda: "run=RB batch=2 exit=0" in self._log()), self._log())
        self.assertEqual(len(self._calls()), 3)

    def test_prompted_write_command_runs(self):
        """The exact command the judge is allowed to run writes the run's edges."""
        cmd = shlex.split(supersede.write_cmd("RW")) + [
            "--pairs", json.dumps([{"newer": "churn-report-v21", "older": "churn-report-v2"}])]
        proc = subprocess.run(cmd, capture_output=True, text=True, env=self.env, timeout=30)
        self.assertEqual(proc.returncode, 0, proc.stderr)
        self.assertEqual(len(json.loads(proc.stdout)["written"]), 1)
        proc = self._cli("revert", "RW")
        self.assertEqual(json.loads(proc.stdout)["deleted"], 1)

    def test_runs_after_capture_not_in_hook_process(self):
        """SessionEnd hook -> capture supervisor -> capture child exits -> judge spawned."""
        self.write_cfg({"enabled": True,
                        "domain": {"description": "widgets.", "keywords": ["widget"]},
                        "min_transcript_bytes": 5,
                        "capture": {"timeout_s": 60}, "supersede": {"timeout_s": 60}})
        tx = Path(self.tmp.name) / "t.jsonl"
        tx.write_text(json.dumps({"type": "user", "message": {
            "role": "user", "content": "widget ranking talk"}}) + "\n")
        t0 = time.time()
        proc = subprocess.run([sys.executable, "-m", "mindgap.capture_hook"],
                              input=json.dumps({"transcript_path": str(tx), "cwd": "/tmp/r",
                                                "session_id": "SX"}),
                              capture_output=True, text=True, env=self.env, timeout=15)
        self.assertEqual(proc.returncode, 0, proc.stderr)
        self.assertLess(time.time() - t0, 10)
        self.assertTrue(self._wait(lambda: len(self._calls()) == 2), self._calls())
        capture_argv, judge_argv = self._calls()
        self.assertNotIn("sonnet", capture_argv)
        self.assertIn("sonnet", judge_argv)
        self.assertTrue(self._wait(
            lambda: "session=SX supersede=spawned" in self._log("capture.log")),
            self._log("capture.log"))
        self.assertTrue(self._wait(lambda: "batch=0 exit=0" in self._log()), self._log())

    def test_after_capture_flag_off_skips_judge(self):
        job = {"cmd": [str(self.bin / "claude"), "-p", "x"], "timeout_s": 10,
               "session": "SO", "supersede": False}
        subprocess.run([sys.executable, "-m", "mindgap.capture_hook", "--supervise",
                        json.dumps(job)], env=self.env, timeout=30)
        time.sleep(0.5)
        self.assertEqual(len(self._calls()), 1)
        self.assertNotIn("supersede=", self._log("capture.log"))


if __name__ == "__main__":
    unittest.main()
