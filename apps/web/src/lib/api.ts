import type { CalendarPayload, MethodPayload, Region } from "./types";

/**
 * The API runs separately from Next on purpose: DuckDB never enters a
 * serverless function, and the browser only ever talks to FastAPI.
 */
export const API_BASE = (
  process.env.NEXT_PUBLIC_API_BASE ?? "http://localhost:8000"
).replace(/\/$/, "");

export class ApiError extends Error {
  constructor(
    message: string,
    readonly status: number,
  ) {
    super(message);
    this.name = "ApiError";
  }
}

async function getJson<T>(path: string, signal?: AbortSignal): Promise<T> {
  const response = await fetch(`${API_BASE}${path}`, { signal, cache: "no-store" });
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
    throw new ApiError(detail, response.status);
  }
  return (await response.json()) as T;
}

export function fetchRegions(signal?: AbortSignal): Promise<Region[]> {
  return getJson<Region[]>("/regions", signal);
}

export function fetchCalendar(region: string, signal?: AbortSignal): Promise<CalendarPayload> {
  return getJson<CalendarPayload>(`/calendar?region=${encodeURIComponent(region)}`, signal);
}

export function fetchMethod(signal?: AbortSignal): Promise<MethodPayload> {
  return getJson<MethodPayload>("/method", signal);
}

export function detectionsCsvUrl(region: string, startYear: number, endYear: number): string {
  const start = `${startYear}-01-01`;
  const end = `${endYear}-12-31`;
  return `${API_BASE}/detections?region=${encodeURIComponent(region)}&start=${start}&end=${end}`;
}
