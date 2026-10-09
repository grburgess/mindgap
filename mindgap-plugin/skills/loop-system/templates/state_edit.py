"""Safe STATE.md / GOAL.md section edits for loop-system SESSION END.

Why: a heading string like "## Superseded" also appears inside header comments,
so s.index("## X") can hit the comment, yield an empty slice, and
str.replace("", body) then splices body between EVERY character of the file
(fired 5x, lessons.md 2026-09-25..30). Every edit here anchors on a real
line-start heading, asserts exactly one match and a non-empty target, and
refuses to write a result that lost content it did not mean to remove.

Usage (python3, no deps):
    from state_edit import replace_section, append_to_section, replace_once
    replace_section("STATE.md", "Last session", "Session 3 of 5 · ...")
    append_to_section("STATE.md", "Iteration log", "- 3.1 · class:... · verdict: PASS")
    replace_once("STATE.md", "Loop status: running", "Loop status: complete 2026-09-30")
CLI self-test:  python3 state_edit.py --selftest
"""

from __future__ import annotations

import re
import sys


def _span(text: str, name: str) -> tuple[int, int]:
    """(start, end) of the BODY of section `## name`: after its heading line, up to the next line-start `## `."""
    hits = [m for m in re.finditer(rf"^## {re.escape(name)}[ \t]*$", text, re.M)]
    if len(hits) != 1:
        raise ValueError(
            f"heading '## {name}' matched {len(hits)} times at line start (need exactly 1)"
        )
    start = (
        text.index("\n", hits[0].end()) + 1
        if "\n" in text[hits[0].end() :]
        else len(text)
    )
    nxt = re.compile(r"^## ", re.M).search(text, start)
    return start, (nxt.start() if nxt else len(text))


def _write(path: str, old: str, new: str, removed: str) -> None:
    # sanity: the edit may only remove what it targeted (plus whitespace)
    if len(new) < len(old) - len(removed) - 2:
        raise ValueError("refusing to write: result lost content outside the target")
    with open(path, "w") as f:
        f.write(new)


def replace_section(path: str, name: str, body: str) -> None:
    """Replace everything under `## name` (heading kept) with `body`."""
    text = open(path).read()
    a, b = _span(text, name)
    new = text[:a] + body.rstrip("\n") + "\n\n" + text[b:]
    _write(path, text, new, text[a:b])


def append_to_section(path: str, name: str, line: str) -> None:
    """Append `line` as the last line of section `## name`."""
    text = open(path).read()
    a, b = _span(text, name)
    sec = text[a:b].rstrip("\n")
    new = text[:a] + (sec + "\n" if sec else "") + line.rstrip("\n") + "\n\n" + text[b:]
    _write(path, text, new, "")


def replace_once(path: str, old: str, new_s: str) -> None:
    """Replace a literal substring that must be non-empty and occur exactly once."""
    if not old:
        raise ValueError("refusing replace_once with an empty target")
    text = open(path).read()
    n = text.count(old)
    if n != 1:
        raise ValueError(f"target occurs {n} times (need exactly 1): {old[:60]!r}")
    _write(path, text, text.replace(old, new_s), old)


def _selftest() -> None:
    import os
    import tempfile

    doc = (
        "# t\n\nLoop status: running\n\n## Verified facts\n<!-- retract: move it to\n     ## Superseded) ... -->\n- f1\n\n"
        "## Iteration log\n- 1.1 · a\n\n## Last session\nold\n\n## Superseded\n<!-- Retracted -->\n"
    )
    fd, p = tempfile.mkstemp(suffix=".md")
    os.write(fd, doc.encode())
    os.close(fd)
    replace_section(p, "Last session", "new body")
    append_to_section(p, "Iteration log", "- 1.2 · b")
    replace_once(p, "Loop status: running", "Loop status: complete 2026-09-30")
    out = open(p).read()
    assert (
        "new body" in out
        and "old" not in out.split("## Last session")[1].split("## Superseded")[0]
    )
    assert "- 1.1 · a\n- 1.2 · b\n" in out
    assert "## Superseded) ..." in out and out.count("\n## Superseded\n") == 1
    for bad in (
        lambda: replace_once(p, "", "x"),
        lambda: replace_section(p, "Nope", "x"),
    ):
        try:
            bad()
            raise AssertionError("expected ValueError")
        except ValueError:
            pass
    os.remove(p)
    print("state_edit selftest OK")


if __name__ == "__main__":
    if "--selftest" in sys.argv:
        _selftest()
