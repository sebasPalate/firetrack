"use client";

import { useEffect, useMemo, useState } from "react";

import type { Series, ViewMode } from "@/features/calendar/view";
import type { MonthRange } from "@/features/range/range";
import type { TourStep } from "@/features/tour/GuidedTour";
import { formatPercent } from "@/shared/format";
import type { CalendarPayload, MethodPayload } from "@/shared/types";

import { peakCell, wholeRange, type Selection } from "./calendarView";

/** The five-step story of the page, with each step setting up the view it talks about. */
export function useTour(view: {
  payload: CalendarPayload | null;
  method: MethodPayload | null;
  onSeries: (series: Series) => void;
  onMode: (mode: ViewMode) => void;
  setRange: (range: MonthRange) => void;
  setSelection: (selection: Selection) => void;
  stopPlaying: () => void;
}) {
  const { payload, method, onSeries, onMode, setRange, setSelection, stopPlaying } = view;
  const [tour, setTour] = useState<number | null>(null);

  const steps = useMemo<TourStep[]>(() => (method ? tourSteps(method) : []), [method]);

  function go(next: number | null) {
    stopPlaying();
    setTour(next);
    if (next === null || !payload) return;
    if (next === 0) {
      onSeries("raw");
      setRange(wholeRange(payload));
    } else if (next === 1) {
      onSeries("compare");
    } else if (next === 2) {
      onSeries("harmonized");
    } else if (next === 3) {
      onMode("index");
      setSelection(peakCell(payload));
    }
  }

  useEffect(() => {
    if (tour === null) return;
    const target = steps[tour]?.target;
    if (!target) return;
    const reduced = window.matchMedia("(prefers-reduced-motion: reduce)").matches;
    document.getElementById(target)?.scrollIntoView({ behavior: reduced ? "auto" : "smooth", block: "start" });
  }, [tour, steps]);

  return { tour, steps, go };
}

function tourSteps(method: MethodPayload): TourStep[] {
  const { raw_step_2011_to_2013_pct: rawStep, aqua_step_2011_to_2013_pct: aquaStep, index_step_2011_to_2013_pct: indexStep } =
    method.validation;
  const factors = Object.values(method.calibration.monthly).map((entry) => entry.factor);
  const lowest = factors.length ? Math.min(...factors) : null;
  const highest = factors.length ? Math.max(...factors) : null;
  const typical = method.validation.median_abs_error_pct;
  return [
    {
      title: "A new satellite looks like more fire",
      target: "section-yearly",
      body: (
        <>
          The raw count jumps when Suomi-NPP joins in <strong className="text-slate-100">2012</strong> and again when
          NOAA-21 joins in <strong className="text-slate-100">2024</strong>.
          {rawStep !== null ? <> From 2011 to 2013 it changes by {formatPercent(rawStep)}.</> : null} Nothing changed
          on the ground; the cameras did.
        </>
      ),
    },
    {
      title: "Same years, two stories",
      target: "section-yearly",
      body: (
        <>
          The pink line is the raw count; the green bars are the harmonized index.
          {aquaStep !== null ? (
            <> Aqua MODIS, the one camera that never changed, moved {formatPercent(aquaStep)} over 2011 to 2013</>
          ) : null}
          {rawStep !== null && indexStep !== null ? (
            <>
              , the raw count {formatPercent(rawStep)}, the index {formatPercent(indexStep)}
            </>
          ) : null}
          . The index tracks the ground, the raw count tracks the camera.
        </>
      ),
    },
    {
      title: "One exchange rate per calendar month",
      target: "section-yearly",
      body: (
        <>
          VIIRS sees far more small fires in some months than in others, so the conversion into Aqua MODIS units is
          estimated month by month
          {lowest !== null && highest !== null ? (
            <>
              , from ×{lowest.toFixed(1)} to ×{highest.toFixed(1)}
            </>
          ) : null}
          .{typical !== null ? <> Against Aqua itself the typical error is {typical.toFixed(1)} %.</> : null}
        </>
      ),
    },
    {
      title: "Open one month",
      target: "section-map",
      body: (
        <>
          Each mark on the map is one satellite pixel. VIIRS circles outnumber MODIS squares for the same fires, which
          is exactly the gap the index corrects. Click a day bar to isolate a day, or press Play on the calendar to
          travel through time.
        </>
      ),
    },
    {
      title: "Take it with you",
      target: "section-top",
      body: (
        <>
          <strong className="text-slate-100">Copy link</strong> keeps your area, range and month.{" "}
          <strong className="text-slate-100">Download CSV</strong> gives every detection behind the view. The
          Validation and Provenance panels at the bottom say what this index does not claim.
        </>
      ),
    },
  ];
}
