"use client";

import { formatBox, type Bbox } from "@/features/area/aoi";
import { calendarCsv, calendarSvg } from "@/features/calendar/insights";
import type { ViewMode } from "@/features/calendar/view";
import { rangeLabel, type MonthRange } from "@/features/range/range";
import { diverging, sequential } from "@/shared/colors";
import { saveBlob, saveText, slug, svgToPng } from "@/shared/download";
import { formatIndex, formatPercent } from "@/shared/format";
import type { CalendarPayload } from "@/shared/types";

import type { Within } from "./calendarView";

/** The calendar as a table (CSV) or as the image on screen (PNG, SVG), named after the area and range. */
export function useCalendarExports(view: {
  payload: CalendarPayload | null;
  years: number[];
  within: Within;
  range: MonthRange | null;
  mode: ViewMode;
  scale: number;
  regionId: string;
  aoi: Bbox | null;
  onError: (message: string) => void;
}) {
  const { payload, years, within, range, mode, scale, regionId, aoi, onError } = view;

  /** File names say what is inside: the area and the range. */
  function exportName(): string {
    const area = aoi ? `aoi ${formatBox(aoi)}` : regionId;
    return `firetrack-${slug(area)}-${slug(range ? rangeLabel(range) : `${years[0]}-${years[years.length - 1]}`)}`;
  }

  function exportTable() {
    if (!payload) return;
    saveText(calendarCsv(payload, years, within), `${exportName()}-calendar.csv`, "text/csv;charset=utf-8");
  }

  function exportImage(format: "png" | "svg") {
    if (!payload) return;
    const index = mode === "index";
    const last = years[years.length - 1];
    const svg = calendarSvg(payload, years, {
      title: `${payload.region.name} · burning activity calendar ${range ? rangeLabel(range) : `${years[0]}–${last}`}`,
      subtitle: index
        ? "Harmonized activity index in Aqua MODIS detections (not a fire count). Dashed outline: partial month."
        : "Anomaly against the multi-year median of the same calendar month. Dashed outline: partial month.",
      value: index ? (harmonized) => harmonized : (_, cell) => payload.anomaly_pct[cell.month][cell.column],
      color: (value) =>
        value === null
          ? "#e2e8f0"
          : index
            ? sequential(scale > 0 ? value / scale : 0)
            : diverging(scale > 0 ? value / scale : 0),
      legend: index ? ["0", formatIndex(scale)] : [`−${Math.round(scale)} %`, `+${Math.round(scale)} %`],
      ramp: index ? [0, 0.25, 0.5, 0.75, 1].map(sequential) : [-1, -0.5, 0, 0.5, 1].map(diverging),
      format: index ? formatIndex : formatPercent,
      inRange: within,
    });
    const name = `${exportName()}-calendar-${mode}`;
    if (format === "svg") {
      saveText(svg, `${name}.svg`, "image/svg+xml;charset=utf-8");
      return;
    }
    svgToPng(svg)
      .then((blob) => saveBlob(blob, `${name}.png`))
      .catch((cause: unknown) => onError(cause instanceof Error ? cause.message : "The image could not be made."));
  }

  return { exportTable, exportImage };
}
