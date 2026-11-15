"use client";

import { formatIndex, formatPercent } from "@/lib/format";
import type { Holdout, MethodPayload } from "@/lib/types";

/**
 * S10: during the overlap window the calibrated index has to reproduce the
 * Aqua-native series. This is that check, drawn from the served artifact, so it
 * can never drift away from the data the calendar is showing.
 */
export function Validation({ method }: { method: MethodPayload }) {
  const years = method.validation.overlap_years;
  const rows = years.map((year) => ({
    year,
    ...(method.validation.per_year[String(year)] ?? { index: 0, aqua: 0, raw: 0 }),
  }));
  const max = Math.max(...rows.map((row) => Math.max(row.index, row.aqua)), 1);

  return (
    <section className="rounded-xl border border-slate-800 bg-slate-900/40 p-4">
      <header className="mb-1 flex flex-wrap items-baseline justify-between gap-2">
        <h2 className="text-sm font-semibold text-slate-200">Validation: does the index reproduce Aqua?</h2>
        <span className="text-xs text-slate-400">
          median |error| {formatPercent(method.validation.median_abs_error_pct)} · worst{" "}
          {formatPercent(method.validation.worst_abs_error_pct)}
        </span>
      </header>
      <p className="mb-3 text-xs leading-relaxed text-slate-400">
        Each pair is one overlap year: the harmonized index (green) against what Aqua MODIS actually detected (grey).
        They are not independent — the index is calibrated on this window — but a wrong factor shows up here as a
        systematic gap. The real checks are the 2012 step and the blind test below.
      </p>

      <div className="space-y-1">
        {rows.map((row) => (
          <div key={row.year} className="flex items-center gap-2 text-[10px] tabular-nums">
            <span className="w-8 text-slate-500">{row.year}</span>
            <div className="flex h-3 flex-1 items-center gap-[2px]">
              <div
                className="h-2.5 rounded-sm bg-emerald-400/80"
                style={{ width: `${(row.index / max) * 100}%` }}
                title={`index ${formatIndex(row.index)}`}
              />
            </div>
            <div className="flex h-3 flex-1 items-center gap-[2px]">
              <div
                className="h-2.5 rounded-sm bg-slate-500/80"
                style={{ width: `${(row.aqua / max) * 100}%` }}
                title={`Aqua ${formatIndex(row.aqua)}`}
              />
            </div>
            <span className={`w-14 text-right ${Math.abs(row.error_pct ?? 0) > 15 ? "text-amber-300" : "text-slate-500"}`}>
              {formatPercent(row.error_pct)}
            </span>
          </div>
        ))}
      </div>

      <div className="mt-3 grid gap-2 border-t border-slate-800 pt-3 text-xs sm:grid-cols-3">
        <Stat
          label="2011 → 2013, raw counts"
          value={formatPercent(method.validation.raw_step_2011_to_2013_pct)}
          note="the artificial step a naive plot shows"
          tone="bad"
        />
        <Stat
          label="2011 → 2013, Aqua alone"
          value={formatPercent(method.validation.aqua_step_2011_to_2013_pct)}
          note="what the afternoons actually did"
          tone="neutral"
        />
        <Stat
          label="2011 → 2013, harmonized index"
          value={formatPercent(method.validation.index_step_2011_to_2013_pct)}
          note="the index follows the ground, not the camera"
          tone="good"
        />
      </div>

      {method.validation.holdout ? <BlindTest holdout={method.validation.holdout} /> : null}
    </section>
  );
}

/**
 * Out of sample: the factors are refitted on the first VIIRS years only, Aqua is
 * hidden, and the next four years are rebuilt from Suomi-NPP alone. That is the
 * position of every month after Aqua, so this error is the one to quote.
 */
function BlindTest({ holdout }: { holdout: Holdout }) {
  const rows = Object.entries(holdout.per_year).map(([year, values]) => ({ year, ...values }));
  const max = Math.max(...rows.map((row) => Math.max(row.index, row.aqua)), 1);
  return (
    <div className="mt-3 border-t border-slate-800 pt-3">
      <h3 className="text-xs font-semibold text-slate-200">
        Blind test: {holdout.test[0].slice(0, 4)} to {holdout.test[1].slice(0, 4)} rebuilt without MODIS
      </h3>
      <p className="mb-2 mt-1 text-xs leading-relaxed text-slate-400">
        Factors fitted on {holdout.train[0]} → {holdout.train[1]} only. Aqua is then hidden and{" "}
        {holdout.months} months are rebuilt from Suomi-NPP alone (green) and compared with what Aqua saw (grey).
      </p>
      <div className="space-y-1">
        {rows.map((row) => (
          <div key={row.year} className="flex items-center gap-2 text-[10px] tabular-nums">
            <span className="w-8 text-slate-500">{row.year}</span>
            <div className="flex h-3 flex-1 items-center">
              <div
                className="h-2.5 rounded-sm bg-emerald-400/80"
                style={{ width: `${(row.index / max) * 100}%` }}
                title={`rebuilt ${formatIndex(row.index)}`}
              />
            </div>
            <div className="flex h-3 flex-1 items-center">
              <div
                className="h-2.5 rounded-sm bg-slate-500/80"
                style={{ width: `${(row.aqua / max) * 100}%` }}
                title={`Aqua ${formatIndex(row.aqua)}`}
              />
            </div>
            <span className={`w-14 text-right ${Math.abs(row.error_pct ?? 0) > 25 ? "text-amber-300" : "text-slate-500"}`}>
              {formatPercent(row.error_pct)}
            </span>
          </div>
        ))}
      </div>
      <div className="mt-3 grid gap-2 text-xs sm:grid-cols-3">
        <Stat
          label="Raw VIIRS vs Aqua"
          value={formatPercent(holdout.raw_error_pct)}
          note="what adding the new sensor naively does"
          tone="bad"
        />
        <Stat
          label="Rebuilt vs Aqua, 4 years"
          value={formatPercent(holdout.error_pct)}
          note={`median year ${formatPercent(holdout.median_abs_year_error_pct)}`}
          tone="good"
        />
        <Stat
          label="Month order kept"
          value={holdout.spearman_monthly === null ? "—" : `ρ ${holdout.spearman_monthly.toFixed(2)}`}
          note="Spearman, rebuilt months against Aqua months"
          tone="neutral"
        />
      </div>
    </div>
  );
}

function Stat({ label, value, note, tone }: { label: string; value: string; note: string; tone: "good" | "bad" | "neutral" }) {
  const colour = tone === "good" ? "text-emerald-300" : tone === "bad" ? "text-rose-300" : "text-slate-100";
  return (
    <div className="rounded-lg border border-slate-800 bg-slate-950/40 p-2">
      <p className="text-[10px] uppercase tracking-wide text-slate-500">{label}</p>
      <p className={`text-lg font-semibold tabular-nums ${colour}`}>{value}</p>
      <p className="text-[10px] leading-snug text-slate-500">{note}</p>
    </div>
  );
}
