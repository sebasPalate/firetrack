"""Harmonize MODIS and VIIRS into one monthly burning-activity index.

Input: the per-region cache built by ``pipeline.firms``. Output: the artifact
contract the API already serves.

    data/processed/hotspots/{region}.parquet    unified detections (CSV export)
    data/processed/calendar/{region}.parquet    one row per year+month
    data/processed/method.json                  calibration table and validation

Method (H2, see docs/problema.md §7):

* **Reference: Aqua MODIS.** The only orbit continuous from 2002-07 through every
  VIIRS satellite, with the same afternoon overpass (~13:30) as VIIRS.
* **One VIIRS at a time.** Suomi-NPP carries the series while it runs, and
  NOAA-20 only fills the tail after it stopped (2026-11-02). Summing NOAA-20 and
  NOAA-21 into the same count doubles the number for the same fires, which is
  exactly the 2018/2024 step this project exists to remove.
* **One factor per calendar month**, day and night together. Measured on this
  region, the monthly VIIRS/Aqua ratio has a coefficient of variation of 0.35
  with one factor, and splitting day from night multiplies the variance because
  the two factors differ three- to seven-fold and the day share changes every
  year. Calibrating each half separately over-corrected by 45 % to 280 %.
* **Empirical-Bayes shrinkage.** A January with a dozen Aqua detections cannot
  produce a rate on its own, so each monthly factor is pulled towards the pooled
  factor with ``SHRINK_K`` pseudo-counts.
* **Terra bridges 2000-11 → 2002-06**, calibrated against Aqua in their overlap.
* **The provisional tail is excluded from calibration**: a year that still mixes
  near-real-time rows with standard rows, or that has a satellite that stopped
  mid-year, is served but never used to fit the factors.
* **Clipped to the official boundary.** The cache is read by bounding box; every
  detection outside the region's GeoJSON (Portugal, France, Andorra, the sea) is
  dropped before anything is counted.
* **Small regions borrow the shape of a larger one.** ``--prior-region spain``
  shrinks each monthly factor of Aragón towards Spain's factor for that month,
  rescaled to Aragón's own pooled level, instead of towards a flat pooled factor.
* **Blind test.** The factors are refitted on 2012-02 .. 2016-12 only, Aqua is
  hidden, and 2017-2020 is rebuilt from Suomi-NPP alone. Unlike the overlap check,
  that error is out of sample.

Values are expressed in **Aqua MODIS detections**, which is why the output is an
index and never a fire count.

    python -m pipeline.harmonize spain
    python -m pipeline.harmonize aragon --prior-region spain
    python -m pipeline.harmonize spain --no-write      # calibration report only
"""

from __future__ import annotations

import argparse
import calendar as _calendar
import json
from pathlib import Path

import pandas as pd

from pipeline.env import load_env
from pipeline.firms import CONF_SQL, DATA, sql_literal
from pipeline.normalize import confidence_score_sql
from pipeline.regions import contains_many, load_geometry, load_regions

load_env()

PROCESSED = DATA / "processed"

#: Reference sensor, the VIIRS that carries the series, its tail, and the bridge.
REFERENCE = "Aqua"
PRIMARY = "Suomi-NPP"
TAIL = "NOAA-20"
BRIDGE = "Terra"

#: Sensor codes in ``data/sensor_days.parquet`` for the names above.
SENSOR_CODES = {
    "Aqua": "MODIS_A",
    "Terra": "MODIS_T",
    "Suomi-NPP": "VIIRS_SNPP",
    "NOAA-20": "VIIRS_NOAA20",
    "NOAA-21": "VIIRS_NOAA21",
}

#: First complete month in which the primary VIIRS and Aqua both observe.
OVERLAP_FIRST = (2012, 2)
#: Pseudo-counts, in Aqua detections, pulling a sparse month towards the pooled factor.
SHRINK_K = 20.0
#: A month is only used when the active sensor observed this share of its days.
MIN_DAYS_FRACTION = 0.6

#: Blind test: fit on the first VIIRS years only, then rebuild the next four without Aqua.
HOLDOUT_TRAIN_LAST = 2016
HOLDOUT_TEST = (2017, 2020)
#: Total order for the detection rows. Several detections share a minute (one
#: overpass), so sorting by time alone lets their order change between runs and
#: every rebuild would look like a data change. These columns never tie in practice.
DETECTION_ORDER = (
    "acq_datetime, satellite, latitude, longitude, frp, confidence, daynight, scan, track, version, type"
)
#: Name of the DuckDB view that holds one region's filtered, clipped detections.
REGION_VIEW = "region_detections"

