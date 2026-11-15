"""Minimal .env loader.

Kept dependency-free on purpose. No credential is needed anywhere in the
pipeline: the FIRMS data comes from a public mirror.
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
