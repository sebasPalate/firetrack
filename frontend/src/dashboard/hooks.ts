"use client";

import { useEffect, useMemo, useRef, useState } from "react";

import { loadCustomArea } from "@/features/area/aoiData";
import type { Bbox } from "@/features/area/aoi";
import type { Series, ViewMode } from "@/features/calendar/view";
import { downloadDetections } from "@/features/exports/downloadDetections";
import { clampRange, makeRange, type MonthRange, type YearMonth } from "@/features/range/range";
import { ApiError, DATA_SOURCE, STATIC_MODE, fetchCalendar, fetchMethod, fetchRegions } from "@/shared/api";
import type { CalendarPayload, MethodPayload, Region } from "@/shared/types";

import { latestUsable, wholeRange, type Selection, type Within } from "./calendarView";
import { writeUrlState, type UrlState } from "./urlState";

/** Playback speed: one observed month every this many milliseconds. */
const PLAY_INTERVAL_MS = 900;

/** The region list: one request for the whole session. */
export function useRegions() {
  const [regions, setRegions] = useState<Region[]>([]);
  const [error, setError] = useState<string | null>(null);
  useEffect(() => {
    const controller = new AbortController();
    fetchRegions(controller.signal)
      .then((list) => {
        setRegions(list);
      })
      .catch((cause: unknown) => {
        if (controller.signal.aborted) return;
        setError(
          cause instanceof ApiError
            ? cause.message
            : STATIC_MODE
              ? `Could not read ${DATA_SOURCE}regions.json.`
              : "The API is unreachable. Is FastAPI running?",
        );
      });
    return () => controller.abort();
  }, []);
  return { regions, error };
}

/**
 * The calendar and calibration of one region, or of a custom box, plus the
 * range and month the link opened with. The view remounts for every region or
 * box (its `key`), so one load never sees the area change under it.
 */
