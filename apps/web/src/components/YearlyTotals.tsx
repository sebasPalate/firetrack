"use client";

import { formatCount, formatIndex } from "@/lib/format";
import type { CalendarPayload } from "@/lib/types";

type Props = {
  payload: CalendarPayload;
  years: number[];
  series: "harmonized" | "raw";
  onSeries: (series: "harmonized" | "raw") => void;
};

export function YearlyTotals({ payload, years, series, onSeries }: Props) {
  const rows = years.map((year) => {
    const column = payload.years.indexOf(year);
    const values: (number | null)[] = [];
    for (let month = 0; month < 12; month += 1) {
      values.push(series === "harmonized" ? payload.harmonized[month][column] : payload.raw_count[month][column]);
    }
    const present = values.filter((value): value is number => value !== null);
    return {
      year,
      total: present.reduce((sum, value) => sum + value, 0),
      provisional: payload.provisional[0][column],
      months: present.length,
    };
  });

  const max = Math.max(...rows.map((row) => row.total), 1);

  return (
    <section className="rounded-xl border border-slate-800 bg-slate-900/40 p-4">
      <header className="mb-3 flex flex-wrap items-center justify-between gap-2">
        <h2 className="text-sm font-semibold text-slate-200">Yearly total, {years[0]}–{years[years.length - 1]}</h2>
        <div className="flex rounded-lg border border-slate-700 p-0.5 text-xs">
          <button
            type="button"
            onClick={() => onSeries("raw")}
            className={`rounded-md px-2 py-1 ${series === "raw" ? "bg-slate-700 text-slate-100" : "text-slate-400"}`}
          >
            Raw detections
          </button>
          <button
            type="button"
            onClick={() => onSeries("harmonized")}
            className={`rounded-md px-2 py-1 ${series === "harmonized" ? "bg-slate-700 text-slate-100" : "text-slate-400"}`}
          >
            Harmonized index
          </button>
        </div>
      </header>

      <div className="flex h-40 items-end gap-[3px]" role="img" aria-label={`Yearly total, ${series}`}>
        {rows.map((row) => (
          <div
            key={row.year}
            className="group relative flex-1 rounded-t-[2px]"
            style={{
              height: `${Math.max((row.total / max) * 100, 1.5)}%`,
              backgroundColor: row.provisional ? "#f59e0b" : series === "raw" ? "#64748b" : "#35b779",
              opacity: row.provisional ? 0.75 : 1,
            }}
            title={`${row.year}: ${
              series === "harmonized" ? formatIndex(row.total) : formatCount(row.total)
            }${row.provisional ? " (provisional)" : ""}`}
          />
        ))}
      </div>

      <div className="mt-1 flex justify-between text-[10px] tabular-nums text-slate-500">
        <span>{rows[0].year}</span>
        <span>{rows[Math.floor(rows.length / 2)].year}</span>
        <span>{rows[rows.length - 1].year}</span>
      </div>

      <p className="mt-2 text-xs leading-relaxed text-slate-400">
        {series === "raw" ? (
          <>
            Every satellite summed. Suomi-NPP joins in <strong className="text-slate-200">2012</strong> and NOAA-21 in{" "}
            <strong className="text-slate-200">2024</strong>, so the count climbs for two reasons at once: more fire,
            and one more camera counting the same flames.
          </>
        ) : (
          <>
            The same record in Aqua MODIS units. The 2012 camera step is gone, while the latest spike survives: it
            happened, so it shows.
          </>
        )}{" "}
        {rows.some((row) => row.provisional) ? (
          <span className="text-amber-300">Amber bars are the running year: served, not used to calibrate.</span>
        ) : null}
      </p>
    </section>
  );
}
