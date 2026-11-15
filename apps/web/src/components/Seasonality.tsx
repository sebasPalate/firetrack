"use client";

import { sequential } from "@/lib/colors";
import { MONTHS, formatIndex } from "@/lib/format";
import type { CalendarPayload } from "@/lib/types";

/** Height of the tallest bar, in pixels. */
const TRACK_PX = 128;

type Props = {
  payload: CalendarPayload;
  /** Zero-based month highlighted in the calendar, if any. */
  selectedMonth: number | null;
  onPickMonth: (month: number) => void;
};

/**
 * S6: month-of-year seasonality, using the same median the anomaly compares
 * against. Each bar is a button: picking a month moves the calendar, the detail
 * panel and the map to that month of the selected year.
 */
export function Seasonality({ payload, selectedMonth, onPickMonth }: Props) {
  const medians = MONTHS.map((_, month) => payload.median_by_month[String(month + 1)] ?? 0);
  const max = Math.max(...medians, 1);
  const peak = medians.indexOf(max);

  return (
    <section className="rounded-xl border border-slate-800 bg-slate-900/40 p-4">
      <header className="mb-3 flex items-baseline justify-between gap-2">
        <h2 className="text-sm font-semibold text-slate-200">Seasonality</h2>
        <span className="text-xs text-slate-400">median of every year since 2000 · click a month to jump there</span>
      </header>

      <div className="flex items-end gap-1" role="group" aria-label="Median activity per calendar month">
        {medians.map((value, month) => {
          // A percentage height inside an auto-height flex column resolves to
          // zero, so the bar is sized in pixels against a fixed track.
          const pixels = Math.max((value / max) * TRACK_PX, 3);
          const background = sequential(value / max);
          const selected = selectedMonth === month;
          return (
            <button
              key={month}
              type="button"
              aria-pressed={selected}
              aria-label={`${MONTHS[month]}: median ${formatIndex(value)}`}
              title={`${MONTHS[month]}: ${formatIndex(value)} (median)`}
              onClick={() => onPickMonth(month)}
              className={`group flex flex-1 flex-col items-center justify-end gap-1 rounded-md px-0.5 pb-1 pt-1 focus-visible:outline focus-visible:outline-2 focus-visible:outline-sky-400 ${
                selected ? "bg-sky-400/15" : "hover:bg-slate-800/60"
              }`}
            >
              <span className="text-[9px] tabular-nums text-slate-500 opacity-0 transition-opacity group-hover:opacity-100 group-focus-visible:opacity-100">
                {formatIndex(value)}
              </span>
              <span className="block w-full rounded-t-[2px]" style={{ height: `${pixels}px`, backgroundColor: background }} />
              <span
                className={`text-[10px] ${
                  selected ? "font-bold text-sky-300" : month === peak ? "font-bold text-slate-200" : "text-slate-500"
                }`}
              >
                {MONTHS[month][0]}
              </span>
            </button>
          );
        })}
      </div>

      <p className="mt-2 text-xs leading-relaxed text-slate-400">
        The fire season peaks in <strong className="text-slate-200">{MONTHS[peak]}</strong> and collapses in winter.
        This is why the calibration needs one factor per calendar month: a single yearly factor hides exactly this
        shape.
      </p>
    </section>
  );
}
