#!/usr/bin/env python3
"""Deterministic constellation layout for the mindgap brag video.

Bakes node coords (scattered + settled), cluster assignment, and edges into a
JS file so the composition needs no runtime randomness (GSAP determinism rule).
"""
import json, math, random

random.seed(7)  # deterministic

W, H = 1920, 1080
# graph area inset
X0, X1, Y0, Y1 = 230, 1690, 150, 940

TYPE_COLORS = {
    "concept": "#57c7a4", "definition": "#a78bfa", "software": "#5aa9e6",
    "repo": "#f4a261", "page": "#e9c46a", "paper": "#e76f51",
    "person": "#f28ab2", "team": "#9ae65a", "stub": "#5b6663",
}

# 3 communities, centroids spread across the frame
CENTROIDS = {
    0: (640, 430),   # knowledge graphs (left-upper)
    1: (1320, 380),  # embedding pipelines (right-upper)
    2: (980, 760),   # ML platform (lower-center)
}
CLUSTER_LABELS = {0: "knowledge graphs", 1: "embedding pipelines", 2: "ML platform"}
CLUSTER_HUE = {0: "#57c7a4", 1: "#a78bfa", 2: "#5aa9e6"}

# nodes: (id, type, community, base_degree_weight)
NODES = [
    # community 0 — knowledge graphs
    ("knowledge-graph", "concept", 0, 6),
    ("org-roam", "software", 0, 3),
    ("wiki-links", "definition", 0, 3),
    ("graph-embeddings", "paper", 0, 4),
    ("mindgap", "repo", 0, 5),
    # community 1 — embedding pipelines
    ("embedding-pipelines", "concept", 1, 5),
    ("sentence-transformers", "software", 1, 4),
    ("vector-database", "concept", 1, 3),
    ("retrieval-augmentation", "paper", 1, 4),
    ("a-researcher", "person", 1, 2),
    # community 2 — ML platform
    ("ml-platform", "team", 2, 5),
    ("feature-store", "software", 2, 3),
    ("model-registry", "repo", 2, 3),
    ("louvain-clustering", "paper", 2, 4),
    ("metadata-page", "page", 2, 2),
    ("force-layout", "definition", 2, 3),
]

# edges within + a few bridges (src, dst)
EDGES = [
    # community 0
    ("mindgap", "knowledge-graph"), ("mindgap", "wiki-links"), ("mindgap", "org-roam"),
    ("knowledge-graph", "graph-embeddings"), ("knowledge-graph", "org-roam"),
    ("wiki-links", "knowledge-graph"),
    # community 1
    ("embedding-pipelines", "sentence-transformers"), ("embedding-pipelines", "vector-database"),
    ("embedding-pipelines", "retrieval-augmentation"), ("sentence-transformers", "vector-database"),
    ("retrieval-augmentation", "a-researcher"),
    # community 2
    ("ml-platform", "feature-store"), ("ml-platform", "model-registry"),
    ("ml-platform", "louvain-clustering"), ("feature-store", "metadata-page"),
    ("louvain-clustering", "force-layout"), ("force-layout", "ml-platform"),
    # bridges between communities
    ("graph-embeddings", "embedding-pipelines"),
    ("louvain-clustering", "knowledge-graph"),
    ("ml-platform", "embedding-pipelines"),
]

idx = {n[0]: i for i, n in enumerate(NODES)}

# ---- settled positions: jitter around centroid then relax ----
pos = []
for nid, typ, comm, deg in NODES:
    cx, cy = CENTROIDS[comm]
    ang = random.uniform(0, 2 * math.pi)
    r = random.uniform(40, 175)
    pos.append([cx + r * math.cos(ang), cy + r * math.sin(ang)])

adj = [[] for _ in NODES]
for s, d in EDGES:
    adj[idx[s]].append(idx[d]); adj[idx[d]].append(idx[s])

# light relaxation: repulsion (all pairs) + springs (edges) + centroid pull
for _ in range(420):
    fx = [0.0] * len(NODES); fy = [0.0] * len(NODES)
    for i in range(len(NODES)):
        for j in range(i + 1, len(NODES)):
            dx = pos[i][0] - pos[j][0]; dy = pos[i][1] - pos[j][1]
            d2 = dx * dx + dy * dy + 0.01
            f = 32000.0 / d2
            d = math.sqrt(d2)
            ux, uy = dx / d, dy / d
            fx[i] += f * ux; fy[i] += f * uy
            fx[j] -= f * ux; fy[j] -= f * uy
    for s, dd in EDGES:
        i, j = idx[s], idx[dd]
        dx = pos[j][0] - pos[i][0]; dy = pos[j][1] - pos[i][1]
        d = math.sqrt(dx * dx + dy * dy) + 0.01
        target = 165.0
        f = (d - target) * 0.018
        ux, uy = dx / d, dy / d
        fx[i] += f * ux; fy[i] += f * uy
        fx[j] -= f * ux; fy[j] -= f * uy
    for i, (nid, typ, comm, deg) in enumerate(NODES):
        cx, cy = CENTROIDS[comm]
        fx[i] += (cx - pos[i][0]) * 0.012
        fy[i] += (cy - pos[i][1]) * 0.012
    for i in range(len(NODES)):
        pos[i][0] += max(-18, min(18, fx[i]))
        pos[i][1] += max(-18, min(18, fy[i]))
        pos[i][0] = max(X0, min(X1, pos[i][0]))
        pos[i][1] = max(Y0, min(Y1, pos[i][1]))

# ---- scattered start positions: uniform spread, deterministic, no edges shown ----
scatter = []
for i in range(len(NODES)):
    scatter.append([random.uniform(X0 + 40, X1 - 40), random.uniform(Y0 + 30, Y1 - 30)])

# degree for sizing
degree = [len(adj[i]) for i in range(len(NODES))]

nodes_out = []
for i, (nid, typ, comm, deg) in enumerate(NODES):
    nodes_out.append({
        "id": nid, "type": typ, "color": TYPE_COLORS[typ], "comm": comm,
        "deg": degree[i],
        "r": round(8 + degree[i] * 2.1, 1),
        "sx": round(scatter[i][0], 1), "sy": round(scatter[i][1], 1),
        "x": round(pos[i][0], 1), "y": round(pos[i][1], 1),
    })

edges_out = [{"s": idx[s], "d": idx[d]} for s, d in EDGES]

# community hull points (settled) + centroid label anchor
comms_out = []
for c in (0, 1, 2):
    members = [i for i, n in enumerate(NODES) if n[2] == c]
    xs = [pos[i][0] for i in members]; ys = [pos[i][1] for i in members]
    comms_out.append({
        "id": c, "label": CLUSTER_LABELS[c], "color": CLUSTER_HUE[c],
        "members": members,
        "cx": round(sum(xs) / len(xs), 1), "cy": round(sum(ys) / len(ys), 1),
        "minx": round(min(xs), 1), "maxx": round(max(xs), 1),
        "miny": round(min(ys), 1), "maxy": round(max(ys), 1),
    })

data = {"w": W, "h": H, "nodes": nodes_out, "edges": edges_out, "comms": comms_out}
out = "window.GRAPH = " + json.dumps(data, separators=(",", ":")) + ";\n"
with open("brag-output/composition/graph-data.js", "w") as f:
    f.write(out)
print("nodes", len(nodes_out), "edges", len(edges_out), "comms", len(comms_out))
print("sample settled:", nodes_out[4]["id"], nodes_out[4]["x"], nodes_out[4]["y"])
