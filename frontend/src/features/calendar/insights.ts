import type { CalendarPayload } from "@/shared/types";

/**
 * The answers a fire manager wants before reading the calendar cell by cell,
 * plus the two downloads that carry the analysis out of the page: the monthly
 * table (CSV) and the calendar itself as an image (SVG, turned into PNG in the
 * browser).
 *
 * Everything reads the same payload the panels read, with the same rules:
 * yearly totals add up the months like `YearlyTotals`, and partial or
 * provisional months never become a baseline, as in `backend/src/firetrack/contract/payloads.py`.
 *
 * Kept free of runtime imports so `node --test` can run it as plain TypeScript.
 */

const MONTH_NAMES = ["Jan", "Feb", "Mar", "Apr", "May", "Jun", "Jul", "Aug", "Sep", "Oct", "Nov", "Dec"];

export type Summary = {
  /** Highest yearly index in the range, the running year left out; compared with the median year. */
  peakYear: { year: number; index: number; vsMedianPct: number | null } | null;
  /** Zero-based calendar month with the highest median in the range: the fire season. */
  peakMonth: { month: number; median: number } | null;
  /** The last complete month in the range against the published median for that month. */
  latest: {
    year: number;
    month: number;
    index: number;
    median: number | null;
    anomalyPct: number | null;
    /** Running year: near-real-time rows still mixed in, so a preview. */
    provisional: boolean;
  } | null;
  /** The three busiest complete months in the range. */
  topMonths: { year: number; month: number; index: number }[];
  /** Every detection in the range, all satellites summed. */
  rawDetections: number;
};

function median(values: number[]): number | null {
  if (!values.length) return null;
  const ordered = [...values].sort((a, b) => a - b);
  const middle = Math.floor(ordered.length / 2);
  return ordered.length % 2 ? ordered[middle] : (ordered[middle - 1] + ordered[middle]) / 2;
}

function round(value: number, digits: number): number {
  return Number(value.toFixed(digits));
}

type CellRef = { year: number; month: number; column: number };

/** Which months of the shown years count: a month range trims the first and last year. */
export type InRange = (year: number, month: number) => boolean;
const everyMonth: InRange = () => true;

/** Observed months of the range in time order. */
function cellsIn(payload: CalendarPayload, years: number[], inRange: InRange): CellRef[] {
  const cells: CellRef[] = [];
  for (const year of years) {
    const column = payload.years.indexOf(year);
    if (column < 0) continue;
    for (let month = 0; month < 12; month += 1) {
      if (payload.harmonized[month][column] !== null && inRange(year, month)) cells.push({ year, month, column });
    }
  }
  return cells;
}

export function summarize(payload: CalendarPayload, years: number[], inRange: InRange = everyMonth): Summary {
  const cells = cellsIn(payload, years, inRange);
  const value = (cell: CellRef) => payload.harmonized[cell.month][cell.column] as number;
  const partial = (cell: CellRef) => Boolean(payload.partial[cell.month][cell.column]);
  const provisional = (cell: CellRef) => Boolean(payload.provisional[cell.month][cell.column]);

  const totals = new Map<number, { index: number; provisional: boolean }>();
  let rawDetections = 0;
  for (const cell of cells) {
    const entry = totals.get(cell.year) ?? { index: 0, provisional: false };
    entry.index += value(cell);
    entry.provisional ||= provisional(cell);
    totals.set(cell.year, entry);
    rawDetections += payload.raw_count[cell.month][cell.column] ?? 0;
  }
  const complete = [...totals].filter(([, entry]) => !entry.provisional);
  let peakYear: Summary["peakYear"] = null;
  for (const [year, entry] of complete) {
    if (!peakYear || entry.index > peakYear.index) peakYear = { year, index: round(entry.index, 1), vsMedianPct: null };
  }
  if (peakYear) {
    const typical = median(complete.map(([, entry]) => entry.index));
    const peakIndex = totals.get(peakYear.year)?.index ?? peakYear.index;
    peakYear.vsMedianPct = typical ? round(((peakIndex - typical) / typical) * 100, 1) : null;
  }

  let peakMonth: Summary["peakMonth"] = null;
  for (let month = 0; month < 12; month += 1) {
    const baseline = median(
      cells.filter((cell) => cell.month === month && !partial(cell) && !provisional(cell)).map(value),
    );
    if (baseline !== null && (!peakMonth || baseline > peakMonth.median)) {
      peakMonth = { month, median: round(baseline, 1) };
    }
  }

  const usable = cells.filter((cell) => !partial(cell));
  const last = usable[usable.length - 1];
  const latest: Summary["latest"] = last
    ? {
        year: last.year,
        month: last.month,
        index: value(last),
        median: payload.median_by_month[String(last.month + 1)] ?? null,
        anomalyPct: payload.anomaly_pct[last.month][last.column],
        provisional: provisional(last),
      }
    : null;

  const topMonths = [...usable]
    .sort((a, b) => value(b) - value(a) || a.year - b.year || a.month - b.month)
    .slice(0, 3)
    .map((cell) => ({ year: cell.year, month: cell.month, index: value(cell) }));

  return { peakYear, peakMonth, latest, topMonths, rawDetections };
}

const CSV_HEADER = [
  "year",
  "month",
  "harmonized_index",
  "raw_detections",
  "median_for_month",
  "anomaly_pct",
  "source",
  "factor",
  "observed_days",
  "partial",
  "provisional",
];

