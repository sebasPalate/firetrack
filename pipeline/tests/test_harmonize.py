"""Tests for the harmonizer: the calibration maths and the artifact contract.

The claim of the project is that a monthly factor removes the satellite step.
That claim is only worth something if the factor is measured on the right set of
months and if the filter is applied to the same rows the calendar counts, so both
are pinned here without touching the network:

    python -m pipeline.tests.test_harmonize

or with pytest if it is installed.
"""

from __future__ import annotations

import json
import tempfile
from pathlib import Path

import duckdb

from pipeline.firms import sql_literal
from pipeline.harmonize import (
    MIN_DAYS_FRACTION,
    OVERLAP_FIRST,
    PRIMARY,
    REFERENCE,
    TAIL,
    build_calendar,
    build_calibration,
    days_in_month,
    detection_query,
    is_complete,
    load_coverage,
    month_key,
    monthly_counts,
    pick_source,
    pooled_ratio,
    shrink_ratio,
    validate,
    write_artifacts,
)


# ------------------------------------------------------------------ pure parts


def test_month_key_is_sortable_and_validates() -> None:
    assert month_key(2012, 2) == 201202
    assert month_key(2013, 1) > month_key(2012, 12)
    for bad in (0, 13):
        try:
            month_key(2013, bad)
        except ValueError:
            continue
        raise AssertionError(f"expected ValueError for month={bad}")


def test_days_in_month_knows_leap_years() -> None:
    assert days_in_month(2013, 7) == 31
    assert days_in_month(2012, 2) == 29
    assert days_in_month(2013, 2) == 28


def test_a_month_is_complete_at_sixty_percent_of_its_days() -> None:
    assert is_complete(31, 2013, 7)
    assert not is_complete(18, 2013, 7)  # 18 / 31 = 0.58, still under
    assert is_complete(19, 2013, 7)
    assert not is_complete(2, 2026, 11)
    if MIN_DAYS_FRACTION != 0.6:
        raise AssertionError("the completeness threshold is part of the method, not a knob")


def test_pooled_ratio_refuses_to_divide_by_zero() -> None:
    assert pooled_ratio(300, 100) == 3.0
    try:
        pooled_ratio(10, 0)
    except ValueError:
        return
    raise AssertionError("expected ValueError when the reference has no detections")


def test_shrinkage_pulls_sparse_months_towards_the_pooled_factor() -> None:
    assert shrink_ratio(300, 100, 3.0, k=0) == 3.0
    assert shrink_ratio(0, 0, 4.0) == 4.0
    # Five detections cannot claim a factor of 40: with k=20 it lands near the prior.
    sparse = shrink_ratio(200, 5, 4.0, k=20)
    assert 4.0 < sparse < 40.0
    try:
        shrink_ratio(50, 0, 4.0)
    except ValueError:
        return
    raise AssertionError("expected ValueError for a sensor with detections and no reference")


def test_source_preference_puts_the_primary_viiRs_before_everything_else() -> None:
    coverage = {
        PRIMARY: {201307: 31},
        TAIL: {201307: 31},
        REFERENCE: {201307: 31},
    }
    assert pick_source(coverage, 2013, 7) == PRIMARY


def test_source_falls_back_to_the_tail_when_the_primary_stops() -> None:
    coverage = {PRIMARY: {202611: 2}, TAIL: {202611: 30}, REFERENCE: {202611: 30}}
    assert pick_source(coverage, 2026, 11) == TAIL


def test_source_is_none_for_a_partial_month_unless_it_is_the_running_one() -> None:
    coverage = {PRIMARY: {202611: 2}, TAIL: {202611: 14}, REFERENCE: {202611: 14}}
    assert pick_source(coverage, 2026, 11) is None
    # The running month keeps the sensor with the most days, ties by preference.
    assert pick_source(coverage, 2026, 11, allow_partial=True) == TAIL


def test_partial_source_prefers_more_days_over_preference_order() -> None:
    coverage = {PRIMARY: {202611: 3}, TAIL: {202611: 20}, REFERENCE: {202611: 14}}
    assert pick_source(coverage, 2026, 11, allow_partial=True) == TAIL
    assert pick_source({PRIMARY: {202611: 0}}, 2026, 11, allow_partial=True) is None


# ------------------------------------------------------------- the calibration


def _two_era_counts() -> list[tuple]:
    """Aqua alone before the VIIRS launch, then Aqua plus a VIIRS that sees 3x more."""
    counts = []
    for year in (2009, 2010, 2011):
        counts.append((year, 7, REFERENCE, 100))
    for year in (2012, 2013, 2014, 2015):
        counts.append((year, 7, REFERENCE, 100))
        counts.append((year, 7, PRIMARY, 300))
    return counts


