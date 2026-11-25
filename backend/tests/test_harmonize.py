"""Tests for the harmonizer: the calibration maths and the artifact contract.

The claim of the project is that a monthly factor removes the satellite step.
That claim is only worth something if the factor is measured on the right set of
months and if the filter is applied to the same rows the calendar counts, so both
are pinned here without touching the network:

    python -m tests.test_harmonize

or with pytest if it is installed.
"""

from __future__ import annotations

import io
import json
import tempfile
from contextlib import redirect_stdout
from pathlib import Path

import duckdb
import pandas as pd

from firetrack.pipeline.firms import sql_literal
from firetrack.pipeline.harmonize import (
    DETECTION_ORDER,
    MIN_DAYS_FRACTION,
    OVERLAP_FIRST,
    PRIMARY,
    REFERENCE,
    TAIL,
    build_calendar,
    build_calibration,
    days_in_month,
    detection_query,
    holdout,
    is_complete,
    last_observed_month,
    load_coverage,
    load_region,
    main,
    month_key,
    monthly_counts,
    pick_source,
    pooled_ratio,
    running_month,
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


def test_the_running_month_stays_partial_after_sixty_percent_of_its_days() -> None:
    """Day 20 of a 30-day month: 20 observed days pass the 60 % threshold.

    The threshold answers "did the sensor fly enough", not "did the month end".
    A running month that passes it must still be partial, or the calendar
    compares a half-finished count against a full-month median.
    """
    counts = [(2026, 11, TAIL, 700)]
    coverage = {PRIMARY: {202611: 0}, TAIL: {202611: 20}, REFERENCE: {202611: 20}}
    calibration = build_calibration([], {}, last_complete_year=2025)
    assert is_complete(20, 2026, 11)  # the threshold alone calls it complete
    rows = build_calendar(counts, coverage, calibration, latest=(2026, 11))
    assert rows[0]["partial"] is True


def test_a_finished_month_is_not_partial_when_the_data_already_moved_on() -> None:
    """A complete month is not the running one just because it is the last with detections."""
    counts = [(2026, 10, TAIL, 700)]
    coverage = {
        PRIMARY: {202610: 31, 202611: 15},
        TAIL: {202610: 31, 202611: 15},
        REFERENCE: {202610: 31, 202611: 15},
    }
    calibration = build_calibration([], {}, last_complete_year=2025)
    rows = build_calendar(counts, coverage, calibration, latest=(2026, 11))
    assert rows[0]["partial"] is False


def test_the_running_month_is_the_later_of_the_data_and_the_region() -> None:
    counts = [(2026, 10, TAIL, 1)]
    assert running_month(counts, (2026, 11)) == (2026, 11)
    assert running_month(counts, (2026, 9)) == (2026, 10)
    assert running_month(counts, None) == (2026, 10)


def test_the_last_observed_month_comes_from_the_sensor_days_table() -> None:
    with tempfile.TemporaryDirectory() as tmp:
        root = Path(tmp)
        _write_synthetic_cache(root)
        con = duckdb.connect()
        try:
            assert last_observed_month(con, data_dir=root) == (2013, 7)
            assert last_observed_month(con, data_dir=root / "missing") is None
        finally:
            con.close()


def test_the_last_observed_month_leaves_the_connection_usable() -> None:
    """A half-consumed DuckDB result blocks the next ``register()`` on that connection.

    ``last_observed_month`` runs in the same connection the writer later uses, so
    it has to consume its result completely; ``fetchone()`` leaves it open and
    ``write_artifacts`` then fails with ``ResourceInUseException``.
    """
    with tempfile.TemporaryDirectory() as tmp:
        root = Path(tmp)
        _write_synthetic_cache(root)
        con = duckdb.connect()
        try:
            assert last_observed_month(con, data_dir=root) == (2013, 7)
            con.register("calendar_rows", pd.DataFrame({"year": [2013]}))
            assert con.execute("select count(*) from calendar_rows").fetchall() == [(1,)]
        finally:
            con.close()


def test_main_refuses_to_run_without_sensor_coverage() -> None:
    """No ``sensor_days`` table: an actionable message, not a pandas ``KeyError``.

    Without coverage every month has no source, so the usable calendar is empty
    and the writer used to fail on ``sort_values`` with a bare ``KeyError``.
    """
    import firetrack.pipeline.harmonize as harmonize

    with tempfile.TemporaryDirectory() as tmp:
        root = Path(tmp)
        _write_synthetic_cache(root)
        (root / "sensor_days.parquet").unlink()
        original = harmonize.DATA
        harmonize.DATA = root
        out = io.StringIO()
        try:
            with redirect_stdout(out):
                code = main(["testregion"])
        finally:
            harmonize.DATA = original
    assert code == 2, out.getvalue()
    assert "sensor_days" in out.getvalue()
    assert "firetrack.pipeline.firms" in out.getvalue()


def test_write_artifacts_refuses_an_empty_calendar() -> None:
    with tempfile.TemporaryDirectory() as tmp:
        con = duckdb.connect()
        try:
            try:
                write_artifacts(con, "testregion", [], {}, {}, {}, data_dir=Path(tmp))
            except ValueError as exc:
                assert "no usable months" in str(exc)
            else:
                raise AssertionError("an empty calendar must be refused, not written")
        finally:
            con.close()


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
        assert (root / "processed" / "method" / "testregion.json").exists()
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

        method = json.loads((root / "processed" / "method" / "testregion.json").read_text(encoding="utf-8"))
        assert method["units"].startswith("harmonized activity index")
        assert "limitations" in method and method["validation"]["median_abs_error_pct"] is not None


def test_the_detection_query_never_globs_the_aggregate_files() -> None:
    sql = detection_query("iberia")
    assert sql.count("*.parquet") == 1
    assert "confidence_pct >= 30" in sql and "confidence <> 'l'" in sql
    assert "coalesce(type, 0) = 0" in sql


# ------------------------------------------- boundary, borrowed shape, blind test


def test_load_region_clips_every_count_to_the_boundary() -> None:
    # A square around the synthetic rows (40.0, -3.5) and one that misses them.
    around = [[[[-4.0, 39.5], [-3.0, 39.5], [-3.0, 40.5], [-4.0, 40.5], [-4.0, 39.5]]]]
    elsewhere = [[[[0.0, 39.5], [1.0, 39.5], [1.0, 40.5], [0.0, 40.5], [0.0, 39.5]]]]
    with tempfile.TemporaryDirectory() as tmp:
        root = Path(tmp)
        _write_synthetic_cache(root)
        con = duckdb.connect()
        try:
            view, stats = load_region(con, "testregion", data_dir=root, polygons=around)
            assert stats == {"in_bbox": 6, "in_boundary": 6}
            assert sum(n for *_k, n in monthly_counts(con, "testregion", relation=view)) == 6
            view, stats = load_region(con, "testregion", data_dir=root, polygons=elsewhere)
            assert stats == {"in_bbox": 6, "in_boundary": 0}
            assert monthly_counts(con, "testregion", relation=view) == []
        finally:
            con.close()


def _seasonal_counts(ratio_by_month: dict[int, float], aqua: int) -> list[tuple]:
    counts = []
    for year in (2012, 2013, 2014, 2015):
        for month, ratio in ratio_by_month.items():
            counts.append((year, month, REFERENCE, aqua))
            counts.append((year, month, PRIMARY, round(aqua * ratio)))
    return counts


def _coverage_for(years, months) -> dict[str, dict[int, int]]:
    return {
        sensor: {year * 100 + month: days_in_month(year, month) for year in years for month in months}
        for sensor in (REFERENCE, PRIMARY, TAIL)
    }


def test_a_small_region_borrows_the_seasonal_shape_of_a_larger_one() -> None:
    years, months = (2012, 2013, 2014, 2015), (1, 7)
    coverage = _coverage_for(years, months)
    # The large region: July sees twice the ratio of January.
    parent = build_calibration(_seasonal_counts({1: 3.0, 7: 6.0}, 500), coverage, last_complete_year=2015)
    # The small region: one Aqua detection per month, the same ratio in both months.
    small = _seasonal_counts({1: 4.5, 7: 4.5}, 1)
    flat = build_calibration(small, coverage, last_complete_year=2015)
    shaped = build_calibration(small, coverage, last_complete_year=2015, prior_calibration={**parent, "region": "big"})
    assert flat["monthly"]["01"]["factor"] == flat["monthly"]["07"]["factor"]
    assert shaped["monthly"]["07"]["factor"] > shaped["monthly"]["01"]["factor"]
    assert shaped["pooled"] == flat["pooled"]  # the level stays the small region's own
    assert shaped["prior"] == {"region": "big", "pooled": parent["pooled"]}
    assert flat["prior"] is None


def test_the_blind_test_is_fitted_only_before_the_hidden_years() -> None:
    years, months = range(2012, 2021), (7,)
    coverage = _coverage_for(years, months)
    counts = []
    for year in years:
        counts.append((year, 7, REFERENCE, 100))
        # VIIRS sees 3x until 2016 and 6x afterwards: an in-sample fit would hide it.
        counts.append((year, 7, PRIMARY, 300 if year <= 2016 else 600))
    report = holdout(counts, coverage)
    assert report["train"] == ["2012-02", "2016-12"] and report["test"] == ["2017-01", "2020-12"]
    assert report["calibration"]["monthly"]["07"]["factor"] == 3.0
    assert report["months"] == 4
    assert report["error_pct"] == 100.0  # 600 / 3 = 200 against 100 Aqua
    assert report["raw_error_pct"] == 500.0
    assert holdout(counts, coverage, test=(2030, 2031)) is None


def test_the_blind_test_reports_month_order_with_spearman() -> None:
    years, months = range(2012, 2021), (1, 4, 7, 10)
    coverage = _coverage_for(years, months)
    counts = []
    for year in years:
        for month, aqua in ((1, 10), (4, 40), (7, 90), (10, 30)):
            counts.append((year, month, REFERENCE, aqua))
            counts.append((year, month, PRIMARY, aqua * 4))
    report = holdout(counts, coverage)
    assert report["spearman_monthly"] > 0.9
    assert report["error_pct"] == 0.0


def test_the_hotspot_export_has_a_total_row_order() -> None:
    """Detections of one overpass share a minute; the export must not depend on read order."""
    def row(sat: str, lat: float, lon: float) -> str:
        sensor = "MODIS" if sat in ("Aqua", "Terra") else "VIIRS_SNPP"
        return (
            f"(TIMESTAMP '2013-07-05 13:00:00', DATE '2013-07-05', {sql_literal(sensor)}, {sql_literal(sat)}, "
            f"'D', 'sp', '6.1', 0, 'n', {80 if sensor == 'MODIS' else 'NULL'}, {lat}, {lon}, 10.0, 1.0, 1.0)"
        )
    # Written out of order on purpose.
    rows = [row(PRIMARY, 41.2, -1.0), row("Aqua", 40.5, -2.0), row(PRIMARY, 40.1, -3.0), row("Aqua", 40.5, -4.0)]
    expected = [("Aqua", 40.5, -4.0), ("Aqua", 40.5, -2.0), (PRIMARY, 40.1, -3.0), (PRIMARY, 41.2, -1.0)]
    assert "acq_datetime, satellite, latitude, longitude" in DETECTION_ORDER
    with tempfile.TemporaryDirectory() as tmp:
        root = Path(tmp)
        cache = root / "cache" / "orderregion"
        cache.mkdir(parents=True)
        con = duckdb.connect()
        try:
            con.execute(
                f"""COPY (SELECT * FROM (VALUES {", ".join(rows)})
                        AS t(acq_datetime, acq_date, sensor, satellite, daynight, quality, version,
                             type, confidence, confidence_pct, lat, lon, frp, scan, track))
                    TO {sql_literal((cache / "2013.parquet").as_posix())} (FORMAT parquet)"""
            )
            write_artifacts(
                con, "orderregion", [{"year": 2013, "month": 7, "harmonized_index": 1.0}],
                {"prior": None}, {}, {}, data_dir=root,
            )
            got = con.execute(
                f"""SELECT satellite, latitude, longitude
                    FROM read_parquet({sql_literal((root / "processed" / "hotspots" / "orderregion.parquet").as_posix())})"""
            ).fetchall()
        finally:
            con.close()
    got = [(sat, float(lat), float(lon)) for sat, lat, lon in got]
    assert got == expected, got


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
