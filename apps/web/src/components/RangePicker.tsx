"use client";

import { MONTHS } from "@/lib/format";
import { makeRange, type MonthRange, type YearMonth } from "@/lib/range";

type Props = {
  /** The years the data covers. */
  years: number[];
  range: MonthRange | null;
  onRange: (range: MonthRange) => void;
};

const select = "rounded-lg border border-slate-700 bg-slate-950 px-2 py-1.5 text-slate-100";

/**
 * From and To, each a month and a year. Picking an end past the other swaps
 * them, so the range is never empty.
 */
export function RangePicker({ years, range, onRange }: Props) {
  return (
    <>
      <RangeEnd
        label="From"
        years={years}
        value={range?.start ?? null}
        onChange={(next) => range && onRange(makeRange(next, range.end))}
      />
      <RangeEnd
        label="To"
        years={years}
        value={range?.end ?? null}
        onChange={(next) => range && onRange(makeRange(range.start, next))}
      />
    </>
  );
}

function RangeEnd({
  label,
  years,
  value,
  onChange,
}: {
  label: string;
  years: number[];
  value: YearMonth | null;
  onChange: (value: YearMonth) => void;
}) {
  return (
    <fieldset className="flex flex-col gap-1">
      <legend className="mb-1 text-slate-500">{label}</legend>
      <div className="flex gap-1">
        <select
          aria-label={`${label} month`}
          value={value?.month ?? ""}
          disabled={!value}
          onChange={(event) => value && onChange({ year: value.year, month: Number(event.target.value) })}
          className={select}
        >
          {MONTHS.map((name, month) => (
            <option key={name} value={month}>
              {name}
            </option>
          ))}
        </select>
        <select
          aria-label={`${label} year`}
          value={value?.year ?? ""}
          disabled={!value}
          onChange={(event) => value && onChange({ year: Number(event.target.value), month: value.month })}
          className={select}
        >
          {years.map((year) => (
            <option key={year} value={year}>
              {year}
            </option>
          ))}
        </select>
      </div>
    </fieldset>
  );
}
