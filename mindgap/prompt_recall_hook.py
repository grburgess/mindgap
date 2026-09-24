"""UserPromptSubmit hook: recall graph nodes that match the words of the PROMPT.

SessionStart recall (recall_hook.py) only knows the folder, and keeps the newest
matches. The 2026-09-24 bench showed what that misses: in one busy project a closed
decision had 49 newer folder matches ahead of it, and a
global learning ranked 24th of the global set, so neither ever reached a
session that asked about exactly that. This hook ranks by the question instead.

Reads {session_id, cwd, prompt} on stdin; prints a short digest to stdout
(Claude Code adds UserPromptSubmit stdout as context). No LLM, direct DB read,
always exits 0; empty output when nothing clears the bar.
"""
import json
import re
import sys

from . import activity, capture, config, db
from .recall_hook import GENERIC_TOKENS, _line, tokens_from_cwd

STOPWORDS = {
    "the", "and", "for", "are", "but", "not", "you", "all", "any", "can", "had", "her",
    "was", "one", "our", "out", "has", "his", "how", "its", "may", "new", "now", "old",
    "see", "two", "way", "who", "did", "get", "got", "let", "put", "say", "she", "too",
    "use", "what", "when", "where", "which", "why", "with", "this", "that", "these",
    "those", "from", "have", "into", "just", "like", "look", "looks", "make", "more",
    "most", "much", "need", "only", "over", "some", "such", "than", "then", "them",
    "they", "there", "their", "very", "want", "were", "will", "would", "could", "should",
    "about", "after", "again", "being", "does", "doing", "done", "each", "here", "also",
    "ever", "every", "good", "high", "low", "many", "same", "well", "add", "yes",
    "please", "thanks", "hello", "hey", "okay", "think", "know", "tell", "show", "give",
    "take", "help", "work", "really", "still", "thing", "things", "something", "anything",
    "we", "is", "it", "to", "of", "in", "on", "my", "me", "do", "be", "an", "or", "at",
}
PREFIX = "## mindgap recall (auto, prompt)"
# Nodes that settle a question. The bench's miss was exactly one of these: a closed
# decision outranked by newer, chattier notes that merely shared the project name.
VERDICT_TYPES = {"decision", "gotcha", "verified-fact", "rule", "general-rule", "constraint"}


def _stem(w: str) -> str:
    """Crude suffix strip so inflates/inflated/inflating meet. Deliberately dumb:
    it only has to make two forms of one word collide, never to be a lemmatiser."""
    for suf in ("ations", "ation", "ings", "ing", "edly", "ed", "es", "ly", "s"):
        if len(w) - len(suf) >= 4 and w.endswith(suf):
            return w[: -len(suf)]
    return w


def prompt_tokens(prompt: str) -> list:
    """Distinct content words of the prompt, in order."""
    out = []
    for w in re.findall(r"[a-z0-9][a-z0-9_-]*", (prompt or "").lower()):
        w = w.strip("-_")
        if len(w) >= 3 and w not in STOPWORDS and w not in GENERIC_TOKENS and w not in out:
            out.append(w)
    return out


def _fields(n: dict):
    """Stemmed words of title, tags and id: where a match means something. Body is
    left out on purpose, as in recall_hook: body hits on common words are noise."""
    split = lambda s: {_stem(w) for w in re.findall(r"[a-z0-9]+", (s or "").lower())}
    return (split(n.get("title")), split(" ".join(n.get("tags") or [])), split(n["id"]))


def rank(conn, prompt: str, cwd: str, limit: int) -> list:
    toks = prompt_tokens(prompt)
    if len(toks) < 2:
        return []
    stems = {t: _stem(t) for t in toks}
    here = {_stem(t) for t in tokens_from_cwd(cwd)}
    pool = {}
    for t in toks:
        for n in db.search(conn, q=stems[t], limit=300):
            pool.setdefault(n["id"], n)
    scored = []
    for n in pool.values():
        title, tags, ident = _fields(n)
        hit = [t for t in toks if stems[t] in title or stems[t] in tags or stems[t] in ident]
        if not hit:
            continue
        score = sum(2.0 if stems[t] in title else 1.5 if stems[t] in tags else 1.0 for t in hit)
        if here & (title | tags | ident):
            score += 0.5                        # the folder you are in breaks ties
        if n.get("type") in VERDICT_TYPES:
            score += 1.0                        # a ruling beats one more loose word match
        scored.append((len(hit), score, n.get("updated_at") or "", n))
    # A node must carry at least two of the prompt's words -- always. A one-content-word
    # prompt ("do the fix", "is it standalone?") matches whatever shares that word, which
    # is noise; the old "unless the prompt has only one" exception injected exactly that.
    scored = [s for s in scored if s[0] >= 2]
    scored.sort(key=lambda s: (s[1], s[2]), reverse=True)
    return [s[3] for s in scored[:limit]]


def main(stdin_text=None) -> int:
    raw = stdin_text if stdin_text is not None else sys.stdin.read()
    try:
        hook_input = json.loads(raw) if raw.strip() else {}
    except json.JSONDecodeError:
        return 0
    cfg = capture.load_config()
    rcfg = cfg["recall"]
    if not rcfg.get("enabled") or not rcfg.get("prompt", True):
        return 0
    cwd = hook_input.get("cwd", "")
    if capture._dir_listed(cwd, cfg.get("denylist_dirs", [])) or not config.db_path().exists():
        return 0
    try:
        conn = db.connect()
        try:
            hits = rank(conn, hook_input.get("prompt", ""), cwd, rcfg.get("max_prompt", 6))
        finally:
            conn.close()
    except Exception:
        return 0   # best-effort; never block a prompt
    if not hits:
        return 0
    try:
        sid = hook_input.get("session_id") or ""
        # own actor: usage_hook credits only "recall:<sid>", and must keep doing so
        activity.record("read", [n["id"] for n in hits],
                        actor=f"prompt-recall:{sid}" if sid else "prompt-recall")
    except Exception:
        pass
    print("\n".join([PREFIX, "Nodes matching the words of this prompt:", *[_line(n) for n in hits]]))
    return 0


if __name__ == "__main__":
    sys.exit(main())
