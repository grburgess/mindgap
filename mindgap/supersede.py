"""M2 automatic supersession: deterministic candidates -> detached LLM judge -> edges.

    candidates()  no LLM. Pairs {newer, older, reasons} among nodes added/updated
                  since the watermark (supersede_state.watermark), then advances it.
    judge()       writes the pairs (both node texts) to <data_dir>/supersede/<run>/,
                  spawns a detached supervisor (like capture_hook) that runs
                  `claude -p --model sonnet` per batch with only Read(<batch file>)
                  and the run's own write command pre-approved, kills it after
                  timeout_s, and releases supersede.lock.
    write()       INSERT OR IGNORE `supersedes` edges (src=newer, dst=older,
                  created_by='supersede:<run>'); never INSERT OR REPLACE, so an
                  existing edge (any author) is left exactly as it was.
    revert(run)   deletes exactly the edges with created_by='supersede:<run>'.

Heuristics (a pair is a candidate when ANY fires; `reasons` lists all that fired):
  anchor-title  the pair shares a neighbour (anchor, e.g. a project node) of degree
                <= MAX_ANCHOR_DEGREE, and normalised titles (lowercased; dates,
                versions, ticket keys, punctuation dropped) have word-level difflib ratio
                >= TITLE_RATIO.
  status        both bodies carry a dated STATUS line ("STATUS ... YYYY-MM-DD"),
                they share an anchor, their latest STATUS dates differ, and title
                ratio >= STATUS_TITLE_RATIO (looser than anchor-title).
  ticket        both titles carry the same ticket key (ABC-123; >= 2 digits).
  id-stem       ids are equal once a trailing version/date suffix is stripped
                (-v2, -v2-1, -r3, -2026-10-03, -20261003); stem >= 6 chars.
  Ticket/stem groups larger than MAX_GROUP are skipped as non-discriminative.
Newer = later (updated_at, created_at, id); the judge may swap a pair. Stub nodes and
pairs already joined by a supersedes edge (either direction) are never candidates.
The watermark is consumed when candidates are computed, so pairs from a judge that
timed out are only revisited by a `--all` backfill. Config: capture.json "supersede"
{after_capture, model, timeout_s (per batch), batch_pairs}.
"""
import difflib
import json
import os
import re
import secrets
import shlex
import shutil
import subprocess
import sys
import time
from collections import defaultdict
from datetime import datetime, timezone
from pathlib import Path

from . import capture, config

REL = "supersedes"
MAX_ANCHOR_DEGREE = 200
TITLE_RATIO = 0.8
STATUS_TITLE_RATIO = 0.4
MAX_GROUP = 12
BODY_CHARS = 1500
ID_RE = re.compile(r"^[A-Za-z0-9][A-Za-z0-9._-]{0,79}$")

TICKET_RE = re.compile(r"\b[A-Z][A-Z0-9]{1,9}-\d{2,}\b")
DATE_RE = r"\d{4}-\d{2}-\d{2}"
STATUS_RE = re.compile(r"\bSTATUS\b[^\n]{0,40}?(" + DATE_RE + ")")
SUFFIX_RE = re.compile(r"(?:-v\d+(?:[-.]\d+)*|-r\d+|-" + DATE_RE + r"|-\d{8})+$")
_NORM_DROP = re.compile(
    r"\b" + DATE_RE + r"\b|\b\d{8}\b|\bv\d+(?:\.\d+)*\b|\b[a-z][a-z0-9]{1,9}-\d{2,}\b")


def _now():
    return datetime.now(timezone.utc).isoformat(timespec="seconds")


def norm_title(title):
    """Word tuple; difflib ratio runs on words (char-level is ~10x too slow at 85k pairs)."""
    return tuple(re.findall(r"[a-z0-9]+", _NORM_DROP.sub(" ", title.lower())))


def id_stem(node_id):
    stem = SUFFIX_RE.sub("", node_id)
    return stem if stem != node_id and len(stem) >= 6 else None


def status_date(body):
    dates = STATUS_RE.findall(body or "")
    return max(dates) if dates else None


def _key(n):
    return (n["updated_at"], n["created_at"], n["id"])


# ---- watermark -------------------------------------------------------------

def get_watermark(conn):
    row = conn.execute("SELECT value FROM supersede_state WHERE key='watermark'").fetchone()
    return row["value"] if row else ""


