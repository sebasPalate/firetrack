"""FIRMS Area API client.

Design constraints that shape this module (verified 2026-11-14):

* ``DAY_RANGE`` is capped at 5 days, so any longer span must be chunked.
* A ``MAP_KEY`` allows 5000 transactions per 10 minutes, and roughly one
  transaction per day requested, so the throttle counts transactions rather
  than requests.
* Responses are cached on disk, which makes ingestion resumable: a crashed run
  never re-downloads a window it already has.
* Sensor coverage differs and VIIRS S-NPP ended on 2026-11-02, so coverage is
  declared per source instead of assumed.
"""

from __future__ import annotations

import time
from collections import deque
from dataclasses import dataclass, field
from datetime import date, timedelta
from pathlib import Path

BASE_URL = "https://firms.modaps.eosdis.nasa.gov/api/area/csv"
MAX_DAY_RANGE = 5
DEFAULT_TRANSACTION_BUDGET = 4500  # documented limit is 5000 / 10 min
DEFAULT_WINDOW_SECONDS = 600

#: First date with data per source. ``None`` as end means "still producing".
SOURCE_COVERAGE: dict[str, tuple[date, date | None]] = {
    "MODIS_SP": (date(2000, 11, 1), None),
    "VIIRS_SNPP_SP": (date(2012, 1, 20), date(2026, 11, 2)),
    "VIIRS_NOAA20_SP": (date(2018, 4, 1), None),
    "VIIRS_NOAA21_SP": (date(2023, 3, 1), None),
}


class FirmsError(RuntimeError):
    """Raised when the API returns something that is not a hotspot CSV."""


def chunk_date_range(
    start: date, end: date, max_days: int = MAX_DAY_RANGE
) -> list[tuple[date, date]]:
    """Split an inclusive range into contiguous, non-overlapping windows.

    Each window is ``(first_day, last_day)`` and covers at most ``max_days``
    days. The union of all windows is exactly ``start..end`` with no gaps and no
    overlap, which is what the ``DATE`` + ``DAY_RANGE`` request shape requires.
    """
    if not 1 <= max_days <= MAX_DAY_RANGE:
        raise ValueError(f"max_days must be between 1 and {MAX_DAY_RANGE}, got {max_days}")
    if start > end:
        raise ValueError(f"start {start} is after end {end}")

    windows: list[tuple[date, date]] = []
    cursor = start
    step = timedelta(days=max_days - 1)
    while cursor <= end:
        window_end = min(cursor + step, end)
        windows.append((cursor, window_end))
        cursor = window_end + timedelta(days=1)
    return windows


def format_bbox(bbox: tuple[float, float, float, float]) -> str:
    """Format ``(west, south, east, north)`` the way the API expects it."""
    west, south, east, north = bbox
    if not (-180 <= west < east <= 180 and -90 <= south < north <= 90):
        raise ValueError(f"invalid bbox {bbox}; expected west,south,east,north")
    return ",".join(f"{value:g}" for value in (west, south, east, north))


def area_url(
    map_key: str,
    source: str,
    bbox: tuple[float, float, float, float],
    window_start: date,
    day_range: int,
) -> str:
    """Build one Area API request URL.

    ``day_range`` is expressed as days covered, so a single-day window passes 1.
    """
    return (
        f"{BASE_URL}/{map_key}/{source}/{format_bbox(bbox)}"
        f"/{day_range}/{window_start.isoformat()}"
    )


class TransactionBudget:
    """Rolling-window throttle measured in API transactions."""

    def __init__(
        self,
        budget: int = DEFAULT_TRANSACTION_BUDGET,
        window_seconds: float = DEFAULT_WINDOW_SECONDS,
        clock=time.monotonic,
        sleep=time.sleep,
    ) -> None:
        self.budget = budget
        self.window_seconds = window_seconds
        self._clock = clock
        self._sleep = sleep
        self._events: deque[float] = deque()

    def acquire(self, transactions: int = 1) -> None:
        if transactions > self.budget:
            raise ValueError(
                f"request needs {transactions} transactions, budget is {self.budget}"
            )
        while True:
            now = self._clock()
            while self._events and now - self._events[0] >= self.window_seconds:
                self._events.popleft()
            if len(self._events) + transactions <= self.budget:
                self._events.extend([now] * transactions)
                return
            wait = self.window_seconds - (now - self._events[0]) + 0.05
            self._sleep(max(wait, 0.05))

    def used(self) -> int:
        return len(self._events)


def looks_like_hotspot_csv(text: str) -> bool:
    """True when the payload is a hotspot table rather than an error message."""
    first_line = text.lstrip().splitlines()[0] if text.strip() else ""
    return first_line.lower().startswith("latitude")


@dataclass
class FirmsClient:
    """Caches one CSV per (source, region, window start) on disk."""

    map_key: str
    cache_dir: Path
    budget: TransactionBudget = field(default_factory=TransactionBudget)
    session: object | None = None
    timeout: float = 60.0
    max_retries: int = 3
    sleep=time.sleep

    def __post_init__(self) -> None:
        if self.session is None:
            import requests  # imported lazily so the tests stay dependency-free

            self.session = requests.Session()
        self.cache_dir = Path(self.cache_dir)

    def cache_path(self, source: str, region: str, window_start: date) -> Path:
        return self.cache_dir / source / region / f"{window_start.isoformat()}.csv"

    def fetch_window(
        self,
        source: str,
        region: str,
        bbox: tuple[float, float, float, float],
        window_start: date,
        days: int,
    ) -> Path:
        """Fetch one window, honouring the cache and the transaction budget."""
        path = self.cache_path(source, region, window_start)
        if path.exists():
            return path

        url = area_url(self.map_key, source, bbox, window_start, days)
        last_error = "no attempt was made"
        for attempt in range(self.max_retries):
            self.budget.acquire(days)
            response = self.session.get(url, timeout=self.timeout)
            if response.status_code == 200:
                if not looks_like_hotspot_csv(response.text):
                    raise FirmsError(
                        f"{source} {region} {window_start}: API returned "
                        f"{response.text.strip()[:200]!r}"
                    )
                path.parent.mkdir(parents=True, exist_ok=True)
                path.write_text(response.text, encoding="utf-8", newline="")
                return path
            last_error = f"HTTP {response.status_code}: {response.text.strip()[:200]}"
            if response.status_code in {429, 500, 502, 503, 504}:
                self.sleep(2**attempt)
                continue
            break
        raise FirmsError(f"{source} {region} {window_start}: {last_error}")

    def fetch_range(
        self,
        source: str,
        region: str,
        bbox: tuple[float, float, float, float],
        start: date,
        end: date,
    ) -> list[Path]:
        """Fetch every window of an inclusive range, clamped to sensor coverage."""
        coverage_start, coverage_end = SOURCE_COVERAGE.get(source, (start, None))
        start = max(start, coverage_start)
        if coverage_end is not None:
            end = min(end, coverage_end)
        if start > end:
            return []

        paths = []
        for window_start, window_end in chunk_date_range(start, end):
            days = (window_end - window_start).days + 1
            paths.append(self.fetch_window(source, region, bbox, window_start, days))
        return paths