#: Volcanoes, other static land sources and offshore platforms are not vegetation fires.
STATIC_FREE = "coalesce(type, 0) = 0"

#: The cache already stores ``lat``/``lon`` as numbers, so the unified schema only
#: renames them here, once, at the boundary.
UNIFIED_COLUMNS = (
    "acq_datetime, acq_date, sensor, satellite, daynight, quality, version, type, "
    "confidence, confidence_pct, round(lat, 4) AS latitude, round(lon, 4) AS longitude, "
    "frp, scan, track"
)


# ------------------------------------------------------------------ pure parts


def month_key(year: int, month: int) -> int:
    """Sortable ``YYYYMM`` integer, the unit of the whole calendar."""
    if not (1 <= month <= 12):
        raise ValueError(f"month out of range: {month}")
    return year * 100 + month


def days_in_month(year: int, month: int) -> int:
    return _calendar.monthrange(year, month)[1]


def is_complete(observed_days: int, year: int, month: int) -> bool:
    """False for a month the sensor only partly observed (launch, gap, end of life)."""
    return observed_days / days_in_month(year, month) >= MIN_DAYS_FRACTION


def running_month(
    counts: list[tuple], last_observed: tuple[int, int] | None = None
) -> tuple[int, int] | None:
    """The month still being observed: the later of the region and the whole record.

    A quiet region can stop detecting in September while the satellites keep
    flying into November, and the record can hold days the region never burned.
    Only the later month is the running one, so a finished month is never flagged
    partial just because it is the last one with detections.
    """
    region_last = max(((year, month) for year, month, _s, _n in counts), default=None)
    candidates = [month for month in (region_last, last_observed) if month is not None]
    return max(candidates) if candidates else None


def pooled_ratio(sensor_total: float, reference_total: float) -> float:
    """The all-year rate, used as the prior and as the fallback."""
    if reference_total <= 0:
        raise ValueError("no reference detections to pool")
    return sensor_total / reference_total


def shrink_ratio(
    sensor_total: float, reference_total: float, pooled: float, k: float = SHRINK_K
) -> float:
    """Ratio of a sensor to the reference, pulled towards ``pooled`` when sparse.

    ``k`` counts are pseudo-observations in reference units: with 20 Aqua
    detections the month is half its own rate and half the pooled rate; with
    2000 it is essentially its own rate. This is what stops a quiet January
    from producing a factor of 37 out of five detections.
    """
    if reference_total <= 0 and sensor_total <= 0:
        return pooled
    if reference_total <= 0:
        raise ValueError("a sensor with detections and no reference cannot be calibrated")
    return (sensor_total + k * pooled) / (reference_total + k)


def pick_source(
    coverage: dict[str, dict[int, int]], year: int, month: int, allow_partial: bool = False
) -> str | None:
    """Which sensor carries this month, in order of preference.

    ``coverage[sensor][YYYYMM]`` is the number of days that sensor observed
    anywhere on Earth. The tail only wins once the primary has stopped
    delivering, Terra only covers the years before Aqua, and ``None`` means the
    month has no complete sensor and is left out of the calendar.

    ``allow_partial`` is only used for the running month: it keeps whichever
    sensor observed the most days so far, so the calendar reaches today instead
    of ending a month early. The row is flagged ``partial`` downstream and is
    never used for calibration.
    """
    key = month_key(year, month)
    order = (PRIMARY, TAIL, REFERENCE, BRIDGE)
    for sensor in order:
        if is_complete(coverage.get(sensor, {}).get(key, 0), year, month):
            return sensor
    if not allow_partial:
        return None
    ranked = [(coverage.get(sensor, {}).get(key, 0), -position, sensor) for position, sensor in enumerate(order)]
    days, _position, sensor = max(ranked)
    return sensor if days else None


# ------------------------------------------------------------------- SQL parts


def detection_query(region: str, data_dir: Path | None = None) -> str:
    """Every cached detection of one region, filtered, with the unified column names.

    ``CONF_SQL`` is applied here and not baked into the cache, so its effect can
    be measured: MODIS keeps 30-100, VIIRS drops the low band.
    """
    files = sql_literal((Path(data_dir or DATA) / "cache" / region).as_posix() + "/*.parquet")
    return f"SELECT {UNIFIED_COLUMNS} FROM read_parquet({files}) WHERE {CONF_SQL} AND {STATIC_FREE}"


