"use client";

import { useRef, useState } from "react";

import { diverging, sequential, textOn } from "@/lib/colors";
import { MONTHS, formatCount, formatIndex, formatPercent } from "@/lib/format";
import type { CalendarPayload } from "@/lib/types";

type Selection = { year: number; month: number };

type Props = {
  payload: CalendarPayload;
  mode: "index" | "anomaly";
  scaleMax: number;
  years: number[];
  selection: Selection | null;
  onSelect: (selection: Selection) => void;
};

type Hover = { year: number; month: number; x: number; y: number };

export function CalendarHeatmap({ payload, mode, scaleMax, years, selection, onSelect }: Props) {
  const grid = useRef<HTMLDivElement>(null);
  const [hover, setHover] = useState<Hover | null>(null);

  const columns = years.map((year) => payload.years.indexOf(year));
  const rows = [0, 1, 2, 3, 4, 5, 6, 7, 8, 9, 10, 11];

  function point(event: React.MouseEvent, year: number, month: number) {
    const box = grid.current?.getBoundingClientRect();
    if (!box) return;
    setHover({
      year,
      month,
      x: Math.min(Math.max(event.clientX - box.left, 70), box.width - 70),
      y: event.clientY - box.top,
    });
  }

  function paint(column: number | undefined, month: number): string {
    if (column === undefined) return "transparent";
    const value = payload.harmonized[month][column];
    const anomaly = payload.anomaly_pct[month][column];
    if (mode === "index") {
      if (value === null) return "transparent";
      return sequential(scaleMax > 0 ? value / scaleMax : 0);
    }
    if (anomaly === null) return "transparent";
    return diverging(scaleMax > 0 ? anomaly / scaleMax : 0);
  }

  const hovered = hover
    ? {
        value: payload.harmonized[hover.month][payload.years.indexOf(hover.year)],
        raw: payload.raw_count[hover.month][payload.years.indexOf(hover.year)],
        median: payload.median_by_month[String(hover.month + 1)] ?? null,
        anomaly: payload.anomaly_pct[hover.month][payload.years.indexOf(hover.year)],
        partial: payload.partial[hover.month][payload.years.indexOf(hover.year)],
        provisional: payload.provisional[hover.month][payload.years.indexOf(hover.year)],
      }
    : null;

  return (
    <figure className="rounded-xl border border-slate-800 bg-slate-900/40 p-4">
      <figcaption className="mb-3 flex flex-wrap items-baseline justify-between gap-2">
        <span className="text-sm font-semibold text-slate-200">
          Burning activity calendar · {mode === "index" ? "harmonized index" : "anomaly vs the same month"}
        </span>
        <span className="text-xs text-slate-400">
          {mode === "index"
            ? "Aqua MODIS detections, calibrated · darker is more activity"
            : "difference from the multi-year median of that calendar month"}
        </span>
      </figcaption>

      <div className="overflow-x-auto">
        <div ref={grid} className="relative min-w-[720px]">
          <div
            className="grid items-center gap-[3px]"
            style={{ gridTemplateColumns: `44px repeat(${columns.length}, minmax(14px, 1fr))` }}
          >
            <span />
            {columns.map((column) => (
              <span
                key={`h-${column}`}
                className={`text-center text-[10px] tabular-nums ${
                  payload.provisional[0][column] ? "font-bold text-amber-300" : "text-slate-400"
                }`}
              >
                {String(payload.years[column]).slice(2)}
              </span>
            ))}

            {rows.map((month) => (
              <div key={`r-${month}`} className="contents">
                <span className="pr-1 text-right text-[10px] text-slate-400">{MONTHS[month]}</span>
                {columns.map((column) => {
                  const value = payload.harmonized[month][column];
                  const anomaly = payload.anomaly_pct[month][column];
                  const background = paint(column, month);
                  const isSelected = selection?.year === payload.years[column] && selection?.month === month;
                  const label =
                    mode === "index"
                      ? `${MONTHS[month]} ${payload.years[column]}: ${formatIndex(value)} index`
                      : `${MONTHS[month]} ${payload.years[column]}: ${formatPercent(anomaly)} vs median`;
                  return (
                    <button
                      key={`c-${month}-${column}`}
                      type="button"
                      aria-label={label}
                      onClick={() => onSelect({ year: payload.years[column], month })}
                      onMouseEnter={(event) => point(event, payload.years[column], month)}
                      onMouseMove={(event) => point(event, payload.years[column], month)}
                      onMouseLeave={() => setHover(null)}
                      style={{ backgroundColor: background, color: textOn(background) }}
                      className={`relative h-6 w-full rounded-[3px] border text-[9px] leading-none tabular-nums transition-[box-shadow,transform] hover:z-10 hover:scale-[1.12] hover:shadow-lg focus:outline-none focus-visible:ring-2 focus-visible:ring-sky-400 ${
                        value === null ? "border-dashed border-slate-700" : "border-transparent"
                      } ${isSelected ? "ring-2 ring-sky-300" : ""}`}
                    >
                      {payload.partial[month][column] ? (
                        <span
                          aria-hidden
                          className="absolute inset-0 rounded-[3px] opacity-50"
                          style={{
                            backgroundImage:
                              "repeating-linear-gradient(45deg, transparent 0 3px, rgba(0,0,0,.55) 3px 4px)",
                          }}
                        />
                      ) : null}
                    </button>
                  );
                })}
              </div>
            ))}
          </div>

          {hover && hovered ? (
            <div
              className="pointer-events-none absolute z-20 w-56 -translate-x-1/2 -translate-y-full rounded-lg border border-slate-700 bg-slate-950/95 p-2 text-xs shadow-xl"
              style={{ left: hover.x, top: hover.y - 6 }}
            >
              <div className="mb-1 font-semibold text-slate-100">
                {MONTHS[hover.month]} {hover.year}
              </div>
              <Row label="Index" value={formatIndex(hovered.value)} />
              <Row label="Median for the month" value={formatIndex(hovered.median)} />
              <Row label="Anomaly" value={formatPercent(hovered.anomaly)} />
              <Row label="Raw detections" value={formatCount(hovered.raw)} />
              {hovered.partial ? (
                <p className="mt-1 text-amber-300">Month still being observed</p>
              ) : null}
              {hovered.provisional ? (
                <p className="mt-1 text-amber-300">Running year, not used to calibrate</p>
              ) : null}
            </div>
          ) : null}
        </div>
      </div>

      <div className="mt-3 flex items-center gap-2 text-[10px] text-slate-400">
        <span>{mode === "index" ? "0" : `−${Math.round(scaleMax)} %`}</span>
        <span
          className="h-2 flex-1 rounded-full"
          style={{
            background:
              mode === "index"
                ? `linear-gradient(90deg, ${sequential(0)}, ${sequential(0.25)}, ${sequential(0.5)}, ${sequential(0.75)}, ${sequential(1)})`
                : `linear-gradient(90deg, ${diverging(-1)}, ${diverging(-0.5)}, ${diverging(0)}, ${diverging(0.5)}, ${diverging(1)})`,
          }}
        />
        <span>{mode === "index" ? formatIndex(scaleMax) : `+${Math.round(scaleMax)} %`}</span>
        <span className="ml-3 flex items-center gap-1">
          <span className="inline-block h-3 w-3 rounded-[2px] border border-dashed border-slate-500" />
          not observed
        </span>
        <span className="flex items-center gap-1">
          <span
            className="inline-block h-3 w-3 rounded-[2px]"
            style={{
              backgroundImage:
                "repeating-linear-gradient(45deg, #1e293b 0 2px, #475569 2px 3px)",
            }}
          />
          partial month
        </span>
      </div>
    </figure>
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
