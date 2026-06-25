# tests/test_analyze.py
import unittest
from mindgap import analyze


def _g(nodes, links):
    return {"nodes": nodes, "links": links}


class BuildGraphTest(unittest.TestCase):
    def test_build_weights_and_structural_degree(self):
        nodes = [{"id": "a", "type": "concept", "body": "x", "confidence": 1.0,
                  "created_by": "manual", "created_at": "", "title": "A"},
                 {"id": "b", "type": "repo", "body": "", "confidence": 0.5,
                  "created_by": "manual", "created_at": "", "title": "B"},
                 {"id": "c", "type": "person", "body": "", "confidence": 1.0,
                  "created_by": "manual", "created_at": "", "title": "C"}]
        links = [{"source": "a", "target": "b", "rel": "depends_on", "weight": 1.0},
                 {"source": "a", "target": "c", "rel": "mentions", "weight": 1.0}]
        g = analyze.build_graph(_g(nodes, links))
        self.assertEqual(g["adj"]["a"]["b"], 1.0)        # structural -> 1.0
        self.assertEqual(g["adj"]["a"]["c"], 0.25)       # mentions -> 0.25
        self.assertEqual(g["adj"]["b"]["a"], 1.0)        # undirected
        self.assertEqual(g["sd"]["a"], 1)                # only b is structural
        self.assertEqual(g["sin"]["b"], 1)               # a -> b is demand on b
        self.assertEqual(g["sin"]["c"], 0)               # mentions don't count as demand
        self.assertEqual(analyze.weighted_degree(g)["a"], 1.25)

    def test_max_incident_not_sum(self):
        nodes = [{"id": "a", "title": "A"}, {"id": "b", "title": "B"}]
        links = [{"source": "a", "target": "b", "rel": "mentions", "weight": 1.0},
                 {"source": "a", "target": "b", "rel": "relates_to", "weight": 1.0}]
        g = analyze.build_graph(_g(nodes, links))
        self.assertEqual(g["adj"]["a"]["b"], 1.0)        # MAX(0.25, 1.0), not 1.25

    def test_hub_stoplist_is_dominant_partof_sink(self):
        nodes = [{"id": x, "title": x} for x in ("root", "p1", "p2", "other")]
        links = [{"source": "p1", "target": "root", "rel": "part_of", "weight": 1.0},
                 {"source": "p2", "target": "root", "rel": "part_of", "weight": 1.0},
                 {"source": "other", "target": "p1", "rel": "part_of", "weight": 1.0}]
        g = analyze.build_graph(_g(nodes, links))
        self.assertEqual(g["hub_stoplist"], {"root"})


class AdamicAdarTest(unittest.TestCase):
    def _star(self):
        # a and b each connect to shared concept hubs z1..z3 (structural), not to each other
        nodes = [{"id": i, "type": "concept", "title": i}
                 for i in ("a", "b", "z1", "z2", "z3")]
        links = []
        for z in ("z1", "z2", "z3"):
            links.append({"source": "a", "target": z, "rel": "relates_to", "weight": 1.0})
            links.append({"source": "b", "target": z, "rel": "relates_to", "weight": 1.0})
        return analyze.build_graph({"nodes": nodes, "links": links})

    def test_surfaces_nonadjacent_pair(self):
        cand = analyze.adamic_adar(self._star(), min_common=3)
        self.assertEqual(cand[0][0], "a")
        self.assertEqual(cand[0][1], "b")
        self.assertEqual(cand[0][3], 3)            # 3 common neighbors
        self.assertGreater(cand[0][2], 0)

    def test_min_common_filters(self):
        self.assertEqual(analyze.adamic_adar(self._star(), min_common=4), [])

    def test_guard_drops_person_only_support(self):
        # a,b (repos) share exactly 3 PERSON neighbors -> raw AA surfaces it, guard drops it
        link = lambda s, t: {"source": s, "target": t, "rel": "relates_to", "weight": 1.0}
        nodes = [{"id": "a", "type": "repo", "title": "a"},
                 {"id": "b", "type": "repo", "title": "b"}] + \
                [{"id": f"p{i}", "type": "person", "title": f"p{i}"} for i in range(3)]
        links = []
        for i in range(3):
            links += [link("a", f"p{i}"), link("b", f"p{i}")]
        g = analyze.build_graph({"nodes": nodes, "links": links})
        raw = analyze.adamic_adar(g, min_common=3)
        self.assertTrue(raw)                        # raw surfaces it
        self.assertEqual(analyze.guard_candidates(g, raw), [])   # guard drops it


class RwrTest(unittest.TestCase):
    def test_closer_node_ranks_higher_and_excludes(self):
        # seed - near - far  (a chain); near must outrank far; hub excluded
        nodes = [{"id": i, "type": "concept", "title": i}
                 for i in ("seed", "near", "far", "hub")]
        link = lambda s, t: {"source": s, "target": t, "rel": "relates_to", "weight": 1.0}
        g = analyze.build_graph({"nodes": nodes,
            "links": [link("seed", "near"), link("near", "far"), link("seed", "hub")]})
        ranked = analyze.rwr(g, ["seed"], exclude={"hub"})
        ids = [r[0] for r in ranked]
        self.assertNotIn("seed", ids)
        self.assertNotIn("hub", ids)
        self.assertLess(ids.index("near"), ids.index("far"))

    def test_empty_seeds(self):
        g = analyze.build_graph({"nodes": [{"id": "a", "title": "a"}], "links": []})
        self.assertEqual(analyze.rwr(g, ["missing"]), [])


class FrontierTest(unittest.TestCase):
    def _g(self, nodes, links=None):
        return analyze.build_graph({"nodes": nodes, "links": links or []})

    def test_stub_outranks_complete_node(self):
        g = self._g([
            {"id": "s", "type": "stub", "body": "", "title": "S", "created_by": "wiki:x"},
            {"id": "full", "type": "concept", "body": "x" * 500, "title": "F",
             "confidence": 1.0, "created_by": "manual"},
            {"id": "other", "type": "concept", "title": "other"},
        ], [{"source": "full", "target": "s", "rel": "mentions"},
            {"source": "other", "target": "s", "rel": "mentions"}])
        # give the stub two mentions so it's not junk-pruned
        scored = dict((nid, sc) for nid, sc, _ in analyze.frontier_scores(g))
        self.assertIn("s", scored)
        self.assertGreater(scored["s"], scored.get("full", 0))

    def test_refuted_node_excluded(self):
        g = self._g([{"id": "r", "type": "concept", "body": "REFUTED: bad idea",
                      "title": "R", "confidence": 0.3, "created_by": "manual"}])
        self.assertEqual(analyze.frontier_scores(g), [])

    def test_capture_dev_artifact_routed_out(self):
        g = self._g([{"id": "d", "type": "design", "body": "x" * 10, "title": "D",
                      "created_by": "capture:mindmap", "confidence": 1.0}])
        self.assertEqual(analyze.frontier_scores(g), [])

    def test_junk_placeholder_stub_pruned(self):
        g = self._g([{"id": "node-id", "type": "stub", "body": "", "title": "node-id"}])
        self.assertEqual(analyze.frontier_scores(g), [])
