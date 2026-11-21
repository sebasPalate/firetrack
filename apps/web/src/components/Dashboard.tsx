"use client";

import { useSyncExternalStore, useEffect, useMemo, useRef, useState } from "react";

import { AreaForm } from "@/components/AreaForm";
import { CalendarHeatmap } from "@/components/CalendarHeatmap";
import { DetailPanel } from "@/components/DetailPanel";
import { GuidedTour, type TourStep } from "@/components/GuidedTour";
import { MapPanel } from "@/components/MapPanel";
import { MonthlySeries } from "@/components/MonthlySeries";
import { Provenance } from "@/components/Provenance";
import { Seasonality } from "@/components/Seasonality";
import { TimeControls } from "@/components/TimeControls";
import { Validation } from "@/components/Validation";
import { YearlyTotals } from "@/components/YearlyTotals";
import {
  ApiError,
  DATA_SOURCE,
  STATIC_MODE,
  detectionsCsvUrl,
  downloadDetections,
  fetchCalendar,
  fetchMethod,
  fetchRegions,
} from "@/lib/api";
import { AOI_SOURCE_REGION, CUSTOM_REGION_ID, clampBox, formatBox, validateBox, type Bbox } from "@/lib/aoi";
import { loadCustomArea } from "@/lib/aoiData";
import { MONTHS, formatPercent } from "@/lib/format";
import type { CalendarPayload, MethodPayload, Region } from "@/lib/types";
import {
  parseUrlState,
  subscribeToUrl,
  urlSnapshot,
  writeUrlState,
  type Series,
  type UrlState,
  type ViewMode,
} from "@/lib/urlState";

type Selection = { year: number; month: number };

/** The region the page opens on when the list has it. */
const DEFAULT_REGION = "spain";

/** Playback speed: one observed month every this many milliseconds. */
const PLAY_INTERVAL_MS = 900;

function percentile(values: number[], share: number): number {
  if (!values.length) return 0;
  const ordered = [...values].sort((a, b) => a - b);
  return ordered[Math.min(ordered.length - 1, Math.floor(share * ordered.length))];
}

/**
 * The region list is one request for the whole session; the calendar and the
 * calibration table are one request per region. Splitting them lets the region
 * view remount on a region change (`key`), which is what makes the loading and
 * error state honest instead of leaking one region's failure into the next.
 *
 * The calendar scale and the series live here, above the region, so switching
 * area keeps the way the person was reading the data.
 */
export function Dashboard() {
  // The link is read as an external store: the server renders with no query string, and
  // the client adopts it on the first render after hydration, so both markups agree.
  const search = useSyncExternalStore(subscribeToUrl, urlSnapshot, () => null);
  const opening = useMemo(() => (search === null ? null : parseUrlState(search)), [search]);

  const [regions, setRegions] = useState<Region[]>([]);
  const [regionsError, setRegionsError] = useState<string | null>(null);
  // A pick beats the link, so the link opens the page once and never fights the person using it.
  const [pickedRegion, setPickedRegion] = useState<string | null>(null);
  const [pickedMode, setPickedMode] = useState<ViewMode | null>(null);
  const [pickedSeries, setPickedSeries] = useState<Series | null>(null);

  const [pickedAoi, setPickedAoi] = useState<Bbox | null>(null);

  const aoi = pickedAoi ?? opening?.aoi ?? null;
  const wanted = pickedRegion ?? opening?.region ?? DEFAULT_REGION;
  // A custom area needs its box; without one the link opens the default region.
  const requestedRegion = wanted === CUSTOM_REGION_ID && !aoi ? DEFAULT_REGION : wanted;
  const custom = requestedRegion === CUSTOM_REGION_ID;
  // A link to a region that is not exported falls back to one that is.
  const regionId =
    !custom && regions.length && !regions.some((region) => region.id === requestedRegion)
      ? regions[0].id
      : requestedRegion;
  const mode = pickedMode ?? opening?.view ?? "index";
  const series = pickedSeries ?? opening?.series ?? "harmonized";

  useEffect(() => {
    const controller = new AbortController();
    fetchRegions(controller.signal)
      .then((list) => {
        setRegions(list);
      })
      .catch((cause: unknown) => {
        if (controller.signal.aborted) return;
        setRegionsError(
          cause instanceof ApiError
            ? cause.message
            : STATIC_MODE
              ? `Could not read ${DATA_SOURCE}regions.json.`
              : "The API is unreachable. Is FastAPI running?",
        );
      });
    return () => controller.abort();
  }, []);

  if (opening === null) {
    return <p className="mx-auto max-w-[1400px] px-4 py-6 text-sm text-slate-500">Loading…</p>;
  }

  return (
    <RegionView
      key={custom && aoi ? `${regionId}:${formatBox(aoi)}` : regionId}
      regionId={regionId}
      aoi={custom ? aoi : null}
      onAoi={(box) => {
        setPickedAoi(box);
        setPickedRegion(CUSTOM_REGION_ID);
      }}
      regions={regions}
      regionsError={regionsError}
      initial={pickedRegion === null ? opening : {}}
      mode={mode}
      onMode={setPickedMode}
      series={series}
      onSeries={setPickedSeries}
      onRegion={(next) => {
        // The year range and month belong to the region they were picked in.
        setPickedRegion(next);
      }}
    />
  );
}

