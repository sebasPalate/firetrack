import {
  AOI_SOURCE_REGION,
  CUSTOM_REGION_ID,
  buildAoiCalendar,
  compactDetections,
  countInBox,
  formatBox,
  validateBox,
  type Bbox,
  type YearDetections,
} from "@/features/area/aoi";
import { ApiError, detectionsYearUrl, fetchCalendar, fetchMethod } from "@/shared/api";
import type { CalendarPayload, MethodPayload, Region } from "@/shared/types";

/** Parallel year downloads: enough to fill the pipe, few enough to keep progress honest. */
const CONCURRENCY = 6;

/**
 * Every year of the source detections, parsed once per session into compact
 * columns (a few MB), so drawing a second box is instant. The downloads are not
 * tied to one view's abort signal: a cancelled view would otherwise poison the
 * cache the next view is about to read.
 */
const years = new Map<number, Promise<YearDetections>>();

function loadYear(year: number): Promise<YearDetections> {
  const cached = years.get(year);
  if (cached) return cached;
  const request = fetch(detectionsYearUrl(AOI_SOURCE_REGION, year))
    .then(async (response) => {
      if (!response.ok) {
        throw new ApiError(`The ${year} detections could not be read (${response.status}).`, response.status);
      }
      return compactDetections(await response.text());
    })
    .catch((cause: unknown) => {
      years.delete(year);
      throw cause;
    });
  years.set(year, request);
  return request;
}

export function customRegion(box: Bbox): Region {
  return {
    id: CUSTOM_REGION_ID,
    name: `Custom area ${formatBox(box).replaceAll(",", ", ")}`,
    bbox: box,
    why: "Custom area, computed in your browser from the Spain detections inside this box. It borrows Spain's calibration and validation as they are: it is not validated on its own.",
  };
}

/** The same two payloads a published region has, built for a box inside the Spain data. */
export async function loadCustomArea(
  box: Bbox,
  onProgress: (done: number, total: number) => void,
  signal?: AbortSignal,
): Promise<{ calendar: CalendarPayload; method: MethodPayload }> {
  const [base, method] = await Promise.all([
    fetchCalendar(AOI_SOURCE_REGION, signal),
    fetchMethod(AOI_SOURCE_REGION, signal),
  ]);
  const problem = validateBox(box, base.region.bbox);
  if (problem) throw new ApiError(problem, 400);

  const loaded = new Map<number, YearDetections>();
  const queue = [...base.years];
  let done = 0;
  onProgress(done, queue.length);
  async function worker() {
    for (let year = queue.shift(); year !== undefined; year = queue.shift()) {
      signal?.throwIfAborted();
      loaded.set(year, await loadYear(year));
      done += 1;
      onProgress(done, base.years.length);
    }
  }
  await Promise.all(Array.from({ length: CONCURRENCY }, worker));

  const calendar = buildAoiCalendar(base, method, countInBox(loaded, box), customRegion(box));
  if (!calendar.years.length) {
    throw new ApiError("No detections inside this box in the whole record. Try a larger area.", 404);
  }
  return { calendar, method };
}
