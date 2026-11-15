"""Areas of interest, shared by the pipeline and the API.

The list lives in ``data/regions.json``; bbox = (west, south, east, north), degrees, CRS84.
"""

from __future__ import annotations

import json
from pathlib import Path

REGIONS_PATH = Path(__file__).resolve().parents[1] / "data" / "regions.json"


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
