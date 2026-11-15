"use client";

import { useCallback, useEffect, useMemo, useRef, useState } from "react";

import {
  DetectionsError,
  familyOf,
  loadDetections,
  rowsInMonth,
  type Detection,
  type Family,
} from "@/lib/detections";
import { MONTHS, formatCount } from "@/lib/format";
import { geoJsonToPath, loadBoundary, makeProjection } from "@/lib/geo";
import type { Region } from "@/lib/types";

type Props = {
  region: Region;
  year: number;
  /** Zero-based. */
  month: number;
  partial: boolean;
  provisional: boolean;
};

type View = { cx: number; cy: number; k: number };
type Point = { id: number; x: number; y: number; family: Family; day: number; row: Detection };
type Hover = { id: number; left: number; top: number };

const MAX_ZOOM = 14;
const CONFIDENCE: Record<string, string> = { l: "low", n: "nominal", h: "high" };
const MODIS_COLOR = "#fbbf24";
const VIIRS_COLOR = "#38bdf8";

function clamp(value: number, low: number, high: number): number {
  return Math.min(high, Math.max(low, value));
}

/** Keep the view inside the map: the centre may only travel as far as the zoomed window allows. */
function clampView(view: View, width: number, height: number): View {
  const halfWidth = width / view.k / 2;
  const halfHeight = height / view.k / 2;
  return {
    k: view.k,
    cx: clamp(view.cx, halfWidth, width - halfWidth),
    cy: clamp(view.cy, halfHeight, height - halfHeight),
  };
}

function zoomView(
  view: View,
  nextK: number,
  width: number,
  height: number,
  anchor?: { x: number; y: number },
): View {
  const k = clamp(nextK, 1, MAX_ZOOM);
  const ax = anchor?.x ?? view.cx;
  const ay = anchor?.y ?? view.cy;
  const ratio = view.k / k;
  return clampView({ k, cx: ax - (ax - view.cx) * ratio, cy: ay - (ay - view.cy) * ratio }, width, height);
}

/** Mark size on screen, in pixels: grows with fire radiative power, never vanishes, never swamps. */
function radiusPx(frp: number | null): number {
  return clamp(2.2 + Math.sqrt(Math.max(frp ?? 1, 0)) * 0.85, 2.5, 9);
}

/**
 * S7: the detections behind one calendar cell, drawn on the region's own
 * boundary. MODIS squares and VIIRS circles share the map, so the reason the
 * raw count needs harmonizing is visible: the same fires, a finer camera.
 *
 * No map library and no tile server: the outline is the boundary the
 * detections were clipped to, so it also works offline at a demo.
 */
