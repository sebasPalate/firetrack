import type { ViewMode } from "@/features/calendar/view";
import { inRange, makeRange, type MonthRange } from "@/features/range/range";
import type { CalendarPayload } from "@/shared/types";

/** One calendar cell: zero-based month. */
export type Selection = { year: number; month: number };

/** Months a range keeps: everything when there is no range yet. */
export type Within = (year: number, month: number) => boolean;

export function percentile(values: number[], share: number): number {
  if (!values.length) return 0;
  const ordered = [...values].sort((a, b) => a - b);
  return ordered[Math.min(ordered.length - 1, Math.floor(share * ordered.length))];
}

/**
 * Top of the colour scale: the 95th percentile of what is in range, so one
 * extreme month does not wash out the rest. Anomalies stay between ±25 and ±250 %.
 */
export function colorScale(payload: CalendarPayload, years: number[], mode: ViewMode, within: Within): number {
  if (!years.length) return 1;
  const values: number[] = [];
  const grid = mode === "index" ? payload.harmonized : payload.anomaly_pct;
  years.forEach((year) => {
    const column = payload.years.indexOf(year);
    for (let month = 0; month < 12; month += 1) {
      const value = grid[month][column];
      if (value !== null && within(year, month)) values.push(mode === "index" ? value : Math.abs(value));
    }
  });
  return mode === "index"
    ? Math.max(percentile(values, 0.95), 1)
    : Math.min(Math.max(percentile(values, 0.95), 25), 250);
}

/** The running year is a preview, so open on the last month that is actually complete. */
export function latestUsable(payload: CalendarPayload, range?: MonthRange): Selection {
  const lastColumn = payload.years.length - 1;
  // Within a range, the newest complete month of the range: the map never shows a month the calendar hides.
  for (let column = lastColumn; column >= 0; column -= 1) {
    for (let month = 11; month >= 0; month -= 1) {
      const year = payload.years[column];
      if (range && !inRange(year, month, range)) continue;
      if (payload.harmonized[month][column] !== null && !payload.partial[month][column]) return { year, month };
    }
    if (!range) break;
  }
  return range ? { ...range.end } : { year: payload.years[lastColumn], month: 11 };
}

/** The whole years the calendar covers: the default range, and what Reset means. */
export function wholeRange(payload: CalendarPayload): MonthRange {
  return makeRange(
    { year: payload.years[0], month: 0 },
    { year: payload.years[payload.years.length - 1], month: 11 },
  );
}

/** The busiest observed month of one year. */
export function busiestMonth(payload: CalendarPayload, year: number): number {
  const column = payload.years.indexOf(year);
  let best = 0;
  let bestValue = Number.NEGATIVE_INFINITY;
  for (let month = 0; month < 12; month += 1) {
    const value = payload.harmonized[month][column];
    if (value !== null && value > bestValue) {
      best = month;
      bestValue = value;
    }
  }
  return best;
}

/** The busiest month of the last complete year: the one worth opening on the map. */
export function peakCell(payload: CalendarPayload): Selection {
  let column = payload.years.length - 1;
  while (column > 0 && payload.provisional[0][column]) column -= 1;
  return { year: payload.years[column], month: busiestMonth(payload, payload.years[column]) };
}
