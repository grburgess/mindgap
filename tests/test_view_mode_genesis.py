"""3D view mode 'genesis' (web/modes/genesis.js): replay-by-created_at contract, run under node when present."""
import json
import re
import shutil
import subprocess
import unittest
from pathlib import Path

ROOT = Path(__file__).resolve().parents[1]
WEB = ROOT / "mindgap" / "web"

# loads modes.js + genesis.js in a bare shim (no THREE / DOM → FX Points + HUD skip), drives a fake
# graph with a manual rAF clock, and records the visible set while the replay plays. A stub
# Instanced3d records the setMod override (edge age tint; no radius hook → Graph-sized spheres).
HARNESS = r"""
const fs = require('fs'), path = require('path');
global.window = global; global.document = { hidden: false };
let q = [], clock = 0;
global.requestAnimationFrame = (cb) => { q.push(cb); return q.length; };
global.cancelAnimationFrame = () => { q = []; };
function frames(k, dt) { for (let i = 0; i < k; i++) { clock += dt; const cbs = q; q = []; cbs.forEach((cb) => cb(clock)); } }
const web = process.argv[2];
global.Instanced3d = { mod: null, setMod(m) { this.mod = m || null; }, rebuild() {}, flash() {} };
eval(fs.readFileSync(path.join(web, 'modes/modes.js'), 'utf8'));
eval(fs.readFileSync(path.join(web, 'modes/genesis.js'), 'utf8'));
let settings = { viewMode: 'graph' };
const ctx = { getSettings: () => settings, nodeColorFor: () => '#fff', nodeVal: () => 1 };
const DAY = 86400000, T0 = Date.UTC(2026, 0, 1);
function data() {
  const nodes = [], links = [];
  for (let i = 0; i < 200; i++) nodes.push({ id: 'n' + i, type: i % 3 ? 'concept' : 'paper',
    created_at: new Date(T0 + ((i * 37) % 200) * DAY / 2).toISOString(), x: i, y: -i, z: 2 * i });
  nodes.push({ id: 'undated', type: 'concept', x: 7, y: 7, z: 7 });
  for (let i = 1; i < 200; i++) links.push({ source: 'n' + i, target: 'n' + (i * 7 % i) });
  links.push({ source: 'undated', target: 'n5' });
  return { nodes, links };
}
let d = data(), cool = Infinity, ctime = 15000;
const forces = new Map([['charge', null], ['link', null]]);   // d3 force registry (insertion order = run order)
const g = { graphData: (v) => (v === undefined ? d : (d = v, g)),
  d3Force: (k, f) => (f === undefined ? forces.get(k) || null : (f === null ? forces.delete(k) : (forces.set(k, f), f.initialize && f.initialize(d.nodes)), g)),
  cooldownTicks: (v) => (v === undefined ? cool : (cool = v, g)), cooldownTime: (v) => (v === undefined ? ctime : (ctime = v, g)),
  d3ReheatSimulation: () => {}, zoomToFit: () => {}, scene: () => ({ add() {}, remove() {} }) };
const orig = d;
function consistent() {                                   // every visible link has both endpoints visible
  const ids = new Set(d.nodes.map((n) => n.id));
  return d.links.every((l) => ids.has(typeof l.source === 'object' ? l.source.id : l.source) && ids.has(typeof l.target === 'object' ? l.target.id : l.target));
}
Modes.install(g, ctx);
settings.viewMode = 'genesis'; Modes.sync();
const out = { enter: Object.assign({ current: Modes.current(), drag: Modes.allowsDrag(), cool, pinned: d.nodes.filter((n) => n.fx != null).length }, Modes.debug()) };
const samples = [];
let ok = true, hub = null, rMid = 0;
const degOf = (id) => d.nodes.find((n) => n.id === id).__gdeg;   // live degree (links born so far)
for (let s = 0; s < 40; s++) {
  frames(60, 1000 / 60); const m = Modes.debug(); samples.push([m.visible, m.replayTime, m.playing, m.visibleLinks]); ok = ok && consistent();
  if (s === 12) {
    hub = m.topHub; rMid = degOf(hub); out.midHubs = m.hubs;
    // playing: the calm speed cap runs last; a blasted node (and a slow one) after one pass
    const names = [...forces.keys()], calm = forces.get(names[names.length - 1]), fast = d.nodes[1], slow = d.nodes[2];
    fast.vx = 3000; fast.vy = -4000; fast.vz = 0; slow.vx = 1; slow.vy = 0; slow.vz = 0;
    calm(1);
    out.calmMid = { last: names[names.length - 1], n: names.length, fast: Math.hypot(fast.vx, fast.vy, fast.vz), dir: fast.vx / fast.vy, slow: slow.vx };
  }
}
out.calmEnd = [...forces.keys()];
// seeding: every newborn whose neighbour was born first sits SEED_K link lengths out, on the outward side
{ const n0 = d.nodes.find((n) => n.id === 'n0'), r = [], out_ = [];
  for (const n of d.nodes) if (n !== n0 && n.id !== 'undated') {
    const dx = n.x - n0.x, dy = n.y - n0.y, dz = n.z - n0.z; r.push(Math.hypot(dx, dy, dz)); out_.push(dx * n0.x + dy * n0.y + dz * n0.z >= -1e-9);
  }
  out.seed = { rMin: Math.min(...r), rMax: Math.max(...r), outward: out_.every(Boolean), n: r.length }; }
out.samples = samples; out.consistent = ok; out.end = Modes.debug();
// hierarchy: the mid-replay top hub's live degree grew as its links arrived; edge tint: old links sink, newest glow
const L = d.links.length, attr = { array: new Float32Array(L * 8).fill(0.5), count: 2 * L };
Instanced3d.mod.tintLinks(attr, d.links);
const deg = {}; data().links.forEach((l) => { deg[l.source] = (deg[l.source] || 0) + 1; deg[l.target] = (deg[l.target] || 0) + 1; });
out.look = { modSet: !!Instanced3d.mod, radiusHook: 'radius' in Instanced3d.mod, hub, rMid, rEnd: degOf(hub), rLeaf: degOf('undated'), oldA: attr.array[3], newA: attr.array[(L - 1) * 8 + 3],
  maxDeg: Math.max(...Object.values(deg)) };
// theme rebuild (dataChanged, no swap): same set, same object
const before = d; Modes.dataChanged(); out.theme = { same: d === before, visible: Modes.debug().visible };
// restart + app filter swap mid-replay: resumes at the same replay time over the new set
settings.viewMode = 'graph'; Modes.sync(); settings.viewMode = 'genesis'; Modes.sync();
frames(60 * 10, 1000 / 60);
const mid = Modes.debug(), prev = new Map(d.nodes.map((n) => [n.id, n]));
const swapped = { nodes: orig.nodes.filter((n) => n.type !== 'paper').map((n) => { const c = { ...n }, p = prev.get(n.id); if (p) { c.x = p.x; c.y = p.y; c.z = p.z; } return c; }),
  links: [] };
const keep = new Set(swapped.nodes.map((n) => n.id));
swapped.links = data().links.filter((l) => keep.has(l.source) && keep.has(l.target));
g.graphData(swapped); Modes.dataChanged();
const after = Modes.debug();
out.swap = { midT: mid.replayTime, afterT: after.replayTime, total: after.total, visible: after.visible, consistent: consistent(),
  expected: swapped.nodes.filter((n) => { const t = Date.parse(n.created_at); return !Number.isFinite(t) || t <= mid.replayTime; }).length };
// leave → graph: full set back, every snapshotted position restored exactly, forces/drag back
settings.viewMode = 'graph'; Modes.sync();
const byId = new Map(orig.nodes.map((n) => [n.id, n]));
out.exit = { mod: Instanced3d.mod, current: Modes.current(), drag: Modes.allowsDrag(), cool, nodes: d.nodes.length, links: d.links.length,
  pinned: d.nodes.filter((n) => n.fx != null).length, same: d === swapped, forces: [...forces.keys()],
  restored: d.nodes.filter((n) => { const o = data().nodes.find((m) => m.id === n.id); return o && n.x === o.x && n.y === o.y && n.z === o.z; }).length };
// filter / search round-trips: app swaps in fresh clones of the matching nodes (positions carried)
function swapTo(keepFn) {
  const prev = new Map(d.nodes.map((n) => [n.id, n]));
  const nodes = data().nodes.filter(keepFn).map((n) => { const p = prev.get(n.id); if (p) { n.x = p.x; n.y = p.y; n.z = p.z; } return n; });
  const ids = new Set(nodes.map((n) => n.id));
  g.graphData({ nodes, links: data().links.filter((l) => ids.has(l.source) && ids.has(l.target)) }); Modes.dataChanged();
  return Modes.debug();
}
const all = () => true, early = (n) => Date.parse(n.created_at) <= T0 + 10 * DAY;
// (a) replay to the end → filter → clear: every node visible again
g.graphData(data()); settings.viewMode = 'genesis'; Modes.sync();
frames(40 * 60, 1000 / 60);
const done0 = Modes.debug(), fd = swapTo((n) => n.type !== 'paper'), cd = swapTo(all);
out.doneRoundTrip = { done0: [done0.visible, done0.done], filtered: [fd.visible, fd.total], cleared: [cd.visible, cd.total, cd.visibleLinks, cd.totalLinks, cd.done],
  consistent: consistent() };
// (b) mid-replay filter to an already-born early subset → clear: growth stays monotone and still reaches all
settings.viewMode = 'graph'; Modes.sync(); g.graphData(data()); settings.viewMode = 'genesis'; Modes.sync();
frames(60 * 10, 1000 / 60);
const m0 = Modes.debug(), mf = swapTo(early);
frames(60, 1000 / 60);
const mf2 = Modes.debug(), mc = swapTo(all), mid2 = [[m0.visible, m0.replayTime], [mc.visible, mc.replayTime]];
for (let s = 0; s < 30; s++) { frames(60, 1000 / 60); const m = Modes.debug(); mid2.push([m.visible, m.replayTime]); }
const mend = Modes.debug();
out.midRoundTrip = { samples: mid2, filtered: [mf.visible, mf.total, mf.playing, mf2.playing, mf2.done], end: [mend.visible, mend.total, mend.done], consistent: consistent() };
console.log(JSON.stringify(out));
"""