export function MapPanel({ region, year, month, partial, provisional }: Props) {
  const projection = useMemo(() => makeProjection(region.bbox), [region.bbox]);
  const width = projection.width;
  const height = projection.height;

  const frame = useRef<HTMLDivElement>(null);
  const svg = useRef<SVGSVGElement>(null);
  const drag = useRef<{ x: number; y: number; cx: number; cy: number } | null>(null);

  const [loaded, setLoaded] = useState<{ key: string; rows: Detection[]; error: string | null } | null>(null);
  const [outlineState, setOutlineState] = useState<{ key: string; path: string | null } | null>(null);
  const [show, setShow] = useState<Record<Family, boolean>>({ MODIS: true, VIIRS: true });
  const [view, setView] = useState<View>({ cx: width / 2, cy: height / 2, k: 1 });
  const [size, setSize] = useState({ w: 800, h: 460 });
  const [dragging, setDragging] = useState(false);
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

  const requestKey = `${region.id}:${year}`;
  const request = loaded && loaded.key === requestKey ? loaded : null;
  const status: "loading" | "ready" | "error" =
    request === null ? "loading" : request.error === null ? "ready" : "error";
  const problem = request?.error ?? null;
  const outline = outlineState && outlineState.key === region.id ? outlineState.path : null;

  // One request per year, cached; the year after is prefetched so playback has no gap at New Year.
  useEffect(() => {
    let alive = true;
    const key = `${region.id}:${year}`;
    loadDetections(region.id, year)
      .then((rows) => {
        if (!alive) return;
        setLoaded({ key, rows, error: null });
        loadDetections(region.id, year + 1).catch(() => undefined);
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
  }, [region.id, year]);

  useEffect(() => {
    let alive = true;
    loadBoundary(region.id)
      .then((geojson) => {
        if (alive) setOutlineState({ key: region.id, path: geoJsonToPath(geojson, projection.project) });
      })
      .catch(() => {
        if (alive) setOutlineState({ key: region.id, path: null });
      });
    return () => {
      alive = false;
    };
  }, [region.id, projection]);

  useEffect(() => {
    const element = frame.current;
    if (!element) return;
    const update = () => setSize({ w: element.clientWidth || 800, h: element.clientHeight || 460 });
    update();
    const observer = new ResizeObserver(update);
    observer.observe(element);
    return () => observer.disconnect();
  }, []);

  /** Pointer position in map coordinates; the CTM already accounts for letterboxing and zoom. */
  const toMap = useCallback((clientX: number, clientY: number) => {
    const element = svg.current;
    const matrix = element?.getScreenCTM();
    if (!element || !matrix) return null;
    const point = element.createSVGPoint();
    point.x = clientX;
    point.y = clientY;
    const mapped = point.matrixTransform(matrix.inverse());
    return { x: mapped.x, y: mapped.y };
  }, []);

  // Plain scrolling must keep scrolling the page, so the wheel only zooms with Ctrl or ⌘.
  useEffect(() => {
    const element = svg.current;
    if (!element) return;
    function onWheel(event: WheelEvent) {
      if (!event.ctrlKey && !event.metaKey) return;
      event.preventDefault();
      const anchor = toMap(event.clientX, event.clientY);
      const factor = event.deltaY < 0 ? 1.25 : 0.8;
      setView((current) => zoomView(current, current.k * factor, width, height, anchor ?? undefined));
    }
    element.addEventListener("wheel", onWheel, { passive: false });
    return () => element.removeEventListener("wheel", onWheel);
  }, [toMap, width, height]);

  const monthRows = useMemo(
    () => (request ? rowsInMonth(request.rows, year, month) : []),
    [request, year, month],
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

  const counts = useMemo(() => {
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

  const scale = view.k * Math.min(size.w / width, size.h / height);
  const unit = 1 / scale;

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

  const viewW = width / view.k;
  const viewH = height / view.k;
  const viewBox = `${view.cx - viewW / 2} ${view.cy - viewH / 2} ${viewW} ${viewH}`;

  function inspect(event: React.PointerEvent) {
    const at = toMap(event.clientX, event.clientY);
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
    // A tap on a touch screen is the only way to inspect a mark there.
    if (event.pointerType === "touch") inspect(event);
    if (view.k <= 1 || event.button !== 0) return;
    event.currentTarget.setPointerCapture(event.pointerId);
    drag.current = { x: event.clientX, y: event.clientY, cx: view.cx, cy: view.cy };
    setDragging(true);
  }

  function onPointerMove(event: React.PointerEvent<SVGSVGElement>) {
    const start = drag.current;
    if (start) {
      const dx = (event.clientX - start.x) / scale;
      const dy = (event.clientY - start.y) / scale;
      setView((current) => clampView({ k: current.k, cx: start.cx - dx, cy: start.cy - dy }, width, height));
      setHover(null);
      return;
    }
    if (event.pointerType !== "touch") inspect(event);
  }

  function endDrag() {
    drag.current = null;
    setDragging(false);
  }

  function zoomTo(point: Point) {
    setView((current) => clampView({ k: Math.max(current.k, 4), cx: point.x, cy: point.y }, width, height));
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
    <div className="grid gap-4 lg:grid-cols-[2fr_1fr]">
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
            style={{ touchAction: view.k > 1 ? "none" : "pan-y", cursor: dragging ? "grabbing" : view.k > 1 ? "grab" : "default" }}
            onPointerDown={onPointerDown}
            onPointerMove={onPointerMove}
            onPointerUp={endDrag}
            onPointerCancel={endDrag}
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
          </svg>

          <div className="absolute right-2 top-2 flex flex-col gap-1">
            <MapButton label="Zoom in" onClick={() => setView((v) => zoomView(v, v.k * 1.6, width, height))}>
              +
            </MapButton>
            <MapButton label="Zoom out" onClick={() => setView((v) => zoomView(v, v.k / 1.6, width, height))}>
              −
            </MapButton>
            <MapButton
              label="Reset the view"
              disabled={view.k === 1}
              onClick={() => setView({ cx: width / 2, cy: height / 2, k: 1 })}
            >
              ⤢
            </MapButton>
          </div>

          <div className="pointer-events-none absolute bottom-2 left-2 flex items-center gap-2 rounded-md bg-slate-950/85 px-2 py-1 text-[10px] text-slate-300">
            <Glyph family="MODIS" /> MODIS 1 km
            <Glyph family="VIIRS" /> VIIRS 375 m
            <span className="text-slate-500">· size = fire radiative power</span>
          </div>

          {loading || problem || emptyAll || emptyFiltered ? (
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
                  ? `${problem} Run python -m pipeline.export_web to rebuild the files.`
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
          <div className="flex h-16 items-end gap-px" role="group" aria-label="Detections per day">
            {Array.from({ length: daysInMonth }, (_, index) => {
              const dayNumber = index + 1;
              const modis = show.MODIS ? counts.modis[index] : 0;
              const viirs = show.VIIRS ? counts.viirs[index] : 0;
              const total = modis + viirs;
              const selected = day === dayNumber;
              return (
                <button
                  key={dayNumber}
                  type="button"
                  aria-pressed={selected}
                  aria-label={`${MONTHS[month]} ${dayNumber}: ${counts.modis[index]} MODIS, ${counts.viirs[index]} VIIRS`}
                  title={`${MONTHS[month]} ${dayNumber}: ${counts.modis[index]} MODIS · ${counts.viirs[index]} VIIRS`}
                  onClick={() => setDay(selected ? null : dayNumber)}
                  className={`flex h-full flex-1 items-end rounded-[2px] focus-visible:outline focus-visible:outline-2 focus-visible:outline-sky-400 ${
                    selected ? "bg-sky-400/25" : "hover:bg-slate-700/40"
                  }`}
                >
                  <span
                    className="flex w-full flex-col justify-end overflow-hidden rounded-t-[2px]"
                    style={{ height: total > 0 ? `${Math.max((total / maxDay) * 100, 6)}%` : "0%" }}
                  >
                    <span style={{ flex: `${viirs} 1 0%`, backgroundColor: VIIRS_COLOR }} />
                    <span style={{ flex: `${modis} 1 0%`, backgroundColor: MODIS_COLOR }} />
                  </span>
                </button>
              );
            })}
          </div>
          <div className="mt-1 flex justify-between text-[10px] tabular-nums text-slate-500">
            <span>1</span>
            <span>{daysInMonth}</span>
          </div>
        </div>

        <div className="mt-4 border-t border-slate-800 pt-3">
          <h3 className="mb-1.5 text-xs font-semibold text-slate-300">Strongest detections</h3>
          {visible.length === 0 ? (
            <p className="text-xs text-slate-500">None to list.</p>
          ) : (
            <ol className="space-y-1">
              {visible.slice(0, 5).map((point) => (
                <li key={point.id}>
                  <button
                    type="button"
                    onMouseEnter={() => setFocusId(point.id)}
                    onMouseLeave={() => setFocusId(null)}
                    onFocus={() => setFocusId(point.id)}
                    onBlur={() => setFocusId(null)}
                    onClick={() => zoomTo(point)}
                    title="Zoom the map to this detection"
                    className="flex w-full items-center justify-between gap-2 rounded-md px-1.5 py-1 text-left text-xs text-slate-300 hover:bg-slate-800/70 focus-visible:outline focus-visible:outline-2 focus-visible:outline-sky-400"
                  >
                    <span className="flex items-center gap-2">
                      <Glyph family={point.family} />
                      <span className="tabular-nums">{point.row.date.slice(5)}</span>
                      <span className="text-slate-500">{point.row.satellite || point.row.sensor}</span>
                    </span>
                    <span className="tabular-nums text-slate-100">
                      {point.row.frp === null ? "—" : `${point.row.frp.toFixed(1)} MW`}
                    </span>
                  </button>
                </li>
              ))}
            </ol>
          )}
        </div>
      </section>
    </div>
  );
}

function confidenceLabel(row: Detection): string {
  if (row.confidence === "") return "—";
  const named = CONFIDENCE[row.confidence.toLowerCase()];
  return named ?? `${row.confidence} %`;
}

function MapButton({
  label,
  onClick,
  disabled,
  children,
}: {
  label: string;
  onClick: () => void;
  disabled?: boolean;
  children: React.ReactNode;
}) {
  return (
    <button
      type="button"
      aria-label={label}
      title={label}
      disabled={disabled}
      onClick={onClick}
      className="flex h-8 w-8 items-center justify-center rounded-md border border-slate-700 bg-slate-900/90 text-base leading-none text-slate-200 hover:bg-slate-800 focus-visible:outline focus-visible:outline-2 focus-visible:outline-sky-400 disabled:opacity-40"
    >
      {children}
    </button>
  );
}

function FamilyToggle({
  family,
  detail,
  count,
  on,
  onToggle,
}: {
  family: Family;
  detail: string;
  count: number;
  on: boolean;
  onToggle: () => void;
}) {
  return (
    <button
      type="button"
      aria-pressed={on}
      onClick={onToggle}
      className={`flex w-full items-center justify-between gap-2 rounded-lg border px-2.5 py-2 text-left text-xs transition-colors focus-visible:outline focus-visible:outline-2 focus-visible:outline-sky-400 ${
        on ? "border-slate-600 bg-slate-800/60 text-slate-100" : "border-slate-800 text-slate-500"
      }`}
    >
      <span className="flex items-center gap-2">
        <Glyph family={family} dim={!on} />
        <span>
          <strong className="font-semibold">{family}</strong> <span className="text-slate-400">{detail}</span>
        </span>
      </span>
      <span className="tabular-nums">{formatCount(count)}</span>
    </button>
  );
}

/** Shape carries the sensor as well as colour, so the legend survives colour-vision differences. */
function Glyph({ family, dim = false }: { family: Family; dim?: boolean }) {
  return (
    <svg width="12" height="12" viewBox="0 0 12 12" aria-hidden className={dim ? "opacity-40" : ""}>
      {family === "VIIRS" ? (
        <circle cx="6" cy="6" r="4.5" fill={VIIRS_COLOR} fillOpacity="0.5" stroke="#bae6fd" />
      ) : (
        <rect x="1.5" y="1.5" width="9" height="9" fill={MODIS_COLOR} fillOpacity="0.12" stroke={MODIS_COLOR} strokeWidth="1.5" />
      )}
    </svg>
  );
}

function Row({ label, value }: { label: string; value: string }) {
  return (
    <div className="flex items-baseline justify-between gap-3">
      <span className="text-slate-400">{label}</span>
      <span className="font-medium tabular-nums text-slate-100">{value}</span>
    </div>
  );
}
