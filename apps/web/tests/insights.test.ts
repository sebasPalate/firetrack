import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { test } from "node:test";
import { fileURLToPath } from "node:url";

import { calendarCsv, calendarSvg, summarize } from "../src/lib/insights.ts";
import type { CalendarPayload } from "../src/lib/types.ts";

const DATA = join(dirname(fileURLToPath(import.meta.url)), "..", "public", "data");

/** Three years: 2020 and 2021 complete, 2022 the running year with a partial March. */
function payload(): CalendarPayload {
  const grid = <T>(value: T): T[][] => Array.from({ length: 12 }, () => [value, value, value]);
  const p: CalendarPayload = {
    region: { id: "test", name: "Test", bbox: [0, 40, 1, 41], why: "" },
    years: [2020, 2021, 2022],
    months: [1, 2, 3, 4, 5, 6, 7, 8, 9, 10, 11, 12],
    harmonized: grid<number | null>(null),
    raw_count: grid<number | null>(null),
    partial: grid<boolean>(false),
    provisional: grid<boolean>(false),
    source: grid<string | null>("Aqua"),
    factor: grid<number | null>(1),
    observed_days: grid<number | null>(30),
    median_by_month: { "1": 10, "2": 20, "3": 15 },
    anomaly_pct: grid<number | null>(null),
    units: "harmonized activity index (not an absolute fire count)",
  };
  p.harmonized[0] = [10, 12, 40];
  p.harmonized[1] = [20, 30, 5];
  p.harmonized[2] = [15, 18, 99];
  p.raw_count[0] = [50, 60, 200];
  p.raw_count[1] = [100, 150, 25];
  p.raw_count[2] = [75, 90, 495];
  p.anomaly_pct[0] = [0, 20, 300];
  p.anomaly_pct[1] = [0, 50, -75];
  p.anomaly_pct[2] = [0, 20, null];
  p.provisional = p.provisional.map(() => [false, false, true]);
  p.partial[2] = [false, false, true];
  return p;
}

test("summary: the most active year skips the running year and is ranked against the others", () => {
  const summary = summarize(payload(), [2020, 2021, 2022]);
  assert.deepEqual(summary.peakYear, { year: 2021, index: 60, vsMedianPct: 14.3 });
});

test("summary: the peak season is the calendar month with the highest median in the range", () => {
  const summary = summarize(payload(), [2020, 2021, 2022]);
  // February: complete values 20 and 30; the provisional 2022 value is left out of the baseline.
  assert.deepEqual(summary.peakMonth, { month: 1, median: 25 });
});

test("summary: the latest complete month is compared with its published median", () => {
  const summary = summarize(payload(), [2020, 2021, 2022]);
  // March 2022 is partial, so February 2022 is the latest complete month.
  assert.deepEqual(summary.latest, { year: 2022, month: 1, index: 5, median: 20, anomalyPct: -75, provisional: true });
});

test("summary: the busiest single months are ranked by index, partial months excluded", () => {
  const summary = summarize(payload(), [2020, 2021, 2022]);
  assert.deepEqual(summary.topMonths, [
    { year: 2022, month: 0, index: 40 },
    { year: 2021, month: 1, index: 30 },
    { year: 2020, month: 1, index: 20 },
  ]);
  assert.equal(summary.rawDetections, 1245);
});

test("summary: a narrower range only reads its own years", () => {
  const summary = summarize(payload(), [2020]);
  assert.deepEqual(summary.peakYear, { year: 2020, index: 45, vsMedianPct: 0 });
  assert.deepEqual(summary.peakMonth, { month: 1, median: 20 });
  assert.equal(summary.rawDetections, 225);
});

test("summary: the published Spain calendar gives a running-year-free peak year", () => {
  const spain = JSON.parse(readFileSync(join(DATA, "calendar", "spain.json"), "utf8")) as CalendarPayload;
  const summary = summarize(spain, spain.years);
  assert.ok(summary.peakYear);
  const column = spain.years.indexOf(summary.peakYear.year);
  assert.equal(spain.provisional[0][column], false);
  assert.ok(summary.latest);
  assert.equal(spain.partial[summary.latest.month][spain.years.indexOf(summary.latest.year)], false);
});

test("calendar CSV: one row per observed month in the range, in time order, with every field", () => {
  const csv = calendarCsv(payload(), [2021, 2022]);
  const lines = csv.trimEnd().split("\n");
  assert.equal(
    lines[0],
    "year,month,harmonized_index,raw_detections,median_for_month,anomaly_pct,source,factor,observed_days,partial,provisional",
  );
  assert.deepEqual(lines.slice(1), [
    "2021,1,12,60,10,20,Aqua,1,30,false,false",
    "2021,2,30,150,20,50,Aqua,1,30,false,false",
    "2021,3,18,90,15,20,Aqua,1,30,false,false",
    "2022,1,40,200,10,300,Aqua,1,30,false,true",
    "2022,2,5,25,20,-75,Aqua,1,30,false,true",
    "2022,3,99,495,15,,Aqua,1,30,true,true",
  ]);
  assert.ok(csv.endsWith("\n"));
});

test("calendar image: an SVG with one cell per observed month, labelled, title escaped", () => {
  const svg = calendarSvg(payload(), [2020, 2021], {
    title: "Spain & <Aragón>",
    subtitle: "harmonized index",
    value: (index) => index,
    color: (value) => (value === null ? "none" : `c${value}`),
    legend: ["0", "30"],
  });
  assert.ok(svg.startsWith('<svg xmlns="http://www.w3.org/2000/svg"'));
  assert.ok(svg.includes("Spain &amp; &lt;Aragón&gt;"));
  assert.equal((svg.match(/<rect class="cell"/g) ?? []).length, 6);
  assert.ok(svg.includes('fill="c30"'));
  assert.ok(svg.includes(">2020<") && svg.includes(">2021<") && !svg.includes(">2022<"));
  assert.ok(svg.includes("<title>Feb 2021: 30</title>"));
});

test("month range: the summary only reads the months inside the range", () => {
  // January and February only: March, the busiest 2022 month, is out of range.
  const within = (_year: number, month: number) => month <= 1;
  const summary = summarize(payload(), [2020, 2021, 2022], within);
  assert.deepEqual(summary.peakYear, { year: 2021, index: 42, vsMedianPct: 16.7 });
  assert.deepEqual(summary.peakMonth, { month: 1, median: 25 });
  assert.equal(summary.latest?.month, 1);
  assert.equal(summary.latest?.year, 2022);
  assert.equal(summary.rawDetections, 585);
  assert.equal(summary.topMonths.length, 3);
});

test("month range: the table only holds the months inside the range", () => {
  const within = (year: number, month: number) => year === 2021 && month >= 1;
  const lines = calendarCsv(payload(), [2021], within).trimEnd().split("\n");
  assert.deepEqual(
    lines.slice(1).map((line) => line.split(",").slice(0, 2).join("-")),
    ["2021-2", "2021-3"],
  );
});

test("month range: the image keeps the whole years and fades the months outside the range", () => {
  const within = (_year: number, month: number) => month === 1;
  const svg = calendarSvg(payload(), [2020, 2021], {
    title: "t",
    subtitle: "s",
    value: (index) => index,
    color: () => "red",
    legend: ["0", "1"],
    inRange: within,
  });
  assert.equal((svg.match(/<rect class="cell"/g) ?? []).length, 6);
  assert.equal((svg.match(/<rect class="cell"[^>]*opacity="0.2"/g) ?? []).length, 4);
  assert.ok(svg.includes("(outside the range)"));
});