# sliced charge: 3000 born nodes (> SLICE_N) while playing → genesis swaps the app's charge force for its
# sliced Barnes-Hut stand-in. Over K ticks it must reproduce the brute-force many-body impulse, each
# tick touching one slice; stopped/leaving → the original force is back.
SLICED = r"""
const fs = require('fs'), path = require('path');
global.window = global; global.document = { hidden: false };
global.requestAnimationFrame = () => 1; global.cancelAnimationFrame = () => {};
const web = process.argv[2];
global.Instanced3d = { mod: null, setMod(m) { this.mod = m || null; }, rebuild() {}, flash() {} };
eval(fs.readFileSync(path.join(web, 'modes/modes.js'), 'utf8'));
eval(fs.readFileSync(path.join(web, 'modes/genesis.js'), 'utf8'));
let settings = { viewMode: 'graph' };
const ctx = { getSettings: () => settings, nodeColorFor: () => '#fff', nodeVal: () => 1 };
const N = 3000, nodes = [];
for (let i = 0; i < N; i++) nodes.push({ id: 'n' + i, created_at: '2026-01-01T00:00:00Z' });
let d = { nodes, links: [] }, cool = Infinity;
const S0 = -260;
function brute(ns, alpha) {                       // reference many-body (d3: distanceMin 1, no distanceMax)
  for (const n of ns) for (const m of ns) { if (m === n) continue;
    const dx = m.x - n.x, dy = m.y - n.y, dz = m.z - n.z; let l = dx * dx + dy * dy + dz * dz; if (l < 1) l = Math.sqrt(l);
    const q = S0 * alpha / l; n.vx += dx * q; n.vy += dy * q; n.vz += dz * q; }
}
let th = 0.9, calls = 0, inits = 0;
const orig = function (a) { calls++; brute(orig.nodes, a); };
orig.strength = (v) => (v === undefined ? () => S0 : orig); orig.theta = (v) => (v === undefined ? th : (th = v, orig));
orig.initialize = (ns) => { inits++; orig.nodes = ns; };
const forces = new Map([['charge', orig]]);
const g = { graphData: (v) => (v === undefined ? d : (d = v, g)), cooldownTicks: (v) => (v === undefined ? cool : (cool = v, g)),
  cooldownTime: () => 15000, zoomToFit: () => {}, d3ReheatSimulation: () => {}, scene: () => ({ add() {}, remove() {} }),
  d3Force: (k, f) => (f === undefined ? forces.get(k) || null : (f === null ? forces.delete(k) : (forces.set(k, f), f.initialize && f.initialize(d.nodes)), g)) };
Modes.install(g, ctx); settings.viewMode = 'genesis'; Modes.sync();
const prox = forces.get('charge'), out = { swapped: prox !== orig, playing: Modes.debug().playing, visible: Modes.debug().visible, thetaPlay: th };
prox.initialize(d.nodes); prox.theta(0.5);
const zero = () => d.nodes.forEach((n) => { n.vx = 0; n.vy = 0; n.vz = 0; });
zero(); prox(1);
out.touched1 = d.nodes.filter((n) => n.vx || n.vy || n.vz).length;
prox(1); prox(1);
const got = d.nodes.map((n) => [n.vx, n.vy, n.vz]);
zero(); brute(d.nodes, 3);                         // K = 3 full ticks of the original force
let num = 0, den = 0;
d.nodes.forEach((n, i) => { num += (got[i][0] - n.vx) ** 2 + (got[i][1] - n.vy) ** 2 + (got[i][2] - n.vz) ** 2; den += n.vx ** 2 + n.vy ** 2 + n.vz ** 2; });
out.relErr = Math.sqrt(num / den); out.origCalls = calls;
settings.viewMode = 'graph'; Modes.sync();
out.restored = forces.get('charge') === orig; out.thetaAfter = th;
console.log(JSON.stringify(out));
"""

