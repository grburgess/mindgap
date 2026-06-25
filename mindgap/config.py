"""Path config: PACKAGE assets (ship with code) vs USER DATA (per-user, outside repo).

PACKAGE assets (inside the mindgap/ package): web_dir(), seed_path(), loops_dir().
USER DATA (~/.mindgap, created on demand): data_dir(), db_path(), snapshots_dir().
Env: MINDGAP_HOME (whole data dir) > ~/.mindgap; MINDGAP_DB overrides the db file.
"""
import os
from pathlib import Path

PKG_DIR = Path(__file__).resolve().parent          # .../mindgap/


def web_dir() -> Path:
    return PKG_DIR / "web"


def seed_path() -> Path:
    return PKG_DIR / "seed.json"


def loops_dir() -> Path:
    return PKG_DIR / "loops"


def data_dir() -> Path:
    d = Path(os.environ["MINDGAP_HOME"]) if os.environ.get("MINDGAP_HOME") else Path.home() / ".mindgap"
    d.mkdir(parents=True, exist_ok=True)
    return d


def db_path() -> Path:
    p = Path(os.environ["MINDGAP_DB"]) if os.environ.get("MINDGAP_DB") else data_dir() / "mindgap.db"
    p.parent.mkdir(parents=True, exist_ok=True)
    return p


def snapshots_dir() -> Path:
    d = data_dir() / "snapshots"
    d.mkdir(parents=True, exist_ok=True)
    return d


def frontier_path() -> Path:
    return data_dir() / "frontier.json"
