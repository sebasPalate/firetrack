"use client";

type Props = {
  /** The month being shown, e.g. "Aug 2023". */
  label: string;
  playing: boolean;
  canPrev: boolean;
  canNext: boolean;
  onPrev: () => void;
  onNext: () => void;
  onToggle: () => void;
};

const BUTTON =
  "flex h-7 items-center justify-center gap-1.5 rounded-md border border-slate-700 px-2 text-slate-200 hover:bg-slate-800 focus-visible:outline focus-visible:outline-2 focus-visible:outline-sky-400 disabled:opacity-40 disabled:hover:bg-transparent";

/** Step through the record one observed month at a time, or let it play. */
export function TimeControls({ label, playing, canPrev, canNext, onPrev, onNext, onToggle }: Props) {
  return (
    <div role="group" aria-label="Move through time" className="flex items-center gap-1 text-xs">
      <span className="mr-1 min-w-[4.25rem] text-right tabular-nums text-slate-300" aria-live="polite">
        {label}
      </span>
      <button type="button" className={`${BUTTON} w-7`} onClick={onPrev} disabled={!canPrev} aria-label="Previous month">
        <svg width="10" height="10" viewBox="0 0 10 10" aria-hidden fill="currentColor">
          <path d="M7 1 2 5l5 4z" />
        </svg>
      </button>
      <button
        type="button"
        className={`${BUTTON} min-w-[4.5rem] ${playing ? "border-sky-500/60 bg-sky-500/10 text-sky-200" : ""}`}
        onClick={onToggle}
        aria-pressed={playing}
        title={playing ? "Pause" : "Play through the record, month by month"}
      >
        <svg width="10" height="10" viewBox="0 0 10 10" aria-hidden fill="currentColor">
          {playing ? <path d="M2 1h2.2v8H2zM5.8 1H8v8H5.8z" /> : <path d="M2 1l7 4-7 4z" />}
        </svg>
        {playing ? "Pause" : "Play"}
      </button>
      <button type="button" className={`${BUTTON} w-7`} onClick={onNext} disabled={!canNext} aria-label="Next month">
        <svg width="10" height="10" viewBox="0 0 10 10" aria-hidden fill="currentColor">
          <path d="M3 1l5 4-5 4z" />
        </svg>
      </button>
    </div>
  );
}
