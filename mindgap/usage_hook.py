"""SessionEnd hook: bump `used:`/`last:` on the ledger rows this session was shown.

Why this exists. The loop-system protocol already says to bump a ledger row's
usage counter at RESUME when the row informs a decision — and it measurably does
not happen: 42 of 60 rows sat at `used:0`, which left the only countable
promote trigger unarmed and the whole ledger->skill path at zero throughput for
two months. Every other link in that chain was likewise a prose instruction, and
prose instructions in this system are followed at roughly chance. Hooks are not:
the SessionStart recall hook, the SessionEnd capture hook and the PostToolUse
paper detector all fire every time. So the counter moves here, mechanically,
instead of being asked for.

How it stays honest rather than merely non-zero:

* It bumps ONLY what the recall hook actually injected. `recall_hook` records
  its digest as one `activity` event with `actor="recall"`, so the last such
  event IS this session's injection — a deterministic record, not a guess about
  what got "used".
* It bumps only after `capture.pregate()` accepts the session, reusing the
  same substantive/on-domain test the capture hook gates on. A two-message
  session bumps nothing.
* It is deliberately a slight OVER-count: "was shown to a session that then did
  real work" is weaker than "changed a decision". That is the intended trade —
  an over-counted signal that exists beats a perfectly-specified one that is
  never written. Anything reading the counter should treat it as evidence of
  exposure, not of influence.

Never blocks session exit: every failure path returns 0.
"""
import json
import re
import sys
from datetime import date

from . import activity, capture, config

ROW_RE = re.compile(r"^\d{4}-\d{2}-\d{2} · ")
MAP_RE = re.compile(r"map:([A-Za-z0-9._-]+)")

# The usage counter is the `used:<n> last:<date>` PAIR near the row's end. Match
# the pair, not a bare `used:` — a row whose prose happens to mention "used:9"
# would otherwise have the prose rewritten and the real counter left at zero
# (caught by test_only_the_first_counter_is_rewritten). Of the matches, the
# rightmost is the suffix.
USAGE_RE = re.compile(r"used:(\d+) last:\d{4}-\d{2}-\d{2}")


def recalled_ids() -> set:
    """Node ids the recall hook injected into THIS session.

    recall fires once per session, so the most recent `actor="recall"` event is
    ours. Older events belong to earlier sessions and must not be re-bumped.
    """
    events = [e for e in activity.tail() if e.get("actor") == "recall"]
    if not events:
        return set()
    return {i for i in events[-1].get("ids", []) if isinstance(i, str)}


def bump_line(line: str, today: str) -> str:
    """Increment `used:` and set `last:` on one ledger row.

    Untouched when the row carries no `used:<n> last:<date>` pair — legacy rows
    predating the suffix keep their shape rather than having a counter invented
    for them, and a malformed half-suffix is likewise left for a human.
    """
    matches = list(USAGE_RE.finditer(line))
    if not matches:
        return line
    m = matches[-1]                      # the suffix, not a prose mention
    return line[:m.start()] + f"used:{int(m.group(1)) + 1} last:{today}" + line[m.end():]


def apply(text: str, ids: set, today: str):
    """Return (new_text, bumped_row_count). A row is bumped when its `map:` id is
    one of the recalled ids — the ledger row and its mirrored node are the same
    learning, so recalling the node is being shown the row."""
    if not ids:
        return text, 0
    out, n = [], 0
    for line in text.splitlines():
        if ROW_RE.match(line):
            m = MAP_RE.search(line)
            if m and m.group(1) in ids:
                new = bump_line(line, today)
                if new != line:
                    n += 1
                line = new
        out.append(line)
    return "\n".join(out) + ("\n" if text.endswith("\n") else ""), n


def main(stdin_text=None) -> int:
    raw = stdin_text if stdin_text is not None else sys.stdin.read()
    if not raw.strip():
        return 0
    try:
        hook_input = json.loads(raw)
    except json.JSONDecodeError:
        return 0
    try:
        cfg = capture.load_config()
        # Same substantive/on-domain bar the capture hook uses. A trivial session
        # was still shown the digest, but being shown it is not usage.
        ok, _reason = capture.pregate(
            hook_input.get("transcript_path"), hook_input.get("cwd", ""), cfg)
        if not ok:
            return 0
        ids = recalled_ids()
        if not ids:
            return 0
        path = config.ledger_path()
        if not path.exists():
            return 0
        text = path.read_text(encoding="utf-8")
        new, n = apply(text, ids, date.today().isoformat())
        if n:
            tmp = path.with_suffix(path.suffix + ".tmp")
            tmp.write_text(new, encoding="utf-8")
            tmp.replace(path)          # atomic: never leave a half-written ledger
    except Exception:
        return 0                        # usage accounting must never break exit
    return 0


if __name__ == "__main__":
    sys.exit(main())
