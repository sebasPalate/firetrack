"""Firetrack read-only analytics API.

Serves precomputed artifacts only. It never reads FIRMS at request time: the
pipeline (``python -m pipeline.firms``, then harmonization) builds the artifacts
once from the Portolan mirror of NASA FIRMS, and this service only queries them.

Run from this directory:

    uvicorn main:app --reload

Artifacts consumed (produced by the pipeline, never written here):

    data/processed/calendar/{region}.parquet   one row per year+month
    data/processed/hotspots/{region}.parquet   unified detections
    data/processed/method/{region}.json        calibration table, validation, limitations

The payloads are built by ``pipeline.payloads``, which ``pipeline.export_web`` also
uses to write the static copy for the web client, so both always agree.
"""

from __future__ import annotations

import json
import os
import sys
from datetime import date
from pathlib import Path

import duckdb
from fastapi import FastAPI, HTTPException, Query
from fastapi.middleware.cors import CORSMiddleware
from fastapi.responses import Response

REPO_ROOT = Path(__file__).resolve().parents[2]
sys.path.insert(0, str(REPO_ROOT))  # uvicorn runs from services/api; the payload code lives in pipeline/

from pipeline.payloads import calendar_payload, csv_cell, public_region  # noqa: E402
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
    # Without this the browser hides the row count and truncation flag of the CSV.
    expose_headers=["Content-Disposition", "X-Firetrack-Rows", "X-Firetrack-Truncated"],
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
    methods = sorted(p.stem for p in (PROCESSED / "method").glob("*.json"))
    return {
        "status": "ok" if calendars else "no-artifacts",
        "regions_configured": len(load_regions()) if REGIONS_PATH.exists() else 0,
        "regions_ready": calendars,
        "methods_ready": methods,
    }


@app.get("/regions")
def regions() -> list[dict]:
    return [public_region(region) for region in load_regions().values()]


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

    rows = query_rows(path, where, params)
    if not rows:
        raise HTTPException(404, "no data in the requested range")
    return calendar_payload(config, rows)


@app.get("/detections")
def detections(
    region: str = Query(...),
    start: date | None = None,
    end: date | None = None,
    limit: int = Query(200_000, ge=1, le=500_000),
) -> Response:
    """Stream the detections behind the current view as CSV.

    The default cap covers the busiest single year in Iberia (141k rows in 2025),
    so a year export is never truncated by accident. When the cap does cut a
    range, the response says so in ``X-Firetrack-Truncated`` instead of returning
    a smaller file that looks complete.
    """
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

    rows = query_rows(path, f"{where} limit {limit + 1}", params)
    if not rows:
        raise HTTPException(404, "no detections in the requested range")
    truncated = len(rows) > limit
    rows = rows[:limit]

    header = ",".join(rows[0].keys())
    body = "\n".join(",".join(csv_cell(value) for value in row.values()) for row in rows)
    # The filename is served, not guessed by the browser: the client is on
    # another origin, where the `download` attribute is ignored. It names the
    # range the user asked for, not the rows that happened to survive `limit`.
    first = start.isoformat() if start else rows[0]["acq_date"] or "start"
    last = end.isoformat() if end else rows[-1]["acq_date"] or "end"
    filename = f"firetrack-{region}-{first}-{last}.csv"
    return Response(
        f"{header}\n{body}\n",
        media_type="text/csv; charset=utf-8",
        headers={
            "Content-Disposition": f'attachment; filename="{filename}"',
            "X-Firetrack-Rows": str(len(rows)),
            "X-Firetrack-Truncated": "true" if truncated else "false",
        },
    )


@app.get("/method")
def method(region: str = Query(..., description="region id from data/regions.json")) -> dict:
    region_or_404(region)
    path = PROCESSED / "method" / f"{region}.json"
    if not path.exists():
        raise HTTPException(503, f"method/{region}.json is not generated yet: run  python -m pipeline.harmonize {region}")
    return json.loads(path.read_text(encoding="utf-8"))