def monthly_counts(con, region: str, data_dir: Path | None = None, relation: str | None = None) -> list[tuple]:
    """Detections per year, month and satellite, after filtering.

    ``relation`` is a view made by ``load_region`` (filtered and clipped); without
    it the cache is read directly, with the filter but no boundary.
    """
    source = relation or f"({detection_query(region, data_dir)})"
    return con.execute(
        f"""SELECT year(acq_date), month(acq_date), satellite, count(*)
            FROM {source}
            GROUP BY ALL ORDER BY 1, 2, 3"""
    ).fetchall()


def load_region(con, region: str, data_dir: Path | None = None, polygons=None) -> tuple[str, dict]:
    """Materialize the filtered detections of one region as a table, clipped to ``polygons``.

    The cache is read by bounding box, so a box around Spain also holds Portugal,
    southern France and the sea. Clipping happens once, here, so the counts, the
    calendar and the CSV export all see exactly the same rows.

    Only the two coordinate columns travel to Python for the point-in-polygon
    test; the rows stay in DuckDB, which keeps memory flat for large regions.
    """
    con.execute(f"CREATE OR REPLACE TEMP TABLE {REGION_VIEW} AS {detection_query(region, data_dir)}")
    stats = {"in_bbox": int(con.execute(f"SELECT count(*) FROM {REGION_VIEW}").fetchone()[0])}
    if polygons:
        columns = con.execute(f"SELECT rowid, longitude, latitude FROM {REGION_VIEW}").fetchnumpy()
        inside = contains_many(polygons, columns["longitude"], columns["latitude"])
        outside = pd.DataFrame({"row": columns["rowid"][~inside]})
        con.register("rows_outside_boundary", outside)
        try:
            con.execute(f"DELETE FROM {REGION_VIEW} WHERE rowid IN (SELECT row FROM rows_outside_boundary)")
        finally:
            con.unregister("rows_outside_boundary")
    stats["in_boundary"] = int(con.execute(f"SELECT count(*) FROM {REGION_VIEW}").fetchone()[0])
    return REGION_VIEW, stats


def load_coverage(con, data_dir: Path | None = None) -> dict[str, dict[int, int]]:
    """Observing days per sensor and month, from the global ``sensor_days`` table.

    The denominator must be "did the satellite fly", not "did this region burn",
    or every quiet winter month would look under-observed.
    """
    path = Path(data_dir or DATA) / "sensor_days.parquet"
    if not path.exists():
        return {}
    rows = con.execute(
        f"""SELECT sensor, year(acq_date), month(acq_date), count(DISTINCT acq_date)
            FROM read_parquet({sql_literal(path.as_posix())})
            GROUP BY ALL"""
    ).fetchall()
    by_name = {code: name for name, code in SENSOR_CODES.items()}
    coverage: dict[str, dict[int, int]] = {}
    for code, year, month, days in rows:
        name = by_name.get(code)
        if name:
            coverage.setdefault(name, {})[month_key(year, month)] = days
    return coverage


def last_observed_month(con, data_dir: Path | None = None) -> tuple[int, int] | None:
    """The last month any satellite observed, from the global ``sensor_days`` table.

    ``None`` when the table is missing or empty, so the caller can fall back to
    the region's own last month instead of failing.
    """
    path = Path(data_dir or DATA) / "sensor_days.parquet"
    if not path.exists():
        return None
    row = con.execute(f"SELECT max(acq_date) FROM read_parquet({sql_literal(path.as_posix())})").fetchone()
    if not row or row[0] is None:
        return None
    return (row[0].year, row[0].month)


# ---------------------------------------------------------------- the calendar


