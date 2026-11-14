"""Ingest FIRMS hotspots for the configured regions.

    python -m pipeline.ingest --dry-run --region chaco --source MODIS_SP
    python -m pipeline.ingest --region chaco --source MODIS_SP --from 2000-11-01 --to 2026-06-30

The cache makes this resumable: rerunning after a crash only fetches what is
missing. Nothing here talks to the network unless it has to.
"""

from __future__ import annotations

import argparse
import json
import sys
from datetime import date
from pathlib import Path

from pipeline.env import load_env, require_map_key
from pipeline.firms import (
    SOURCE_COVERAGE,
    FirmsClient,
    FirmsError,
    chunk_date_range,
)

REPO_ROOT = Path(__file__).resolve().parent.parent
REGIONS_PATH = REPO_ROOT / "data" / "regions.json"
DEFAULT_CACHE = REPO_ROOT / "data" / "raw"


def load_regions() -> dict[str, dict]:
    payload = json.loads(REGIONS_PATH.read_text(encoding="utf-8"))
    return {region["id"]: region for region in payload["regions"]}


def resolve_span(source: str, start: date | None, end: date | None) -> tuple[date, date]:
    coverage_start, coverage_end = SOURCE_COVERAGE[source]
    span_start = max(start or coverage_start, coverage_start)
    span_end = min(end or date.today(), coverage_end or date.today())
    return span_start, span_end


def main(argv: list[str] | None = None) -> int:
    parser = argparse.ArgumentParser(description="Ingest FIRMS hotspots into data/raw")
    parser.add_argument("--region", required=True)
    parser.add_argument("--source", action="append", choices=sorted(SOURCE_COVERAGE))
    parser.add_argument("--from", dest="start", type=date.fromisoformat)
    parser.add_argument("--to", dest="end", type=date.fromisoformat)
    parser.add_argument("--cache-dir", type=Path, default=DEFAULT_CACHE)
    parser.add_argument("--dry-run", action="store_true")
    args = parser.parse_args(argv)

    regions = load_regions()
    if args.region not in regions:
        print(f"unknown region {args.region!r}; known: {sorted(regions)}", file=sys.stderr)
        return 2
    region = regions[args.region]
    bbox = tuple(region["bbox"])
    sources = args.source or list(SOURCE_COVERAGE)

    total_windows = 0
    total_days = 0
    plan: list[tuple[str, date, date]] = []
    for source in sources:
        span_start, span_end = resolve_span(source, args.start, args.end)
        if span_start > span_end:
            print(f"{source}: nothing to fetch {span_start} .. {span_end}")
            continue
        plan.append((source, span_start, span_end))
        days = (span_end - span_start).days + 1
        total_days += days
        total_windows += len(chunk_date_range(span_start, span_end))

    print(f"region  : {region['name']} {bbox}")
    for source, span_start, span_end in plan:
        print(f"  {source:<18} {span_start} .. {span_end}")
    print(f"windows : {total_windows}")
    print(f"days    : {total_days} (each day is roughly one transaction)")

    if args.dry_run:
        print("\ndry run: nothing was requested")
        return 0

    load_env()
    client = FirmsClient(map_key=require_map_key(), cache_dir=args.cache_dir)

    failures = 0
    for source, span_start, span_end in plan:
        print(f"\n{source}")
        for window_start, window_end in chunk_date_range(span_start, span_end):
            days = (window_end - window_start).days + 1
            try:
                client.fetch_window(source, args.region, bbox, window_start, days)
            except FirmsError as exc:
                failures += 1
                print(f"  FAIL {window_start}: {exc}", file=sys.stderr)
        print(f"  done, {client.budget.used()} transactions in the current window")

    if failures:
        print(f"\n{failures} window(s) failed; rerun to retry only those", file=sys.stderr)
        return 1
    print("\nall windows cached")
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