def _full_july_coverage() -> dict[str, dict[int, int]]:
    """Aqua flies the whole record; the VIIRS only starts in 2012, as in reality."""
    coverage: dict[str, dict[int, int]] = {REFERENCE: {}, PRIMARY: {}, TAIL: {}}
    for year in (2009, 2010, 2011, 2012, 2013, 2014, 2015):
        coverage[REFERENCE][year * 100 + 7] = 31
        if year >= OVERLAP_FIRST[0]:
            coverage[PRIMARY][year * 100 + 7] = 31
            coverage[TAIL][year * 100 + 7] = 31
    return coverage


def test_calibration_measures_one_factor_per_month_on_the_overlap() -> None:
    calibration = build_calibration(_two_era_counts(), _full_july_coverage(), last_complete_year=2015)
    assert calibration["pooled"] == 3.0
    assert calibration["monthly"]["07"]["factor"] == 3.0
    assert calibration["monthly"]["07"]["raw_ratio"] == 3.0
    assert calibration["monthly"]["07"]["aqua"] == 400  # four overlap years
    assert calibration["overlap_first"] == f"{OVERLAP_FIRST[0]}-{OVERLAP_FIRST[1]:02d}"
    # A month with no overlap falls back to the pooled factor instead of inventing one.
    assert calibration["monthly"]["01"]["factor"] == 3.0
    assert calibration["monthly"]["01"]["raw_ratio"] is None


def test_calibration_never_fits_the_running_year() -> None:
    counts = _two_era_counts() + [(2026, 7, REFERENCE, 100), (2026, 7, PRIMARY, 900)]
    coverage = _full_july_coverage()
    coverage[REFERENCE][202607] = 31
    coverage[PRIMARY][202607] = 31
    calibration = build_calibration(counts, coverage, last_complete_year=2025)
    assert calibration["calibration_last_year"] == 2025
    assert calibration["monthly"]["07"]["factor"] == 3.0  # 2026 would have pulled it to 4.2


def test_calendar_turns_the_satellite_join_into_flat_ground() -> None:
    counts = _two_era_counts()
    coverage = _full_july_coverage()
    calibration = build_calibration(counts, coverage, last_complete_year=2015)
    rows = build_calendar(counts, coverage, calibration)

    by_year = {row["year"]: row for row in rows}
    assert by_year[2011]["harmonized_index"] == 100.0  # Aqua is the unit
    assert by_year[2011]["raw_count"] == 100
    assert by_year[2012]["source"] == PRIMARY
    assert by_year[2012]["harmonized_index"] == 100.0  # 300 VIIRS = 100 Aqua
    assert by_year[2013]["raw_count"] == 400

    report = validate(rows, last_complete_year=2015)
    assert report["raw_step_2011_to_2013_pct"] == 300.0
    assert report["index_step_2011_to_2013_pct"] == 0.0
    assert report["aqua_step_2011_to_2013_pct"] == 0.0
    assert report["median_abs_error_pct"] == 0.0


def test_the_running_month_is_flagged_partial() -> None:
    counts = [(2026, 11, TAIL, 700)]
    coverage = {PRIMARY: {202611: 2}, TAIL: {202611: 14}, REFERENCE: {202611: 14}}
    calibration = build_calibration([], {}, last_complete_year=2025)
    rows = build_calendar(counts, coverage, calibration, latest=(2026, 11))
    assert len(rows) == 1
    assert rows[0]["source"] == TAIL
    assert rows[0]["partial"] is True
    assert rows[0]["observed_days"] == 14
    assert rows[0]["harmonized_index"] is not None


# --------------------------------------------------------------- the contract


def _row(day: int, sensor: str, satellite: str, confidence: str, pct: int | None, type_: int | None) -> str:
    return (
        f"(TIMESTAMP '2013-07-{day:02d} 13:00:00', DATE '2013-07-{day:02d}', "
        f"{sql_literal(sensor)}, {sql_literal(satellite)}, 'D', 'sp', '6.1NRT', "
        f"{'NULL' if type_ is None else type_}, {sql_literal(confidence)}, "
        f"{'NULL' if pct is None else pct}, 40.0, -3.5, 12.5, 1.0, 1.0)"
    )


