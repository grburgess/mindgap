"""3D view mode 'brain' (web/modes/brain.js): wiring + the lobe layout contract, run under node when present."""
import json
import re
import shutil
import sqlite3
import subprocess
import sys
import tempfile
import unittest
from pathlib import Path

ROOT = Path(__file__).resolve().parents[1]
WEB = ROOT / "mindgap" / "web"

# loads modes.js + brain.js in a bare shim (no THREE → decorations skip), lays out a dense-map-like
# type mix and checks the structural signature + the framework's enter/exit on a fake graph
HARNESS = r"""
const fs = require('fs'), path = require('path');
global.window = global; global.document = { hidden: false };
global.requestAnimationFrame = () => 1; global.cancelAnimationFrame = () => {};
const web = process.argv[2];
eval(fs.readFileSync(path.join(web, 'modes/modes.js'), 'utf8'));
let spec = null; const reg = Modes.register;
Modes.register = (n, s) => { spec = s; reg(n, s); };
eval(fs.readFileSync(path.join(web, 'modes/brain.js'), 'utf8'));
let settings = { viewMode: 'graph' };
const ctx = { getSettings: () => settings, nodeColorFor: () => '#fff', nodeVal: () => 1 };
const TYPES = ['concept', 'definition', 'software', 'repo', 'page', 'paper', 'person', 'team', 'design', 'feature',
  'learning', 'jira-ticket', 'stub', 'finding', 'decision', 'idea', 'widget'];
const W = [34, 8, 5, 6, 10, 18, 8, 1, 2, 3, 3, 4, 2, 2, 2, 2, 1];
function data(N) {
  const tot = W.reduce((a, b) => a + b); let r = 7; const rnd = () => (r = (r * 16807) % 2147483647) / 2147483647;
  const nodes = [], links = [];
  for (let i = 0; i < N; i++) { let x = rnd() * tot, t = 0; while (x > W[t]) { x -= W[t]; t++; } nodes.push({ id: 'n' + i, type: TYPES[t] }); }
  for (let i = 0; i < 2 * N; i++) links.push({ source: 'n' + Math.floor(rnd() * N), target: 'n' + Math.floor(rnd() * N) });
  return { nodes, links };
}
function signature(N, d) {
  d = d || data(N); N = d.nodes.length;
  const pos = spec.layout(d, ctx), dbg = spec.debug();
  // ALL type pairs (same lobe included) vs the median spread, recomputed here independently of debug()
  const ts = Object.keys(dbg.centroid);
  const sp = ts.map((t) => dbg.spread[t]).sort((a, b) => a - b), n2 = sp.length >> 1;
  const med = Math.max(sp[n2], sp.length % 2 ? sp[n2] : (sp[n2 - 1] + sp[n2]) / 2);   // stricter of both medians
  let minD = Infinity, below = 0;
  for (const a of ts) for (const b of ts) {
    if (a >= b) continue;
    const ca = dbg.centroid[a], cb = dbg.centroid[b], dd = Math.hypot(ca[0] - cb[0], ca[1] - cb[1], ca[2] - cb[2]);
    minD = Math.min(minD, dd); if (dd <= med) below++;
  }
  // both hemispheres used: lobes (bar the midline stem) have nodes on each side of x = 0
  let left = 0, right = 0, fissure = Infinity;
  for (const p of pos.values()) { if (p.x < 0) left++; else if (p.x > 0) right++; }
  // midline fissure: every node outside the (midline) stem keeps |x| clear of the midline
  for (const n of d.nodes) if (spec.lobeOf(n.type) !== 'stem') fissure = Math.min(fissure, Math.abs(pos.get(n.id).x) / dbg.scale);
  const again = spec.layout(d, ctx), stable = [...pos].every(([id, p]) => { const q = again.get(id); return q.x === p.x && q.y === p.y && q.z === p.z; });
  return { placed: pos.size, nodes: N, ratio: minD / med, below, types: ts.length, left, right, fissure, stable, typeLobe: dbg.typeLobe,
    sig: dbg.signature };
}
// the perf fixture (tools/perf/gen_dense_map.py --nodes 5000): "id|type" lines
const fixture = { nodes: fs.readFileSync(process.argv[3], 'utf8').trim().split('\n').map((l) => { const [id, type] = l.split('|'); return { id, type }; }), links: [] };
const out = { small: signature(300), big: signature(5000), fixture: signature(0, fixture) };
out.lobeOf = Object.fromEntries(['papers', 'ml-paper', 'team-lead', 'verified-fact', 'stub', 'gotcha', 'mystery', ''].map((t) => [t, spec.lobeOf(t)]));
const d = data(400); d.nodes.forEach((n, i) => { n.x = i; n.y = -i; n.z = 2 * i; });
let cool = Infinity, reheats = 0;
const g = { graphData: () => d, cooldownTicks: (v) => (v === undefined ? cool : (cool = v, g)),
  d3ReheatSimulation: () => { reheats++; }, zoomToFit: () => {}, scene: () => ({ add() {}, remove() {} }) };
Modes.install(g, ctx);
settings.viewMode = 'brain'; Modes.sync();
out.enter = { current: Modes.current(), cool, pinned: d.nodes.filter((n) => n.fx != null).length, drag: Modes.allowsDrag(), moving: Modes.debug().moving };
settings.viewMode = 'graph'; Modes.sync();
out.exit = { current: Modes.current(), cool, pinned: d.nodes.filter((n) => n.fx != null).length, drag: Modes.allowsDrag(),
  restored: d.nodes.filter((n, i) => n.x === i && n.y === -i && n.z === 2 * i).length, reheats };
console.log(JSON.stringify(out));
"""