function csvField(value: string | number | boolean | null | undefined): string {
  if (value === null || value === undefined) return "";
  const text = String(value);
  return /[",\n\r]/.test(text) ? `"${text.replace(/"/g, '""')}"` : text;
}

/** The monthly analysis behind the calendar: one row per observed month of the range. */
export function calendarCsv(payload: CalendarPayload, years: number[], inRange: InRange = everyMonth): string {
  const rows = cellsIn(payload, years, inRange).map(({ year, month, column }) =>
    [
      year,
      month + 1,
      payload.harmonized[month][column],
      payload.raw_count[month][column],
      payload.median_by_month[String(month + 1)],
      payload.anomaly_pct[month][column],
      payload.source[month][column],
      payload.factor[month][column],
      payload.observed_days[month][column],
      Boolean(payload.partial[month][column]),
      Boolean(payload.provisional[month][column]),
    ]
      .map(csvField)
      .join(","),
  );
  return `${[CSV_HEADER.join(","), ...rows].join("\n")}\n`;
}

function escapeXml(text: string): string {
  return text.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;").replace(/"/g, "&quot;");
}

export type CalendarImageOptions = {
  title: string;
  subtitle: string;
  /** The number a cell shows: the index, or its anomaly. Null leaves the cell empty. */
  value: (index: number, cell: { year: number; month: number; column: number }) => number | null;
  /** Fill for a value; the page passes its own ramp, so the image matches the screen. */
  color: (value: number | null) => string;
  /** Text under the two ends of the colour bar. */
  legend: [string, string];
  /** Colours along the bar, low to high. */
  ramp?: string[];
  format?: (value: number) => string;
  /** Months outside the selected range are drawn faded, so the season keeps its context. */
  inRange?: InRange;
};

const CELL = 22;
const GAP = 3;
const LEFT = 40;
const TOP = 64;

/** The calendar as a standalone SVG: white background, so it drops into a report or a slide. */
export function calendarSvg(payload: CalendarPayload, years: number[], options: CalendarImageOptions): string {
  const format = options.format ?? ((value: number) => String(value));
  const inRange = options.inRange ?? everyMonth;
  const pitch = CELL + GAP;
  const width = Math.max(LEFT + years.length * pitch + 16, 360);
  const gridBottom = TOP + 12 * pitch;
  const height = gridBottom + 56;
  const parts: string[] = [];

  parts.push(
    `<svg xmlns="http://www.w3.org/2000/svg" width="${width}" height="${height}" viewBox="0 0 ${width} ${height}" font-family="system-ui, -apple-system, Segoe UI, sans-serif">`,
    `<rect width="${width}" height="${height}" fill="#ffffff"/>`,
    `<text x="${LEFT}" y="22" font-size="14" font-weight="600" fill="#0f172a">${escapeXml(options.title)}</text>`,
    `<text x="${LEFT}" y="40" font-size="11" fill="#475569">${escapeXml(options.subtitle)}</text>`,
  );
  years.forEach((year, index) => {
    const x = LEFT + index * pitch + CELL / 2;
    parts.push(
      `<text x="${x}" y="${TOP - 6}" font-size="8" text-anchor="middle" fill="#475569">${year}</text>`,
    );
  });
  MONTH_NAMES.forEach((name, month) => {
    parts.push(
      `<text x="${LEFT - 6}" y="${TOP + month * pitch + CELL / 2 + 3}" font-size="9" text-anchor="end" fill="#475569">${name}</text>`,
    );
  });

  years.forEach((year, index) => {
    const column = payload.years.indexOf(year);
    for (let month = 0; month < 12; month += 1) {
      const x = LEFT + index * pitch;
      const y = TOP + month * pitch;
      const harmonized = column < 0 ? null : payload.harmonized[month][column];
      if (harmonized === null) {
        parts.push(
          `<rect x="${x + 0.5}" y="${y + 0.5}" width="${CELL - 1}" height="${CELL - 1}" rx="3" fill="none" stroke="#cbd5e1" stroke-dasharray="2 2"/>`,
        );
        continue;
      }
      const shown = options.value(harmonized, { year, month, column });
      const partial = Boolean(payload.partial[month][column]);
      const outside = !inRange(year, month);
      const label = `${MONTH_NAMES[month]} ${year}: ${shown === null ? "—" : format(shown)}${partial ? " (partial month)" : ""}${
        outside ? " (outside the range)" : ""
      }`;
      parts.push(
        `<rect class="cell" x="${x}" y="${y}" width="${CELL}" height="${CELL}" rx="3" fill="${options.color(shown)}"${
          partial ? ' stroke="#0f172a" stroke-dasharray="3 2"' : ""
        }${outside ? ' opacity="0.2"' : ""}><title>${escapeXml(label)}</title></rect>`,
      );
    }
  });

  const ramp = options.ramp ?? [];
  const barWidth = Math.min(240, width - LEFT - 16);
  const barY = gridBottom + 14;
  if (ramp.length > 1) {
    const stops = ramp
      .map((color, index) => `<stop offset="${(index / (ramp.length - 1)).toFixed(3)}" stop-color="${color}"/>`)
      .join("");
    parts.push(
      `<defs><linearGradient id="ramp">${stops}</linearGradient></defs>`,
      `<rect x="${LEFT}" y="${barY}" width="${barWidth}" height="8" rx="2" fill="url(#ramp)"/>`,
    );
  }
  parts.push(
    `<text x="${LEFT}" y="${barY + 22}" font-size="9" fill="#475569">${escapeXml(options.legend[0])}</text>`,
    `<text x="${LEFT + barWidth}" y="${barY + 22}" font-size="9" text-anchor="end" fill="#475569">${escapeXml(options.legend[1])}</text>`,
    `<text x="${width - 16}" y="${barY + 22}" font-size="9" text-anchor="end" fill="#94a3b8">Firetrack · NASA FIRMS MODIS + VIIRS</text>`,
    "</svg>",
  );
  return parts.join("");
}
