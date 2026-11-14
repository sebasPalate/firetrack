"""Sensor-agnostic normalization of FIRMS rows.

MODIS and VIIRS share a core of columns and disagree on the rest. Everything
downstream must read one schema, so the divergence is absorbed here and nowhere
else.

Column differences:

============  ==========================  ==========================
concept       MODIS                       VIIRS
============  ==========================  ==========================
brightness    ``brightness``              ``bright_ti4``
background    ``bright_t31``              ``bright_ti5``
confidence    0-100 numeric               ``l`` / ``n`` / ``h``
============  ==========================  ==========================
"""

from __future__ import annotations

from typing import Any, Mapping

#: Nominal pixel size in km at nadir, used to weight cells.
PIXEL_KM = {"MODIS": 1.0, "VIIRS": 0.375}

#: Midpoints of the VIIRS confidence bands. Assumption, documented on purpose:
#: the bands are not calibrated against the MODIS 0-100 scale, so the resulting
#: score is only valid for filtering, never for comparing magnitudes.
VIIRS_CONFIDENCE_BANDS = {"l": 0.3, "n": 0.6, "h": 0.9}

UNIFIED_FIELDS = (
    "sensor",
    "platform",
    "latitude",
    "longitude",
    "acq_date",
    "acq_time",
    "datetime_utc",
    "confidence_raw",
    "confidence_score",
    "brightness",
    "brightness_t31",
    "frp",
    "daynight",
    "type",
    "scan",
    "track",
    "pixel_km",
)


def parse_acq_time(raw: Any) -> str:
    """Convert FIRMS ``acq_time`` (HHMM, leading zeros dropped) to ``HH:MM``."""
    if raw is None:
        raise ValueError("acq_time is missing")
    text = str(raw).strip()
    if not text.isdigit():
        raise ValueError(f"acq_time is not numeric: {raw!r}")
    if len(text) > 4:
        raise ValueError(f"acq_time is out of range: {raw!r}")

    padded = text.zfill(4)
    hours, minutes = int(padded[:2]), int(padded[2:])
    if not (0 <= hours <= 23 and 0 <= minutes <= 59):
        raise ValueError(f"acq_time is out of range: {raw!r}")
    return f"{hours:02d}:{minutes:02d}"


def normalize_confidence(raw: Any) -> float | None:
    """Map MODIS numeric confidence or VIIRS band labels onto 0..1.

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


def normalize_row(row: Mapping[str, Any], sensor: str) -> dict[str, Any]:
    """Rewrite one FIRMS row into the unified schema."""
    instrument = str(row.get("instrument") or sensor.split("_")[0]).strip()
    acq_date = str(row.get("acq_date") or "").strip()
    acq_time = parse_acq_time(row.get("acq_time"))
    raw_confidence = row.get("confidence")

    return {
        "sensor": sensor,
        "platform": str(row.get("satellite") or "").strip(),
        "latitude": float(row["latitude"]),
        "longitude": float(row["longitude"]),
        "acq_date": acq_date,
        "acq_time": acq_time,
        "datetime_utc": f"{acq_date}T{acq_time}:00Z",
        "confidence_raw": "" if raw_confidence is None else str(raw_confidence).strip(),
        "confidence_score": normalize_confidence(raw_confidence),
        "brightness": _optional_float(row.get("brightness") or row.get("bright_ti4")),
        "brightness_t31": _optional_float(row.get("bright_t31") or row.get("bright_ti5")),
        "frp": _optional_float(row.get("frp")),
        "daynight": str(row.get("daynight") or "").strip(),
        "type": str(row.get("type") or "").strip(),
        "scan": _optional_float(row.get("scan")),
        "track": _optional_float(row.get("track")),
        "pixel_km": PIXEL_KM.get(instrument.upper(), None),
    }


def _optional_float(raw: Any) -> float | None:
    if raw is None:
        return None
    text = str(raw).strip()
    if not text:
        return None
    try:
        return float(text)
    except ValueError:
        return None
