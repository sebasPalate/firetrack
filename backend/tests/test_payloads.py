"""Tests for the payloads shared by the API and the static export.

    python -m tests.test_payloads
"""

from __future__ import annotations

import csv
import io

from firetrack.contract.payloads import calendar_payload, csv_cell, detections_csv, public_region

REGION = {"id": "x", "name": "X", "bbox": (0.0, 0.0, 1.0, 1.0), "why": "test", "geometry": "data/aoi/x.geojson"}


def _row(year, month, index, partial=False, provisional=False):
    return {
        "year": year, "month": month, "harmonized_index": index, "raw_count": 10, "source": "Aqua",
        "factor": 1.0, "observed_days": 31, "partial": partial, "provisional": provisional,
    }


def test_calendar_is_a_month_by_year_matrix() -> None:
    payload = calendar_payload(REGION, [_row(2021, 7, 30.0), _row(2020, 7, 10.0), _row(2020, 1, 2.0)])
    assert payload["years"] == [2020, 2021]
    assert len(payload["harmonized"]) == 12
    assert payload["harmonized"][6] == [10.0, 30.0]
    assert payload["harmonized"][0] == [2.0, None]
    assert payload["region"]["bbox"] == [0.0, 0.0, 1.0, 1.0]


def test_partial_and_provisional_months_never_set_the_median() -> None:
    rows = [_row(2019, 7, 10.0), _row(2020, 7, 20.0), _row(2021, 7, 900.0, provisional=True), _row(2022, 7, 1.0, partial=True)]
    payload = calendar_payload(REGION, rows)
    assert payload["median_by_month"][7] == 15.0
    assert payload["anomaly_pct"][6][2] == 5900.0  # provisional: served, compared, not fitted
    assert payload["anomaly_pct"][6][3] is None  # partial: never read as an anomaly


def test_public_region_and_csv() -> None:
    assert public_region(REGION)["geometry"] == "data/aoi/x.geojson"
    assert "geometry" not in public_region({**REGION, "geometry": None})
    assert csv_cell(None) == "" and csv_cell("a,b") == '"a,b"' and csv_cell(3) == "3"
    assert detections_csv(["a", "b"], [(1, None), (2, "x")]) == "a,b\n1,\n2,x\n"
    assert detections_csv(["a"], []) == "a\n"


def test_csv_cell_escapes_quotes_and_line_breaks() -> None:
    """RFC 4180: a field is quoted when it holds a comma, a quote or a newline."""
    assert csv_cell('say "hi"') == '"say ""hi"""'
    assert csv_cell("a\nb") == '"a\nb"'
    assert csv_cell("a\r\nb") == '"a\r\nb"'
    assert csv_cell("plain") == "plain"


def test_detections_csv_round_trips_through_the_standard_parser() -> None:
    """The served CSV must be readable by any RFC 4180 parser, not just by eye."""
    text = detections_csv(["a", "b"], [(1, 'x,"y"'), (2, "line\nbreak")])
    assert list(csv.reader(io.StringIO(text))) == [
        ["a", "b"],
        ["1", 'x,"y"'],
        ["2", "line\nbreak"],
    ]


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
    print("all payload tests passed")


if __name__ == "__main__":
    _run_all()
