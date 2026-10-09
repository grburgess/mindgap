import tempfile
import time
import unittest
from pathlib import Path

from mindgap import capture


def cfg(**over):
    base = {"enabled": True, "domain": {"keywords": ["roof", "parcel"]},
            "denylist_dirs": [], "allowlist_dirs": [], "min_transcript_bytes": 10}
    base.update(over)
    return base


class GateTest(unittest.TestCase):
    def setUp(self):
        self.tmp = tempfile.TemporaryDirectory()
        self.tx = Path(self.tmp.name) / "transcript.jsonl"
        self.tx.write_text("user: how does the roof segmentation model work?\n" * 5)

    def tearDown(self):
        self.tmp.cleanup()

    def test_keyword_hits(self):
        self.assertTrue(capture.keyword_hits("a ROOF here", ["roof"]))
        self.assertFalse(capture.keyword_hits("nothing", ["roof"]))

    def test_pass_when_on_domain(self):
        ok, why = capture.pregate(str(self.tx), self.tmp.name, cfg(), env={})
        self.assertTrue(ok, why)

    def test_disabled(self):
        ok, why = capture.pregate(str(self.tx), self.tmp.name, cfg(enabled=False), env={})
        self.assertFalse(ok); self.assertEqual(why, "disabled")

    def test_self_capture_env(self):
        ok, why = capture.pregate(str(self.tx), self.tmp.name, cfg(),
                                  env={"MINDGAP_CAPTURE": "1"})
        self.assertFalse(ok); self.assertEqual(why, "self-capture-session")

    def test_denylist(self):
        ok, why = capture.pregate(str(self.tx), self.tmp.name,
                                  cfg(denylist_dirs=[self.tmp.name]), env={})
        self.assertFalse(ok); self.assertEqual(why, "denylisted-dir")

    def test_allowlist_excludes(self):
        ok, why = capture.pregate(str(self.tx), self.tmp.name,
                                  cfg(allowlist_dirs=["/somewhere/else"]), env={})
        self.assertFalse(ok); self.assertEqual(why, "not-in-allowlist")

    def test_missing_transcript(self):
        ok, why = capture.pregate(str(self.tx) + ".nope", self.tmp.name, cfg(), env={})
        self.assertFalse(ok); self.assertEqual(why, "no-transcript")

    def test_too_small(self):
        ok, why = capture.pregate(str(self.tx), self.tmp.name,
                                  cfg(min_transcript_bytes=10_000_000), env={})
        self.assertFalse(ok); self.assertEqual(why, "transcript-too-small")

    def test_no_keywords(self):
        ok, why = capture.pregate(str(self.tx), self.tmp.name,
                                  cfg(domain={"keywords": ["zzz"]}), env={})
        self.assertFalse(ok); self.assertEqual(why, "no-domain-keywords")

    def test_lock_acquire_release_and_staleness(self):
        lp = Path(self.tmp.name) / "capture.lock"
        self.assertTrue(capture.acquire_lock(lp, ttl_s=300))   # fresh acquire
        self.assertFalse(capture.acquire_lock(lp, ttl_s=300))  # held
        capture.release_lock(lp)
        self.assertTrue(capture.acquire_lock(lp, ttl_s=300))   # released
        # make it stale:
        import os
        old = time.time() - 999
        os.utime(lp, (old, old))
        self.assertTrue(capture.acquire_lock(lp, ttl_s=300))   # stale -> reclaim


if __name__ == "__main__":
    unittest.main()