function RegionView({
  regionId,
  aoi,
  onAoi,
  regions,
  regionsError,
  initial,
  mode,
  onMode,
  series,
  onSeries,
  onRegion,
}: {
  regionId: string;
  /** Set only for the custom area. */
  aoi: Bbox | null;
  onAoi: (box: Bbox) => void;
  regions: Region[];
  regionsError: string | null;
  initial: UrlState;
  mode: ViewMode;
  onMode: (mode: ViewMode) => void;
  series: Series;
  onSeries: (series: Series) => void;
  onRegion: (region: string) => void;
}) {
  const [payload, setPayload] = useState<CalendarPayload | null>(null);
  const [method, setMethod] = useState<MethodPayload | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [loading, setLoading] = useState(true);
  const [selection, setSelection] = useState<Selection | null>(null);
  const [range, setRange] = useState<{ start: number; end: number } | null>(null);
  const [download, setDownload] = useState<string | null>(null);
  const [playing, setPlaying] = useState(false);
  const [tour, setTour] = useState<number | null>(null);
  const [notice, setNotice] = useState<string | null>(null);
  const [progress, setProgress] = useState<{ done: number; total: number } | null>(null);
  const [aoiForm, setAoiForm] = useState(false);

  // The link the page opened with applies to the first load only.
  const opening = useRef(initial);
  const custom = aoi !== null;
  /** Every custom box is cut from the source region's data, so it must lie inside its box. */
  const aoiLimits = regions.find((candidate) => candidate.id === AOI_SOURCE_REGION)?.bbox ?? null;

  useEffect(() => {
    const controller = new AbortController();
    const load: Promise<[CalendarPayload, MethodPayload]> = aoi
      ? loadCustomArea(aoi, (done, total) => setProgress({ done, total }), controller.signal).then(
          ({ calendar, method }) => [calendar, method],
        )
      : Promise.all([fetchCalendar(regionId, controller.signal), fetchMethod(regionId, controller.signal)]);
    load
      .then(([calendar, calibration]) => {
        const first = calendar.years[0];
        const last = calendar.years[calendar.years.length - 1];
        const wanted = opening.current;
        let start = Math.min(Math.max(wanted.from ?? first, first), last);
        let end = Math.min(Math.max(wanted.to ?? last, first), last);
        if (start > end) [start, end] = [end, start];

        const column = wanted.year === undefined ? -1 : calendar.years.indexOf(wanted.year);
        const linked =
          wanted.month !== undefined && column >= 0 && calendar.harmonized[wanted.month]?.[column] !== undefined
            ? { year: calendar.years[column], month: wanted.month }
            : null;

        setPayload(calendar);
        setMethod(calibration);
        setRange({ start, end });
        setSelection(linked ?? latestUsable(calendar));
      })
      .catch((cause: unknown) => {
        if (controller.signal.aborted) return;
        setPayload(null);
        setError(
          cause instanceof ApiError
            ? cause.message
            : STATIC_MODE
              ? `Could not read the data in ${DATA_SOURCE}. Build it with: python -m pipeline.export_web`
              : `Could not reach ${DATA_SOURCE}. Start it with: cd services/api; uvicorn main:app`,
        );
      })
      .finally(() => {
        if (!controller.signal.aborted) setLoading(false);
      });
    return () => controller.abort();
    // The view remounts for every new box (its key), so the box never changes under one load.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [regionId]);

  // Keep the address bar in step with what is on screen, so Copy link always copies this view.
  useEffect(() => {
    if (!payload || !range) return;
    const first = payload.years[0];
    const last = payload.years[payload.years.length - 1];
    writeUrlState({
      region: regionId,
      aoi: aoi ?? undefined,
      from: range.start !== first ? range.start : undefined,
      to: range.end !== last ? range.end : undefined,
      year: selection?.year,
      month: selection?.month,
      view: mode,
      series,
    });
  }, [payload, range, selection, regionId, aoi, mode, series]);

  /** A box from the form or the map: rounded for a stable link, kept inside the data, then checked. */
  function applyArea(box: Bbox, drawn: boolean): string | null {
    const rounded = box.map((value) => Number(value.toFixed(4))) as Bbox;
    const candidate = drawn && aoiLimits ? clampBox(rounded, aoiLimits) : rounded;
    const problem = aoiLimits ? validateBox(candidate, aoiLimits) : null;
    if (problem) return problem;
    setAoiForm(false);
    onAoi(candidate);
    return null;
  }

  const years = useMemo(() => {
    if (!payload) return [];
    const start = range?.start ?? payload.years[0];
    const end = range?.end ?? payload.years[payload.years.length - 1];
    const low = Math.min(start, end);
    const high = Math.max(start, end);
    return payload.years.filter((year) => year >= low && year <= high);
  }, [payload, range]);

  const scale = useMemo(() => {
    if (!payload || !years.length) return 1;
    if (mode === "index") {
      const values: number[] = [];
      years.forEach((year) => {
        const column = payload.years.indexOf(year);
        for (let month = 0; month < 12; month += 1) {
          const value = payload.harmonized[month][column];
          if (value !== null) values.push(value);
        }
      });
      return Math.max(percentile(values, 0.95), 1);
    }
    const anomalies: number[] = [];
    years.forEach((year) => {
      const column = payload.years.indexOf(year);
      for (let month = 0; month < 12; month += 1) {
        const value = payload.anomaly_pct[month][column];
        if (value !== null) anomalies.push(Math.abs(value));
      }
    });
    return Math.min(Math.max(percentile(anomalies, 0.95), 25), 250);
  }, [payload, years, mode]);

  /** Every observed month in the visible range, in time order: what Play and the arrows walk through. */
  const cells = useMemo(() => {
    const list: Selection[] = [];
    if (!payload) return list;
    years.forEach((year) => {
      const column = payload.years.indexOf(year);
      for (let month = 0; month < 12; month += 1) {
        if (payload.harmonized[month][column] !== null) list.push({ year, month });
      }
    });
    return list;
  }, [payload, years]);

  const position = selection
    ? cells.findIndex((cell) => cell.year === selection.year && cell.month === selection.month)
    : -1;

  // Playback is a chain of timeouts keyed on the selection. It reaches the end and stops
  // there by itself, so "playing" is derived from the position instead of reset from an effect.
  const atEnd = position < 0 || position >= cells.length - 1;
  const isPlaying = playing && !atEnd;

  useEffect(() => {
    if (!isPlaying || !selection) return;
    const next = cells[position + 1];
    if (!next) return;
    const timer = window.setTimeout(() => setSelection(next), PLAY_INTERVAL_MS);
    return () => window.clearTimeout(timer);
  }, [isPlaying, selection, cells, position]);

  function togglePlay() {
    if (isPlaying) {
      setPlaying(false);
      return;
    }
    // Pressing Play on the last month starts over from the first.
    if (cells.length && position >= cells.length - 1) setSelection(cells[0]);
    setPlaying(true);
  }

  function step(delta: number) {
    const target = cells[Math.min(Math.max(position + delta, 0), cells.length - 1)];
    if (target) setSelection(target);
  }

  function pick(next: Selection) {
    setPlaying(false);
    setSelection(next);
  }

  const column = payload && selection ? payload.years.indexOf(selection.year) : -1;

  const tourSteps = useMemo<TourStep[]>(() => {
    if (!method) return [];
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
  }, [method]);

  function goTour(next: number | null) {
    setPlaying(false);
    setTour(next);
    if (next === null || !payload) return;
    if (next === 0) {
      onSeries("raw");
      setRange({ start: payload.years[0], end: payload.years[payload.years.length - 1] });
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
    const target = tourSteps[tour]?.target;
    if (!target) return;
    const reduced = window.matchMedia("(prefers-reduced-motion: reduce)").matches;
    document.getElementById(target)?.scrollIntoView({ behavior: reduced ? "auto" : "smooth", block: "start" });
  }, [tour, tourSteps]);

  async function copyLink() {
    try {
      await navigator.clipboard.writeText(window.location.href);
      setNotice("Link copied");
    } catch {
      setNotice("Could not copy. The address bar has the link.");
    }
    window.setTimeout(() => setNotice(null), 2500);
  }

  const region = custom ? payload?.region : regions.find((candidate) => candidate.id === regionId);
  const problem = error ?? regionsError;
  const actionButton =
    "rounded-lg border px-3 py-1.5 font-medium focus-visible:outline focus-visible:outline-2 focus-visible:outline-sky-400 disabled:opacity-50";

  return (
    <div className={`mx-auto max-w-[1400px] px-4 py-5 sm:px-6 sm:py-8 ${tour !== null ? "pb-72" : ""}`}>
      <header id="section-top" className="mb-6 scroll-mt-4">
        <div className="grid gap-5 lg:grid-cols-[minmax(0,1fr)_auto] lg:items-end">
          <div>
            <p className="mb-2 text-[11px] font-semibold uppercase tracking-[0.18em] text-sky-300/80">
              Satellite hotspot harmonization · 2000 to today
            </p>
            <h1 className="text-3xl font-semibold tracking-tight text-slate-100 sm:text-4xl">Firetrack</h1>
            <p className="mt-2 max-w-2xl text-sm leading-relaxed text-slate-300">
              A comparable activity record from NASA MODIS and VIIRS. Pick an area and a range, then read every month
              in the same Aqua-referenced units — so a satellite change does not look like a fire change.
            </p>
            <p className="mt-3 text-xs text-slate-500">
              Harmonized index, not a fire count · transparent method · downloadable detections
            </p>
          </div>
          <div className="rounded-2xl border border-slate-800 bg-slate-900/70 p-3 shadow-lg shadow-slate-950/20">
            <div className="mb-2 flex items-center justify-between gap-3">
              <span className="text-xs font-semibold text-slate-200">Explore the record</span>
              <span className="text-[10px] uppercase tracking-wider text-slate-500">Controls</span>
            </div>
            <div className="flex flex-wrap items-end gap-2 text-xs">
            <label className="flex flex-col gap-1">
              <span className="text-slate-500">Area</span>
              <select
                value={aoiForm ? CUSTOM_REGION_ID : regionId}
                onChange={(event) => {
                  if (event.target.value === CUSTOM_REGION_ID) {
                    setAoiForm(true);
                    return;
                  }
                  setAoiForm(false);
                  onRegion(event.target.value);
                }}
                className="min-w-32 rounded-lg border border-slate-700 bg-slate-950 px-2 py-1.5 text-slate-100"
              >
                {regions.length === 0 && !custom ? <option value={regionId}>{regionId}</option> : null}
                {regions.map((candidate) => (
                  <option key={candidate.id} value={candidate.id}>
                    {candidate.name}
                  </option>
                ))}
                <option value={CUSTOM_REGION_ID}>Custom area (lat/lon box)</option>
              </select>
            </label>
            {custom && !aoiForm ? (
              <button
                type="button"
                onClick={() => setAoiForm(true)}
                className={`${actionButton} border-slate-600 text-slate-200 hover:bg-slate-800`}
              >
                Edit area
              </button>
            ) : null}
            <label className="flex flex-col gap-1">
              <span className="text-slate-500">From</span>
              <select
                value={range?.start ?? ""}
                onChange={(event) => {
                  setPlaying(false);
                  setRange((current) => ({
                    start: Number(event.target.value),
                    end: current?.end ?? Number(event.target.value),
                  }));
                }}
                className="rounded-lg border border-slate-700 bg-slate-950 px-2 py-1.5 text-slate-100"
              >
                {(payload?.years ?? []).map((year) => (
                  <option key={year} value={year}>
                    {year}
                  </option>
                ))}
              </select>
            </label>
            <label className="flex flex-col gap-1">
              <span className="text-slate-500">To</span>
              <select
                value={range?.end ?? ""}
                onChange={(event) => {
                  setPlaying(false);
                  setRange((current) => ({
                    start: current?.start ?? Number(event.target.value),
                    end: Number(event.target.value),
                  }));
                }}
                className="rounded-lg border border-slate-700 bg-slate-950 px-2 py-1.5 text-slate-100"
              >
                {(payload?.years ?? []).map((year) => (
                  <option key={year} value={year}>
                    {year}
                  </option>
                ))}
              </select>
            </label>
            <button
              type="button"
              disabled={!payload}
              onClick={() => goTour(tour === null ? 0 : null)}
              aria-pressed={tour !== null}
              className={`${actionButton} border-sky-500/40 bg-sky-500/10 text-sky-300 hover:bg-sky-500/20`}
            >
              {tour === null ? "Guided tour" : "Close tour"}
            </button>
            <button
              type="button"
              disabled={!payload}
              onClick={copyLink}
              className={`${actionButton} border-slate-600 text-slate-200 hover:bg-slate-800`}
            >
              Copy link
            </button>
            {STATIC_MODE || custom ? (
              <button
                type="button"
                disabled={download === "busy"}
                onClick={() => {
                  setDownload("busy");
                  downloadDetections(regionId, years[0] ?? 2000, years[years.length - 1] ?? 2026, aoi ?? undefined)
                    .then(({ rows, missing }) =>
                      setDownload(
                        `${rows.toLocaleString("en-US")} detections` +
                          (missing.length ? `, no file for ${missing.join(", ")}` : ""),
                      ),
                    )
                    .catch((cause: unknown) => setDownload(cause instanceof Error ? cause.message : "download failed"));
                }}
                title={
                  custom
                    ? "Every detection in the selected range inside the custom box, with its sensor, confidence and FRP."
                    : "Every detection in the selected range inside the region boundary, with its sensor, confidence and FRP."
                }
                className={`${actionButton} border-emerald-500/40 bg-emerald-500/10 text-emerald-300 hover:bg-emerald-500/20`}
              >
                {download === "busy" ? "Preparing CSV…" : "Download CSV"}
              </button>
            ) : (
              <a
                href={detectionsCsvUrl(regionId, years[0] ?? 2000, years[years.length - 1] ?? 2026)}
                title="Every detection in the selected range, with its sensor, confidence and FRP. Capped at 200,000 rows, so pick a range you need."
                className={`${actionButton} border-emerald-500/40 bg-emerald-500/10 text-emerald-300 hover:bg-emerald-500/20`}
              >
                Download CSV
              </a>
            )}
            </div>
          </div>
        </div>
        {aoiForm ? (
          <AreaForm
            initial={aoi ?? payload?.region.bbox ?? aoiLimits ?? [-1.5, 40.5, 0.5, 42]}
            limits={aoiLimits}
            onApply={(box) => applyArea(box, false)}
            onCancel={() => setAoiForm(false)}
          />
        ) : null}
        {region ? (
          <p className="mt-4 inline-flex max-w-full flex-wrap items-center gap-x-1.5 gap-y-1 rounded-full border border-slate-800 bg-slate-900/50 px-3 py-1.5 text-[11px] text-slate-500">
            {region.geometry ? "clipped to the official boundary" : `bbox ${region.bbox.map((value) => value.toFixed(1)).join(", ")}`}
            {" · "}
            {region.why}
          </p>
        ) : null}
        <p role="status" className="mt-1 min-h-[1rem] text-right text-[11px] text-slate-500">
          {notice ?? (download && download !== "busy" ? `CSV: ${download}` : "")}
        </p>
      </header>

      {problem ? (
        <div role="alert" className="mb-4 rounded-2xl border border-rose-500/40 bg-rose-500/10 p-4 text-sm text-rose-200">
          <p className="font-semibold">The view cannot be built</p>
          <p className="mt-1 text-rose-300">{problem}</p>
        </div>
      ) : null}

      {loading && !payload ? (
        <div aria-live="polite" aria-label="Loading the harmonized artifacts" className="grid gap-4 lg:grid-cols-[2fr_1fr]">
          {custom && progress ? (
            <p role="status" className="text-xs text-slate-400 lg:col-span-2">
              Building the custom area from the Spain detections: {progress.done} of {progress.total} years read. The
              first area takes a moment; the next ones reuse the data.
            </p>
          ) : null}
          <div className="h-72 animate-pulse rounded-2xl border border-slate-800 bg-slate-900/60" />
          <div className="h-72 animate-pulse rounded-2xl border border-slate-800 bg-slate-900/60" />
        </div>
      ) : null}

      {payload && method && years.length ? (
        <div className="space-y-4">
          <div id="section-calendar" className="grid scroll-mt-4 gap-4 lg:grid-cols-[2fr_1fr]">
            <div className="space-y-2">
              <div className="flex flex-wrap items-center justify-between gap-2 text-xs">
                <div role="group" aria-label="Calendar scale" className="flex items-center gap-1">
                  <button
                    type="button"
                    aria-pressed={mode === "index"}
                    onClick={() => onMode("index")}
                    className={`rounded-md px-2 py-1 focus-visible:outline focus-visible:outline-2 focus-visible:outline-sky-400 ${
                      mode === "index" ? "bg-slate-700 text-slate-100" : "text-slate-400 hover:text-slate-200"
                    }`}
                  >
                    Index
                  </button>
                  <button
                    type="button"
                    aria-pressed={mode === "anomaly"}
                    onClick={() => onMode("anomaly")}
                    className={`rounded-md px-2 py-1 focus-visible:outline focus-visible:outline-2 focus-visible:outline-sky-400 ${
                      mode === "anomaly" ? "bg-slate-700 text-slate-100" : "text-slate-400 hover:text-slate-200"
                    }`}
                  >
                    Anomaly
                  </button>
                </div>
                {selection ? (
                  <TimeControls
                    label={`${MONTHS[selection.month]} ${selection.year}`}
                    playing={isPlaying}
                    canPrev={position > 0}
                    canNext={!atEnd}
                    onPrev={() => {
                      setPlaying(false);
                      step(-1);
                    }}
                    onNext={() => {
                      setPlaying(false);
                      step(1);
                    }}
                    onToggle={togglePlay}
                  />
                ) : null}
              </div>
              <CalendarHeatmap
                payload={payload}
                mode={mode}
                scaleMax={scale}
                years={years}
                selection={selection}
                onSelect={pick}
              />
            </div>
            {selection ? <DetailPanel payload={payload} selection={selection} /> : null}
          </div>

          <div id="section-map" className="scroll-mt-4">
            {selection && column >= 0 ? (
              <MapPanel
                region={payload.region}
                year={selection.year}
                month={selection.month}
                partial={payload.partial[selection.month][column]}
                provisional={payload.provisional[selection.month][column]}
                dataRegion={custom ? AOI_SOURCE_REGION : undefined}
                clip={aoi}
                onDrawArea={(box) => {
                  const problem = applyArea(box, true);
                  if (problem) {
                    setNotice(problem);
                    window.setTimeout(() => setNotice(null), 4000);
                  }
                }}
              />
            ) : null}
          </div>

          <div className="grid gap-4 lg:grid-cols-2">
            <div id="section-yearly" className="scroll-mt-4">
              <YearlyTotals
                payload={payload}
                years={years}
                series={series}
                onSeries={onSeries}
                selectedYear={selection?.year ?? null}
                onPickYear={(year) => pick({ year, month: selection?.month ?? 0 })}
                uncertainFrom={method.validation.overlap_years[0] ?? null}
                typicalErrorPct={method.validation.median_abs_error_pct}
                worstErrorPct={method.validation.worst_abs_error_pct}
              />
            </div>
            <Seasonality
              payload={payload}
              selectedMonth={selection?.month ?? null}
              onPickMonth={(month) => pick({ year: selection?.year ?? years[years.length - 1], month })}
            />
          </div>

          {custom ? (
            <p
              role="note"
              className="rounded-xl border border-amber-500/40 bg-amber-500/10 px-4 py-3 text-xs leading-relaxed text-amber-200"
            >
              <strong className="font-semibold">Custom area:</strong> the calibration and validation below are Spain&apos;s.
              This box borrows Spain&apos;s monthly factors as they are and is not validated on its own; small areas
              with few detections are noisy.
            </p>
          ) : null}

          <div className="grid gap-4 lg:grid-cols-2">
            <MonthlySeries payload={payload} years={years} />
            <Validation method={method} />
          </div>

          <Provenance method={method} />
        </div>
      ) : null}

      <footer className="mt-6 text-[11px] text-slate-600">
        Firetrack · NASA Space Apps Challenge 2026 · harmonized activity index, never a fire count.
      </footer>

      {tour !== null && tourSteps.length ? (
        <GuidedTour steps={tourSteps} index={tour} onIndex={goTour} onExit={() => goTour(null)} />
      ) : null}
    </div>
  );
}

/** The running year is a preview, so open on the last month that is actually complete. */
function latestUsable(payload: CalendarPayload): Selection {
  const lastColumn = payload.years.length - 1;
  for (let month = 11; month >= 0; month -= 1) {
    if (payload.harmonized[month][lastColumn] !== null && !payload.partial[month][lastColumn]) {
      return { year: payload.years[lastColumn], month };
    }
  }
  return { year: payload.years[lastColumn], month: 11 };
}

/** The busiest month of the last complete year: the one worth opening on the map. */
function peakCell(payload: CalendarPayload): Selection {
  let column = payload.years.length - 1;
  while (column > 0 && payload.provisional[0][column]) column -= 1;
  let best = 0;
  let bestValue = Number.NEGATIVE_INFINITY;
  for (let month = 0; month < 12; month += 1) {
    const value = payload.harmonized[month][column];
    if (value !== null && value > bestValue) {
      best = month;
      bestValue = value;
    }
  }
  return { year: payload.years[column], month: best };
}
