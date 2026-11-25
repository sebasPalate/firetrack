"use client";

import { CUSTOM_REGION_ID } from "@/features/area/aoi";
import { RangePicker } from "@/features/range/RangePicker";
import type { MonthRange } from "@/features/range/range";
import type { Region } from "@/shared/types";

export const actionButton =
  "rounded-lg border px-3 py-1.5 font-medium focus-visible:outline focus-visible:outline-2 focus-visible:outline-sky-400 disabled:opacity-50";

type Props = {
  regions: Region[];
  regionId: string;
  custom: boolean;
  /** The custom-area form is open, so the select shows "Custom area". */
  areaFormOpen: boolean;
  onPickRegion: (region: string) => void;
  onOpenAreaForm: () => void;
  years: number[];
  range: MonthRange | null;
  onRange: (range: MonthRange) => void;
  /** The view has data, so the tour and the link make sense. */
  ready: boolean;
  tourOpen: boolean;
  onToggleTour: () => void;
  onCopyLink: () => void;
  download: {
    /** Cut in the browser (static mode, a custom box or a month range); otherwise a plain API link. */
    inBrowser: boolean;
    busy: boolean;
    onStart: () => void;
    href: string;
  };
};

/** The "Explore the record" box: area, range and the actions on the view. */
export function ControlsBar({
  regions,
  regionId,
  custom,
  areaFormOpen,
  onPickRegion,
  onOpenAreaForm,
  years,
  range,
  onRange,
  ready,
  tourOpen,
  onToggleTour,
  onCopyLink,
  download,
}: Props) {
  return (
    <div className="rounded-2xl border border-slate-800 bg-slate-900/70 p-3 shadow-lg shadow-slate-950/20">
      <div className="mb-2 flex items-center justify-between gap-3">
        <span className="text-xs font-semibold text-slate-200">Explore the record</span>
        <span className="text-[10px] uppercase tracking-wider text-slate-500">Controls</span>
      </div>
      <div className="flex flex-wrap items-end gap-2 text-xs">
        <label className="flex flex-col gap-1">
          <span className="text-slate-500">Area</span>
          <select
            value={areaFormOpen ? CUSTOM_REGION_ID : regionId}
            onChange={(event) =>
              event.target.value === CUSTOM_REGION_ID ? onOpenAreaForm() : onPickRegion(event.target.value)
            }
            className="min-w-32 rounded-lg border border-slate-700 bg-slate-950 px-2 py-1.5 text-slate-100"
          >
            {regions.length === 0 && !custom ? <option value={regionId}>{regionId}</option> : null}
            {regions.map((candidate) => (
              <option key={candidate.id} value={candidate.id}>
                {candidate.name}
              </option>
            ))}
            <option value={CUSTOM_REGION_ID}>Custom area (lat/lon box)</option>
          </select>
        </label>
        {custom && !areaFormOpen ? (
          <button
            type="button"
            onClick={onOpenAreaForm}
            className={`${actionButton} border-slate-600 text-slate-200 hover:bg-slate-800`}
          >
            Edit area
          </button>
        ) : null}
        <RangePicker years={years} range={range} onRange={onRange} />
        <button
          type="button"
          disabled={!ready}
          onClick={onToggleTour}
          aria-pressed={tourOpen}
          className={`${actionButton} border-sky-500/40 bg-sky-500/10 text-sky-300 hover:bg-sky-500/20`}
        >
          {tourOpen ? "Close tour" : "Guided tour"}
        </button>
        <button
          type="button"
          disabled={!ready}
          onClick={onCopyLink}
          className={`${actionButton} border-slate-600 text-slate-200 hover:bg-slate-800`}
        >
          Copy link
        </button>
        {download.inBrowser ? (
          <button
            type="button"
            disabled={download.busy}
            onClick={download.onStart}
            title={
              custom
                ? "Every detection in the selected range inside the custom box, with its sensor, confidence and FRP."
                : "Every detection in the selected range inside the region boundary, with its sensor, confidence and FRP."
            }
            className={`${actionButton} border-emerald-500/40 bg-emerald-500/10 text-emerald-300 hover:bg-emerald-500/20`}
          >
            {download.busy ? "Preparing CSV…" : "Download CSV"}
          </button>
        ) : (
          <a
            href={download.href}
            title="Every detection in the selected range, with its sensor, confidence and FRP. Capped at 200,000 rows, so pick a range you need."
            className={`${actionButton} border-emerald-500/40 bg-emerald-500/10 text-emerald-300 hover:bg-emerald-500/20`}
          >
            Download CSV
          </a>
        )}
      </div>
    </div>
  );
}
