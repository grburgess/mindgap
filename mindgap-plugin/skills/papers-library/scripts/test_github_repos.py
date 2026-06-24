import unittest
import github_repos as G

REPOS = [
    {"name": "popsynth", "owner": "grburgess", "description": "population synthesis"},
    {"name": "cv", "owner": "grburgess", "description": "my cv"},  # too short → no auto-link
    {"name": "dotfiles", "owner": "grburgess", "description": "configs"},
]
PAPERS = [
    {"id": "arxiv-2107-12404", "title": "popsynth: A generic population synthesis", "type": "paper"},
    {"id": "doi-x", "title": "Unrelated study of cv stars", "type": "paper"},
]

class TestRepos(unittest.TestCase):
    def test_repo_node(self):
        n = G.repo_node(REPOS[0])
        self.assertEqual((n["id"], n["type"]), ("repo-popsynth", "repo"))
        self.assertEqual(n["urls"][0]["url"], "https://github.com/grburgess/popsynth")
        self.assertIn("papers-library", n["tags"])
    def test_auto_links_exact_token_only(self):
        edges = G.auto_links(REPOS, PAPERS)
        self.assertIn(("repo-popsynth", "arxiv-2107-12404", "implements"),
                      {(e["src"], e["dst"], e["rel"]) for e in edges})
        # 'cv' is < 4 chars → must NOT link despite appearing in a title
        self.assertFalse(any(e["src"] == "repo-cv" for e in edges))
    def test_build_anchors_every_repo_to_hub(self):
        p = G.build(REPOS, PAPERS)
        hub_edges = {e["src"] for e in p["edges"] if e["dst"] == "grburgess" and e["rel"] == "relates_to"}
        self.assertEqual(hub_edges,
            {"repo-popsynth", "repo-cv", "repo-dotfiles", "repo-threeml", "repo-astromodels"})
        # flagships are also present as nodes
        node_ids = {n["id"] for n in p["nodes"]}
        self.assertIn("repo-threeml", node_ids)
        self.assertIn("repo-astromodels", node_ids)
        self.assertEqual(p["created_by"], "skill:papers-library")

if __name__ == "__main__":
    unittest.main()