class TestBrainWiring(unittest.TestCase):
    def test_index_loads_brain_after_framework_before_app(self):
        srcs = re.findall(r'<script src="(/[^"]+)"', (WEB / "index.html").read_text())
        self.assertLess(srcs.index("/modes/modes.js"), srcs.index("/modes/brain.js"))
        self.assertLess(srcs.index("/modes/brain.js"), srcs.index("/app.js"))


# brain.js hideStraight() + exit() lifted out and run against fake instanced3d handles; the fake
# loop then re-asserts obj.visible like instanced3d's rAF loop does (photons.visible = gfx, arrows too)
HIDE_HARNESS = r"""
const fs = require('fs');
const src = fs.readFileSync(process.argv[2], 'utf8');
const pick = (name) => src.match(new RegExp('\\n  function ' + name + '\\(\\) \\{[\\s\\S]*?\\n  \\}'))[0];
const obj = () => ({ visible: true, material: { visible: true }, geometry: { dispose() {} } });
const h = { inst: obj(), lines: obj(), photons: obj(), arrows: obj(), hubMeshes: [obj(), obj()] };
global.window = global; window.Instanced3d = { debug: () => h };
const run = new Function('h', `let g = {}, arcs = null, glow = null, labels = null, hidden = [], hiddenMat = [],
  savedCam = null, reentry = false;
  ${pick('hideStraight')}
  ${pick('exit')}
  return { hideStraight, exit };`)(h);
const all = () => [h.inst, h.lines, h.photons, h.arrows, ...h.hubMeshes];
run.hideStraight();
for (const o of all()) o.visible = true;            // instanced3d loop: photons.visible = gfx, arrows.visible = gfx && arrows
const drawn = (o) => o.visible && o.material.visible;
const out = { inBrain: all().map(drawn) };
run.exit();
out.afterExit = all().map(drawn);
console.log(JSON.stringify(out));
"""


@unittest.skipUnless(shutil.which("node"), "node not installed")
class TestBrainHidesGraphObjects(unittest.TestCase):
    # regression: arrows were never hidden and photons only via obj.visible (re-set every frame by the
    # instanced3d loop) → cones + straight-chord photons drew over the lobes as purple shards
    def test_spheres_edges_photons_arrows_hidden_until_exit(self):
        r = subprocess.run(["node", "-e", HIDE_HARNESS, "x", str(WEB / "modes" / "brain.js")],
                           capture_output=True, text=True, timeout=30)
        if r.returncode:
            raise AssertionError(r.stderr)
        out = json.loads(r.stdout)
        self.assertEqual(out["inBrain"], [False] * 6)
        self.assertEqual(out["afterExit"], [True] * 6)