# physics budget + stop settle: a 120 Hz clock with rare 4.5 ms rAF jitter must grow the per-batch tick
# budget (the old fastest-frame cap read every 8.3 ms frame as slow and pinned it at 1); sustained
# missed frames must shrink it. At done the sim settles to the early-stop on the sliced charge + calm
# (one reheat, budget lifted at once) and the original charge comes back only once the engine idles.
BUDGET = r"""
const fs = require('fs'), path = require('path');
global.window = global; global.document = { hidden: false };
let q = [], clock = 0;
global.requestAnimationFrame = (cb) => { q.push(cb); return q.length; };
global.cancelAnimationFrame = () => { q = []; };
function frame(dt) { clock += dt; const cbs = q; q = []; cbs.forEach((cb) => cb(clock)); }
const web = process.argv[2];
global.Instanced3d = { mod: null, setMod(m) { this.mod = m || null; }, rebuild() {}, flash() {} };
eval(fs.readFileSync(path.join(web, 'modes/modes.js'), 'utf8'));
eval(fs.readFileSync(path.join(web, 'modes/genesis.js'), 'utf8'));
let settings = { viewMode: 'graph' };
const ctx = { getSettings: () => settings, nodeColorFor: () => '#fff', nodeVal: () => 1 };
const T0 = Date.UTC(2026, 0, 1), nodes = [];
for (let i = 0; i < 400; i++) nodes.push({ id: 'n' + i, created_at: new Date(T0 + i * 3600000).toISOString() });
let d = { nodes, links: [] }, cool = Infinity, reheats = 0;
const orig = function () {}; orig.theta = (v) => (v === undefined ? 0.9 : orig); orig.strength = () => -260;
const forces = new Map([['charge', orig]]);
const g = { graphData: (v) => (v === undefined ? d : (d = v, g)), cooldownTicks: (v) => (v === undefined ? cool : (cool = v, g)),
  cooldownTime: () => 15000, zoomToFit: () => {}, d3ReheatSimulation: () => { reheats++; }, scene: () => ({ add() {}, remove() {} }),
  d3Force: (k, f) => (f === undefined ? forces.get(k) || null : (f === null ? forces.delete(k) : (forces.set(k, f), f.initialize && f.initialize(d.nodes), g))) };
Modes.install(g, ctx); settings.viewMode = 'genesis'; Modes.sync();
const out = {};
for (let i = 0; i < 600; i++) frame(i % 25 === 24 ? 4.5 : 1000 / 120);          // 5 s at 120 Hz, rare short jitter
out.ticks120 = Modes.debug().physicsTicksPerBatch;
{ // tether (calm, playing): an exiled node is pulled back toward the origin; a node near it is not
  const calm = forces.get('genesisCalm'), far = d.nodes[0], near = d.nodes[1];
  far.x = 1e5; far.y = 0; far.z = 0; far.vx = far.vy = far.vz = 0;
  near.x = 10; near.y = 0; near.z = 0; near.vx = near.vy = near.vz = 0;
  calm(1); out.tether = { far: far.vx, near: near.vx };
  far.x = 0; near.x = 0; far.vx = near.vx = 0; }
for (let i = 0; i < 120; i++) frame(25);                                       // 3 s of missed frames
out.ticksSlow = Modes.debug().physicsTicksPerBatch;
for (let i = 0; i < 6000 && !Modes.debug().done; i++) frame(1000 / 120);
out.doneFrame = { done: Modes.debug().done, reheats0: reheats };
frame(1000 / 120); frame(1000 / 120);
out.settling = { cool, reheats, calm: forces.has('genesisCalm'), proxy: forces.get('charge') !== orig };
for (let i = 0; i < 60; i++) frame(1000 / 120);                                  // no ticks (fake engine) → idle
out.handedBack = { cool, reheats, calm: forces.has('genesisCalm'), orig: forces.get('charge') === orig };
console.log(JSON.stringify(out));
"""


