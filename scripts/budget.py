"""How long does ingestion take? Print the transaction budget per sensor.

Every day requested costs roughly one transaction, and a MAP_KEY allows 5000
transactions per 10 minutes. This is the hard floor for any ingest plan, no
matter how many workers run.

    python scripts/budget.py
"""

from __future__ import annotations

import sys
from datetime import date
from pathlib import Path

REPO_ROOT = Path(__file__).resolve().parent.parent
sys.path.insert(0, str(REPO_ROOT))

from pipeline.firms import SOURCE_COVERAGE  # noqa: E402

TODAY = date.today()
TRANSACTIONS_PER_WINDOW = 5000
WINDOW_MINUTES = 10


def main() -> int:
    per_region = 0
    print(f"{'source':<18}{'days':>8}{'minutes at the ceiling':>26}")
    print("-" * 52)
    for source, (start, end) in SOURCE_COVERAGE.items():
        days = (min(end or TODAY, TODAY) - start).days + 1
        per_region += days
        print(f"{source:<18}{days:>8}{days / TRANSACTIONS_PER_WINDOW * WINDOW_MINUTES:>24.1f}")

    print("-" * 52)
    print(f"{'one region, all sensors':<26}{per_region:>8} transactions")
    print()
    print(f"{'regions':>8}{'transactions':>14}{'throttled hours':>18}")
    for count in (1, 3, 6, 9):
        transactions = per_region * count
        hours = transactions / TRANSACTIONS_PER_WINDOW * WINDOW_MINUTES / 60
        print(f"{count:>8}{transactions:>14}{hours:>18.1f}")
    print()
    print("This is wall clock spent waiting on the rate limit, not developer time.")
    print("It runs in the background while the UI is being built, but it caps scope.")
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
