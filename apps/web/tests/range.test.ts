import assert from "node:assert/strict";
import { test } from "node:test";

import {
  clampRange,
  formatRangeBound,
  inRange,
  inRangeDate,
  isWholeYears,
  makeRange,
  parseRangeBound,
  rangeLabel,
} from "../src/lib/range.ts";

const jun22: { year: number; month: number } = { year: 2022, month: 5 };
const sep22 = { year: 2022, month: 8 };

test("range: a month is inside when it falls between both ends, ends included", () => {
  const range = makeRange(jun22, sep22);
  assert.equal(inRange(2022, 5, range), true);
  assert.equal(inRange(2022, 8, range), true);
  assert.equal(inRange(2022, 4, range), false);
  assert.equal(inRange(2022, 9, range), false);
  assert.equal(inRange(2021, 7, range), false);
});

test("range: ends picked in the wrong order are swapped", () => {
  assert.deepEqual(makeRange(sep22, jun22), { start: jun22, end: sep22 });
});

test("range: a span across years keeps every month between the ends", () => {
  const range = makeRange({ year: 2021, month: 10 }, { year: 2022, month: 1 });
  assert.equal(inRange(2021, 11, range), true);
  assert.equal(inRange(2022, 0, range), true);
  assert.equal(inRange(2021, 9, range), false);
});

test("range: detection dates are tested by their month", () => {
  const range = makeRange(jun22, sep22);
  assert.equal(inRangeDate("2022-06-01", range), true);
  assert.equal(inRangeDate("2022-09-30", range), true);
  assert.equal(inRangeDate("2022-05-31", range), false);
  assert.equal(inRangeDate("2022-10-01", range), false);
  assert.equal(inRangeDate("", range), false);
});

test("link: a bare year still opens as that whole year, so old links keep working", () => {
  assert.deepEqual(parseRangeBound("2010", "start"), { year: 2010, month: 0 });
  assert.deepEqual(parseRangeBound("2010", "end"), { year: 2010, month: 11 });
  assert.deepEqual(parseRangeBound("2022-06", "start"), jun22);
  assert.deepEqual(parseRangeBound("2022-09", "end"), sep22);
});

test("link: anything else is ignored rather than guessed", () => {
  for (const text of [null, "", "22-06", "2022-13", "2022-00", "2022-6", "1800", "2022-06-01", "abcd"]) {
    assert.equal(parseRangeBound(text, "start"), undefined, String(text));
  }
});

test("link: a whole-year end is written as a bare year, a month as YYYY-MM", () => {
  assert.equal(formatRangeBound({ year: 2010, month: 0 }, "start"), "2010");
  assert.equal(formatRangeBound({ year: 2010, month: 11 }, "end"), "2010");
  assert.equal(formatRangeBound(jun22, "start"), "2022-06");
  assert.equal(formatRangeBound({ year: 2022, month: 0 }, "end"), "2022-01");
});

test("range: it is kept inside the data's first and last month", () => {
  const first = { year: 2000, month: 10 };
  const last = { year: 2026, month: 10 };
  assert.deepEqual(clampRange(makeRange({ year: 1999, month: 0 }, { year: 2030, month: 0 }), first, last), {
    start: first,
    end: last,
  });
  assert.deepEqual(clampRange(makeRange(jun22, sep22), first, last), { start: jun22, end: sep22 });
});

test("range: labels read as years when whole years are picked, as months otherwise", () => {
  assert.equal(isWholeYears(makeRange({ year: 2000, month: 0 }, { year: 2026, month: 11 })), true);
  assert.equal(rangeLabel(makeRange({ year: 2000, month: 0 }, { year: 2026, month: 11 })), "2000–2026");
  assert.equal(isWholeYears(makeRange(jun22, sep22)), false);
  assert.equal(rangeLabel(makeRange(jun22, sep22)), "Jun 2022 – Sep 2022");
});
