"""Neon integration: motion.js toggles composed with the 3D view modes (web/modes/), run under node.

aliveDrift must stay exact (no residual offset) across view-mode enter/exit and graph-data swaps,
and be disabled while a fixed-layout mode pins every node."""
import json
import re
import shutil
import subprocess
import unittest
from pathlib import Path

ROOT = Path(__file__).resolve().parents[1]
WEB = ROOT / "mindgap" / "web"

# motion.js + modes.js in a bare shim; two fake modes: 'fixed' (pins, no drag, like universe/brain)
# and 'live' (pins nothing, drag on, like genesis). rAF is driven by hand with a fake clock.
HARNESS = r"""
const fs = require('fs'), path = require('path');
global.window = global; global.document = { hidden: false };
const bus = new EventTarget();
global.addEventListener = bus.addEventListener.bind(bus); global.dispatchEvent = bus.dispatchEvent.bind(bus);
let rafCb = null, now = 1000;
global.requestAnimationFrame = (f) => { rafCb = f; return 1; };
global.cancelAnimationFrame = () => { rafCb = null; };
Object.defineProperty(globalThis, 'performance', { value: { now: () => now }, configurable: true, writable: true });
global.THREE = {};
global.setTimeout = () => 0;
const web = process.argv[2];
eval(fs.readFileSync(path.join(web, 'motion.js'), 'utf8'));
eval(fs.readFileSync(path.join(web, 'modes/modes.js'), 'utf8'));
Modes.register('fixed', { allowsDrag: false, enter() {}, exit() {},
  layout: (d) => new Map(d.nodes.map((n, i) => [n.id, { x: 1000 + i, y: 2000 + i, z: 3000 + i }])) });
Modes.register('live', { allowsDrag: true, enter() {}, exit() {}, layout: () => new Map() });
const settings = { viewMode: 'graph', aliveDrift: false, linkDist: 55 };
const all = [];
for (let i = 0; i < 50; i++) all.push({ id: 'n' + i, x: i, y: -i, z: 2 * i });
const base = all.map((n) => [n.x, n.y, n.z]);
let data = { nodes: all, links: [] };
let cool = Infinity;
const g = { graphData: (d) => (d === undefined ? data : (data = d, g)), cooldownTicks: (v) => (v === undefined ? cool : (cool = v, g)),
  d3ReheatSimulation() {}, zoomToFit() {}, scene: () => ({ add() {}, remove() {} }),
  camera: () => ({ position: { x: 0, y: 0, z: 0 } }), renderer: () => ({ domElement: { addEventListener() {}, removeEventListener() {} } }) };
const ctx = { nodes: () => g.graphData().nodes, links: () => g.graphData().links, nodeVal: () => 1, nodeColorFor: () => '#fff',
  getSettings: () => settings };
function frames(k) { for (let i = 0; i < k; i++) { now += 50; if (rafCb) rafCb(); } }
function err() {                                 // max |pos - base| over all nodes
  let m = 0; all.forEach((n, i) => { m = Math.max(m, Math.abs(n.x - base[i][0]), Math.abs(n.y - base[i][1]), Math.abs(n.z - base[i][2])); });
  return m;
}
function onLayout() { return all.every((n, i) => n.x === 1000 + i && n.y === 2000 + i && n.z === 3000 + i); }
function mode(m) { settings.viewMode = m; Modes.sync(); }
function drift(on) { settings.aliveDrift = on; Motion.refresh(); }
Motion.install(g, ctx); Modes.install(g, { getSettings: () => settings, nodeColorFor: () => '#fff', nodeVal: () => 1 });
const out = {};
drift(true); frames(20);
out.graphMoving = err() > 0.5;
mode('fixed'); frames(20);
out.fixedOnLayout = onLayout(); out.fixedDriftActive = Motion.debug().aliveDrift.active;
out.fixedVeto = Motion.driftState();
drift(false); drift(true); frames(5);
out.fixedToggleOnLayout = onLayout();
mode('graph'); out.graphVeto = Motion.driftState(); drift(false);
out.afterFixedErr = err();
drift(true); mode('live'); frames(20);
out.liveDriftActive = Motion.debug().aliveDrift.active; out.liveVeto = Motion.driftState();
for (let k = 0; k < 6; k++) {                    // genesis-style growth: prefix swaps of the SAME node objects
  data = { nodes: all.slice(0, 20 + 5 * k), links: [] }; frames(7);
}
data = { nodes: all, links: [] }; frames(7);
mode('graph'); drift(false);
out.afterLiveErr = err();
drift(true); frames(10);
for (let k = 0; k < 5; k++) {                    // app.applyData-style swaps: fresh clones carrying positions by id
  const prev = new Map(data.nodes.map((n) => [n.id, n]));
  data = { nodes: all.map((n) => { const p = prev.get(n.id); return { id: n.id, x: p.x, y: p.y, z: p.z }; }), links: [] }; frames(7);
}
drift(false);
const cur = new Map(data.nodes.map((n) => [n.id, n]));
out.afterCloneErr = Math.max(...all.map((n, i) => { const c = cur.get(n.id); return Math.max(Math.abs(c.x - base[i][0]), Math.abs(c.y - base[i][1]), Math.abs(c.z - base[i][2])); }));
console.log(JSON.stringify(out));
"""


