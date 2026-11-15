"""Tests for the pure parts of the FIRMS ingest (Portolan mirror).

The bounding box, the query and the cache freshness rule decide whether a region
silently loses detections or keeps a stale current year, so they are pinned here
without touching the network. Run with:

    python -m pipeline.tests.test_firms

or with pytest if it is installed.
"""

from __future__ import annotations

import tempfile
from pathlib import Path

from pipeline.firms import (
    BASE,
    CONF_SQL,
    FIRST_YEAR,
    LIVE_TTL_S,
    _fresh,
    bbox_predicate,
    cache_path,
    plan_years,
    sql_literal,
    year_select,
    year_url,
)
from pipeline.regions import envelopes, load_regions, validate_bbox


def test_plain_bbox_is_one_envelope() -> None:
    assert envelopes((-10, 35.5, 4, 44)) == [(-10.0, 35.5, 4.0, 44.0)]


def test_antimeridian_bbox_is_split_in_two() -> None:
    assert envelopes((170, -20, -170, -10)) == [(170.0, -20.0, 180.0, -10.0), (-180.0, -20.0, -170.0, -10.0)]


def test_invalid_bboxes_raise() -> None:
    for bad in ((0, 10, 5, 5), (0, 0, 0, 5), (-200, 0, 5, 5), (0, -95, 5, 5), (1, 2, 3)):
        try:
            validate_bbox(bad)
        except ValueError:
            continue
        raise AssertionError(f"expected ValueError for bbox={bad!r}")


def test_every_configured_region_is_valid() -> None:
    regions = load_regions()
    assert regions, "data/regions.json has no regions"
    for rid, region in regions.items():
        assert len(region["bbox"]) == 4, rid


def test_predicate_has_one_envelope_per_box() -> None:
    assert bbox_predicate((-10, 35.5, 4, 44)).count("ST_MakeEnvelope") == 1
    split = bbox_predicate((170, -20, -170, -10))
    assert split.count("ST_MakeEnvelope") == 2 and " OR " in split


def test_query_reads_one_detections_file_and_recovers_coordinates() -> None:
    sql = year_select((-10, 35.5, 4, 44), 2016, base="https://example.test/detections")
    assert "'https://example.test/detections/year=2016/detections.parquet'" in sql
    assert "*.parquet" not in sql  # the year folders also hold aggregates with another schema
    assert "ST_Y(geometry)" in sql and "ST_X(geometry)" in sql
    assert "confidence" in sql and "quality" in sql and "version" in sql


def test_default_source_is_the_portolan_mirror() -> None:
    assert "portolan-mirrors/firms-catalog/detections" in BASE
    assert year_url(2020).endswith("/year=2020/detections.parquet")


def test_confidence_filter_never_mixes_scales() -> None:
    assert "confidence_pct >= 30" in CONF_SQL and "confidence <> 'l'" in CONF_SQL


def test_sql_literal_escapes_quotes() -> None:
    assert sql_literal("C:/data/o'brien.parquet") == "'C:/data/o''brien.parquet'"


def test_plan_years_is_clamped_to_the_record() -> None:
    assert plan_years(None, None, this_year=2026) == list(range(FIRST_YEAR, 2027))
    assert plan_years(1995, 2001, this_year=2026) == [2000, 2001]
    assert plan_years(2024, 2030, this_year=2026) == [2024, 2025, 2026]
    try:
        plan_years(2020, 2019, this_year=2026)
    except ValueError:
        return
    raise AssertionError("expected ValueError for an empty year range")


def test_cache_is_one_file_per_region_and_year() -> None:
    assert cache_path("spain", 2016, Path("data/cache")) == Path("data/cache/spain/2016.parquet")


def test_freshness_rule() -> None:
    with tempfile.TemporaryDirectory() as tmp:
        path = Path(tmp) / "2016.parquet"
        assert not _fresh(path, 2016, this_year=2026)  # a missing file is never fresh
        path.write_bytes(b"x")
        written = path.stat().st_mtime
        a_month_later = written + 30 * 24 * 3600
        assert _fresh(path, 2016, this_year=2026, now=a_month_later)  # a finished year never expires
        assert not _fresh(path, 2026, this_year=2026, now=a_month_later)  # the running year does
        assert _fresh(path, 2026, this_year=2026, now=written + LIVE_TTL_S - 60)
        assert not _fresh(path, 2026, this_year=2026, now=written + LIVE_TTL_S + 60)


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
    print("all firms tests passed")


if __name__ == "__main__":
    _run_all()
