import type { CalendarPayload, MethodPayload, Region } from "./types";

/**
 * A custom area of interest, computed in the browser.
 *
 * The published Spain detections are already filtered (confidence, static
 * sources) and clipped to Spain's boundary, so a sub-area is only a lat/lon
 * filter on them. The calendar then follows the pipeline's own rules
 * (`pipeline/harmonize.py` `build_calendar`, `pipeline/payloads.py`):
 *
 * - The sensor that carries each month, and whether the month is partial or
 *   provisional, do not depend on the area, so they are read from Spain's calendar.
 * - The index divides the carrying satellite's count inside the box by Spain's
 *   factor for that sensor and month. A box cannot fit its own calibration (the
 *   per-sensor coverage it needs is not published), so it borrows Spain's.
 *
 * Kept free of runtime imports so `node --test` can run it as plain TypeScript.
 */

/** West, south, east, north in degrees. */
export type Bbox = [number, number, number, number];

/** The published dataset every custom area is cut from. */
export const AOI_SOURCE_REGION = "spain";
export const CUSTOM_REGION_ID = "custom";
/** Smallest side a box may have: about 5 km, a few VIIRS pixels. */
export const MIN_SIDE_DEG = 0.05;

/** Index order of the per-satellite counts. */
export const SATELLITES = ["Terra", "Aqua", "Suomi-NPP", "NOAA-20", "NOAA-21"] as const;

/** Compact columns of one year of detections, so redrawing a box never re-parses text. */
export type YearDetections = {
  year: Int16Array;
  /** Zero-based month. */
  month: Uint8Array;
  /** Index into SATELLITES; 255 for a satellite the calendar does not know. */
  satellite: Uint8Array;
  lat: Float64Array;
  lon: Float64Array;
};

/** Key of a per-month count: `${year}-${zeroBasedMonth}`. */
export type MonthCounts = Map<string, number[]>;

export function parseBox(text: string | null | undefined): Bbox | null {
  if (!text) return null;
  const parts = text.split(",");
  if (parts.length !== 4) return null;
  const values = parts.map((part) => (/^\s*-?\d+(\.\d+)?\s*$/.test(part) ? Number(part) : Number.NaN));
  return values.every(Number.isFinite) ? (values as Bbox) : null;
}

/** Four decimals: about 10 m, plenty for a link and stable to round-trip. */
export function formatBox(box: Bbox): string {
  return box.map((value) => value.toFixed(4)).join(",");
}

/** Why a box cannot be used, or null when it can. `limits` is the source data's own box. */
export function validateBox(box: Bbox, limits: Bbox): string | null {
  const [west, south, east, north] = box;
  if (![west, south, east, north].every(Number.isFinite)) return "Enter four numbers: west, south, east, north.";
  if (west >= east) return "The west must be smaller than east.";
  if (south >= north) return "The south must be smaller than north.";
  const [minLon, minLat, maxLon, maxLat] = limits;
  if (west < minLon || east > maxLon || south < minLat || north > maxLat) {
    return `The area must lie inside the Spain data (longitude ${minLon} to ${maxLon}, latitude ${minLat} to ${maxLat}).`;
  }
  if (east - west < MIN_SIDE_DEG || north - south < MIN_SIDE_DEG) {
    return `The area must be at least ${MIN_SIDE_DEG}° on each side.`;
  }
  return null;
}

export function inBox(lat: number, lon: number, box: Bbox): boolean {
  return lon >= box[0] && lon <= box[2] && lat >= box[1] && lat <= box[3];
}

/** Clamp a box to the limits, keeping its order; used for a rectangle drawn past the map edge. */
export function clampBox(box: Bbox, limits: Bbox): Bbox {
  const lon = (value: number) => Math.min(Math.max(value, limits[0]), limits[2]);
  const lat = (value: number) => Math.min(Math.max(value, limits[1]), limits[3]);
  return [
    lon(Math.min(box[0], box[2])),
    lat(Math.min(box[1], box[3])),
    lon(Math.max(box[0], box[2])),
    lat(Math.max(box[1], box[3])),
  ];
}