class TestGenesisWiring(unittest.TestCase):
    def test_index_loads_genesis_after_framework_before_app(self):
        srcs = re.findall(r'<script src="(/[^"]+)"', (WEB / "index.html").read_text())
        self.assertLess(srcs.index("/modes/modes.js"), srcs.index("/modes/genesis.js"))
        self.assertLess(srcs.index("/modes/genesis.js"), srcs.index("/app.js"))


@unittest.skipUnless(shutil.which("node"), "node not installed")
class TestGenesisReplay(unittest.TestCase):
    @classmethod
    def setUpClass(cls):
        r = subprocess.run(["node", "-e", HARNESS, "x", str(WEB)], capture_output=True, text=True, timeout=60)
        if r.returncode:
            raise AssertionError(r.stderr)
        cls.out = json.loads(r.stdout)

    def test_enter_keeps_forces_and_drag(self):
        e = self.out["enter"]
        self.assertEqual((e["current"], e["drag"], e["pinned"]), ("genesis", True, 0))
        self.assertGreaterEqual(e["cool"], 1)            # sim runs, in budgeted bursts per batch while playing
        self.assertTrue(e["playing"])
        self.assertGreaterEqual(e["visible"], 1)
        self.assertLess(e["visible"], 50)

    def test_visible_grows_monotonically_to_all(self):
        vis = [s[0] for s in self.out["samples"]]
        times = [s[1] for s in self.out["samples"]]
        self.assertEqual(vis, sorted(vis))
        self.assertEqual(times, sorted(times))
        self.assertGreaterEqual(len(set(v for v in vis if v < 201)), 5)   # ≥5 distinct growing samples
        self.assertTrue(self.out["consistent"])
        end = self.out["end"]
        self.assertEqual((end["visible"], end["total"], end["visibleLinks"], end["totalLinks"]), (201, 201, 200, 200))
        self.assertTrue(end["done"])
        self.assertFalse(end["playing"])                 # stops at now (loop off)
        self.assertEqual(end["replayTime"], end["endTime"])
        self.assertIsNone(end["cooldownTicks"])          # stopped → physics budget lifted (normal settle)

    def test_batched_not_per_frame(self):
        self.assertLess(self.out["end"]["batches"], 40 * 60 / 6)   # ≤ ~1 swap per 200 ms, not 1 per frame

    def test_theme_rebuild_keeps_set(self):
        self.assertEqual(self.out["theme"], {"same": True, "visible": 201})

    def test_data_swap_resumes_at_same_time(self):
        s = self.out["swap"]
        self.assertEqual(s["midT"], s["afterT"])
        self.assertEqual(s["visible"], s["expected"])
        self.assertLess(s["visible"], s["total"])
        self.assertTrue(s["consistent"])

    def test_exit_restores_full_set_positions_forces(self):
        x = self.out["exit"]
        self.assertEqual((x["current"], x["drag"], x["pinned"], x["same"]), ("graph", True, 0, True))
        self.assertIsNone(x["mod"])                      # instanced override cleared: Graph radii + edge colours
        self.assertIsNone(x["cool"])
        self.assertEqual(x["nodes"], x["restored"])      # every node back at its pre-genesis position

    def test_graph_sized_spheres_hubs_by_live_degree(self):
        k = self.out["look"]
        self.assertTrue(k["modSet"])
        self.assertFalse(k["radiusHook"])                 # one scale source: instanced3d's Graph radius
        self.assertIsNotNone(k["hub"])
        self.assertGreater(self.out["midHubs"], 0)
        self.assertGreater(k["rEnd"], k["rMid"])          # hub keeps accumulating links (halo grows with it)
        self.assertGreater(k["rMid"], k["rLeaf"])         # hierarchy: hub > degree-1 leaf
        self.assertEqual(self.out["end"]["maxDegree"], k["maxDeg"])   # live degree = full degree at now

    def test_calm_caps_speed_while_playing_only(self):
        c = self.out["calmMid"]
        self.assertEqual(c["last"], "genesisCalm")          # runs after every other force
        self.assertAlmostEqual(c["fast"], 0.15 * 55, places=6)   # 5000/tick blast → capped at VMAX_K × linkDist
        self.assertAlmostEqual(c["dir"], -0.75, places=6)   # direction kept
        self.assertEqual(c["slow"], 1)                      # slow nodes untouched
        self.assertNotIn("genesisCalm", self.out["calmEnd"])   # done → removed (normal settle dynamics)
        self.assertNotIn("genesisCalm", self.out["exit"]["forces"])

    def test_newborns_seed_beside_born_neighbour_outward(self):
        k = self.out["seed"]
        self.assertEqual(k["n"], 199)
        self.assertAlmostEqual(k["rMin"], 0.5 * 55, places=6)   # not piled 8 units from the neighbour
        self.assertAlmostEqual(k["rMax"], 0.5 * 55, places=6)
        self.assertTrue(k["outward"])

    def test_old_links_fade_newest_bright(self):
        k = self.out["look"]
        self.assertLess(k["oldA"], 0.5 * 0.5)              # oldest edge sinks well below its base alpha
        self.assertGreater(k["newA"], 0.5)                 # newest edge above base (recent / glowing)

    def test_done_then_filter_then_clear_shows_all(self):
        r = self.out["doneRoundTrip"]
        self.assertEqual(r["done0"], [201, True])
        self.assertEqual(r["filtered"][0], r["filtered"][1])     # every matching node shown
        self.assertEqual(r["cleared"], [201, 201, 200, 200, True])
        self.assertTrue(r["consistent"])

    def test_mid_replay_filter_round_trip_monotone(self):
        r = self.out["midRoundTrip"]
        vis = [s[0] for s in r["samples"]]
        times = [s[1] for s in r["samples"]]
        self.assertEqual(vis, sorted(vis))
        self.assertEqual(times, sorted(times))
        self.assertLess(vis[0], 201)
        self.assertEqual(r["filtered"][0], r["filtered"][1])     # early subset fully born
        self.assertTrue(r["filtered"][3])                        # filter doesn't end the replay
        self.assertFalse(r["filtered"][4])
        self.assertEqual(r["end"], [201, 201, True])
        self.assertTrue(r["consistent"])


