"""Draw the two documentation figures straight from the served artifacts.

No plotting library: the SVGs are written by hand so the figures in ``docs/``
cannot drift away from ``data/processed/`` and so the repo keeps a small
dependency set. Run after the harmonizer:

    python -m firetrack.pipeline.charts            # Spain
    python -m firetrack.pipeline.charts aragon

Writes ``docs/img/salto_2012.svg`` and ``docs/img/factor_por_mes.svg``.
"""

from __future__ import annotations

import argparse
import json
from pathlib import Path

import duckdb

from firetrack.pipeline.regions import load_regions
from firetrack.paths import REPO_ROOT

DATA = REPO_ROOT / "data" / "processed"
IMG = REPO_ROOT / "docs" / "img"
#: Region drawn in the figures; ``main`` can change it from the command line.
REGION = {"id": "spain", "name": "Spain"}

INK = "#1f2933"
MUTED = "#6b7280"
GRID = "#d8dee9"
RAW = "#8a8f98"
INDEX = "#0f766e"
ACCENT = "#b45309"

MONTHS = ["Jan", "Feb", "Mar", "Apr", "May", "Jun", "Jul", "Aug", "Sep", "Oct", "Nov", "Dec"]

FONT = "font-family: 'Segoe UI', system-ui, -apple-system, sans-serif"


def _text(x: float, y: float, body: str, size: int = 12, fill: str = INK, anchor: str = "start", weight: int = 400) -> str:
    return (
        f'<text x="{x:.1f}" y="{y:.1f}" font-size="{size}" fill="{fill}" '
        f'text-anchor="{anchor}" font-weight="{weight}" style="{FONT}">{body}</text>'
    )


def _line(x1: float, y1: float, x2: float, y2: float, stroke: str = GRID, width: float = 1, dash: str = "") -> str:
    extra = f' stroke-dasharray="{dash}"' if dash else ""
    return f'<line x1="{x1:.1f}" y1="{y1:.1f}" x2="{x2:.1f}" y2="{y2:.1f}" stroke="{stroke}" stroke-width="{width}"{extra}/>'


def _polyline(points: list[tuple[float, float]], stroke: str, width: float = 2.2, dash: str = "") -> str:
    body = " ".join(f"{x:.1f},{y:.1f}" for x, y in points)
    extra = f' stroke-dasharray="{dash}"' if dash else ""
    return (
        f'<polyline points="{body}" fill="none" stroke="{stroke}" stroke-width="{width}" '
        f'stroke-linejoin="round"{extra}/>'
    )


def yearly() -> tuple[list[int], list[float], list[float], set[int]]:
    """Yearly totals, plus which years are provisional (the running year)."""
    calendar = DATA / "calendar" / f"{REGION['id']}.parquet"
    con = duckdb.connect()
    rows = con.execute(
        f"""
        select year, sum(harmonized_index) as index, sum(raw_count) as raw,
               bool_or(provisional) as provisional
        from read_parquet('{calendar.as_posix()}')
        group by 1 order by 1
        """
    ).fetchall()
    years = [int(row[0]) for row in rows]
    index = [float(row[1] or 0) for row in rows]
    raw = [float(row[2] or 0) for row in rows]
    provisional = {int(row[0]) for row in rows if row[3]}
    return years, index, raw, provisional


