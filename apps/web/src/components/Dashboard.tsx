"use client";

import { useEffect, useMemo, useState } from "react";

import { CalendarHeatmap } from "@/components/CalendarHeatmap";
import { DetailPanel } from "@/components/DetailPanel";
import { MonthlySeries } from "@/components/MonthlySeries";
import { Provenance } from "@/components/Provenance";
import { Seasonality } from "@/components/Seasonality";
import { Validation } from "@/components/Validation";
import { YearlyTotals } from "@/components/YearlyTotals";
import { ApiError, API_BASE, detectionsCsvUrl, fetchCalendar, fetchMethod, fetchRegions } from "@/lib/api";
import type { CalendarPayload, MethodPayload, Region } from "@/lib/types";

type Selection = { year: number; month: number };

function percentile(values: number[], share: number): number {
  if (!values.length) return 0;
  const ordered = [...values].sort((a, b) => a - b);
  return ordered[Math.min(ordered.length - 1, Math.floor(share * ordered.length))];
}

/**
 * The region list is one request for the whole session; the calendar and the
 * calibration table are one request per region. Splitting them lets the region
 * view remount on a region change (`key`), which is what makes the loading and
 * error state honest instead of leaking one region's failure into the next.
 */
export function Dashboard() {
  const [regions, setRegions] = useState<Region[]>([]);
  const [regionId, setRegionId] = useState("iberia");
  const [regionsError, setRegionsError] = useState<string | null>(null);

  useEffect(() => {
    const controller = new AbortController();
    fetchRegions(controller.signal)
      .then((list) => {
        setRegions(list);
        if (list.length && !list.some((region) => region.id === "iberia")) {
          setRegionId(list[0].id);
        }
      })
      .catch((cause: unknown) => {
        if (controller.signal.aborted) return;
        setRegionsError(
          cause instanceof ApiError ? cause.message : "The API is unreachable. Is FastAPI running?",
        );
      });
    return () => controller.abort();
  }, []);

  return (
    <RegionView
      key={regionId}
      regionId={regionId}
      regions={regions}
      regionsError={regionsError}
      onRegion={setRegionId}
    />
  );
}