export function useRegionData(regionId: string, aoi: Bbox | null, initial: UrlState) {
  const [payload, setPayload] = useState<CalendarPayload | null>(null);
  const [method, setMethod] = useState<MethodPayload | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [loading, setLoading] = useState(true);
  const [progress, setProgress] = useState<{ done: number; total: number } | null>(null);
  const [selection, setSelection] = useState<Selection | null>(null);
  const [range, setRange] = useState<MonthRange | null>(null);

  // The link the page opened with applies to the first load only.
  const opening = useRef(initial);

  useEffect(() => {
    const controller = new AbortController();
    const load: Promise<[CalendarPayload, MethodPayload]> = aoi
      ? loadCustomArea(aoi, (done, total) => setProgress({ done, total }), controller.signal).then(
          ({ calendar, method }) => [calendar, method],
        )
      : Promise.all([fetchCalendar(regionId, controller.signal), fetchMethod(regionId, controller.signal)]);
    load
      .then(([calendar, calibration]) => {
        const wanted = opening.current;
        const bounds = wholeRange(calendar);
        const picked = clampRange(
          makeRange(wanted.from ?? bounds.start, wanted.to ?? bounds.end),
          bounds.start,
          bounds.end,
        );

        const column = wanted.year === undefined ? -1 : calendar.years.indexOf(wanted.year);
        const linked =
          wanted.month !== undefined && column >= 0 && calendar.harmonized[wanted.month]?.[column] !== undefined
            ? { year: calendar.years[column], month: wanted.month }
            : null;

        setPayload(calendar);
        setMethod(calibration);
        setRange(picked);
        setSelection(linked ?? latestUsable(calendar, picked));
      })
      .catch((cause: unknown) => {
        if (controller.signal.aborted) return;
        setPayload(null);
        setError(
          cause instanceof ApiError
            ? cause.message
            : STATIC_MODE
              ? `Could not read the data in ${DATA_SOURCE}. Build it with: python -m firetrack.pipeline.export_web`
              : `Could not reach ${DATA_SOURCE}. Start it with: uvicorn firetrack.api.main:app`,
        );
      })
      .finally(() => {
        if (!controller.signal.aborted) setLoading(false);
      });
    return () => controller.abort();
    // The view remounts for every new box (its key), so the box never changes under one load.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [regionId]);

  return { payload, method, error, loading, progress, selection, setSelection, range, setRange };
}

/** Keep the address bar in step with what is on screen, so Copy link always copies this view. */
export function useUrlSync(state: {
  payload: CalendarPayload | null;
  range: MonthRange | null;
  selection: Selection | null;
  regionId: string;
  aoi: Bbox | null;
  mode: ViewMode;
  series: Series;
}) {
  const { payload, range, selection, regionId, aoi, mode, series } = state;
  useEffect(() => {
    if (!payload || !range) return;
    const bounds = wholeRange(payload);
    const same = (a: YearMonth, b: YearMonth) => a.year === b.year && a.month === b.month;
    writeUrlState({
      region: regionId,
      aoi: aoi ?? undefined,
      from: same(range.start, bounds.start) ? undefined : range.start,
      to: same(range.end, bounds.end) ? undefined : range.end,
      year: selection?.year,
      month: selection?.month,
      view: mode,
      series,
    });
  }, [payload, range, selection, regionId, aoi, mode, series]);
}

/**
 * Play and the arrows walk through every observed month in the range, in time
 * order. Playback is a chain of timeouts keyed on the selection: it reaches the
 * end and stops there by itself, so "playing" is derived from the position.
 */
export function usePlayback(
  payload: CalendarPayload | null,
  years: number[],
  within: Within,
  selection: Selection | null,
  setSelection: (selection: Selection) => void,
) {
  const [playing, setPlaying] = useState(false);

  const cells = useMemo(() => {
    const list: Selection[] = [];
    if (!payload) return list;
    years.forEach((year) => {
      const column = payload.years.indexOf(year);
      for (let month = 0; month < 12; month += 1) {
        if (payload.harmonized[month][column] !== null && within(year, month)) list.push({ year, month });
      }
    });
    return list;
  }, [payload, years, within]);

  const position = selection
    ? cells.findIndex((cell) => cell.year === selection.year && cell.month === selection.month)
    : -1;
  const atEnd = position < 0 || position >= cells.length - 1;
  const isPlaying = playing && !atEnd;

  useEffect(() => {
    if (!isPlaying || !selection) return;
    const next = cells[position + 1];
    if (!next) return;
    const timer = window.setTimeout(() => setSelection(next), PLAY_INTERVAL_MS);
    return () => window.clearTimeout(timer);
  }, [isPlaying, selection, cells, position, setSelection]);

  function toggle() {
    if (isPlaying) {
      setPlaying(false);
      return;
    }
    // Pressing Play on the last month starts over from the first.
    if (cells.length && position >= cells.length - 1) setSelection(cells[0]);
    setPlaying(true);
  }

  function step(delta: number) {
    setPlaying(false);
    const target = cells[Math.min(Math.max(position + delta, 0), cells.length - 1)];
    if (target) setSelection(target);
  }

  /** A person picking a month stops the playback. */
  function pick(next: Selection) {
    setPlaying(false);
    setSelection(next);
  }

  return { isPlaying, canPrev: position > 0, canNext: !atEnd, toggle, step, pick, stop: () => setPlaying(false) };
}

/** One short status line: copy confirmations, refused areas, failed images. */
export function useNotice() {
  const [notice, setNotice] = useState<string | null>(null);
  function flash(message: string, ms: number) {
    setNotice(message);
    window.setTimeout(() => setNotice(null), ms);
  }
  return { notice, flash };
}

/** The detections CSV behind the view; `status` is the line shown after it, or "busy". */
export function useDetectionsDownload(regionId: string, range: MonthRange | null, aoi: Bbox | null) {
  const [status, setStatus] = useState<string | null>(null);
  function start() {
    if (!range) return;
    setStatus("busy");
    downloadDetections(regionId, range, aoi ?? undefined)
      .then(({ rows, missing }) =>
        setStatus(
          `${rows.toLocaleString("en-US")} detections` + (missing.length ? `, no file for ${missing.join(", ")}` : ""),
        ),
      )
      .catch((cause: unknown) => setStatus(cause instanceof Error ? cause.message : "download failed"));
  }
  return { status, start };
}
