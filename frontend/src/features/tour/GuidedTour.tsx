"use client";

import { useEffect, type ReactNode } from "react";

export type TourStep = {
  title: string;
  body: ReactNode;
  /** Id of the section the page scrolls to for this step. */
  target: string;
};

type Props = {
  steps: TourStep[];
  index: number;
  onIndex: (index: number) => void;
  onExit: () => void;
};

/**
 * A coach card pinned to the bottom of the screen, so the chart it talks about
 * stays visible above it. Escape closes it; every step is reachable by keyboard.
 */
export function GuidedTour({ steps, index, onIndex, onExit }: Props) {
  useEffect(() => {
    function onKey(event: KeyboardEvent) {
      if (event.key === "Escape") onExit();
    }
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [onExit]);

  const step = steps[index];
  if (!step) return null;
  const last = index === steps.length - 1;

  return (
    <section
      aria-label="Guided tour"
      className="fixed inset-x-4 bottom-4 z-40 mx-auto max-w-3xl rounded-xl border border-sky-500/40 bg-slate-900/95 p-4 shadow-2xl backdrop-blur"
    >
      <div className="flex items-start justify-between gap-3">
        <div>
          <p className="text-[11px] font-semibold uppercase tracking-wide text-sky-300">
            Guided tour · {index + 1} of {steps.length}
          </p>
          <h2 className="mt-1 text-base font-semibold text-slate-100">{step.title}</h2>
        </div>
        <button
          type="button"
          onClick={onExit}
          className="rounded-md px-2 py-1 text-xs text-slate-400 hover:bg-slate-800 hover:text-slate-200 focus-visible:outline focus-visible:outline-2 focus-visible:outline-sky-400"
        >
          Close
        </button>
      </div>

      <div className="mt-2 text-sm leading-relaxed text-slate-300" aria-live="polite">
        {step.body}
      </div>

      <div className="mt-3 flex items-center justify-between gap-3">
        <ol className="flex gap-1.5" aria-hidden>
          {steps.map((_, position) => (
            <li
              key={position}
              className={`h-1.5 w-6 rounded-full ${position <= index ? "bg-sky-400" : "bg-slate-700"}`}
            />
          ))}
        </ol>
        <div className="flex gap-2 text-xs">
          <button
            type="button"
            disabled={index === 0}
            onClick={() => onIndex(index - 1)}
            className="rounded-md border border-slate-700 px-3 py-1.5 text-slate-200 hover:bg-slate-800 focus-visible:outline focus-visible:outline-2 focus-visible:outline-sky-400 disabled:opacity-40"
          >
            Back
          </button>
          <button
            type="button"
            onClick={() => (last ? onExit() : onIndex(index + 1))}
            className="rounded-md border border-sky-500/50 bg-sky-500/15 px-3 py-1.5 font-medium text-sky-200 hover:bg-sky-500/25 focus-visible:outline focus-visible:outline-2 focus-visible:outline-sky-400"
          >
            {last ? "Finish" : "Next"}
          </button>
        </div>
      </div>
    </section>
  );
}
