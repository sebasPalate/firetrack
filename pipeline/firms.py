"""Read NASA FIRMS detections from the public Portolan GeoParquet mirror and cache them locally.

This is the only ingest path. No MAP_KEY, no rate limit, no 5-day window.

The mirror (https://source.coop/portolan-mirrors/firms-catalog) republishes every
FIRMS detection, MODIS (Terra, Aqua) and VIIRS (Suomi-NPP, NOAA-20, NOAA-21),
science-quality (``quality = 'sp'``) and near-real-time (``'nrt'``) rows, as one
GeoParquet file per year. Facts verified on 2026-11-15:

* Path: ``detections/year=YYYY/detections.parquet``. Never glob
  ``year=*/*.parquet``: the same folders also hold aggregate files with another
  schema.
* The FIRMS columns are carried verbatim. ``latitude``/``longitude`` live in
  ``geometry``, satellite codes are expanded (``Aqua``, ``Suomi-NPP``...), and
  ``confidence_pct`` is the MODIS 0-100 value as an integer (NULL for VIIRS).
* Nothing is harmonized upstream: counts still jump when a satellite joins,
  and ``type`` is NULL for every near-real-time row.
* Rows are sorted along a Hilbert curve in ~100k-row row groups with a
  bounding box per row group, so a box filter reads only the row groups that
  touch the area (2016: 2 of 248 for central Spain).
* Cross-check against the official NASA FIRMS country files for central Spain
  (-5.5, 38.5, -1.0, 42.3): 2016 Aqua 262, Terra 282, Suomi-NPP 1,891 and 2022
  Aqua 488, Terra 526, Suomi-NPP 2,892, NOAA-20 3,682, identical in both.

One cached row = one detection with every confidence level, so the confidence
filter (``CONF_SQL``) is applied and measured in the harmonization step instead
of being baked in here.

    python -m pipeline.firms                     # every region in data/regions.json
    python -m pipeline.firms iberia chaco        # some regions
    python -m pipeline.firms iberia --from-year 2016 --to-year 2016

The layout (remote GeoParquet read with DuckDB, a per-year cache and a measured
sensor-days table) follows Kiln Watch (Team Off The Binary, NASA Space Apps 2026,
https://github.com/Aalvee-Aarham/kiln-watch). The code is our own.
"""

from __future__ import annotations

import argparse
import datetime as dt
import os
import sys
import threading
import time
from pathlib import Path

from pipeline.env import load_env
from pipeline.regions import envelopes, load_regions

load_env()  # optional .env overrides (FIRETRACK_FIRMS_BASE, FIRETRACK_DATA_DIR); no credentials

BASE = os.environ.get(
    "FIRETRACK_FIRMS_BASE", "https://data.source.coop/portolan-mirrors/firms-catalog/detections"
).rstrip("/")
DATA = Path(os.environ.get("FIRETRACK_DATA_DIR", Path(__file__).resolve().parents[1] / "data"))
CACHE = DATA / "cache"
FIRST_YEAR = 2000
LIVE_TTL_S = 6 * 3600  # refetch the running year after 6 h: near-real-time rows arrive hourly
WORKERS = 8
ATTEMPTS = 3

#: First day with data per sensor, as published by FIRMS. Last days are never
#: hard-coded: they are measured from the data in ``sensor_days()``.
SENSOR_START = {
    "MODIS": "2000-11-01",
    "VIIRS_SNPP": "2012-01-20",
    "VIIRS_NOAA20": "2018-04-01",
    "VIIRS_NOAA21": "2024-01-17",
}
SENSORS = list(SENSOR_START)

#: Confidence filter for the harmonized series: drop VIIRS 'l' and MODIS below 30.
#: The two scales are never crosswalked (no official equivalence exists).
CONF_SQL = "((sensor = 'MODIS' AND confidence_pct >= 30) OR (sensor <> 'MODIS' AND confidence <> 'l'))"

_lock = threading.Lock()


# ---------------------------------------------------------------- pure helpers


def current_year() -> int:
    return dt.datetime.now(dt.timezone.utc).year


def year_url(year: int, base: str | None = None) -> str:
    return f"{base or BASE}/year={year}/detections.parquet"


def sql_literal(text: str) -> str:
    """Quote a path or URL for DuckDB."""
    return "'" + str(text).replace("'", "''") + "'"


