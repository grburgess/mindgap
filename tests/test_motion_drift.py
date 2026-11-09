"""Motion.setDriftAllowed: external veto on alive drift (fixed-layout view modes).

Runs web/motion.js under node in a vm sandbox with a stub graph; skipped when
node is not installed.
"""
import json
import shutil
import subprocess
import unittest
from pathlib import Path

ROOT = Path(__file__).resolve().parents[1]
MOTION_JS = ROOT / "mindgap/web/motion.js"

HARNESS = r"""
const vm = require('vm'), fs = require('fs');
let clock = 1000, rafCb = null;
const bus = new EventTarget(), events = [];
const sb = {
  THREE: {}, console, Math, Map, Number, String, Array, Float32Array, Int32Array, Int8Array,
  CustomEvent, document: { hidden: false },
  performance: { now: () => clock },
  requestAnimationFrame: (cb) => { rafCb = cb; return 1; }, cancelAnimationFrame: () => { rafCb = null; },
  addEventListener: bus.addEventListener.bind(bus), dispatchEvent: bus.dispatchEvent.bind(bus),
};
sb.window = sb;
vm.createContext(sb);
vm.runInContext(fs.readFileSync(process.argv[process.argv.length - 1], 'utf8'), sb);
const M = sb.Motion;
sb.addEventListener('motion:drift', (e) => events.push(e.detail));
const nodes = [], links = [];
for (let i = 0; i < 10; i++) nodes.push({ id: 'n' + i, x: i * 10, y: -i, z: i });
for (let i = 1; i < 10; i++) links.push({ source: nodes[0], target: nodes[i] });
const settings = { aliveDrift: true, linkDist: 55 };
const graph = { camera: () => ({ position: { x: 0, y: 0, z: 0 } }), scene: () => ({}) };
const snap = () => nodes.map((n) => [n.x, n.y, n.z]);
const tick = (n) => { for (let i = 0; i < n; i++) { clock += 30; const cb = rafCb; if (cb) cb(); } };
const out = { api: typeof M.setDriftAllowed === 'function' && typeof M.driftState === 'function' };
out.before = M.driftState();
M.install(graph, { nodes: () => nodes, links: () => links, nodeVal: () => 1, nodeColorFor: () => '#fff',
  getSettings: () => settings });
const p0 = snap();
tick(20);
out.drifted = JSON.stringify(snap()) !== JSON.stringify(p0);
out.activeOn = M.debug().aliveDrift.active;
M.setDriftAllowed(false, 'paused in fixed layouts');
out.vetoed = M.debug().aliveDrift;
out.restored = snap().every((p, i) => p.every((v, k) => Math.abs(v - p0[i][k]) < 1e-4));
out.running = M.debug().running;
out.pref = settings.aliveDrift;
M.setDriftAllowed(false, 'paused in fixed layouts');   // same state: no new event
out.eventsAfterRepeat = events.length;
M.teardown();                                          // veto survives a remount
M.install(graph, { nodes: () => nodes, links: () => links, nodeVal: () => 1, nodeColorFor: () => '#fff',
  getSettings: () => settings });
out.afterRemount = M.debug().aliveDrift;
M.setDriftAllowed(true);
out.resumed = M.debug().aliveDrift;
out.runningResumed = M.debug().running;
out.events = events;
console.log(JSON.stringify(out));
"""


@unittest.skipUnless(shutil.which("node"), "node not installed")
class SetDriftAllowedTest(unittest.TestCase):
    @classmethod
    def setUpClass(cls):
        r = subprocess.run(["node", "-e", HARNESS, "--", str(MOTION_JS)],
                           capture_output=True, text=True, timeout=30)
        if r.returncode:
            raise AssertionError(r.stderr)
        cls.out = json.loads(r.stdout.strip().splitlines()[-1])

    def test_api_exposed_and_allowed_by_default(self):
        self.assertTrue(self.out["api"])
        self.assertEqual(self.out["before"], {"allowed": True, "reason": ""})
        self.assertTrue(self.out["activeOn"])
        self.assertTrue(self.out["drifted"])

    def test_veto_removes_drift_but_keeps_preference(self):
        v = self.out["vetoed"]
        self.assertFalse(v["allowed"])
        self.assertEqual(v["reason"], "paused in fixed layouts")
        self.assertFalse(v["active"])
        self.assertTrue(v["on"])                 # saved preference untouched
        self.assertTrue(self.out["pref"])
        self.assertTrue(self.out["restored"])    # offsets subtracted (float32 offset store)
        self.assertFalse(self.out["running"])    # drift was the only effect -> loop stopped

    def test_veto_survives_remount_and_resumes(self):
        self.assertFalse(self.out["afterRemount"]["allowed"])
        self.assertFalse(self.out["afterRemount"]["active"])
        r = self.out["resumed"]
        self.assertTrue(r["allowed"])
        self.assertEqual(r["reason"], "")
        self.assertTrue(r["active"])
        self.assertTrue(self.out["runningResumed"])

    def test_change_events(self):
        self.assertEqual(self.out["eventsAfterRepeat"], 1)
        self.assertEqual(self.out["events"], [
            {"allowed": False, "reason": "paused in fixed layouts"},
            {"allowed": True, "reason": ""},
        ])


if __name__ == "__main__":
    unittest.main()