@unittest.skipUnless(shutil.which("node"), "node not installed")
class TestGenesisBudgetAndSettle(unittest.TestCase):
    @classmethod
    def setUpClass(cls):
        r = subprocess.run(["node", "-e", BUDGET, "x", str(WEB)], capture_output=True, text=True, timeout=60)
        if r.returncode:
            raise AssertionError(r.stderr)
        cls.out = json.loads(r.stdout)

    def test_tether_pulls_exiled_nodes_back(self):
        t = self.out["tether"]
        self.assertLess(t["far"], 0)                         # pulled inward (speed-capped by calm)
        self.assertEqual(t["near"], 0)                       # inside the tether radius: untouched

    def test_budget_grows_at_120hz_despite_jitter(self):
        self.assertGreaterEqual(self.out["ticks120"], 24)   # ≥ a full 200 ms batch of 120 Hz frames

    def test_budget_shrinks_on_missed_frames(self):
        self.assertLess(self.out["ticksSlow"], self.out["ticks120"])
        self.assertLessEqual(self.out["ticksSlow"], 4)

    def test_stop_settles_on_sliced_charge_then_hands_back(self):
        o = self.out
        self.assertTrue(o["doneFrame"]["done"])
        s = o["settling"]
        self.assertIsNone(s["cool"])                         # budget lifted: settle runs to the early-stop
        self.assertEqual(s["reheats"], 1)                    # one settle reheat, from the done frame on
        self.assertTrue(s["calm"] and s["proxy"])            # ...on the cheap sliced charge + calm
        h = o["handedBack"]
        self.assertEqual(h["reheats"], s["reheats"])         # one settle, no full-accuracy burst
        self.assertFalse(h["calm"])
        self.assertTrue(h["orig"])                           # engine idle → original charge back


