import { AOI_SOURCE_REGION, filterCsv, formatBox, inBox, type Bbox } from "@/features/area/aoi";
import { inRangeDate, isWholeYears, type MonthRange } from "@/features/range/range";
import { ApiError, STATIC_MODE, detectionsCsvUrl, detectionsYearUrl } from "@/shared/api";

/**
 * Static mode: the detections are one CSV per year, so the range is stitched in
 * the browser (one header, then every year in order) and saved as one file.
 * A year with no file is skipped and reported, never silently treated as empty.
 *
 * A custom `box` is cut from the Spain files in the browser, in either mode:
 * only the rows inside the box are kept. A `range` that does not cover whole
 * years keeps only the rows of its months, also in the browser.
 */
export async function downloadDetections(
  region: string,
  range: MonthRange,
  box?: Bbox,
): Promise<{ rows: number; missing: number[] }> {
  const startYear = range.start.year;
  const endYear = range.end.year;
  const byMonth = !isWholeYears(range);
  if (!STATIC_MODE && !box && !byMonth) {
    window.location.href = detectionsCsvUrl(region, startYear, endYear);
    return { rows: -1, missing: [] };
  }
  const source = box ? AOI_SOURCE_REGION : region;
  const keep = (field: (name: string) => string) =>
    (!box || inBox(Number(field("latitude")), Number(field("longitude")), box)) &&
    (!byMonth || inRangeDate(field("acq_date"), range));
  let header = "";
  const parts: string[] = [];
  const missing: number[] = [];
  let rows = 0;
  for (let year = startYear; year <= endYear; year += 1) {
    const response = await fetch(detectionsYearUrl(source, year), { cache: "no-store" });
    if (!response.ok) {
      missing.push(year);
      continue;
    }
    const full = await response.text();
    const text = (box || byMonth ? filterCsv(full, keep).text : full).replace(/\r?\n$/, "");
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
  const name = box ? `aoi_${formatBox(box).replaceAll(",", "_")}` : region;
  const pad = (value: number) => String(value).padStart(2, "0");
  const lastDay = new Date(Date.UTC(endYear, range.end.month + 1, 0)).getUTCDate();
  const from = `${startYear}-${pad(range.start.month + 1)}-01`;
  const to = `${endYear}-${pad(range.end.month + 1)}-${pad(lastDay)}`;
  link.download = `firetrack-${name}-${from}-${to}.csv`;
  link.click();
  setTimeout(() => URL.revokeObjectURL(url), 1000);
  return { rows, missing };
}
