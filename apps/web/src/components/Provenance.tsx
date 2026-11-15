"use client";

import { formatCount, formatIndex, formatPercent } from "@/lib/format";
import type { MethodPayload } from "@/lib/types";

/** S8: sources, method, calibration window and known limitations, in plain words. */
export function Provenance({ method }: { method: MethodPayload }) {
  const calibration = method.calibration;
  return (
    <section className="rounded-xl border border-slate-800 bg-slate-900/40 p-4">
      <h2 className="mb-2 text-sm font-semibold text-slate-200">Provenance and known limits</h2>

      <div className="grid gap-4 text-xs leading-relaxed text-slate-400 md:grid-cols-3">
        <div>
          <h3 className="mb-1 font-semibold text-slate-300">Where the data comes from</h3>
          <p>
            NASA FIRMS: MODIS Collection 6.1 (Terra, Aqua, 1 km) and VIIRS 375 m (Suomi-NPP, NOAA-20, NOAA-21). Read
            through the <span className="text-slate-300">Portolan mirror</span> of FIRMS on Source Cooperative (CC0),
            with no key and no rate limit. Records run from {method.coverage.first_month ?? "2000-11"} to{" "}
            {method.coverage.last_month ?? "today"}.
          </p>
          <p className="mt-2">
            Detections in the mirror were checked against the official NASA FIRMS country files for 2016 and 2022: the
            counts are identical.
          </p>
          {method.boundary ? (
            <p className="mt-2">
              Clipped to the official boundary (Instituto Geográfico Nacional via geoBoundaries, CC BY 4.0):{" "}
              <strong className="text-slate-200">{formatCount(method.boundary.in_boundary)}</strong> of the{" "}
              {formatCount(method.boundary.in_bbox)} filtered detections in the reading box fall inside.
            </p>
          ) : null}
        </div>

        <div>
          <h3 className="mb-1 font-semibold text-slate-300">How it is harmonized</h3>
          <p>
            Reference: <strong className="text-slate-200">{method.reference}</strong>, the only orbit continuous from
            2002 through every VIIRS and with the same afternoon overpass (~13:30).
          </p>
          <p className="mt-1">
            One factor per calendar month, day and night together, fitted on the overlap window{" "}
            <strong className="text-slate-200">{calibration.overlap_first}</strong> →{" "}
            <strong className="text-slate-200">{calibration.calibration_last_year ?? "—"}</strong>. Sparse months are
            pulled towards the pooled factor {formatIndex(calibration.pooled)} with empirical-Bayes shrinkage.
          </p>
          {calibration.prior ? (
            <p className="mt-1">
              Too few local Aqua detections for a seasonal shape of its own, so each month is shrunk towards the factor
              of <strong className="text-slate-200">{calibration.prior.region}</strong> for the same month, rescaled to
              this region&apos;s level.
            </p>
          ) : null}
          <p className="mt-1">
            One VIIRS at a time: <strong className="text-slate-200">{method.primary}</strong> carries the series;
            after it stopped, <strong className="text-slate-200">{method.tail}</strong> takes over with its own factor.
            Adding satellites together is exactly the step this project removes.
          </p>
          <p className="mt-1">
            Validation in the overlap: median |error| {formatPercent(method.validation.median_abs_error_pct)}, worst{" "}
            {formatPercent(method.validation.worst_abs_error_pct)}.
            {method.validation.holdout ? (
              <>
                {" "}
                Blind test with Aqua hidden ({method.validation.holdout.test[0].slice(0, 4)} to{" "}
                {method.validation.holdout.test[1].slice(0, 4)}): {formatPercent(method.validation.holdout.error_pct)},
                against {formatPercent(method.validation.holdout.raw_error_pct)} for raw VIIRS.
              </>
            ) : null}
          </p>
        </div>

        <div>
          <h3 className="mb-1 font-semibold text-slate-300">What this is not, and what it cannot do</h3>
          <ul className="list-disc space-y-1 pl-4">
            <li>
              It is an <strong className="text-slate-200">activity index</strong> expressed in Aqua MODIS detections,
              not a count of fires or of hectares burned.
            </li>
            {method.limitations.map((limitation) => (
              <li key={limitation}>{limitation}</li>
            ))}
          </ul>
        </div>
      </div>

      <p className="mt-3 border-t border-slate-800 pt-2 text-[11px] text-slate-500">
        We acknowledge the use of data from NASA&apos;s Fire Information for Resource Management System (FIRMS),
        part of NASA&apos;s Earth Observing System Data and Information System (EOSDIS). Ingest approach inspired by
        Kiln Watch (Team Off The Binary, NASA Space Apps 2026); our implementation is our own.
      </p>
    </section>
  );
}
