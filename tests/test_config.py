import importlib, os, unittest
from pathlib import Path
import tempfile


class TestConfigPaths(unittest.TestCase):
    def setUp(self):
        self.tmp = tempfile.mkdtemp()
        self._env = {k: os.environ.get(k) for k in ("MINDGAP_HOME", "MINDGAP_DB")}
        os.environ.pop("MINDGAP_DB", None)
        os.environ["MINDGAP_HOME"] = self.tmp
        import mindgap.config as config
        self.config = importlib.reload(config)

    def tearDown(self):
        for k, v in self._env.items():
            if v is None:
                os.environ.pop(k, None)
            else:
                os.environ[k] = v

    def test_assets_resolve_inside_package(self):
        c = self.config
        self.assertEqual(c.web_dir(), c.PKG_DIR / "web")
        self.assertEqual(c.seed_path(), c.PKG_DIR / "seed.json")
        self.assertEqual(c.loops_dir(), c.PKG_DIR / "loops")
        self.assertTrue(c.PKG_DIR.name == "mindgap")

    def test_user_data_honors_mindgap_home(self):
        c = self.config
        self.assertEqual(c.data_dir(), Path(self.tmp))
        self.assertEqual(c.db_path(), Path(self.tmp) / "mindgap.db")
        self.assertEqual(c.snapshots_dir(), Path(self.tmp) / "snapshots")
        self.assertTrue(c.snapshots_dir().is_dir())

    def test_mindgap_db_overrides_db_only(self):
        c = self.config
        dbf = Path(self.tmp) / "custom" / "x.db"
        os.environ["MINDGAP_DB"] = str(dbf)
        self.assertEqual(c.db_path(), dbf)
        self.assertTrue(dbf.parent.is_dir())
        self.assertEqual(c.snapshots_dir(), Path(self.tmp) / "snapshots")


class TestInit(unittest.TestCase):
    def setUp(self):
        self.home = tempfile.mkdtemp()
        self._env = {k: os.environ.get(k) for k in ("MINDGAP_HOME", "MINDGAP_DB")}
        os.environ.pop("MINDGAP_DB", None)
        os.environ["MINDGAP_HOME"] = self.home

    def tearDown(self):
        for k, v in self._env.items():
            if v is None:
                os.environ.pop(k, None)
            else:
                os.environ[k] = v

    def test_init_seeds_empty_db_then_is_noop(self):
        from mindgap import cli, db, config
        import importlib; importlib.reload(config); importlib.reload(db); importlib.reload(cli)
        n1 = cli.init_db(force=False)
        self.assertGreater(n1, 0)
        conn = db.connect()
        got = conn.execute("SELECT COUNT(*) FROM nodes").fetchone()[0]
        self.assertEqual(got, n1)
        self.assertEqual(cli.init_db(force=False), 0)


class TestLoop(unittest.TestCase):
    def setUp(self):
        self.proj = tempfile.mkdtemp()
        self._cwd = os.getcwd(); os.chdir(self.proj)

    def tearDown(self):
        os.chdir(self._cwd)

    def test_new_scaffolds_with_substitution_then_export_strips_state(self):
        from mindgap import cli, config
        import importlib; importlib.reload(config); importlib.reload(cli)
        cli.loop_new("arxiv-weekly", name="my-watch", topics="quantum error correction")
        goal = Path(self.proj) / "self-learning-loop" / "my-watch" / "GOAL.md"
        self.assertTrue(goal.exists())
        self.assertIn("quantum error correction", goal.read_text())
        self.assertNotIn("{{TOPICS}}", goal.read_text())
        self.assertTrue((goal.parent / "STATE.md").exists())
        (goal.parent / "STATE.md").write_text("# private progress\n")
        (goal.parent / "artifacts").mkdir()
        out = cli.loop_export("my-watch")
        self.assertTrue((Path(out) / "GOAL.md").exists())
        self.assertFalse((Path(out) / "STATE.md").exists())
        self.assertFalse((Path(out) / "artifacts").exists())


if __name__ == "__main__":
    unittest.main()
