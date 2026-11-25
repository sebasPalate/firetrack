"use client";

import { TimeControls } from "@/features/calendar/TimeControls";
import type { ViewMode } from "@/features/calendar/view";

type Props = {
  mode: ViewMode;
  onMode: (mode: ViewMode) => void;
  onExportTable: () => void;
  onExportImage: (format: "png" | "svg") => void;
  /** "Oct 2026", or null before a month is selected. */
  selectionLabel: string | null;
  playback: {
    isPlaying: boolean;
    canPrev: boolean;
    canNext: boolean;
    onPrev: () => void;
    onNext: () => void;
    onToggle: () => void;
  };
};

const scaleButton =
  "rounded-md px-2 py-1 focus-visible:outline focus-visible:outline-2 focus-visible:outline-sky-400";
const exportButton =
  "rounded-md border border-slate-700 px-2 py-1 text-slate-300 hover:bg-slate-800 focus-visible:outline focus-visible:outline-2 focus-visible:outline-sky-400";

/** Above the calendar: its scale, its downloads and the time controls. */
export function CalendarToolbar({ mode, onMode, onExportTable, onExportImage, selectionLabel, playback }: Props) {
  return (
    <div className="flex flex-wrap items-center justify-between gap-2 text-xs">
      <div role="group" aria-label="Calendar scale" className="flex items-center gap-1">
        {(["index", "anomaly"] as const).map((option) => (
          <button
            key={option}
            type="button"
            aria-pressed={mode === option}
            onClick={() => onMode(option)}
            className={`${scaleButton} ${
              mode === option ? "bg-slate-700 text-slate-100" : "text-slate-400 hover:text-slate-200"
            }`}
          >
            {option === "index" ? "Index" : "Anomaly"}
          </button>
        ))}
      </div>
      <div role="group" aria-label="Download the calendar" className="flex items-center gap-1">
        <span className="text-slate-500">Download</span>
        <button
          type="button"
          onClick={onExportTable}
          title="One row per month in the range: index, raw detections, median, anomaly, sensor and factor."
          className={exportButton}
        >
          Table CSV
        </button>
        <button
          type="button"
          onClick={() => onExportImage("png")}
          title="The calendar as shown, as an image for a report or a slide."
          className={exportButton}
        >
          PNG
        </button>
        <button
          type="button"
          onClick={() => onExportImage("svg")}
          title="The calendar as shown, as a vector image."
          className={exportButton}
        >
          SVG
        </button>
      </div>
      {selectionLabel ? (
        <TimeControls
          label={selectionLabel}
          playing={playback.isPlaying}
          canPrev={playback.canPrev}
          canNext={playback.canNext}
          onPrev={playback.onPrev}
          onNext={playback.onNext}
          onToggle={playback.onToggle}
        />
      ) : null}
    </div>
  );
}
