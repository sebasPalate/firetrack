"""Timed probe: is the Area API fast enough for our schedule?

Run this as soon as you have a MAP_KEY. It answers the one question the whole
planning hangs on: how long does one year of one sensor take for one AOI.

    python -m pipeline.ingest --dry-run --region chaco --source MODIS_SP --from 2020-01-01 --to 2020-12-31
    python scripts/check_firms.py --region chaco --source MODIS_SP --year 2020

The script only reads. It writes nothing except the usual ingest cache.
"""

from __future__ import annotations

import argparse
import csv
import io
import json
import sys
import time
from datetime import date
from pathlib import Path

REPO_ROOT = Path(__file__).resolve().parent.parent
sys.path.insert(0, str(REPO_ROOT))

from pipeline.env import load_env, require_map_key  # noqa: E402
from pipeline.firms import (  # noqa: E402
    SOURCE_COVERAGE,
    FirmsClient,
    FirmsError,
    chunk_date_range,
)

REGIONS_PATH = REPO_ROOT / "data" / "regions.json"
DEFAULT_CACHE = REPO_ROOT / "data" / "raw"


def load_regions() -> dict[str, dict]:
    payload = json.loads(REGIONS_PATH.read_text(encoding="utf-8"))
    return {region["id"]: region for region in payload["regions"]}


def count_rows(path: Path) -> int:
    text = path.read_text(encoding="utf-8")
    if not text.strip():
        return 0
    return max(len(list(csv.reader(io.StringIO(text)))) - 1, 0)


def main() -> int:
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--region", required=True, help="region id from data/regions.json")
    parser.add_argument("--source", default="MODIS_SP", choices=sorted(SOURCE_COVERAGE))
    parser.add_argument("--year", type=int, required=True)
    parser.add_argument("--cache-dir", type=Path, default=DEFAULT_CACHE)
    args = parser.parse_args()

    load_env()
    map_key = require_map_key()

    regions = load_regions()
    if args.region not in regions:
        print(f"unknown region {args.region!r}; known: {sorted(regions)}", file=sys.stderr)
        return 2
    region = regions[args.region]
    bbox = tuple(region["bbox"])

    start = date(args.year, 1, 1)
    end = date(args.year, 12, 31)
    windows = chunk_date_range(start, end)

    print(f"region     : {region['name']} {bbox}")
    print(f"source     : {args.source}")
    print(f"range      : {start} .. {end}")
    print(f"windows    : {len(windows)} (of at most 5 days each)")
    print(f"transactions: ~{sum((b - a).days + 1 for a, b in windows)} of 5000 per 10 min")
    print()

    client = FirmsClient(map_key=map_key, cache_dir=args.cache_dir)
    started = time.perf_counter()
    rows = 0
    bytes_total = 0
    failures = 0

    for index, (window_start, window_end) in enumerate(windows, start=1):
        days = (window_end - window_start).days + 1
        try:
            path = client.fetch_window(args.source, args.region, bbox, window_start, days)
        except FirmsError as exc:
            failures += 1
            print(f"[{index}/{len(windows)}] FAIL {window_start} -> {exc}")
            continue
        rows += count_rows(path)
        bytes_total += path.stat().st_size
        if index % 10 == 0 or index == len(windows):
            elapsed = time.perf_counter() - started
            rate = index / elapsed if elapsed else 0
            print(
                f"[{index}/{len(windows)}] {window_start} rows={rows} "
                f"elapsed={elapsed:.1f}s rate={rate:.1f} req/s"
            )

    elapsed = time.perf_counter() - started
    if failures == len(windows):
        print("\nevery window failed: check the MAP_KEY and the source name")
        return 1

    print()
    print(f"elapsed    : {elapsed:.1f}s for {len(windows)} windows")
    print(f"rows       : {rows}")
    print(f"bytes      : {bytes_total / 1e6:.2f} MB")
    print(f"throughput : {len(windows) / elapsed:.2f} windows/s" if elapsed else "")

    full_record_days = sum(
        (b - a).days + 1 for a, b in chunk_date_range(*_record_span(args.source))
    )
    projection = full_record_days / elapsed if elapsed and rows else 0
    print(f"\nprojection : ~{projection / 60:.0f} min for the full {args.source} record")
    print("             (multiply by the number of regions you plan to cover)")
    print(f"cache      : {args.cache_dir / args.source / args.region}")
    return 0


def _record_span(source: str) -> tuple[date, date]:
    coverage_start, coverage_end = SOURCE_COVERAGE[source]
    return coverage_start, coverage_end or date.today()


if __name__ == "__main__":
    raise SystemExit(main())
