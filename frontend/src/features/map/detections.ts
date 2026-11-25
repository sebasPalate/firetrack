import { detectionsYearUrl } from "@/shared/api";

export type Family = "MODIS" | "VIIRS";

/** One satellite pixel flagged as hot. Only the columns the map needs. */
export type Detection = {
  /** YYYY-MM-DD */
  date: string;
  sensor: string;
  satellite: string;
  /** D or N */
  daynight: string;
  /** MODIS: 0-100. VIIRS: l / n / h. */
  confidence: string;
  lat: number;
  lon: number;
  /** Fire radiative power in MW, when the sensor reported it. */
  frp: number | null;
};

export class DetectionsError extends Error {
  constructor(
    message: string,
    readonly status: number,
  ) {
    super(message);
    this.name = "DetectionsError";
  }
}

export function familyOf(sensor: string): Family {
  return sensor.toUpperCase().startsWith("VIIRS") ? "VIIRS" : "MODIS";
}

function splitLine(line: string): string[] {
  if (!line.includes('"')) return line.split(",");
  const fields: string[] = [];
  let current = "";
  let quoted = false;
  for (let index = 0; index < line.length; index += 1) {
    const char = line[index];
    if (quoted) {
      if (char === '"') {
        if (line[index + 1] === '"') {
          current += '"';
          index += 1;
        } else {
          quoted = false;
        }
      } else {
        current += char;
      }
    } else if (char === '"') {
      quoted = true;
    } else if (char === ",") {
      fields.push(current);
      current = "";
    } else {
      current += char;
    }
  }
  fields.push(current);
  return fields;
}

export function parseDetections(text: string): Detection[] {
  const lines = text.split(/\r?\n/);
  const header = splitLine(lines[0] ?? "");
  const at = (name: string) => header.indexOf(name);
  const iDate = at("acq_date");
  const iSensor = at("sensor");
  const iSatellite = at("satellite");
  const iDayNight = at("daynight");
  const iConfidence = at("confidence");
  const iLat = at("latitude");
  const iLon = at("longitude");
  const iFrp = at("frp");
  if (iDate < 0 || iSensor < 0 || iLat < 0 || iLon < 0) {
    throw new DetectionsError("The detections file has an unexpected header.", 500);
  }

  const rows: Detection[] = [];
  for (let index = 1; index < lines.length; index += 1) {
    const line = lines[index];
    if (!line) continue;
    const fields = splitLine(line);
    const field = (column: number) => (column >= 0 ? (fields[column] ?? "") : "");
    const lat = Number(field(iLat));
    const lon = Number(field(iLon));
    if (!Number.isFinite(lat) || !Number.isFinite(lon)) continue;
    const frpText = field(iFrp);
    const frp = frpText === "" ? Number.NaN : Number(frpText);
    rows.push({
      date: field(iDate),
      sensor: field(iSensor),
      satellite: field(iSatellite),
      daynight: field(iDayNight),
      confidence: field(iConfidence),
      lat,
      lon,
      frp: Number.isFinite(frp) ? frp : null,
    });
  }
  return rows;
}

/** A year of a region is fetched once; the cache keeps the last few so playback never refetches. */
const CACHE_LIMIT = 4;
const cache = new Map<string, Promise<Detection[]>>();

export function loadDetections(region: string, year: number): Promise<Detection[]> {
  const key = `${region}:${year}`;
  const cached = cache.get(key);
  if (cached) return cached;

  const request = fetch(detectionsYearUrl(region, year))
    .then(async (response) => {
      if (response.status === 404) {
        throw new DetectionsError(`The pipeline wrote no detections file for ${year}.`, 404);
      }
      if (!response.ok) throw new DetectionsError(`${response.status} ${response.statusText}`, response.status);
      return parseDetections(await response.text());
    })
    .catch((cause: unknown) => {
      cache.delete(key);
      throw cause;
    });

  cache.set(key, request);
  while (cache.size > CACHE_LIMIT) {
    const oldest = cache.keys().next().value;
    if (oldest === undefined) break;
    cache.delete(oldest);
  }
  return request;
}

/** `month` is zero-based. */
export function rowsInMonth(rows: Detection[], year: number, month: number): Detection[] {
  const prefix = `${year}-${String(month + 1).padStart(2, "0")}-`;
  return rows.filter((row) => row.date.startsWith(prefix));
}
