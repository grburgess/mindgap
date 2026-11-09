"""3D view mode "matrix" (web/modes/matrix.js): wiring + the strata layout contract, run under node when present."""
import json
import re
import shutil
import subprocess
import unittest
from pathlib import Path

ROOT = Path(__file__).resolve().parents[1]
WEB = ROOT / "mindgap" / "web"

# loads modes.js + matrix.js in a bare shim (no THREE → decorations skip), exercises layout() and the
# framework's enter/exit on a fake graph
HARNESS = r"""
const fs = require('fs'), path = require('path');
global.window = global; global.document = { hidden: false };
global.requestAnimationFrame = () => 1; global.cancelAnimationFrame = () => {};
const web = process.argv[2];
eval(fs.readFileSync(path.join(web, 'modes/modes.js'), 'utf8'));
let spec = null; const reg = Modes.register;
Modes.register = (n, s) => { spec = s; reg(n, s); };
eval(fs.readFileSync(path.join(web, 'modes/matrix.js'), 'utf8'));
let settings = { viewMode: 'graph' };
const ctx = { getSettings: () => settings, nodeColorFor: () => '#fff', nodeVal: () => 2 };
function data() {                                 // 10 star hubs with 1..5-hop chains + 2 unreachable
  const nodes = [], links = [];
  for (let i = 0; i < 300; i++) {
    nodes.push({ id: 'm' + i, type: 'concept' });
    if (i % 30) links.push({ source: 'm' + (i % 30 < 6 ? i - i % 30 : i - 1), target: 'm' + i });
  }
  nodes.push({ id: 'lone1', type: 'concept' }, { id: 'lone2', type: 'concept' });
  links.push({ source: 'lone1', target: 'lone2' });
  return { nodes, links };
}
function hops(d, from) {
  const adj = new Map(); d.nodes.forEach((n) => adj.set(n.id, []));
  d.links.forEach((l) => { adj.get(l.source).push(l.target); adj.get(l.target).push(l.source); });
  const dist = new Map([[from, 0]]); let q = [from];
  while (q.length) { const nx = []; for (const u of q) for (const v of adj.get(u)) if (!dist.has(v)) { dist.set(v, dist.get(u) + 1); nx.push(v); } q = nx; }
  return dist;
}
const d = data(), pos = spec.layout(d, ctx), dbg = spec.debug();
const hs = dbg.hubs.map((h) => hops(d, h));
let stratumOk = 0, ownerOk = 0, yMatch = 0, ordered = true;
for (const n of d.nodes) {
  const best = Math.min(...hs.map((m) => (m.has(n.id) ? m.get(n.id) : Infinity)));
  const want = Number.isFinite(best) ? best : dbg.strata - 1;
  if (dbg.stratum[n.id] === want) stratumOk++;
  if (!dbg.hubOf[n.id] || hs[dbg.hubs.indexOf(dbg.hubOf[n.id])].get(n.id) === best) ownerOk++;
  if (pos.get(n.id).y === dbg.y[n.id]) yMatch++;
}
for (let k = 0; k + 1 < dbg.strata; k++) {        // signature: min y of stratum k > max y of stratum k+1
  const ys = (s) => d.nodes.filter((n) => dbg.stratum[n.id] === s).map((n) => dbg.y[n.id]);
  const a = ys(k), b = ys(k + 1);
  if (a.length && b.length && !(Math.min(...a) > Math.max(...b))) ordered = false;
}
const out = { hubs: dbg.hubs.length, strata: dbg.strata, unreachable: dbg.unreachable.sort(), placed: pos.size, nodes: d.nodes.length,
  stratumOk, ownerOk, yMatch, ordered, rain: dbg.rain, lonesBottom: dbg.stratum.lone1 === dbg.strata - 1 };
// distinct positions: no two nodes on the same spot
out.distinct = new Set([...pos.values()].map((p) => p.x + ',' + p.y + ',' + p.z)).size;
// parent links: each reachable non-hub node → a neighbour one stratum up under the same hub
const nb = new Set(d.links.map((l) => l.source + '|' + l.target));
out.parentOk = 0; out.parentWant = 0; out.parentStray = 0;
for (const n of d.nodes) {
  const p = dbg.parentOf[n.id], s = dbg.stratum[n.id];
  if (dbg.hubOf[n.id] && s > 0) {
    out.parentWant++;
    if (p && dbg.stratum[p] === s - 1 && dbg.hubOf[p] === dbg.hubOf[n.id] && (nb.has(p + '|' + n.id) || nb.has(n.id + '|' + p))) out.parentOk++;
  } else if (p) out.parentStray++;
}
// basement: 120 isolated nodes form a tidy floor inside the hub blocks' footprint (no tail)
const d2 = data(); for (let i = 0; i < 120; i++) d2.nodes.push({ id: 'iso' + i, type: 'concept' });
const pos2 = spec.layout(d2, ctx), dbg2 = spec.debug(), fp = dbg2.footprint;
const base = dbg2.unreachable.map((id) => pos2.get(id)), xs = base.map((p) => p.x), zs = base.map((p) => p.z);
out.basement = { n: base.length, ys: new Set(base.map((p) => p.y)).size, bottom: base[0].y === dbg2.strataY[dbg2.strata - 1],
  inX: Math.max(...xs.map(Math.abs)) <= fp.w / 2 + 16, inZ: Math.max(...zs.map(Math.abs)) <= fp.d / 2 + 16,
  rows: new Set(zs.map((z) => Math.round(z))).size, distinct: new Set(base.map((p) => p.x + ',' + p.z)).size,
  aboveOk: Math.max(...base.map((p) => p.y)) < Math.min(...d2.nodes.filter((n) => dbg2.stratum[n.id] === dbg2.strata - 2).map((n) => pos2.get(n.id).y)) };
const empty = spec.layout({ nodes: [], links: [] }, ctx);
out.empty = empty.size;
// framework: enter pins + stops the sim, exit restores positions exactly
d.nodes.forEach((n, i) => { n.x = i; n.y = -i; n.z = 2 * i; });
let cool = Infinity, reheats = 0;
const g = { graphData: () => d, cooldownTicks: (v) => (v === undefined ? cool : (cool = v, g)),
  d3ReheatSimulation: () => { reheats++; }, zoomToFit: () => {}, scene: () => ({ add() {}, remove() {} }) };
Modes.install(g, ctx);
settings.viewMode = 'matrix'; Modes.sync();
out.enter = { current: Modes.current(), cool, pinned: d.nodes.filter((n) => n.fx != null).length, drag: Modes.allowsDrag(),
  dbgCurrent: Modes.debug().current, draws: Modes.drawsNodes() };
settings.viewMode = 'graph'; Modes.sync();
out.exit = { current: Modes.current(), cool, pinned: d.nodes.filter((n) => n.fx != null).length, drag: Modes.allowsDrag(),
  restored: d.nodes.filter((n, i) => n.x === i && n.y === -i && n.z === 2 * i).length, reheats, draws: Modes.drawsNodes() };
console.log(JSON.stringify(out));
"""