def build_calibration(
    counts: list[tuple],
    coverage: dict[str, dict[int, int]],
    last_complete_year: int | None = None,
    prior_calibration: dict | None = None,
) -> dict:
    """Per calendar month: the VIIRS-to-Aqua factor, its bridge and its tail.

    Only complete months up to ``last_complete_year`` are measured. The pooled
    factor is both the prior and the fallback for a month that never has both
    sensors.

    ``prior_calibration`` is another region's calibration, as written to its method file.
    With it, each month is shrunk towards that region's factor for the same month,
    rescaled by the ratio of the two pooled factors: the seasonal shape comes from
    the larger region, the level from this one.
    """
    per_month: dict[tuple[int, int], dict[str, int]] = {}
    for year, month, satellite, n in counts:
        per_month.setdefault((year, month), {})[satellite] = n

    def measured(month: int | None = None, limit: int | None = None) -> dict[str, float]:
        totals = {"snpp": 0.0, "aqua": 0.0, "noaa20": 0.0, "terra": 0.0}
        for (year, m), per_satellite in per_month.items():
            if month is not None and m != month:
                continue
            if month_key(year, m) < month_key(*OVERLAP_FIRST):
                continue
            if limit is not None and year > limit:
                continue
            if not is_complete(coverage.get(PRIMARY, {}).get(month_key(year, m), 0), year, m):
                continue
            if not is_complete(coverage.get(REFERENCE, {}).get(month_key(year, m), 0), year, m):
                continue
            totals["snpp"] += per_satellite.get(PRIMARY, 0)
            totals["aqua"] += per_satellite.get(REFERENCE, 0)
            totals["noaa20"] += per_satellite.get(TAIL, 0)
        return totals

    overall = measured(limit=last_complete_year)
    prior = pooled_ratio(overall["snpp"], overall["aqua"]) if overall["aqua"] else None
    borrowed = _prior_shape(prior_calibration)

    def month_prior(month: int) -> float:
        own = prior or 1.0
        if not borrowed:
            return own
        shape = borrowed["monthly"][f"{month:02d}"] / borrowed["pooled"]
        return shape * (prior or borrowed["pooled"])

    table = {}
    for month in range(1, 13):
        totals = measured(month=month, limit=last_complete_year)
        table[f"{month:02d}"] = {
            "factor": round(shrink_ratio(totals["snpp"], totals["aqua"], month_prior(month)), 4),
            "raw_ratio": round(pooled_ratio(totals["snpp"], totals["aqua"]), 4) if totals["aqua"] else None,
            "viiRs": int(totals["snpp"]),
            "aqua": int(totals["aqua"]),
        }

    # The tail is the same instrument family as the primary, but a different
    # platform: using it without a correction would add a step of its own at the
    # very end of the record. It must be measured only where both overlap.
    tail_snpp = tail_noaa20 = 0.0
    for (year, month), per_satellite in per_month.items():
        key = month_key(year, month)
        if key < month_key(*OVERLAP_FIRST):
            continue
        if last_complete_year is not None and year > last_complete_year:
            continue
        if not is_complete(coverage.get(TAIL, {}).get(key, 0), year, month):
            continue
        if not is_complete(coverage.get(PRIMARY, {}).get(key, 0), year, month):
            continue
        tail_noaa20 += per_satellite.get(TAIL, 0)
        tail_snpp += per_satellite.get(PRIMARY, 0)
    tail_factor = pooled_ratio(tail_noaa20, tail_snpp) if tail_snpp else None

    terra_total = aqua_total = 0.0
    for (year, month), per_satellite in per_month.items():
        key = month_key(year, month)
        if not (month_key(2002, 7) <= key < month_key(*OVERLAP_FIRST)):
            continue
        if last_complete_year is not None and year > last_complete_year:
            continue
        if not is_complete(coverage.get(BRIDGE, {}).get(key, 0), year, month):
            continue
        if not is_complete(coverage.get(REFERENCE, {}).get(key, 0), year, month):
            continue
        terra_total += per_satellite.get(BRIDGE, 0)
        aqua_total += per_satellite.get(REFERENCE, 0)

    return {
        "pooled": round(prior, 4) if prior else None,
        "monthly": table,
        "tail": {
            "sensor": TAIL,
            "factor": round(tail_factor, 4) if tail_factor else None,
            "note": "NOAA-20 counts divided by (monthly factor x this) to match Suomi-NPP",
        },
        "bridge": {
            "sensor": BRIDGE,
            "factor": round(pooled_ratio(terra_total, aqua_total), 4) if aqua_total else None,
            "terra": int(terra_total),
            "aqua": int(aqua_total),
        },
        "shrink_k": SHRINK_K,
        "prior": (
            {"region": prior_calibration.get("region"), "pooled": borrowed["pooled"]}
            if borrowed
            else None
        ),
        "overlap_first": f"{OVERLAP_FIRST[0]}-{OVERLAP_FIRST[1]:02d}",
        "calibration_last_year": last_complete_year,
    }


def _prior_shape(prior_calibration: dict | None) -> dict | None:
    """The pooled and per-month factors of another region, or None if unusable."""
    if not prior_calibration or not prior_calibration.get("pooled"):
        return None
    monthly = {key: entry["factor"] for key, entry in prior_calibration["monthly"].items()}
    if len(monthly) != 12 or not all(monthly.values()):
        return None
    return {"pooled": prior_calibration["pooled"], "monthly": monthly}


