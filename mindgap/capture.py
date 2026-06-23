"""Knowledge-capture config + deterministic pre-gate (no LLM).

The SessionEnd hook (capture_hook.py) uses these to decide cheaply whether to
spawn the headless capture subagent. The domain (what counts as on-topic) is
config, so this engine is domain-agnostic; mindgap ships a disabled-by-default
capture.json with an empty domain as package data.
"""
import copy
import json
import os
from pathlib import Path

from . import config

DEFAULTS = {
    "enabled": False,
    "domain": {"description": "", "keywords": []},
    "denylist_dirs": [],
    "allowlist_dirs": [],
    "min_transcript_bytes": 2000,
    "capture": {"model": "claude-haiku-4-5", "timeout_s": 180,
                "max_nodes_per_session": 15, "default_confidence": 0.6},
    "lint": {"stale_days": 60, "stale_below_confidence": 0.7},
}


def preset_path() -> Path:
    """Packaged domain preset shipped with the code (disabled, empty domain)."""
    return config.PKG_DIR / "capture.json"


def config_path() -> Path:
    """User capture config: $MINDGAP_CAPTURE_CONFIG or <data_dir>/capture.json."""
    env = os.environ.get("MINDGAP_CAPTURE_CONFIG")
    return Path(env) if env else config.data_dir() / "capture.json"


def _merge(base, override):
    out = copy.deepcopy(base)
    for k, v in override.items():
        if isinstance(v, dict) and isinstance(out.get(k), dict):
            out[k] = _merge(out[k], v)
        else:
            out[k] = v
    return out


def load_config(path=None) -> dict:
    """DEFAULTS deep-merged under the user capture.json. Missing/invalid -> DEFAULTS."""
    p = Path(path) if path else config_path()
    cfg = copy.deepcopy(DEFAULTS)
    if p.exists():
        try:
            cfg = _merge(DEFAULTS, json.loads(p.read_text()))
        except (json.JSONDecodeError, OSError):
            cfg = copy.deepcopy(DEFAULTS)
    ov = os.environ.get("MINDGAP_CAPTURE_ENABLED")
    if ov is not None:
        cfg["enabled"] = ov not in ("0", "false", "")
    return cfg


import os as _os
import time as _time


def keyword_hits(text: str, keywords) -> bool:
    low = text.lower()
    return any(k.lower() in low for k in keywords)


def _expand(p: str) -> str:
    return str(Path(_os.path.expanduser(p)).resolve(strict=False))


def _dir_listed(cwd: str, dirs) -> bool:
    if not cwd:
        return False
    c = _expand(cwd)
    for d in dirs:
        d = _expand(d)
        if c == d or c.startswith(d + _os.sep):
            return True
    return False


def pregate(transcript_path, cwd, cfg, env=None):
    """Deterministic gate. Returns (should_capture, reason). No LLM, no spawn."""
    env = env if env is not None else _os.environ
    if not cfg.get("enabled"):
        return False, "disabled"
    if env.get("MINDGAP_CAPTURE") == "1":
        return False, "self-capture-session"
    if _dir_listed(cwd, cfg.get("denylist_dirs", [])):
        return False, "denylisted-dir"
    allow = cfg.get("allowlist_dirs", [])
    if allow and not _dir_listed(cwd, allow):
        return False, "not-in-allowlist"
    p = Path(transcript_path) if transcript_path else None
    if not p or not p.exists():
        return False, "no-transcript"
    try:
        text = p.read_text(errors="ignore")
    except OSError:
        return False, "unreadable-transcript"
    if len(text.encode("utf-8", "ignore")) < cfg.get("min_transcript_bytes", 0):
        return False, "transcript-too-small"
    if not keyword_hits(text, cfg.get("domain", {}).get("keywords", [])):
        return False, "no-domain-keywords"
    return True, "ok"


def _lock_default() -> Path:
    return config.data_dir() / "capture.lock"


def acquire_lock(path=None, ttl_s=300) -> bool:
    """Best-effort single-flight. Reclaims a lock older than ttl_s (crash backstop)."""
    lp = Path(path) if path else _lock_default()
    now = _time.time()
    if lp.exists():
        try:
            if now - lp.stat().st_mtime < ttl_s:
                return False
        except OSError:
            return False
    try:
        lp.write_text(str(int(now)))
        return True
    except OSError:
        return False


def release_lock(path=None) -> None:
    lp = Path(path) if path else _lock_default()
    try:
        lp.unlink()
    except OSError:
        pass
