"""Tests for the pure parts of the FIRMS plumbing.

The date chunking decides whether we silently lose days of the record, so it is
tested without touching the network. Run with:

    python -m pipeline.tests.test_chunking
    python -m pipeline.tests.test_normalize

or with pytest if it is installed.
"""

from __future__ import annotations

from datetime import date, timedelta

from pipeline.firms import MAX_DAY_RANGE, chunk_date_range


def test_single_day_is_one_window() -> None:
    assert chunk_date_range(date(2020, 1, 1), date(2020, 1, 1)) == [
        (date(2020, 1, 1), date(2020, 1, 1))
    ]


def test_exactly_one_full_window() -> None:
    assert chunk_date_range(date(2020, 1, 1), date(2020, 1, 5)) == [
        (date(2020, 1, 1), date(2020, 1, 5))
    ]


def test_one_day_over_spills_into_second_window() -> None:
    assert chunk_date_range(date(2020, 1, 1), date(2020, 1, 6)) == [
        (date(2020, 1, 1), date(2020, 1, 5)),
        (date(2020, 1, 6), date(2020, 1, 6)),
    ]


def test_default_window_never_exceeds_api_limit() -> None:
    assert MAX_DAY_RANGE == 5


def test_full_record_is_contiguous_exhaustive_and_bounded() -> None:
    start, end = date(2000, 11, 1), date(2026, 11, 10)
    windows = chunk_date_range(start, end)

    assert all((b - a).days + 1 <= MAX_DAY_RANGE for a, b in windows)
    assert windows[0][0] == start
    assert windows[-1][1] == end
    for (_, previous_end), (next_start, _) in zip(windows, windows[1:]):
        assert next_start == previous_end + timedelta(days=1)

    covered = sum((b - a).days + 1 for a, b in windows)
    assert covered == (end - start).days + 1


def test_custom_max_days() -> None:
    assert chunk_date_range(date(2020, 1, 1), date(2020, 1, 5), max_days=2) == [
        (date(2020, 1, 1), date(2020, 1, 2)),
        (date(2020, 1, 3), date(2020, 1, 4)),
        (date(2020, 1, 5), date(2020, 1, 5)),
    ]


def test_start_after_end_raises() -> None:
    try:
        chunk_date_range(date(2020, 1, 2), date(2020, 1, 1))
    except ValueError:
        return
    raise AssertionError("expected ValueError when start > end")


def test_invalid_max_days_raises() -> None:
    for bad in (0, -1, 6):
        try:
            chunk_date_range(date(2020, 1, 1), date(2020, 1, 2), max_days=bad)
        except ValueError:
            continue
        raise AssertionError(f"expected ValueError for max_days={bad}")


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
    print("all chunking tests passed")


if __name__ == "__main__":
    _run_all()