def load_prior(region: str, data_dir: Path | None = None) -> dict:
    """The calibration of an already harmonized region, tagged with its id."""
    path = Path(data_dir or DATA) / "processed" / "method" / f"{region}.json"
    if not path.exists():
        raise FileNotFoundError(f"{path} not found: run  python -m pipeline.harmonize {region}  first")
    payload = json.loads(path.read_text(encoding="utf-8"))
    return {**payload["calibration"], "region": region}


def build_calendar(
    counts: list[tuple],
    coverage: dict[str, dict[int, int]],
    calibration: dict,
    latest: tuple[int, int] | None = None,
) -> list[dict]:
    """One row per year and month, in reference units, with the raw count alongside.

    ``raw_count`` sums every satellite, which is the series that jumps when one
    joins. ``harmonized_index`` is the one that should not. ``latest`` is the
    running month, the only one that is partial even after enough days passed
    ``MIN_DAYS_FRACTION``: the threshold answers "did the sensor fly enough", not
    "did the month end".
    """
    per_month: dict[tuple[int, int], dict] = {}
    for year, month, satellite, n in counts:
        row = per_month.setdefault((year, month), {})
        row[satellite] = row.get(satellite, 0) + n

    tail_factor = calibration["tail"]["factor"] or 1.0
    bridge_factor = calibration["bridge"]["factor"] or 1.0
    fitted_through = calibration.get("calibration_last_year")

    rows = []
    for (year, month) in sorted(per_month):
        per_satellite = per_month[(year, month)]
        source = pick_source(coverage, year, month, allow_partial=latest == (year, month))
        index = None
        factor = None
        if source == REFERENCE:
            index = float(per_satellite.get(REFERENCE, 0))
            factor = 1.0
        elif source == BRIDGE:
            index = round(per_satellite.get(BRIDGE, 0) / bridge_factor, 3)
            factor = bridge_factor
        elif source is not None:
            monthly = calibration["monthly"][f"{month:02d}"]["factor"]
            effective = monthly * (tail_factor if source == TAIL else 1.0)
            index = round(per_satellite.get(source, 0) / effective, 3)
            factor = effective
        observed = coverage.get(source or "", {}).get(month_key(year, month), 0)
        rows.append(
            {
                "year": year,
                "month": month,
                "harmonized_index": index,
                "raw_count": sum(per_satellite.values()),
                "source": source,
                "factor": round(factor, 4) if factor else None,
                "observed_days": observed,
                "partial": latest == (year, month)
                or (bool(source) and not is_complete(observed, year, month)),
                "provisional": fitted_through is not None and year > fitted_through,
                "aqua": per_satellite.get(REFERENCE, 0),
                "terra": per_satellite.get(BRIDGE, 0),
                "snpp": per_satellite.get(PRIMARY, 0),
                "noaa20": per_satellite.get(TAIL, 0),
                "noaa21": per_satellite.get("NOAA-21", 0),
            }
        )
    return rows


