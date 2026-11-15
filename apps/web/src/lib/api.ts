import type { CalendarPayload, MethodPayload, Region } from "./types";

/**
 * Two ways to get the same payloads:
 *
 * - **Static (default).** `pipeline.export_web` writes them to `public/data/`, and
 *   the page reads plain files. No server, so it deploys anywhere (Vercel).
 * - **API.** Set `NEXT_PUBLIC_API_BASE` and the page talks to FastAPI instead,
 *   which serves the same payloads from the Parquet artifacts.
 *
 * Both are built by `pipeline/payloads.py`, so they cannot disagree.
 */
export const API_BASE = (process.env.NEXT_PUBLIC_API_BASE ?? "").replace(/\/$/, "");
export const STATIC_MODE = API_BASE === "";
/** Sub-path the site is served from, if any (GitHub Pages); empty on Vercel. */
const BASE_PATH = (process.env.NEXT_PUBLIC_BASE_PATH ?? "").replace(/\/$/, "");
const STATIC_BASE = `${BASE_PATH}/data`;

/** Where the data comes from, for error messages. */
export const DATA_SOURCE = STATIC_MODE ? `${STATIC_BASE}/` : API_BASE;

export class ApiError extends Error {
  constructor(
    message: string,
    readonly status: number,
  ) {
    super(message);
    this.name = "ApiError";
  }
}

async function getJson<T>(url: string, signal?: AbortSignal): Promise<T> {
  const response = await fetch(url, { signal, cache: "no-store" });
  if (!response.ok) {
    // FastAPI puts the actionable part in `detail`; an empty chart that looks
    // like "no fires" is worse than an honest error, so never swallow it.
    let detail = `${response.status} ${response.statusText}`;
    try {
      const body = (await response.json()) as { detail?: unknown };
      if (typeof body.detail === "string") detail = body.detail;
    } catch {
      // the body was not JSON; keep the status line
    }
    if (STATIC_MODE && response.status === 404) {
      detail = `${url} is missing: run  python -m pipeline.export_web  and commit apps/web/public/data`;
    }
    throw new ApiError(detail, response.status);
  }
  return (await response.json()) as T;
}

export function fetchRegions(signal?: AbortSignal): Promise<Region[]> {
  return getJson<Region[]>(STATIC_MODE ? `${STATIC_BASE}/regions.json` : `${API_BASE}/regions`, signal);
}

export function fetchCalendar(region: string, signal?: AbortSignal): Promise<CalendarPayload> {
  const id = encodeURIComponent(region);
  return getJson<CalendarPayload>(
    STATIC_MODE ? `${STATIC_BASE}/calendar/${id}.json` : `${API_BASE}/calendar?region=${id}`,
    signal,
  );
}

export function fetchMethod(region: string, signal?: AbortSignal): Promise<MethodPayload> {
  const id = encodeURIComponent(region);
  return getJson<MethodPayload>(
    STATIC_MODE ? `${STATIC_BASE}/method/${id}.json` : `${API_BASE}/method?region=${id}`,
    signal,
  );
}

/** API mode only: one request, the server cuts the range. */
export function detectionsCsvUrl(region: string, startYear: number, endYear: number): string {
  const start = `${startYear}-01-01`;
  const end = `${endYear}-12-31`;
  return `${API_BASE}/detections?region=${encodeURIComponent(region)}&start=${start}&end=${end}`;
}

/** One year of detections as CSV, from the static files or from the API. */
export function detectionsYearUrl(region: string, year: number): string {
  if (!STATIC_MODE) return detectionsCsvUrl(region, year, year);
  return `${STATIC_BASE}/detections/${encodeURIComponent(region)}/${year}.csv`;
}

/** Official boundary of a region. Always a static file, in both modes. */
export function boundaryUrl(region: string): string {
  return `${STATIC_BASE}/aoi/${encodeURIComponent(region)}.geojson`;
}

/**
 * Static mode: the detections are one CSV per year, so the range is stitched in
 * the browser (one header, then every year in order) and saved as one file.
 * A year with no file is skipped and reported, never silently treated as empty.
 */
export async function downloadDetections(
  region: string,
  startYear: number,
  endYear: number,
): Promise<{ rows: number; missing: number[] }> {
  if (!STATIC_MODE) {
    window.location.href = detectionsCsvUrl(region, startYear, endYear);
    return { rows: -1, missing: [] };
  }
  const id = encodeURIComponent(region);
  let header = "";
  const parts: string[] = [];
  const missing: number[] = [];
  let rows = 0;
  for (let year = startYear; year <= endYear; year += 1) {
    const response = await fetch(`${STATIC_BASE}/detections/${id}/${year}.csv`, { cache: "no-store" });
    if (!response.ok) {
      missing.push(year);
      continue;
    }
    const text = (await response.text()).replace(/\r?\n$/, "");
    const newline = text.indexOf("\n");
    if (newline < 0) {
      header ||= text;
      continue;
    }
    header ||= text.slice(0, newline);
    const body = text.slice(newline + 1);
    parts.push(body);
    rows += body.split("\n").length;
  }
  if (!header) throw new ApiError(`no detection files for ${region} in ${startYear}-${endYear}`, 404);
  const body = parts.length ? `${parts.join("\n")}\n` : "";
  const blob = new Blob([`${header}\n`, body], { type: "text/csv;charset=utf-8" });
  const url = URL.createObjectURL(blob);
  const link = document.createElement("a");
  link.href = url;
  link.download = `firetrack-${region}-${startYear}-01-01-${endYear}-12-31.csv`;
  link.click();
  setTimeout(() => URL.revokeObjectURL(url), 1000);
  return { rows, missing };
}
