"""Open mindgap pages in iTerm2's built-in browser (MINDGAP_BROWSER=iterm).

iTerm2 ≥3.6 + its Browser Plugin can run a session as a web browser, isolated from the
system browser. There is no API to point a browser session at a URL, so we write a
dynamic profile (Profile Type = Web Browser, Initial URL = url) and open it via
AppleScript: a new window, or a split pane next to the calling session ($ITERM_SESSION_ID).
"""
import json
import os
import subprocess
import time
from pathlib import Path

PROFILE_DIR = Path.home() / "Library" / "Application Support" / "iTerm2" / "DynamicProfiles"


def enabled() -> bool:
    return os.environ.get("MINDGAP_BROWSER") == "iterm"


def _write_profile(url) -> str:
    """One file, overwritten per call; the URL is in the name so a not-yet-reloaded
    profile can't open a stale URL (AppleScript just fails until iTerm picks it up)."""
    name = f"mindgap {url}"
    PROFILE_DIR.mkdir(parents=True, exist_ok=True)
    (PROFILE_DIR / "mindgap.json").write_text(json.dumps({"Profiles": [
        {"Name": name, "Guid": "mindgap-browser", "Custom Command": "Browser", "Initial URL": url}]}))
    return name


def _script(name, session_uuid, direction="vertically"):
    if not session_uuid:
        return f'tell application "iTerm2" to create window with profile "{name}"'
    return f'''tell application "iTerm2"
  repeat with w in windows
    repeat with t in tabs of w
      repeat with s in sessions of t
        if unique id of s is "{session_uuid}" then
          tell s to split {direction} with profile "{name}"
          tell s to select
          return "ok"
        end if
      end repeat
    end repeat
  end repeat
  error "session not found"
end tell'''


def open_url(url, split=False) -> bool:
    """Open url in an iTerm2 browser session; split=True puts it beside the calling
    session — vertical split, or horizontal with MINDGAP_ITERM_SPLIT=horizontal
    (falls back to a new window outside iTerm2). False if iTerm2 never accepted it."""
    name = _write_profile(url)
    sid = os.environ.get("ITERM_SESSION_ID", "").partition(":")[2] if split else ""
    horizontal = os.environ.get("MINDGAP_ITERM_SPLIT") == "horizontal"
    script = _script(name, sid, "horizontally" if horizontal else "vertically")
    for _ in range(10):  # iTerm2 reloads DynamicProfiles asynchronously
        if subprocess.run(["osascript"], input=script, capture_output=True, text=True).returncode == 0:
            return True
        time.sleep(0.3)
    return False