def _write_synthetic_cache(root: Path) -> None:
    """One region-year with the rows the filter has to separate."""
    cache = root / "cache" / "testregion"
    cache.mkdir(parents=True)
    rows = [
        _row(1, "MODIS", "Aqua", "80", 80, 0),  # kept
        _row(2, "MODIS", "Aqua", "10", 10, 0),  # dropped: MODIS below 30
        _row(3, "MODIS", "Aqua", "40", 40, 0),  # kept
        _row(4, "MODIS", "Terra", "50", 50, 0),  # kept
        _row(5, "VIIRS_SNPP", PRIMARY, "h", None, 0),  # kept
        _row(6, "VIIRS_SNPP", PRIMARY, "l", None, 0),  # dropped: low confidence band
        _row(7, "VIIRS_SNPP", PRIMARY, "n", None, 0),  # kept
        _row(8, "VIIRS_SNPP", PRIMARY, "h", None, 2),  # dropped: static source
        _row(9, "VIIRS_SNPP", PRIMARY, "h", None, None),  # kept: near-real-time has no type
    ]
    con = duckdb.connect()
    try:
        con.execute(
            f"""COPY (SELECT * FROM (VALUES {", ".join(rows)})
                    AS t(acq_datetime, acq_date, sensor, satellite, daynight, quality, version,
                         type, confidence, confidence_pct, lat, lon, frp, scan, track))
                TO {sql_literal((cache / "2013.parquet").as_posix())} (FORMAT parquet)"""
        )
        days = ", ".join(
            f"({sql_literal(sensor)}, DATE '2013-07-{day:02d}')"
            for sensor in ("MODIS_A", "MODIS_T", "VIIRS_SNPP")
            for day in range(1, 32)
        )
        con.execute(
            f"""COPY (SELECT * FROM (VALUES {days}) AS t(sensor, acq_date))
                TO {sql_literal((root / "sensor_days.parquet").as_posix())} (FORMAT parquet)"""
        )
    finally:
        con.close()


def test_the_filter_applies_to_the_rows_the_calendar_counts() -> None:
    with tempfile.TemporaryDirectory() as tmp:
        root = Path(tmp)
        _write_synthetic_cache(root)
        con = duckdb.connect()
        try:
            counts = monthly_counts(con, "testregion", data_dir=root)
        finally:
            con.close()
    per_satellite = {(year, month, satellite): n for year, month, satellite, n in counts}
    assert per_satellite == {
        (2013, 7, "Aqua"): 2,
        (2013, 7, "Terra"): 1,
        (2013, 7, PRIMARY): 3,
    }


def test_write_artifacts_produces_the_contract_the_api_reads() -> None:
    with tempfile.TemporaryDirectory() as tmp:
        root = Path(tmp)
        _write_synthetic_cache(root)
        con = duckdb.connect()
        try:
            counts = monthly_counts(con, "testregion", data_dir=root)
            coverage = load_coverage(con, data_dir=root)
            calibration = build_calibration(counts, coverage, last_complete_year=2013)
            rows = build_calendar(counts, coverage, calibration, latest=(2013, 7))
            validation = validate(rows, last_complete_year=2013)
            usable = [row for row in rows if row["harmonized_index"] is not None]
            payload = write_artifacts(
                con,
                "testregion",
                usable,
                calibration,
                validation,
                {"first_month": "2013-07", "last_month": "2013-07"},
                data_dir=root,
            )
        finally:
            con.close()

        calendar = root / "processed" / "calendar" / "testregion.parquet"
        hotspots = root / "processed" / "hotspots" / "testregion.parquet"
        assert calendar.exists() and hotspots.exists()
        assert (root / "processed" / "method.json").exists()
        assert payload["rows"] == 1

        con = duckdb.connect()
        try:
            calendar_columns = [row[0] for row in con.execute(
                f"SELECT * FROM read_parquet({sql_literal(calendar.as_posix())}) LIMIT 0"
            ).description]
            assert {"harmonized_index", "raw_count", "source", "partial", "provisional"} <= set(calendar_columns)

            total, high, modis80 = con.execute(
                f"""SELECT count(*),
                           count(*) FILTER (WHERE confidence_score = 0.9),
                           count(*) FILTER (WHERE confidence_score = 0.8)
                    FROM read_parquet({sql_literal(hotspots.as_posix())})"""
            ).fetchone()
        finally:
            con.close()

        assert total == 6  # the three rejected rows never reach the export
        assert high == 2  # two retained rows with a VIIRS 'h' band
        assert modis80 == 1  # MODIS 80 maps to 0.8, not to 80

        method = json.loads((root / "processed" / "method.json").read_text(encoding="utf-8"))
        assert method["units"].startswith("harmonized activity index")
        assert "limitations" in method and method["validation"]["median_abs_error_pct"] is not None


def test_the_detection_query_never_globs_the_aggregate_files() -> None:
    sql = detection_query("iberia")
    assert sql.count("*.parquet") == 1
    assert "confidence_pct >= 30" in sql and "confidence <> 'l'" in sql
    assert "coalesce(type, 0) = 0" in sql


def _run_all() -> None:
    failures = 0
    for name, fn in sorted(globals().items()):
        if name.startswith("test_") and callable(fn):
            try:
                fn()
                print(f"PASS {name}")
            except Exception as exc:  # noqa: BLE001 - test runner
                failures += 1
                print(f"FAIL {name}: {exc}")
    if failures:
        raise SystemExit(f"{failures} failing test(s)")
    print("all harmonize tests passed")


if __name__ == "__main__":
    _run_all()
