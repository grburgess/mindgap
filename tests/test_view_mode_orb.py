"""3D view mode 'orb' (web/modes/orb.js): sphere-shell layout contract, run under node when present."""
import json
import re
import shutil
import subprocess
import unittest
from pathlib import Path

ROOT = Path(__file__).resolve().parents[1]
WEB = ROOT / "mindgap" / "web"

# loads modes.js + orb.js in a bare shim (no THREE → decorations skip) and exercises layout(),
# debug() and the framework's enter/exit on a fake graph
HARNESS = r"""
const fs = require('fs'), path = require('path');
global.window = global; global.document = { hidden: false };
global.requestAnimationFrame = () => 1; global.cancelAnimationFrame = () => {};
const web = process.argv[2];
eval(fs.readFileSync(path.join(web, 'modes/modes.js'), 'utf8'));
let spec = null; const reg = Modes.register;
Modes.register = (n, s) => { spec = s; reg(n, s); };
eval(fs.readFileSync(path.join(web, 'modes/orb.js'), 'utf8'));
let settings = { viewMode: 'graph', colorBy: 'type' };
const ctx = { getSettings: () => settings, nodeColorFor: () => '#fff', nodeVal: () => 1 };
const TYPES = ['concept', 'paper', 'page', 'repo', 'software', 'definition'];
function data() {
  const nodes = [], links = [];
  for (let i = 0; i < 600; i++) nodes.push({ id: 'n' + i, type: TYPES[i % 7 < 3 ? 0 : i % 7 - 2] });
  for (let i = 1; i < 600; i++) links.push({ source: 'n' + (i % 50), target: 'n' + i });
  return { nodes, links };
}
const d = data(), pos = spec.layout(d, ctx), dbg = spec.debug();
// patch compactness: mean angular distance of a type's shell nodes to their type centroid
const by = new Map(d.nodes.map((n) => [n.id, n])), riders = new Set(dbg.ringRiders.map((r) => r.id));
const cen = new Map();
for (const [id, p] of pos) { if (riders.has(id)) continue; const t = by.get(id).type, c = cen.get(t) || [0, 0, 0];
  const r = Math.hypot(p.x, p.y, p.z); c[0] += p.x / r; c[1] += p.y / r; c[2] += p.z / r; cen.set(t, c); }
let ang = 0, cnt = 0;
for (const [id, p] of pos) { if (riders.has(id)) continue; const c = cen.get(by.get(id).type), cl = Math.hypot(...c), r = Math.hypot(p.x, p.y, p.z);
  ang += Math.acos(Math.max(-1, Math.min(1, (p.x * c[0] + p.y * c[1] + p.z * c[2]) / (r * cl)))); cnt++; }
const out = { placed: pos.size, nodes: d.nodes.length, riders: dbg.ringRiders, groupBy: dbg.groupBy,
  shell: dbg.shellRadius, meanAng: ang / cnt,
  riderR: dbg.ringRiders.map((r) => dbg.radius[r.id]) };
d.nodes.forEach((n, i) => { n.x = i; n.y = -i; n.z = 2 * i; });
let cool = Infinity, reheats = 0;
const cam = { fov: 50, position: { x: 0, y: 0, z: 1000 } }, camCalls = [];
const g = { graphData: () => d, cooldownTicks: (v) => (v === undefined ? cool : (cool = v, g)),
  d3ReheatSimulation: () => { reheats++; }, zoomToFit: () => {}, scene: () => ({ add() {}, remove() {} }),
  camera: () => cam, renderer: () => ({ domElement: { clientWidth: 1400, clientHeight: 900, width: 2100, height: 1350 } }),
  cameraPosition: (p, look, ms) => { camCalls.push({ p, look, ms }); Object.assign(cam.position, p); } };
Modes.install(g, ctx);
settings.viewMode = 'orb'; Modes.sync();
out.enter = { current: Modes.current(), cool, pinned: d.nodes.filter((n) => n.fx != null).length, drag: Modes.allowsDrag(),
  cv: Modes.debug().radiusCV, radii: Object.keys(Modes.debug().radius).length };
// framing: entry places the camera so the shell's on-screen radius ≥ 40% of the viewport height;
// a data swap (dataChanged re-enter) must not move it
const R0 = Modes.debug().shellRadius, c0 = camCalls[0];
out.frame = { calls: camCalls.length, ms: c0.ms, look: c0.look, onAxis: c0.p.x === 0 && c0.p.y === 0,
  rFrac: (R0 / Math.hypot(c0.p.x, c0.p.y, c0.p.z)) / (2 * Math.tan(25 * Math.PI / 180)) };
Modes.dataChanged();
out.frame.afterData = camCalls.length;
// picking: pure screen-space pick against the visible dot sizes (not the hidden hub-sized spheres)
const P = spec._pickIx, px = 1000, f = [0, 0, -1], o = [0, 0, 500];
const nodes = [{ x: 0, y: 0, z: 0 }, { x: 14, y: 0, z: 0 }, { x: 0, y: 0, z: -300 }, { x: 40, y: 0, z: 0 }];
const sizes = [16, 7, 7, 7];                     // hub dot 16 (its hidden sphere would be ~40), small dots 7
const aim = (x, y) => { const v = [x - o[0], y - o[1], -o[2]], l = Math.hypot(...v); return v.map((c) => c / l); };
out.pick = { small: P(nodes, sizes, o, aim(14, 0), f, px, 300, 4), hub: P(nodes, sizes, o, aim(0, 0), f, px, 300, 4),
  hubSphereOnly: P(nodes, sizes, o, aim(25, 0), f, px, 300, 4), far: P(nodes, sizes, o, aim(40, 0), f, px, 300, 4),
  miss: P(nodes, sizes, o, aim(0, 60), f, px, 300, 4) };
out.frameDist = spec._frameDist(100, 50, 16 / 9, 0.42);
settings.viewMode = 'graph'; Modes.sync();
out.exit = { current: Modes.current(), cool, pinned: d.nodes.filter((n) => n.fx != null).length, drag: Modes.allowsDrag(),
  restored: d.nodes.filter((n, i) => n.x === i && n.y === -i && n.z === 2 * i).length, reheats };
console.log(JSON.stringify(out));
"""