class TestNeonLookWiring(unittest.TestCase):
    def test_all_six_view_modes_load(self):
        srcs = re.findall(r'<script src="(/[^"]+)"', (WEB / "index.html").read_text())
        for m in ("universe", "matrix", "orb", "brain", "genesis"):
            self.assertIn(f"/modes/{m}.js", srcs)
            self.assertLess(srcs.index("/modes/modes.js"), srcs.index(f"/modes/{m}.js"))
        self.assertLess(srcs.index("/motion.js"), srcs.index("/app.js"))

    def test_look_section_has_motion_glow_and_view_picker(self):
        app = (WEB / "app.js").read_text()
        for k in ("linkPulses", "aliveDrift", "orbitRings", "autoTour", "viewMode: 'graph'", "glow: 0.5"):
            self.assertIn(k, app)
        self.assertIn("MOTION_TOGGLES.map(", app)
        self.assertIn("Modes.pickerHtml(s.viewMode)", app)


@unittest.skipUnless(shutil.which("node"), "node not installed")
class TestDriftAcrossModes(unittest.TestCase):
    @classmethod
    def setUpClass(cls):
        r = subprocess.run(["node", "-e", HARNESS, "x", str(WEB)], capture_output=True, text=True, timeout=60)
        if r.returncode:
            raise AssertionError(r.stderr)
        cls.out = json.loads(r.stdout)

    def test_drift_moves_nodes_in_graph(self):
        self.assertTrue(self.out["graphMoving"])

    def test_fixed_mode_disables_drift_and_keeps_layout_exact(self):
        self.assertTrue(self.out["fixedOnLayout"])
        self.assertFalse(self.out["fixedDriftActive"])
        self.assertTrue(self.out["fixedToggleOnLayout"])

    def test_modes_veto_drift_via_set_drift_allowed(self):
        self.assertEqual(self.out["fixedVeto"], {"allowed": False, "reason": "paused in fixed layouts"})
        self.assertEqual(self.out["graphVeto"], {"allowed": True, "reason": ""})
        self.assertEqual(self.out["liveVeto"], {"allowed": True, "reason": ""})

    def test_no_residual_offset_after_fixed_mode(self):
        self.assertLess(self.out["afterFixedErr"], 1e-4)   # dPrev is Float32 (pre-existing): ~1e-6 rounding, not drift

    def test_drift_runs_in_live_mode_and_survives_growth_swaps(self):
        self.assertTrue(self.out["liveDriftActive"])
        self.assertLess(self.out["afterLiveErr"], 1e-4)   # dPrev is Float32 (pre-existing): ~1e-6 rounding, not drift

    def test_drift_exact_across_clone_swaps(self):
        self.assertLess(self.out["afterCloneErr"], 1e-4)   # dPrev is Float32 (pre-existing): ~1e-6 rounding, not drift


if __name__ == "__main__":
    unittest.main()
