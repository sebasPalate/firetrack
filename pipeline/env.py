"""Minimal .env loader.

Kept dependency-free on purpose: the pipeline must run before anyone has
installed anything beyond `requests`.
"""

from __future__ import annotations

import os
from pathlib import Path

REPO_ROOT = Path(__file__).resolve().parent.parent


def load_env(path: Path | None = None) -> None:
    """Load ``KEY=value`` pairs from ``.env`` without overriding real env vars."""
    env_path = path or REPO_ROOT / ".env"
    if not env_path.exists():
        return
    for raw_line in env_path.read_text(encoding="utf-8").splitlines():
        line = raw_line.strip()
        if not line or line.startswith("#") or "=" not in line:
            continue
        key, value = line.split("=", 1)
        key = key.strip()
        value = value.strip().strip('"').strip("'")
        os.environ.setdefault(key, value)


def require_map_key() -> str:
    """Return the FIRMS key or explain exactly how to get one."""
    key = os.environ.get("FIRMS_MAP_KEY", "").strip()
    if not key:
        raise SystemExit(
            "FIRMS_MAP_KEY is not set.\n"
            "  1. Open https://firms.modaps.eosdis.nasa.gov/api/map_key/\n"
            "  2. Enter an email you can read right now and submit the form\n"
            "  3. Copy the key from the email into .env as FIRMS_MAP_KEY=...\n"
            "  .env is gitignored; never commit the key."
        )
    return key
