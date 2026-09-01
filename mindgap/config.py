"""Path config: PACKAGE assets (ship with code) vs USER DATA (per-user, outside repo).

PACKAGE assets live inside the mindgap/ package dir, resolved from this file:
    PKG_DIR           the mindgap/ package directory
    web_dir()         -> mindgap/web
    seed_path()       -> mindgap/seed.json
    loops_dir()       -> mindgap/loops

USER DATA is per-user, outside the repo, created on demand:
    data_dir()        $MINDGAP_HOME if set, else ~/.mindgap
    db_path()         $MINDGAP_DB if set, else <data_dir>/mindgap.db
    snapshots_dir()   <data_dir>/snapshots

Migration source: legacy_data_dir() = the old repo data/ (file still named mindmap.db).
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


def legacy_data_dir() -> Path:
    """Where a pre-relocation source checkout kept its DB (repo-root data/)."""
    return PKG_DIR.parent / "data"


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


def activity_path() -> Path:
    return data_dir() / "activity.jsonl"
