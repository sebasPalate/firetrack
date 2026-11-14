"""Firetrack read-only analytics API.

Serves precomputed artifacts only. It never calls FIRMS at request time: the
Area API covers at most 5 days per request and 5000 transactions per 10 minutes,
which is incompatible with an interactive query.

Run from this directory:

    uvicorn main:app --reload

Artifacts consumed (produced by the pipeline, never written here):

    data/processed/calendar/{region}.parquet   one row per year+month
    data/processed/hotspots/{region}.parquet   unified detections
    data/processed/method.json                 calibration table + limitations
"""

from __future__ import annotations

import json
import os
from datetime import date
from pathlib import Path

import duckdb
from fastapi import FastAPI, HTTPException, Query
from fastapi.middleware.cors import CORSMiddleware
from fastapi.responses import PlainTextResponse

REPO_ROOT = Path(__file__).resolve().parents[2]
DATA_DIR = Path(os.environ.get("FIRETRACK_DATA_DIR", REPO_ROOT / "data"))
PROCESSED = DATA_DIR / "processed"
REGIONS_PATH = DATA_DIR / "regions.json"

app = FastAPI(
    title="Firetrack API",
    version="0.1.0",
    description="Harmonized MODIS + VIIRS burning activity calendar. Read-only.",
)

app.add_middleware(
    CORSMiddleware,
    allow_origins=[origin for origin in os.environ.get("ALLOWED_ORIGINS", "*").split(",")],
    allow_methods=["GET"],
    allow_headers=["*"],
)


def load_regions() -> dict[str, dict]:
    if not REGIONS_PATH.exists():
        raise HTTPException(503, f"missing {REGIONS_PATH.relative_to(REPO_ROOT)}")
    payload = json.loads(REGIONS_PATH.read_text(encoding="utf-8"))
    return {region["id"]: region for region in payload["regions"]}


def region_or_404(region_id: str) -> dict:
    regions = load_regions()
    if region_id not in regions:
        raise HTTPException(404, f"unknown region {region_id!r}; known: {sorted(regions)}")
    return regions[region_id]


def artifact(path: Path) -> Path:
    if not path.exists():
        raise HTTPException(
            503,
            f"missing artifact {path.relative_to(REPO_ROOT)}: run the pipeline for this region first",
        )
    return path


def query_rows(path: Path, sql_suffix: str = "", params: list | None = None) -> list[dict]:
    """Run a query against one Parquet file and return dicts.

    ``path`` is built from a whitelisted region id, never from raw user input.
    """
    con = duckdb.connect()
    try:
        cursor = con.execute(
            f"select * from read_parquet('{path.as_posix()}') {sql_suffix}",
            params or [],
        )
        columns = [column[0] for column in cursor.description]
        return [dict(zip(columns, row)) for row in cursor.fetchall()]
    finally:
        con.close()


@app.get("/health")
def health() -> dict:
    calendars = sorted(p.stem for p in (PROCESSED / "calendar").glob("*.parquet"))
    return {
        "status": "ok" if calendars else "no-artifacts",
        "regions_configured": len(load_regions()) if REGIONS_PATH.exists() else 0,
        "regions_ready": calendars,
        "has_method": (PROCESSED / "method.json").exists(),
    }


@app.get("/regions")
def regions() -> list[dict]:
    return list(load_regions().values())


@app.get("/calendar")
def calendar(
    region: str = Query(..., description="region id from data/regions.json"),
    start: date | None = None,
    end: date | None = None,
) -> dict:
    """Return the burning calendar as a month x year matrix plus anomalies."""
    config = region_or_404(region)
    path = artifact(PROCESSED / "calendar" / f"{region}.parquet")

    clauses, params = [], []
    if start:
        clauses.append("year * 100 + month >= ?")
        params.append(start.year * 100 + start.month)
    if end:
        clauses.append("year * 100 + month <= ?")
        params.append(end.year * 100 + end.month)
    where = f"where {' and '.join(clauses)}" if clauses else ""

    rows = sorted(
        query_rows(path, where, params),
        key=lambda row: (row["year"], row["month"]),
    )
    if not rows:
        raise HTTPException(404, "no data in the requested range")

    years = sorted({row["year"] for row in rows})
    by_month: dict[int, list[float]] = {}
    for row in rows:
        by_month.setdefault(row["month"], []).append(row["harmonized_index"])

    median_by_month = {
        month: _median(values) for month, values in sorted(by_month.items())
    }

    def matrix(key: str) -> list[list[float | None]]:
        index = {(row["year"], row["month"]): row.get(key) for row in rows}
        return [[index.get((year, month)) for year in years] for month in range(1, 13)]

    harmonized = matrix("harmonized_index")
    anomaly = [
        [
            None
            if value is None or not median_by_month.get(month)
            else round((value - median_by_month[month]) / median_by_month[month] * 100, 1)
            for year, value in zip(years, harmonized[month - 1])
        ]
        for month in range(1, 13)
    ]

    return {
        "region": config,
        "years": years,
        "months": list(range(1, 13)),
        "harmonized": harmonized,
        "raw_count": matrix("raw_count"),
        "median_by_month": median_by_month,
        "anomaly_pct": anomaly,
        "units": "harmonized activity index (not an absolute fire count)",
    }


@app.get("/detections", response_class=PlainTextResponse)
def detections(
    region: str = Query(...),
    start: date | None = None,
    end: date | None = None,
    limit: int = Query(50_000, ge=1, le=500_000),
) -> str:
    """Stream the detections behind the current view as CSV."""
    region_or_404(region)
    path = artifact(PROCESSED / "hotspots" / f"{region}.parquet")

    clauses, params = [], []
    if start:
        clauses.append("acq_date >= ?")
        params.append(start.isoformat())
    if end:
        clauses.append("acq_date <= ?")
        params.append(end.isoformat())
    where = f"where {' and '.join(clauses)}" if clauses else ""

    rows = query_rows(path, f"{where} limit {limit}", params)
    if not rows:
        raise HTTPException(404, "no detections in the requested range")

    header = ",".join(rows[0].keys())
    body = "\n".join(",".join(_cell(value) for value in row.values()) for row in rows)
    return f"{header}\n{body}\n"


@app.get("/method")
def method() -> dict:
    path = PROCESSED / "method.json"
    if not path.exists():
        raise HTTPException(503, "method.json is not generated yet")
    return json.loads(path.read_text(encoding="utf-8"))


def _median(values: list[float]) -> float:
    ordered = sorted(values)
    middle = len(ordered) // 2
    if len(ordered) % 2:
        return round(ordered[middle], 4)
    return round((ordered[middle - 1] + ordered[middle]) / 2, 4)


def _cell(value: object) -> str:
    if value is None:
        return ""
    text = str(value)
    return f'"{text}"' if "," in text else text
