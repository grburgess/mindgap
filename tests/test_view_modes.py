"""3D view modes (web/modes/): wiring + the universe layout contract, run under node when present."""
import json
import re
import shutil
import subprocess
import unittest
from pathlib import Path

ROOT = Path(__file__).resolve().parents[1]
WEB = ROOT / "mindgap" / "web"

# loads modes.js + universe.js in a bare shim (no THREE → decorations skip) and exercises
# layout() and the framework's enter/exit on a fake graph
HARNESS = r"""
const fs = require('fs'), path = require('path');
global.window = global; global.document = { hidden: false };
global.requestAnimationFrame = () => 1; global.cancelAnimationFrame = () => {};
const web = process.argv[2];
eval(fs.readFileSync(path.join(web, 'modes/modes.js'), 'utf8'));
let spec = null; const reg = Modes.register;
Modes.register = (n, s) => { spec = s; reg(n, s); };
eval(fs.readFileSync(path.join(web, 'modes/universe.js'), 'utf8'));
const ctx = { getSettings: () => settings, nodeColorFor: () => '#fff', nodeVal: (n) => 1.5 + (n._deg || 0) * 1.4 };
let settings = { viewMode: 'graph' };
function data(projects) {
  const nodes = [], links = [];
  for (let p = 0; p < projects; p++) nodes.push({ id: 'p' + p, type: 'project' });
  for (let i = 0; i < 300; i++) {
    nodes.push({ id: 'm' + i, type: 'concept' });
    if (projects) links.push({ source: i >= 4 && i % 5 ? 'm' + (i - 1) : 'p' + (i % projects), target: 'm' + i });   // chains 1..5 hops deep
    else if (i % 25) links.push({ source: 'm' + (i - i % 25), target: 'm' + i });                                    // 12 star hubs
  }
  nodes.push({ id: 'lone1', type: 'concept' }, { id: 'lone2', type: 'concept' });
  links.push({ source: 'lone1', target: 'lone2' });
  return { nodes, links };
}
function hops(d, from) {                         // BFS hop distance from one id
  const adj = new Map(); d.nodes.forEach((n) => adj.set(n.id, []));
  d.links.forEach((l) => { adj.get(l.source).push(l.target); adj.get(l.target).push(l.source); });
  const dist = new Map([[from, 0]]); let q = [from];
  while (q.length) { const nx = []; for (const u of q) for (const v of adj.get(u)) if (!dist.has(v)) { dist.set(v, dist.get(u) + 1); nx.push(v); } q = nx; }
  return dist;
}
function check(d) {
  const pos = spec.layout(d, ctx), dbg = spec.debug(), by = new Map(d.nodes.map((n) => [n.id, n]));
  let within = 0, nearest = 0;
  const hs = new Map(dbg.suns.map((s) => [s, hops(d, s)]));
  for (const [m, s] of Object.entries(dbg.memberSun)) {
    const a = pos.get(m), b = pos.get(s);
    if (Math.hypot(a.x - b.x, a.y - b.y, a.z - b.z) <= dbg.orbitRadius[s]) within++;
    const best = Math.min(...dbg.suns.map((x) => hs.get(x).has(m) ? hs.get(x).get(m) : Infinity));
    if (hs.get(s).get(m) === best) nearest++;
  }
  const M = Object.keys(dbg.memberSun).length;
  return { suns: dbg.suns, source: dbg.sunSource, members: M, within: within / M, nearest: nearest / M,
    shell: dbg.outerShell.sort(), placed: pos.size, nodes: d.nodes.length };
}
const out = { projects: check(data(4)), fallback: check(data(0)), many: check(data(15)) };
{ // link alpha: intra-system faint, cross-system hidden
  const d = data(4); spec.layout(d, ctx); const ms = spec.debug().memberSun;
  const intra = d.links.find((l) => ms[l.target] && (ms[l.source] || l.source) === ms[l.target]);
  out.linkAlpha = { intra: spec.linkAlpha(intra), cross: spec.linkAlpha({ source: 'm0', target: 'm1' }),
    belt: spec.linkAlpha({ source: 'lone1', target: 'lone2' }) };
}
// framework: enter pins + stops the sim, exit restores positions exactly
const d = data(4); d.nodes.forEach((n, i) => { n.x = i; n.y = -i; n.z = 2 * i; });
let cool = Infinity, reheats = 0;
const g = { graphData: () => d, cooldownTicks: (v) => (v === undefined ? cool : (cool = v, g)),
  d3ReheatSimulation: () => { reheats++; }, zoomToFit: () => {}, scene: () => ({ add() {}, remove() {} }) };
Modes.install(g, ctx);
settings.viewMode = 'universe'; Modes.sync();
out.enter = { current: Modes.current(), cool, pinned: d.nodes.filter((n) => n.fx != null).length, drag: Modes.allowsDrag() };
settings.viewMode = 'graph'; Modes.sync();
out.exit = { current: Modes.current(), cool, pinned: d.nodes.filter((n) => n.fx != null).length, drag: Modes.allowsDrag(),
  restored: d.nodes.filter((n, i) => n.x === i && n.y === -i && n.z === 2 * i).length, reheats };
settings.viewMode = 'matrix'; Modes.sync();     // unregistered → stays graph
out.unknown = Modes.current();
console.log(JSON.stringify(out));
"""


