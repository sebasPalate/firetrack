"use client";

import { useMemo, useState, useSyncExternalStore } from "react";

import { AreaForm } from "@/features/area/AreaForm";
import { AOI_SOURCE_REGION, CUSTOM_REGION_ID, clampBox, formatBox, validateBox, type Bbox } from "@/features/area/aoi";
import { AtAGlance } from "@/features/calendar/AtAGlance";
import { CalendarHeatmap } from "@/features/calendar/CalendarHeatmap";
import { DetailPanel } from "@/features/calendar/DetailPanel";
import { MonthlySeries } from "@/features/calendar/MonthlySeries";
import { Seasonality } from "@/features/calendar/Seasonality";
import { YearlyTotals } from "@/features/calendar/YearlyTotals";
import { summarize } from "@/features/calendar/insights";
import type { Series, ViewMode } from "@/features/calendar/view";
import { MapPanel } from "@/features/map/MapPanel";
import { Provenance } from "@/features/method/Provenance";
import { Validation } from "@/features/method/Validation";
import { inRange, isWholeYears, rangeLabel, type MonthRange } from "@/features/range/range";
import { GuidedTour } from "@/features/tour/GuidedTour";
import { STATIC_MODE, detectionsCsvUrl } from "@/shared/api";
import { MONTHS } from "@/shared/format";
import type { Region } from "@/shared/types";

import { CalendarToolbar } from "./CalendarToolbar";
import { ControlsBar } from "./ControlsBar";
import { busiestMonth, colorScale, latestUsable } from "./calendarView";
import {
  useDetectionsDownload,
  useNotice,
  usePlayback,
  useRegionData,
  useRegions,
  useUrlSync,
} from "./hooks";
import { useCalendarExports } from "./useCalendarExports";
import { useTour } from "./useTour";
import { parseUrlState, subscribeToUrl, urlSnapshot, type UrlState } from "./urlState";

/** The region the page opens on when the list has it. */
const DEFAULT_REGION = "spain";

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

  const { regions, error: regionsError } = useRegions();
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
      // The range and month belong to the region they were picked in.
      onRegion={setPickedRegion}
    />
  );
}

