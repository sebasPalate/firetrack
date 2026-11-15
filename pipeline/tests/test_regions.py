"""Tests for the demo regions and their boundaries.

The boundary decides which detections count, so a wrong file or a broken
point-in-polygon test would silently move fires in or out of the calendar.
Run with:

    python -m pipeline.tests.test_regions

or with pytest if it is installed.
"""

from __future__ import annotations

from pipeline.regions import contains, geometry_bounds, load_geometry, load_regions

#: (lon, lat, in Spain, in Aragón). City centres and enclaves, all far from a border
#: compared with the ~300 m simplification of the boundary files.
CONTROL_POINTS = {
    "Zaragoza": (-0.8891, 41.6488, True, True),
    "Huesca": (-0.4087, 42.1401, True, True),
    "Teruel": (-1.1065, 40.3457, True, True),
    "Madrid": (-3.7038, 40.4168, True, False),
    "Valencia": (-0.3763, 39.4699, True, False),
    "Lleida": (0.6200, 41.6176, True, False),
    "Tarifa": (-5.6046, 36.0128, True, False),
    "Palma": (2.6502, 39.5696, True, False),
    "Mahón": (4.2650, 39.8885, True, False),
    "Llívia (enclave in France)": (1.9806, 42.4636, True, False),
    "Lisboa": (-9.1393, 38.7223, False, False),
    "Porto": (-8.6291, 41.1579, False, False),
    "Andorra la Vella": (1.5218, 42.5063, False, False),
    "Perpignan": (2.8948, 42.6887, False, False),
    "Ceuta (left out)": (-5.3213, 35.8894, False, False),
    "Las Palmas (left out)": (-15.4134, 28.1235, False, False),
}


def test_demo_regions_are_spain_and_aragon() -> None:
    assert sorted(load_regions()) == ["aragon", "spain"]


def test_every_region_has_a_closed_boundary() -> None:
    for rid, region in load_regions().items():
        polygons = load_geometry(region)
        assert polygons, rid
        for polygon in polygons:
            for ring in polygon:
                assert len(ring) >= 4 and ring[0] == ring[-1], f"{rid}: ring not closed"


def test_boundary_fits_inside_its_bbox() -> None:
    for rid, region in load_regions().items():
        west, south, east, north = region["bbox"]
        x0, y0, x1, y1 = geometry_bounds(load_geometry(region))
        assert west <= x0 and south <= y0 and x1 <= east and y1 <= north, rid


def test_control_points() -> None:
    regions = load_regions()
    spain, aragon = load_geometry(regions["spain"]), load_geometry(regions["aragon"])
    for name, (lon, lat, in_spain, in_aragon) in CONTROL_POINTS.items():
        assert contains(spain, lon, lat) is in_spain, f"{name}: spain"
        assert contains(aragon, lon, lat) is in_aragon, f"{name}: aragon"


def test_holes_are_excluded() -> None:
    square = [[[0, 0], [10, 0], [10, 10], [0, 10], [0, 0]], [[4, 4], [6, 4], [6, 6], [4, 6], [4, 4]]]
    assert contains([square], 2, 2)
    assert not contains([square], 5, 5)
    assert not contains([square], 11, 5)


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
    print("all region tests passed")


if __name__ == "__main__":
    _run_all()
