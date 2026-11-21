/**
 * The link is the state. Region (or custom area), year range, selected month, calendar scale and
 * series live in the query string, so any view can be pasted into a chat or a
 * slide and open exactly as it was.
 *
 * It uses `history.replaceState` directly: no navigation, no re-render, no
 * scroll jump, and it works the same on a static export under a base path.
 */
import { formatBox, parseBox, type Bbox } from "./aoi";

export type Series = "raw" | "harmonized" | "compare";
export type ViewMode = "index" | "anomaly";

export type UrlState = {
  region?: string;
  /** The custom area, when `region` is the custom one. Range checks happen where the data is. */
  aoi?: Bbox;
  from?: number;
  to?: number;
  year?: number;
  /** Zero-based month, like everywhere else in the client. */
  month?: number;
  view?: ViewMode;
  series?: Series;
};

export type UrlSnapshot = {
  region: string;
  aoi?: Bbox;
  from?: number;
  to?: number;
  year?: number;
  month?: number;
  view: ViewMode;
  series: Series;
};

const REGION_ID = /^[a-z0-9_-]{1,40}$/i;

function integer(value: string | null, min: number, max: number): number | undefined {
  if (value === null || !/^\d{1,4}$/.test(value)) return undefined;
  const parsed = Number(value);
  return parsed >= min && parsed <= max ? parsed : undefined;
}

/**
 * The query string as an external store, for `useSyncExternalStore`: the browser
 * owns it, the server has no query string, and reading it during render would
 * desynchronise hydration. Returning the raw string keeps the snapshot stable by
 * value, so the subscription never loops.
 */
export function subscribeToUrl(onChange: () => void): () => void {
  window.addEventListener("popstate", onChange);
  return () => window.removeEventListener("popstate", onChange);
}

export function urlSnapshot(): string {
  return window.location.search;
}

/** Everything is validated: a hand-edited link can never put the page in a state it cannot render. */
export function parseUrlState(search: string): UrlState {
  const params = new URLSearchParams(search);
  const region = params.get("region");
  const view = params.get("view");
  const series = params.get("series");
  const month = integer(params.get("month"), 1, 12);
  return {
    region: region && REGION_ID.test(region) ? region : undefined,
    aoi: parseBox(params.get("aoi")) ?? undefined,
    from: integer(params.get("from"), 1900, 2200),
    to: integer(params.get("to"), 1900, 2200),
    year: integer(params.get("year"), 1900, 2200),
    month: month === undefined ? undefined : month - 1,
    view: view === "index" || view === "anomaly" ? view : undefined,
    series: series === "raw" || series === "harmonized" || series === "compare" ? series : undefined,
  };
}

/** Defaults are left out so shared links stay short. */
export function writeUrlState(state: UrlSnapshot): void {
  const params = new URLSearchParams();
  params.set("region", state.region);
  if (state.aoi) params.set("aoi", formatBox(state.aoi));
  if (state.from !== undefined) params.set("from", String(state.from));
  if (state.to !== undefined) params.set("to", String(state.to));
  if (state.year !== undefined && state.month !== undefined) {
    params.set("year", String(state.year));
    params.set("month", String(state.month + 1));
  }
  if (state.view !== "index") params.set("view", state.view);
  if (state.series !== "harmonized") params.set("series", state.series);
  const next = `${window.location.pathname}?${params.toString()}${window.location.hash}`;
  window.history.replaceState(window.history.state, "", next);
}
