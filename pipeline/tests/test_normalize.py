"""Tests for the sensor-agnostic confidence handling.

MODIS reports `confidence` as 0-100 and VIIRS reports l/n/h. Filtering without
normalising them is the silent bug that ruins a series (risk R5), so the mapping
is pinned here — and pinned twice, because the pipeline filters in SQL and
exports in Python from the same table.
"""

from __future__ import annotations

import duckdb

from pipeline.normalize import confidence_score_sql, normalize_confidence


def test_modis_numeric_confidence_is_scaled() -> None:
    assert normalize_confidence(0) == 0.0
    assert normalize_confidence(50) == 0.5
    assert normalize_confidence(100) == 1.0
    assert normalize_confidence("80") == 0.8


def test_viirs_categorical_confidence_maps_to_band_midpoints() -> None:
    assert normalize_confidence("l") == 0.3
    assert normalize_confidence("n") == 0.6
    assert normalize_confidence("h") == 0.9
    assert normalize_confidence("H") == 0.9


def test_missing_confidence_is_none() -> None:
    assert normalize_confidence("") is None
    assert normalize_confidence(None) is None


def test_unknown_confidence_raises_instead_of_defaulting() -> None:
    try:
        normalize_confidence("medium")
    except ValueError:
        return
    raise AssertionError("expected ValueError for an unknown confidence label")


def test_sql_and_python_confidence_agree() -> None:
    """The SQL export and the Python helper must never disagree on a valid value."""
    sql = confidence_score_sql("sensor", "confidence")
    con = duckdb.connect()
    cases = [
        ("MODIS", "0"),
        ("MODIS", "30"),
        ("MODIS", "80"),
        ("MODIS", "100"),
        ("VIIRS_SNPP", "l"),
        ("VIIRS_SNPP", "n"),
        ("VIIRS_SNPP", "h"),
        ("VIIRS_SNPP", "H"),
    ]
    for sensor, confidence in cases:
        value = con.execute(
            f"SELECT {sql} FROM (SELECT ? AS sensor, ? AS confidence)", [sensor, confidence]
        ).fetchone()[0]
        expected = normalize_confidence(confidence)
        assert value == expected, (sensor, confidence, value, expected)
    con.close()


def test_sql_confidence_never_leaves_the_unit_interval() -> None:
    sql = confidence_score_sql("sensor", "confidence")
    con = duckdb.connect()
    for sensor, confidence in (("MODIS", "250"), ("MODIS", "-40"), ("VIIRS_SNPP", "medium"), ("VIIRS_SNPP", "")):
        value = con.execute(
            f"SELECT {sql} FROM (SELECT ? AS sensor, ? AS confidence)", [sensor, confidence]
        ).fetchone()[0]
        assert value is None or 0.0 <= value <= 1.0, (sensor, confidence, value)
    con.close()


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
    print("all normalization tests passed")


if __name__ == "__main__":
    _run_all()