def set_watermark(conn, value):
    conn.execute("INSERT OR REPLACE INTO supersede_state(key,value) VALUES('watermark',?)",
                 (value,))
    conn.commit()


# ---- candidate generator ---------------------------------------------------

def _linked(conn):
    out = set()
    for r in conn.execute("SELECT src,dst FROM edges WHERE rel=?", (REL,)):
        out.add((r["src"], r["dst"]))
        out.add((r["dst"], r["src"]))
    return out


def candidates(conn, all_=False, advance=True):
    """Deterministic candidate pairs, sorted by #reasons then title ratio (desc)."""
    nodes = {r["id"]: dict(r) for r in conn.execute(
        "SELECT id,title,type,body,created_at,updated_at FROM nodes")}
    wm = "" if all_ else get_watermark(conn)
    new = {i for i, n in nodes.items() if n["updated_at"] > wm and n["type"] != "stub"}
    if advance and nodes:
        set_watermark(conn, max(n["updated_at"] for n in nodes.values()))
    if not new:
        return []
    ok = {i for i, n in nodes.items() if n["type"] != "stub"}
    linked = _linked(conn)

    nb = defaultdict(set)
    for r in conn.execute("SELECT src,dst FROM edges WHERE rel!=?", (REL,)):
        if r["src"] != r["dst"]:
            nb[r["src"]].add(r["dst"])
            nb[r["dst"]].add(r["src"])

    reasons = defaultdict(list)
    ratios = {}
    norm = {i: norm_title(nodes[i]["title"]) for i in ok}
    sm = difflib.SequenceMatcher(None)

    def ratio(a, b):
        p = (a, b) if a < b else (b, a)
        if p not in ratios:
            x, y = norm[p[0]], norm[p[1]]
            if not x or not y:
                ratios[p] = 0.0
            else:
                sm.set_seqs(x, y)
                r = sm.real_quick_ratio()
                if r >= STATUS_TITLE_RATIO:
                    r = sm.quick_ratio()
                if r >= STATUS_TITLE_RATIO:
                    r = sm.ratio()
                ratios[p] = r
        return ratios[p]

    def add(a, b, why):
        if a == b or a not in ok or b not in ok or (a, b) in linked:
            return
        p = (a, b) if a < b else (b, a)
        if why not in reasons[p]:
            reasons[p].append(why)

    # anchor-title + status: pairs (new, other) sharing a low-degree anchor
    status = {i: status_date(nodes[i]["body"]) for i in ok}
    seen = set()
    for n in new:
        for anchor in nb.get(n, ()):
            peers = nb[anchor]
            if len(peers) > MAX_ANCHOR_DEGREE:
                continue
            for m in peers:
                if m == n or m not in ok:
                    continue
                p = (n, m) if n < m else (m, n)
                if p in seen:
                    continue
                seen.add(p)
                r = ratio(n, m)
                if r >= TITLE_RATIO:
                    add(n, m, f"anchor-title:{anchor}:{r:.2f}")
                sa, sb = status[n], status[m]
                if sa and sb and sa != sb and r >= STATUS_TITLE_RATIO:
                    add(n, m, f"status:{min(sa, sb)}->{max(sa, sb)}")

    # ticket + id-stem: groups keyed by a shared token
    groups = defaultdict(set)
    for i in ok:
        for k in set(TICKET_RE.findall(nodes[i]["title"])):
            groups[("ticket", k)].add(i)
        s = id_stem(i)
        if s:
            groups[("id-stem", s)].add(i)
    for i in ok:  # an unsuffixed id that equals some stem joins that stem's group
        if ("id-stem", i) in groups:
            groups[("id-stem", i)].add(i)
    for (kind, k), members in groups.items():
        if len(members) < 2 or len(members) > MAX_GROUP or not (members & new):
            continue
        ms = sorted(members)
        for x in range(len(ms)):
            for y in range(x + 1, len(ms)):
                if ms[x] in new or ms[y] in new:
                    add(ms[x], ms[y], f"{kind}:{k}")

    out = []
    for (a, b), why in reasons.items():
        newer, older = (a, b) if _key(nodes[a]) > _key(nodes[b]) else (b, a)
        out.append({"newer": newer, "older": older, "reasons": why,
                    "title_ratio": round(ratio(a, b), 3)})
    out.sort(key=lambda c: (-len(c["reasons"]), -c["title_ratio"], c["newer"], c["older"]))
    return out


# ---- write / revert --------------------------------------------------------

