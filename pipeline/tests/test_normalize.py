"""Tests for the sensor-agnostic normalisation of FIRMS rows.

MODIS reports `confidence` as 0-100 and VIIRS reports l/n/h. Filtering without
normalising them is the silent bug that ruins a series (risk R5), so the mapping
is pinned here.
"""

from __future__ import annotations

from pipeline.normalize import normalize_confidence, parse_acq_time


def test_acq_time_pads_unpadded_values() -> None:
    assert parse_acq_time("0") == "00:00"
    assert parse_acq_time("5") == "00:05"
    assert parse_acq_time("930") == "09:30"


def test_acq_time_parses_full_values() -> None:
    assert parse_acq_time("1342") == "13:42"
    assert parse_acq_time("2359") == "23:59"
    assert parse_acq_time(1342) == "13:42"


def test_acq_time_rejects_garbage() -> None:
    for bad in ("", "2461", "abcd", "-1", None):
        try:
            parse_acq_time(bad)
        except ValueError:
            continue
        raise AssertionError(f"expected ValueError for acq_time={bad!r}")


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
