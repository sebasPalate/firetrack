/**
 * The selected period, to the month: June to September 2022 is a question a
 * fire manager asks, and a whole-year range cannot answer it.
 *
 * The calendar still shows whole years, so a season keeps its context; every
 * number and download reads only the months inside the range.
 *
 * Kept free of runtime imports so `node --test` can run it as plain TypeScript.
 */

const MONTH_NAMES = ["Jan", "Feb", "Mar", "Apr", "May", "Jun", "Jul", "Aug", "Sep", "Oct", "Nov", "Dec"];

/** `month` is zero-based, like everywhere else in the client. */
export type YearMonth = { year: number; month: number };
export type MonthRange = { start: YearMonth; end: YearMonth };

function ordinal(value: YearMonth): number {
  return value.year * 12 + value.month;
}

/** The two ends in time order, whichever way they were picked. */
export function makeRange(a: YearMonth, b: YearMonth): MonthRange {
  return ordinal(a) <= ordinal(b) ? { start: { ...a }, end: { ...b } } : { start: { ...b }, end: { ...a } };
}

export function inRange(year: number, month: number, range: MonthRange): boolean {
  const at = year * 12 + month;
  return at >= ordinal(range.start) && at <= ordinal(range.end);
}

/** A detection's `acq_date` (YYYY-MM-DD) against the range. */
export function inRangeDate(date: string, range: MonthRange): boolean {
  const match = /^(\d{4})-(\d{2})/.exec(date);
  return match ? inRange(Number(match[1]), Number(match[2]) - 1, range) : false;
}

export function clampRange(range: MonthRange, first: YearMonth, last: YearMonth): MonthRange {
  const clamp = (value: YearMonth) =>
    ordinal(value) < ordinal(first) ? { ...first } : ordinal(value) > ordinal(last) ? { ...last } : { ...value };
  return makeRange(clamp(range.start), clamp(range.end));
}

export function isWholeYears(range: MonthRange): boolean {
  return range.start.month === 0 && range.end.month === 11;
}

export function rangeLabel(range: MonthRange): string {
  if (isWholeYears(range)) {
    return range.start.year === range.end.year ? String(range.start.year) : `${range.start.year}–${range.end.year}`;
  }
  const name = (value: YearMonth) => `${MONTH_NAMES[value.month]} ${value.year}`;
  return `${name(range.start)} – ${name(range.end)}`;
}

/**
 * A link end: `2022-06` is that month; a bare `2010` is the whole year, so links
 * written before months existed open exactly as they did.
 */
export function parseRangeBound(text: string | null | undefined, edge: "start" | "end"): YearMonth | undefined {
  const match = text ? /^(\d{4})(?:-(\d{2}))?$/.exec(text) : null;
  if (!match) return undefined;
  const year = Number(match[1]);
  if (year < 1900 || year > 2200) return undefined;
  if (match[2] === undefined) return { year, month: edge === "start" ? 0 : 11 };
  const month = Number(match[2]);
  return month >= 1 && month <= 12 ? { year, month: month - 1 } : undefined;
}

/** The shortest link end that parses back to the same month. */
export function formatRangeBound(value: YearMonth, edge: "start" | "end"): string {
  const wholeYear = edge === "start" ? value.month === 0 : value.month === 11;
  return wholeYear ? String(value.year) : `${value.year}-${String(value.month + 1).padStart(2, "0")}`;
}