def bbox_predicate(bbox) -> str:
    """SQL filter that keeps detections inside the box (needs the spatial extension)."""
    parts = [
        f"ST_Intersects(geometry, ST_MakeEnvelope({w:.6f}, {s:.6f}, {e:.6f}, {n:.6f}))"
        for w, s, e, n in envelopes(bbox)
    ]
    return parts[0] if len(parts) == 1 else "(" + " OR ".join(parts) + ")"


def year_select(bbox, year: int, base: str | None = None) -> str:
    """The query that reads one year of one region from the mirror."""
    return (
        "SELECT acq_datetime, acq_date, sensor, satellite, daynight, quality, version, type, "
        "confidence, confidence_pct, round(ST_Y(geometry), 4) AS lat, round(ST_X(geometry), 4) AS lon, "
        f"frp, scan, track FROM read_parquet({sql_literal(year_url(year, base))}) "
        f"WHERE {bbox_predicate(bbox)}"
    )


def plan_years(from_year: int | None = None, to_year: int | None = None, this_year: int | None = None) -> list[int]:
    """Inclusive list of years, clamped to the record (2000 .. this year)."""
    this_year = this_year or current_year()
    start, end = max(from_year or FIRST_YEAR, FIRST_YEAR), min(to_year or this_year, this_year)
    if start > end:
        raise ValueError(f"empty year range: {start}..{end}")
    return list(range(start, end + 1))


def cache_path(region_id: str, year: int, cache: Path | None = None) -> Path:
    return Path(cache or CACHE) / region_id / f"{year}.parquet"


def _fresh(path: Path, year: int, *, this_year: int | None = None, now: float | None = None) -> bool:
    """A finished year never changes once cached; the running year expires after LIVE_TTL_S."""
    path = Path(path)
    if not path.exists():
        return False
    if year < (this_year or current_year()):
        return True
    return ((now if now is not None else time.time()) - path.stat().st_mtime) < LIVE_TTL_S


# ---------------------------------------------------------------- DuckDB I/O


def connect():
    """DuckDB connection able to read remote GeoParquet. The first call downloads the
    spatial and httpfs extensions, so it needs internet once."""
    import duckdb  # imported here so the tests stay dependency-free

    con = duckdb.connect()
    con.execute("INSTALL spatial; LOAD spatial; INSTALL httpfs; LOAD httpfs;")
    con.execute("SET http_retries = 6; SET http_retry_wait_ms = 2000; SET enable_http_metadata_cache = true;")
    return con


def _copy(con, select_sql: str, out: Path) -> None:
    """Write a query to Parquet atomically: a crash never leaves half a year cached."""
    out.parent.mkdir(parents=True, exist_ok=True)
    tmp = out.with_suffix(".tmp")
    con.execute(f"COPY ({select_sql}) TO {sql_literal(tmp.as_posix())} (FORMAT parquet, COMPRESSION zstd)")
    os.replace(tmp, out)


def fetch_year(con, bbox, year: int, out: Path) -> Path:
    """Cache one year of one region, retrying network errors."""
    for attempt in range(ATTEMPTS):
        try:
            _copy(con, year_select(bbox, year), out)
            return out
        except Exception:  # noqa: BLE001 - network errors come in many types
            if attempt == ATTEMPTS - 1:
                raise
            time.sleep(5 * (attempt + 1))
    return out


def fetch_region(region_id: str, bbox, progress=None, years: list[int] | None = None, con=None) -> Path:
    """Make sure every year is cached. ``progress(year, done, total)`` is called as years finish."""
    years = years or plan_years()
    con = con or connect()
    for i, year in enumerate(years):
        out = cache_path(region_id, year)
        if not _fresh(out, year):
            fetch_year(con, bbox, year, out)
        if progress:
            progress(year, i + 1, len(years))
    return CACHE / region_id