def _run_row(conn, run_id):
    return conn.execute("SELECT * FROM supersede_runs WHERE run_id=?", (run_id,)).fetchone()


def record_run(conn, run_id, cands, status="judging"):
    conn.execute(
        "INSERT OR REPLACE INTO supersede_runs(run_id,created_at,status,candidates,written)"
        " VALUES(?,?,?,?,'[]')",
        (run_id, _now(), status, json.dumps([[c["newer"], c["older"]] for c in cands])))
    conn.commit()


def write(conn, run_id, pairs):
    """INSERT OR IGNORE judged pairs. Pairs outside the run's recorded candidates,
    unknown nodes, self-loops and pairs already linked either way are skipped."""
    if not ID_RE.match(run_id or ""):
        raise ValueError(f"bad run id: {run_id!r}")
    row = _run_row(conn, run_id)
    allowed = None
    if row is not None and json.loads(row["candidates"]):
        allowed = {frozenset(p) for p in json.loads(row["candidates"])}
    by, now = f"supersede:{run_id}", _now()
    written, skipped = [], []
    for p in pairs:
        newer, older = p.get("newer"), p.get("older")
        why = None
        if not newer or not older or newer == older:
            why = "bad-pair"
        elif allowed is not None and frozenset((newer, older)) not in allowed:
            why = "not-a-candidate"
        elif conn.execute("SELECT COUNT(*) c FROM nodes WHERE id IN (?,?)",
                          (newer, older)).fetchone()["c"] != 2:
            why = "unknown-node"
        elif conn.execute("SELECT 1 FROM edges WHERE src=? AND dst=? AND rel=?",
                          (older, newer, REL)).fetchone():
            why = "reverse-exists"
        if why is None:
            cur = conn.execute(
                "INSERT OR IGNORE INTO edges(src,dst,rel,weight,created_by,created_at)"
                " VALUES(?,?,?,1.0,?,?)", (newer, older, REL, by, now))
            why = None if cur.rowcount == 1 else "exists"
        if why:
            skipped.append({"newer": newer, "older": older, "why": why})
        else:
            written.append({"newer": newer, "older": older, "reason": p.get("reason", "")})
    if row is None:
        conn.execute("INSERT INTO supersede_runs(run_id,created_at,status,candidates,written)"
                     " VALUES(?,?,'written','[]',?)", (run_id, now, json.dumps(written)))
    else:
        prev = json.loads(row["written"])
        conn.execute("UPDATE supersede_runs SET status='written', written=? WHERE run_id=?",
                     (json.dumps(prev + written), run_id))
    conn.commit()
    return {"run_id": run_id, "written": written, "skipped": skipped}


def revert(conn, run_id):
    """Delete exactly this run's edges; nothing else."""
    if not ID_RE.match(run_id or ""):
        raise ValueError(f"bad run id: {run_id!r}")
    cur = conn.execute("DELETE FROM edges WHERE created_by=?", (f"supersede:{run_id}",))
    conn.execute("UPDATE supersede_runs SET status='reverted' WHERE run_id=?", (run_id,))
    conn.commit()
    return {"run_id": run_id, "deleted": cur.rowcount}


# ---- judge (detached, like capture_hook) -----------------------------------

PROMPT = (
    "You judge whether newer knowledge-graph nodes SUPERSEDE older ones. Read {path}: a "
    "JSON list of candidate pairs, each with a 'newer' and an 'older' node (id, title, "
    "type, dates, body). A pair is a supersession only when the newer node replaces the "
    "older one's claim, status or version for the SAME subject, so a reader should "
    "prefer the newer and treat the older as outdated. Same topic, complementary facts, "
    "parts of a series or different subjects are NOT supersession. If the older one "
    "actually replaces the newer, swap them. Then run exactly once:\n"
    "{cmd} --pairs '<JSON list of {{\"newer\": id, \"older\": id, \"reason\": short "
    "text}}>'\nUse [] when no pair qualifies. No single quotes inside reasons. Run no "
    "other command."
)


def write_cmd(run_id):
    return (f"{shlex.quote(sys.executable)} -m mindgap supersede write "
            f"--run-id {run_id}")


def allowed_tools(path, run_id):
    # `//` prefix = absolute path in a permission rule (see capture_hook).
    return [f"Read(/{path})", f"Bash({write_cmd(run_id)} --pairs:*)"]


def _lock_path():
    return config.data_dir() / "supersede.lock"


