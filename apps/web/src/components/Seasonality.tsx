"use client";

import { sequential } from "@/lib/colors";
import { MONTHS, formatIndex } from "@/lib/format";
import type { CalendarPayload } from "@/lib/types";

/** S6: month-of-year seasonality, using the same median the anomaly compares against. */
export function Seasonality({ payload }: { payload: CalendarPayload }) {
  const medians = MONTHS.map((_, month) => payload.median_by_month[String(month + 1)] ?? 0);
  const max = Math.max(...medians, 1);
  const peak = medians.indexOf(max);

  return (
    <section className="rounded-xl border border-slate-800 bg-slate-900/40 p-4">
      <header className="mb-3 flex items-baseline justify-between gap-2">
        <h2 className="text-sm font-semibold text-slate-200">Seasonality</h2>
        <span className="text-xs text-slate-400">median of every year since 2000</span>
      </header>

      <div className="flex h-36 items-end gap-1" role="img" aria-label="Median activity per calendar month">
        {medians.map((value, month) => {
          const height = Math.max((value / max) * 100, 2);
          const background = sequential(value / max);
          return (
            <div key={month} className="group flex flex-1 flex-col items-center justify-end gap-1">
              <span className="text-[9px] tabular-nums text-slate-500 opacity-0 transition-opacity group-hover:opacity-100">
                {formatIndex(value)}
              </span>
              <div
                className="w-full rounded-t-[2px]"
                style={{ height: `${height}%`, backgroundColor: background }}
                title={`${MONTHS[month]}: ${formatIndex(value)} (median)`}
              />
              <span
                className={`text-[10px] ${month === peak ? "font-bold text-slate-200" : "text-slate-500"}`}
              >
                {MONTHS[month][0]}
              </span>
            </div>
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