def _panel(
    years: list[int],
    values: list[float],
    *,
    top: float,
    left: float,
    width: float,
    height: float,
    colour: str,
    label: str,
    provisional: set[int] | None = None,
) -> tuple[str, list[float]]:
    """One stacked panel with its own y scale, sharing the year axis."""
    provisional = provisional or set()
    peak = max(values) or 1.0
    x0, x1 = years[0], years[-1]
    parts = []
    for step in range(5):
        value = peak * step / 4
        y = top + height - (value / peak) * height
        parts.append(_line(left, y, left + width, y))
        if value == 0:
            tick = "0"
        elif peak > 2000:
            tick = f"{value / 1000:.1f}k"
        else:
            tick = f"{value:.1f}"
        parts.append(_text(left - 8, y + 4, tick, 10, MUTED, "end"))
    points = [
        (left + (year - x0) / (x1 - x0) * width, top + height - (value / peak) * height)
        for year, value in zip(years, values)
    ]
    # A provisional year is served but never fitted, so it is drawn as a dashed
    # continuation instead of a solid claim.
    split = next((i for i, year in enumerate(years) if year in provisional), None)
    if split is not None and split > 0:
        parts.append(_polyline(points[: split + 1], colour))
        parts.append(_polyline(points[split - 1 :], colour, 2.2, "5 4"))
    else:
        parts.append(_polyline(points, colour))
    parts.append(_text(left, top - 10, label, 12, INK, "start", 600))
    return "".join(parts), [y for _, y in points]


def step_chart() -> str:
    years, index, raw, provisional = yearly()
    # 2000 holds only November and December (the record starts 2000-11), so
    # plotting it draws a spike that is a calendar artefact, not a fire season.
    keep = [i for i, year in enumerate(years) if year >= 2001]
    years = [years[i] for i in keep]
    index = [index[i] for i in keep]
    raw = [raw[i] for i in keep]

    width, height = 880, 600
    left, plot_width = 74, 760

    top_raw, top_index = 96, 330
    panel_height = 170
    raw_svg, _ = _panel(
        years, raw, top=top_raw, left=left, width=plot_width, height=panel_height,
        colour=RAW, label="Raw detections, every satellite summed", provisional=provisional,
    )
    index_svg, _ = _panel(
        years, index, top=top_index, left=left, width=plot_width, height=panel_height,
        colour=INDEX, label="Harmonized activity index (Aqua MODIS units)", provisional=provisional,
    )

    x0, x1 = years[0], years[-1]

    def x_of(year: float) -> float:
        return left + (year - x0) / (x1 - x0) * plot_width

    marks = []
    for year, label in ((2012, "Suomi-NPP"), (2018, "NOAA-20"), (2024, "NOAA-21")):
        x = x_of(year + 0.5)
        marks.append(_line(x, top_raw - 4, x, top_index + panel_height, ACCENT, 1.2, "4 4"))
        marks.append(_text(x, 70, label, 11, ACCENT, "middle"))
    end = x_of(2026.86)
    marks.append(_line(end, top_raw - 4, end, top_index + panel_height, MUTED, 1.2, "2 4"))

    ticks = []
    for year in range(2002, 2027, 4):
        x = x_of(year)
        ticks.append(_line(x, top_index + panel_height, x, top_index + panel_height + 5, MUTED))
        ticks.append(_text(x, top_index + panel_height + 20, str(year), 11, MUTED, "middle"))

    return (
        f'<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 {width} {height}" '
        f'width="{width}" height="{height}" role="img" '
        f'aria-label="Raw detections jump when each satellite joins; the harmonized index stays level">'
        f'<rect width="{width}" height="{height}" fill="#ffffff"/>'
        + _text(left, 30, "The same fires, two ways of counting them", 16, INK, "start", 600)
        + _text(left, 50, f"{REGION['name']}, yearly totals from 2001. Both panels share the year axis.", 11, MUTED)
        + raw_svg
        + index_svg
        + "".join(marks)
        + "".join(ticks)
        + _text(left, height - 56, "Orange lines: a VIIRS satellite joining. Grey line: S-NPP ended on 2026-11-02.", 10, MUTED)
        + _text(left, height - 42, "Dashed segment: running year, served but never used to fit the factors.", 10, MUTED)
        + _text(left, height - 28, "2000 is left out: the record starts in November, so two months are not a year.", 10, MUTED)
        + _text(left, height - 14, "Source: NASA FIRMS through the Portolan mirror; built by firetrack/pipeline/charts.py.", 10, MUTED)
        + "</svg>"
    )