function RegionView({
  regionId,
  regions,
  regionsError,
  onRegion,
}: {
  regionId: string;
  regions: Region[];
  regionsError: string | null;
  onRegion: (region: string) => void;
}) {
  const [payload, setPayload] = useState<CalendarPayload | null>(null);
  const [method, setMethod] = useState<MethodPayload | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [loading, setLoading] = useState(true);
  const [mode, setMode] = useState<"index" | "anomaly">("index");
  const [series, setSeries] = useState<"harmonized" | "raw">("harmonized");
  const [selection, setSelection] = useState<Selection | null>(null);
  const [range, setRange] = useState<{ start: number; end: number } | null>(null);

  useEffect(() => {
    const controller = new AbortController();
    Promise.all([fetchCalendar(regionId, controller.signal), fetchMethod(controller.signal)])
      .then(([calendar, calibration]) => {
        setPayload(calendar);
        setMethod(calibration);
        setRange({ start: calendar.years[0], end: calendar.years[calendar.years.length - 1] });
        setSelection(latestUsable(calendar));
      })
      .catch((cause: unknown) => {
        if (controller.signal.aborted) return;
        setPayload(null);
        setError(
          cause instanceof ApiError
            ? cause.message
            : `Could not reach ${API_BASE}. Start it with: cd services/api; uvicorn main:app`,
        );
      })
      .finally(() => {
        if (!controller.signal.aborted) setLoading(false);
      });
    return () => controller.abort();
  }, [regionId]);

  const years = useMemo(() => {
    if (!payload) return [];
    const start = range?.start ?? payload.years[0];
    const end = range?.end ?? payload.years[payload.years.length - 1];
    const low = Math.min(start, end);
    const high = Math.max(start, end);
    return payload.years.filter((year) => year >= low && year <= high);
  }, [payload, range]);

  const scale = useMemo(() => {
    if (!payload || !years.length) return 1;
    if (mode === "index") {
      const values: number[] = [];
      years.forEach((year) => {
        const column = payload.years.indexOf(year);
        for (let month = 0; month < 12; month += 1) {
          const value = payload.harmonized[month][column];
          if (value !== null) values.push(value);
        }
      });
      return Math.max(percentile(values, 0.95), 1);
    }
    const anomalies: number[] = [];
    years.forEach((year) => {
      const column = payload.years.indexOf(year);
      for (let month = 0; month < 12; month += 1) {
        const value = payload.anomaly_pct[month][column];
        if (value !== null) anomalies.push(Math.abs(value));
      }
    });
    return Math.min(Math.max(percentile(anomalies, 0.95), 25), 250);
  }, [payload, years, mode]);

  const region = regions.find((candidate) => candidate.id === regionId);
  const problem = error ?? regionsError;

  return (
    <div className="mx-auto max-w-[1400px] px-4 py-6">
      <header className="mb-6">
        <div className="flex flex-wrap items-start justify-between gap-4">
          <div>
            <h1 className="text-2xl font-semibold tracking-tight text-slate-100">Firetrack</h1>
            <p className="mt-1 max-w-2xl text-sm leading-relaxed text-slate-400">
              One comparable fire record from NASA MODIS and VIIRS. Pick an area and a range, then read the calendar:
              every cell is a month expressed in the same units, so 2005 and 2024 can finally be compared.
            </p>
          </div>
          <div className="flex flex-wrap items-end gap-2 text-xs">
            <label className="flex flex-col gap-1">
              <span className="text-slate-500">Area</span>
              <select
                value={regionId}
                onChange={(event) => onRegion(event.target.value)}
                className="rounded-lg border border-slate-700 bg-slate-900 px-2 py-1.5 text-slate-100"
              >
                {regions.length === 0 ? <option value="iberia">iberia</option> : null}
                {regions.map((candidate) => (
                  <option key={candidate.id} value={candidate.id}>
                    {candidate.name}
                  </option>
                ))}
              </select>
            </label>
            <label className="flex flex-col gap-1">
              <span className="text-slate-500">From</span>
              <select
                value={range?.start ?? ""}
                onChange={(event) =>
                  setRange((current) => ({
                    start: Number(event.target.value),
                    end: current?.end ?? Number(event.target.value),
                  }))
                }
                className="rounded-lg border border-slate-700 bg-slate-900 px-2 py-1.5 text-slate-100"
              >
                {(payload?.years ?? []).map((year) => (
                  <option key={year} value={year}>
                    {year}
                  </option>
                ))}
              </select>
            </label>
            <label className="flex flex-col gap-1">
              <span className="text-slate-500">To</span>
              <select
                value={range?.end ?? ""}
                onChange={(event) =>
                  setRange((current) => ({
                    start: current?.start ?? Number(event.target.value),
                    end: Number(event.target.value),
                  }))
                }
                className="rounded-lg border border-slate-700 bg-slate-900 px-2 py-1.5 text-slate-100"
              >
                {(payload?.years ?? []).map((year) => (
                  <option key={year} value={year}>
                    {year}
                  </option>
                ))}
              </select>
            </label>
            <a
              href={detectionsCsvUrl(regionId, years[0] ?? 2000, years[years.length - 1] ?? 2026)}
              title="Every detection in the selected range, with its sensor, confidence and FRP. Capped at 200,000 rows, so pick a range you need."
              className="rounded-lg border border-emerald-500/40 bg-emerald-500/10 px-3 py-1.5 font-medium text-emerald-300 hover:bg-emerald-500/20"
            >
              Download CSV
            </a>
          </div>
        </div>
        {region ? (
          <p className="mt-2 text-[11px] text-slate-500">
            bbox {region.bbox.map((value) => value.toFixed(1)).join(", ")} · {region.why}
          </p>
        ) : null}
      </header>

      {problem ? (
        <div className="mb-4 rounded-xl border border-rose-500/40 bg-rose-500/10 p-4 text-sm text-rose-200">
          <p className="font-semibold">The view cannot be built</p>
          <p className="mt-1 text-rose-300">{problem}</p>
        </div>
      ) : null}

      {loading && !payload ? <p className="text-sm text-slate-500">Loading the harmonized artifacts…</p> : null}

      {payload && method && years.length ? (
        <div className="space-y-4">
          <div className="grid gap-4 lg:grid-cols-[2fr_1fr]">
            <div className="space-y-2">
              <div className="flex items-center gap-1 text-xs">
                <button
                  type="button"
                  onClick={() => setMode("index")}
                  className={`rounded-md px-2 py-1 ${mode === "index" ? "bg-slate-700 text-slate-100" : "text-slate-400"}`}
                >
                  Index
                </button>
                <button
                  type="button"
                  onClick={() => setMode("anomaly")}
                  className={`rounded-md px-2 py-1 ${mode === "anomaly" ? "bg-slate-700 text-slate-100" : "text-slate-400"}`}
                >
                  Anomaly
                </button>
              </div>
              <CalendarHeatmap
                payload={payload}
                mode={mode}
                scaleMax={scale}
                years={years}
                selection={selection}
                onSelect={setSelection}
              />
            </div>
            {selection ? <DetailPanel payload={payload} selection={selection} /> : null}
          </div>

          <div className="grid gap-4 lg:grid-cols-2">
            <YearlyTotals payload={payload} years={years} series={series} onSeries={setSeries} />
            <Seasonality payload={payload} />
          </div>

          <div className="grid gap-4 lg:grid-cols-2">
            <MonthlySeries payload={payload} years={years} />
            <Validation method={method} />
          </div>

          <Provenance method={method} />
        </div>
      ) : null}

      <footer className="mt-6 text-[11px] text-slate-600">
        Firetrack · NASA Space Apps Challenge 2026 · harmonized activity index, never a fire count.
      </footer>
    </div>
  );
}

/** The running year is a preview, so open on the last month that is actually complete. */
function latestUsable(payload: CalendarPayload): Selection {
  const lastColumn = payload.years.length - 1;
  for (let month = 11; month >= 0; month -= 1) {
    if (payload.harmonized[month][lastColumn] !== null && !payload.partial[month][lastColumn]) {
      return { year: payload.years[lastColumn], month };
    }
  }
  return { year: payload.years[lastColumn], month: 11 };
}