def log(line):
    try:
        with open(config.data_dir() / "supersede.log", "a") as f:
            f.write(time.strftime("%Y-%m-%dT%H:%M:%S ") + line + "\n")
    except OSError:
        pass


def _node_text(conn, node_id):
    r = conn.execute("SELECT id,title,type,body,created_at,updated_at FROM nodes WHERE id=?",
                     (node_id,)).fetchone()
    d = dict(r)
    d["body"] = d["body"][:BODY_CHARS]
    return d


def new_run_id():
    return time.strftime("%Y%m%dT%H%M%SZ", time.gmtime()) + "-" + secrets.token_hex(2)


def judge(conn, run_id=None, all_=False, claude=None, cfg=None):
    """Compute candidates and spawn the detached judge. Returns a status dict.
    Checks claude + the lock BEFORE consuming the watermark."""
    cfg = cfg or capture.load_config()["supersede"]
    run_id = run_id or new_run_id()
    if not ID_RE.match(run_id):
        raise ValueError(f"bad run id: {run_id!r}")
    claude = claude or shutil.which("claude")
    if not claude:
        return {"run_id": run_id, "status": "skip=no-claude"}
    timeout_s = cfg["timeout_s"]
    batch = max(1, cfg["batch_pairs"])
    # The supervisor re-touches the lock per batch, so a TTL just past one batch's
    # kill is only a crash backstop.
    if not capture.acquire_lock(_lock_path(), ttl_s=timeout_s + 30):
        return {"run_id": run_id, "status": "skip=locked"}
    try:
        cands = candidates(conn, all_=all_)
        if not cands:
            capture.release_lock(_lock_path())
            return {"run_id": run_id, "status": "no-candidates", "pairs": 0}
        record_run(conn, run_id, cands)
        rdir = config.data_dir() / "supersede" / run_id
        rdir.mkdir(parents=True, exist_ok=True)
        cmds = []
        for k in range(0, len(cands), batch):
            path = rdir / f"candidates-{k // batch}.json"
            path.write_text(json.dumps([
                {"newer": _node_text(conn, c["newer"]), "older": _node_text(conn, c["older"]),
                 "reasons": c["reasons"]} for c in cands[k:k + batch]], indent=1))
            cmds.append([claude, "-p", PROMPT.format(path=path, cmd=write_cmd(run_id)),
                         "--allowedTools", *allowed_tools(path, run_id),
                         "--model", cfg["model"]])
        proc = spawn({"cmds": cmds, "timeout_s": timeout_s, "run_id": run_id,
                      "lock": str(_lock_path())})
    except BaseException:
        capture.release_lock(_lock_path())
        raise
    log(f"run={run_id} pairs={len(cands)} batches={len(cmds)} pid={proc.pid}")
    return {"run_id": run_id, "status": "spawned", "pairs": len(cands),
            "batches": len(cmds), "pid": proc.pid}


def spawn(job):
    pkg_parent = str(Path(__file__).resolve().parents[1])
    env = dict(os.environ, MINDGAP_CAPTURE="1",  # child session never self-captures
               PYTHONPATH=pkg_parent + os.pathsep + os.environ.get("PYTHONPATH", ""))
    return subprocess.Popen(
        [sys.executable, "-m", "mindgap.supersede", "--supervise", json.dumps(job)],
        stdin=subprocess.DEVNULL, stdout=subprocess.DEVNULL,
        stderr=subprocess.DEVNULL, start_new_session=True, env=env)


def supervise(job):
    """Run each batch's judge child, kill each after timeout_s, always release the lock."""
    try:
        with open(config.data_dir() / "supersede-child.log", "a") as out:
            for i, cmd in enumerate(job["cmds"]):
                try:
                    os.utime(job["lock"])
                except OSError:
                    pass
                child = subprocess.Popen(cmd, stdin=subprocess.DEVNULL,
                                         stdout=out, stderr=subprocess.STDOUT)
                try:
                    status = child.wait(timeout=job["timeout_s"])
                except subprocess.TimeoutExpired:
                    child.kill()
                    child.wait()
                    status = "timeout"
                log(f"run={job['run_id']} batch={i} exit={status}")
    finally:
        capture.release_lock(job["lock"])
    return 0


if __name__ == "__main__":
    if len(sys.argv) == 3 and sys.argv[1] == "--supervise":
        sys.exit(supervise(json.loads(sys.argv[2])))