class TestViewModeWiring(unittest.TestCase):
    def test_index_loads_framework_before_modes_and_app(self):
        html = (WEB / "index.html").read_text()
        srcs = re.findall(r'<script src="(/[^"]+)"', html)
        self.assertLess(srcs.index("/modes/modes.js"), srcs.index("/modes/universe.js"))
        self.assertLess(srcs.index("/modes/universe.js"), srcs.index("/app.js"))

    def test_modes_ship_in_package_data(self):
        self.assertIn('"web/modes/*"', (ROOT / "pyproject.toml").read_text())

    def test_default_view_mode_is_graph(self):
        self.assertIn("viewMode: 'graph'", (WEB / "app.js").read_text())


@unittest.skipUnless(shutil.which("node"), "node not installed")
class TestUniverseLayout(unittest.TestCase):
    @classmethod
    def setUpClass(cls):
        r = subprocess.run(["node", "-e", HARNESS, "x", str(WEB)], capture_output=True, text=True, timeout=60)
        if r.returncode:
            raise AssertionError(r.stderr)
        cls.out = json.loads(r.stdout)

    def test_projects_are_suns(self):
        p = self.out["projects"]
        self.assertEqual(p["source"], "project")
        self.assertEqual(sorted(p["suns"]), ["p0", "p1", "p2", "p3"])

    def test_fallback_top_degree_suns(self):
        f = self.out["fallback"]
        self.assertEqual(f["source"], "degree")
        self.assertEqual(len(f["suns"]), 12)

    def test_members_inside_orbit_and_nearest_sun(self):
        for k in ("projects", "fallback", "many"):
            o = self.out[k]
            self.assertGreaterEqual(o["within"], 0.9, k)
            self.assertEqual(o["nearest"], 1.0, k)
            self.assertEqual(o["placed"], o["nodes"], k)

    def test_many_projects_capped_to_biggest_systems(self):
        m = self.out["many"]
        self.assertEqual(len(m["suns"]), 12)
        self.assertGreaterEqual(m["within"], 0.9)
        self.assertEqual(m["nearest"], 1.0)
        self.assertEqual(m["placed"], m["nodes"])

    def test_cross_system_links_hidden_intra_faint(self):
        a = self.out["linkAlpha"]
        self.assertGreater(a["intra"], 0)
        self.assertLess(a["intra"], 0.5)
        self.assertEqual((a["cross"], a["belt"]), (0, 0))

    def test_unreachable_nodes_on_outer_shell(self):
        self.assertEqual(self.out["projects"]["shell"], ["lone1", "lone2"])

    def test_enter_pins_and_stops_sim_exit_restores(self):
        e, x = self.out["enter"], self.out["exit"]
        self.assertEqual((e["current"], e["cool"], e["drag"]), ("universe", 0, False))
        self.assertEqual(e["pinned"], 306)
        self.assertEqual((x["current"], x["pinned"], x["drag"], x["restored"], x["reheats"]), ("graph", 0, True, 306, 0))
        self.assertIsNone(x["cool"])          # Infinity serialises to null: original cooldown restored
        self.assertEqual(self.out["unknown"], "graph")


if __name__ == "__main__":
    unittest.main()