class TestOrbWiring(unittest.TestCase):
    def test_index_loads_orb_after_framework_before_app(self):
        srcs = re.findall(r'<script src="(/[^"]+)"', (WEB / "index.html").read_text())
        self.assertLess(srcs.index("/modes/modes.js"), srcs.index("/modes/orb.js"))
        self.assertLess(srcs.index("/modes/orb.js"), srcs.index("/app.js"))


class TestOrbLook(unittest.TestCase):
    """particle look: nodes are soft additive dots in ONE Points; opaque spheres hidden, not removed (picking)"""
    src = (WEB / "modes" / "orb.js").read_text()

    def test_one_additive_shader_points(self):
        self.assertEqual(self.src.count("new THREE.Points("), 1)
        self.assertIn("new THREE.ShaderMaterial(", self.src)
        self.assertIn("AdditiveBlending", self.src)
        self.assertNotIn("new THREE.Mesh(", self.src)          # no opaque/bloom meshes of its own

    def test_spheres_hidden_by_material_so_raycast_still_hits(self):
        self.assertIn("h.inst, ...(h.hubMeshes", self.src)
        self.assertIn("o.material.visible = false", self.src)
        self.assertIn("spheresHidden", self.src)

    def test_pick_swaps_inst_raycast_and_restores(self):
        self.assertIn("inst.raycast = pickRaycast", self.src)
        self.assertIn("delete pickInst.raycast", self.src)   # exit → prototype raycast again
        self.assertIn("unpatchPick(); }", self.src)          # showEdges (exit) restores


@unittest.skipUnless(shutil.which("node"), "node not installed")
class TestOrbLayout(unittest.TestCase):
    @classmethod
    def setUpClass(cls):
        r = subprocess.run(["node", "-e", HARNESS, "x", str(WEB)], capture_output=True, text=True, timeout=60)
        if r.returncode:
            raise AssertionError(r.stderr)
        cls.out = json.loads(r.stdout)

    def test_every_node_placed_and_reported(self):
        self.assertEqual(self.out["placed"], self.out["nodes"])
        self.assertEqual(self.out["enter"]["radii"], self.out["nodes"])   # live positions once pinned

    def test_shell_radius_cv_signature(self):
        self.assertLessEqual(self.out["enter"]["cv"], 0.1)

    def test_ring_riders_are_top_group_hubs_off_shell(self):
        riders = self.out["riders"]
        self.assertEqual([r["group"] for r in riders], ["concept", "page", "paper"])
        self.assertEqual(riders[0]["id"], "n0")              # highest-degree concept
        for r, rad in zip(riders, self.out["riderR"]):
            self.assertAlmostEqual(rad, r["ringRadius"], places=6)
            self.assertGreater(rad, self.out["shell"] * 1.2)

    def test_types_form_patches(self):
        # random placement averages ~pi/2 to the centroid; one compact patch per type is far tighter
        self.assertLess(self.out["meanAng"], 0.8)

    def test_entry_frames_shell_large_and_data_swap_keeps_camera(self):
        f = self.out["frame"]
        self.assertEqual((f["calls"], f["ms"], f["onAxis"], f["look"]), (1, 0, True, {"x": 0, "y": 0, "z": 0}))
        self.assertGreaterEqual(f["rFrac"], 0.4)
        self.assertEqual(f["afterData"], 1)

    def test_pick_hits_visible_dot_not_neighbouring_hub(self):
        p = self.out["pick"]
        self.assertEqual(p["small"], 1)          # small dot beside the hub → the small dot
        self.assertEqual(p["hub"], 0)            # front hub, not the dot behind it on the same ray
        self.assertEqual(p["hubSphereOnly"], -1)  # inside the hidden sphere radius but off every dot → nothing
        self.assertEqual(p["far"], 3)
        self.assertEqual(p["miss"], -1)

    def test_frame_dist_formula(self):
        # r_px/h = (r/D) / (2 tan(fov/2)) = 0.42
        self.assertAlmostEqual(100 / self.out["frameDist"] / (2 * 0.46630765815), 0.42, places=6)

    def test_enter_pins_and_stops_sim_exit_restores(self):
        e, x = self.out["enter"], self.out["exit"]
        self.assertEqual((e["current"], e["cool"], e["drag"], e["pinned"]), ("orb", 0, False, 600))
        self.assertEqual((x["current"], x["pinned"], x["drag"], x["restored"], x["reheats"]), ("graph", 0, True, 600, 0))
        self.assertIsNone(x["cool"])


if __name__ == "__main__":
    unittest.main()
