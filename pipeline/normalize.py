"""Sensor-agnostic confidence handling for MODIS and VIIRS rows.

MODIS reports ``confidence`` as 0-100 and VIIRS reports ``l`` / ``n`` / ``h``.
The two scales have no official equivalence, so they are never used to compare
magnitudes: the score below exists to filter and to label a row in the CSV
export, and the filter itself uses two separate predicates (``firms.CONF_SQL``).

The Python and the SQL mapping are generated from the same table and pinned
against each other by ``tests/test_normalize.py``, because a pipeline that
filters in SQL and exports in Python silently disagrees with itself otherwise.
"""

from __future__ import annotations

from typing import Any

#: Midpoints of the VIIRS confidence bands. Documented assumption: only valid
#: for filtering and labelling, never for comparing intensity across sensors.
VIIRS_CONFIDENCE_BANDS = {"l": 0.3, "n": 0.6, "h": 0.9}


def normalize_confidence(raw: Any) -> float | None:
    """Map MODIS numeric confidence or a VIIRS band label onto 0..1.

    Raises on unknown values instead of silently defaulting, because a wrong
    default would quietly filter out real detections (risk R5).
    """
    if raw is None:
        return None
    text = str(raw).strip()
    if not text:
        return None

    lowered = text.lower()
    if lowered in VIIRS_CONFIDENCE_BANDS:
        return VIIRS_CONFIDENCE_BANDS[lowered]

    try:
        value = float(text)
    except ValueError as exc:
        raise ValueError(f"unknown confidence value: {raw!r}") from exc
    if not 0 <= value <= 100:
        raise ValueError(f"confidence out of range 0..100: {raw!r}")
    return round(value / 100.0, 4)


def confidence_score_sql(sensor_column: str, confidence_column: str) -> str:
    """SQL twin of :func:`normalize_confidence`, built from the same band table.

    Unknown labels become NULL here instead of raising, because a single bad row
    must not abort a scan of a million detections.
    """
    bands = " ".join(f"WHEN '{label}' THEN {value}" for label, value in VIIRS_CONFIDENCE_BANDS.items())
    return (
        f"CASE WHEN {sensor_column} = 'MODIS' "
        f"THEN least(greatest(try_cast({confidence_column} AS DOUBLE) / 100.0, 0), 1) "
        f"ELSE CASE lower(trim({confidence_column})) {bands} ELSE NULL END END"
    )