def sensor_days(refresh: bool = False, years: list[int] | None = None, con=None) -> Path:
    """Days on which each sensor delivered at least one detection anywhere on Earth.

    This is the observing-opportunity denominator: a month where a satellite flew
    only 10 of 30 days must not read as a quiet month. Launches, gaps and the end
    of Suomi-NPP come from the data instead of hard-coded dates. MODIS also gets
    one row per platform (MODIS_T = Terra, MODIS_A = Aqua), because Aqua only
    joined in July 2002. Only three columns of each global file are read.
    """
    path = DATA / "sensor_days.parquet"
    with _lock:
        if path.exists() and not refresh and (time.time() - path.stat().st_mtime) < LIVE_TTL_S:
            return path
        con = con or connect()
        parts = []
        for year in years or plan_years():
            part = DATA / "sensor_days" / f"sat-{year}.parquet"
            if refresh or not _fresh(part, year):
                _copy(con, f"SELECT DISTINCT sensor, satellite, acq_date FROM read_parquet({sql_literal(year_url(year))})", part)
            parts.append(sql_literal(part.as_posix()))
        files = "[" + ", ".join(parts) + "]"
        _copy(
            con,
            f"""SELECT DISTINCT sensor, acq_date FROM read_parquet({files})
                UNION SELECT DISTINCT 'MODIS_' || left(satellite, 1), acq_date FROM read_parquet({files})
                WHERE sensor = 'MODIS' ORDER BY 1, 2""",
            path,
        )
        return path


def summary(region_id: str, con=None) -> list[tuple]:
    """Detections per year and satellite in the local cache. Should already show the 2012 step."""
    folder = CACHE / region_id
    if not list(folder.glob("*.parquet")):
        return []
    con = con or connect()
    return con.execute(
        f"""SELECT year(acq_date), satellite, quality, count(*),
                   count(*) FILTER (WHERE type IN (1, 2, 3)), count(*) FILTER (WHERE type IS NULL)
            FROM read_parquet({sql_literal(folder.as_posix() + '/*.parquet')})
            GROUP BY ALL ORDER BY 1, 2, 3"""
    ).fetchall()


# ---------------------------------------------------------------- CLI


def main(argv: list[str] | None = None) -> int:
    from concurrent.futures import ThreadPoolExecutor

    parser = argparse.ArgumentParser(description="Cache FIRMS detections from the Portolan mirror")
    parser.add_argument("regions", nargs="*", help="region ids from data/regions.json (default: all)")
    parser.add_argument("--from-year", type=int)
    parser.add_argument("--to-year", type=int)
    parser.add_argument("--dry-run", action="store_true")
    args = parser.parse_args(argv)

    regions = load_regions()
    ids = args.regions or list(regions)
    unknown = [r for r in ids if r not in regions]
    if unknown:
        print(f"unknown region(s) {unknown}; known: {sorted(regions)}", file=sys.stderr)
        return 2
    years = plan_years(args.from_year, args.to_year)
    jobs = [(rid, y) for y in years for rid in ids if not _fresh(cache_path(rid, y), y)]

    print(f"source : {BASE}")
    print(f"regions: {', '.join(ids)}")
    print(f"years  : {years[0]}..{years[-1]}, {len(jobs)} region-year file(s) to fetch, cache {CACHE}")
    if args.dry_run:
        print("\nfirst query:\n  " + year_select(regions[ids[0]]["bbox"], years[0]))
        return 0

    # Requests are latency-bound (row-group pruning keeps the bytes small), so run several
    # (region, year) jobs at once on cursors of one connection, which share the metadata cache.
    t0 = time.time()
    db = connect()
    sensor_days(years=plan_years(), con=db)
    print(f"sensor days ready {time.time() - t0:.0f}s", flush=True)
    failed = []

    def one(job):
        rid, year = job
        try:
            fetch_year(db.cursor(), regions[rid]["bbox"], year, cache_path(rid, year))
            print(f"{rid} {year} {time.time() - t0:.0f}s", flush=True)
        except Exception as exc:  # noqa: BLE001
            failed.append(job)
            print(f"{rid} {year} FAILED: {str(exc)[:200]}", flush=True)

    with ThreadPoolExecutor(WORKERS) as pool:
        list(pool.map(one, jobs))

    for rid in ids:
        print(f"\n{rid}\n{'year':<6}{'satellite':<12}{'quality':<9}{'detections':>11}{'static':>8}{'untyped':>9}")
        for year, sat, quality, n, static, untyped in summary(rid, db):
            print(f"{year:<6}{sat:<12}{quality:<9}{n:>11}{static:>8}{untyped:>9}")
    if failed:
        print(f"\n{len(failed)} file(s) failed: {sorted(failed)}; rerun to retry only those", file=sys.stderr)
        return 1
    print(f"\ndone in {time.time() - t0:.0f}s")
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
