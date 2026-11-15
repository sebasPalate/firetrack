"use client";

import { MONTHS, formatCount, formatDelta, formatIndex, formatPercent } from "@/lib/format";
import type { CalendarPayload } from "@/lib/types";

type Selection = { year: number; month: number };

/**
 * S4: for the selected month+year, the value, the multi-year median for that
 * calendar month, and the anomaly as both an absolute delta and a percentage.
 * It also says which sensor carried the month, because that is the whole point.
 */
export function DetailPanel({
  payload,
  selection,
}: {
  payload: CalendarPayload;
  selection: Selection;
}) {
  const column = payload.years.indexOf(selection.year);
  const index = column >= 0 ? payload.harmonized[selection.month][column] : null;
  const median = payload.median_by_month[String(selection.month + 1)] ?? null;
  const anomaly = column >= 0 ? payload.anomaly_pct[selection.month][column] : null;
  const raw = column >= 0 ? payload.raw_count[selection.month][column] : null;
  const source = column >= 0 ? payload.source[selection.month][column] : null;
  const factor = column >= 0 ? payload.factor[selection.month][column] : null;
  const observed = column >= 0 ? payload.observed_days[selection.month][column] : null;
  const partial = column >= 0 ? payload.partial[selection.month][column] : false;
  const provisional = column >= 0 ? payload.provisional[selection.month][column] : false;
  const delta = index !== null && median !== null ? index - median : null;

  return (
    <section className="rounded-xl border border-slate-800 bg-slate-900/40 p-4">
      <header className="mb-3 flex items-baseline justify-between gap-2">
        <h2 className="text-sm font-semibold text-slate-200">
          {MONTHS[selection.month]} {selection.year}
        </h2>
        {provisional ? <span className="text-[10px] font-semibold text-amber-300">PROVISIONAL</span> : null}
      </header>

      <p className="text-4xl font-semibold tabular-nums text-slate-100">{formatIndex(index)}</p>
      <p className="mb-3 text-xs text-slate-400">harmonized activity index (Aqua MODIS detections)</p>

      <dl className="space-y-1.5 text-sm">
        <Line label="Median for this month" value={formatIndex(median)} />
        <Line
          label="Anomaly"
          value={`${formatDelta(delta)} · ${formatPercent(anomaly)}`}
          tone={anomaly === null ? "muted" : anomaly > 15 ? "hot" : anomaly < -15 ? "cold" : "muted"}
        />
        <Line label="Raw detections that month" value={formatCount(raw)} />
      </dl>

      <div className="mt-3 border-t border-slate-800 pt-2 text-xs leading-relaxed text-slate-400">
        {source ? (
          <>
            Carried by <strong className="text-slate-200">{source}</strong>
            {factor && factor !== 1 ? (
              <>
                , divided by a factor of <strong className="tabular-nums text-slate-200">{factor}</strong>
              </>
            ) : (
              <> — the reference sensor itself, so its counts are the unit</>
            )}
            . Observed on {formatCount(observed)} days of {selection.month === 1 ? 31 : new Date(selection.year, selection.month + 1, 0).getDate()}.
          </>
        ) : (
          <>No sensor observed this month completely enough to be usable.</>
        )}
        {partial ? (
          <p className="mt-1 text-amber-300">
            Partial month: fewer observing days than the month is long, so do not read it as an anomaly.
          </p>
        ) : null}
        {provisional ? (
          <p className="mt-1 text-amber-300">
            Running year: it still mixes near-real-time rows and is excluded from the calibration. Treat it as a
            preview.
          </p>
        ) : null}
      </div>
    </section>
  );
}

function Line({ label, value, tone = "muted" }: { label: string; value: string; tone?: "hot" | "cold" | "muted" }) {
  const colour = tone === "hot" ? "text-rose-300" : tone === "cold" ? "text-sky-300" : "text-slate-100";
  return (
    <div className="flex items-baseline justify-between gap-3">
      <dt className="text-xs text-slate-400">{label}</dt>
      <dd className={`text-sm font-medium tabular-nums ${colour}`}>{value}</dd>
    </div>
  );
}
