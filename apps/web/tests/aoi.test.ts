import assert from "node:assert/strict";
import { readFileSync, readdirSync } from "node:fs";
import { dirname, join } from "node:path";
import { test } from "node:test";
import { fileURLToPath } from "node:url";

import {
  buildAoiCalendar,
  compactDetections,
  countInBox,
  filterCsvToBox,
  formatBox,
  parseBox,
  validateBox,
  type Bbox,
  type YearDetections,
} from "../src/lib/aoi.ts";
import type { CalendarPayload, MethodPayload, Region } from "../src/lib/types.ts";

const DATA = join(dirname(fileURLToPath(import.meta.url)), "..", "public", "data");
const SPAIN_BOX: Bbox = [-9.31, 36.0, 4.33, 43.8];

function readJson<T>(path: string): T {
  return JSON.parse(readFileSync(join(DATA, path), "utf8")) as T;
}

function loadSpainYears(): Map<number, YearDetections> {
  const years = new Map<number, YearDetections>();
  for (const file of readdirSync(join(DATA, "detections", "spain"))) {
    const year = Number(file.replace(".csv", ""));
    years.set(year, compactDetections(readFileSync(join(DATA, "detections", "spain", file), "utf8")));
  }
  return years;
}

const customRegion = (bbox: Bbox): Region => ({ id: "custom", name: "Custom area", bbox, why: "test" });

test("S3: a box around the whole Spain dataset reproduces the pipeline's Spain calendar", () => {
  const spain = readJson<CalendarPayload>("calendar/spain.json");
  const method = readJson<MethodPayload>("method/spain.json");
  const counts = countInBox(loadSpainYears(), SPAIN_BOX);
  const built = buildAoiCalendar(spain, method, counts, customRegion(SPAIN_BOX));

  assert.deepEqual(built.years, spain.years);
  assert.deepEqual(built.months, spain.months);
  for (const key of [
    "harmonized",
    "raw_count",
    "partial",
    "provisional",
    "source",
    "factor",
    "observed_days",
    "anomaly_pct",
  ] as const) {
    assert.deepEqual(built[key], spain[key], key);
  }
  assert.deepEqual(built.median_by_month, spain.median_by_month);
  assert.equal(built.units, spain.units);
  assert.equal(built.region.id, "custom");
});

/** Two years, Spain-like: 2012 carried by Suomi-NPP, 2013 by Aqua in January and NOAA-20 in February. */
function syntheticBase(): { base: CalendarPayload; method: MethodPayload } {
  const empty = <T>(value: T): T[][] => Array.from({ length: 12 }, () => [value, value]);
  const base: CalendarPayload = {
    region: customRegion(SPAIN_BOX),
    years: [2012, 2013],
    months: [1, 2, 3, 4, 5, 6, 7, 8, 9, 10, 11, 12],
    harmonized: empty<number | null>(null),
    raw_count: empty<number | null>(null),
    partial: empty<boolean>(false),
    provisional: empty<boolean>(false),
    source: empty<string | null>(null),
    factor: empty<number | null>(null),
    observed_days: empty<number | null>(null),
    median_by_month: {},
    anomaly_pct: empty<number | null>(null),
    units: "harmonized activity index (not an absolute fire count)",
  };
  base.source[0] = ["Suomi-NPP", "Aqua"];
  base.observed_days[0] = [31, 30];
  base.source[1] = ["Suomi-NPP", "NOAA-20"];
  base.observed_days[1] = [29, 10];
  base.partial[1] = [false, true];
  base.provisional[1] = [false, true];
  const method = {
    calibration: {
      monthly: { "01": { factor: 4 }, "02": { factor: 5 } },
      tail: { factor: 1.25 },
      bridge: { factor: 1.1552 },
    },
  } as unknown as MethodPayload;
  return { base, method };
}

