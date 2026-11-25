"use client";

import { useEffect, useMemo, useRef, useState } from "react";

import { DayBars } from "@/features/map/DayBars";
import {
  clamp,
  confidenceLabel,
  FamilyToggle,
  Glyph,
  MapButton,
  MODIS_COLOR,
  radiusPx,
  Row,
  VIIRS_COLOR,
  type DayCounts,
  type Point,
} from "@/features/map/mapShared";
import { StrongestDetections } from "@/features/map/StrongestDetections";
import { inBox, type Bbox } from "@/features/area/aoi";
import { useMapView } from "@/features/map/useMapView";
import {
  DetectionsError,
  familyOf,
  loadDetections,
  rowsInMonth,
  type Detection,
  type Family,
} from "@/features/map/detections";
import { MONTHS, formatCount } from "@/shared/format";
import { geoJsonToPath, loadBoundary, makeProjection } from "@/features/map/geo";
import type { Region } from "@/shared/types";

type Props = {
  region: Region;
  year: number;
  /** Zero-based. */
  month: number;
  partial: boolean;
  provisional: boolean;
  /** Published region whose detection files feed this map; a custom area reads Spain's. */
  dataRegion?: string;
  /** Keep only the detections inside this box (a custom area). */
  clip?: Bbox | null;
  /** Turns on "Draw area": called with the rectangle the person dragged, in lon/lat. */
  onDrawArea?: (box: Bbox) => void;
};

type Hover = { id: number; left: number; top: number };

/**
 * S7: the detections behind one calendar cell, drawn on the region's own
 * boundary. MODIS squares and VIIRS circles share the map, so the reason the
 * raw count needs harmonizing is visible: the same fires, a finer camera.
 *
 * No map library and no tile server: the outline is the boundary the
 * detections were clipped to, so it also works offline at a demo.
 *
 * The file holds the panel and its two data loads. Zoom and pan live in
 * `useMapView`, the per-day bars in `DayBars`, the ranking in
 * `StrongestDetections`, and the shared pieces in `mapShared`.
 */