/** One CSV line into fields, honouring double-quoted fields with commas and escaped quotes. */
export function splitCsvLine(line: string): string[] {
  if (!line.includes('"')) return line.split(",");
  const fields: string[] = [];
  let field = "";
  let quoted = false;
  for (let index = 0; index < line.length; index += 1) {
    const char = line[index];
    if (quoted) {
      if (char === '"' && line[index + 1] === '"') {
        field += '"';
        index += 1;
      } else if (char === '"') {
        quoted = false;
      } else {
        field += char;
      }
    } else if (char === '"') {
      quoted = true;
    } else if (char === ",") {
      fields.push(field);
      field = "";
    } else {
      field += char;
    }
  }
  fields.push(field);
  return fields;
}

function columns(header: string, names: string[]): number[] {
  const fields = splitCsvLine(header.replace(/\r$/, ""));
  return names.map((name) => {
    const index = fields.indexOf(name);
    if (index < 0) throw new Error(`detections CSV has no "${name}" column`);
    return index;
  });
}

function lines(csv: string): string[] {
  return csv.split("\n").filter((line) => line.trim() !== "");
}

export function compactDetections(csv: string): YearDetections {
  const rows = lines(csv);
  const [dateAt, satelliteAt, latAt, lonAt] = columns(rows[0] ?? "", ["acq_date", "satellite", "latitude", "longitude"]);
  const size = Math.max(rows.length - 1, 0);
  const out: YearDetections = {
    year: new Int16Array(size),
    month: new Uint8Array(size),
    satellite: new Uint8Array(size),
    lat: new Float64Array(size),
    lon: new Float64Array(size),
  };
  for (let row = 0; row < size; row += 1) {
    const fields = splitCsvLine(rows[row + 1].replace(/\r$/, ""));
    const date = fields[dateAt];
    out.year[row] = Number(date.slice(0, 4));
    out.month[row] = Number(date.slice(5, 7)) - 1;
    const satellite = (SATELLITES as readonly string[]).indexOf(fields[satelliteAt]);
    out.satellite[row] = satellite < 0 ? 255 : satellite;
    out.lat[row] = Number(fields[latAt]);
    out.lon[row] = Number(fields[lonAt]);
  }
  return out;
}

/** Detections inside the box, per month and satellite. Months with none are absent. */
export function countInBox(years: Map<number, YearDetections>, box: Bbox): MonthCounts {
  const counts: MonthCounts = new Map();
  for (const detections of years.values()) {
    for (let row = 0; row < detections.lat.length; row += 1) {
      if (!inBox(detections.lat[row], detections.lon[row], box)) continue;
      const key = `${detections.year[row]}-${detections.month[row]}`;
      let entry = counts.get(key);
      if (!entry) {
        entry = SATELLITES.map(() => 0);
        counts.set(key, entry);
      }
      const satellite = detections.satellite[row];
      // An unknown satellite still counts as a detection in the month, like the raw count.
      if (satellite < SATELLITES.length) entry[satellite] += 1;
      else entry.push(1);
    }
  }
  return counts;
}

/**
 * The CSV header plus the rows a rule keeps, in their original text. The rule
 * reads fields by column name, so it never depends on the column order.
 */
export function filterCsv(
  csv: string,
  keep: (field: (name: string) => string) => boolean,
): { text: string; rows: number } {
  const rows = lines(csv);
  if (!rows.length) return { text: "", rows: 0 };
  const header = splitCsvLine(rows[0].replace(/\r$/, ""));
  const kept = rows.slice(1).filter((line) => {
    const fields = splitCsvLine(line.replace(/\r$/, ""));
    return keep((name) => {
      const index = header.indexOf(name);
      if (index < 0) throw new Error(`detections CSV has no "${name}" column`);
      return fields[index] ?? "";
    });
  });
  return { text: `${[rows[0], ...kept].join("\n")}\n`, rows: kept.length };
}

/** The CSV header plus the rows inside the box, in their original text. */
export function filterCsvToBox(csv: string, box: Bbox): { text: string; rows: number } {
  return filterCsv(csv, (field) => inBox(Number(field("latitude")), Number(field("longitude")), box));
}