test("S3: each month divides its source satellite's count by that sensor's factor", () => {
  const { base, method } = syntheticBase();
  const counts = new Map<string, number[]>([
    // Terra, Aqua, Suomi-NPP, NOAA-20, NOAA-21
    ["2012-0", [0, 2, 10, 0, 0]],
    ["2013-0", [1, 3, 9, 0, 0]],
    ["2012-1", [0, 0, 7, 0, 0]],
    ["2013-1", [0, 0, 0, 5, 4]],
  ]);
  const built = buildAoiCalendar(base, method, counts, customRegion([0, 40, 1, 41]));

  assert.deepEqual(built.years, [2012, 2013]);
  assert.deepEqual(built.harmonized[0], [2.5, 3]);
  assert.deepEqual(built.factor[0], [4, 1]);
  assert.deepEqual(built.raw_count[0], [12, 13]);
  assert.deepEqual(built.harmonized[1], [1.4, 0.8]);
  assert.deepEqual(built.factor[1], [5, 6.25]);
  assert.deepEqual(built.partial[1], [false, true]);
  assert.deepEqual(built.provisional[1], [false, true]);
  assert.deepEqual(built.observed_days[1], [29, 10]);
  // January has two usable values: the median is their mean; February's 2013 cell is partial.
  assert.deepEqual(built.median_by_month, { "1": 2.75, "2": 1.4 });
  assert.deepEqual(built.anomaly_pct[0], [-9.1, 9.1]);
  assert.deepEqual(built.anomaly_pct[1], [0, null]);
});

test("S3: months with no detection in the box are null in every matrix, and empty years drop out", () => {
  const { base, method } = syntheticBase();
  const counts = new Map<string, number[]>([["2013-0", [0, 3, 0, 0, 0]]]);
  const built = buildAoiCalendar(base, method, counts, customRegion([0, 40, 1, 41]));

  assert.deepEqual(built.years, [2013]);
  for (const key of ["harmonized", "raw_count", "partial", "provisional", "source", "factor", "observed_days"] as const) {
    assert.equal(built[key][1][0], null, key);
  }
  assert.equal(built.harmonized[0][0], 3);
});

test("S2: the box must be a valid rectangle inside Spain's data", () => {
  assert.deepEqual(parseBox("-1.5,40,0.5,41.25"), [-1.5, 40, 0.5, 41.25]);
  assert.equal(parseBox("-1.5,40,0.5"), null);
  assert.equal(parseBox("a,b,c,d"), null);
  assert.equal(formatBox([-1.5, 40, 0.5, 41.25]), "-1.5000,40.0000,0.5000,41.2500");

  assert.equal(validateBox([-1.5, 40, 0.5, 41.25], SPAIN_BOX), null);
  assert.match(validateBox([0.5, 40, -1.5, 41.25], SPAIN_BOX) ?? "", /west must be smaller than east/);
  assert.match(validateBox([-1.5, 41.25, 0.5, 40], SPAIN_BOX) ?? "", /south must be smaller than north/);
  assert.match(
    validateBox([10, 40, 12, 41], SPAIN_BOX) ?? "",
    /must lie inside the Spain data \(longitude -9\.31 to 4\.33, latitude 36 to 43\.8\)/,
  );
  assert.match(validateBox([0, 40, 0.01, 40.01], SPAIN_BOX) ?? "", /at least 0\.05° on each side/);
});

test("S5: the CSV export keeps the header and only the rows inside the box", () => {
  const csv = [
    "acq_date,satellite,note,latitude,longitude",
    "2020-01-01,Aqua,plain,40.5,0.5",
    '2020-01-02,Aqua,"quoted, with comma",40.6,0.6',
    "2020-01-03,Aqua,outside,42.0,0.5",
    "",
  ].join("\n");
  const { text, rows } = filterCsvToBox(csv, [0, 40, 1, 41]);
  assert.equal(rows, 2);
  assert.equal(
    text,
    'acq_date,satellite,note,latitude,longitude\n2020-01-01,Aqua,plain,40.5,0.5\n2020-01-02,Aqua,"quoted, with comma",40.6,0.6\n',
  );
});

test("S3: counting uses the detection's own month and satellite, inside the box only", () => {
  const csv = [
    "acq_date,satellite,latitude,longitude",
    "2020-01-31,Aqua,40.5,0.5",
    "2020-02-01,Suomi-NPP,40.5,0.5",
    "2020-02-01,NOAA-21,40.5,0.5",
    "2020-02-01,Suomi-NPP,43.0,0.5",
  ].join("\n");
  const counts = countInBox(new Map([[2020, compactDetections(csv)]]), [0, 40, 1, 41]);
  assert.deepEqual(counts.get("2020-0"), [0, 1, 0, 0, 0]);
  assert.deepEqual(counts.get("2020-1"), [0, 0, 1, 0, 1]);
  assert.equal(counts.size, 2);
});