type RegionViewProps = {
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
};

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
}: RegionViewProps) {
  const data = useRegionData(regionId, aoi, initial);
  const { payload, method, range, setRange, selection, setSelection } = data;
  const [areaFormOpen, setAreaFormOpen] = useState(false);
  const { notice, flash } = useNotice();
  const detections = useDetectionsDownload(regionId, range, aoi);

  const custom = aoi !== null;
  /** Every custom box is cut from the source region's data, so it must lie inside its box. */
  const aoiLimits = regions.find((candidate) => candidate.id === AOI_SOURCE_REGION)?.bbox ?? null;

  /** Every year the range touches: the calendar shows them whole, so a season keeps its context. */
  const years = useMemo(() => {
    if (!payload) return [];
    const low = range?.start.year ?? payload.years[0];
    const high = range?.end.year ?? payload.years[payload.years.length - 1];
    return payload.years.filter((year) => year >= low && year <= high);
  }, [payload, range]);

  /** The one rule every number and download reads: is this month part of the answer? */
  const within = useMemo(
    () => (range ? (year: number, month: number) => inRange(year, month, range) : () => true),
    [range],
  );

  const scale = useMemo(() => (payload ? colorScale(payload, years, mode, within) : 1), [payload, years, mode, within]);
  const summary = useMemo(
    () => (payload && years.length ? summarize(payload, years, within) : null),
    [payload, years, within],
  );

  const playback = usePlayback(payload, years, within, selection, setSelection);
  const exports = useCalendarExports({
    payload,
    years,
    within,
    range,
    mode,
    scale,
    regionId,
    aoi,
    onError: (message) => flash(message, 4000),
  });
  const tour = useTour({
    payload,
    method,
    onSeries,
    onMode,
    setRange,
    setSelection,
    stopPlaying: playback.stop,
  });

  useUrlSync({ payload, range, selection, regionId, aoi, mode, series });

  /** A box from the form or the map: rounded for a stable link, kept inside the data, then checked. */
  function applyArea(box: Bbox, drawn: boolean): string | null {
    const rounded = box.map((value) => Number(value.toFixed(4))) as Bbox;
    const candidate = drawn && aoiLimits ? clampBox(rounded, aoiLimits) : rounded;
    const problem = aoiLimits ? validateBox(candidate, aoiLimits) : null;
    if (problem) return problem;
    setAreaFormOpen(false);
    onAoi(candidate);
    return null;
  }

  function changeRange(next: MonthRange) {
    playback.stop();
    setRange(next);
    if (payload && (!selection || !inRange(selection.year, selection.month, next))) {
      setSelection(latestUsable(payload, next));
    }
  }

  async function copyLink() {
    try {
      await navigator.clipboard.writeText(window.location.href);
      flash("Link copied", 2500);
    } catch {
      flash("Could not copy. The address bar has the link.", 2500);
    }
  }

  const column = payload && selection ? payload.years.indexOf(selection.year) : -1;
  const region = custom ? payload?.region : regions.find((candidate) => candidate.id === regionId);
  const problem = data.error ?? regionsError;
  const rangeText = range ? rangeLabel(range) : `${years[0]}–${years[years.length - 1]}`;

  return (
    <div className={`mx-auto max-w-[1400px] px-4 py-5 sm:px-6 sm:py-8 ${tour.tour !== null ? "pb-72" : ""}`}>
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
          <ControlsBar
            regions={regions}
            regionId={regionId}
            custom={custom}
            areaFormOpen={areaFormOpen}
            onPickRegion={(next) => {
              setAreaFormOpen(false);
              onRegion(next);
            }}
            onOpenAreaForm={() => setAreaFormOpen(true)}
            years={payload?.years ?? []}
            range={range}
            onRange={changeRange}
            ready={payload !== null}
            tourOpen={tour.tour !== null}
            onToggleTour={() => tour.go(tour.tour === null ? 0 : null)}
            onCopyLink={copyLink}
            download={{
              inBrowser: STATIC_MODE || custom || (range !== null && !isWholeYears(range)),
              busy: detections.status === "busy",
              onStart: detections.start,
              href: detectionsCsvUrl(regionId, years[0] ?? 2000, years[years.length - 1] ?? 2026),
            }}
          />
        </div>
        {areaFormOpen ? (
          <AreaForm
            initial={aoi ?? payload?.region.bbox ?? aoiLimits ?? [-1.5, 40.5, 0.5, 42]}
            limits={aoiLimits}
            onApply={(box) => applyArea(box, false)}
            onCancel={() => setAreaFormOpen(false)}
          />
        ) : null}
        {region ? (
          <p className="mt-4 inline-flex max-w-full flex-wrap items-center gap-x-1.5 gap-y-1 rounded-2xl border border-slate-800 bg-slate-900/50 px-3 py-1.5 text-[11px] text-slate-500">
            {region.geometry ? "clipped to the official boundary" : `bbox ${region.bbox.map((value) => value.toFixed(1)).join(", ")}`}
            {" · "}
            {region.why}
          </p>
        ) : null}
        <p role="status" className="mt-1 min-h-[1rem] text-right text-[11px] text-slate-500">
          {notice ?? (detections.status && detections.status !== "busy" ? `CSV: ${detections.status}` : "")}
        </p>
      </header>

      {problem ? (
        <div role="alert" className="mb-4 rounded-2xl border border-rose-500/40 bg-rose-500/10 p-4 text-sm text-rose-200">
          <p className="font-semibold">The view cannot be built</p>
          <p className="mt-1 text-rose-300">{problem}</p>
        </div>
      ) : null}

      {data.loading && !payload ? (
        <div aria-live="polite" aria-label="Loading the harmonized artifacts" className="grid grid-cols-1 gap-4 lg:grid-cols-[2fr_1fr]">
          {custom && data.progress ? (
            <p role="status" className="text-xs text-slate-400 lg:col-span-2">
              Building the custom area from the Spain detections: {data.progress.done} of {data.progress.total} years
              read. The first area takes a moment; the next ones reuse the data.
            </p>
          ) : null}
          <div className="h-72 animate-pulse rounded-2xl border border-slate-800 bg-slate-900/60" />
          <div className="h-72 animate-pulse rounded-2xl border border-slate-800 bg-slate-900/60" />
        </div>
      ) : null}

      {payload && method && years.length ? (
        <div className="space-y-4">
          {summary ? (
            <AtAGlance
              summary={summary}
              range={rangeText}
              peakOfYear={(year) => busiestMonth(payload, year)}
              onSelect={(next) => {
                playback.pick(next);
                document.getElementById("section-calendar")?.scrollIntoView({ block: "start" });
              }}
            />
          ) : null}
          <div id="section-calendar" className="grid grid-cols-1 scroll-mt-4 gap-4 lg:grid-cols-[2fr_1fr]">
            <div className="space-y-2">
              <CalendarToolbar
                mode={mode}
                onMode={onMode}
                onExportTable={exports.exportTable}
                onExportImage={exports.exportImage}
                selectionLabel={selection ? `${MONTHS[selection.month]} ${selection.year}` : null}
                playback={{
                  isPlaying: playback.isPlaying,
                  canPrev: playback.canPrev,
                  canNext: playback.canNext,
                  onPrev: () => playback.step(-1),
                  onNext: () => playback.step(1),
                  onToggle: playback.toggle,
                }}
              />
              <CalendarHeatmap
                payload={payload}
                mode={mode}
                scaleMax={scale}
                years={years}
                selection={selection}
                onSelect={playback.pick}
                inRange={within}
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
                  const refused = applyArea(box, true);
                  if (refused) flash(refused, 4000);
                }}
              />
            ) : null}
          </div>

          <div className="grid grid-cols-1 gap-4 lg:grid-cols-2">
            <div id="section-yearly" className="scroll-mt-4">
              <YearlyTotals
                payload={payload}
                years={years}
                inRange={within}
                rangeNote={range && !isWholeYears(range) ? rangeLabel(range) : null}
                series={series}
                onSeries={onSeries}
                selectedYear={selection?.year ?? null}
                onPickYear={(year) => playback.pick({ year, month: selection?.month ?? 0 })}
                uncertainFrom={method.validation.overlap_years[0] ?? null}
                typicalErrorPct={method.validation.median_abs_error_pct}
                worstErrorPct={method.validation.worst_abs_error_pct}
              />
            </div>
            <Seasonality
              payload={payload}
              selectedMonth={selection?.month ?? null}
              onPickMonth={(month) => playback.pick({ year: selection?.year ?? years[years.length - 1], month })}
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

          <div className="grid grid-cols-1 gap-4 lg:grid-cols-2">
            <MonthlySeries payload={payload} years={years} inRange={within} />
            <Validation method={method} />
          </div>

          <Provenance method={method} />
        </div>
      ) : null}

      <footer className="mt-6 text-[11px] text-slate-600">
        Firetrack · NASA Space Apps Challenge 2026 · harmonized activity index, never a fire count.
      </footer>

      {tour.tour !== null && tour.steps.length ? (
        <GuidedTour steps={tour.steps} index={tour.tour} onIndex={tour.go} onExit={() => tour.go(null)} />
      ) : null}
    </div>
  );
}
