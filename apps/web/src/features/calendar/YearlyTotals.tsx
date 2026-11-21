"use client";

import { useState } from "react";

import { formatCount, formatIndex } from "@/shared/format";
import type { CalendarPayload } from "@/shared/types";
import type { Series } from "@/features/calendar/view";

type Props = {
  payload: CalendarPayload;
  years: number[];
  /** Only these months add up into a year's total. */
  inRange?: (year: number, month: number) => boolean;
  /** Set when the range is not whole years, so the totals say what they add up. */
  rangeNote?: string | null;
  series: Series;
  onSeries: (series: Series) => void;
  selectedYear: number | null;
  onPickYear: (year: number) => void;
  /** First year the index is carried by VIIRS, i.e. where the calibration error applies. */
  uncertainFrom: number | null;
  /** Median and worst absolute error against Aqua in the overlap, in percent. */
  typicalErrorPct: number | null;
  worstErrorPct: number | null;
};

const EVENTS = [
  { year: 2012, label: "Suomi-NPP joins" },
  { year: 2024, label: "NOAA-21 joins" },
];

/** Mission spans from the mirror's coverage table (README §3), as decimal years. */
const ERAS: { name: string; start: number; end: number | null; family: "MODIS" | "VIIRS" }[] = [
  { name: "Terra", start: 2000.83, end: null, family: "MODIS" },
  { name: "Aqua", start: 2002.5, end: null, family: "MODIS" },
  { name: "S-NPP", start: 2012.05, end: 2026.84, family: "VIIRS" },
  { name: "NOAA-20", start: 2018.25, end: null, family: "VIIRS" },
  { name: "NOAA-21", start: 2024.05, end: null, family: "VIIRS" },
];

const SERIES_OPTIONS: { id: Series; label: string }[] = [
  { id: "raw", label: "Raw detections" },
  { id: "compare", label: "Compare" },
  { id: "harmonized", label: "Harmonized index" },
];