@unittest.skipUnless(shutil.which("node"), "node not installed")
class TestBrainLayout(unittest.TestCase):
    @classmethod
    def setUpClass(cls):
        with tempfile.TemporaryDirectory() as tmp:
            db = Path(tmp) / "x.db"
            subprocess.run([sys.executable, str(ROOT / "tools" / "perf" / "gen_dense_map.py"), "--db", str(db),
                            "--nodes", "5000", "--edges", "10000"], check=True, capture_output=True, timeout=120)
            con = sqlite3.connect(str(db))
            (Path(tmp) / "nodes.txt").write_text("\n".join(f"{i}|{t}" for i, t in con.execute("SELECT id, type FROM nodes")))
            con.close()
            r = subprocess.run(["node", "-e", HARNESS, "x", str(WEB), str(Path(tmp) / "nodes.txt")],
                               capture_output=True, text=True, timeout=60)
        if r.returncode:
            raise AssertionError(r.stderr)
        cls.out = json.loads(r.stdout)

    def test_lobe_table(self):
        tl = self.out["big"]["typeLobe"]
        for t, lobe in {"idea": "frontal", "decision": "frontal", "jira-ticket": "frontal", "concept": "parietal",
                        "definition": "parietal", "software": "parietal", "repo": "parietal", "person": "temporal",
                        "team": "temporal", "paper": "occipital", "page": "occipital", "learning": "cerebellum",
                        "finding": "cerebellum", "stub": "stem", "widget": "parietal"}.items():
            self.assertEqual(tl[t], lobe, t)

    def test_unknown_types_map_to_closest_lobe(self):
        self.assertEqual(self.out["lobeOf"], {"papers": "occipital", "ml-paper": "occipital", "team-lead": "temporal",
                                              "verified-fact": "cerebellum", "stub": "stem", "gotcha": "cerebellum",
                                              "mystery": "parietal", "": "stem"})

    def test_signature_all_type_pairs_apart_beyond_median_spread(self):
        # every pair of type centroids, same lobe included (66 pairs on the 12-type 5k fixture)
        for k in ("small", "big", "fixture"):
            o = self.out[k]
            self.assertEqual(o["placed"], o["nodes"], k)
            self.assertEqual(o["below"], 0, k)
            self.assertGreater(o["ratio"], 1.15, k)
        self.assertEqual((self.out["fixture"]["nodes"], self.out["fixture"]["types"]), (5000, 12))

    def test_debug_reports_signature(self):
        for k in ("small", "big", "fixture"):
            o = self.out[k]
            s = o["sig"]
            self.assertEqual((s["types"], s["pairs"], s["below"]), (o["types"], o["types"] * (o["types"] - 1) // 2, 0), k)
            self.assertGreater(s["ratio"], 1.15, k)

    def test_two_hemispheres_and_deterministic(self):
        for k in ("small", "big", "fixture"):
            o = self.out[k]
            self.assertTrue(o["stable"], k)
            self.assertLess(abs(o["left"] - o["right"]) / o["nodes"], 0.1, k)

    def test_midline_fissure_between_hemispheres(self):
        # non-stem nodes sit >= FISSURE*XS (0.13 brain units) off x = 0 → a dark gap between the hemispheres
        for k in ("small", "big", "fixture"):
            self.assertGreaterEqual(self.out[k]["fissure"], 0.12, k)

    def test_enter_pins_static_exit_restores(self):
        e, x = self.out["enter"], self.out["exit"]
        self.assertEqual((e["current"], e["cool"], e["drag"], e["pinned"], e["moving"]), ("brain", 0, False, 400, False))
        self.assertEqual((x["current"], x["pinned"], x["drag"], x["restored"], x["reheats"]), ("graph", 0, True, 400, 0))
        self.assertIsNone(x["cool"])


if __name__ == "__main__":
    unittest.main()