def factor_chart() -> str:
    method = json.loads((DATA / "method" / f"{REGION['id']}.json").read_text(encoding="utf-8"))
    monthly = method["calibration"]["monthly"]
    factors = [monthly[f"{month:02d}"]["factor"] for month in range(1, 13)]
    pooled = method["calibration"]["pooled"]

    width, height = 880, 400
    left, plot_width, plot_height, top = 74, 690, 240, 86
    peak = max(factors) * 1.15

    parts = []
    for step in range(5):
        value = peak * step / 4
        y = top + plot_height - (value / peak) * plot_height
        parts.append(_line(left, y, left + plot_width, y))
        parts.append(_text(left - 8, y + 4, f"{value:.1f}", 10, MUTED, "end"))

    slot = plot_width / 12
    for month in range(1, 13):
        value = factors[month - 1]
        bar_height = (value / peak) * plot_height
        x = left + (month - 1) * slot + slot * 0.18
        bar_width = slot * 0.64
        parts.append(
            f'<rect x="{x:.1f}" y="{top + plot_height - bar_height:.1f}" width="{bar_width:.1f}" '
            f'height="{bar_height:.1f}" fill="{INDEX}" opacity="0.85" rx="2"/>'
        )
        parts.append(_text(x + bar_width / 2, top + plot_height - bar_height - 6, f"{value:.1f}", 10, INK, "middle"))
        parts.append(_text(x + bar_width / 2, top + plot_height + 16, MONTHS[month - 1], 10, MUTED, "middle"))

    pooled_y = top + plot_height - (pooled / peak) * plot_height
    parts.append(_line(left, pooled_y, left + plot_width, pooled_y, ACCENT, 1.4, "5 4"))
    # Outside the plot area: inside it the label lands on a bar value every time.
    parts.append(_text(left + plot_width + 10, pooled_y + 4, f"pooled {pooled:.2f}", 11, ACCENT, "start"))

    low = min(range(12), key=lambda i: factors[i])
    high = max(range(12), key=lambda i: factors[i])

    return (
        f'<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 {width} {height}" '
        f'width="{width}" height="{height}" role="img" '
        f'aria-label="Monthly VIIRS to Aqua correction factors, from {factors[low]:.1f} in {MONTHS[low]} '
        f'to {factors[high]:.1f} in {MONTHS[high]}">'
        f'<rect width="{width}" height="{height}" fill="#ffffff"/>'
        + _text(left, 30, "One factor per calendar month, measured on the overlap", 16, INK, "start", 600)
        + _text(left, 50, f"How many VIIRS detections equal one Aqua MODIS detection, fitted {method['calibration']['overlap_first']} onward.", 11, MUTED)
        + "".join(parts)
        + _text(left, height - 34, "The factors are not flat: a single yearly factor would be wrong almost every month.", 10, MUTED)
        + _text(left, height - 18, f"Computed by firetrack/pipeline/harmonize.py and read here from data/processed/method/{REGION['id']}.json.", 10, MUTED)
        + "</svg>"
    )


def main(argv: list[str] | None = None) -> None:
    parser = argparse.ArgumentParser(description="Redraw docs/img from one region's artifacts")
    parser.add_argument("region", nargs="?", default="spain")
    args = parser.parse_args(argv)
    config = load_regions()[args.region]
    REGION.update(id=args.region, name=config["name"].split(" (")[0])

    IMG.mkdir(parents=True, exist_ok=True)
    (IMG / "salto_2012.svg").write_text(step_chart(), encoding="utf-8")
    (IMG / "factor_por_mes.svg").write_text(factor_chart(), encoding="utf-8")
    print(f"wrote {IMG / 'salto_2012.svg'}")
    print(f"wrote {IMG / 'factor_por_mes.svg'}")


if __name__ == "__main__":
    main()