def validate(rows: list[dict], last_complete_year: int | None = None) -> dict:
    """S10: during the overlap, the calibrated index must reproduce Aqua.

    Also reports the size of the 2012 step before and after harmonization, which
    is the whole claim of the project.
    """
    per_year: dict[int, dict] = {}
    for row in rows:
        if row["harmonized_index"] is None:
            continue
        if month_key(row["year"], row["month"]) < month_key(*OVERLAP_FIRST):
            continue
        if last_complete_year is not None and row["year"] > last_complete_year:
            continue
        bucket = per_year.setdefault(row["year"], {"index": 0.0, "aqua": 0.0, "raw": 0.0})
        bucket["index"] += row["harmonized_index"]
        bucket["aqua"] += row["aqua"]
        bucket["raw"] += row["raw_count"]

    errors = []
    for bucket in per_year.values():
        if bucket["aqua"] > 0:
            bucket["error_pct"] = round((bucket["index"] - bucket["aqua"]) / bucket["aqua"] * 100, 1)
            errors.append(abs(bucket["error_pct"]))
    errors.sort()

    def era_mean(first: int, last: int, key: str) -> float | None:
        values = [r[key] for r in rows if first <= r["year"] <= last and r[key] is not None]
        return sum(values) / len(values) if values else None

    return {
        "overlap_years": sorted(per_year),
        "per_year": {
            str(year): {k: round(v, 1) for k, v in bucket.items()}
            for year, bucket in sorted(per_year.items())
        },
        "median_abs_error_pct": round(errors[len(errors) // 2], 1) if errors else None,
        "worst_abs_error_pct": round(errors[-1], 1) if errors else None,
        "raw_step_2011_to_2013_pct": _step(era_mean(2009, 2011, "raw_count"), era_mean(2013, 2015, "raw_count")),
        "aqua_step_2011_to_2013_pct": _step(era_mean(2009, 2011, "aqua"), era_mean(2013, 2015, "aqua")),
        "index_step_2011_to_2013_pct": _step(
            era_mean(2009, 2011, "harmonized_index"), era_mean(2013, 2015, "harmonized_index")
        ),
    }


def holdout(
    counts: list[tuple],
    coverage: dict[str, dict[int, int]],
    prior_calibration: dict | None = None,
    train_last: int = HOLDOUT_TRAIN_LAST,
    test: tuple[int, int] = HOLDOUT_TEST,
) -> dict | None:
    """Blind test: fit on the overlap up to ``train_last``, then hide Aqua.

    The test years are rebuilt from the primary VIIRS alone with those factors and
    compared with what Aqua really saw. This is the situation of every month after
    Aqua, so it is the honest error bar of the index; the overlap check in
    ``validate`` is in sample and can only catch a systematic gap.
    """
    train = [row for row in counts if row[0] <= train_last]
    calibration = build_calibration(
        train, coverage, last_complete_year=train_last, prior_calibration=prior_calibration
    )
    per_month: dict[tuple[int, int], dict[str, int]] = {}
    for year, month, satellite, n in counts:
        per_month.setdefault((year, month), {})[satellite] = n

    months = []
    for (year, month), per_satellite in sorted(per_month.items()):
        if not (test[0] <= year <= test[1]):
            continue
        key = month_key(year, month)
        if not (
            is_complete(coverage.get(PRIMARY, {}).get(key, 0), year, month)
            and is_complete(coverage.get(REFERENCE, {}).get(key, 0), year, month)
        ):
            continue
        viirs = per_satellite.get(PRIMARY, 0)
        factor = calibration["monthly"][f"{month:02d}"]["factor"]
        months.append((year, month, viirs / factor, per_satellite.get(REFERENCE, 0), viirs))
    if not months:
        return None

    per_year: dict[int, dict] = {}
    for year, _month, index, aqua, viirs in months:
        bucket = per_year.setdefault(year, {"index": 0.0, "aqua": 0.0, "raw_viirs": 0.0})
        bucket["index"] += index
        bucket["aqua"] += aqua
        bucket["raw_viirs"] += viirs
    year_errors = []
    for bucket in per_year.values():
        if bucket["aqua"] > 0:
            bucket["error_pct"] = round((bucket["index"] - bucket["aqua"]) / bucket["aqua"] * 100, 1)
            year_errors.append(abs(bucket["error_pct"]))
    year_errors.sort()

    index_total = sum(m[2] for m in months)
    aqua_total = sum(m[3] for m in months)
    viirs_total = sum(m[4] for m in months)
    return {
        "train": [f"{OVERLAP_FIRST[0]}-{OVERLAP_FIRST[1]:02d}", f"{train_last}-12"],
        "test": [f"{test[0]}-01", f"{test[1]}-12"],
        "months": len(months),
        "per_year": {
            str(year): {k: round(v, 1) for k, v in bucket.items()} for year, bucket in sorted(per_year.items())
        },
        "error_pct": round((index_total - aqua_total) / aqua_total * 100, 1) if aqua_total else None,
        "raw_error_pct": round((viirs_total - aqua_total) / aqua_total * 100, 1) if aqua_total else None,
        "median_abs_year_error_pct": round(year_errors[len(year_errors) // 2], 1) if year_errors else None,
        "spearman_monthly": _spearman([m[2] for m in months], [m[3] for m in months]),
        "calibration": {
            "pooled": calibration["pooled"],
            "monthly": {key: {"factor": entry["factor"]} for key, entry in calibration["monthly"].items()},
        },
    }


def _ranks(values: list[float]) -> list[float]:
    order = sorted(range(len(values)), key=lambda i: values[i])
    ranks = [0.0] * len(values)
    i = 0
    while i < len(order):
        j = i
        while j + 1 < len(order) and values[order[j + 1]] == values[order[i]]:
            j += 1
        for k in range(i, j + 1):
            ranks[order[k]] = (i + j) / 2 + 1
        i = j + 1
    return ranks


def _spearman(a: list[float], b: list[float]) -> float | None:
    """Rank correlation: does the rebuilt series put the months in the same order as Aqua?"""
    if len(a) < 3:
        return None
    ra, rb = _ranks(a), _ranks(b)
    ma, mb = sum(ra) / len(ra), sum(rb) / len(rb)
    cov = sum((x - ma) * (y - mb) for x, y in zip(ra, rb))
    va = sum((x - ma) ** 2 for x in ra) ** 0.5
    vb = sum((y - mb) ** 2 for y in rb) ** 0.5
    return round(cov / (va * vb), 3) if va and vb else None


def _step(before: float | None, after: float | None) -> float | None:
    if not before or after is None:
        return None
    return round((after - before) / before * 100, 1)


# ---------------------------------------------------------------------- output


def write_artifacts(
    con,
    region: str,
    rows: list[dict],
    calibration: dict,
    validation: dict,
    seen: dict,
    data_dir: Path | None = None,
    relation: str | None = None,
    boundary: dict | None = None,
) -> dict:
    root = Path(data_dir or DATA)
    if not rows:
        raise ValueError(f"no usable months for {region}: nothing to write")
    processed = root / "processed"
    calendar_path = processed / "calendar" / f"{region}.parquet"
    hotspots_path = processed / "hotspots" / f"{region}.parquet"
    calendar_path.parent.mkdir(parents=True, exist_ok=True)
    hotspots_path.parent.mkdir(parents=True, exist_ok=True)

    frame = pd.DataFrame(rows).sort_values(["year", "month"], ignore_index=True)
    con.register("calendar_rows", frame)
    try:
        con.execute(
            f"COPY (SELECT * FROM calendar_rows) TO {sql_literal(calendar_path.as_posix())} (FORMAT parquet)"
        )
    finally:
        con.unregister("calendar_rows")

    score = confidence_score_sql("sensor", "confidence")
    source = relation or f"({detection_query(region, data_dir)})"
    con.execute(
        f"""COPY (SELECT *, {score} AS confidence_score FROM {source} ORDER BY {DETECTION_ORDER})
            TO {sql_literal(hotspots_path.as_posix())} (FORMAT parquet, COMPRESSION zstd)"""
    )

    payload = {
        "region": region,
        "reference": REFERENCE,
        "primary": PRIMARY,
        "tail": TAIL,
        "bridge": BRIDGE,
        "units": "harmonized activity index, in Aqua MODIS detections (not a fire count)",
        "method": "H2: overlap-window calibration per calendar month, empirical-Bayes shrinkage",
        "calibration": calibration,
        "validation": validation,
        "coverage": seen,
        "boundary": boundary,
        "artifacts": {
            "calendar": calendar_path.relative_to(root.parent).as_posix(),
            "hotspots": hotspots_path.relative_to(root.parent).as_posix(),
        },
        "rows": len(rows),
        "limitations": [
            "An index is comparable across years; it is not a count of fires.",
            "One VIIRS at a time: NOAA-20 and NOAA-21 are used only to fill the record, never added to the sum.",
            "One factor per calendar month, day and night together: splitting them multiplied the variance by three on this region.",
            "Months flagged partial have fewer observing days than the month is long and should not be read as anomalies.",
            "Years flagged provisional are served but excluded from calibration: they still mix near-real-time rows, so their level is less trustworthy than the fitted years.",
            "Aqua is the reference from 2002-07; Terra covers 2000-11 to 2002-06 through its own overlap factor.",
            "The last year mixes near-real-time rows and is excluded from calibration, so its values are provisional.",
            "Detections are clipped to the official boundary; a fire on the border counts only on the side its pixel centre falls.",
            "Aqua's orbit drifts later in the afternoon after 2022, so overlap years from 2023 compare VIIRS with a slowly changing reference.",
        ]
        + (
            [f"Monthly factors are shrunk towards those of {calibration['prior']['region']}: too few local Aqua detections for a seasonal shape of its own."]
            if calibration.get("prior")
            else []
        ),
    }
    method_path = processed / "method" / f"{region}.json"
    method_path.parent.mkdir(parents=True, exist_ok=True)
    method_path.write_text(json.dumps(payload, indent=2), encoding="utf-8")
    return payload


def connect():
    """Plain DuckDB: the harmonizer only reads the local cache, so no extension is needed."""
    import duckdb

    return duckdb.connect()


def main(argv: list[str] | None = None) -> int:
    parser = argparse.ArgumentParser(description="Harmonize a region's detections into one monthly index")
    parser.add_argument("region", help="region id from data/regions.json")
    parser.add_argument("--prior-region", help="shrink the monthly factors towards this region's (run it first)")
    parser.add_argument("--no-write", action="store_true", help="print the calibration report only")
    args = parser.parse_args(argv)

    if not list((DATA / "cache" / args.region).glob("*.parquet")):
        print(f"no cache for {args.region}: run  python -m pipeline.firms {args.region}")
        return 2

    config = load_regions().get(args.region, {})
    polygons = load_geometry(config) if config.get("geometry") else None
    prior = load_prior(args.prior_region) if args.prior_region else None
    prior_holdout = None
    if args.prior_region:
        method_path = DATA / "processed" / "method" / f"{args.prior_region}.json"
        held = json.loads(method_path.read_text(encoding="utf-8"))["validation"].get("holdout") or {}
        prior_holdout = {**held["calibration"], "region": args.prior_region} if held.get("calibration") else None

    con = connect()
    relation, boundary = load_region(con, args.region, polygons=polygons)
    counts = monthly_counts(con, args.region, relation=relation)
    coverage = load_coverage(con)
    if not coverage:
        print(
            f"no sensor coverage: {DATA / 'sensor_days.parquet'} is missing or empty\n"
            f"run  python -m pipeline.firms {args.region}  to rebuild it, then retry"
        )
        return 2
    last_full = max(year for year, _m, _s, _n in counts) - 1
    latest = running_month(counts, last_observed_month(con))
    calibration = build_calibration(counts, coverage, last_complete_year=last_full, prior_calibration=prior)
    rows = build_calendar(counts, coverage, calibration, latest=latest)
    validation = validate(rows, last_complete_year=last_full)
    validation["holdout"] = holdout(counts, coverage, prior_calibration=prior_holdout)

    usable = [row for row in rows if row["harmonized_index"] is not None]
    print(f"region : {args.region}" + (f" (factors shrunk towards {args.prior_region})" if prior else ""))
    if polygons:
        print(f"clip   : {boundary['in_boundary']:,} of {boundary['in_bbox']:,} filtered detections inside the boundary")
    print(f"months : {len(rows)}, {len(usable)} usable, {sum(r['partial'] for r in usable)} partial")
    print(f"calibration years: {calibration['overlap_first']} .. {last_full} (the running year is served, not fitted)")
    print("\nmonth  factor  raw_ratio    viirs     aqua")
    for month in range(1, 13):
        entry = calibration["monthly"][f"{month:02d}"]
        print(
            f"{month:>5}  {entry['factor']:>6.2f}  {str(entry['raw_ratio']):>9} "
            f"{entry['viiRs']:>7} {entry['aqua']:>7}"
        )
    print(f"\npooled VIIRS/Aqua: {calibration['pooled']}")
    print(f"tail NOAA-20/Suomi-NPP: {calibration['tail']['factor']}")
    print(f"bridge Terra/Aqua: {calibration['bridge']['factor']}")
    print(f"median |error| vs Aqua: {validation['median_abs_error_pct']}% (worst {validation['worst_abs_error_pct']}%)")
    print(
        f"step 2011->2013: raw {validation['raw_step_2011_to_2013_pct']}% "
        f"vs index {validation['index_step_2011_to_2013_pct']}% "
        f"(Aqua itself {validation['aqua_step_2011_to_2013_pct']}%)"
    )
    blind = validation["holdout"]
    if blind:
        print(
            f"blind test {blind['test'][0]}..{blind['test'][1]} (fitted to {blind['train'][1]}, Aqua hidden): "
            f"error {blind['error_pct']}% vs raw VIIRS {blind['raw_error_pct']}%, "
            f"median |year error| {blind['median_abs_year_error_pct']}%, Spearman {blind['spearman_monthly']}"
        )

    if args.no_write:
        return 0

    payload = write_artifacts(
        con,
        args.region,
        usable,
        calibration,
        validation,
        {
            "first_month": f"{usable[0]['year']}-{usable[0]['month']:02d}" if usable else None,
            "last_month": f"{usable[-1]['year']}-{usable[-1]['month']:02d}" if usable else None,
        },
        relation=relation,
        boundary={**boundary, "geometry": config.get("geometry")} if polygons else None,
    )
    print(f"\nwrote {payload['artifacts']['calendar']} ({payload['rows']} rows)")
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