export function MapPanel({ region, year, month, partial, provisional, dataRegion, clip, onDrawArea }: Props) {
  const source = dataRegion ?? region.id;
  const projection = useMemo(() => makeProjection(region.bbox), [region.bbox]);
  const width = projection.width;
  const height = projection.height;

  const map = useMapView(width, height);
  const { frame, svg, view, size, dragging, scale, unit, viewBox } = map;

  const [loaded, setLoaded] = useState<{ key: string; rows: Detection[]; error: string | null } | null>(null);
  const [outlineState, setOutlineState] = useState<{ key: string; path: string | null } | null>(null);
  const [show, setShow] = useState<Record<Family, boolean>>({ MODIS: true, VIIRS: true });
  /**
   * Day, hovered mark and keyboard focus all belong to one month: a different month
   * starts clean. Storing the month with the value derives the reset instead of an
   * effect that clears three setters on every change.
   */
  const [marks, setMarks] = useState<{ period: string; day: number | null; hover: Hover | null; focus: number | null }>({
    period: "",
    day: null,
    hover: null,
    focus: null,
  });

  const period = `${year}-${month}`;
  const mark = marks.period === period ? marks : { period, day: null, hover: null, focus: null };
  const day = mark.day;
  const hover = mark.hover;
  const focusId = mark.focus;
  const setMarksNow = (next: { day?: number | null; hover?: Hover | null; focus?: number | null }) =>
    setMarks((current) => ({ ...(current.period === period ? current : mark), period, ...next }));
  const setDay = (value: number | null) => setMarksNow({ day: value });
  const setHover = (value: Hover | null) => setMarksNow({ hover: value });
  const setFocusId = (value: number | null) => setMarksNow({ focus: value });

  const requestKey = `${source}:${year}`;
  const request = loaded && loaded.key === requestKey ? loaded : null;
  const status: "loading" | "ready" | "error" =
    request === null ? "loading" : request.error === null ? "ready" : "error";
  const problem = request?.error ?? null;
  // A custom box has no boundary of its own: it shows the source region's, cut by the box.
  const boundaryId = region.geometry ? region.id : source !== region.id ? source : null;
  const outline = outlineState && outlineState.key === boundaryId ? outlineState.path : null;

  const [drawing, setDrawing] = useState(false);
  const [sketch, setSketch] = useState<{ x0: number; y0: number; x1: number; y1: number } | null>(null);
  const sketchStart = useRef<{ x: number; y: number } | null>(null);

  // One request per year, cached; the year after is prefetched so playback has no gap at New Year.
  useEffect(() => {
    let alive = true;
    const key = `${source}:${year}`;
    loadDetections(source, year)
      .then((rows) => {
        if (!alive) return;
        setLoaded({ key, rows, error: null });
        loadDetections(source, year + 1).catch(() => undefined);
      })
      .catch((cause: unknown) => {
        if (!alive) return;
        setLoaded({
          key,
          rows: [],
          error:
            cause instanceof DetectionsError || cause instanceof Error
              ? cause.message
              : "The detections could not be loaded.",
        });
      });
    return () => {
      alive = false;
    };
  }, [source, year]);

  useEffect(() => {
    if (!boundaryId) return;
    let alive = true;
    loadBoundary(boundaryId)
      .then((geojson) => {
        if (alive) setOutlineState({ key: boundaryId, path: geoJsonToPath(geojson, projection.project) });
      })
      .catch(() => {
        if (alive) setOutlineState({ key: boundaryId, path: null });
      });
    return () => {
      alive = false;
    };
  }, [boundaryId, projection]);

  const monthRows = useMemo(
    () => {
      if (!request) return [];
      const rows = rowsInMonth(request.rows, year, month);
      return clip ? rows.filter((row) => inBox(row.lat, row.lon, clip)) : rows;
    },
    [request, year, month, clip],
  );

  const points = useMemo<Point[]>(() => {
    const list = monthRows.map((row, id) => {
      const [x, y] = projection.project(row.lon, row.lat);
      return { id, x, y, family: familyOf(row.sensor), day: Number(row.date.slice(8, 10)), row };
    });
    // Big marks first, so small ones are never buried under them.
    return list.sort((a, b) => (b.row.frp ?? 0) - (a.row.frp ?? 0));
  }, [monthRows, projection]);

  const daysInMonth = new Date(year, month + 1, 0).getDate();

  const counts = useMemo<DayCounts>(() => {
    const modis = new Array<number>(daysInMonth).fill(0);
    const viirs = new Array<number>(daysInMonth).fill(0);
    let totalModis = 0;
    let totalViirs = 0;
    for (const point of points) {
      const slot = point.day - 1;
      if (slot < 0 || slot >= daysInMonth) continue;
      if (point.family === "VIIRS") {
        viirs[slot] += 1;
        totalViirs += 1;
      } else {
        modis[slot] += 1;
        totalModis += 1;
      }
    }
    return { modis, viirs, totalModis, totalViirs };
  }, [points, daysInMonth]);

  const visible = useMemo(
    () => points.filter((point) => show[point.family] && (day === null || point.day === day)),
    [points, show, day],
  );

  const layer = useMemo(
    () =>
      visible.map((point) => {
        const r = radiusPx(point.row.frp) * unit;
        return point.family === "VIIRS" ? (
          <circle
            key={point.id}
            cx={point.x}
            cy={point.y}
            r={r}
            fill={VIIRS_COLOR}
            fillOpacity={0.5}
            stroke="#bae6fd"
            strokeOpacity={0.9}
            strokeWidth={unit}
          />
        ) : (
          <rect
            key={point.id}
            x={point.x - r}
            y={point.y - r}
            width={r * 2}
            height={r * 2}
            fill={MODIS_COLOR}
            fillOpacity={0.12}
            stroke={MODIS_COLOR}
            strokeWidth={1.5 * unit}
          />
        );
      }),
    [visible, unit],
  );

  const activeId = hover?.id ?? focusId;
  const active = activeId === null ? null : (visible.find((point) => point.id === activeId) ?? null);

  function inspect(event: React.PointerEvent) {
    const at = map.toMap(event.clientX, event.clientY);
    const box = frame.current?.getBoundingClientRect();
    if (!at || !box) return;
    let best: Point | null = null;
    let bestDistance = (12 / scale) ** 2;
    for (const point of visible) {
      const dx = point.x - at.x;
      const dy = point.y - at.y;
      const distance = dx * dx + dy * dy;
      if (distance < bestDistance) {
        best = point;
        bestDistance = distance;
      }
    }
    setHover(best ? { id: best.id, left: event.clientX - box.left, top: event.clientY - box.top } : null);
  }

  function onPointerDown(event: React.PointerEvent<SVGSVGElement>) {
    if (drawing) {
      const at = map.toMap(event.clientX, event.clientY);
      if (!at || event.button !== 0) return;
      event.currentTarget.setPointerCapture(event.pointerId);
      sketchStart.current = at;
      setSketch({ x0: at.x, y0: at.y, x1: at.x, y1: at.y });
      setHover(null);
      return;
    }
    // A tap on a touch screen is the only way to inspect a mark there.
    if (event.pointerType === "touch") inspect(event);
    if (view.k <= 1 || event.button !== 0) return;
    event.currentTarget.setPointerCapture(event.pointerId);
    map.startDrag(event.clientX, event.clientY);
  }

  function onPointerMove(event: React.PointerEvent<SVGSVGElement>) {
    if (drawing) {
      const start = sketchStart.current;
      const at = start ? map.toMap(event.clientX, event.clientY) : null;
      if (start && at) setSketch({ x0: start.x, y0: start.y, x1: at.x, y1: at.y });
      return;
    }
    if (map.pan(event.clientX, event.clientY)) {
      setHover(null);
      return;
    }
    if (event.pointerType !== "touch") inspect(event);
  }

  function onPointerUp() {
    if (!drawing) {
      map.endDrag();
      return;
    }
    const drawn = sketch;
    sketchStart.current = null;
    setSketch(null);
    // A click without a drag is not an area.
    if (!drawn || !onDrawArea) return;
    if (Math.abs(drawn.x1 - drawn.x0) * scale < 6 || Math.abs(drawn.y1 - drawn.y0) * scale < 6) return;
    const [west, north] = projection.unproject(Math.min(drawn.x0, drawn.x1), Math.min(drawn.y0, drawn.y1));
    const [east, south] = projection.unproject(Math.max(drawn.x0, drawn.x1), Math.max(drawn.y0, drawn.y1));
    setDrawing(false);
    onDrawArea([west, south, east, north]);
  }

  function cancelSketch() {
    sketchStart.current = null;
    setSketch(null);
    map.endDrag();
  }

  const monthLabel = `${MONTHS[month]} ${year}`;
  const loading = status === "loading";
  const emptyAll = status === "ready" && points.length === 0;
  const emptyFiltered = status === "ready" && points.length > 0 && visible.length === 0;
  const ratio =
    counts.totalModis > 0 && counts.totalViirs > 0 ? counts.totalViirs / counts.totalModis : null;
  const maxDay = Math.max(
    1,
    ...counts.modis.map((value, index) => (show.MODIS ? value : 0) + (show.VIIRS ? counts.viirs[index] : 0)),
  );

  return (
    <div className="grid grid-cols-1 gap-4 lg:grid-cols-[2fr_1fr]">
      <section className="rounded-xl border border-slate-800 bg-slate-900/40 p-4">
        <header className="mb-3 flex flex-wrap items-baseline justify-between gap-2">
          <h2 className="text-sm font-semibold text-slate-200">Hotspots · {monthLabel}</h2>
          <span className="text-xs text-slate-400">
            {loading
              ? `Loading ${year}…`
              : `${formatCount(visible.length)} of ${formatCount(points.length)} detections shown`}
            {day !== null ? ` · day ${day}` : ""}
          </span>
        </header>

        <div
          ref={frame}
          className="relative h-[420px] overflow-hidden rounded-lg border border-slate-800 bg-slate-950 sm:h-[500px]"
        >
          <svg
            ref={svg}
            viewBox={viewBox}
            preserveAspectRatio="xMidYMid meet"
            role="img"
            aria-label={`Map of ${formatCount(visible.length)} detections in ${monthLabel}`}
            className="h-full w-full select-none"
            style={{
              touchAction: drawing || view.k > 1 ? "none" : "pan-y",
              cursor: drawing ? "crosshair" : dragging ? "grabbing" : view.k > 1 ? "grab" : "default",
            }}
            onPointerDown={onPointerDown}
            onPointerMove={onPointerMove}
            onPointerUp={onPointerUp}
            onPointerCancel={cancelSketch}
            onPointerLeave={() => setHover(null)}
          >
            {outline ? (
              <path
                d={outline}
                fill="rgba(30,41,59,0.6)"
                stroke="#64748b"
                strokeWidth={1}
                vectorEffect="non-scaling-stroke"
                fillRule="evenodd"
              />
            ) : null}
            {clip ? (
              <rect
                x={0}
                y={0}
                width={width}
                height={height}
                fill="none"
                stroke="#38bdf8"
                strokeOpacity={0.6}
                strokeWidth={2}
                strokeDasharray="6 4"
                vectorEffect="non-scaling-stroke"
              />
            ) : null}
            <g style={{ opacity: loading ? 0.35 : 1, transition: "opacity 150ms" }}>{layer}</g>
            {active ? (
              <circle
                cx={active.x}
                cy={active.y}
                r={(radiusPx(active.row.frp) + 5) * unit}
                fill="none"
                stroke="#f8fafc"
                strokeWidth={2 * unit}
              />
            ) : null}
            {sketch ? (
              <rect
                x={Math.min(sketch.x0, sketch.x1)}
                y={Math.min(sketch.y0, sketch.y1)}
                width={Math.abs(sketch.x1 - sketch.x0)}
                height={Math.abs(sketch.y1 - sketch.y0)}
                fill="rgba(56,189,248,0.12)"
                stroke="#38bdf8"
                strokeWidth={2 * unit}
                strokeDasharray={`${6 * unit} ${4 * unit}`}
              />
            ) : null}
          </svg>

          {onDrawArea ? (
            <button
              type="button"
              aria-pressed={drawing}
              onClick={() => {
                cancelSketch();
                setDrawing((current) => !current);
              }}
              className={`absolute left-2 top-2 rounded-md border px-2 py-1 text-[11px] font-medium focus-visible:outline focus-visible:outline-2 focus-visible:outline-sky-400 ${
                drawing
                  ? "border-sky-400 bg-sky-500/20 text-sky-200"
                  : "border-slate-700 bg-slate-950/85 text-slate-200 hover:bg-slate-800"
              }`}
            >
              {drawing ? "Cancel drawing" : "Draw area"}
            </button>
          ) : null}
          {drawing && !sketch ? (
            <p
              role="status"
              className="pointer-events-none absolute left-1/2 top-2 -translate-x-1/2 rounded-md bg-slate-950/90 px-2 py-1 text-[11px] text-sky-200"
            >
              Drag a rectangle to define the area of interest
            </p>
          ) : null}

          <div className="absolute right-2 top-2 flex flex-col gap-1">
            <MapButton label="Zoom in" onClick={() => map.zoomBy(1.6)}>
              +
            </MapButton>
            <MapButton label="Zoom out" onClick={() => map.zoomBy(1 / 1.6)}>
              −
            </MapButton>
            <MapButton label="Reset the view" disabled={view.k === 1} onClick={map.reset}>
              ⤢
            </MapButton>
          </div>

          <div className="pointer-events-none absolute bottom-2 left-2 flex items-center gap-2 rounded-md bg-slate-950/85 px-2 py-1 text-[10px] text-slate-300">
            <Glyph family="MODIS" /> MODIS 1 km
            <Glyph family="VIIRS" /> VIIRS 375 m
            <span className="text-slate-500">· size = fire radiative power</span>
          </div>

          {!drawing && (loading || problem || emptyAll || emptyFiltered) ? (
            <div className="pointer-events-none absolute inset-0 flex items-center justify-center p-6 text-center">
              <p
                role={problem ? "alert" : "status"}
                className={`max-w-xs rounded-lg px-3 py-2 text-xs ${
                  problem
                    ? "border border-rose-500/40 bg-rose-950/80 text-rose-200"
                    : "bg-slate-950/85 text-slate-300"
                }`}
              >
                {problem
                  ? `${problem} Run python -m firetrack.pipeline.export_web to rebuild the files.`
                  : loading
                    ? `Loading ${year} detections…`
                    : emptyAll
                      ? `No detections inside the boundary in ${monthLabel}.${partial ? " The month is still being observed." : ""}`
                      : "Nothing matches the current filters."}
              </p>
            </div>
          ) : null}

          {hover && active ? (
            <div
              className="pointer-events-none absolute z-10 w-48 -translate-x-1/2 -translate-y-full rounded-lg border border-slate-700 bg-slate-950/95 p-2 text-xs shadow-xl"
              style={{ left: clamp(hover.left, 100, Math.max(size.w - 100, 100)), top: hover.top - 12 }}
            >
              <div className="mb-1 font-semibold text-slate-100">{active.row.date}</div>
              <Row label="Sensor" value={`${active.family} · ${active.row.satellite || active.row.sensor}`} />
              <Row label="Radiative power" value={active.row.frp === null ? "—" : `${active.row.frp.toFixed(1)} MW`} />
              <Row label="Confidence" value={confidenceLabel(active.row)} />
              <Row label="Overpass" value={active.row.daynight === "N" ? "night" : active.row.daynight === "D" ? "day" : "—"} />
            </div>
          ) : null}
        </div>

        <p className="mt-2 text-[11px] leading-relaxed text-slate-500">
          Each mark is one satellite pixel, not one fire. Drag to pan once zoomed, use + / − or Ctrl/⌘ + scroll to zoom.
          {onDrawArea ? " Draw area turns a dragged rectangle into a custom area of interest." : ""}
          {provisional ? (
            <span className="text-amber-300"> Running year: near-real-time rows still mixed in.</span>
          ) : null}
        </p>
      </section>

      <section className="rounded-xl border border-slate-800 bg-slate-900/40 p-4">
        <h2 className="mb-1 text-sm font-semibold text-slate-200">Who saw what</h2>
        <p className="mb-3 text-xs text-slate-400">Tap a sensor to hide or show it.</p>

        <div className="space-y-1.5">
          <FamilyToggle
            family="MODIS"
            detail="1 km pixels"
            count={counts.totalModis}
            on={show.MODIS}
            onToggle={() => setShow((current) => ({ ...current, MODIS: !current.MODIS }))}
          />
          <FamilyToggle
            family="VIIRS"
            detail="375 m pixels"
            count={counts.totalViirs}
            on={show.VIIRS}
            onToggle={() => setShow((current) => ({ ...current, VIIRS: !current.VIIRS }))}
          />
        </div>

        <p className="mt-3 text-xs leading-relaxed text-slate-400">
          {ratio !== null ? (
            <>
              VIIRS drew <strong className="text-slate-200">{ratio.toFixed(1)}×</strong> as many marks as MODIS this
              month. Same fires, finer pixels: that gap is what the harmonized index removes.
            </>
          ) : counts.totalViirs === 0 && counts.totalModis > 0 ? (
            <>No VIIRS detections inside the boundary this month.</>
          ) : counts.totalModis === 0 && counts.totalViirs > 0 ? (
            <>No MODIS detections inside the boundary this month.</>
          ) : (
            <>Nothing to compare in this month.</>
          )}
        </p>

        <div className="mt-4 border-t border-slate-800 pt-3">
          <div className="mb-1.5 flex items-baseline justify-between gap-2">
            <h3 className="text-xs font-semibold text-slate-300">Per day</h3>
            {day !== null ? (
              <button
                type="button"
                onClick={() => setDay(null)}
                className="text-[11px] text-sky-300 hover:underline focus-visible:outline focus-visible:outline-2 focus-visible:outline-sky-400"
              >
                Show the whole month
              </button>
            ) : (
              <span className="text-[11px] text-slate-500">click a bar to isolate a day</span>
            )}
          </div>
          <DayBars
            month={month}
            daysInMonth={daysInMonth}
            counts={counts}
            maxDay={maxDay}
            showModis={show.MODIS}
            showViirs={show.VIIRS}
            selected={day}
            onPick={setDay}
          />
          <div className="mt-1 flex justify-between text-[10px] tabular-nums text-slate-500">
            <span>1</span>
            <span>{daysInMonth}</span>
          </div>
        </div>

        <div className="mt-4 border-t border-slate-800 pt-3">
          <h3 className="mb-1.5 text-xs font-semibold text-slate-300">Strongest detections</h3>
          <StrongestDetections
            points={visible}
            onFocus={setFocusId}
            onZoom={(point) => map.zoomToPoint(point.x, point.y, 4)}
          />
        </div>
      </section>
    </div>
  );
}
