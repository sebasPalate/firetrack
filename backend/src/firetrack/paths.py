"""Where the repository is, for every module that reads or writes its files.

The package is installed in editable mode (``pip install -e backend``), so this
file stays at ``backend/src/firetrack/paths.py`` and the repository root is
three folders up. One definition here replaces a ``parents[n]`` count in each
module, which broke silently whenever a file moved.
"""

from pathlib import Path

REPO_ROOT = Path(__file__).resolve().parents[3]