/** Python's `round(x, digits)`: exact on the binary value, which `toFixed` also is. */
function round(value: number, digits: number): number {
  return Number(value.toFixed(digits));
}

/** The factor that converts one month of the carrying sensor into Aqua MODIS units. */
function sourceFactor(source: string, month: number, method: MethodPayload): number | null {
  const monthly = method.calibration.monthly[String(month + 1).padStart(2, "0")]?.factor ?? null;
  switch (source) {
    case "Aqua":
      return 1;
    case "Terra":
      return method.calibration.bridge.factor;
    case "Suomi-NPP":
      return monthly;
    case "NOAA-20":
      return monthly === null || method.calibration.tail.factor === null
        ? null
        : monthly * method.calibration.tail.factor;
    default:
      return null;
  }
}

function median(values: number[]): number {
  const ordered = [...values].sort((a, b) => a - b);
  const middle = Math.floor(ordered.length / 2);
  return ordered.length % 2 ? ordered[middle] : (ordered[middle - 1] + ordered[middle]) / 2;
}

/**
 * The calendar payload for a custom box, shaped exactly like the pipeline's.
 * `base` and `method` are the source region's (Spain's) published payloads.
 */
export function buildAoiCalendar(
  base: CalendarPayload,
  method: MethodPayload,
  counts: MonthCounts,
  region: Region,
): CalendarPayload {
  type Cell = {
    index: number;
    raw: number;
    partial: boolean;
    provisional: boolean;
    source: string;
    factor: number;
    observedDays: number | null;
  };
  const cells = new Map<string, Cell>();
  base.years.forEach((year, column) => {
    for (let month = 0; month < 12; month += 1) {
      const source = base.source[month]?.[column] ?? null;
      const entry = counts.get(`${year}-${month}`);
      if (source === null || !entry) continue;
      const factor = sourceFactor(source, month, method);
      if (factor === null) continue;
      const count = entry[(SATELLITES as readonly string[]).indexOf(source)] ?? 0;
      cells.set(`${year}-${month}`, {
        index: source === "Aqua" ? count : round(count / factor, 3),
        raw: entry.reduce((sum, value) => sum + value, 0),
        partial: Boolean(base.partial[month][column]),
        provisional: Boolean(base.provisional[month][column]),
        source,
        factor: round(factor, 4),
        observedDays: base.observed_days[month][column],
      });
    }
  });

  const years = base.years.filter((year) => {
    for (let month = 0; month < 12; month += 1) if (cells.has(`${year}-${month}`)) return true;
    return false;
  });
  function matrix<T>(pick: (cell: Cell) => T): (T | null)[][] {
    return Array.from({ length: 12 }, (_, month) =>
      years.map((year) => {
        const cell = cells.get(`${year}-${month}`);
        return cell ? pick(cell) : null;
      }),
    );
  }

  const harmonized = matrix((cell) => cell.index);
  const partial = matrix((cell) => cell.partial);
  const provisional = matrix((cell) => cell.provisional);

  const medianByMonth: Record<string, number> = {};
  for (let month = 0; month < 12; month += 1) {
    const values = years.flatMap((_, column) => {
      const value = harmonized[month][column];
      return value !== null && !partial[month][column] && !provisional[month][column] ? [value] : [];
    });
    if (values.length) medianByMonth[String(month + 1)] = round(median(values), 4);
  }

  const anomaly = Array.from({ length: 12 }, (_, month) =>
    years.map((_, column) => {
      const value = harmonized[month][column];
      const reference = medianByMonth[String(month + 1)];
      if (value === null || !reference || partial[month][column]) return null;
      return round(((value - reference) / reference) * 100, 1);
    }),
  );

  return {
    region,
    years,
    months: [...base.months],
    harmonized,
    raw_count: matrix((cell) => cell.raw),
    // Missing months are null in every matrix, exactly as the pipeline serves them.
    partial: partial as boolean[][],
    provisional: provisional as boolean[][],
    source: matrix((cell) => cell.source),
    factor: matrix((cell) => cell.factor),
    observed_days: matrix((cell) => cell.observedDays),
    median_by_month: medianByMonth,
    anomaly_pct: anomaly,
    units: base.units,
  };
}
