"""Areas of interest, shared by the pipeline and the API.

The list lives in ``data/regions.json``. Each region has:

* ``bbox`` = (west, south, east, north), degrees, CRS84. This is what the ingest
  reads from the mirror, because a box is what the mirror's row-group bounds can
  prune on.
* ``geometry``: path (from the repository root) to a GeoJSON file with the official
  boundary. Detections are clipped to it when the calendar is built, so a box
  around Spain does not count fires in Portugal, Andorra or France.

The demo regions are Spain (mainland and Balearic Islands) and Aragón, with
boundaries from the Instituto Geografico Nacional via geoBoundaries (CC BY 4.0).
"""

from __future__ import annotations

import json
from pathlib import Path

REPO_ROOT = Path(__file__).resolve().parents[1]
REGIONS_PATH = REPO_ROOT / "data" / "regions.json"

#: A polygon is a list of rings (outer ring first, then holes); a ring is a list of
#: [lon, lat] points with the first point repeated at the end.
Polygon = list[list[list[float]]]


def load_regions(path: Path | None = None) -> dict[str, dict]:
    """Regions by id, with each bbox validated."""
    payload = json.loads(Path(path or REGIONS_PATH).read_text(encoding="utf-8"))
    regions = {}
    for region in payload["regions"]:
        regions[region["id"]] = {**region, "bbox": validate_bbox(region["bbox"])}
    return regions


def validate_bbox(bbox) -> tuple[float, float, float, float]:
    """Return a clean (west, south, east, north) or raise ValueError.

    ``west > east`` means the box crosses the antimeridian, which is allowed.
    """
    if len(bbox) != 4:
        raise ValueError(f"bbox needs 4 numbers (west, south, east, north), got {bbox!r}")
    west, south, east, north = (float(v) for v in bbox)
    if not (-180 <= west <= 180 and -180 <= east <= 180):
        raise ValueError(f"longitude out of range in {bbox!r}")
    if not (-90 <= south < north <= 90):
        raise ValueError(f"latitude out of range or south >= north in {bbox!r}")
    if west == east:
        raise ValueError(f"bbox has zero width: {bbox!r}")
    return (west, south, east, north)


def envelopes(bbox) -> list[tuple[float, float, float, float]]:
    """Split an antimeridian-crossing box into two ordinary ones."""
    west, south, east, north = validate_bbox(bbox)
    if west < east:
        return [(west, south, east, north)]
    return [(west, south, 180.0, north), (-180.0, south, east, north)]


# ---------------------------------------------------------------- boundaries


def geometry_path(region: dict) -> Path:
    if not region.get("geometry"):
        raise ValueError(f"region {region.get('id')!r} has no geometry")
    return REPO_ROOT / region["geometry"]


def load_geometry(region: dict) -> list[Polygon]:
    """The region boundary as a list of polygons (a MultiPolygon's coordinates)."""
    payload = json.loads(geometry_path(region).read_text(encoding="utf-8"))
    if payload.get("type") == "FeatureCollection":
        geometries = [feature["geometry"] for feature in payload["features"]]
    elif payload.get("type") == "Feature":
        geometries = [payload["geometry"]]
    else:
        geometries = [payload]
    polygons: list[Polygon] = []
    for geometry in geometries:
        if geometry["type"] == "Polygon":
            polygons.append(geometry["coordinates"])
        elif geometry["type"] == "MultiPolygon":
            polygons.extend(geometry["coordinates"])
        else:
            raise ValueError(f"unsupported geometry type {geometry['type']!r}")
    return polygons


def geometry_bounds(polygons: list[Polygon]) -> tuple[float, float, float, float]:
    xs = [x for polygon in polygons for x, _ in polygon[0]]
    ys = [y for polygon in polygons for _, y in polygon[0]]
    return (min(xs), min(ys), max(xs), max(ys))


def _in_ring(lon: float, lat: float, ring) -> bool:
    """Even-odd ray casting. Points exactly on an edge may fall either way, which
    is far below the size of a MODIS or VIIRS pixel."""
    inside = False
    j = len(ring) - 1
    for i in range(len(ring)):
        xi, yi = ring[i]
        xj, yj = ring[j]
        if (yi > lat) != (yj > lat) and lon < (xj - xi) * (lat - yi) / (yj - yi) + xi:
            inside = not inside
        j = i
    return inside


def contains(polygons: list[Polygon], lon: float, lat: float) -> bool:
    """True when the point is inside the boundary (inside an outer ring and in none of its holes)."""
    for polygon in polygons:
        xs = [x for x, _ in polygon[0]]
        ys = [y for _, y in polygon[0]]
        if not (min(xs) <= lon <= max(xs) and min(ys) <= lat <= max(ys)):
            continue
        if _in_ring(lon, lat, polygon[0]) and not any(_in_ring(lon, lat, hole) for hole in polygon[1:]):
            return True
    return False


def contains_many(polygons: list[Polygon], lons, lats):
    """Vectorised ``contains`` for whole columns: a numpy boolean mask.

    Same even-odd rule as ``_in_ring``, one edge at a time over every point, so a
    year of Spain (hundreds of thousands of detections) clips in about a second.
    """
    import numpy as np  # imported here so the pure tests stay dependency-free

    x = np.asarray(lons, dtype=float)
    y = np.asarray(lats, dtype=float)
    inside = np.zeros(x.shape, dtype=bool)
    for polygon in polygons:
        outer = np.asarray(polygon[0], dtype=float)
        box = (
            (x >= outer[:, 0].min()) & (x <= outer[:, 0].max())
            & (y >= outer[:, 1].min()) & (y <= outer[:, 1].max())
        )
        if not box.any():
            continue
        idx = np.flatnonzero(box)
        hit = _ring_mask(x[idx], y[idx], outer)
        for hole in polygon[1:]:
            hit &= ~_ring_mask(x[idx], y[idx], np.asarray(hole, dtype=float))
        inside[idx] |= hit
    return inside


def _ring_mask(x, y, ring):
    import numpy as np

    crossings = np.zeros(x.shape, dtype=bool)
    for (xi, yi), (xj, yj) in zip(ring[1:], ring[:-1]):
        straddles = (yi > y) != (yj > y)
        if straddles.any():
            crossings[straddles] ^= x[straddles] < (xj - xi) * (y[straddles] - yi) / (yj - yi) + xi
    return crossings
