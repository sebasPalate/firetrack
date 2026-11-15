"""The JSON and CSV the web client reads, built from the processed artifacts.

One implementation for both ways of serving them: the FastAPI service calls these
functions per request, and ``pipeline.export_web`` calls them once to write static
files for a host without a server. Same code, same numbers.
"""

from __future__ import annotations

def median(values: list[float]) -> float:
    ordered = sorted(values)
    middle = len(ordered) // 2
    if len(ordered) % 2:
        return round(ordered[middle], 4)
    return round((ordered[middle - 1] + ordered[middle]) / 2, 4)


def calendar_payload(region: dict, rows: list[dict]) -> dict:
    """The burning calendar as a month x year matrix plus anomalies.

    ``rows`` are rows of ``data/processed/calendar/{region}.parquet``. Partial and
    provisional rows are served, but they never set the baseline: a month still
    being observed, or a running year that mixes near-real-time rows, would make
    every other year look like an anomaly.
    """
    rows = sorted(rows, key=lambda row: (row["year"], row["month"]))
    years = sorted({row["year"] for row in rows})
    by_key = {(row["year"], row["month"]): row for row in rows}

    by_month: dict[int, list[float]] = {}
    for row in rows:
        if row.get("partial") or row.get("provisional") or row["harmonized_index"] is None:
            continue
        by_month.setdefault(row["month"], []).append(row["harmonized_index"])
    median_by_month = {month: median(values) for month, values in sorted(by_month.items())}

    def matrix(key: str) -> list[list]:
        return [[by_key.get((year, month), {}).get(key) for year in years] for month in range(1, 13)]

    harmonized = matrix("harmonized_index")
    anomaly = [
        [
            None
            if value is None or not median_by_month.get(month) or by_key[(year, month)].get("partial")
            else round((value - median_by_month[month]) / median_by_month[month] * 100, 1)
            for year, value in zip(years, harmonized[month - 1])
        ]
        for month in range(1, 13)
    ]

    return {
        "region": public_region(region),
        "years": years,
        "months": list(range(1, 13)),
        "harmonized": harmonized,
        "raw_count": matrix("raw_count"),
        "partial": matrix("partial"),
        "provisional": matrix("provisional"),
        "source": matrix("source"),
        "factor": matrix("factor"),
        "observed_days": matrix("observed_days"),
        "median_by_month": median_by_month,
        "anomaly_pct": anomaly,
        "units": "harmonized activity index (not an absolute fire count)",
    }


def public_region(region: dict) -> dict:
    """The fields of a region the client needs; bbox as a plain list."""
    return {
        "id": region["id"],
        "name": region["name"],
        "bbox": list(region["bbox"]),
        "why": region.get("why", ""),
        **({"geometry": region["geometry"]} if region.get("geometry") else {}),
    }


def csv_cell(value: object) -> str:
    if value is None:
        return ""
    text = str(value)
    return f'"{text}"' if "," in text else text


def detections_csv(columns: list[str], rows: list[tuple]) -> str:
    """Header plus one line per detection, the format of ``GET /detections``."""
    body = "\n".join(",".join(csv_cell(value) for value in row) for row in rows)
    return ",".join(columns) + "\n" + (body + "\n" if body else "")