class TestMatrixWiring(unittest.TestCase):
    def test_index_loads_matrix_after_framework_before_app(self):
        srcs = re.findall(r'<script src="(/[^"]+)"', (WEB / "index.html").read_text())
        self.assertLess(srcs.index("/modes/modes.js"), srcs.index("/modes/matrix.js"))
        self.assertLess(srcs.index("/modes/matrix.js"), srcs.index("/app.js"))


@unittest.skipUnless(shutil.which("node"), "node not installed")
class TestMatrixLayout(unittest.TestCase):
    @classmethod
    def setUpClass(cls):
        r = subprocess.run(["node", "-e", HARNESS, "x", str(WEB)], capture_output=True, text=True, timeout=60)
        if r.returncode:
            raise AssertionError(r.stderr)
        cls.out = json.loads(r.stdout)

    def test_top_tenth_by_degree_are_hubs(self):
        self.assertEqual(self.out["hubs"], 30)   # round(302 * 0.1)

    def test_stratum_is_hops_to_nearest_hub(self):
        o = self.out
        self.assertEqual((o["placed"], o["stratumOk"], o["ownerOk"], o["yMatch"]), (o["nodes"],) * 4)
        self.assertEqual(o["distinct"], o["nodes"])

    def test_y_strictly_ordered_by_stratum(self):
        self.assertTrue(self.out["ordered"])
        self.assertGreaterEqual(self.out["strata"], 3)

    def test_unreachable_sink_to_bottom(self):
        self.assertEqual(self.out["unreachable"], ["lone1", "lone2"])
        self.assertTrue(self.out["lonesBottom"])

    def test_parent_links_point_one_stratum_up(self):
        o = self.out
        self.assertGreater(o["parentWant"], 200)
        self.assertEqual((o["parentOk"], o["parentStray"]), (o["parentWant"], 0))

    def test_basement_is_tidy_floor_in_footprint(self):
        b = self.out["basement"]
        self.assertEqual(b["n"], 122)
        self.assertEqual(b["ys"], 1)
        self.assertTrue(b["bottom"] and b["aboveOk"])
        self.assertTrue(b["inX"] and b["inZ"])   # no tail out past the hub blocks
        self.assertGreater(b["rows"], 1)         # a 2D grid, not a single line
        self.assertEqual(b["distinct"], 122)

    def test_empty_graph(self):
        self.assertEqual(self.out["empty"], 0)

    def test_enter_pins_and_stops_sim_exit_restores(self):
        e, x = self.out["enter"], self.out["exit"]
        self.assertEqual((e["current"], e["cool"], e["drag"], e["dbgCurrent"]), ("matrix", 0, False, "matrix"))
        self.assertEqual(e["pinned"], 302)
        self.assertEqual((x["current"], x["pinned"], x["drag"], x["restored"], x["reheats"]), ("graph", 0, True, 302, 0))
        self.assertIsNone(x["cool"])
        self.assertEqual((e["draws"], x["draws"]), (True, False))   # instanced3d hides its spheres only in-mode


if __name__ == "__main__":
    unittest.main()
