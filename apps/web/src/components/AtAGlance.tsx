"use client";

import { MONTHS, formatCount, formatIndex, formatPercent } from "@/lib/format";
import type { Summary } from "@/lib/insights";

type Selection = { year: number; month: number };

type Props = {
  summary: Summary;
  /** The busiest month of a year, so picking a year opens a month worth looking at. */
  peakOfYear: (year: number) => number;
  onSelect: (selection: Selection) => void;
  /** The range in words: "2000–2026" or "Jun 2022 – Sep 2022". */
  range: string;
};

const card =
  "rounded-xl border border-slate-800 bg-slate-900/60 p-3 text-left focus-visible:outline focus-visible:outline-2 focus-visible:outline-sky-400";
const clickable = "transition-colors hover:border-slate-600 hover:bg-slate-900";

/**
 * The questions a fire manager asks first, answered before the calendar:
 * which year burned most, when the season peaks, and whether the latest month
 * is unusual. Every card opens the month it talks about.
 */
export function AtAGlance({ summary, peakOfYear, onSelect, range }: Props) {
  const { peakYear, peakMonth, latest, topMonths, rawDetections } = summary;
  const anomalyTone =
    latest?.anomalyPct === null || latest?.anomalyPct === undefined
      ? "text-slate-300"
      : latest.anomalyPct > 0
        ? "text-rose-300"
        : "text-sky-300";

  return (
    <section aria-labelledby="glance-title" className="space-y-2">
      <h2 id="glance-title" className="text-sm font-semibold text-slate-200">
        At a glance · {range}
      </h2>
      <div className="grid gap-2 sm:grid-cols-2 xl:grid-cols-4">
        {latest ? (
          <button
            type="button"
            onClick={() => onSelect({ year: latest.year, month: latest.month })}
            className={`${card} ${clickable}`}
          >
            <span className="flex items-baseline justify-between gap-2 text-[11px] uppercase tracking-wider text-slate-500">
              Latest complete month
              {latest.provisional ? <span className="normal-case tracking-normal text-amber-300">provisional</span> : null}
            </span>
            <span className="mt-1 block text-lg font-semibold text-slate-100">
              {MONTHS[latest.month]} {latest.year}
            </span>
            <span className="block text-xs text-slate-400">
              index {formatIndex(latest.index)} · median {formatIndex(latest.median)}
            </span>
            <span className={`block text-xs font-medium ${anomalyTone}`}>
              {latest.anomalyPct === null ? "no anomaly for this month" : `${formatPercent(latest.anomalyPct)} vs its usual level`}
            </span>
          </button>
        ) : null}

        {peakYear ? (
          <button
            type="button"
            onClick={() => onSelect({ year: peakYear.year, month: peakOfYear(peakYear.year) })}
            className={`${card} ${clickable}`}
          >
            <span className="block text-[11px] uppercase tracking-wider text-slate-500">Most active year</span>
            <span className="mt-1 block text-lg font-semibold text-slate-100">{peakYear.year}</span>
            <span className="block text-xs text-slate-400">yearly index {formatIndex(peakYear.index)}</span>
            <span className="block text-xs font-medium text-rose-300">
              {peakYear.vsMedianPct === null ? "" : `${formatPercent(peakYear.vsMedianPct)} vs the median year`}
            </span>
          </button>
        ) : null}

        {peakMonth ? (
          <div className={card}>
            <span className="block text-[11px] uppercase tracking-wider text-slate-500">Fire season peak</span>
            <span className="mt-1 block text-lg font-semibold text-slate-100">{MONTHS[peakMonth.month]}</span>
            <span className="block text-xs text-slate-400">median index {formatIndex(peakMonth.median)} in the range</span>
            <span className="block text-xs text-slate-500">running year and partial months left out</span>
          </div>
        ) : null}

        <div className={card}>
          <span className="block text-[11px] uppercase tracking-wider text-slate-500">Busiest months</span>
          <ol className="mt-1 space-y-0.5 text-xs">
            {topMonths.map((cell, index) => (
              <li key={`${cell.year}-${cell.month}`}>
                <button
                  type="button"
                  onClick={() => onSelect({ year: cell.year, month: cell.month })}
                  className="flex w-full justify-between gap-2 rounded px-1 text-slate-200 hover:bg-slate-800 focus-visible:outline focus-visible:outline-2 focus-visible:outline-sky-400"
                >
                  <span>
                    {index + 1}. {MONTHS[cell.month]} {cell.year}
                  </span>
                  <span className="tabular-nums text-slate-400">{formatIndex(cell.index)}</span>
                </button>
              </li>
            ))}
          </ol>
          <span className="mt-1 block text-[11px] text-slate-500">
            {formatCount(rawDetections)} raw detections in the range
          </span>
        </div>
      </div>
    </section>
  );
}