@unittest.skipUnless(shutil.which("node"), "node not installed")
class TestGenesisSlicedCharge(unittest.TestCase):
    @classmethod
    def setUpClass(cls):
        r = subprocess.run(["node", "-e", SLICED, "x", str(WEB)], capture_output=True, text=True, timeout=120)
        if r.returncode:
            raise AssertionError(r.stderr)
        cls.out = json.loads(r.stdout)

    def test_swaps_in_while_playing_and_restores_on_leave(self):
        o = self.out
        self.assertTrue(o["swapped"] and o["playing"])
        self.assertEqual(o["visible"], 3000)
        self.assertEqual(o["thetaPlay"], 1.5)
        self.assertTrue(o["restored"])
        self.assertEqual(o["thetaAfter"], 0.9)

    def test_one_slice_per_tick(self):
        self.assertEqual(self.out["touched1"], 1000)     # 3000 nodes, SLICE_N 1200 → K 3 slices of 1000
        self.assertEqual(self.out["origCalls"], 0)       # never fell back to the full O(N) force while playing

    def test_k_ticks_match_brute_force(self):
        self.assertLess(self.out["relErr"], 0.05)        # Barnes-Hut θ 0.5: K sliced ticks = K full ticks


if __name__ == "__main__":
    unittest.main()