export function YearlyTotals({
  payload,
  years,
  inRange,
  rangeNote,
  series,
  onSeries,
  selectedYear,
  onPickYear,
  uncertainFrom,
  typicalErrorPct,
  worstErrorPct,
}: Props) {
  const [hoverYear, setHoverYear] = useState<number | null>(null);

  const rows = years.map((year) => {
    const column = payload.years.indexOf(year);
    let harmonized = 0;
    let raw = 0;
    for (let month = 0; month < 12; month += 1) {
      if (inRange && !inRange(year, month)) continue;
      harmonized += payload.harmonized[month][column] ?? 0;
      raw += payload.raw_count[month][column] ?? 0;
    }
    return { year, harmonized, raw, provisional: payload.provisional[0][column] };
  });

  const error = typicalErrorPct === null ? null : typicalErrorPct / 100;
  const hasWhisker = (year: number) =>
    series !== "raw" && error !== null && uncertainFrom !== null && year >= uncertainFrom;

  const primary = (row: (typeof rows)[number]) => (series === "raw" ? row.raw : row.harmonized);
  const max = Math.max(
    ...rows.map((row) => primary(row) * (hasWhisker(row.year) && error !== null ? 1 + error : 1)),
    1,
  );
  const rawMax = Math.max(...rows.map((row) => row.raw), 1);
  const count = rows.length;

  const focus = rows.find((row) => row.year === (hoverYear ?? selectedYear)) ?? null;

  const rangeStart = years[0];
  const rangeEnd = years[years.length - 1] + 1;

  return (
    <section className="rounded-xl border border-slate-800 bg-slate-900/40 p-4">
      <header className="mb-3 flex flex-wrap items-center justify-between gap-2">
        <h2 className="text-sm font-semibold text-slate-200">
          {rangeNote ? <>Total per year, months in {rangeNote}</> : <>Yearly total, {years[0]}–{years[years.length - 1]}</>}
        </h2>
        <div role="group" aria-label="Series" className="flex rounded-lg border border-slate-700 p-0.5 text-xs">
          {SERIES_OPTIONS.map((option) => (
            <button
              key={option.id}
              type="button"
              aria-pressed={series === option.id}
              onClick={() => onSeries(option.id)}
              className={`rounded-md px-2 py-1 focus-visible:outline focus-visible:outline-2 focus-visible:outline-sky-400 ${
                series === option.id ? "bg-slate-700 text-slate-100" : "text-slate-400 hover:text-slate-200"
              }`}
            >
              {option.label}
            </button>
          ))}
        </div>
      </header>

      <p className="mb-1 min-h-[1.25rem] text-xs tabular-nums text-slate-300" aria-live="off">
        {focus ? (
          <>
            <strong className="text-slate-100">{focus.year}</strong> · raw {formatCount(focus.raw)} · index{" "}
            {formatIndex(focus.harmonized)}
            {focus.provisional ? <span className="text-amber-300"> · running year</span> : null}
          </>
        ) : (
          <span className="text-slate-500">Hover or click a year to read it and jump the calendar there.</span>
        )}
      </p>

      <div className="relative mt-6 h-44">
        <div className="absolute inset-0 flex items-end gap-[3px]" role="group" aria-label={`Yearly total, ${series}`}>
          {rows.map((row) => {
            const selected = selectedYear === row.year;
            const value = primary(row);
            const whisker = hasWhisker(row.year) && error !== null;
            return (
              <button
                key={row.year}
                type="button"
                aria-pressed={selected}
                aria-label={`${row.year}: ${formatCount(row.raw)} raw detections, index ${formatIndex(row.harmonized)}${
                  row.provisional ? ", running year" : ""
                }`}
                onClick={() => onPickYear(row.year)}
                onMouseEnter={() => setHoverYear(row.year)}
                onMouseLeave={() => setHoverYear(null)}
                onFocus={() => setHoverYear(row.year)}
                onBlur={() => setHoverYear(null)}
                className={`relative flex h-full flex-1 items-end rounded-[2px] focus-visible:outline focus-visible:outline-2 focus-visible:outline-sky-400 ${
                  selected ? "bg-sky-400/15" : "hover:bg-slate-700/30"
                }`}
              >
                <span
                  className="block w-full rounded-t-[2px] transition-[height,background-color] duration-700 ease-out"
                  style={{
                    height: `${Math.max((value / max) * 100, 1.5)}%`,
                    backgroundColor: row.provisional ? "#f59e0b" : series === "raw" ? "#64748b" : "#35b779",
                    opacity: row.provisional ? 0.75 : series === "compare" ? 0.85 : 1,
                  }}
                />
                {whisker ? (
                  <span
                    aria-hidden
                    className="pointer-events-none absolute left-1/2 w-px -translate-x-1/2 bg-slate-100/80"
                    style={{
                      bottom: `${((row.harmonized * (1 - error)) / max) * 100}%`,
                      height: `${((row.harmonized * 2 * error) / max) * 100}%`,
                    }}
                  />
                ) : null}
              </button>
            );
          })}
        </div>

        {series === "compare" && count > 1 ? (
          <svg
            aria-hidden
            className="pointer-events-none absolute inset-0 h-full w-full"
            viewBox="0 0 100 100"
            preserveAspectRatio="none"
          >
            <polyline
              fill="none"
              stroke="#fda4af"
              strokeWidth={2}
              strokeLinejoin="round"
              vectorEffect="non-scaling-stroke"
              points={rows
                .map((row, index) => `${((index + 0.5) / count) * 100},${100 - (row.raw / rawMax) * 100}`)
                .join(" ")}
            />
          </svg>
        ) : null}

        <div aria-hidden className="pointer-events-none absolute inset-0">
          {EVENTS.map((event) => {
            const index = rows.findIndex((row) => row.year === event.year);
            if (index <= 0) return null;
            const left = (index / count) * 100;
            const flip = left > 70;
            return (
              <div
                key={event.year}
                className="absolute inset-y-0 border-l border-dashed border-amber-300/60"
                style={{ left: `${left}%` }}
              >
                <span
                  className={`absolute -top-5 whitespace-nowrap text-[10px] text-amber-300 ${
                    flip ? "right-1" : "left-1"
                  }`}
                >
                  {event.label}
                </span>
              </div>
            );
          })}
        </div>
      </div>

      <div className="mt-1 flex justify-between text-[10px] tabular-nums text-slate-500">
        <span>{rows[0].year}</span>
        <span>{rows[Math.floor(rows.length / 2)].year}</span>
        <span>{rows[rows.length - 1].year}</span>
      </div>

      <div className="mt-2 space-y-[3px]" role="img" aria-label="Which satellites were observing, by year">
        {ERAS.map((era) => {
          const end = era.end ?? rangeEnd;
          const left = (Math.max(era.start, rangeStart) - rangeStart) / (rangeEnd - rangeStart);
          const right = (Math.min(end, rangeEnd) - rangeStart) / (rangeEnd - rangeStart);
          const present = right > left;
          return (
            <div key={era.name} className="relative h-3 rounded-full bg-slate-800/50">
              {present ? (
                <span
                  className="absolute inset-y-0 flex items-center overflow-hidden whitespace-nowrap rounded-full px-1.5 text-[8px] font-semibold leading-none text-slate-950"
                  style={{
                    left: `${left * 100}%`,
                    width: `${(right - left) * 100}%`,
                    backgroundColor: era.family === "VIIRS" ? "#38bdf8" : "#fbbf24",
                    opacity: 0.85,
                  }}
                >
                  {era.name}
                </span>
              ) : null}
            </div>
          );
        })}
      </div>

      <p className="mt-2 text-xs leading-relaxed text-slate-400">
        {series === "raw" ? (
          <>
            Every satellite summed. Suomi-NPP joins in <strong className="text-slate-200">2012</strong> and NOAA-21 in{" "}
            <strong className="text-slate-200">2024</strong>, so the count climbs for two reasons at once: more fire,
            and one more camera counting the same flames.
          </>
        ) : series === "compare" ? (
          <>
            Green bars are the harmonized index, the pink line is the raw count. Each is scaled to its own maximum, so
            read the shape, not the height: the line steps up when a camera joins, the bars follow the fires.
          </>
        ) : (
          <>
            The same record in Aqua MODIS units. The 2012 camera step is gone, while the latest spike survives: it
            happened, so it shows.
          </>
        )}{" "}
        {series !== "raw" && error !== null && uncertainFrom !== null ? (
          <>
            Whiskers from {uncertainFrom} on are the typical error against Aqua ({typicalErrorPct?.toFixed(1)} %
            {worstErrorPct !== null ? `, worst year ${worstErrorPct.toFixed(1)} %` : ""}).
          </>
        ) : null}{" "}
        {rows.some((row) => row.provisional) ? (
          <span className="text-amber-300">Amber bars are the running year: served, not used to calibrate.</span>
        ) : null}
      </p>
    </section>
  );
}
